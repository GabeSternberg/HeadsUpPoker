/**
 * Game state module — manages the authoritative state of a poker match.
 *
 * Supports two modes:
 *  - 'headsup': Classic 2-player. Dealer/SB acts first preflop, BB acts first postflop.
 *  - 'unlimited': Any number of players. Standard positions with dealer button.
 *
 * Standard multi-player betting order:
 *  - Preflop: action starts on player after BB (UTG), ends on BB.
 *  - Postflop: action starts on the first active player left of the dealer.
 *
 * After each hand, dealer button moves clockwise (next active seat).
 */

import { Deck, Card, cardToString } from './deck';
import { BettingState, getLegalActions, processAction, PlayerAction } from './betting';
import { evaluateHand, compareHands, HandResult } from './handEvaluator';
import { appendHandRow, StatsLogData } from './statsLogger';
import { PendingDecision, flushDecisions } from './classifierLogger';
import { getDisplayName, mapNamesInText } from './displayNames';

export const MAX_PLAYERS_PER_HAND = 23;

export type Round = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
export type GameMode = 'headsup' | 'unlimited' | 'virtualcards';

export interface PlayerState {
  id: string;
  name: string;
  customName?: string;
  ready: boolean;
  connected: boolean;
  stack: number;
  holeCards: Card[];
  seatIndex: number;
  sittingOut?: boolean;
  sitOutNextHand?: boolean;
}

export interface PotInfo {
  amount: number;
  eligiblePlayers: { seat: number; name: string }[];
  awards: { seat: number; name: string; amount: number }[];
}

export interface HandState {
  deck: Deck;
  communityCards: Card[];
  round: Round;
  pot: number;
  potResults: PotInfo[];
  currentBet: number;
  lastRaiseSize: number;
  chipUnit: number;
  playerBets: number[];
  playerActedThisRound: boolean[];
  playerLastActionBet: (number | null)[];
  playerAllIn: boolean[];
  playerFolded: boolean[];
  currentPlayerIndex: number;
  dealerIndex: number;
  sbIndex: number;
  bbIndex: number;
  handOver: boolean;
  showdown: boolean;
  winner: number | null;      // null = split pot
  winnerHand: HandResult | null;
  loserHand: HandResult | null;
  resultMessage: string;
  // Players participating in this hand (seat indices)
  participants: number[];
  // Each player's stack at the start of this hand (for side pot calculation)
  startingStacks: number[];
}

export interface Settings {
  startingSum: number;
  bigBlind: number;
  uiMode: 'mobile' | 'pc';
}

export interface VCState {
  phase: 'dealt' | 'flop' | 'turn' | 'river';
  deck: Deck;
  playerCards: Record<number, Card[]>; // seat → 2 hole cards
  communityCards: Card[];
  sbSeat: number;
  bbSeat: number;
}

export interface LastShowdown {
  playerHands: { seat: number; name: string; holeCards: Card[] }[];
  communityCards: Card[];
  resultMessage: string;
}

export interface PlayerStats {
  handsPlayed: number;
  vpipOpportunities: number;
  vpipCount: number;
  pfrOpportunities: number;
  pfrCount: number;
  threeBetOpportunities: number;
  threeBetCount: number;
  foldToThreeBetOpportunities: number;
  foldToThreeBetCount: number;
  cbetOpportunities: number;
  cbetCount: number;
  foldToCbetOpportunities: number;
  foldToCbetCount: number;
  postflopBetsRaises: number;
  postflopCalls: number;
  wtsdOpportunities: number;
  wtsdCount: number;
  wsdCount: number;
}

export interface HandStatsContext {
  preflopAggressor: number | null;
  preflopRaiseCount: number;
  playerVPIP: boolean[];
  playerPFR: boolean[];
  playerFacedRaisePreflop: boolean[];
  playerThreeBet: boolean[];
  playerRaisedFacedThreeBet: boolean[];
  playerFoldedToThreeBet: boolean[];
  sawFlop: boolean[];
  cbetOpportunity: boolean[];
  cbetMade: boolean[];
  flopCbetOccurred: boolean;
  foldToCbetOpportunity: boolean[];
  foldedToCbet: boolean[];
  postflopBetsRaises: number[];
  postflopCalls: number[];
  // Classifier tracking
  streetRaiseCount: number;
  prevBetPctPot: number;
  pendingDecisions: PendingDecision[];
}

function emptyStats(): PlayerStats {
  return {
    handsPlayed: 0,
    vpipOpportunities: 0, vpipCount: 0,
    pfrOpportunities: 0, pfrCount: 0,
    threeBetOpportunities: 0, threeBetCount: 0,
    foldToThreeBetOpportunities: 0, foldToThreeBetCount: 0,
    cbetOpportunities: 0, cbetCount: 0,
    foldToCbetOpportunities: 0, foldToCbetCount: 0,
    postflopBetsRaises: 0, postflopCalls: 0,
    wtsdOpportunities: 0, wtsdCount: 0, wsdCount: 0,
  };
}

export interface Room {
  players: (PlayerState | null)[];
  settings: Settings;
  gameStarted: boolean;
  matchOver: boolean;
  hand: HandState | null;
  actionLog: string[];
  dealerIndex: number;
  mode: GameMode;
  avatarMode: boolean;
  avatarAssignment: (string | null)[];
  handNumber: number;
  lastShowdown: LastShowdown | null;
  lastFoldedHand: { actionLog: string[]; playerHoleCards: { seat: number; holeCards: Card[] }[] } | null;
  stats: PlayerStats[];
  handStatsCtx: HandStatsContext | null;
  vc: VCState | null;
  vcPending: string[]; // socket IDs connected but not yet seated (VC mode)
  vcDealerIndex: number; // tracks dealer button for SB/BB cycling
  blockedJoiners: string[]; // socket IDs that couldn't join (room full)
  paused: boolean;
}

export function createRoom(): Room {
  return {
    players: [null, null],
    settings: { startingSum: 1000, bigBlind: 20, uiMode: 'mobile' },
    gameStarted: false,
    matchOver: false,
    hand: null,
    actionLog: [],
    dealerIndex: 0,
    mode: 'headsup',
    avatarMode: false,
    avatarAssignment: [null, null],
    handNumber: 0,
    lastShowdown: null,
    lastFoldedHand: null,
    stats: [emptyStats(), emptyStats()],
    handStatsCtx: null,
    vc: null,
    vcPending: [],
    vcDealerIndex: -1, // -1 = not yet set; randomised on first deal
    blockedJoiners: [],
    paused: false,
  };
}

// --- Virtual Cards mode ---

export function vcDeal(room: Room): void {
  let seated = room.players
    .map((p, i) => (p && p.connected && !p.sittingOut) ? i : -1)
    .filter(i => i >= 0);
  if (seated.length === 0) return;

  // Advance dealer button (random on first deal, then cycle)
  if (room.vcDealerIndex === -1 || !seated.includes(room.vcDealerIndex)) {
    room.vcDealerIndex = seated[Math.floor(Math.random() * seated.length)];
  } else {
    const di = seated.indexOf(room.vcDealerIndex);
    room.vcDealerIndex = seated[(di + 1) % seated.length];
  }

  seated = handSeats(seated, room.vcDealerIndex);

  // Heads-up: dealer = SB, other = BB. 3+ players: SB = next after dealer, BB = next after SB.
  const dealerPos = seated.indexOf(room.vcDealerIndex);
  const sbSeat = seated.length === 2
    ? room.vcDealerIndex
    : seated[(dealerPos + 1) % seated.length];
  const sbPos = seated.indexOf(sbSeat);
  const bbSeat = seated[(sbPos + 1) % seated.length];

  const deck = new Deck();
  const playerCards: Record<number, Card[]> = {};
  for (const s of seated) {
    playerCards[s] = deck.deal(2);
  }

  room.vc = { phase: 'dealt', deck, playerCards, communityCards: [], sbSeat, bbSeat };

  // Reset ready flags
  for (const p of room.players) if (p) p.ready = false;
}

export function vcNextPhase(room: Room): void {
  if (!room.vc) return;
  switch (room.vc.phase) {
    case 'dealt':
      room.vc.communityCards = room.vc.deck.deal(3);
      room.vc.phase = 'flop';
      break;
    case 'flop':
      room.vc.communityCards.push(...room.vc.deck.deal(1));
      room.vc.phase = 'turn';
      break;
    case 'turn':
      room.vc.communityCards.push(...room.vc.deck.deal(1));
      room.vc.phase = 'river';
      break;
    // river: nothing
  }
}

// --- Seat navigation helpers ---

/** Get indices of all occupied seats. */
function occupiedSeats(room: Room): number[] {
  return room.players.map((p, i) => p ? i : -1).filter(i => i >= 0);
}

/** Get indices of all players with chips > 0 (eligible to play a hand). */
function activeSeats(room: Room): number[] {
  return room.players.map((p, i) => (p && p.connected && !p.sittingOut && p.stack > 0) ? i : -1).filter(i => i >= 0);
}

/** Use one deck per hand; rotate the clockwise window with the dealer for larger groups. */
function handSeats(seats: number[], dealer: number): number[] {
  if (seats.length <= MAX_PLAYERS_PER_HAND) return seats;
  let start = seats.findIndex(s => s >= dealer);
  if (start < 0) start = 0;
  return [...seats.slice(start), ...seats.slice(0, start)].slice(0, MAX_PLAYERS_PER_HAND).sort((a, b) => a - b);
}

/** Next occupied seat clockwise from `from` (excluding `from`). */
function nextSeat(seats: number[], from: number): number {
  if (seats.length === 0) return from;
  // Sort seats
  const sorted = [...seats].sort((a, b) => a - b);
  for (const s of sorted) {
    if (s > from) return s;
  }
  return sorted[0]; // wrap around
}

/** Next seat from `from` that is in the hand and hasn't folded and isn't all-in. */
function nextActiveSeat(hand: HandState, from: number): number {
  const n = hand.participants.length;
  // Find `from` in participants
  const fromIdx = hand.participants.indexOf(from);
  for (let step = 1; step < n; step++) {
    const idx = (fromIdx + step) % n;
    const seat = hand.participants[idx];
    if (!hand.playerFolded[seat] && !hand.playerAllIn[seat]) {
      return seat;
    }
  }
  return from; // no one else (shouldn't happen in normal flow)
}

/** Next seat from `from` that hasn't folded (may be all-in). */
function nextNonFoldedSeat(hand: HandState, from: number): number {
  const n = hand.participants.length;
  const fromIdx = hand.participants.indexOf(from);
  for (let step = 1; step < n; step++) {
    const idx = (fromIdx + step) % n;
    const seat = hand.participants[idx];
    if (!hand.playerFolded[seat]) {
      return seat;
    }
  }
  return from;
}

/** Count non-folded players. */
function countNonFolded(hand: HandState): number {
  return hand.participants.filter(s => !hand.playerFolded[s]).length;
}

/** Count active (non-folded, non-all-in) players. */
function countActive(hand: HandState): number {
  return hand.participants.filter(s => !hand.playerFolded[s] && !hand.playerAllIn[s]).length;
}

// --- Board texture helpers ---

function boardHighestRank(cards: Card[]): number {
  if (cards.length === 0) return 0;
  return Math.max(...cards.map(c => c.rank));
}

function boardIsPaired(cards: Card[]): boolean {
  const ranks = cards.map(c => c.rank);
  return ranks.some((r, i) => ranks.indexOf(r) !== i);
}

function boardNumSuited(cards: Card[]): number {
  if (cards.length === 0) return 0;
  const counts: Record<string, number> = {};
  for (const c of cards) counts[c.suit] = (counts[c.suit] || 0) + 1;
  return Math.max(...Object.values(counts));
}

function boardNumConnected(cards: Card[]): number {
  let count = 0;
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      if (Math.abs(cards[i].rank - cards[j].rank) <= 2) count++;
    }
  }
  return count;
}

function boardHasFlushDraw(cards: Card[]): boolean {
  return boardNumSuited(cards) >= 2;
}

function boardHasStraightDraw(cards: Card[]): boolean {
  if (cards.length < 2) return false;
  const ranks = cards.map(c => c.rank);
  for (let i = 0; i < ranks.length; i++) {
    for (let j = i + 1; j < ranks.length; j++) {
      if (Math.abs(ranks[i] - ranks[j]) <= 4) return true;
    }
  }
  return false;
}

// Compute opponent cumulative HUD stats relative to a given seat.
function getOpponentStats(room: Room, seat: number) {
  const hand = room.hand!;
  const oppSeat = hand.participants.find(s => s !== seat) ?? seat;
  const st = room.stats[oppSeat];
  if (!st || st.handsPlayed === 0) return { vpip: 0, pfr: 0, af: 0, foldToCbet: 0, sampleSize: 0 };
  const vpip = st.vpipOpportunities > 0 ? st.vpipCount / st.vpipOpportunities : 0;
  const pfr  = st.pfrOpportunities  > 0 ? st.pfrCount  / st.pfrOpportunities  : 0;
  const af   = st.postflopCalls === 0
    ? (st.postflopBetsRaises > 0 ? 99 : 0)
    : st.postflopBetsRaises / st.postflopCalls;
  const foldToCbet = st.foldToCbetOpportunities > 0
    ? st.foldToCbetCount / st.foldToCbetOpportunities
    : 0;
  return { vpip, pfr, af, foldToCbet, sampleSize: st.handsPlayed };
}

/** Advance blinds among funded seats, including the transition into heads-up. */
export function advanceDealer(room: Room): void {
  const seats = activeSeats(room);
  if (seats.length < 2) return;
  if (!room.hand) { room.dealerIndex = seats[0]; return; }
  const nextBB = nextSeat(seats, room.hand.bbIndex);
  const bbPosition = seats.indexOf(nextBB);
  const offset = seats.length === 2 ? 1 : 2;
  room.dealerIndex = seats[(bbPosition - offset + seats.length) % seats.length];
}

// --- Start a new hand ---

export function startHand(room: Room): void {
  const eligible = activeSeats(room);
  const seats = handSeats(eligible, room.dealerIndex);
  if (seats.length < 2) return;
  for (const p of room.players) if (p) p.holeCards = [];

  const deck = new Deck();
  const numPlayers = room.players.length;

  // Find dealer position (must be an active seat)
  // If current dealerIndex isn't active, advance to next active
  if (!seats.includes(room.dealerIndex)) {
    room.dealerIndex = nextSeat(seats, room.dealerIndex);
  }
  const dealerIdx = room.dealerIndex;

  let sbIdx: number;
  let bbIdx: number;
  let firstToAct: number;

  if (seats.length === 2) {
    // Heads-up: dealer is SB, other is BB. Dealer/SB acts first preflop.
    sbIdx = dealerIdx;
    bbIdx = nextSeat(seats, dealerIdx);
    firstToAct = sbIdx; // preflop: SB acts first in heads-up
  } else {
    // Multi-player: SB = next active after dealer, BB = next after SB
    sbIdx = nextSeat(seats, dealerIdx);
    bbIdx = nextSeat(seats, sbIdx);
    // Preflop: action starts after BB (UTG)
    firstToAct = nextSeat(seats, bbIdx);
  }

  const sb = room.settings.bigBlind / 2;
  const bb = room.settings.bigBlind;

  room.actionLog = [];
  room.matchOver = false;
  room.handNumber++;

  // Initialise per-hand stats context
  const n = room.players.length;
  room.handStatsCtx = {
    preflopAggressor: null,
    preflopRaiseCount: 0,
    playerVPIP: new Array(n).fill(false),
    playerPFR: new Array(n).fill(false),
    playerFacedRaisePreflop: new Array(n).fill(false),
    playerThreeBet: new Array(n).fill(false),
    playerRaisedFacedThreeBet: new Array(n).fill(false),
    playerFoldedToThreeBet: new Array(n).fill(false),
    sawFlop: new Array(n).fill(false),
    cbetOpportunity: new Array(n).fill(false),
    cbetMade: new Array(n).fill(false),
    flopCbetOccurred: false,
    foldToCbetOpportunity: new Array(n).fill(false),
    foldedToCbet: new Array(n).fill(false),
    postflopBetsRaises: new Array(n).fill(0),
    postflopCalls: new Array(n).fill(0),
    streetRaiseCount: 0,
    prevBetPctPot: 0,
    pendingDecisions: [],
  };

  // Record starting stacks before blinds (for side pot calculation)
  const startingStacks = room.players.map(p => p ? p.stack : 0);

  // Post blinds
  const sbAmount = Math.min(sb, room.players[sbIdx]!.stack);
  const bbAmount = Math.min(bb, room.players[bbIdx]!.stack);

  room.players[sbIdx]!.stack -= sbAmount;
  room.players[bbIdx]!.stack -= bbAmount;

  // Initialize arrays for ALL seats (indexed by seat number)
  const playerBets = new Array(numPlayers).fill(0);
  const playerActed = new Array(numPlayers).fill(true); // default true (non-participants)
  const playerAllIn = new Array(numPlayers).fill(false);
  const playerFolded = new Array(numPlayers).fill(true); // non-participants are "folded"

  // Set up participants
  for (const s of seats) {
    playerActed[s] = false;
    playerFolded[s] = false;
  }

  playerBets[sbIdx] = sbAmount;
  playerBets[bbIdx] = bbAmount;

  // Deal hole cards to all active seats
  for (const s of seats) {
    room.players[s]!.holeCards = deck.deal(2);
  }

  // Check all-in from blinds
  if (room.players[sbIdx]!.stack === 0) playerAllIn[sbIdx] = true;
  if (room.players[bbIdx]!.stack === 0) playerAllIn[bbIdx] = true;

  // Build participants in clockwise order starting from SB
  const participants: number[] = [];
  let cursor = sbIdx;
  for (let i = 0; i < seats.length; i++) {
    participants.push(cursor);
    cursor = nextSeat(seats, cursor);
  }

  room.hand = {
    deck,
    communityCards: [],
    round: 'preflop',
    pot: sbAmount + bbAmount,
    potResults: [],
    currentBet: bb,
    lastRaiseSize: bb,
    chipUnit: bb % 2 !== 0 || startingStacks.some(s => !Number.isInteger(s)) ? 0.5 : 1,
    playerBets,
    playerActedThisRound: playerActed,
    playerLastActionBet: new Array(numPlayers).fill(null),
    playerAllIn,
    playerFolded,
    currentPlayerIndex: firstToAct,
    dealerIndex: dealerIdx,
    sbIndex: sbIdx,
    bbIndex: bbIdx,
    handOver: false,
    showdown: false,
    winner: null,
    winnerHand: null,
    loserHand: null,
    resultMessage: '',
    participants,
    startingStacks,
  };

  room.actionLog.push(`${room.players[sbIdx]!.name} posts small blind (${sbAmount})`);
  room.actionLog.push(`${room.players[bbIdx]!.name} posts big blind (${bbAmount})`);

  if (!finishIfNoBettingPossible(room) && room.hand.playerAllIn[firstToAct]) advanceToNextPlayer(room);
}

// --- Betting state bridge ---

function getBettingState(room: Room): BettingState {
  const h = room.hand!;
  return {
    pot: h.pot,
    currentBet: h.currentBet,
    lastRaiseSize: h.lastRaiseSize,
    playerBets: room.players.map((_, i) => h.playerBets[i] ?? 0),
    playerStacks: room.players.map(p => p ? p.stack : 0),
    playerActedThisRound: room.players.map((_, i) => h.playerActedThisRound[i] ?? true),
    playerLastActionBet: room.players.map((_, i) => h.playerLastActionBet[i] ?? null),
    playerAllIn: room.players.map((_, i) => h.playerAllIn[i] ?? false),
    playerFolded: room.players.map((_, i) => h.playerFolded[i] ?? true),
    bigBlind: room.settings.bigBlind,
    round: h.round as any,
    numPlayers: room.players.length,
  };
}

// --- Process action ---

export function handleAction(room: Room, playerIndex: number, action: PlayerAction): { valid: boolean; error?: string } {
  const hand = room.hand;
  if (room.paused) return { valid: false, error: 'Game is paused' };
  if (!hand || hand.handOver) return { valid: false, error: 'No active hand' };
  if (hand.currentPlayerIndex !== playerIndex) return { valid: false, error: 'Not your turn' };
  if (hand.playerAllIn[playerIndex]) return { valid: false, error: 'You are all-in' };
  if (hand.playerFolded[playerIndex]) return { valid: false, error: 'You have folded' };

  const bettingState = getBettingState(room);
  const result = processAction(bettingState, playerIndex, action);
  if (!result.valid) return { valid: false, error: result.error };

  // Capture classifier decision features BEFORE action is processed
  const captureCtx = room.handStatsCtx;
  if (captureCtx && room.avatarMode) {
    const role = room.avatarAssignment[playerIndex];
    if (role === 'G' || role === 'L') {
      const community = hand.communityCards;
      const pot = bettingState.pot;
      const bb = room.settings.bigBlind;
      const oppSeat = hand.participants.find(s => s !== playerIndex) ?? playerIndex;
      const effectiveStack = Math.min(
        bettingState.playerStacks[playerIndex],
        bettingState.playerStacks[oppSeat],
      );
      const spr = pot > 0 ? effectiveStack / pot : 99;
      const inPosition = hand.round === 'preflop'
        ? playerIndex === hand.bbIndex
        : playerIndex === hand.dealerIndex;
      const opp = getOpponentStats(room, playerIndex);

      captureCtx.pendingDecisions.push({
        handNumber: room.handNumber,
        street: hand.round,
        playerRole: role,
        playerSeat: playerIndex,
        action: action.type,
        amount: action.amount ?? 0,
        inPosition,
        effectiveStackBB: effectiveStack / bb,
        spr,
        wasPreflopAggressor: captureCtx.preflopAggressor === playerIndex,
        facingBet: bettingState.currentBet > 0,
        betSizePctPot: pot > 0 ? bettingState.currentBet / pot : 0,
        previousBetPctPot: captureCtx.prevBetPctPot,
        numRaisesThisStreet: captureCtx.streetRaiseCount,
        potSizeBB: pot / bb,
        highestCardRank: boardHighestRank(community),
        isPairedBoard: boardIsPaired(community),
        numSuitedCardsOnBoard: boardNumSuited(community),
        numConnectedCardsOnBoard: boardNumConnected(community),
        hasFlushDraw: boardHasFlushDraw(community),
        hasStraightDraw: boardHasStraightDraw(community),
        opponentVPIP: opp.vpip,
        opponentPFR: opp.pfr,
        opponentAF: opp.af,
        opponentFoldToCBet: opp.foldToCbet,
        opponentSampleSize: opp.sampleSize,
      });

      // Update raise counters so next player's capture sees them
      if (action.type === 'raise') {
        captureCtx.prevBetPctPot = pot > 0 ? bettingState.currentBet / pot : 0;
        captureCtx.streetRaiseCount++;
      }
    }
  }

  const ns = result.newState!;

  // Apply new state back
  hand.pot = ns.pot;
  if (ns.playerBets.some(bet => !Number.isInteger(bet))) hand.chipUnit = 0.5;
  hand.currentBet = ns.currentBet;
  hand.lastRaiseSize = ns.lastRaiseSize;
  hand.playerBets = ns.playerBets;
  hand.playerActedThisRound = ns.playerActedThisRound;
  hand.playerLastActionBet = ns.playerLastActionBet!;
  hand.playerAllIn = ns.playerAllIn;
  hand.playerFolded = ns.playerFolded;
  for (let i = 0; i < room.players.length; i++) {
    if (room.players[i]) {
      room.players[i]!.stack = ns.playerStacks[i];
    }
  }

  // Log the action
  const pName = room.players[playerIndex]!.name;
  switch (action.type) {
    case 'fold':
      room.actionLog.push(`${pName} folds`);
      break;
    case 'check':
      room.actionLog.push(`${pName} checks`);
      break;
    case 'call': {
      const callAmt = Math.min(
        bettingState.currentBet - bettingState.playerBets[playerIndex],
        bettingState.playerStacks[playerIndex]
      );
      if (ns.playerAllIn[playerIndex]) {
        room.actionLog.push(`${pName} calls all-in (${callAmt})`);
      } else {
        room.actionLog.push(`${pName} calls (${callAmt})`);
      }
      break;
    }
    case 'raise':
      if (ns.playerAllIn[playerIndex]) {
        room.actionLog.push(`${pName} raises all-in to ${action.amount}`);
      } else {
        room.actionLog.push(`${pName} raises to ${action.amount}`);
      }
      break;
  }

  // --- Per-action stats instrumentation ---
  const ctx = room.handStatsCtx;
  if (ctx) {
    if (hand.round === 'preflop') {
      if (action.type === 'call' || action.type === 'raise') {
        ctx.playerVPIP[playerIndex] = true;
      }
      if (action.type === 'raise') {
        ctx.playerPFR[playerIndex] = true;
        if (ctx.preflopAggressor !== null && ctx.preflopAggressor !== playerIndex) {
          // Re-raise: this is a 3-bet (or higher)
          ctx.playerFacedRaisePreflop[playerIndex] = true;
          ctx.playerThreeBet[playerIndex] = true;
          ctx.playerRaisedFacedThreeBet[ctx.preflopAggressor] = true;
        }
        ctx.preflopAggressor = playerIndex;
        ctx.preflopRaiseCount++;
      }
      if (action.type === 'call' && ctx.preflopAggressor !== null && ctx.preflopAggressor !== playerIndex) {
        ctx.playerFacedRaisePreflop[playerIndex] = true;
      }
      if (action.type === 'fold') {
        if (ctx.preflopAggressor !== null && ctx.preflopAggressor !== playerIndex) {
          ctx.playerFacedRaisePreflop[playerIndex] = true;
        }
        if (ctx.playerRaisedFacedThreeBet[playerIndex]) {
          ctx.playerFoldedToThreeBet[playerIndex] = true;
        }
      }
    } else if (hand.round !== 'showdown') {
      // Post-flop (flop/turn/river)
      if (action.type === 'raise') {
        ctx.postflopBetsRaises[playerIndex]++;
        // C-bet: preflopAggressor bets first on flop (currentBet was 0 before this action)
        if (hand.round === 'flop' && !ctx.flopCbetOccurred
            && ctx.preflopAggressor === playerIndex
            && bettingState.currentBet === 0) {
          ctx.cbetMade[playerIndex] = true;
          ctx.flopCbetOccurred = true;
          for (const s of hand.participants) {
            if (s !== playerIndex && !hand.playerFolded[s]) {
              ctx.foldToCbetOpportunity[s] = true;
            }
          }
        }
      }
      if (action.type === 'call') {
        ctx.postflopCalls[playerIndex]++;
      }
      if (action.type === 'fold' && ctx.foldToCbetOpportunity[playerIndex]) {
        ctx.foldedToCbet[playerIndex] = true;
      }
    }
  }

  if (result.handOver) {
    refundUncalledBet(room);
    // Everyone else folded — last player standing wins
    const winnerIdx = hand.participants.find(s => !hand.playerFolded[s])!;
    hand.handOver = true;
    hand.winner = winnerIdx;
    hand.potResults = [potInfo(room, { amount: hand.pot, eligible: [winnerIdx] })];
    hand.potResults[0].awards = [{ seat: winnerIdx, name: getDisplayName(room, winnerIdx), amount: hand.pot }];
    hand.resultMessage = `${room.players[winnerIdx]!.name} wins the pot (${hand.pot})`;
    room.players[winnerIdx]!.stack += hand.pot;
    hand.pot = 0;
    room.actionLog.push(hand.resultMessage);
    room.lastFoldedHand = {
      actionLog: [...room.actionLog],
      playerHoleCards: hand.participants.map(s => ({
        seat: s,
        holeCards: [...(room.players[s]?.holeCards ?? [])],
      })),
    };
    commitHandStats(room, false, []);
    return { valid: true };
  }

  if (finishIfNoBettingPossible(room)) return { valid: true };

  if (result.roundOver) {
    advanceRound(room);
  } else {
    advanceToNextPlayer(room);
  }

  return { valid: true };
}

/** Return the unmatched part of the highest wager before closing a street. */
function refundUncalledBet(room: Room): void {
  const hand = room.hand!;
  const bets = hand.participants.map(seat => ({ seat, amount: hand.playerBets[seat] ?? 0 })).sort((a, b) => b.amount - a.amount);
  const refund = bets[0].amount - (bets[1]?.amount ?? 0);
  if (refund <= 0) return;
  const seat = bets[0].seat;
  room.players[seat]!.stack += refund;
  hand.playerBets[seat] -= refund;
  hand.pot -= refund;
  hand.playerAllIn[seat] = room.players[seat]!.stack === 0;
  hand.currentBet = Math.max(...hand.playerBets);
  room.actionLog.push(`${room.players[seat]!.name} receives ${refund} uncalled chips back`);
}

/** Once all opponents are all-in, only an outstanding call/fold can remain. */
function finishIfNoBettingPossible(room: Room): boolean {
  const hand = room.hand!;
  const active = hand.participants.filter(s => !hand.playerFolded[s] && !hand.playerAllIn[s]);
  if (active.length > 1 || countNonFolded(hand) < 2) return false;
  if (active.length === 1) {
    hand.currentBet = Math.max(...hand.playerBets);
    if (hand.playerBets[active[0]] < hand.currentBet) { hand.currentPlayerIndex = active[0]; return false; }
  }
  runOutBoard(room); return true;
}

/** Find the next player who can act and set them as current. */
function advanceToNextPlayer(room: Room): void {
  const hand = room.hand!;
  const active = countActive(hand);

  if (active === 0) {
    // Everyone is all-in or folded — run out the board
    if (countNonFolded(hand) >= 2) {
      runOutBoard(room);
    }
    return;
  }

  const next = nextActiveSeat(hand, hand.currentPlayerIndex);
  hand.currentPlayerIndex = next;
}

// --- Round advancement ---

function advanceRound(room: Room): void {
  refundUncalledBet(room);
  const hand = room.hand!;
  const nonFolded = countNonFolded(hand);

  if (nonFolded <= 1) {
    // Shouldn't get here normally, but handle gracefully
    const winner = hand.participants.find(s => !hand.playerFolded[s])!;
    hand.handOver = true;
    hand.winner = winner;
    hand.potResults = [potInfo(room, { amount: hand.pot, eligible: [winner] })];
    hand.potResults[0].awards = [{ seat: winner, name: getDisplayName(room, winner), amount: hand.pot }];
    hand.resultMessage = `${room.players[winner]!.name} wins the pot (${hand.pot})`;
    room.players[winner]!.stack += hand.pot;
    hand.pot = 0;
    return;
  }

  const nextRounds: Record<string, Round> = {
    preflop: 'flop',
    flop: 'turn',
    turn: 'river',
    river: 'showdown',
  };

  const nextRound = nextRounds[hand.round];
  if (!nextRound) return;

  if (nextRound === 'showdown') {
    doShowdown(room);
    return;
  }

  hand.round = nextRound;

  // Reset per-street classifier counters
  if (room.handStatsCtx) {
    room.handStatsCtx.streetRaiseCount = 0;
    room.handStatsCtx.prevBetPctPot = 0;
  }

  // Stats: mark sawFlop and c-bet opportunity
  if (nextRound === 'flop' && room.handStatsCtx) {
    const sctx = room.handStatsCtx;
    for (const s of hand.participants) {
      if (!hand.playerFolded[s]) sctx.sawFlop[s] = true;
    }
    if (sctx.preflopAggressor !== null && !hand.playerFolded[sctx.preflopAggressor]) {
      sctx.cbetOpportunity[sctx.preflopAggressor] = true;
    }
  }

  // Deal community cards
  if (nextRound === 'flop') {
    hand.communityCards.push(...hand.deck.deal(3));
    room.actionLog.push(`--- Flop: ${hand.communityCards.map(cardToString).join(' ')} ---`);
  } else if (nextRound === 'turn') {
    hand.communityCards.push(...hand.deck.deal(1));
    room.actionLog.push(`--- Turn: ${hand.communityCards.map(cardToString).join(' ')} ---`);
  } else if (nextRound === 'river') {
    hand.communityCards.push(...hand.deck.deal(1));
    room.actionLog.push(`--- River: ${hand.communityCards.map(cardToString).join(' ')} ---`);
  }

  // Reset per-round betting
  hand.currentBet = 0;
  hand.lastRaiseSize = 0;
  hand.playerBets = new Array(room.players.length).fill(0);
  hand.playerLastActionBet = new Array(room.players.length).fill(null);
  hand.playerActedThisRound = room.players.map((_, i) => {
    return hand.playerAllIn[i] || hand.playerFolded[i];
  });

  // Postflop action starts with the first player after the dealer, in every mode.
  // With two players the dealer is the small blind, so this is the big blind.
  const startFrom = nextSeat(hand.participants, hand.dealerIndex);

  // Find first active player starting from startFrom
  let firstActor = startFrom;
  const n = hand.participants.length;
  const startIdx = hand.participants.indexOf(startFrom);
  let foundActive = false;
  for (let step = 0; step < n; step++) {
    const idx = (startIdx + step) % n;
    const seat = hand.participants[idx];
    if (!hand.playerFolded[seat] && !hand.playerAllIn[seat]) {
      firstActor = seat;
      foundActive = true;
      break;
    }
  }

  hand.currentPlayerIndex = firstActor;

  // If no active players remain (all are all-in or folded), run out the board
  if (!foundActive && countNonFolded(hand) >= 2) {
    runOutBoard(room);
  }
}

/** Deal remaining community cards and go to showdown (when no more betting possible). */
function runOutBoard(room: Room): void {
  refundUncalledBet(room);
  const hand = room.hand!;

  while (hand.communityCards.length < 5) {
    const needed = hand.communityCards.length === 0 ? 3 : 1;
    hand.communityCards.push(...hand.deck.deal(needed));

    if (needed === 3) {
      room.actionLog.push(`--- Flop: ${hand.communityCards.slice(0, 3).map(cardToString).join(' ')} ---`);
    } else if (hand.communityCards.length === 4) {
      room.actionLog.push(`--- Turn: ${hand.communityCards.map(cardToString).join(' ')} ---`);
    } else {
      room.actionLog.push(`--- River: ${hand.communityCards.map(cardToString).join(' ')} ---`);
    }
  }

  hand.round = 'showdown';
  doShowdown(room);
}

// --- Side pot calculation ---

interface SidePot {
  amount: number;
  eligible: number[]; // seat indices eligible to win this pot
}

/** All-in caps create real pots; an unmatched top wager is pending/refundable. */
function calculateSidePots(room: Room): { pots: SidePot[]; uncalled: number } {
  const hand = room.hand!;
  const invested = hand.participants.map(seat => ({ seat, amount: hand.startingStacks[seat] - room.players[seat]!.stack }));
  const ordered = [...invested].sort((a, b) => b.amount - a.amount);
  const uncalled = Math.max(0, ordered[0].amount - (ordered[1]?.amount ?? 0));
  const matched = invested.map(player => ({ ...player, amount: player.amount - (player.seat === ordered[0].seat ? uncalled : 0) }));
  const maximum = Math.max(...matched.map(player => player.amount));
  const caps = [...new Set([...matched.filter(player => hand.playerAllIn[player.seat] && !hand.playerFolded[player.seat]).map(player => player.amount), maximum])].filter(amount => amount > 0).sort((a, b) => a - b);
  const pots: SidePot[] = [];
  let previous = 0;
  for (const cap of caps) {
    const amount = matched.reduce((sum, player) => sum + Math.max(0, Math.min(player.amount, cap) - previous), 0);
    const eligible = matched.filter(player => !hand.playerFolded[player.seat] && player.amount >= cap).map(player => player.seat);
    if (amount > 0 && eligible.length) pots.push({ amount, eligible });
    else if (amount > 0 && pots.length) pots[pots.length - 1].amount += amount;
    previous = cap;
  }
  return { pots, uncalled };
}

function potInfo(room: Room, pot: SidePot): PotInfo {
  return { amount: pot.amount, eligiblePlayers: pot.eligible.map(seat => ({ seat, name: getDisplayName(room, seat) })), awards: [] };
}

/** Commit per-hand stat context into cumulative counters and log to CSV. */
function commitHandStats(
  room: Room,
  isShowdown: boolean,
  showdownWinners: number[],
  handDescriptions?: Record<number, string>,
): void {
  const ctx = room.handStatsCtx;
  if (!ctx) return;
  const hand = room.hand!;

  for (const s of hand.participants) {
    // Ensure stats slot exists
    while (room.stats.length <= s) room.stats.push(emptyStats());
    const st = room.stats[s];

    st.handsPlayed++;
    st.vpipOpportunities++;
    if (ctx.playerVPIP[s]) st.vpipCount++;
    st.pfrOpportunities++;
    if (ctx.playerPFR[s]) st.pfrCount++;

    if (ctx.playerFacedRaisePreflop[s]) {
      st.threeBetOpportunities++;
      if (ctx.playerThreeBet[s]) st.threeBetCount++;
    }
    if (ctx.playerRaisedFacedThreeBet[s]) {
      st.foldToThreeBetOpportunities++;
      if (ctx.playerFoldedToThreeBet[s]) st.foldToThreeBetCount++;
    }
    if (ctx.cbetOpportunity[s]) {
      st.cbetOpportunities++;
      if (ctx.cbetMade[s]) st.cbetCount++;
    }
    if (ctx.foldToCbetOpportunity[s]) {
      st.foldToCbetOpportunities++;
      if (ctx.foldedToCbet[s]) st.foldToCbetCount++;
    }

    st.postflopBetsRaises += ctx.postflopBetsRaises[s] || 0;
    st.postflopCalls += ctx.postflopCalls[s] || 0;

    if (ctx.sawFlop[s]) {
      st.wtsdOpportunities++;
      if (isShowdown && !hand.playerFolded[s]) st.wtsdCount++;
    }
  }

  // W$SD: winners at showdown
  if (isShowdown) {
    for (const w of showdownWinners) {
      if (room.stats[w]) room.stats[w].wsdCount++;
    }
  }

  // Classifier decision logging (avatar mode only)
  if (room.avatarMode && ctx.pendingDecisions.length > 0) {
    // Gabe: always log. Liana: only at showdown.
    const decisionsToLog = ctx.pendingDecisions.filter(
      d => d.playerRole === 'G' || (d.playerRole === 'L' && isShowdown),
    );

    const winnerSeats = isShowdown ? showdownWinners : (hand.winner !== null ? [hand.winner] : []);
    const holeCardsByRole: Record<string, Card[]> = {};
    const handRankByRole: Record<string, string> = {};
    const wonByRole: Record<string, boolean> = {};
    for (const s of hand.participants) {
      const role = room.avatarAssignment[s];
      if (role) {
        holeCardsByRole[role] = room.players[s]?.holeCards ?? [];
        handRankByRole[role] = handDescriptions?.[s] ?? '';
        wonByRole[role] = winnerSeats.includes(s);
      }
    }
    flushDecisions(decisionsToLog, holeCardsByRole, handRankByRole, wonByRole);
  }

  // CSV logging (avatar mode only)
  if (room.avatarMode) {
    const logData: StatsLogData = {
      handNumber: room.handNumber,
      players: [0, 1].map(i => {
        const p = room.players[i];
        if (!p) return null;
        return {
          name: p.name,
          role: room.avatarAssignment[i] ?? '',
          startStack: hand.startingStacks[i] ?? 0,
          endStack: p.stack,
        };
      }),
      winnerName: hand.winner !== null
        ? (() => {
            const role = room.avatarAssignment[hand.winner];
            return role === 'G' ? 'Gabe' : role === 'L' ? 'Liana' : (room.players[hand.winner]?.name ?? 'split');
          })()
        : 'split',
      resultMessage: hand.resultMessage,
      stats: [0, 1].map(i => room.stats[i] ?? null),
    };
    appendHandRow(logData);
  }

  room.handStatsCtx = null;
}

/** Evaluate hands and award pot. */
function doShowdown(room: Room): void {
  const hand = room.hand!;
  hand.round = 'showdown';
  hand.showdown = true;
  hand.handOver = true;

  const nonFolded = hand.participants.filter(s => !hand.playerFolded[s]);

  // Evaluate all hands
  const results: { seat: number; result: HandResult }[] = nonFolded.map(s => ({
    seat: s,
    result: evaluateHand([...room.players[s]!.holeCards, ...hand.communityCards]),
  }));

  // Sort by hand strength (best first)
  results.sort((a, b) => compareHands(b.result, a.result));

  const { pots } = calculateSidePots(room);
  hand.potResults = pots.map(pot => potInfo(room, pot));

  const payouts = new Map<number, number>();
  const chipUnit = hand.chipUnit;
  const clockwise = (seat: number) => (seat - hand.dealerIndex + room.players.length) % room.players.length || room.players.length;
  for (const [potIndex, pot] of pots.entries()) {
    // Find best hand among eligible players
    const eligible = results.filter(r => pot.eligible.includes(r.seat));
    if (eligible.length === 0) continue;

    const bestHand = eligible[0].result;
    // Find all players tied for best
    const winners = eligible.filter(r => compareHands(r.result, bestHand) === 0);

    winners.sort((a, b) => clockwise(a.seat) - clockwise(b.seat));
    const units = Math.round(pot.amount / chipUnit);
    const share = Math.floor(units / winners.length);
    const remainder = units % winners.length;
    winners.forEach((winner, i) => {
      const amount = (share + (i < remainder ? 1 : 0)) * chipUnit;
      room.players[winner.seat]!.stack += amount;
      payouts.set(winner.seat, (payouts.get(winner.seat) ?? 0) + amount);
      hand.potResults[potIndex].awards.push({ seat: winner.seat, name: getDisplayName(room, winner.seat), amount });
    });
  }

  hand.pot = 0;

  // Set result info
  const bestResult = results[0];
  hand.winnerHand = bestResult.result;
  hand.loserHand = results.length > 1 ? results[results.length - 1].result : null;

  const winners = [...payouts.keys()];
  hand.winner = winners.length === 1 ? winners[0] : null;
  if (pots.length === 1 && winners.length === 1) {
    hand.resultMessage = `${room.players[winners[0]]!.name} wins ${payouts.get(winners[0])} with ${bestResult.result.description}`;
  } else {
    hand.resultMessage = `${winners.length > 1 ? 'Pot results' : 'Winner'}: ${[...payouts].map(([seat, amount]) => `${room.players[seat]!.name} wins ${amount}`).join('; ')}`;
  }
  room.actionLog.push(hand.resultMessage);
  const showdownWinners = winners;

  // Build per-seat hand description for classifier
  const handDescriptions: Record<number, string> = {};
  for (const r of results) handDescriptions[r.seat] = r.result.description;

  commitHandStats(room, true, showdownWinners, handDescriptions);

  // Save showdown data for "last showdown" preview
  room.lastShowdown = {
    playerHands: nonFolded.map(s => ({
      seat: s,
      name: room.players[s]!.name,
      holeCards: [...room.players[s]!.holeCards],
    })),
    communityCards: [...hand.communityCards],
    resultMessage: hand.resultMessage,
  };
}

/** Get the legal actions for the current player. */
export function getCurrentLegalActions(room: Room) {
  if (!room.hand || room.hand.handOver) return null;
  const bettingState = getBettingState(room);
  return getLegalActions(bettingState, room.hand.currentPlayerIndex);
}

/** Build the game state visible to a specific player (hides opponent's cards). */
export function getClientState(room: Room, playerIndex: number) {
  const isShowdown = room.hand?.showdown ?? false;
  const breakdown = room.hand && !room.hand.handOver ? calculateSidePots(room) : null;

  return {
    players: room.players.map((p, i) => {
      if (!p) return null;
      return {
        name: getDisplayName(room, i),
        customName: p.customName,
        inHand: room.mode === 'virtualcards' ? !!room.vc?.playerCards[i] : !!room.hand?.participants.includes(i),
        ready: p.ready,
        sittingOut: !!p.sittingOut,
        sitOutNextHand: !!p.sitOutNextHand,
        connected: p.connected,
        stack: p.stack,
        holeCards: (i === playerIndex || (isShowdown && room.hand!.participants.includes(i) && !room.hand!.playerFolded[i])) ? p.holeCards : null,
        isDealer: room.hand ? room.hand.dealerIndex === i : (room.dealerIndex === i),
        isSB: room.hand ? room.hand.sbIndex === i : false,
        isBB: room.hand ? room.hand.bbIndex === i : false,
        folded: room.hand ? room.hand.playerFolded[i] : false,
      };
    }),
    settings: room.settings,
    gameStarted: room.gameStarted,
    matchOver: room.matchOver,
    mode: room.mode,
    hand: room.hand ? {
      communityCards: room.hand.communityCards,
      round: room.hand.round,
      pot: room.hand.pot,
      pots: breakdown ? breakdown.pots.map(pot => potInfo(room, pot)) : room.hand.potResults,
      uncalled: breakdown?.uncalled ?? 0,
      currentBet: room.hand.currentBet,
      currentPlayerIndex: room.hand.currentPlayerIndex,
      playerBets: room.hand.playerBets,
      playerAllIn: room.hand.playerAllIn,
      playerFolded: room.hand.playerFolded,
      handOver: room.hand.handOver,
      showdown: room.hand.showdown,
      winner: room.hand.winner,
      resultMessage: room.hand.resultMessage ? mapNamesInText(room, room.hand.resultMessage) : '',
    } : null,
    legalActions: room.hand && !room.hand.handOver && room.hand.currentPlayerIndex === playerIndex
      ? getCurrentLegalActions(room)
      : null,
    actionLog: room.actionLog.map(entry => mapNamesInText(room, entry)),
    myIndex: playerIndex,
    avatarMode: room.avatarMode,
    avatarAssignment: room.avatarAssignment,
    handNumber: room.handNumber,
    lastShowdown: room.lastShowdown ? {
      ...room.lastShowdown,
      playerHands: room.lastShowdown.playerHands.map(ph => ({
        ...ph,
        name: getDisplayName(room, ph.seat),
      })),
      resultMessage: mapNamesInText(room, room.lastShowdown.resultMessage),
    } : null,
    lastFoldedHand: room.lastFoldedHand ? {
      actionLog: room.lastFoldedHand.actionLog.map(entry => mapNamesInText(room, entry)),
      myHoleCards: room.lastFoldedHand.playerHoleCards.find(p => p.seat === playerIndex)?.holeCards ?? [],
    } : null,
    stats: room.stats,
    isPending: false,
    isBlockedJoiner: false,
    paused: room.paused,
    vcState: room.mode === 'virtualcards' && room.vc ? {
      phase: room.vc.phase,
      myCards: room.vc.playerCards[playerIndex] ?? [],
      communityCards: room.vc.communityCards,
      sbSeat: room.vc.sbSeat,
      bbSeat: room.vc.bbSeat,
    } : null,
  };
}

/** State for clients blocked because the room is full. */
export function getBlockedJoinerState(room: Room) {
  return {
    isBlockedJoiner: true,
    isPending: false,
    mode: room.mode,
    players: room.players.map((p, i) => p
      ? { name: getDisplayName(room, i), ready: p.ready,
        sittingOut: !!p.sittingOut,
        sitOutNextHand: !!p.sitOutNextHand, connected: p.connected,
          stack: p.stack, holeCards: null, isDealer: false, isSB: false, isBB: false, folded: false }
      : null),
    settings: room.settings,
    gameStarted: room.gameStarted,
    matchOver: room.matchOver,
    hand: null,
    legalActions: null,
    actionLog: [],
    myIndex: -1,
    avatarMode: room.avatarMode,
    avatarAssignment: room.avatarAssignment,
    handNumber: room.handNumber,
    lastShowdown: null,
    lastFoldedHand: null,
    stats: [],
    paused: room.paused,
    vcState: null,
  };
}

/** Minimal state sent to players who have connected but not yet joined (VC mode). */
export function getVCViewerState(room: Room) {
  return {
    isPending: true,
    mode: room.mode,
    players: room.players.map((p, i) => p
      ? { name: getDisplayName(room, i), ready: p.ready,
        sittingOut: !!p.sittingOut,
        sitOutNextHand: !!p.sitOutNextHand, connected: p.connected,
          stack: 0, holeCards: null, isDealer: false, isSB: false, isBB: false, folded: false }
      : null),
    settings: room.settings,
    gameStarted: false,
    matchOver: false,
    hand: null,
    legalActions: null,
    actionLog: [],
    myIndex: -1,
    avatarMode: room.avatarMode,
    avatarAssignment: room.avatarAssignment,
    handNumber: room.handNumber,
    lastShowdown: null,
    lastFoldedHand: null,
    stats: [],
    isBlockedJoiner: false,
    paused: false,
    vcState: null,
  };
}

/** Check if the match is over. In heads-up: one player has 0 chips. In unlimited: never auto-ends. */
export function checkMatchOver(room: Room): boolean {
  if (room.mode === 'headsup') {
    if (room.players[0] && room.players[1]) {
      if (room.players[0].stack <= 0 || room.players[1].stack <= 0) {
        room.matchOver = true;
        return true;
      }
    }
  }
  // Unlimited mode: match doesn't auto-end. Players rebuy or leave.
  return false;
}

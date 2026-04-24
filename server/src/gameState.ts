/**
 * Game state module — manages the authoritative state of a poker match.
 *
 * Supports two modes:
 *  - 'headsup': Classic 2-player. Dealer/SB acts first preflop, BB acts first postflop.
 *  - 'unlimited': Any number of players. Standard positions with dealer button.
 *
 * Standard multi-player betting order:
 *  - Preflop: action starts on player after BB (UTG), ends on BB.
 *  - Postflop: action starts on SB (or first active player left of dealer).
 *
 * After each hand, dealer button moves clockwise (next active seat).
 */

import { Deck, Card, cardToString } from './deck';
import { BettingState, getLegalActions, processAction, newStreetBetting, PlayerAction } from './betting';
import { evaluateHand, compareHands, HandResult } from './handEvaluator';
import { appendHandRow, StatsLogData } from './statsLogger';
import { PendingDecision, flushDecisions } from './classifierLogger';

export type Round = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
export type GameMode = 'headsup' | 'unlimited';

export interface PlayerState {
  id: string;
  name: string;
  ready: boolean;
  connected: boolean;
  stack: number;
  holeCards: Card[];
  seatIndex: number;
}

export interface HandState {
  deck: Deck;
  communityCards: Card[];
  round: Round;
  pot: number;
  currentBet: number;
  lastRaiseSize: number;
  playerBets: number[];
  playerActedThisRound: boolean[];
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
  };
}

// --- Seat navigation helpers ---

/** Get indices of all occupied seats. */
function occupiedSeats(room: Room): number[] {
  return room.players.map((p, i) => p ? i : -1).filter(i => i >= 0);
}

/** Get indices of all players with chips > 0 (eligible to play a hand). */
function activeSeats(room: Room): number[] {
  return room.players.map((p, i) => (p && p.stack > 0) ? i : -1).filter(i => i >= 0);
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

// --- Start a new hand ---

export function startHand(room: Room): void {
  const seats = activeSeats(room);
  if (seats.length < 2) return;

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

  if (room.mode === 'headsup') {
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
    currentBet: bbAmount,
    lastRaiseSize: bbAmount,
    playerBets,
    playerActedThisRound: playerActed,
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

  // If all active players are all-in from blinds, run out
  if (countActive(room.hand) === 0 && countNonFolded(room.hand) >= 2) {
    runOutBoard(room);
  }
  // If first to act is all-in, advance to next
  else if (room.hand.playerAllIn[firstToAct]) {
    advanceToNextPlayer(room);
  }
}

// --- Betting state bridge ---

function getBettingState(room: Room): BettingState {
  const h = room.hand!;
  return {
    pot: h.pot,
    currentBet: h.currentBet,
    lastRaiseSize: h.lastRaiseSize,
    playerBets: [...h.playerBets],
    playerStacks: room.players.map(p => p ? p.stack : 0),
    playerActedThisRound: [...h.playerActedThisRound],
    playerAllIn: [...h.playerAllIn],
    playerFolded: [...h.playerFolded],
    bigBlind: room.settings.bigBlind,
    round: h.round as any,
    numPlayers: room.players.length,
  };
}

// --- Process action ---

export function handleAction(room: Room, playerIndex: number, action: PlayerAction): { valid: boolean; error?: string } {
  const hand = room.hand;
  if (!hand || hand.handOver) return { valid: false, error: 'No active hand' };
  if (hand.currentPlayerIndex !== playerIndex) return { valid: false, error: 'Not your turn' };
  if (hand.playerAllIn[playerIndex]) return { valid: false, error: 'You are all-in' };
  if (hand.playerFolded[playerIndex]) return { valid: false, error: 'You have folded' };

  const bettingState = getBettingState(room);

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

  const result = processAction(bettingState, playerIndex, action);

  if (!result.valid) return { valid: false, error: result.error };

  const ns = result.newState!;

  // Apply new state back
  hand.pot = ns.pot;
  hand.currentBet = ns.currentBet;
  hand.lastRaiseSize = ns.lastRaiseSize;
  hand.playerBets = ns.playerBets;
  hand.playerActedThisRound = ns.playerActedThisRound;
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
    // Everyone else folded — last player standing wins
    const winnerIdx = hand.participants.find(s => !hand.playerFolded[s])!;
    hand.handOver = true;
    hand.winner = winnerIdx;
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

  if (result.roundOver) {
    advanceRound(room);
  } else {
    advanceToNextPlayer(room);
  }

  return { valid: true };
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
  const hand = room.hand!;
  const nonFolded = countNonFolded(hand);

  if (nonFolded <= 1) {
    // Shouldn't get here normally, but handle gracefully
    const winner = hand.participants.find(s => !hand.playerFolded[s])!;
    hand.handOver = true;
    hand.winner = winner;
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
  hand.playerActedThisRound = room.players.map((_, i) => {
    return hand.playerAllIn[i] || hand.playerFolded[i];
  });

  // Postflop: find first active (non-folded, non-all-in) player
  // In heads-up: start from BB (non-dealer). In multi: start from SB.
  let startFrom: number;
  if (room.mode === 'headsup') {
    startFrom = hand.participants.find(s => s !== hand.dealerIndex)!;
  } else {
    startFrom = hand.sbIndex;
  }

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

function calculateSidePots(room: Room): SidePot[] {
  const hand = room.hand!;

  // Total invested by each participant = startingStack - currentStack
  // This includes folded players (their chips are in the pot too)
  const invested: { seat: number; amount: number }[] = hand.participants.map(s => ({
    seat: s,
    amount: hand.startingStacks[s] - room.players[s]!.stack,
  }));

  // Get unique investment levels sorted ascending (these are the "layers")
  const levels = [...new Set(invested.map(i => i.amount))].sort((a, b) => a - b);

  const pots: SidePot[] = [];
  let processedLevel = 0;

  for (const level of levels) {
    const layerSize = level - processedLevel;
    if (layerSize <= 0) continue;

    // Every player who invested >= this level contributes to this pot layer
    const contributors = invested.filter(i => i.amount >= level);
    const potAmount = layerSize * contributors.length;

    // Only non-folded players who invested >= this level are eligible to win
    const eligible = contributors
      .filter(i => !hand.playerFolded[i.seat])
      .map(i => i.seat);

    if (potAmount > 0 && eligible.length > 0) {
      pots.push({ amount: potAmount, eligible });
    } else if (potAmount > 0 && eligible.length === 0) {
      // All contributors at this level folded — add to next pot or give to remaining
      // This shouldn't normally happen, but handle it: add to the last pot
      if (pots.length > 0) {
        pots[pots.length - 1].amount += potAmount;
      }
    }

    processedLevel = level;
  }

  return pots;
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

  const pots = calculateSidePots(room);

  for (const pot of pots) {
    // Find best hand among eligible players
    const eligible = results.filter(r => pot.eligible.includes(r.seat));
    if (eligible.length === 0) continue;

    const bestHand = eligible[0].result;
    // Find all players tied for best
    const winners = eligible.filter(r => compareHands(r.result, bestHand) === 0);

    const share = Math.floor(pot.amount / winners.length);
    const remainder = pot.amount - share * winners.length;

    for (let i = 0; i < winners.length; i++) {
      const amt = share + (i === 0 ? remainder : 0); // odd chip to first winner
      room.players[winners[i].seat]!.stack += amt;
    }
  }

  hand.pot = 0;

  // Set result info
  const bestResult = results[0];
  hand.winnerHand = bestResult.result;
  hand.loserHand = results.length > 1 ? results[results.length - 1].result : null;

  if (results.length >= 2 && compareHands(results[0].result, results[1].result) === 0) {
    // Tie
    const tiedPlayers = results.filter(r => compareHands(r.result, results[0].result) === 0);
    hand.winner = null;
    const names = tiedPlayers.map(r => room.players[r.seat]!.name).join(' & ');
    hand.resultMessage = `Split pot — ${names} tie with ${bestResult.result.description}`;
  } else {
    hand.winner = bestResult.seat;
    const totalWon = room.players[bestResult.seat]!.stack; // approximate
    hand.resultMessage = `${room.players[bestResult.seat]!.name} wins with ${bestResult.result.description}`;
  }

  room.actionLog.push(hand.resultMessage);

  // Determine showdown winners for W$SD tracking
  const showdownWinners: number[] = [];
  if (hand.winner !== null) {
    showdownWinners.push(hand.winner);
  } else {
    // Split: all non-folded participants are winners
    showdownWinners.push(...hand.participants.filter(s => !hand.playerFolded[s]));
  }

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

  return {
    players: room.players.map((p, i) => {
      if (!p) return null;
      return {
        name: p.name,
        ready: p.ready,
        connected: p.connected,
        stack: p.stack,
        holeCards: (i === playerIndex || isShowdown) ? p.holeCards : null,
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
      currentBet: room.hand.currentBet,
      currentPlayerIndex: room.hand.currentPlayerIndex,
      playerBets: room.hand.playerBets,
      playerAllIn: room.hand.playerAllIn,
      playerFolded: room.hand.playerFolded,
      handOver: room.hand.handOver,
      showdown: room.hand.showdown,
      winner: room.hand.winner,
      resultMessage: room.hand.resultMessage,
    } : null,
    legalActions: room.hand && !room.hand.handOver && room.hand.currentPlayerIndex === playerIndex
      ? getCurrentLegalActions(room)
      : null,
    actionLog: room.actionLog,
    myIndex: playerIndex,
    avatarMode: room.avatarMode,
    avatarAssignment: room.avatarAssignment,
    handNumber: room.handNumber,
    lastShowdown: room.lastShowdown,
    lastFoldedHand: room.lastFoldedHand ? {
      actionLog: room.lastFoldedHand.actionLog,
      myHoleCards: room.lastFoldedHand.playerHoleCards.find(p => p.seat === playerIndex)?.holeCards ?? [],
    } : null,
    stats: room.stats,
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

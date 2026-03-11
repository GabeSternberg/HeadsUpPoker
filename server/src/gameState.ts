/**
 * Game state module — manages the authoritative state of a heads-up poker match.
 *
 * Design:
 *  - Room holds lobby state + settings + match state
 *  - Match holds the ongoing game across multiple hands
 *  - Hand holds the state of a single deal
 *
 * Heads-up betting order:
 *  - Preflop: dealer/SB acts first (player index = dealerIndex)
 *  - Postflop: BB acts first (player index = 1 - dealerIndex)
 *
 * After each hand, dealerIndex swaps.
 */

import { Deck, Card, cardToString } from './deck';
import { BettingState, getLegalActions, processAction, newStreetBetting, PlayerAction } from './betting';
import { evaluateHand, compareHands, HandResult } from './handEvaluator';

export type Round = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export interface PlayerState {
  id: string;        // socket ID
  name: string;      // "Player 1" or "Player 2"
  ready: boolean;
  connected: boolean;
  stack: number;
  holeCards: Card[];
  currentBetThisRound: number;
}

export interface HandState {
  deck: Deck;
  communityCards: Card[];
  round: Round;
  pot: number;
  currentBet: number;
  lastRaiseSize: number;
  playerBets: [number, number];
  playerActedThisRound: [boolean, boolean];
  playerAllIn: [boolean, boolean];
  currentPlayerIndex: number; // whose turn it is
  dealerIndex: number;        // 0 or 1 — also the SB
  handOver: boolean;
  showdown: boolean;
  winner: number | null;      // null = split pot
  winnerHand: HandResult | null;
  loserHand: HandResult | null;
  resultMessage: string;
}

export interface Settings {
  startingSum: number;
  bigBlind: number;
}

export interface Room {
  players: (PlayerState | null)[];
  settings: Settings;
  gameStarted: boolean;
  matchOver: boolean;
  hand: HandState | null;
  actionLog: string[];
  dealerIndex: number; // persists across hands
  avatarMode: boolean;
  // 'L' or 'G' assignment per player index, null if unassigned
  avatarAssignment: [string | null, string | null];
  handNumber: number;
}

export function createRoom(): Room {
  return {
    players: [null, null],
    settings: { startingSum: 1000, bigBlind: 20 },
    gameStarted: false,
    matchOver: false,
    hand: null,
    actionLog: [],
    dealerIndex: 0, // first connected player starts as dealer
    avatarMode: false,
    avatarAssignment: [null, null],
    handNumber: 0,
  };
}

/** Start a new hand. */
export function startHand(room: Room): void {
  const deck = new Deck();
  const dealerIndex = room.dealerIndex;
  const sbIndex = dealerIndex;      // in heads-up, dealer is SB
  const bbIndex = 1 - dealerIndex;

  const sb = room.settings.bigBlind / 2;
  const bb = room.settings.bigBlind;

  room.actionLog = [];
  room.matchOver = false;
  room.handNumber++;

  // Post blinds
  const sbAmount = Math.min(sb, room.players[sbIndex]!.stack);
  const bbAmount = Math.min(bb, room.players[bbIndex]!.stack);

  room.players[sbIndex]!.stack -= sbAmount;
  room.players[bbIndex]!.stack -= bbAmount;

  // Deal hole cards
  const cards0 = deck.deal(2);
  const cards1 = deck.deal(2);
  room.players[0]!.holeCards = cards0;
  room.players[1]!.holeCards = cards1;

  room.hand = {
    deck,
    communityCards: [],
    round: 'preflop',
    pot: sbAmount + bbAmount,
    currentBet: bbAmount,
    lastRaiseSize: bbAmount, // BB counts as the opening forced bet
    playerBets: [0, 0] as [number, number],
    playerActedThisRound: [false, false],
    playerAllIn: [false, false],
    currentPlayerIndex: sbIndex, // preflop, SB acts first in heads-up
    dealerIndex,
    handOver: false,
    showdown: false,
    winner: null,
    winnerHand: null,
    loserHand: null,
    resultMessage: '',
  };

  // Record blind bets in playerBets
  room.hand.playerBets[sbIndex] = sbAmount;
  room.hand.playerBets[bbIndex] = bbAmount;

  // Check all-in from blinds
  if (room.players[sbIndex]!.stack === 0) room.hand.playerAllIn[sbIndex] = true;
  if (room.players[bbIndex]!.stack === 0) room.hand.playerAllIn[bbIndex] = true;

  room.actionLog.push(`${room.players[sbIndex]!.name} posts small blind (${sbAmount})`);
  room.actionLog.push(`${room.players[bbIndex]!.name} posts big blind (${bbAmount})`);

  // If both are all-in from blinds, go straight to runout
  if (room.hand.playerAllIn[0] && room.hand.playerAllIn[1]) {
    runOutBoard(room);
  }
  // If SB is all-in from posting blind, BB doesn't need to act if SB couldn't cover
  else if (room.hand.playerAllIn[sbIndex] && sbAmount < bbAmount) {
    // BB can check (they already put in more)
    // Actually SB all-in for less means BB just checks, round is over
    runOutBoard(room);
  }
}

/** Get the betting state from current hand state. */
function getBettingState(room: Room): BettingState {
  const h = room.hand!;
  return {
    pot: h.pot,
    currentBet: h.currentBet,
    lastRaiseSize: h.lastRaiseSize,
    playerBets: [...h.playerBets] as [number, number],
    playerStacks: [room.players[0]!.stack, room.players[1]!.stack],
    playerActedThisRound: [...h.playerActedThisRound] as [boolean, boolean],
    playerAllIn: [...h.playerAllIn] as [boolean, boolean],
    bigBlind: room.settings.bigBlind,
    round: h.round as any,
  };
}

/** Process a player's action. Returns true if valid. */
export function handleAction(room: Room, playerIndex: number, action: PlayerAction): { valid: boolean; error?: string } {
  const hand = room.hand;
  if (!hand || hand.handOver) return { valid: false, error: 'No active hand' };
  if (hand.currentPlayerIndex !== playerIndex) return { valid: false, error: 'Not your turn' };
  if (hand.playerAllIn[playerIndex]) return { valid: false, error: 'You are all-in' };

  const bettingState = getBettingState(room);
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
  room.players[0]!.stack = ns.playerStacks[0];
  room.players[1]!.stack = ns.playerStacks[1];

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

  if (result.handOver) {
    // Fold — opponent wins
    const winner = 1 - result.foldedPlayer!;
    hand.handOver = true;
    hand.winner = winner;
    hand.resultMessage = `${room.players[winner]!.name} wins the pot (${hand.pot})`;
    room.players[winner]!.stack += hand.pot;
    room.actionLog.push(hand.resultMessage);
    return { valid: true };
  }

  if (result.roundOver) {
    advanceRound(room);
  } else {
    // Switch to next player
    hand.currentPlayerIndex = 1 - playerIndex;
    // If next player is all-in, the round should be over — handle edge case
    if (hand.playerAllIn[hand.currentPlayerIndex]) {
      advanceRound(room);
    }
  }

  return { valid: true };
}

/** Advance to the next round (flop, turn, river, showdown). */
function advanceRound(room: Room): void {
  const hand = room.hand!;
  const bothAllIn = hand.playerAllIn[0] && hand.playerAllIn[1];
  const oneAllIn = hand.playerAllIn[0] || hand.playerAllIn[1];

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
  hand.playerBets = [0, 0];
  hand.playerActedThisRound = [hand.playerAllIn[0], hand.playerAllIn[1]];

  // Postflop: BB acts first (the non-dealer)
  const bbIndex = 1 - hand.dealerIndex;
  hand.currentPlayerIndex = bbIndex;

  // If both all-in, run out remaining cards
  if (bothAllIn || (oneAllIn && hand.playerActedThisRound[0] && hand.playerActedThisRound[1])) {
    runOutBoard(room);
    return;
  }

  // If the first-to-act player is all-in, switch to the other
  if (hand.playerAllIn[hand.currentPlayerIndex]) {
    hand.currentPlayerIndex = 1 - hand.currentPlayerIndex;
    // If both all-in, run out
    if (hand.playerAllIn[hand.currentPlayerIndex]) {
      runOutBoard(room);
    }
  }
}

/** Deal remaining community cards and go to showdown (when both are all-in). */
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

/** Evaluate hands and award pot. */
function doShowdown(room: Room): void {
  const hand = room.hand!;
  hand.showdown = true;
  hand.handOver = true;

  const cards0 = [...room.players[0]!.holeCards, ...hand.communityCards];
  const cards1 = [...room.players[1]!.holeCards, ...hand.communityCards];

  const hand0 = evaluateHand(cards0);
  const hand1 = evaluateHand(cards1);

  const cmp = compareHands(hand0, hand1);

  if (cmp > 0) {
    hand.winner = 0;
    hand.winnerHand = hand0;
    hand.loserHand = hand1;
    // Handle unequal all-in: winner can only win as much as they put in from the other player
    const potShare = settlePot(room, 0);
    hand.resultMessage = `${room.players[0]!.name} wins ${potShare} with ${hand0.description}`;
  } else if (cmp < 0) {
    hand.winner = 1;
    hand.winnerHand = hand1;
    hand.loserHand = hand0;
    const potShare = settlePot(room, 1);
    hand.resultMessage = `${room.players[1]!.name} wins ${potShare} with ${hand1.description}`;
  } else {
    hand.winner = null;
    hand.winnerHand = hand0;
    hand.loserHand = hand1;
    // Split pot
    const half = Math.floor(hand.pot / 2);
    const remainder = hand.pot - half * 2;
    room.players[0]!.stack += half;
    room.players[1]!.stack += half;
    // Odd chip goes to the player out of position (BB) — standard rule
    if (remainder > 0) {
      const bbIndex = 1 - hand.dealerIndex;
      room.players[bbIndex]!.stack += remainder;
    }
    hand.pot = 0;
    hand.resultMessage = `Split pot — both players have ${hand0.description}`;
  }

  room.actionLog.push(hand.resultMessage);
}

/**
 * Settle pot for a winner. Handles the case where one player is all-in for less:
 * since there are only 2 players, no side pots needed. The winner gets the whole
 * pot (which is min(player_total_bet, opponent_total_bet) * 2 + any remainder back).
 *
 * Actually in 2-player, the pot is always correct — each player can only win what
 * they contributed from the opponent, but since we already limited bets to stack size,
 * the pot is the correct amount. Winner takes it all.
 */
function settlePot(room: Room, winnerIndex: number): number {
  const amount = room.hand!.pot;
  room.players[winnerIndex]!.stack += amount;
  room.hand!.pot = 0;
  return amount;
}

/** Get the legal actions for the current player. */
export function getCurrentLegalActions(room: Room) {
  if (!room.hand || room.hand.handOver) return null;
  const bettingState = getBettingState(room);
  return getLegalActions(bettingState, room.hand.currentPlayerIndex);
}

/** Build the game state visible to a specific player (hides opponent's cards). */
export function getClientState(room: Room, playerIndex: number) {
  const opponent = 1 - playerIndex;

  const isShowdown = room.hand?.showdown ?? false;

  return {
    players: room.players.map((p, i) => {
      if (!p) return null;
      return {
        name: p.name,
        ready: p.ready,
        connected: p.connected,
        stack: p.stack,
        // Only show own cards, or both at showdown
        holeCards: (i === playerIndex || isShowdown) ? p.holeCards : null,
        isDealer: room.hand ? room.hand.dealerIndex === i : (room.dealerIndex === i),
        isBB: room.hand ? (1 - room.hand.dealerIndex) === i : (1 - room.dealerIndex) === i,
      };
    }),
    settings: room.settings,
    gameStarted: room.gameStarted,
    matchOver: room.matchOver,
    hand: room.hand ? {
      communityCards: room.hand.communityCards,
      round: room.hand.round,
      pot: room.hand.pot,
      currentBet: room.hand.currentBet,
      currentPlayerIndex: room.hand.currentPlayerIndex,
      playerBets: room.hand.playerBets,
      playerAllIn: room.hand.playerAllIn,
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
  };
}

/** Check if the match is over (one player has 0 chips). */
export function checkMatchOver(room: Room): boolean {
  if (room.players[0] && room.players[1]) {
    if (room.players[0].stack <= 0 || room.players[1].stack <= 0) {
      room.matchOver = true;
      return true;
    }
  }
  return false;
}

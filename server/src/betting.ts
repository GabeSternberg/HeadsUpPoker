/**
 * Betting logic module.
 *
 * Validates and processes player actions (fold, check/call, raise)
 * according to no-limit Texas Hold'em rules.
 */

export type ActionType = 'fold' | 'check' | 'call' | 'raise';

export interface PlayerAction {
  type: ActionType;
  amount?: number; // only for raise — total bet this round (not raise increment)
}

export interface BettingState {
  pot: number;
  currentBet: number;        // largest total bet this round
  lastRaiseSize: number;     // size of last raise increment (for min-raise calc)
  playerBets: [number, number]; // each player's total bet THIS ROUND
  playerStacks: [number, number];
  playerActedThisRound: [boolean, boolean];
  playerAllIn: [boolean, boolean];
  bigBlind: number;
  round: 'preflop' | 'flop' | 'turn' | 'river';
}

export interface ActionResult {
  valid: boolean;
  error?: string;
  newState?: BettingState;
  handOver?: boolean;    // true if someone folded
  roundOver?: boolean;   // true if betting round is complete
  foldedPlayer?: number; // index of player who folded
}

/**
 * Get the legal actions for a player.
 * Returns an object describing what the player can do.
 */
export function getLegalActions(state: BettingState, playerIndex: number): {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmount: number;
  canRaise: boolean;
  minRaise: number;  // minimum total bet to raise to
  maxRaise: number;  // maximum total bet (all-in)
} {
  const toCall = state.currentBet - state.playerBets[playerIndex];
  const stack = state.playerStacks[playerIndex];

  const canFold = true;
  const canCheck = toCall === 0;
  const canCall = toCall > 0 && stack > 0;
  const callAmount = Math.min(toCall, stack); // all-in for less if needed

  // Min raise: current bet + max(lastRaiseSize, bigBlind)
  // But preflop the BB counts as the opening bet, so lastRaiseSize starts at BB
  const minRaiseIncrement = Math.max(state.lastRaiseSize, state.bigBlind);
  const minRaiseTotal = state.currentBet + minRaiseIncrement;
  const maxRaiseTotal = state.playerBets[playerIndex] + stack; // all-in

  // Player can raise if they have more chips than what's needed to call
  const canRaise = stack > toCall && maxRaiseTotal > state.currentBet;

  return {
    canFold,
    canCheck,
    canCall,
    callAmount,
    canRaise,
    // If player can't meet min raise but can go all-in, allow all-in
    minRaise: Math.min(minRaiseTotal, maxRaiseTotal),
    maxRaise: maxRaiseTotal,
  };
}

/**
 * Process a player action and return the result.
 */
export function processAction(
  state: BettingState,
  playerIndex: number,
  action: PlayerAction
): ActionResult {
  const legal = getLegalActions(state, playerIndex);
  const newState: BettingState = {
    ...state,
    playerBets: [...state.playerBets] as [number, number],
    playerStacks: [...state.playerStacks] as [number, number],
    playerActedThisRound: [...state.playerActedThisRound] as [boolean, boolean],
    playerAllIn: [...state.playerAllIn] as [boolean, boolean],
  };

  switch (action.type) {
    case 'fold': {
      return {
        valid: true,
        newState,
        handOver: true,
        foldedPlayer: playerIndex,
      };
    }

    case 'check': {
      if (!legal.canCheck) {
        return { valid: false, error: 'Cannot check — must call or fold' };
      }
      newState.playerActedThisRound[playerIndex] = true;
      break;
    }

    case 'call': {
      if (!legal.canCall) {
        return { valid: false, error: 'Nothing to call' };
      }
      const callAmt = legal.callAmount;
      newState.playerStacks[playerIndex] -= callAmt;
      newState.playerBets[playerIndex] += callAmt;
      newState.pot += callAmt;
      newState.playerActedThisRound[playerIndex] = true;
      if (newState.playerStacks[playerIndex] === 0) {
        newState.playerAllIn[playerIndex] = true;
      }
      break;
    }

    case 'raise': {
      if (!legal.canRaise) {
        return { valid: false, error: 'Cannot raise' };
      }
      const raiseTotal = action.amount;
      if (raiseTotal === undefined) {
        return { valid: false, error: 'Raise amount required' };
      }
      // Validate raise amount
      if (raiseTotal > legal.maxRaise) {
        return { valid: false, error: `Cannot raise to ${raiseTotal}, max is ${legal.maxRaise}` };
      }
      // Allow all-in even if below min raise
      if (raiseTotal < legal.minRaise && raiseTotal !== legal.maxRaise) {
        return { valid: false, error: `Minimum raise is to ${legal.minRaise}` };
      }

      const raiseIncrement = raiseTotal - newState.currentBet;
      const chipsNeeded = raiseTotal - newState.playerBets[playerIndex];
      newState.playerStacks[playerIndex] -= chipsNeeded;
      newState.playerBets[playerIndex] = raiseTotal;
      newState.pot += chipsNeeded;
      newState.currentBet = raiseTotal;
      // Only update lastRaiseSize if it was a full raise
      if (raiseIncrement >= newState.lastRaiseSize) {
        newState.lastRaiseSize = raiseIncrement;
      }
      newState.playerActedThisRound[playerIndex] = true;
      // Opponent must act again
      const opponent = 1 - playerIndex;
      newState.playerActedThisRound[opponent] = false;
      if (newState.playerStacks[playerIndex] === 0) {
        newState.playerAllIn[playerIndex] = true;
      }
      break;
    }

    default:
      return { valid: false, error: 'Unknown action type' };
  }

  // Check if betting round is over
  const roundOver = isBettingRoundOver(newState);

  return {
    valid: true,
    newState,
    roundOver,
    handOver: false,
  };
}

/** Betting round is over when both players have acted and bets are matched, or both are all-in. */
function isBettingRoundOver(state: BettingState): boolean {
  // Both all-in
  if (state.playerAllIn[0] && state.playerAllIn[1]) return true;
  // One player all-in and the other has acted
  if (state.playerAllIn[0] && state.playerActedThisRound[1]) return true;
  if (state.playerAllIn[1] && state.playerActedThisRound[0]) return true;
  // Both acted and bets matched
  if (state.playerActedThisRound[0] && state.playerActedThisRound[1] &&
      state.playerBets[0] === state.playerBets[1]) {
    return true;
  }
  return false;
}

/** Reset per-round betting state for a new street. */
export function newStreetBetting(state: BettingState): BettingState {
  return {
    ...state,
    currentBet: 0,
    lastRaiseSize: 0,
    playerBets: [0, 0],
    playerActedThisRound: [
      state.playerAllIn[0], // all-in players count as having acted
      state.playerAllIn[1],
    ],
  };
}

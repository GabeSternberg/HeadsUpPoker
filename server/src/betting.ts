/**
 * Betting logic module.
 *
 * Validates and processes player actions (fold, check/call, raise)
 * according to no-limit Texas Hold'em rules.
 * Supports any number of players.
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
  playerBets: number[];      // each player's total bet THIS ROUND
  playerStacks: number[];
  playerActedThisRound: boolean[];
  playerAllIn: boolean[];
  playerFolded: boolean[];
  bigBlind: number;
  round: 'preflop' | 'flop' | 'turn' | 'river';
  numPlayers: number;
}

export interface ActionResult {
  valid: boolean;
  error?: string;
  newState?: BettingState;
  handOver?: boolean;    // true if only one player remains (all others folded)
  roundOver?: boolean;   // true if betting round is complete
  foldedPlayer?: number; // index of player who folded
}

/**
 * Get the legal actions for a player.
 */
export function getLegalActions(state: BettingState, playerIndex: number): {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmount: number;
  canRaise: boolean;
  minRaise: number;
  maxRaise: number;
} {
  const toCall = state.currentBet - state.playerBets[playerIndex];
  const stack = state.playerStacks[playerIndex];

  const canFold = true;
  const canCheck = toCall === 0;
  const canCall = toCall > 0 && stack > 0;
  const callAmount = Math.min(toCall, stack);

  // Min raise: must at least double the current bet (house rule)
  const minRaiseTotal = Math.max(state.currentBet * 2, state.currentBet + state.bigBlind);
  const maxRaiseTotal = state.playerBets[playerIndex] + stack;

  const canRaise = stack > toCall && maxRaiseTotal > state.currentBet;

  return {
    canFold,
    canCheck,
    canCall,
    callAmount,
    canRaise,
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
    playerBets: [...state.playerBets],
    playerStacks: [...state.playerStacks],
    playerActedThisRound: [...state.playerActedThisRound],
    playerAllIn: [...state.playerAllIn],
    playerFolded: [...state.playerFolded],
  };

  switch (action.type) {
    case 'fold': {
      newState.playerFolded[playerIndex] = true;
      newState.playerActedThisRound[playerIndex] = true;

      // Check if only one player remains
      const remaining = newState.playerFolded.filter(f => !f).length;
      if (remaining === 1) {
        return {
          valid: true,
          newState,
          handOver: true,
          foldedPlayer: playerIndex,
        };
      }

      // Check if betting round is over after this fold
      const roundOver = isBettingRoundOver(newState);
      return {
        valid: true,
        newState,
        roundOver,
        handOver: false,
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
      if (raiseTotal > legal.maxRaise) {
        return { valid: false, error: `Cannot raise to ${raiseTotal}, max is ${legal.maxRaise}` };
      }
      if (raiseTotal < legal.minRaise && raiseTotal !== legal.maxRaise) {
        return { valid: false, error: `Minimum raise is to ${legal.minRaise}` };
      }

      const raiseIncrement = raiseTotal - newState.currentBet;
      const chipsNeeded = raiseTotal - newState.playerBets[playerIndex];
      newState.playerStacks[playerIndex] -= chipsNeeded;
      newState.playerBets[playerIndex] = raiseTotal;
      newState.pot += chipsNeeded;
      newState.currentBet = raiseTotal;
      if (raiseIncrement >= newState.lastRaiseSize) {
        newState.lastRaiseSize = raiseIncrement;
      }
      newState.playerActedThisRound[playerIndex] = true;
      // All other non-folded, non-all-in players must act again
      for (let i = 0; i < newState.numPlayers; i++) {
        if (i !== playerIndex && !newState.playerFolded[i] && !newState.playerAllIn[i]) {
          newState.playerActedThisRound[i] = false;
        }
      }
      if (newState.playerStacks[playerIndex] === 0) {
        newState.playerAllIn[playerIndex] = true;
      }
      break;
    }

    default:
      return { valid: false, error: 'Unknown action type' };
  }

  const roundOver = isBettingRoundOver(newState);

  return {
    valid: true,
    newState,
    roundOver,
    handOver: false,
  };
}

/** Betting round is over when all active (non-folded) players have acted and bets are matched (or all-in). */
function isBettingRoundOver(state: BettingState): boolean {
  const maxBet = state.currentBet;

  for (let i = 0; i < state.numPlayers; i++) {
    if (state.playerFolded[i]) continue;
    if (state.playerAllIn[i]) continue;
    // This player is active — they must have acted and matched the bet
    if (!state.playerActedThisRound[i]) return false;
    if (state.playerBets[i] !== maxBet) return false;
  }

  return true;
}

/** Reset per-round betting state for a new street. */
export function newStreetBetting(state: BettingState): BettingState {
  const acted = new Array(state.numPlayers).fill(false);
  for (let i = 0; i < state.numPlayers; i++) {
    // All-in and folded players count as having acted
    if (state.playerAllIn[i] || state.playerFolded[i]) {
      acted[i] = true;
    }
  }
  return {
    ...state,
    currentBet: 0,
    lastRaiseSize: 0,
    playerBets: new Array(state.numPlayers).fill(0),
    playerActedThisRound: acted,
  };
}

/** Shared types matching the server's getClientState output. */

export interface Card {
  suit: 'hearts' | 'diamonds' | 'clubs' | 'spades';
  rank: number; // 2-14, 14=Ace
}

export interface PlayerInfo {
  name: string;
  ready: boolean;
  connected: boolean;
  stack: number;
  holeCards: Card[] | null;
  isDealer: boolean;
  isBB: boolean;
}

export interface HandInfo {
  communityCards: Card[];
  round: string;
  pot: number;
  currentBet: number;
  currentPlayerIndex: number;
  playerBets: [number, number];
  playerAllIn: [boolean, boolean];
  handOver: boolean;
  showdown: boolean;
  winner: number | null;
  resultMessage: string;
}

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmount: number;
  canRaise: boolean;
  minRaise: number;
  maxRaise: number;
}

export interface GameState {
  players: (PlayerInfo | null)[];
  settings: { startingSum: number; bigBlind: number };
  gameStarted: boolean;
  matchOver: boolean;
  hand: HandInfo | null;
  legalActions: LegalActions | null;
  actionLog: string[];
  myIndex: number;
  avatarMode: boolean;
  avatarAssignment: [string | null, string | null];
  handNumber: number;
}

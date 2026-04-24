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
  isSB: boolean;
  isBB: boolean;
  folded: boolean;
}

export interface HandInfo {
  communityCards: Card[];
  round: string;
  pot: number;
  currentBet: number;
  currentPlayerIndex: number;
  playerBets: number[];
  playerAllIn: boolean[];
  playerFolded: boolean[];
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

export interface PlayerStatsRaw {
  handsPlayed: number;
  vpipOpportunities: number; vpipCount: number;
  pfrOpportunities: number; pfrCount: number;
  threeBetOpportunities: number; threeBetCount: number;
  foldToThreeBetOpportunities: number; foldToThreeBetCount: number;
  cbetOpportunities: number; cbetCount: number;
  foldToCbetOpportunities: number; foldToCbetCount: number;
  postflopBetsRaises: number; postflopCalls: number;
  wtsdOpportunities: number; wtsdCount: number;
  wsdCount: number;
}

export interface LastShowdownInfo {
  playerHands: { seat: number; name: string; holeCards: Card[] }[];
  communityCards: Card[];
  resultMessage: string;
}

export interface GameState {
  players: (PlayerInfo | null)[];
  settings: { startingSum: number; bigBlind: number; uiMode: 'mobile' | 'pc' };
  gameStarted: boolean;
  matchOver: boolean;
  mode: 'headsup' | 'unlimited';
  hand: HandInfo | null;
  legalActions: LegalActions | null;
  actionLog: string[];
  myIndex: number;
  avatarMode: boolean;
  avatarAssignment: (string | null)[];
  handNumber: number;
  lastShowdown: LastShowdownInfo | null;
  lastFoldedHand: { actionLog: string[]; myHoleCards: Card[] } | null;
  stats: PlayerStatsRaw[];
}

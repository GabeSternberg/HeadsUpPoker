/**
 * Per-decision classifier data logger.
 *
 * Logs one row per betting decision (action) to classifier_decisions.csv.
 * In avatar mode:
 *   - Gabe ('G'): always logged, even on folds.
 *   - Liana ('L'): only logged when the hand reaches showdown.
 *
 * Each row captures game-state features, board texture, opponent HUD stats,
 * the action taken, and (at commit time) hole cards + hand rank + won/lost.
 */

import fs from 'fs';
import path from 'path';
import { Card, cardToString } from './deck';

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../logs');
export const CLASSIFIER_CSV_PATH = path.join(DATA_DIR, 'classifier_decisions.csv');

const HEADER = [
  'timestamp', 'handNumber', 'street', 'playerRole', 'action', 'amount',
  // Game state
  'inPosition', 'effectiveStackBB', 'spr',
  // Betting context
  'wasPreflopAggressor', 'facingBet', 'betSizePctPot', 'previousBetPctPot',
  'numRaisesThisStreet', 'potSizeBB',
  // Board texture (0 when preflop)
  'highestCardRank', 'isPairedBoard', 'numSuitedCardsOnBoard',
  'numConnectedCardsOnBoard', 'hasFlushDraw', 'hasStraightDraw',
  // Opponent HUD stats (cumulative from prior hands)
  'opponentVPIP', 'opponentPFR', 'opponentAF', 'opponentFoldToCBet', 'opponentSampleSize',
  // Result — filled at hand end
  'holeCards', 'handRank', 'won',
].join(',');

/** Pending decision — all fields except the result columns. */
export interface PendingDecision {
  handNumber: number;
  street: string;
  playerRole: string;
  playerSeat: number;
  action: string;
  amount: number;
  inPosition: boolean;
  effectiveStackBB: number;
  spr: number;
  wasPreflopAggressor: boolean;
  facingBet: boolean;
  betSizePctPot: number;
  previousBetPctPot: number;
  numRaisesThisStreet: number;
  potSizeBB: number;
  highestCardRank: number;
  isPairedBoard: boolean;
  numSuitedCardsOnBoard: number;
  numConnectedCardsOnBoard: number;
  hasFlushDraw: boolean;
  hasStraightDraw: boolean;
  opponentVPIP: number;
  opponentPFR: number;
  opponentAF: number;
  opponentFoldToCBet: number;
  opponentSampleSize: number;
}

export function initClassifierCSV(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(CLASSIFIER_CSV_PATH)) {
      fs.writeFileSync(CLASSIFIER_CSV_PATH, HEADER + '\n');
    }
  } catch (e) {
    console.error('Failed to init classifier CSV:', e);
  }
}

function b(v: boolean): number { return v ? 1 : 0; }
function f(n: number): string { return n.toFixed(3); }
function q(s: string): string { return `"${s.replace(/"/g, '""')}"`; }

export function flushDecisions(
  decisions: PendingDecision[],
  holeCardsByRole: Record<string, Card[]>,
  handRankByRole: Record<string, string>,
  wonByRole: Record<string, boolean>,
): void {
  if (decisions.length === 0) return;
  try {
    const ts = new Date().toISOString();
    const rows = decisions.map(d => {
      const cards = (holeCardsByRole[d.playerRole] || []).map(cardToString).join(' ');
      const rank = handRankByRole[d.playerRole] || '';
      const won = wonByRole[d.playerRole] ?? false;
      return [
        ts,
        d.handNumber,
        d.street,
        d.playerRole,
        d.action,
        d.amount,
        b(d.inPosition),
        f(d.effectiveStackBB),
        f(d.spr),
        b(d.wasPreflopAggressor),
        b(d.facingBet),
        f(d.betSizePctPot),
        f(d.previousBetPctPot),
        d.numRaisesThisStreet,
        f(d.potSizeBB),
        d.highestCardRank,
        b(d.isPairedBoard),
        d.numSuitedCardsOnBoard,
        d.numConnectedCardsOnBoard,
        b(d.hasFlushDraw),
        b(d.hasStraightDraw),
        f(d.opponentVPIP),
        f(d.opponentPFR),
        f(d.opponentAF),
        f(d.opponentFoldToCBet),
        d.opponentSampleSize,
        q(cards),
        q(rank),
        b(won),
      ].join(',');
    });
    fs.appendFileSync(CLASSIFIER_CSV_PATH, rows.join('\n') + '\n');
  } catch (e) {
    console.error('Failed to flush classifier decisions:', e);
  }
}

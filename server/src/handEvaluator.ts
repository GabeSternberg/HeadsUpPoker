/**
 * Hand evaluator for 7-card Texas Hold'em.
 *
 * Evaluates the best 5-card hand from 7 cards (2 hole + 5 community).
 * Returns a HandResult with category, rank array for tie-breaking, and
 * a human-readable description.
 *
 * Hand categories (higher = better):
 *   9 = Royal Flush
 *   8 = Straight Flush
 *   7 = Four of a Kind
 *   6 = Full House
 *   5 = Flush
 *   4 = Straight
 *   3 = Three of a Kind
 *   2 = Two Pair
 *   1 = One Pair
 *   0 = High Card
 */

import { Card, Rank, rankToString } from './deck';

export interface HandResult {
  category: number;       // 0-9
  ranks: number[];        // for tie-breaking, highest significance first
  description: string;    // e.g. "flush, ace high"
}

const CATEGORY_NAMES: Record<number, string> = {
  9: 'a royal flush',
  8: 'a straight flush',
  7: 'four of a kind',
  6: 'a full house',
  5: 'a flush',
  4: 'a straight',
  3: 'three of a kind',
  2: 'two pair',
  1: 'one pair',
  0: 'high card',
};

/** Generate all C(n,5) 5-card combinations from n cards. */
function combinations5(cards: Card[]): Card[][] {
  const result: Card[][] = [];
  const n = cards.length;
  for (let i = 0; i < n - 4; i++)
    for (let j = i + 1; j < n - 3; j++)
      for (let k = j + 1; k < n - 2; k++)
        for (let l = k + 1; l < n - 1; l++)
          for (let m = l + 1; m < n; m++)
            result.push([cards[i], cards[j], cards[k], cards[l], cards[m]]);
  return result;
}

/** Evaluate exactly 5 cards. */
function evaluate5(cards: Card[]): HandResult {
  const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);

  const isFlush = suits.every(s => s === suits[0]);

  // Check for straight (ace can be high or low)
  let isStraight = false;
  let straightHigh = 0;

  // Normal straight check
  if (ranks[0] - ranks[4] === 4 && new Set(ranks).size === 5) {
    isStraight = true;
    straightHigh = ranks[0];
  }
  // Wheel: A-2-3-4-5 (ranks sorted descending: [14,5,4,3,2])
  if (!isStraight && ranks[0] === 14 && ranks[1] === 5 && ranks[2] === 4 && ranks[3] === 3 && ranks[4] === 2) {
    isStraight = true;
    straightHigh = 5; // 5-high straight
  }

  // Count rank frequencies
  const freq: Map<number, number> = new Map();
  for (const r of ranks) freq.set(r, (freq.get(r) || 0) + 1);
  // Sort groups by (frequency desc, rank desc)
  const groups = Array.from(freq.entries()).sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  // Royal flush
  if (isFlush && isStraight && straightHigh === 14) {
    return { category: 9, ranks: [14], description: 'a royal flush' };
  }
  // Straight flush
  if (isFlush && isStraight) {
    return { category: 8, ranks: [straightHigh], description: `a straight flush, ${rankName(straightHigh)} high` };
  }
  // Four of a kind
  if (groups[0][1] === 4) {
    const quadRank = groups[0][0];
    const kicker = groups[1][0];
    return { category: 7, ranks: [quadRank, kicker], description: `four of a kind, ${rankName(quadRank)}s` };
  }
  // Full house
  if (groups[0][1] === 3 && groups[1][1] === 2) {
    return { category: 6, ranks: [groups[0][0], groups[1][0]], description: `a full house, ${rankName(groups[0][0])}s full of ${rankName(groups[1][0])}s` };
  }
  // Flush
  if (isFlush) {
    return { category: 5, ranks: [...ranks], description: `a flush, ${rankName(ranks[0])} high` };
  }
  // Straight
  if (isStraight) {
    return { category: 4, ranks: [straightHigh], description: `a straight, ${rankName(straightHigh)} high` };
  }
  // Three of a kind
  if (groups[0][1] === 3) {
    const kickers = groups.filter(g => g[1] === 1).map(g => g[0]).sort((a, b) => b - a);
    return { category: 3, ranks: [groups[0][0], ...kickers], description: `three of a kind, ${rankName(groups[0][0])}s` };
  }
  // Two pair
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const highPair = Math.max(groups[0][0], groups[1][0]);
    const lowPair = Math.min(groups[0][0], groups[1][0]);
    const kicker = groups[2][0];
    return { category: 2, ranks: [highPair, lowPair, kicker], description: `two pair, ${rankName(highPair)}s and ${rankName(lowPair)}s` };
  }
  // One pair
  if (groups[0][1] === 2) {
    const kickers = groups.filter(g => g[1] === 1).map(g => g[0]).sort((a, b) => b - a);
    return { category: 1, ranks: [groups[0][0], ...kickers], description: `a pair of ${rankName(groups[0][0])}s` };
  }
  // High card
  return { category: 0, ranks: [...ranks], description: `${rankName(ranks[0])} high` };
}

function rankName(r: number): string {
  return rankToString(r as Rank);
}

/**
 * Evaluate the best 5-card hand from 7 cards.
 * Checks all C(7,5) = 21 combinations.
 */
export function evaluateHand(cards: Card[]): HandResult {
  if (cards.length < 5) throw new Error('Need at least 5 cards to evaluate');
  const combos = combinations5(cards);
  let best: HandResult | null = null;
  for (const combo of combos) {
    const result = evaluate5(combo);
    if (!best || compareHands(result, best) > 0) {
      best = result;
    }
  }
  return best!;
}

/**
 * Compare two HandResults.
 * Returns positive if a > b, negative if a < b, 0 if tie.
 */
export function compareHands(a: HandResult, b: HandResult): number {
  if (a.category !== b.category) return a.category - b.category;
  for (let i = 0; i < Math.min(a.ranks.length, b.ranks.length); i++) {
    if (a.ranks[i] !== b.ranks[i]) return a.ranks[i] - b.ranks[i];
  }
  return 0;
}

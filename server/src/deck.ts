/**
 * Deck module — standard 52-card deck with Fisher-Yates shuffle
 * using cryptographic randomness (node:crypto).
 */

import crypto from 'crypto';

export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;
// 11=J, 12=Q, 13=K, 14=A

export interface Card {
  suit: Suit;
  rank: Rank;
}

const SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export function rankToString(rank: Rank): string {
  switch (rank) {
    case 14: return 'A';
    case 13: return 'K';
    case 12: return 'Q';
    case 11: return 'J';
    default: return String(rank);
  }
}

export function cardToString(card: Card): string {
  const suitSymbol: Record<Suit, string> = {
    hearts: '\u2665',
    diamonds: '\u2666',
    clubs: '\u2663',
    spades: '\u2660',
  };
  return `${rankToString(card.rank)}${suitSymbol[card.suit]}`;
}

export class Deck {
  private cards: Card[] = [];

  constructor() {
    this.reset();
  }

  /** Build a fresh sorted deck and shuffle it. */
  reset(): void {
    this.cards = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        this.cards.push({ suit, rank });
      }
    }
    this.shuffle();
  }

  /** Fisher-Yates shuffle using cryptographic randomness. */
  private shuffle(): void {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const bytes = crypto.randomBytes(4);
      const rand = bytes.readUInt32BE(0);
      const j = rand % (i + 1);
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  /** Deal n cards off the top. Throws if not enough cards remain. */
  deal(n: number): Card[] {
    if (n > this.cards.length) {
      throw new Error(`Cannot deal ${n} cards, only ${this.cards.length} remain`);
    }
    return this.cards.splice(0, n);
  }
}

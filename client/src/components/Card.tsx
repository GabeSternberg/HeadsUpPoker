import { Card as CardType } from '../types';

const SUIT_SYMBOLS: Record<string, string> = {
  hearts: '\u2665',
  diamonds: '\u2666',
  clubs: '\u2663',
  spades: '\u2660',
};

const RANK_NAMES: Record<number, string> = {
  14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: '10',
  9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2',
};

export function CardDisplay({ card }: { card: CardType }) {
  const colorClass =
    card.suit === 'hearts' || card.suit === 'diamonds' ? 'red'
    : card.suit === 'clubs' ? 'club-green'
    : 'black';
  return (
    <span className={`card ${colorClass}`}>
      {RANK_NAMES[card.rank]}{SUIT_SYMBOLS[card.suit]}
    </span>
  );
}

export function CardBack() {
  return <span className="card card-back">??</span>;
}

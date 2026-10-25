import { HandInfo } from '../types';
import { useAmountDisplay } from './AmountDisplay';

export function displayedPot(hand: HandInfo): number {
  return hand.handOver && hand.pots?.length ? hand.pots.reduce((sum, pot) => sum + pot.amount, 0) : hand.pot;
}

export default function PotBreakdown({ hand }: { hand: HandInfo }) {
  const { format } = useAmountDisplay();
  if (!hand.pots || hand.pots.length < 2) return null;
  return <section className="pot-breakdown" aria-label="Pot breakdown">
    <div className="pot-breakdown-heading">Main pot + {hand.pots.length - 1} side {hand.pots.length === 2 ? 'pot' : 'pots'}</div>
    <ul className="pot-breakdown-list" tabIndex={0} aria-label="All pots">
      {hand.pots.map((pot, i) => <li key={i} className="pot-breakdown-item">
        <div className="pot-breakdown-amount"><span>{i === 0 ? 'Main pot' : `Side pot ${i}`}</span><strong>{format(pot.amount)}</strong></div>
        {pot.awards.length ? <div className="pot-breakdown-winners">{pot.awards.map(award => `${award.name}: ${format(award.amount)}`).join(' · ')}</div> : <div className="pot-breakdown-eligible" title={pot.eligiblePlayers.map(player => player.name).join(', ')}>Eligible: {pot.eligiblePlayers.length} {pot.eligiblePlayers.length === 1 ? 'player' : 'players'}</div>}
      </li>)}
    </ul>
    {hand.uncalled > 0 && <div className="pot-breakdown-pending">Unmatched wager: {format(hand.uncalled)}</div>}
  </section>;
}

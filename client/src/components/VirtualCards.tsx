import { GameState } from '../types';
import { CardDisplay } from './Card';

interface VirtualCardsProps {
  gameState: GameState;
  myIndex: number;
  onNextPhase: () => void;
  onNextHand: () => void;
}

const PHASE_LABEL: Record<string, string> = {
  dealt: 'Cards Dealt',
  flop:  'Flop',
  turn:  'Turn',
  river: 'River',
};

export default function VirtualCards({ gameState, myIndex, onNextPhase, onNextHand }: VirtualCardsProps) {
  const vc = gameState.vcState!;
  const atRiver = vc.phase === 'river';

  return (
    <div className="vc-table">
      <div className="vc-phase-banner">{PHASE_LABEL[vc.phase] ?? vc.phase}</div>

      {/* Community cards */}
      <div className="vc-community">
        {vc.communityCards.length === 0 ? (
          <span className="vc-community-empty">Community cards will appear here</span>
        ) : (
          vc.communityCards.map((card, i) => <CardDisplay key={i} card={card} />)
        )}
      </div>

      {/* Phase controls */}
      <div className="vc-controls">
        <button
          className="btn vc-btn-phase"
          onClick={onNextPhase}
          disabled={atRiver}
        >
          {atRiver ? 'River' : `Show ${vc.phase === 'dealt' ? 'Flop' : vc.phase === 'flop' ? 'Turn' : 'River'}`}
        </button>
        <button className="btn vc-btn-next-hand" onClick={onNextHand}>
          Next Hand
        </button>
      </div>

      {/* Player list */}
      <div className="vc-players">
        {gameState.players.map((player, i) => {
          if (!player) return null;
          const isMe = i === myIndex;
          const role = gameState.avatarMode ? gameState.avatarAssignment[i] : null;
          const displayName = role === 'G' ? 'Gabe' : role === 'L' ? 'Liana' : player.name;
          return (
            <div key={i} className={`vc-player ${isMe ? 'vc-me' : ''}`}>
              <span className="vc-player-name">{displayName}{isMe ? ' (You)' : ''}</span>
              {i === vc.sbSeat && <span className="vc-badge vc-sb">SB</span>}
              {i === vc.bbSeat && <span className="vc-badge vc-bb">BB</span>}
              {isMe && vc.myCards.length > 0 && (
                <div className="vc-my-cards">
                  {vc.myCards.map((card, ci) => <CardDisplay key={ci} card={card} />)}
                </div>
              )}
              {!isMe && (
                <span className="vc-hidden-cards">🂠 🂠</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

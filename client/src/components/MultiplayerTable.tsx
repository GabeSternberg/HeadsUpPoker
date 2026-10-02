import { useEffect, useRef, useState } from 'react';
import { Card, GameState } from '../types';
import { getDisplayName } from '../displayNames';
import { CardDisplay } from './Card';

type StreetAction = 'check' | 'fold' | 'call' | 'raise' | 'blind';

function streetActions(log: string[], names: string[]): Map<number, StreetAction> {
  let start = 0;
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].startsWith('---')) {
      start = i + 1;
      break;
    }
  }
  const named = names
    .map((name, index) => ({ name, index }))
    .filter(entry => entry.name.length > 0)
    .sort((a, b) => b.name.length - a.name.length);
  const found = new Map<number, StreetAction>();
  for (const entry of log.slice(start)) {
    const hit = named.find(player => entry.startsWith(`${player.name} `));
    if (!hit) continue;
    if (entry.includes(' folds')) found.set(hit.index, 'fold');
    else if (entry.includes(' checks')) found.set(hit.index, 'check');
    else if (entry.includes(' calls')) found.set(hit.index, 'call');
    else if (entry.includes(' raises')) found.set(hit.index, 'raise');
    else if (entry.includes(' posts ')) found.set(hit.index, 'blind');
  }
  return found;
}

function seatPoint(visual: number, count: number, radiusX: number, radiusY: number) {
  const angle = Math.PI / 2 + (visual / count) * Math.PI * 2;
  return {
    left: 50 + Math.cos(angle) * radiusX,
    top: 50 + Math.sin(angle) * radiusY,
  };
}

function HoleCards({
  faceUp,
  cards,
  mine,
  style,
}: {
  faceUp: boolean;
  cards: Card[] | null;
  mine: boolean;
  style: { left: string; top: string };
}) {
  if (faceUp && cards && cards.length > 0) {
    return (
      <div className={`mp-hole${mine ? ' mine' : ''}`} style={style}>
        {cards.map((card, i) => <CardDisplay key={i} card={card} />)}
      </div>
    );
  }
  return (
    <div className="mp-hole" style={style} aria-hidden="true">
      <span className="card card-back mp-back" />
      <span className="card card-back mp-back" />
    </div>
  );
}

const SEAT_COLORS = ['#7c5cff', '#e5484d', '#1f9d5a', '#f59e0b', '#3b82f6', '#ec4899', '#14b8a6', '#a855f7', '#f97316'];

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}

const TABLE_WIDTH = 1000;
const TABLE_HEIGHT = 640;

export default function MultiplayerTable({
  gameState,
  myIndex,
  onSit,
}: {
  gameState: GameState;
  myIndex: number;
  onSit?: (seat: number) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const update = () => setScale(Math.max(0.78, node.clientWidth / TABLE_WIDTH));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const hand = gameState.hand;
  const seatCount = Math.max(gameState.players.length, gameState.maxSeats || 0, 2);
  const anchor = myIndex >= 0 ? myIndex : 0;
  const names = gameState.players.map((player, index) => (player ? getDisplayName(gameState, index) : ''));
  const actions = streetActions(gameState.actionLog, names);
  const smallBlind = gameState.settings.bigBlind / 2;
  const myTurn = !!hand && !hand.handOver && myIndex >= 0 && hand.currentPlayerIndex === myIndex && !gameState.paused;

  return (
    <div className="mp-layout">
      <div className="mp-meta">
        <span>BLIND {smallBlind}/{gameState.settings.bigBlind}</span>
        {myTurn && <span className="mp-your-turn">YOUR TURN</span>}
      </div>
      <div className="mp-frame" ref={frame} style={{ height: TABLE_HEIGHT * scale }}>
        <div className="mp-sizer" style={{ width: TABLE_WIDTH * scale, height: TABLE_HEIGHT * scale }}>
        <div className="mp-table" style={{ transform: `scale(${scale})` }} aria-label="Poker table">
          <div className="mp-rail" />
          <div className="mp-felt" />

          <div className="mp-center">
            {hand && <div className="mp-pot"><span className="mp-pot-label">POT</span>{hand.pot.toLocaleString()}</div>}
            {hand && <div className="mp-street">{hand.round}</div>}
            {hand && hand.communityCards.length > 0 && (
              <div className="mp-community">
                {hand.communityCards.map((card, i) => <CardDisplay key={i} card={card} />)}
              </div>
            )}
            {!hand && !gameState.paused && (
              <div className="mp-status">
                {gameState.isHost ? 'Press Start game when at least 2 players are seated' : 'Waiting for the host to start the game'}
              </div>
            )}
            {gameState.paused && <div className="mp-status">Paused</div>}
            {!gameState.paused && hand && !hand.handOver && hand.currentPlayerIndex !== myIndex && (
              <div className="mp-status">
                {getDisplayName(gameState, hand.currentPlayerIndex)} to act
              </div>
            )}
            {hand?.handOver && hand.resultMessage && (
              <div className="mp-result">{hand.resultMessage}</div>
            )}
          </div>

          {Array.from({ length: seatCount }, (_, index) => {
            const player = gameState.players[index] ?? null;
            const visual = (index - anchor + seatCount) % seatCount;
            const spot = seatPoint(visual, seatCount, 42, 40);
            const cardSpot = seatPoint(visual, seatCount, 29, 23);
            const betSpot = seatPoint(visual, seatCount, 18, 15);
            const isMe = index === myIndex;
            const folded = !!player && !!hand?.playerFolded[index];
            const allIn = !!player && !!hand?.playerAllIn[index];
            const acting = !!hand && !hand.handOver && hand.currentPlayerIndex === index;
            const bet = hand?.playerBets[index] ?? 0;
            const action = actions.get(index);
            const showFaces = isMe || !!hand?.showdown;
            const inHand = !!hand && !!player && !player.sittingOut;
            const myRequest = gameState.seatRequest?.seat === index ? gameState.seatRequest : null;
            const otherRequest = gameState.seatRequests?.find(r => r.seat === index);
            const canSit = !player && myIndex < 0 && !gameState.seatRequest && !otherRequest && !!onSit;
            const emptyLabel = myRequest
              ? myRequest.approved ? 'Approved · next hand' : 'Waiting for host'
              : otherRequest ? `${otherRequest.name} wants to sit`
              : canSit ? 'Sit here' : 'Empty';
            const plate = (
              <>
                {player?.isDealer && <span className="mp-dealer" title="Dealer">D</span>}
                {player && (
                  <span className="mp-avatar" style={{ background: SEAT_COLORS[index % SEAT_COLORS.length] }} aria-hidden="true">
                    {initials(names[index])}
                  </span>
                )}
                <div className="mp-plate-text">
                  <div className="mp-name">
                    {player ? `${names[index]}${isMe ? ' (You)' : ''}` : emptyLabel}
                  </div>
                  {player && <div className="mp-stack">{player.stack.toLocaleString()}</div>}
                </div>
                <div className="mp-tags">
                  {player?.isSB && <span className="mp-tag sb">SB</span>}
                  {player?.isBB && <span className="mp-tag bb">BB</span>}
                  {folded && <span className="mp-tag fold">FOLD</span>}
                  {allIn && <span className="mp-tag allin">ALL IN</span>}
                  {player?.sittingOut && <span className="mp-tag out">OUT</span>}
                  {player && !player.connected && <span className="mp-tag off">AWAY</span>}
                </div>
              </>
            );

            return (
              <div key={index}>
                {player && inHand && !folded && bet > 0 && (
                  <div className="mp-chip" style={{ left: `${betSpot.left}%`, top: `${betSpot.top}%` }}>
                    <span className="mp-chip-icon" aria-hidden="true" />
                    {bet.toLocaleString()}
                  </div>
                )}
                {player && inHand && !folded && bet === 0 && action === 'check' && (
                  <div className="mp-chip check" style={{ left: `${betSpot.left}%`, top: `${betSpot.top}%` }}>
                    check
                  </div>
                )}
                {player && inHand && !folded && (
                  <HoleCards
                    faceUp={showFaces}
                    cards={player.holeCards}
                    mine={isMe}
                    style={{ left: `${cardSpot.left}%`, top: `${cardSpot.top}%` }}
                  />
                )}
                <div
                  className={`mp-seat${player ? '' : ' empty'}${canSit ? ' open' : ''}${myRequest || otherRequest ? ' requested' : ''}${isMe ? ' me' : ''}${folded ? ' folded' : ''}${acting ? ' acting' : ''}${player && !player.connected ? ' offline' : ''}`}
                  style={{ left: `${spot.left}%`, top: `${spot.top}%` }}
                >
                  {canSit ? (
                    <button type="button" className="mp-plate mp-sit" aria-label={`Sit in seat ${index + 1}`} onClick={() => onSit!(index)}>
                      {plate}
                    </button>
                  ) : (
                    <div className="mp-plate">{plate}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        </div>
      </div>
    </div>
  );
}

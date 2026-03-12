import { GameState, PlayerInfo } from '../types';
import { CardDisplay, CardBack } from './Card';
import ActionPanel from './ActionPanel';
import ActionLog from './ActionLog';

interface GameProps {
  gameState: GameState;
  myIndex: number;
  onAction: (type: string, amount?: number) => void;
  onResetMatch: () => void;
  onNextHand: () => void;
  onRebuy: () => void;
  onLeave: () => void;
  avatarFiles: { L: string[]; G: string[] };
}

function getAvatarUrl(
  playerIndex: number,
  gameState: GameState,
  avatarFiles: { L: string[]; G: string[] }
): string | null {
  if (!gameState.avatarMode) return null;
  const role = gameState.avatarAssignment[playerIndex];
  if (!role) return null;

  const folder = role === 'L' ? 'liana_avatars' : 'gabe_avatars';
  const files = role === 'L' ? avatarFiles.L : avatarFiles.G;
  if (files.length === 0) return null;

  const idx = (gameState.handNumber - 1) % files.length;
  return `/${folder}/${files[idx < 0 ? 0 : idx]}`;
}

function PlayerArea({
  player,
  index,
  isMe,
  hand,
  gameState,
  avatarFiles,
}: {
  player: PlayerInfo;
  index: number;
  isMe: boolean;
  hand: GameState['hand'];
  gameState: GameState;
  avatarFiles: { L: string[]; G: string[] };
}) {
  const avatar = getAvatarUrl(index, gameState, avatarFiles);
  const isFolded = hand?.playerFolded[index];
  const isCurrentTurn = hand && !hand.handOver && hand.currentPlayerIndex === index;

  return (
    <div className={`player-area ${isMe ? 'my-area' : 'opponent-area'} ${isFolded ? 'folded' : ''} ${isCurrentTurn ? 'active-turn' : ''}`}>
      <div className="player-info">
        {avatar && <img className="avatar" src={avatar} alt="avatar" />}
        <span className="player-name">{player.name}{isMe ? ' (You)' : ''}</span>
        {!player.connected && <span className="disconnected-tag">DISCONNECTED</span>}
        {hand && player.isDealer && <span className="marker dealer-marker">D</span>}
        {hand && player.isSB && <span className="marker sb-marker">SB</span>}
        {hand && player.isBB && <span className="marker bb-marker">BB</span>}
        <span className="stack">Chips: {player.stack}</span>
        {hand && hand.playerAllIn[index] && <span className="all-in-badge">ALL IN</span>}
        {isFolded && <span className="folded-badge">FOLDED</span>}
      </div>
      {hand && hand.playerBets[index] > 0 && (
        <div className="bet-badge">Bet: {hand.playerBets[index]}</div>
      )}
      <div className="cards">
        {player.holeCards ? (
          player.holeCards.map((card, i) => <CardDisplay key={i} card={card} />)
        ) : (
          hand && !hand.handOver && !isFolded ? (
            <><CardBack /><CardBack /></>
          ) : null
        )}
      </div>
    </div>
  );
}

export default function Game({ gameState, myIndex, onAction, onResetMatch, onNextHand, onRebuy, onLeave, avatarFiles }: GameProps) {
  const me = gameState.players[myIndex];
  const hand = gameState.hand;
  const isMyTurn = hand && !hand.handOver && hand.currentPlayerIndex === myIndex;

  // Separate opponents from me
  const opponents = gameState.players
    .map((p, i) => ({ player: p, index: i }))
    .filter(({ index }) => index !== myIndex && gameState.players[index] !== null);

  const isBusted = me && me.stack <= 0 && hand?.handOver;

  return (
    <div className="game">
      {/* Opponents (top) */}
      <div className="opponents-row">
        {opponents.map(({ player, index }) => (
          player && (
            <PlayerArea
              key={index}
              player={player}
              index={index}
              isMe={false}
              hand={hand}
              gameState={gameState}
              avatarFiles={avatarFiles}
            />
          )
        ))}
      </div>

      {/* Board area (center) */}
      <div className="board-area">
        {hand && (
          <>
            <div className="pot">Pot: {hand.pot}</div>
            <div className="round-label">{hand.round.toUpperCase()}</div>
            <div className="community-cards">
              {hand.communityCards.map((card, i) => (
                <CardDisplay key={i} card={card} />
              ))}
            </div>
          </>
        )}

        {hand?.handOver && hand.resultMessage && (
          <div className="result-message">{hand.resultMessage}</div>
        )}

        {hand?.handOver && !gameState.matchOver && (
          <button className="btn btn-next-hand" onClick={onNextHand}>Next Round</button>
        )}

        {!hand?.handOver && (
          <div className="turn-indicator">
            {isMyTurn ? 'Your turn' : `Waiting for ${gameState.players[hand?.currentPlayerIndex ?? 0]?.name}...`}
          </div>
        )}

        {gameState.matchOver && (
          <div className="match-over">
            <h2>Match Over!</h2>
            <p>{me && me.stack > 0 ? 'You win!' : 'You lose!'}</p>
            <button className="btn btn-reset" onClick={onResetMatch}>Play Again</button>
          </div>
        )}

        {/* Rebuy/Leave for busted players in unlimited mode */}
        {gameState.mode === 'unlimited' && isBusted && (
          <div className="busted-actions">
            <p>You're out of chips!</p>
            <button className="btn btn-rebuy" onClick={onRebuy}>Rebuy</button>
            <button className="btn btn-leave" onClick={onLeave}>Leave Table</button>
          </div>
        )}
      </div>

      {/* My area (bottom) */}
      {me && (
        <div className="my-area-container">
          <PlayerArea
            player={me}
            index={myIndex}
            isMe={true}
            hand={hand}
            gameState={gameState}
            avatarFiles={avatarFiles}
          />

          {isMyTurn && gameState.legalActions && (
            <ActionPanel legalActions={gameState.legalActions} onAction={onAction} pot={hand?.pot ?? 0} />
          )}
        </div>
      )}

      <ActionLog log={gameState.actionLog} />
    </div>
  );
}

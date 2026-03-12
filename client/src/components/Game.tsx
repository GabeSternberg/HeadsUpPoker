import { GameState } from '../types';
import { CardDisplay, CardBack } from './Card';
import ActionPanel from './ActionPanel';
import ActionLog from './ActionLog';

interface GameProps {
  gameState: GameState;
  myIndex: number;
  onAction: (type: string, amount?: number) => void;
  onResetMatch: () => void;
  onNextHand: () => void;
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

  // Cycle through avatars based on hand number (1-indexed, so subtract 1)
  const idx = (gameState.handNumber - 1) % files.length;
  return `/${folder}/${files[idx < 0 ? 0 : idx]}`;
}

export default function Game({ gameState, myIndex, onAction, onResetMatch, onNextHand, avatarFiles }: GameProps) {
  const opponentIndex = 1 - myIndex;
  const me = gameState.players[myIndex];
  const opponent = gameState.players[opponentIndex];
  const hand = gameState.hand;

  const isMyTurn = hand && !hand.handOver && hand.currentPlayerIndex === myIndex;

  const opponentAvatar = getAvatarUrl(opponentIndex, gameState, avatarFiles);
  const myAvatar = getAvatarUrl(myIndex, gameState, avatarFiles);

  return (
    <div className="game">
      {/* Opponent area (top) */}
      <div className="player-area opponent-area">
        <div className="player-info">
          {opponentAvatar && <img className="avatar" src={opponentAvatar} alt="avatar" />}
          <span className="player-name">{opponent?.name}</span>
          {opponent && !opponent.connected && <span className="disconnected-tag">DISCONNECTED</span>}
          {hand && gameState.players[opponentIndex]?.isDealer && <span className="marker dealer-marker">D/SB</span>}
          {hand && gameState.players[opponentIndex]?.isBB && <span className="marker bb-marker">BB</span>}
          <span className="stack">Chips: {opponent?.stack}</span>
          {hand && hand.playerAllIn[opponentIndex] && <span className="all-in-badge">ALL IN</span>}
        </div>
        {hand && hand.playerBets[opponentIndex] > 0 && (
          <div className="bet-badge">Bet: {hand.playerBets[opponentIndex]}</div>
        )}
        <div className="cards">
          {opponent?.holeCards ? (
            opponent.holeCards.map((card, i) => <CardDisplay key={i} card={card} />)
          ) : (
            hand && !hand.handOver ? (
              <><CardBack /><CardBack /></>
            ) : null
          )}
        </div>
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
            {isMyTurn ? 'Your turn' : `Waiting for ${opponent?.name}...`}
          </div>
        )}

        {gameState.matchOver && (
          <div className="match-over">
            <h2>Match Over!</h2>
            <p>{me && me.stack > 0 ? 'You win!' : 'You lose!'}</p>
            <button className="btn btn-reset" onClick={onResetMatch}>Play Again</button>
          </div>
        )}
      </div>

      {/* My area (bottom) */}
      <div className="player-area my-area">
        <div className="player-info">
          {myAvatar && <img className="avatar" src={myAvatar} alt="avatar" />}
          <span className="player-name">{me?.name} (You)</span>
          {hand && gameState.players[myIndex]?.isDealer && <span className="marker dealer-marker">D/SB</span>}
          {hand && gameState.players[myIndex]?.isBB && <span className="marker bb-marker">BB</span>}
          <span className="stack">Chips: {me?.stack}</span>
          {hand && hand.playerAllIn[myIndex] && <span className="all-in-badge">ALL IN</span>}
        </div>
        {hand && hand.playerBets[myIndex] > 0 && (
          <div className="bet-badge">Bet: {hand.playerBets[myIndex]}</div>
        )}
        <div className="cards">
          {me?.holeCards?.map((card, i) => (
            <CardDisplay key={i} card={card} />
          ))}
        </div>

        {/* Actions */}
        {isMyTurn && gameState.legalActions && (
          <ActionPanel legalActions={gameState.legalActions} onAction={onAction} pot={hand?.pot ?? 0} />
        )}
      </div>

      <ActionLog log={gameState.actionLog} />
    </div>
  );
}

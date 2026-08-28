import { useState } from 'react';
import { GameState, PlayerInfo, LastShowdownInfo, Card } from '../types';
import { getDisplayName, buildNameMap, resolveEntry } from '../displayNames';
import { CardDisplay, CardBack } from './Card';
import ActionPanel from './ActionPanel';
import ActionLog from './ActionLog';
import StatsPanel from './StatsPanel';

interface GameProps {
  gameState: GameState;
  myIndex: number;
  onAction: (type: string, amount?: number) => void;
  onResetMatch: () => void;
  onNextHand: () => void;
  onRebuy: () => void;
  onLeave: () => void;
  avatarFiles: { L: string[]; G: string[] };
  uiMode: 'mobile' | 'pc';
  onSetUiMode: (mode: 'mobile' | 'pc') => void;
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
  const displayName = getDisplayName(gameState, index);
  const rawStats = gameState.stats?.[index];
  const showStats = gameState.avatarMode && rawStats && rawStats.handsPlayed >= 0;

  return (
    <div className={`player-area ${isMe ? 'my-area' : 'opponent-area'} ${isFolded ? 'folded' : ''} ${isCurrentTurn ? 'active-turn' : ''}`}>
      <div className="player-info">
        {avatar && (
          <div className="avatar-wrapper">
            <img className="avatar" src={avatar} alt="avatar" />
            {showStats && (
              <div className="stats-trigger">
                <button className="stats-btn" title="Stats">📊</button>
                <StatsPanel raw={rawStats!} displayName={displayName} />
              </div>
            )}
          </div>
        )}
        {!avatar && showStats && (
          <div className="stats-trigger">
            <button className="stats-btn" title="Stats">📊</button>
            <StatsPanel raw={rawStats!} displayName={displayName} />
          </div>
        )}
        <span className="player-name">{displayName}{isMe ? ' (You)' : ''}</span>
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
      {(isMe || hand?.showdown) && (
        <div className="cards">
          {player.holeCards ? (
            player.holeCards.map((card, i) => <CardDisplay key={i} card={card} />)
          ) : null}
        </div>
      )}
    </div>
  );
}

function LastFoldedPreview({ data, gameState }: { data: { actionLog: string[]; myHoleCards: Card[] }; gameState: GameState }) {
  const nameMap = buildNameMap(gameState);
  return (
    <div className="last-hand-popup">
      <div className="last-hand-title">Last Hand</div>
      {data.myHoleCards.length > 0 && (
        <div className="last-hand-my-cards">
          <span className="last-hand-label">Your hand:</span>
          <div className="last-hand-cards">
            {data.myHoleCards.map((card, i) => <CardDisplay key={i} card={card} />)}
          </div>
        </div>
      )}
      <div className="last-fold-log">
        {data.actionLog.map((entry, i) => (
          <div key={i} className={`log-entry ${entry.startsWith('---') ? 'log-round' : ''}`}>
            {resolveEntry(entry, nameMap)}
          </div>
        ))}
      </div>
    </div>
  );
}

function LastHandPreview({ data, gameState }: { data: LastShowdownInfo; gameState: GameState }) {
  const seatName = (seat: number, fallback: string) => getDisplayName(gameState, seat, fallback);
  const nameMap = buildNameMap(gameState);
  return (
    <div className="last-hand-popup">
      <div className="last-hand-title">Last Showdown</div>
      <div className="last-hand-community">
        {data.communityCards.map((card, i) => (
          <CardDisplay key={i} card={card} />
        ))}
      </div>
      <div className="last-hand-players">
        {data.playerHands.map((ph) => (
          <div key={ph.seat} className="last-hand-player">
            <span className="last-hand-name">{seatName(ph.seat, ph.name)}</span>
            <div className="last-hand-cards">
              {ph.holeCards.map((card, i) => (
                <CardDisplay key={i} card={card} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="last-hand-result">{resolveEntry(data.resultMessage, nameMap)}</div>
    </div>
  );
}

export default function Game({ gameState, myIndex, onAction, onResetMatch, onNextHand, onRebuy, onLeave, avatarFiles, uiMode, onSetUiMode }: GameProps) {
  const me = gameState.players[myIndex];
  const hand = gameState.hand;
  const isMyTurn = hand && !hand.handOver && hand.currentPlayerIndex === myIndex;

  // Separate opponents from me
  const opponents = gameState.players
    .map((p, i) => ({ player: p, index: i }))
    .filter(({ index }) => index !== myIndex && gameState.players[index] !== null);

  const isBusted = me && me.stack <= 0 && hand?.handOver;

  return (
    <div className={`game${uiMode === 'mobile' ? ' mobile-ui' : ''}`}>
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

      {/* Board + last hand area */}
      <div className="board-row">
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
              {isMyTurn
                ? 'Your turn'
                : `Waiting for ${getDisplayName(gameState, hand?.currentPlayerIndex ?? 0)}...`}
            </div>
          )}

          {gameState.matchOver && (
            <div className="match-over">
              <h2>Match Over!</h2>
              <p>{me && me.stack > 0 ? 'You win!' : 'You lose!'}</p>
              <button className="btn btn-reset" onClick={onResetMatch}>Play Again</button>
            </div>
          )}

          {gameState.mode === 'unlimited' && isBusted && (
            <div className="busted-actions">
              <p>You're out of chips!</p>
              <button className="btn btn-rebuy" onClick={onRebuy}>Rebuy</button>
              <button className="btn btn-leave" onClick={onLeave}>Leave Table</button>
            </div>
          )}
        </div>

        {/* Last showdown hover button */}
        {gameState.lastShowdown && !hand?.showdown && (
          <div className="last-hand-trigger">
            <span className="last-hand-btn">Last Showdown</span>
            <LastHandPreview data={gameState.lastShowdown} gameState={gameState} />
          </div>
        )}
        {/* Last folded hand hover button */}
        {gameState.lastFoldedHand && !hand?.showdown && (
          <div className="last-hand-trigger">
            <span className="last-hand-btn">Last Hand</span>
            <LastFoldedPreview data={gameState.lastFoldedHand} gameState={gameState} />
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
            <ActionPanel
              legalActions={gameState.legalActions}
              onAction={onAction}
              pot={hand?.pot ?? 0}
              currentBet={hand?.currentBet ?? 0}
              isMobile={uiMode === 'mobile'}
            />
          )}
        </div>
      )}

      <div className="ui-mode-toggle-row">
        <button className={`btn btn-mode ${uiMode === 'mobile' ? 'active' : ''}`} onClick={() => onSetUiMode('mobile')}>Mobile</button>
        <button className={`btn btn-mode ${uiMode === 'pc' ? 'active' : ''}`} onClick={() => onSetUiMode('pc')}>PC</button>
      </div>
      <ActionLog log={gameState.actionLog} isMobile={uiMode === 'mobile'} />
    </div>
  );
}

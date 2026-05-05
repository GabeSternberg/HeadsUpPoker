import { useState, useEffect } from 'react';
import { GameState } from '../types';

interface LobbyProps {
  gameState: GameState;
  myIndex: number;
  onUpdateSettings: (settings: { startingSum?: number; bigBlind?: number }) => void;
  onToggleReady: () => void;
  onSetAvatar: (playerIndex: number, role: 'L' | 'G') => void;
  onSetMode: (mode: 'headsup' | 'unlimited' | 'virtualcards') => void;
  onKickPlayer: (targetIndex: number) => void;
  uiMode: 'mobile' | 'pc';
  onSetUiMode: (mode: 'mobile' | 'pc') => void;
}

export default function Lobby({ gameState, myIndex, onUpdateSettings, onToggleReady, onSetAvatar, onSetMode, onKickPlayer, uiMode, onSetUiMode }: LobbyProps) {
  const [startingSum, setStartingSum] = useState(gameState.settings.startingSum);
  const [bigBlind, setBigBlind] = useState(gameState.settings.bigBlind);
  const [kickTarget, setKickTarget] = useState<number | null>(null);
  const [kickPassword, setKickPassword] = useState('');

  useEffect(() => {
    setStartingSum(gameState.settings.startingSum);
    setBigBlind(gameState.settings.bigBlind);
  }, [gameState.settings.startingSum, gameState.settings.bigBlind]);

  const smallBlind = bigBlind / 2;

  const isVC = gameState.mode === 'virtualcards';
  const connectedPlayers = gameState.players.filter(p => p && p.connected);
  const minPlayers = isVC ? 1 : 2;
  const canReady = connectedPlayers.length >= minPlayers;

  const handleStartingSumChange = (val: string) => {
    const num = parseInt(val, 10);
    if (!isNaN(num) && num > 0) {
      setStartingSum(num);
      onUpdateSettings({ startingSum: num });
    } else {
      setStartingSum(num || 0);
    }
  };

  const handleBigBlindChange = (val: string) => {
    const num = parseInt(val, 10);
    if (!isNaN(num) && num > 0) {
      setBigBlind(num);
      onUpdateSettings({ bigBlind: num });
    } else {
      setBigBlind(num || 0);
    }
  };

  const handleKickClick = (i: number) => {
    setKickTarget(i);
    setKickPassword('');
  };

  const handleKickSubmit = (i: number) => {
    if (kickPassword === '123') {
      onKickPlayer(i);
    }
    setKickTarget(null);
    setKickPassword('');
  };

  const handleKickKeyDown = (e: React.KeyboardEvent, i: number) => {
    if (e.key === 'Enter') handleKickSubmit(i);
    if (e.key === 'Escape') { setKickTarget(null); setKickPassword(''); }
  };

  return (
    <div className="lobby">
      <h2>Lobby</h2>

      {/* Mode selector */}
      <div className="mode-selector">
        <span className="mode-label">Game Mode:</span>
        <button
          className={`btn btn-mode ${gameState.mode === 'headsup' ? 'active' : ''}`}
          onClick={() => onSetMode('headsup')}
        >
          2-Player
        </button>
        <button
          className={`btn btn-mode ${gameState.mode === 'unlimited' ? 'active' : ''}`}
          onClick={() => onSetMode('unlimited')}
        >
          Unlimited
        </button>
        <button
          className={`btn btn-mode ${gameState.mode === 'virtualcards' ? 'active' : ''}`}
          onClick={() => onSetMode('virtualcards')}
        >
          Virtual Cards
        </button>
      </div>

      <div className="players-list">
        {gameState.players.map((player, i) => {
          const assignment = gameState.avatarAssignment[i];
          return (
            <div key={i} className={`player-slot ${player ? 'connected' : 'empty'}`}>
              <span className="player-name">
                {player ? player.name : `Slot ${i + 1} — waiting...`}
              </span>
              {player && (
                <span className={`ready-status ${player.ready ? 'ready' : 'not-ready'}`}>
                  {player.ready ? 'READY' : 'Not Ready'}
                </span>
              )}
              {i === myIndex && <span className="you-tag">(You)</span>}
              {gameState.avatarMode && player && (
                <div className="avatar-buttons">
                  <button
                    className={`btn btn-avatar ${assignment === 'L' ? 'active' : ''}`}
                    onClick={() => onSetAvatar(i, 'L')}
                  >L</button>
                  <button
                    className={`btn btn-avatar ${assignment === 'G' ? 'active' : ''}`}
                    onClick={() => onSetAvatar(i, 'G')}
                  >G</button>
                </div>
              )}
              {player && i !== myIndex && kickTarget !== i && (
                <button className="btn-kick" onClick={() => handleKickClick(i)}>✕</button>
              )}
              {player && i !== myIndex && kickTarget === i && (
                <div className="kick-confirm">
                  <input
                    type="password"
                    placeholder="password"
                    value={kickPassword}
                    onChange={e => setKickPassword(e.target.value)}
                    onKeyDown={e => handleKickKeyDown(e, i)}
                    autoFocus
                    className="kick-password-input"
                  />
                  <button className="btn-kick-confirm" onClick={() => handleKickSubmit(i)}>Kick</button>
                  <button className="btn-kick-cancel" onClick={() => setKickTarget(null)}>Cancel</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isVC && (
        <p className="vc-lobby-desc">
          Each player will see only their own cards. Click Ready when everyone has joined.
        </p>
      )}

      {!isVC && <div className="settings">
        <h3>Game Settings</h3>
        <div className="setting-row">
          <label>Starting Chips:</label>
          <input
            type="number"
            value={startingSum}
            onChange={e => handleStartingSumChange(e.target.value)}
            min={1}
          />
          <div className="preset-buttons">
            <button className={`btn btn-preset-lobby ${startingSum === 500 ? 'active' : ''}`} onClick={() => handleStartingSumChange('500')}>500</button>
            <button className={`btn btn-preset-lobby ${startingSum === 1000 ? 'active' : ''}`} onClick={() => handleStartingSumChange('1000')}>1000</button>
          </div>
        </div>
        <div className="setting-row">
          <label>Big Blind:</label>
          <input
            type="number"
            value={bigBlind}
            onChange={e => handleBigBlindChange(e.target.value)}
            min={1}
          />
          <div className="preset-buttons">
            <button className={`btn btn-preset-lobby ${bigBlind === 10 ? 'active' : ''}`} onClick={() => handleBigBlindChange('10')}>10</button>
            <button className={`btn btn-preset-lobby ${bigBlind === 20 ? 'active' : ''}`} onClick={() => handleBigBlindChange('20')}>20</button>
          </div>
        </div>
        <div className="setting-row">
          <label>Small Blind:</label>
          <span className="computed-value">{smallBlind}</span>
        </div>
        <div className="setting-row">
          <label>UI Mode:</label>
          <div className="ui-mode-buttons">
            <button
              className={`btn btn-mode ${uiMode === 'mobile' ? 'active' : ''}`}
              onClick={() => onSetUiMode('mobile')}
            >Mobile</button>
            <button
              className={`btn btn-mode ${uiMode === 'pc' ? 'active' : ''}`}
              onClick={() => onSetUiMode('pc')}
            >PC</button>
          </div>
        </div>
      </div>}

      <button
        className={`ready-button ${gameState.players[myIndex]?.ready ? 'unready' : ''}`}
        onClick={onToggleReady}
        disabled={!canReady}
      >
        {gameState.players[myIndex]?.ready
          ? (isVC ? 'UNREADY' : 'UNREADY')
          : (isVC ? 'READY TO DEAL' : 'READY')}
      </button>

      {!canReady && (
        <p className="waiting-message">
          {isVC ? 'Join the table to deal cards...' : 'Waiting for more players to join...'}
        </p>
      )}
    </div>
  );
}

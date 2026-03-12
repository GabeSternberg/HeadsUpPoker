import { useState, useEffect } from 'react';
import { GameState } from '../types';

interface LobbyProps {
  gameState: GameState;
  myIndex: number;
  onUpdateSettings: (settings: { startingSum?: number; bigBlind?: number }) => void;
  onToggleReady: () => void;
  onSetAvatar: (playerIndex: number, role: 'L' | 'G') => void;
  onSetMode: (mode: 'headsup' | 'unlimited') => void;
}

export default function Lobby({ gameState, myIndex, onUpdateSettings, onToggleReady, onSetAvatar, onSetMode }: LobbyProps) {
  const [startingSum, setStartingSum] = useState(gameState.settings.startingSum);
  const [bigBlind, setBigBlind] = useState(gameState.settings.bigBlind);

  useEffect(() => {
    setStartingSum(gameState.settings.startingSum);
    setBigBlind(gameState.settings.bigBlind);
  }, [gameState.settings.startingSum, gameState.settings.bigBlind]);

  const smallBlind = bigBlind / 2;

  const connectedPlayers = gameState.players.filter(p => p && p.connected);
  const minPlayers = 2;
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
            </div>
          );
        })}
      </div>

      <div className="settings">
        <h3>Game Settings</h3>
        <div className="setting-row">
          <label>Starting Chips:</label>
          <input
            type="number"
            value={startingSum}
            onChange={e => handleStartingSumChange(e.target.value)}
            min={1}
          />
        </div>
        <div className="setting-row">
          <label>Big Blind:</label>
          <input
            type="number"
            value={bigBlind}
            onChange={e => handleBigBlindChange(e.target.value)}
            min={1}
          />
        </div>
        <div className="setting-row">
          <label>Small Blind:</label>
          <span className="computed-value">{smallBlind}</span>
        </div>
      </div>

      <button
        className={`ready-button ${gameState.players[myIndex]?.ready ? 'unready' : ''}`}
        onClick={onToggleReady}
        disabled={!canReady}
      >
        {gameState.players[myIndex]?.ready ? 'UNREADY' : 'READY'}
      </button>

      {!canReady && (
        <p className="waiting-message">Waiting for more players to join...</p>
      )}
    </div>
  );
}

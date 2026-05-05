import { useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { GameState } from './types';
import Lobby from './components/Lobby';
import Game from './components/Game';
import VirtualCards from './components/VirtualCards';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [myIndex, setMyIndex] = useState<number>(-1);
  const [error, setError] = useState<string | null>(null);

  // Per-client UI mode (not shared with server)
  const [uiMode, setUiModeState] = useState<'mobile' | 'pc'>(() =>
    (localStorage.getItem('uiMode') as 'mobile' | 'pc') || 'mobile'
  );
  const handleSetUiMode = useCallback((mode: 'mobile' | 'pc') => {
    localStorage.setItem('uiMode', mode);
    setUiModeState(mode);
  }, []);

  // Secret code state
  const [showCodeInput, setShowCodeInput] = useState(false);
  const [secretCode, setSecretCode] = useState('');

  // Avatar file lists (fetched once when avatar mode activates)
  const [avatarFiles, setAvatarFiles] = useState<{ L: string[]; G: string[] }>({ L: [], G: [] });

  useEffect(() => {
    const s = io(SERVER_URL);
    setSocket(s);

    s.on('assignPlayer', (data: { index: number; name: string }) => {
      setMyIndex(data.index);
    });

    s.on('gameState', (state: GameState) => {
      setGameState(state);
    });

    s.on('error', (data: { message: string }) => {
      setError(data.message);
    });

    s.on('actionError', (data: { message: string }) => {
      setError(data.message);
      setTimeout(() => setError(null), 3000);
    });

    return () => {
      s.disconnect();
    };
  }, []);

  // Fetch avatar file lists when avatar mode activates
  useEffect(() => {
    if (gameState?.avatarMode && avatarFiles.L.length === 0 && avatarFiles.G.length === 0) {
      Promise.all([
        fetch('/liana_avatars/manifest.json').then(r => r.json()),
        fetch('/gabe_avatars/manifest.json').then(r => r.json()),
      ]).then(([liana, gabe]) => {
        setAvatarFiles({ L: liana.files || [], G: gabe.files || [] });
      }).catch(() => {});
    }
  }, [gameState?.avatarMode]);

  const handleAction = useCallback((type: string, amount?: number) => {
    if (!socket) return;
    socket.emit('action', { type, amount });
  }, [socket]);

  const handleUpdateSettings = useCallback((settings: { startingSum?: number; bigBlind?: number }) => {
    if (!socket) return;
    socket.emit('updateSettings', settings);
  }, [socket]);

  const handleToggleReady = useCallback(() => {
    if (!socket) return;
    socket.emit('toggleReady');
  }, [socket]);

  const handleResetMatch = useCallback(() => {
    if (!socket) return;
    socket.emit('resetMatch');
  }, [socket]);

  const handleNextHand = useCallback(() => {
    if (!socket) return;
    socket.emit('nextHand');
  }, [socket]);

  const handleKickPlayer = useCallback((targetIndex: number) => {
    if (!socket) return;
    socket.emit('kickPlayer', { targetIndex });
  }, [socket]);

  const handleSetMode = useCallback((mode: 'headsup' | 'unlimited' | 'virtualcards') => {
    if (!socket) return;
    socket.emit('setMode', { mode });
  }, [socket]);

  const handleJoinTable = useCallback(() => {
    if (!socket) return;
    socket.emit('joinTable');
  }, [socket]);

  const handleVCNextPhase = useCallback(() => {
    if (!socket) return;
    socket.emit('vcNextPhase');
  }, [socket]);

  const handleVCNextHand = useCallback(() => {
    if (!socket) return;
    socket.emit('vcNextHand');
  }, [socket]);

  const handleRebuy = useCallback(() => {
    if (!socket) return;
    socket.emit('rebuy');
  }, [socket]);

  const handleLeave = useCallback(() => {
    if (!socket) return;
    socket.emit('leaveTable');
  }, [socket]);

  const handleSecretClick = () => {
    setShowCodeInput(true);
    setSecretCode('');
  };

  const handleCodeSubmit = () => {
    if (secretCode === '123' && socket) {
      socket.emit('activateAvatarMode');
      setShowCodeInput(false);
      setSecretCode('');
    } else {
      setShowCodeInput(false);
      setSecretCode('');
    }
  };

  const handleCodeKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleCodeSubmit();
    if (e.key === 'Escape') { setShowCodeInput(false); setSecretCode(''); }
  };

  const handleSetAvatar = useCallback((playerIndex: number, role: 'L' | 'G') => {
    if (!socket) return;
    socket.emit('setAvatarAssignment', { playerIndex, role });
  }, [socket]);

  if (error && !gameState) {
    return <div className="app"><div className="error">{error}</div></div>;
  }

  if (!gameState) {
    return <div className="app"><div className="loading">Connecting to server...</div></div>;
  }

  const isVC = gameState.mode === 'virtualcards';
  const title = isVC ? 'Virtual Cards' : gameState.mode === 'unlimited' ? 'Poker' : 'Heads-Up Poker';

  // VC pending: player connected but hasn't clicked "Join Table" yet
  if (isVC && gameState.isPending) {
    return (
      <div className="app">
        <h1>{title}</h1>
        {error && <div className="error">{error}</div>}
        <div className="vc-join-screen">
          <div className="vc-join-card">
            <h2>Virtual Card Table</h2>
            <p className="vc-join-desc">
              No physical deck needed — everyone sees their own cards on their device.
            </p>
            {gameState.players.some(p => p) && (
              <div className="vc-join-players">
                <span className="vc-join-label">Already at the table:</span>
                {gameState.players.filter(p => p).map((p, i) => (
                  <span key={i} className="vc-join-player-tag">{p!.name}</span>
                ))}
              </div>
            )}
            <button className="btn vc-btn-join" onClick={handleJoinTable}>
              Join Table
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <h1>{title}</h1>
      {error && <div className="error">{error}</div>}

      {/* VC mode: show table when cards are dealt, lobby otherwise */}
      {isVC && gameState.vcState ? (
        <VirtualCards
          gameState={gameState}
          myIndex={myIndex}
          onNextPhase={handleVCNextPhase}
          onNextHand={handleVCNextHand}
        />
      ) : isVC ? (
        /* VC lobby — seated but waiting to deal */
        <Lobby
          gameState={gameState}
          myIndex={myIndex}
          onUpdateSettings={handleUpdateSettings}
          onToggleReady={handleToggleReady}
          onSetAvatar={handleSetAvatar}
          onSetMode={handleSetMode}
          onKickPlayer={handleKickPlayer}
          uiMode={uiMode}
          onSetUiMode={handleSetUiMode}
        />
      ) : !gameState.gameStarted ? (
        <>
          <Lobby
            gameState={gameState}
            myIndex={myIndex}
            onUpdateSettings={handleUpdateSettings}
            onToggleReady={handleToggleReady}
            onSetAvatar={handleSetAvatar}
            onSetMode={handleSetMode}
            onKickPlayer={handleKickPlayer}
            uiMode={uiMode}
            onSetUiMode={handleSetUiMode}
          />
          <div className="secret-area">
            {!showCodeInput && !gameState.avatarMode && (
              <button className="btn btn-secret" onClick={handleSecretClick}>Secret</button>
            )}
            {showCodeInput && (
              <div className="secret-code-input">
                <span>Enter code:</span>
                <input
                  type="text"
                  value={secretCode}
                  onChange={e => setSecretCode(e.target.value)}
                  onKeyDown={handleCodeKeyDown}
                  autoFocus
                />
              </div>
            )}
            {gameState.avatarMode && (
              <span className="avatar-mode-badge">Avatar Mode Active</span>
            )}
          </div>
        </>
      ) : (
        <Game
          gameState={gameState}
          myIndex={myIndex}
          onAction={handleAction}
          onResetMatch={handleResetMatch}
          onNextHand={handleNextHand}
          onRebuy={handleRebuy}
          onLeave={handleLeave}
          avatarFiles={avatarFiles}
          uiMode={uiMode}
          onSetUiMode={handleSetUiMode}
        />
      )}
    </div>
  );
}

export default App;

import { useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { GameState, TableSummary } from './types';
import { TableDirectory, TableControls } from './components/Tables';
import Lobby from './components/Lobby';
import Game from './components/Game';
import VirtualCards from './components/VirtualCards';


const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [myIndex, setMyIndex] = useState<number>(-1);
  const [error, setError] = useState<string | null>(null);

  const [tables, setTables] = useState<TableSummary[]>([]);
  const [connected, setConnected] = useState(false);

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
    const s = io(SERVER_URL, {
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1500,
    });
    setSocket(s);
    s.on('connect', () => {
      setConnected(true);
      const saved = sessionStorage.getItem('pokerSession');
      if (saved) { try { s.emit('resumeTable', JSON.parse(saved)); } catch { sessionStorage.removeItem('pokerSession'); } }
    });
    s.on('disconnect', reason => { setConnected(false); if (reason === 'io server disconnect') { sessionStorage.removeItem('pokerSession'); setGameState(null); setMyIndex(-1); s.connect(); } });
    s.on('tables', setTables);
    s.on('tableSession', data => sessionStorage.setItem('pokerSession', JSON.stringify(data)));
    const clearSession = () => { sessionStorage.removeItem('pokerSession'); setGameState(null); setMyIndex(-1); };
    s.on('tableLeft', () => { clearSession(); setError(null); });
    s.on('sessionExpired', () => { clearSession(); setError('Your previous game expired. Create or join a game.'); });

    s.on('assignPlayer', (data: { index: number; name: string }) => {
      setMyIndex(data.index);
      setError(null);
    });

    s.on('gameState', (state: GameState) => {
      setGameState(state);
      setError(null);
      setMyIndex(state.myIndex);
    });

    s.on('error', (data: { message: string }) => {
      setError(data.message);
    });

    s.on('kicked', (data: { message: string }) => {
      sessionStorage.removeItem('pokerSession');
      setError(data.message);
      setGameState(null);
      setMyIndex(-1);
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

  const handleTogglePause = useCallback(() => {
    if (!socket) return;
    socket.emit('togglePause');
  }, [socket]);

  if (!gameState) {
    return <div className="app"><h1>Poker tables</h1>{error && <div className="error">{error}</div>}
      <TableDirectory socket={socket} tables={tables} connected={connected} /></div>;
  }
  const isVC = gameState.mode === 'virtualcards';
  const title = isVC ? 'Virtual Cards' : gameState.mode === 'unlimited' ? 'Multi-handed Poker' : 'Heads-Up Poker';


  return (
    <div className="app">
      <h1>{title}</h1>
      {!connected && <div className="error">Disconnected — reconnecting to your seat…</div>}
      <TableControls socket={socket} state={gameState} />
      {error && <div className="error">{error}</div>}

      {/* VC mode: show table when cards are dealt, lobby otherwise */}
      {myIndex < 0 && !gameState.gameStarted ? <p>Watching this table. Request a seat to join the game.</p> : isVC && gameState.vcState ? (
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
          onTogglePause={handleTogglePause}
          avatarFiles={avatarFiles}
          uiMode={uiMode}
          onSetUiMode={handleSetUiMode}
        />
      )}
    </div>
  );
}

export default App;

import { useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { GameState, TableSummary } from './types';
import { TableDirectory, TableControls } from './components/Tables';
import Lobby from './components/Lobby';
import Game from './components/Game';
import VirtualCards from './components/VirtualCards';
import HeadsUpControls from './components/HeadsUpControls';


const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

function PokerSession({ classic }: { classic: boolean }) {
  const sessionKey = classic ? 'pokerDefaultSession' : 'pokerSession';
  const [socket, setSocket] = useState<Socket | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [myIndex, setMyIndex] = useState<number>(-1);
  const [error, setError] = useState<string | null>(null);
  const [resetRequest, setResetRequest] = useState(0);

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
      const saved = sessionStorage.getItem(sessionKey);
      if (saved) { try { s.emit('resumeTable', JSON.parse(saved)); } catch { sessionStorage.removeItem(sessionKey); if (classic) s.emit('joinDefault'); } }
      else if (classic) s.emit('joinDefault');
    });
    s.on('disconnect', reason => { setConnected(false); if (reason === 'io server disconnect') { sessionStorage.removeItem(sessionKey); setGameState(null); setMyIndex(-1); s.connect(); } });
    s.on('tables', setTables);
    s.on('tableSession', data => sessionStorage.setItem(sessionKey, JSON.stringify(data)));
    const clearSession = () => { sessionStorage.removeItem(sessionKey); setGameState(null); setMyIndex(-1); };
    s.on('tableLeft', data => { if (data?.ledger) sessionStorage.setItem('lastPokerLedger', JSON.stringify(data)); clearSession(); setError(null); });
    s.on('sessionExpired', () => { clearSession(); if (classic) s.emit('joinDefault'); else setError('Your previous game expired. Create or join a game.'); });

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

    s.on('kicked', (data: { message: string; ledger?: GameState['ledger']; tableCode?: string }) => {
      if (data.ledger) sessionStorage.setItem('lastPokerLedger', JSON.stringify({ ledger: data.ledger, tableCode: data.tableCode }));
      sessionStorage.removeItem(sessionKey);
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
    if (classic) {
      setResetRequest(value => value + 1);
    } else socket.emit('resetMatch');
  }, [socket]);

  const handleNextHand = useCallback(() => {
    if (!socket) return;
    socket.emit('nextHand');
  }, [socket]);

  const handleKickPlayer = useCallback((targetIndex: number, password: string) => {
    if (!socket) return;
    socket.emit('kickPlayer', { targetIndex, password });
  }, [socket]);

  const handleStartGame = useCallback(() => {
    if (!socket) return;
    socket.emit('startGame');
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
    return <div className="app"><h1>{classic ? 'Heads-Up Poker' : 'Poker tables'}</h1>{error && <div className="error">{error}</div>}
      {classic ? <p>Connecting to the heads-up table…</p> : <TableDirectory socket={socket} tables={tables} connected={connected} />}</div>;
  }
  const isVC = gameState.mode === 'virtualcards';
  const multiplayer = gameState.mode === 'unlimited';
  const title = isVC ? 'Virtual Cards' : multiplayer ? 'Multi-handed Poker' : 'Heads-Up Poker';


  return (
    <div className="app">
      <h1>{title}</h1>
      {!connected && <div className="error">Disconnected — reconnecting to your seat…</div>}
      {classic ? <HeadsUpControls socket={socket} state={gameState} resetRequest={resetRequest} /> : <TableControls socket={socket} state={gameState} />}
      {error && <div className="error">{error}</div>}

      {/* VC mode: show table when cards are dealt, lobby otherwise */}
      {classic && myIndex < 0 ? null : myIndex < 0 && !gameState.gameStarted && !multiplayer ? <p>Watching this table. Request a seat to join the game.</p> : isVC && gameState.vcState ? (
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
      ) : !gameState.gameStarted && !multiplayer ? (
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
          onStartGame={handleStartGame}
          avatarFiles={avatarFiles}
          uiMode={uiMode}
          onSetUiMode={handleSetUiMode}
        />
      )}
    </div>
  );
}

function App() {
  const invited = new URLSearchParams(location.search).has('table');
  const [tab, setTab] = useState<'headsup' | 'multiplayer'>(invited ? 'multiplayer' : 'headsup');
  const [visited, setVisited] = useState({ headsup: !invited, multiplayer: invited });
  const switchTab = (next: 'headsup' | 'multiplayer') => { setTab(next); setVisited(previous => ({ ...previous, [next]: true })); };
  return <>
    <nav className="app-tabs" aria-label="Game tabs">
      <button className={`btn ${tab === 'headsup' ? 'active' : ''}`} aria-pressed={tab === 'headsup'} onClick={() => switchTab('headsup')}>Heads-up</button>
      <button className={`btn ${tab === 'multiplayer' ? 'active' : ''}`} aria-pressed={tab === 'multiplayer'} onClick={() => switchTab('multiplayer')}>Multiplayer</button>
    </nav>
    <div hidden={tab !== 'headsup'}>{visited.headsup && <PokerSession classic />}</div>
    <div hidden={tab !== 'multiplayer'}>{visited.multiplayer && <PokerSession classic={false} />}</div>
  </>;
}

export default App;

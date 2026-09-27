import { useState } from 'react';
import { Socket } from 'socket.io-client';
import { GameState, TableSummary } from '../types';

const label = (mode: GameState['mode']) => mode === 'headsup' ? 'Heads-up' : mode === 'unlimited' ? 'Multi-handed' : 'Virtual cards';
export function TableDirectory({ socket, tables, connected }: { socket: Socket | null; tables: TableSummary[]; connected: boolean }) {
  const [name, setName] = useState(() => localStorage.getItem('pokerName') || '');
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('table') || '');
  const [mode, setMode] = useState<GameState['mode']>('headsup');
  const send = (event: string, data: object) => {
    localStorage.setItem('pokerName', name.trim());
    socket?.emit(event, { ...data, name });
  };
  return <div className="lobby table-directory">
    <h2>Your next game</h2>
    <label>Your name <input maxLength={30} value={name} onChange={e => setName(e.target.value)} placeholder="Name at the table" /></label>
    <div className="table-controls">
      <select aria-label="Game category" value={mode} onChange={e => setMode(e.target.value as GameState['mode'])}>
        <option value="headsup">Heads-up · 2 seats</option><option value="unlimited">Multi-handed · 9 seats</option><option value="virtualcards">Virtual cards · 9 seats</option>
      </select>
      <button className="btn" disabled={!connected || !name.trim()} onClick={() => send('createTable', { mode })}>Create game</button>
    </div>
    <form className="table-controls" onSubmit={e => { e.preventDefault(); send('joinGame', { code }); }}>
      <input aria-label="Game code" placeholder="Game code" value={code} maxLength={6} onChange={e => setCode(e.target.value.toUpperCase())} />
      <button className="btn" disabled={!connected || !name.trim() || !code.trim()}>Join by code</button>
    </form>
    {!connected && <p>Connecting to server…</p>}
    <h3>Open games</h3>
    {tables.length === 0 && <p>No games yet. Create the first one.</p>}
    {(['headsup', 'unlimited', 'virtualcards'] as const).map(category => <section key={category}>
      <h4>{label(category)}</h4>
      {tables.filter(t => t.mode === category).map(t => <div className="table-list-row" key={t.code}>
        <div><strong>{t.host}'s game</strong><br /><small>{t.code} · {t.players}/{t.capacity} seats · {t.started ? 'Playing' : 'Lobby'}</small></div>
        <button className="btn" disabled={!connected || !name.trim()} onClick={() => send('joinGame', { code: t.code })}>Join / watch</button>
      </div>)}
    </section>)}
  </div>;
}

export function TableControls({ socket, state }: { socket: Socket | null; state: GameState }) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const amountInput = (key: string) => <input type="number" min={1} max={1000000} aria-label="Chip amount" value={amounts[key] ?? state.settings.startingSum} onChange={e => setAmounts({ ...amounts, [key]: e.target.value })} />;
  const amount = (key: string) => Number(amounts[key] ?? state.settings.startingSum);
  const active = !!state.hand && !state.hand.handOver;
  return <section className="table-management">
    <div className="table-controls"><strong>Game {state.tableCode}</strong><span>Host: {state.hostName}{state.isHost ? ' (you)' : ''}</span>
      <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(`${location.origin}${location.pathname}?table=${state.tableCode}`); setCopied(true); } catch { setCopied(false); } }}>{copied ? 'Link copied' : 'Copy invite link'}</button>
      <button className="btn" disabled={active && state.myIndex >= 0} onClick={() => socket?.emit('leaveGame')}>Leave game</button>
    </div>
    {state.paused && <p>Game paused. If a player disconnected, wait for them to return, then the host can resume.</p>}
    {state.myIndex < 0 && <div>
      <h3>Choose a seat</h3>
      <p>{state.seatRequest ? state.seatRequest.approved ? `Seat ${state.seatRequest.seat + 1} approved — you join after this hand.` : `Waiting for host approval for seat ${state.seatRequest.seat + 1}.` : 'You are watching. Request a seat; the host sets your starting chips.'}</p>
      <div className="table-controls">{state.players.map((p, i) => <button key={i} className="btn" disabled={!!p || !!state.seatRequest} onClick={() => socket?.emit('requestSeat', { seat: i })}>{p ? `${i + 1}: ${p.name}` : `Sit in seat ${i + 1}`}</button>)}</div>
    </div>}
    {state.isHost && <details open={state.seatRequests.length > 0}>
      <summary>Host controls · seats & chips</summary>
      <p>Approvals and chip additions during a hand take effect after it ends.</p>
      {state.seatRequests.map(r => <div className="table-controls" key={r.id}>
        <span>{r.name} · seat {r.seat + 1}</span>
        {r.approved ? <span>Approved · waiting for next hand</span> : <>{amountInput(`request-${r.id}`)}<button className="btn" onClick={() => socket?.emit('approveSeat', { id: r.id, chips: amount(`request-${r.id}`) })}>Approve seat</button></>}
        <button className="btn" onClick={() => socket?.emit('denySeat', { id: r.id })}>Decline</button>
      </div>)}
      {state.players.map((p, i) => p && <div className="table-controls" key={i}>
        <span>{p.name}: {p.stack} chips{state.pendingChips[i] ? ` (+${state.pendingChips[i]} queued)` : ''}</span>
        {amountInput(`player-${i}`)}<button className="btn" onClick={() => socket?.emit('addChips', { seat: i, chips: amount(`player-${i}`) })}>Add chips</button>
      </div>)}
      {state.gameStarted && <button className="btn" onClick={() => socket?.emit('togglePause')}>{state.paused ? 'Resume game' : 'Pause game'}</button>}
    </details>}
  </section>;
}

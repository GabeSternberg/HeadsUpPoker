import { useState } from 'react';
import { Socket } from 'socket.io-client';
import { GameState, TableSummary, LedgerEntry } from '../types';

const label = (mode: GameState['mode']) => mode === 'headsup' ? 'Heads-up' : mode === 'unlimited' ? 'Multi-handed' : 'Virtual cards';
export function TableDirectory({ socket, tables, connected }: { socket: Socket | null; tables: TableSummary[]; connected: boolean }) {
  const [name, setName] = useState(() => localStorage.getItem('pokerName') || '');
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('table') || '');
  const [isPrivate, setIsPrivate] = useState(false);
  const [accessKey, setAccessKey] = useState(() => new URLSearchParams(location.hash.slice(1)).get('key') || '');
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
      <button className="btn" disabled={!connected || !name.trim()} onClick={() => send('createTable', { mode, isPrivate })}>Create game</button>
    </div>
    <label><input type="checkbox" checked={isPrivate} onChange={e => setIsPrivate(e.target.checked)} />Private game — hidden from the directory; invite required</label>
    <form className="table-controls" onSubmit={e => { e.preventDefault(); send('joinGame', { code, accessKey }); }}>
      <input aria-label="Game code" placeholder="Game code" value={code} maxLength={6} onChange={e => setCode(e.target.value.toUpperCase())} />
      <input aria-label="Private game access key" placeholder="Access key (private games only)" value={accessKey} onChange={e => setAccessKey(e.target.value)} />
      <button className="btn" disabled={!connected || !name.trim() || !code.trim()}>Join by code</button>
    </form>
    {!connected && <p>Connecting to server…</p>}
    <PreviousLedger />
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
  const amountInput = (key: string, min = 1) => <input type="number" min={min} max={1000000} aria-label="Chip amount" value={amounts[key] ?? state.settings.startingSum} onChange={e => setAmounts({ ...amounts, [key]: e.target.value })} />;
  const amount = (key: string) => Number(amounts[key] ?? state.settings.startingSum);
  const me = state.players[state.myIndex];
  const active = !!state.hand && !state.hand.handOver;
  const waiting = state.seatRequests.filter(r => !r.approved).length;
  const seated = state.players.flatMap((p, i) => p ? [{ p, i }] : []);
  const chipControls = state.mode !== 'virtualcards';
  return <section className="table-management">
    <div className="table-controls"><strong>{state.isPrivate ? 'Private game' : 'Game'} <span className="table-code">{state.tableCode}</span></strong><span>Host: <b>{state.hostName}</b>{state.isHost ? ' (you)' : ''}</span>
      <button className="btn btn-info" onClick={async () => { try { await navigator.clipboard.writeText(`${location.origin}${location.pathname}?table=${state.tableCode}${state.isPrivate ? `#key=${state.accessKey}` : ''}`); setCopied(true); } catch { setCopied(false); } }}>{copied ? 'Link copied' : 'Copy invite link'}</button>
      <button className="btn" disabled={active && state.myIndex >= 0} onClick={() => socket?.emit('leaveGame')}>Leave game</button>
      <button className="btn btn-bad" onClick={() => {
        const password = window.prompt('Enter the terminate code to end this game for everyone:');
        if (password) socket?.emit('terminateTable', { password });
      }}>Terminate game</button>
    </div>
    {me && <div className="table-controls">
      <button className="btn btn-warn" onClick={() => socket?.emit('setSittingOut', { sittingOut: !(me.sittingOut || me.sitOutNextHand) })}>{me.sitOutNextHand ? 'Cancel sit out' : me.sittingOut ? 'Sit back in' : active ? 'Sit out next hand' : 'Sit out'}</button>
      <span>{me.sitOutNextHand ? 'Finish this hand; your seat and chips will be held.' : me.sittingOut ? 'Sitting out — your seat and chips are held.' : ''}</span>
      {state.mode !== 'virtualcards' && <button className="btn" disabled={active} onClick={() => socket?.emit('cashOut')}>Cash out & stand up</button>}
    </div>}
    {state.paused && <p>Game paused. If a player disconnected, wait for them to return, then the host can resume.</p>}
    {state.myIndex < 0 && state.mode !== 'unlimited' && <div>
      <h3>Choose a seat</h3>
      <p>{state.seatRequest ? state.seatRequest.approved ? `Seat ${state.seatRequest.seat + 1} approved — you'll be dealt in when this hand ends.` : `Waiting for host approval for seat ${state.seatRequest.seat + 1}.` : 'You are watching. Request a seat; the host sets your starting chips.'}</p>
      <div className="table-controls">{state.players.map((p, i) => <button key={i} className="btn" disabled={!!p || !!state.seatRequest} onClick={() => socket?.emit('requestSeat', { seat: i })}>{p ? `${i + 1}: ${p.name}` : `Sit in seat ${i + 1}`}</button>)}</div>
    </div>}
    {state.isHost && <details className="host-panel" open={waiting > 0 || undefined}>
      <summary>
        <span>Host controls</span>
        <span className="host-badges">
          {waiting > 0 && <span className="host-count pending">{waiting} waiting</span>}
          <span className="host-count">{seated.length} seated</span>
        </span>
      </summary>
      <p className="host-hint">Approvals and chip changes made during a hand take effect when it ends.</p>

      <div className="host-section">
        <h4>Seat requests <span className="host-count pending">{state.seatRequests.length}</span></h4>
        {state.seatRequests.length === 0 && <p className="host-empty">No one is waiting for a seat.</p>}
        {state.seatRequests.map(r => <div className={`host-row${r.approved ? ' approved' : ' request'}`} key={r.id}>
          <div className="host-who">
            <strong>{r.name}</strong>
            <span>Seat {r.seat + 1}</span>
          </div>
          <div className="host-actions">
            {r.approved ? <span className="host-status">Approved · joins next hand</span> : <>
              <label className="host-amount">Buy-in {amountInput(`request-${r.id}`)}</label>
              <button className="btn btn-good" onClick={() => socket?.emit('approveSeat', { id: r.id, chips: amount(`request-${r.id}`) })}>Approve</button>
            </>}
            <button className="btn btn-bad" onClick={() => socket?.emit('denySeat', { id: r.id })}>Decline</button>
          </div>
        </div>)}
      </div>

      <div className="host-section">
        <h4>Players at the table <span className="host-count">{seated.length}</span></h4>
        {seated.length === 0 && <p className="host-empty">No one is seated yet.</p>}
        {seated.map(({ p, i }) => <div className="host-row" key={i}>
          <div className="host-who">
            <strong>{p.name}{i === state.myIndex ? ' (you)' : ''}</strong>
            <span>Seat {i + 1}</span>
            {chipControls && <span className="host-stack">{p.stack.toLocaleString()} chips</span>}
            {p.sittingOut && <span className="host-tag">Sitting out</span>}
            {p.sitOutNextHand && <span className="host-tag">Out next hand</span>}
            {!p.connected && <span className="host-tag bad">Away</span>}
          </div>
          <div className="host-actions">
            {chipControls && (state.pendingChipChanges[i] ? <>
              <span className="host-status">Queued: {state.pendingChipChanges[i].type} {state.pendingChipChanges[i].amount} after this hand</span>
              <button className="btn" onClick={() => socket?.emit('cancelChipChange', { seat: i })}>Cancel change</button>
            </> : <>
              <label className="host-amount">Chips {amountInput(`player-${i}`, 0)}</label>
              <button className="btn btn-good" onClick={() => socket?.emit('addChips', { seat: i, chips: amount(`player-${i}`) })}>Add</button>
              <button className="btn btn-warn" onClick={() => socket?.emit('removeChips', { seat: i, chips: amount(`player-${i}`) })}>Remove</button>
              <button className="btn btn-info" onClick={() => socket?.emit('setChips', { seat: i, chips: amount(`player-${i}`) })}>Set stack</button>
            </>)}
            {i !== state.myIndex && <button className="btn btn-bad" onClick={() => {
              const password = window.prompt(`Override password to remove ${p.name}${active ? ' (they fold this hand)' : ''}:`);
              if (password) socket?.emit('kickPlayer', { targetIndex: i, password });
            }}>Kick</button>}
          </div>
        </div>)}
      </div>

      <div className="host-section">
        <h4>Table</h4>
        {state.mode === 'unlimited' && <BlindSettings socket={socket} state={state} disabled={active} />}
        <div className="table-controls">
          <label className="host-amount">Transfer host to <select aria-label="Transfer host to" defaultValue="" onChange={e => {
            const id = e.target.value;
            if (id && window.confirm('Transfer all host controls to this member?')) socket?.emit('transferHost', { id });
            e.target.value = '';
          }}><option value="">Choose connected member</option>{state.hostCandidates.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
          {state.gameStarted && <button className={`btn ${state.paused ? 'btn-good' : 'btn-warn'}`} onClick={() => socket?.emit('togglePause')}>{state.paused ? 'Resume game' : 'Pause game'}</button>}
        </div>
      </div>
    </details>}
    {state.mode !== 'virtualcards' && <Ledger entries={state.ledger} code={state.tableCode} />}
  </section>;
}


function BlindSettings({ socket, state, disabled }: { socket: Socket | null; state: GameState; disabled: boolean }) {
  const [bigBlind, setBigBlind] = useState(String(state.settings.bigBlind));
  const [buyIn, setBuyIn] = useState(String(state.settings.startingSum));
  return <form className="table-controls" onSubmit={e => {
    e.preventDefault();
    socket?.emit('updateSettings', { bigBlind: Number(bigBlind), startingSum: Number(buyIn) });
  }}>
    <label className="host-amount">Big blind <input type="number" min={1} max={1000000} value={bigBlind} disabled={disabled} onChange={e => setBigBlind(e.target.value)} /></label>
    <label className="host-amount">Default buy-in <input type="number" min={1} max={1000000} value={buyIn} disabled={disabled} onChange={e => setBuyIn(e.target.value)} /></label>
    <button className="btn btn-good" disabled={disabled}>Save for next hand</button>
    <span className="host-status">Blinds {state.settings.bigBlind / 2}/{state.settings.bigBlind}{disabled ? ' · editable between hands' : ''}</span>
  </form>;
}

function PreviousLedger() {
  try {
    const saved = JSON.parse(sessionStorage.getItem('lastPokerLedger') || 'null');
    return saved ? <Ledger entries={saved.ledger} code={saved.tableCode} previous /> : null;
  } catch { return null; }
}

function Ledger({ entries, code, previous = false }: { entries: LedgerEntry[]; code: string; previous?: boolean }) {
  const totals = new Map<string, { name: string; buyIn: number; cashOut: number }>();
  for (const entry of entries) {
    const row = totals.get(entry.playerId) ?? { name: entry.name, buyIn: 0, cashOut: 0 };
    if (entry.type === 'buy-in') row.buyIn += entry.amount; else row.cashOut += entry.amount;
    totals.set(entry.playerId, row);
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ tableCode: code, exportedAt: new Date().toISOString(), ledger: entries }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `poker-${code}-ledger.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <details className="session-ledger">
    <summary>{previous ? `Previous game ${code}` : 'Session'} buy-in / cash-out ledger</summary>
    <p>Chip amounts only. Chip changes appear when applied; reductions are recorded as cash-outs. Cashing out returns your full stack and frees your seat.</p>
    <p>This ledger lasts for this server session. Download a copy before the game ends.</p>
    <button className="btn" onClick={download}>Download ledger</button>
    <div className="ledger-scroll"><table><thead><tr><th>Player</th><th>Bought in</th><th>Cashed out</th></tr></thead><tbody>
      {[...totals].map(([id, row]) => <tr key={id}><td>{row.name}</td><td>{row.buyIn}</td><td>{row.cashOut}</td></tr>)}
    </tbody></table></div>
    <div className="ledger-scroll"><table><thead><tr><th>Time</th><th>Player</th><th>Entry</th><th>Chips</th></tr></thead><tbody>
      {entries.map(entry => <tr key={entry.id}><td>{new Date(entry.timestamp).toLocaleTimeString()}</td><td>{entry.name}</td><td>{entry.type}: {entry.reason}</td><td>{entry.amount}</td></tr>)}
    </tbody></table></div>
  </details>;
}

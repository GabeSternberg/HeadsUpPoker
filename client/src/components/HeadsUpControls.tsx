import { useEffect, useState } from 'react';
import { Socket } from 'socket.io-client';
import { GameState } from '../types';

export default function HeadsUpControls({ socket, state, resetRequest }: { socket: Socket | null; state: GameState; resetRequest: number }) {
  const [password, setPassword] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => { if (resetRequest > 0) setExpanded(true); }, [resetRequest]);
  const seatName = (index: number) => state.avatarMode
    ? state.avatarAssignment[index] === 'G' ? 'Gabe' : state.avatarAssignment[index] === 'L' ? 'Liana' : `Player ${index + 1}`
    : `Player ${index + 1}`;
  return <section className="heads-up-controls">
    {state.myIndex < 0 && <><h2>{state.gameStarted ? 'Game in progress' : 'Both seats are occupied'}</h2>
      <p>Enter the recovery password to rejoin as either player. Rejoining keeps that player's cards, chips, and position in the hand.</p></>}
    {state.paused && <p>Game paused. Once both players are connected, either player can resume.</p>}
    <details open={state.myIndex < 0 || expanded} onToggle={e => setExpanded(e.currentTarget.open)}>
      <summary>Rejoin / reset game</summary>
      <label>Recovery password <input type="password" autoComplete="off" value={password} onChange={e => setPassword(e.target.value)} /></label>
      <div className="table-controls">
        {state.myIndex < 0 && [0, 1].map(index => <button className="btn" key={index} disabled={!password} onClick={() => socket?.emit('reclaimDefaultSeat', { seat: index, password })}>Rejoin as {seatName(index)}</button>)}
        <button className="btn" disabled={!password} onClick={() => setConfirmReset(true)}>Reset game</button>
        {confirmReset && <div role="alert">
          <p>End this hand and restore starting chips for both players?</p>
          <button className="btn" onClick={() => { socket?.emit('resetDefault', { password }); setConfirmReset(false); }}>Confirm reset</button>
          <button className="btn" onClick={() => setConfirmReset(false)}>Cancel</button>
        </div>}
      </div>
    </details>
  </section>;
}

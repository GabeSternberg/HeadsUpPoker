import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as connect } from '../../client/node_modules/socket.io-client';
import { setupSocketHandlers } from '../src/socketHandler';

const delay = () => new Promise(resolve => setTimeout(resolve, 40));
function event(socket: any, name: string, predicate = (_: any) => true): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(name, handler); reject(new Error(`Timed out: ${name}`)); }, 3000);
    const handler = (data: any) => { if (predicate(data)) { clearTimeout(timer); socket.off(name, handler); resolve(data); } };
    socket.on(name, handler);
  });
}
test('independent tables, approvals, deferred chips, privacy, reconnect and permissions', async () => {
  const http = createServer(); const server = new Server(http); setupSocketHandlers(server);
  await new Promise<void>(r => http.listen(0, '127.0.0.1', r));
  const port = (http.address() as any).port;
  const sockets: any[] = [];
  async function client() {
    const s = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'], reconnection: false });
    sockets.push(s); await event(s, 'connect'); return s;
  }
  async function send(s: any, command: string, data = {}, predicate = (_: any) => true) {
    await delay();
    const result = event(s, 'gameState', predicate); s.emit(command, data); return result;
  }
  try {
    const host = await client(); const sessionPromise = event(host, 'tableSession');
    let state = await send(host, 'createTable', { mode: 'unlimited', name: 'Host' });
    const session = await sessionPromise; const code = state.tableCode;
    assert.equal(state.isHost, true); assert.equal(state.players.length, 9);
    const secondHost = await client(); const other = await send(secondHost, 'createTable', { mode: 'headsup', name: 'Other host' });
    assert.notEqual(other.tableCode, code);
    const player = await client(); state = await send(player, 'joinGame', { code, name: 'Guest' });
    assert.equal(state.myIndex, -1);
    const denied = event(player, 'actionError'); player.emit('addChips', { seat: 0, chips: 999 });
    assert.match((await denied).message, /host/);
    await send(player, 'requestSeat', { seat: 3 });
    state = await send(host, 'approveSeat', { id: '3', chips: 300 });
    assert.equal(state.players[3].stack, 300);
    const viewer = await client(); await send(viewer, 'joinGame', { code, name: 'Viewer' });
    await send(host, 'toggleReady');
    state = await send(player, 'toggleReady');
    assert.equal(state.gameStarted, true);
    assert.equal(state.players[0].isSB, true, 'two players at multiway table use heads-up blinds');
    assert.equal(state.players[3].isBB, true);
    assert.equal(state.players[0].holeCards, null);
    const before = state.players[3].stack;
    state = await send(host, 'addChips', { seat: 3, chips: 200 });
    assert.equal(state.players[3].stack, before); assert.equal(state.pendingChips[3], 200);
    await send(viewer, 'requestSeat', { seat: 5 });
    state = await send(host, 'approveSeat', { id: '5', chips: 450 });
    assert.equal(state.players[5], null);
    const spectatorUpdate = event(viewer, 'gameState');
    state = await send(host, 'action', { type: 'fold' });
    assert.equal(state.hand.handOver, true); assert.equal(state.players[5].stack, 450);
    assert.equal(state.players[3].stack, 300 + state.settings.bigBlind / 2 + 200);
    const spectatorState = await spectatorUpdate;
    assert.equal(spectatorState.players[0].holeCards, null);
    assert.equal(state.players.filter(Boolean).reduce((n: number, p: any) => n + p.stack, 0), 1000 + 300 + 450 + 200);
    state = await send(host, 'nextHand'); assert.equal(state.players[5].holeCards, null);
    const pauseUpdate = event(player, 'gameState', s => s.paused);
    host.disconnect(); await pauseUpdate;
    const replacement = await client(); state = await send(replacement, 'resumeTable', session);
    assert.equal(state.myIndex, 0); assert.equal(state.isHost, true); assert.equal(state.players[0].connected, true);
    state = await send(replacement, 'togglePause'); assert.equal(state.paused, false);
    const invalid = event(player, 'actionError'); player.emit('updateSettings', { bigBlind: 500 }); await invalid;
    const fresh = await client(); const untouched = await send(fresh, 'joinGame', { code: other.tableCode, name: 'Second guest' });
    assert.equal(untouched.players[0].name, 'Other host'); assert.equal(untouched.gameStarted, false);
    assert.equal(untouched.players[1].name, 'Second guest');
    const expired = await client(); const expiredEvent = event(expired, 'sessionExpired');
    expired.emit('resumeTable', { code, token: 'fake' }); await expiredEvent;
    replacement.emit('approveSeat', null); replacement.emit('action', null); await delay();
    assert.equal(replacement.connected, true);
  } finally { for (const s of sockets) s.disconnect(); await new Promise<void>(r => server.close(() => r())); }
});

test('unequal multiway all-ins conserve chips through side-pot settlement', async () => {
  const { createRoom, startHand, handleAction, getCurrentLegalActions, getClientState } = await import('../src/gameState');
  for (let iteration = 0; iteration < 30; iteration++) {
    const room = createRoom(); room.mode = 'unlimited';
    room.players = [100, 200, 500].map((stack, seatIndex) => ({ stack, seatIndex, name: `P${seatIndex}`, id: `${seatIndex}`, connected: true, ready: true, holeCards: [] }));
    startHand(room);
    let actions = 0;
    while (!room.hand!.handOver && actions++ < 20) {
      const legal = getCurrentLegalActions(room)!;
      const result = handleAction(room, room.hand!.currentPlayerIndex, legal.canRaise ? { type: 'raise', amount: legal.maxRaise } : legal.canCall ? { type: 'call' } : { type: 'check' });
      assert.equal(result.valid, true);
    }
    assert.equal(room.hand!.handOver, true);
    assert.equal(room.players.reduce((sum, p) => sum + p!.stack, 0), 800);
    assert.ok(room.players.every(p => Number.isFinite(p!.stack) && p!.stack >= 0));
    // A folded player's cards must never become public at showdown.
    room.hand!.playerFolded[0] = true;
    assert.equal(getClientState(room, -1).players[0]!.holeCards, null);
  }
});

test('private invitations, sit out/back in, host transfer and reconciled session ledger', async () => {
  const http = createServer(); const server = new Server(http); setupSocketHandlers(server);
  await new Promise<void>(r => http.listen(0, '127.0.0.1', r));
  const port = (http.address() as any).port;
  const sockets: any[] = [];
  async function client() {
    const s = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'], reconnection: false });
    sockets.push(s); await event(s, 'connect'); return s;
  }
  async function send(s: any, command: string, data = {}) {
    await delay(); const result = event(s, 'gameState'); s.emit(command, data); return result;
  }
  async function reject(s: any, command: string, data = {}) {
    await delay(); const result = event(s, 'actionError'); s.emit(command, data); return result;
  }
  const reconcile = (state: any) => {
    const balance = state.ledger.reduce((n: number, e: any) => n + (e.type === 'buy-in' ? e.amount : -e.amount), 0);
    const inPlay = state.players.reduce((n: number, p: any) => n + (p?.stack ?? 0), 0) + (state.hand?.pot ?? 0);
    assert.equal(balance, inPlay);
  };
  try {
    const host = await client(), guest = await client(), third = await client();
    const directory = event(guest, 'tables');
    let state = await send(host, 'createTable', { mode: 'unlimited', name: 'Host', isPrivate: true });
    assert.equal((await directory).length, 0);
    const code = state.tableCode, accessKey = state.accessKey;
    assert.ok(accessKey.length >= 32); assert.equal(state.ledger.length, 1); reconcile(state);
    assert.match((await reject(guest, 'joinGame', { code, name: 'Guest' })).message, /invite/);
    await reject(guest, 'joinGame', { code, name: 'Guest', accessKey: 'é'.repeat(32) });
    const guestSession = event(guest, 'tableSession');
    await send(guest, 'joinGame', { code, accessKey, name: 'Guest' });
    const session = await guestSession;
    await send(guest, 'requestSeat', { seat: 1 });
    await send(host, 'approveSeat', { id: '1', chips: 400 });
    await send(third, 'joinGame', { code, accessKey, name: 'Third' });
    await send(third, 'requestSeat', { seat: 2 });
    state = await send(host, 'approveSeat', { id: '2', chips: 500 }); reconcile(state);
    assert.equal(state.ledger.length, 3);
    state = await send(third, 'setSittingOut', { sittingOut: true }); assert.equal(state.players[2].sittingOut, true);
    await reject(third, 'toggleReady');
    await send(host, 'toggleReady'); state = await send(guest, 'toggleReady');
    assert.equal(state.gameStarted, true); assert.equal(state.players[2].holeCards, null);
    state = await send(host, 'setSittingOut', { sittingOut: true });
    assert.equal(state.players[0].sitOutNextHand, true); assert.equal(state.players[0].sittingOut, false);
    await reject(host, 'cashOut');
    const ledgerBefore = state.ledger.length;
    state = await send(host, 'addChips', { seat: 1, chips: 150 });
    assert.equal(state.ledger.length, ledgerBefore); reconcile(state);
    state = await send(host, 'action', { type: 'fold' });
    assert.equal(state.players[0].sittingOut, true); assert.equal(state.ledger.length, ledgerBefore + 1); reconcile(state);
    await reject(guest, 'nextHand'); // only one player is sitting in
    state = await send(third, 'setSittingOut', { sittingOut: false });
    const thirdReadyStack = state.players[2].stack;
    state = await send(guest, 'nextHand');
    assert.equal(state.players[0].isSB, false); assert.equal(state.players[0].isBB, false);
    assert.ok(state.players[2].stack < thirdReadyStack); reconcile(state);
    // New hand is between seats 1 and 2, dealer 1 acts first.
    state = await send(guest, 'action', { type: 'fold' }); reconcile(state);
    const guestId = state.hostCandidates; assert.equal(guestId.length, 0);
    state = await send(host, 'setSittingOut', { sittingOut: false });
    const target = state.hostCandidates.find((m: any) => m.name === 'Guest');
    await reject(third, 'transferHost', { id: target.id });
    state = await send(host, 'transferHost', { id: target.id }); assert.equal(state.isHost, false);
    await reject(host, 'addChips', { seat: 0, chips: 1 });
    state = await send(guest, 'addChips', { seat: 0, chips: 10 }); assert.equal(state.isHost, true); reconcile(state);
    const amount = state.players[0].stack;
    state = await send(host, 'cashOut'); assert.equal(state.myIndex, -1); assert.equal(state.players[0], null);
    assert.equal(state.ledger.at(-1).amount, amount); assert.equal(state.ledger.at(-1).type, 'cash-out'); reconcile(state);
    const entryCount = state.ledger.length;
    await send(guest, 'resetMatch');
    state = await send(guest, 'addChips', { seat: 1, chips: 5 }); assert.equal(state.ledger.length, entryCount + 1); reconcile(state);
    guest.disconnect(); await delay();
    const resumed = await client(); state = await send(resumed, 'resumeTable', session);
    assert.equal(state.isHost, true); assert.equal(state.ledger.length, entryCount + 1); reconcile(state);
    const result = event(third, 'tableLeft'); third.emit('leaveGame');
    const departed = await result; assert.equal(departed.ledger.at(-1).reason, 'Left table');
    await delay();
    state = await send(resumed, 'addChips', { seat: 1, chips: 1 }); reconcile(state);
    // A repeated cash-out cannot create another ledger entry.
    host.emit('cashOut'); await delay();
    state = await send(resumed, 'addChips', { seat: 1, chips: 1 }); reconcile(state);
  } finally { for (const s of sockets) s.disconnect(); await new Promise<void>(r => server.close(() => r())); }
});

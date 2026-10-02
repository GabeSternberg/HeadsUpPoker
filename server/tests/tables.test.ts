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
    assert.equal(state.hand, null, 'dealing waits for the host to start');
    const notHost = event(player, 'actionError'); player.emit('startGame');
    assert.match((await notHost).message, /host/);
    const dealt = event(player, 'gameState', s => s.gameStarted);
    state = await send(host, 'startGame');
    assert.equal(state.gameStarted, true, 'multi-handed tables deal without a ready step');
    assert.equal(state.hand.handOver, false);
    assert.equal(state.players[3].stack + state.hand.playerBets[3], 300);
    const playerView = await dealt;
    assert.equal(playerView.players[0].isSB, true, 'two players at multiway table use heads-up blinds');
    assert.equal(playerView.players[3].isBB, true);
    assert.equal(playerView.players[0].holeCards, null);
    const viewer = await client(); await send(viewer, 'joinGame', { code, name: 'Viewer' });
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

test('minimum raise is the current bet plus the last raise increment', async () => {
  const { getLegalActions, processAction, newStreetBetting } = await import('../src/betting');
  let state = {
    pot: 30, currentBet: 20, lastRaiseSize: 20, playerBets: [10, 20, 0], playerStacks: [990, 980, 1000],
    playerActedThisRound: [false, false, false], playerAllIn: [false, false, false], playerFolded: [false, false, false],
    bigBlind: 20, round: 'preflop' as const, numPlayers: 3,
  };
  assert.equal(getLegalActions(state, 2).minRaise, 40, 'open raise is the big blind plus one big blind');
  state = processAction(state, 2, { type: 'raise', amount: 100 }).newState!;
  assert.equal(getLegalActions(state, 0).minRaise, 180, 'a raise of 80 makes the next minimum 100 + 80');
  assert.equal(processAction(state, 0, { type: 'raise', amount: 150 }).valid, false);
  state = processAction(state, 0, { type: 'raise', amount: 180 }).newState!;
  assert.equal(getLegalActions(state, 1).minRaise, 260);
  state = newStreetBetting({ ...state, round: 'flop' });
  assert.equal(getLegalActions(state, 0).minRaise, 20, 'first bet on a street is at least the big blind');
  state = processAction(state, 0, { type: 'raise', amount: 50 }).newState!;
  assert.equal(getLegalActions(state, 1).minRaise, 100, 'facing a bet of 50 the minimum raise is to 100');
});

test('postflop action starts left of the dealer, including two-handed multi tables', async () => {
  const { createRoom, startHand, handleAction } = await import('../src/gameState');
  const seatPlayers = (stacks: (number | null)[]) => stacks.map((stack, seatIndex) => stack === null ? null
    : { stack, seatIndex, name: `P${seatIndex}`, id: `${seatIndex}`, connected: true, ready: true, holeCards: [] });
  for (const mode of ['unlimited', 'headsup'] as const) {
    const room = createRoom(); room.mode = mode;
    room.players = seatPlayers(mode === 'headsup' ? [1000, 1000] : [null, 1000, null, 1000]);
    room.dealerIndex = mode === 'headsup' ? 0 : 3;
    startHand(room);
    const dealer = room.hand!.dealerIndex, other = room.hand!.participants.find(s => s !== dealer)!;
    assert.equal(room.hand!.sbIndex, dealer, `${mode}: the dealer posts the small blind two-handed`);
    assert.equal(room.hand!.currentPlayerIndex, dealer, `${mode}: the dealer acts first preflop`);
    handleAction(room, dealer, { type: 'call' });
    handleAction(room, other, { type: 'check' });
    assert.equal(room.hand!.round, 'flop');
    assert.equal(room.hand!.currentPlayerIndex, other, `${mode}: the non-dealer acts first on the flop`);
  }
  const room = createRoom(); room.mode = 'unlimited';
  room.players = seatPlayers([1000, 1000, 1000]);
  room.dealerIndex = 0;
  startHand(room);
  for (const seat of [0, 1]) handleAction(room, seat, { type: 'call' });
  handleAction(room, 2, { type: 'check' });
  assert.equal(room.hand!.currentPlayerIndex, 1, 'three-handed, the small blind (left of dealer) acts first postflop');
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
    state = await send(host, 'setSittingOut', { sittingOut: true }); assert.equal(state.players[0].sittingOut, true);
    const guestSession = event(guest, 'tableSession');
    await send(guest, 'joinGame', { code, accessKey, name: 'Guest' });
    const session = await guestSession;
    await send(guest, 'requestSeat', { seat: 1 });
    state = await send(host, 'approveSeat', { id: '1', chips: 400 });
    assert.equal(state.hand, null, 'one player sitting in is not enough to deal');
    await send(third, 'joinGame', { code, accessKey, name: 'Third' });
    await send(third, 'requestSeat', { seat: 2 });
    state = await send(host, 'approveSeat', { id: '2', chips: 500 }); reconcile(state);
    assert.equal(state.ledger.length, 3); assert.equal(state.hand, null);
    state = await send(host, 'startGame');
    assert.equal(state.gameStarted, true, 'host start deals the first hand');
    assert.equal(state.players[0].isSB, false); assert.equal(state.players[0].isBB, false);
    state = await send(third, 'setSittingOut', { sittingOut: true });
    assert.equal(state.players[2].sitOutNextHand, true); assert.equal(state.players[2].sittingOut, false);
    await reject(third, 'cashOut');
    const ledgerBefore = state.ledger.length;
    state = await send(host, 'addChips', { seat: 1, chips: 150 });
    assert.equal(state.ledger.length, ledgerBefore); reconcile(state);
    // Seat 1 is dealer and small blind heads-up, so the guest acts first.
    state = await send(guest, 'action', { type: 'fold' });
    assert.equal(state.players[2].sittingOut, true); assert.equal(state.ledger.length, ledgerBefore + 1); reconcile(state);
    await reject(guest, 'nextHand'); // only one player is sitting in
    state = await send(host, 'setSittingOut', { sittingOut: false });
    assert.equal(state.hand.handOver, true, 'later hands still wait for Next Round');
    const hostStack = state.players[0].stack;
    state = await send(guest, 'nextHand');
    assert.equal(state.players[2].isSB, false); assert.equal(state.players[2].isBB, false);
    assert.ok(state.players[0].stack < hostStack); reconcile(state);
    state = await send(host, 'action', { type: 'fold' }); reconcile(state);
    state = await send(third, 'setSittingOut', { sittingOut: false });
    assert.equal(state.hostCandidates.length, 0);
    state = await send(host, 'cancelChipChange', { seat: 0 });
    const target = state.hostCandidates.find((m: any) => m.name === 'Guest');
    await reject(third, 'transferHost', { id: target.id });
    state = await send(host, 'transferHost', { id: target.id }); assert.equal(state.isHost, false);
    await reject(host, 'addChips', { seat: 0, chips: 1 });
    state = await send(guest, 'addChips', { seat: 0, chips: 10 }); assert.equal(state.isHost, true); reconcile(state);
    const amount = state.players[0].stack;
    state = await send(host, 'cashOut'); assert.equal(state.myIndex, -1); assert.equal(state.players[0], null);
    assert.equal(state.ledger.at(-1).amount, amount); assert.equal(state.ledger.at(-1).type, 'cash-out'); reconcile(state);
    const entryCount = state.ledger.length;
    state = await send(guest, 'resetMatch');
    assert.equal(state.hand, null, 'reset tables wait for the host to start again');
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

test('host remove/set chips validates bounds, queues safely, and reconciles ledger', async () => {
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
    assert.equal(balance, state.players.reduce((n: number, p: any) => n + (p?.stack ?? 0), 0) + (state.hand?.pot ?? 0));
  };
  try {
    const host = await client(), guest = await client();
    let state = await send(host, 'createTable', { mode: 'headsup', name: 'Host' });
    await send(guest, 'joinGame', { code: state.tableCode, name: 'Guest' });
    for (const eventName of ['setChips', 'removeChips', 'cancelChipChange']) await reject(guest, eventName, { seat: 0, chips: 100 });
    for (const chips of [-1, 1.5, 1000001, '100']) await reject(host, 'setChips', { seat: 1, chips });
    await reject(host, 'removeChips', { seat: 1, chips: 1001 });
    state = await send(host, 'removeChips', { seat: 1, chips: 200 });
    assert.equal(state.players[1].stack, 800); assert.equal(state.ledger.at(-1).reason, 'Host chip removal'); reconcile(state);
    state = await send(host, 'setChips', { seat: 1, chips: 0 });
    assert.equal(state.players[1].stack, 0); assert.equal(state.ledger.at(-1).amount, 800); reconcile(state);
    state = await send(host, 'setChips', { seat: 1, chips: 500 }); reconcile(state);
    await send(host, 'toggleReady'); state = await send(guest, 'toggleReady');
    const current = state.players[1].stack, ledgerSize = state.ledger.length;
    state = await send(host, 'setChips', { seat: 1, chips: 250 });
    assert.equal(state.players[1].stack, current); assert.equal(state.ledger.length, ledgerSize);
    assert.deepEqual(state.pendingChipChanges[1], { type: 'set', amount: 250 });
    await reject(host, 'removeChips', { seat: 1, chips: 100 });
    state = await send(host, 'action', { type: 'fold' });
    assert.equal(state.players[1].stack, 250); assert.equal(state.ledger.at(-1).reason, 'Host set stack'); reconcile(state);
    await send(host, 'nextHand');
    state = await send(host, 'removeChips', { seat: 0, chips: 100 });
    assert.equal(state.pendingChipChanges[0].amount, 100);
    state = await send(host, 'cancelChipChange', { seat: 0 }); assert.equal(state.pendingChipChanges[0], undefined);
    state = await send(host, 'removeChips', { seat: 0, chips: 2000 });
    const entriesBeforeInvalidRemoval = state.ledger.length;
    state = await send(guest, 'action', { type: 'fold' });
    assert.equal(state.ledger.length, entriesBeforeInvalidRemoval);
    assert.ok(state.actionLog.some((line: string) => line.includes('cancelled'))); reconcile(state);
    state = await send(host, 'removeChips', { seat: 0, chips: 100 }); reconcile(state);
    assert.equal(state.ledger.at(-1).amount, 100);
  } finally { for (const s of sockets) s.disconnect(); await new Promise<void>(r => server.close(() => r())); }
});

test('host override kick works mid-hand: the player folds, then is cashed out', async () => {
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
  try {
    const host = await client(), a = await client(), b = await client();
    let state = await send(host, 'createTable', { mode: 'unlimited', name: 'Host' });
    const code = state.tableCode;
    for (const [s, seat, name] of [[a, 1, 'A'], [b, 2, 'B']] as const) {
      await send(s, 'joinGame', { code, name });
      await send(s, 'requestSeat', { seat });
      await send(host, 'approveSeat', { id: String(seat), chips: 500 });
    }
    state = await send(host, 'startGame');
    // Dealer 0, small blind 1, big blind 2; the host acts first.
    assert.equal(state.hand.currentPlayerIndex, 0);
    assert.match((await reject(host, 'kickPlayer', { targetIndex: 1, password: 'wrong' })).message, /password/);
    assert.match((await reject(a, 'kickPlayer', { targetIndex: 2, password: '123' })).message, /host/);
    const kicked = event(a, 'kicked');
    state = await send(host, 'kickPlayer', { targetIndex: 1, password: '123' });
    await kicked;
    assert.equal(state.hand.handOver, false); assert.ok(state.players[1], 'seat is held until the hand ends');
    state = await send(host, 'action', { type: 'fold' });
    assert.equal(state.hand.handOver, true, 'removed player folded automatically');
    assert.equal(state.players[1], null);
    assert.equal(state.ledger.at(-1).reason, 'Host removed player');
    assert.equal(state.ledger.at(-1).amount, 500 - state.settings.bigBlind / 2);
    state = await send(b, 'setSittingOut', { sittingOut: false });
    assert.equal(state.players[2].stack, 500 + state.settings.bigBlind / 2);

    const viewer = await client();
    await send(viewer, 'joinGame', { code, name: 'Viewer' });
    state = await send(host, 'nextHand');
    assert.equal(state.hand.handOver, false);
    assert.match((await reject(viewer, 'terminateTable', { password: 'wrong' })).message, /terminate code/);
    const hostKicked = event(host, 'kicked'), bKicked = event(b, 'kicked');
    viewer.emit('terminateTable', { password: 'terminate123' });
    const [ended] = await Promise.all([hostKicked, bKicked, event(viewer, 'kicked')]);
    assert.match(ended.message, /terminated/);
    const balance = ended.ledger.reduce((n: number, e: any) => n + (e.type === 'buy-in' ? e.amount : -e.amount), 0);
    assert.equal(balance, 0, 'every seat is cashed out and the voided hand is refunded');
    const late = await client();
    assert.match((await reject(late, 'joinGame', { code, name: 'Late' })).message, /not found/);
  } finally { for (const s of sockets) s.disconnect(); await new Promise<void>(r => server.close(() => r())); }
});

test('default heads-up singleton supports password seat recovery and isolated resets', async () => {
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
  try {
    const p1 = await client(), p2 = await client(), watcher = await client(), multi = await client();
    let state = await send(p1, 'joinDefault');
    assert.equal(state.isClassic, true); assert.equal(state.myIndex, 0); assert.equal(state.players[0].name, 'Player 1');
    state = await send(p2, 'joinDefault'); assert.equal(state.myIndex, 1); assert.equal(state.players[1].name, 'Player 2');
    state = await send(watcher, 'joinDefault'); assert.equal(state.myIndex, -1);
    const directoryPromise = event(watcher, 'tables');
    const multiplayer = await send(multi, 'createTable', { mode: 'unlimited', name: 'Separate table' });
    const listed = await directoryPromise;
    assert.equal(listed.length, 1); assert.equal(listed[0].code, multiplayer.tableCode);
    await send(p2, 'updateSettings', { startingSum: 700 }); // either default player can configure
    await send(p1, 'activateAvatarMode');
    await send(p1, 'toggleReady'); state = await send(p2, 'toggleReady');
    assert.equal(state.gameStarted, true); assert.equal(state.players[0].name, 'Gabe'); assert.equal(state.players[1].name, 'Liana');
    const cards = state.players[1].holeCards, stack = state.players[1].stack;
    await reject(watcher, 'reclaimDefaultSeat', { seat: 1, password: 'wrong' });
    await reject(watcher, 'resetDefault', { password: 'wrong' });
    await reject(p1, 'resetMatch');
    await reject(p1, 'setChips', { seat: 0, chips: 999 });
    state = await send(watcher, 'reclaimDefaultSeat', { seat: 1, password: '123' });
    assert.equal(state.myIndex, 1); assert.deepEqual(state.players[1].holeCards, cards); assert.equal(state.players[1].stack, stack);
    assert.equal(state.players[0].holeCards, null);
    // The former seat owner cannot act or reset without the password.
    p2.emit('action', { type: 'fold' });
    state = await send(watcher, 'togglePause'); assert.equal(state.hand.handOver, false);
    await send(watcher, 'togglePause');
    await reject(watcher, 'reclaimDefaultSeat', { seat: 0, password: '123' });
    const paused = event(watcher, 'gameState', s => s.paused);
    p1.disconnect(); await paused;
    state = await send(p2, 'reclaimDefaultSeat', { seat: 0, password: '123' });
    assert.equal(state.myIndex, 0); assert.equal(state.players[0].connected, true);
    await send(p2, 'togglePause');
    const observer = await client(); await send(observer, 'joinDefault');
    state = await send(observer, 'resetDefault', { password: '123' });
    assert.equal(state.gameStarted, false); assert.equal(state.hand, null); assert.equal(state.paused, false);
    assert.equal(state.players[0].stack, 700); assert.equal(state.players[1].stack, 700);
    assert.equal(state.players[0].ready, false); assert.equal(state.players[0].name, 'Gabe');
    const intact = await send(multi, 'addChips', { seat: 0, chips: 10 });
    assert.equal(intact.players[0].stack, 1010); assert.equal(intact.tableCode, multiplayer.tableCode);
    const outsider = await client();
    await reject(outsider, 'joinGame', { code: 'CLASSIC', name: 'Intruder' });
  } finally { for (const s of sockets) s.disconnect(); await new Promise<void>(r => server.close(() => r())); }
});

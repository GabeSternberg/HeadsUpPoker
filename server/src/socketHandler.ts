/** Independent, server-authoritative tables with private reconnect credentials. */
import { randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { Server, Socket } from 'socket.io';
import { Room, createRoom, startHand, handleAction, getClientState, checkMatchOver, GameMode, vcDeal, vcNextPhase } from './gameState';
import { syncAvatarPlayerNames } from './displayNames';

interface Member { id: string; token: string; socketId: string; name: string; seat: number }
interface SeatRequest { token: string; seat: number; chips?: number }
interface LedgerEntry { id: string; playerId: string; name: string; type: 'buy-in' | 'cash-out'; amount: number; reason: string; timestamp: string }
interface ChipChange { type: 'add' | 'remove' | 'set'; amount: number }
interface Table {
  classic?: boolean;
  private: boolean; accessKey: string; ledger: LedgerEntry[];
  code: string; room: Room; host: string; members: Map<string, Member>;
  requests: SeatRequest[]; additions: Map<number, ChipChange>; updated: number;
  evicted?: Map<number, Member>;
}
const MAX_CHIPS = 1_000_000;
const chipsValid = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= MAX_CHIPS;

export function setupSocketHandlers(io: Server): void {
  const tables = new Map<string, Table>();
  const classic: Table = { classic: true, private: true, accessKey: '', ledger: [], code: 'CLASSIC', room: createRoom(), host: '', members: new Map(), requests: [], additions: new Map(), updated: Date.now() };
  tables.set(classic.code, classic);
  const inHand = (t: Table) => !!t.room.hand && !t.room.hand.handOver;
  const capacity = (t: Table) => t.room.mode === 'headsup' ? 2 : 9;
  function directory() {
    io.emit('tables', [...tables.values()].filter(t => !t.private).map(t => ({ code: t.code, mode: t.room.mode,
      host: t.members.get(t.host)?.name ?? 'Host', players: t.room.players.filter(Boolean).length,
      capacity: capacity(t), started: t.room.gameStarted })));
  }
  function record(t: Table, m: Member, type: LedgerEntry['type'], amount: number, reason: string) {
    if (t.classic || t.room.mode === 'virtualcards' || amount === 0) return;
    t.ledger.push({ id: randomUUID(), playerId: m.id, name: m.name, type, amount, reason, timestamp: new Date().toISOString() });
  }
  function cashOut(t: Table, m: Member, reason: string) {
    if (m.seat < 0) return;
    applyPending(t);
    record(t, m, 'cash-out', t.room.players[m.seat]!.stack, reason);
    t.room.players[m.seat] = null; t.additions.delete(m.seat); m.seat = -1;
  }
  function seat(t: Table, m: Member, index: number, chips: number) {
    m.seat = index;
    record(t, m, 'buy-in', chips, 'Seat buy-in');
    t.room.players[index] = { id: m.socketId, name: m.name, connected: true, ready: false,
      stack: chips, holeCards: [], seatIndex: index };
  }
  function applyPending(t: Table) {
    if (inHand(t)) return;
    const evicted = [...(t.evicted?.values() ?? [])];
    t.evicted?.clear();
    for (const m of evicted) cashOut(t, m, 'Host removed player');
    for (const p of t.room.players) if (p?.sitOutNextHand) { p.sittingOut = true; p.sitOutNextHand = false; p.ready = false; }
    for (const request of t.requests.filter(r => r.chips !== undefined)) {
      const m = t.members.get(request.token);
      if (!m || !io.sockets.sockets.has(m.socketId)) continue;
      seat(t, m, request.seat, request.chips!);
      t.requests = t.requests.filter(r => r !== request);
      t.room.actionLog.push(`${m.name} seated with ${request.chips} chips`);
    }
    for (const [index, change] of t.additions) {
      const p = t.room.players[index];
      if (!p) continue;
      const next = change.type === 'set' ? change.amount : p.stack + (change.type === 'add' ? change.amount : -change.amount);
      if (next < 0 || next > MAX_CHIPS) {
        const message = `Chip change for ${p.name} cancelled: the final stack must be between 0 and ${MAX_CHIPS}.`;
        t.room.actionLog.push(message);
        const host = t.members.get(t.host);
        if (host) io.to(host.socketId).emit('actionError', { message });
        continue;
      }
      const difference = next - p.stack;
      const m = [...t.members.values()].find(m => m.seat === index);
      if (m) record(t, m, difference >= 0 ? 'buy-in' : 'cash-out', Math.abs(difference), change.type === 'add' ? 'Host top-up' : change.type === 'remove' ? 'Host chip removal' : 'Host set stack');
      p.stack = next;
      t.room.actionLog.push(`Host ${change.type === 'set' ? `set ${p.name}'s stack to ${next}` : `${change.type === 'add' ? 'added' : 'removed'} ${change.amount} chips ${change.type === 'add' ? 'to' : 'from'} ${p.name}`}`);
    }
    if (t.room.mode === 'headsup' && t.room.players.filter(p => p && p.stack > 0).length === 2) t.room.matchOver = false;
    t.additions.clear();
  }
  const dealable = (t: Table) => t.room.players.filter(p => p && p.connected && !p.sittingOut && p.stack > 0).length;
  // Players removed mid-hand keep their seat until it ends, folding whenever the action reaches them.
  function foldEvicted(t: Table) {
    for (let guard = 0; guard < 20 && !t.room.paused && inHand(t) && t.evicted?.has(t.room.hand!.currentPlayerIndex); guard++) {
      handleAction(t.room, t.room.hand!.currentPlayerIndex, { type: 'fold' });
    }
  }
  function broadcast(t: Table) {
    t.updated = Date.now();
    foldEvicted(t);
    applyPending(t);
    for (const m of t.members.values()) {
      const state = getClientState(t.room, m.seat);
      io.to(m.socketId).emit('gameState', { ...state,
        isClassic: !!t.classic, tableCode: t.code, isHost: t.classic ? m.seat >= 0 : m.token === t.host, hostName: t.members.get(t.host)?.name,
        maxSeats: capacity(t), seatRequest: t.requests.find(r => r.token === m.token) ? {
          seat: t.requests.find(r => r.token === m.token)!.seat,
          approved: t.requests.find(r => r.token === m.token)!.chips !== undefined,
        } : null,
        seatRequests: m.token === t.host ? t.requests.map(r => ({
          id: String(r.seat), seat: r.seat, name: t.members.get(r.token)?.name, approved: r.chips !== undefined,
        })) : [],
        pendingChips: Object.fromEntries([...t.additions].filter(([, change]) => change.type === 'add').map(([index, change]) => [index, change.amount])),
        pendingChipChanges: Object.fromEntries(t.additions),
        isPrivate: t.private, accessKey: t.private ? t.accessKey : '',
        ledger: t.room.mode === 'virtualcards' ? [] : t.ledger,
        hostCandidates: m.token === t.host ? [...t.members.values()].filter(candidate => candidate.token !== t.host && io.sockets.sockets.has(candidate.socketId)).map(candidate => ({ id: candidate.id, name: candidate.name })) : [],
      });
    }
    directory();
  }
  // Abandoned tables expire; no active table is removed.
  const cleanup = setInterval(() => {
    for (const [code, t] of tables) if (!t.classic && Date.now() - t.updated > 24 * 60 * 60 * 1000 &&
      [...t.members.values()].every(m => !io.sockets.sockets.has(m.socketId))) tables.delete(code);
    directory();
  }, 60_000);
  cleanup.unref();
  io.engine.on('close', () => clearInterval(cleanup));

  io.on('connection', (socket: Socket) => {
    let table: Table | undefined;
    let member: Member | undefined;
    const error = (message: string) => socket.emit('actionError', { message });
    const hostOnly = () => {
      if (table && member && (table.classic ? member.seat >= 0 : member.token === table.host)) return true;
      error('Only the host can do that.'); return false;
    };
    // Every handler validates membership and malformed payloads before touching state.
    function on(event: string, fn: (data: any, t: Table, m: Member) => void) {
      socket.on(event, (data = {}) => {
        if (!table || !member || member.socketId !== socket.id) return;
        if (!data || typeof data !== 'object') return error('Invalid request.');
        if (table.classic && ['requestSeat', 'approveSeat', 'denySeat', 'addChips', 'removeChips', 'setChips', 'cancelChipChange', 'setSittingOut', 'transferHost', 'cashOut', 'kickPlayer', 'leaveGame', 'leaveTable'].includes(event)) return error('Use the heads-up recovery controls for this table.');
        fn(data, table, member);
      });
    }
    function attach(t: Table, m: Member) {
      table = t; member = m; m.socketId = socket.id;
      if (m.seat >= 0) { t.room.players[m.seat]!.id = socket.id; t.room.players[m.seat]!.connected = true; }
      socket.emit('tableSession', { code: t.code, token: m.token });
      broadcast(t);
    }
    socket.on('joinDefault', () => {
      if (table) return;
      const m: Member = { id: randomUUID(), token: randomBytes(24).toString('hex'), socketId: socket.id, name: 'Viewer', seat: -1 };
      classic.members.set(m.token, m);
      if (!classic.room.gameStarted) {
        const index = classic.room.players.findIndex(p => !p);
        if (index >= 0) {
          m.name = `Player ${index + 1}`;
          seat(classic, m, index, classic.room.settings.startingSum);
          if (!classic.host) classic.host = m.token;
          if (classic.room.avatarMode) syncAvatarPlayerNames(classic.room);
        }
      }
      attach(classic, m);
    });
    on('reclaimDefaultSeat', (data, t, m) => {
      if (!t.classic) return;
      if (data.password !== '123') return error('Incorrect password.');
      if (![0, 1].includes(data.seat)) return error('Choose Player 1 or Player 2.');
      if (m.seat >= 0 && m.seat !== data.seat) return error('You already control a seat. Use another device or tab to rejoin the other seat.');
      const previous = [...t.members.values()].find(candidate => candidate.seat === data.seat && candidate !== m);
      if (previous) previous.seat = -1;
      if (previous?.token === t.host || !t.host) t.host = m.token;
      m.seat = data.seat; m.name = `Player ${data.seat + 1}`;
      const player = t.room.players[data.seat];
      if (player) { player.id = socket.id; player.connected = true; }
      else seat(t, m, data.seat, t.room.settings.startingSum);
      if (t.room.avatarMode) syncAvatarPlayerNames(t.room);
      socket.emit('tableSession', { code: t.code, token: m.token });
      broadcast(t);
    });
    on('resetDefault', (data, t, m) => {
      if (!t.classic) return;
      if (data.password !== '123') return error('Incorrect password.');
      const old = t.room;
      t.room = createRoom(); t.room.settings = { ...old.settings };
      t.room.avatarMode = old.avatarMode; t.room.avatarAssignment = [...old.avatarAssignment];
      t.additions.clear(); t.requests = []; t.ledger = [];
      for (const candidate of t.members.values()) {
        if (candidate.seat < 0) continue;
        if (io.sockets.sockets.has(candidate.socketId)) seat(t, candidate, candidate.seat, t.room.settings.startingSum);
        else candidate.seat = -1;
      }
      if (m.seat < 0) {
        const index = t.room.players.findIndex(p => !p);
        if (index >= 0) { m.name = `Player ${index + 1}`; seat(t, m, index, t.room.settings.startingSum); }
      }
      if (t.room.avatarMode) syncAvatarPlayerNames(t.room);
      broadcast(t);
    });
    socket.on('createTable', (data = {}) => {
      if (table || !data || !['headsup', 'unlimited', 'virtualcards'].includes(data.mode)) return;
      if (tables.size >= 200) return error('Table limit reached. Please join an existing table.');
      const name = typeof data.name === 'string' ? data.name.trim().slice(0, 30) : '';
      if (!name) return error('Enter your name.');
      let code: string;
      do { code = randomBytes(3).toString('hex').toUpperCase(); } while (tables.has(code));
      const m: Member = { id: randomUUID(), token: randomBytes(24).toString('hex'), socketId: socket.id, name, seat: -1 };
      const room = createRoom(); room.mode = data.mode as GameMode;
      room.players = new Array(room.mode === 'headsup' ? 2 : 9).fill(null);
      room.avatarAssignment = new Array(room.players.length).fill(null);
      const t: Table = { private: data.isPrivate === true, accessKey: randomBytes(16).toString('hex'), ledger: [], code, room, host: m.token, members: new Map([[m.token, m]]), requests: [], additions: new Map(), updated: Date.now() };
      seat(t, m, 0, room.settings.startingSum);
      tables.set(code, t); attach(t, m);
    });
    socket.on('joinGame', (data = {}) => {
      if (table || !data || typeof data.code !== 'string') return;
      const t = tables.get(data.code.trim().toUpperCase());
      if (!t || t.classic) return error('Game not found. Check the code or create a new game.');
      if (t.private) {
        const key = typeof data.accessKey === 'string' ? data.accessKey : '';
        if (Buffer.byteLength(key) !== Buffer.byteLength(t.accessKey) || !timingSafeEqual(Buffer.from(key), Buffer.from(t.accessKey))) return error('This private game requires its invite link or access key.');
      }
      const name = typeof data.name === 'string' ? data.name.trim().slice(0, 30) : '';
      if (!name) return error('Enter your name.');
      if (t.members.size >= 50) return error('This table has too many viewers.');
      const m: Member = { id: randomUUID(), token: randomBytes(24).toString('hex'), socketId: socket.id, name, seat: -1 };
      t.members.set(m.token, m);
      if (t.room.mode !== 'unlimited') {
        const index = t.room.players.findIndex(p => !p);
        if (index >= 0 && !inHand(t)) seat(t, m, index, t.room.settings.startingSum);
      }
      attach(t, m);
    });
    socket.on('resumeTable', (data = {}) => {
      if (table || !data) return;
      const t = tables.get(data.code);
      const m = t?.members.get(data.token);
      if (!t || !m) { socket.emit('sessionExpired'); return; }
      const old = io.sockets.sockets.get(m.socketId);
      if (old && old.id !== socket.id) old.disconnect(true);
      attach(t, m);
    });
    on('requestSeat', (data, t, m) => {
      const index = data.seat;
      if (m.seat >= 0 || !Number.isInteger(index) || index < 0 || index >= capacity(t)) return error('Choose an empty seat.');
      if (t.room.players[index] || t.requests.some(r => r.seat === index && r.token !== m.token)) return error('That seat is occupied or requested.');
      t.requests = t.requests.filter(r => r.token !== m.token);
      t.requests.push({ token: m.token, seat: index }); broadcast(t);
    });
    on('approveSeat', (data, t) => {
      if (!hostOnly()) return;
      const request = t.requests.find(r => String(r.seat) === data.id);
      if (!request || request.chips !== undefined) return;
      if (!chipsValid(data.chips)) return error('Enter a whole chip amount from 1 to 1,000,000.');
      request.chips = data.chips; broadcast(t);
    });
    on('denySeat', (data, t) => { if (hostOnly()) { t.requests = t.requests.filter(r => String(r.seat) !== data.id); broadcast(t); } });
    function changeChips(type: ChipChange['type'], data: any, t: Table) {
      if (!hostOnly()) return;
      if (t.room.mode === 'virtualcards') return error('Virtual-card tables do not use chips.');
      if (!Number.isInteger(data.seat) || data.seat < 0 || !t.room.players[data.seat] ||
        !(chipsValid(data.chips) || (type === 'set' && data.chips === 0))) return error('Choose a player and a valid whole chip amount (set stack can be zero).');
      const pending = t.additions.get(data.seat);
      if (pending && !(pending.type === 'add' && type === 'add')) return error('Cancel the queued chip change before entering another.');
      const amount = data.chips + (pending?.amount ?? 0);
      const stack = t.room.players[data.seat]!.stack;
      if (amount > MAX_CHIPS || (!inHand(t) && ((type === 'remove' && amount > stack) || (type === 'add' && stack + amount > MAX_CHIPS)))) return error('The resulting stack must be between 0 and 1,000,000 chips.');
      t.additions.set(data.seat, { type, amount }); broadcast(t);
    }
    on('addChips', (data, t) => changeChips('add', data, t));
    on('removeChips', (data, t) => changeChips('remove', data, t));
    on('setChips', (data, t) => changeChips('set', data, t));
    on('cancelChipChange', (data, t) => {
      if (!hostOnly()) return;
      t.additions.delete(data.seat); broadcast(t);
    });
    on('updateSettings', (data, t) => {
      if (!hostOnly()) return;
      if (t.room.mode === 'unlimited' ? inHand(t) : t.room.gameStarted) return error('Change settings between hands.');
      for (const key of ['startingSum', 'bigBlind'] as const) {
        if (data[key] !== undefined) {
          if (!chipsValid(data[key])) return error('Settings must be whole numbers from 1 to 1,000,000.');
          t.room.settings[key] = data[key];
        }
      }
      if (t.room.mode === 'headsup' && data.startingSum !== undefined) for (const m of t.members.values()) {
        const p = t.room.players[m.seat];
        if (!p) continue;
        const difference = t.room.settings.startingSum - p.stack;
        record(t, m, difference >= 0 ? 'buy-in' : 'cash-out', Math.abs(difference), 'Starting chips adjustment');
        p.stack = t.room.settings.startingSum;
      }
      for (const p of t.room.players) if (p) p.ready = false;
      broadcast(t);
    });
    on('toggleReady', (_data, t, m) => {
      if (m.seat < 0 || t.room.gameStarted || t.room.mode === 'unlimited') return;
      const p = t.room.players[m.seat]!;
      if (p.sittingOut) return error('Sit back in before readying.');
      p.ready = !p.ready;
      const players = t.room.players.filter(p => p && p.connected && !p.sittingOut && (p.stack > 0 || t.room.mode === 'virtualcards'));
      if (players.length >= (t.room.mode === 'virtualcards' ? 1 : 2) && players.every(p => p!.ready)) {
        if (t.room.mode === 'virtualcards') vcDeal(t.room);
        else { t.room.gameStarted = true; startHand(t.room); }
      }
      broadcast(t);
    });
    on('startGame', (_data, t) => {
      if (!hostOnly()) return;
      if (t.room.mode !== 'unlimited' || t.room.gameStarted) return;
      if (t.room.paused) return error('Resume the game before starting.');
      applyPending(t);
      if (dealable(t) < 2) return error('Need at least two connected players sitting in with chips.');
      t.room.gameStarted = true;
      startHand(t.room); broadcast(t);
    });
    on('action', (data, t, m) => {
      if (m.seat < 0) return;
      if (t.room.paused) return error('Game is paused.');
      if (!['fold', 'check', 'call', 'raise'].includes(data.type)) return error('Invalid action.');
      if (data.type === 'raise' && !chipsValid(data.amount)) return error('Enter a valid whole chip amount.');
      const result = handleAction(t.room, m.seat, data);
      if (!result.valid) return error(result.error ?? 'Invalid action.');
      broadcast(t);
    });
    on('nextHand', (_data, t, m) => {
      if (m.seat < 0 || t.room.paused || !t.room.hand?.handOver) return;
      applyPending(t);
      if (checkMatchOver(t.room)) { broadcast(t); return; }
      const seats = t.room.players.flatMap((p, i) => p && p.connected && !p.sittingOut && p.stack > 0 ? [i] : []);
      if (seats.length < 2) return error('Need at least two connected players sitting in with chips.');
      t.room.dealerIndex = seats.find(s => s > t.room.dealerIndex) ?? seats[0];
      startHand(t.room); broadcast(t);
    });
    on('togglePause', (_data, t) => {
      if (!hostOnly()) return;
      if (t.room.paused && inHand(t) && t.room.hand?.participants.some(s => !t.room.players[s]?.connected && !t.evicted?.has(s))) return error('Wait for disconnected players to reconnect before resuming.');
      t.room.paused = !t.room.paused; broadcast(t);
    });
    on('setSittingOut', (data, t, m) => {
      if (m.seat < 0 || typeof data.sittingOut !== 'boolean') return;
      const p = t.room.players[m.seat]!;
      if (inHand(t) && t.room.hand!.participants.includes(m.seat)) {
        p.sitOutNextHand = data.sittingOut;
      } else { p.sittingOut = data.sittingOut; p.sitOutNextHand = false; p.ready = false; }
      broadcast(t);
    });
    on('transferHost', (data, t) => {
      if (!hostOnly()) return;
      const target = [...t.members.values()].find(m => m.id === data.id && io.sockets.sockets.has(m.socketId));
      if (!target) return error('Choose a connected member.');
      t.host = target.token; broadcast(t);
    });
    on('cashOut', (_data, t, m) => {
      if (m.seat < 0) return;
      if (inHand(t)) return error('Cash out after this hand finishes.');
      cashOut(t, m, 'Player cash-out'); broadcast(t);
    });
    on('rebuy', () => error('Ask the host to add chips using the table controls.'));
    on('vcNextPhase', (_data, t) => { if (hostOnly() && t.room.mode === 'virtualcards') { vcNextPhase(t.room); broadcast(t); } });
    on('vcNextHand', (_data, t) => { if (hostOnly() && t.room.mode === 'virtualcards') { vcDeal(t.room); broadcast(t); } });
    on('activateAvatarMode', (_data, t) => { if (hostOnly()) { t.room.avatarMode = true; if (t.classic && t.room.avatarAssignment.every(role => !role)) t.room.avatarAssignment = ['G', 'L']; syncAvatarPlayerNames(t.room); broadcast(t); } });
    on('setAvatarAssignment', (data, t) => {
      if (!hostOnly() || t.room.gameStarted || !t.room.avatarMode || ![0, 1].includes(data.playerIndex) || !['L', 'G'].includes(data.role)) return;
      t.room.avatarAssignment[data.playerIndex] = data.role;
      t.room.avatarAssignment[1 - data.playerIndex] = data.role === 'L' ? 'G' : 'L';
      syncAvatarPlayerNames(t.room); broadcast(t);
    });
    on('resetMatch', (_data, t) => {
      if (t.classic) return error('Use Reset game with the recovery password.');
      if (!hostOnly()) return;
      if (inHand(t)) return error('Finish the current hand before resetting.');
      const old = t.room; t.room = createRoom();
      Object.assign(t.room, { mode: old.mode, settings: old.settings, players: old.players,
        avatarMode: old.avatarMode, avatarAssignment: old.avatarAssignment });
      for (const p of t.room.players) if (p) { p.ready = false; p.holeCards = []; }
      broadcast(t);
    });
    function leave() {
      if (!table || !member) return;
      const t = table, m = member;
      if (inHand(t) && m.seat >= 0) return error('Finish this hand before leaving the table.');
      cashOut(t, m, 'Left table');
      t.members.delete(m.token); t.requests = t.requests.filter(r => r.token !== m.token);
      if (t.host === m.token) t.host = [...t.members.values()].find(p => io.sockets.sockets.has(p.socketId))?.token ?? t.members.keys().next().value ?? '';
      table = undefined; member = undefined; socket.emit('tableLeft', { ledger: t.ledger, tableCode: t.code });
      if (!t.members.size) tables.delete(t.code); else broadcast(t);
      directory();
    }
    on('leaveGame', leave); on('leaveTable', leave);
    on('kickPlayer', (data, t) => {
      if (!hostOnly() || !Number.isInteger(data.targetIndex) || data.targetIndex < 0) return;
      if (data.password !== '123') return error('Incorrect override password.');
      const target = [...t.members.values()].find(m => m.seat === data.targetIndex);
      if (!target || target.token === t.host) return error('Choose another seated player.');
      t.members.delete(target.token);
      t.requests = t.requests.filter(r => r.token !== target.token);
      if (inHand(t) && t.room.hand!.participants.includes(target.seat)) {
        t.room.players[target.seat]!.connected = false;
        (t.evicted ??= new Map()).set(target.seat, target);
        t.room.actionLog.push(`${target.name} was removed by the host and folds`);
      } else cashOut(t, target, 'Host removed player');
      io.to(target.socketId).emit('kicked', { message: 'The host removed you from this table.', ledger: t.ledger, tableCode: t.code });
      io.sockets.sockets.get(target.socketId)?.disconnect(true);
      broadcast(t);
    });
    socket.on('disconnect', () => {
      if (!table || !member || member.socketId !== socket.id || !table.members.has(member.token)) return;
      if (member.seat >= 0) {
        table.room.players[member.seat]!.connected = false;
        if (inHand(table) && table.room.hand!.participants.includes(member.seat)) {
          table.room.paused = true;
          table.room.actionLog.push(`${member.name} disconnected. Host can resume after reconnection.`);
        }
      }
      if (table.classic && member.seat < 0) table.members.delete(member.token);
      broadcast(table);
    });
    directory();
  });
}

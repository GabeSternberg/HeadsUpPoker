import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Deck, Card } from '../src/deck';
import { Room, createRoom, startHand, handleAction, getCurrentLegalActions, getClientState } from '../src/gameState';
import { evaluateHand, compareHands } from '../src/handEvaluator';

function table(stacks = new Array(9).fill(1000), bigBlind = 20): Room {
  const room = createRoom(); room.mode = 'unlimited'; room.gameStarted = true; room.settings.bigBlind = bigBlind;
  room.players = stacks.map((stack, seatIndex) => ({ id: String(seatIndex), name: `P${seatIndex}`, stack, seatIndex, ready: true, connected: true, holeCards: [] })); return room;
}
function act(room: Room, type: 'fold' | 'check' | 'call' | 'raise', amount?: number) {
  const result = handleAction(room, room.hand!.currentPlayerIndex, { type, amount }); assert.equal(result.valid, true, result.error);
}
function finish(room: Room) {
  for (let i = 0; !room.hand!.handOver; i++) { assert.ok(i < 500, 'hand must finish'); const legal = getCurrentLegalActions(room)!; act(room, legal.canCall ? 'call' : 'check'); }
}
function preflopCalls(room: Room) {
  while (room.hand!.round === 'preflop' && !room.hand!.handOver) { const legal = getCurrentLegalActions(room)!; act(room, legal.canCall ? 'call' : 'check'); }
}
function cards(text: string): Card[] {
  const suits = { h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' } as const;
  return text.split(' ').map(t => ({ suit: suits[t.slice(-1) as keyof typeof suits], rank: Number(t.slice(0, -1)) as Card['rank'] }));
}
function rig(room: Room, board: Card[], hands: Record<number, Card[]>) {
  const key = (c: Card) => `${c.rank}-${c.suit}`; const used = new Set([...board, ...Object.values(hands).flat()].map(key));
  const deck = new Deck().deal(52).filter(c => !used.has(key(c))); room.players.forEach((p, i) => { if (p) p.holeCards = hands[i] ?? deck.splice(0, 2); });
  let next = 0; room.hand!.deck.deal = n => board.slice(next, next += n);
}

test('all nine seats act in order on all streets and the BB keeps their option', () => {
  for (let dealer = 0; dealer < 9; dealer++) {
    const room = table(); room.dealerIndex = dealer; startHand(room);
    assert.equal(room.hand!.sbIndex, (dealer + 1) % 9); assert.equal(room.hand!.bbIndex, (dealer + 2) % 9);
    for (let i = 0; i < 9; i++) {
      assert.equal(room.hand!.currentPlayerIndex, (dealer + 3 + i) % 9);
      if (i < 8) act(room, 'call'); else { assert.equal(getCurrentLegalActions(room)!.canCheck, true); assert.equal(getCurrentLegalActions(room)!.canRaise, true); act(room, 'check'); }
    }
    for (const street of ['flop', 'turn', 'river']) { assert.equal(room.hand!.round, street); for (let i = 0; i < 9; i++) { assert.equal(room.hand!.currentPlayerIndex, (dealer + 1 + i) % 9); act(room, 'check'); } }
    assert.equal(room.hand!.handOver, true); assert.equal(room.hand!.communityCards.length, 5);
  }
});

test('a short all-in big blind does not lower the bring-in or minimum raise', () => {
  const room = table([1000,1000,5,1000,1000,1000,1000,1000,1000]); startHand(room);
  assert.equal(room.hand!.pot, 15); assert.equal(room.hand!.currentBet, 20); assert.equal(getCurrentLegalActions(room)!.callAmount, 20); assert.equal(getCurrentLegalActions(room)!.minRaise, 40);
});

test('one short all-in requires calls without reopening an earlier raiser', () => {
  const room = table([1000,1000,1000,1000,150,1000,1000,1000,1000]); startHand(room); act(room, 'raise', 100); act(room, 'raise', 150);
  while (room.hand!.currentPlayerIndex !== 3) act(room, 'fold');
  assert.equal(getCurrentLegalActions(room)!.canCall, true); assert.equal(getCurrentLegalActions(room)!.canRaise, false);
  const before = JSON.stringify(room.hand); assert.equal(handleAction(room, 3, { type: 'raise', amount: 300 }).valid, false); assert.equal(JSON.stringify(room.hand), before);
  act(room, 'call'); assert.equal(room.hand!.handOver, true);
});

test('cumulative short all-ins reopen only players facing a full raise since their last action', () => {
  const room = table([1000,1000,1000,1000,150,180,1000,1000,1000]); startHand(room); act(room, 'raise', 100); act(room, 'raise', 150); act(room, 'raise', 180);
  while (room.hand!.currentPlayerIndex !== 3) act(room, 'call');
  assert.equal(getCurrentLegalActions(room)!.canRaise, true); assert.equal(getCurrentLegalActions(room)!.minRaise, 260); act(room, 'raise', 260); assert.equal(getCurrentLegalActions(room)!.minRaise, 340);
});

test('calling a short all-in starts a new reopening threshold for that player', () => {
  const room = table([1000,1000,1000,1000,150,1000,210,1000,1000]); startHand(room); act(room, 'raise', 100); act(room, 'raise', 150); act(room, 'call'); act(room, 'raise', 210);
  while (room.hand!.currentPlayerIndex !== 3) act(room, 'call');
  assert.equal(getCurrentLegalActions(room)!.canRaise, true); act(room, 'call');
  assert.equal(room.hand!.currentPlayerIndex, 5); assert.equal(getCurrentLegalActions(room)!.canRaise, false); // 210 - 150 is less than 80
});

test('one funded player cannot raise against only all-ins and the board runs out after their call', () => {
  const room = table([10,10,10,1000,10,10,10,10,10]); startHand(room); act(room, 'call');
  while (room.hand!.currentPlayerIndex !== 3 && !room.hand!.handOver) act(room, 'call');
  assert.equal(room.hand!.handOver, true); assert.equal(room.hand!.communityCards.length, 5);
});

test('a lone player cannot bet into a dry side pot', () => {
  const room = table([1000,1000,1000,1000,50,1000,1000,1000,1000]); startHand(room); act(room, 'call'); act(room, 'raise', 50);
  while (room.hand!.currentPlayerIndex !== 3) act(room, 'fold');
  assert.equal(getCurrentLegalActions(room)!.callAmount, 30); assert.equal(getCurrentLegalActions(room)!.canRaise, false); act(room, 'call'); assert.equal(room.hand!.handOver, true);
});

test('nine all-ins pay the main and side pots to the correct different winners', () => {
  const room = table([100,200,300,400,500,600,700,800,900]); startHand(room);
  const board = cards('2h 4d 7c 9s 11h');
  rig(room, board, { 0: cards('14c 14d'), 1: cards('10c 10d'), 2: cards('8c 8d'), 3: cards('13c 13d'), 4: cards('6c 6d'), 5: cards('5c 5d'), 6: cards('3c 3d'), 7: cards('14s 13s'), 8: cards('12c 12d') });
  const h = room.hand!;
  for (let step = 0; !h.handOver; step++) {
    assert.ok(step < 12); const legal = getCurrentLegalActions(room)!;
    act(room, legal.canRaise ? 'raise' : legal.canCall ? 'call' : 'check', legal.canRaise ? legal.maxRaise : undefined);
  }
  assert.deepEqual(room.players.map(p => p!.stack), [900,0,0,2100,0,0,0,0,1500]);
  const settled = getClientState(room, -1).hand!;
  assert.deepEqual(settled.pots.map(pot => pot.amount), [900,800,700,600,500,400,300,200]);
  assert.equal(settled.pots[0].awards[0].seat, 0);
  assert.equal(settled.pots[1].awards[0].seat, 3);
  assert.equal(settled.pots[4].awards[0].seat, 8);
  assert.equal(settled.uncalled, 0);
  assert.ok(h.resultMessage.includes('P3'), 'side-pot winners must be included in the result'); assert.ok(h.resultMessage.includes('P8'));
});

test('split pots distribute multiple odd chips one at a time left of the dealer', () => {
  const room = table(new Array(9).fill(100), 2); room.dealerIndex = 2; startHand(room); const board = cards('14h 13h 12h 11h 10h'); rig(room, board, {});
  const h = room.hand!; h.round = 'river'; h.communityCards = board;
  room.players.forEach((p, i) => { p!.stack = i < 5 ? 99 : 100; h.playerFolded[i] = ![0,2,4].includes(i); });
  h.pot = 5; h.playerBets.fill(0); h.currentBet = 0; h.playerActedThisRound.fill(true); h.currentPlayerIndex = 4;
  act(room, 'check'); assert.equal(room.players[4]!.stack, 101); assert.equal(room.players[0]!.stack, 101); assert.equal(room.players[2]!.stack, 100);
});

test('invalid raises cannot introduce non-finite, negative, or sub-chip balances', () => {
  for (const amount of [NaN, Infinity, -10, 0, 0.25, 50.25]) {
    const room = table(); startHand(room); const before = JSON.stringify(room.hand);
    assert.equal(handleAction(room, 3, { type: 'raise', amount }).valid, false, `reject ${amount}`); assert.equal(JSON.stringify(room.hand), before);
  }
});

test('empty, disconnected, busted, and sitting-out seats are skipped on every street', () => {
  const room = table(); room.players[0]!.sittingOut = true; room.players[1] = null;
  room.players[4]!.connected = false; room.players[7]!.stack = 0; startHand(room);
  assert.deepEqual([...room.hand!.participants].sort(), [2,3,5,6,8]);
  const total = room.players.reduce((n, p) => n + (p?.stack ?? 0), 0) + room.hand!.pot;
  finish(room); assert.equal(room.players.reduce((n, p) => n + (p?.stack ?? 0), 0), total);
  for (const i of [0,4]) assert.equal(room.players[i]!.stack, 1000);
});

test('a short opening all-in preserves the minimum raise and does not reopen a checker', () => {
  const room = table([1000,1000,25,1000,1000,1000,1000,1000,1000]); startHand(room); preflopCalls(room);
  act(room, 'check'); act(room, 'raise', 5);
  assert.equal(getCurrentLegalActions(room)!.minRaise, 25);
  while (room.hand!.currentPlayerIndex !== 1) act(room, 'call');
  assert.equal(getCurrentLegalActions(room)!.canRaise, false); act(room, 'call'); assert.equal(room.hand!.round, 'turn');
});

test('uncalled overbets are refunded before automatically running out the board', () => {
  const room = table([10,10,10,1000,10,10,10,10,10]); startHand(room);
  act(room, 'raise', 1000);
  while (!room.hand!.handOver) { const legal = getCurrentLegalActions(room)!; act(room, legal.canCall ? 'call' : 'check'); }
  assert.ok(room.players[3]!.stack >= 990); assert.ok(room.actionLog.some(line => line.includes('990 uncalled')));
  assert.equal(room.players.reduce((n, p) => n + p!.stack, 0), 1080);
});

test('a lone funded small blind does not owe an uncallable nominal big blind', () => {
  const room = table([1000,1000,5,1000,1000,1000,1000,1000,1000]); startHand(room);
  while (!room.hand!.handOver && room.hand!.currentPlayerIndex !== 1) act(room, 'fold');
  assert.equal(room.hand!.handOver, true); assert.ok(room.players[1]!.stack >= 995);
  assert.equal(room.players.reduce((n, p) => n + p!.stack, 0), 8005);
});

test('fractional blinds and half-chip all-ins settle without losing chips', () => {
  const room = table(new Array(9).fill(101), 21); startHand(room);
  while (room.hand!.round === 'preflop') { const legal = getCurrentLegalActions(room)!; act(room, legal.canRaise ? 'raise' : legal.canCall ? 'call' : 'check', legal.canRaise ? legal.maxRaise : undefined); }
  if (!room.hand!.handOver) finish(room);
  assert.equal(room.players.reduce((n, p) => n + p!.stack, 0), 909);
});

test('blind progression remains fair when a blind busts and when the table becomes heads-up', async () => {
  const { advanceDealer } = await import('../src/gameState');
  const room = table(); startHand(room); const priorBB = room.hand!.bbIndex;
  room.players[1]!.stack = 0; advanceDealer(room); startHand(room);
  assert.equal(room.hand!.bbIndex, (priorBB + 1) % 9);
  const two = table(); two.players.forEach((p, i) => { if (![0,1,2].includes(i)) p!.sittingOut = true; }); startHand(two);
  assert.equal(two.hand!.bbIndex, 2); two.players[0]!.stack = 0; advanceDealer(two); startHand(two);
  assert.equal(two.hand!.bbIndex, 1); assert.equal(two.hand!.dealerIndex, 2);
});

function rng(seed: number): () => number {
  let state = seed || 1; return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
}
function expectedStacks(room: Room, spent: number[], halfChips: boolean): number[] {
  const h = room.hand!, expected = h.startingStacks.map((chips, i) => chips - spent[i]);
  const live = h.participants.filter(i => !h.playerFolded[i]);
  if (live.length === 1) { expected[live[0]] += spent.reduce((a, b) => a + b, 0); return expected; }
  const values = new Map(live.map(i => [i, evaluateHand([...room.players[i]!.holeCards, ...h.communityCards])]));
  let previous = 0;
  const pots: { eligible: number[]; amount: number }[] = [];
  for (const level of [...new Set(spent.filter(x => x > 0))].sort((a,b) => a - b)) {
    const contributors = spent.flatMap((amount, i) => amount >= level ? [i] : []), amount = (level - previous) * contributors.length; previous = level;
    if (contributors.length === 1) { expected[contributors[0]] += amount; continue; }
    const eligible = contributors.filter(i => live.includes(i)); assert.ok(eligible.length > 0, 'every contested pot has a live eligible player');
    const last = pots[pots.length - 1];
    if (last && JSON.stringify(last.eligible) === JSON.stringify(eligible)) last.amount += amount;
    else pots.push({ eligible, amount });
  }
  for (const { eligible, amount } of pots) {
    const best = eligible.reduce((a,b) => compareHands(values.get(a)!, values.get(b)!) >= 0 ? a : b);
    const winners = eligible.filter(i => compareHands(values.get(i)!, values.get(best)!) === 0).sort((a,b) => ((a - h.dealerIndex + 8) % 9) - ((b - h.dealerIndex + 8) % 9));
    const unit = halfChips ? 0.5 : 1, ticks = Math.round(amount / unit), share = Math.floor(ticks / winners.length), remainder = ticks % winners.length;
    winners.forEach((seat,i) => expected[seat] += (share + (i < remainder ? 1 : 0)) * unit);
  }
  return expected;
}

test('3,000 generated nine-handed games preserve exact stacks, card privacy, and liveness', () => {
  for (let seed = 1; seed <= 3000; seed++) {
    const random = rng(seed * 7919), stacks = Array.from({ length: 9 }, () => 1 + Math.floor(random() * 800));
    const bigBlind = 1 + Math.floor(random() * 60), room = table(stacks, bigBlind);
    room.dealerIndex = seed % 9; startHand(room);
    const deck = new Deck().deal(52).sort((a,b) => a.rank - b.rank || a.suit.localeCompare(b.suit));
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [deck[i],deck[j]] = [deck[j],deck[i]]; }
    rig(room, deck.slice(18,23), Object.fromEntries(room.players.map((_,i) => [i, deck.slice(2*i,2*i+2)])));
    const spent = [...room.hand!.playerBets]; let halfChips = bigBlind % 2 !== 0;
    const total = stacks.reduce((a,b) => a + b, 0);
    for (let step = 0; !room.hand!.handOver; step++) {
      assert.ok(step < 1000, `seed ${seed} must terminate`);
      const h = room.hand!, seat = h.currentPlayerIndex, legal = getCurrentLegalActions(room)!;
      assert.equal(h.playerFolded[seat], false); assert.equal(h.playerAllIn[seat], false);
      const choice = random(); let type: 'fold' | 'check' | 'call' | 'raise', amount: number | undefined;
      if (choice < 0.14 && legal.canFold) type = 'fold';
      else if (choice < 0.5 && legal.canRaise) {
        type = 'raise'; const range = legal.maxRaise - legal.minRaise;
        amount = random() < 0.4 ? legal.maxRaise : legal.minRaise + Math.floor(random() * (range + 1));
        amount = Math.min(amount, legal.maxRaise);
      } else type = legal.canCheck ? 'check' : 'call';
      const chips = type === 'call' ? legal.callAmount : type === 'raise' ? amount! - h.playerBets[seat] : 0;
      spent[seat] += chips; if (!Number.isInteger(chips)) halfChips = true;
      const result = handleAction(room, seat, { type, amount }); assert.equal(result.valid, true, `seed ${seed}: ${result.error}`);
      assert.equal(room.players.reduce((n,p) => n + p!.stack, 0) + h.pot, total, `seed ${seed}: chip conservation`);
      assert.ok(room.players.every(p => Number.isFinite(p!.stack) && p!.stack >= 0 && Number.isInteger(p!.stack * 2)), `seed ${seed}: valid balances`);
      const breakdown = getClientState(room, -1).hand!;
      assert.equal(breakdown.pots.reduce((sum, pot) => sum + pot.amount, 0) + breakdown.uncalled, h.handOver ? breakdown.pots.reduce((sum, pot) => sum + pot.amount, 0) : h.pot, `seed ${seed}: displayed pot accounting`);
      if (h.handOver) assert.equal(breakdown.pots.flatMap(pot => pot.awards).reduce((sum, award) => sum + award.amount, 0), breakdown.pots.reduce((sum, pot) => sum + pot.amount, 0));
      if (!h.handOver) for (let viewer = -1; viewer < 9; viewer++) {
        const state = getClientState(room, viewer);
        state.players.forEach((p,i) => { if (i !== viewer) assert.equal(p!.holeCards, null); });
      }
    }
    const h = room.hand!, allCards = [...room.players.flatMap(p => p!.holeCards), ...h.communityCards];
    assert.equal(new Set(allCards.map(c => `${c.suit}-${c.rank}`)).size, allCards.length);
    assert.deepEqual(room.players.map(p => p!.stack), expectedStacks(room, spent, halfChips), `seed ${seed}: exact payouts`);
  }
});

test('showdown ranking handles wheels, two triples, flush kickers, quads, and playing the board', () => {
  const score = (text: string) => evaluateHand(cards(text));
  assert.equal(score('14c 13s 2h 3d 4s 5c 9h').ranks[0], 5);
  assert.ok(compareHands(score('6s 13d 2h 3d 4s 5c 9h'), score('14c 13s 2h 3d 4s 5c 9h')) > 0);
  assert.deepEqual(score('14c 13h 14h 14d 13c 13s 2h').ranks, [14,13]);
  assert.ok(compareHands(score('13h 14c 14h 10h 8h 5h 2c'), score('12h 9c 14h 10h 8h 5h 2c')) > 0);
  assert.ok(compareHands(score('14s 13s 9h 9s 9d 9c 2h'), score('13h 12s 9h 9s 9d 9c 2h')) > 0);
  assert.equal(compareHands(score('2c 3c 14h 13h 12h 11h 10h'), score('4s 5s 14h 13h 12h 11h 10h')), 0);
});

test('side pots appear live only after all-in caps and exclude unmatched bets', () => {
  const room = table([100,500,500,0,0,0,0,0,0]); startHand(room);
  act(room, 'raise', 100); act(room, 'call'); act(room, 'raise', 200);
  let visible = getClientState(room, 0).hand!;
  assert.deepEqual(visible.pots.map(p => p.amount), [300]); assert.equal(visible.uncalled, 100);
  assert.equal(visible.pot, 400); // the extra 100 has not been called yet
  act(room, 'call'); visible = getClientState(room, 0).hand!;
  assert.deepEqual(visible.pots.map(p => p.amount), [300,200]);
  assert.deepEqual(visible.pots[0].eligiblePlayers.map(p => p.seat), [1,2,0]);
  assert.deepEqual(visible.pots[1].eligiblePlayers.map(p => p.seat), [1,2]);
  assert.equal(visible.uncalled, 0); assert.equal(visible.pot, 500);
  assert.ok(visible.pots.every(p => p.awards.length === 0));
});

test('multiple side pots remain visible after awards and later seat/chip changes', () => {
  const room = table([100,200,500,500,0,0,0,0,0]); startHand(room);
  act(room, 'raise', 300); act(room, 'call'); act(room, 'call'); act(room, 'call');
  let visible = getClientState(room, -1).hand!;
  assert.deepEqual(visible.pots.map(p => p.amount), [400,300,200]);
  assert.deepEqual(visible.pots[2].eligiblePlayers.map(p => p.seat), [2,3]);
  finish(room); visible = getClientState(room, -1).hand!;
  assert.deepEqual(visible.pots.map(p => p.amount), [400,300,200]);
  assert.ok(visible.pots.every(p => p.awards.reduce((sum, award) => sum + award.amount, 0) === p.amount));
  const original = JSON.stringify(visible.pots);
  room.players[0]!.stack += 500; room.players[1] = null;
  assert.equal(JSON.stringify(getClientState(room, -1).hand!.pots), original);
  startHand(room); assert.deepEqual(getClientState(room, -1).hand!.pots.map(p => p.awards.length), [0]);
});

test('folded contributions do not create fake side pots or extra odd-chip awards', () => {
  const room = table(new Array(9).fill(100), 2); startHand(room);
  const board = cards('14h 13h 12h 11h 10h'); rig(room, board, {});
  const invested = [5,5,1,2,3,0,0,0,0], h = room.hand!;
  h.round = 'river'; h.communityCards = board; h.pot = 16; h.currentBet = 0; h.playerBets.fill(0); h.playerActedThisRound.fill(true);
  room.players.forEach((p, i) => { p!.stack = 100 - invested[i]; h.playerFolded[i] = i > 1; });
  h.currentPlayerIndex = 1;
  assert.deepEqual(getClientState(room, -1).hand!.pots.map(p => p.amount), [16]);
  act(room, 'check'); assert.equal(room.players[0]!.stack, 103); assert.equal(room.players[1]!.stack, 103);
  assert.equal(getClientState(room, -1).hand!.pots.length, 1);
});

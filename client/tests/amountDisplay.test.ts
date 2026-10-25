import assert from 'node:assert/strict';
import test from 'node:test';
import { amountScale, formatAmount, formatAmountText, readAmountPreferences, toChipAmount, validCashPerBB } from '../src/amountDisplay';

const chips = { unit: 'chips', cashPerBB: null } as const;
const bb = { unit: 'bb', cashPerBB: null } as const;
const cash = { unit: 'cash', cashPerBB: 2 } as const;

test('the same stack is displayed as chips, BB, or dollars using the current blind', () => {
  assert.equal(formatAmount(1000, chips, 20), '1,000');
  assert.equal(formatAmount(1000, bb, 20), '50 BB');
  assert.equal(formatAmount(1000, cash, 20), '$100.00');
  assert.equal(formatAmount(1000, cash, 10), '$200.00');
  assert.equal(formatAmount(0, cash, 20), '$0.00');
});

test('fractional blinds and small cash amounts retain useful precision', () => {
  assert.equal(formatAmount(0.5, chips, 1), '0.5');
  assert.equal(formatAmount(0.5, bb, 20), '0.025 BB');
  assert.equal(formatAmount(0.5, { unit: 'cash', cashPerBB: 0.01 }, 20), '$0.0003');
  assert.equal(formatAmount(5, cash, 20), '$0.50');
});

test('cash requires a finite positive value, including when restoring storage', () => {
  for (const invalid of [null, 0, -1, NaN, Infinity, '2', undefined]) assert.equal(validCashPerBB(invalid), false);
  for (const saved of [null, '{', 'null', '{"unit":"cash"}', '{"unit":"cash","cashPerBB":0}', '{"unit":"unknown"}']) {
    assert.equal(readAmountPreferences(saved).unit, 'chips');
  }
  assert.deepEqual(readAmountPreferences(JSON.stringify(cash)), cash);
  assert.deepEqual(readAmountPreferences(JSON.stringify(bb)), bb);
});

test('unit input converts back to exact chips and legal half chips', () => {
  assert.equal(toChipAmount(3, amountScale(bb, 20)), 60);
  assert.equal(toChipAmount(6, amountScale(cash, 20)), 60);
  assert.equal(toChipAmount(1.025, amountScale(bb, 20)), 20.5);
  assert.equal(toChipAmount(2.05, amountScale(cash, 20)), 20.5);
  assert.equal(toChipAmount(1.011, amountScale(bb, 20)), 20);
  for (const preferences of [chips, bb, cash, { unit: 'cash', cashPerBB: 0.03 } as const]) {
    for (const blind of [1, 3, 20, 999]) {
      const scale = amountScale(preferences, blind);
      for (const amount of [0.5, 1, 20.5, 500, 999999.5]) assert.equal(toChipAmount(Number((amount * scale).toPrecision(12)), scale), amount);
    }
  }
});

test('hand logs and results convert only amount-bearing phrases', () => {
  const format = (amount: number) => formatAmount(amount, bb, 20);
  const cases = [
    ['Player 20 posts small blind (10)', 'Player 20 posts small blind (0.5 BB)'],
    ['Player 20 posts big blind (20)', 'Player 20 posts big blind (1 BB)'],
    ['Player 20 calls all-in (10.5)', 'Player 20 calls all-in (0.525 BB)'],
    ['Player 20 raises all-in to 100', 'Player 20 raises all-in to 5 BB'],
    ['Player 20 wins the pot (100)', 'Player 20 wins the pot (5 BB)'],
    ['Player 20 wins 100 with Pair of 10s', 'Player 20 wins 5 BB with Pair of 10s'],
    ['Pot results: Player 20 wins 100; Player 2 wins 200', 'Pot results: Player 20 wins 5 BB; Player 2 wins 10 BB'],
    ['Player 20 receives 10 uncalled chips back', 'Player 20 receives 0.5 BB uncalled back'],
    ['--- Hand #20 ---', '--- Hand #20 ---'],
    ['Host renamed "Player 20" to "Player 100"', 'Host renamed "Player 20" to "Player 100"'],
  ];
  for (const [before, after] of cases) assert.equal(formatAmountText(before, format), after);
});

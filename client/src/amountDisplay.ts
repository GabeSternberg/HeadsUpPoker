export type AmountUnit = 'chips' | 'bb' | 'cash';
export interface AmountPreferences { unit: AmountUnit; cashPerBB: number | null }
export const DEFAULT_AMOUNTS: AmountPreferences = { unit: 'chips', cashPerBB: null };
export const AMOUNT_STORAGE_KEY = 'pokerAmountDisplay';

export function validCashPerBB(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function readAmountPreferences(saved: string | null): AmountPreferences {
  try {
    const value = JSON.parse(saved || 'null');
    const cashPerBB = validCashPerBB(value?.cashPerBB) ? value.cashPerBB : null;
    const unit = value?.unit === 'bb' || (value?.unit === 'cash' && cashPerBB !== null) ? value.unit : 'chips';
    return { unit, cashPerBB };
  } catch { return { ...DEFAULT_AMOUNTS }; }
}

export function amountScale(preferences: AmountPreferences, bigBlind: number): number {
  if (!Number.isFinite(bigBlind) || bigBlind <= 0) return 1;
  if (preferences.unit === 'bb') return 1 / bigBlind;
  if (preferences.unit === 'cash' && validCashPerBB(preferences.cashPerBB)) return preferences.cashPerBB / bigBlind;
  return 1;
}

export function formatAmount(chips: number, preferences: AmountPreferences, bigBlind: number): string {
  const value = chips * amountScale(preferences, bigBlind);
  if (preferences.unit === 'cash' && validCashPerBB(preferences.cashPerBB)) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(value);
  }
  const number = value.toLocaleString('en-US', { maximumFractionDigits: preferences.unit === 'bb' ? 4 : 1 });
  return preferences.unit === 'bb' ? `${number} BB` : number;
}

// Match only amount-bearing phrases emitted by the server, preserving names,
// hand numbers, card ranks and side-pot numbers.
export function formatAmountText(text: string, format: (chips: number) => string): string {
  return text
    .replace(/((?:posts (?:small|big) blind|calls(?: all-in)?|wins the pot) \()(\d+(?:\.\d+)?)(\))$/g, (_, before, amount, after) => before + format(Number(amount)) + after)
    .replace(/(raises(?: all-in)? to |wins )(\d+(?:\.\d+)?)(?= with |; |$)/g, (_, before, amount) => before + format(Number(amount)))
    .replace(/(receives )(\d+(?:\.\d+)?)( uncalled chips back)$/g, (_, before, amount) => before + format(Number(amount)) + ' uncalled back');
}

export function toChipAmount(value: number, scale: number): number {
  return Math.round(value / scale * 2) / 2;
}

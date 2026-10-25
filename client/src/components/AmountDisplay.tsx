import { createContext, ReactNode, useContext, useEffect, useId, useState } from 'react';
import { AMOUNT_STORAGE_KEY, AmountPreferences, AmountUnit, DEFAULT_AMOUNTS, amountScale, formatAmount, formatAmountText, readAmountPreferences, validCashPerBB } from '../amountDisplay';

const PreferencesContext = createContext({ preferences: DEFAULT_AMOUNTS, update: (_: AmountPreferences) => {} });
const BlindContext = createContext(1);

export function AmountPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(() => {
    try { return readAmountPreferences(localStorage.getItem(AMOUNT_STORAGE_KEY)); } catch { return DEFAULT_AMOUNTS; }
  });
  const update = (next: AmountPreferences) => {
    setPreferences(next);
    try { localStorage.setItem(AMOUNT_STORAGE_KEY, JSON.stringify(next)); } catch { /* Session preference still works. */ }
  };
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === AMOUNT_STORAGE_KEY || event.key === null) setPreferences(readAmountPreferences(event.newValue)); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  return <PreferencesContext.Provider value={{ preferences, update }}>{children}</PreferencesContext.Provider>;
}

export function AmountDisplayProvider({ bigBlind, children }: { bigBlind: number; children: ReactNode }) {
  return <BlindContext.Provider value={bigBlind}>{children}</BlindContext.Provider>;
}

export function useAmountDisplay() {
  const { preferences } = useContext(PreferencesContext);
  const bigBlind = useContext(BlindContext);
  const format = (chips: number) => formatAmount(chips, preferences, bigBlind);
  return {
    format,
    formatText: (text: string) => preferences.unit === 'chips' ? text : formatAmountText(text, format),
    scale: amountScale(preferences, bigBlind),
    unit: preferences.unit,
    unitLabel: preferences.unit === 'bb' ? 'BB' : preferences.unit === 'cash' ? 'USD' : 'chips',
  };
}

export default function AmountDisplaySettings() {
  const { preferences, update } = useContext(PreferencesContext);
  const [cashInput, setCashInput] = useState(preferences.cashPerBB?.toString() ?? '');
  const [unit, setUnit] = useState(preferences.unit);
  const id = useId();
  useEffect(() => { setUnit(preferences.unit); setCashInput(preferences.cashPerBB?.toString() ?? ''); }, [preferences]);
  const valid = validCashPerBB(Number(cashInput));
  return <details className="amount-display-settings">
    <summary>Amount display: {preferences.unit === 'bb' ? 'Big blinds' : preferences.unit === 'cash' ? 'Cash (USD)' : 'Chips'}</summary>
    <form onSubmit={event => { event.preventDefault(); if (unit !== 'cash' || valid) update({ unit, cashPerBB: valid ? Number(cashInput) : preferences.cashPerBB }); }}>
      <label htmlFor={`${id}-unit`}>Display amounts in</label>
      <select id={`${id}-unit`} value={unit} onChange={event => setUnit(event.target.value as AmountUnit)}>
        <option value="chips">Chips</option><option value="bb">Big blinds (BB)</option><option value="cash">Cash (USD)</option>
      </select>
      {unit === 'cash' && <>
        <label htmlFor={`${id}-cash`}>Value of 1 BB ($)</label>
        <input id={`${id}-cash`} type="number" inputMode="decimal" min="0" step="any" required value={cashInput} aria-describedby={`${id}-hint`} onChange={event => setCashInput(event.target.value)} />
        <p id={`${id}-hint`}>{valid ? 'For example, 1 BB = $2 makes 100 BB display as $200.00.' : 'Enter a dollar amount greater than zero to use cash.'}</p>
      </>}
      <button className="btn" type="submit" disabled={unit === 'cash' && !valid}>Save display</button>
      <p>Saved for you on this browser. Uses this table’s big blind.</p>
    </form>
  </details>;
}

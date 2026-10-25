import { useState, useEffect } from 'react';
import { LegalActions } from '../types';
import { useAmountDisplay } from './AmountDisplay';
import { toChipAmount } from '../amountDisplay';

interface ActionPanelProps {
  legalActions: LegalActions;
  onAction: (type: string, amount?: number) => void;
  pot: number;
  currentBet: number;
  isMobile?: boolean;
}

export default function ActionPanel({ legalActions, onAction, pot, currentBet, isMobile }: ActionPanelProps) {
  const { format, scale, unitLabel } = useAmountDisplay();
  const inputForChips = (chips: number) => String(Number((chips * scale).toPrecision(12)));
  const { minRaise, maxRaise } = legalActions;
  const [keypad, setKeypad] = useState(() => inputForChips(minRaise));

  useEffect(() => {
    setKeypad(inputForChips(minRaise));
  }, [minRaise, maxRaise, scale]);

  const isEmpty = keypad === '';
  const raiseAmount = Math.max(minRaise, Math.min(maxRaise, toChipAmount(Number(keypad), scale) || minRaise));

  function pressDigit(d: string) {
    setKeypad(prev => {
      if (d === '.') return prev.includes('.') ? prev : (prev || '0') + '.';
      const next = prev === '' || prev === '0' ? d : prev + d;
      const num = Number(next);
      if (num > maxRaise * scale) return inputForChips(maxRaise);
      return next;
    });
  }

  function pressDelete() {
    setKeypad(prev => prev.slice(0, -1));
  }

  function setPreset(val: number) {
    const clamped = Math.max(minRaise, Math.min(maxRaise, Math.floor(val)));
    setKeypad(inputForChips(clamped));
  }

  function adjustBy(delta: number) {
    const next = Math.max(minRaise, Math.min(maxRaise, raiseAmount + delta));
    setKeypad(inputForChips(next));
  }

  const hasFold = legalActions.canFold && !legalActions.canCheck;
  const isAllIn = raiseAmount === maxRaise;

  return (
    <div className="action-panel">
      {/* Top row: check/call — fold (if any) — raise, all equal width */}
      <div className="action-trio">
        {legalActions.canCheck && (
          <button className="btn btn-check btn-check-free btn-trio" onClick={() => onAction('check')}>
            Check
          </button>
        )}
        {legalActions.canCall && (
          <button className="btn btn-call btn-trio" onClick={() => onAction('call')}>
            Call {format(legalActions.callAmount)}
          </button>
        )}
        {hasFold && (
          <button className="btn btn-fold btn-trio" onClick={() => onAction('fold')}>
            Fold
          </button>
        )}
        {legalActions.canRaise && (
          <button className="btn btn-raise btn-trio" onClick={() => onAction('raise', raiseAmount)}>
            Raise {format(raiseAmount)}{isAllIn ? ' (All In)' : ''}
          </button>
        )}
      </div>

      {/* Raise controls */}
      {legalActions.canRaise && (
        <div className="raise-controls">
          <div className="raise-presets">
            <button className="btn btn-preset" onClick={() => adjustBy(-10)}>-{format(10)}</button>
            <button className="btn btn-preset" onClick={() => adjustBy(10)}>+{format(10)}</button>
            <button className="btn btn-preset" disabled={currentBet === 0} onClick={() => setPreset(currentBet * 3)}>3x Bet</button>
            <button className="btn btn-preset" disabled={currentBet === 0} onClick={() => setPreset(currentBet * 4)}>4x Bet</button>
            <button className="btn btn-preset" onClick={() => setPreset(Math.floor(pot / 4))}>1/4 Pot</button>
            <button className="btn btn-preset" onClick={() => setPreset(Math.floor(pot / 2))}>1/2 Pot</button>
            <button className="btn btn-preset" onClick={() => setPreset(Math.floor(pot * 3 / 4))}>3/4 Pot</button>
            <button className="btn btn-preset" onClick={() => setPreset(pot)}>Pot</button>
            <button className="btn btn-preset" onClick={() => setPreset(Math.floor(pot * 3 / 2))}>1.5x Pot</button>
            <button className="btn btn-preset" onClick={() => setPreset(pot * 2)}>2x Pot</button>
          </div>
          {isMobile ? (
            <>
              <div className={`keypad-display${isEmpty ? ' keypad-display-empty' : ''}`}>
                {isEmpty ? 'EMPTY' : `${keypad} ${unitLabel}`}
              </div>
              <div className="raise-keypad">
                {['1','2','3','4','5','6','7','8','9'].map(d => (
                  <button key={d} className="btn btn-key" onClick={() => pressDigit(d)}>{d}</button>
                ))}
                <button className="btn btn-key" onClick={() => pressDigit('0')}>0</button>
                <button className="btn btn-key" aria-label="Decimal point" onClick={() => pressDigit('.')}>.</button>
                <button className="btn btn-key btn-key-del" onClick={pressDelete}>⌫</button>
              </div>
            </>
          ) : (
            <div className="raise-slider-row">
              <input
                type="range"
                aria-label="Raise amount slider"
                min={minRaise}
                max={maxRaise}
                step={0.5}
                value={raiseAmount}
                onChange={e => setKeypad(inputForChips(Number(e.target.value)))}
              />
              <input
                type="number"
                aria-label={`Raise amount (${unitLabel})`}
                min={minRaise * scale}
                max={maxRaise * scale}
                step="any"
                value={keypad}
                onChange={e => setKeypad(e.target.value)}
                onBlur={e => {
                  const val = toChipAmount(Number(e.target.value), scale);
                  if (!e.target.value || isNaN(val) || val < minRaise) {
                    setKeypad(inputForChips(minRaise));
                  } else if (val > maxRaise) {
                    setKeypad(inputForChips(maxRaise));
                  } else setKeypad(inputForChips(val));
                }}
              />
              <span className="raise-unit">{unitLabel}</span>
              {isAllIn && <span className="all-in-tag">ALL IN</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

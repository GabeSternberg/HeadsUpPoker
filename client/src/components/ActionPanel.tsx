import { useState, useEffect } from 'react';
import { LegalActions } from '../types';

interface ActionPanelProps {
  legalActions: LegalActions;
  onAction: (type: string, amount?: number) => void;
  pot: number;
  isMobile?: boolean;
}

export default function ActionPanel({ legalActions, onAction, pot, isMobile }: ActionPanelProps) {
  const { minRaise, maxRaise } = legalActions;
  const [keypad, setKeypad] = useState(String(minRaise));

  useEffect(() => {
    setKeypad(String(minRaise));
  }, [minRaise, maxRaise]);

  const isEmpty = keypad === '';
  const raiseAmount = Math.max(minRaise, Math.min(maxRaise, Number(keypad) || minRaise));

  function pressDigit(d: string) {
    setKeypad(prev => {
      const next = prev === '' || prev === '0' ? d : prev + d;
      const num = Number(next);
      if (num > maxRaise) return String(maxRaise);
      return next;
    });
  }

  function pressDelete() {
    setKeypad(prev => prev.slice(0, -1));
  }

  function setPreset(val: number) {
    const clamped = Math.max(minRaise, Math.min(maxRaise, Math.floor(val)));
    setKeypad(String(clamped));
  }

  function adjustBy(delta: number) {
    const next = Math.max(minRaise, Math.min(maxRaise, raiseAmount + delta));
    setKeypad(String(next));
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
            Call {legalActions.callAmount}
          </button>
        )}
        {hasFold && (
          <button className="btn btn-fold btn-trio" onClick={() => onAction('fold')}>
            Fold
          </button>
        )}
        {legalActions.canRaise && (
          <button className="btn btn-raise btn-trio" onClick={() => onAction('raise', raiseAmount)}>
            Raise {raiseAmount}{isAllIn ? ' (All In)' : ''}
          </button>
        )}
      </div>

      {/* Raise controls */}
      {legalActions.canRaise && (
        <div className="raise-controls">
          <div className="raise-presets">
            <button className="btn btn-preset" onClick={() => adjustBy(-10)}>-10</button>
            <button className="btn btn-preset" onClick={() => adjustBy(10)}>+10</button>
            <button className="btn btn-preset" onClick={() => setPreset(Math.floor(pot / 2))}>1/2 Pot</button>
            <button className="btn btn-preset" onClick={() => setPreset(Math.floor(pot * 3 / 4))}>3/4 Pot</button>
            <button className="btn btn-preset" onClick={() => setPreset(pot)}>Pot</button>
            <button className="btn btn-preset" onClick={() => setPreset(pot * 2)}>2x Pot</button>
          </div>
          {isMobile ? (
            <>
              <div className={`keypad-display${isEmpty ? ' keypad-display-empty' : ''}`}>
                {isEmpty ? 'EMPTY' : keypad}
              </div>
              <div className="raise-keypad">
                {['1','2','3','4','5','6','7','8','9'].map(d => (
                  <button key={d} className="btn btn-key" onClick={() => pressDigit(d)}>{d}</button>
                ))}
                <button className="btn btn-key" onClick={() => pressDigit('0')}>0</button>
                <button className="btn btn-key btn-key-del" onClick={pressDelete}>⌫</button>
              </div>
            </>
          ) : (
            <div className="raise-slider-row">
              <input
                type="range"
                min={minRaise}
                max={maxRaise}
                value={raiseAmount}
                onChange={e => setKeypad(e.target.value)}
              />
              <input
                type="number"
                value={keypad}
                onChange={e => setKeypad(e.target.value)}
                onBlur={e => {
                  const val = Number(e.target.value);
                  if (!e.target.value || isNaN(val) || val < minRaise) {
                    setKeypad(String(minRaise));
                  } else if (val > maxRaise) {
                    setKeypad(String(maxRaise));
                  }
                }}
              />
              {isAllIn && <span className="all-in-tag">ALL IN</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

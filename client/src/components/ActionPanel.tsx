import { useState, useEffect } from 'react';
import { LegalActions } from '../types';

interface ActionPanelProps {
  legalActions: LegalActions;
  onAction: (type: string, amount?: number) => void;
  pot: number;
}

export default function ActionPanel({ legalActions, onAction, pot }: ActionPanelProps) {
  const [raiseAmount, setRaiseAmount] = useState(legalActions.minRaise);

  // Reset raise amount when legal actions change (new turn/round)
  useEffect(() => {
    setRaiseAmount(legalActions.minRaise);
  }, [legalActions.minRaise, legalActions.maxRaise]);

  const clamp = (val: number) =>
    Math.max(legalActions.minRaise, Math.min(legalActions.maxRaise, Math.floor(val)));

  const handleRaise = () => {
    onAction('raise', raiseAmount);
  };

  return (
    <div className="action-panel">
      <div className="action-buttons">
        {legalActions.canFold && (
          <button className="btn btn-fold" onClick={() => onAction('fold')}>
            Fold
          </button>
        )}
        {legalActions.canCheck && (
          <button className="btn btn-check" onClick={() => onAction('check')}>
            Check
          </button>
        )}
        {legalActions.canCall && (
          <button className="btn btn-call" onClick={() => onAction('call')}>
            Call ({legalActions.callAmount})
          </button>
        )}
      </div>
      {legalActions.canRaise && (
        <div className="raise-controls">
          <div className="raise-presets">
            <button className="btn btn-preset" onClick={() => setRaiseAmount(clamp(raiseAmount - 10))}>-10</button>
            <button className="btn btn-preset" onClick={() => setRaiseAmount(clamp(raiseAmount + 10))}>+10</button>
            <button className="btn btn-preset" onClick={() => setRaiseAmount(clamp(Math.floor(raiseAmount / 2)))}>1/2x</button>
            <button className="btn btn-preset" onClick={() => setRaiseAmount(clamp(raiseAmount * 2))}>2x</button>
            <button className="btn btn-preset" onClick={() => setRaiseAmount(clamp(Math.floor(pot / 2)))}>1/2 Pot</button>
            <button className="btn btn-preset" onClick={() => setRaiseAmount(clamp(pot))}>Pot</button>
          </div>
          <div className="raise-slider-row">
            <input
              type="range"
              min={legalActions.minRaise}
              max={legalActions.maxRaise}
              value={raiseAmount}
              onChange={e => setRaiseAmount(Number(e.target.value))}
            />
            <input
              type="number"
              min={legalActions.minRaise}
              max={legalActions.maxRaise}
              value={raiseAmount}
              onChange={e => {
                const val = Number(e.target.value);
                if (val >= legalActions.minRaise && val <= legalActions.maxRaise) {
                  setRaiseAmount(val);
                }
              }}
            />
            <button className="btn btn-raise" onClick={handleRaise}>
              Raise to {raiseAmount}
            </button>
            {raiseAmount === legalActions.maxRaise && (
              <span className="all-in-tag">ALL IN</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

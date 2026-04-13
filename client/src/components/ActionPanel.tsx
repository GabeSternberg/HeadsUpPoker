import { useState, useEffect } from 'react';
import { LegalActions } from '../types';

interface ActionPanelProps {
  legalActions: LegalActions;
  onAction: (type: string, amount?: number) => void;
  pot: number;
  isMobile?: boolean;
}

export default function ActionPanel({ legalActions, onAction, pot, isMobile }: ActionPanelProps) {
  const [raiseAmount, setRaiseAmount] = useState(legalActions.minRaise);

  useEffect(() => {
    setRaiseAmount(legalActions.minRaise);
  }, [legalActions.minRaise, legalActions.maxRaise]);

  const clamp = (val: number) =>
    Math.max(legalActions.minRaise, Math.min(legalActions.maxRaise, Math.floor(val)));

  const handleRaise = () => onAction('raise', raiseAmount);

  const presets = (
    <div className="raise-presets">
      <button className="btn btn-preset" onClick={() => setRaiseAmount(clamp(raiseAmount - 10))}>-10</button>
      <button className="btn btn-preset" onClick={() => setRaiseAmount(clamp(raiseAmount + 10))}>+10</button>
      <button className="btn btn-preset" onClick={() => setRaiseAmount(clamp(Math.floor(raiseAmount / 2)))}>1/2x</button>
      <button className="btn btn-preset" onClick={() => setRaiseAmount(clamp(raiseAmount * 2))}>2x</button>
      <button className="btn btn-preset" onClick={() => setRaiseAmount(clamp(Math.floor(pot / 2)))}>1/2 Pot</button>
      <button className="btn btn-preset" onClick={() => setRaiseAmount(clamp(Math.floor(pot * 3 / 4)))}>3/4 Pot</button>
      <button className="btn btn-preset" onClick={() => setRaiseAmount(clamp(pot))}>Pot</button>
    </div>
  );

  // canCheck = no previous bet (free check); canCall = facing a bet
  const hasFold = legalActions.canFold && !legalActions.canCheck;

  return (
    <div className="action-panel">
      {/* Main row: [check/call + optional fold] on left, [raise] on right */}
      <div className="action-main-row">
        <div className={`action-left ${hasFold ? '' : 'action-left-solo'}`}>
          {legalActions.canCheck && (
            <button className="btn btn-check btn-check-free" onClick={() => onAction('check')}>Check</button>
          )}
          {legalActions.canCall && (
            <button className="btn btn-call" onClick={() => onAction('call')}>
              Call ({legalActions.callAmount})
            </button>
          )}
          {hasFold && (
            <button className="btn btn-fold" onClick={() => onAction('fold')}>Fold</button>
          )}
        </div>

        {legalActions.canRaise && (
          <button className="btn btn-raise btn-raise-main" onClick={handleRaise}>
            Raise {raiseAmount}{raiseAmount === legalActions.maxRaise ? ' (All In)' : ''}
          </button>
        )}
      </div>

      {/* Raise controls below */}
      {legalActions.canRaise && (
        <div className="raise-controls">
          {presets}
          {isMobile ? (
            <div className="raise-number-row">
              <input
                type="number"
                min={legalActions.minRaise}
                max={legalActions.maxRaise}
                value={raiseAmount}
                onChange={e => {
                  const val = Number(e.target.value);
                  if (val >= legalActions.minRaise && val <= legalActions.maxRaise) setRaiseAmount(val);
                }}
              />
            </div>
          ) : (
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
                  if (val >= legalActions.minRaise && val <= legalActions.maxRaise) setRaiseAmount(val);
                }}
              />
              {raiseAmount === legalActions.maxRaise && <span className="all-in-tag">ALL IN</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

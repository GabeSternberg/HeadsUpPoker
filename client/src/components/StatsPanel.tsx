import { PlayerStatsRaw } from '../types';

function pct(num: number, den: number): string {
  if (den === 0) return '—';
  return ((num / den) * 100).toFixed(1) + '%';
}

function af(bets: number, calls: number): string {
  if (calls === 0) return bets > 0 ? '∞' : '—';
  return (bets / calls).toFixed(2);
}

interface Row { label: string; value: string; low?: number; high?: number; rawPct?: number }

function rows(s: PlayerStatsRaw): Row[] {
  const vpipVal = s.vpipOpportunities > 0 ? (s.vpipCount / s.vpipOpportunities) * 100 : -1;
  const pfrVal  = s.pfrOpportunities  > 0 ? (s.pfrCount  / s.pfrOpportunities)  * 100 : -1;
  const tbVal   = s.threeBetOpportunities > 0 ? (s.threeBetCount / s.threeBetOpportunities) * 100 : -1;
  const f3Val   = s.foldToThreeBetOpportunities > 0 ? (s.foldToThreeBetCount / s.foldToThreeBetOpportunities) * 100 : -1;
  const cbVal   = s.cbetOpportunities > 0 ? (s.cbetCount / s.cbetOpportunities) * 100 : -1;
  const fcbVal  = s.foldToCbetOpportunities > 0 ? (s.foldToCbetCount / s.foldToCbetOpportunities) * 100 : -1;
  const wtsdVal = s.wtsdOpportunities > 0 ? (s.wtsdCount / s.wtsdOpportunities) * 100 : -1;
  const wsdVal  = s.wtsdCount > 0 ? (s.wsdCount / s.wtsdCount) * 100 : -1;
  const afRaw   = s.postflopCalls === 0 ? (s.postflopBetsRaises > 0 ? 99 : -1) : (s.postflopBetsRaises / s.postflopCalls);

  return [
    { label: 'VPIP',         value: pct(s.vpipCount, s.vpipOpportunities),                      rawPct: vpipVal, low: 12, high: 25 },
    { label: 'PFR',          value: pct(s.pfrCount, s.pfrOpportunities),                        rawPct: pfrVal,  low: 8,  high: 20 },
    { label: '3-Bet %',      value: pct(s.threeBetCount, s.threeBetOpportunities),              rawPct: tbVal,   low: 4,  high: 12 },
    { label: 'Fold to 3-Bet',value: pct(s.foldToThreeBetCount, s.foldToThreeBetOpportunities), rawPct: f3Val,   low: 45, high: 65 },
    { label: 'C-Bet %',      value: pct(s.cbetCount, s.cbetOpportunities),                     rawPct: cbVal,   low: 45, high: 75 },
    { label: 'Fold to C-Bet',value: pct(s.foldToCbetCount, s.foldToCbetOpportunities),         rawPct: fcbVal,  low: 35, high: 65 },
    { label: 'AF',           value: af(s.postflopBetsRaises, s.postflopCalls) },
    { label: 'WTSD',         value: pct(s.wtsdCount, s.wtsdOpportunities),                     rawPct: wtsdVal, low: 22, high: 30 },
    { label: 'W$SD',         value: pct(s.wsdCount, s.wtsdCount),                              rawPct: wsdVal,  low: 45, high: 60 },
    { label: 'Hands',        value: String(s.handsPlayed) },
  ];
}

function valueColor(rawPct: number | undefined, low: number | undefined, high: number | undefined): string {
  if (rawPct === undefined || rawPct < 0 || low === undefined || high === undefined) return '#e0e0e0';
  if (rawPct < low) return '#3498db';   // below range: blue (tight/passive)
  if (rawPct > high) return '#e94560';  // above range: red (loose/aggro)
  return '#2ecc71';                     // in range: green (balanced)
}

export default function StatsPanel({ raw, displayName }: { raw: PlayerStatsRaw; displayName: string }) {
  const statRows = rows(raw);
  const lowSample = raw.handsPlayed < 15;

  return (
    <div className="stats-panel">
      <div className="stats-panel-header">{displayName}</div>
      {lowSample && <div className="stats-sample-warn">Small sample ({raw.handsPlayed} hands)</div>}
      <div className="stats-grid">
        {statRows.map(r => (
          <div key={r.label} className="stats-row">
            <span className="stats-label">{r.label}</span>
            <span className="stats-value" style={{ color: valueColor(r.rawPct, r.low, r.high) }}>
              {r.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

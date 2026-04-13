/**
 * CSV logging for poker hand stats.
 * Appends one row per hand (avatar mode only) to preserve full history.
 */

import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../logs');
export const CSV_PATH = path.join(DATA_DIR, 'poker_hands.csv');

const HEADER = [
  'timestamp', 'handNumber', 'p0Name', 'p0Role', 'p0StartStack', 'p0EndStack',
  'p1Name', 'p1Role', 'p1StartStack', 'p1EndStack',
  'winner', 'resultMessage',
  'p0_hands', 'p0_vpip', 'p0_pfr', 'p0_3bet', 'p0_fold3bet',
  'p0_cbet', 'p0_foldCbet', 'p0_af', 'p0_wtsd', 'p0_wsd',
  'p1_hands', 'p1_vpip', 'p1_pfr', 'p1_3bet', 'p1_fold3bet',
  'p1_cbet', 'p1_foldCbet', 'p1_af', 'p1_wtsd', 'p1_wsd',
].join(',');

export function initCSV(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(CSV_PATH)) fs.writeFileSync(CSV_PATH, HEADER + '\n');
  } catch (e) {
    console.error('Failed to init CSV:', e);
  }
}

function pct(num: number, den: number): string {
  return den === 0 ? '' : ((num / den) * 100).toFixed(1);
}

function afStr(bets: number, calls: number): string {
  if (calls === 0) return bets > 0 ? 'inf' : '0';
  return (bets / calls).toFixed(2);
}

function escape(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

export interface StatsLogData {
  handNumber: number;
  players: Array<{ name: string; role: string; startStack: number; endStack: number } | null>;
  winnerName: string;
  resultMessage: string;
  stats: Array<{
    handsPlayed: number;
    vpipCount: number; vpipOpportunities: number;
    pfrCount: number; pfrOpportunities: number;
    threeBetCount: number; threeBetOpportunities: number;
    foldToThreeBetCount: number; foldToThreeBetOpportunities: number;
    cbetCount: number; cbetOpportunities: number;
    foldToCbetCount: number; foldToCbetOpportunities: number;
    postflopBetsRaises: number; postflopCalls: number;
    wtsdCount: number; wtsdOpportunities: number;
    wsdCount: number;
  } | null>;
}

export function appendHandRow(data: StatsLogData): void {
  try {
    const ts = new Date().toISOString();
    const p = (i: number) => data.players[i];
    const s = (i: number) => data.stats[i];

    const statsColumns = (i: number): string => {
      const st = s(i);
      if (!st) return Array(10).fill('').join(',');
      return [
        st.handsPlayed,
        pct(st.vpipCount, st.vpipOpportunities),
        pct(st.pfrCount, st.pfrOpportunities),
        pct(st.threeBetCount, st.threeBetOpportunities),
        pct(st.foldToThreeBetCount, st.foldToThreeBetOpportunities),
        pct(st.cbetCount, st.cbetOpportunities),
        pct(st.foldToCbetCount, st.foldToCbetOpportunities),
        afStr(st.postflopBetsRaises, st.postflopCalls),
        pct(st.wtsdCount, st.wtsdOpportunities),
        pct(st.wsdCount, st.wtsdCount),
      ].join(',');
    };

    const row = [
      ts,
      data.handNumber,
      p(0)?.name ?? '', p(0)?.role ?? '', p(0)?.startStack ?? '', p(0)?.endStack ?? '',
      p(1)?.name ?? '', p(1)?.role ?? '', p(1)?.startStack ?? '', p(1)?.endStack ?? '',
      data.winnerName,
      escape(data.resultMessage),
      statsColumns(0),
      statsColumns(1),
    ].join(',');

    fs.appendFileSync(CSV_PATH, row + '\n');
  } catch (e) {
    console.error('Failed to append CSV row:', e);
  }
}

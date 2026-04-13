/**
 * CSV logging for poker hand stats.
 * Appends one row per hand (avatar mode only) to preserve full history.
 * Columns are always Gabe/Liana regardless of seat order.
 */

import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../logs');
export const CSV_PATH = path.join(DATA_DIR, 'poker_hands.csv');

const HEADER = [
  'timestamp', 'handNumber',
  'gabe_startStack', 'gabe_endStack',
  'liana_startStack', 'liana_endStack',
  'winner', 'resultMessage',
  'gabe_hands', 'gabe_vpip', 'gabe_pfr', 'gabe_3bet', 'gabe_fold3bet',
  'gabe_cbet', 'gabe_foldCbet', 'gabe_af', 'gabe_wtsd', 'gabe_wsd',
  'liana_hands', 'liana_vpip', 'liana_pfr', 'liana_3bet', 'liana_fold3bet',
  'liana_cbet', 'liana_foldCbet', 'liana_af', 'liana_wtsd', 'liana_wsd',
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

function statsColumns(st: StatsLogData['stats'][number]): string {
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
}

export function appendHandRow(data: StatsLogData): void {
  try {
    const ts = new Date().toISOString();

    // Find Gabe (role 'G') and Liana (role 'L') by role, not seat index
    const gabeIdx  = data.players.findIndex(p => p?.role === 'G');
    const lianaIdx = data.players.findIndex(p => p?.role === 'L');

    const gabe  = gabeIdx  >= 0 ? data.players[gabeIdx]  : null;
    const liana = lianaIdx >= 0 ? data.players[lianaIdx] : null;
    const gabeSt  = gabeIdx  >= 0 ? data.stats[gabeIdx]  : null;
    const lianaSt = lianaIdx >= 0 ? data.stats[lianaIdx] : null;

    const row = [
      ts,
      data.handNumber,
      gabe?.startStack  ?? '', gabe?.endStack  ?? '',
      liana?.startStack ?? '', liana?.endStack ?? '',
      data.winnerName,
      escape(data.resultMessage),
      statsColumns(gabeSt),
      statsColumns(lianaSt),
    ].join(',');

    fs.appendFileSync(CSV_PATH, row + '\n');
  } catch (e) {
    console.error('Failed to append CSV row:', e);
  }
}

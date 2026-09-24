// scripts/backtest/analyze-chop.ts — does the market chop filter predict anything?
//
// The scorecard turns a blended QQQ/SPY Choppiness Index into instructions:
// "Do not trade breakouts", "Breakout triggers will fire and reverse — sit
// out". Its thresholds are self-described as conventional or a judgement call
// and were never tested against outcomes. This replays them.
//
// For every session it rebuilds the DAILY reading exactly as /api/chop does
// (choppiness() over 14 bars, 0.6 QQQ + 0.4 SPY), reads it as of the SIGNAL
// date — what a trader sees that evening, before next-open entry, so no
// lookahead — and buckets every breakout trade the scans took by that reading.
//
// Limitation, stated rather than hidden: the live composite blends a 15-minute
// intraday leg at 30%. There is no intraday history, so this tests the daily
// reading only — which is 70% of the composite and 100% of it outside hours.
//
// No network, no KV: reads ../backtest-data only.
//   npx tsx scripts/backtest/analyze-chop.ts

import fs from 'node:fs';
import path from 'node:path';
import { listSessions, readDay, DATA } from './cache';
import { choppiness } from '@/lib/indicators/chop';
import { CHOP_BANDS, CHOP_MODES, chopZoneLabel } from '@/lib/indicators/chopMarket';

// ---- 1. the daily reading, per session ------------------------------------
const sessions = listSessions();
const bars: Record<'QQQ' | 'SPY', { h: number; l: number; c: number }[]> = { QQQ: [], SPY: [] };
const chopOn = new Map<string, number>();
const qs: (number | null)[] = [], ss: (number | null)[] = [];
for (const d of sessions) {
  const rows = readDay('adj', d);
  for (const T of ['QQQ', 'SPY'] as const) {
    const r = rows.find(x => x[0] === T);
    if (r) bars[T].push({ h: r[2], l: r[3], c: r[4] });
  }
  const q = choppiness(bars.QQQ), s = choppiness(bars.SPY);
  if (q != null && s != null) chopOn.set(d, 0.6 * q + 0.4 * s);
}
const vals = [...chopOn.values()].sort((a, b) => a - b);
const pct = (p: number) => vals[Math.floor(p * (vals.length - 1))];

console.log(`\n=== DAILY READING — ${chopOn.size} sessions, ${[...chopOn.keys()][0]} to ${[...chopOn.keys()].at(-1)} ===`);
console.log(`percentiles  p10 ${pct(.1).toFixed(1)}  p25 ${pct(.25).toFixed(1)}  p50 ${pct(.5).toFixed(1)}  p75 ${pct(.75).toFixed(1)}  p90 ${pct(.9).toFixed(1)}`);
console.log('\nhow often each setting calls each zone:');
for (const m of CHOP_MODES) {
  const b = CHOP_BANDS[m];
  const n: Record<string, number> = {};
  for (const v of vals) { const z = chopZoneLabel(v, b); n[z] = (n[z] ?? 0) + 1; }
  const choppyish = ['CHOPPY', 'DEAD CHOP', 'EXTREME'].reduce((a, z) => a + (n[z] ?? 0), 0);
  console.log(`  ${b.label.padEnd(8)} choppy-or-worse ${(100 * choppyish / vals.length).toFixed(0).padStart(3)}%  |  ` +
    ['STRONG TREND', 'TRENDING', 'MIXED', 'CHOPPY', 'DEAD CHOP', 'EXTREME'].map(z => `${z} ${(100 * (n[z] ?? 0) / vals.length).toFixed(0)}%`).join('  '));
}

// ---- 2. outcomes, by reading ----------------------------------------------
type T = { date: string; fixed: number; trail: number; filled: boolean };
function load(file: string, entry: string): T[] {
  const out: T[] = [];
  for (const line of fs.readFileSync(path.join(DATA, 'replay', file), 'utf8').split('\n')) {
    if (!line) continue;
    const o = JSON.parse(line); const e = o.entries?.[entry];
    if (!e) continue;
    const filled = e.status === 'traded';
    out.push({ date: o.date, filled, fixed: filled ? e.exits?.fixedTarget?.r ?? NaN : NaN, trail: filled ? e.exits?.trail21?.r ?? NaN : NaN });
  }
  return out;
}
const SETS: [string, string, string][] = [
  ['SIPs + Daily (breakout)', 'scanner_outcomes.jsonl', 'highBreak'],
  ['Swing (breakout)', 'swing_outcomes.jsonl', 'highBreak'],
  ['VCP (pivot)', 'vcp_outcomes.jsonl', 'pivot'],
  ['10/21 (pivot)', 'consol_outcomes.jsonl', 'pivot'],
  ['HRS (breakout)', 'hrs_outcomes.jsonl', 'highBreak'],
  ['EP9M (pullback — not a breakout)', 'ep9m_v2_outcomes.jsonl', 'pullback'],
];

// Quintiles of the reading itself, so the buckets are equal-sized and no
// threshold is assumed. Then split into the first two-thirds and the last
// third of the period: a trait only counts if it holds in BOTH (house rule).
const q = [pct(.2), pct(.4), pct(.6), pct(.8)];
const qi = (v: number) => q.findIndex(x => v <= x) === -1 ? 4 : q.findIndex(x => v <= x);
const dates = [...chopOn.keys()];
const cut = dates[Math.floor(dates.length * 2 / 3)];
const qLabel = ['Q1 most trending', 'Q2', 'Q3', 'Q4', 'Q5 most choppy'];
console.log(`\nquintile edges: ${q.map(x => x.toFixed(1)).join(' / ')}   |   halves split at ${cut}`);

const avg = (a: number[]) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const f2 = (x: number) => Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(2) : '  n/a';
for (const [name, file, entry] of SETS) {
  const rows = load(file, entry).filter(r => chopOn.has(r.date));
  console.log(`\n--- ${name}: ${rows.length} signals, ${rows.filter(r => r.filled).length} filled`);
  console.log('                        n    fill%   2R-bracket R      trail-21 R       [first 2/3 | last 1/3 of trail R]');
  for (let k = 0; k < 5; k++) {
    const b = rows.filter(r => qi(chopOn.get(r.date)!) === k);
    const f = b.filter(r => r.filled && Number.isFinite(r.fixed));
    const is = f.filter(r => r.date < cut), oos = f.filter(r => r.date >= cut);
    console.log(`  ${qLabel[k].padEnd(18)} ${String(b.length).padStart(5)}  ${(100 * f.length / Math.max(1, b.length)).toFixed(0).padStart(4)}%     ${f2(avg(f.map(r => r.fixed)))}           ${f2(avg(f.map(r => r.trail)))}          [${f2(avg(is.map(r => r.trail)))} | ${f2(avg(oos.map(r => r.trail)))}]`);
  }
}

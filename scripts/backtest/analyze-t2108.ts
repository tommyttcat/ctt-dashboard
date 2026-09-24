// scripts/backtest/analyze-t2108.ts — does the scorecard's T2108 colouring hold?
//
// The scorecard paints OVERSOLD (<=35% of stocks above their 40-day average)
// green and FROTHY (>80%) red: a contrarian buy/avoid claim in colour. This
// rebuilds the reading daily, as computeT2108 does (every name with 41+ closes,
// close vs its 40-day simple average; null under 100 names), and buckets every
// breakout trade by the zone on its signal date. No network, no KV.
//   npx tsx scripts/backtest/analyze-t2108.ts

import fs from 'node:fs';
import path from 'node:path';
import { listSessions, readDay, DATA } from './cache';
import { t2108ZoneLabel } from '@/lib/indicators/marketScorecard';

const sessions = listSessions();
const hist = new Map<string, number[]>();
const t2108 = new Map<string, number>();
for (const d of sessions) {
  let above = 0, total = 0;
  for (const r of readDay('adj', d)) {
    const c = r[4]; if (!(c > 0)) continue;
    let h = hist.get(r[0]); if (!h) { h = []; hist.set(r[0], h); }
    h.push(c); if (h.length > 41) h.shift();
    if (h.length < 41) continue;
    let s = 0; for (let i = 1; i < 41; i++) s += h[i];
    total++; if (c > s / 40) above++;
  }
  if (total >= 100) t2108.set(d, 100 * above / total);
}
const vals = [...t2108.values()];
const zones = ['WASHED OUT', 'VERY OVERSOLD', 'OVERSOLD', 'NEUTRAL', 'STRETCHED', 'OVERHEATED'];
const zc: Record<string, number> = {};
for (const v of vals) { const z = t2108ZoneLabel(v); zc[z] = (zc[z] ?? 0) + 1; }
console.log(`\n=== T2108 — ${vals.length} sessions ===`);
console.log('share of days: ' + zones.map(z => `${z} ${(100 * (zc[z] ?? 0) / vals.length).toFixed(0)}%`).join('  '));

const dates = [...t2108.keys()];
const cut = dates[Math.floor(dates.length * 2 / 3)];
const avg = (a: number[]) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const f2 = (x: number) => Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(2) : '  n/a';
const SETS: [string, string, string][] = [
  ['SIPs + Daily (breakout)', 'scanner_outcomes.jsonl', 'highBreak'],
  ['Swing (breakout)', 'swing_outcomes.jsonl', 'highBreak'],
  ['VCP (pivot)', 'vcp_outcomes.jsonl', 'pivot'],
  ['10/21 (pivot)', 'consol_outcomes.jsonl', 'pivot'],
  ['HRS (breakout)', 'hrs_outcomes.jsonl', 'highBreak'],
  ['EP9M (pullback)', 'ep9m_v2_outcomes.jsonl', 'pullback'],
];
console.log(`halves split at ${cut}; figure is trail-21 R per filled trade  [first 2/3 | last 1/3]`);
for (const [name, file, entry] of SETS) {
  const rows: { date: string; r: number }[] = [];
  for (const line of fs.readFileSync(path.join(DATA, 'replay', file), 'utf8').split('\n')) {
    if (!line) continue;
    const o = JSON.parse(line); const e = o.entries?.[entry];
    if (e?.status !== 'traded' || !t2108.has(o.date)) continue;
    const r = e.exits?.trail21?.r; if (Number.isFinite(r)) rows.push({ date: o.date, r });
  }
  console.log(`\n--- ${name}: ${rows.length} filled`);
  for (const z of zones) {
    const b = rows.filter(x => t2108ZoneLabel(t2108.get(x.date)!) === z);
    if (b.length < 30) { console.log(`  ${z.padEnd(14)} n=${String(b.length).padStart(5)}   (too few)`); continue; }
    const is = b.filter(x => x.date < cut), oos = b.filter(x => x.date >= cut);
    console.log(`  ${z.padEnd(14)} n=${String(b.length).padStart(5)}   ${f2(avg(b.map(x => x.r)))}   [${f2(avg(is.map(x => x.r)))} n=${is.length} | ${f2(avg(oos.map(x => x.r)))} n=${oos.length}]`);
  }
}

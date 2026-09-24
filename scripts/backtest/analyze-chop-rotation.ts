// scripts/backtest/analyze-chop-rotation.ts — does restoring the rotation
// guard make the chop reading say anything?
//
// The guard removed on 5 Sep 2026 (09eed01) moved the raw reading by up to
// +/-12 on each of three inputs. Rebuilt here from daily bars:
//   breadth balance  advancers vs decliners, as the 0-6 score's centrality
//   highs vs lows    new 52-week highs vs lows (needs 252 sessions of history)
//   session move     0.6 QQQ% + 0.4 SPY%, past 0.5% pushes toward trending
// Compared against the raw reading on the SAME dates, by quintile, in both
// halves. No network, no KV.
//   npx tsx scripts/backtest/analyze-chop-rotation.ts

import fs from 'node:fs';
import path from 'node:path';
import { listSessions, readDay, DATA } from './cache';
import { choppiness } from '@/lib/indicators/chop';

const CAP = 12;
const sessions = listSessions();
const idx: Record<'QQQ' | 'SPY', { h: number; l: number; c: number }[]> = { QQQ: [], SPY: [] };
const prevClose = new Map<string, number>();
// per-ticker rolling 252-session high/low via monotonic deques over indices
type Dq = { hi: number[]; lo: number[]; hv: number[]; lv: number[]; n: number };
const dq = new Map<string, Dq>();

type Day = { raw: number; breadthAdj: number; hlAdj: number; sessAdj: number };
const day = new Map<string, Day>();

for (const d of sessions) {
  const rows = readDay('adj', d);
  let adv = 0, dec = 0, nh = 0, nl = 0;
  for (const r of rows) {
    const [T, , h, l, c] = r;
    if (!(c > 0)) continue;
    const pc = prevClose.get(T);
    if (pc) { if (c > pc) adv++; else if (c < pc) dec++; }
    prevClose.set(T, c);
    let q = dq.get(T); if (!q) { q = { hi: [], lo: [], hv: [], lv: [], n: 0 }; dq.set(T, q); }
    const i = q.n++;
    // drop anything older than 252 sessions for this ticker
    while (q.hi.length && q.hi[0] <= i - 252) { q.hi.shift(); q.hv.shift(); }
    while (q.lo.length && q.lo[0] <= i - 252) { q.lo.shift(); q.lv.shift(); }
    if (q.n > 252) {
      const priorMax = q.hv.length ? q.hv[0] : -Infinity, priorMin = q.lv.length ? q.lv[0] : Infinity;
      if (h > priorMax) nh++;
      if (l < priorMin) nl++;
    }
    while (q.hv.length && q.hv[q.hv.length - 1] <= h) { q.hv.pop(); q.hi.pop(); }
    q.hv.push(h); q.hi.push(i);
    while (q.lv.length && q.lv[q.lv.length - 1] >= l) { q.lv.pop(); q.lo.pop(); }
    q.lv.push(l); q.lo.push(i);
  }
  const pct: Record<string, number> = {};
  for (const T of ['QQQ', 'SPY'] as const) {
    const r = rows.find(x => x[0] === T);
    if (!r) continue;
    const prev = idx[T].at(-1)?.c;
    idx[T].push({ h: r[2], l: r[3], c: r[4] });
    if (prev) pct[T] = 100 * (r[4] / prev - 1);
  }
  const q = choppiness(idx.QQQ), s = choppiness(idx.SPY);
  if (q == null || s == null || nh + nl === 0 || adv + dec === 0) continue;
  // breadth centrality, exactly as the removed code did it on a 0-6 score
  const score = 6 * adv / (adv + dec);
  const breadthAdj = ((1 - Math.abs(score - 3) / 3) - 0.5) * 2 * CAP;
  const hlAdj = ((1 - Math.abs(100 * nh / (nh + nl) - 50) / 50) - 0.5) * 2 * CAP;
  const w = Math.abs(0.6 * (pct.QQQ ?? 0) + 0.4 * (pct.SPY ?? 0));
  const sessAdj = w >= 0.5 ? -Math.min((w - 0.5) / 1.0, 1) * CAP : 0;
  day.set(d, { raw: 0.6 * q + 0.4 * s, breadthAdj, hlAdj, sessAdj });
}

// only dates where the 52-week high/low count is valid (252 sessions warm)
const valid = [...day.keys()].filter((_, i, a) => i >= 0);
const firstValid = sessions[252];
const dates = valid.filter(d => d >= firstValid);
console.log(`\n${dates.length} sessions with every input, ${dates[0]} to ${dates.at(-1)}`);

const VARIANTS: [string, (x: Day) => number][] = [
  ['RAW (today)', x => x.raw],
  ['+ ROTATION (breadth + highs/lows)', x => x.raw + x.breadthAdj + x.hlAdj],
  ['+ ALL THREE (as before 5 Sep)', x => x.raw + x.breadthAdj + x.hlAdj + x.sessAdj],
];
const SETS: [string, string, string][] = [
  ['SIPs+Daily', 'scanner_outcomes.jsonl', 'highBreak'],
  ['Swing', 'swing_outcomes.jsonl', 'highBreak'],
  ['VCP', 'vcp_outcomes.jsonl', 'pivot'],
  ['10/21', 'consol_outcomes.jsonl', 'pivot'],
  ['HRS', 'hrs_outcomes.jsonl', 'highBreak'],
];
const trades: Record<string, { date: string; r: number }[]> = {};
for (const [name, file, entry] of SETS) {
  trades[name] = [];
  for (const line of fs.readFileSync(path.join(DATA, 'replay', file), 'utf8').split('\n')) {
    if (!line) continue;
    const o = JSON.parse(line); const e = o.entries?.[entry];
    if (e?.status !== 'traded' || !day.has(o.date) || o.date < firstValid) continue;
    const r = e.exits?.trail21?.r; if (Number.isFinite(r)) trades[name].push({ date: o.date, r });
  }
}
const cut = dates[Math.floor(dates.length * 2 / 3)];
const avg = (a: number[]) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const f2 = (x: number) => Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(2) : ' n/a';
console.log(`halves split at ${cut}. Cells: trail-21 R for the most TRENDING fifth vs the most CHOPPY fifth, each half.`);
console.log(`A reading that works puts trending above choppy in BOTH halves ("ok"); "x" = reversed in a half.\n`);

for (const [vname, fn] of VARIANTS) {
  const v = new Map(dates.map(d => [d, fn(day.get(d)!)]));
  const sorted = [...v.values()].sort((a, b) => a - b);
  const q20 = sorted[Math.floor(.2 * (sorted.length - 1))], q80 = sorted[Math.floor(.8 * (sorted.length - 1))];
  const trendDays = dates.filter(d => v.get(d)! <= q20).length;
  console.log(`=== ${vname}   (trending fifth <= ${q20.toFixed(1)}, choppy fifth >= ${q80.toFixed(1)})`);
  let wins = 0;
  for (const [name] of SETS) {
    const t = trades[name];
    const cell = (half: 'is' | 'oos') => {
      const h = t.filter(x => half === 'is' ? x.date < cut : x.date >= cut);
      const lo = avg(h.filter(x => v.get(x.date)! <= q20).map(x => x.r));
      const hi = avg(h.filter(x => v.get(x.date)! >= q80).map(x => x.r));
      return { lo, hi, ok: lo > hi };
    };
    const a = cell('is'), b = cell('oos');
    const both = a.ok && b.ok; if (both) wins++;
    console.log(`  ${name.padEnd(11)} first 2/3: trend ${f2(a.lo)} vs chop ${f2(a.hi)} ${a.ok ? 'ok' : 'x '}   last 1/3: trend ${f2(b.lo)} vs chop ${f2(b.hi)} ${b.ok ? 'ok' : 'x '}   ${both ? '<- holds' : ''}`);
  }
  console.log(`  holds in both halves for ${wins} of ${SETS.length} scans\n`);
}

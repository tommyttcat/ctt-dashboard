// scripts/backtest/dots.ts — Dr. Wish's blue dot / red dot on daily bars.
//
//   npx tsx scripts/backtest/dots.ts
//
// RULES — fixed 9 Oct 2026, before the first run.
//   Universe each day: CS/ADRC, close >= $5, 20-session average dollar volume
//     >= $20M (trendline.ts's), 220+ sessions of history.
//   SITE   the dashboard's own dots (lib/indicators/dots.ts, reproduced):
//          fast %K(10) <= 25 on any of the last 3 bars, close > prior close,
//          close > SMA30 or > EMA21 -> BLUE. Mirror: %K >= 75 in the last 3,
//          close < prior close, close < SMA30 AND < EMA21 -> RED.
//   WISH   the commonly cited 10.4 version: slow %K = 4-session average of
//          fast %K(10). BLUE = slow %K closes above 20 after closing at or
//          below 20 the day before. RED = closes below 80 after 80+.
//   Entry: the next session's open. Outcome: close of the 5th / 10th / 20th
//     session after entry, minus QQQ over the same window, minus 0.2% costs.
//   Baseline: the same outcome for EVERY universe stock-day (what a random
//     liquid name did over the same windows).
//   Subsets printed: all; uptrend (close > SMA200 and SMA50 > SMA200);
//     market on (QQQ above its 200-day).
//   PASS blue: 10-session excess above the baseline by 0.5+ point AND above 0
//     in BOTH halves (split 2024-09-30), for the version and subset tested.
//   PASS red (as an exit / avoid signal): 10-session excess BELOW the baseline
//     by 0.5+ point in both halves.

import { loadAdjusted } from './cache';
import { loadReference, refAt } from './reference';

const c = loadAdjusted();
const ref = loadReference();
const { sessions, syms, O, H, L, C, V } = c;
const N = sessions.length;
const qId = c.idOf.get('QQQ')!;
const iSplit = sessions.findIndex(d => d > '2024-09-30');
const COST = 0.002;
const HOLDS = [5, 10, 20];

const typeOk = new Map<string, boolean>();
const isStock = (sym: string, date: string) => {
  const k = `${sym}|${date.slice(0, 4)}`;
  if (!typeOk.has(k)) { const t = (refAt(ref, sym, date)?.type || '').toUpperCase(); typeOk.set(k, t === 'CS' || t === 'ADRC'); }
  return typeOk.get(k)!;
};
const qSma200 = new Float64Array(N);
for (let t = 200; t < N; t++) { let s = 0; for (let j = t - 199; j <= t; j++) s += C[qId][j]; qSma200[t] = s / 200; }

type Acc = { n: number; s: number[] };
const mk = (): Acc => ({ n: 0, s: HOLDS.map(() => 0) });
const keys = ['base', 'SITE blue', 'SITE red', 'WISH blue', 'WISH red'];
const subsets = ['all', 'uptrend', 'market on'];
const acc: Record<string, Acc[][]> = {};   // key|subset -> [half][]
for (const k of keys) for (const s of subsets) acc[`${k}|${s}`] = [[mk()], [mk()]].map(x => x) as unknown as Acc[][];
const get = (k: string, s: string, h: number): Acc => (acc[`${k}|${s}`] as unknown as Acc[])[h];

for (let id = 0; id < syms.length; id++) {
  const cl = C[id], hi = H[id], lo = L[id];
  const fk = new Float64Array(N).fill(NaN), sk = new Float64Array(N).fill(NaN);
  const sma30 = new Float64Array(N).fill(NaN), sma50 = new Float64Array(N).fill(NaN), sma200 = new Float64Array(N).fill(NaN), ema21 = new Float64Array(N).fill(NaN);
  let e = NaN, run = 0;
  for (let t = 0; t < N; t++) {
    if (Number.isNaN(cl[t])) { run = 0; e = NaN; continue; }
    run++;
    if (run >= 10) {
      let h = -Infinity, l = Infinity; for (let j = t - 9; j <= t; j++) { h = Math.max(h, hi[j]); l = Math.min(l, lo[j]); }
      fk[t] = h === l ? 50 : ((cl[t] - l) / (h - l)) * 100;
    }
    if (run >= 13) sk[t] = (fk[t] + fk[t - 1] + fk[t - 2] + fk[t - 3]) / 4;
    const sm = (n: number) => { let s = 0; for (let j = t - n + 1; j <= t; j++) s += cl[j]; return s / n; };
    if (run >= 30) sma30[t] = sm(30);
    if (run >= 50) sma50[t] = sm(50);
    if (run >= 200) sma200[t] = sm(200);
    e = Number.isNaN(e) ? cl[t] : cl[t] * (2 / 22) + e * (1 - 2 / 22);
    if (run >= 60) ema21[t] = e;
  }
  for (let t = 220; t + 1 + 20 < N; t++) {
    if (!(cl[t] >= 5) || Number.isNaN(O[id][t + 1]) || Number.isNaN(sma200[t])) continue;
    let dv = 0; for (let j = t - 19; j <= t; j++) dv += cl[j] * V[id][j];
    if (!(dv / 20 >= 20e6)) continue;
    if (!isStock(syms[id], sessions[t])) continue;
    const half = t < iSplit ? 0 : 1;
    const e0 = t + 1, fill = O[id][e0];
    const ex = HOLDS.map(hd => { let k = e0 + hd - 1; while (k > e0 && Number.isNaN(cl[k])) k--; return cl[k] / fill - 1 - COST - (C[qId][e0 + hd - 1] / O[qId][e0] - 1); });
    const up = cl[t] > sma200[t] && sma50[t] > sma200[t];
    const mkt = C[qId][t] > qSma200[t];
    const minK3 = Math.min(fk[t], fk[t - 1], fk[t - 2]), maxK3 = Math.max(fk[t], fk[t - 1], fk[t - 2]);
    const sig: Record<string, boolean> = {
      base: true,
      'SITE blue': minK3 <= 25 && cl[t] > cl[t - 1] && (cl[t] > sma30[t] || cl[t] > ema21[t]),
      'SITE red': maxK3 >= 75 && cl[t] < cl[t - 1] && cl[t] < sma30[t] && cl[t] < ema21[t],
      'WISH blue': sk[t - 1] <= 20 && sk[t] > 20,
      'WISH red': sk[t - 1] >= 80 && sk[t] < 80,
    };
    for (const k of keys) {
      if (!sig[k]) continue;
      for (const [s, on] of [['all', true], ['uptrend', up], ['market on', mkt]] as const) {
        if (!on) continue;
        const a = get(k, s, half); a.n++; ex.forEach((x, i) => (a.s[i] += x));
      }
    }
  }
}

const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`;
const avg = (a: Acc, i: number) => a.s[i] / Math.max(1, a.n);
console.log(`Excess vs QQQ after costs, entry next open. Split 2024-09-30. Columns: 5 / 10 / 20 sessions.`);
for (const s of subsets) {
  console.log(`\n== ${s} ==`);
  for (const k of keys) {
    const parts = [0, 1].map(h => { const a = get(k, s, h); return `${h ? '2nd' : '1st'} ${HOLDS.map((_, i) => pct(avg(a, i)).padStart(7)).join(' ')} n ${String(a.n).padStart(7)}`; });
    let verdict = '';
    if (k !== 'base') {
      const d = [0, 1].map(h => avg(get(k, s, h), 1) - avg(get('base', s, h), 1));
      const raw = [0, 1].map(h => avg(get(k, s, h), 1));
      verdict = k.endsWith('blue')
        ? (d.every(x => x >= 0.005) && raw.every(x => x > 0) ? '→ PASS' : '→ fail')
        : (d.every(x => x <= -0.005) ? '→ PASS (avoid)' : '→ fail');
      verdict += `  (10-day vs base: ${pct(d[0])} / ${pct(d[1])})`;
    }
    console.log(`  ${k.padEnd(10)} ${parts.join(' | ')}  ${verdict}`);
  }
}

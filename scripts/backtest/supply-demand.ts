// scripts/backtest/supply-demand.ts — buy the first retest of a daily demand zone, 2016-2026.
//
//   LONG=1 NODE_OPTIONS=--max-old-space-size=8192 npx tsx scripts/backtest/supply-demand.ts
//
// From "Mastering Stock Market Supply and Demand" (kasmcapital.substack.com,
// shared 10 Oct 2026). The article gives no numbers; every threshold below is
// ours, fixed before the first run.
//
// RULES — fixed 10 Oct 2026.
//   Universe: CS/ADRC, real close >= $2, 20-session $ volume >= $20M.
//   ADR = 20-session mean (high/low - 1).
//   ZONE: a base of 3-10 sessions whose high-low range is <= 1.5 ADR (of the
//     base's last day), followed within 5 sessions by a DEPARTURE: a close
//     >= base high x (1 + 2 ADR) on a day with volume >= 1.5x its prior
//     20-session average. Zone = [base low, base high]. The longest qualifying
//     base ending on a given day is used; zones are found as of the departure.
//   RETEST: the first later session (2..60 sessions after the departure) whose
//     low trades into the zone (<= base high). Only the first retest counts
//     (fresh zones); a close below the zone low before then voids it.
//   ENTRY: on that retest day the close is back above the zone midpoint AND in
//     the upper half of the day's range (a bounce). Buy the next open.
//   STOP: zone low x (1 - 0.5 ADR); out at the open if it gaps through, else at
//     the stop. TARGET: the departure-day high (limit). Else out at the first
//     close below SMA10 from session 2. Max 60 sessions. 0.1% a side.
//   Variants: all; TREND (close above SMA200 at the retest); VOLUME (retest-day
//     volume >= its 20-session average); both.
//   Excess = return minus QQQ over the same window. Baseline: the next-open
//     10-session excess of every universe stock-day (as dots.ts).
//   PASS: average trade excess > 0 in BOTH halves (2016-20, 2021-26) for any
//     variant, AND above the baseline's 10-session excess by 0.5+ point.

import { loadAdjusted, listSessions, readDay } from './cache';
import { loadReference, refAt } from './reference';

const c = loadAdjusted();
const ref = loadReference();
const { sessions, syms, O, H, L, C, V } = c;
const N = sessions.length;
const qId = c.idOf.get('QQQ')!;
const RC: Float32Array[] = syms.map(() => new Float32Array(N).fill(NaN));
{ if (listSessions().length !== N) throw new Error('session mismatch');
  for (let s = 0; s < N; s++) for (const r of readDay('unadj', sessions[s])) { const id = c.idOf.get(r[0]); if (id != null) RC[id][s] = r[4]; } }
const typeOk = new Map<string, boolean>();
const isStock = (sym: string, date: string) => { const k = `${sym}|${date.slice(0, 4)}`; if (!typeOk.has(k)) { const t = (refAt(ref, sym, date)?.type || '').toUpperCase(); typeOk.set(k, t === 'CS' || t === 'ADRC'); } return typeOk.get(k)!; };
const COST = 0.002;
const idx = (d: string) => { const i = sessions.findIndex(x => x >= d); return i < 0 ? N : i; };
const H2 = idx('2021-01-01'), START = idx('2016-01-01');
type T = { e: number; ex: number; trend: boolean; vol: boolean };
const trades: T[] = [];
const base: number[][] = [[], []];
for (let id = 0; id < syms.length; id++) {
  const cl = C[id];
  const ok = (t: number) => { if (!(RC[id][t] >= 2)) return false; for (let j = t - 210; j <= t; j++) if (Number.isNaN(cl[j])) return false; let dv = 0; for (let j = t - 19; j <= t; j++) dv += cl[j] * V[id][j]; return dv / 20 >= 20e6; };
  const adr = (t: number) => { let s = 0; for (let j = t - 19; j <= t; j++) s += H[id][j] / L[id][j] - 1; return s / 20; };
  const avgV = (t: number) => { let s = 0; for (let j = t - 20; j < t; j++) s += V[id][j]; return s / 20; };
  const sma = (t: number, n: number) => { let s = 0; for (let j = t - n + 1; j <= t; j++) s += cl[j]; return s / n; };
  let busy = -1;
  for (let d = Math.max(START - 70, 230); d < N - 2; d++) {
    // baseline sample: every 10th stock-day
    if (d >= START && d % 10 === id % 10 && d + 10 < N && ok(d) && !Number.isNaN(O[id][d + 1]) && isStock(syms[id], sessions[d])) {
      let k = d + 10; while (k > d + 1 && Number.isNaN(cl[k])) k--;
      base[d < H2 ? 0 : 1].push(cl[k] / O[id][d + 1] - 1 - COST - (C[qId][d + 10] / O[qId][d + 1] - 1));
    }
    if (d <= busy || Number.isNaN(cl[d])) continue;
    // departure day d?
    if (!(V[id][d] >= 1.5 * avgV(d))) continue;
    let zone: { lo: number; hi: number } | null = null;
    for (let gap = 1; gap <= 5 && !zone; gap++) {
      const end = d - gap; const a0 = adr(end);
      for (let len = 10; len >= 3; len--) {
        let hi = -Infinity, lo = Infinity, bad = false;
        for (let j = end - len + 1; j <= end; j++) { if (Number.isNaN(cl[j])) { bad = true; break; } hi = Math.max(hi, H[id][j]); lo = Math.min(lo, L[id][j]); }
        if (bad || !(hi / lo - 1 <= 1.5 * a0)) continue;
        // the departure must be the first close that far above the base
        let earlier = false; for (let j = end + 1; j < d; j++) if (cl[j] >= hi * (1 + 2 * a0)) earlier = true;
        if (!earlier && cl[d] >= hi * (1 + 2 * a0)) zone = { lo, hi };
        break;
      }
    }
    if (!zone) continue;
    const depHigh = H[id][d], mid = (zone.lo + zone.hi) / 2;
    for (let r = d + 2; r <= Math.min(N - 2, d + 60); r++) {
      if (Number.isNaN(cl[r])) continue;
      if (cl[r] < zone.lo) break;                        // broken before a retest
      if (!(L[id][r] <= zone.hi)) continue;              // not back in the zone yet
      // first retest
      if (r < START || !ok(r) || !isStock(syms[id], sessions[r])) break;
      const cs = H[id][r] > L[id][r] ? (cl[r] - L[id][r]) / (H[id][r] - L[id][r]) : 0;
      if (!(cl[r] > mid && cs >= 0.5)) break;
      const e = r + 1, fill = O[id][e]; if (!(fill > 0)) break;
      const a = adr(r), stop = zone.lo * (1 - 0.5 * a);
      if (!(fill > stop)) break;
      let exK = -1, px = NaN;
      for (let k = e; k < N && k <= e + 59; k++) {
        if (Number.isNaN(cl[k])) continue;
        if (k > e && O[id][k] <= stop) { exK = k; px = O[id][k]; break; }
        if (L[id][k] <= stop) { exK = k; px = stop; break; }
        if (H[id][k] >= depHigh) { exK = k; px = Math.max(depHigh, k > e ? O[id][k] : depHigh); break; }
        if (k > e && (cl[k] < sma(k, 10) || k === e + 59)) { exK = k; px = cl[k]; break; }
      }
      if (exK < 0) break;
      trades.push({ e, ex: px / fill - 1 - COST - (C[qId][exK] / O[qId][e] - 1), trend: cl[r] > sma(r, 200), vol: V[id][r] >= avgV(r) });
      busy = exK;
      break;
    }
  }
}
const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`;
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
const bm = [mean(base[0]), mean(base[1])];
console.log(`baseline 10-session excess (all stock-days): 2016-20 ${pct(bm[0])} | 2021-26 ${pct(bm[1])}`);
for (const [name, f] of [['all', () => true], ['trend (above 200-day)', (t: T) => t.trend], ['volume on the bounce', (t: T) => t.vol], ['trend + volume', (t: T) => t.trend && t.vol]] as [string, (t: T) => boolean][]) {
  const ts = trades.filter(f); const h = [ts.filter(t => t.e < H2), ts.filter(t => t.e >= H2)];
  const m = h.map(x => mean(x.map(t => t.ex)));
  const win = mean(ts.map(t => +(t.ex > 0)));
  const pass = m.every((x, i) => x > 0 && x - bm[i] >= 0.005);
  console.log(`  ${name.padEnd(22)} 2016-20 ${pct(m[0]).padStart(7)} n ${String(h[0].length).padStart(5)} | 2021-26 ${pct(m[1]).padStart(7)} n ${String(h[1].length).padStart(5)} | beat QQQ ${(100 * win).toFixed(0)}%  → ${pass ? 'PASS' : 'fail'}`);
}
for (const y of [...new Set(trades.map(t => sessions[t.e].slice(0, 4)))].sort()) { const ys = trades.filter(t => sessions[t.e].startsWith(y)); console.log(`    ${y} ${pct(mean(ys.map(t => t.ex))).padStart(7)} n ${ys.length}`); }

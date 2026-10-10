// scripts/backtest/ten-week-line.ts — "a stock that has doubled can double again; buy the first
// 2 or 3 pullbacks to the rising 10-week line" (Southwestern Energy / IBD post, 10 Oct 2026).
//
//   LONG=1 NODE_OPTIONS=--max-old-space-size=12288 npx tsx scripts/backtest/ten-week-line.ts
//
// RULES — fixed 10 Oct 2026, before the first run. 2016-2026. Universe: CS/ADRC, real close
// >= $2, 20-session $ volume >= $20M, a full year of bars.
//
// PART 1 — the needle. Each month-end, every stock: did it gain another +100% within the
// next 252 sessions? Compare stocks already up >= 100% over the past 252 sessions with all
// stocks. Also the average next-12-month return and the share that LOSE 50%+.
//   Supported if doublers double again at least 2x as often as everything else, in BOTH halves.
//
// PART 2 — the rule. A leader at t: 252-session return >= +100%; 10-week line = 50-day SMA,
// rising (above its level 20 sessions ago); a 52-week high within the last 60 sessions.
// Earnings growth: the latest two reported quarters (non-Q4, filed by t) both above the same
// quarter a year earlier. Market: QQQ above its 200-day.
// Advance start = the last close that crossed from below to above the 50-day. A pullback
// = after a close >= 10% above the line, the low comes within 2% of the line (or under it);
// pullbacks are counted from the advance start. Buy pullbacks #1-3 when that day CLOSES at or
// above the line, at the next open. Exit: the first close 3% or more below the line; else
// 252 sessions. 0.2% round trip. One trade per name at a time.
// Benchmark: QQQ over the same window. Portfolio: $100k, 20 slots of 5%.
// PASS: average trade beats QQQ AND the portfolio beats QQQ, in BOTH halves (2016-20, 2021-26).
// Reported alongside (not graded): no earnings filter; pullback #4+.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DATA, loadAdjusted, listSessions, readDay } from './cache';
import { loadReference, refAt } from './reference';
import type { Qtr } from '../../src/lib/sue';

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
const qCache = new Map<string, Qtr[] | null>();
const quarters = (sym: string): Qtr[] | null => { if (qCache.has(sym)) return qCache.get(sym)!; let q: Qtr[] | null = null; const f = path.join(DATA, 'fundamentals', 'quarterly', `${sym}.json.gz`); if (fs.existsSync(f)) { try { q = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString()).q ?? null; } catch { q = null; } } qCache.set(sym, q); return q; };
/** null = no data; true/false = the latest two non-Q4 quarters both beat the year-ago quarter. */
const growing = (sym: string, date: string): boolean | null => {
  const q = quarters(sym); if (!q) return null;
  const known = q.filter(x => x.filed <= date && x.eps != null && x.fp !== 'Q4').sort((a, b) => (a.filed < b.filed ? 1 : -1));
  if (known.length < 2) return null;
  for (const x of known.slice(0, 2)) { const p = known.find(y => y.fy === x.fy - 1 && y.fp === x.fp); if (!p) return null; if (!((x.eps as number) > (p.eps as number))) return false; }
  return true;
};
const idx = (d: string) => { const i = sessions.findIndex(x => x >= d); return i < 0 ? N : i; };
const START = idx('2016-01-01'), MID = idx('2021-01-01');
const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
const liquid = (id: number, t: number) => { if (!(RC[id][t] >= 2) || Number.isNaN(C[id][t - 252])) return false; let dv = 0; for (let j = t - 19; j <= t; j++) { if (Number.isNaN(C[id][j])) return false; dv += C[id][j] * V[id][j]; } return dv / 20 >= 20e6; };

// ---- PART 1
console.log('PART 1 — does a stock that has doubled double again more often?');
const monthEnds: number[] = []; for (let t = START; t < N - 252; t++) if (sessions[t + 1].slice(0, 7) !== sessions[t].slice(0, 7)) monthEnds.push(t);
let p1ok = true;
for (const [name, a, b] of [['2016-20', START, MID - 1], ['2021-25', MID, N - 253]] as const) {
  const g = { dbl: [0, 0, 0, 0] as number[], all: [0, 0, 0, 0] as number[] }; // n, doubled again, sum ret, halved
  const fw: { dbl: number[]; all: number[] } = { dbl: [], all: [] };
  for (const t of monthEnds) { if (t < a || t > b) continue;
    for (let id = 0; id < syms.length; id++) {
      if (Number.isNaN(C[id][t]) || !liquid(id, t) || !isStock(syms[id], sessions[t])) continue;
      let k = t + 252; while (k > t && Number.isNaN(C[id][k])) k--; if (k <= t + 20) continue;
      let mx = -Infinity; for (let j = t + 1; j <= k; j++) if (!Number.isNaN(H[id][j])) mx = Math.max(mx, H[id][j]);
      const fwd = C[id][k] / C[id][t] - 1, again = mx >= 2 * C[id][t], halved = fwd <= -0.5;
      const past = C[id][t] / C[id][t - 252] - 1;
      for (const key of (past >= 1 ? ['dbl', 'all'] : ['all']) as ('dbl' | 'all')[]) { const r = g[key]; r[0]++; if (again) r[1]++; r[2] += fwd; if (halved) r[3]++; fw[key].push(fwd); }
    } }
  const med = (xs: number[]) => xs.slice().sort((x, y) => x - y)[xs.length >> 1];
  const line = (lab: string, r: number[], xs: number[]) => `  ${lab.padEnd(18)} n ${String(r[0]).padStart(7)} | doubled again ${(100 * r[1] / r[0]).toFixed(1)}% | next 12m avg ${pct(r[2] / r[0])} median ${pct(med(xs))} | lost 50%+ ${(100 * r[3] / r[0]).toFixed(1)}%`;
  console.log(` ${name} (QQQ next-12m avg n/a)`); console.log(line('already doubled', g.dbl, fw.dbl)); console.log(line('all stocks', g.all, fw.all));
  if (!(g.dbl[1] / g.dbl[0] >= 2 * g.all[1] / g.all[0])) p1ok = false;
}
console.log(` → ${p1ok ? 'SUPPORTED' : 'not supported'} (bar: 2x the base rate in both halves)`);

// ---- PART 2
const q200 = (t: number) => { let s = 0; for (let j = t - 199; j <= t; j++) s += C[qId][j]; return C[qId][t] > s / 200; };
type Tr = { id: number; e: number; x: number; px: number; fill: number; ret: number; ex: number; n: number; earn: boolean | null };
const trades: Tr[] = [];
for (let id = 0; id < syms.length; id++) {
  const cl = C[id]; const sma = new Float64Array(N).fill(NaN);
  { let s = 0, cnt = 0; for (let j = 0; j < N; j++) { if (Number.isNaN(cl[j])) { s = 0; cnt = 0; continue; } s += cl[j]; cnt++; if (cnt > 50) { s -= cl[j - 50]; cnt = 50; } if (cnt === 50) sma[j] = s / 50; } }
  let advStart = -1, armed = false, count = 0, busy = -1;
  for (let t = Math.max(START - 300, 260); t < N - 1; t++) {
    if (Number.isNaN(cl[t]) || Number.isNaN(sma[t])) { advStart = -1; continue; }
    if (cl[t] > sma[t] && cl[t - 1] <= sma[t - 1]) { advStart = t; armed = false; count = 0; }
    if (advStart < 0) continue;
    if (cl[t] >= sma[t] * 1.10) armed = true;
    if (!(armed && L[id][t] <= sma[t] * 1.02)) continue;
    count++; armed = false;
    if (t < START || t <= busy || !(cl[t] >= sma[t]) || Number.isNaN(O[id][t + 1])) continue;
    if (!(cl[t] / cl[t - 252] - 1 >= 1) || !(sma[t] > sma[t - 20])) continue;
    let hi = 0, hiAt = -1; for (let j = t - 251; j <= t; j++) if (H[id][j] >= hi) { hi = H[id][j]; hiAt = j; } if (t - hiAt > 60) continue;
    if (!q200(t) || !liquid(id, t) || !isStock(syms[id], sessions[t])) continue;
    const e = t + 1, fill = O[id][e]; let x = -1, px = NaN;
    for (let k = e; k < N && k <= e + 252; k++) { if (Number.isNaN(cl[k])) continue; if (cl[k] <= sma[k] * 0.97 || k === e + 252) { x = k; px = cl[k]; break; } }
    if (x < 0) { let k = N - 1; while (Number.isNaN(cl[k])) k--; x = k; px = cl[k]; }
    const ret = px / fill - 1 - 0.002;
    trades.push({ id, e, x, px, fill, ret, ex: ret - (C[qId][x] / O[qId][e] - 1), n: count, earn: growing(syms[id], sessions[t]) });
    busy = x;
  }
}
function portfolio(ts: Tr[], from: number, to: number) {
  let cash = 1e5; const pos: { t: Tr; sh: number }[] = []; let eq = 1e5, peak = 1e5, dd = 0;
  const byDay = new Map<number, Tr[]>(); for (const t of ts) if (t.e >= from && t.e <= to) (byDay.get(t.e) ?? byDay.set(t.e, []).get(t.e)!).push(t);
  const last = (id: number, s: number) => { let k = s; while (k > 0 && Number.isNaN(C[id][k])) k--; return C[id][k]; };
  for (let s = from; s <= to; s++) {
    for (let i = pos.length - 1; i >= 0; i--) if (pos[i].t.x <= s) { cash += pos[i].sh * pos[i].t.px * 0.999; pos.splice(i, 1); }
    const equity = cash + pos.reduce((a, p) => a + p.sh * last(p.t.id, s), 0);
    for (const t of byDay.get(s) ?? []) { if (pos.length >= 20 || pos.some(p => p.t.id === t.id)) continue; const amt = Math.min(cash, 0.05 * equity); if (amt < 0.02 * equity) continue; pos.push({ t, sh: amt / (t.fill * 1.001) }); cash -= amt; }
    eq = cash + pos.reduce((a, p) => a + p.sh * last(p.t.id, s), 0); peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak);
  }
  return { ret: eq / 1e5 - 1, dd };
}
const HALF: [string, number, number][] = [['2016-20', START, MID - 1], ['2021-26', MID, N - 1]];
const qq = (a: number, b: number) => C[qId][b] / C[qId][a] - 1;
console.log(`\nPART 2 — first 2-3 pullbacks to the rising 10-week line (QQQ held: 2016-20 ${pct(qq(START, MID - 1))}, 2021-26 ${pct(qq(MID, N - 1))})`);
let pass = true;
for (const [lab, f, graded] of [
  ['RULE: pullback #1-3, earnings growing', (t: Tr) => t.n <= 3 && t.earn === true, true],
  ['pullback #1-3, no earnings filter', (t: Tr) => t.n <= 3, false],
  ['pullback #4+, earnings growing', (t: Tr) => t.n >= 4 && t.earn === true, false],
] as const) {
  console.log(` ${lab}`);
  for (const [h, a, b] of HALF) {
    const ts = trades.filter(t => f(t) && t.e >= a && t.e <= b); const acc = portfolio(ts, a, b);
    const ok = mean(ts.map(t => t.ex)) > 0 && acc.ret > qq(a, b); if (graded && !ok) pass = false;
    console.log(`  ${h}: n ${ts.length} avg ${pct(mean(ts.map(t => t.ret)))} win ${(100 * mean(ts.map(t => +(t.ret > 0)))).toFixed(0)}% +100%+ ${ts.filter(t => t.ret >= 1).length} | vs QQQ ${pct(mean(ts.map(t => t.ex)))} | $100k → $${((1 + acc.ret) * 100).toFixed(0)}k (dd ${pct(-acc.dd)})`);
  }
}
console.log(` earnings data present on ${(100 * mean(trades.map(t => +(t.earn !== null)))).toFixed(0)}% of pullbacks`);
console.log(` → ${pass ? 'PASS' : 'fail'}`);

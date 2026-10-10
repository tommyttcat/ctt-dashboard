// scripts/backtest/momentum-crash.ts — momentum with crash protection, 2016-2026.
//
//   LONG=1 NODE_OPTIONS=--max-old-space-size=8192 npx tsx scripts/backtest/momentum-crash.ts
//
// long-history.ts: the 12-1 momentum top 50 made +331% vs QQQ +207% in
// 2016-20 but crashed in 2021 (-46%). Does crash protection keep the gains?
//
// RULES — fixed 10 Oct 2026, before the first run.
//   List: long-history.ts B — month-end top 50 by 12-1 momentum among CS/ADRC,
//     real close >= $2, 20-session $ volume >= $20M; equal weight from the next
//     open, held to the next month's open (buy-and-hold within the month).
//     0.12% monthly turnover cost (as long-history.ts).
//   The list's DAILY value is tracked so exposure can change any day; exposure
//     for day d is decided at close d-1. Cash earns 3% a year, borrowing costs
//     5%; changing exposure costs 0.2% x the change.
//   M0  the list, always 100%.
//   M1  the list while QQQ closed above its 200-day, else cash (O3 gate).
//   M2  O4 gate: 150% for the 10 sessions after a washout close (20% or
//       fewer of universe names above their 40-day), else as M1.
//   M3  volatility-scaled (Barroso & Santa-Clara 2015): exposure =
//       min(1, 25% / the list's realized volatility over the prior 126
//       sessions, annualized). 100% until 126 sessions exist.
//   M4  M2's exposure x M3's scale.
//   Benchmarks: QQQ held; O4 on QQQ (long-history.ts C).
//   Halves: 2016-01-01..2020-12-31 and 2021-01-01..end.
//   PASS: total return above QQQ AND above O4-on-QQQ, AND CAGR / worst drop
//     above QQQ's — all in BOTH halves.

import { loadAdjusted, listSessions, readDay } from './cache';
import { loadReference, refAt } from './reference';

const c = loadAdjusted();
const ref = loadReference();
const { sessions, syms, O, C, V } = c;
const N = sessions.length;
const qId = c.idOf.get('QQQ')!;
const RC: Float32Array[] = syms.map(() => new Float32Array(N).fill(NaN));
{ if (listSessions().length !== N) throw new Error('session mismatch');
  for (let s = 0; s < N; s++) for (const r of readDay('unadj', sessions[s])) { const id = c.idOf.get(r[0]); if (id != null) RC[id][s] = r[4]; } }
const typeOk = new Map<string, boolean>();
const isStock = (sym: string, date: string) => { const k = `${sym}|${date.slice(0, 4)}`; if (!typeOk.has(k)) { const t = (refAt(ref, sym, date)?.type || '').toUpperCase(); typeOk.set(k, t === 'CS' || t === 'ADRC'); } return typeOk.get(k)!; };
const inUni = (id: number, t: number) => {
  if (!(RC[id][t] >= 2) || Number.isNaN(C[id][t - 260])) return false;
  let dv = 0; for (let j = t - 19; j <= t; j++) { if (Number.isNaN(C[id][j])) return false; dv += C[id][j] * V[id][j]; }
  return dv / 20 >= 20e6 && isStock(syms[id], sessions[t]);
};
const qS200 = new Float64Array(N).fill(NaN);
for (let t = 199; t < N; t++) { let s = 0; for (let j = t - 199; j <= t; j++) s += C[qId][j]; qS200[t] = s / 200; }
const qOn = (t: number) => C[qId][t] > qS200[t];
const breadth = new Float64Array(N).fill(NaN);
for (let t = 41; t < N; t++) { let up = 0, tot = 0; for (let id = 0; id < syms.length; id++) { const x = C[id][t]; if (!(x > 0) || Number.isNaN(C[id][t - 40])) continue; let s = 0; for (let j = t - 39; j <= t; j++) s += C[id][j]; if (Number.isNaN(s)) continue; tot++; if (x > s / 40) up++; } if (tot >= 100) breadth[t] = up / tot * 100; }
const boost = new Array<boolean>(N).fill(false); { let until = -1; for (let t = 200; t < N - 1; t++) { if (t <= until) continue; if (breadth[t] <= 20) { until = t + 10; for (let k = t + 1; k <= Math.min(N - 1, t + 10); k++) boost[k] = true; } } }

// ---- daily returns of the monthly list ----
const ends: number[] = []; for (let s = 0; s < N - 1; s++) if (sessions[s].slice(0, 7) !== sessions[s + 1].slice(0, 7) && s >= 261) ends.push(s);
const R = new Float64Array(N).fill(NaN);           // the list's return on day d (close d-1 -> close d)
const last = (id: number, d: number, a: number) => { let k = d; while (k >= a && !(C[id][k] > 0)) k--; return k >= a ? C[id][k] : O[id][a]; };
let prevHold: number[] = [], prevA = -1;
for (let i = 0; i < ends.length; i++) {
  const t = ends[i], a = t + 1; if (a >= N) break;
  const b = i + 1 < ends.length ? ends[i + 1] + 1 : N;
  const pool: { id: number; mom: number }[] = [];
  for (let id = 0; id < syms.length; id++) { if (!inUni(id, t)) continue; const m = C[id][t - 21] / C[id][t - 252] - 1; if (Number.isFinite(m)) pool.push({ id, mom: m }); }
  pool.sort((x, y) => y.mom - x.mom);
  const hold = pool.filter(p => O[p.id][a] > 0).slice(0, 50).map(p => p.id);
  // day a: old book close(a-1)->open(a), new book open(a)->close(a)
  const val = (ids: number[], d: number, base: (id: number) => number) => ids.reduce((s, id) => s + last(id, d, a) / base(id), 0) / ids.length;
  const oldOvernight = prevHold.length ? prevHold.reduce((s, id) => { const pc = last(id, a - 1, prevA); const op = O[id][a] > 0 ? O[id][a] : pc; return s + op / pc; }, 0) / prevHold.length : 1;
  const newIntra = val(hold, a, id => O[id][a]);
  const turn = prevHold.length ? hold.filter(x => !prevHold.includes(x)).length / hold.length : 1;
  R[a] = oldOvernight * newIntra * (1 - 2 * 0.001 * turn) - 1;
  // within the month: buy-and-hold weights
  let prevV = newIntra;
  for (let d = a + 1; d < b && d < N; d++) { const v = val(hold, d, id => O[id][a]); R[d] = v / prevV - 1; prevV = v; }
  prevHold = hold; prevA = a;
}
const start = ends[0] + 1;
// realized vol of the list (126 sessions, annualized)
const vol = new Float64Array(N).fill(NaN);
for (let d = start + 126; d < N; d++) { let s = 0, s2 = 0; for (let j = d - 125; j <= d; j++) { s += R[j]; s2 += R[j] * R[j]; } const m = s / 126; vol[d] = Math.sqrt(Math.max(0, s2 / 126 - m * m) * 252); }

const nav = (ret: (d: number) => number, expo: (d: number) => number) => {
  const v = new Float64Array(N).fill(1); let pe = 0;
  for (let d = start; d < N; d++) {
    const e = expo(d), r = ret(d);
    const fin = e > 1 ? -(e - 1) * 0.05 / 252 : (1 - e) * 0.03 / 252;
    v[d] = (d > start ? v[d - 1] : 1) * (1 + e * (Number.isFinite(r) ? r : 0) + fin - 0.002 * Math.abs(e - pe));
    pe = e;
  }
  return v;
};
const gate3 = (d: number) => (qOn(d - 1) ? 1 : 0);
const gate4 = (d: number) => (boost[d] ? 1.5 : qOn(d - 1) ? 1 : 0);
const vscale = (d: number) => (Number.isFinite(vol[d - 1]) && vol[d - 1] > 0 ? Math.min(1, 0.25 / vol[d - 1]) : 1);
const listR = (d: number) => R[d];
const qR = (d: number) => C[qId][d] / C[qId][d - 1] - 1;
const series: [string, Float64Array][] = [
  ['QQQ held', nav(qR, () => 1)],
  ['O4 on QQQ', nav(qR, gate4)],
  ['M0 list', nav(listR, () => 1)],
  ['M1 list, 200-day gate', nav(listR, gate3)],
  ['M2 list, O4 gate', nav(listR, gate4)],
  ['M3 list, vol-scaled', nav(listR, vscale)],
  ['M4 list, O4 x vol', nav(listR, d => gate4(d) * vscale(d))],
];
const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const idx = (d: string) => { const i = sessions.findIndex(x => x >= d); return i < 0 ? N : i; };
const seg = (v: Float64Array, a: number, b: number) => { let pk = 0, dd = 0; for (let d = a; d <= b; d++) { pk = Math.max(pk, v[d]); dd = Math.max(dd, 1 - v[d] / pk); } const tot = v[b] / v[a - 1] - 1; const cagr = (1 + tot) ** (252 / (b - a + 1)) - 1; return { tot, dd, r: dd > 0 ? cagr / dd : Infinity }; };
const years = [...new Set(sessions.slice(start).map(d => d.slice(0, 4)))];
console.log(`from ${sessions[start]} to ${sessions[N - 1]}`);
console.log(`year   ${series.map(s => s[0].split(',')[0].padStart(9)).join(' ')}`);
for (const y of years) { const a = Math.max(start + 1, idx(`${y}-01-01`)), b = Math.min(N, idx(`${+y + 1}-01-01`)) - 1; console.log(`${y}   ${series.map(([, v]) => pct(v[b] / v[a - 1] - 1).padStart(9)).join(' ')}`); }
const H = [[Math.max(start + 1, idx('2016-01-01')), idx('2021-01-01') - 1], [idx('2021-01-01'), N - 1]];
console.log('');
const q = H.map(([a, b]) => seg(series[0][1], a, b)), o4 = H.map(([a, b]) => seg(series[1][1], a, b));
for (const [name, v] of series) {
  const h = H.map(([a, b]) => seg(v, a, b));
  const pass = name.startsWith('M') && h.every((x, i) => x.tot > q[i].tot && x.tot > o4[i].tot && x.r > q[i].r);
  console.log(`${name.padEnd(24)} 2016-20 ${pct(h[0].tot).padStart(8)} drop ${pct(-h[0].dd).padStart(7)} r ${h[0].r.toFixed(2)} | 2021-26 ${pct(h[1].tot).padStart(8)} drop ${pct(-h[1].dd).padStart(7)} r ${h[1].r.toFixed(2)}${name.startsWith('M') ? (pass ? '  → PASS' : '  → fail') : ''}`);
}

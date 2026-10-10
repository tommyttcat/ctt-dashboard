// scripts/backtest/ai-system.ts — a system learned from all the data, tested walk-forward.
//
//   LONG=1 NODE_OPTIONS=--max-old-space-size=16384 npx tsx scripts/backtest/ai-system.ts
//
// Asked 10 Oct 2026: "use all the data and the other systems to create a new
// system — the most consistent way that works." Every signal tested so far
// becomes a feature; a model learns their weights from the past only, and
// predicts each year it has never seen.
//
// RULES — fixed 10 Oct 2026, before the first run.
//   Universe each week (every 5th session from 2016): CS/ADRC, real close >= $2,
//     20-session $ volume >= $20M, 260 sessions of history.
//   FEATURES at the week's close (all known then): r5 r21 r63 r126 mom12_1,
//     vol20 vol60 (daily-return stdev), adr20, smooth (frog-in-the-pan, 252),
//     off52 (close / 252-day high - 1), vs20 vs50 vs200 (close / SMA - 1),
//     slope50 (SMA50 / SMA50 10 sessions ago - 1), rvol1 (volume / 20-day avg),
//     rvol5 (5-day avg / 50-day avg), chg1, atrExp (range / ATR14), closeStr,
//     gap, rsi14, max21 / min21 (largest / smallest daily return, 21 sessions),
//     logDvol, beta60 (to QQQ), logPrice (real), offLow20 (close / 20-day low - 1),
//     secMom (2-digit SIC average r63) and relSec (r63 - secMom).
//     Each feature is ranked within the week to [-0.5, 0.5]; the model sees each
//     rank and its square (so "in the middle is best" can be learned). Missing = 0.
//   TARGET: the forward 20-session return, ranked within the week to [-0.5, 0.5].
//   MODEL: ridge regression, lambda = 10 x rows / 1000 (fixed), no other tuning.
//   WALK-FORWARD: for each test year Y = 2018..2026, train on every week whose
//     20-session outcome ended before Y's first week; predict Y's weeks.
//   EVALUATION (out of sample only):
//     IC = Spearman rank correlation of prediction vs forward return, per week.
//     Top-decile minus bottom-decile forward 20-day return, per year.
//     LONG: top 20 by prediction among names with $50M+ a day, equal weight,
//       held 20 sessions, 4 staggered weekly sleeves; 0.1% a side on turnover.
//     LONG/SHORT: the same top 20 minus the bottom 20.
//   PASS (pre-registered): mean IC > 0 in at least 7 of the 9 test years AND the
//     LONG book beats QQQ over 2018-2021 AND over 2022-2026 AND the LONG/SHORT
//     book is positive in both.

import fs from 'node:fs';
import path from 'node:path';
import { DATA, loadAdjusted, listSessions, readDay } from './cache';
import { loadReference, refAt } from './reference';

const c = loadAdjusted();
const ref = loadReference();
const { sessions, syms, O, H, L, C, V } = c;
const N = sessions.length;
const qId = c.idOf.get('QQQ')!;
const RC: Float32Array[] = syms.map(() => new Float32Array(N).fill(NaN));
{ if (listSessions().length !== N) throw new Error('session mismatch');
  for (let s = 0; s < N; s++) for (const r of readDay('unadj', sessions[s])) { const id = c.idOf.get(r[0]); if (id != null) RC[id][s] = r[4]; } }
const sic: Record<string, string> = (() => { try { return JSON.parse(fs.readFileSync(path.join(DATA, 'reference', 'sic.json'), 'utf8')); } catch { return {}; } })();
const sec2 = (sym: string) => { const v = (sic as any)[sym]; const s = typeof v === 'string' ? v : v?.sic ?? v?.code; return s ? String(s).slice(0, 2) : ''; };
const typeOk = new Map<string, boolean>();
const isStock = (sym: string, date: string) => { const k = `${sym}|${date.slice(0, 4)}`; if (!typeOk.has(k)) { const t = (refAt(ref, sym, date)?.type || '').toUpperCase(); typeOk.set(k, t === 'CS' || t === 'ADRC'); } return typeOk.get(k)!; };
const idx = (d: string) => { const i = sessions.findIndex(x => x >= d); return i < 0 ? N : i; };
const FEATS = ['r5', 'r21', 'r63', 'r126', 'mom', 'vol20', 'vol60', 'adr', 'smooth', 'off52', 'vs20', 'vs50', 'vs200', 'slope50', 'rvol1', 'rvol5', 'chg1', 'atrExp', 'closeStr', 'gap', 'rsi', 'max21', 'min21', 'logDvol', 'beta', 'logPx', 'offLow20', 'secMom', 'relSec'];
const F = FEATS.length;
const qr = (k: number) => C[qId][k] / C[qId][k - 1] - 1;

type Week = { t: number; ids: number[]; X: Float32Array; y: Float32Array; fwd: Float32Array; dv: Float32Array };
const weeks: Week[] = [];
const start = idx('2016-01-04');
for (let t = start; t + 20 < N; t += 5) {
  const rows: { id: number; f: number[]; fwd: number; dv: number }[] = [];
  for (let id = 0; id < syms.length; id++) {
    if (id === qId) continue;
    const cl = C[id];
    if (!(RC[id][t] >= 2) || Number.isNaN(cl[t - 260]) || Number.isNaN(cl[t])) continue;
    let ok = true, dv = 0; for (let j = t - 260; j <= t; j++) if (Number.isNaN(cl[j])) { ok = false; break; }
    if (!ok) continue;
    for (let j = t - 19; j <= t; j++) dv += cl[j] * V[id][j]; dv /= 20;
    if (dv < 20e6 || !isStock(syms[id], sessions[t])) continue;
    let k = t + 20; while (k > t && Number.isNaN(cl[k])) k--; if (k === t) continue;
    const ret = (a: number) => cl[t] / cl[t - a] - 1;
    const dr = (j: number) => cl[j] / cl[j - 1] - 1;
    const sd = (n: number) => { let s = 0, s2 = 0; for (let j = t - n + 1; j <= t; j++) { const x = dr(j); s += x; s2 += x * x; } const m = s / n; return Math.sqrt(Math.max(0, s2 / n - m * m)); };
    const sma = (n: number, at = t) => { let s = 0; for (let j = at - n + 1; j <= at; j++) s += cl[j]; return s / n; };
    let hi252 = -Infinity, lo20 = Infinity, adr = 0, atr = 0, up = 0, dn = 0, mx = -Infinity, mn = Infinity, g = 0, ls = 0, v20 = 0, v5 = 0, v50 = 0;
    for (let j = t - 251; j <= t; j++) { hi252 = Math.max(hi252, H[id][j]); const x = dr(j); if (x > 0) up++; else if (x < 0) dn++; }
    for (let j = t - 19; j <= t; j++) { lo20 = Math.min(lo20, L[id][j]); adr += H[id][j] / L[id][j] - 1; v20 += V[id][j]; }
    for (let j = t - 13; j <= t; j++) { atr += Math.max(H[id][j], cl[j - 1]) - Math.min(L[id][j], cl[j - 1]); const x = dr(j); if (x > 0) g += x; else ls -= x; }
    for (let j = t - 20; j <= t; j++) { const x = dr(j); mx = Math.max(mx, x); mn = Math.min(mn, x); }
    for (let j = t - 4; j <= t; j++) v5 += V[id][j]; for (let j = t - 49; j <= t; j++) v50 += V[id][j];
    let sxy = 0, sxx = 0; for (let j = t - 59; j <= t; j++) { const a = qr(j), b = dr(j); sxy += a * b; sxx += a * a; }
    const r12 = ret(252);
    rows.push({ id, dv, fwd: cl[k] / cl[t] - 1, f: [
      ret(5), ret(21), ret(63), ret(126), cl[t - 21] / cl[t - 252] - 1, sd(20), sd(60), adr / 20, -Math.sign(r12) * (dn - up) / 252,
      cl[t] / hi252 - 1, cl[t] / sma(20) - 1, cl[t] / sma(50) - 1, cl[t] / sma(200) - 1, sma(50) / sma(50, t - 10) - 1,
      V[id][t] / (v20 / 20), (v5 / 5) / (v50 / 50), dr(t), (H[id][t] - L[id][t]) / (atr / 14),
      H[id][t] > L[id][t] ? (cl[t] - L[id][t]) / (H[id][t] - L[id][t]) : 0.5, O[id][t] / cl[t - 1] - 1, ls === 0 ? 100 : 100 - 100 / (1 + g / ls),
      mx, mn, Math.log(dv), sxx > 0 ? sxy / sxx : 1, Math.log(RC[id][t]), cl[t] / lo20 - 1, NaN, NaN] });
  }
  if (rows.length < 100) continue;
  // sector momentum
  const secR = new Map<string, number[]>(); rows.forEach(r => { const s = sec2(syms[r.id]); if (s) (secR.get(s) ?? secR.set(s, []).get(s)!).push(r.f[2]); });
  rows.forEach(r => { const s = sec2(syms[r.id]); const a = s ? secR.get(s)! : null; if (a && a.length >= 5) { const m = a.reduce((x, y) => x + y, 0) / a.length; r.f[27] = m; r.f[28] = r.f[2] - m; } });
  const n = rows.length, X = new Float32Array(n * F), y = new Float32Array(n), fwd = new Float32Array(n), dv = new Float32Array(n);
  const rankInto = (vals: number[], put: (i: number, v: number) => void) => { const o = vals.map((v, i) => [v, i] as [number, number]).filter(p => Number.isFinite(p[0])).sort((a, b) => a[0] - b[0]); const m = o.length; o.forEach(([, i], r) => put(i, m > 1 ? r / (m - 1) - 0.5 : 0)); };
  for (let f = 0; f < F; f++) rankInto(rows.map(r => r.f[f]), (i, v) => { X[i * F + f] = v; });
  rankInto(rows.map(r => r.fwd), (i, v) => { y[i] = v; });
  rows.forEach((r, i) => { fwd[i] = r.fwd; dv[i] = r.dv; });
  weeks.push({ t, ids: rows.map(r => r.id), X, y, fwd, dv });
}
console.log(`weeks ${weeks.length} (${sessions[weeks[0].t]} → ${sessions[weeks[weeks.length - 1].t]}), avg names ${Math.round(weeks.reduce((a, w) => a + w.ids.length, 0) / weeks.length)}`);

// ridge on [1, x, x^2]
const P = 1 + 2 * F;
const featRow = (w: Week, i: number, out: Float64Array) => { out[0] = 1; for (let f = 0; f < F; f++) { const x = w.X[i * F + f]; out[1 + f] = x; out[1 + F + f] = x * x - 1 / 12; } };
function solve(A: Float64Array, b: Float64Array, n: number): Float64Array { // Gaussian elimination
  const M = new Float64Array(n * (n + 1)); for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) M[i * (n + 1) + j] = A[i * n + j]; M[i * (n + 1) + n] = b[i]; }
  for (let col = 0; col < n; col++) { let piv = col; for (let r = col + 1; r < n; r++) if (Math.abs(M[r * (n + 1) + col]) > Math.abs(M[piv * (n + 1) + col])) piv = r;
    if (piv !== col) for (let j = 0; j <= n; j++) { const tmp = M[col * (n + 1) + j]; M[col * (n + 1) + j] = M[piv * (n + 1) + j]; M[piv * (n + 1) + j] = tmp; }
    const d = M[col * (n + 1) + col]; for (let j = col; j <= n; j++) M[col * (n + 1) + j] /= d;
    for (let r = 0; r < n; r++) if (r !== col) { const f = M[r * (n + 1) + col]; if (f) for (let j = col; j <= n; j++) M[r * (n + 1) + j] -= f * M[col * (n + 1) + j]; } }
  const x = new Float64Array(n); for (let i = 0; i < n; i++) x[i] = M[i * (n + 1) + n]; return x;
}
function fit(train: Week[]): Float64Array {
  const A = new Float64Array(P * P), b = new Float64Array(P), row = new Float64Array(P); let rows = 0;
  for (const w of train) for (let i = 0; i < w.ids.length; i++) { featRow(w, i, row); const yi = w.y[i]; rows++; for (let a = 0; a < P; a++) { b[a] += row[a] * yi; const ra = row[a]; for (let k = 0; k < P; k++) A[a * P + k] += ra * row[k]; } }
  const lam = 10 * rows / 1000; for (let a = 1; a < P; a++) A[a * P + a] += lam;
  return solve(A, b, P);
}
const spearman = (a: ArrayLike<number>, b: ArrayLike<number>) => { const n = a.length; const rk = (v: ArrayLike<number>) => { const o = Array.from({ length: n }, (_, i) => i).sort((x, y) => v[x] - v[y]); const r = new Float64Array(n); o.forEach((i, k) => (r[i] = k)); return r; }; const ra = rk(a), rb = rk(b); let s = 0; for (let i = 0; i < n; i++) s += (ra[i] - rb[i]) ** 2; return 1 - 6 * s / (n * (n * n - 1)); };

type Pred = { w: Week; p: Float64Array };
const preds: Pred[] = [];
const coefsByYear: Record<string, Float64Array> = {};
for (let Y = 2018; Y <= 2026; Y++) {
  const firstIdx = weeks.findIndex(w => sessions[w.t] >= `${Y}-01-01`); if (firstIdx < 0) break;
  const firstT = weeks[firstIdx].t;
  const train = weeks.filter(w => w.t + 20 < firstT);
  const beta = fit(train); coefsByYear[Y] = beta;
  const row = new Float64Array(P);
  for (const w of weeks.filter(w => sessions[w.t].startsWith(String(Y)))) { const p = new Float64Array(w.ids.length); for (let i = 0; i < w.ids.length; i++) { featRow(w, i, row); let s = 0; for (let a = 0; a < P; a++) s += beta[a] * row[a]; p[i] = s; } preds.push({ w, p }); }
}
const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
// IC and decile spread per year
console.log(`\nOUT-OF-SAMPLE CONSISTENCY (each year predicted by a model trained only on earlier years)`);
console.log(`  year  weeks  mean IC  weeks IC>0  top-decile 20d  bottom-decile  spread`);
let yearsPos = 0;
const yrs = [...new Set(preds.map(p => sessions[p.w.t].slice(0, 4)))];
for (const y of yrs) {
  const ps = preds.filter(p => sessions[p.w.t].startsWith(y));
  const ics = ps.map(p => spearman(p.p, p.w.fwd));
  const top: number[] = [], bot: number[] = [];
  for (const p of ps) { const o = Array.from(p.p.keys()).sort((a, b) => p.p[b] - p.p[a]); const d = Math.floor(o.length / 10); o.slice(0, d).forEach(i => top.push(p.w.fwd[i])); o.slice(-d).forEach(i => bot.push(p.w.fwd[i])); }
  if (mean(ics) > 0) yearsPos++;
  console.log(`  ${y}  ${String(ps.length).padStart(5)}  ${mean(ics).toFixed(3).padStart(7)}  ${(100 * mean(ics.map(x => +(x > 0)))).toFixed(0).padStart(6)}%     ${pct(mean(top)).padStart(7)}      ${pct(mean(bot)).padStart(7)}   ${pct(mean(top) - mean(bot)).padStart(7)}`);
}
const allIc = preds.map(p => spearman(p.p, p.w.fwd));
const icT = mean(allIc) / (Math.sqrt(mean(allIc.map(x => (x - mean(allIc)) ** 2))) / Math.sqrt(allIc.length));
console.log(`  all   mean IC ${mean(allIc).toFixed(3)}, positive in ${(100 * mean(allIc.map(x => +(x > 0)))).toFixed(0)}% of weeks, t-stat ${icT.toFixed(1)} (overlapping 20-day outcomes inflate it ~2x)`);

// books: 4 staggered sleeves, each rebalanced every 4 weeks (20 sessions)
const book = (short: boolean, from: string, to: string) => {
  const sleeves = [0, 1, 2, 3].map(off => { let v = 1, prev = new Set<number>(); preds.filter((p, i) => i % 4 === off && sessions[p.w.t] >= from && sessions[p.w.t] <= to).forEach(p => {
    const elig = Array.from(p.p.keys()).filter(i => p.w.dv[i] >= 50e6).sort((a, b) => p.p[b] - p.p[a]);
    const top = elig.slice(0, 20), bot = elig.slice(-20);
    const lr = mean(top.map(i => p.w.fwd[i])), sr = mean(bot.map(i => p.w.fwd[i]));
    const ids = new Set(top.map(i => p.w.ids[i])); const turn = prev.size ? [...ids].filter(x => !prev.has(x)).length / ids.size : 1; prev = ids;
    v *= 1 + (short ? (lr - sr) / 2 : lr) - 0.002 * turn * (short ? 2 : 1); }); return v; });
  return mean(sleeves) - 1;
};
const qq = (a: string, b: string) => C[qId][idx(b) >= N ? N - 1 : idx(b)] / C[qId][idx(a)] - 1;
console.log(`\nBOOKS (out of sample)`);
for (const [a, b] of [['2018-01-01', '2021-12-31'], ['2022-01-01', '2026-12-31']] as const) console.log(`  ${a.slice(0, 4)}-${b.slice(0, 4)}: LONG top 20 ${pct(book(false, a, b))} | LONG/SHORT ${pct(book(true, a, b))} | QQQ ${pct(qq(a, b))}`);
for (const y of yrs) console.log(`    ${y}: long ${pct(book(false, `${y}-01-01`, `${y}-12-31`)).padStart(7)}  long/short ${pct(book(true, `${y}-01-01`, `${y}-12-31`)).padStart(7)}  QQQ ${pct(qq(`${y}-01-01`, `${y}-12-31`)).padStart(7)}`);
const passIc = yearsPos >= 7;
const pL = [['2018-01-01', '2021-12-31'], ['2022-01-01', '2026-12-31']].every(([a, b]) => book(false, a, b) > qq(a, b));
const pS = [['2018-01-01', '2021-12-31'], ['2022-01-01', '2026-12-31']].every(([a, b]) => book(true, a, b) > 0);
console.log(`  → IC positive in ${yearsPos}/${yrs.length} years; long beats QQQ both: ${pL}; long/short positive both: ${pS} → ${passIc && pL && pS ? 'PASS' : 'fail'}`);
// what the last model weighs most (linear term)
const last = coefsByYear[2026] ?? Object.values(coefsByYear).pop()!;
const w = FEATS.map((f, i) => [f, last[1 + i], last[1 + F + i]] as [string, number, number]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
console.log(`\nLATEST MODEL — strongest linear weights (+ = higher rank predicts better; sq = curve):`);
console.log('  ' + w.slice(0, 14).map(([f, a, b]) => `${f} ${a >= 0 ? '+' : ''}${a.toFixed(3)} (sq ${b >= 0 ? '+' : ''}${b.toFixed(3)})`).join('\n  '));

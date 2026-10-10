// scripts/backtest/runner-model.ts — which stocks are about to RUN? (walk-forward)
//
//   LONG=1 NODE_OPTIONS=--max-old-space-size=16384 npx tsx scripts/backtest/runner-model.ts
//
// Asked 10 Oct 2026: "use all the data and the other systems to create a new
// system — the most consistent way that works." Every signal tested so far
// becomes a feature; a model learns their weights from the past only, and
// predicts each year it has never seen.
//
// NOSEC=1 (10 Oct, for production: SIC sectors are local-only) leaves the two
// sector features at 0. EXPORT=1 also fits on every week and prints the weights.
// RUNNER RULES — fixed 10 Oct 2026, before the first run (user: "green should tell me to
// look at the stock first"). The ai-system.ts model predicted the AVERAGE stock's next
// 20 days and favoured steady names; this one predicts the right tail.
//   LABEL: 1 if, within the next 40 sessions, a close is 20%+ above the signal close
//     BEFORE any close 10%+ below it; else 0. TRADE: the same rule as an exit (out at
//     the first close +20% / -10%, else the 40th close), from the signal close, 0.2% costs.
//   Same universe, weeks, features (sector off), ridge and walk-forward as ai-system.ts
//   (rules below), with the binary label as the target. Weeks need 40 sessions ahead.
//   EVALUATION (out of sample, 2018-2026):
//     L1 top-decile runner rate / base rate, per year.
//     L2 inside the momentum leaders (top 5% by 12-1 momentum that week): runner
//        rate of the top third by score vs the bottom third, per year.
//     L3 book: each week the top 10 by score ($20M+ a day) traded with the TRADE rule;
//        average trade and win rate, 2018-21 and 2022-26.
//     Liquidity buckets ($20-50M, $50-200M, $200M+): runner rates, base and top decile.
//   PASS: L1 lift >= 1.5 in >= 7 of 9 years AND L2 top > bottom in >= 7 of 9 years AND
//     L3 average trade > 0 in both halves.
// (ai-system.ts rules follow)
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
import { featuresAt } from '../../src/lib/system';

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

type Week = { t: number; ids: number[]; X: Float32Array; y: Float32Array; fwd: Float32Array; dv: Float32Array; run: Uint8Array; trade: Float32Array; momRank: Float32Array };
const weeks: Week[] = [];
const start = idx('2016-01-04');
for (let t = start; t + 40 < N; t += 5) {
  const rows: { id: number; f: number[]; fwd: number; dv: number; run: number; trade: number }[] = [];
  for (let id = 0; id < syms.length; id++) {
    if (id === qId) continue;
    const cl = C[id];
    if (!(RC[id][t] >= 2) || Number.isNaN(cl[t - 260]) || Number.isNaN(cl[t])) continue;
    let ok = true, dv = 0; for (let j = t - 260; j <= t; j++) if (Number.isNaN(cl[j])) { ok = false; break; }
    if (!ok) continue;
    for (let j = t - 19; j <= t; j++) dv += cl[j] * V[id][j]; dv /= 20;
    if (dv < 20e6 || !isStock(syms[id], sessions[t])) continue;
    let k = t + 20; while (k > t && Number.isNaN(cl[k])) k--; if (k === t) continue;
    let run = 0, trade = NaN;
    for (let j = t + 1; j <= t + 40; j++) { if (Number.isNaN(cl[j])) continue; const r = cl[j] / cl[t]; if (r >= 1.2) { run = 1; trade = 0.2; break; } if (r <= 0.9) { trade = r - 1; break; } }
    if (Number.isNaN(trade)) { let j = t + 40; while (j > t && Number.isNaN(cl[j])) j--; trade = cl[j] / cl[t] - 1; }
    trade -= 0.002;
    /* Features from the shared production code (lib/system featuresAt), so live
       scores and this test use the same arithmetic. */
    rows.push({ id, dv, run, trade, fwd: cl[k] / cl[t] - 1, f: featuresAt({ o: O[id], h: H[id], l: L[id], c: cl, v: V[id] }, t, C[qId], RC[id][t], dv) });
  }
  if (rows.length < 100) continue;
  // sector momentum
  const secR = new Map<string, number[]>(); rows.forEach(r => { const s = sec2(syms[r.id]); if (s) (secR.get(s) ?? secR.set(s, []).get(s)!).push(r.f[2]); });
  rows.forEach(r => { const s = sec2(syms[r.id]); const a = s ? secR.get(s)! : null; if (a && a.length >= 5) { const m = a.reduce((x, y) => x + y, 0) / a.length; r.f[27] = m; r.f[28] = r.f[2] - m; } });
  const n = rows.length, X = new Float32Array(n * F), y = new Float32Array(n), fwd = new Float32Array(n), dv = new Float32Array(n);
  const rankInto = (vals: number[], put: (i: number, v: number) => void) => { const o = vals.map((v, i) => [v, i] as [number, number]).filter(p => Number.isFinite(p[0])).sort((a, b) => a[0] - b[0]); const m = o.length; o.forEach(([, i], r) => put(i, m > 1 ? r / (m - 1) - 0.5 : 0)); };
  const NOSEC = process.env.NOSEC === '1';
  for (let f = 0; f < F; f++) { if (NOSEC && f >= 27) continue; rankInto(rows.map(r => r.f[f]), (i, v) => { X[i * F + f] = v; }); }
  rows.forEach((r, i) => { y[i] = r.run; });
  rows.forEach((r, i) => { fwd[i] = r.fwd; dv[i] = r.dv; });
  const run = new Uint8Array(n), trade = new Float32Array(n), momRank = new Float32Array(n);
  rows.forEach((r, i) => { run[i] = r.run; trade[i] = r.trade; momRank[i] = X[i * F + 4] + 0.5; });
  weeks.push({ t, ids: rows.map(r => r.id), X, y, fwd, dv, run, trade, momRank });
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
  // purge: training weeks must have their 40-session outcome known before the test year
  const A = new Float64Array(P * P), b = new Float64Array(P), row = new Float64Array(P); let rows = 0;
  for (const w of train) for (let i = 0; i < w.ids.length; i++) { featRow(w, i, row); const yi = w.y[i]; rows++; for (let a = 0; a < P; a++) { b[a] += row[a] * yi; const ra = row[a]; for (let k = 0; k < P; k++) A[a * P + k] += ra * row[k]; } }
  const lam = 10 * rows / 1000; for (let a = 1; a < P; a++) A[a * P + a] += lam;
  return solve(A, b, P);
}
const spearman = (a: ArrayLike<number>, b: ArrayLike<number>) => { const n = a.length; const rk = (v: ArrayLike<number>) => { const o = Array.from({ length: n }, (_, i) => i).sort((x, y) => v[x] - v[y]); const r = new Float64Array(n); o.forEach((i, k) => (r[i] = k)); return r; }; const ra = rk(a), rb = rk(b); let s = 0; for (let i = 0; i < n; i++) s += (ra[i] - rb[i]) ** 2; return 1 - 6 * s / (n * (n * n - 1)); };

type Pred = { w: Week; p: Float64Array };
const preds: Pred[] = [];
for (let Y = 2018; Y <= 2026; Y++) {
  const fi = weeks.findIndex(w => sessions[w.t] >= `${Y}-01-01`); if (fi < 0) break;
  const train = weeks.filter(w => w.t + 40 < weeks[fi].t);
  const beta = fit(train); const row = new Float64Array(P);
  for (const w of weeks.filter(w => sessions[w.t].startsWith(String(Y)))) { const p = new Float64Array(w.ids.length); for (let i = 0; i < w.ids.length; i++) { featRow(w, i, row); let sc = 0; for (let a = 0; a < P; a++) sc += beta[a] * row[a]; p[i] = sc; } preds.push({ w, p }); }
}
const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`;
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
const yrs = [...new Set(preds.map(p => sessions[p.w.t].slice(0, 4)))];
let l1 = 0, l2 = 0;
console.log(`weeks ${weeks.length}; OUT OF SAMPLE. runner = +20% close within 40 sessions before a -10% close`);
console.log(`  year  base   top-decile  lift | momentum leaders: top-third  bottom-third`);
for (const y of yrs) {
  const ps = preds.filter(p => sessions[p.w.t].startsWith(y));
  const all: number[] = [], top: number[] = [], mt: number[] = [], mb: number[] = [];
  for (const p of ps) {
    const o = Array.from(p.p.keys()).sort((a, b) => p.p[b] - p.p[a]); const d = Math.floor(o.length / 10);
    o.forEach(i => all.push(p.w.run[i])); o.slice(0, d).forEach(i => top.push(p.w.run[i]));
    const ml = o.filter(i => p.w.momRank[i] >= 0.95); const th = Math.floor(ml.length / 3);
    if (th >= 1) { ml.slice(0, th).forEach(i => mt.push(p.w.run[i])); ml.slice(-th).forEach(i => mb.push(p.w.run[i])); }
  }
  const lift = mean(top) / mean(all); if (lift >= 1.5) l1++; if (mean(mt) > mean(mb)) l2++;
  console.log(`  ${y}  ${(100 * mean(all)).toFixed(1).padStart(4)}%  ${(100 * mean(top)).toFixed(1).padStart(5)}%     ${lift.toFixed(2)} |   ${(100 * mean(mt)).toFixed(1).padStart(5)}%       ${(100 * mean(mb)).toFixed(1).padStart(5)}%`);
}
console.log(`\nLIQUIDITY (all years): runner rate base | model top decile`);
for (const [lo, hi, nm] of [[20e6, 50e6, '$20-50M'], [50e6, 200e6, '$50-200M'], [200e6, 1e15, '$200M+']] as [number, number, string][]) {
  const b: number[] = [], t: number[] = [];
  for (const p of preds) { const o = Array.from(p.p.keys()).sort((a, c) => p.p[c] - p.p[a]); const d = Math.floor(o.length / 10); const topSet = new Set(o.slice(0, d)); for (let i = 0; i < p.p.length; i++) if (p.w.dv[i] >= lo && p.w.dv[i] < hi) { b.push(p.w.run[i]); if (topSet.has(i)) t.push(p.w.run[i]); } }
  console.log(`  ${nm.padEnd(9)} ${(100 * mean(b)).toFixed(1)}% | ${(100 * mean(t)).toFixed(1)}% (n ${t.length})`);
}
const book = (a: string, b: string) => { const tr: number[] = []; for (const p of preds) { if (sessions[p.w.t] < a || sessions[p.w.t] > b) continue; const o = Array.from(p.p.keys()).filter(i => p.w.dv[i] >= 20e6).sort((x, z) => p.p[z] - p.p[x]).slice(0, 10); o.forEach(i => tr.push(p.w.trade[i])); } return tr; };
const baseTrades = (a: string, b: string) => { const tr: number[] = []; for (const p of preds) { if (sessions[p.w.t] < a || sessions[p.w.t] > b) continue; for (let i = 0; i < p.p.length; i += 7) tr.push(p.w.trade[i]); } return tr; };
console.log(`\nBOOK (top 10 a week, +20% / -10% / 40 sessions):`);
const halves = [['2018-01-01', '2021-12-31'], ['2022-01-01', '2026-12-31']];
const l3 = halves.map(([a, b]) => { const t = book(a, b), bt = baseTrades(a, b); console.log(`  ${a.slice(0, 4)}-${b.slice(0, 4)}: avg trade ${pct(mean(t))} win ${(100 * mean(t.map(x => +(x > 0)))).toFixed(0)}% hit +20% ${(100 * mean(t.map(x => +(x > 0.19)))).toFixed(0)}% n ${t.length} | random stock same rule ${pct(mean(bt))}`); return mean(t) > 0; });
console.log(`\n→ L1 lift>=1.5 in ${l1}/${yrs.length} years; L2 in ${l2}/${yrs.length}; L3 both halves ${l3.every(Boolean)} → ${l1 >= 7 && l2 >= 7 && l3.every(Boolean) ? 'PASS' : 'fail'}`);
if (process.env.EXPORT === '1') { const all = fit(weeks.filter(w => w.t + 40 < N)); console.log('\nEXPORT ' + JSON.stringify({ feats: FEATS, trainedOn: `${sessions[weeks[0].t]}..${sessions[weeks[weeks.length - 1].t]}`, weeks: weeks.length, beta: Array.from(all).map(x => +x.toPrecision(6)) })); }

// scripts/backtest/long-history.ts — the main tests again, on 2015-2026.
//
//   LONG=1 npx tsx scripts/backtest/long-history.ts
//
// Every earlier test ran on Sep 2021 - Sep 2026, which misses the years when
// breakout methods made their names. This reruns the core ideas year by year
// on FMP 2015-2021 + Polygon 2021-2026 (build-long-cache.ts).
//
// RULES — fixed 9 Oct 2026, before the long data existed.
//   Universe each day: CS/ADRC (reference), REAL traded close >= $2 (the user's
//     floor; real price from the split-free series), 20-session dollar volume
//     >= $20M, 260+ sessions of history.
//   Halves: H1 = 2016-01-01 .. 2020-12-31, H2 = 2021-01-01 .. end. Every result
//     is also printed per calendar year. Excess = return minus QQQ over the same
//     window, after 0.2% costs.
//   A BREAKOUTS: close above the prior 20 sessions' highest close, volume >= 1.5x
//     its prior 20-session average, close above SMA50. Buy the next open. Exits:
//       H20  close of the 20th session (no stop)
//       T10  first close below SMA10 (no stop, max 60 sessions)
//       S1   stop at the signal day's low (out at the open if it gaps through,
//            else at the stop); otherwise as T10
//     Gate: QQQ above its 200-day at the signal close (also shown ungated).
//     PASS: T10 or S1 excess > 0 in BOTH halves, gated.
//   B MOMENTUM: month-end top 50 by 12-1 momentum, equal weight, held a month
//     (next open to next month-end's next open), vs QQQ and SPY.
//     PASS: beats QQQ in both halves.
//   C EXPOSURE: QQQ when it closed above its 200-day, else cash at 3% a year
//     (O3); plus 150% for 10 sessions after a washout close (breadth <= 20% of
//     universe names above their 40-day) (O4). PASS: total above QQQ AND
//     CAGR / worst drop above QQQ's, both halves.
//   D BLUE DOT (the site's, lib/indicators/dots.ts): 10-session excess vs the
//     same-day all-universe baseline. PASS: +0.5 point or more in both halves.

import { loadAdjusted, listSessions, readDay } from './cache';
import { loadReference, refAt } from './reference';

const c = loadAdjusted();
const ref = loadReference();
const { sessions, syms, O, H, L, C, V } = c;
const N = sessions.length;
const qId = c.idOf.get('QQQ')!, spyId = c.idOf.get('SPY')!;
console.log(`sessions ${N}: ${sessions[0]} → ${sessions[N - 1]}`);
// real (unadjusted) close
const RC: Float32Array[] = syms.map(() => new Float32Array(N).fill(NaN));
{ const all = listSessions(); if (all.length !== N) throw new Error('session mismatch');
  for (let s = 0; s < N; s++) for (const r of readDay('unadj', sessions[s])) { const id = c.idOf.get(r[0]); if (id != null) RC[id][s] = r[4]; } }
const COST = 0.002;
const yearOf = (t: number) => sessions[t].slice(0, 4);
const halfOf = (t: number) => (sessions[t] < '2016-01-01' ? -1 : sessions[t] <= '2020-12-31' ? 0 : 1);
const typeOk = new Map<string, boolean>();
const isStock = (sym: string, date: string) => { const k = `${sym}|${date.slice(0, 4)}`; if (!typeOk.has(k)) { const t = (refAt(ref, sym, date)?.type || '').toUpperCase(); typeOk.set(k, t === 'CS' || t === 'ADRC'); } return typeOk.get(k)!; };
const qS200 = new Float64Array(N).fill(NaN);
for (let t = 199; t < N; t++) { let s = 0; for (let j = t - 199; j <= t; j++) s += C[qId][j]; qS200[t] = s / 200; }
const qOn = (t: number) => C[qId][t] > qS200[t];
const pct = (x: number) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%` : '   —  ');
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const inUni = (id: number, t: number) => {
  if (!(RC[id][t] >= 2) || Number.isNaN(C[id][t - 260])) return false;
  let dv = 0; for (let j = t - 19; j <= t; j++) { if (Number.isNaN(C[id][j])) return false; dv += C[id][j] * V[id][j]; }
  return dv / 20 >= 20e6 && isStock(syms[id], sessions[t]);
};

// ---------- A + D: one pass over every name ----------
type Ev = { t: number; on: boolean; h20: number; t10: number; s1: number };
const brk: Ev[] = [];
const blue: { t: number; ex10: number }[] = [];
const base10 = new Map<number, number[]>();
for (let id = 0; id < syms.length; id++) {
  const cl = C[id];
  const sma = (t: number, n: number) => { let s = 0; for (let j = t - n + 1; j <= t; j++) s += cl[j]; return s / n; };
  let e21 = NaN;
  for (let t = 1; t < N; t++) { if (Number.isNaN(cl[t])) { e21 = NaN; continue; } e21 = Number.isNaN(e21) ? cl[t] : cl[t] * (2 / 22) + e21 * (20 / 22); 
    if (t < 261 || t + 21 >= N || Number.isNaN(O[id][t + 1])) continue;
    if (!inUni(id, t)) continue;
    const e = t + 1, fill = O[id][e];
    const qr = (k: number) => C[qId][k] / O[qId][e] - 1;
    let k10 = e + 9; while (k10 > e && Number.isNaN(cl[k10])) k10--;
    const ex10 = cl[k10] / fill - 1 - COST - qr(e + 9);
    (base10.get(t) ?? base10.set(t, []).get(t)!).push(ex10);
    // site blue dot
    let lo3 = Infinity;
    for (let i = 0; i < 3; i++) { let hh = -Infinity, ll = Infinity; for (let j = t - i - 9; j <= t - i; j++) { hh = Math.max(hh, H[id][j]); ll = Math.min(ll, L[id][j]); } const k = hh === ll ? 50 : ((cl[t - i] - ll) / (hh - ll)) * 100; lo3 = Math.min(lo3, k); }
    if (lo3 <= 25 && cl[t] > cl[t - 1] && (cl[t] > sma(t, 30) || cl[t] > e21)) blue.push({ t, ex10 });
    // breakout
    let mx = -Infinity, vs = 0; for (let j = t - 20; j < t; j++) { mx = Math.max(mx, cl[j]); vs += V[id][j]; }
    if (!(cl[t] > mx && V[id][t] >= 1.5 * vs / 20 && cl[t] > sma(t, 50))) continue;
    let k20 = e + 19; while (k20 > e && Number.isNaN(cl[k20])) k20--;
    const h20 = cl[k20] / fill - 1 - COST - qr(e + 19);
    let t10 = NaN, s1 = NaN; const stop = L[id][t];
    for (let k = e; k < N && k <= e + 59; k++) {
      if (Number.isNaN(cl[k])) continue;
      if (Number.isNaN(s1)) { if (k > e && O[id][k] <= stop) s1 = O[id][k] / fill - 1 - COST - qr(k); else if (L[id][k] <= stop) s1 = stop / fill - 1 - COST - qr(k); }
      if (k > e && (cl[k] < sma(k, 10) || k === e + 59)) { t10 = cl[k] / fill - 1 - COST - qr(k); if (Number.isNaN(s1)) s1 = t10; break; }
    }
    if (Number.isNaN(t10)) continue;
    brk.push({ t, on: qOn(t), h20, t10, s1 });
  }
}
const years = [...new Set(sessions.map(d => d.slice(0, 4)))].filter(y => y >= '2016');
console.log(`\nA BREAKOUTS (excess vs QQQ per trade; gated = QQQ above its 200-day)`);
console.log(`  year    n gated   H20      T10      S1   | ungated T10   win% (T10, gated)`);
for (const y of years) {
  const g = brk.filter(b => yearOf(b.t) === y && b.on), u = brk.filter(b => yearOf(b.t) === y);
  console.log(`  ${y} ${String(g.length).padStart(6)}  ${pct(mean(g.map(b => b.h20))).padStart(7)}  ${pct(mean(g.map(b => b.t10))).padStart(7)}  ${pct(mean(g.map(b => b.s1))).padStart(7)} | ${pct(mean(u.map(b => b.t10))).padStart(7)}   ${(100 * mean(g.map(b => +(b.t10 > 0)))).toFixed(0)}%`);
}
const hA = [0, 1].map(h => { const g = brk.filter(b => halfOf(b.t) === h && b.on); return { t10: mean(g.map(b => b.t10)), s1: mean(g.map(b => b.s1)), h20: mean(g.map(b => b.h20)) }; });
console.log(`  halves (2016-20 / 2021-26) gated: H20 ${pct(hA[0].h20)} / ${pct(hA[1].h20)}  T10 ${pct(hA[0].t10)} / ${pct(hA[1].t10)}  S1 ${pct(hA[0].s1)} / ${pct(hA[1].s1)}`);
console.log(`  → A ${(hA.every(x => x.t10 > 0) || hA.every(x => x.s1 > 0)) ? 'PASS' : 'fail'}`);

console.log(`\nD SITE BLUE DOT (10-session excess minus same-day universe average)`);
const dBy = (sel: (t: number) => boolean) => { const v = blue.filter(b => sel(b.t)).map(b => b.ex10 - mean(base10.get(b.t)!)); return { m: mean(v), n: v.length }; };
for (const y of years) { const r = dBy(t => yearOf(t) === y); console.log(`  ${y} ${pct(r.m).padStart(7)} n ${r.n}`); }
const hD = [0, 1].map(h => dBy(t => halfOf(t) === h).m);
console.log(`  halves ${pct(hD[0])} / ${pct(hD[1])}  → D ${hD.every(x => x >= 0.005) ? 'PASS' : 'fail'}`);

// ---------- B momentum ----------
const ends: number[] = []; for (let s = 0; s < N - 1; s++) if (sessions[s].slice(0, 7) !== sessions[s + 1].slice(0, 7) && s >= 261) ends.push(s);
const mRet: { t: number; m: number; q: number; s: number }[] = [];
for (let i = 0; i + 1 < ends.length; i++) {
  const t = ends[i], a = t + 1, b = ends[i + 1] + 1; if (b >= N) break;
  const pool: { id: number; mom: number }[] = [];
  for (let id = 0; id < syms.length; id++) { if (!inUni(id, t)) continue; const m = C[id][t - 21] / C[id][t - 252] - 1; if (Number.isFinite(m)) pool.push({ id, mom: m }); }
  pool.sort((x, y) => y.mom - x.mom);
  /* bookkeeping fix: a name must have a next-open fill (NaN opens made whole months NaN) */
  const top = pool.filter(p => O[p.id][a] > 0).slice(0, 50);
  const r = mean(top.map(p => { let k = b; while (k > a && !(O[p.id][k] > 0)) k--; const px = O[p.id][k] > 0 ? O[p.id][k] : C[p.id][k - 1]; return px / O[p.id][a] - 1; }).filter(Number.isFinite)) - 2 * COST * 0.6;
  mRet.push({ t, m: r, q: O[qId][b] / O[qId][a] - 1, s: O[spyId][b] / O[spyId][a] - 1 });
}
console.log(`\nB MOMENTUM top 50 (12-1), monthly`);
const grow = (xs: number[]) => xs.reduce((g, x) => g * (1 + x), 1) - 1;
for (const y of years) { const r = mRet.filter(x => yearOf(x.t) === y); console.log(`  ${y} list ${pct(grow(r.map(x => x.m))).padStart(8)}  QQQ ${pct(grow(r.map(x => x.q))).padStart(8)}  SPY ${pct(grow(r.map(x => x.s))).padStart(8)}`); }
const hB = [0, 1].map(h => { const r = mRet.filter(x => halfOf(x.t) === h); return { m: grow(r.map(x => x.m)), q: grow(r.map(x => x.q)) }; });
console.log(`  halves list ${pct(hB[0].m)} / ${pct(hB[1].m)}  QQQ ${pct(hB[0].q)} / ${pct(hB[1].q)}  → B ${hB.every(x => x.m > x.q) ? 'PASS' : 'fail'}`);

// ---------- C exposure ----------
const breadth = new Float64Array(N).fill(NaN);
for (let t = 41; t < N; t++) { let up = 0, tot = 0; for (let id = 0; id < syms.length; id++) { const x = C[id][t]; if (!(x > 0) || Number.isNaN(C[id][t - 40])) continue; let s = 0; for (let j = t - 39; j <= t; j++) s += C[id][j]; if (Number.isNaN(s)) continue; tot++; if (x > s / 40) up++; } if (tot >= 100) breadth[t] = up / tot * 100; }
const boost = new Array<boolean>(N).fill(false); let until = -1;
for (let t = 200; t < N - 1; t++) { if (t <= until) continue; if (breadth[t] <= 20) { until = t + 10; for (let k = t + 1; k <= Math.min(N - 1, t + 10); k++) boost[k] = true; } }
const run = (expo: (d: number) => number) => { const nav = new Float64Array(N).fill(1); for (let d = 201; d < N; d++) { const e = expo(d); const r = C[qId][d] / C[qId][d - 1] - 1; nav[d] = nav[d - 1] * (1 + e * r + (e > 1 ? -(e - 1) * 0.05 / 252 : (1 - e) * 0.03 / 252)); } return nav; };
const navQ = run(() => 1), navO3 = run(d => (qOn(d - 1) ? 1 : 0)), navO4 = run(d => (boost[d] ? 1.5 : qOn(d - 1) ? 1 : 0));
const idx = (d: string) => sessions.findIndex(x => x >= d);
const seg = (nav: Float64Array, a: number, b: number) => { let pk = 0, dd = 0; for (let d = a; d <= b; d++) { pk = Math.max(pk, nav[d]); dd = Math.max(dd, 1 - nav[d] / pk); } const tot = nav[b] / nav[a] - 1; const cagr = (1 + tot) ** (252 / (b - a)) - 1; return { tot, dd, r: cagr / dd }; };
console.log(`\nC EXPOSURE (QQQ)`);
for (const y of years) { const a = idx(`${y}-01-01`), b = Math.min(N - 1, idx(`${+y + 1}-01-01`) - 1 < 0 ? N - 1 : idx(`${+y + 1}-01-01`) - 1); console.log(`  ${y} QQQ ${pct(navQ[b] / navQ[a] - 1).padStart(8)}  O3 ${pct(navO3[b] / navO3[a] - 1).padStart(8)}  O4 ${pct(navO4[b] / navO4[a] - 1).padStart(8)}`); }
const H1 = [idx('2016-01-01'), idx('2021-01-01') - 1], H2 = [idx('2021-01-01'), N - 1];
for (const [nm, nav] of [['QQQ', navQ], ['O3', navO3], ['O4', navO4]] as const) { const a = seg(nav, H1[0], H1[1]), b = seg(nav, H2[0], H2[1]); console.log(`  ${nm.padEnd(4)} 2016-20 ${pct(a.tot)} dd ${pct(-a.dd)} r ${a.r.toFixed(2)} | 2021-26 ${pct(b.tot)} dd ${pct(-b.dd)} r ${b.r.toFixed(2)}`); }
const pass = (nav: Float64Array) => [H1, H2].every(([a, b]) => { const x = seg(nav, a, b), q = seg(navQ, a, b); return x.tot > q.tot && x.r > q.r; });
console.log(`  → C O3 ${pass(navO3) ? 'PASS' : 'fail'}, O4 ${pass(navO4) ? 'PASS' : 'fail'}`);

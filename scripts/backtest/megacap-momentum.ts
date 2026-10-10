// scripts/backtest/megacap-momentum.ts — momentum among the biggest, most traded stocks, 2016-2026.
//
//   LONG=1 NODE_OPTIONS=--max-old-space-size=12288 npx tsx scripts/backtest/megacap-momentum.ts
//
// Every stock-picking test so far chose from thousands of equal-weighted
// small / mid caps; QQQ is 100 cap-weighted mega caps, and the decade belonged
// to them. Does momentum work INSIDE the mega-cap pool?
// RULES — fixed 10 Oct 2026, before the first run: universe at each month end =
// the 150 CS/ADRC names with the highest 20-session dollar volume (otherwise as
// below); L1 = top 15 by 12-1 momentum, L2 = top 30, L3 = all 150 equal weight
// (control). Same holding, costs, halves and PASS bar as smooth-momentum.ts.
//
// (smooth-momentum.ts header follows, for the shared machinery)
//
// next-move-channels.ts: inside the momentum list, the smoothest third beat the
// jumpiest by 1.4 / 1.6 points a month in both halves (frog-in-the-pan, Da,
// Gurun & Warachka 2014). momentum-crash.ts: plain momentum crashed in 2021
// on speculative, jumpy names. Never tested as a portfolio.
//
// RULES — fixed 10 Oct 2026, before the first run.
//   Universe at each month end: CS/ADRC, real close >= $2, 20-session $ volume
//     >= $20M, 260 sessions of history.
//   MOM  12-1 return. FIP = sign(12-month return) x (% down days - % up days)
//        over 252 sessions (lower = smoother).
//   P0 plain momentum: top 30 by MOM.
//   P1 smooth momentum: top 20% by MOM, then the 30 lowest FIP.
//   P2 P1 after avoid filters: ADR(20) <= 6% and 1-month return <= +30%.
//   Equal weight, bought at the next open, held to the next month end's next
//   open (buy-and-hold within the month); 0.1% a side on turnover.
//   Benchmarks: QQQ, SPY. Halves 2016-2020 / 2021-2026.
//   PASS: total return above QQQ AND CAGR / worst drop above QQQ's, BOTH halves.

import { loadAdjusted, listSessions, readDay } from './cache';
import { loadReference, refAt } from './reference';

const c = loadAdjusted();
const ref = loadReference();
const { sessions, syms, O, H, L, C, V } = c;
const N = sessions.length;
const qId = c.idOf.get('QQQ')!, spyId = c.idOf.get('SPY')!;
const RC: Float32Array[] = syms.map(() => new Float32Array(N).fill(NaN));
{ if (listSessions().length !== N) throw new Error('session mismatch');
  for (let s = 0; s < N; s++) for (const r of readDay('unadj', sessions[s])) { const id = c.idOf.get(r[0]); if (id != null) RC[id][s] = r[4]; } }
const typeOk = new Map<string, boolean>();
const isStock = (sym: string, date: string) => { const k = `${sym}|${date.slice(0, 4)}`; if (!typeOk.has(k)) { const t = (refAt(ref, sym, date)?.type || '').toUpperCase(); typeOk.set(k, t === 'CS' || t === 'ADRC'); } return typeOk.get(k)!; };
const idx = (d: string) => { const i = sessions.findIndex(x => x >= d); return i < 0 ? N : i; };
const START = idx('2016-01-01'), MID = idx('2021-01-01');
const ends: number[] = []; for (let s = START - 1; s < N - 1; s++) if (sessions[s].slice(0, 7) !== sessions[s + 1].slice(0, 7)) ends.push(s);

type P = { id: number; mom: number; fip: number; adr: number; r1: number; dv: number };
const pools: P[][] = ends.map(t => {
  const out: P[] = [];
  for (let id = 0; id < syms.length; id++) {
    if (!(RC[id][t] >= 2)) continue;
    let ok = true, dv = 0; for (let j = t - 260; j <= t; j++) if (Number.isNaN(C[id][j])) { ok = false; break; }
    if (!ok) continue;
    for (let j = t - 19; j <= t; j++) dv += C[id][j] * V[id][j];
    if (!(dv / 20 >= 20e6) || !isStock(syms[id], sessions[t])) continue;
    let up = 0, dn = 0, adr = 0; for (let j = t - 251; j <= t; j++) { const r = C[id][j] / C[id][j - 1] - 1; if (r > 0) up++; else if (r < 0) dn++; }
    for (let j = t - 19; j <= t; j++) adr += H[id][j] / L[id][j] - 1;
    const r12 = C[id][t] / C[id][t - 252] - 1;
    out.push({ id, mom: C[id][t - 21] / C[id][t - 252] - 1, fip: Math.sign(r12) * (dn - up) / 252, adr: adr / 20, r1: C[id][t] / C[id][t - 21] - 1, dv: dv / 20 });
  }
  return out.sort((a, b) => b.dv - a.dv).slice(0, 150);
});
const pick: Record<string, (p: P[]) => number[]> = {
  'L1 mega top 15': p => p.slice().sort((a, b) => b.mom - a.mom).slice(0, 15).map(x => x.id),
  'L2 mega top 30': p => p.slice().sort((a, b) => b.mom - a.mom).slice(0, 30).map(x => x.id),
  'L3 all 150 (control)': p => p.map(x => x.id),
};
const last = (id: number, d: number, a: number) => { let k = d; while (k >= a && !(C[id][k] > 0)) k--; return k >= a ? C[id][k] : O[id][a]; };
function nav(f: (p: P[]) => number[]): Float64Array {
  const R = new Float64Array(N).fill(0); let prev: number[] = [], prevA = -1;
  for (let i = 0; i < ends.length; i++) {
    const a = ends[i] + 1; if (a >= N) break; const b = i + 1 < ends.length ? ends[i + 1] + 1 : N;
    const hold = f(pools[i]).filter(id => O[id][a] > 0);
    if (!hold.length) continue;
    const on = prev.length ? prev.reduce((s, id) => { const pc = last(id, a - 1, prevA); const op = O[id][a] > 0 ? O[id][a] : pc; return s + op / pc; }, 0) / prev.length : 1;
    const v = (d: number) => hold.reduce((s, id) => s + last(id, d, a) / O[id][a], 0) / hold.length;
    const turn = prev.length ? hold.filter(x => !prev.includes(x)).length / hold.length : 1;
    R[a] = on * v(a) * (1 - 0.002 * turn) - 1;
    let pv = v(a); for (let d = a + 1; d < b && d < N; d++) { const x = v(d); R[d] = x / pv - 1; pv = x; }
    prev = hold; prevA = a;
  }
  const out = new Float64Array(N).fill(1); for (let d = START + 1; d < N; d++) out[d] = out[d - 1] * (1 + R[d]); return out;
}
const bench = (id: number) => { const v = new Float64Array(N).fill(1); for (let d = START + 1; d < N; d++) v[d] = v[d - 1] * (C[id][d] / C[id][d - 1]); return v; };
const seg = (v: Float64Array, a: number, b: number) => { let pk = 0, dd = 0; for (let d = a; d <= b; d++) { pk = Math.max(pk, v[d]); dd = Math.max(dd, 1 - v[d] / pk); } const tot = v[b] / v[a - 1] - 1; return { tot, dd, r: ((1 + tot) ** (252 / (b - a + 1)) - 1) / dd }; };
const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const series: [string, Float64Array][] = [['QQQ', bench(qId)], ['SPY', bench(spyId)], ...Object.entries(pick).map(([n, f]) => [n, nav(f)] as [string, Float64Array])];
const HALF = [[START + 1, MID - 1], [MID, N - 1]];
const years = [...new Set(sessions.slice(START + 1).map(d => d.slice(0, 4)))];
console.log(`year  ${series.map(s => s[0].split(' ')[0].padStart(8)).join('')}`);
for (const y of years) { const a = Math.max(START + 1, idx(`${y}-01-01`)), b = Math.min(N, idx(`${+y + 1}-01-01`)) - 1; console.log(`${y}  ${series.map(([, v]) => pct(v[b] / v[a - 1] - 1).padStart(8)).join('')}`); }
const q = HALF.map(([a, b]) => seg(series[0][1], a, b));
for (const [n, v] of series) { const h = HALF.map(([a, b]) => seg(v, a, b)); const pass = n.startsWith('L1') || n.startsWith('L2') ? true : false; const ok = (n.startsWith('L1') || n.startsWith('L2')) ; const passed = ok && h.every((x, i) => x.tot > q[i].tot && x.r > q[i].r); void pass; console.log(`${n.padEnd(26)} 2016-20 ${pct(h[0].tot).padStart(8)} drop ${pct(-h[0].dd).padStart(7)} r ${h[0].r.toFixed(2)} | 2021-26 ${pct(h[1].tot).padStart(8)} drop ${pct(-h[1].dd).padStart(7)} r ${h[1].r.toFixed(2)}${ok ? (passed ? '  → PASS' : '  → fail') : ''}`); }

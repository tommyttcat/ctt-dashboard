// scripts/backtest/rank-gated.ts — the ranked list, held only when the index trend is up.
//
//   npx tsx scripts/backtest/rank-gated.ts
//
// The two things that held up separately: the momentum + earnings list (P2,
// rank-pead.ts: +165%, matched QQQ) and the QQQ 200-day exposure rule
// (index-overlay.ts O3/O4). Untested together until now.
//
// RULES — fixed 9 Oct 2026, before the first run. P2 staggered NAV from
// rank-engine.ts. Gate decided at close d-1: QQQ close above its 200-day
// average → hold the list on session d; otherwise cash at 4% a year.
// Switching in or out costs 0.2% (0.1% a side on the whole book).
//   G1  P2 gated by the QQQ 200-day.
//   G2  G1, plus 150% for the 10 sessions after a washout (breadth <= 20%,
//       index-overlay.ts), borrowing at 5%.
//   Benchmarks: SPY, QQQ, P2 ungated, O4 (QQQ with the same gate + boost).
//   PASS: G1 or G2 beats O4 on total return AND on CAGR / worst drop, in
//     BOTH halves (split 2024-09-30). If not, the list adds nothing to the
//     index rule.

import { listSessions, readDay } from './cache';
import { sessions, N, C, O, c, staggered, report } from './rank-engine';
import { p2 } from './rank-pead';

if (listSessions().length !== N) throw new Error('session mismatch');
const qId = c.idOf.get('QQQ')!;
const hist = new Map<string, number[]>();
const breadth: (number | null)[] = [];
for (const d of sessions) {
  let above = 0, total = 0;
  for (const r of readDay('adj', d)) {
    const cl = r[4]; if (!(cl > 0)) continue;
    let h = hist.get(r[0]); if (!h) { h = []; hist.set(r[0], h); }
    h.push(cl); if (h.length > 41) h.shift();
    if (h.length < 41) continue;
    let s = 0; for (let i = 1; i < 41; i++) s += h[i];
    total++; if (cl > s / 40) above++;
  }
  breadth.push(total >= 100 ? (100 * above) / total : null);
}
const boost = new Array<boolean>(N).fill(false);
let episodes = 0, until = -1;
for (let d = 200; d < N - 1; d++) {
  if (d <= until) continue;
  if (breadth[d] != null && (breadth[d] as number) <= 20) { episodes++; until = d + 10; for (let k = d + 1; k <= Math.min(N - 1, d + 10); k++) boost[k] = true; }
}
const trendOn = (d: number) => { let s = 0; for (let j = d - 200; j < d; j++) s += C[qId][j]; return C[qId][d - 1] > s / 200; };
const CASH = 0.04 / 252, BORROW = 0.05 / 252, SWITCH = 0.002;

const base = staggered(p2);
const qqq = new Float64Array(N).map((_, d) => C[qId][d]);
const p2s = staggered(p2);
const S = base.findIndex(v => v !== 1) - 1;   // first session the list is held
function gate(src: Float64Array, withBoost: boolean): Float64Array {
  const nav = new Float64Array(N).fill(1);
  let prevE = 0;
  for (let d = S + 1; d < N; d++) {
    const e = withBoost && boost[d] ? 1.5 : trendOn(d) ? 1 : 0;
    const r = src[d] / src[d - 1] - 1;
    const fin = e > 1 ? -(e - 1) * BORROW : (1 - e) * CASH;
    nav[d] = nav[d - 1] * (1 + e * r + fin - SWITCH / 2 * Math.abs(e - prevE));
    prevE = e;
  }
  return nav;
}
const rebase = (x: Float64Array) => { const n = new Float64Array(N).fill(1); for (let d = S + 1; d < N; d++) n[d] = x[d] / x[S]; return n; };
const qN = rebase(qqq);
console.log(`list held from ${sessions[S + 1]}; washout episodes ${episodes}`);
const rows: [string, Float64Array][] = [
  ['QQQ held', qN], ['P2 list ungated', rebase(p2s)],
  ['O4 QQQ gate+boost', gate(qN, true)], ['O3 QQQ gate', gate(qN, false)],
  ['G1 P2 gated', gate(rebase(p2s), false)], ['G2 P2 gate+boost', gate(rebase(p2s), true)],
];
const R = Object.fromEntries(rows.map(([n, v]) => [n, report(n, v)]));
for (const [n] of rows) console.log(R[n].line);
const o4 = R['O4 QQQ gate+boost'];
for (const n of ['G1 P2 gated', 'G2 P2 gate+boost']) {
  const r = R[n];
  console.log(`${n}: ${r.tot > o4.tot && r.h1 > o4.h1 && r.h2 > o4.h2 ? 'beats O4 on return in both halves' : 'does NOT beat O4 on return in both halves'}; worst drop ${(r.dd * 100).toFixed(1)}% vs O4 ${(o4.dd * 100).toFixed(1)}%`);
}

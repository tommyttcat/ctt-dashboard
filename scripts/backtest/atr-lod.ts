// scripts/backtest/atr-lod.ts — does it pay to buy before a stock has used up its daily range?
//
//   npx tsx scripts/backtest/atr-lod.ts
//
// ATR% from LOD = (price - today's low) / ATR(14) of the sessions BEFORE
// today. 0% = at the low; 100% = a full average day's range above it. The
// idea: a name that has already covered its range is late to buy.
//
// RULES — fixed 9 Oct 2026, before the first run. Daily bars only: the
// reading is taken AT THE CLOSE and the buy is at that close (minute history
// does not exist for these names, so the intraday version is not testable
// here). ATR(14) = mean true range of the 14 sessions ending the day before.
//   Lists, rebuilt every session: L1 = 12-1 momentum top 50 (rank-engine),
//     L2 = momentum + earnings top 50 (rank-pead P2 — what the card shows).
//   Every list name, every session = one observation. Buckets: <25%, 25-50%,
//     50-75%, 75-100%, 100%+. Return = close t to close t+10, minus 0.2%
//     costs, minus QQQ's close t to close t+10.
//   PASS: for L2, the <50% buckets together beat the 75%+ buckets together
//     on average excess return in BOTH halves (split 2024-09-30), AND the
//     <50% group beats QQQ (excess > 0) in both halves. L1 is reported as a
//     check, not a gate. Observations overlap (a name sits on the list for
//     weeks), so the counts overstate the evidence; the halves are the guard.

import { sessions, N, C, O, H, c, pool, SPLIT } from './rank-engine';
import { p2 } from './rank-pead';

void O;
const L = c.L;
const qId = c.idOf.get('QQQ')!;
const HOLD = 10, COST = 0.002;
const iSplit = sessions.findIndex(d => d > SPLIT);
const atrPrior = (id: number, t: number) => {
  let s = 0;
  for (let k = t - 14; k < t; k++) {
    const pc = C[id][k - 1], h = H[id][k], l = L[id][k];
    if ([pc, h, l].some(Number.isNaN)) return NaN;
    s += Math.max(h, pc) - Math.min(l, pc);
  }
  return s / 14;
};
const B = [0.25, 0.5, 0.75, 1, Infinity];
const label = ['<25%', '25-50%', '50-75%', '75-100%', '100%+'];
type Acc = { n: number; s: number; w: number }[][];   // [half][bucket]
const mk = (): Acc => [0, 1].map(() => B.map(() => ({ n: 0, s: 0, w: 0 })));
const res: Record<string, Acc> = { L1: mk(), L2: mk() };
const lists: [string, (t: number) => number[]][] = [['L1', t => pool(t).slice(0, 50).map(x => x.id)], ['L2', p2]];
for (let t = 260; t + HOLD < N; t++) {
  const q = C[qId][t + HOLD] / C[qId][t] - 1;
  const half = t < iSplit ? 0 : 1;
  for (const [name, f] of lists) {
    for (const id of f(t)) {
      const atr = atrPrior(id, t), cl = C[id][t], lo = L[id][t];
      let end = t + HOLD; while (end > t && Number.isNaN(C[id][end])) end--;
      if (!(atr > 0) || end === t) continue;
      const x = (cl - lo) / atr;
      const b = B.findIndex(v => x < v);
      const ex = C[id][end] / cl - 1 - COST - q;
      const a = res[name][half][b]; a.n++; a.s += ex; if (ex > 0) a.w++;
    }
  }
}
const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`;
const grp = (acc: Acc, h: number, bs: number[]) => { let n = 0, s = 0; for (const b of bs) { n += acc[h][b].n; s += acc[h][b].s; } return { n, avg: s / Math.max(1, n) }; };
console.log(`10-session return after buying at the close, minus QQQ, by ATR% from the low at that close. Split ${SPLIT}.`);
for (const name of ['L1', 'L2']) {
  console.log(`\n${name === 'L1' ? 'L1 12-1 momentum top 50' : 'L2 momentum + earnings top 50 (the card)'}`);
  for (let b = 0; b < B.length; b++) {
    const [h1, h2] = [0, 1].map(h => res[name][h][b]);
    console.log(`  ${label[b].padEnd(8)} 1st ${pct(h1.s / Math.max(1, h1.n)).padStart(7)} (n ${h1.n}, beat QQQ ${(100 * h1.w / Math.max(1, h1.n)).toFixed(0)}%)   2nd ${pct(h2.s / Math.max(1, h2.n)).padStart(7)} (n ${h2.n}, beat QQQ ${(100 * h2.w / Math.max(1, h2.n)).toFixed(0)}%)`);
  }
  const lo = [0, 1].map(h => grp(res[name], h, [0, 1])), hi = [0, 1].map(h => grp(res[name], h, [3, 4]));
  const pass = lo[0].avg > hi[0].avg && lo[1].avg > hi[1].avg && lo[0].avg > 0 && lo[1].avg > 0;
  console.log(`  under 50%: 1st ${pct(lo[0].avg)} 2nd ${pct(lo[1].avg)} | 75%+: 1st ${pct(hi[0].avg)} 2nd ${pct(hi[1].avg)}${name === 'L2' ? `  → ${pass ? 'PASS' : 'fail'}` : ''}`);
}

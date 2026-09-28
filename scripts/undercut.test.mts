/* scripts/undercut.test.mts — the 10/21 undercut & rally rule and the
 * at-the-averages plan, pinned to the rules replayed in
 * scripts/backtest/mau-r.ts. */

import { detectUndercut, atMarketPlan } from '../src/lib/scans/consolidation.ts';
import { eq, near, done } from './testkit.mts';

type B = { t: number; o: number; h: number; l: number; c: number; v: number };
// 100 sessions drifting up 0.3%/day in a 2% range, then a custom tail.
const trend = (n: number): B[] => Array.from({ length: n }, (_, i) => {
  const c = 100 * Math.pow(1.003, i);
  return { t: i, o: c, h: c * 1.01, l: c * 0.99, c, v: 1e6 };
});
const withTail = (tail: Array<[number, number, number]>): B[] => {
  const b = trend(100);
  const last = b[b.length - 1].c;
  tail.forEach(([l, c, h], k) => b.push({ t: 100 + k, o: last, h: last * h, l: last * l, c: last * c, v: 1e6 }));
  return b;
};

// Undercut today of the prior 10-day low, closed back above it today.
{
  const bars = withTail([[0.93, 1.0, 1.01]]);
  const u = detectUndercut(bars, 2);
  eq('same-day undercut and reclaim is found', u?.level, 'L10');
  eq('stop is the shakeout low', u ? +u.stop.toFixed(4) : null, +(bars[99].c * 0.93).toFixed(4));
  eq('reclaim today', u?.daysAgo, 0);
}
{
  const bars = withTail([[0.95, 0.955, 1.0]]);   // under the 10-day low only, not the 50-day
  eq('still under the level at the close: not yet', detectUndercut(bars, 2), null);
}
{
  const bars = withTail([[0.95, 0.955, 1.0], [0.96, 1.0, 1.01]]);
  const u = detectUndercut(bars, 2);
  eq('undercut yesterday, reclaimed today', u?.daysAgo, 1);
  eq('stop is the lowest low since the undercut', u ? +u.stop.toFixed(4) : null, +(bars[99].c * 0.95).toFixed(4));
}
{
  const bars = withTail([[0.70, 1.0, 1.01]]);
  eq('a drop deeper than 2 x ADR is a breakdown, not a shakeout', detectUndercut(bars, 2), null);
}
{
  const bars = withTail([[0.93, 1.0, 1.01], [0.99, 1.01, 1.02]]);
  eq('the day after the reclaim is no longer a signal', detectUndercut(bars, 2), null);
}
eq('too little history', detectUndercut(trend(40), 2), null);

// The plan: buy at the price, the stop where the idea is wrong.
{
  const p = atMarketPlan(50, 47.5, 'at the 10/21', 'n');
  eq('buy level is the price', p.trigger, 50);
  eq('stop kept', p.stop, 47.5);
  near('stop %', p.stopPct ?? null, 5, 1e-9);
  eq('2R target', p.target, 55);
  eq('tradeable', p.tradeable, true);
}
eq('stop floored at 0.5% of the price', atMarketPlan(50, 49.99, 'x', 'n').stop, 49.75);
eq('no stop below the price: not tradeable', atMarketPlan(50, 51, 'x', 'n').tradeable, false);

done('undercut & at-market plan');

/* scripts/earlyTrack.test.mts — the Early Movers forward record (lib/earlyTrack). */

import { earlyFlag, openEarly, earlyPoolFrom, summarizeEarly, EARLY_PASS_N, type EarlyPoolItem } from '../src/lib/earlyTrack.ts';
import { stepPlan } from '../src/lib/trackPlan.ts';
import type { Minute } from '../src/lib/orb.ts';
import { eq, near, ok, done } from './testkit.mts';

// 28 Sep 2026 is EDT: 9:30 ET = 13:30 UTC.
const at = (etMin: number) => Date.UTC(2026, 8, 28, 13, 30) + (etMin - 570) * 60_000;
const bar = (etMin: number, o: number, h: number, l: number, c: number, v: number): Minute => [at(etMin), o, h, l, c, v];
const item: EarlyPoolItem = { t: 'X', scan: 'consolidation', stop: 95, avgVol: 390_000, rs: 90, prevClose: 100 };
// avgVol 390k = 1,000 shares a minute on a normal day, so 1,500/min is 1.5x pace.

{
  const mins = [
    bar(565, 100, 101, 100, 101, 50_000),            // pre-market: ignored
    bar(570, 100, 101, 99.5, 100.5, 1_000),
    bar(571, 100.5, 103, 100.4, 102.5, 1_000),       // up 2.5%, but inside the first 5 minutes
    bar(572, 102.5, 103, 102, 102.8, 5_000),
    bar(573, 102.8, 103, 102.5, 102.9, 5_000),
    bar(574, 102.9, 103.2, 102.6, 103, 5_000),       // 5 minutes in, pace (17k / 5k) = 3.4x: FLAG
    bar(575, 103, 104, 102.9, 103.8, 5_000),
  ];
  const f = earlyFlag(item, mins);
  eq('flags at the first minute from 5 minutes in', f?.minute, 574);
  eq('entry is that minute\'s close', f?.fill, 103);
  eq('stop is the scan\'s own', f?.stop, 95);
  eq('only later minutes are walked', f?.after.length, 1);
}
{
  const thin = [570, 571, 572, 573, 574, 575].map(t => bar(t, 102, 103, 102, 103, 1_000));
  eq('up 3% on normal volume is not a flag', earlyFlag(item, thin), null);
  const flat = [570, 571, 572, 573, 574, 575].map(t => bar(t, 100, 101, 100, 101, 9_000));
  eq('heavy volume up 1% is not a flag', earlyFlag(item, flat), null);
}
{
  const own = { ...item, stop: 104 };                  // scan stop above the entry
  const mins = [570, 571, 572, 573, 574].map((t, i) => bar(t, 101, 103, 100.2 + i * 0.1, 103, 5_000));
  const f = earlyFlag(own, mins);
  eq('a scan stop above the entry falls back to the session low so far', f?.stop, 100.2);
}

// The flag day, then the Track record's bracket.
{
  const flag = { minute: 600, fill: 100, stop: 98, after: [bar(601, 100, 101, 97.5, 98, 1)] };
  const p = openEarly(item, flag, '2026-09-28');
  eq('stopped later the same day', p.state, 'stopped');
  near('for -1R', p.r, -1, 1e-9);
}
{
  const flag = { minute: 600, fill: 100, stop: 98, after: [bar(601, 100, 104.5, 99, 104, 1)] };
  const p = openEarly(item, flag, '2026-09-28');
  eq('2R the same day', p.state, 'target');
  near('for +2R', p.r, 2, 1e-9);
}
{
  const flag = { minute: 600, fill: 100, stop: 98, after: [bar(601, 100, 101, 99, 100.5, 1)] };
  const p = openEarly(item, flag, '2026-09-28');
  eq('neither: still open overnight', p.state, 'filled');
  stepPlan(p, { o: 101, h: 104.2, l: 100.5, c: 104 }, '2026-09-29');
  eq('the next session is walked by the Track record\'s own rule', p.state, 'target');
}

// Pool: tonight's lists, deduplicated, in the card's order, with a close.
{
  const pool = earlyPoolFrom({
    consolidation: [{ symbol: 'AAA', plan: { stop: 9 }, avgDollarVolM: 20, price: 10, rsRating: 80 }],
    sip: [{ ticker: 'AAA', avgVol: 1e6, rsRating: 70 }, { ticker: 'NOCLOSE' }],
  }, new Map([['AAA', 10]]), '2026-09-28');
  eq('deduplicated, and a name with no close is left out', pool.names.map(n => n.t).join(), 'AAA');
  eq('the momentum list comes first, as on the card', pool.names[0].scan, 'sip');
}

// The pass bar, fixed before any data.
{
  const closed = (n: number, r0: number, r1: number) => Array.from({ length: n }, (_, i) => ({
    t: 'X', scan: 's', d: `2026-10-${String(1 + Math.floor(i / 10)).padStart(2, '0')}-${i}`, r: i < n / 2 ? r0 : r1,
  }));
  const s = (n: number, r0: number, r1: number) => summarizeEarly({ startedOn: '2026-09-28', flags: n, open: [], closed: closed(n, r0, r1) });
  eq('under 100 closed: still collecting', s(EARLY_PASS_N - 2, 1, 1).verdict, 'collecting');
  eq('both halves at +0.10R or better: pass', s(EARLY_PASS_N, 0.2, 0.1).verdict, 'pass');
  eq('one half short: fail', s(EARLY_PASS_N, 0.5, 0.05).verdict, 'fail');
  ok('win rate reported', s(10, 1, -1).winRate === 50);
}

done('early movers record');

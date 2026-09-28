/* scripts/earlyMovers.test.mts — the Early Movers card's rule (lib/summary/earlyMovers). */

import { earlyMovers, paceOf, avgSharesOf, EARLY_MIN_PACE } from '../src/lib/summary/earlyMovers.ts';
import { eq, near, ok, done } from './testkit.mts';

const AT_1030 = 10 * 60 + 30;           // an hour in: a normal day's share is 60/390
const name = (ticker: string, extra: Record<string, unknown> = {}) => ({
  ticker, price: 50, avgVol: 1_000_000, rsRating: 90, _source: 'swing',
  plan: { tradeable: true, trigger: 51, stop: 47, triggerLabel: 'pivot' }, ...extra,
});
const normalHour = 1_000_000 * (60 / 390);

near('pace is volume over the average day pro rata', paceOf(normalHour * 2, 1_000_000, 60), 2, 1e-9);
eq('no pace in the first minutes', paceOf(50_000, 1_000_000, 3), null);
eq('no pace without average volume', paceOf(50_000, null, 60), null);
near('average shares from dollar volume when that is all there is', avgSharesOf({ avgDollarVolM: 50, price: 25 }), 2_000_000, 1e-6);

{
  const pool = [name('UP'), name('THIN'), name('FLAT'), name('UP')];
  const q = {
    UP: { price: 52, pct: 4, prevClose: 50, vol: normalHour * 3 },
    THIN: { price: 52, pct: 4, prevClose: 50, vol: normalHour * 1.2 },
    FLAT: { price: 50.5, pct: 1, prevClose: 50, vol: normalHour * 5 },
  };
  const rows = earlyMovers(pool, q, 'Open', AT_1030);
  eq('only the name up 2%+ on 1.5x pace is listed, once', rows.map(r => r.ticker).join(), 'UP');
  near('its RVOL is the live pace', rows[0].rvol, 3, 1e-9);
  eq('with the live price', rows[0].price, 52);
  ok('the pace bar is the tested breakout rule', EARLY_MIN_PACE === 1.5);
}
{
  const q = { UP: { price: 52, pct: 4, prevClose: 50, vol: null } };
  eq('pre-market: the move alone', earlyMovers([name('UP')], q, 'Pre-Market', 8 * 60).map(r => r.ticker).join(), 'UP');
  eq('during the session a missing volume is not a pass', earlyMovers([name('UP')], q, 'Open', AT_1030).length, 0);
  eq('closed: nothing', earlyMovers([name('UP')], q, 'Closed', 2 * 60).length, 0);
}
{
  // Up 4% on the day but under its stop (a gap down reversed is not this).
  const q = { DN: { price: 46, pct: 4, prevClose: 44.2, vol: normalHour * 3 } };
  eq('a name through its stop is left out', earlyMovers([name('DN')], q, 'Open', AT_1030).length, 0);
}
{
  const pool = ['A', 'B', 'C'].map(t => name(t));
  const q = Object.fromEntries(pool.map((p, i) => [p.ticker, { price: 52, pct: 2 + i, prevClose: 50, vol: normalHour * 2 }]));
  eq('biggest move first', earlyMovers(pool, q, 'Open', AT_1030).map(r => r.ticker).join(), 'C,B,A');
}

done('early movers');

/* scripts/epNeglect.test.mts — the forward paper record's position rules.
 *
 * lib/epNeglect is proven identical to the 5-year backtest by
 * scripts/backtest/epn-equivalence.ts (needs the local bar cache). These pin
 * the management rules on synthetic bars so a refactor cannot drift them.
 */
import { epnStep, epnEntry, EPN_COST, type EpnPosition, type Minute } from '../src/lib/epNeglect.ts';
import { eq, near, ok, done } from './testkit.mts';

const pos = (o: Partial<EpnPosition> = {}): EpnPosition => ({
  t: 'T', d: '2026-10-01', gap: 0.12, fill: 100, stop: 97, stop0: 97, day: 1, left: 1,
  closes: Array(9).fill(95), exits: [], ret: null, ...o,
});
const bar = (o: number, h: number, l: number, c: number) => ({ o, h, l, c, v: 1e6 });

{ const p = pos(); epnStep(p, bar(99, 101, 96, 98), 'd2'); near('stop hit intraday exits at the stop', p.ret!, -0.03 - 2 * EPN_COST); }
{ const p = pos(); epnStep(p, bar(95, 96, 94, 95), 'd2'); near('gap through the stop exits at the open', p.ret!, -0.05 - 2 * EPN_COST); }
{
  const p = pos();
  epnStep(p, bar(101, 103, 100, 102), 'd2');
  eq('day 2 holds', p.left, 1);
  epnStep(p, bar(104, 111, 103, 110), 'd3');
  eq('day 3 sells half', p.left, 0.5);
  eq('rest moves to breakeven', p.stop, 100);
  epnStep(p, bar(100.5, 101, 99, 99.5), 'd4');
  near('breakeven stop on the rest', p.ret!, 0.5 * 0.10 + 0.5 * 0 - 2 * EPN_COST);
}
{
  // close below SMA10 from day 3 sells the rest the same day as the half
  const p = pos({ closes: Array(9).fill(120) });
  epnStep(p, bar(101, 103, 100, 102), 'd2');
  epnStep(p, bar(103, 105, 102, 104), 'd3');
  eq('below SMA10 on day 3: all out', p.left, 0);
}
{
  const et = (ms: number) => ms;   // synthetic: timestamps are ET minutes
  const m = (t: number, o: number, h: number, l: number, c: number, v: number): Minute => [t, o, h, l, c, v];
  const or = [m(570, 10, 10.2, 9.9, 10.1, 100), m(574, 10.1, 10.3, 10.0, 10.2, 100)];
  const red = [m(570, 10, 10.2, 9.9, 9.95, 100), m(574, 9.95, 10.0, 9.8, 9.9, 100)];
  eq('red first 5 minutes: no trade', epnEntry([...red, m(575, 9.9, 10.5, 9.9, 10.4, 50)], et, 1000, 1).ok, false);
  eq('thin first 5 minutes: no trade', epnEntry([...or, m(575, 10.2, 10.5, 10.2, 10.4, 50)], et, 10000, 1).ok, false);
  const e = epnEntry([...or, m(575, 10.2, 10.25, 10.1, 10.2, 50), m(576, 10.25, 10.5, 10.2, 10.4, 50)], et, 1000, 1);
  ok('breaks the 5-minute high', e.ok);
  if (e.ok) { near('fill at the range high', e.fill, 10.3); near('stop at the low of day', e.stop, 9.9); }
}
done('EP neglect paper record');

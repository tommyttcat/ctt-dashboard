/* scripts/ledgerScore.test.mts — scoring the brief's picks against the scan list.
 *
 * The comparison is only honest if the pick and the pool are the same
 * measurement, so the next-open leg is pinned to /track's hold-20 rule here,
 * and the fold is pinned to count each date exactly once.
 */

import {
  scoreNextOpen, scoreLevels, scorePool, scoreDate, advance, emptyScorecard,
  type DayBar,
} from '../src/lib/ledgerScore.ts';
import { HOLD20, rMultiple, rToPct, type OpenPosition } from '../src/lib/track.ts';
import type { SetupEntry } from '../src/lib/setupLedger.ts';
import { eq, near, ok, done } from './testkit.mts';

const day = (i: number) => `2026-10-${String(i + 2).padStart(2, '0')}`;
/** n flat sessions at 100, with overrides by index. */
const bars = (n: number, over: Record<number, Partial<DayBar>> = {}): DayBar[] =>
  Array.from({ length: n }, (_, i) => ({ d: day(i), o: 100, h: 101, l: 99, c: 100, ...over[i] }));

// ---- next-open leg ---------------------------------------------------------
{
  const r = scoreNextOpen({ stop: 95, direction: 'long' }, bars(HOLD20, { [HOLD20 - 1]: { c: 110 } }));
  eq('held to session 20', r.state, 'held');
  near('held: close of session 20', r.pct, 10);
  near('best is the highest high', r.best, 1);
  near('worst is the lowest low', r.worst, -1);
}
{
  const r = scoreNextOpen({ stop: 95, direction: 'long' }, bars(5, { 2: { o: 96, l: 90 } }));
  eq('stopped', r.state, 'stopped');
  near('a later stop exits at the stop when the open is above it', r.pct, -5);
}
{
  const r = scoreNextOpen({ stop: 95, direction: 'long' }, bars(5, { 2: { o: 92, l: 90 } }));
  near('a gap through the stop exits at the open', r.pct, -8);
}
{
  const r = scoreNextOpen({ stop: 95, direction: 'long' }, bars(3, { 0: { l: 94 } }));
  near('stopped on the entry bar exits at the stop', r.pct, -5);
}
{
  const r = scoreNextOpen({ stop: 120, direction: 'long' }, bars(3));
  near('a stop above the fill falls back to the entry bar low', r.stop, 99);
}
{
  const r = scoreNextOpen({ stop: 95, direction: 'long' }, bars(4, { 3: { c: 103 } }));
  eq('under 20 sessions is open', r.state, 'open');
  eq('open has no final result', r.pct, null);
  near('open is marked to the last close', r.nowPct, 3);
}
eq('no bars is pending', scoreNextOpen({ stop: 95, direction: 'long' }, []).state, 'pending');
{
  const r = scoreNextOpen({ stop: 105, direction: 'short' }, bars(HOLD20, { [HOLD20 - 1]: { c: 90 } }));
  near('a short gains on the drop', r.pct, 10);
}

/* The identity the whole comparison rests on: a pick scored here and the same
   trade scored by /track's hold-20 leg give the same %. */
{
  const fill = 100, stop = 95, exit = 92;
  const viaTrack = rToPct(fill, stop, rMultiple(fill, stop, exit));
  const viaHere = scoreNextOpen({ stop, direction: 'long' }, bars(5, { 2: { o: exit, l: 90 } })).pct;
  near('same % as /track for the same trade', viaHere, viaTrack as number);
}

// ---- the brief's levels ----------------------------------------------------
const entry = (o: Partial<SetupEntry>): SetupEntry => ({
  date: '2026-10-01', ticker: 'TEST', buckets: ['top'], direction: 'long', refPrice: 100,
  trigger: 102, stop: 95, target: null, rMultiple: null, sources: [], recordedAt: '', ...o,
});
eq('breakout fills when the high trades the level', scoreLevels(entry({}), bars(3, { 1: { h: 103 } })).level, 'filled');
eq('never trading the level expires', scoreLevels(entry({}), bars(12)).level, 'expired');
eq('a dip level under the price waits for the low', scoreLevels(entry({ trigger: 97 }), bars(2, { 1: { l: 96.5, h: 100 } })).level, 'filled');
eq('no stop, no plan', scoreLevels(entry({ stop: null }), bars(3)).level, 'none');
eq('shorts have no level leg', scoreLevels(entry({ direction: 'short' }), bars(3)).level, 'none');

// ---- pool ------------------------------------------------------------------
const pos = (o: Partial<OpenPosition>): OpenPosition => ({
  scan: 'sip', t: 'A', d: '2026-10-01', score: null, tier: null, fill: 100, stop: 95, target: 110,
  n: 20, peak: 110, hr: false, stopped: false, exitFixed: null, exitHold20: 1, last: 105, ...o,
} as OpenPosition);
{
  const p = scorePool([
    pos({ t: 'A', exitHold20: 1 }),                    // +5%
    pos({ t: 'A', scan: 'daily', exitHold20: -1 }),    // same name on a second scan: counted once
    pos({ t: 'B', exitHold20: -1 }),                   // -5%
    pos({ t: 'C', scan: 'multibagger' }),              // return-mode, not a trade
    pos({ t: 'D', exitHold20: null, last: 102, n: 4 }),// undecided
    pos({ t: 'E', d: '2026-09-30' }),                  // another date
  ], '2026-10-01', 5)!;
  eq('pool: one row per ticker, no multibagger, right date', p.n, 2);
  near('pool: summed %', p.sumPct, 0);
  eq('pool: wins', p.wins, 1);
  eq('pool: one still waiting', p.waiting, 1);
  near('pool: now-sum marks the undecided to its last close', p.nowSumPct, 2);
}
eq('no pool for a date /track has nothing on', scorePool([], '2026-10-01', 5), null);

// ---- a whole date, and the fold ---------------------------------------------
{
  const e1 = entry({ ticker: 'WIN', stop: 95, trigger: 101 });
  const e2 = entry({ ticker: 'LOSE', stop: 95, trigger: 101 });
  const win = bars(HOLD20 + 15, { [HOLD20 - 1]: { c: 110 }, 1: { h: 120 } });
  const lose = bars(HOLD20 + 15, { 2: { o: 96, l: 90 } });
  const spy = bars(HOLD20 + 15, { [HOLD20 - 1]: { c: 102 } });
  const pool = [pos({ t: 'P', exitHold20: 0 })];
  const s = scoreDate('2026-10-01', [e1, e2], t => (t === 'WIN' ? win : lose), spy, pool);
  ok('date: next-open finished', s.nextOpenDone);
  ok('date: levels finished', s.levelsDone);
  near('date: SPY 20-session return', s.spyPct, 2);

  let { card, finished } = advance(emptyScorecard('2026-10-01'), ['2026-10-01'], new Map([[s.d, s]]));
  eq('fold: date finished', finished.length, 1);
  eq('fold: two picks', card.totals.picks.n, 2);
  near('fold: picks summed % (+10 and -5)', card.totals.picks.sumPct, 5);
  eq('fold: picks beat a flat pool on this date', card.totals.datesBeat, 1);
  eq('fold: bucket totals', card.totals.byBucket.top.n, 2);
  eq('fold: nothing left open', card.open.length, 0);

  /* Run again on the same data: a finished date must not count twice. */
  ({ card, finished } = advance(card, ['2026-10-01'], new Map([[s.d, s]])));
  eq('refold: still two picks', card.totals.picks.n, 2);
  eq('refold: nothing newly finished', finished.length, 0);
}
{
  const s = scoreDate('2026-10-01', [entry({})], () => bars(3), bars(3), []);
  const { card } = advance(emptyScorecard('2026-10-01'), ['2026-10-01'], new Map([[s.d, s]]));
  eq('young date stays open', card.open.length, 1);
  eq('young date folds nothing', card.totals.picks.n, 0);
}
{
  const s = scoreDate('2026-10-01', [entry({ ticker: 'GONE' })], () => [], bars(HOLD20 + 15), []);
  eq('no bars after a full window is nodata', s.picks[0].state, 'nodata');
  ok('...and does not hold the date open', s.nextOpenDone && s.levelsDone);
}

done('ledger scoring');

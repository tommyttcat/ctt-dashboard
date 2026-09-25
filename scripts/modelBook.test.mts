/* scripts/modelBook.test.mts — the Model Book's rules, pinned.
 *
 * The book is the live test of scripts/backtest/portfolio.ts. If these rules
 * drift from the backtest's, the live record stops measuring what the
 * backtest claimed, so every rule in lib/modelBook's header has a line here.
 */

import { newBook, stepBook, addPicks, candidateFrom, orbTickers, MB, type ModelBook, type Bar } from '../src/lib/modelBook.ts';
import { orbTrigger, etMinute, type Minute } from '../src/lib/orb.ts';
import { eq, near, done } from './testkit.mts';

const bar = (o: number, h: number, l: number, c: number): Bar => ({ o, h, l, c });
const bars = (m: Record<string, Bar>) => new Map(Object.entries(m));
// A green Stocks in Play row: ADR under 9, not $5-10, closed in the top 10% of its range.
const sip = (o: Record<string, unknown> = {}) => ({
  ticker: 'AAA', price: 50, adrPct: 4, dayHigh: 50.2, dayLow: 47, rsRating: 90,
  plan: { tradeable: true, stop: 47.5 }, ...o,
});
// A green EP9M row: clears the three losing traits, price $50+.
const ep = (o: Record<string, unknown> = {}) => ({
  ticker: 'EPX', price: 60, adrPct: 6, dayHigh: 62, dayLow: 54, mktCap: 2e9, floatTurnover: 0.2, mf: 70, rsRating: 80, ...o,
});
const fresh = (): ModelBook => { const b = newBook('d0', 500); stepBook(b, 'd0', bars({}), 500); return b; };

// ---- who gets in -------------------------------------------------------------
eq('green row is a candidate', candidateFrom('sip', sip(), 'd0')?.kind, 'open');
eq('yellow row is not (closed mid-range)', candidateFrom('sip', sip({ price: 48.5 }), 'd0'), null);
eq('red row is not ($5-10)', candidateFrom('sip', sip({ price: 8, dayHigh: 8.05, dayLow: 7.5 }), 'd0'), null);
eq('plan stop is used when tradeable', candidateFrom('sip', sip(), 'd0')?.stop, 47.5);
eq('else the pick day low', candidateFrom('sip', sip({ plan: { tradeable: false, stop: 49 } }), 'd0')?.stop, 47);
eq('EP9M is a dip to the midpoint', candidateFrom('ep9m', ep(), 'd0')?.buy, 58);
eq('EP9M stop is the EP-day low', candidateFrom('ep9m', ep(), 'd0')?.stop, 54);
{
  const b = fresh();
  eq('same ticker on two lists is one candidate', addPicks(b, 'd0', { sip: [sip()], daily: [sip()] }), 1);
}

// ---- next-open buy, sizing, slippage -------------------------------------------
{
  const b = fresh();
  addPicks(b, 'd0', { sip: [sip()] });
  stepBook(b, 'd1', bars({ AAA: bar(50, 51, 49, 50.5) }), 501);
  eq('bought at the next open', b.open[0]?.fill, 50);
  // risk 0.5% of 100k = $500 over $2.50/share = 200 sh; 20% cap = 399 sh; cash plenty.
  eq('sized to 0.5% risk', b.open[0]?.sh, 200);
  near('cash paid with slippage', b.cash, 100_000 - 200 * 50 * 1.001, 1e-6);
  eq('candidate consumed', b.candidates.length, 0);
  eq('entry day counts as session 1', b.open[0]?.n, 1);
  eq('curve has start + today', b.curve.length, 2);
}
{
  const b = fresh();
  addPicks(b, 'd0', { sip: [sip({ plan: { tradeable: true, stop: 49.99 } })] });
  stepBook(b, 'd1', bars({ AAA: bar(50, 51, 49.99, 50.5) }), 501);
  // A 1-cent stop is floored to 0.5% of the fill: 500 / 0.25 = 2000 sh, capped at 20% = 399.
  eq('20% position cap binds on a tight stop', b.open[0]?.sh, Math.floor(20_000 / (50 * 1.001)));
}
{
  const b = fresh();
  addPicks(b, 'd0', { sip: [sip()] });
  stepBook(b, 'd1', bars({ AAA: bar(47, 48, 46, 47.2) }), 501);
  eq('opened under its stop: not bought', b.open.length, 0);
}

// ---- exits -----------------------------------------------------------------------
{
  const b = fresh();
  addPicks(b, 'd0', { sip: [sip()] });
  stepBook(b, 'd1', bars({ AAA: bar(50, 51, 47.4, 48) }), 501);
  eq('stop touched on the entry day: out at the stop', b.closed[0]?.exit, 47.5);
  eq('slot freed', b.open.length, 0);
  eq('counted as a loss', b.totals.wins, 0);
  near('R includes both slippages', b.closed[0]?.r, (47.5 * 0.999 - 50 * 1.001) / 2.5, 1e-3);
}
{
  const b = fresh();
  addPicks(b, 'd0', { sip: [sip()] });
  stepBook(b, 'd1', bars({ AAA: bar(50, 51, 49, 50.5) }), 501);
  stepBook(b, 'd2', bars({ AAA: bar(46, 46.5, 45, 46) }), 501);
  eq('gap through the stop: out at the open', b.closed[0]?.exit, 46);
}
{
  const b = fresh();
  addPicks(b, 'd0', { sip: [sip()] });
  for (let i = 1; i <= MB.hold; i++) stepBook(b, `d${i}`, bars({ AAA: bar(50 + i, 51 + i, 49 + i, 50.5 + i) }), 501);
  eq('sold at the close of session 20', b.closed[0]?.exit, 50.5 + MB.hold);
  eq('held 20 sessions, not 19', b.closed[0]?.exitDate, `d${MB.hold}`);
  eq('a win', b.totals.wins, 1);
}
{
  const b = fresh();
  addPicks(b, 'd0', { sip: [sip()] });
  stepBook(b, 'd1', bars({ AAA: bar(50, 51, 49, 50.5) }), 501);
  stepBook(b, 'd1', bars({ AAA: bar(10, 10, 1, 1) }), 501);
  eq('same date twice is a no-op', b.open.length, 1);
}

// ---- EP9M dip -----------------------------------------------------------------------
{
  const b = fresh();
  addPicks(b, 'd0', { ep9m: [ep()] });
  stepBook(b, 'd1', bars({ EPX: bar(60, 61, 57, 59) }), 501);
  eq('not on the first session after the pick', b.open.length, 0);
  stepBook(b, 'd2', bars({ EPX: bar(59, 60, 57.5, 58.5) }), 501);
  eq('dip to the midpoint fills at the midpoint', b.open[0]?.fill, 58);
}
{
  const b = fresh();
  addPicks(b, 'd0', { ep9m: [ep()] });
  stepBook(b, 'd1', bars({ EPX: bar(60, 61, 53, 53.5) }), 501);
  eq('closed under the EP-day low: cancelled', b.candidates.length, 0);
}
{
  const b = fresh();
  addPicks(b, 'd0', { ep9m: [ep()] });
  for (let i = 1; i <= MB.dipWindow; i++) stepBook(b, `d${i}`, bars({ EPX: bar(61, 62, 60, 61) }), 501);
  eq('never dipped: expires after the window', b.candidates.length, 0);
  eq('and never bought', b.open.length, 0);
}

// ---- slots and ranking ----------------------------------------------------------------
{
  const b = fresh();
  const rows = Array.from({ length: 12 }, (_, i) => sip({ ticker: `T${i}`, rsRating: 70 + i }));
  addPicks(b, 'd0', { sip: rows });
  const m: Record<string, Bar> = {};
  for (let i = 0; i < 12; i++) m[`T${i}`] = bar(50, 51, 49, 50.5);
  stepBook(b, 'd1', bars(m), 501);
  eq('ten slots', b.open.length, MB.maxPos);
  eq('two turned away', b.totals.skippedFull, 2);
  eq('highest RS bought first', b.open.map(h => h.t).includes('T11') && !b.open.map(h => h.t).includes('T0'), true);
}

// ---- the breakout rule (lib/orb) ---------------------------------------------------
// 28 Sep 2026 is EDT, so 9:30 ET = 13:30 UTC. `mins` builds one session minute by minute.
const T0 = Date.parse('2026-09-28T13:30:00Z');
const at = (k: number) => T0 + k * 60_000;
function mins(spec: (k: number) => [number, number, number, number, number] | null, n = 390): Minute[] {
  const out: Minute[] = [];
  for (let k = 0; k < n; k++) { const x = spec(k); if (x) out.push([at(k), ...x]); }
  return out;
}
eq('9:30 ET is minute 570', etMinute(at(0)), 570);
{
  // Range 49-50 for 30 minutes on 1,000/min; breaks 50 at 10:05 on 50,000 shares.
  const m = mins(k => k < 30 ? [49.5, 50, 49, 49.5, 1000] : k === 35 ? [50.1, 50.6, 50, 50.5, 50_000] : [49.8, 49.9, 49.7, 49.8, 1000]);
  const o = orbTrigger(m, 100_000);   // pace at 10:05 = 1.5 x 100k x 36/390 = 13,846
  eq('breaks the 30-minute high on volume: triggers', o?.minute, 570 + 35);
  eq('fills at the open when it opened above the range', o?.fill, 50.1);
  eq('post-fill low is the rest of the day', o?.postFillLow, 49.7);
  eq('same break without the volume: no trigger', orbTrigger(m, 10_000_000), null);
}
{
  const m = mins(k => k === 10 ? [50, 60, 50, 59, 1_000_000] : [49.5, 50, 49, 49.5, 1000]);
  eq('a spike inside the opening range is the range, not a breakout', orbTrigger(m, 100_000), null);
}
{
  const m = mins(k => k < 30 ? [49.5, 50, 49, 49.5, 1000] : k === 40 ? [49.9, 50.4, 49.8, 50.2, 90_000] : [49.8, 49.9, 49.7, 49.8, 1000]);
  eq('fills at the range high when it opened inside it', orbTrigger(m, 100_000)?.fill, 50);
}
{
  const pre = [[T0 - 60 * 60_000, 40, 70, 40, 70, 9e9] as Minute];
  const m = [...pre, ...mins(k => [49.5, 50, 49, 49.5, 1000])];
  eq('pre-market prints are ignored', orbTrigger(m, 100_000), null);
}

// ---- Model Book v2 ------------------------------------------------------------------------
const v2 = (): ModelBook => { const b = newBook('d0', 500, 'orb'); stepBook(b, 'd0', bars({}), 500); return b; };
const breakout = mins(k => k < 30 ? [49.5, 50, 49, 49.5, 1000] : k < 35 ? [49.8, 49.9, 49.7, 49.8, 1000] : k === 35 ? [50.1, 50.6, 50, 50.5, 50_000] : [50.3, 50.5, 49.9, 50.4, 1000]);
{
  const b = v2();
  addPicks(b, 'd0', { sip: [sip({ avgVol: 100_000 })] });
  eq('v2 pick waits for the breakout', b.candidates[0]?.kind, 'orb');
  eq('it is on the minute-bar list', orbTickers(b).join(), 'AAA');
  stepBook(b, 'd1', bars({ AAA: bar(49.5, 50.6, 49, 50.4) }), 501, new Map([['AAA', breakout]]));
  eq('bought on the breakout, not the open', b.open[0]?.fill, 50.1);
  eq('held through the day', b.open.length, 1);
}
{
  const b = v2();
  addPicks(b, 'd0', { sip: [sip({ avgVol: 100_000 })] });
  // The day's low (47) is under the stop, but it came BEFORE the breakout: not stopped.
  const early = mins(k => k === 2 ? [49, 49.5, 47, 49, 1000] : k < 30 ? [49.5, 50, 49, 49.5, 1000] : k < 35 ? [49.8, 49.9, 49.7, 49.8, 1000] : k === 35 ? [50.1, 50.6, 50, 50.5, 50_000] : [50.3, 50.5, 49.9, 50.4, 1000]);
  stepBook(b, 'd1', bars({ AAA: bar(49.5, 50.6, 47, 50.4) }), 501, new Map([['AAA', early]]));
  eq('a low before the fill does not stop the trade', b.open.length, 1);
  eq('and v1 would have used the day low', candidateFrom('sip', sip(), 'd0')?.kind, 'open');
}
{
  const b = v2();
  addPicks(b, 'd0', { sip: [sip({ avgVol: 100_000 })] });
  stepBook(b, 'd1', bars({ AAA: bar(49.5, 50, 49, 49.5) }), 501, new Map([['AAA', mins(k => [49.5, 50, 49, 49.5, 1000])]]));
  eq('no breakout that session: not bought', b.open.length, 0);
  eq('and not carried to the next session', b.candidates.length, 0);
  eq('no breakout is not a data gap', b.dataGaps, 0);
}
{
  const b = v2();
  addPicks(b, 'd0', { sip: [sip({ avgVol: 100_000 })] });
  stepBook(b, 'd1', bars({ AAA: bar(49.5, 50.6, 49, 50.4) }), 501, new Map([['AAA', null]]));
  eq('failed minute fetch: counted as a data gap', b.dataGaps, 1);
  eq('and not bought', b.open.length, 0);
}
{
  const b = v2();
  addPicks(b, 'd0', { sip: [sip()] });            // no avgVol on the row
  stepBook(b, 'd1', bars({ AAA: bar(49.5, 50.6, 49, 50.4) }), 501, new Map([['AAA', breakout]]));
  eq('no average volume: a data gap, not "no breakout"', b.dataGaps, 1);
}
{
  const b = v2();
  addPicks(b, 'd0', { swing: [{ symbol: 'SWG', price: 100, avgDollarVolM: 50, rsRating: 96, stage: 'Stage 2', dayLow: 95, plan: { tradeable: true, stop: 95 } }] });
  eq('Swing volume comes from average dollar volume', b.candidates[0]?.avgVol, 500_000);
  addPicks(b, 'd0', { ep9m: [ep()] });
  eq('EP9M keeps its dip entry in v2', b.candidates.find(c => c.t === 'EPX')?.kind, 'dip');
}

done('modelBook');

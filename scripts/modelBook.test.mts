/* scripts/modelBook.test.mts — the Model Book's rules, pinned.
 *
 * The book is the live test of scripts/backtest/portfolio.ts. If these rules
 * drift from the backtest's, the live record stops measuring what the
 * backtest claimed, so every rule in lib/modelBook's header has a line here.
 */

import { newBook, stepBook, addPicks, candidateFrom, MB, type ModelBook, type Bar } from '../src/lib/modelBook.ts';
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

done('modelBook');

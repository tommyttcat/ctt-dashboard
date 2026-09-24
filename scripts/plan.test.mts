/* scripts/plan.test.mts — the levels the cards hand out.
 *
 * Two plans, two different shapes, and both are claims a reader acts on with
 * money. The EP pullback plan is the one to watch: its trigger sits BELOW the
 * last price, which is the opposite of every other table here, so the usual
 * "trigger already passed" reasoning does not apply and the geometry has to
 * be right on its own terms.
 */

import { epPullbackPlan, EP_PULLBACK_WINDOW } from '../src/lib/scans/ep9m.ts';
import { computeTradePlan } from '../src/lib/indicators/tradeplan.ts';
import { EXIT_STYLE, EXIT_GUIDANCE } from '../src/lib/scans/exits.ts';
import { trigRowOf, trigRows, planRowsFor, planStatusOf } from '../src/lib/scans/triggerProximity.ts';
import { eq, near, ok, done } from './testkit.mts';

// ---- the EP pullback plan --------------------------------------------------
const ep = epPullbackPlan({ price: 12, dayHigh: 12, dayLow: 8, priorSwingHigh: 16 });
ok('EP plan is tradeable', ep.tradeable);
near('trigger is the EP-day midpoint', ep.trigger, 10);
near('stop is the EP-day low', ep.stop, 8);
near('risk is half the range', (ep.trigger ?? 0) - (ep.stop ?? 0), 2);
near('target is a fixed 2R', ep.target, 14);
eq('trigger is labelled', ep.triggerLabel, 'EP mid');
near('stop percent', ep.stopPct, 20);
near('overhead is the swing high, not the day high', ep.resistanceR, 3); // (16-10)/2
eq('overhead label', ep.resistanceLabel, 'prior swing high');
eq('not clear when a swing high is above', ep.clear, false);

/* The trigger is BELOW the last price by construction — that is the setup,
   not a stale level, and nothing downstream may treat it as "already passed". */
ok('trigger sits below the last price', (ep.trigger ?? 0) < 12);

const clear = epPullbackPlan({ price: 12, dayHigh: 12, dayLow: 8, priorSwingHigh: null });
ok('no swing high means clear', clear.clear);
eq('and no resistance to quote', clear.resistanceR, null);

const dead = epPullbackPlan({ price: 7, dayHigh: 12, dayLow: 8 });
eq('below the EP low is not tradeable', dead.tradeable, false);
ok('and says why', /below the EP day/i.test(dead.note));

const collapsed = epPullbackPlan({ price: 10, dayHigh: 12, dayLow: 8, changePct: -20 });
eq('a 20% down day is not a long setup', collapsed.tradeable, false);
eq('and is marked collapsed', collapsed.collapsed, true);

const flat = epPullbackPlan({ price: 10, dayHigh: 10.01, dayLow: 10.0 });
eq('a range too tight to size a stop', flat.tradeable, false);

eq('no range at all', epPullbackPlan({ price: 10, dayHigh: null, dayLow: null }).tradeable, false);
eq('the window is ten sessions', EP_PULLBACK_WINDOW, 10);
ok('the note states the window', ep.note.includes('10 sessions'));

// ---- the generic plan now carries a trail ---------------------------------
// The fixed 2R was the worst exit measured on the momentum tables, so the plan
// has to be able to express the exit that won; a plan without a trail level
// cannot, and the tooltip silently falls back to the target.
const gen = computeTradePlan({
  price: 100, adrPct: 5, atrPct: 4, changePct: 2,
  ema10: 98, ema21: 95, ema50: 90, dayHigh: 101, priorSwingHigh: 110,
  aboveEma10: true, aboveEma21: true, setupName: null,
});
ok('generic plan is tradeable', gen.tradeable);
near('trail is the 21 EMA', gen.trail, 95);
eq('trail is labelled', gen.trailLabel, '21 EMA');
near('trigger is the day high', gen.trigger, 101);
ok('target is above the trigger', (gen.target ?? 0) > (gen.trigger ?? 0));

const noEma21 = computeTradePlan({
  price: 100, adrPct: 5, atrPct: 4, changePct: 2,
  ema10: 98, ema21: null, ema50: null, dayHigh: 101,
  aboveEma10: true, aboveEma21: null, setupName: null,
});
near('falls back to the 10 EMA', noEma21.trail, 98);
eq('and says so', noEma21.trailLabel, '10 EMA');

// ---- the exit decision is recorded, not just described ---------------------
// EXIT_STYLE is what the renderer acts on and EXIT_GUIDANCE is what the reader
// reads. They describe the same measurement, so they must not disagree.
eq('momentum tables trail', EXIT_STYLE.scanner, 'trail');
eq('swing trails', EXIT_STYLE.swing, 'trail');
eq('VCP is the one that takes the target', EXIT_STYLE.vcp, 'target');
eq('nothing worked on 10/21', EXIT_STYLE.consolidation, 'none');
for (const [scan, style] of Object.entries(EXIT_STYLE)) {
  const text = EXIT_GUIDANCE[scan as keyof typeof EXIT_GUIDANCE].toLowerCase();
  if (style === 'trail') ok(`${scan} guidance mentions trailing`, text.includes('trail'));
  if (style === 'target') ok(`${scan} guidance says take the target`, text.includes('take the 2r'));
  if (style === 'none') ok(`${scan} guidance says nothing worked`, /no exit|flat either way/.test(text));
}

// ---- closest to trigger ----------------------------------------------------
/* The direction rule. A breakout row is only a watch while price is BELOW the
   level; an EP9M row only while price is ABOVE it. Both halves are asserted
   because getting one backwards lists names on the wrong side of the market
   with a confident distance next to them. */
const breakout = (price: number, trigger: number) => ({
  ticker: 'AAA', price, _source: 'swing',
  plan: { tradeable: true, trigger, stop: trigger * 0.95, triggerLabel: 'day high' },
});
const pull = (price: number, trigger: number) => ({
  ticker: 'BBB', price, _source: 'ep9m',
  plan: { tradeable: true, trigger, stop: trigger * 0.9, triggerLabel: 'EP mid' },
});

ok('breakout below its level is a watch', trigRowOf(breakout(99, 100)) != null);
ok('breakout through its level is dropped', trigRowOf(breakout(101, 100)) == null);
ok('breakout exactly at its level is dropped', trigRowOf(breakout(100, 100)) == null);
ok('EP pullback above its level is a watch', trigRowOf(pull(101, 100)) != null);
ok('EP pullback through its level is dropped', trigRowOf(pull(99, 100)) == null);
eq('breakout is not flagged as a pullback', trigRowOf(breakout(99, 100))?.pullback, false);
eq('EP9M is flagged as a pullback', trigRowOf(pull(101, 100))?.pullback, true);

// The Buy & stop panel lists a FIXED set (the recommended names) and keeps
// names already through their level, flagged, rather than dropping them.
{
  const rows = planRowsFor([breakout(99, 100), breakout(101, 100), pull(101, 100), pull(99, 100)]);
  eq('planRowsFor keeps every name with a live plan', rows.length, 4);
  eq('breakout under its level is not through', rows[0].through, false);
  eq('breakout over its level is through', rows[1].through, true);
  eq('EP above its dip level is not through', rows[2].through, false);
  eq('EP below its dip level is through', rows[3].through, true);
  eq('planRowsFor keeps input order', rows.map(r => r.price).join(','), '99,101,101,99');
  eq('planRowsFor drops a name with no live plan',
    planRowsFor([{ ticker: 'C', price: 99, _source: 'swing', plan: { tradeable: false, trigger: 100, stop: 95 } }]).length, 0);
}

// One-word status. breakout(price, trigger) has stop = trigger*0.95; ADR 4%.
{
  const st = (s: any) => planStatusOf(planRowsFor([s])[0]);
  const bo = (price: number) => ({ ...breakout(price, 100), adrPct: 4 });
  eq('below a breakout level is WAIT', st(bo(99)), 'wait');
  eq('just through a breakout level is HIT', st(bo(101)), 'hit');
  eq('more than 1 ADR past a breakout level is MISS', st(bo(105)), 'miss');
  eq('no ADR means no MISS call', st(breakout(110, 100)), 'hit');
  eq('at or under the stop is OUT', st(bo(95)), 'out');
  eq('EP above its dip level is WAIT', st(pull(101, 100)), 'wait');
  eq('EP through its dip level is HIT, never MISS', st({ ...pull(92, 100), adrPct: 2 }), 'hit');
  eq('EP under its stop is OUT', st(pull(89, 100)), 'out');
  const ext = { ...breakout(99, 100), plan: { ...breakout(99, 100).plan, overextended: true } };
  eq('overextended plan is kept in a fixed list', planRowsFor([ext]).length, 1);
  eq('overextended plan reads EXT', st(ext), 'ext');
  ok('overextended plan is still dropped from the proximity list', trigRowOf(ext) == null);
  eq('collapsed plan is dropped even from a fixed list',
    planRowsFor([{ ...breakout(99, 100), plan: { ...breakout(99, 100).plan, collapsed: true } }]).length, 0);
}

near('distance is measured from price', trigRowOf(breakout(100, 101))?.awayPct, 1);
ok('distance is always positive', (trigRowOf(pull(101, 100))?.awayPct ?? -1) > 0);

// The gates the scan tables already apply: a plan that is not live is not a watch.
ok('untradeable plan is dropped', trigRowOf({ ticker: 'C', price: 99, _source: 'swing', plan: { tradeable: false, trigger: 100, stop: 95 } }) == null);
ok('collapsed plan is dropped', trigRowOf({ ticker: 'C', price: 99, _source: 'swing', plan: { tradeable: true, collapsed: true, trigger: 100, stop: 95 } }) == null);
ok('overextended plan is dropped', trigRowOf({ ticker: 'C', price: 99, _source: 'swing', plan: { tradeable: true, overextended: true, trigger: 100, stop: 95 } }) == null);
ok('a row with no plan at all is dropped', trigRowOf({ ticker: 'C', price: 99, _source: 'daily' }) == null);

/* VCP carries trigger/stop at the top level instead of in a plan — the one
   shape exception, and the only scan allowed to use it. */
const vcp = { symbol: 'VVV', price: 50, _source: 'vcp', trigger: 52, stop: 47 };
ok('VCP top-level levels are read', trigRowOf(vcp) != null);
eq('VCP label falls back to the pivot', trigRowOf(vcp)?.label, 'pivot');
ok('the same shape on another scan is not read', trigRowOf({ ...vcp, _source: 'daily' }) == null);

const sorted = trigRows([breakout(90, 100), breakout(99, 100), vcp]);
eq('sorted by distance, closest first', sorted[0].price, 99);
eq('the limit is honoured', trigRows([breakout(90, 100), breakout(99, 100), vcp], 2).length, 2);

done('trade plans');

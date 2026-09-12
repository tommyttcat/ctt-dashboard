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

done('trade plans');

/* scripts/edge.test.mts — the row shading, at its boundaries.
 *
 * These thresholds are not style choices: each one is a number a five-year
 * replay produced, and the tooltips quote them to the reader. A silent change
 * here changes what the site claims was measured, which is the one kind of
 * regression that cannot be spotted by looking at the page.
 *
 * The cases below are the EDGES of each rule — 9.0 vs 9.01 ADR, $4.99 vs
 * $5.00 — because an off-by-one in a comparison operator is exactly how a
 * threshold drifts without anyone noticing.
 */

import {
  edgeTier, ep9mTier, vcpTier, swingTier, consolidationTier, multibaggerTier, hrsTier,
} from '../src/lib/scans/edge.ts';
import { eq, done } from './testkit.mts';

// ---- momentum: Stocks in Play + Daily Setups -------------------------------
// red = ADR above 9%, or price in [5, 10). green = clears both and closed in
// the top 10% of the day's range.
eq('adr 9.0 is not red', edgeTier({ adrPct: 9, price: 50, closeStrength: 0.95 }), 'green');
eq('adr 9.01 is red', edgeTier({ adrPct: 9.01, price: 50, closeStrength: 0.95 }), 'red');
eq('price 4.99 escapes the band', edgeTier({ adrPct: 4, price: 4.99, closeStrength: 0.95 }), 'green');
eq('price 5.00 is red', edgeTier({ adrPct: 4, price: 5, closeStrength: 0.95 }), 'red');
eq('price 9.99 is red', edgeTier({ adrPct: 4, price: 9.99, closeStrength: 0.95 }), 'red');
eq('price 10.00 escapes', edgeTier({ adrPct: 4, price: 10, closeStrength: 0.95 }), 'green');
eq('close 0.9 is green', edgeTier({ adrPct: 4, price: 50, closeStrength: 0.9 }), 'green');
eq('close 0.89 is yellow', edgeTier({ adrPct: 4, price: 50, closeStrength: 0.89 }), 'yellow');
eq('close derived from the range', edgeTier({ adrPct: 4, price: 50, dayHigh: 50, dayLow: 40 }), 'green');
eq('no adr means no claim', edgeTier({ price: 50, closeStrength: 1 }), null);
eq('no price means no claim', edgeTier({ adrPct: 4, closeStrength: 1 }), null);
eq('null row', edgeTier(null), null);

// ---- EP9M: measured on the pullback entry the card ships --------------------
const ep = (o: Record<string, number>) => ep9mTier({ adrPct: 4, price: 20, floatTurnover: 0.3, mktCap: 1e9, mf: 50, ...o });
eq('ep base case is yellow', ep({}), 'yellow');
eq('ep adr above 9 is red', ep({ adrPct: 9.5 }), 'red');
eq('ep float turnover 1x is red', ep({ floatTurnover: 1 }), 'red');
eq('ep float turnover 0.99 is not', ep({ floatTurnover: 0.99 }), 'yellow');
eq('ep cap under 300M is red', ep({ mktCap: 2.99e8 }), 'red');
eq('ep cap at 300M is not', ep({ mktCap: 3e8 }), 'yellow');
eq('ep money flow 65 is green', ep({ mf: 65 }), 'green');
eq('ep price 50 is green', ep({ price: 50 }), 'green');
eq('ep red beats green', ep({ mf: 90, adrPct: 12 }), 'red');

// ---- VCP: the tail, not the average ---------------------------------------
eq('vcp wide base with a real contraction', vcpTier({ atrPct: 4, stopPct: 9, finalDepthPct: -12 }), 'green');
eq('vcp shallow contraction is yellow', vcpTier({ atrPct: 4, stopPct: 9, finalDepthPct: -8 }), 'yellow');
eq('vcp atr under 2.5 is red', vcpTier({ atrPct: 2.4, stopPct: 9, finalDepthPct: -12 }), 'red');
eq('vcp stop under 5 is red', vcpTier({ atrPct: 4, stopPct: 4.9, finalDepthPct: -12 }), 'red');
eq('vcp depth sign does not matter', vcpTier({ atrPct: 4, stopPct: 9, finalDepthPct: 12 }), 'green');
eq('vcp no atr means no claim', vcpTier({ stopPct: 9 }), null);

// ---- Swing: Stage 1 is the only losing bucket ------------------------------
eq('swing stage 1 is red', swingTier({ rsRating: 99, mf: 90, stage: 'Stage 1B' }), 'red');
eq('swing rs 95 is green', swingTier({ rsRating: 95, stage: 'Stage 2A' }), 'green');
eq('swing rs 94 alone is yellow', swingTier({ rsRating: 94, stage: 'Stage 2A' }), 'yellow');
eq('swing money flow 65 is green', swingTier({ rsRating: 70, mf: 65, stage: 'Stage 2A' }), 'green');
eq('swing with neither marker', swingTier({ stage: 'Stage 2A' }), null);

// ---- 10/21: tightness is what lost ----------------------------------------
eq('coil 3x pressed at the high', consolidationTier({ coilRatio: 3, stochK: 75, pctOffHigh: 5 }), 'green');
eq('coil 3x not pressed', consolidationTier({ coilRatio: 3, stochK: 74, pctOffHigh: 5 }), 'yellow');
eq('tight coil is red', consolidationTier({ coilRatio: 2.49, stochK: 90, pctOffHigh: 5 }), 'red');
eq('more than 11 off the high is red', consolidationTier({ coilRatio: 4, stochK: 90, pctOffHigh: 11.1 }), 'red');
eq('exactly 11 off the high is not', consolidationTier({ coilRatio: 4, stochK: 90, pctOffHigh: 11 }), 'green');

// ---- 100-Bagger: the boring growth band ------------------------------------
eq('growth 50+ is red', multibaggerTier({ revGrowthPct: 50, marketCap: 1e9 }), 'red');
eq('growth 10-25 under 3B is green', multibaggerTier({ revGrowthPct: 15, marketCap: 2.9e9 }), 'green');
eq('same growth, bigger cap', multibaggerTier({ revGrowthPct: 15, marketCap: 3e9 }), 'yellow');
eq('growth 25 is out of the band', multibaggerTier({ revGrowthPct: 25, marketCap: 1e9 }), 'yellow');

// ---- Hidden RS: the band that inverts the momentum rule ---------------------
eq('hrs $5 is green', hrsTier({ price: 5 }), 'green');
eq('hrs $15 is green', hrsTier({ price: 15 }), 'green');
eq('hrs $15.01 is yellow', hrsTier({ price: 15.01 }), 'yellow');
eq('hrs $4.99 is yellow', hrsTier({ price: 4.99 }), 'yellow');
eq('hrs never returns red', hrsTier({ price: 500 }), 'yellow');

done('edge tiers');

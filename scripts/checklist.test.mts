/* scripts/checklist.test.mts — the day and swing checklists (lib/scans/checklist). */
import { swingCheck, dayCheck, setMarketUp, checkTip, daysToEarnings, paceOf } from '../src/lib/scans/checklist.ts';
import { eq, ok, done } from './testkit.mts';

const T = '2026-10-12';
const sw = (o: Record<string, unknown>) => swingCheck({ price: 100, ema50: 90, ema21Rising: true, distToEma21: 2, distToEma10: 1, adrPct: 4, rsRating: 85, ...o }, false, T)!.tier;
setMarketUp(true);
eq('swing: all four = green', sw({}), 'green');
eq('swing: RS 69 = yellow', sw({ rsRating: 69 }), 'yellow');
eq('swing: 21 EMA falling = yellow', sw({ ema21Rising: false }), 'yellow');
eq('swing: 1.0 ADR from the 10 is still near', sw({ distToEma21: 6, distToEma10: 4 }), 'green');
eq('swing: 2 ADRs stretched = yellow', sw({ distToEma21: 8, distToEma10: 8 }), 'yellow');
eq('swing: 3.0 ADRs is not yet red', sw({ distToEma21: 12, distToEma10: 12 }), 'yellow');
eq('swing: 3.1 ADRs = red', sw({ distToEma21: 12.4, distToEma10: 12.4 }), 'red');
eq('swing: below the 50 = red', sw({ price: 89 }), 'red');
eq('swing: earnings in 3 days = red', sw({ earningsDate: '2026-10-15' }), 'red');
eq('swing: earnings in 4 days = fine', sw({ earningsDate: '2026-10-16' }), 'green');
eq('swing: earnings already passed = fine', sw({ earningsDate: '2026-10-01' }), 'green');
eq('swing: scan red rule wins', swingCheck({ price: 100, ema50: 90, ema21Rising: true, distToEma21: 2, adrPct: 4, rsRating: 85 }, true, T)!.tier, 'red');
eq('swing: stage fallback with no stretch data stays yellow', sw({ ema50: undefined, ema21Rising: undefined, distToEma21: undefined, distToEma10: undefined, stage: 'Stage 2A' }), 'yellow');
eq('swing: a known Stage 3 is not an uptrend', sw({ stage: 'Stage 3A' }), 'yellow');
eq('swing: Stage 2 with EMAs is green', sw({ stage: 'Stage 2B' }), 'green');
eq('swing: stage 3 with no EMAs = red', sw({ ema50: undefined, ema21Rising: undefined, distToEma21: undefined, stage: 'Stage 3' }), 'red');
eq('swing: rs field (momentum rows) counts', sw({ rsRating: undefined, rs: 75 }), 'green');
setMarketUp(false);
eq('swing: QQQ below its 200-day = red', sw({}), 'red');
setMarketUp(null);
eq('swing: market unknown does not block green', sw({}), 'green');

const AFTER = 965;  // after the close: RVOL read as is
const dy = (o: Record<string, unknown>) => dayCheck({ price: 30, changePct: 5, rvol: 3, closeStrength: 0.7, adrPct: 6, dVol: 5e7, ...o }, false, AFTER)!.tier;
eq('day: all checks = green', dy({}), 'green');
eq('day: down on the day = red', dy({ changePct: -0.5 }), 'red');
eq('day: volume 1.4x = red', dy({ rvol: 1.4 }), 'red');
eq('day: volume 1.5x = yellow', dy({ rvol: 1.5 }), 'yellow');
eq('day: fading to the bottom half = yellow', dy({ closeStrength: 0.4 }), 'yellow');
eq('day: below the open = red', dy({ open: 31 }), 'red');
eq('day: above the open = green', dy({ open: 29 }), 'green');
eq('day: thin range (ADR 3%) = yellow', dy({ adrPct: 3 }), 'yellow');
eq('day: range from high/low when no closeStrength', dy({ closeStrength: undefined, dayHigh: 31, dayLow: 25 }), 'green');
ok('tip lists ticks and crosses', /✔ Up today[\s\S]*✖ Moves enough/.test(checkTip('day', dayCheck({ price: 30, changePct: 5, rvol: 3, closeStrength: 0.7, adrPct: 3, dVol: 5e7 }, false, AFTER))));
eq('pace: 0.5x by 11:15 is 1.9x pace', paceOf(0.5, 675)!.toFixed(2), (0.5 / (105 / 390)).toFixed(2));
eq('pace: 15-minute floor at the open', paceOf(0.1, 571)!.toFixed(2), (0.1 / (15 / 390)).toFixed(2));
eq('pace: Early Movers rows already a pace', paceOf(2, 675, true), 2);
eq('pace: pre-market left as is', paceOf(0.4, 500), 0.4);
eq('day: half-day 1.0x RVOL is a 2x pace = green', dayCheck({ price: 30, changePct: 5, rvol: 1.0, closeStrength: 0.7, adrPct: 6, dVol: 5e7 }, false, 765)!.tier, 'green');
eq('day: scan red rules do not apply', dayCheck({ price: 6, changePct: 50, rvol: 9, closeStrength: 0.7, adrPct: 60, dVol: 5e7 }, true, AFTER)!.tier, 'green');
eq('days to earnings', daysToEarnings({ earningsDate: '2026-10-15T20:00:00Z' }, T), 3);
done('checklist');

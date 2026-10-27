/* scripts/checklist.test.mts — the day and swing checklists (lib/scans/checklist). */
import { swingCheck, dayCheck, setMarketUp, checkTip, daysToEarnings, paceOf, setEarnings, setGroups, sessionShare } from '../src/lib/scans/checklist.ts';
import { tightnessOf, lowerHighOf } from '../src/lib/scans/tightness.ts';
import { neglectOf } from '../src/lib/scans/neglect.ts';
import { swingPrecheck } from '../src/lib/scans/swingWide.ts';
import { groupTerciles } from '../src/lib/groups.ts';
import { eq, ok, done } from './testkit.mts';

const T = '2026-10-12';
const sw = (o: Record<string, unknown>) => swingCheck({ price: 100, ema50: 90, ema21Rising: true, distToEma21: 2, distToEma10: 1, adrPct: 4, rsRating: 85, volDry: 0.6, ...o }, false, T, 965)!.tier;
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
// ---- 15 Oct: tightened after TWLO went green closing under its 10 and 21
eq('swing: TWLO (under the 10 and the 21, 10 still over 21) = yellow, not green', sw({ distToEma10: -2.1, distToEma21: -0.4, adrPct: 5.8, rsRating: 98, volDry: 0.4 }), 'yellow');
eq('swing: under the 21 with the 10 below it = red', sw({ distToEma10: -1, distToEma21: -2 }), 'red');
eq('swing: under the 21 with the 21 falling = red', sw({ distToEma10: -2, distToEma21: -1, ema21Rising: false }), 'red');
eq('swing: dip under the 10 while holding the 21 = green', sw({ distToEma10: -0.5, distToEma21: 1.5 }), 'green');
eq('swing: 10 EMA under the 21 above both = yellow', sw({ distToEma10: 3, distToEma21: 2 }), 'yellow');
eq('swing: RS 49 = red', sw({ rsRating: 49 }), 'red');
eq('swing: 30% off the high = yellow', sw({ pctOffHigh: -30 }), 'yellow');
eq('swing: 10% off the high (either sign) = green', sw({ pctOffHigh: 10 }), 'green');
eq('swing: down on 2x volume = yellow', sw({ changePct: -2, rvol: 2 }), 'yellow');
eq('swing: down on quiet volume = green', sw({ changePct: -2, rvol: 0.7 }), 'green');
eq('swing: no volume dry-up data = yellow (unchecked never greens)', sw({ volDry: undefined }), 'yellow');
eq('swing: stage label without EMAs no longer greens', sw({ ema50: undefined, ema21Rising: undefined, stage: 'Stage 2A' }), 'yellow');
// ---- 15 Oct: lower high
eq('swing: under a failed bounce high = yellow', sw({ lowerHigh: 104 }), 'yellow');
eq('swing: price back above the bounce high = green', sw({ lowerHigh: 98 }), 'green');
eq('swing: no lower high (0) = green', sw({ lowerHigh: 0 }), 'green');
ok('swing: lower high named in the tip', /✖ No lower high \(last bounce failed at 104/.test(checkTip('swing', swingCheck({ price: 100, ema50: 90, ema21Rising: true, distToEma21: 2, distToEma10: 1, adrPct: 4, rsRating: 85, volDry: 0.6, lowerHigh: 104 }, false, T, 965))));
{
  // 30 flat bars, a peak at 120, a bounce to 112 that fails, then drift: lower high at 112.
  const B = (h: number, c = h - 1) => ({ h, l: c - 1, c, v: 1000 });
  const base = Array.from({ length: 30 }, () => B(101, 100));
  const run = [B(105), B(110), B(116), B(120, 118), B(114, 112), B(109, 107), B(108, 106), B(112, 110), B(109, 107), B(107, 105), B(106, 104)];
  eq('lowerHighOf: failed bounce under the peak', lowerHighOf([...base, ...run]), 112);
  eq('lowerHighOf: a close back above the bounce clears it', lowerHighOf([...base, ...run, B(114, 113)]), 0);
  eq('lowerHighOf: straight pullback, no bounce yet = 0', lowerHighOf([...base, B(110), B(120, 118), B(116, 114), B(113, 111), B(111, 109)]), 0);
  eq('lowerHighOf: too few bars = null', lowerHighOf(base.slice(0, 20)), null);
  eq('lowerHighOf: bounce within half an ADR of the peak = 0', lowerHighOf([...base, B(110), B(120, 118), B(116, 114), B(119.9, 117), B(116, 114), B(115, 113), B(114, 112)]), 0);
}
setMarketUp(false);
eq('swing: QQQ below its 200-day = red', sw({}), 'red');
setMarketUp(null);
eq('swing: market unknown does not block green', sw({}), 'green');

const AFTER = 965;  // after the close: RVOL read as is
const dy = (o: Record<string, unknown>) => dayCheck({ price: 30, changePct: 5, rvol: 3, closeStrength: 0.7, adrPct: 6, dVol: 5e7, ...o }, false, AFTER)!.tier;
eq('day: all checks = green', dy({}), 'green');
eq('day: down on the day = red', dy({ changePct: -0.5 }), 'red');
eq('day: volume 0.9x = red', dy({ rvol: 0.9 }), 'red');
eq('day: volume 1.4x = yellow', dy({ rvol: 1.4 }), 'yellow');
eq('day: volume 1.5x = green', dy({ rvol: 1.5 }), 'green');
eq('day: rvolPace from the scan wins over the page clock', dayCheck({ price: 30, changePct: 5, rvol: 0.6, rvolPace: 1.8, closeStrength: 0.7, adrPct: 6, dVol: 5e7 }, false, 700)!.tier, 'green');
eq('day: fading to the bottom half = yellow', dy({ closeStrength: 0.4 }), 'yellow');
eq('day: below the open = red', dy({ open: 31 }), 'red');
eq('day: above the open = green', dy({ open: 29 }), 'green');
eq('day: thin range (ADR 3%) = yellow', dy({ adrPct: 3 }), 'yellow');
eq('day: range from high/low when no closeStrength', dy({ closeStrength: undefined, dayHigh: 31, dayLow: 25 }), 'green');
ok('tip lists ticks and crosses', /✔ Up today[\s\S]*✖ Moves enough/.test(checkTip('day', dayCheck({ price: 30, changePct: 5, rvol: 3, closeStrength: 0.7, adrPct: 3, dVol: 5e7 }, false, AFTER))));
eq('pace: 0.5x by 11:15 is a 1.49x pace on the U-curve (was 1.86 on a straight line)', paceOf(0.5, 675)!.toFixed(2), '1.49');
eq('pace: 15-minute floor at the open (U-curve share at 9:45 = 6.5%)', paceOf(0.1, 571)!.toFixed(2), (0.1 / 0.065).toFixed(2));
eq('pace: Early Movers rows already a pace', paceOf(2, 675, true), 2);
eq('pace: pre-market left as is', paceOf(0.4, 500), 0.4);
eq('day: half-day 1.0x RVOL is a 2x pace = green', dayCheck({ price: 30, changePct: 5, rvol: 1.0, closeStrength: 0.7, adrPct: 6, dVol: 5e7 }, false, 765)!.tier, 'green');
eq('day: scan red rules do not apply', dayCheck({ price: 6, changePct: 50, rvol: 9, closeStrength: 0.7, adrPct: 60, dVol: 5e7 }, true, AFTER)!.tier, 'green');
eq('days to earnings', daysToEarnings({ earningsDate: '2026-10-15T20:00:00Z' }, T), 3);
// ---- 12 Oct, round 2: earnings lookup, group, tightness, catalyst
setMarketUp(true);
setEarnings({ AAA: '2026-10-14' });
eq('swing: earnings from the calendar map = red', sw({ ticker: 'AAA' }), 'red');
eq('swing: a name not on the calendar is clear', sw({ ticker: 'BBB' }), 'green');
setEarnings(null);
setGroups({ AAA: 0, BBB: 1, CCC: 2 });
eq('swing: top-third group stays green', sw({ ticker: 'AAA' }), 'green');
eq('swing: middle group = yellow', sw({ ticker: 'BBB' }), 'yellow');
eq('swing: bottom group = yellow', sw({ ticker: 'CCC' }), 'yellow');
eq('swing: unclassified group does not block', sw({ ticker: 'ZZZ' }), 'green');
setGroups(null);
eq('swing: tight and quiet = green', sw({ tight5: 1.2, volDry: 0.6 }), 'green');
eq('swing: a wide 5-day range no longer blocks green (10/21 evidence)', sw({ tight5: 2.8, volDry: 0.6 }), 'green');
eq('swing: loud (volume 1.1x) = yellow', sw({ tight5: 1.2, volDry: 1.1 }), 'yellow');
eq('day: specific catalyst = green', dy({ catalyst: 'Earnings Beat' }), 'green');
eq('day: no specific catalyst no longer blocks green (info only)', dy({ catalyst: 'Technical Momentum' }), 'green');
eq('day: generic tag but causal news = green', dy({ catalyst: 'News', newsCausal: true }), 'green');
eq('day: no news fields = not checked', dy({}), 'green');
const flat = Array.from({ length: 30 }, (_, i) => ({ h: 101, l: 99, c: 100, v: i >= 27 ? 500 : 1000 }));
const tt = tightnessOf(flat);
eq('tightness: 5-day span in ADRs', tt.tight5, +((2 / 100) / (101 / 99 - 1)).toFixed(2));
eq('tightness: volume dry-up', tt.volDry, 0.5);
eq('tightness: too few bars', tightnessOf(flat.slice(0, 10)).tight5, null);
// SIC 73 (software), 13 (oil & gas extraction), 60 (banks) — five names each.
const names = [...['MSFT', 'ORCL', 'ADBE', 'CRM', 'NOW'].map(t => ({ t, r63: 0.3 })), ...['JPM', 'BAC', 'C', 'WFC', 'USB'].map(t => ({ t, r63: -0.1 })), ...['EOG', 'OXY', 'HAL', 'SLB', 'DVN'].map(t => ({ t, r63: 0.1 }))];
const g = groupTerciles(names);
ok('groups: three groups ranked', g.MSFT === 0 && g.EOG === 1 && g.JPM === 2);
eq('groups: under 5 names is unclassified', groupTerciles(names.slice(0, 4)).MSFT, undefined);
eq('day: neglected = green', dy({ neglected: true, preRun3m: 5, preRun6m: 10 }), 'green');
eq('day: already ran no longer blocks green (info only)', dy({ neglected: false, preRun3m: 40, preRun6m: 80 }), 'green');
const nb = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => ({ t: Date.UTC(2026, 0, 1) + i * 864e5, h: f(i) * 1.01, l: f(i) * 0.99, c: f(i) }));
eq('neglect: flat base is neglected', neglectOf(nb(200, () => 50), '2099-01-01').neglected, true);
eq('neglect: a doubled stock is not', neglectOf(nb(200, i => 20 + i * 0.3), '2099-01-01').neglected, false);
eq('neglect: too little history', neglectOf(nb(100, () => 50), '2099-01-01').neglected, null);
// wider Swing universe pre-check: an uptrend that dips back to its 21 EMA passes; a stock
// ripping to new highs (stochastic pinned) does not.
const up = (n: number) => Array.from({ length: n }, (_, i) => { const c = 100 + i * 0.5; return { c, h: c * 1.015, l: c * 0.985, v: 1e6 }; });
const dip = [...up(40), ...[118, 117, 116.5, 116, 115.5].map(c => ({ c, h: c * 1.012, l: c * 0.985, v: 1e6 }))];
eq('swingWide: a dip to the 21 EMA passes', swingPrecheck(dip), true);
eq('swingWide: a stock at its highs does not', swingPrecheck(up(45)), false);
eq('swingWide: too few bars', swingPrecheck(up(20)), false);
// Session share for whole-day volume floors (27 Oct 2026)
eq('session share: 9:40 -> the 10% floor', sessionShare('2026-10-27', 580, '2026-10-27'), 0.1);
eq('session share: 1:00 PM (data 12:45) -> 52% of a day on the U-curve', +sessionShare('2026-10-27', 780, '2026-10-27').toFixed(3), 0.52);
eq('session share: after the close -> full', sessionShare('2026-10-27', 980, '2026-10-27'), 1);
eq('session share: yesterday\'s bar -> full', sessionShare('2026-10-26', 652, '2026-10-27'), 1);
done('checklist');

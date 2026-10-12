/* scripts/leaders.test.mts — Liquid Leaders arithmetic (lib/leaders). */

import { expectedCum, trackingPct, profileOf, buildLive, chkOf, checkFields, BUCKETS, type LeadersState } from '../src/lib/leaders.ts';
import { eq, near, ok, done } from './testkit.mts';

// A flat day: 100 shares every half hour -> cumulative 100, 200, ... 1300.
const flat = Array.from({ length: BUCKETS }, () => 100);
const prof = profileOf([flat, flat]);
eq('profile is cumulative', prof[BUCKETS - 1], 1300);
near('expected at the end of the first half hour', expectedCum(prof, 600), 100, 1e-9);
near('expected halfway through it', expectedCum(prof, 585), 50, 1e-9);
near('expected at the close', expectedCum(prof, 960), 1300, 1e-9);
near('twice the usual pace reads +100%', trackingPct(200, prof, 600), 100, 1e-9);
eq('no volume, no reading', trackingPct(0, prof, 600), null);
eq('a short session is left out of the profile', profileOf([flat.slice(0, 5)]).length, 0);

const state: LeadersState = { date: '2026-09-29', builtAt: '', names: {
  UP: { maxClose: 100, maxRs: 0.2, adv: 1300, prof },   // new highs today
  MID: { maxClose: 200, maxRs: 0.5, adv: 1300, prof },  // below both
} };
const live = buildLive(state, [
  { t: 'UP', price: 101, prevClose: 95, vol: 400 },
  { t: 'MID', price: 150, prevClose: 149, vol: 50 },
  { t: 'NEW', price: 50, prevClose: 40, vol: 999 },      // not in the universe
], 500, 600, 1, { spy: null, qqq: null }, t => ({ UP: 90, MID: 40 } as Record<string, number>)[t] ?? null);
eq('only universe names count', live.universe, 2);
eq('a close above its 5-year high is a price high', live.priceHigh.map(r => r.t).join(), 'UP');
eq('price / SPY above its best is an RS high', live.rsHigh.map(r => r.t).join(), 'UP');
eq('gainers need RS 70+ (MID is RS 40)', live.gainers.map(r => r.t).join(), 'UP');
eq('4x usual volume reads +300%', live.volume[0].track, 300);
eq('heavy = at least twice usual', live.counts.heavy, 1);
ok('change is a %', Math.abs(live.gainers[0].chg - 6.32) < 0.01);
const down = buildLive(state, [{ t: 'UP', price: 90, prevClose: 95, vol: 400 }], 500, 600, 1, { spy: null, qqq: null }, () => 90);
eq('heavy volume on a down day is not buying', down.volume.length, 0);
const series = Array.from({ length: 70 }, (_, i) => ({ c: 100 + i, h: 101 + i, l: 99 + i, v: 1000 }));
const chk = chkOf(series)!;
ok('chk: EMA10 above EMA21 above EMA50 in an uptrend', chk[0] > chk[1] && chk[1] > chk[3]);
ok('chk: EMA21 rising', chk[1] > chk[2]);
eq('chk: too few bars', chkOf(series.slice(0, 40)), undefined);
const f = checkFields({ maxClose: 1, maxRs: 1, adv: 1, prof: [], chk }, 170, 85);
ok('live distance to the 21 EMA from last night\'s EMA', f.distToEma21 != null && Math.abs(f.distToEma21 - (170 / chk[1] - 1) * 100) < 0.01);
eq('live row carries the rating for the checklist', f.rsRating, 85);
eq('no chk = no fields', Object.keys(checkFields({ maxClose: 1, maxRs: 1, adv: 1, prof: [] }, 170, 85)).length, 0);

done('liquid leaders');

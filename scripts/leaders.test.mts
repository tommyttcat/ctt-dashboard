/* scripts/leaders.test.mts — Liquid Leaders arithmetic (lib/leaders). */

import { expectedCum, trackingPct, profileOf, buildLive, BUCKETS, type LeadersState } from '../src/lib/leaders.ts';
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
], 500, 600, 1, { spy: null, qqq: null });
eq('only universe names count', live.universe, 2);
eq('a close above its 5-year high is a price high', live.priceHigh.map(r => r.t).join(), 'UP');
eq('price / SPY above its best is an RS high', live.rsHigh.map(r => r.t).join(), 'UP');
eq('gainers biggest first', live.gainers.map(r => r.t).join(), 'UP,MID');
eq('4x usual volume reads +300%', live.volume[0].track, 300);
eq('heavy = at least twice usual', live.counts.heavy, 1);
ok('change is a %', Math.abs(live.gainers[0].chg - 6.32) < 0.01);

done('liquid leaders');

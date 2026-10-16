/* scripts/leaders.test.mts — Liquid Leaders arithmetic (lib/leaders). */

import { expectedCum, trackingPct, profileOf, buildLive, chkOf, checkFields, oversoldOf, isLeveragedBull, keyLevelsOf, levelStatusOf, BUCKETS, type LeadersState } from '../src/lib/leaders.ts';
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

// ---- Oversold Bounce (15 Oct 2026): ADR 6-15%, today's low 1.5 ADRs or more under the 5-session high
{
  const chk = (adr: number) => [10, 10, 10, 10, adr, null, null, 0] as any;
  const base = { t: 'X', price: 90, chg: -3, track: null, raw: null };
  const h = (adr: number, wkHi = 100) => ({ maxClose: 200, maxRs: 1, adv: 1, prof: [], chk: chk(adr), wkHi });
  // ADR 8%: level = 100 x (1 - 0.12) = 88.
  eq('low at the level qualifies', oversoldOf(h(8), { t: 'X', price: 90, prevClose: 93, vol: 1, lo: 88 }, base)?.level, 88);
  eq('low above the level does not', oversoldOf(h(8), { t: 'X', price: 90, prevClose: 93, vol: 1, lo: 88.5 }, base), null);
  eq('ADR under 6% does not', oversoldOf(h(5), { t: 'X', price: 80, prevClose: 93, vol: 1, lo: 80 }, base), null);
  eq('ADR over 15% does not', oversoldOf(h(16), { t: 'X', price: 70, prevClose: 93, vol: 1, lo: 70 }, base), null);
  eq('no 5-session high, no row', oversoldOf({ ...h(8), wkHi: undefined }, { t: 'X', price: 90, prevClose: 93, vol: 1, lo: 80 }, base), null);
  const r = oversoldOf(h(8), { t: 'X', price: 88, prevClose: 93, vol: 1, lo: 80 }, base)!;
  eq('off the low, %', r.offLow, 10);
  eq('depth in ADRs (20% under / 8%)', r.deep, 2.5);
  const st: LeadersState = { date: 'd', builtAt: '', names: { A: { ...h(8), prof }, B: { ...h(8), prof }, C: { ...h(8), prof } } };
  const lv = buildLive(st, [
    { t: 'A', price: 85, prevClose: 95, vol: 1, lo: 84 },   // +1.2% off the low
    { t: 'B', price: 88, prevClose: 95, vol: 1, lo: 80 },   // +10% off the low
    { t: 'C', price: 99, prevClose: 99, vol: 1, lo: 98 },   // not oversold
  ], 500, 600, 1, { spy: null, qqq: null });
  eq('sorted by bounce off the low (TopD)', lv.oversold!.map(x => x.t).join(), 'B,A');
  eq('count', lv.counts.oversold, 2);
}
// ---- Leveraged bull ETFs (15 Oct 2026)
for (const n of ['Direxion Daily Semiconductor Bull 3X Shares', 'ProShares UltraPro QQQ', 'GraniteShares 2x Long NVDA Daily ETF', 'T-Rex 2X Long MSTR Daily Target ETF', 'ProShares Ultra Bitcoin ETF', 'Direxion Daily TSLA Bull 2X Shares'])
  ok(`leveraged bull: ${n}`, isLeveragedBull(n));
for (const n of ['Direxion Daily Semiconductor Bear 3X Shares', 'ProShares UltraPro Short QQQ', 'ProShares UltraShort S&P500', 'Direxion Daily S&P 500 Bear 1X Shares', 'SPDR S&P 500 ETF Trust', 'Invesco QQQ Trust', 'Tradr 2X Short TSLA Daily ETF', 'MicroSectors FANG+ -3X Inverse Leveraged ETN'])
  ok(`not leveraged bull: ${n}`, !isLeveragedBull(n));
{
  const chk = [10, 10, 10, 10, 8, null, null, 0] as any;
  const st: LeadersState = { date: 'd', builtAt: '', names: {
    SOXL: { n: 'Direxion Daily Semiconductor Bull 3X Shares', maxClose: 0, maxRs: 0, adv: 1, prof: [], chk, wkHi: 100, etf: true },
    STK: { maxClose: 50, maxRs: 0.01, adv: 1, prof, chk, wkHi: 100 },
  } };
  const lv = buildLive(st, [
    { t: 'SOXL', price: 86, prevClose: 95, vol: 1, lo: 80 },
    { t: 'STK', price: 86, prevClose: 95, vol: 1, lo: 80 },
  ], 500, 600, 1, { spy: null, qqq: null });
  eq('ETF on the oversold list, flagged', lv.oversold!.filter(r => r.etf).map(r => r.t).join(), 'SOXL');
  eq('ETF kept out of the universe count', lv.universe, 1);
  ok('ETF kept out of the Liquid Leaders lists', ![...lv.rsHigh, ...lv.priceHigh, ...lv.gainers, ...lv.volume].some(r => r.t === 'SOXL'));
}
// ---- Key levels + status (16 Oct 2026)
{
  // A dip to 90 at bar 10 (a swing low), an old high at 105 cleared later, last close 110.
  const B = (h: number, l: number, c: number) => ({ h, l, c });
  const bars = [...Array.from({ length: 6 }, () => B(100, 98, 99)), B(99, 95, 96), B(97, 93, 94), B(95, 91, 92), B(94, 90.5, 93), B(93, 90, 92), B(95, 91, 94), B(98, 93, 97), B(101, 96, 100), B(103, 99, 102), B(105, 101, 104),
    B(104, 100, 101), B(103, 99, 100), B(104, 100, 102), B(107, 103, 106), B(109, 105, 108), B(111, 107, 110)];
  const lv = keyLevelsOf(bars);
  ok('key levels under the close, nearest first', lv.length >= 2 && lv[0] > lv[1] && lv.every(x => x < 110));
  ok('the swing low at 90 is a level', lv.includes(90));
  eq('reclaimed: low under a level, price back above', levelStatusOf([100, 90], 101, 99, 8).status, 'reclaimed');
  eq('reclaimed names the level', levelStatusOf([100, 90], 101, 99, 8).key, 100);
  eq('lost: under the nearest level', levelStatusOf([100, 90], 95, 94, 8).status, 'lost');
  eq('testing: within a quarter ADR', levelStatusOf([100, 90], 101, 100.5, 8).status, 'testing');
  eq('holding: above, not near', levelStatusOf([100, 90], 110, 108, 8).status, 'holding');
  eq('no levels = no status', levelStatusOf([], 110, 108, 8).status, null);
}
done('liquid leaders');

/* scripts/leaders.test.mts — Liquid Leaders arithmetic (lib/leaders). */

import { expectedCum, trackingPct, profileOf, buildLive, chkOf, checkFields, oversoldOf, isLeveragedBull, keyLevelsOf, levelStatusOf, liveCnf, osbScoreOf, osbThin, bbSumsOf, bbLowerOf, monisChecksOf, swingOf, gapZonesOf, osbTrendOf, BUCKETS, type LeadersState } from '../src/lib/leaders.ts';
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
    { t: 'A', price: 85, prevClose: 95, vol: 1_200_000, lo: 84 },   // +1.2% off the low
    { t: 'B', price: 88, prevClose: 95, vol: 1_200_000, lo: 80 },   // +10% off the low
    { t: 'C', price: 99, prevClose: 99, vol: 1, lo: 98 },   // not oversold
  ], 500, 600, 1, { spy: null, qqq: null });
  eq('sorted by bounce off the low (TopD)', lv.oversold!.map(x => x.t).join(), 'B,A');
  eq('count', lv.counts.oversold, 2);
}
// ---- Leveraged bull ETFs (15 Oct 2026)
for (const n of ['Direxion Daily Semiconductor Bull 3X Shares', 'ProShares UltraPro QQQ', 'GraniteShares 2x Long NVDA Daily ETF', 'T-Rex 2X Long MSTR Daily Target ETF', 'ProShares Ultra Bitcoin ETF', 'Direxion Daily TSLA Bull 2X Shares', 'Volatility Shares 2x Ether ETF'])
  ok(`leveraged bull: ${n}`, isLeveragedBull(n));
for (const n of ['Direxion Daily Semiconductor Bear 3X Shares', 'ProShares UltraPro Short QQQ', 'ProShares UltraShort S&P500', 'Direxion Daily S&P 500 Bear 1X Shares', 'SPDR S&P 500 ETF Trust', 'Invesco QQQ Trust', 'Tradr 2X Short TSLA Daily ETF', 'MicroSectors FANG+ -3X Inverse Leveraged ETN', '2x Long VIX Futures ETF', 'ProShares Ultra VIX Short-Term Futures ETF'])
  ok(`not leveraged bull: ${n}`, !isLeveragedBull(n));
{
  const chk = [10, 10, 10, 10, 8, null, null, 0] as any;
  const st: LeadersState = { date: 'd', builtAt: '', names: {
    SOXL: { n: 'Direxion Daily Semiconductor Bull 3X Shares', maxClose: 0, maxRs: 0, adv: 1, prof: [], chk, wkHi: 100, etf: true },
    STK: { maxClose: 50, maxRs: 0.01, adv: 1, prof, chk, wkHi: 100 },
  } };
  const lv = buildLive(st, [
    { t: 'SOXL', price: 86, prevClose: 95, vol: 1_200_000, lo: 80 },
    { t: 'STK', price: 86, prevClose: 95, vol: 1_200_000, lo: 80 },
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
// ---- CNF + stage on every row (16 Oct 2026)
{
  const h = { maxClose: 50, maxRs: 0.01, adv: 1000, prof, chk: [95, 90, 89, 80, 6, null, null, 0] as any, stg: '2A' };
  const c = liveCnf(h, { t: 'X', price: 100, prevClose: 96, vol: 3000, o: 97, hi: 101, lo: 96, vw: 98 }, 150, 0.5);
  ok('live CNF is on the 0-100 scale', c != null && c >= 0 && c <= 100);
  eq('no quote, no CNF', liveCnf(h, { t: 'X', price: 0, prevClose: 96, vol: 0 }, null, null), null);
  const st: LeadersState = { date: 'd', builtAt: '', names: { X: h } };
  const lv = buildLive(st, [{ t: 'X', price: 100, prevClose: 96, vol: 3000, o: 97, hi: 101, lo: 96, vw: 98 }], 500, 600, 1, { spy: { price: 500, chg: 0.5 }, qqq: null });
  const row = [...lv.gainers, ...lv.volume, ...lv.rsHigh, ...lv.priceHigh].find(r => r.t === 'X');
  eq('stage carried on the row', row?.stg, '2A');
  ok('CNF carried on the row', typeof row?.cnf === 'number');
}

// OSB score (30 Oct 2026)
{
  const full = osbScoreOf({ status: 'reclaimed', offLow: 10, adr: 8, deep: 3.5, track: 150 });
  eq('OSB: every part maxed is 100', full.score, 100);
  eq('OSB: parts', JSON.stringify(full.sc), JSON.stringify([40, 30, 18, 12]));
  eq('OSB: lost, at the low, at the gate, usual volume is 0', osbScoreOf({ status: 'lost', offLow: 0, adr: 8, deep: 1.5, track: 0 }).score, 0);
  eq('OSB: half an ADR off the low earns 15', osbScoreOf({ status: 'lost', offLow: 4, adr: 8, deep: 1.5, track: 0 }).sc[1], 15);
  eq('OSB: no volume profile scales from 88', osbScoreOf({ status: 'reclaimed', offLow: 8, adr: 8, deep: 3, track: null }).score, 100);
  eq('OSB: reclaimed outranks a deeper lost name', osbScoreOf({ status: 'reclaimed', offLow: 2, adr: 8, deep: 1.6, track: 0 }).score > osbScoreOf({ status: 'lost', offLow: 2, adr: 8, deep: 3, track: 100 }).score, true);
}

// Monis checks (17 Nov 2026)
{
  eq('BB: under 19 closes, no sums', bbSumsOf(Array(18).fill(100)), undefined);
  const flat = bbSumsOf(Array(19).fill(100))!;
  eq('BB: flat closes, band at the price', bbLowerOf(flat, 100), 100);
  /* 19 closes of 100 and today 90: mean 99.5, population SD sqrt(4.75)=2.179, lower 95.14 */
  eq('BB: lower band with today as the 20th close', bbLowerOf(flat, 90), 95.14);
  eq('BB: no sums, null', bbLowerOf(undefined, 90), null);
  const base = { lo: 90, price: 92, bbLo: 95.14, gap: -2, etf: false };
  /* The original three, by key (25 Nov 2026 added stretch / gap region / lower low between them). */
  const pass = (r: object, ...e: (string | null | undefined)[]) => monisChecksOf({ ...base, ...r } as never, e.length ? e[0] : null, '2026-11-17', '2026-11-18').filter(c => ['bb', 'gap', 'earn'].includes(c.key)).map(c => c.pass).join();
  eq('all three pass', pass({}), 'true,true,true');
  eq('inside the band fails BB', pass({ lo: 96 }), 'false,true,true');
  eq('gap up 0.5% fails', pass({ gap: 0.5 }), 'true,false,true');
  eq('earnings today fails', pass({}, '2026-11-17'), 'true,true,false');
  eq('earnings next session fails', pass({}, '2026-11-18'), 'true,true,false');
  eq('earnings later passes', pass({}, '2026-11-24'), 'true,true,true');
  eq('calendar not loaded, unknown', pass({}, undefined), 'true,true,');
  eq('no band yet, unknown', pass({ bbLo: null }), ',true,true');
  const h = { maxClose: 0, maxRs: 0, adv: 1, prof: [], chk: [0, 0, 0, 0, 8, null, null] as never, wkHi: 100, bb: flat };
  const b = { t: 'X', price: 0, chg: 0, track: null, raw: null };
  const r1 = oversoldOf(h, { t: 'X', price: 90, prevClose: 92, vol: 1, lo: 88, o: 93 }, b)!;
  eq('gap from the open', r1.gap, 1.09);
  eq('BB lower on the row', r1.bbLo, 95.14);
  const r2 = oversoldOf(h, { t: 'X', price: 90, prevClose: 92, vol: 1, lo: 88 }, b)!;
  eq('no open: pre-market gap from the price', `${r2.gap},${r2.gapPre}`, '-2.17,true');
}

// Monis checklist part 2 (25 Nov 2026): stretch, gap region, lower low, trend
{
  // 5 flat-ish bars, a gap up (prior high 80, gap-day low 82), a rally to 100, a 10-bar slide with no bounce.
  const bars: { h: number; l: number; c: number }[] = [];
  for (let i = 0; i < 5; i++) bars.push({ h: 78 + i * 0.5, l: 76 + i * 0.5, c: 77 + i * 0.5 });
  bars[4].h = 80;
  bars.push({ h: 86, l: 82, c: 85 });
  for (let i = 0; i < 8; i++) bars.push({ h: 88 + i * 1.5, l: 86 + i * 1.5, c: 87 + i * 1.5 });
  for (let i = 0; i < 10; i++) { const top = 99 - i * 1.8; bars.push({ h: top + 1, l: top - 1.5, c: top - 1 }); }
  eq('swing: high, no bounce, 10-day low', swingOf(bars, 5)?.join(), '100,0,81.3');
  const bounced = [...bars.slice(0, -1), { h: 90, l: 81.5, c: 89 }];
  eq('swing: a 1-ADR close off the low is a bounce', swingOf(bounced, 5)?.[1], 1);
  eq('gap zone open under the close', JSON.stringify(gapZonesOf(bars)), '[[80,82]]');
  eq('gap zone filled to the bottom is dropped', JSON.stringify(gapZonesOf([...bars, { h: 82, l: 79.5, c: 81 }])), '[]');
  const base = { lo: 81, price: 83, bbLo: 82, gap: -1, etf: false, adr: 5, swDrop: 3.8, swBounced: false, lo10: 81.3, gz: [[80, 82]] as [number, number][] };
  const ck = (r: object) => monisChecksOf({ ...base, ...r } as never, null, '2026-11-25', '2026-11-27').filter(c => ['stretch', 'gapz', 'll'].includes(c.key)).map(c => c.pass).join();
  eq('all three new checks pass', ck({}), 'true,true,true');
  eq('under 3 ADRs is not stretched', ck({ swDrop: 2.5 }), 'false,true,true');
  eq('already bounced fails stretch', ck({ swBounced: true }), 'false,true,true');
  eq('low above the gap fails gap region', ck({ lo: 83, swDrop: 3.4 }), 'true,false,false');
  eq('higher low fails lower low', ck({ lo10: 80.5 }), 'true,true,false');
  eq('no nightly inputs, unknown', ck({ swDrop: null, gz: undefined, lo10: null }), ',,');
  eq('six checks in all', monisChecksOf(base as never, null, '2026-11-25', '2026-11-27').length, 6);
  eq('trend: bearish under a falling 21', osbTrendOf([10, 12, 12.5, 15, 8, null, null] as never, 11), 'bear');
  eq('trend: bullish over a rising 21', osbTrendOf([13, 12, 11.8, 10, 8, null, null] as never, 14), 'bull');
}

// $10M dollar-volume floor (17 Nov 2026)
{
  eq('thin after 10:00 is dropped', osbThin({ dvol: 9e6, vol: 2e6 }, 600), true);
  eq('$10M and 1M shares after 10:00 stays', osbThin({ dvol: 10e6, vol: 1e6 }, 600), false);
  eq('$10M but under 1M shares is dropped', osbThin({ dvol: 50e6, vol: 999_999 }, 600), true);
  eq('thin before 10:00 stays', osbThin({ dvol: 1e6, vol: 1 }, 599), false);
  eq('no dollars after 10:00 is dropped', osbThin({}, 700), true);
  const h = { maxClose: 0, maxRs: 0, adv: 1, prof: [], chk: [0, 0, 0, 0, 8, null, null] as never, wkHi: 100 };
  const st: LeadersState = { date: 'd', builtAt: '', names: { A: h, B: h } };
  const q = (t: string, vol: number) => ({ t, price: 90, prevClose: 92, vol, lo: 88, o: 91 });
  const st3: LeadersState = { date: 'd', builtAt: '', names: { A: h, B: h, C: h } };
  const at = (m: number) => buildLive(st3, [q('A', 1_200_000), q('B', 50_000), { ...q('C', 900_000), price: 90 }], 500, m, 1, { spy: null, qqq: null });
  eq('10:30: thin B left off', at(630).oversold!.map(r => r.t).join(), 'A');
  eq('10:30: counted (kept, left off, under $10M, under 1M shares)', [at(630).counts.oversold, at(630).counts.thinOsb, at(630).counts.thinDvol, at(630).counts.thinShr].join(), '1,2,1,2');
  eq('9:50: all kept', at(590).oversold!.length, 3);
  eq('dollars on the row', at(630).oversold![0].dvol, 108_000_000);
}
done('liquid leaders');

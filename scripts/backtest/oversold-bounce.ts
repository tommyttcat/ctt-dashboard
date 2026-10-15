// scripts/backtest/oversold-bounce.ts — Monis-style oversold bounce.
//
// Run from trade-dash:  LONG=1 npx tsx scripts/backtest/oversold-bounce.ts
// Local bars only (backtest-data/grouped[_fmp]), no network, no KV. Streams one
// session at a time, so no big heap is needed.
//
// 15 Oct 2026: the owner wants an oversold-bounce card modelled on Monis
// (x.com/mmonis). His rules, from his own posts: a small universe of liquid,
// well-known, high-ADR names (6%+, not 15%+); oversold = down more than 1.5x the
// 20-day ADR from the week's high; buy at a key level near the low of the day;
// stop about half an ADR under the buy; take the day-trade bounce and leave a
// runner. He reports ~70% wins on the day trades. Judged on its own numbers —
// the owner does not want it compared with QQQ.
//
// RULES — fixed 15 Oct 2026 BEFORE running.
//   Universe on day d, from the 20 sessions BEFORE d: last close $10+, average
//     dollar volume $100M+, ADR (mean of high/low - 1) 6% to 15%.
//   Level = highest high of the 5 sessions before d, less 1.5 ADR.
//   Fill on day d: opens above the level and trades down to it -> bought AT the
//     level; opens at or below it (gap into oversold) -> bought at the open.
//     One trade per ticker per 5 sessions.
//   Stop = buy less 0.5 ADR. Daily bars cannot order the low against the fill,
//     so a stop is counted as HIT whenever the day's low reaches it — the
//     pessimistic reading.
//   Exits (each reported):
//     DAY   sell at d's close                       (his day trade)
//     DAY+S same, stopped out first if the low reaches the stop
//     RUN   half at d's close, half at the close 5 sessions later (his runner)
//     H1/H3/H5  hold to the close 1 / 3 / 5 sessions later
//   Costs: 0.10% round trip off every trade.
//   Baseline: the same universe, every day, bought at the open and sold at the
//     close — what a day trade in these names paid with no signal at all.
//   Split: 2015-2020 / 2021 on (Polygon era), plus per year.
//   Account: DAY and DAY+S, up to 5 fills a day (deepest in ADRs first) at 20%
//     of equity each, compounded daily.
//   PASS (DAY): average after costs above zero AND above the baseline in BOTH
//     halves, win rate 50%+, 200+ trades. The key-level judgement and the
//     near-the-low timing cannot be replayed on daily bars — the test is the
//     mechanical core only.

import { listSessions, readDay } from './cache';

const COST = 0.001;
const CUT = '2021-01-01';
const MAX_FILLS = 5, SLOT = 0.2;

type Hist = { h: number[]; l: number[]; c: number[]; v: number[] };
type Open = { t: string; d: number; entry: number; dayRet: number; dayStopRet: number; depth: number; closes: number[]; keys?: string[] };
type Stat = { n: number; sum: number; wins: number };
const stat = (): Stat => ({ n: 0, sum: 0, wins: 0 });
const add = (s: Stat, r: number) => { s.n++; s.sum += r; if (r > 0) s.wins++; };
const fmt = (s: Stat) => s.n ? `${(100 * s.sum / s.n).toFixed(2).padStart(6)}%  win ${(100 * s.wins / s.n).toFixed(0).padStart(3)}%  n ${s.n}` : 'n 0';

function main() {
  const sessions = listSessions();
  const hist = new Map<string, Hist>();
  const lastTrade = new Map<string, number>();
  const open: Open[] = [];
  const EXITS = ['DAY', 'DAY+S', 'RUN', 'H1', 'H3', 'H5'] as const;
  const by: Record<string, Record<string, Stat>> = {};
  const bucket = (k: string) => (by[k] ??= Object.fromEntries(EXITS.concat(['BASE' as any]).map(e => [e, stat()])));
  const spy: number[] = [];
  let eqDay = 1, eqStop = 1, peakDay = 1, peakStop = 1, ddDay = 0, ddStop = 0;
  const yearsSeen = new Set<string>();
  /* Baseline for the 5-day hold (also post-hoc): every universe name, d's open to the close 5 sessions on. */
  let baseOpen: { t: string; d: number; o: number; keys: string[] }[] = [];
  /* POST-HOC split added after the first run (2020 carried every hold): the market washout
     reading (share of stocks above their 40-day, as panic.ts), from the session before d. */
  const c40 = new Map<string, number[]>();
  let washPrev: number | null = null;

  for (let d = 0; d < sessions.length; d++) {
    const date = sessions[d], year = date.slice(0, 4), half = date < CUT ? '2015-2020' : '2021-on';
    yearsSeen.add(year);
    const rows = readDay('adj', date);
    const today = new Map<string, number>();
    for (const r of rows) if (r[4] > 0) today.set(r[0], r[4]);
    const spyRow = rows.find(r => r[0] === 'SPY'); if (spyRow) spy.push(spyRow[4]);
    const spyUp = spy.length > 201 ? spy[spy.length - 2] > spy.slice(-201, -1).reduce((a, b) => a + b, 0) / 200 : null;
    const regime = spyUp == null ? null : spyUp ? 'SPY>200d' : 'SPY<200d';
    const wash = washPrev == null ? null : washPrev <= 20 ? 'WASHOUT<=20' : 'not washed';
    {
      let above = 0, total = 0;
      for (const r of rows) { const c = r[4]; if (!(c > 0)) continue; let h = c40.get(r[0]); if (!h) { h = []; c40.set(r[0], h); } h.push(c); if (h.length > 41) h.shift(); if (h.length < 41) continue; let s = 0; for (let i = 1; i < 41; i++) s += h[i]; total++; if (c > s / 40) above++; }
      washPrev = total >= 100 ? (100 * above) / total : null;
    }

    // Resolve open trades whose hold has reached today.
    for (let i = open.length - 1; i >= 0; i--) {
      const o = open[i], c = today.get(o.t);
      if (c != null) o.closes.push(c);
      const held = d - o.d;
      if (held >= 5) {
        const at = (k: number) => (o.closes[k - 1] ?? o.closes[o.closes.length - 1] ?? o.entry) / o.entry - 1 - COST;
        const yr = sessions[o.d].slice(0, 4), hf = sessions[o.d] < CUT ? '2015-2020' : '2021-on';
        for (const k of [yr, hf, 'ALL', ...(o.keys ?? [])]) {
          const b = bucket(k);
          add(b.RUN, 0.5 * o.dayRet + 0.5 * at(5));
          add(b.H1, at(1)); add(b.H3, at(3)); add(b.H5, at(5));
        }
        open.splice(i, 1);
      }
    }

    baseOpen = baseOpen.filter(x => {
      if (d - x.d < 5) return true;
      const c = today.get(x.t);
      if (c != null) for (const k of x.keys) add(bucket(k).BASE5 ??= stat(), c / x.o - 1 - COST);
      return false;
    });

    // Today's fills, judged on the 20 sessions before today.
    const fills: { t: string; entry: number; dayRet: number; dayStopRet: number; depth: number }[] = [];
    for (const r of rows) {
      const [t, o, h, l, c, v] = r;
      const H = hist.get(t);
      if (H && H.c.length >= 20 && o > 0 && c > 0) {
        const n = H.c.length, prevC = H.c[n - 1];
        let adr = 0, dv = 0;
        for (let i = n - 20; i < n; i++) { adr += H.h[i] / H.l[i] - 1; dv += H.c[i] * H.v[i]; }
        adr /= 20; dv /= 20;
        if (prevC >= 10 && dv >= 100e6 && adr >= 0.06 && adr <= 0.15) {
          const baseRet = c / o - 1 - COST;
          baseOpen.push({ t, d, o, keys: [half, 'ALL', ...(wash ? [wash] : [])] });
          for (const k of [year, half, 'ALL', ...(regime ? [regime] : []), ...(wash ? [wash] : [])]) add(bucket(k).BASE, baseRet);
          const wk = Math.max(...H.h.slice(-5));
          const level = wk * (1 - 1.5 * adr);
          const recent = lastTrade.get(t);
          if (l <= level && (recent == null || d - recent >= 5)) {
            const entry = o <= level ? o : level;
            const stop = entry * (1 - 0.5 * adr);
            const dayRet = c / entry - 1 - COST;
            const dayStopRet = (l <= stop ? stop / entry - 1 : c / entry - 1) - COST;
            const depth = (wk - entry) / wk / adr;
            fills.push({ t, entry, dayRet, dayStopRet, depth });
            lastTrade.set(t, d);
            const keys = [...(regime ? [regime] : []), ...(wash ? [wash, `${wash} ${year}`] : [])];
            for (const k of [year, half, 'ALL', ...keys]) { add(bucket(k).DAY, dayRet); add(bucket(k)['DAY+S'], dayStopRet); }
            open.push({ t, d, entry, dayRet, dayStopRet, depth, closes: [], keys } as Open);
          }
        }
      }
      // Roll the history (after judging today, so today never feeds its own signal).
      if (!(h > 0 && l > 0 && c > 0)) continue;
      let X = hist.get(t); if (!X) { X = { h: [], l: [], c: [], v: [] }; hist.set(t, X); }
      X.h.push(h); X.l.push(l); X.c.push(c); X.v.push(v);
      if (X.c.length > 25) { X.h.shift(); X.l.shift(); X.c.shift(); X.v.shift(); }
    }

    // Account: up to 5 fills, deepest first, 20% each.
    fills.sort((a, b) => b.depth - a.depth);
    const take = fills.slice(0, MAX_FILLS);
    if (take.length) {
      eqDay *= 1 + take.reduce((s, f) => s + SLOT * f.dayRet, 0);
      eqStop *= 1 + take.reduce((s, f) => s + SLOT * f.dayStopRet, 0);
      peakDay = Math.max(peakDay, eqDay); peakStop = Math.max(peakStop, eqStop);
      ddDay = Math.min(ddDay, eqDay / peakDay - 1); ddStop = Math.min(ddStop, eqStop / peakStop - 1);
    }
  }

  const yrs = (Date.parse(sessions[sessions.length - 1]) - Date.parse(sessions[0])) / (365.25 * 864e5);
  console.log(`Sessions ${sessions[0]} .. ${sessions[sessions.length - 1]} (${yrs.toFixed(1)} years)\n`);
  const order = ['ALL', '2015-2020', '2021-on', 'SPY>200d', 'SPY<200d', 'WASHOUT<=20', 'not washed', ...[...yearsSeen].sort(), ...[...yearsSeen].sort().map(y => `WASHOUT<=20 ${y}`)];
  for (const e of [...EXITS, 'BASE', 'BASE5']) {
    console.log(`== ${e}`);
    for (const k of order) if (by[k]?.[e]) console.log(`  ${k.padEnd(10)} ${fmt(by[k][e])}`);
  }
  const cagr = (x: number) => `${((Math.pow(x, 1 / yrs) - 1) * 100).toFixed(1)}%/yr`;
  console.log(`\nAccount (5 x 20%, day trades only):`);
  console.log(`  DAY    x${eqDay.toFixed(2)}  ${cagr(eqDay)}  max drawdown ${(ddDay * 100).toFixed(1)}%`);
  console.log(`  DAY+S  x${eqStop.toFixed(2)}  ${cagr(eqStop)}  max drawdown ${(ddStop * 100).toFixed(1)}%`);
}

main();

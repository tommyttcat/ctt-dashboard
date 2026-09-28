// scripts/backtest/portfolio.ts — one account trading the scans, with real limits.
//
// Run from trade-dash:  npx tsx scripts/backtest/portfolio.ts
// Writes CTT/backtest-data/replay/portfolio_results.json
// Local bars only — no network, no KV.
//
// Every other backtest here scores each pick on its own. An account cannot
// take 12,000 trades: it has ten slots, a cash balance and a losing streak.
// This asks whether the parts that measured positive make money TOGETHER.
//
// RULES — fixed 24 Sep 2026 BEFORE any portfolio result was read.
//   Universe   green rows only, each scan judged by its own edge.ts function:
//                Stocks in Play + Daily (edgeTier), next-open entry
//                Swing Candidates (swingTier), next-open entry
//                EP9M final list (ep9mTier), pullback to the EP-day midpoint
//                in sessions 2-10 (the entry the card ships)
//              10/21, Hidden RS, VCP and 100-Bagger are left out.
//   Stop       card stop (plan stop, else the signal-day low; EP9M = EP-day
//              low). FLOOR variant: never closer than one ADR below the fill.
//              A gap through the stop exits at the open. Entry-day touches of
//              the stop count as stopped (daily bars cannot order them).
//   Exit       SHIP variant: the card's own exit — trail the 21 EMA (Stocks in
//              Play, Daily, Swing), 10 EMA (EP9M), first close below it from
//              day 2. HOLD20 variant: close of session 20. Both capped at 60.
//   Regime     ON variant: new entries only when SPY closed above its 50- and
//              200-day on the signal day (the scorecard's "risk-on" is not
//              replayable, so this is the stand-in).
//   Account    $100,000. Risk 0.5% of equity (prior close) per trade; no
//              position above 20% of equity; no margin; at most 10 open.
//              One position per ticker. Slots freed by a same-day exit are not
//              reused until the next open.
//   Ranking    more candidates than slots: RS rating, highest first.
//   Costs      0.10% slippage each side on every fill. No commissions.
//   Split      first two-thirds of sessions vs last third, as every other
//              backtest in this folder.
//
// The green-row rules were themselves chosen on this same five-year data, so
// the universe is in-sample. The halves test stability, not a fresh period;
// the live /track record is the only out-of-sample test.

import fs from 'node:fs';
import path from 'node:path';
import { DATA, loadAdjusted, type BarCache } from './cache';
import { ema } from '@/lib/indicators/marketMath';
import { edgeTier, swingTier, ep9mTier } from '@/lib/scans/edge';

const REPLAY = path.join(DATA, 'replay');
const START = '2022-09-26';          // first date every included scan has rows
const HOLD = 60;
const MIN_RISK_PCT = 0.5;
const RISK = 0.005, MAX_POS = 10, MAX_WEIGHT = 0.2, EQUITY0 = 100_000;
const SLIP = Number(process.env.SLIP ?? 0.001);   // SLIP=0.0025 for the cost-stress run

type Scan = 'scanner' | 'swing' | 'ep9m';
interface Cand {
  scan: Scan; ticker: string; id: number; s: number; ei: number;
  fill: number; cardStop: number; adrPct: number | null;
  tier: string | null; rs: number; riskOn: boolean;
  /** Intraday entries only: the lowest print AFTER the fill on the entry day. */
  postFillLow?: number;
  /** Stockbee TI65 on the signal day: avg close 7 / avg close 65. */
  ti65?: number | null;
}
interface Trade { c: Cand; stop: number; xi: number; xpx: number; how: string }

const read = (f: string) => fs.readFileSync(path.join(REPLAY, f), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const firstBar = (c: BarCache, id: number, from: number, to: number) => {
  for (let j = from; j <= to && j < c.sessions.length; j++) if (!Number.isNaN(c.C[id][j])) return j;
  return -1;
};

function candidates(c: BarCache): Cand[] {
  const { O, H, L, C, idOf } = c;
  const out: Cand[] = [];
  const push = (scan: Scan, e: any, ei: number, fill: number, cardStop: number, tier: string | null) => {
    if (ei < 0 || !(fill > cardStop)) return;
    out.push({
      scan, ticker: e.ticker, id: idOf.get(e.ticker)!, s: e.sIdx, ei, fill, cardStop,
      adrPct: typeof e.adrPct === 'number' ? e.adrPct : null, tier,
      rs: typeof e.rsRating === 'number' ? e.rsRating : -1,
      riskOn: e.spyAbove50 === true && e.spyAbove200 === true,
    });
  };

  for (const e of read('scanner_registry.jsonl')) {
    const id = idOf.get(e.ticker); if (id === undefined || e.date < START) continue;
    const ei = firstBar(c, id, e.sIdx + 1, e.sIdx + 5); if (ei < 0) continue;
    const stop = e.plan?.tradeable && e.plan.stop != null ? e.plan.stop : e.dayLow;
    push('scanner', e, ei, O[id][ei], stop, edgeTier(e));
  }
  for (const e of read('swing_registry.jsonl')) {
    const id = idOf.get(e.ticker); if (id === undefined || e.date < START) continue;
    const ei = firstBar(c, id, e.sIdx + 1, e.sIdx + 5); if (ei < 0) continue;
    const stop = (e.plan?.tradeable ? e.plan?.stop : null) ?? e.dayLow;
    push('swing', e, ei, O[id][ei], stop, swingTier(e));
  }
  for (const e of read('ep9m_v2_registry.jsonl')) {
    if (!e.inFinal || e.date < START) continue;
    const id = idOf.get(e.ticker); if (id === undefined) continue;
    const s = e.sIdx, epLow = L[id][s], mid = (H[id][s] + epLow) / 2;
    let ei = -1, fill = 0, seen = 0;
    for (let j = s + 1; j <= s + 10 && j < c.sessions.length; j++) {
      if (Number.isNaN(C[id][j])) continue;
      seen++;
      if (seen >= 2 && L[id][j] <= mid && O[id][j] > epLow) { ei = j; fill = Math.min(mid, O[id][j]); break; }
      if (C[id][j] < epLow) break;
    }
    push('ep9m', e, ei, fill, epLow, ep9mTier(e));
  }
  // TI65 as of the signal day's close (known before the entry).
  for (const k of out) {
    const cl: number[] = [];
    for (let j = k.s; j >= 0 && cl.length < 65; j--) if (!Number.isNaN(C[k.id][j])) cl.push(C[k.id][j]);
    k.ti65 = cl.length >= 65 ? (cl.slice(0, 7).reduce((a, x) => a + x, 0) / 7) / (cl.reduce((a, x) => a + x, 0) / 65) : null;
  }
  return out;
}

/** Walk one position forward. Same stop/gap/ambiguity rules as simulate.ts. */
function walk(c: BarCache, k: Cand, floor: boolean, exit: 'ship' | 'hold20' | 'hold20run' | 'sma10x3'): Trade {
  const { O, H, L, C } = c; void H;
  const N = c.sessions.length;
  let stop = k.cardStop;
  if (floor && k.adrPct != null) stop = Math.min(stop, k.fill * (1 - k.adrPct / 100));
  if (k.fill - stop < k.fill * MIN_RISK_PCT / 100) stop = k.fill * (1 - MIN_RISK_PCT / 100);
  const len = k.scan === 'ep9m' ? 10 : 21;
  const hist: number[] = [];
  for (let j = Math.max(0, k.s - 300); j < k.ei; j++) if (!Number.isNaN(C[k.id][j])) hist.push(C[k.id][j]);
  const last = Math.min(N - 1, k.ei + HOLD - 1);
  let day = 0, lastJ = k.ei, lastC = k.fill, below10 = 0;
  for (let j = k.ei; j <= last; j++) {
    if (Number.isNaN(C[k.id][j])) continue;
    day++; lastJ = j; lastC = C[k.id][j];
    hist.push(lastC);
    const lo = j === k.ei && k.postFillLow != null ? k.postFillLow : L[k.id][j];
    if (lo <= stop) return { c: k, stop, xi: j, xpx: j === k.ei ? stop : Math.min(stop, O[k.id][j]), how: 'stop' };
    if (exit === 'hold20') { if (day >= 20) return { c: k, stop, xi: j, xpx: lastC, how: 'time' }; }
    else if (exit === 'sma10x3') {
      // Stockbee: out on the close of the 3rd straight close under the 10-day SMA.
      if (hist.length >= 10) {
        const sma10 = hist.slice(-10).reduce((a, x) => a + x, 0) / 10;
        below10 = lastC < sma10 ? below10 + 1 : 0;
        if (below10 >= 3) return { c: k, stop, xi: j, xpx: lastC, how: 'time' };
      }
    }
    else if (exit === 'hold20run') {
      // From day 20, sell only on a close under the 21 EMA — a winner keeps running.
      if (day >= 20) { const e = ema(hist, 21); if (e == null || lastC < e) return { c: k, stop, xi: j, xpx: lastC, how: 'time' }; }
    }
    else if (day >= 2) { const e = ema(hist, len); if (e != null && lastC < e) return { c: k, stop, xi: j, xpx: lastC, how: 'ema' }; }
  }
  // Ran out of window, or out of data (still open at the end of the test).
  return { c: k, stop, xi: last >= N - 1 && day < HOLD ? Infinity : lastJ, xpx: lastC, how: last >= N - 1 && day < HOLD ? 'open' : 'time' };
}

interface Opts { name: string; floor: boolean; exit: 'ship' | 'hold20' | 'hold20run' | 'sma10x3'; regime: boolean; greenOnly: boolean; seed?: number; sweep?: boolean; rankBy?: 'rs' | 'ti65';
  scans?: Scan[]; swingFirst?: boolean; riskByScan?: Partial<Record<Scan, number>> }

/* Deterministic PRNG for the ranking-luck check (mulberry32). */
const rng = (seed: number) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

function run(c: BarCache, cands: Cand[], o: Opts) {
  const { C, sessions } = c;
  const t0 = sessions.indexOf(sessions.find(d => d >= START)!);
  const T = sessions.length;
  const byEntry = new Map<number, Trade[]>();
  for (const k of cands) {
    if (o.greenOnly && k.tier !== 'green') continue;
    if (o.regime && !k.riskOn) continue;
    if (k.ei < t0) continue;
    if (o.scans && !o.scans.includes(k.scan)) continue;
    const tr = walk(c, k, o.floor, o.exit);
    (byEntry.get(k.ei) ?? byEntry.set(k.ei, []).get(k.ei)!).push(tr);
  }

  type Pos = { tr: Trade; sh: number; cost: number; mark: number };
  let cash = EQUITY0, equity = EQUITY0;
  const open: Pos[] = [];
  const closed: { scan: Scan; r: number; pnl: number; entry: string; exit: string; how: string; ticker: string }[] = [];
  const curve: { d: string; eq: number; n: number; x: number }[] = [];
  let skippedFull = 0;
  const spy = c.idOf.get('SPY')!;
  const rand = o.seed != null ? rng(o.seed) : null;

  for (let t = t0; t < T; t++) {
    // 1. Entries at the open, sized off yesterday's close.
    /* Swing-first puts every Swing buy ahead of the rest; within a class the
       order is RS, or random for the ranking-luck check. */
    const cls = (x: Trade) => (o.swingFirst && x.c.scan === 'swing' ? 0 : 1);
    const todays = rand
      ? (byEntry.get(t) ?? []).map(x => [cls(x), rand(), x] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(x => x[2])
      : (byEntry.get(t) ?? []).sort((a, b) => cls(a) - cls(b) || (o.rankBy === 'ti65' ? (b.c.ti65 ?? -1) - (a.c.ti65 ?? -1) : b.c.rs - a.c.rs));
    for (const tr of todays) {
      if (open.length >= MAX_POS) { skippedFull++; continue; }
      if (open.some(p => p.tr.c.ticker === tr.c.ticker)) continue;
      const px = tr.c.fill * (1 + SLIP);
      const perSh = tr.c.fill - tr.stop;
      let sh = Math.floor(((o.riskByScan?.[tr.c.scan] ?? RISK) * equity) / perSh);
      sh = Math.min(sh, Math.floor((MAX_WEIGHT * equity) / px), Math.floor(cash / px));
      if (sh <= 0) continue;
      cash -= sh * px;
      open.push({ tr, sh, cost: px, mark: tr.c.fill });
    }
    // 2. Exits during/at the close of the session.
    for (let i = open.length - 1; i >= 0; i--) {
      const p = open[i];
      const cl = C[p.tr.c.id][t];
      if (!Number.isNaN(cl)) p.mark = cl;
      if (p.tr.xi === t) {
        const px = p.tr.xpx * (1 - SLIP);
        cash += p.sh * px;
        closed.push({
          scan: p.tr.c.scan, ticker: p.tr.c.ticker, how: p.tr.how,
          r: (px - p.cost) / (p.tr.c.fill - p.tr.stop), pnl: p.sh * (px - p.cost),
          entry: sessions[p.tr.c.ei], exit: sessions[t],
        });
        open.splice(i, 1);
      }
    }
    /* SWEEP: idle cash sits in SPY instead of earning nothing. Applied to the
       balance left after today's entries, close to close — an approximation
       that ignores SPY's own trading costs (a few basis points a year). */
    if (o.sweep && t > t0) cash *= C[spy][t] / C[spy][t - 1];
    // 3. Mark to market.
    const invested = open.reduce((a, p) => a + p.sh * p.mark, 0);
    equity = cash + invested;
    curve.push({ d: sessions[t], eq: equity, n: open.length, x: invested / equity });
  }
  return { curve, closed, openAtEnd: open.length, skippedFull };
}

function stats(curve: { d: string; eq: number; n: number; x?: number }[], closed: { r: number; pnl: number; exit: string }[]) {
  const eq0 = curve[0].eq, eq1 = curve[curve.length - 1].eq;
  const years = curve.length / 252;
  let peak = -Infinity, mdd = 0, ddStart = 0, longest = 0;
  curve.forEach((p, i) => {
    if (p.eq >= peak) { peak = p.eq; longest = Math.max(longest, i - ddStart); ddStart = i; }
    mdd = Math.min(mdd, p.eq / peak - 1);
  });
  longest = Math.max(longest, curve.length - 1 - ddStart);
  const rs = closed.map(x => x.r);
  const wins = rs.filter(r => r > 0);
  let streak = 0, worst = 0;
  for (const r of rs) { streak = r > 0 ? 0 : streak + 1; worst = Math.max(worst, streak); }
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  return {
    returnPct: +((eq1 / eq0 - 1) * 100).toFixed(1),
    cagrPct: +((Math.pow(eq1 / eq0, 1 / years) - 1) * 100).toFixed(1),
    maxDdPct: +(mdd * 100).toFixed(1),
    longestDdSessions: longest,
    trades: rs.length,
    winPct: +(100 * wins.length / (rs.length || 1)).toFixed(1),
    avgR: +mean(rs).toFixed(3),
    avgWinR: +mean(wins).toFixed(2),
    avgLossR: +mean(rs.filter(r => r <= 0)).toFixed(2),
    worstLosingStreak: worst,
    avgOpen: +mean(curve.map(p => p.n)).toFixed(1),
    avgInvestedPct: +(100 * mean(curve.map(p => (p as { x?: number }).x ?? 1))).toFixed(0),
  };
}

/** Next-open signals re-entered by an intraday rule (scripts/backtest/intraday.ts). */
function intradayCands(c: BarCache, entry: string, file = 'intraday_entries.jsonl'): Cand[] {
  const rows = read(file);
  const out: Cand[] = [];
  for (const r of rows) {
    const e = r.entries?.[entry];
    const id = c.idOf.get(r.ticker);
    if (!e || id === undefined) continue;
    out.push({
      scan: r.scan, ticker: r.ticker, id, s: r.s, ei: e.ei, fill: e.fill, cardStop: e.stop,
      adrPct: null, tier: 'green', rs: r.rs, riskOn: true, postFillLow: e.postFillLow,
    });
  }
  return out;
}

function intradayMain(c: BarCache) {
  const ep = candidates(c).filter(k => k.scan === 'ep9m');
  const spy = c.idOf.get('SPY')!;
  const s0 = c.sessions.findIndex(d => d >= START);
  const spyCurve = c.sessions.slice(s0).map((d, i) => ({ d, eq: EQUITY0 * c.C[spy][s0 + i] / c.O[spy][s0], n: 1 }));
  const cut = spyCurve[Math.floor(spyCurve.length * 2 / 3)].d;
  const spyAll = stats(spyCurve, []).returnPct;
  const spyH = [stats(spyCurve.filter(p => p.d < cut), []).returnPct, stats(spyCurve.filter(p => p.d >= cut), []).returnPct];
  console.log(`SPY ${spyAll}% (halves ${spyH[0]} / ${spyH[1]})`);
  const base: Opts = { name: '', floor: false, exit: 'hold20', regime: false, greenOnly: true };
  const results: Record<string, unknown> = {};
  const names = process.argv[3] ? process.argv[3].split(',') : ['E0', 'E1', 'E2', 'E3', 'E4'];
  for (const E of names) {
    const ic = intradayCands(c, E);
    // Each trade on its own, before any account limits: is the entry better?
    const solo = ic.map(k => walk(c, k, false, 'hold20')).filter(t => Number.isFinite(t.xi));
    const half = (a: typeof solo, h: 0 | 1) => a.filter(t => (c.sessions[t.c.ei] < cut) === (h === 0));
    const avg = (a: typeof solo, f: (t: Trade) => number) => a.length ? +(a.reduce((x, t) => x + f(t), 0) / a.length).toFixed(3) : null;
    const R = (t: Trade) => (t.xpx - t.c.fill) / (t.c.fill - t.stop);
    const P = (t: Trade) => (t.xpx / t.c.fill - 1) * 100;
    const perTrade = {
      n: solo.length, avgR: avg(solo, R), avgPct: avg(solo, P), winPct: +(100 * solo.filter(t => t.xpx > t.c.fill).length / (solo.length || 1)).toFixed(1),
      halvesR: [avg(half(solo, 0), R), avg(half(solo, 1), R)], halvesPct: [avg(half(solo, 0), P), avg(half(solo, 1), P)],
    };
    const cands = [...ic, ...ep];
    const r = run(c, cands, { ...base, name: E });
    const all = stats(r.curve, r.closed);
    const h1 = stats(r.curve.filter(p => p.d < cut), []), h2 = stats(r.curve.filter(p => p.d >= cut), []);
    const rets: number[] = [];
    for (let seed = 1; seed <= 200; seed++) rets.push(stats(run(c, cands, { ...base, name: E, seed }).curve, []).returnPct);
    rets.sort((a, b) => a - b);
    const med = rets[100];
    const pass = h1.returnPct > spyH[0] && h2.returnPct > spyH[1] && med > spyAll;
    results[E] = { perTrade, account: all, halves: [h1.returnPct, h2.returnPct], randomMedian: med, randomP10: rets[20], randomP90: rets[180], pass };
    console.log(`${E} per-trade n ${perTrade.n} avgR ${perTrade.avgR} (${perTrade.halvesR.join(' / ')}) avg% ${perTrade.avgPct} win ${perTrade.winPct}% | account ${all.returnPct}% dd ${all.maxDdPct}% halves ${h1.returnPct} / ${h2.returnPct} | random median ${med} (p10 ${rets[20]}, p90 ${rets[180]}) ${pass ? 'PASS' : 'fail'}`);
  }
  fs.writeFileSync(path.join(REPLAY, process.argv[3] ? 'portfolio_intraday_sens.json' : 'portfolio_intraday.json'), JSON.stringify(results, null, 1));
}

/* Wider watch list (scripts/backtest/intraday.ts header holds the rules, fixed
   27 Sep 2026 BEFORE the yellow minute bars were downloaded). Yellow rows are
   tagged 'green' here only so the account's green-only gate (which exists for
   the EP9M rows) lets them through; the ranking is RS first as always. */
function widerMain(c: BarCache) {
  const ep = candidates(c).filter(k => k.scan === 'ep9m');
  const spy = c.idOf.get('SPY')!;
  const s0 = c.sessions.findIndex(d => d >= START);
  const spyCurve = c.sessions.slice(s0).map((d, i) => ({ d, eq: EQUITY0 * c.C[spy][s0 + i] / c.O[spy][s0], n: 1 }));
  const cut = spyCurve[Math.floor(spyCurve.length * 2 / 3)].d;
  const base: Opts = { name: '', floor: false, exit: 'hold20', regime: false, greenOnly: true };
  const green = intradayCands(c, 'E2');
  const yellow = intradayCands(c, 'E2', 'intraday_entries_yellow.jsonl');
  const R = (t: Trade) => (t.xpx - t.c.fill) / (t.c.fill - t.stop);
  const solo = (ic: Cand[]) => ic.map(k => walk(c, k, false, 'hold20')).filter(t => Number.isFinite(t.xi));
  const avgR = (a: Trade[]) => a.length ? +(a.reduce((x, t) => x + R(t), 0) / a.length).toFixed(3) : NaN;
  const halvesR = (a: Trade[]) => [0, 1].map(h => avgR(a.filter(t => (c.sessions[t.c.ei] < cut) === (h === 0))));
  const acct = (name: string, ic: Cand[]) => {
    const cands = [...ic, ...ep];
    const r = run(c, cands, { ...base, name });
    const all = stats(r.curve, r.closed);
    const h = [stats(r.curve.filter(p => p.d < cut), []).returnPct, stats(r.curve.filter(p => p.d >= cut), []).returnPct];
    const rets: number[] = [];
    for (let seed = 1; seed <= 200; seed++) rets.push(stats(run(c, cands, { ...base, name, seed }).curve, []).returnPct);
    rets.sort((a, b) => a - b);
    return { account: all.returnPct, dd: all.maxDdPct, halves: h, median: rets[100], trades: r.closed.length };
  };
  const ys = solo(yellow), gs = solo(green);
  const yH = halvesR(ys);
  console.log(`yellow E2 alone: n ${ys.length} avgR ${avgR(ys)} (${yH.join(' / ')}) win ${(100 * ys.filter(t => t.xpx > t.c.fill).length / (ys.length || 1)).toFixed(1)}%`);
  console.log(`green  E2 alone: n ${gs.length} avgR ${avgR(gs)} (${halvesR(gs).join(' / ')})`);
  const g = acct('green', green);
  const gy = acct('green+yellow', [...green, ...yellow.map(k => ({ ...k, tier: 'green' }))]);
  for (const [n, v] of [['green', g], ['green+yellow', gy]] as const) console.log(`${n.padEnd(13)} account ${v.account}% dd ${v.dd}% halves ${v.halves.join(' / ')} random median ${v.median} trades ${v.trades}`);
  const pass = yH.every(x => x > 0) && [0, 1].every(h => gy.halves[h] > g.halves[h]) && gy.median > g.median;
  console.log(`VERDICT (wider): ${pass ? 'PASS — add the yellow tier to the watch' : 'fail — the watch stays green only'}`);
  fs.writeFileSync(path.join(REPLAY, 'portfolio_wider.json'), JSON.stringify({ yellow: { n: ys.length, avgR: avgR(ys), halvesR: yH }, green: g, greenYellow: gy, pass }, null, 1));
}

/* Market-on-the-day filters on the breakout entry (scripts/backtest/
   market-filter.ts holds the rules, fixed 27 Sep 2026 BEFORE running). Every
   variant runs on the same tagged E2 trades; PASS = beats unfiltered E2 on
   per-trade R in both halves, account return in both halves, and the random-
   order median. The trades each filter skips are scored too, for the reading. */
function marketMain(c: BarCache) {
  const tags = JSON.parse(fs.readFileSync(path.join(REPLAY, 'intraday_market_tags.json'), 'utf8')) as Record<string, Record<string, unknown>>;
  const tagOf = (k: Cand) => tags[`${k.ticker}|${c.sessions[k.s]}`];
  const ep = candidates(c).filter(k => k.scan === 'ep9m');
  const spy = c.idOf.get('SPY')!;
  const s0 = c.sessions.findIndex(d => d >= START);
  const spyCurve = c.sessions.slice(s0).map((d, i) => ({ d, eq: EQUITY0 * c.C[spy][s0 + i] / c.O[spy][s0], n: 1 }));
  const cut = spyCurve[Math.floor(spyCurve.length * 2 / 3)].d;
  const base: Opts = { name: '', floor: false, exit: 'hold20', regime: false, greenOnly: true };
  const e2 = intradayCands(c, 'E2').filter(k => tagOf(k));
  const R = (t: Trade) => (t.xpx - t.c.fill) / (t.c.fill - t.stop);
  const avgR = (a: Trade[]) => a.length ? +(a.reduce((x, t) => x + R(t), 0) / a.length).toFixed(3) : null;
  const halvesR = (a: Trade[]) => [0, 1].map(h => avgR(a.filter(t => (c.sessions[t.c.ei] < cut) === (h === 0))));
  const solo = (ic: Cand[]) => ic.map(k => walk(c, k, false, 'hold20')).filter(t => Number.isFinite(t.xi));
  const evalSet = (name: string, ic: Cand[]) => {
    const tr = solo(ic);
    const cands = [...ic, ...ep];
    const r = run(c, cands, { ...base, name });
    const all = stats(r.curve, r.closed);
    const h = [stats(r.curve.filter(p => p.d < cut), []).returnPct, stats(r.curve.filter(p => p.d >= cut), []).returnPct];
    const rets: number[] = [];
    for (let seed = 1; seed <= 200; seed++) rets.push(stats(run(c, cands, { ...base, name, seed }).curve, []).returnPct);
    rets.sort((a, b) => a - b);
    return { n: tr.length, avgR: avgR(tr), halvesR: halvesR(tr), win: +(100 * tr.filter(t => t.xpx > t.c.fill).length / (tr.length || 1)).toFixed(1),
      account: all.returnPct, dd: all.maxDdPct, halves: h, median: rets[100] };
  };
  const b = evalSet('E2', e2);
  console.log(`E2 (all ${b.n}) avgR ${b.avgR} (${b.halvesR.join(' / ')}) win ${b.win}% | account ${b.account}% dd ${b.dd}% halves ${b.halves.join(' / ')} | random median ${b.median}`);
  const results: Record<string, unknown> = { E2: b };
  for (const F of ['F1', 'F2', 'F3', 'F4']) {
    const kept = e2.filter(k => !tagOf(k)[F]);
    const skipped = solo(e2.filter(k => tagOf(k)[F]));
    const v = evalSet(`E2-${F}`, kept);
    const pass = [0, 1].every(h => (v.halvesR[h] ?? -9) > (b.halvesR[h] ?? 9)) && [0, 1].every(h => v.halves[h] > b.halves[h]) && v.median > b.median;
    results[F] = { ...v, skipped: { n: skipped.length, avgR: avgR(skipped), halvesR: halvesR(skipped) }, pass };
    console.log(`${F} kept ${v.n} avgR ${v.avgR} (${v.halvesR.join(' / ')}) win ${v.win}% | account ${v.account}% dd ${v.dd}% halves ${v.halves.join(' / ')} | random median ${v.median} | skipped ${skipped.length} avgR ${avgR(skipped)} (${halvesR(skipped).join(' / ')}) ${pass ? 'PASS' : 'fail'}`);
  }
  fs.writeFileSync(path.join(REPLAY, 'portfolio_market.json'), JSON.stringify(results, null, 1));
}

/* Stockbee ideas, fixed 27 Sep 2026 BEFORE running, against the live Model
   Book v1 rules (green rows, card stop, hold 20, RS first, 10 slots, 0.5%):
     X1   exit on the close of the 3rd straight close under the 10-day SMA
          (card stop kept, 60-session cap). PASS = beats SPY in both halves,
          random-order median beats SPY, AND beats BASE in both halves.
     R1   when buys outnumber slots, highest TI65 (avgC7/avgC65) first
          instead of RS. PASS = beats SPY in both halves, beats BASE (RS
          first) in both halves, AND sits above the 90th percentile of random
          orderings (the random-median test cannot apply: randomising the
          order removes the ranking being tested).
     X1R1 both, reported for information only. */
function stockbeeMain(c: BarCache) {
  const cands = candidates(c);
  const spy = c.idOf.get('SPY')!;
  const s0 = c.sessions.findIndex(d => d >= START);
  const spyCurve = c.sessions.slice(s0).map((d, i) => ({ d, eq: EQUITY0 * c.C[spy][s0 + i] / c.O[spy][s0], n: 1 }));
  const cut = spyCurve[Math.floor(spyCurve.length * 2 / 3)].d;
  const spyAll = stats(spyCurve, []).returnPct;
  const spyH = [stats(spyCurve.filter(p => p.d < cut), []).returnPct, stats(spyCurve.filter(p => p.d >= cut), []).returnPct];
  console.log(`SPY ${spyAll}% (halves ${spyH[0]} / ${spyH[1]}) · ti65 known on ${cands.filter(k => k.ti65 != null).length}/${cands.length} candidates`);
  const base: Opts = { name: 'BASE', floor: false, exit: 'hold20', regime: false, greenOnly: true, rankBy: 'rs' };
  const variants: Opts[] = [base, { ...base, name: 'X1 sma10x3 exit', exit: 'sma10x3' }, { ...base, name: 'R1 TI65 first', rankBy: 'ti65' }, { ...base, name: 'X1R1 both', exit: 'sma10x3', rankBy: 'ti65' }];
  const res: Record<string, any> = {};
  for (const v of variants) {
    const r = run(c, cands, v);
    const all = stats(r.curve, r.closed);
    const h = [stats(r.curve.filter(p => p.d < cut), []).returnPct, stats(r.curve.filter(p => p.d >= cut), []).returnPct];
    const rets: number[] = [];
    for (let seed = 1; seed <= 200; seed++) rets.push(stats(run(c, cands, { ...v, seed }).curve, []).returnPct);
    rets.sort((a, b) => a - b);
    // Per trade, every green candidate on its own (no slots): is the exit itself better?
    const solo = cands.filter(k => k.tier === 'green' && k.ei >= s0).map(k => walk(c, k, false, v.exit)).filter(t => Number.isFinite(t.xi));
    const R = (t: Trade) => (t.xpx - t.c.fill) / (t.c.fill - t.stop);
    const half = (h2: 0 | 1) => solo.filter(t => (c.sessions[t.c.ei] < cut) === (h2 === 0));
    const avg = (a: Trade[]) => a.length ? +(a.reduce((x, t) => x + R(t), 0) / a.length).toFixed(3) : null;
    res[v.name] = { all, halves: h, median: rets[100], p10: rets[20], p90: rets[180], soloR: [avg(half(0)), avg(half(1))], soloN: solo.length, days: +(solo.reduce((x, t) => x + (t.xi - t.c.ei + 1), 0) / (solo.length || 1)).toFixed(1) };
  }
  const B = res.BASE;
  for (const [name, x] of Object.entries(res)) {
    const beatsSpy = x.halves[0] > spyH[0] && x.halves[1] > spyH[1];
    const beatsBase = x.halves[0] > B.halves[0] && x.halves[1] > B.halves[1];
    let verdict = '';
    if (name.startsWith('X1 ')) verdict = beatsSpy && x.median > spyAll && beatsBase ? 'PASS' : 'fail';
    if (name.startsWith('R1 ')) verdict = beatsSpy && beatsBase && x.all.returnPct > x.p90 ? 'PASS' : 'fail';
    console.log(`${name.padEnd(18)} account ${x.all.returnPct}% dd ${x.all.maxDdPct}% halves ${x.halves[0]} / ${x.halves[1]} | trades ${x.all.trades} win ${x.all.winPct}% avgR ${x.all.avgR} | random median ${x.median} (p10 ${x.p10}, p90 ${x.p90}) | per-trade R ${x.soloR.join(' / ')} (n ${x.soloN}, avg ${x.days}d held) ${verdict}`);
  }
  fs.writeFileSync(path.join(REPLAY, 'portfolio_stockbee.json'), JSON.stringify(res, null, 1));
}

/* No-financials rule in the account (rules in scripts/backtest/ep-fundamentals.ts,
   fixed before running): Model Book v1 with EP9M flags that have no recent
   financials removed. PASS = beats the Model Book in both halves AND its
   random-order median beats the Model Book's. */
function nofinMain(c: BarCache) {
  const fin: Record<string, boolean> = JSON.parse(fs.readFileSync(path.join(REPLAY, 'ep9m_fin_flags.json'), 'utf8'));
  const all = candidates(c);
  const kept = all.filter(k => k.scan !== 'ep9m' || fin[`${k.ticker}|${c.sessions[k.s]}`] === true);
  const s0 = c.sessions.findIndex(d => d >= START);
  const spyId = c.idOf.get('SPY')!;
  const spyCurve = c.sessions.slice(s0).map((d, i) => ({ d, eq: EQUITY0 * c.C[spyId][s0 + i] / c.O[spyId][s0], n: 1 }));
  const cut = spyCurve[Math.floor(spyCurve.length * 2 / 3)].d;
  const base: Opts = { name: 'BASE', floor: false, exit: 'hold20', regime: false, greenOnly: true };
  const out: Record<string, { ret: number; dd: number; h: number[]; med: number; p10: number; trades: number; ep: number }> = {};
  for (const [name, cands] of [['Model Book', all], ['+ skip no-financials EP9M', kept]] as const) {
    const r = run(c, cands, { ...base, name });
    const st = stats(r.curve, r.closed);
    const h = [stats(r.curve.filter(p => p.d < cut), []).returnPct, stats(r.curve.filter(p => p.d >= cut), []).returnPct];
    const rets: number[] = [];
    for (let seed = 1; seed <= 200; seed++) rets.push(stats(run(c, cands, { ...base, name, seed }).curve, []).returnPct);
    rets.sort((a, b) => a - b);
    out[name] = { ret: st.returnPct, dd: st.maxDdPct, h, med: rets[100], p10: rets[20], trades: st.trades, ep: r.closed.filter(x => x.scan === 'ep9m').length };
  }
  const [B, N] = [out['Model Book'], out['+ skip no-financials EP9M']];
  for (const [name, x] of Object.entries(out)) console.log(`${name.padEnd(26)} ${x.ret}% dd ${x.dd}% halves ${x.h.join(' / ')} | trades ${x.trades} (EP9M ${x.ep}) | random median ${x.med} (p10 ${x.p10})`);
  console.log(`account part: ${N.h[0] > B.h[0] && N.h[1] > B.h[1] && N.med > B.med ? 'PASS' : 'FAIL'}`);
  console.log(`EP9M candidates removed: ${all.length - kept.length} of ${all.filter(k => k.scan === 'ep9m').length}`);
}

function main() {
  const t0 = Date.now();
  const c = loadAdjusted();
  if (process.argv[2] === 'intraday') { intradayMain(c); return; }
  if (process.argv[2] === 'market') { marketMain(c); return; }
  if (process.argv[2] === 'wider') { widerMain(c); return; }
  if (process.argv[2] === 'stockbee') { stockbeeMain(c); return; }
  if (process.argv[2] === 'nofin') { nofinMain(c); return; }
  const cands = candidates(c);
  const tally = cands.reduce<Record<string, number>>((m, k) => { const key = `${k.scan}:${k.tier}`; m[key] = (m[key] || 0) + 1; return m; }, {});
  console.log('candidates', cands.length, JSON.stringify(tally));

  // SPY buy-and-hold over the same sessions, for scale.
  const spy = c.idOf.get('SPY')!;
  const s0 = c.sessions.findIndex(d => d >= START);
  const spyCurve = c.sessions.slice(s0).map((d, i) => ({ d, eq: EQUITY0 * c.C[spy][s0 + i] / c.O[spy][s0], n: 1 }));

  const variants: Opts[] = [];
  if (process.argv[2] === 'round2') {
    /* Round 2, fixed 25 Sep 2026 before running: four ideas against the live
       Model Book rules (card stop, hold 20, no filter). Pass = beats SPY in
       BOTH halves AND the random-order median beats SPY. */
    const base: Opts = { name: 'BASE model book', floor: false, exit: 'hold20', regime: false, greenOnly: true };
    variants.push(base,
      { ...base, name: 'A swing-first', swingFirst: true },
      { ...base, name: 'B swing-only', scans: ['swing'] },
      { ...base, name: 'C let winners run', exit: 'hold20run' },
      { ...base, name: 'D 1% on swing', riskByScan: { swing: 0.01 } });
  } else {
  for (const floor of [true, false]) for (const exit of ['ship', 'hold20'] as const) for (const regime of [true, false])
    variants.push({ name: `${floor ? 'floor' : 'card'}-${exit}-${regime ? 'riskon' : 'always'}`, floor, exit, regime, greenOnly: true });
  for (const v of [...variants]) variants.push({ ...v, name: `SWEEP ${v.name}`, sweep: true });
  variants.push({ name: 'ALL-TIERS floor-ship-riskon', floor: true, exit: 'ship', regime: true, greenOnly: false });
  variants.push({ name: 'ALL-TIERS floor-ship-always', floor: true, exit: 'ship', regime: false, greenOnly: false });
  }

  const cut = spyCurve[Math.floor(spyCurve.length * 2 / 3)].d;
  const split = <T extends { d?: string; exit?: string }>(arr: T[], key: 'd' | 'exit') =>
    [arr.filter(x => (x[key] as string) < cut), arr.filter(x => (x[key] as string) >= cut)];

  const results: Record<string, unknown> = {};
  const [s1, s2] = split(spyCurve, 'd');
  results.SPY = { all: stats(spyCurve, []), firstTwoThirds: stats(s1, []), lastThird: stats(s2, []) };

  for (const v of variants) {
    const r = run(c, cands, v);
    const [c1, c2] = split(r.curve, 'd');
    const [x1, x2] = split(r.closed, 'exit');
    const byScan: Record<string, unknown> = {};
    for (const sc of ['scanner', 'swing', 'ep9m']) {
      const xs = r.closed.filter(x => x.scan === sc);
      byScan[sc] = { trades: xs.length, avgR: +(xs.reduce((a, x) => a + x.r, 0) / (xs.length || 1)).toFixed(3), pnl: Math.round(xs.reduce((a, x) => a + x.pnl, 0)) };
    }
    const byYear: Record<string, number> = {};
    let prev = EQUITY0;
    for (const y of [...new Set(r.curve.map(p => p.d.slice(0, 4)))]) {
      const endEq = r.curve.filter(p => p.d.startsWith(y)).at(-1)!.eq;
      byYear[y] = +((endEq / prev - 1) * 100).toFixed(1); prev = endEq;
    }
    const top = [...r.closed].sort((a, b) => b.pnl - a.pnl);
    results[v.name] = {
      all: stats(r.curve, r.closed), firstTwoThirds: stats(c1, x1), lastThird: stats(c2, x2),
      byScan, byYear, skippedFull: r.skippedFull, openAtEnd: r.openAtEnd,
      top5: top.slice(0, 5).map(x => `${x.ticker} ${x.entry} ${x.r.toFixed(1)}R $${Math.round(x.pnl)}`),
      top5ShareOfPnl: +(top.slice(0, 5).reduce((a, x) => a + x.pnl, 0) / Math.max(1, r.closed.reduce((a, x) => a + x.pnl, 0)) * 100).toFixed(0),
      curve: r.curve.filter((_, i) => i % 5 === 0).map(p => [p.d, Math.round(p.eq)]),
    };
    const a = (results[v.name] as any).all;
    console.log(v.name.padEnd(30), `ret ${a.returnPct}%  cagr ${a.cagrPct}%  mdd ${a.maxDdPct}%  n ${a.trades}  win ${a.winPct}%  avgR ${a.avgR}`);
  }
  /* Ranking luck. With thousands of candidates turned away for want of a slot,
     "RS first" decides which trades exist. Re-run with the day's candidates in
     random order: if the RS-ranked result sits far above the random spread,
     the ranking (or luck in it) is doing the work, not the universe. */
  const luck: Record<string, unknown> = {};
  for (const v of variants.filter(v => v.greenOnly)) {
    const rets: number[] = [], dds: number[] = [];
    for (let seed = 1; seed <= 200; seed++) {
      const r = run(c, cands, { ...v, seed });
      const st = stats(r.curve, r.closed);
      rets.push(st.returnPct); dds.push(st.maxDdPct);
    }
    rets.sort((a, b) => a - b); dds.sort((a, b) => a - b);
    const q = (a: number[], p: number) => a[Math.floor(p * (a.length - 1))];
    luck[v.name] = { p10: q(rets, 0.1), median: q(rets, 0.5), p90: q(rets, 0.9), beatSpyPct: +(100 * rets.filter(x => x > (results.SPY as any).all.returnPct).length / rets.length).toFixed(0), medianMaxDd: q(dds, 0.5) };
    console.log('random-rank', v.name.padEnd(24), JSON.stringify(luck[v.name]));
  }
  results.randomRanking = luck;
  results.meta = { start: START, end: c.sessions.at(-1), splitAt: cut, rules: 'see header of scripts/backtest/portfolio.ts' };
  fs.writeFileSync(path.join(REPLAY, process.argv[2] === 'round2' ? 'portfolio_round2.json' : 'portfolio_results.json'), JSON.stringify(results, null, 1));
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s — split at ${cut}`);
}

main();

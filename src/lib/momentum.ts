// lib/momentum.ts — Momentum Leaders: the 50 liquid stocks with the strongest
// 12-month return, skipping the most recent month.
//
// WHY THIS LIST (scripts/backtest/rank-hold.ts, rank-offsets.ts,
// rank-refine.ts, 9 Oct 2026). Of six monthly rankings tested on Sep 2022 -
// Sep 2026, this is the only one that beat SPY whichever day of the month it
// was rebalanced on (20 of 20 days, median +51% over SPY across the 4 years).
// Held as four staggered monthly sleeves it made +159% against SPY's +112%.
// The costs of that: it trailed SPY for the first two years (+44% vs +58%),
// fell further (worst drop -32% vs -19%), and per unit of drawdown it did
// WORSE than SPY. Momentum is a known, decades-old effect with long dry
// spells and sharp crashes in market rebounds. This is a ranking, not a buy
// signal — no buy levels, no stops.
//
// Universe (rank-hold.ts): common stock or ADR, close >= $5, 20-session
// average dollar volume >= $20M. Live approximation of "every bar of the last
// 253 sessions present": traded today, 21 sessions ago, 252 sessions ago, and
// on at least 18 of the last 20 sessions.

import { sueFresh, type SueEntry } from './sue';

export const MOMENTUM_KEY = 'momentum_leaders_v1';
/** Tonight's ranked universe (tickers), for /api/earnings/sue to keep scores for. */
export const MOMENTUM_UNIVERSE_KEY = 'momentum_universe_v1';
/** Below this many names with a fresh earnings score, the list falls back to plain momentum. */
export const MIN_SUE_NAMES = 100;
export const MOMENTUM_TOP = 50;
export const MOMENTUM_MIN_PRICE = 5;
export const MOMENTUM_MIN_DVOL = 20e6;

export interface MomentumRow {
  t: string;
  n?: string;
  mom: number;     // % return from 252 to 21 sessions ago
  r1m: number;     // % return over the last 21 sessions (not used to rank)
  price: number;
  dvol: number;    // 20-session average dollar volume
  sue?: number | null;  // earnings surprise (lib/sue) when the ranking uses it
}

export interface MomentumList {
  asOf: string;          // the session the closes are from
  builtAt: string;
  universe: number;
  /** 'momentum+earnings' = rank-pead.ts P2 (the tested best); 'momentum' = the fallback. */
  ranking?: 'momentum' | 'momentum+earnings';
  /** Names with a fresh earnings score, of the universe. */
  scored?: number;
  rows: MomentumRow[];
}

type Bar = { c: number; v: number };

/**
 * Rank the universe. `recent` is the last 20 sessions newest first (recent[0]
 * = today); `d21` and `d252` the sessions 21 and 252 back.
 */
export function rankMomentum(
  names: Map<string, string>,
  recent: Map<string, Bar>[],
  d21: Map<string, Bar>,
  d252: Map<string, Bar>,
): { universe: number; rows: MomentumRow[]; all: MomentumRow[] } {
  const rows: MomentumRow[] = [];
  let universe = 0;
  for (const [t, name] of names) {
    const today = recent[0]?.get(t);
    if (!today || !(today.c >= MOMENTUM_MIN_PRICE)) continue;
    let dv = 0, n = 0;
    for (const day of recent) { const b = day.get(t); if (b) { dv += b.c * b.v; n++; } }
    if (n < 18 || !(dv / n >= MOMENTUM_MIN_DVOL)) continue;
    const a = d252.get(t), b = d21.get(t);
    if (!a || !b || !(a.c > 0) || !(b.c > 0)) continue;
    universe++;
    rows.push({ t, n: name, mom: (b.c / a.c - 1) * 100, r1m: (today.c / b.c - 1) * 100, price: today.c, dvol: dv / n });
  }
  rows.sort((x, y) => y.mom - x.mom);
  return { universe, rows: rows.slice(0, MOMENTUM_TOP), all: rows };
}

/**
 * rank-pead.ts P2: among names with a fresh earnings score, the top 50 by
 * (SUE rank + momentum rank). `all` must be momentum-sorted (rankMomentum),
 * which is also the tie-break, as in the test.
 */
export function rankCombined(all: MomentumRow[], sue: Record<string, SueEntry>, date: string): MomentumRow[] {
  const e = all.filter(r => sueFresh(sue[r.t], date)).map(r => ({ ...r, sue: sue[r.t].s as number }));
  const rs = new Map(e.slice().sort((a, b) => (b.sue as number) - (a.sue as number)).map((x, i) => [x.t, i]));
  const rm = new Map(e.map((x, i) => [x.t, i]));
  return e.slice().sort((a, b) => (rs.get(a.t)! + rm.get(a.t)!) - (rs.get(b.t)! + rm.get(b.t)!)).slice(0, MOMENTUM_TOP);
}

/* ---- Forward paper record (hidden) -----------------------------------------
   The list above, held exactly as rank-refine.ts V1 tested it: four sleeves
   of 25%, each rebalanced to the top 50 on the 1st / 6th / 11th / 16th
   session of the month, filled at the NEXT session's open, 0.1% a side on
   turnover, marked on closes; against SPY bought at the first fill. Shown
   nowhere; read with /api/momentum/nightly?view=1. */
export const MOMENTUM_PAPER_KEY = 'momentum_paper_v1';          // plain momentum
export const MOMENTUM_PAPER_P2_KEY = 'momentum_paper_p2_v1';    // momentum + earnings (what the card shows)
export const SLEEVE_DAYS = [1, 6, 11, 16] as const;
export const PAPER_COST = 0.001;

export interface Sleeve {
  k: number;                              // session of the month it rebalances on
  base: number;                           // NAV at the last fill, after costs
  nav: number;                            // NAV at the last close
  hold: { t: string; entry: number; last: number }[];
  pending: string[] | null;               // chosen at a rebalance close, filled at the next open
}
export interface MomentumPaper {
  startedOn: string;
  lastDate: string | null;
  spyEntry: number | null;
  sleeves: Sleeve[];
  daily: [string, number, number][];      // [date, combined NAV, SPY growth]
}
export const newPaper = (date: string): MomentumPaper => ({
  startedOn: date, lastDate: null, spyEntry: null,
  sleeves: SLEEVE_DAYS.map(k => ({ k, base: 1, nav: 1, hold: [], pending: null })), daily: [],
});

type OC = { o: number; c: number };

/** One session forward. `som` = this session's number within its month (1-based). */
export function stepPaper(p: MomentumPaper, date: string, som: number, bars: Map<string, OC>, top: string[]): void {
  if (p.lastDate === date) return;
  for (const s of p.sleeves) {
    if (s.pending) {
      // sell the old book and buy the new one at today's open
      let v = s.base;
      if (s.hold.length) {
        const r = s.hold.reduce((a, h) => { const b = bars.get(h.t); const px = b && b.o > 0 ? b.o : h.last; return a + px / h.entry - 1; }, 0) / s.hold.length;
        v = s.base * (1 + r);
      }
      const old = new Set(s.hold.map(h => h.t));
      const next = s.pending.filter(t => (bars.get(t)?.o ?? 0) > 0);
      const turn = next.length ? next.filter(t => !old.has(t)).length / next.length : 0;
      s.base = v * (1 - 2 * PAPER_COST * turn);
      s.hold = next.map(t => ({ t, entry: bars.get(t)!.o, last: bars.get(t)!.o }));
      s.pending = null;
    }
    for (const h of s.hold) { const b = bars.get(h.t); if (b && b.c > 0) h.last = b.c; }
    s.nav = s.hold.length ? s.base * (1 + s.hold.reduce((a, h) => a + h.last / h.entry - 1, 0) / s.hold.length) : s.base;
    if (som === s.k) s.pending = top.slice();
  }
  const spy = bars.get('SPY');
  if (p.spyEntry == null && p.sleeves.some(s => s.hold.length) && spy?.o) p.spyEntry = spy.o;
  const nav = p.sleeves.reduce((a, s) => a + s.nav, 0) / p.sleeves.length;
  if (p.spyEntry != null && spy?.c) p.daily.push([date, +nav.toFixed(6), +(spy.c / p.spyEntry).toFixed(6)]);
  p.daily = p.daily.slice(-800);
  p.lastDate = date;
}

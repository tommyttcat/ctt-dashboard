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

export const MOMENTUM_KEY = 'momentum_leaders_v1';
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
}

export interface MomentumList {
  asOf: string;          // the session the closes are from
  builtAt: string;
  universe: number;
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
): { universe: number; rows: MomentumRow[] } {
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
  return { universe, rows: rows.slice(0, MOMENTUM_TOP) };
}

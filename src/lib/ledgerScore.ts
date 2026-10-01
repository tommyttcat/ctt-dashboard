// lib/ledgerScore.ts — did the brief's own picks beat the scan list they came from?
//
// The setup ledger (lib/setupLedger) freezes the brief's picks at the close,
// before price has resolved anything. Since 24 Sep 2026 the brief takes its
// buy and stop levels from the scans, so the only thing it adds is WHICH names
// it picks. This file answers whether that choice is worth anything, by
// scoring the picks and the scan list with the same measuring stick:
//
//   Next open   bought at the next session's open, out at the stop or at the
//               close of session HOLD20. Identical to /track's hold-20 leg
//               (same stop fallback, same gap-through-the-stop exit), so the
//               pick and the pool are the same measurement on the same days.
//   Pool        every name /track recorded that evening (lib/track), scored by
//               /track itself. Caveat: /track only records a name the first
//               day it appears on a scan, so the pool is "fresh scan names",
//               while the brief may pick a name that has sat on a table for
//               weeks.
//   SPY         the same next-open, 20-session hold, no stop — the market.
//   Levels      the brief's own "buy above X / buy dip X, stop Y", walked by
//               lib/trackPlan's stepPlan — the same rules as /track's
//               "followed the levels" record. Long only.
//
// Everything is recomputed from daily bars on every run, so a missed night or
// a backfill costs nothing; a date is folded into the running totals exactly
// once, when it is finished, and the fold is guarded by `folded`.
//
// Percent only — no R (28 Sep 2026).

import { rToPct, HOLD20, type OpenPosition } from './track';
import { stepPlan, isResolved, type PlanPosition, type PlanState } from './trackPlan';
import type { SetupEntry, SetupBucket } from './setupLedger';

export const SCORECARD_KEY = 'setup_scorecard_v1';
export const SCORE_DAY_KEY = (date: string) => `setup_score:${date}`;
/** Finished dates kept on the scorecard for the page; older ones live in SCORE_DAY_KEY. */
export const RECENT_CAP = 20;
/** A pool position with no bar for this long is counted as missing data, not waited on. */
export const POOL_GIVE_UP_SESSIONS = 40;

export interface DayBar { d: string; o: number; h: number; l: number; c: number }

/** Sums, not rolling averages, so every average is exact at any sample size. */
export interface Agg { n: number; wins: number; sumPct: number; sumBest: number; sumWorst: number }
export const emptyAgg = (): Agg => ({ n: 0, wins: 0, sumPct: 0, sumBest: 0, sumWorst: 0 });

export interface LevelAgg {
  picked: number;   // had a usable buy level and stop
  filled: number;   // traded the level
  failed: number;   // hit the stop (or opened through it) before the level
  missed: number;   // stepPlan's "gapped past it" — needs an ADR the ledger lacks, so 0 today
  expired: number;  // never traded the level within the window
  closed: number;   // filled and finished
  wins: number;
  sumPct: number;
}
export const emptyLevelAgg = (): LevelAgg => ({ picked: 0, filled: 0, failed: 0, missed: 0, expired: 0, closed: 0, wins: 0, sumPct: 0 });

export type LegState = 'pending' | 'open' | 'stopped' | 'held' | 'nodata';

export interface PickScore {
  t: string;
  buckets: SetupBucket[];
  direction: 'long' | 'short';
  /* Next-open leg. */
  fill: number | null;
  stop: number | null;
  n: number;                // sessions walked
  state: LegState;
  pct: number | null;       // final % once stopped/held; null while open
  nowPct: number | null;    // final % if done, else marked to the last close
  best: number | null;      // best move from the fill within HOLD20 sessions, %
  worst: number | null;     // worst move from the fill within HOLD20 sessions, %
  /* The brief's own levels. */
  level: PlanState | 'none';
  levelPct: number | null;
}

export interface PoolScore {
  n: number;            // decided positions counted
  wins: number;
  sumPct: number;
  nowN: number;         // filled positions, decided or not
  nowSumPct: number;    // decided at their result, the rest marked to the last close
  waiting: number;      // filled, not yet decided
  pcts: number[];       // every decided result — kept for a later luck check
}

export interface DateScore {
  d: string;
  sessions: number;           // sessions since the pick date (SPY's calendar)
  picks: PickScore[];
  pool: PoolScore | null;     // null when /track has no picks for that date
  spyPct: number | null;      // SPY next open → close of session HOLD20
  spyNowPct: number | null;
  nextOpenDone: boolean;      // every pick's next-open leg and the pool are decided
  levelsDone: boolean;        // every pick's level leg is resolved
}

export interface Totals {
  dates: number;              // dates folded into the comparison
  datesBeat: number;          // dates where the picks' average beat the pool's
  datesWithPool: number;
  picks: Agg;                 // long picks
  pool: Agg;                  // best/worst unused: /track's peak runs 60 sessions, not 20
  spy: { n: number; sumPct: number };
  shorts: Agg;                // scored, kept out of the comparison (the pool is long only)
  nodata: number;             // picks with no bars at all
  byBucket: Record<SetupBucket, Agg>;
  level: LevelAgg;
}

export const emptyTotals = (): Totals => ({
  dates: 0, datesBeat: 0, datesWithPool: 0,
  picks: emptyAgg(), pool: emptyAgg(), spy: { n: 0, sumPct: 0 }, shorts: emptyAgg(), nodata: 0,
  byBucket: { top: emptyAgg(), confluence: emptyAgg(), conviction: emptyAgg() },
  level: emptyLevelAgg(),
});

export interface Scorecard {
  startedOn: string;
  updatedAt?: string;
  /** Dates whose next-open comparison is in the totals. */
  foldedNextOpen: string[];
  /** Dates whose level legs are in the totals. A date is finished when it is in both. */
  foldedLevels: string[];
  totals: Totals;
  /** Unfinished dates, recomputed every run — the in-progress view. */
  open: DateScore[];
  /** Finished dates, newest first, capped at RECENT_CAP. */
  recent: DateScore[];
}

export const emptyScorecard = (startedOn: string): Scorecard => ({
  startedOn, foldedNextOpen: [], foldedLevels: [], totals: emptyTotals(), open: [], recent: [],
});

const pctOf = (fill: number, exit: number, dir: 'long' | 'short') =>
  +((dir === 'short' ? (fill - exit) / fill : (exit - fill) / fill) * 100).toFixed(3);

/**
 * The next-open leg — the same rule as the hold-20 exit in /api/track/tick.
 * `bars` are the sessions strictly after the pick date, oldest first.
 *
 * Stop: the published stop when it is on the losing side of the fill, else
 * the entry bar's extreme, else 1% — /track's fallback, mirrored for shorts.
 * A stop touched on the entry bar exits at the stop; later, at the worse of
 * the stop and the open (a gap through the stop fills at the open).
 */
export function scoreNextOpen(e: Pick<SetupEntry, 'stop' | 'direction'>, bars: DayBar[]) {
  const dir = e.direction;
  if (bars.length === 0) return { fill: null, stop: null, n: 0, state: 'pending' as LegState, pct: null, nowPct: null, best: null, worst: null };
  const first = bars[0];
  const fill = first.o;
  if (!(fill > 0)) return { fill: null, stop: null, n: 0, state: 'nodata' as LegState, pct: null, nowPct: null, best: null, worst: null };
  let stop: number;
  if (dir === 'long') stop = e.stop != null && e.stop < fill ? e.stop : first.l < fill ? first.l : fill * 0.99;
  else stop = e.stop != null && e.stop > fill ? e.stop : first.h > fill ? first.h : fill * 1.01;

  let hi = -Infinity, lo = Infinity;
  let pct: number | null = null;
  let state: LegState = 'open';
  let n = 0;
  for (const b of bars.slice(0, HOLD20)) {
    n += 1;
    hi = Math.max(hi, b.h);
    lo = Math.min(lo, b.l);
    if (pct != null) continue;   // keep walking for best/worst, the exit is fixed
    const hit = dir === 'long' ? b.l <= stop : b.h >= stop;
    if (hit) {
      const exit = n === 1 ? stop : dir === 'long' ? Math.min(stop, b.o) : Math.max(stop, b.o);
      pct = pctOf(fill, exit, dir);
      state = 'stopped';
    } else if (n >= HOLD20) {
      pct = pctOf(fill, b.c, dir);
      state = 'held';
    }
  }
  const last = bars[Math.min(bars.length, HOLD20) - 1];
  const best = dir === 'long' ? pctOf(fill, hi, 'long') : pctOf(fill, lo, 'short');
  const worst = dir === 'long' ? pctOf(fill, lo, 'long') : pctOf(fill, hi, 'short');
  return { fill, stop: +stop.toFixed(4), n, state, pct, nowPct: pct ?? pctOf(fill, last.c, dir), best, worst };
}

/**
 * The brief's own levels, walked by lib/trackPlan's stepPlan. A buy level
 * under the publish price is a dip plan ("buy dip X"), at or above it a
 * breakout ("buy above X"). Long only, and only with a stop under the level —
 * anything else has no plan a reader could have followed.
 */
export function scoreLevels(e: Pick<SetupEntry, 'ticker' | 'date' | 'trigger' | 'stop' | 'refPrice' | 'direction'>, bars: DayBar[]): { level: PlanState | 'none'; levelPct: number | null } {
  if (e.direction !== 'long' || e.trigger == null || e.stop == null || !(e.trigger > 0) || !(e.stop < e.trigger)) {
    return { level: 'none', levelPct: null };
  }
  const ref = e.refPrice ?? bars[0]?.o ?? null;
  const p: PlanPosition = {
    scan: 'brief', t: e.ticker, d: e.date, tier: null,
    buy: e.trigger, stop: e.stop, dip: ref != null && e.trigger < ref,
    adr: null, state: 'watching', wait: 0, fill: null, fillDate: null, target: null, n: 0, r: null, last: null, closedOn: null,
  };
  for (const b of bars) {
    stepPlan(p, b, b.d);
    if (isResolved(p)) break;
  }
  return { level: p.state, levelPct: p.r != null ? rToPct(p.fill, p.stop, p.r) : null };
}

/** /track's verdict on everything the scans recorded that evening, one row per ticker. */
export function scorePool(trackOpen: OpenPosition[], date: string, sessions: number): PoolScore | null {
  const seen = new Set<string>();
  const mine = trackOpen.filter(p => {
    if (p.d !== date || p.scan === 'multibagger' || seen.has(p.t)) return false;
    seen.add(p.t);
    return true;
  });
  if (mine.length === 0) return null;
  const out: PoolScore = { n: 0, wins: 0, sumPct: 0, nowN: 0, nowSumPct: 0, waiting: 0, pcts: [] };
  for (const p of mine) {
    if (p.fill == null || !(p.fill > 0)) continue;
    const pct = rToPct(p.fill, p.stop, p.exitHold20);
    if (pct != null) {
      out.n += 1;
      if (pct > 0) out.wins += 1;
      out.sumPct += pct;
      out.pcts.push(+pct.toFixed(3));
      out.nowN += 1;
      out.nowSumPct += pct;
    } else {
      // A position missing bars can stall short of 20; stop waiting on it eventually.
      if (sessions < POOL_GIVE_UP_SESSIONS) out.waiting += 1;
      if (p.last != null) { out.nowN += 1; out.nowSumPct += ((p.last - p.fill) / p.fill) * 100; }
    }
  }
  out.sumPct = +out.sumPct.toFixed(3);
  out.nowSumPct = +out.nowSumPct.toFixed(3);
  return out;
}

/** Score one ledger date from scratch. `barsFor` returns sessions strictly after `date`. */
export function scoreDate(
  date: string,
  entries: SetupEntry[],
  barsFor: (ticker: string) => DayBar[] | null,
  spyBars: DayBar[],
  trackOpen: OpenPosition[],
): DateScore {
  const sessions = spyBars.length;
  const picks: PickScore[] = entries.map(e => {
    const bars = barsFor(e.ticker);
    if (!bars || bars.length === 0) {
      // No bars after a full window means the name is gone, not slow.
      const state: LegState = sessions >= HOLD20 ? 'nodata' : 'pending';
      return { t: e.ticker, buckets: e.buckets, direction: e.direction, fill: null, stop: null, n: 0, state, pct: null, nowPct: null, best: null, worst: null, level: state === 'nodata' ? 'none' : 'watching', levelPct: null };
    }
    const no = scoreNextOpen(e, bars);
    const lv = scoreLevels(e, bars);
    return { t: e.ticker, buckets: e.buckets, direction: e.direction, ...no, ...lv };
  });

  const spy = spyBars.length ? scoreNextOpen({ stop: 0, direction: 'long' }, spyBars) : null;
  const pool = scorePool(trackOpen, date, sessions);
  const legDone = (p: PickScore) => p.state === 'stopped' || p.state === 'held' || p.state === 'nodata';
  const levelDone = (p: PickScore) => p.level === 'none' || (p.level !== 'watching' && p.level !== 'filled');

  return {
    d: date,
    sessions,
    picks,
    pool,
    spyPct: spy?.state === 'held' ? spy.pct : null,
    spyNowPct: spy?.nowPct ?? null,
    nextOpenDone: picks.every(legDone) && sessions >= HOLD20 && (pool == null || pool.waiting === 0),
    levelsDone: picks.every(levelDone),
  };
}

const addTo = (a: Agg, p: PickScore) => {
  if (p.pct == null) return;
  a.n += 1;
  if (p.pct > 0) a.wins += 1;
  a.sumPct = +(a.sumPct + p.pct).toFixed(3);
  a.sumBest = +(a.sumBest + (p.best ?? 0)).toFixed(3);
  a.sumWorst = +(a.sumWorst + (p.worst ?? 0)).toFixed(3);
};

/** Fold a finished next-open comparison into the totals. Call once per date. */
export function foldNextOpen(t: Totals, s: DateScore): void {
  t.dates += 1;
  for (const p of s.picks) {
    if (p.state === 'nodata') { t.nodata += 1; continue; }
    if (p.direction === 'short') { addTo(t.shorts, p); continue; }
    addTo(t.picks, p);
    for (const b of p.buckets) addTo((t.byBucket[b] ||= emptyAgg()), p);
  }
  if (s.spyPct != null) { t.spy.n += 1; t.spy.sumPct = +(t.spy.sumPct + s.spyPct).toFixed(3); }
  if (s.pool && s.pool.n > 0) {
    t.pool.n += s.pool.n;
    t.pool.wins += s.pool.wins;
    t.pool.sumPct = +(t.pool.sumPct + s.pool.sumPct).toFixed(3);
    const longs = s.picks.filter(p => p.direction === 'long' && p.pct != null);
    if (longs.length > 0) {
      t.datesWithPool += 1;
      const pickAvg = longs.reduce((a, p) => a + (p.pct ?? 0), 0) / longs.length;
      if (pickAvg > s.pool.sumPct / s.pool.n) t.datesBeat += 1;
    }
  }
}

/** Fold a date's resolved level legs into the totals. Call once per date. */
export function foldLevels(t: Totals, s: DateScore): void {
  const L = t.level;
  for (const p of s.picks) {
    if (p.level === 'none' || p.level === 'watching') continue;
    L.picked += 1;
    if (p.level === 'failed') L.failed += 1;
    else if (p.level === 'missed') L.missed += 1;
    else if (p.level === 'expired') L.expired += 1;
    else {
      L.filled += 1;
      if (p.levelPct != null) {
        L.closed += 1;
        if (p.levelPct > 0) L.wins += 1;
        L.sumPct = +(L.sumPct + p.levelPct).toFixed(3);
      }
    }
  }
}

/**
 * One run: rescore every unfinished date, fold what has finished, and return
 * the new scorecard plus the dates that finished on this run (to archive).
 * Pure — the route does the I/O.
 */
export function advance(
  card: Scorecard,
  ledgerDates: string[],
  scored: Map<string, DateScore>,
): { card: Scorecard; finished: DateScore[] } {
  const foldedNO = new Set(card.foldedNextOpen);
  const foldedLV = new Set(card.foldedLevels);
  const finished: DateScore[] = [];
  const open: DateScore[] = [];
  for (const d of [...ledgerDates].sort()) {
    if (foldedNO.has(d) && foldedLV.has(d)) continue;
    const s = scored.get(d);
    if (!s) continue;
    if (!foldedNO.has(d) && s.nextOpenDone) { foldNextOpen(card.totals, s); foldedNO.add(d); }
    if (!foldedLV.has(d) && s.levelsDone) { foldLevels(card.totals, s); foldedLV.add(d); }
    if (foldedNO.has(d) && foldedLV.has(d)) finished.push(s);
    else open.push(s);
  }
  return {
    card: {
      ...card,
      foldedNextOpen: [...foldedNO].sort(),
      foldedLevels: [...foldedLV].sort(),
      open: open.sort((a, b) => b.d.localeCompare(a.d)),
      recent: [...finished.reverse(), ...card.recent].slice(0, RECENT_CAP),
      updatedAt: new Date().toISOString(),
    },
    finished,
  };
}

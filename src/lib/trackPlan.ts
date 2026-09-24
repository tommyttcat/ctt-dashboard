// lib/trackPlan.ts — the record kept the way the picks are presented.
//
// lib/track.ts buys every pick at the next open. That is the method the
// 5-year backtest used, and it stays, but it is not what the site tells
// anyone to do: every table, the dashboard and the brief say "buy above X,
// stop Y", and "don't chase" once a name is too far past X. A reader who
// followed that would only have bought the names that actually traded their
// level. This record counts exactly those.
//
//   Picked    a row on one of the six tables that publish a buy level and a
//             stop, and whose status was HIT or "x% away" that evening. EXT,
//             MISS and OUT are not recorded: the site says not to buy them.
//   Fill      the first session that trades the level, within
//             PLAN_VALID_SESSIONS. Breakout: the open if it opened through
//             the level, else the level itself. Dip (EP9M): the open if it
//             opened below the level, else the level itself.
//   Missed    opened more than one normal day's range past the level — the
//             site's "don't chase" — so no reader would have bought it.
//   Failed    reached its stop before its level (or opened through the stop
//             on a dip plan): the idea was wrong before it was a trade.
//   Expired   never traded its level within the window.
//   Exit      the same bracket as lib/track: the stop, 2R, or the close of
//             the HOLD_SESSIONS-th session. Stop first when a single bar
//             touches both — the conservative reading of a daily bar.
//
// A trade is counted the day it closes, not after a fixed window, so the
// page has results within days instead of months.
//
// Cost: two KV reads and two writes inside the daily tick, which already
// fetches the bars and the scan lists. Flat in users. The read side adds one
// small key behind the same ten-minute CDN cache.

import { trigRowOf, planStatusOf } from '@/lib/scans/triggerProximity';
import { rMultiple, targetFor, HOLD_SESSIONS } from '@/lib/track';

export const PLAN_OPEN_KEY = 'track_plan_open_v1';
export const PLAN_RESULTS_KEY = 'track_plan_results_v1';
export const PLAN_VALID_SESSIONS = 10;
export const PLAN_RECENT_CAP = 40;

/** The six tables with a buy level and a stop, and the `_source` each needs:
 *  EP9M is a dip plan and VCP keeps its levels at the top of the row. */
export const PLAN_SOURCES: Record<string, string | undefined> = {
  sip: undefined, daily: undefined, swing: undefined, consolidation: undefined,
  ep9m: 'ep9m', vcp: 'vcp',
};

export type PlanState = 'watching' | 'filled' | 'target' | 'stopped' | 'timeout' | 'missed' | 'failed' | 'expired';

export interface PlanPosition {
  scan: string;
  t: string;               // ticker
  d: string;               // pick date (ET)
  tier: string | null;
  buy: number;
  stop: number;
  dip: boolean;
  adr: number | null;      // one normal day's range, % — the "don't chase" line
  state: PlanState;
  wait: number;            // sessions watched before the fill
  fill: number | null;
  fillDate: string | null;
  target: number | null;
  n: number;               // sessions since the fill
  r: number | null;        // realised R once closed
  last: number | null;
  closedOn: string | null;
}

export interface PlanScanRecord {
  picked: number;
  filled: number;          // reached the buy level
  missed: number;          // gapped past it — not bought
  failed: number;          // hit the stop first
  expired: number;         // never reached it
  closed: number;          // filled and finished
  wins: number;
  sumR: number;
  watching: number;        // right now, recomputed each tick
  open: number;            // right now, recomputed each tick
}

export interface PlanResults {
  startedOn: string;
  byScan: Record<string, PlanScanRecord>;
  recent: PlanPosition[];  // newest first, every resolution — the trades themselves
  updatedAt?: string;
}

export const emptyPlanRecord = (): PlanScanRecord => ({
  picked: 0, filled: 0, missed: 0, failed: 0, expired: 0, closed: 0, wins: 0, sumR: 0, watching: 0, open: 0,
});

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A scan row → a watched position, or null when the site would not present it as a buy. */
export function newPlanPosition(scan: string, row: Record<string, unknown>, date: string, tier: string | null): PlanPosition | null {
  if (!(scan in PLAN_SOURCES)) return null;
  const src = PLAN_SOURCES[scan];
  const r = trigRowOf(src && row._source == null ? { ...row, _source: src } : row, { keepThrough: true, keepExtended: true });
  if (!r) return null;
  const st = planStatusOf(r);
  if (st === 'ext' || st === 'miss' || st === 'out') return null;
  return {
    scan, t: String(r.ticker).toUpperCase(), d: date, tier,
    buy: r.trigger, stop: r.stop, dip: r.pullback,
    adr: num(row.adrPct) ?? num(row.atrPct),
    state: 'watching', wait: 0, fill: null, fillDate: null, target: null, n: 0, r: null, last: null, closedOn: null,
  };
}

interface Bar { o: number; h: number; l: number; c: number }

const close = (p: PlanPosition, state: PlanState, r: number | null, date: string) => {
  p.state = state; p.r = r; p.closedOn = date;
};

/** Walk one position forward one session. Returns true on the session it fills. */
export function stepPlan(p: PlanPosition, bar: Bar, date: string): boolean {
  if (p.state === 'watching') {
    p.wait += 1;
    let fill: number | null = null;
    if (p.dip) {
      if (bar.o <= p.stop) { close(p, 'failed', null, date); return false; }
      if (bar.l <= p.buy) fill = Math.min(bar.o, p.buy);
    } else if (bar.o >= p.buy) {
      const pastPct = ((bar.o - p.buy) / p.buy) * 100;
      if (p.adr != null && p.adr > 0 && pastPct > p.adr) { close(p, 'missed', null, date); return false; }
      fill = bar.o;
    } else if (bar.h >= p.buy) {
      fill = p.buy;
    } else if (bar.l <= p.stop) {
      close(p, 'failed', null, date); return false;
    }

    if (fill == null) {
      if (p.wait >= PLAN_VALID_SESSIONS) close(p, 'expired', null, date);
      return false;
    }
    if (!(p.stop < fill)) { close(p, 'failed', null, date); return false; }

    p.state = 'filled';
    p.fill = fill;
    p.fillDate = date;
    p.target = targetFor(fill, p.stop);
    p.n = 1;
    p.last = bar.c;
    if (bar.l <= p.stop) close(p, 'stopped', rMultiple(fill, p.stop, p.stop), date);
    else if (bar.h >= p.target) close(p, 'target', rMultiple(fill, p.stop, p.target), date);
    return true;
  }

  if (p.state === 'filled' && p.fill != null && p.target != null) {
    p.n += 1;
    p.last = bar.c;
    if (bar.l <= p.stop) close(p, 'stopped', rMultiple(p.fill, p.stop, Math.min(p.stop, bar.o)), date);
    else if (bar.h >= p.target) close(p, 'target', rMultiple(p.fill, p.stop, p.target), date);
    else if (p.n >= HOLD_SESSIONS) close(p, 'timeout', rMultiple(p.fill, p.stop, bar.c), date);
  }
  return false;
}

export const isResolved = (p: PlanPosition) => p.state !== 'watching' && p.state !== 'filled';

/** Fold a resolved position into its scan's running counts. Sums, not rolling
 *  averages, so the page's average is exact at any sample size. */
export function foldPlan(results: PlanResults, p: PlanPosition): void {
  const rec = (results.byScan[p.scan] ||= emptyPlanRecord());
  if (p.state === 'missed') rec.missed += 1;
  else if (p.state === 'failed') rec.failed += 1;
  else if (p.state === 'expired') rec.expired += 1;
  else if (p.r != null) {
    rec.closed += 1;
    rec.sumR = +(rec.sumR + p.r).toFixed(4);
    if (p.r > 0) rec.wins += 1;
  }
  results.recent = [p, ...results.recent].slice(0, PLAN_RECENT_CAP);
}

// lib/earlyTrack.ts — the forward record for the Early Movers card.
//
// The card (lib/summary/earlyMovers) says plainly it is NOT A TESTED SIGNAL.
// This is how it gets tested: every flag it would have raised during the
// session is found again by the nightly tick on the day's minute bars and
// walked forward on the Track record's bracket. In a few months the card
// either earns a claim or says it has not.
//
// RULES — fixed 27 Sep 2026, BEFORE any data.
//   Pool    the names on tonight's lists (Stocks in Play, Daily, EP9M, Swing,
//           VCP, 100-Bagger, 10/21), frozen overnight. The card watches the
//           same pool tomorrow, so what is tracked is what is shown — and a
//           momentum list's own movers cannot flag on the day they joined it.
//   Flag    the first regular-hours minute, from EARLY_MIN_ELAPSED minutes in,
//           that closes up EARLY_MIN_PCT on the prior close with cumulative
//           volume at EARLY_MIN_PACE x the average day pro rata. The card's
//           paceOf and constants, imported rather than copied. Polygon minute
//           bars. Pre-market moves show on the card but are not tracked.
//   Entry   that minute's close.
//   Stop    the scan's own stop if it is below the entry, else the session's
//           low up to the flag minute. lib/track floors the risk at
//           MIN_RISK_PCT.
//   Exit    stop, 2R, or the close of the HOLD_SESSIONS-th session — lib/track's
//           bracket, walked by lib/trackPlan stepPlan. On the flag day only the
//           minutes after the flag count; stop first when one minute has both.
//   PASS    at least EARLY_PASS_N closed flags averaging at least EARLY_PASS_R
//           in BOTH the first and the second half by flag date. Anything less
//           is not an edge.
//
// Cost (in the nightly tick only): 2 KV reads, 2 writes, one Polygon minute
// call per pool name whose day's high reached +EARLY_MIN_PCT. The pool rides
// to the page inside scan_meta_v6, fetched with the breakout watch in one
// mget — nothing per page view. Flat in users.

import { etMinute, type Minute } from '@/lib/orb';
import { targetFor, rMultiple } from '@/lib/track';
import type { PlanPosition } from '@/lib/trackPlan';
import { EARLY_MIN_PCT, EARLY_MIN_PACE, avgSharesOf, paceOf } from '@/lib/summary/earlyMovers';

export const EARLY_POOL_KEY = 'early_pool_v1';
export const EARLY_TRACK_KEY = 'early_track_v1';
export const EARLY_PASS_N = 100;
export const EARLY_PASS_R = 0.10;
/** The card's pool order: the Setups Summary's, then 10/21. */
export const EARLY_POOL_SCANS = ['sip', 'daily', 'ep9m', 'swing', 'vcp', 'multibagger', 'consolidation'] as const;

const OPEN_MIN = 9 * 60 + 30;
const CLOSE_MIN = 16 * 60;

export interface EarlyPoolItem { t: string; scan: string; stop: number | null; avgVol: number | null; rs: number | null; prevClose: number }
export interface EarlySummary {
  since: string;
  flags: number;
  closed: number;
  open: number;
  avgR: number | null;
  winRate: number | null;
  halves: [number | null, number | null];
  verdict: 'collecting' | 'pass' | 'fail';
}
export interface EarlyPool { pickedOn: string; names: EarlyPoolItem[]; record?: EarlySummary | null }
export interface EarlyClosed { t: string; scan: string; d: string; r: number }
export interface EarlyTrack { startedOn: string; flags: number; open: PlanPosition[]; closed: EarlyClosed[] }
/** Closed flags kept for the halves; ~50 bytes each, years of room. */
export const EARLY_CLOSED_CAP = 5000;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Tonight's lists → tomorrow's pool. `closes` is tonight's close per ticker;
 *  a name without one cannot be measured tomorrow and is left out. */
export function earlyPoolFrom(rowsByScan: Record<string, Record<string, unknown>[]>, closes: Pick<Map<string, number>, 'get'>, date: string): EarlyPool {
  const seen = new Set<string>();
  const names: EarlyPoolItem[] = [];
  for (const scan of EARLY_POOL_SCANS) {
    for (const row of rowsByScan[scan] ?? []) {
      const t = String(row.ticker ?? row.symbol ?? '').toUpperCase();
      const prevClose = closes.get(t);
      if (!t || seen.has(t) || !(prevClose && prevClose > 0)) continue;
      seen.add(t);
      const plan = row.plan as { stop?: unknown } | undefined;
      names.push({
        t, scan,
        stop: num(plan?.stop) ?? num(row.stop),
        avgVol: avgSharesOf(row),
        rs: num(row.rsRating),
        prevClose,
      });
    }
  }
  return { pickedOn: date, names };
}

export interface EarlyFlag { minute: number; fill: number; stop: number; after: Minute[] }

/** The first minute the card would have flagged, or null. Pure. */
export function earlyFlag(item: EarlyPoolItem, mins: Minute[]): EarlyFlag | null {
  const day = mins
    .map(m => ({ m, t: etMinute(m[0]) }))
    .filter(x => x.t >= OPEN_MIN && x.t < CLOSE_MIN)
    .sort((a, b) => a.m[0] - b.m[0]);
  let cum = 0;
  let low = Infinity;
  for (let k = 0; k < day.length; k++) {
    const { m, t } = day[k];
    cum += m[5];
    low = Math.min(low, m[3]);
    const close = m[4];
    const pct = ((close - item.prevClose) / item.prevClose) * 100;
    const pace = paceOf(cum, item.avgVol, t - OPEN_MIN + 1);
    if (pct >= EARLY_MIN_PCT && pace != null && pace >= EARLY_MIN_PACE) {
      const own = item.stop != null && item.stop > 0 && item.stop < close ? item.stop : null;
      return { minute: t, fill: close, stop: own ?? Math.min(low, close), after: day.slice(k + 1).map(x => x.m) };
    }
  }
  return null;
}

/** A flag becomes a filled position, walked through the rest of its own day. */
export function openEarly(item: EarlyPoolItem, flag: EarlyFlag, date: string): PlanPosition {
  const { fill, stop } = flag;
  const target = targetFor(fill, stop);
  const p: PlanPosition = {
    scan: item.scan, t: item.t, d: date, tier: null, buy: fill, stop, dip: false, adr: null,
    state: 'filled', wait: 0, fill, fillDate: date, target, n: 1, r: null, last: fill, closedOn: null,
  };
  for (const m of flag.after) {
    p.last = m[4];
    if (m[3] <= stop) { p.state = 'stopped'; p.r = rMultiple(fill, stop, stop); p.closedOn = date; break; }
    if (m[2] >= target) { p.state = 'target'; p.r = rMultiple(fill, stop, target); p.closedOn = date; break; }
  }
  return p;
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r4 = (v: number | null) => (v == null ? null : +v.toFixed(4));

/** What the card prints under itself, and the verdict against the pass bar. */
export function summarizeEarly(track: EarlyTrack): EarlySummary {
  const closed = [...track.closed].sort((a, b) => a.d.localeCompare(b.d));
  const rs = closed.map(c => c.r);
  const half = Math.floor(closed.length / 2);
  // Rounded before the comparison, so an average printed as +0.1000 passes.
  const h0 = r4(mean(rs.slice(0, half)));
  const h1 = r4(mean(rs.slice(half)));
  const verdict: EarlySummary['verdict'] = closed.length < EARLY_PASS_N ? 'collecting'
    : h0 != null && h1 != null && h0 >= EARLY_PASS_R && h1 >= EARLY_PASS_R ? 'pass' : 'fail';
  return {
    since: track.startedOn,
    flags: track.flags,
    closed: closed.length,
    open: track.open.length,
    avgR: r4(mean(rs)),
    winRate: closed.length ? +(100 * rs.filter(r => r > 0).length / closed.length).toFixed(1) : null,
    halves: [h0, h1],
    verdict,
  };
}

// lib/orb.ts — the volume-confirmed opening-range breakout, in one place.
//
// Shared by the backtest (scripts/backtest/intraday.ts, entry E2) and the live
// Model Book v2 (lib/modelBook), so the rule that was tested and the rule that
// is traded cannot drift apart.
//
//   Opening range  the first ORB_MINUTES of regular hours (9:30-9:59 ET).
//   Trigger        the first minute from 10:00 whose high clears the range
//                  high while cumulative volume is at least ORB_VOL_MULT x the
//                  average daily volume pro rata (elapsed minutes / 390).
//   Fill           the range high, or that minute's open if it opened above.
//   postFillLow    the lowest print from the trigger minute to the close — the
//                  only part of the day that can stop the trade out.
//
// Measured 25 Sep 2026 on 3,821 green SIP/Daily/Swing signals: 41% winners
// and +3.9% per trade against 30% and +2.0% for buying the open, better in
// both halves and across 15 neighbouring settings.

export const ORB_MINUTES = 30;
export const ORB_VOL_MULT = 1.5;

/** One regular- or extended-hours minute: epoch ms, OHLC, volume. */
export type Minute = [number, number, number, number, number, number];

const OPEN = 9 * 60 + 30;
const CLOSE = 16 * 60;
const etFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' });

/** Minutes since midnight, New York time. */
export function etMinute(ms: number): number {
  const p = Object.fromEntries(etFmt.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return (+p.hour % 24) * 60 + +p.minute;
}

export interface OrbFill { fill: number; postFillLow: number; minute: number }

/**
 * The breakout on one session's minutes (any order of extended hours is
 * ignored), or null when it never triggered. `avgVol` is the average daily
 * share volume; without it the volume half of the rule cannot be judged, so
 * callers must treat a missing value as a data gap, not as "no breakout".
 */
export function orbTrigger(minutes: Minute[], avgVol: number, orMin = ORB_MINUTES, mult = ORB_VOL_MULT): OrbFill | null {
  const day = minutes
    .map(m => ({ m, t: etMinute(m[0]) }))
    .filter(x => x.t >= OPEN && x.t < CLOSE)
    .sort((a, b) => a.m[0] - b.m[0]);
  const range = day.filter(x => x.t < OPEN + orMin);
  if (!range.length) return null;
  const hi = Math.max(...range.map(x => x.m[2]));
  let cum = range.reduce((a, x) => a + x.m[5], 0);
  for (let k = 0; k < day.length; k++) {
    const { m, t } = day[k];
    if (t < OPEN + orMin) continue;
    cum += m[5];
    if (m[2] > hi && cum >= mult * avgVol * ((t - OPEN + 1) / 390)) {
      let low = Infinity;
      for (let j = k; j < day.length; j++) low = Math.min(low, day[j].m[3]);
      return { fill: Math.max(hi, m[1]), postFillLow: low, minute: t };
    }
  }
  return null;
}

/* ---- Today's breakout watch ------------------------------------------------
   Last night's green Stocks in Play / Daily / Swing picks (Model Book v2's
   watch list), judged live on today's minute bars with the SAME orbTrigger.
   Written by the nightly tick (ORB_WATCH_KEY), re-judged by every scanner run
   and carried to the page inside scan_meta_v6 — no extra read on the page. */

export const ORB_WATCH_KEY = 'orb_watch_v1';

export interface OrbWatchItem { t: string; scan: string; stop: number; avgVol: number | null; rs: number }
export interface OrbWatch { pickedOn: string; names: OrbWatchItem[] }

export type OrbWatchState =
  | 'pending'   // before the range is complete (9:30-10:00, plus the data delay)
  | 'wait'      // range set, no volume-confirmed break yet
  | 'go'        // broke the range high on 1.5x pace — the tested entry
  | 'stopped'   // went GO, then traded to the stop
  | 'none'      // the session closed without a breakout: not bought
  | 'out'       // at or under the stop before any breakout
  | 'nodata';   // minute bars or average volume unavailable — never shown as WAIT

export interface OrbWatchRow extends OrbWatchItem {
  state: OrbWatchState;
  orHigh: number | null;
  pace: number | null;     // cumulative volume vs the average day's pro-rata share
  last: number | null;
  goAt: number | null;     // ET minute of the breakout
  fill: number | null;
}
export interface OrbWatchStatus { pickedOn: string; session: string; asOf: number; rows: OrbWatchRow[] }

/**
 * One name's state at `nowMin` (ET minutes). `mins` is today's minute bars;
 * null means the fetch failed. Pure — the tests pin every branch.
 */
export function orbWatchRow(item: OrbWatchItem, mins: Minute[] | null, nowMin: number): OrbWatchRow {
  const base: OrbWatchRow = { ...item, state: 'pending', orHigh: null, pace: null, last: null, goAt: null, fill: null };
  if (nowMin < OPEN) return base;
  if (mins == null || item.avgVol == null || !(item.avgVol > 0)) return { ...base, state: 'nodata' };
  const day = mins
    .map(m => ({ m, t: etMinute(m[0]) }))
    .filter(x => x.t >= OPEN && x.t < CLOSE)
    .sort((a, b) => a.m[0] - b.m[0]);
  if (!day.length) return { ...base, state: nowMin < OPEN + ORB_MINUTES + 30 ? 'pending' : 'nodata' };

  const lastT = day[day.length - 1].t;
  const last = day[day.length - 1].m[4];
  const cum = day.reduce((a, x) => a + x.m[5], 0);
  const pace = cum / (item.avgVol * ((lastT - OPEN + 1) / 390));
  const rangeDone = lastT >= OPEN + ORB_MINUTES - 1;
  const orHigh = rangeDone ? Math.max(...day.filter(x => x.t < OPEN + ORB_MINUTES).map(x => x.m[2])) : null;
  const row = { ...base, orHigh, pace: +pace.toFixed(2), last };

  const trig = orbTrigger(mins, item.avgVol);
  if (trig) {
    const stopped = trig.postFillLow <= item.stop;
    return { ...row, state: stopped ? 'stopped' : 'go', goAt: trig.minute, fill: trig.fill };
  }
  if (last <= item.stop) return { ...row, state: 'out' };
  if (!rangeDone) return { ...row, state: 'pending' };
  if (nowMin >= CLOSE && lastT >= CLOSE - 1) return { ...row, state: 'none' };
  return { ...row, state: 'wait' };
}

/** One session of minute bars from Polygon, or null when it cannot be had. */
export async function fetchSessionMinutes(ticker: string, date: string, apiKey: string): Promise<Minute[] | null> {
  const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/minute/${date}/${date}?adjusted=true&sort=asc&limit=50000&apiKey=${apiKey}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    // Bounded, so one hung call cannot eat the caller's time budget.
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (res?.ok) {
      const j = await res.json().catch(() => null);
      if (j) return (j.results ?? []).map((r: { t: number; o: number; h: number; l: number; c: number; v: number }) => [r.t, r.o, r.h, r.l, r.c, r.v] as Minute);
    }
    await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
  }
  return null;
}

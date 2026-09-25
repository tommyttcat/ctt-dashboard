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

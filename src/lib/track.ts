// lib/track.ts — the live record: what each scan picked, and what happened.
//
// The backtests answered "did these scans work over the last five years".
// This answers the only question that can keep answering itself: are they
// working NOW, on picks made before the outcome was known. Same measuring
// stick as scripts/backtest/simulate.ts so the two records are comparable:
//
//   Entry     the next session's open after the pick
//   Stop      the row's plan stop when it has one, else the pick day's low,
//             floored at MIN_RISK_PCT so a stop inside the spread cannot
//             manufacture an R-multiple
//   Outcomes  fixedTarget (2R vs stop, first passage on daily bars),
//             hold20 (close of the 20th session), peak (best print), and the
//             home-run test (+50% or +10R before the stop)
//
// The EMA trailing exits are deliberately NOT tracked live: they need a
// running EMA per position, which is a lot of state for a number the backtest
// already reports. Fixed target and hold-20 bracket it.
//
// Cost, measured 11 Sep 2026: one cron tick a day reads 8 scan keys plus two
// of its own and writes two; ~11 KB of new rows a day; the open-position key
// peaks near 200 KB because positions retire after HOLD sessions. Flat in
// users — nothing here runs on a page view.

export const TRACK_OPEN_KEY = 'track_open_v1';
export const TRACK_RESULTS_KEY = 'track_results_v1';
export const TRACK_META_KEY = 'track_meta_v1';
/* The closed log. The running averages in TRACK_RESULTS_KEY answer "how is
   this scan doing"; this answers "show me the trades", which is the only
   version of a track record anyone should trust. Capped, newest first, so the
   key cannot grow without bound — the averages are cumulative regardless, so
   dropping the oldest rows loses the detail, never the record. */
export const TRACK_CLOSED_KEY = 'track_closed_v1';
export const CLOSED_CAP = 1200;

export const HOLD_SESSIONS = 60;
export const HOLD20 = 20;
export const MIN_RISK_PCT = 0.5;
export const TARGET_R = 2;
export const HR_PCT = 0.5;
export const HR_R = 10;

/** The scans tracked, their KV list keys, and how a row names itself. */
export const TRACKED_SCANS = [
  { scan: 'sip', key: 'stocks_in_play_v6', sym: 'ticker' },
  { scan: 'daily', key: 'daily_setups_v6', sym: 'ticker' },
  { scan: 'ep9m', key: 'ep9m_v1', sym: 'ticker' },
  { scan: 'vcp', key: 'vcp_v1', sym: 'symbol' },
  { scan: 'consolidation', key: 'consol_1021_v1', sym: 'symbol' },
  { scan: 'swing', key: 'swing_candidates_v1', sym: 'symbol' },
  { scan: 'hrs', key: 'hrs_results_v1', sym: 'symbol' },
  { scan: 'multibagger', key: 'multibagger_v1', sym: 'ticker' },
] as const;

export type TrackedScan = typeof TRACKED_SCANS[number]['scan'];

export interface OpenPosition {
  scan: TrackedScan;
  t: string;             // ticker
  d: string;             // pick date (ET)
  score: number | null;
  tier: string | null;   // the row tint at pick time, so the record can be sliced by it
  fill: number | null;   // next session's open, filled in on the following tick
  stop: number | null;
  target: number | null;
  n: number;             // sessions elapsed since entry
  peak: number | null;   // best print since entry
  hr: boolean;           // home run reached before the stop
  stopped: boolean;
  exitFixed: number | null;  // realised R on the 2R/stop bracket
  exitHold20: number | null; // realised R at the 20th session
  last?: number | null;      // most recent close, so the drill-down can show an open position's current R
}

/** What a position looks like in the drill-down, open or closed. */
export type PositionStatus = 'pending' | 'running' | 'target' | 'stopped' | 'closed';

export function statusOf(p: OpenPosition): PositionStatus {
  if (p.fill == null) return 'pending';
  if (p.stopped) return 'stopped';
  if (p.exitFixed != null && p.exitFixed > 0) return 'target';
  if (p.n >= HOLD_SESSIONS) return 'closed';
  return 'running';
}

/** Open R on the last close — what the position is worth right now, unrealised. */
export function openR(p: OpenPosition): number | null {
  if (p.fill == null || p.stop == null || p.last == null) return null;
  return rMultiple(p.fill, p.stop, p.last);
}

export interface ScanRecord {
  picks: number;
  entered: number;
  settled: number;
  hrRate: number | null;
  fixedAvgR: number | null;
  hold20AvgR: number | null;
  winRate: number | null;
  byTier: Record<string, { n: number; avgR: number | null; hr: number | null }>;
}

export type TrackResults = Record<string, ScanRecord> & { updatedAt?: string };

/** R-multiple with the risk floor applied, so a spread-width stop cannot fake leverage. */
export function rMultiple(fill: number, stop: number, exit: number): number | null {
  if (!(fill > 0)) return null;
  const floor = fill * (MIN_RISK_PCT / 100);
  const risk = Math.max(fill - stop, floor);
  if (!(risk > 0)) return null;
  return +((exit - fill) / risk).toFixed(3);
}

export function homeRunLevel(fill: number, stop: number): number {
  const floor = fill * (MIN_RISK_PCT / 100);
  const risk = Math.max(fill - stop, floor);
  return Math.min(fill * (1 + HR_PCT), fill + HR_R * risk);
}

export function targetFor(fill: number, stop: number): number {
  const floor = fill * (MIN_RISK_PCT / 100);
  const risk = Math.max(fill - stop, floor);
  return fill + TARGET_R * risk;
}

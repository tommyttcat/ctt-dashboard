// lib/alerts.ts — watchlist alerts: "a name you starred reached its buy level
// (HIT) or fell below its stop (OUT)". Opt-in, email, built 24 Sep 2026.
//
// Cost is flat in users by construction. The opted-in watchlists live in one
// KV hash (email → tickers), written per user when they toggle alerts or edit
// their watchlist, so a check reads it in a single HGETALL instead of one key
// per user. A check is then: the hash, the six plan-scan lists in one MGET,
// and the last-seen statuses — about three commands, every 15 minutes in
// market hours. Only the alert emails themselves grow with users, and only
// when something actually happens.
//
// Status is the same planStatusOf every table and the dashboard use, from the
// scan's own levels. The scans refresh about every 15 minutes, so an alert
// means "reached it since the last scan", not a tick-level price alert.

import { trigRowOf, planStatusOf } from '@/lib/scans/triggerProximity';

export const ALERT_INDEX_KEY = 'watch_alerts_v1';   // hash: lowercased email → tickers[]
export const ALERT_STATE_KEY = 'alert_state_v1';    // AlertState

/** Scan, its KV list, the `_source` the plan rules need, and the name a reader knows. */
export const ALERT_SCANS: { scan: string; key: string; source?: string; label: string }[] = [
  { scan: 'sip', key: 'stocks_in_play_v6', label: 'Stocks in Play' },
  { scan: 'daily', key: 'daily_setups_v6', label: 'Daily Setups' },
  { scan: 'swing', key: 'swing_candidates_v1', label: 'Swing' },
  { scan: 'vcp', key: 'vcp_v1', source: 'vcp', label: 'VCP' },
  { scan: 'ep9m', key: 'ep9m_v1', source: 'ep9m', label: 'EP9M' },
  { scan: 'consolidation', key: 'consol_1021_v1', label: '10/21' },
];

export type AlertKind = 'hit' | 'out';

export interface TickerStatus {
  ticker: string;
  status: 'wait' | 'hit' | 'miss' | 'ext' | 'out';
  buy: number;
  stop: number;
  dip: boolean;
  price: number;
  scan: string;            // reader-facing label
}

export interface Alert extends TickerStatus { kind: AlertKind }

/** Per ticker: last status seen, and the ET date each kind last alerted. */
export type AlertState = Record<string, { status: string; alerted?: Partial<Record<AlertKind, string>> }>;

/** Current status for every wanted ticker, from the first scan (in ALERT_SCANS
 *  order) that carries a live plan for it. */
export function statusesFor(rowsByKey: Record<string, unknown>, wanted: Set<string>): Map<string, TickerStatus> {
  const out = new Map<string, TickerStatus>();
  for (const { key, source, label } of ALERT_SCANS) {
    const rows = Array.isArray(rowsByKey[key]) ? (rowsByKey[key] as Record<string, unknown>[]) : [];
    for (const row of rows) {
      const t = String(row?.ticker ?? row?.symbol ?? '').toUpperCase();
      if (!t || !wanted.has(t) || out.has(t)) continue;
      const r = trigRowOf(source && row._source == null ? { ...row, _source: source } : row, { keepThrough: true, keepExtended: true });
      if (!r) continue;
      out.set(t, { ticker: t, status: planStatusOf(r), buy: r.trigger, stop: r.stop, dip: r.pullback, price: r.price, scan: label });
    }
  }
  return out;
}

/** Decide who gets what, and the new state. An alert fires when a name moves
 *  INTO hit or out (not every check it stays there), at most once per kind per
 *  ET day. The very first check (empty state) only records — otherwise
 *  switching the feature on would mail every name already at its level. */
export function computeAlerts(
  index: Record<string, string[]>,
  statuses: Map<string, TickerStatus>,
  prior: AlertState,
  today: string,
): { byEmail: Record<string, Alert[]>; state: AlertState } {
  const seeding = Object.keys(prior).length === 0;
  const state: AlertState = { ...prior };
  const fired = new Map<string, Alert>();

  for (const [t, s] of statuses) {
    const before = state[t];
    const kind: AlertKind | null = s.status === 'hit' ? 'hit' : s.status === 'out' ? 'out' : null;
    const alerted = { ...(before?.alerted ?? {}) };
    if (!seeding && kind && before?.status !== s.status && alerted[kind] !== today) {
      fired.set(t, { ...s, kind });
      alerted[kind] = today;
    }
    state[t] = { status: s.status, alerted };
  }

  const byEmail: Record<string, Alert[]> = {};
  for (const [email, tickers] of Object.entries(index)) {
    const mine = (tickers ?? []).map(x => fired.get(String(x).toUpperCase())).filter((a): a is Alert => !!a);
    if (mine.length) byEmail[email] = mine;
  }
  return { byEmail, state };
}

/** HGETALL hands back parsed arrays or raw JSON strings depending on how the
 *  value was written; normalise both to string[]. */
export function normaliseIndex(raw: Record<string, unknown> | null): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [email, v] of Object.entries(raw ?? {})) {
    let list: unknown = v;
    if (typeof v === 'string') { try { list = JSON.parse(v); } catch { list = []; } }
    if (Array.isArray(list)) out[email] = list.map(x => String(x).toUpperCase()).filter(Boolean);
  }
  return out;
}

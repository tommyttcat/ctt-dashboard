// lib/summary/earlyMovers.ts — names already on today's lists that are moving now.
//
// The scan lists run on data 15-30 minutes behind the market, and the
// momentum lists (Stocks in Play, Daily) only see a name once it is up 4%.
// This card takes every name already on a list — the Setups Summary pool plus
// 10/21 — and checks it against the live Webull price (/api/live-quotes). A
// name up EARLY_MIN_PCT on at least EARLY_MIN_PACE times its normal volume for
// the time of day shows on the next poll, with its own scan's buy and stop.
//
// NOT A TESTED SIGNAL. It says what is moving, nothing about what happens
// next. The volume bar is the Model Book v2 breakout's (lib/orb ORB_VOL_MULT),
// which was tested; this rule as a whole was not. Before the open there is no
// meaningful volume pace, so pre-market it is the price move alone.
//
// Cost: none of its own on KV. The pool is lists the dashboard already loads;
// the quotes are one /api/live-quotes URL shared by every viewer (edge cache,
// one Webull snapshot call per 15s at most) — flat in users.

import { ORB_VOL_MULT } from '@/lib/orb';
import { numOrNull } from '@/lib/summary/rowFormat';
import { planRowsFor, planStatusOf } from '@/lib/scans/triggerProximity';

export const EARLY_MIN_PCT = 2;
export const EARLY_MIN_PACE = ORB_VOL_MULT;
export const EARLY_MAX = 12;
/** Minutes after the open before a volume pace means anything. */
export const EARLY_MIN_ELAPSED = 5;
const OPEN_MIN = 9 * 60 + 30;

export type LiveQ = { price: number; pct: number; prevClose: number; vol?: number | null };

/** Average daily share volume: the row's own, else average dollar volume over
 *  the scan's price (10/21 and Swing ship only the dollar figure). */
export function avgSharesOf(s: any): number | null {
  const v = numOrNull(s?.avgVol ?? s?.avgVolume);
  if (v != null && v > 0) return v;
  const dv = numOrNull(s?.avgDollarVolM);
  const p = numOrNull(s?.price ?? s?.last ?? s?.close);
  return dv != null && dv > 0 && p != null && p > 0 ? (dv * 1e6) / p : null;
}

/** Volume so far against the average day's share for the minutes elapsed. */
export function paceOf(vol: number | null | undefined, avg: number | null, elapsedMin: number): number | null {
  if (vol == null || !(vol > 0) || avg == null || !(avg > 0) || elapsedMin < EARLY_MIN_ELAPSED) return null;
  return vol / ((avg * Math.min(390, elapsedMin)) / 390);
}

/**
 * The movers, biggest move first. `etMin` is minutes since midnight ET at the
 * quote time. Rows come back in the pool's own shape with the live price,
 * change and pace (as `rvol`) laid over, so the Buy & stop rows render them
 * unchanged. A name through its stop is left out: that is not a mover to act on.
 */
export function earlyMovers(pool: any[], quotes: Record<string, LiveQ>, session: string, etMin: number): any[] {
  if (session !== 'Pre-Market' && session !== 'Open' && session !== 'Post-Market') return [];
  const seen = new Set<string>();
  const out: any[] = [];
  for (const s of pool) {
    const t = String(s?.ticker ?? s?.symbol ?? '').toUpperCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    const q = quotes[t];
    if (!q || !(q.price > 0) || !(q.pct >= EARLY_MIN_PCT)) continue;
    let pace: number | null = null;
    if (session !== 'Pre-Market') {
      pace = paceOf(q.vol, avgSharesOf(s), etMin - OPEN_MIN);
      if (pace == null || pace < EARLY_MIN_PACE) continue;
    }
    const row = {
      ...s, ticker: t, price: q.price, last: q.price, change: q.pct, changePct: q.pct,
      rvol: pace != null ? +pace.toFixed(2) : null, _live: true,
    };
    const pr = planRowsFor([row])[0];
    if (pr && planStatusOf(pr) === 'out') continue;
    out.push(row);
  }
  return out.sort((a, b) => b.changePct - a.changePct).slice(0, EARLY_MAX);
}

/* RS Rating — shared lookup
   ==================================================================
   Reads the market-wide percentile map written by /api/rs/run and hands
   scan routes a lookup function.

   WHY EVERY ROUTE GOES THROUGH THIS RATHER THAN READING KV DIRECTLY:

   The rating is only meaningful if every table means the same thing by it.
   Four routes each doing `kv.get('rs_ratings_v1')` and each deciding for
   itself what counts as too stale is how the dashboard ends up showing a
   stock as RS 88 on one table and RS 74 on another — which is exactly the
   inconsistency this whole change was meant to remove.

   ONE STALENESS RULE, APPLIED HERE. See MAX_AGE_DAYS.
   ================================================================== */

import { kv } from '@vercel/kv';
import { isTradingDay, lastCompletedSession, sessionsBetween } from '@/lib/marketCalendar';

export const RS_KEY = 'rs_ratings_v1';

export interface RsPayload {
  asOf: string;
  generatedAt: string;
  ranked: number;
  legDates: Record<string, string | null>;
  ratings: Record<string, number>;
  sortedRaws?: number[];
}

/* How stale the map may be before it is refused.

   MEASURED IN TRADING SESSIONS, NOT CALENDAR DAYS. The previous rule was
   MAX_AGE_DAYS = 4 calendar days, which blanked every RS rating on the
   Tuesday after Labor Day 2026: Friday's asOf parses to midnight UTC, so by
   Tuesday morning it was 4.6 days old and refused — even though Friday was
   still the most recent completed session and the ratings were exactly
   current. Christmas week 2026 would have done the same thing on 28 Dec.

   Calendar days cannot express "no session has traded since", which is the
   only question that matters. Sessions can. Freshness is now the number of
   completed sessions between the map's asOf and the most recent completed
   session; zero means current, and one session of slack covers the window
   between a close and the next morning's RS run.

   NULL RATHER THAN STALE is still the rule. A missing rating renders as an
   em-dash and any RS filter drops the row; a stale one would pass filters
   and be acted on. */
const MAX_AGE_SESSIONS = 1;

export interface RsLookup {
  /* Rating for a symbol, or null when unrated. Unrated is common and
     benign: a name below the ranking floor, or one that listed less than a
     quarter ago and therefore has no recent leg to weight. */
  get: (symbol: string) => number | null;
  available: boolean;
  asOf: string | null;
  ranked: number;
  ageDays: number | null;
  /* Why the lookup is empty, when it is. Worth surfacing in a scan's
     response — "RS job has not run" and "RS job ran but the market map is
     five days old" call for different fixes, and a bare zero-count tells
     you neither. */
  reason: string | null;
  sortedRaws: number[];
}

const EMPTY: RsLookup = {
  get: () => null,
  available: false,
  asOf: null,
  ranked: 0,
  ageDays: null,
  reason: 'not loaded',
  sortedRaws: [],
};

export async function loadRsRatings(): Promise<RsLookup> {
  let payload: RsPayload | null = null;

  try {
    payload = await kv.get<RsPayload>(RS_KEY);
  } catch {
    return { ...EMPTY, reason: 'KV unavailable' };
  }

  if (!payload || !payload.ratings || typeof payload.ratings !== 'object') {
    return { ...EMPTY, reason: 'no RS map in KV — has /api/rs/run executed?' };
  }

  const asOf = payload.asOf ?? null;

  if (!asOf || Number.isNaN(new Date(asOf).getTime())) {
    return { ...EMPTY, reason: 'RS map has no usable asOf date' };
  }

  const ageDays = +((Date.now() - new Date(asOf).getTime()) / 86400000).toFixed(1);

  /* An asOf that is not itself a session means the RS job ranked a day the
     market never traded — refuse it rather than reason about its age. */
  if (!isTradingDay(asOf)) {
    return {
      ...EMPTY,
      asOf,
      ranked: payload.ranked ?? 0,
      ageDays,
      reason: `RS map asOf ${asOf} is not a trading day — refusing to serve`,
    };
  }

  const ageSessions = sessionsBetween(asOf, lastCompletedSession());

  if (ageSessions > MAX_AGE_SESSIONS) {
    return {
      ...EMPTY,
      asOf,
      ranked: payload.ranked ?? 0,
      ageDays,
      reason: `RS map is ${ageSessions} sessions behind (asOf ${asOf}, last close ${lastCompletedSession()}) — refusing to serve stale percentiles`,
    };
  }

  const ratings = payload.ratings;

  return {
    get: (symbol: string) => {
      const v = ratings[symbol];
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    },
    available: true,
    asOf,
    ranked: payload.ranked ?? Object.keys(ratings).length,
    ageDays,
    reason: null,
    sortedRaws: Array.isArray(payload.sortedRaws) ? payload.sortedRaws : [],
  };
}

/* Shared display thresholds, so the five tables cannot colour the same
   number differently. Minervini gates at 70 and prefers 80-90+. */
export const RS_STRONG = 90;
export const RS_GOOD = 80;
export const RS_FLOOR = 70;

export const rsColor = (rs: number | null | undefined): string => {
  if (rs == null) return 'text-slate-500';
  if (rs >= RS_STRONG) return 'text-purple-400';
  if (rs >= RS_GOOD) return 'text-emerald-400';
  if (rs >= RS_FLOOR) return 'text-slate-300';
  return 'text-rose-400';
};

export const rsBadge = (rs: number | null | undefined): string => {
  if (rs == null) return 'bg-white/[0.02] text-slate-600 border-white/5';
  if (rs >= RS_STRONG) return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
  if (rs >= RS_GOOD) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
  if (rs >= RS_FLOOR) return 'bg-slate-500/10 text-slate-300 border-white/10';
  return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
};

/* One tooltip, used everywhere the rating appears.

   It says AS OF explicitly because the rating is computed on closing prices
   and does not move intraday — a stock up 8% today shows yesterday's rating,
   which is correct (IBD's works the same way) and looks wrong the first time
   anyone notices. Saying so in the tooltip is cheaper than explaining it
   every time. */
export const rsTooltip = (rs: number | null | undefined, asOf?: string | null): string => {
  if (rs == null) {
    return 'RS Rating unavailable — the name is below the ranking floor, listed less than a quarter ago, or the daily ranking job has not run.';
  }

  const lines = [
    `RS Rating ${rs} — stronger than ${rs}% of the liquid US market.`,
    '',
    'Trailing-year price performance with the most recent quarter double-weighted, then percentile-ranked against every stock above $5 and 100k average shares.',
    '',
    'Minervini gates at 70 and prefers 80-90+.',
  ];

  if (asOf) {
    lines.push('');
    lines.push(`As of the ${asOf} close — the rating does not move intraday.`);
  }

  return lines.join('\n');
};
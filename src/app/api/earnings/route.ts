// app/api/earnings/route.ts — v2.2
//
// Earnings calendar: FMP calendar + Polygon market-cap floor.
//
// v2.2: Weekend guard. FMP and Polygon return stale/empty data on weekends.
//       The route now keeps a durable "last good" payload in KV (no TTL) and
//       serves it on Sat/Sun instead of hitting the APIs. During the trading
//       week, every successful fetch updates the durable key so Monday's
//       first request always has Friday's data to serve until the fresh
//       fetch completes.
//
// ---------------------------------------------------------------------------
// WHY $1B AND HOW IT COSTS ZERO FMP CALLS
//
// FMP's /stable/earnings-calendar returns every company reporting in the
// window — 4,000+ over 45 days, most of them micro and nano caps whose
// reports move nothing. A $1B floor cuts that to the names worth watching.
//
// FMP charges per call and does not offer a market-cap filter on this
// endpoint. Using FMP's /stable/profile to enrich would cost one call per
// symbol or one batched call per ~100 — hundreds of calls per request.
//
// Instead, market caps come from Polygon's /v3/reference/tickers, which
// returns market_cap on every ticker and is paginated at 1,000. The whole
// US market fits in ~8 pages, cached daily in KV. The Polygon plan is
// unlimited, so the cost is zero.
//
// TOTAL API COST PER REQUEST:
//   FMP:     1 call (the calendar itself)  — 0 on weekends
//   Polygon: 0 calls (reads from KV; the map refreshes once a day at ~8)
//
// ---------------------------------------------------------------------------
// WINDOW
//
// Default is the CURRENT TRADING WEEK: Monday of this week through Friday.
// The component can override with `from` and `to` query params.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

const FMP_KEY = (
  process.env.FMP_API_KEY ||
  process.env.NEXT_PUBLIC_FMP_API_KEY ||
  ''
).trim();

const POLYGON_KEY = (
  process.env.NEXT_PUBLIC_POLYGON_API_KEY ||
  process.env.POLYGON_API_KEY ||
  ''
).trim();

const MIN_MARKET_CAP = 1_000_000_000; // $1B

/* ---- Helpers ---------------------------------------------------------- */

const numOrNull = (v: any): number | null => {
  if (v === '' || v === null || v === undefined) return null;
  const n = parseFloat(String(v));
  return isNaN(n) ? null : n;
};

const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/* Monday of the week containing `d`. */
const mondayOf = (d: Date): Date => {
  const clone = new Date(d);
  const day = clone.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  clone.setDate(clone.getDate() + diff);
  return clone;
};

/* Friday of the week containing `d`. */
const fridayOf = (d: Date): Date => {
  const mon = mondayOf(d);
  mon.setDate(mon.getDate() + 4);
  return mon;
};

const isWeekend = (d: Date): boolean => {
  const day = d.getDay();
  return day === 0 || day === 6;
};

/* ---- KV keys ---------------------------------------------------------- */

/* Per-window TTL cache (same as before). */
const windowCacheKey = (from: string, to: string) => `earnings_fmp2_${from}_${to}`;
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

/* Durable "last good" key — NOT window-scoped, no TTL. Overwritten every
   successful weekday fetch so it always holds the most recent good data.
   On weekends, the route reads this instead of hitting APIs. */
const DURABLE_KEY = 'earnings_last_good_v1';

/* ---- Market-cap map (Polygon, cached daily) --------------------------- */

const MCAP_KV_KEY = 'polygon_mcap_map_v1';
const MCAP_TTL_HOURS = 24;
const POLYGON_REF_LIMIT = 1000;
const POLYGON_REF_MAX_PAGES = 12;

interface McapMap {
  _t: number;
  caps: Record<string, number>;
}

async function loadOrBuildMcapMap(): Promise<Record<string, number>> {
  // --- Try cache ---
  try {
    const cached = await kv.get<McapMap>(MCAP_KV_KEY);
    if (cached && cached._t && (Date.now() - cached._t) < MCAP_TTL_HOURS * 3_600_000) {
      return cached.caps;
    }
  } catch {
    // KV unavailable — build fresh.
  }

  // --- Build from Polygon ---
  if (!POLYGON_KEY) return {};

  const caps: Record<string, number> = {};
  let cursor: string | null = null;
  let pages = 0;

  while (pages < POLYGON_REF_MAX_PAGES) {
    pages++;
    let url =
      `https://api.polygon.io/v3/reference/tickers` +
      `?type=CS&market=stocks&active=true&limit=${POLYGON_REF_LIMIT}` +
      `&apiKey=${POLYGON_KEY}`;
    if (cursor) url += `&cursor=${cursor}`;

    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) break;
      const data = await res.json();
      const results = data?.results;
      if (!Array.isArray(results) || results.length === 0) break;

      for (const t of results) {
        if (t.ticker && typeof t.market_cap === 'number' && t.market_cap > 0) {
          caps[t.ticker] = t.market_cap;
        }
      }

      cursor = data?.next_url
        ? new URL(data.next_url).searchParams.get('cursor')
        : null;
      if (!cursor) break;
    } catch {
      break;
    }
  }

  // --- Cache ---
  if (Object.keys(caps).length > 1000) {
    try {
      await kv.set(MCAP_KV_KEY, { _t: Date.now(), caps } as McapMap, {
        ex: Math.ceil(MCAP_TTL_HOURS * 3600),
      });
    } catch {
      // Non-fatal.
    }
  }

  return caps;
}

/* ---- Route -------------------------------------------------------------- */

export async function GET(request: Request) {
  if (!FMP_KEY) {
    return NextResponse.json(
      { error: 'Missing FMP API key — set FMP_API_KEY in environment' },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(request.url);

  const estNow = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
  );

  /* ---- Weekend guard -------------------------------------------------- */
  if (isWeekend(estNow)) {
    try {
      const durable = await kv.get<any>(DURABLE_KEY);
      if (durable && durable.payload) {
        return NextResponse.json(durable.payload);
      }
    } catch {
      // Fall through — try a live fetch as last resort.
    }
  }

  /* Default window: current trading week (Mon–Fri). The component sends
     explicit from/to when the user picks a different period. */
  const from = searchParams.get('from') || iso(mondayOf(estNow));
  const to = searchParams.get('to') || iso(fridayOf(estNow));

  /* Cache key includes the window so different date ranges don't collide.
     TTL is 4 hours rather than 12 — the current-week default means the
     component hits this more often with the same params, and a company
     rescheduling or reporting intraday should show up reasonably quickly. */
  const cacheKey = windowCacheKey(from, to);

  try {
    const cached = await kv.get<any>(cacheKey);
    if (cached && cached._t && Date.now() - cached._t < CACHE_TTL_MS) {
      return NextResponse.json(cached.payload);
    }
  } catch {
    // Fall through.
  }

  // --- FMP calendar (1 call) ---
  let raw: any[] = [];
  try {
    const url =
      `https://financialmodelingprep.com/stable/earnings-calendar` +
      `?from=${from}&to=${to}&apikey=${FMP_KEY}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      console.error(`EARNINGS_FMP: ${res.status} ${res.statusText}`);
      return NextResponse.json(
        { error: `FMP returned ${res.status}` },
        { status: 502 },
      );
    }
    const body = await res.json();
    raw = Array.isArray(body) ? body : [];
  } catch (err: any) {
    console.error('EARNINGS_FMP_ERROR:', err?.message || err);
    return NextResponse.json(
      { error: err?.message || 'Earnings calendar fetch failed' },
      { status: 500 },
    );
  }

  // --- Market-cap filter (Polygon, 0 calls if cached) ---
  const mcaps = await loadOrBuildMcapMap();
  const hasMcapData = Object.keys(mcaps).length > 0;

  const events = raw
    .filter((e: any) => {
      if (!e || !e.symbol) return false;
      if (!hasMcapData) return true;
      const cap = mcaps[e.symbol];
      return cap != null && cap >= MIN_MARKET_CAP;
    })
    .map((e: any) => ({
      symbol: String(e.symbol),
      date: e.date || null,
      name: e.symbol,
      epsEstimated: numOrNull(e.epsEstimated),
      revenueEstimated: numOrNull(e.revenueEstimated),
      epsActual: numOrNull(e.epsActual),
      epsSurprisePct: (() => {
        const actual = numOrNull(e.epsActual);
        const est = numOrNull(e.epsEstimated);
        if (actual != null && est != null && est !== 0) {
          return Math.round(((actual - est) / Math.abs(est)) * 10000) / 100;
        }
        return null;
      })(),
      importance: 0,
      mktCap: mcaps[e.symbol] || null,
    }))
    .sort((a: any, b: any) => {
      if (!a.date || !b.date) return 0;
      return a.date.localeCompare(b.date);
    });

  // --- Cache and respond ---
  const payload = {
    events,
    meta: { from, to, total: raw.length, afterFilter: events.length, hasMcapData },
  };

  if (events.length > 0) {
    try {
      /* Window-scoped TTL cache (same as before). */
      await kv.set(cacheKey, { _t: Date.now(), payload }, {
        ex: Math.ceil(CACHE_TTL_MS / 1000),
      });

      /* Durable "last good" — no TTL, overwritten every successful fetch.
         This is what the weekend guard serves. */
      await kv.set(DURABLE_KEY, { _t: Date.now(), payload });
    } catch {
      // Non-fatal.
    }
  }

  return NextResponse.json(payload);
}
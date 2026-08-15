// app/api/earnings/route.ts — v3.0
//
// Earnings calendar: FMP calendar + Polygon market-cap floor.
//
// v3.0: Fixed market-cap sourcing. The /v3/reference/tickers LIST endpoint
//       does NOT return market_cap — only the per-ticker DETAILS endpoint
//       (/v3/reference/tickers/{ticker}) does. Switched to per-symbol
//       lookups with per-symbol KV caching (7-day TTL). Cold start fetches
//       concurrently; warm path is a single batch KV read.
//
// v2.2: Weekend guard (kept). Durable "last good" payload in KV for
//       Sat/Sun serving.
//
// ---------------------------------------------------------------------------
// MARKET-CAP ENRICHMENT
//
// FMP's earnings calendar returns ~4000 events per 2-week window.
// A $1B floor filters that to the names worth watching (~200-400).
//
// Market caps come from Polygon's Ticker Details endpoint:
//   GET /v3/reference/tickers/{ticker} → results.market_cap
//
// Each symbol is cached per-symbol in KV with a 7-day TTL. The warm path
// reads all cached values via mget (one KV round-trip per 500 symbols).
// Only uncached symbols hit Polygon (fetched concurrently, 25 at a time).
// A "not found" sentinel (0) prevents re-fetching missing/OTC symbols.
//
// TOTAL API COST PER REQUEST:
//   FMP:     1 call (the calendar itself)  — 0 on weekends
//   Polygon: 0 calls (warm) / up to ~100 calls (cold, first run only)
//
// ---------------------------------------------------------------------------
// WINDOW
//
// Default is the CURRENT TRADING WEEK: Monday of this week through Friday.
// The component can override with `from` and `to` query params.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';

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

/* ---- Market-cap per-symbol (Polygon Ticker Details, KV-cached) -------- */

const MCAP_PREFIX = 'mcap:';
const MCAP_TTL_SEC = 7 * 24 * 3600;          // 7 days for valid caps
const MCAP_NOT_FOUND_TTL_SEC = 24 * 3600;    // 1 day for "not found" sentinel
const POLYGON_CONCURRENCY = 25;
const MGET_BATCH = 500;

/** Looks like a US equity ticker: no dots, 1-5 uppercase letters. */
const isUsLikeTicker = (s: string): boolean =>
  /^[A-Z]{1,5}$/.test(s);

/**
 * Resolve market caps for a list of symbols.
 *
 * 1. Batch-read KV cache (mget, 500 per round-trip).
 * 2. Fetch uncached symbols from Polygon Ticker Details (25 concurrent).
 * 3. Pipeline-write new results back to KV.
 *
 * Returns { caps, hasMcapData }.
 */
async function fetchMcaps(
  allSymbols: string[],
): Promise<{ caps: Record<string, number>; hasMcapData: boolean }> {
  if (!POLYGON_KEY || allSymbols.length === 0) {
    return { caps: {}, hasMcapData: false };
  }

  /* Only look up symbols that look like US equities. */
  const symbols = allSymbols.filter(isUsLikeTicker);
  const caps: Record<string, number> = {};
  const uncached: string[] = [];

  /* --- 1. Batch KV read ------------------------------------------------- */
  for (let i = 0; i < symbols.length; i += MGET_BATCH) {
    const batch = symbols.slice(i, i + MGET_BATCH);
    const keys = batch.map(s => `${MCAP_PREFIX}${s}`);
    try {
      const vals = await kv.mget<(number | null)[]>(...keys);
      for (let j = 0; j < batch.length; j++) {
        const v = vals[j];
        if (typeof v === 'number') {
          if (v > 0) caps[batch[j]] = v;
          // v === 0 means "not found" sentinel — skip (don't re-fetch)
        } else {
          // null = not in cache yet
          uncached.push(batch[j]);
        }
      }
    } catch {
      // KV unavailable — treat all as uncached.
      uncached.push(...batch);
    }
  }

  /* --- 2. Fetch uncached from Polygon ----------------------------------- */
  if (uncached.length > 0) {
    const deadline = Date.now() + 45_000; // stop after 45s to leave room

    const fetchOne = async (sym: string): Promise<[string, number]> => {
      try {
        const url =
          `https://api.polygon.io/v3/reference/tickers/${encodeURIComponent(sym)}` +
          `?apiKey=${POLYGON_KEY}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) return [sym, 0];
        const data = await res.json();
        const cap = data?.results?.market_cap;
        return [sym, typeof cap === 'number' && cap > 0 ? cap : 0];
      } catch {
        return [sym, 0];
      }
    };

    const newEntries: [string, number][] = [];

    for (let i = 0; i < uncached.length; i += POLYGON_CONCURRENCY) {
      if (Date.now() > deadline) break; // safety valve
      const batch = uncached.slice(i, i + POLYGON_CONCURRENCY);
      const results = await Promise.allSettled(batch.map(fetchOne));
      for (const r of results) {
        if (r.status === 'fulfilled') {
          newEntries.push(r.value);
          if (r.value[1] > 0) caps[r.value[0]] = r.value[1];
        }
      }
    }

    /* --- 3. Pipeline-write new results to KV ----------------------------- */
    if (newEntries.length > 0) {
      try {
        const pipeline = kv.pipeline();
        for (const [sym, cap] of newEntries) {
          const ttl = cap > 0 ? MCAP_TTL_SEC : MCAP_NOT_FOUND_TTL_SEC;
          pipeline.set(`${MCAP_PREFIX}${sym}`, cap, { ex: ttl });
        }
        await pipeline.exec();
      } catch {
        // Non-fatal.
      }
    }
  }

  return { caps, hasMcapData: Object.keys(caps).length > 0 };
}

/* ---- Route -------------------------------------------------------------- */

export async function GET(request: Request) {
  if (!FMP_KEY) {
    return NextResponse.json(
      { error: 'Missing FMP API key — set FMP_API_KEY in environment' },
      { status: 500, headers: noCacheHeaders() },
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
        return NextResponse.json(durable.payload, { headers: cacheHeaders(CACHE.SLOW) });
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
      return NextResponse.json(cached.payload, { headers: cacheHeaders(CACHE.SLOW) });
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
        { status: 502, headers: noCacheHeaders() },
      );
    }
    const body = await res.json();
    raw = Array.isArray(body) ? body : [];
  } catch (err: any) {
    console.error('EARNINGS_FMP_ERROR:', err?.message || err);
    return NextResponse.json(
      { error: err?.message || 'Earnings calendar fetch failed' },
      { status: 500, headers: noCacheHeaders() },
    );
  }

  // --- Market-cap filter (Polygon per-symbol, KV-cached) ---
  const allSymbols = Array.from(new Set(raw.map((e: any) => e.symbol).filter(Boolean))) as string[];
  const { caps: mcaps, hasMcapData } = await fetchMcaps(allSymbols);

  const events = raw
    .filter((e: any) => {
      if (!e || !e.symbol) return false;
      if (!hasMcapData) return true; // fail-open only if Polygon key missing
      const cap = mcaps[e.symbol];
      return cap != null && cap >= MIN_MARKET_CAP;
    })
    .map((e: any) => ({
      symbol: String(e.symbol),
      date: e.date || null,
      name: e.name || e.symbol,
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

  return NextResponse.json(payload, { headers: cacheHeaders(CACHE.SLOW) });
}

// app/api/earnings/route.ts — v2.0
//
// Earnings calendar, now powered by FMP's /stable/earnings-calendar.
//
// ---------------------------------------------------------------------------
// WHY THIS REPLACED BENZINGA
//
// The Benzinga earnings endpoint sits behind the same credential as the news
// endpoint, which returns an empty JSON array for a key without the news
// product. fetchEarningsCalendar in the scanner and this route swallowed
// errors and returned empty on failure, so a dead credential was
// indistinguishable from a quiet earnings week. earningsMatched: 0 across
// every scan confirmed it — zero matches in early August, one of the
// heaviest earnings weeks of the year.
//
// FMP's /stable/earnings-calendar is on a credential that already works (the
// dashboard uses FMP for fundamentals), and the response shape is closer to
// what the component needs — `epsEstimated`, `revenueEstimated`, `epsActual`
// are already named that way, so the mapping is thinner than the Benzinga
// version.
//
// ---------------------------------------------------------------------------
// THE RESPONSE SHAPE IS DELIBERATELY IDENTICAL to the old route's output, so
// EarningsCalendar.tsx needs no changes at all. Same field names, same
// types, same sort order.
//
// ---------------------------------------------------------------------------
// TWO CONSUMERS, ONE SOURCE
//
// This route serves the EarningsCalendar component directly. The SECOND
// consumer is the scanner's fetchEarningsCalendar, which drives the
// earnings-week blackout and the CNF earnings component (+5). That function
// still calls Benzinga separately and is probably also dead — it should be
// pointed at this route or at FMP directly. Not done in this commit because
// the scanner is a separate deploy risk.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

/* 12 hours — the calendar changes at most once a day when a company
   reschedules, and that is rare enough that same-day freshness is more than
   adequate. Matches the component's own polling interval. */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

const FMP_KEY = (
  process.env.FMP_API_KEY ||
  process.env.NEXT_PUBLIC_FMP_API_KEY ||
  ''
).trim();

const numOrNull = (v: any): number | null => {
  if (v === '' || v === null || v === undefined) return null;
  const n = parseFloat(String(v));
  return isNaN(n) ? null : n;
};

const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export async function GET(request: Request) {
  if (!FMP_KEY) {
    return NextResponse.json(
      { error: 'Missing FMP API key — set FMP_API_KEY in environment' },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);

  const estNow = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })
  );

  /* Default window: 3 days back (catch anything that reported over the
     weekend or that was missed) through 45 days forward. */
  const defFrom = new Date(estNow);
  defFrom.setDate(estNow.getDate() - 3);
  const defTo = new Date(estNow);
  defTo.setDate(estNow.getDate() + 45);

  const from = searchParams.get('from') || iso(defFrom);
  const to = searchParams.get('to') || iso(defTo);

  const cacheKey = `earnings_fmp_${from}_${to}`;

  // --- Cache check ---
  try {
    const cached = await kv.get<any>(cacheKey);
    if (cached && cached._t && Date.now() - cached._t < CACHE_TTL_MS) {
      return NextResponse.json(cached.events);
    }
  } catch {
    // KV unavailable — fall through and fetch fresh.
  }

  // --- Fetch from FMP ---
  try {
    const url =
      `https://financialmodelingprep.com/stable/earnings-calendar` +
      `?from=${from}&to=${to}&apikey=${FMP_KEY}`;

    const res = await fetch(url, { cache: 'no-store' });

    if (!res.ok) {
      console.error(`EARNINGS_FMP: ${res.status} ${res.statusText}`);
      return NextResponse.json(
        { error: `FMP returned ${res.status}` },
        { status: 502 }
      );
    }

    const raw = await res.json();

    if (!Array.isArray(raw)) {
      console.error('EARNINGS_FMP: response is not an array');
      return NextResponse.json(
        { error: 'Unexpected FMP response shape' },
        { status: 502 }
      );
    }

    /* Map to the SAME SHAPE the component already reads, so nothing
       downstream needs to change. Field names are intentionally identical
       to the old Benzinga-backed route's output.

       FMP's `symbol` can contain a hyphen (BRK-B) which is fine — the
       component handles it. `fiscalDateEnding` and `updatedFromDate` are
       available but not used; the component only needs the report date.

       SORTING BY DATE ASC is what the old route did and what the
       component expects for its week-grouping logic. */
    const events = raw
      .filter((e: any) => e && e.symbol)
      .map((e: any) => ({
        symbol: String(e.symbol),
        date: e.date || null,
        name: e.symbol, // FMP doesn't return company name on this endpoint
        epsEstimated: numOrNull(e.epsEstimated),
        revenueEstimated: numOrNull(e.revenueEstimated),
        epsActual: numOrNull(e.epsActual),
        epsSurprisePct: (() => {
          /* FMP doesn't return a surprise percentage directly on the
             /stable/earnings-calendar endpoint. Compute it when both
             values exist, which they will for reported earnings. */
          const actual = numOrNull(e.epsActual);
          const est = numOrNull(e.epsEstimated);
          if (actual != null && est != null && est !== 0) {
            return Math.round(((actual - est) / Math.abs(est)) * 10000) / 100;
          }
          return null;
        })(),
        importance: 0, // FMP doesn't have an importance score
      }))
      .sort((a: any, b: any) => {
        if (!a.date || !b.date) return 0;
        return a.date.localeCompare(b.date);
      });

    // --- Cache ---
    if (events.length > 0) {
      try {
        await kv.set(cacheKey, { _t: Date.now(), events }, { ex: Math.ceil(CACHE_TTL_MS / 1000) });
      } catch {
        // Non-fatal — next request just re-fetches.
      }
    }

    return NextResponse.json(events);
  } catch (err: any) {
    console.error('EARNINGS_FMP_ERROR:', err?.message || err);
    return NextResponse.json(
      { error: err?.message || 'Earnings calendar fetch failed' },
      { status: 500 }
    );
  }
}
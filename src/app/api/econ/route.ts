// ---------------------------------------------------------------------------
// Economic calendar — Benzinga-backed
// v1.1
//
// Returns rows shaped EXACTLY like the old FMP payload
// (event/date/country/currency/actual/previous/estimate/impact) so the
// EconomicCalendar component's existing mapper/filter keeps working. The
// response is still a bare array — contract unchanged.
//
// v1.1 FIXES:
//   (a) + pagesize=1000. This was the bug. Benzinga's default page is small
//       and the endpoint returns GLOBAL events, while the US filter runs
//       client-side AFTER the fetch — so non-US rows consumed the entire page
//       budget and only a single day's cluster survived. A 14-day window was
//       returning 12 events, all from one date nine days out, with today's
//       FOMC decision nowhere in it.
//   (b) + pagination loop as a backstop, in case 1000 is still short on a
//       heavy window.
//   (c) Results sorted ascending by datetime. Benzinga's ordering isn't
//       guaranteed, and an unsorted calendar renders in arbitrary order.
//   (d) + dedupe. Paginated responses can repeat rows at page boundaries.
//   (e) Impact cutoffs corrected: Benzinga importance runs 0–5, so `>= 3`
//       was flagging mid-tier releases as High. Now 5 = High, 3–4 = Medium.
//       Rate decisions and NFP carry 5, so the High tab becomes meaningful
//       instead of containing half the calendar.
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min — matches the component's refresh

const PAGE_SIZE = 1000;
const MAX_PAGES = 5;

// Benzinga importance runs 0–5 (5 = most market-moving: rate decisions, CPI,
// NFP). The old `>= 3` cutoff put mid-tier releases in the High tab alongside
// them, which made the tab useless for spotting the events that actually stop
// a session.
const mapImpact = (importance: any): 'High' | 'Medium' | 'Low' => {
  const n = Number(importance);
  if (!Number.isNaN(n)) {
    if (n >= 5) return 'High';
    if (n >= 3) return 'Medium';
    return 'Low';
  }
  return 'Low';
};

const numOrNull = (v: any): number | null => {
  if (v === '' || v === null || v === undefined) return null;
  const n = parseFloat(String(v));
  return isNaN(n) ? null : n;
};

const isUS = (country: any): boolean => {
  const c = String(country || '').toUpperCase().trim();
  return c === 'US' || c === 'USA' || c === 'UNITED STATES';
};

const fetchSafeJson = async (url: string, headers: Record<string, string>, fallback: any, timeoutMs = 12000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal as any, headers, cache: 'no-store' });
    clearTimeout(id);
    if (!res.ok) return fallback;
    return await res.json();
  } catch (e) {
    clearTimeout(id);
    return fallback;
  }
};

export async function GET(request: Request) {
  const token = (process.env.BENZINGA_API_KEY || process.env.NEXT_PUBLIC_BENZINGA_API_KEY || '').trim();
  if (!token) return NextResponse.json({ error: 'Missing Benzinga key' }, { status: 500 });

  const { searchParams } = new URL(request.url);
  // Default rolling window if the client doesn't pass one.
  const estNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const defFrom = new Date(estNow); defFrom.setDate(estNow.getDate() - 4);
  const defTo = new Date(estNow); defTo.setDate(estNow.getDate() + 10);
  const from = searchParams.get('from') || iso(defFrom);
  const to = searchParams.get('to') || iso(defTo);

  // Cache key bumped to v2 so the broken single-day payloads currently sitting
  // in KV don't keep being served after this deploys.
  const cacheKey = `econ_bz_v2_${from}_${to}`;

  // Serve fresh cache without hitting Benzinga.
  try {
    const cached = await kv.get<any>(cacheKey);
    if (cached && cached._t && Date.now() - cached._t < CACHE_TTL_MS) {
      return NextResponse.json(cached.events);
    }
  } catch (e) {
    // fall through
  }

  // Benzinga needs the JSON accept header or it returns XML; auth via token
  // query param. pagesize is the fix — without it the default page is far too
  // small for a two-week global calendar.
  const raw: any[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const url =
      `https://api.benzinga.com/api/v2/calendar/economics?token=${token}` +
      `&parameters[date_from]=${from}&parameters[date_to]=${to}` +
      `&pagesize=${PAGE_SIZE}&page=${page}`;

    const data = await fetchSafeJson(url, { accept: 'application/json' }, {});
    const batch = Array.isArray(data?.economics) ? data.economics : [];
    if (batch.length === 0) break;
    raw.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }

  // Map Benzinga -> the FMP-style row the component already understands.
  const mapped = raw
    .filter((e: any) => isUS(e.country))
    .map((e: any) => {
      const dateStr = e.time ? `${e.date} ${e.time}` : `${e.date} 00:00:00`;
      return {
        event: e.event_name || e.event || 'Economic Event',
        date: dateStr,
        country: 'US',
        currency: 'USD',
        actual: numOrNull(e.actual),
        previous: numOrNull(e.prior),
        estimate: numOrNull(e.consensus),
        impact: mapImpact(e.importance),
      };
    });

  // Dedupe on name+datetime — page boundaries can repeat rows.
  const seen = new Set<string>();
  const events = mapped
    .filter((e) => {
      const key = `${e.date}|${e.event}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  // Only cache a non-empty result so a transient empty response doesn't stick.
  if (events.length > 0) {
    try {
      await kv.set(cacheKey, { _t: Date.now(), events });
    } catch (e) {
      // non-fatal
    }
  }

  return NextResponse.json(events);
}
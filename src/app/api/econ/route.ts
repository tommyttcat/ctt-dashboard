// Deploy to: app/api/econ/route.ts
//
// Benzinga-backed economic calendar (replaces the FMP economic-calendar call).
// Server-side + KV-cached, and it returns rows shaped EXACTLY like the old FMP
// payload (event/date/country/currency/actual/previous/estimate/impact), so the
// EconomicCalendar component's existing mapper/filter works with almost no change.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min — matches the component's refresh

// Benzinga importance is roughly 0–5 (5 = most market-moving). Map to the
// High/Medium/Low buckets the component tabs on. Tune the cutoffs if you want
// more/fewer events in the High tab.
const mapImpact = (importance: any): 'High' | 'Medium' | 'Low' => {
  const n = Number(importance);
  if (!isNaN(n)) {
    if (n >= 3) return 'High';
    if (n === 2) return 'Medium';
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

  const cacheKey = `econ_bz_${from}_${to}`;

  // Serve fresh cache without hitting Benzinga.
  try {
    const cached = await kv.get<any>(cacheKey);
    if (cached && cached._t && Date.now() - cached._t < CACHE_TTL_MS) {
      return NextResponse.json(cached.events);
    }
  } catch (e) {
    // fall through
  }

  // Benzinga needs the JSON accept header or it returns XML; auth via token query param.
  const url = `https://api.benzinga.com/api/v2/calendar/economics?token=${token}&parameters[date_from]=${from}&parameters[date_to]=${to}`;
  const data = await fetchSafeJson(url, { accept: 'application/json' }, {});

  const raw = Array.isArray(data?.economics) ? data.economics : [];

  // Map Benzinga -> the FMP-style row the component already understands.
  const events = raw
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
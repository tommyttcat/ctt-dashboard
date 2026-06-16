// Deploy to: app/api/earnings/route.ts
//
// Benzinga-backed earnings calendar (replaces the FMP earnings-calendar call).
// Server-side + KV-cached. Returns rows shaped like the old FMP payload
// (symbol/date/epsEstimated/revenueEstimated) PLUS the new fields needed for
// actual + beat/miss: epsActual, epsSurprisePct. Market-cap enrichment still
// happens client-side via Massive, exactly as before.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h — matches the component's refresh

const numOrNull = (v: any): number | null => {
  if (v === '' || v === null || v === undefined) return null;
  const n = parseFloat(String(v));
  return isNaN(n) ? null : n;
};

const fetchSafeJson = async (url: string, headers: Record<string, string>, fallback: any, timeoutMs = 15000) => {
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
  const estNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const defFrom = new Date(estNow); defFrom.setDate(estNow.getDate() - 3);
  const defTo = new Date(estNow); defTo.setDate(estNow.getDate() + 45);
  const from = searchParams.get('from') || iso(defFrom);
  const to = searchParams.get('to') || iso(defTo);

  const cacheKey = `earnings_bz_${from}_${to}`;

  try {
    const cached = await kv.get<any>(cacheKey);
    if (cached && cached._t && Date.now() - cached._t < CACHE_TTL_MS) {
      return NextResponse.json(cached.events);
    }
  } catch (e) {
    // fall through
  }

  // Benzinga needs the JSON accept header (else XML); auth via token query param.
  // pagesize maxes the window so a busy earnings week comes back in one call.
  const url = `https://api.benzinga.com/api/v2/calendar/earnings?token=${token}&parameters[date_from]=${from}&parameters[date_to]=${to}&pagesize=1000`;
  const data = await fetchSafeJson(url, { accept: 'application/json' }, {});

  const raw = Array.isArray(data?.earnings) ? data.earnings : [];

  const events = raw
    .map((e: any) => ({
      symbol: e.ticker,
      date: e.date,
      name: e.name || e.ticker,
      epsEstimated: numOrNull(e.eps_est),
      revenueEstimated: numOrNull(e.revenue_est),
      epsActual: numOrNull(e.eps),
      epsSurprisePct: numOrNull(e.eps_surprise_percent),
      importance: Number(e.importance) || 0,
    }))
    .filter((e: any) => e.symbol);

  if (events.length > 0) {
    try {
      await kv.set(cacheKey, { _t: Date.now(), events });
    } catch (e) {
      // non-fatal
    }
  }

  return NextResponse.json(events);
}
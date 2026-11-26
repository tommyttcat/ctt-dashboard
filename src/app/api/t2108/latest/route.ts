// app/api/t2108/latest/route.ts — v1.0
//
// Read-only KV fetch for T2108, written by the swing-candidates run route.
// Separate endpoint so the Scorecard can poll it without touching the swing
// payload (which is a 40-row array it has no use for).

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function GET() {
  try {
    const t = await kv.get<any>('t2108_v1');
    /* From the daily history (25 Nov 2026): the previous session's reading,
       for the up/down colour, and the lowest of the last 15 sessions, for
       "from X%". Absent until the scan has written a history. */
    const hist: [string, number][] = Array.isArray(t?.hist) ? t.hist : [];
    const prev = hist.length >= 2 ? hist[hist.length - 2][1] : null;
    const lowRow = hist.slice(-15).reduce<[string, number] | null>((m, h) => (m == null || h[1] < m[1] ? h : m), null);
    return NextResponse.json({
      asOf: hist.length ? hist[hist.length - 1][0] : null,
      prev,
      low: lowRow ? { value: lowRow[1], date: lowRow[0] } : null,
      success: true,
      value: t?.value ?? null,
      zone: t?.zone ?? 'unknown',
      above: t?.above ?? null,
      total: t?.total ?? null,
      updatedAt: t?.updatedAt ?? null,
    }, { headers: cacheHeaders(CACHE.SCAN) });
  } catch (error: any) {
    console.error('T2108_LATEST_ERROR:', error);
    return NextResponse.json(
      { success: false, error: error.message, value: null },
      { status: 500, headers: noCacheHeaders() }
    );
  }
}
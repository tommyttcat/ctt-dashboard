// app/api/hrs/latest/route.ts — v1.0
//
// KV read for the Hidden Relative Strength scan. Same pattern as
// /api/vcp/latest — serves cached data, never triggers a scan.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function GET() {
  try {
    const [candidates, lastScanTime, meta] = await Promise.all([
      kv.get<any[]>('hrs_results_v1'),
      kv.get<number>('hrs_last_scan_v1'),
      kv.get<any>('hrs_meta_v1'),
    ]);

    return NextResponse.json(
      {
        success: true,
        candidates: Array.isArray(candidates) ? candidates : [],
        lastScanTime: lastScanTime ?? null,
        count: Array.isArray(candidates) ? candidates.length : 0,
        scanMeta: meta ? { hrs: meta } : null,
        regime: meta?.regime ?? null,
        universe: meta?.universe ?? null,
        prefiltered: meta?.prefiltered ?? null,
        confirmed: meta?.confirmed ?? null,
      },
      { headers: cacheHeaders(CACHE.SCAN) }
    );
  } catch (error: any) {
    console.error('HRS_LATEST_ERROR:', error);
    return NextResponse.json(
      { success: false, error: error.message, candidates: [] },
      { status: 500, headers: noCacheHeaders() }
    );
  }
}

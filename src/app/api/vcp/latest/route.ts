// app/api/vcp/latest/route.ts — v1.0
//
// KV read for the VCP scan. Mirrors /api/swing-candidates/latest and
// /api/ep9m/latest.
//
// Deliberately does NOT fall back to running the scan when the cache is
// empty. The VCP run touches ~150 market-wide grouped calls plus per-ticker
// history and takes a minute or more; triggering that from a component poll
// would mean every page load on a cold cache fires a full market scan, and
// several tabs open at once would fire several. The scan runs on its own
// schedule; this endpoint reports what it last produced.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function GET() {
  try {
    const [candidates, lastScanTime, meta] = await Promise.all([
      kv.get<any[]>('vcp_v1'),
      kv.get<number>('vcp_last_scan_v1'),
      kv.get<any>('vcp_meta_v1'),
    ]);

    return NextResponse.json(
      {
        success: true,
        candidates: Array.isArray(candidates) ? candidates : [],
        lastScanTime: lastScanTime ?? null,
        count: Array.isArray(candidates) ? candidates.length : 0,
        // `scanMeta.vcp` mirrors the shape the other latest routes use, so
        // MetricsKey can read liveGates the same way everywhere.
        scanMeta: meta ? { vcp: meta } : null,
        universe: meta?.universe ?? null,
        prefiltered: meta?.prefiltered ?? null,
        confirmed: meta?.confirmed ?? null,
      },
      { headers: cacheHeaders(CACHE.SCAN) }
    );
  } catch (error: any) {
    console.error('VCP_LATEST_ERROR:', error);
    return NextResponse.json(
      { success: false, error: error.message, candidates: [] },
      { status: 500, headers: noCacheHeaders() }
    );
  }
}
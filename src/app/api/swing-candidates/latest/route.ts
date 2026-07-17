import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

// ABSOLUTE CACHE ANNIHILATION (matching scanner/latest)
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export async function GET() {
  try {
    const candidates = await kv.get('swing_candidates_v1') || [];
    const meta: any = await kv.get('swing_meta_v1') || {};
    const lastScanTime = await kv.get('swing_last_scan_v1') || null;

    return NextResponse.json({
      success: true,
      lastScanTime: lastScanTime,
      candidates: candidates,
      spyReturn3M: meta.spyReturn3M ?? null,
      universeSize: meta.universeSize ?? 0,
      excludedForEarnings: meta.excludedForEarnings ?? 0,
      count: meta.count ?? (Array.isArray(candidates) ? candidates.length : 0),
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Surrogate-Control': 'no-store'
      }
    });
  } catch (error: any) {
    console.error("SWING_LATEST_ROUTE_ERROR:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
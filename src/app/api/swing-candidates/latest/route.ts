import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { SWING_META } from '@/lib/scanConfig';

// ABSOLUTE CACHE ANNIHILATION (matching scanner/latest)
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export async function GET() {
  try {
    // Parallel reads — three sequential awaits meant three KV round trips on
    // every 60-second poll from every open tab.
    const [candidates, meta, lastScanTime] = await Promise.all([
      kv.get('swing_candidates_v1'),
      kv.get<any>('swing_meta_v1'),
      kv.get('swing_last_scan_v1'),
    ]);

    const m = meta || {};
    const list = candidates || [];

    // Scan-gate metadata for the on-screen "?" key. Prefer what the last run
    // persisted — that is the config the scan ACTUALLY enforced. Fall back to
    // the static import so a cold KV still renders a key.
    const scanMeta = m.scanMeta ?? SWING_META;

    return NextResponse.json({
      success: true,
      lastScanTime: lastScanTime || null,
      candidates: list,
      spyReturn3M: m.spyReturn3M ?? null,
      universeSize: m.universeSize ?? 0,
      excludedForEarnings: m.excludedForEarnings ?? 0,
      count: m.count ?? (Array.isArray(list) ? list.length : 0),
      scanMeta,
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
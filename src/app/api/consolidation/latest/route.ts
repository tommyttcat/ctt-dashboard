import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { CONSOL_META } from '@/lib/scanConfig';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export async function GET() {
  try {
    const [candidates, meta, lastScanTime] = await Promise.all([
      kv.get<any[]>('consol_1021_v1'),
      kv.get<any>('consol_1021_meta_v1'),
      kv.get<number>('consol_1021_last_scan_v1'),
    ]);

    // Scan-gate metadata for the on-screen "?" key. Prefer what the last run
    // persisted — that is the config the scan ACTUALLY enforced. Fall back to
    // the static import so a cold KV still renders a key.
    const scanMeta = meta?.scanMeta ?? CONSOL_META;

    return NextResponse.json({
      success: true,
      candidates: candidates || [],
      count: meta?.count ?? (candidates ? candidates.length : 0),
      lastScanTime: lastScanTime || null,
      scanMeta,
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Surrogate-Control': 'no-store',
      },
    });
  } catch (error: any) {
    console.error("CONSOL_LATEST_ROUTE_ERROR:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
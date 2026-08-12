// app/api/multibagger/latest/route.ts — v1.0
//
// Read-only KV fetch for the 100-Bagger Scorecard. Mirrors the shape of
// the other latest endpoints. Never triggers a scan — if the run route
// hasn't executed yet, this returns an empty list with success:true.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { MULTIBAGGER_META } from '@/lib/scanConfig';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function GET() {
  const noStoreHeaders = {
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  };

  try {
    const [candidates, lastScanTime, meta, liveChgMap] = await Promise.all([
      kv.get<any[]>('multibagger_v1'),
      kv.get<number>('multibagger_last_scan_v1'),
      kv.get<any>('multibagger_meta_v1'),
      kv.get<Record<string, [number, number]>>('live_chg_map_v1'),
    ]);

    const scanMeta = meta?.scanMeta ?? MULTIBAGGER_META;

    let list = Array.isArray(candidates) ? candidates : [];
    if (liveChgMap && list.length) {
      list = list.map((c: any) => {
        const live = liveChgMap[c.ticker];
        return live ? { ...c, changePct: live[0] } : c;
      });
    }

    return NextResponse.json({
      success: true,
      candidates: list,
      lastScanTime: lastScanTime || null,
      count: meta?.count ?? (Array.isArray(candidates) ? candidates.length : 0),
      universeSize: meta?.universeSize ?? null,
      mcapFiltered: meta?.mcapFiltered ?? null,
      scored: meta?.scored ?? null,
      scanMeta,
    }, { headers: noStoreHeaders });
  } catch (error: any) {
    console.error('MULTIBAGGER_LATEST_ERROR:', error);
    return NextResponse.json(
      { success: false, error: error.message, candidates: [] },
      { status: 500, headers: noStoreHeaders },
    );
  }
}

// app/api/dvol/latest/route.ts — v1.0
//
// Read-only KV fetch for the Dollar Volume card. Mirrors the other latest
// endpoints: never triggers a scan, and returns an empty list with
// success:true when the run route has not executed yet.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function GET() {
  try {
    const [rows, lastScanTime, meta, liveChgMap] = await Promise.all([
      kv.get<any[]>('dvol_rows_v1'),
      kv.get<number>('dvol_last_scan_v1'),
      kv.get<any>('dvol_meta_v1'),
      kv.get<Record<string, [number, number]>>('live_chg_map_v1'),
    ]);

    /* Same live-change overlay the other cards use, so an intraday reload does
       not show a change percentage from the last completed session. */
    let list = Array.isArray(rows) ? rows : [];
    if (liveChgMap && list.length) {
      list = list.map(r => {
        const live = liveChgMap[r.ticker];
        return live ? { ...r, changePct: live[0] } : r;
      });
    }

    return NextResponse.json(
      {
        success: true,
        rows: list,
        lastScanTime: lastScanTime || null,
        count: list.length,
        ...(meta ?? {}),
      },
      // LIVE rather than SCAN: the rows above are overlaid with liveChgMap.
      { headers: cacheHeaders(CACHE.LIVE) },
    );
  } catch (error: any) {
    console.error('DVOL_LATEST_ERROR:', error);
    return NextResponse.json(
      { success: false, error: error.message, rows: [] },
      { status: 500, headers: noCacheHeaders() },
    );
  }
}

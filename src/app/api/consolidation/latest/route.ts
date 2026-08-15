import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { CONSOL_META } from '@/lib/scanConfig';
import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export async function GET() {
  try {
    const [candidates, meta, lastScanTime, liveChgMap] = await Promise.all([
      kv.get<any[]>('consol_1021_v1'),
      kv.get<any>('consol_1021_meta_v1'),
      kv.get<number>('consol_1021_last_scan_v1'),
      kv.get<Record<string, [number, number]>>('live_chg_map_v1'),
    ]);

    /* Live overlay applied server-side — see swing-candidates/latest for why.
       Keeps the 235 KB liveChgMap off /api/scanner/latest and off the wire. */
    let list: any[] = Array.isArray(candidates) ? candidates : [];
    if (liveChgMap && list.length) {
      list = list.map((c: any) => {
        /* These rows key on `symbol`, not `ticker` — mirrors MarketSummary's
           tickerOf() helper. Indexing on c.ticker alone silently matched
           nothing and left the scan's stale price in place. */
        const t = c.ticker ?? c.symbol;
        const live = t ? liveChgMap[t] : undefined;
        return live ? { ...c, changePct: live[0], price: live[1] } : c;
      });
    }

    // Scan-gate metadata for the on-screen "?" key. Prefer what the last run
    // persisted — that is the config the scan ACTUALLY enforced. Fall back to
    // the static import so a cold KV still renders a key.
    const scanMeta = meta?.scanMeta ?? CONSOL_META;

    return NextResponse.json({
      success: true,
      candidates: list,
      count: meta?.count ?? list.length,
      lastScanTime: lastScanTime || null,
      scanMeta,
    }, {
      headers: cacheHeaders(CACHE.SCAN),
    });
  } catch (error: any) {
    console.error("CONSOL_LATEST_ROUTE_ERROR:", error);
    return NextResponse.json({ success: false, error: error.message }, {
      status: 500,
      headers: noCacheHeaders(),
    });
  }
}
import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { SWING_META } from '@/lib/scanConfig';
import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';

// Edge-cacheable (matching scanner/latest) — see lib/httpCache.
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export async function GET() {
  try {
    // Parallel reads — three sequential awaits meant three KV round trips on
    // every 60-second poll from every open tab.
    const [candidates, meta, lastScanTime, liveChgMap] = await Promise.all([
      kv.get('swing_candidates_v1'),
      kv.get<any>('swing_meta_v1'),
      kv.get('swing_last_scan_v1'),
      kv.get<Record<string, [number, number]>>('live_chg_map_v1'),
    ]);

    const m = meta || {};
    let list: any[] = Array.isArray(candidates) ? candidates : [];

    /* Live overlay applied here rather than on the client. It used to happen in
       MarketSummary, which meant /api/scanner/latest had to ship the entire
       12,122-ticker liveChgMap (235 KB) to every browser just so a handful of
       swing rows could be patched. Same pattern as multibagger/latest and
       dvol/latest — the map is read server-side and only the result crosses
       the wire. */
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
      headers: cacheHeaders(CACHE.SCAN),
    });
  } catch (error: any) {
    console.error("SWING_LATEST_ROUTE_ERROR:", error);
    return NextResponse.json({ success: false, error: error.message }, {
      status: 500,
      headers: noCacheHeaders(),
    });
  }
}
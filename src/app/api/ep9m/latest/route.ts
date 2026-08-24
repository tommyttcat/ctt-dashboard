// app/api/ep9m/latest/route.ts — v1.1
//
// Read-only KV fetch for the EP9M section. Mirrors the shape of the
// consolidation and swing-candidates latest endpoints so the component's
// fetch logic is identical to its siblings.
//
// Never triggers a scan. If the run route hasn't executed yet, this returns
// an empty list with success:true — an empty EP9M list is a legitimate result
// (early in the session nothing has traded 9M shares yet), not an error state.
//
// v1.1: + scanMeta passthrough for the on-screen "?" key.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { EP9M_META } from '@/lib/scanConfig';
import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function GET() {
  try {
    const [candidates, lastScanTime, meta, registry] = await Promise.all([
      kv.get<any[]>('ep9m_v1'),
      kv.get<number>('ep9m_last_scan_v1'),
      kv.get<any>('ep9m_meta_v1'),
      kv.get<any[]>('ep9m_registry_v1'),
    ]);

    const scanMeta = meta?.scanMeta ?? EP9M_META;

    const regArr = Array.isArray(registry) ? registry : [];
    const repeatMap: Record<string, { count: number; events: { date: string; price: number; vol: number; rvol: number; score: number }[] }> = {};
    for (const e of regArr) {
      const t = e.ticker;
      if (!t) continue;
      if (!repeatMap[t]) repeatMap[t] = { count: 0, events: [] };
      repeatMap[t].count++;
      repeatMap[t].events.push({ date: e.date, price: e.price, vol: e.vol, rvol: e.rvol, score: e.score });
    }
    for (const v of Object.values(repeatMap)) {
      v.events.sort((a, b) => a.date.localeCompare(b.date));
    }

    return NextResponse.json({
      success: true,
      candidates: Array.isArray(candidates) ? candidates : [],
      lastScanTime: lastScanTime || null,
      raw9m: meta?.raw9m ?? null,
      shortlisted: meta?.shortlisted ?? null,
      count: meta?.count ?? (Array.isArray(candidates) ? candidates.length : 0),
      minRvol: meta?.minRvol ?? null,
      minVolume: meta?.minVolume ?? null,
      registrySize: regArr.length,
      repeatPivots: repeatMap,
      scanMeta,
    }, { headers: cacheHeaders(CACHE.SCAN) });
  } catch (error: any) {
    console.error('EP9M_LATEST_ERROR:', error);
    return NextResponse.json(
      { success: false, error: error.message, candidates: [] },
      { status: 500, headers: noCacheHeaders() }
    );
  }
}
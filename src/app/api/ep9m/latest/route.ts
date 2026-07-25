// app/api/ep9m/latest/route.ts — v1.0
//
// Read-only KV fetch for the EP9M section. Mirrors the shape of the
// consolidation and swing-candidates latest endpoints so the component's
// fetch logic is identical to its siblings.
//
// Never triggers a scan. If the run route hasn't executed yet, this returns
// an empty list with success:true — an empty EP9M list is a legitimate result
// (early in the session nothing has traded 9M shares yet), not an error state.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

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
    const [candidates, lastScanTime, meta, registry] = await Promise.all([
      kv.get<any[]>('ep9m_v1'),
      kv.get<number>('ep9m_last_scan_v1'),
      kv.get<any>('ep9m_meta_v1'),
      kv.get<any[]>('ep9m_registry_v1'),
    ]);

    return NextResponse.json({
      success: true,
      candidates: Array.isArray(candidates) ? candidates : [],
      lastScanTime: lastScanTime || null,
      // Funnel diagnostics — how many cleared 9M shares vs how many of those
      // were actually abnormal. Surfaced in the header so a thin list reads as
      // "the tape was quiet" rather than "the scan is broken".
      raw9m: meta?.raw9m ?? null,
      shortlisted: meta?.shortlisted ?? null,
      count: meta?.count ?? (Array.isArray(candidates) ? candidates.length : 0),
      minRvol: meta?.minRvol ?? null,
      minVolume: meta?.minVolume ?? null,
      registrySize: Array.isArray(registry) ? registry.length : 0,
    }, { headers: noStoreHeaders });
  } catch (error: any) {
    console.error('EP9M_LATEST_ERROR:', error);
    return NextResponse.json(
      { success: false, error: error.message, candidates: [] },
      { status: 500, headers: noStoreHeaders }
    );
  }
}
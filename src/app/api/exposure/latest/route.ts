// app/api/exposure/latest/route.ts — the Market exposure strip's data.
// One KV read per CDN miss (SLOW: it changes once a night), flat in users.
// The forward record stays out of this payload (it is hidden; see nightly ?view=1).

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';
import { EXPOSURE_KEY, type ExposureState } from '@/lib/exposure';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const s = await kv.get<ExposureState>(EXPOSURE_KEY);
    if (!s) return NextResponse.json({ success: true, state: null }, { headers: cacheHeaders(CACHE.SLOW) });
    const { record: _record, ...state } = s;
    void _record;
    return NextResponse.json({ success: true, state }, { headers: cacheHeaders(CACHE.SLOW) });
  } catch (e) {
    console.error('EXPOSURE_LATEST_ERROR', e);
    return NextResponse.json({ success: false, state: null }, { status: 500, headers: noCacheHeaders() });
  }
}

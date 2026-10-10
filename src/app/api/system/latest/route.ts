// app/api/system/latest/route.ts — the System card's data. One KV read per CDN miss (SLOW), flat in users.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';
import { SYSTEM_KEY, liveRecord, type SystemState } from '@/lib/system';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const s = await kv.get<SystemState>(SYSTEM_KEY);
    if (!s) return NextResponse.json({ success: true, state: null }, { headers: cacheHeaders(CACHE.SLOW) });
    const { history, ...rest } = s;
    return NextResponse.json({ success: true, state: rest, record: liveRecord(history ?? []) }, { headers: cacheHeaders(CACHE.SLOW) });
  } catch (e) {
    console.error('SYSTEM_LATEST_ERROR', e);
    return NextResponse.json({ success: false, state: null }, { status: 500, headers: noCacheHeaders() });
  }
}

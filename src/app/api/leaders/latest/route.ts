// app/api/leaders/latest/route.ts — the Liquid Leaders lists for the page.
// One KV read per CDN miss (60s), so flat in users.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';
import { LEADERS_LIVE_KEY, type LeadersLive } from '@/lib/leaders';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const live = await kv.get<LeadersLive>(LEADERS_LIVE_KEY);
    return NextResponse.json({ success: true, live: live ?? null }, { headers: cacheHeaders(CACHE.SCAN) });
  } catch (e) {
    console.error('LEADERS_LATEST_ERROR', e);
    return NextResponse.json({ success: false, live: null }, { status: 500, headers: noCacheHeaders() });
  }
}

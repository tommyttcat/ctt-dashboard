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
    const { history, colours, ...rest } = s;
    const col = colours ? { since: colours.since, days: colours.daily.length, green: colours.nav[0] - 1, yellow: colours.nav[1] - 1, red: colours.nav[2] - 1 } : null;
    return NextResponse.json({ success: true, state: rest, record: liveRecord(history ?? []), colours: col }, { headers: cacheHeaders(CACHE.SLOW) });
  } catch (e) {
    console.error('SYSTEM_LATEST_ERROR', e);
    return NextResponse.json({ success: false, state: null }, { status: 500, headers: noCacheHeaders() });
  }
}

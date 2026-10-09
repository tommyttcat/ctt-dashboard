// app/api/momentum/latest/route.ts — Momentum Leaders for the page.
// One KV read per CDN miss (SLOW: the list changes once a night), so flat in users.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';
import { MOMENTUM_KEY, type MomentumList } from '@/lib/momentum';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const list = await kv.get<MomentumList>(MOMENTUM_KEY);
    return NextResponse.json({ success: true, list: list ?? null }, { headers: cacheHeaders(CACHE.SLOW) });
  } catch (e) {
    console.error('MOMENTUM_LATEST_ERROR', e);
    return NextResponse.json({ success: false, list: null }, { status: 500, headers: noCacheHeaders() });
  }
}

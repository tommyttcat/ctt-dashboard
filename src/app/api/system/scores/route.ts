// app/api/system/scores/route.ts — every scored name's model percentile, for row colours.
// One KV read per CDN miss (SLOW: rebuilt once a night), so flat in users. ~30 KB.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';
import { SYSTEM_SCORES_KEY, type SystemScores } from '@/lib/system';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const s = await kv.get<SystemScores>(SYSTEM_SCORES_KEY);
    return NextResponse.json({ success: true, ...(s ?? { asOf: null, scores: {} }) }, { headers: cacheHeaders(CACHE.SLOW) });
  } catch (e) {
    console.error('SYSTEM_SCORES_ERROR', e);
    return NextResponse.json({ success: false, asOf: null, scores: {} }, { status: 500, headers: noCacheHeaders() });
  }
}

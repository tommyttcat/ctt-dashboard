// app/api/sentiment/latest/route.ts — the Social Sentiment card's data.
// One KV read per CDN miss (60s), so flat in users.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';
import { SENTIMENT_KEY, type SentimentLive } from '@/lib/sentiment';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const live = await kv.get<SentimentLive>(SENTIMENT_KEY);
    return NextResponse.json({ success: true, live: live ?? null }, { headers: cacheHeaders(CACHE.SCAN) });
  } catch (e) {
    console.error('SENTIMENT_LATEST_ERROR', e);
    return NextResponse.json({ success: false, live: null }, { status: 500, headers: noCacheHeaders() });
  }
}

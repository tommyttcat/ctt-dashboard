// app/api/track/latest/route.ts — the live record, read side.
//
// Aggregates only: per scan, how many picks have been made, how many have
// settled, and what they returned on the same measuring stick the backtests
// use. Cached at the edge for an hour because the numbers change once a day,
// so this is roughly one KV read an hour no matter how many people look.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { TRACK_RESULTS_KEY, TRACK_META_KEY, TRACK_OPEN_KEY, type TrackResults, type OpenPosition } from '@/lib/track';
import { CACHE, cacheHeaders } from '@/lib/httpCache';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [results, meta, open] = await Promise.all([
      kv.get<TrackResults>(TRACK_RESULTS_KEY),
      kv.get<{ lastBarDate?: string; tickedAt?: string; open?: number }>(TRACK_META_KEY),
      kv.get<OpenPosition[]>(TRACK_OPEN_KEY),
    ]);
    const live = open ?? [];
    return NextResponse.json({
      success: true,
      results: results ?? {},
      meta: meta ?? null,
      openCount: live.length,
      // Enough to show "tracking N ideas" without shipping the whole book.
      openByScan: live.reduce<Record<string, number>>((m, p) => { m[p.scan] = (m[p.scan] || 0) + 1; return m; }, {}),
    }, { headers: cacheHeaders(CACHE.SLOW) });
  } catch (e) {
    console.error('TRACK_LATEST_ERROR', e);
    return NextResponse.json({ success: false, error: 'unavailable' }, { status: 500 });
  }
}

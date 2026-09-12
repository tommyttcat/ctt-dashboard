// app/api/track/detail/route.ts — the individual trades behind one scan's row.
//
// /api/track/latest gives the averages; this gives the positions they were
// computed from, which is the only version of a track record worth reading.
// Open positions come from the live book, closed ones from the capped log the
// tick retires into.
//
// Cost: 2 KV reads per origin hit, and the response is CDN-cached on the same
// SLOW profile as /latest (600s, stale-while-revalidate 3600). The scan name
// is part of the cache key, so eight scans cost at most eight cached copies —
// still flat in users, because the cache absorbs every reader after the first.
// Rows are capped so a long-running book cannot turn this into a fat payload.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import {
  TRACK_OPEN_KEY, TRACK_CLOSED_KEY, statusOf, openR, HOLD_SESSIONS,
  type OpenPosition,
} from '@/lib/track';
import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';

export const dynamic = 'force-dynamic';

/** Enough rows to read the record, few enough that the payload stays small. */
const MAX_ROWS = 150;

const r2 = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? null : parseFloat(v.toFixed(2));

/** The wire shape: only what the drill-down renders. */
function serialise(p: OpenPosition) {
  const peakPct = p.fill != null && p.peak != null && p.fill > 0
    ? ((p.peak - p.fill) / p.fill) * 100
    : null;
  return {
    t: p.t,
    d: p.d,
    tier: p.tier,
    score: p.score,
    fill: r2(p.fill),
    stop: r2(p.stop),
    target: r2(p.target),
    last: r2(p.last),
    n: p.n,
    hr: p.hr,
    status: statusOf(p),
    peakPct: r2(peakPct),
    openR: r2(openR(p)),
    exitFixed: r2(p.exitFixed),
    exitHold20: r2(p.exitHold20),
  };
}

export async function GET(request: Request) {
  const scan = new URL(request.url).searchParams.get('scan') || '';
  if (!scan) {
    return NextResponse.json({ success: false, error: 'scan required' }, { status: 400, headers: noCacheHeaders() });
  }

  try {
    const [open, closed] = await Promise.all([
      kv.get<OpenPosition[]>(TRACK_OPEN_KEY),
      kv.get<OpenPosition[]>(TRACK_CLOSED_KEY),
    ]);

    // Newest pick first in both lists — the reader wants this week, not 2026.
    const byDate = (a: OpenPosition, b: OpenPosition) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0);
    const live = (open ?? []).filter(p => p.scan === scan).sort(byDate);
    const done = (closed ?? []).filter(p => p.scan === scan).sort(byDate);

    return NextResponse.json({
      success: true,
      scan,
      holdSessions: HOLD_SESSIONS,
      openCount: live.length,
      closedCount: done.length,
      open: live.slice(0, MAX_ROWS).map(serialise),
      closed: done.slice(0, MAX_ROWS).map(serialise),
      truncated: live.length > MAX_ROWS || done.length > MAX_ROWS,
    }, { headers: cacheHeaders(CACHE.SLOW) });
  } catch (e) {
    console.error('TRACK_DETAIL_ERROR', e);
    return NextResponse.json({ success: false, error: 'unavailable' }, { status: 500 });
  }
}

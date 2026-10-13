// app/api/exposure/latest/route.ts — the Market exposure strip's data.
// One KV read per CDN miss (SLOW: it changes once a night), flat in users.
// The forward record stays out of this payload (it is hidden; see nightly ?view=1).

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';
import { EXPOSURE_KEY, type ExposureState } from '@/lib/exposure';
import { STAGE2_KEY, type Stage2State } from '@/lib/stageBreadth';
import { NET_HL_KEY, type NetHLState } from '@/lib/netHighsLows';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    /* + the S2 breadth reading (lib/stageBreadth) for the Scorecard, in the same CDN-cached
       response: one mget instead of a second route. Its last 30 points only. */
    const [s, s2, hl] = await kv.mget<[ExposureState | null, Stage2State | null, NetHLState | null]>(EXPOSURE_KEY, STAGE2_KEY, NET_HL_KEY);
    const stage2 = s2 ? { asOf: s2.asOf, pct: s2.pct, n: s2.n, counts: s2.counts, history: s2.history.slice(-30) } : null;
    /* Net new highs − lows for the Scorecard chart: the last year (~260 points, ~8 KB). */
    const netHL = hl ? { asOf: hl.asOf, history: hl.history.slice(-260) } : null;
    if (!s) return NextResponse.json({ success: true, state: null, stage2, netHL }, { headers: cacheHeaders(CACHE.SLOW) });
    const { record: _record, ...state } = s;
    void _record;
    return NextResponse.json({ success: true, state, stage2, netHL }, { headers: cacheHeaders(CACHE.SLOW) });
  } catch (e) {
    console.error('EXPOSURE_LATEST_ERROR', e);
    return NextResponse.json({ success: false, state: null }, { status: 500, headers: noCacheHeaders() });
  }
}

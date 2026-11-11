// app/api/leaders/latest/route.ts — the Liquid Leaders lists for the page.
// One KV read per CDN miss (60s), so flat in users.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';
import { LEADERS_LIVE_KEY, LEADERS_OSB_EARLY_KEY, type LeadersLive, type OsbEarly } from '@/lib/leaders';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    /* One MGET (11 Nov 2026): the live lists + the real-time early Oversold Bounce list. Until the
       delayed job's first run of the day (9:45 ET) the early list replaces the oversold rows. */
    const [base, early] = await kv.mget<[LeadersLive | null, OsbEarly | null]>(LEADERS_LIVE_KEY, LEADERS_OSB_EARLY_KEY);
    const etDay = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const today = etDay(Date.now());
    const live = base && early?.oversold && etDay(early.asOf) === today && etDay(base.asOf) !== today
      ? { ...base, oversold: early.oversold, counts: { ...base.counts, oversold: early.count }, osb: { asOf: early.asOf, clockEt: early.clockEt, pre: early.pre } }
      : base;
    return NextResponse.json({ success: true, live: live ?? null }, { headers: cacheHeaders(CACHE.SCAN) });
  } catch (e) {
    console.error('LEADERS_LATEST_ERROR', e);
    return NextResponse.json({ success: false, live: null }, { status: 500, headers: noCacheHeaders() });
  }
}

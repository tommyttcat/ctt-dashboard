// app/api/inst-buys/route.ts — the Institutional Buys card (lib/instBuys).
//
// COST (measured 11 Nov 2026 before building):
//   - zero KV reads or writes. No cron: the edge cache is the schedule.
//   - one build = 2 lists (calls, puts) + 4 opposing-flow lookups + up to 12
//     whole-day checks: at most ~18 Unusual Whales calls, ~0.5 s each, run 3
//     at a time. (Bullish-only on 11 Nov measured 10 calls, ~31 KB.)
//   - edge-cached 15 minutes (was 10 before the bearish side doubled the
//     calls), one URL for every viewer, flat in users: ~26 builds a session
//     day, ~470 calls, ~10K a month against Starter's 25K.
// What silently defeats it: any query string (each is its own cache entry and
// its own build) — the client sends none — or no-store on the response.
// Session-gated like /api/live-quotes: no session, no Unusual Whales call.
// Unusual Whales data is individual-use: owner-only, never published.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySession, SESSION_COOKIE } from '@/lib/auth';
import { cacheHeaders, noCacheHeaders } from '@/lib/httpCache';
import { uwConfigured } from '@/lib/uw';
import { buildInstBuys, flowSession, type InstBuysPayload } from '@/lib/instBuys';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const EDGE = { sMaxAge: 900, swr: 900 };

export async function GET() {
  const jar = await cookies();
  const session = await verifySession(jar.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!session) return NextResponse.json({ error: 'sign in' }, { status: 401, headers: noCacheHeaders() });

  const s = flowSession();
  const empty: InstBuysPayload = { ok: false, asOf: Date.now(), session: s.date, since: s.openUtc, bull: [], bear: [], out: [] };
  if (!uwConfigured()) return NextResponse.json({ ...empty, error: 'Unusual Whales key not set' }, { headers: noCacheHeaders() });
  try {
    return NextResponse.json(await buildInstBuys(), { headers: cacheHeaders(EDGE) });
  } catch (e) {
    /* Short hold on a failure so a bad minute does not stick for ten. */
    const error = String((e as Error)?.message || e).slice(0, 160);
    return NextResponse.json({ ...empty, error }, { headers: cacheHeaders({ sMaxAge: 60, swr: 60 }) });
  }
}

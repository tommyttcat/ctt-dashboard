// app/api/inst-buys/route.ts — the Institutional Buys card (lib/instBuys).
//
// COST (measured 11 Nov 2026 before building):
//   - zero KV reads or writes. No cron: the edge cache is the schedule.
//   - one build = 1 + 2 + N Unusual Whales calls (N = names that pass, 7 on
//     11 Nov, so 10 calls, ~31 KB, ~0.5 s each, run 3 at a time).
//   - edge-cached 10 minutes, one URL for every viewer: at most ~6 builds an
//     hour per active region while the card is open, flat in users. A session
//     day is ~390 calls; ~8K a month against Starter's 25K.
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

const EDGE = { sMaxAge: 600, swr: 600 };

export async function GET() {
  const jar = await cookies();
  const session = await verifySession(jar.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!session) return NextResponse.json({ error: 'sign in' }, { status: 401, headers: noCacheHeaders() });

  const s = flowSession();
  const empty: InstBuysPayload = { ok: false, asOf: Date.now(), session: s.date, since: s.openUtc, rows: [], out: [] };
  if (!uwConfigured()) return NextResponse.json({ ...empty, error: 'Unusual Whales key not set' }, { headers: noCacheHeaders() });
  try {
    return NextResponse.json(await buildInstBuys(), { headers: cacheHeaders(EDGE) });
  } catch (e) {
    /* Short hold on a failure so a bad minute does not stick for ten. */
    const error = String((e as Error)?.message || e).slice(0, 160);
    return NextResponse.json({ ...empty, error }, { headers: cacheHeaders({ sMaxAge: 60, swr: 60 }) });
  }
}

// app/api/inst-buys/route.ts — the Institutional Buys card (lib/instBuys).
//
// COST (measured 11 Nov 2026 before building):
//   - zero KV reads or writes. No cron: the edge cache is the schedule.
//   - one build = 2 lists (calls, puts) + 4 opposing-flow lookups + up to 12
//     whole-day checks: at most ~18 Unusual Whales calls, ~0.5 s each, run 3
//     at a time. (Bullish-only on 11 Nov measured 10 calls, ~31 KB.)
//   - the BUILD is held 15 minutes in Vercel's server data cache
//     (unstable_cache, keyed by session date), shared by every viewer, flat
//     in users: ~26 builds a session day, ~470 calls, ~10K a month against
//     Starter's 25K. Measured live 11 Nov: 9 calls, ~1 s, 3.5 KB.
//   - the RESPONSE is never edge-cached (11 Nov): an edge copy is served
//     without running this function, so the session check is skipped and
//     anyone with the URL could read licensed data. One small function run
//     per open tab per 15 minutes instead.
// What silently defeats it: a changing cache key (the key is the date only).
// Unusual Whales data is individual-use: owner-only, never published.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { unstable_cache } from 'next/cache';
import { verifySession, SESSION_COOKIE } from '@/lib/auth';
import { noCacheHeaders } from '@/lib/httpCache';
import { uwConfigured } from '@/lib/uw';
import { buildInstBuys, flowSession, type InstBuysPayload } from '@/lib/instBuys';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/* One shared build per session day, rebuilt at most every 15 minutes. */
const cachedBuild = (date: string) => unstable_cache(() => buildInstBuys(), ['inst-buys-v2', date], { revalidate: 900 })();

export async function GET() {
  const jar = await cookies();
  const session = await verifySession(jar.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!session) return NextResponse.json({ error: 'sign in' }, { status: 401, headers: noCacheHeaders() });

  const s = flowSession();
  const empty: InstBuysPayload = { ok: false, asOf: Date.now(), session: s.date, since: s.openUtc, bull: [], bear: [], out: [] };
  if (!uwConfigured()) return NextResponse.json({ ...empty, error: 'Unusual Whales key not set' }, { headers: noCacheHeaders() });
  try {
    return NextResponse.json(await cachedBuild(s.date), { headers: noCacheHeaders() });
  } catch (e) {
    /* A failed build is not cached (unstable_cache keeps only results), so the next poll retries. */
    const error = String((e as Error)?.message || e).slice(0, 160);
    return NextResponse.json({ ...empty, error }, { headers: noCacheHeaders() });
  }
}

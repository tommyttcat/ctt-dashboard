// app/api/inst-buys/route.ts — the Institutional Buys card (lib/instBuys).
//
// COST (measured 11 Nov 2026 before building):
//   - KV: one read (MGET of rs_ratings_v1 + leaders_state_v1, 125 KB + 311 KB measured
//     11 Nov) held 3 hours in the data cache — ~3 reads a session day, flat in users.
//     No writes, no cron.
//   - one build = 2 qualifying lists (calls, puts) + 4 net-flow lookups =
//     6 Unusual Whales calls, run 3 at a time. Measured 11 Nov: ~1 s.
//   - the BUILD is held 5 minutes in Vercel's server data cache
//     (unstable_cache, keyed by session date), shared by every viewer, flat
//     in users: ~78 builds a session day, ~470 calls, ~10K a month against
//     Starter's 25K (shared with the Unusual Whales MCP). 15 min was ~3.3K.
//   - the RESPONSE is never edge-cached (11 Nov): an edge copy is served
//     without running this function, so the session check is skipped and
//     anyone with the URL could read licensed data. One small function run
//     per open tab per 5 minutes instead.
// What silently defeats it: a changing cache key (the key is the date only).
// Unusual Whales data is individual-use: owner-only, never published.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { unstable_cache } from 'next/cache';
import { verifySession, SESSION_COOKIE } from '@/lib/auth';
import { noCacheHeaders } from '@/lib/httpCache';
import { uwConfigured } from '@/lib/uw';
import { buildInstBuys, loadNightlyRefs, flowSession, type InstBuysPayload } from '@/lib/instBuys';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/* RS, stage and volume profiles change nightly: one KV read (MGET), held 3 hours. */
const cachedRefs = unstable_cache(() => loadNightlyRefs(), ['inst-buys-refs-v1'], { revalidate: 10_800 });
/* One shared build per session day, rebuilt at most every 5 minutes (owner, 11 Nov; was 15). */
const cachedBuild = (date: string) => unstable_cache(
  async () => buildInstBuys(new Date(), await cachedRefs().catch(() => null)),
  ['inst-buys-v5', date], { revalidate: 300 },
)();

export async function GET() {
  const jar = await cookies();
  const session = await verifySession(jar.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!session) return NextResponse.json({ error: 'sign in' }, { status: 401, headers: noCacheHeaders() });

  const s = flowSession();
  const empty: InstBuysPayload = { ok: false, asOf: Date.now(), session: s.date, since: s.openUtc, buy: [], sell: [] };
  if (!uwConfigured()) return NextResponse.json({ ...empty, error: 'flow feed key not set' }, { headers: noCacheHeaders() });
  try {
    return NextResponse.json(await cachedBuild(s.date), { headers: noCacheHeaders() });
  } catch (e) {
    /* A failed build is not cached (unstable_cache keeps only results), so the next poll retries. */
    const error = String((e as Error)?.message || e).slice(0, 160);
    return NextResponse.json({ ...empty, error }, { headers: noCacheHeaders() });
  }
}

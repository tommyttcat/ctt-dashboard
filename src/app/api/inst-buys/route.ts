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
//   - 12 Nov additions: market tide is a 7th call in the same build (5.3 KB);
//     the held check (lib/instBuysHist) is <=10 calls of ~2.3 KB, held 1 hour per
//     saved day: ~13K Unusual Whales calls a month all in. The daily snapshot
//     rides the same 3-hourly MGET (third key) — still ~3 KV reads a day; its
//     one write a day is /api/inst-buys/save. All flat in users.
// What silently defeats it: a changing cache key (the key is the date only).
// Unusual Whales data is individual-use: owner-only, never published.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { unstable_cache } from 'next/cache';
import { verifySession, SESSION_COOKIE } from '@/lib/auth';
import { noCacheHeaders } from '@/lib/httpCache';
import { uwConfigured } from '@/lib/uw';
import { buildInstBuys, loadNightlyRefs, flowSession, type InstBuysPayload } from '@/lib/instBuys';
import { checkHeld, type InstHistDay } from '@/lib/instBuysHist';
import { etDateString } from '@/lib/marketCalendar';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/* RS, stage and volume profiles change nightly: one KV read (MGET), held 3 hours. */
const cachedRefs = unstable_cache(() => loadNightlyRefs(), ['inst-buys-refs-v2'], { revalidate: 10_800 });
/* One shared build per session day, rebuilt at most every 5 minutes (owner, 11 Nov; was 15). */
const cachedBuild = (date: string) => unstable_cache(
  async () => buildInstBuys(new Date(), await cachedRefs().catch(() => null)),
  ['inst-buys-v6', date], { revalidate: 300 },
)();
/* Yesterday's bets against today's open interest: one check per saved day, redone hourly
   (open interest is published overnight, so "pending" clears on the next pass). */
const cachedHeld = (day: InstHistDay) => unstable_cache(
  async () => checkHeld(day),
  ['inst-buys-held-v1', day.date, String(day.savedAt)], { revalidate: 3_600 },
)();

export async function GET() {
  const jar = await cookies();
  const session = await verifySession(jar.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!session) return NextResponse.json({ error: 'sign in' }, { status: 401, headers: noCacheHeaders() });

  const s = flowSession();
  const empty: InstBuysPayload = { ok: false, asOf: Date.now(), session: s.date, since: s.openUtc, buy: [], sell: [] };
  if (!uwConfigured()) return NextResponse.json({ ...empty, error: 'flow feed key not set' }, { headers: noCacheHeaders() });
  try {
    const built = await cachedBuild(s.date);
    /* The last snapshot from before today's ET date = "yesterday's bets". */
    const refs = await cachedRefs().catch(() => null);
    const today = etDateString();
    const day = (refs?.hist ?? []).filter(d => d.date < today).sort((a, b) => b.date.localeCompare(a.date))[0];
    const prev = day ? await cachedHeld(day).catch(() => null) : null;
    const out: InstBuysPayload = { ...built, prev };
    /* One line per request so "the card is empty" can be checked from the logs (12 Nov). */
    console.log(`[inst-buys] session ${out.session} built ${Math.round((Date.now() - out.asOf) / 1000)}s ago buy ${out.buy.length} sell ${out.sell.length} tide ${out.tide ? 'yes' : 'no'} prev ${prev ? prev.date : 'none'}${out.error ? ` error ${out.error}` : ''}`);
    return NextResponse.json(out, { headers: noCacheHeaders() });
  } catch (e) {
    /* A failed build is not cached (unstable_cache keeps only results), so the next poll retries. */
    const error = String((e as Error)?.message || e).slice(0, 160);
    console.log(`[inst-buys] build failed: ${error}`);
    return NextResponse.json({ ...empty, error }, { headers: noCacheHeaders() });
  }
}

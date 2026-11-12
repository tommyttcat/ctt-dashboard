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
//   - 12 Nov, dark pool: one call per name on the card (40-210 KB measured), held 15
//     minutes PER TICKER so a name that stays on the list is not re-fetched when
//     the list changes: <=10 calls per 15 min, ~5.5K a month (~18.5K all in).
//   - 12 Nov (later): the build key is now a TIME SLOT — 5 min in market hours, 60 min
//     otherwise. A new slot waits for a fresh build (no stale copy after a gap). 7 calls a
//     build, at most 78 builds a session day (~546 calls) — the same ceiling as before.
//     Measured 12 Nov 13:20 ET: 266 calls used today (all uses incl. the MCP).
// What silently defeats it: a key that changes more often than the slot (it is date + slot only).
// Unusual Whales data is individual-use: owner-only, never published.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { unstable_cache } from 'next/cache';
import { verifySession, SESSION_COOKIE } from '@/lib/auth';
import { noCacheHeaders } from '@/lib/httpCache';
import { uwConfigured, uwDailyCount } from '@/lib/uw';
import { buildInstBuys, loadNightlyRefs, flowSession, darkPoolFor, dpAgrees, type InstBuysPayload, type InstBuyRow } from '@/lib/instBuys';
import { checkHeld, type InstHistDay } from '@/lib/instBuysHist';
import { etDateString } from '@/lib/marketCalendar';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/* RS, stage and volume profiles change nightly: one KV read (MGET), held 3 hours. */
const cachedRefs = unstable_cache(() => loadNightlyRefs(), ['inst-buys-refs-v2'], { revalidate: 10_800 });
/* One shared build per time slot (12 Nov, owner: "refresh more often"; was one key per day held
   5 min). The slot is part of the key, so a new slot is a miss and the request WAITS for a fresh
   build instead of being handed the last copy while it rebuilds in the background (that served
   22-24 min old builds after a gap). Slots: 5 min in market hours (owner, 12 Nov: "every 5
   minutes is ok"; 2 min ran for an hour), 60 min outside market hours. */
function buildSlot(s: { openUtc: string }, now = Date.now()): { ms: number; n: number } {
  const o = Date.parse(s.openUtc);
  const open = Number.isFinite(o) && now >= o && now <= o + 390 * 60_000;
  const ms = open ? 300_000 : 3_600_000;
  return { ms, n: Math.floor(now / ms) };
}
const cachedBuild = (date: string, slot: { ms: number; n: number }) => unstable_cache(
  async () => buildInstBuys(new Date(), await cachedRefs().catch(() => null)),
  ['inst-buys-v7', date, String(slot.ms), String(slot.n)], { revalidate: Math.round((slot.ms * 2) / 1000) },
)();
/* Yesterday's bets against today's open interest: one check per saved day, redone hourly
   (open interest is published overnight, so "pending" clears on the next pass). */
const cachedHeld = (day: InstHistDay) => unstable_cache(
  async () => checkHeld(day),
  ['inst-buys-held-v1', day.date, String(day.savedAt)], { revalidate: 3_600 },
)();

/* Today's big dark-pool prints for one name, held 15 minutes per ticker. */
const cachedDp = (date: string, ticker: string) => unstable_cache(
  async () => darkPoolFor(ticker, date),
  ['inst-buys-dp-v1', date, ticker], { revalidate: 900 },
)();
/* Three at a time: the plan allows 3 requests in flight. A failed name just shows no dark pool. */
async function withDarkPool(date: string, rows: InstBuyRow[]): Promise<InstBuyRow[]> {
  const out = rows.map(r => ({ ...r }));
  let next = 0;
  const worker = async () => {
    while (next < out.length) {
      const r = out[next++];
      const dp = await cachedDp(date, r.ticker).catch(() => null);
      r.dp = dp ? { ...dp, agrees: dpAgrees(dp, r.dir) } : null;
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return out;
}

export async function GET() {
  const jar = await cookies();
  const session = await verifySession(jar.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!session) return NextResponse.json({ error: 'sign in' }, { status: 401, headers: noCacheHeaders() });

  const s = flowSession();
  const empty: InstBuysPayload = { ok: false, asOf: Date.now(), session: s.date, since: s.openUtc, buy: [], sell: [] };
  if (!uwConfigured()) return NextResponse.json({ ...empty, error: 'flow feed key not set' }, { headers: noCacheHeaders() });
  try {
    const slot = buildSlot(s);
    const built = await cachedBuild(s.date, slot);
    /* The last snapshot from before today's ET date = "yesterday's bets". */
    const refs = await cachedRefs().catch(() => null);
    const today = etDateString();
    const day = (refs?.hist ?? []).filter(d => d.date < today).sort((a, b) => b.date.localeCompare(a.date))[0];
    const prev = day ? await cachedHeld(day).catch(() => null) : null;
    const [buy, sell] = [await withDarkPool(built.session, built.buy), await withDarkPool(built.session, built.sell)];
    const out: InstBuysPayload = { ...built, buy, sell, prev };
    /* One line per request so "the card is empty" can be checked from the logs (12 Nov). */
    console.log(`[inst-buys] session ${out.session} built ${Math.round((Date.now() - out.asOf) / 1000)}s ago slot ${slot.ms / 60_000}m uw-today ${uwDailyCount() ?? '?'} buy ${out.buy.length} sell ${out.sell.length} tide ${out.tide ? 'yes' : 'no'} dp ${[...buy, ...sell].filter(r => r.dp).length} prev ${prev ? prev.date : 'none'}${out.error ? ` error ${out.error}` : ''}`);
    return NextResponse.json(out, { headers: noCacheHeaders() });
  } catch (e) {
    /* A failed build is not cached (unstable_cache keeps only results), so the next poll retries. */
    const error = String((e as Error)?.message || e).slice(0, 160);
    console.log(`[inst-buys] build failed: ${error}`);
    return NextResponse.json({ ...empty, error }, { headers: noCacheHeaders() });
  }
}

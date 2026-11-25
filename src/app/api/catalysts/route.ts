import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';
import { authorized } from '@/lib/apiAuth';
import { CATALYSTS_KEY, cleanPayload, type CatalystsPayload } from '@/lib/catalysts';

/* /api/catalysts — the News page catalyst list (25 Nov 2026).
 *
 * GET  — the latest run. One KV read per edge miss, NARRATIVE profile
 *        (120s / 600s SWR): at most ~30 reads an hour whatever the number of
 *        readers. Callers must not cache-bust.
 * POST — the cloud routine's write (SOCIAL_POST_KEY). One KV read (the
 *        previous run, to mark names that are new this run) + one KV write.
 */

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await kv.get<CatalystsPayload>(CATALYSTS_KEY);
    if (!data) return NextResponse.json({ empty: true }, { headers: cacheHeaders(CACHE.NARRATIVE) });
    return NextResponse.json(data, { headers: cacheHeaders(CACHE.NARRATIVE) });
  } catch {
    return NextResponse.json({ error: 'read failed' }, { status: 500, headers: noCacheHeaders() });
  }
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: noCacheHeaders() });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400, headers: noCacheHeaders() }); }
  const payload = cleanPayload(body);
  if (!payload) return NextResponse.json({ error: 'no usable rows' }, { status: 400, headers: noCacheHeaders() });

  const prev = await kv.get<CatalystsPayload>(CATALYSTS_KEY).catch(() => null);
  /* "New in last scan": not on the previous run's list, when that run was today (ET). */
  const etDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const sameDay = prev?.runAt && etDay(prev.runAt) === etDay(payload.runAt);
  const before = new Set(sameDay ? [...(prev!.ranked ?? []), ...(prev!.passed ?? [])].map(r => r.ticker) : []);
  for (const r of [...payload.ranked, ...payload.passed]) r.isNew = sameDay ? !before.has(r.ticker) : true;

  await kv.set(CATALYSTS_KEY, payload);
  return NextResponse.json(
    { success: true, runAt: payload.runAt, ranked: payload.ranked.length, passed: payload.passed.length },
    { headers: noCacheHeaders() },
  );
}

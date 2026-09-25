// app/api/alerts/route.ts — a signed-in user's watchlist-alert switch.
//
// GET  → { on }             one HEXISTS
// POST → { on: boolean }    on: copies their watchlist into the alert index;
//                           off: removes them from it.
// The index is what the 15-minute check reads (lib/alerts), so it holds only
// people who asked for alerts; /api/watchlist keeps their entry current.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { kv } from '@vercel/kv';
import { verifySession, SESSION_COOKIE } from '@/lib/auth';
import { ALERT_INDEX_KEY } from '@/lib/alerts';

export const dynamic = 'force-dynamic';

async function sessionEmail(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const s = await verifySession(token);
  return s?.email ? s.email.toLowerCase() : null;
}

export async function GET() {
  const email = await sessionEmail();
  if (!email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const on = (await kv.hexists(ALERT_INDEX_KEY, email)) === 1;
  return NextResponse.json({ on }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  const email = await sessionEmail();
  if (!email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (body?.on === true) {
    const list = (await kv.get<string[]>(`watchlist:${email}`)) || [];
    await kv.hset(ALERT_INDEX_KEY, { [email]: list });
    return NextResponse.json({ on: true, watching: list.length });
  }
  await kv.hdel(ALERT_INDEX_KEY, email);
  return NextResponse.json({ on: false });
}

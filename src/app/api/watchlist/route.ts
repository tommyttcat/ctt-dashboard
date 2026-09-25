import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySession, SESSION_COOKIE } from '@/lib/auth';
import { kv } from '@vercel/kv';
import { ALERT_INDEX_KEY } from '@/lib/alerts';

export const dynamic = 'force-dynamic';

/* Keep an opted-in user's entry in the alert index in step with their list,
   in the same request — an index that drifts means alerts that silently
   never arrive. One HEXISTS per edit for everyone else. */
async function syncAlertIndex(email: string, list: string[]) {
  const field = email.toLowerCase();
  if ((await kv.hexists(ALERT_INDEX_KEY, field)) === 1) await kv.hset(ALERT_INDEX_KEY, { [field]: list });
}

function watchlistKey(email: string) {
  return `watchlist:${email.toLowerCase()}`;
}

async function getAuthEmail(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  return session?.email ?? null;
}

export async function GET() {
  const email = await getAuthEmail();
  if (!email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const list = await kv.get<string[]>(watchlistKey(email));
  return NextResponse.json({ tickers: list || [] });
}

export async function POST(request: Request) {
  const email = await getAuthEmail();
  if (!email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { ticker } = await request.json();
  if (!ticker || typeof ticker !== 'string') {
    return NextResponse.json({ error: 'ticker required' }, { status: 400 });
  }

  const sym = ticker.toUpperCase().trim();
  const key = watchlistKey(email);
  const list = await kv.get<string[]>(key) || [];

  if (!list.includes(sym)) {
    list.push(sym);
    await kv.set(key, list);
    await syncAlertIndex(email, list);
  }

  return NextResponse.json({ tickers: list });
}

export async function DELETE(request: Request) {
  const email = await getAuthEmail();
  if (!email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { ticker } = await request.json();
  if (!ticker || typeof ticker !== 'string') {
    return NextResponse.json({ error: 'ticker required' }, { status: 400 });
  }

  const sym = ticker.toUpperCase().trim();
  const key = watchlistKey(email);
  const list = await kv.get<string[]>(key) || [];
  const updated = list.filter(t => t !== sym);
  await kv.set(key, updated);
  await syncAlertIndex(email, updated);

  return NextResponse.json({ tickers: updated });
}

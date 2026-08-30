import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySession, SESSION_COOKIE } from '@/lib/auth';
import { kv } from '@vercel/kv';

export const dynamic = 'force-dynamic';

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

  return NextResponse.json({ tickers: updated });
}

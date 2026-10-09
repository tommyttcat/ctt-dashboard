import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { kv } from '@vercel/kv';
import { verifySession, SESSION_COOKIE } from '@/lib/auth';
import { noCacheHeaders } from '@/lib/httpCache';
import { COMPARE_KEY, COMPARE_INDEX_KEY, type CompareReport } from '@/lib/newsCompare';

export const dynamic = 'force-dynamic';

/**
 * Admin read surface for the shadow news comparison (lib/newsCompare).
 * Cookie-gated, never cached: 2 KV commands per view (index, then report).
 */
export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session?.isAdmin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const requested = new URL(request.url).searchParams.get('id');
  const index = (await kv.get<string[]>(COMPARE_INDEX_KEY)) || [];
  const ids = [...index].reverse();
  const id = requested && ids.includes(requested) ? requested : ids[0] ?? null;
  const report = id ? await kv.get<CompareReport>(COMPARE_KEY(id)) : null;

  return NextResponse.json({ ids, id, report }, { headers: noCacheHeaders() });
}

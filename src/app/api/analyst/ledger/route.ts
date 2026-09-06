import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySession, SESSION_COOKIE } from '@/lib/auth';
import { kv } from '@vercel/kv';
import { LEDGER_INDEX_KEY, LEDGER_KEY, type SetupLedger } from '@/lib/setupLedger';
import { noCacheHeaders } from '@/lib/httpCache';

export const dynamic = 'force-dynamic';

/**
 * Admin read surface for the setup ledger. Cookie-gated and never cached — it
 * is low-traffic and user-specific, so 2 KV reads per view is the whole cost.
 * This is a raw viewer, not the scored track record (which does not exist yet).
 */
async function requireAdmin(): Promise<NextResponse | null> {
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session?.isAdmin) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

export async function GET(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const requested = searchParams.get('date');

  // Index is newest-appended; sort desc so the picker leads with the latest.
  const index = (await kv.get<string[]>(LEDGER_INDEX_KEY)) || [];
  const dates = [...index].sort((a, b) => b.localeCompare(a));

  const date = requested || dates[0] || null;
  const ledger = date ? await kv.get<SetupLedger>(LEDGER_KEY(date)) : null;

  return NextResponse.json(
    { dates, date, ledger: ledger ?? null },
    { headers: noCacheHeaders() },
  );
}

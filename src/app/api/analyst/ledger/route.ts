import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySession, SESSION_COOKIE } from '@/lib/auth';
import { kv } from '@vercel/kv';
import { LEDGER_INDEX_KEY, LEDGER_KEY, type SetupLedger } from '@/lib/setupLedger';
import { noCacheHeaders } from '@/lib/httpCache';
import { SCORECARD_KEY, SCORE_DAY_KEY, type Scorecard, type DateScore } from '@/lib/ledgerScore';

export const dynamic = 'force-dynamic';

/**
 * Admin read surface for the setup ledger and its scorecard (lib/ledgerScore).
 * Cookie-gated and never cached — it is low-traffic and admin-only, so 2 KV
 * commands per view is the whole cost: the index + scorecard, then the date's
 * ledger + its archived score.
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
  const [index, scorecard] = await kv.mget<[string[] | null, Scorecard | null]>(LEDGER_INDEX_KEY, SCORECARD_KEY);
  const dates = [...(index || [])].sort((a, b) => b.localeCompare(a));

  const date = requested || dates[0] || null;
  let ledger: SetupLedger | null = null;
  let score: DateScore | null = null;
  if (date) {
    const [l, archived] = await kv.mget<[SetupLedger | null, DateScore | null]>(LEDGER_KEY(date), SCORE_DAY_KEY(date));
    ledger = l;
    // Unfinished dates live on the scorecard; finished ones in their own key.
    score = archived ?? scorecard?.open.find(s => s.d === date) ?? null;
  }

  // The page needs the totals and the in-progress dates, not every pool result.
  const lean = (s: DateScore) => ({ ...s, pool: s.pool ? { ...s.pool, pcts: undefined } : null });
  return NextResponse.json(
    {
      dates, date, ledger,
      score: score ? lean(score) : null,
      scorecard: scorecard ? { ...scorecard, open: scorecard.open.map(lean), recent: scorecard.recent.map(lean) } : null,
    },
    { headers: noCacheHeaders() },
  );
}

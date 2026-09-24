// /api/settings/chop — the CHOP band setting, shared between the dashboard and the email.
//
// The Scorecard's mode toggle used to be pure component state, which meant the
// server had no way to know which bands the user was actually looking at. The
// briefing email therefore hardcoded one set and could disagree with the site.
// Storing it here lets both read the same value.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { kv } from '@vercel/kv';
import { verifySession, SESSION_COOKIE } from '@/lib/auth';
import { authorized } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CACHE_KEY = 'chop_mode_v1';
const MODES = ['asis', 'med', 'strong', 'extreme'] as const;
type ChopMode = (typeof MODES)[number];
const DEFAULT_MODE: ChopMode = 'strong'; // matches DEFAULT_CHOP_MODE — see chopMarket for the trade-off

export async function GET() {
  try {
    const mode = await kv.get<ChopMode>(CACHE_KEY);
    return NextResponse.json(
      { mode: mode && MODES.includes(mode) ? mode : DEFAULT_MODE },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    // KV unavailable — fall back rather than break the page or the email.
    return NextResponse.json({ mode: DEFAULT_MODE }, { headers: { 'Cache-Control': 'no-store' } });
  }
}

/* WHO MAY CHANGE IT. This is one setting for everybody — it decides the
   words on every reader's dashboard and in every briefing email — and until
   24 Sep 2026 the POST had no check at all: anyone, signed in or not, could
   change what the whole site told its readers. Now an admin session, or the
   server key (lib/apiAuth) for scripted changes.

   Nothing else changes for anyone else. Both toggles (Scorecard.tsx and
   useMacroScorecard.ts) switch the reader's own view FIRST and only then post,
   ignoring a failed post — so a non-admin's toggle still works as a what-if on
   their own screen; it simply stops rewriting everyone else's.

   Costs nothing: isAdmin is carried in the signed session token, so the check
   reads no KV. */
async function mayChange(req: Request): Promise<boolean> {
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (session?.isAdmin) return true;
  return authorized(req);
}

export async function POST(req: Request) {
  if (!(await mayChange(req))) {
    return NextResponse.json({ error: 'Only an admin can change this setting' }, { status: 401 });
  }
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const mode = body?.mode;
  if (!MODES.includes(mode)) {
    return NextResponse.json({ error: `mode must be one of: ${MODES.join(', ')}` }, { status: 400 });
  }

  try {
    await kv.set(CACHE_KEY, mode);
    return NextResponse.json({ success: true, mode });
  } catch (err: any) {
    return NextResponse.json({ error: `KV write failed: ${err.message}` }, { status: 500 });
  }
}

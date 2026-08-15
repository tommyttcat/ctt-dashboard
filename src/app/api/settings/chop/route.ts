// /api/settings/chop — the CHOP band setting, shared between the dashboard and the email.
//
// The Scorecard's mode toggle used to be pure component state, which meant the
// server had no way to know which bands the user was actually looking at. The
// briefing email therefore hardcoded one set and could disagree with the site.
// Storing it here lets both read the same value.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CACHE_KEY = 'chop_mode_v1';
const MODES = ['asis', 'med', 'strong', 'extreme'] as const;
type ChopMode = (typeof MODES)[number];
const DEFAULT_MODE: ChopMode = 'extreme';

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

export async function POST(req: Request) {
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

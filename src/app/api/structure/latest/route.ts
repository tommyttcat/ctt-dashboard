// app/api/structure/latest/route.ts — Chart Structure for the page.
// One KV read per CDN miss (SLOW: rebuilt once a night), so flat in users.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';
import { STRUCTURE_KEY, type StructureState } from '@/lib/structure';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const state = await kv.get<StructureState>(STRUCTURE_KEY);
    return NextResponse.json({ success: true, state: state ?? null }, { headers: cacheHeaders(CACHE.SLOW) });
  } catch (e) {
    console.error('STRUCTURE_LATEST_ERROR', e);
    return NextResponse.json({ success: false, state: null }, { status: 500, headers: noCacheHeaders() });
  }
}

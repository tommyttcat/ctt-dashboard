// /api/analyst/brief — AI Market Analysis Brief (KV-backed)
//
// GET  → serves the latest cached analysis from KV
// POST → accepts analysis JSON and stores it in KV (called by Claude Code session)
//
// The analysis itself is NOT generated here. It runs inside a Claude Code
// session (or scheduled routine) which fetches /api/claude/snapshot, analyzes
// it, and POSTs the result back here for the frontend to display.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

const CACHE_KEY = 'analyst_brief_v1';

export async function GET() {
  try {
    const brief = await kv.get<any>(CACHE_KEY);
    if (!brief) {
      /* NOT an error condition. /api/analyst/generate refuses to run outside
         4 AM – 8 PM ET, so an absent brief overnight is the expected state.
         `pending: true` lets the client tell this apart from a real failure
         and render a calm empty state instead of a red error box. */
      /* Cached briefly rather than not at all: overnight every open tab polls
         this on a timer, and an uncached 404 is a KV read per poll per user.
         stale-while-revalidate means a brief that lands mid-TTL still shows up
         within about a minute. */
      return NextResponse.json(
        {
          pending: true,
          error: 'No analysis published yet — the analyst runs between 4 AM and 8 PM ET.',
        },
        { status: 404, headers: cacheHeaders(CACHE.SCAN) },
      );
    }
    return NextResponse.json(brief, {
      headers: {
        ...cacheHeaders(CACHE.NARRATIVE),
        'Content-Type': 'application/json; charset=utf-8',
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: `KV read failed: ${err.message}` },
      { status: 500, headers: noCacheHeaders() },
    );
  }
}

const ARCHIVE_INDEX_KEY = 'brief_archive_index';

function etDateString(iso: string): string {
  const dt = new Date(iso);
  return dt.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function todayET(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export async function POST(req: Request) {
  const requiredKey = process.env.ANALYST_BRIEF_KEY || '';
  if (requiredKey) {
    const authHeader = req.headers.get('authorization') || '';
    const provided = authHeader.replace('Bearer ', '');
    if (provided !== requiredKey) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.sections || !Array.isArray(body.sections)) {
    return NextResponse.json(
      { error: 'Body must have a "sections" array' },
      { status: 400 },
    );
  }

  const existing = await kv.get<any>(CACHE_KEY);

  // Archive previous day's brief when the date rolls over
  let archived: string | null = null;
  if (existing?.generatedAt) {
    const existingDate = etDateString(existing.generatedAt);
    if (existingDate !== todayET()) {
      const archiveKey = `brief_archive:${existingDate}`;
      try {
        await kv.set(archiveKey, existing);
        const index = (await kv.get<string[]>(ARCHIVE_INDEX_KEY)) || [];
        if (!index.includes(existingDate)) {
          index.push(existingDate);
          await kv.set(ARCHIVE_INDEX_KEY, index);
        }
        archived = existingDate;
        console.log(`[brief] archived ${existingDate}`);
      } catch (e: any) {
        console.error(`[brief] archive failed: ${e.message}`);
      }
    }
  }

  let mergedSessionUpdates: Record<string, any> | undefined;
  let newTapePhase: string | null = null;
  if (body.sessionUpdate?.key && body.sessionUpdate?.block) {
    const prev = existing?.sessionUpdates || {};
    if (!prev[body.sessionUpdate.key]) {
      newTapePhase = body.sessionUpdate.key;
    }
    mergedSessionUpdates = { ...prev, [body.sessionUpdate.key]: body.sessionUpdate.block };
  } else if (!body.sessionUpdates) {
    if (existing?.sessionUpdates && Object.keys(existing.sessionUpdates).length > 0) {
      mergedSessionUpdates = existing.sessionUpdates;
    }
  }

  const brief = {
    generatedAt: new Date().toISOString(),
    generatedAtET: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
    generatedBy: body.generatedBy || 'ai-analyst',
    snapshotTime: body.snapshotTime || null,
    sections: body.sections,
    ...(body.regimeDetail && { regimeDetail: body.regimeDetail }),
    ...(body.summary && { summary: body.summary }),
    ...(mergedSessionUpdates ? { sessionUpdates: mergedSessionUpdates } : body.sessionUpdates ? { sessionUpdates: body.sessionUpdates } : {}),
  };

  try {
    await kv.set(CACHE_KEY, brief);

    return NextResponse.json({ success: true, generatedAt: brief.generatedAtET, newTapePhase, archived });
  } catch (err: any) {
    return NextResponse.json(
      { error: `KV write failed: ${err.message}` },
      { status: 500 },
    );
  }
}

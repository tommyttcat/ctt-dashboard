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

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

const CACHE_KEY = 'analyst_brief_v1';

export async function GET() {
  try {
    const brief = await kv.get<any>(CACHE_KEY);
    if (!brief) {
      return NextResponse.json(
        { error: 'No analysis available yet. Run the analyst from a Claude Code session.' },
        { status: 404 },
      );
    }
    return NextResponse.json(brief, {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: `KV read failed: ${err.message}` },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  // Simple shared-secret auth — optional, set ANALYST_BRIEF_KEY in env to enable
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

  const brief = {
    generatedAt: new Date().toISOString(),
    generatedAtET: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
    snapshotTime: body.snapshotTime || null,
    sections: body.sections,
  };

  try {
    await kv.set(CACHE_KEY, brief, { ex: 1800 }); // 30 min TTL
    return NextResponse.json({ success: true, generatedAt: brief.generatedAtET });
  } catch (err: any) {
    return NextResponse.json(
      { error: `KV write failed: ${err.message}` },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// CTT Dashboard — Claude Snapshot Cache-Bust Alias
// v1.1
//
// Some fetchers normalize query strings away before caching, so ?t=1 collapses
// to the same cache key as the bare URL. Path segments are NOT normalized, so
// this alias produces a genuinely distinct URL per call.
//
// The [v] segment is ignored entirely — it exists only to change the path.
//
//   /api/claude/snapshot/0730am
//   /api/claude/snapshot/0730pm?limit=10
//
// v1.1: proxies over HTTP instead of importing the base handler, which avoids
// Next's route-export type validation entirely.
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

const BASE_PATH = '/api/claude/snapshot';
const FETCH_TIMEOUT_MS = 45_000;

// Mirrors resolveOrigin() in the base route.
function resolveOrigin(req: Request): string {
  try {
    const u = new URL(req.url);
    if (u.origin && u.origin !== 'null') return u.origin;
  } catch {
    /* fall through */
  }
  const h = req.headers;
  const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000';
  const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export async function GET(req: Request) {
  const incoming = new URL(req.url);
  const target = `${resolveOrigin(req)}${BASE_PATH}${incoming.search}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(target, {
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });

    const body = await res.text();

    return new NextResponse(body, {
      status: res.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'CDN-Cache-Control': 'no-store',
        'Vercel-CDN-Cache-Control': 'no-store',
        Pragma: 'no-cache',
        Expires: '0',
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'alias proxy failed', detail: msg === 'The operation was aborted.' ? 'timeout' : msg },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  } finally {
    clearTimeout(timer);
  }
}
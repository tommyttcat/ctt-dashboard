// ---------------------------------------------------------------------------
// CTT Dashboard — Claude Snapshot Aggregator
// v1.0
//
// Single read-only endpoint that merges every /latest + reference route into
// one compact JSON payload, so an external analyst (Claude) can pull the whole
// board in one fetch instead of eleven.
//
// Reads nothing from KV directly — it calls your existing routes server-side,
// so it stays correct automatically as those routes evolve.
//
//   /api/claude/snapshot                -> core scans, 25 rows each
//   /api/claude/snapshot?limit=10       -> fewer rows (smaller payload)
//   /api/claude/snapshot?extras=1       -> also include news / earnings / econ
//   /api/claude/snapshot?only=stocksInPlay,consolidation1021
//   /api/claude/snapshot?full=1         -> no trimming at all (can be huge)
//   /api/claude/snapshot?key=...        -> only enforced if CLAUDE_SNAPSHOT_KEY is set
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

// --- Source map -------------------------------------------------------------
// `extra: true` sources are skipped unless ?extras=1 — they're high-volume and
// rarely needed for setup analysis.

type SourceDef = { name: string; path: string; extra?: boolean };

const SOURCES: SourceDef[] = [
  { name: 'macro', path: '/api/macro' },
  { name: 'marketSummary', path: '/api/market-summary' },
  { name: 't2108', path: '/api/t2108/latest' },
  { name: 'sectors', path: '/api/sectors' },
  { name: 'stocksInPlay', path: '/api/scanner/latest' },
  { name: 'swingCandidates', path: '/api/swing-candidates/latest' },
  { name: 'consolidation1021', path: '/api/consolidation/latest' },
  { name: 'ep9m', path: '/api/ep9m/latest' },
  { name: 'news', path: '/api/news', extra: true },
  { name: 'earnings', path: '/api/earnings', extra: true },
  { name: 'econ', path: '/api/econ', extra: true },
];

const DEFAULT_ROW_LIMIT = 25;
const FETCH_TIMEOUT_MS = 12_000;

// --- Origin resolution ------------------------------------------------------
// On Vercel, req.url is absolute and correct. Header fallback covers local dev
// and any proxy setup where that isn't true.

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

// --- Fetch with timeout -----------------------------------------------------

async function fetchJson(url: string): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

    const text = await res.text();
    if (!text.trim()) return { ok: false, error: 'empty body' };

    try {
      return { ok: true, data: JSON.parse(text) };
    } catch {
      return { ok: false, error: 'non-JSON response' };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg === 'The operation was aborted.' ? 'timeout' : msg };
  } finally {
    clearTimeout(timer);
  }
}

// --- Payload compaction -----------------------------------------------------
// Shape-agnostic on purpose: it walks whatever each route returns rather than
// assuming field names, so adding columns upstream never breaks this route.

function tidyNumber(n: number): number {
  if (!Number.isFinite(n)) return n;
  if (Number.isInteger(n)) return n;
  return Math.round(n * 100) / 100;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Drop empty values so sparse scan rows don't bloat the payload with nulls.
function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string' && v.trim() === '') return true;
  if (Array.isArray(v) && v.length === 0) return true;
  if (isPlainObject(v) && Object.keys(v).length === 0) return true;
  return false;
}

function compact(value: unknown, rowLimit: number, depth = 0): unknown {
  if (depth > 6) return value;

  if (typeof value === 'number') return tidyNumber(value);

  if (Array.isArray(value)) {
    const trimmed = value.slice(0, rowLimit).map((item) => compact(item, rowLimit, depth + 1));
    if (value.length > rowLimit) {
      trimmed.push({ _truncated: `${value.length - rowLimit} more rows omitted (total ${value.length})` });
    }
    return trimmed;
  }

  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (isEmptyValue(v)) continue;
      out[k] = compact(v, rowLimit, depth + 1);
    }
    return out;
  }

  return value;
}

// --- Handler ----------------------------------------------------------------

export async function GET(req: Request) {
  const url = new URL(req.url);
  const params = url.searchParams;

  // Optional shared-secret gate. If CLAUDE_SNAPSHOT_KEY is unset, the endpoint
  // is open — it only serves the same public market data the dashboard shows.
  const requiredKey = process.env.CLAUDE_SNAPSHOT_KEY || '';
  if (requiredKey && params.get('key') !== requiredKey) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const full = params.get('full') === '1' || params.get('full') === 'true';
  const includeExtras = params.get('extras') === '1' || params.get('extras') === 'true';

  const parsedLimit = Number.parseInt(params.get('limit') || '', 10);
  const rowLimit = full
    ? Number.MAX_SAFE_INTEGER
    : Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 250)
      : DEFAULT_ROW_LIMIT;

  const onlyParam = params.get('only');
  const only = onlyParam
    ? new Set(onlyParam.split(',').map((s) => s.trim()).filter(Boolean))
    : null;

  const selected = SOURCES.filter((s) => {
    if (only) return only.has(s.name);
    return includeExtras || !s.extra;
  });

  const origin = resolveOrigin(req);
  const startedAt = Date.now();

  const results = await Promise.all(
    selected.map(async (src) => {
      const result = await fetchJson(`${origin}${src.path}`);
      return { src, result };
    }),
  );

  const data: Record<string, unknown> = {};
  const failed: Array<{ source: string; path: string; error: string }> = [];

  for (const { src, result } of results) {
    if (result.ok) {
      data[src.name] = full ? result.data : compact(result.data, rowLimit);
    } else {
      failed.push({ source: src.name, path: src.path, error: result.error });
    }
  }

  return NextResponse.json(
    {
      meta: {
        generatedAt: new Date().toISOString(),
        generatedAtET: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
        elapsedMs: Date.now() - startedAt,
        rowLimit: full ? 'unlimited' : rowLimit,
        sourcesRequested: selected.length,
        sourcesOk: Object.keys(data),
        sourcesFailed: failed,
        note: 'Read-only aggregate of CTT Dashboard scan output. Market data only; not investment advice.',
      },
      data,
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'Content-Type': 'application/json; charset=utf-8',
      },
    },
  );
}
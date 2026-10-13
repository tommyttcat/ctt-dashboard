// app/api/breadth/nethl-backfill/route.ts — one-time backfill of net new 52-week highs − lows
// (lib/netHighsLows) for the Scorecard chart, 13 Oct 2026. The System nightly adds one point a
// night from then on; this fills the year before.
//
// GET ?force=1 with the cron secret or an admin session. Cost when run: the CS/ADR reference
// (~7 pages) + ~520 sessions of Polygon grouped daily bars (one call each, 16 at a time) — once.
// KV: 1 read + 1 write. Not scheduled.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { authorizedOrAdmin } from '@/lib/apiAuth';
import { netHLAt, mergeHistory, NET_HL_KEY, type NetHLPoint, type NetHLState } from '@/lib/netHighsLows';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const KEY = process.env.POLYGON_API_KEY || '';
const SESSIONS = 512;   // 260 charted sessions + 252 of lookback
const etDate = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
async function pg<T>(path: string): Promise<T | null> {
  const url = path.startsWith('http') ? `${path}&apiKey=${KEY}` : `https://api.polygon.io${path}${path.includes('?') ? '&' : '?'}apiKey=${KEY}`;
  for (let a = 0; a < 3; a++) {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30000) }).catch(() => null);
    if (res?.ok) return (await res.json().catch(() => null)) as T | null;
    await new Promise(r => setTimeout(r, 600 * (a + 1)));
  }
  return null;
}

export async function GET(req: Request) {
  if (new URL(req.url).searchParams.get('force') !== '1' || !(await authorizedOrAdmin(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!KEY) return NextResponse.json({ success: false, error: 'no data key' }, { status: 500 });
  const t0 = Date.now();
  const names = new Set<string>();
  for (const type of ['CS', 'ADRC']) {
    let next: string | null = `/v3/reference/tickers?type=${type}&market=stocks&active=true&limit=1000`;
    for (let p = 0; next && p < 20; p++) {
      const j: { results?: { ticker: string }[]; next_url?: string } | null = await pg(next);
      for (const r of j?.results ?? []) names.add(r.ticker);
      next = j?.next_url ?? null;
    }
  }
  const from = etDate(Date.now() - 780 * 864e5), to = etDate(Date.now());
  const spy = await pg<{ results?: { t: number }[] }>(`/v2/aggs/ticker/SPY/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=5000`);
  const cal = (spy?.results ?? []).map(r => etDate(r.t));
  if (cal.length < 300) return NextResponse.json({ success: false, error: `calendar too short (${cal.length})` }, { status: 502 });
  const days = cal.slice(-SESSIONS), N = days.length;
  const idx = new Map<string, number>(); const H: Float32Array[] = [], L: Float32Array[] = [], C: Float32Array[] = [];
  const slot = (t: string) => { let i = idx.get(t); if (i == null) { i = H.length; idx.set(t, i); H.push(new Float32Array(N).fill(NaN)); L.push(new Float32Array(N).fill(NaN)); C.push(new Float32Array(N).fill(NaN)); } return i; };
  let empty = 0;
  for (let k = 0; k < N; k += 16) {
    await Promise.all(days.slice(k, k + 16).map(async (d, j) => {
      const g = await pg<{ results?: { T: string; h: number; l: number; c: number }[] }>(`/v2/aggs/grouped/locale/us/market/stocks/${d}?adjusted=true`);
      const rs = g?.results ?? []; if (!rs.length) empty++;
      for (const r of rs) { if (!names.has(r.T)) continue; const i = slot(r.T); H[i][k + j] = r.h; L[i][k + j] = r.l; C[i][k + j] = r.c; }
    }));
  }
  const pts: NetHLPoint[] = [];
  for (let t = 252; t < N; t++) pts.push({ d: days[t], ...netHLAt(H, L, C, t) });
  const prev = await kv.get<NetHLState>(NET_HL_KEY);
  const history = mergeHistory(prev?.history, pts);
  await kv.set(NET_HL_KEY, { asOf: history[history.length - 1].d, history } satisfies NetHLState);
  return NextResponse.json({ success: true, sessions: N, emptyDays: empty, names: H.length, points: pts.length, first: pts[0], last: pts[pts.length - 1], ms: Date.now() - t0 });
}

// app/api/momentum/nightly/route.ts — rebuild Momentum Leaders (lib/momentum).
//
// 18:10 ET on weekdays (two UTC hours + etGate). Reads Polygon's reference
// list (common stock + ADRs) and the grouped daily bars for the last 20
// sessions plus the sessions 21 and 252 back (dates from SPY's own daily
// history), ranks, and writes the top 50.
//
// Cost per run: 1 KV write (~6 KB). Polygon: ~7 reference pages, 1 SPY
// history call, 22 grouped-daily calls. Flat in users — the page reads it
// through /api/momentum/latest behind the CDN.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { etGate } from '@/lib/etCron';
import { authorized } from '@/lib/apiAuth';
import { MOMENTUM_KEY, rankMomentum, type MomentumList } from '@/lib/momentum';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const KEY = process.env.POLYGON_API_KEY || '';
const BASE = 'https://api.polygon.io';
const etDate = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

async function pg<T>(pathOrUrl: string): Promise<T | null> {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${BASE}${pathOrUrl}`;
  const full = `${url}${url.includes('?') ? '&' : '?'}apiKey=${KEY}`;
  for (let a = 0; a < 2; a++) {
    const res = await fetch(full, { cache: 'no-store', signal: AbortSignal.timeout(20000) }).catch(() => null);
    if (res?.ok) return (await res.json().catch(() => null)) as T | null;
  }
  return null;
}

type Grouped = { results?: { T: string; c: number; v: number }[] };
const toMap = (j: Grouped | null) => new Map((j?.results ?? []).map(r => [r.T, { c: r.c, v: r.v }]));

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const gate = etGate([18], 'momentum leaders nightly');
  if (gate) return gate;
  if (!KEY) return NextResponse.json({ success: false, error: 'no data key' }, { status: 500 });

  // 1. Reference: common stock and ADRs, any US exchange (rank-hold.ts's universe).
  const names = new Map<string, string>();
  for (const type of ['CS', 'ADRC']) {
    let next: string | null = `/v3/reference/tickers?type=${type}&market=stocks&active=true&limit=1000`;
    for (let p = 0; next && p < 20; p++) {
      const j: { results?: { ticker: string; name?: string }[]; next_url?: string } | null = await pg(next);
      for (const r of j?.results ?? []) names.set(r.ticker, r.name ?? r.ticker);
      next = j?.next_url ?? null;
    }
  }
  if (names.size < 3000) return NextResponse.json({ success: false, error: `reference too small (${names.size})` }, { status: 502 });

  // 2. The session calendar from SPY's own history (newest last).
  const to = etDate(Date.now()), from = etDate(Date.now() - 420 * 864e5);
  const spy = await pg<{ results?: { t: number }[] }>(`/v2/aggs/ticker/SPY/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=500`);
  const cal = (spy?.results ?? []).map(r => etDate(r.t));
  if (cal.length < 260) return NextResponse.json({ success: false, error: `calendar too short (${cal.length})` }, { status: 502 });
  const last = cal.length - 1;

  // 3. Grouped bars: last 20 sessions, and 21 / 252 back.
  const recentDates = cal.slice(last - 19).reverse();
  const recent = await Promise.all(recentDates.map(d => pg<Grouped>(`/v2/aggs/grouped/locale/us/market/stocks/${d}?adjusted=true`).then(toMap)));
  if (recent.some(m => m.size === 0)) return NextResponse.json({ success: false, error: 'a recent grouped day came back empty' }, { status: 502 });
  const [d21, d252] = await Promise.all([cal[last - 21], cal[last - 252]].map(d => pg<Grouped>(`/v2/aggs/grouped/locale/us/market/stocks/${d}?adjusted=true`).then(toMap)));
  if (!d21.size || !d252.size) return NextResponse.json({ success: false, error: 'lookback grouped day empty' }, { status: 502 });

  const { universe, rows } = rankMomentum(names, recent, d21, d252);
  if (rows.length < 20) return NextResponse.json({ success: false, error: `only ${rows.length} ranked names`, universe }, { status: 502 });
  const list: MomentumList = { asOf: cal[last], builtAt: new Date().toISOString(), universe, rows };
  await kv.set(MOMENTUM_KEY, list);
  return NextResponse.json({ success: true, asOf: list.asOf, universe, top: rows.slice(0, 10).map(r => `${r.t} ${r.mom.toFixed(0)}%`) });
}

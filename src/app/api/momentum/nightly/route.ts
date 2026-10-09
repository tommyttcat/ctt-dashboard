// app/api/momentum/nightly/route.ts — rebuild Momentum Leaders (lib/momentum).
//
// 18:10 ET on weekdays (two UTC hours + etGate). Reads Polygon's reference
// list (common stock + ADRs) and the grouped daily bars for the last 20
// sessions plus the sessions 21 and 252 back (dates from SPY's own daily
// history), ranks, and writes the top 50.
//
// Cost per run: 1 KV read of the earnings scores (~90 KB), 2 writes (list
// ~6 KB, universe ~10 KB), plus the hidden paper records' 1 mget + up to 2
// sets (~20 KB each). Polygon: ~7 reference pages, 1 SPY
// history call, 22 grouped-daily calls. Flat in users — the page reads it
// through /api/momentum/latest behind the CDN.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { etGate } from '@/lib/etCron';
import { authorized, authorizedOrAdmin } from '@/lib/apiAuth';
import {
  MOMENTUM_KEY, MOMENTUM_PAPER_KEY, MOMENTUM_PAPER_P2_KEY, MOMENTUM_UNIVERSE_KEY, MIN_SUE_NAMES,
  newPaper, rankMomentum, rankCombined, stepPaper, type MomentumList, type MomentumPaper,
} from '@/lib/momentum';
import { SUE_KEY, sueFresh, type SueStore } from '@/lib/sue';

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

type Grouped = { results?: { T: string; o: number; c: number; v: number }[] };
const toMap = (j: Grouped | null) => new Map((j?.results ?? []).map(r => [r.T, { o: r.o, c: r.c, v: r.v }]));

export async function GET(req: Request) {
  if (new URL(req.url).searchParams.get('view') === '1') {
    if (!(await authorizedOrAdmin(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const [p, p2] = await kv.mget<[MomentumPaper | null, MomentumPaper | null]>(MOMENTUM_PAPER_KEY, MOMENTUM_PAPER_P2_KEY);
    const view = (x: MomentumPaper | null) => { const l = x?.daily.at(-1); return x ? { startedOn: x.startedOn, lastDate: x.lastDate, navPct: l ? +((l[1] - 1) * 100).toFixed(2) : null, spyPct: l ? +((l[2] - 1) * 100).toFixed(2) : null, days: x.daily.length, daily: x.daily } : null; };
    return NextResponse.json({ momentum: view(p), momentumPlusEarnings: view(p2) });
  }
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

  const { universe, rows, all } = rankMomentum(names, recent, d21, d252);
  if (rows.length < 20) return NextResponse.json({ success: false, error: `only ${rows.length} ranked names`, universe }, { status: 502 });
  /* The tested best (rank-pead.ts P2) once enough names carry a fresh
     earnings score (kept by /api/earnings/sue); plain momentum until then. */
  const sue = (await kv.get<SueStore>(SUE_KEY))?.map ?? {};
  const scored = all.filter(r => sueFresh(sue[r.t], cal[last])).length;
  const combined = scored >= MIN_SUE_NAMES ? rankCombined(all, sue, cal[last]) : null;
  const list: MomentumList = {
    asOf: cal[last], builtAt: new Date().toISOString(), universe, scored,
    ranking: combined ? 'momentum+earnings' : 'momentum', rows: combined ?? rows,
  };
  await kv.set(MOMENTUM_KEY, list);
  await kv.set(MOMENTUM_UNIVERSE_KEY, all.map(r => r.t));

  /* The hidden forward record: the same list held as the test held it. Fenced
     so a fault here never costs the list itself. 1 KV get + 1 set. */
  let paper: Record<string, unknown> | string = 'skipped (error, see logs)';
  try {
    const month = cal[last].slice(0, 7);
    const som = cal.filter(d => d.slice(0, 7) === month).length;
    const [p1, p2Stored] = await kv.mget<[MomentumPaper | null, MomentumPaper | null]>(MOMENTUM_PAPER_KEY, MOMENTUM_PAPER_P2_KEY);
    const p = p1 ?? newPaper(cal[last]);
    stepPaper(p, cal[last], som, recent[0], rows.map(r => r.t));
    await kv.set(MOMENTUM_PAPER_KEY, p);
    // The combined list's own record starts the first night it exists.
    const p2 = p2Stored ?? (combined ? newPaper(cal[last]) : null);
    if (p2) { stepPaper(p2, cal[last], som, recent[0], (combined ?? rows).map(r => r.t)); await kv.set(MOMENTUM_PAPER_P2_KEY, p2); }
    const d = p.daily.at(-1), d2 = p2?.daily.at(-1);
    paper = {
      som, held: p.sleeves.map(s => s.hold.length),
      momentumPct: d ? +((d[1] - 1) * 100).toFixed(2) : null, spyPct: d ? +((d[2] - 1) * 100).toFixed(2) : null,
      combinedPct: d2 ? +((d2[1] - 1) * 100).toFixed(2) : null,
    };
  } catch (e) {
    console.error('MOMENTUM_PAPER_ERROR', e);
  }
  return NextResponse.json({ success: true, asOf: list.asOf, universe, scored, ranking: list.ranking, top: list.rows.slice(0, 10).map(r => r.t), paper });
}

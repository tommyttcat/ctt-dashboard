// app/api/exposure/nightly/route.ts — the Market exposure rule (lib/exposure), nightly.
//
// 18:20 ET weekdays (two UTC hours + etGate). Decides tomorrow's exposure from
// tonight's close: QQQ vs its 200-day, and the washout breadth computed as the
// test did. Breadth needs each name's last 41 closes, and thin names skip
// sessions, so it reads 150 sessions of whole-market grouped bars — with
// fewer, borderline days fall on the other side of 20% (100 sessions: 3 days
// flipped and the 4-year result moved from +197% to +169%;
// scripts/backtest/exposure-equivalence.ts). A failed day aborts the run
// rather than computing breadth from partial data.
//
// Cost per run: ~150 Polygon grouped-daily calls (~180 MB in, no call cap on
// the plan) + 1 QQQ history call; ~30 s; 1 KV get + 1 set. Flat in users: the
// page reads /api/exposure/latest behind the CDN. `?view=1` (admin or key)
// returns the hidden forward record.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { etGate } from '@/lib/etCron';
import { authorized, authorizedOrAdmin } from '@/lib/apiAuth';
import { EXPOSURE_KEY, breadth, stepExposure, type ExposureState } from '@/lib/exposure';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const KEY = process.env.POLYGON_API_KEY || '';
const etDate = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const HISTORY = 150;

async function pg<T>(path: string): Promise<T | null> {
  for (let a = 0; a < 3; a++) {
    const res = await fetch(`https://api.polygon.io${path}${path.includes('?') ? '&' : '?'}apiKey=${KEY}`, { cache: 'no-store', signal: AbortSignal.timeout(25000) }).catch(() => null);
    if (res?.ok) return (await res.json().catch(() => null)) as T | null;
    await new Promise(r => setTimeout(r, 1000 * (a + 1)));
  }
  return null;
}

export async function GET(req: Request) {
  if (new URL(req.url).searchParams.get('view') === '1') {
    if (!(await authorizedOrAdmin(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const s = await kv.get<ExposureState>(EXPOSURE_KEY);
    if (!s) return NextResponse.json({ empty: true });
    const last = s.record.daily.at(-1);
    return NextResponse.json({ startedOn: s.record.startedOn, asOf: s.asOf, rulePct: +((s.record.nav - 1) * 100).toFixed(2), qqqPct: last ? +((last[2] - 1) * 100).toFixed(2) : null, spyPct: last ? +((last[3] - 1) * 100).toFixed(2) : null, daily: s.record.daily });
  }
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const gate = etGate([18], 'market exposure nightly');
  if (gate) return gate;
  if (!KEY) return NextResponse.json({ success: false, error: 'no data key' }, { status: 500 });
  const t0 = Date.now();

  // QQQ history = the session calendar and the 200-day.
  const qh = await pg<{ results?: { t: number; c: number }[] }>(`/v2/aggs/ticker/QQQ/range/1/day/${etDate(Date.now() - 400 * 864e5)}/${etDate(Date.now())}?adjusted=true&sort=asc&limit=500`);
  const q = (qh?.results ?? []).map(r => ({ d: etDate(r.t), c: r.c }));
  if (q.length < HISTORY || q.length < 200) return NextResponse.json({ success: false, error: `QQQ history too short (${q.length})` }, { status: 502 });
  const date = q[q.length - 1].d;

  const prev = await kv.get<ExposureState>(EXPOSURE_KEY);
  if (prev?.asOf === date) return NextResponse.json({ success: true, note: `already decided at the ${date} close`, mode: prev.mode });

  // 150 sessions of whole-market closes, oldest first; any failure aborts.
  const dates = q.slice(-HISTORY).map(x => x.d);
  const days: Map<string, number>[] = new Array(dates.length);
  for (let i = 0; i < dates.length; i += 10) {
    const batch = dates.slice(i, i + 10);
    const got = await Promise.all(batch.map(d => pg<{ results?: { T: string; c: number }[] }>(`/v2/aggs/grouped/locale/us/market/stocks/${d}?adjusted=true`)));
    for (let j = 0; j < batch.length; j++) {
      const rows = got[j]?.results;
      if (!rows?.length) return NextResponse.json({ success: false, error: `grouped bars missing for ${batch[j]} — not deciding on partial data` }, { status: 502 });
      days[i + j] = new Map(rows.map(r => [r.T, r.c]));
    }
  }
  const b = breadth(days);
  const spy = days[days.length - 1].get('SPY');
  if (b.value == null || !spy) return NextResponse.json({ success: false, error: 'breadth or SPY unavailable', total: b.total }, { status: 502 });

  const next = stepExposure(prev, date, q.map(x => x.c), q.map(x => x.d), b.value, spy);
  await kv.set(EXPOSURE_KEY, next);
  return NextResponse.json({
    success: true, asOf: date, mode: next.mode, exposure: next.exposure, qqq: next.qqq, sma200: next.sma200,
    breadth: next.breadth, breadthNames: b.total, boostDay: next.boostDay, seconds: Math.round((Date.now() - t0) / 1000),
  });
}

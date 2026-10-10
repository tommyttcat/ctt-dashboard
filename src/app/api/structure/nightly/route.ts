// app/api/structure/nightly/route.ts — Chart Structure (lib/structure), once each trading evening.
//
// 17:55 ET on weekdays (two UTC hours + etGate), after Liquid Leaders' nightly
// (17:40) has refreshed its universe. Reads that universe (one KV read), pulls
// ~260 daily bars per name from Polygon (unlimited on this plan; ~1,000 calls,
// 10 at a time), classifies each chart, and writes STRUCTURE_KEY (one KV write).
// Only names with a shape are stored. Nothing here runs per page view.
// force=1 (cron secret or a signed-in admin) rebuilds outside the window.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { authorized, authorizedOrAdmin } from '@/lib/apiAuth';
import { etGate } from '@/lib/etCron';
import { LEADERS_STATE_KEY, type LeadersState } from '@/lib/leaders';
import { STRUCTURE_KEY, readStructure, type StructureRow, type StructureState } from '@/lib/structure';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const KEY = process.env.POLYGON_API_KEY || '';
const BUDGET_MS = 240_000;

async function pg<T = any>(path: string): Promise<T | null> {
  for (let a = 0; a < 3; a++) {
    const res = await fetch(`https://api.polygon.io${path}${path.includes('?') ? '&' : '?'}apiKey=${KEY}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (res?.ok) return (await res.json().catch(() => null)) as T | null;
    await new Promise(r => setTimeout(r, 500 * (a + 1)));
  }
  return null;
}
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get('force') === '1';
  if (!(force ? await authorizedOrAdmin(req) : authorized(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const gate = force ? null : etGate([17], 'chart structure nightly');
  if (gate) return gate;
  if (!KEY) return NextResponse.json({ success: false, error: 'no data key' }, { status: 500 });

  const t0 = Date.now();
  const leaders = await kv.get<LeadersState>(LEADERS_STATE_KEY);
  const tickers = Object.keys(leaders?.names ?? {});
  if (!tickers.length) return NextResponse.json({ success: false, error: 'no Liquid Leaders universe yet' });
  const from = ymd(Date.now() - 400 * 86400000), to = ymd(Date.now());
  const rows: StructureRow[] = [];
  let asOf = '', done = 0;
  for (let i = 0; i < tickers.length && Date.now() - t0 < BUDGET_MS; i += 10) {
    await Promise.allSettled(tickers.slice(i, i + 10).map(async t => {
      const j = await pg<{ results?: { t: number; h: number; l: number; c: number }[] }>(`/v2/aggs/ticker/${encodeURIComponent(t)}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=400`);
      const bars = (j?.results ?? []).slice(-260);
      done++;
      if (bars.length < 127) return;
      const r = readStructure(bars);
      if (!r.shape) return;
      const last = bars[bars.length - 1], prev = bars[bars.length - 2];
      const d = new Date(last.t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      if (d > asOf) asOf = d;
      rows.push({ t, n: leaders!.names[t]?.n, price: last.c, chg: +((last.c / prev.c - 1) * 100).toFixed(2), ...r });
    }));
  }
  const state: StructureState = { asOf, builtAt: new Date().toISOString(), universe: done, rows };
  await kv.set(STRUCTURE_KEY, state);
  const count = (f: (r: StructureRow) => boolean) => rows.filter(f).length;
  return NextResponse.json({
    success: true, asOf, universe: done, of: tickers.length, stored: rows.length, ms: Date.now() - t0,
    shapes: { up: count(r => r.shape === 'uptrend' || r.shape === 'channel-up'), down: count(r => r.shape === 'downtrend' || r.shape === 'channel-down'), range: count(r => r.shape === 'range'), bounce: count(r => r.bounce), breakout: count(r => r.breakout) },
  });
}

// app/api/earnings/sue/route.ts — keep each liquid stock's earnings surprise current.
//
// 18:40 ET weekdays, after /api/momentum/nightly has written tonight's
// universe. Fetches FMP quarterly income statements only where needed and
// stores one SUE per ticker (lib/sue). Momentum Leaders reads the store the
// next evening, so a new quarter reaches the ranking a session after it is
// filed — later than the backtest assumed, never earlier.
//
// Which tickers are fetched tonight, in order, up to the time budget:
//   1. in the universe but never fetched (the first-week backfill);
//   2. reported earnings in the last 45 days (FMP earnings calendar) and the
//      stored score is anchored to an earlier filing, not re-tried for 2 days;
//   3. stored score older than 30 days (catches anything the calendar missed).
//
// Cost per run: 1 KV mget (universe + store, ~100 KB) and 1 set (~90 KB).
// FMP: 1 calendar call + up to ~600 income-statement calls (~22 KB each),
// paced to ~200 a minute so the dashboard's own FMP quotes keep headroom
// under the plan's 300/min. Steady state after the backfill: tens of calls a
// night. Flat in users.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { etGate } from '@/lib/etCron';
import { authorized } from '@/lib/apiAuth';
import { SUE_KEY, fromFmp, sueAt, type SueStore } from '@/lib/sue';
import { MOMENTUM_UNIVERSE_KEY } from '@/lib/momentum';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const FMP = (process.env.FMP_API_KEY || '').trim();
const BUDGET_MS = 240_000;
const PER_MINUTE = 200;
const etDate = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 864e5;

async function fmp<T>(path: string): Promise<T | null> {
  for (let a = 0; a < 2; a++) {
    const res = await fetch(`https://financialmodelingprep.com/stable/${path}${path.includes('?') ? '&' : '?'}apikey=${FMP}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) }).catch(() => null);
    if (res?.ok) return (await res.json().catch(() => null)) as T | null;
    if (res?.status === 429) await new Promise(r => setTimeout(r, 5000));
  }
  return null;
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const gate = etGate([18], 'earnings SUE refresh');
  if (gate) return gate;
  if (!FMP) return NextResponse.json({ success: false, error: 'no FMP key' }, { status: 500 });
  const t0 = Date.now();
  const today = etDate(Date.now());

  const [universe, stored] = await kv.mget<[string[] | null, SueStore | null]>(MOMENTUM_UNIVERSE_KEY, SUE_KEY);
  if (!universe?.length) return NextResponse.json({ success: false, error: 'no universe yet — /api/momentum/nightly writes it' });
  const store: SueStore = stored ?? { updatedAt: '', map: {} };

  // Who reported recently (one call).
  const cal = await fmp<{ symbol: string; date: string }[]>(`earnings-calendar?from=${etDate(Date.now() - 45 * 864e5)}&to=${today}`);
  const reported = new Map<string, string>();
  for (const r of cal ?? []) if (r?.symbol && r?.date) { const prev = reported.get(r.symbol); if (!prev || r.date > prev) reported.set(r.symbol, r.date); }

  const missing: string[] = [], recent: string[] = [], old: string[] = [];
  for (const t of universe) {
    const e = store.map[t];
    if (!e) { missing.push(t); continue; }
    const rep = reported.get(t);
    if (rep && (!e.f || e.f < rep) && daysBetween(e.a, today) >= 2) { recent.push(t); continue; }
    if (daysBetween(e.a, today) > 30) old.push(t);
  }
  const queue = [...recent, ...missing, ...old];

  let fetched = 0, scored = 0, failed = 0;
  const gap = 60_000 / PER_MINUTE;
  for (const t of queue) {
    if (Date.now() - t0 > BUDGET_MS) break;
    const started = Date.now();
    const rows = await fmp<{ fiscalYear?: string; period?: string; filingDate?: string; eps?: number }[]>(`income-statement?symbol=${encodeURIComponent(t)}&period=quarter&limit=16`);
    if (rows == null) { failed++; }
    else {
      const r = sueAt(fromFmp(rows), today);
      store.map[t] = { s: r.sue != null ? +r.sue.toFixed(4) : null, f: r.filed, a: today };
      fetched++;
      if (r.sue != null) scored++;
    }
    const wait = gap - (Date.now() - started);
    if (wait > 0) await new Promise(res => setTimeout(res, wait));
  }

  store.updatedAt = new Date().toISOString();
  await kv.set(SUE_KEY, store);
  const total = Object.keys(store.map).length;
  return NextResponse.json({
    success: true, today, universe: universe.length, queued: { recent: recent.length, missing: missing.length, old: old.length },
    fetched, scored, failed, stored: total, withScore: Object.values(store.map).filter(e => e.s != null).length,
    seconds: Math.round((Date.now() - t0) / 1000),
  });
}

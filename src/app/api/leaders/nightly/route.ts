// app/api/leaders/nightly/route.ts — rebuild the Liquid Leaders universe (lib/leaders).
//
// Once each trading evening (Vercel cron at both candidate UTC hours; etGate
// keeps it to 17:xx ET, after the close and after Polygon's grouped bars land):
//   1. NASDAQ + NYSE common stock from Polygon reference (names included).
//   2. The last 20 sessions of grouped daily bars: price and 20-day average
//      dollar / share volume -> the universe (close >= $10, $100M+ a day).
//   3. 5-year highs of close and of close / SPY: from each name's own daily
//      history the first time it appears (one call), then rolled forward with
//      each night's close — so after the first night this costs no per-name
//      calls. New names are backfilled within a time budget; any left over are
//      done the next night.
//   4. Each name's usual volume by half hour: 20 sessions of 30-minute bars
//      (one small call per name, budgeted the same way; a name keeps its last
//      profile if it is not reached).
// Writes LEADERS_STATE_KEY (about 150 KB). Nothing here runs per page view.
// Polygon calls are unlimited on this plan; the budget is the function's time.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { authorized } from '@/lib/apiAuth';
import { etGate } from '@/lib/etCron';
import { etToday } from '@/lib/orb';
import { etMinute } from '@/lib/orb';
import {
  LEADERS_STATE_KEY, LEADERS_MIN_PRICE, LEADERS_MIN_DVOL, BUCKETS, profileOf,
  type LeadersState, type LeaderHist,
} from '@/lib/leaders';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BASE = 'https://api.polygon.io';
const KEY = process.env.POLYGON_API_KEY || '';
const BUDGET_MS = 240_000;
const OPEN = 9 * 60 + 30;

async function pg<T = any>(path: string): Promise<T | null> {
  const url = path.startsWith('http') ? `${path}${path.includes('?') ? '&' : '?'}apiKey=${KEY}` : `${BASE}${path}${path.includes('?') ? '&' : '?'}apiKey=${KEY}`;
  for (let a = 0; a < 3; a++) {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (res?.ok) return (await res.json().catch(() => null)) as T | null;
    await new Promise(r => setTimeout(r, 500 * (a + 1)));
  }
  return null;
}
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const etDay = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

async function inBatches<T>(items: T[], size: number, deadline: number, fn: (x: T) => Promise<void>): Promise<number> {
  let done = 0;
  for (let i = 0; i < items.length && Date.now() < deadline; i += size) {
    await Promise.allSettled(items.slice(i, i + size).map(fn));
    done = Math.min(items.length, i + size);
  }
  return done;
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const gate = etGate([17], 'liquid leaders nightly');
  if (gate) return gate;
  if (!KEY) return NextResponse.json({ success: false, error: 'no polygon key' }, { status: 500 });
  const t0 = Date.now();
  const deadline = t0 + BUDGET_MS;

  // 1. Reference: common stock on NASDAQ / NYSE.
  const names = new Map<string, string>();
  for (const ex of ['XNAS', 'XNYS']) {
    let next: string | null = `/v3/reference/tickers?type=CS&market=stocks&active=true&exchange=${ex}&limit=1000`;
    for (let p = 0; next && p < 20; p++) {
      const j: { results?: { ticker: string; name?: string }[]; next_url?: string } | null = await pg(next);
      for (const r of j?.results ?? []) names.set(r.ticker, r.name ?? r.ticker);
      next = j?.next_url ?? null;
    }
  }
  if (names.size < 1000) return NextResponse.json({ success: false, error: `reference too small (${names.size})` }, { status: 502 });

  // 2. The last 20 sessions of grouped bars.
  const days: { d: string; bars: Map<string, { c: number; v: number }> }[] = [];
  for (let back = 0; days.length < 20 && back < 40; back++) {
    const d = ymd(Date.now() - back * 864e5);
    const j = await pg<{ results?: { T: string; c: number; v: number }[] }>(`/v2/aggs/grouped/locale/us/market/stocks/${d}?adjusted=true`);
    if (j?.results?.length) days.push({ d, bars: new Map(j.results.map(r => [r.T, { c: r.c, v: r.v }])) });
  }
  if (days.length < 20) return NextResponse.json({ success: false, error: `only ${days.length} sessions of grouped bars` }, { status: 502 });
  const today = days[0];
  const spyToday = today.bars.get('SPY')?.c;
  if (!spyToday) return NextResponse.json({ success: false, error: 'no SPY close' }, { status: 502 });

  const universe: { t: string; adv: number }[] = [];
  for (const [t] of names) {
    const last = today.bars.get(t); if (!last || last.c < LEADERS_MIN_PRICE) continue;
    let dv = 0, v = 0, n = 0;
    for (const day of days) { const b = day.bars.get(t); if (b) { dv += b.c * b.v; v += b.v; n++; } }
    if (n < 15 || dv / n < LEADERS_MIN_DVOL) continue;
    universe.push({ t, adv: v / n });
  }

  const prior = await kv.get<LeadersState>(LEADERS_STATE_KEY);
  const out: Record<string, LeaderHist> = {};

  // 3. 5-year highs: roll existing names forward, backfill new ones.
  const from5y = ymd(Date.now() - 5 * 365 * 864e5);
  const spyHist = await pg<{ results?: { t: number; c: number }[] }>(`/v2/aggs/ticker/SPY/range/1/day/${from5y}/${today.d}?adjusted=true&sort=asc&limit=50000`);
  const spyBy = new Map((spyHist?.results ?? []).map(r => [etDay(r.t), r.c]));
  const needHist: { t: string; adv: number }[] = [];
  for (const u of universe) {
    const p = prior?.names?.[u.t];
    const c = today.bars.get(u.t)!.c;
    if (p && prior!.date < today.d) out[u.t] = { ...p, n: names.get(u.t), adv: u.adv, maxClose: Math.max(p.maxClose, c), maxRs: Math.max(p.maxRs, c / spyToday) };
    else if (p) out[u.t] = { ...p, n: names.get(u.t), adv: u.adv };
    else needHist.push(u);
  }
  const histDone = await inBatches(needHist, 20, deadline - 60_000, async u => {
    const j = await pg<{ results?: { t: number; c: number }[] }>(`/v2/aggs/ticker/${encodeURIComponent(u.t)}/range/1/day/${from5y}/${today.d}?adjusted=true&sort=asc&limit=50000`);
    const bars = j?.results ?? []; if (!bars.length) return;
    let maxClose = 0, maxRs = 0;
    for (const b of bars) { maxClose = Math.max(maxClose, b.c); const s = spyBy.get(etDay(b.t)); if (s) maxRs = Math.max(maxRs, b.c / s); }
    out[u.t] = { n: names.get(u.t), maxClose, maxRs, adv: u.adv, prof: [] };
  });

  // 4. Usual volume by half hour, from 20 sessions of 30-minute bars.
  const from30 = ymd(Date.now() - 32 * 864e5);
  const withHist = Object.keys(out);
  const profDone = await inBatches(withHist, 25, deadline, async t => {
    const j = await pg<{ results?: { t: number; v: number }[] }>(`/v2/aggs/ticker/${encodeURIComponent(t)}/range/30/minute/${from30}/${today.d}?adjusted=true&sort=asc&limit=50000`);
    const byDay = new Map<string, number[]>();
    for (const b of j?.results ?? []) {
      const m = etMinute(b.t); if (m < OPEN || m >= OPEN + BUCKETS * 30) continue;
      const d = etDay(b.t); const k = Math.floor((m - OPEN) / 30);
      const arr = byDay.get(d) ?? new Array(BUCKETS).fill(-1); arr[k] = b.v; byDay.set(d, arr);
    }
    const sessions = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-20).map(([, a]) => a.map(v => (v < 0 ? 0 : v)));
    const prof = profileOf(sessions);
    if (prof.length) out[t].prof = prof.map(v => Math.round(v));
  });

  const state: LeadersState = { date: today.d, builtAt: new Date().toISOString(), names: out };
  await kv.set(LEADERS_STATE_KEY, state);
  return NextResponse.json({
    success: true, date: today.d, reference: names.size, universe: universe.length, stored: Object.keys(out).length,
    backfilled: `${histDone} of ${needHist.length}`, profiles: `${profDone} of ${withHist.length}`, ms: Date.now() - t0, forToday: etToday(),
  });
}

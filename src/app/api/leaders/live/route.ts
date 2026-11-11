// app/api/leaders/live/route.ts — the Liquid Leaders lists, refreshed in market hours.
//
// Vercel cron every 5 minutes; etGate keeps it to 8:00-16:59 ET, and it works
// from 9:45 (the data is 15 minutes delayed, so that describes 9:30) to 16:30.
// 8:00-9:44 it builds only the Oversold Bounce list, real-time from Webull (earlyOsb).
// One Polygon snapshot of the universe (two calls of up to 600 tickers) plus
// SPY and QQQ, judged against LEADERS_STATE_KEY with lib/leaders buildLive,
// written to LEADERS_LIVE_KEY (tens of KB). The page reads that through the
// CDN-cached /api/leaders/latest, so the cost is flat in users.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { authorized } from '@/lib/apiAuth';
import { etGate } from '@/lib/etCron';
import { isTradingDay } from '@/lib/marketCalendar';
import { etMinute } from '@/lib/orb';
import { loadRsRatings } from '@/lib/indicators/rs';
import { LEADERS_STATE_KEY, LEADERS_LIVE_KEY, LEADERS_OSB_EARLY_KEY, buildLive, buildOsbEarly, osbPoolOf, type LeadersState, type OsbEarly, type Quote } from '@/lib/leaders';
import { webullConfigured, webullSnapshot, dayBase } from '@/lib/webull';
import { STAGE_MAP_KEY, type StageMapState } from '@/lib/stageBreadth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const KEY = process.env.POLYGON_API_KEY || '';
const DELAY_MIN = 15;
const OPEN = 9 * 60 + 30, CLOSE = 16 * 60;
const EARLY_FROM = 8 * 60;   // the real-time Oversold Bounce pass, 8:00 until the first delayed run (9:45)
const etDay = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

/* Oversold Bounce before 9:45 ET (11 Nov 2026): Webull real-time quotes for the ADR-band names only,
   written to LEADERS_OSB_EARLY_KEY. 3 KV commands a run (MGET, the RS GET, SET), 8:00-9:44 = 21 runs a
   day, flat in users; 1-3 Webull snapshot calls a run (100 symbols each) against its 60/min limit. */
async function earlyOsb(now: number) {
  if (!webullConfigured()) return NextResponse.json({ success: false, error: 'live feed not configured' }, { status: 500 });
  const [[state, stages, prev], rsLookup] = await Promise.all([
    kv.mget<[LeadersState | null, StageMapState | null, OsbEarly | null]>(LEADERS_STATE_KEY, STAGE_MAP_KEY, LEADERS_OSB_EARLY_KEY),
    loadRsRatings(),
  ]);
  if (!state?.names || !Object.keys(state.names).length) return NextResponse.json({ success: true, skipped: 'no universe yet (the nightly job builds it)' });
  if (stages?.stage) for (const [t, h] of Object.entries(state.names)) { const s = stages.stage[t]; if (s && !h.etf) h.stg = s; }
  const pre = now < OPEN;
  const prevLows = prev && etDay(prev.asOf) === etDay(Date.now()) ? prev.lows ?? {} : {};
  const pool = osbPoolOf(state);
  const groups: [string[], 'US_STOCK' | 'US_ETF'][] = [[pool.filter(t => !state.names[t].etf), 'US_STOCK'], [pool.filter(t => state.names[t].etf), 'US_ETF']];
  const quotes: Quote[] = [];
  let errors = 0;
  for (const [list, cat] of groups) {
    for (let i = 0; i < list.length; i += 100) {
      const snaps = await webullSnapshot(list.slice(i, i + 100), cat, { extendedHours: pre }).catch(() => { errors++; return []; });
      for (const q of snaps) {
        /* Pre-market: the extended-session print against yesterday's close (lib/webull dayBase); the low is
           the lowest print seen at these runs. From 9:30 the regular session's own low and volume. */
        const price = pre ? q.extPrice ?? 0 : q.price;
        if (!(price > 0)) continue;
        const lo = pre ? Math.min(prevLows[q.symbol] ?? price, price) : q.low > 0 ? Math.min(q.low, price) : price;
        quotes.push({ t: q.symbol, price, prevClose: dayBase(q, pre), vol: (pre ? q.extVolume : q.volume) ?? 0, lo, o: pre ? undefined : q.open || undefined, hi: pre ? undefined : q.high || undefined });
      }
    }
  }
  if (!quotes.length) return NextResponse.json({ success: false, error: 'no quotes', pool: pool.length, errors }, { status: 502 });
  const out = buildOsbEarly(state, quotes, now, Date.now(), pre, rsLookup.available ? rsLookup.get : undefined);
  await kv.set(LEADERS_OSB_EARLY_KEY, out);
  return NextResponse.json({ success: true, early: true, pre, pool: pool.length, quoted: quotes.length, oversold: out.count, errors, top: out.oversold.slice(0, 10).map(r => r.t) });
}

async function snapshot(tickers: string[]): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < tickers.length; i += 600) {
    const url = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickers.slice(i, i + 600).join(',')}&apiKey=${KEY}`;
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20000) }).catch(() => null);
    const j = res?.ok ? await res.json().catch(() => null) : null;
    out.push(...(j?.tickers ?? []));
  }
  return out;
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const gate = etGate([8, 9, 10, 11, 12, 13, 14, 15, 16], 'liquid leaders live');
  if (gate) return gate;
  if (!isTradingDay(new Date())) return NextResponse.json({ success: true, skipped: 'not a trading day' });
  const now = etMinute(Date.now());
  if (now >= EARLY_FROM && now < OPEN + DELAY_MIN) return earlyOsb(now);
  if (now < OPEN + DELAY_MIN || now > CLOSE + 30) return NextResponse.json({ success: true, skipped: 'outside the window' });
  if (!KEY) return NextResponse.json({ success: false, error: 'no data key' }, { status: 500 });

  /* Two KV commands a run: the universe + the System nightly's per-name stages (one MGET; the
     stages, 16 Oct 2026, fill the STG column and feed CNF) and the RS map (one GET via the shared lookup). */
  const [[state, stages], rsLookup] = await Promise.all([
    kv.mget<[LeadersState | null, StageMapState | null]>(LEADERS_STATE_KEY, STAGE_MAP_KEY),
    loadRsRatings(),
  ]);
  if (!state?.names || !Object.keys(state.names).length) return NextResponse.json({ success: true, skipped: 'no universe yet (the nightly job builds it)' });

  if (stages?.stage) for (const [t, h] of Object.entries(state.names)) { const s = stages.stage[t]; if (s && !h.etf) h.stg = s; }
  const tickers = [...Object.keys(state.names), 'SPY', 'QQQ'];
  const snaps = await snapshot(tickers);
  const quotes: Quote[] = [];
  let spyQ: Quote | null = null, qqqQ: Quote | null = null;
  for (const s of snaps) {
    const q: Quote = { t: s.ticker, price: s.lastTrade?.p || s.min?.c || s.day?.c || 0, prevClose: s.prevDay?.c || 0, vol: s.day?.v || 0, lo: s.day?.l || undefined, o: s.day?.o || undefined, hi: s.day?.h || undefined, vw: s.day?.vw || undefined };
    if (q.t === 'SPY') spyQ = q; else if (q.t === 'QQQ') qqqQ = q; else quotes.push(q);
  }
  if (!spyQ || !(spyQ.price > 0)) return NextResponse.json({ success: false, error: 'no SPY quote' }, { status: 502 });
  const idx = (q: Quote | null) => (q && q.prevClose > 0 ? { price: q.price, chg: +((q.price / q.prevClose - 1) * 100).toFixed(2) } : null);
  const clock = Math.min(CLOSE, now - DELAY_MIN);
  const live = buildLive(state, quotes, spyQ.price, clock, Date.now(), { spy: idx(spyQ), qqq: idx(qqqQ) }, rsLookup.available ? rsLookup.get : undefined);
  await kv.set(LEADERS_LIVE_KEY, live);
  return NextResponse.json({ success: true, universe: live.universe, counts: live.counts, clockEt: clock, quotes: quotes.length, rs: rsLookup.available ? rsLookup.asOf : rsLookup.reason });
}

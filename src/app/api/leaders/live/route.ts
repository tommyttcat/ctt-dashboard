// app/api/leaders/live/route.ts — the Liquid Leaders lists, refreshed in market hours.
//
// Vercel cron every 5 minutes; etGate keeps it to 9:00-16:59 ET, and it works
// from 9:45 (the data is 15 minutes delayed, so that describes 9:30) to 16:30.
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
import { LEADERS_STATE_KEY, LEADERS_LIVE_KEY, buildLive, type LeadersState, type Quote } from '@/lib/leaders';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const KEY = process.env.POLYGON_API_KEY || '';
const DELAY_MIN = 15;
const OPEN = 9 * 60 + 30, CLOSE = 16 * 60;

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
  const gate = etGate([9, 10, 11, 12, 13, 14, 15, 16], 'liquid leaders live');
  if (gate) return gate;
  if (!isTradingDay(new Date())) return NextResponse.json({ success: true, skipped: 'not a trading day' });
  const now = etMinute(Date.now());
  if (now < OPEN + DELAY_MIN || now > CLOSE + 30) return NextResponse.json({ success: true, skipped: 'outside the window' });
  if (!KEY) return NextResponse.json({ success: false, error: 'no data key' }, { status: 500 });

  const state = await kv.get<LeadersState>(LEADERS_STATE_KEY);
  if (!state?.names || !Object.keys(state.names).length) return NextResponse.json({ success: true, skipped: 'no universe yet (the nightly job builds it)' });

  const tickers = [...Object.keys(state.names), 'SPY', 'QQQ'];
  const snaps = await snapshot(tickers);
  const quotes: Quote[] = [];
  let spyQ: Quote | null = null, qqqQ: Quote | null = null;
  for (const s of snaps) {
    const q: Quote = { t: s.ticker, price: s.lastTrade?.p || s.min?.c || s.day?.c || 0, prevClose: s.prevDay?.c || 0, vol: s.day?.v || 0 };
    if (q.t === 'SPY') spyQ = q; else if (q.t === 'QQQ') qqqQ = q; else quotes.push(q);
  }
  if (!spyQ || !(spyQ.price > 0)) return NextResponse.json({ success: false, error: 'no SPY quote' }, { status: 502 });
  const idx = (q: Quote | null) => (q && q.prevClose > 0 ? { price: q.price, chg: +((q.price / q.prevClose - 1) * 100).toFixed(2) } : null);
  const clock = Math.min(CLOSE, now - DELAY_MIN);
  const live = buildLive(state, quotes, spyQ.price, clock, Date.now(), { spy: idx(spyQ), qqq: idx(qqqQ) });
  await kv.set(LEADERS_LIVE_KEY, live);
  return NextResponse.json({ success: true, universe: live.universe, counts: live.counts, clockEt: clock, quotes: quotes.length });
}

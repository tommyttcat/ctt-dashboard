// app/api/live-quotes/route.ts — real-time price and day change for the
// Setups Summary names (and the Buy & stop box under it).
//
// The scan rows carry Polygon prices that are 15 minutes delayed and refreshed
// every 15 minutes, so a row can sit 15-30 minutes behind the market. Where a
// stale price changes a decision — WAIT vs HIT against a buy level — the card
// overlays this instead. Webull Level 1 (Nasdaq Basic, real-time; see
// lib/webull), one snapshot call for up to 100 symbols.
//
// COST (fixed 25 Sep 2026, measured before building):
//   - edge-cached 15s per URL: at most 4 Webull calls a minute per distinct
//     symbol list, however many people are looking. Every viewer of the card
//     sends the same sorted list, so that is one list in practice.
//   - zero KV reads or writes. The session check is a JWT signature check.
//   - Webull's snapshot endpoint allows 60 calls/min, shared with /api/macro
//     (about 2.4/min) — so this stays well under it.
//   - the session check is what stops a stranger from burning that shared
//     limit with made-up symbol lists: no session, no Webull call.
// What silently defeats it: a cache-buster on the URL, or an unsorted list
// (each order is its own cache entry). The client sends one sorted,
// de-duplicated list and nothing else.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySession, SESSION_COOKIE } from '@/lib/auth';
import { webullConfigured, webullSnapshot } from '@/lib/webull';
import { getMarketSession } from '@/lib/indicators/marketScorecard';
import { cacheHeaders, noCacheHeaders } from '@/lib/httpCache';

export const dynamic = 'force-dynamic';

const MAX_SYMBOLS = 100;
const SYMBOL = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const EDGE = { sMaxAge: 15, swr: 30 };

export type LiveQuote = { price: number; pct: number; prevClose: number };
export type LiveQuotesPayload = {
  live: boolean;
  asOf: number;
  session: string;
  quotes: Record<string, LiveQuote>;
  error?: string;
};

export async function GET(req: Request) {
  const jar = await cookies();
  const session = await verifySession(jar.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!session) return NextResponse.json({ error: 'sign in' }, { status: 401, headers: noCacheHeaders() });

  const raw = new URL(req.url).searchParams.get('s') || '';
  const symbols = [...new Set(raw.split(',').map((s) => s.trim().toUpperCase()).filter((s) => SYMBOL.test(s)))]
    .sort()
    .slice(0, MAX_SYMBOLS);
  const mkt = getMarketSession();
  const base: LiveQuotesPayload = { live: false, asOf: Date.now(), session: mkt, quotes: {} };
  if (symbols.length === 0) return NextResponse.json(base, { headers: cacheHeaders(EDGE) });
  if (!webullConfigured()) return NextResponse.json({ ...base, error: 'webull not configured' }, { headers: cacheHeaders(EDGE) });

  const preMarket = mkt === 'Pre-Market';
  try {
    const snaps = await webullSnapshot(symbols, 'US_STOCK', { extendedHours: preMarket });
    const quotes: Record<string, LiveQuote> = {};
    for (const q of snaps) {
      /* Before the open the regular-session "price" is yesterday's close, so
         the pre-market print is the live number. After the close, today's
         regular close stays the day's price — the card is about the session. */
      const price = preMarket && q.extPrice ? q.extPrice : q.price;
      const prevClose = q.preClose;
      if (!(price > 0) || !(prevClose > 0)) continue;
      quotes[q.symbol] = { price, prevClose, pct: +(((price - prevClose) / prevClose) * 100).toFixed(2) };
    }
    return NextResponse.json({ ...base, live: Object.keys(quotes).length > 0, quotes }, { headers: cacheHeaders(EDGE) });
  } catch (e) {
    const error = String((e as Error)?.message || e).slice(0, 160);
    console.error('LIVE_QUOTES_ERROR', error);
    return NextResponse.json({ ...base, error }, { headers: cacheHeaders(EDGE) });
  }
}

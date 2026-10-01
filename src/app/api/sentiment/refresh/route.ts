// app/api/sentiment/refresh/route.ts — rebuild the Social Sentiment card (lib/sentiment).
//
// Vercel cron every 15 minutes; etGate keeps it to 7:00-19:59 ET on weekdays.
// Per run: StockTwits trending (1 call) + the latest messages for each name
// (up to 25 calls; the public API allows about 200 an hour, this uses ~100),
// ApeWisdom (1 call), one Bluesky sign-in and up to 25 searches, one price
// snapshot. Writes SENTIMENT_KEY once (~10 KB). The page reads it through the
// CDN-cached /api/sentiment/latest, so the cost is flat in users.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { authorized } from '@/lib/apiAuth';
import { etGate } from '@/lib/etCron';
import { blueskyCashtagPosts } from '@/lib/bluesky';
import { loadRsRatings } from '@/lib/indicators/rs';
import { LEADERS_STATE_KEY, trackingPct, type LeadersState } from '@/lib/leaders';
import { etMinute } from '@/lib/orb';
import {
  SENTIMENT_KEY, pickUniverse, buildRows, postLean,
  type StIn, type RedditIn, type SentimentLive,
} from '@/lib/sentiment';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; CTT/1.0)', Accept: 'application/json' };
const KEY = process.env.POLYGON_API_KEY || '';

async function getJson<T = any>(url: string, ms = 10000): Promise<T | null> {
  const res = await fetch(url, { headers: UA, cache: 'no-store', signal: AbortSignal.timeout(ms) }).catch(() => null);
  return res?.ok ? ((await res.json().catch(() => null)) as T | null) : null;
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const gate = etGate([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19], 'social sentiment');
  if (gate) return gate;

  // 1. Who is being talked about.
  const [stJ, apeJ] = await Promise.all([
    getJson<{ symbols?: any[] }>('https://api.stocktwits.com/api/2/trending/symbols.json'),
    getJson<{ results?: any[] }>('https://apewisdom.io/api/v1.0/filter/all-stocks/page/1'),
  ]);
  const st: StIn[] = (stJ?.symbols ?? [])
    .filter(s => s?.instrument_class === 'Stock' || s?.instrument_class === 'ExchangeTradedFund')
    .map((s, i) => ({ t: String(s.symbol), n: s.title, rank: Number(s.rank) || i + 1, watchers: s.watchlist_count, summary: s.trends?.summary || undefined }));
  const reddit: RedditIn[] = (apeJ?.results ?? []).map(r => ({
    t: String(r.ticker), n: r.name, rank: Number(r.rank), mentions: Number(r.mentions) || 0, prev: Number(r.mentions_24h_ago) || 0, upvotes: Number(r.upvotes) || 0,
  }));
  const names = pickUniverse(st, reddit);
  if (!names.length) return NextResponse.json({ success: false, error: 'no names from StockTwits or Reddit' }, { status: 502 });

  // 2. StockTwits bull / bear tags, five names at a time.
  const stTags = new Map<string, { bull: number; bear: number; msgs: number }>();
  for (let i = 0; i < names.length; i += 5) {
    await Promise.all(names.slice(i, i + 5).map(async t => {
      const j = await getJson<{ messages?: any[] }>(`https://api.stocktwits.com/api/2/streams/symbol/${t}.json`);
      if (!j?.messages) return;
      let bull = 0, bear = 0;
      for (const m of j.messages) {
        const b = m?.entities?.sentiment?.basic;
        if (b === 'Bullish') bull++; else if (b === 'Bearish') bear++;
      }
      stTags.set(t, { bull, bear, msgs: j.messages.length });
    }));
  }

  // 3. Bluesky, 4. prices, 5. RS and usual volume (two KV reads: the RS map, the Liquid Leaders profiles) — in parallel.
  const [bskyPosts, snap, rsLookup, leaders] = await Promise.all([
    blueskyCashtagPosts(names),
    KEY ? getJson<{ tickers?: any[] }>(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${names.join(',')}&apiKey=${KEY}`) : Promise.resolve(null),
    loadRsRatings(),
    kv.get<LeadersState>(LEADERS_STATE_KEY).catch(() => null),
  ]);
  const bsky = new Map<string, { posts: number; bull: number; bear: number }>();
  for (const [t, texts] of bskyPosts ?? []) {
    let bull = 0, bear = 0;
    for (const s of texts) { const l = postLean(s); if (l === 'bull') bull++; else if (l === 'bear') bear++; }
    bsky.set(t, { posts: texts.length, bull, bear });
  }
  const quotes = new Map<string, { price: number; chg: number; vol?: number }>();
  for (const s of snap?.tickers ?? []) {
    const price = s.lastTrade?.p || s.min?.c || s.day?.c || 0, prev = s.prevDay?.c || 0;
    if (price > 0 && prev > 0) quotes.set(s.ticker, { price, chg: +((price / prev - 1) * 100).toFixed(2), vol: s.day?.v || 0 });
  }
  // RVOL on the same footing as Liquid Leaders: against the name's usual volume by this
  // (15-minute delayed) time of day. Names outside that universe (under $10 or $100M a day) stay blank.
  const clock = Math.min(16 * 60, etMinute(Date.now()) - 15);
  const extra = new Map<string, { rvol: number | null; rs: number | null }>();
  for (const t of names) {
    const h = leaders?.names?.[t], v = quotes.get(t)?.vol ?? 0;
    const tr = h?.prof?.length && v > 0 ? trackingPct(v, h.prof, clock) : null;
    extra.set(t, { rvol: tr == null ? null : +Math.max(0, 1 + tr / 100).toFixed(2), rs: rsLookup.available ? rsLookup.get(t) : null });
  }

  const live: SentimentLive = {
    asOf: Date.now(),
    rows: buildRows(names, new Map(st.map(s => [s.t, s])), stTags, new Map(reddit.map(r => [r.t, r])), bsky, quotes, extra),
    sources: {
      stocktwits: stJ ? `${stTags.size} of ${names.length} read` : 'unavailable',
      reddit: apeJ ? 'ok' : 'unavailable',
      bluesky: bskyPosts ? 'ok' : 'unavailable',
    },
  };
  await kv.set(SENTIMENT_KEY, live);
  return NextResponse.json({ success: true, names: names.length, sources: live.sources, quotes: quotes.size });
}

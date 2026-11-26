import { NextResponse } from 'next/server';
import { noCacheHeaders } from '@/lib/httpCache';
import { authorized } from '@/lib/apiAuth';
import { webullConfigured, webullGainersLosers, webullSnapshot } from '@/lib/webull';
import { fetchFreeNewsIndex } from '@/lib/indicators/newsAlt';
import { etDateString, previousTradingDay, isTradingDay } from '@/lib/marketCalendar';
import { adrPct } from '@/lib/indicators/marketMath';
import { paceOf } from '@/lib/scans/checklist';

/* /api/catalysts/candidates — what the catalyst routine reads (25 Nov 2026).
 *
 * Today's gappers (Webull's own pre-market ranking before 9:30 ET, the day
 * ranking after) and the earnings reporters from /api/earnings, each with its
 * last 3 days of headlines from SEC 8-Ks (with the EX-99 press-release
 * headline when there is one) and FMP stock news.
 *
 * Behind the write key: it spends upstream calls (1 Webull ranking + 1-3 snapshots, ~4 FMP, up to
 * ~34 SEC, ~85 Polygon daily-bar reads) and no KV, and only the routine needs it — about 13 runs a
 * weekday.
 *
 * 26 Nov 2026: each candidate carries its move scaled to its own range. `move` is the bigger of the
 * change from the prior close and from today's open; `adr` the 20-session average daily range;
 * `moveAdr` = move / adr; `rvol` today's volume against the 20-session average, paced to the time
 * of day in the session (raw before 9:30). Earnings reporters are chosen by move, not by size.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_GAPPERS = 60;
const MAX_EARNINGS = 25;
const EARN_POOL = 200;     // reporters quoted before the 25 with the biggest moves are kept
const BAR_SESSIONS = 20;
const BAR_CONCURRENCY = 20;
const POLYGON_KEY = (process.env.POLYGON_API_KEY || '').trim();
const MIN_GAP = 0.04;     // +4%
const MIN_PRICE = 1;
const NEWS_PER_TICKER = 4;
const NEWS_MAX_AGE_MS = 3 * 86_400_000;
/* Opinion and recap mills that crowd out the filing or the press release (same list as /api/news), plus StockTwits posts. */
const JUNK_PUBLISHER = /stocktwits|motley fool|fool\.com|marketbeat|24\/7 wall|247 ?wall|defense world|simply wall|insider monkey|zacks|ticker report|etf daily news|american banking news|finbold|validea|talkmarkets|invezz|quiverquant/i;

/* fromOpen: % from today's regular-session open to now (null before 9:30 ET).
   A reporter that gaps down 9% and closes flat (DELL, 25 Nov) shows ~0% chg
   but an 11% move from the open; the routine ranks on the bigger of the two. */
type Quote = { chg: number | null; fromOpen: number | null; price: number | null; vol: number | null; mktCap: number | null };

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: noCacheHeaders() });

  const now = new Date();
  const etMin = (() => {
    const [h, m] = now.toLocaleTimeString('en-GB', { timeZone: 'America/New_York', hour12: false }).split(':').map(Number);
    return h * 60 + m;
  })();
  const preMarket = etMin < 9 * 60 + 30;
  const today = etDateString(now);
  const prevDay = previousTradingDay(today);
  const notes: string[] = [];

  /* Gappers */
  const quotes = new Map<string, Quote>();
  let gapperRows: { ticker: string }[] = [];
  if (webullConfigured()) {
    try {
      const rows = await webullGainersLosers(preMarket ? 'PRE_MARKET' : 'DAY_1', 'gainers');
      gapperRows = rows
        .filter(r => r.symbol && r.price >= MIN_PRICE && r.changeRatio >= MIN_GAP)
        .slice(0, MAX_GAPPERS)
        .map(r => {
          quotes.set(r.symbol, {
            chg: +(r.changeRatio * 100).toFixed(1), fromOpen: null, price: r.price, vol: r.volume || null, mktCap: r.marketValue || null,
          });
          return { ticker: r.symbol };
        });
    } catch (e) { notes.push(`gappers failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`); }
  } else notes.push('Webull not configured');

  /* Earnings: today's reporters plus the previous session's (after-close reports land overnight). */
  let earnRows: { ticker: string; date: string; epsActual: number | null; epsEstimated: number | null; epsSurprisePct: number | null; revenueEstimated: number | null; mktCap: number | null }[] = [];
  try {
    const origin = new URL(req.url).origin;
    const j = await fetch(`${origin}/api/earnings`, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- our own /api/earnings payload
    const events: any[] = Array.isArray(j?.events) ? j.events : [];
    earnRows = events
      .filter(e => e?.symbol && (e.date === today || e.date === prevDay))
      .filter(e => e.date === today || e.epsActual != null)
      .sort((a, b) => (Number(b.mktCap) || 0) - (Number(a.mktCap) || 0))
      .slice(0, EARN_POOL)
      .map(e => ({
        ticker: String(e.symbol).toUpperCase(), date: e.date,
        epsActual: e.epsActual ?? null, epsEstimated: e.epsEstimated ?? null, epsSurprisePct: e.epsSurprisePct ?? null,
        revenueEstimated: e.revenueEstimated ?? null, mktCap: e.mktCap ?? null,
      }));
  } catch (e) { notes.push(`earnings failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`); }

  /* Snapshot quotes: price/chg for earnings names not on the gapper list, and
     — once the regular session is open — today's open for every name, so a move
     from the open counts. 100 symbols a call: 1-3 calls. */
  const poolTickers = [...new Set([...gapperRows.map(r => r.ticker), ...earnRows.map(r => r.ticker)])];
  const need = preMarket ? earnRows.map(r => r.ticker).filter(t => !quotes.has(t)) : poolTickers;
  if (need.length && webullConfigured()) {
    try {
      for (let i = 0; i < need.length; i += 100) {
        const snaps = await webullSnapshot(need.slice(i, i + 100), 'US_STOCK', { extendedHours: true });
        for (const s of snaps) {
          const last = preMarket ? (s.extPrice ?? s.price) : s.price;
          const fromOpen = !preMarket && s.open > 0 && s.price > 0 ? +(((s.price / s.open) - 1) * 100).toFixed(1) : null;
          const have = quotes.get(s.symbol);
          if (have) { have.fromOpen = fromOpen; continue; }
          const chg = s.preClose > 0 && last > 0 ? +(((last / s.preClose) - 1) * 100).toFixed(1) : null;
          const er = earnRows.find(r => r.ticker === s.symbol);
          quotes.set(s.symbol, { chg, fromOpen, price: last || null, vol: (preMarket ? s.extVolume : s.volume) || null, mktCap: er?.mktCap ?? null });
        }
      }
    } catch (e) { notes.push(`snapshot quotes failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`); }
  }

  /* Earnings: keep the 25 reporters with the biggest moves (26 Nov 2026) — by size alone, a flat
     mega-cap took the slot of a mid-cap up 20% on its report. Names with no quote sort last. */
  const moveOf = (t: string): number | null => {
    const q = quotes.get(t);
    if (!q || q.chg == null) return null;
    return Math.max(Math.abs(q.chg), Math.abs(q.fromOpen ?? 0));
  };
  earnRows = earnRows
    .map((r, i) => ({ r, i, m: moveOf(r.ticker) }))
    .sort((a, b) => (b.m ?? -1) - (a.m ?? -1) || a.i - b.i)
    .slice(0, MAX_EARNINGS)
    .map(x => x.r);
  const tickers = [...new Set([...gapperRows.map(r => r.ticker), ...earnRows.map(r => r.ticker)])];

  /* Usual volume and range: the last 20 sessions of daily bars (through the previous session). */
  const usual = new Map<string, { adr: number | null; avgVol: number | null }>();
  if (POLYGON_KEY && tickers.length) {
    const from = new Date(Date.parse(prevDay + 'T12:00:00Z') - 40 * 86_400_000).toISOString().slice(0, 10);
    const one = async (t: string) => {
      try {
        const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(t)}/range/1/day/${from}/${prevDay}?adjusted=true&sort=asc&limit=60&apiKey=${POLYGON_KEY}`;
        const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
        if (!r.ok) return;
        const j = await r.json();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Polygon aggs payload
        const bars = (Array.isArray(j?.results) ? j.results : []).map((b: any) => ({ o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })).slice(-BAR_SESSIONS);
        if (bars.length < 10) return;
        const avgVol = bars.reduce((a: number, b: { v: number }) => a + (b.v || 0), 0) / bars.length;
        usual.set(t, { adr: adrPct(bars, Math.min(BAR_SESSIONS, bars.length)), avgVol: avgVol > 0 ? avgVol : null });
      } catch { /* leave the name without a usual range */ }
    };
    for (let i = 0; i < tickers.length; i += BAR_CONCURRENCY) await Promise.all(tickers.slice(i, i + BAR_CONCURRENCY).map(one));
    if (usual.size < tickers.length / 2) notes.push(`daily bars: ${usual.size} of ${tickers.length} names`);
  } else if (!POLYGON_KEY) notes.push('Polygon not configured: no adr/rvol');

  /* Headlines: SEC 8-Ks + FMP stock news, opinion mills left out */
  const news = new Map<string, { title: string; source: string; url: string | null; at: string | null }[]>();
  try {
    const idx = await fetchFreeNewsIndex(tickers, (process.env.FMP_API_KEY || '').trim(), { batched: true });
    const cutoff = Date.now() - NEWS_MAX_AGE_MS;
    for (const [t, arr] of idx) {
      const items = arr
        .filter(a => !JUNK_PUBLISHER.test(a.publisher?.name ?? ''))
        .filter(a => !a.published_utc || Date.parse(a.published_utc) >= cutoff)
        /* SEC filings first (the primary source), then newest. */
        .sort((a, b) => Number(b.publisher?.name === 'SEC') - Number(a.publisher?.name === 'SEC')
          || String(b.published_utc ?? '').localeCompare(String(a.published_utc ?? '')))
        .slice(0, NEWS_PER_TICKER)
        .map(a => ({ title: String(a.title ?? '').slice(0, 300), source: a.publisher?.name ?? '', url: a.article_url ?? null, at: a.published_utc ?? null }));
      if (items.length) news.set(t, items);
    }
  } catch (e) { notes.push(`news failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`); }

  const earnSet = new Set(earnRows.map(r => r.ticker));
  const gapSet = new Set(gapperRows.map(r => r.ticker));
  const candidates = tickers.map(t => {
    const q = quotes.get(t) ?? { chg: null, fromOpen: null, price: null, vol: null, mktCap: null };
    const u = usual.get(t);
    const move = moveOf(t);
    const adr = u?.adr != null ? +u.adr.toFixed(1) : null;
    const rawRvol = u?.avgVol && q.vol ? q.vol / u.avgVol : null;
    const rvol = rawRvol == null ? null : +(paceOf(rawRvol, etMin) as number).toFixed(1);
    return {
    ticker: t,
    source: gapSet.has(t) && earnSet.has(t) ? 'both' : gapSet.has(t) ? 'gapper' : 'earnings',
    ...q,
    move: move == null ? null : +move.toFixed(1),
    adr,
    moveAdr: move != null && adr ? +(move / adr).toFixed(1) : null,
    rvol,
    earnings: earnRows.find(r => r.ticker === t) ?? null,
    news: news.get(t) ?? [],
    };
  });

  return NextResponse.json({
    asOf: now.toISOString(),
    tradingDay: isTradingDay(today),
    session: preMarket ? 'pre-market' : 'regular',
    gappers: gapperRows.length,
    earnings: earnRows.length,
    notes,
    candidates,
  }, { headers: noCacheHeaders() });
}

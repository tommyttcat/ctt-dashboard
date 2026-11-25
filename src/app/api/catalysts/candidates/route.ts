import { NextResponse } from 'next/server';
import { noCacheHeaders } from '@/lib/httpCache';
import { authorized } from '@/lib/apiAuth';
import { webullConfigured, webullGainersLosers, webullSnapshot } from '@/lib/webull';
import { fetchFreeNewsIndex } from '@/lib/indicators/newsAlt';
import { etDateString, previousTradingDay, isTradingDay } from '@/lib/marketCalendar';

/* /api/catalysts/candidates — what the catalyst routine reads (25 Nov 2026).
 *
 * Today's gappers (Webull's own pre-market ranking before 9:30 ET, the day
 * ranking after) and the earnings reporters from /api/earnings, each with its
 * last 3 days of headlines from SEC 8-Ks (with the EX-99 press-release
 * headline when there is one) and FMP stock news.
 *
 * Behind the write key: it spends upstream calls (2 Webull, ~4 FMP, up to ~34
 * SEC) and no KV, and only the routine needs it — about 4 runs a weekday.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_GAPPERS = 60;
const MAX_EARNINGS = 25;
const MIN_GAP = 0.04;     // +4%
const MIN_PRICE = 1;
const NEWS_PER_TICKER = 4;
const NEWS_MAX_AGE_MS = 3 * 86_400_000;
/* Opinion and recap mills that crowd out the filing or the press release (same list as /api/news), plus StockTwits posts. */
const JUNK_PUBLISHER = /stocktwits|motley fool|fool\.com|marketbeat|24\/7 wall|247 ?wall|defense world|simply wall|insider monkey|zacks|ticker report|etf daily news|american banking news|finbold|validea|talkmarkets|invezz|quiverquant/i;

type Quote = { chg: number | null; price: number | null; vol: number | null; mktCap: number | null };

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
            chg: +(r.changeRatio * 100).toFixed(1), price: r.price, vol: r.volume || null, mktCap: r.marketValue || null,
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
      .slice(0, MAX_EARNINGS)
      .map(e => ({
        ticker: String(e.symbol).toUpperCase(), date: e.date,
        epsActual: e.epsActual ?? null, epsEstimated: e.epsEstimated ?? null, epsSurprisePct: e.epsSurprisePct ?? null,
        revenueEstimated: e.revenueEstimated ?? null, mktCap: e.mktCap ?? null,
      }));
  } catch (e) { notes.push(`earnings failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`); }

  /* Quotes for earnings names that are not already on the gapper list */
  const need = earnRows.map(r => r.ticker).filter(t => !quotes.has(t));
  if (need.length && webullConfigured()) {
    try {
      const snaps = await webullSnapshot(need.slice(0, 100), 'US_STOCK', { extendedHours: true });
      for (const s of snaps) {
        const last = preMarket ? (s.extPrice ?? s.price) : s.price;
        const chg = s.preClose > 0 && last > 0 ? +(((last / s.preClose) - 1) * 100).toFixed(1) : null;
        const er = earnRows.find(r => r.ticker === s.symbol);
        quotes.set(s.symbol, { chg, price: last || null, vol: (preMarket ? s.extVolume : s.volume) || null, mktCap: er?.mktCap ?? null });
      }
    } catch (e) { notes.push(`earnings quotes failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`); }
  }

  /* Headlines: SEC 8-Ks + FMP stock news, opinion mills left out */
  const tickers = [...new Set([...gapperRows.map(r => r.ticker), ...earnRows.map(r => r.ticker)])];
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
  const candidates = tickers.map(t => ({
    ticker: t,
    source: gapSet.has(t) && earnSet.has(t) ? 'both' : gapSet.has(t) ? 'gapper' : 'earnings',
    ...(quotes.get(t) ?? { chg: null, price: null, vol: null, mktCap: null }),
    earnings: earnRows.find(r => r.ticker === t) ?? null,
    news: news.get(t) ?? [],
  }));

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

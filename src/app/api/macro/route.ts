// Deploy to: app/api/macro/route.ts
//
// Server-side, KV-cached macro quotes. The whole point: FMP gets hit at most
// once per minute TOTAL — not once per browser tab, not once per user. Every
// client reads the cached payload. This also keeps the FMP key server-side
// instead of shipping it to the browser.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { computeMoneyFlow, moneyFlowTrend } from '@/lib/indicators/moneyflow';
import { getMarketSession } from '@/lib/indicators/marketScorecard';
import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// 9 equity/ETF symbols. Crypto (BTC/ETH/SOL) stays on the free Coinbase
// WebSocket on the client, so it never touches this route.
const STOCK_SYMBOLS = [
  { id: 'SPY', fmp: 'SPY' },
  { id: 'QQQ', fmp: 'QQQ' },
  { id: 'DIA', fmp: 'DIA' },
  { id: 'IWM', fmp: 'IWM' },
  { id: 'VIX', fmp: '^VIX' },
  { id: 'TLT', fmp: 'TLT' },
  { id: 'GLD', fmp: 'GLD' },
  { id: 'SLV', fmp: 'SLV' },
  { id: 'USO', fmp: 'USO' },
];

const CACHE_KEY = 'macro_quotes_v1';
const CACHE_TTL_MS = 55 * 1000; // serve cache for ~1 min before hitting FMP again


const fetchSafeJson = async (url: string, fallback: any, timeoutMs = 10000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal as any, cache: 'no-store' });
    clearTimeout(id);
    if (!res.ok) return fallback;
    return await res.json();
  } catch (e) {
    clearTimeout(id);
    return fallback;
  }
};

export async function GET() {
  const fmpApiKey = (process.env.FMP_API_KEY || '').trim();
  if (!fmpApiKey) return NextResponse.json({ error: 'Missing FMP key' }, { status: 500, headers: noCacheHeaders() });

  // Market breadth / GMI-style regime is computed by the scanner and cached in
  // its own KV key; read it fresh on every call (cheap) and attach it.
  let breadth: any = null;
  try { breadth = await kv.get('market_breadth_v6'); } catch { /* ignore */ }

  // THE THROTTLE: if the cached payload is still fresh, return it without
  // touching FMP at all. This is what collapses N clients into 1 FMP hit/min.
  try {
    const cached = await kv.get<any>(CACHE_KEY);
    if (cached && cached.updatedAt && Date.now() - cached.updatedAt < CACHE_TTL_MS) {
      return NextResponse.json({ ...cached, breadth, cached: true }, { headers: cacheHeaders(CACHE.LIVE) });
    }
  } catch (e) {
    // KV miss/error — fall through and fetch fresh.
  }

  const session = getMarketSession();
  const isExtended = session === 'Pre-Market' || session === 'Post-Market';

  // Standard quotes (always).
  const quoteResults = (
    await Promise.all(
      STOCK_SYMBOLS.map((s) =>
        fetchSafeJson(
          `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(s.fmp)}&apikey=${fmpApiKey}`,
          []
        )
      )
    )
  ).flat();

  // 5-min extended chart ONLY during real pre/post (never overnight/weekends).
  const ahData: Record<string, number> = {};
  if (isExtended) {
    const ahResults = await Promise.all(
      STOCK_SYMBOLS.map((s) =>
        fetchSafeJson(
          `https://financialmodelingprep.com/stable/historical-chart/5min?symbol=${encodeURIComponent(s.fmp)}&extended=true&apikey=${fmpApiKey}`,
          []
        ).then((d: any) => (Array.isArray(d) && d.length > 0 ? { sym: s.fmp, price: d[0].close } : null))
      )
    );
    ahResults.forEach((r: any) => {
      if (r) ahData[r.sym] = r.price;
    });
  }

  // Polygon supplementary data — SPY snapshot for volume, VIX9D for term structure.
  /* Previous-day high/low, keyed by quote id. Polygon-sourced (see below).
     VIX is an index and this plan has no indices entitlement, so VIX carries
     no previous-day level — the institutional rules no longer depend on one. */
  const prevDay: Record<string, { high: number; low: number }> = {};
  let spyMoneyFlow: { value: number; trend: number } | null = null;

  const polyKey = (process.env.POLYGON_API_KEY || '').trim();
  let polyVolume: { volume: number; avgVolume: number } | null = null;
  let vix9dPrice: number | null = null;
  if (polyKey) {
    /* One snapshot call covers both index ETFs. It carries `prevDay` with the
       previous session's high, low and volume, which is where the previous-day
       levels now come from — FMP's historical-chart call was returning nothing,
       so PDL/PDH never reached the client and the two breakdown rules could
       never fire. This response was already being fetched for SPY volume; only
       `day.v` was being read off it. */
    const AVG_VOL_DAYS = 20;
    /* Money flow needs 21 sessions plus 5 more to read its trend. The same
       aggregate call already serves the volume average, so this costs nothing
       extra — only a wider limit. */
    const MF_LENGTH = 21;
    const MF_TREND_LOOKBACK = 5;
    const AGG_BARS = MF_LENGTH + MF_TREND_LOOKBACK + 2;
    const aggTo = new Date();
    const aggFrom = new Date(aggTo.getTime() - 70 * 86400000);
    const ymdUTC = (d: Date) => d.toISOString().slice(0, 10);

    const [pdSnap, vix9dSnap, spyAggs] = await Promise.all([
      fetchSafeJson(
        `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=SPY,QQQ&apiKey=${polyKey}`,
        null
      ),
      fetchSafeJson(
        `https://api.polygon.io/v3/snapshot?ticker.any_of=I:VIX9D&apiKey=${polyKey}`,
        null
      ),
      /* A genuine 20-session average. The volume-anomaly rule is documented as
         "1.5x the 20-day average" but was comparing against `prevDay.v` — one
         session, not an average — so it read 1.5x yesterday instead. */
      fetchSafeJson(
        `https://api.polygon.io/v2/aggs/ticker/SPY/range/1/day/${ymdUTC(aggFrom)}/${ymdUTC(aggTo)}?adjusted=true&sort=desc&limit=${AGG_BARS}&apiKey=${polyKey}`,
        null
      ),
    ]);

    const snapTickers: any[] = Array.isArray(pdSnap?.tickers) ? pdSnap.tickers : [];
    for (const t of snapTickers) {
      const pd = t?.prevDay;
      if (t?.ticker && pd?.h > 0 && pd?.l > 0) {
        prevDay[t.ticker] = { high: pd.h, low: pd.l };
      }
    }

    const spyT = snapTickers.find((t) => t?.ticker === 'SPY') ?? null;
    if (spyT?.day?.v > 0) {
      /* Drop today's own bar before averaging — sort=desc puts it first when
         the session is open, and including it makes the ratio self-referential. */
      const bars: any[] = Array.isArray(spyAggs?.results) ? spyAggs.results : [];
      const todayYmd = ymdUTC(new Date());
      const priorVols = bars
        .filter((b) => b?.v > 0 && ymdUTC(new Date(b.t)) !== todayYmd)
        .slice(0, AVG_VOL_DAYS)
        .map((b) => b.v as number);
      const avg = priorVols.length >= 5
        ? priorVols.reduce((a, b) => a + b, 0) / priorVols.length
        : (spyT.prevDay?.v ?? 0);
      polyVolume = { volume: spyT.day.v, avgVolume: avg };

      /* Chaikin accumulation/distribution over the same bars. This is the one
         reading here that answers WHICH SIDE GOT FILLED rather than inferring
         it from price direction: it weights where each session closed inside
         its own range by that session's volume. Bars arrive newest-first. */
      const mfBars = bars
        .filter((b) => b?.h > 0 && b?.l > 0 && b?.c > 0 && b?.v > 0)
        .map((b) => ({ h: b.h as number, l: b.l as number, c: b.c as number, v: b.v as number }));
      const mfValue = computeMoneyFlow(mfBars, { order: 'desc', length: MF_LENGTH });
      if (mfValue != null) {
        spyMoneyFlow = {
          value: mfValue,
          trend: moneyFlowTrend(mfBars, { order: 'desc', length: MF_LENGTH, lookback: MF_TREND_LOOKBACK }),
        };
      }
    }
    const vix9dResult = vix9dSnap?.results?.[0];
    if (vix9dResult?.value > 0) vix9dPrice = vix9dResult.value;
    else if (vix9dResult?.session?.close > 0) vix9dPrice = vix9dResult.session.close;
    else if (vix9dResult?.last?.price > 0) vix9dPrice = vix9dResult.last.price;
  }


  // Build the per-symbol payload. Tick direction is computed on the client.
  const quotes: Record<string, any> = {};
  for (const s of STOCK_SYMBOLS) {
    const q = quoteResults.find((x: any) => x?.symbol === s.fmp);
    if (!q) continue;
    const ahPrice = ahData[s.fmp];
    const useAh = isExtended && ahPrice !== undefined && ahPrice > 0;
    const price = useAh ? ahPrice : q.price || 0;
    const baseline = q.previousClose || q.open || price;
    const pct = baseline > 0 ? ((price - baseline) / baseline) * 100 : 0;
    if (price > 0) {
      const entry: any = { price, baseline, pct, isExtended: useAh };
      if (prevDay[s.id]) {
        entry.prevHigh = prevDay[s.id].high;
        entry.prevLow = prevDay[s.id].low;
      }
      if (q.volume > 0) entry.volume = q.volume;
      if (s.id === 'SPY' && polyVolume) {
        entry.volume = polyVolume.volume;
        entry.avgVolume = polyVolume.avgVolume;
      }
      quotes[s.id] = entry;
    }
  }

  if (vix9dPrice != null) {
    const vixBase = quotes['VIX']?.baseline;
    quotes['VIX9D'] = { price: vix9dPrice, baseline: vixBase ?? vix9dPrice, pct: 0 };
  }

  /* moneyFlow rides alongside quotes rather than inside SPY's entry: it is a
     21-session reading, not a live quote, and the client caches quote entries
     per tick. */
  const payload = { session, updatedAt: Date.now(), quotes, moneyFlow: spyMoneyFlow };

  // Only overwrite the cache if we actually got data — never cache an empty wipe.
  if (Object.keys(quotes).length > 0) {
    try {
      await kv.set(CACHE_KEY, payload);
    } catch (e) {
      // non-fatal
    }
  }

  return NextResponse.json({ ...payload, breadth }, { headers: cacheHeaders(CACHE.LIVE) });
}
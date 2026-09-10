// Deploy to: app/api/macro/route.ts
//
// Server-side, KV-cached macro quotes. The whole point: upstream providers get
// hit at most once per minute TOTAL — not once per browser tab, not once per
// user. Every client reads the cached payload. This also keeps every API key
// server-side instead of shipping it to the browser.
//
// Quote sources (10 Sep 2026): the eight ETFs come from Webull's real-time
// Level 1 snapshot, which also carries the pre/post-market print so the FMP
// 5-minute extended chart is no longer needed. VIX is an index Webull does not
// serve, so it stays on FMP. If Webull is unconfigured or fails, every symbol
// falls back to the FMP quote exactly as before. Polygon still supplies the
// previous-day levels, daily bars (money flow, 20-day volume) and VIX9D.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { computeMoneyFlow, moneyFlowTrend } from '@/lib/indicators/moneyflow';
import { getMarketSession } from '@/lib/indicators/marketScorecard';
import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';
import { webullConfigured, webullSnapshot, webullCapitalFlow, type WebullCapitalFlowDay } from '@/lib/webull';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// 9 equity/ETF symbols. Crypto (BTC/ETH/SOL) stays on the free Coinbase
// WebSocket on the client, so it never touches this route.
const STOCK_SYMBOLS: { id: string; fmp: string; webull?: string }[] = [
  { id: 'SPY', fmp: 'SPY', webull: 'SPY' },
  { id: 'QQQ', fmp: 'QQQ', webull: 'QQQ' },
  { id: 'DIA', fmp: 'DIA', webull: 'DIA' },
  { id: 'IWM', fmp: 'IWM', webull: 'IWM' },
  { id: 'VIX', fmp: '^VIX' }, // index — not on Webull Level 1
  { id: 'TLT', fmp: 'TLT', webull: 'TLT' },
  { id: 'GLD', fmp: 'GLD', webull: 'GLD' },
  { id: 'SLV', fmp: 'SLV', webull: 'SLV' },
  { id: 'USO', fmp: 'USO', webull: 'USO' },
];

/* Capital flow (large/medium/small order in-vs-out, USD) for the two index
   ETFs. Daily granularity — intraday the newest row is today's running total. */
const CAPITAL_FLOW_SYMBOLS = ['SPY', 'QQQ'] as const;
const CAPITAL_FLOW_DAYS = 5;

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

  /* Webull real-time snapshot first. One call covers all eight ETFs, and the
     extended-hours print rides on the same response. Any symbol Webull does
     not return (or every symbol, if the call fails) drops to FMP below. */
  type LiveQuote = { price: number; baseline: number; volume: number; extPrice: number | null };
  const live: Record<string, LiveQuote> = {};
  const sources: { quotes: 'webull' | 'fmp' | 'mixed'; webullError?: string } = { quotes: 'fmp' };
  let capitalFlow: Record<string, WebullCapitalFlowDay[]> | null = null;

  if (webullConfigured()) {
    const wbSymbols = STOCK_SYMBOLS.filter((s) => s.webull).map((s) => s.webull as string);
    const [snapRes, ...flowRes] = await Promise.allSettled([
      webullSnapshot(wbSymbols, 'US_ETF', { extendedHours: isExtended }),
      ...CAPITAL_FLOW_SYMBOLS.map((sym) => webullCapitalFlow(sym, CAPITAL_FLOW_DAYS)),
    ]);
    if (snapRes.status === 'fulfilled') {
      for (const q of snapRes.value) {
        if (q.price > 0) {
          live[q.symbol] = { price: q.price, baseline: q.preClose || q.open || q.price, volume: q.volume, extPrice: q.extPrice };
        }
      }
    } else {
      sources.webullError = String(snapRes.reason?.message || snapRes.reason).slice(0, 200);
    }
    const flows: Record<string, WebullCapitalFlowDay[]> = {};
    CAPITAL_FLOW_SYMBOLS.forEach((sym, i) => {
      const r = flowRes[i];
      if (r?.status === 'fulfilled' && r.value.length > 0) flows[sym.toLowerCase()] = r.value;
      else if (r?.status === 'rejected' && !sources.webullError) {
        sources.webullError = String(r.reason?.message || r.reason).slice(0, 200);
      }
    });
    if (Object.keys(flows).length > 0) capitalFlow = flows;
  }

  // FMP quotes for whatever Webull did not cover (always VIX; everything on a Webull failure).
  const fmpSymbols = STOCK_SYMBOLS.filter((s) => !(s.webull && live[s.webull]));
  const quoteResults = (
    await Promise.all(
      fmpSymbols.map((s) =>
        fetchSafeJson(
          `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(s.fmp)}&apikey=${fmpApiKey}`,
          []
        )
      )
    )
  ).flat();
  const liveCount = Object.keys(live).length;
  sources.quotes = liveCount === 0 ? 'fmp' : fmpSymbols.length <= 1 ? 'webull' : 'mixed';

  // 5-min extended chart ONLY during real pre/post, and only for FMP-served symbols.
  const ahData: Record<string, number> = {};
  if (isExtended) {
    const ahResults = await Promise.all(
      fmpSymbols.map((s) =>
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
  let qqqMoneyFlow: { value: number; trend: number } | null = null;

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

    const [pdSnap, vix9dSnap, spyAggs, qqqAggs] = await Promise.all([
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
      /* QQQ daily bars, for its own money-flow reading. Polygon is unmetered
         on this plan and these are daily bars, so the delayed feed costs the
         reading nothing. */
      fetchSafeJson(
        `https://api.polygon.io/v2/aggs/ticker/QQQ/range/1/day/${ymdUTC(aggFrom)}/${ymdUTC(aggTo)}?adjusted=true&sort=desc&limit=${AGG_BARS}&apiKey=${polyKey}`,
        null
      ),
    ]);

    /* Chaikin accumulation/distribution over daily bars. This is the one
       reading on the card that answers WHICH SIDE GOT FILLED rather than
       inferring it from price direction: it weights where each session closed
       inside its own range by that session's volume. Bars arrive newest-first.
       The newest is today's partial bar, which is normal for a live reading. */
    const readMoneyFlow = (raw: any[]): { value: number; trend: number } | null => {
      const mfBars = (raw || [])
        .filter((b) => b?.h > 0 && b?.l > 0 && b?.c > 0 && b?.v > 0)
        .map((b) => ({ h: b.h as number, l: b.l as number, c: b.c as number, v: b.v as number }));
      const value = computeMoneyFlow(mfBars, { order: 'desc', length: MF_LENGTH });
      if (value == null) return null;
      return {
        value,
        trend: moneyFlowTrend(mfBars, { order: 'desc', length: MF_LENGTH, lookback: MF_TREND_LOOKBACK }),
      };
    };

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

      const mfBars = bars
        .filter((b) => b?.h > 0 && b?.l > 0 && b?.c > 0 && b?.v > 0)
        .map((b) => ({ h: b.h as number, l: b.l as number, c: b.c as number, v: b.v as number }));
      spyMoneyFlow = readMoneyFlow(bars);
    }

    qqqMoneyFlow = readMoneyFlow(Array.isArray(qqqAggs?.results) ? qqqAggs.results : []);
    const vix9dResult = vix9dSnap?.results?.[0];
    if (vix9dResult?.value > 0) vix9dPrice = vix9dResult.value;
    else if (vix9dResult?.session?.close > 0) vix9dPrice = vix9dResult.session.close;
    else if (vix9dResult?.last?.price > 0) vix9dPrice = vix9dResult.last.price;
  }


  // Build the per-symbol payload. Tick direction is computed on the client.
  const quotes: Record<string, any> = {};
  for (const s of STOCK_SYMBOLS) {
    const wb = s.webull ? live[s.webull] : undefined;
    const q = wb ? null : quoteResults.find((x: any) => x?.symbol === s.fmp);
    if (!wb && !q) continue;
    let price: number;
    let baseline: number;
    let useAh: boolean;
    if (wb) {
      useAh = isExtended && wb.extPrice != null && wb.extPrice > 0;
      price = useAh ? (wb.extPrice as number) : wb.price;
      baseline = wb.baseline || price;
    } else {
      const ahPrice = ahData[s.fmp];
      useAh = isExtended && ahPrice !== undefined && ahPrice > 0;
      price = useAh ? ahPrice : q.price || 0;
      baseline = q.previousClose || q.open || price;
    }
    const pct = baseline > 0 ? ((price - baseline) / baseline) * 100 : 0;
    if (price > 0) {
      const entry: any = { price, baseline, pct, isExtended: useAh };
      if (prevDay[s.id]) {
        entry.prevHigh = prevDay[s.id].high;
        entry.prevLow = prevDay[s.id].low;
      }
      const vol = wb ? wb.volume : q.volume;
      if (vol > 0) entry.volume = vol;
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
  /* `moneyFlow` keeps SPY's reading at the top level so a client running the
     previous shape (or a KV payload written by it) still resolves; `spy` and
     `qqq` are the explicit form. */
  /* `capitalFlow` is Webull's daily large/medium/small order flow for SPY and
     QQQ, newest row last. Null when Webull is unconfigured or the call failed.
     `sources` says where the quotes came from so a production payload can be
     read for provenance without digging through logs. */
  const payload = {
    session,
    updatedAt: Date.now(),
    quotes,
    moneyFlow: spyMoneyFlow ? { ...spyMoneyFlow, spy: spyMoneyFlow, qqq: qqqMoneyFlow } : null,
    capitalFlow,
    sources,
  };

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
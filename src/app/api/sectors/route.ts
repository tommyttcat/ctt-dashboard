// /api/sectors — Sector Performance & Money Flow for the SPDR sector ETFs
//
// Source (10 Sep 2026): Webull's real-time Level 1 snapshot, one call for all
// eleven ETFs. Polygon's snapshot is 15 minutes delayed on this plan and is
// kept only as the fallback when Webull is unconfigured or fails. Computes a
// volume-weighted money flow metric per sector. Cached in KV for 5 min.
//
// Webull carries no VWAP, so dollar volume uses the session's typical price
// ((high + low + last) / 3) instead of Polygon's day.vw. Same sign convention.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';
import { getMarketSession } from '@/lib/indicators/marketScorecard';
import { webullConfigured, webullSnapshot } from '@/lib/webull';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

const CACHE_KEY = 'sector_flow_v2';
const CACHE_TTL_MS = 290 * 1000;

const SECTOR_ETFS: { ticker: string; sector: string }[] = [
  { ticker: 'XLK', sector: 'Technology' },
  { ticker: 'XLF', sector: 'Financials' },
  { ticker: 'XLE', sector: 'Energy' },
  { ticker: 'XLV', sector: 'Health Care' },
  { ticker: 'XLI', sector: 'Industrials' },
  { ticker: 'XLC', sector: 'Communication Services' },
  { ticker: 'XLY', sector: 'Consumer Discretionary' },
  { ticker: 'XLP', sector: 'Consumer Staples' },
  { ticker: 'XLRE', sector: 'Real Estate' },
  { ticker: 'XLU', sector: 'Utilities' },
  { ticker: 'XLB', sector: 'Materials' },
];


const fetchSafeJson = async (url: string, fallback: any, timeoutMs = 8000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal as any, cache: 'no-store' });
    clearTimeout(id);
    if (!res.ok) return fallback;
    return await res.json();
  } catch {
    clearTimeout(id);
    return fallback;
  }
};

export async function GET() {
  const polygonKey = (process.env.POLYGON_API_KEY || '').trim();
  if (!polygonKey) return NextResponse.json({ error: 'Missing Polygon key' }, { status: 500, headers: noCacheHeaders() });

  let stale: any = null;
  try {
    const cached = await kv.get<any>(CACHE_KEY);
    if (cached) {
      stale = cached;
      if (cached.updatedAt && Date.now() - cached.updatedAt < CACHE_TTL_MS) {
        return NextResponse.json({ ...cached, cached: true }, { headers: cacheHeaders(CACHE.SCAN) });
      }
    }
  } catch {
    // fall through
  }

  const session = getMarketSession();
  const isExtended = session === 'Pre-Market' || session === 'Post-Market';
  const tickerList = SECTOR_ETFS.map(e => e.ticker);

  /* Per-ETF reading in one shape regardless of provider. */
  type Reading = { changePct: number; vol: number; refPrice: number };
  const readings = new Map<string, Reading>();
  let source: 'webull' | 'polygon' = 'polygon';
  let webullError: string | undefined;

  if (webullConfigured()) {
    try {
      const rows = await webullSnapshot(tickerList, 'US_ETF', { extendedHours: isExtended });
      for (const r of rows) {
        const base = r.preClose || r.open;
        const last = isExtended && r.extPrice != null && r.extPrice > 0 ? r.extPrice : r.price;
        if (!(base > 0) || !(last > 0)) continue;
        const typical = r.high > 0 && r.low > 0 ? (r.high + r.low + last) / 3 : last;
        readings.set(r.symbol, { changePct: ((last - base) / base) * 100, vol: r.volume, refPrice: typical });
      }
      if (readings.size > 0) source = 'webull';
    } catch (e) {
      webullError = String((e as Error)?.message || e).slice(0, 200);
    }
  }

  if (readings.size === 0) {
    const snapshotUrl = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickerList.join(',')}&apiKey=${polygonKey}`;
    const snap = await fetchSafeJson(snapshotUrl, { tickers: [] });
    const tickerData: any[] = Array.isArray(snap?.tickers) ? snap.tickers : [];
    for (const t of tickerData) {
      if (!t?.ticker) continue;
      readings.set(t.ticker, {
        changePct: t.todaysChangePerc ?? 0,
        vol: t.day?.v ?? t.day?.volume ?? 0,
        refPrice: t.day?.vw ?? t.day?.vwap ?? t.day?.c ?? 0,
      });
    }
  }

  const sectors: {
    sector: string;
    etf: string;
    changesPercentage: number;
    volume: number;
    dollarVolume: number;
    moneyFlow: number;
  }[] = [];

  for (const { ticker, sector } of SECTOR_ETFS) {
    const r = readings.get(ticker);
    if (!r) continue;

    const dollarVol = r.vol * r.refPrice;
    // Money flow: dollar volume * direction of change (positive = inflow, negative = outflow)
    const flow = r.changePct >= 0 ? dollarVol : -dollarVol;

    sectors.push({
      sector,
      etf: ticker,
      changesPercentage: Math.round(r.changePct * 100) / 100,
      volume: r.vol,
      dollarVolume: Math.round(dollarVol),
      moneyFlow: Math.round(flow),
    });
  }

  sectors.sort((a, b) => b.changesPercentage - a.changesPercentage);

  if (sectors.length === 0 && stale?.sectors?.length > 0) {
    return NextResponse.json({ ...stale, cached: true, stale: true }, { headers: cacheHeaders(CACHE.SCAN) });
  }

  const payload = { session, updatedAt: Date.now(), sectors, source, ...(webullError ? { webullError } : {}) };

  if (sectors.length > 0) {
    try {
      await kv.set(CACHE_KEY, payload);
    } catch {
      // non-fatal
    }
  }

  return NextResponse.json(payload, { headers: cacheHeaders(CACHE.SCAN) });
}

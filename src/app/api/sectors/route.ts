// /api/sectors — Polygon-backed Sector Performance & Money Flow
//
// Uses Polygon snapshot for SPDR sector ETFs to get real-time price change
// and volume. Computes a volume-weighted money flow metric per sector.
// One Polygon call for snapshots, cached in KV for 5 min.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';
import { getMarketSession } from '@/lib/indicators/marketScorecard';

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
  const tickers = SECTOR_ETFS.map(e => e.ticker).join(',');
  const snapshotUrl = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickers}&apiKey=${polygonKey}`;

  const snap = await fetchSafeJson(snapshotUrl, { tickers: [] });
  const tickerData: any[] = Array.isArray(snap?.tickers) ? snap.tickers : [];

  const tickerMap = new Map<string, any>();
  for (const t of tickerData) {
    if (t?.ticker) tickerMap.set(t.ticker, t);
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
    const t = tickerMap.get(ticker);
    if (!t) continue;

    const changePct = t.todaysChangePerc ?? 0;
    const vol = t.day?.v ?? t.day?.volume ?? 0;
    const vwap = t.day?.vw ?? t.day?.vwap ?? t.day?.c ?? 0;
    const dollarVol = vol * vwap;
    // Money flow: dollar volume * direction of change (positive = inflow, negative = outflow)
    const flow = changePct >= 0 ? dollarVol : -dollarVol;

    sectors.push({
      sector,
      etf: ticker,
      changesPercentage: Math.round(changePct * 100) / 100,
      volume: vol,
      dollarVolume: Math.round(dollarVol),
      moneyFlow: Math.round(flow),
    });
  }

  sectors.sort((a, b) => b.changesPercentage - a.changesPercentage);

  if (sectors.length === 0 && stale?.sectors?.length > 0) {
    return NextResponse.json({ ...stale, cached: true, stale: true }, { headers: cacheHeaders(CACHE.SCAN) });
  }

  const payload = { session, updatedAt: Date.now(), sectors };

  if (sectors.length > 0) {
    try {
      await kv.set(CACHE_KEY, payload);
    } catch {
      // non-fatal
    }
  }

  return NextResponse.json(payload, { headers: cacheHeaders(CACHE.SCAN) });
}

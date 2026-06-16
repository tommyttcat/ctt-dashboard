// Deploy to: app/api/macro/route.ts
//
// Server-side, KV-cached macro quotes. The whole point: FMP gets hit at most
// once per minute TOTAL — not once per browser tab, not once per user. Every
// client reads the cached payload. This also keeps the FMP key server-side
// instead of shipping it to the browser.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

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

const getMarketSession = (): string => {
  const est = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = est.getDay();
  const t = est.getHours() + est.getMinutes() / 60;
  if (day === 0 || day === 6) return 'Closed';
  if (t >= 4 && t < 9.5) return 'Pre-Market';
  if (t >= 9.5 && t < 16) return 'Open';
  if (t >= 16 && t < 20) return 'Post-Market';
  return 'Closed';
};

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
  const fmpApiKey = (process.env.FMP_API_KEY || process.env.NEXT_PUBLIC_FMP_API_KEY || '').trim();
  if (!fmpApiKey) return NextResponse.json({ error: 'Missing FMP key' }, { status: 500 });

  // THE THROTTLE: if the cached payload is still fresh, return it without
  // touching FMP at all. This is what collapses N clients into 1 FMP hit/min.
  try {
    const cached = await kv.get<any>(CACHE_KEY);
    if (cached && cached.updatedAt && Date.now() - cached.updatedAt < CACHE_TTL_MS) {
      return NextResponse.json({ ...cached, cached: true });
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
    if (price > 0) quotes[s.id] = { price, baseline, pct, isExtended: useAh };
  }

  const payload = { session, updatedAt: Date.now(), quotes };

  // Only overwrite the cache if we actually got data — never cache an empty wipe.
  if (Object.keys(quotes).length > 0) {
    try {
      await kv.set(CACHE_KEY, payload);
    } catch (e) {
      // non-fatal
    }
  }

  return NextResponse.json(payload);
}
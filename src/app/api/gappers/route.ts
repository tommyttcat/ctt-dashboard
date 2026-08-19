import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

const POLYGON_KEY = (
  process.env.POLYGON_API_KEY ||
  process.env.POLYGON_API_KEY ||
  ''
).trim();

const CACHE_KEY = 'gappers_v1';
const CACHE_TTL_MS = 90 * 1000;

const MIN_PRICE = 5;
const MIN_GAP_PCT = 3;
const MIN_VOLUME = 100_000;
const TOP_N = 15;

async function fetchSafeJson(url: string, fallback: any, timeoutMs = 12000) {
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
}

function getMarketPhase(): 'pre' | 'open' | 'post' | 'closed' {
  const est = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = est.getDay();
  const t = est.getHours() + est.getMinutes() / 60;
  if (day === 0 || day === 6) return 'closed';
  if (t >= 4 && t < 9.5) return 'pre';
  if (t >= 9.5 && t < 16) return 'open';
  if (t >= 16 && t < 20) return 'post';
  return 'closed';
}

export async function GET() {
  if (!POLYGON_KEY) {
    return NextResponse.json({ error: 'Missing Polygon key' }, { status: 500, headers: noCacheHeaders() });
  }

  try {
    const cached = await kv.get<any>(CACHE_KEY);
    if (cached && cached.updatedAt && Date.now() - cached.updatedAt < CACHE_TTL_MS) {
      return NextResponse.json({ ...cached, cached: true }, { headers: cacheHeaders(CACHE.SCAN) });
    }
  } catch { /* fall through */ }

  const phase = getMarketPhase();

  const snapRes = await fetchSafeJson(
    `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?apiKey=${POLYGON_KEY}`,
    { tickers: [] }
  );
  const tickers = snapRes.tickers || [];
  if (tickers.length === 0) {
    return NextResponse.json({ error: 'No snapshot data' }, { status: 500, headers: noCacheHeaders() });
  }

  const gappers: any[] = [];

  for (const t of tickers) {
    if (!t.ticker || !/^[A-Z]{1,5}$/.test(t.ticker)) continue;

    const prevClose = t.prevDay?.c || 0;
    if (prevClose <= 0) continue;

    const price = t.lastTrade?.p || t.min?.c || t.day?.c || 0;
    if (price < MIN_PRICE) continue;

    const vol = t.day?.v || 0;
    if (vol < MIN_VOLUME && phase !== 'pre') continue;

    const open = t.day?.o || price;
    const gapPct = ((open - prevClose) / prevClose) * 100;

    if (Math.abs(gapPct) < MIN_GAP_PCT) continue;

    const changePct = ((price - prevClose) / prevClose) * 100;
    const dVol = price * vol;

    gappers.push({
      ticker: t.ticker,
      price: Math.round(price * 100) / 100,
      prevClose: Math.round(prevClose * 100) / 100,
      open: Math.round(open * 100) / 100,
      gapPct: Math.round(gapPct * 100) / 100,
      changePct: Math.round(changePct * 100) / 100,
      vol,
      dVol: Math.round(dVol),
      high: t.day?.h || price,
      low: t.day?.l || price,
    });
  }

  const gappersUp = gappers
    .filter((g) => g.gapPct > 0)
    .sort((a, b) => b.gapPct - a.gapPct)
    .slice(0, TOP_N);

  const gappersDown = gappers
    .filter((g) => g.gapPct < 0)
    .sort((a, b) => a.gapPct - b.gapPct)
    .slice(0, TOP_N);

  const payload = {
    phase,
    gappersUp,
    gappersDown,
    totalGapUp: gappers.filter((g) => g.gapPct > 0).length,
    totalGapDown: gappers.filter((g) => g.gapPct < 0).length,
    updatedAt: Date.now(),
  };

  try {
    await kv.set(CACHE_KEY, payload, { ex: 300 });
  } catch { /* non-fatal */ }

  return NextResponse.json(payload, { headers: cacheHeaders(CACHE.SCAN) });
}

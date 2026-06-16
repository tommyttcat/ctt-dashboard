// Deploy to: app/api/sectors/route.ts
//
// Server-side, KV-cached Sector Flow data. Two things were hitting FMP from the
// browser: the sector/industry snapshot (every 5 min, 2-6 calls, per tab) and
// ETF sector weightings (a fresh call on every SPY/QQQ/DIA/IWM click, per tab).
// This route does both server-side once per ~5 min and pre-fetches ALL FOUR
// ETFs, so tab-switching on the client costs zero FMP calls.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ETF_TICKERS = ['SPY', 'QQQ', 'DIA', 'IWM'];
const CACHE_KEY = 'sector_flow_v1';
const CACHE_TTL_MS = 290 * 1000; // ~5 min — refresh FMP at most once per 5 min

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

const isoDate = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Walk back through recent days (skipping weekends) so we land on a session
// that actually has data — handles weekends, holidays, and pre-open.
const getFallbackDates = (): string[] => {
  const dates: string[] = [];
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  for (let i = 0; i < 3; i++) {
    if (d.getDay() === 0) d.setDate(d.getDate() - 2);
    if (d.getDay() === 6) d.setDate(d.getDate() - 1);
    dates.push(isoDate(d));
    d.setDate(d.getDate() - 1);
  }
  return dates;
};

const fetchSafeJson = async (url: string, fallback: any, timeoutMs = 12000) => {
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

  // THE THROTTLE: serve fresh cache without touching FMP.
  try {
    const cached = await kv.get<any>(CACHE_KEY);
    if (cached && cached.updatedAt && Date.now() - cached.updatedAt < CACHE_TTL_MS) {
      return NextResponse.json({ ...cached, cached: true });
    }
  } catch (e) {
    // fall through and fetch fresh
  }

  const session = getMarketSession();

  // Sector + industry snapshots, with fallback-date retry until real data shows.
  const tryDates = getFallbackDates();
  let finalSectors: any[] = [];
  let finalIndustries: any[] = [];
  for (const date of tryDates) {
    const [sData, iData] = await Promise.all([
      fetchSafeJson(`https://financialmodelingprep.com/stable/sector-performance-snapshot?date=${date}&apikey=${fmpApiKey}`, []),
      fetchSafeJson(`https://financialmodelingprep.com/stable/industry-performance-snapshot?date=${date}&apikey=${fmpApiKey}`, []),
    ]);
    const sArr = Array.isArray(sData) ? sData : [];
    const iArr = Array.isArray(iData) ? iData : [];
    const hasReal = sArr.some((s: any) => {
      const pct = s.averageChange ?? s.changesPercentage ?? 0;
      return parseFloat(pct) !== 0 && !isNaN(parseFloat(pct));
    });
    if (hasReal) {
      finalSectors = sArr;
      finalIndustries = iArr;
      break;
    }
  }

  const sectors = finalSectors
    .map((s: any) => ({
      sector: s.sector,
      changesPercentage: parseFloat(s.averageChange ?? s.changesPercentage ?? 0),
    }))
    .sort((a, b) => b.changesPercentage - a.changesPercentage)
    .slice(0, 11);

  const industries = finalIndustries
    .map((i: any) => ({
      industry: i.industry,
      changesPercentage: parseFloat(i.averageChange ?? i.changesPercentage ?? 0),
    }))
    .sort((a, b) => b.changesPercentage - a.changesPercentage)
    .slice(0, 10);

  // Pre-fetch ALL four ETF weightings so client tab-switching never hits FMP.
  const etfWeights: Record<string, any[]> = {};
  await Promise.all(
    ETF_TICKERS.map(async (ticker) => {
      const data = await fetchSafeJson(
        `https://financialmodelingprep.com/stable/etf/sector-weightings?symbol=${ticker}&apikey=${fmpApiKey}`,
        []
      );
      etfWeights[ticker] = Array.isArray(data)
        ? data
            .map((item: any) => ({
              sector: item.sector,
              weightPercentage: parseFloat(String(item.weightPercentage).replace('%', '')) || 0,
            }))
            .sort((a, b) => b.weightPercentage - a.weightPercentage)
            .slice(0, 8)
        : [];
    })
  );

  const payload = { session, updatedAt: Date.now(), sectors, industries, etfWeights };

  // Only cache if we actually got sector data — never cache an empty wipe.
  if (sectors.length > 0) {
    try {
      await kv.set(CACHE_KEY, payload);
    } catch (e) {
      // non-fatal
    }
  }

  return NextResponse.json(payload);
}
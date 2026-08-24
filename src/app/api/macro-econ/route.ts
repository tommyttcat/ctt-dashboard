import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

const CACHE_KEY = 'macro_econ_av_v2';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

interface IndicatorDef {
  id: string;
  label: string;
  fn: string;
  unit: string;
  params?: string;
}

const INDICATORS: IndicatorDef[] = [
  { id: 'fedFunds',     label: 'Fed Funds Rate',   fn: 'FEDERAL_FUNDS_RATE', unit: '%',     params: 'interval=monthly' },
  { id: 'treasury10y',  label: '10Y Treasury',     fn: 'TREASURY_YIELD',     unit: '%',     params: 'interval=daily&maturity=10year' },
  { id: 'treasury2y',   label: '2Y Treasury',      fn: 'TREASURY_YIELD',     unit: '%',     params: 'interval=daily&maturity=2year' },
  { id: 'cpi',          label: 'CPI',              fn: 'CPI',               unit: 'index', params: 'interval=monthly' },
  { id: 'inflation',    label: 'Inflation (YoY)',  fn: 'INFLATION',          unit: '%' },
  { id: 'unemployment', label: 'Unemployment',     fn: 'UNEMPLOYMENT',       unit: '%' },
  { id: 'gdp',          label: 'Real GDP',         fn: 'REAL_GDP',           unit: 'B$',    params: 'interval=quarterly' },
  { id: 'retailSales',  label: 'Retail Sales',     fn: 'RETAIL_SALES',       unit: 'M$' },
  { id: 'nonfarm',      label: 'Nonfarm Payroll',  fn: 'NONFARM_PAYROLL',    unit: 'K' },
  { id: 'wti',          label: 'WTI Crude',        fn: 'WTI',               unit: '$/bbl',  params: 'interval=monthly' },
];

const fetchSafeJson = async (url: string, timeoutMs = 12000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal as any, cache: 'no-store' });
    clearTimeout(id);
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.Information || data?.Note) return null;
    return data;
  } catch {
    clearTimeout(id);
    return null;
  }
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface DataPoint { date: string; value: string; }

function parseLatest(data: any): { latest: DataPoint; previous: DataPoint } | null {
  if (!data?.data || !Array.isArray(data.data)) return null;
  const valid = data.data.filter((d: DataPoint) => d.value !== '.' && d.value != null);
  if (valid.length < 2) return null;
  return { latest: valid[0], previous: valid[1] };
}

export async function GET() {
  const apiKey = (process.env.ALPHA_VANTAGE_API_KEY || '').trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Missing ALPHA_VANTAGE_API_KEY' },
      { status: 500, headers: noCacheHeaders() },
    );
  }

  // Load existing cache — we'll merge new results into it
  let cached: any = null;
  try {
    cached = await kv.get<any>(CACHE_KEY);
  } catch { /* miss */ }

  // If cache is fresh enough, serve it directly
  if (cached?.updatedAt && Date.now() - cached.updatedAt < CACHE_TTL_MS) {
    return NextResponse.json(cached, { headers: cacheHeaders(CACHE.SLOW) });
  }

  // Build a map of previously cached indicators so we can keep them
  // if the new fetch fails (AV rate limit)
  const existingById = new Map<string, any>();
  if (cached?.indicators) {
    for (const ind of cached.indicators) {
      existingById.set(ind.id, ind);
    }
  }

  // Fetch sequentially with 1.5s gaps
  const CALL_GAP_MS = 1500;
  let newCount = 0;

  for (let i = 0; i < INDICATORS.length; i++) {
    if (i > 0) await delay(CALL_GAP_MS);
    const ind = INDICATORS[i];
    const params = ind.params ? `&${ind.params}` : '';
    const url = `https://www.alphavantage.co/query?function=${ind.fn}${params}&apikey=${apiKey}`;
    const data = await fetchSafeJson(url);
    const parsed = parseLatest(data);
    if (!parsed) continue;

    const latestVal = parseFloat(parsed.latest.value);
    const prevVal = parseFloat(parsed.previous.value);
    if (isNaN(latestVal)) continue;

    existingById.set(ind.id, {
      id: ind.id,
      label: ind.label,
      unit: ind.unit,
      value: latestVal,
      previousValue: isNaN(prevVal) ? null : prevVal,
      change: !isNaN(prevVal) ? latestVal - prevVal : null,
      date: parsed.latest.date,
      previousDate: parsed.previous.date,
      sourceName: data?.name || ind.label,
    });
    newCount++;
  }

  // Assemble indicators in the canonical order
  const indicators = INDICATORS
    .map(def => existingById.get(def.id))
    .filter(Boolean);

  if (indicators.length === 0) {
    return NextResponse.json(
      { error: 'No indicator data available' },
      { status: 502, headers: noCacheHeaders() },
    );
  }

  const t10 = existingById.get('treasury10y');
  const t2 = existingById.get('treasury2y');
  let yieldSpread: number | null = null;
  if (t10 && t2) {
    yieldSpread = Math.round((t10.value - t2.value) * 100) / 100;
  }

  const payload = {
    updatedAt: Date.now(),
    updatedAtET: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
    indicators,
    derived: { yieldSpread },
    _meta: { total: indicators.length, newThisRefresh: newCount },
  };

  try {
    await kv.set(CACHE_KEY, payload);
  } catch { /* non-fatal */ }

  return NextResponse.json(payload, { headers: cacheHeaders(CACHE.SLOW) });
}

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

// Match the scanner's env-var chain exactly — same Polygon key, same fallbacks.
const POLYGON_KEY = process.env.NEXT_PUBLIC_POLYGON_API_KEY || process.env.POLYGON_API_KEY || '';
const BENZINGA_KEY = process.env.NEXT_PUBLIC_BENZINGA_API_KEY || process.env.BENZINGA_API_KEY || '';
const BASE = "https://api.polygon.io";

// ---------------------------------------------------------------
// CONFIG — tune all filter thresholds here
// ---------------------------------------------------------------
const CONFIG = {
  minPrice: 12,
  maxPrice: 2000,
  minPrevDayDollarVol: 25_000_000,

  minAtrPct: 1.5,
  maxAtrPct: 6.0,
  maxPctOffHigh: 20,
  minPctOffHigh: 2,
  maxDistToEma21: 4,
  maxStochK: 35,
  requireAbove50: true,
  requireAbove200: true,
  rsLookback: 63,
  earningsBlackoutDays: 7,

  maxSymbolsToAnalyze: 150,
  concurrency: 10,
};

// ---------------------------------------------------------------
// Types
// ---------------------------------------------------------------
interface Bar { t: number; o: number; h: number; l: number; c: number; v: number; }

interface Candidate {
  symbol: string;
  price: number;
  score: number;
  atrPct: number;
  pctOffHigh: number;
  distToEma21: number;
  distToEma10: number;
  aboveEma10: boolean;
  aboveEma21: boolean;
  stochK: number;
  rsVsSpy: number;
  avgDollarVolM: number;
  goldenCross: boolean;
  ema21Rising: boolean;
}

// ---------------------------------------------------------------
// Fetch helpers (Polygon: apiKey as query param, matching the scanner)
// ---------------------------------------------------------------
async function polygon<T = any>(path: string): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${BASE}${path}${sep}apiKey=${POLYGON_KEY}`);
  if (!res.ok) throw new Error(`Polygon ${res.status}: ${path.split("?")[0]}`);
  return res.json() as Promise<T>;
}

function dateStr(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
}

async function getDailyBars(symbol: string): Promise<Bar[]> {
  const from = dateStr(450);
  const to = dateStr(0);
  const data = await polygon<{ results?: Bar[] }>(
    `/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=5000`
  );
  return data.results ?? [];
}

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R | null>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const results = await Promise.allSettled(items.slice(i, i + size).map(fn));
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) out.push(r.value);
    }
  }
  return out;
}

// ---------------------------------------------------------------
// Indicator math
// ---------------------------------------------------------------
function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  return values.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function atr(bars: Bar[], period = 14): number | null {
  if (bars.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const pc = bars[i - 1].c;
    trs.push(Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - pc), Math.abs(bars[i].l - pc)));
  }
  let a = trs.slice(0, period).reduce((x, y) => x + y, 0) / period;
  for (let i = period; i < trs.length; i++) a = (a * (period - 1) + trs[i]) / period;
  return a;
}

function stochK(bars: Bar[], length = 10, smooth = 4): number | null {
  if (bars.length < length + smooth) return null;
  const rawKs: number[] = [];
  for (let i = length - 1; i < bars.length; i++) {
    const win = bars.slice(i - length + 1, i + 1);
    const hh = Math.max(...win.map(b => b.h));
    const ll = Math.min(...win.map(b => b.l));
    rawKs.push(hh === ll ? 50 : ((bars[i].c - ll) / (hh - ll)) * 100);
  }
  const lastN = rawKs.slice(-smooth);
  return lastN.reduce((a, b) => a + b, 0) / lastN.length;
}

function pctReturn(closes: number[], lookback: number): number | null {
  if (closes.length < lookback + 1) return null;
  const then = closes[closes.length - 1 - lookback];
  return ((closes[closes.length - 1] - then) / then) * 100;
}

// ---------------------------------------------------------------
// Stage 1: coarse universe from the full-market snapshot (1 call)
// ---------------------------------------------------------------
async function getUniverse(): Promise<string[]> {
  const data = await polygon<{ tickers?: any[] }>(
    `/v2/snapshot/locale/us/markets/stocks/tickers`
  );
  const tickers = data.tickers ?? [];

  return tickers
    .filter(t => {
      const sym: string = t.ticker ?? "";
      if (!/^[A-Z]{1,5}$/.test(sym)) return false;
      const prev = t.prevDay;
      if (!prev || !prev.c || !prev.v) return false;
      if (prev.c < CONFIG.minPrice || prev.c > CONFIG.maxPrice) return false;
      if (prev.c * prev.v < CONFIG.minPrevDayDollarVol) return false;
      return true;
    })
    .sort((a, b) => (b.prevDay.c * b.prevDay.v) - (a.prevDay.c * a.prevDay.v))
    .slice(0, CONFIG.maxSymbolsToAnalyze)
    .map(t => t.ticker as string);
}

// ---------------------------------------------------------------
// Earnings blackout — Benzinga calendar directly (same key + JSON-accept
// pattern as the scanner's WIIM fetch). Fails open.
// ---------------------------------------------------------------
async function getEarningsBlackout(): Promise<Set<string>> {
  if (!BENZINGA_KEY) return new Set();
  try {
    const from = dateStr(0);
    const to = dateStr(-CONFIG.earningsBlackoutDays); // future date
    const url =
      `https://api.benzinga.com/api/v2.1/calendar/earnings?token=${BENZINGA_KEY}` +
      `&parameters[date_from]=${from}&parameters[date_to]=${to}&pagesize=1000`;
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return new Set();
    const data = await res.json();
    const rows = Array.isArray(data?.earnings) ? data.earnings : [];
    return new Set(rows.map((r: any) => (r?.ticker || '').toUpperCase()).filter(Boolean));
  } catch {
    return new Set();
  }
}

// ---------------------------------------------------------------
// Stage 2: analyze one symbol
// ---------------------------------------------------------------
function analyze(symbol: string, bars: Bar[], spyReturn: number | null): Candidate | null {
  if (bars.length < 210) return null;

  const closes = bars.map(b => b.c);
  const price = closes[closes.length - 1];

  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const ema10 = ema(closes, 10);
  const ema21 = ema(closes, 21);
  const ema21Prev = ema(closes.slice(0, -3), 21);
  const atr14 = atr(bars, 14);
  const kVal = stochK(bars, 10, 4);

  if (!sma50 || !sma200 || !ema10 || !ema21 || !atr14 || kVal == null) return null;

  const atrPct = (atr14 / price) * 100;
  const hi52 = Math.max(...bars.slice(-252).map(b => b.h));
  const pctOffHigh = ((hi52 - price) / hi52) * 100;
  const distToEma21 = ((price - ema21) / ema21) * 100;
  const distToEma10 = ((price - ema10) / ema10) * 100;
  const ema21Rising = ema21Prev != null && ema21 > ema21Prev;

  const dollarVols = bars.slice(-20).map(b => b.c * b.v);
  const avgDollarVol = dollarVols.reduce((a, b) => a + b, 0) / dollarVols.length;

  const ret = pctReturn(closes, CONFIG.rsLookback);
  const rsVsSpy = ret != null && spyReturn != null ? ret - spyReturn : null;

  if (avgDollarVol < CONFIG.minPrevDayDollarVol) return null;
  if (CONFIG.requireAbove50 && price < sma50) return null;
  if (CONFIG.requireAbove200 && price < sma200) return null;
  if (atrPct < CONFIG.minAtrPct || atrPct > CONFIG.maxAtrPct) return null;
  if (pctOffHigh < CONFIG.minPctOffHigh || pctOffHigh > CONFIG.maxPctOffHigh) return null;
  if (Math.abs(distToEma21) > CONFIG.maxDistToEma21) return null;
  if (kVal > CONFIG.maxStochK) return null;
  if (rsVsSpy == null || rsVsSpy <= 0) return null;

  const rsScore = Math.min(rsVsSpy / 30, 1) * 40;
  const pullbackScore =
    (1 - Math.abs(distToEma21) / CONFIG.maxDistToEma21) * 15 +
    (1 - kVal / CONFIG.maxStochK) * 15;
  const volScore = Math.max(0, (1 - Math.abs(atrPct - 3.0) / 3.0) * 15);
  const trendScore = (sma50 > sma200 ? 10 : 0) + (ema21Rising ? 5 : 0);
  const score = Math.round(Math.max(0, rsScore + pullbackScore + volScore + trendScore));

  return {
    symbol,
    price: +price.toFixed(2),
    score,
    atrPct: +atrPct.toFixed(2),
    pctOffHigh: +pctOffHigh.toFixed(1),
    distToEma21: +distToEma21.toFixed(2),
    distToEma10: +distToEma10.toFixed(2),
    aboveEma10: price >= ema10,
    aboveEma21: price >= ema21,
    stochK: +kVal.toFixed(1),
    rsVsSpy: +rsVsSpy.toFixed(1),
    avgDollarVolM: Math.round(avgDollarVol / 1e6),
    goldenCross: sma50 > sma200,
    ema21Rising,
  };
}

// ---------------------------------------------------------------
// Run handler: execute scan, write results to KV
// ---------------------------------------------------------------
export async function GET() {
  try {
    if (!POLYGON_KEY) {
      return NextResponse.json({ success: false, error: 'Missing Polygon API Key' }, { status: 500 });
    }

    const spyBars = await getDailyBars("SPY");
    const spyReturn = pctReturn(spyBars.map(b => b.c), CONFIG.rsLookback);

    const [universe, earningsBlackout] = await Promise.all([getUniverse(), getEarningsBlackout()]);
    const toScan = universe.filter(sym => !earningsBlackout.has(sym));

    const candidates = await inBatches(toScan, CONFIG.concurrency, async (sym) => {
      const bars = await getDailyBars(sym);
      return analyze(sym, bars, spyReturn);
    });

    candidates.sort((a, b) => b.score - a.score);

    // Guard against degenerate scans (weekend-cleared snapshot, provider
    // hiccup): preserve the previous KV data rather than clobbering it —
    // same pattern as the scanner's hasRealData guard.
    const scanTime = Date.now();
    const hasRealData = universe.length > 0 && candidates.length > 0;

    if (hasRealData) {
      await kv.set('swing_candidates_v1', candidates);
      await kv.set('swing_meta_v1', {
        spyReturn3M: spyReturn != null ? +spyReturn.toFixed(1) : null,
        universeSize: universe.length,
        excludedForEarnings: universe.length - toScan.length,
        count: candidates.length,
      });
      await kv.set('swing_last_scan_v1', scanTime);
    } else {
      console.warn('Swing scan produced no candidates; preserving previous KV snapshot.');
    }

    return NextResponse.json({
      success: true,
      lastScanTime: scanTime,
      count: candidates.length,
      universeSize: universe.length,
      excludedForEarnings: universe.length - toScan.length,
      dataPersisted: hasRealData,
    });
  } catch (error: any) {
    console.error("SWING_RUN_ERROR:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
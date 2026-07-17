// app/api/swing-candidates/route.ts
// Swing Reversal Candidates feed for ctt-dashboard — Massive API version
// Pipeline:
//   Stage 1: Massive full-market snapshot (1 call) -> coarse liquid universe
//   Stage 2: per-symbol daily aggregates -> trend / ATR% / pullback /
//            stochastic / RS filters computed locally, scored, ranked
// Cache: in-memory, bust with ?refresh=true (same pattern as /api/market-summary)

export const maxDuration = 60;

const MASSIVE_KEY = process.env.MASSIVE_API_KEY as string;
const BASE = "https://api.massive.com";

// ---------------------------------------------------------------
// CONFIG — tune all filter thresholds here
// ---------------------------------------------------------------
const CONFIG = {
  // Stage 1: coarse snapshot filter
  minPrice: 12,
  maxPrice: 2000,
  minPrevDayDollarVol: 25_000_000, // prev-day close * volume

  // Stage 2: technical filters
  minAtrPct: 1.5,
  maxAtrPct: 6.0,
  maxPctOffHigh: 20,
  minPctOffHigh: 2,
  maxDistToEma21: 4,
  maxStochK: 35,
  requireAbove50: true,
  requireAbove200: true,
  rsLookback: 63,                  // ~3 months vs SPY
  earningsBlackoutDays: 7,

  maxSymbolsToAnalyze: 150,
  concurrency: 10,
  cacheMinutes: 30,
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
  stochK: number;
  rsVsSpy: number;
  avgDollarVolM: number;
  goldenCross: boolean;
  ema21Rising: boolean;
}

interface Payload {
  generatedAt: string;
  spyReturn3M: number | null;
  universeSize: number;
  excludedForEarnings: number;
  count: number;
  candidates: Candidate[];
  cached: boolean;
}

// ---------------------------------------------------------------
// In-memory cache (per serverless instance)
// ---------------------------------------------------------------
let cache: { data: Payload | null; ts: number } = { data: null, ts: 0 };

// ---------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------
async function massive<T = any>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${MASSIVE_KEY}` },
  });
  if (!res.ok) throw new Error(`Massive ${res.status}: ${path.split("?")[0]}`);
  return res.json() as Promise<T>;
}

function dateStr(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
}

async function getDailyBars(symbol: string): Promise<Bar[]> {
  // ~450 calendar days back ≈ 300+ trading days (SMA200 + 52wk high + RS)
  const from = dateStr(450);
  const to = dateStr(0);
  const data = await massive<{ results?: Bar[] }>(
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
// Indicator math (chronological daily bars)
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

// Smoothed %K matching the Dr. Wish dots (10, 4)
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
  const data = await massive<{ tickers?: any[] }>(
    `/v2/snapshot/locale/us/markets/stocks/tickers`
  );
  const tickers = data.tickers ?? [];

  return tickers
    .filter(t => {
      const sym: string = t.ticker ?? "";
      // Plain common-stock symbols only: skip units, warrants, preferreds, ADR suffixes
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
// Earnings blackout (Massive's Benzinga-powered earnings endpoint)
// ---------------------------------------------------------------
async function getEarningsBlackout(): Promise<Set<string>> {
  try {
    const from = dateStr(0);
    const to = dateStr(-CONFIG.earningsBlackoutDays); // future date
    const data = await massive<{ results?: any[] }>(
      `/benzinga/v1/earnings?date.gte=${from}&date.lte=${to}&limit=1000`
    );
    return new Set((data.results ?? []).map(r => r.ticker as string));
  } catch {
    return new Set(); // fail open — a calendar hiccup shouldn't kill the scan
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
  const ema21 = ema(closes, 21);
  const ema21Prev = ema(closes.slice(0, -3), 21);
  const atr14 = atr(bars, 14);
  const kVal = stochK(bars, 10, 4);

  if (!sma50 || !sma200 || !ema21 || !atr14 || kVal == null) return null;

  const atrPct = (atr14 / price) * 100;
  const hi52 = Math.max(...bars.slice(-252).map(b => b.h));
  const pctOffHigh = ((hi52 - price) / hi52) * 100;
  const distToEma21 = ((price - ema21) / ema21) * 100;
  const ema21Rising = ema21Prev != null && ema21 > ema21Prev;

  const dollarVols = bars.slice(-20).map(b => b.c * b.v);
  const avgDollarVol = dollarVols.reduce((a, b) => a + b, 0) / dollarVols.length;

  const ret = pctReturn(closes, CONFIG.rsLookback);
  const rsVsSpy = ret != null && spyReturn != null ? ret - spyReturn : null;

  // ---- Hard filters ----
  if (avgDollarVol < CONFIG.minPrevDayDollarVol) return null;
  if (CONFIG.requireAbove50 && price < sma50) return null;
  if (CONFIG.requireAbove200 && price < sma200) return null;
  if (atrPct < CONFIG.minAtrPct || atrPct > CONFIG.maxAtrPct) return null;
  if (pctOffHigh < CONFIG.minPctOffHigh || pctOffHigh > CONFIG.maxPctOffHigh) return null;
  if (Math.abs(distToEma21) > CONFIG.maxDistToEma21) return null;
  if (kVal > CONFIG.maxStochK) return null;
  if (rsVsSpy == null || rsVsSpy <= 0) return null;

  // ---- Score (0-100): RS 40%, pullback quality 30%, volatility fit 15%, trend structure 15%
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
    stochK: +kVal.toFixed(1),
    rsVsSpy: +rsVsSpy.toFixed(1),
    avgDollarVolM: Math.round(avgDollarVol / 1e6),
    goldenCross: sma50 > sma200,
    ema21Rising,
  };
}

// ---------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const refresh = searchParams.get("refresh") === "true";

    if (!refresh && cache.data && Date.now() - cache.ts < CONFIG.cacheMinutes * 60000) {
      return Response.json({ ...cache.data, cached: true });
    }

    // SPY benchmark for RS
    const spyBars = await getDailyBars("SPY");
    const spyReturn = pctReturn(spyBars.map(b => b.c), CONFIG.rsLookback);

    const [universe, earningsBlackout] = await Promise.all([getUniverse(), getEarningsBlackout()]);
    const toScan = universe.filter(sym => !earningsBlackout.has(sym));

    const candidates = await inBatches(toScan, CONFIG.concurrency, async (sym) => {
      const bars = await getDailyBars(sym);
      return analyze(sym, bars, spyReturn);
    });

    candidates.sort((a, b) => b.score - a.score);

    const payload: Payload = {
      generatedAt: new Date().toISOString(),
      spyReturn3M: spyReturn != null ? +spyReturn.toFixed(1) : null,
      universeSize: universe.length,
      excludedForEarnings: universe.length - toScan.length,
      count: candidates.length,
      candidates,
      cached: false,
    };

    cache = { data: payload, ts: Date.now() };
    return Response.json(payload);
  } catch (err: any) {
    console.error("swing-candidates error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
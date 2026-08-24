// app/api/hrs/run/route.ts — v1.0
//
// Hidden Relative Strength scanner.
//
// The premise: when the broader market sells off and a stock refuses to go
// down, institutions are absorbing the selling pressure. This scanner:
//
//   1. Detects market weakness (QQQ multi-day decline, elevated VIX)
//   2. Finds stocks that held flat or green on those weak days
//   3. Confirms they sit near 52-week highs with stacked, rising SMAs
//   4. Ranks them by a composite "hidden RS" score
//
// The results are a WATCHLIST, not entries. The scanner always runs and reports
// the market regime; when conditions are inactive it still computes the data
// but marks the regime clearly.
//
// ---------------------------------------------------------------------------
// PIPELINE
//
//   1. UNIVERSE (1 call)    — full market snapshot, price/volume/type floors
//   2. RECENT WINDOW (~32)  — grouped daily bars, 30 trading days
//   3. PREFILTER (0 calls)  — relative performance vs QQQ, SMA stack
//   4. CONFIRM (~50)        — per-ticker 1-year bars for 52-week high
//   5. SCORE & WRITE        — composite rank, write to KV
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { sma } from '@/lib/indicators/marketMath';
import { loadRsRatings, type RsLookup } from '@/lib/indicators/rs';
import { computeStage } from '@/lib/indicators/stage';
import { runInBackground, isDetachedRun, BG_HEADERS } from '@/lib/background';
import { HRS, HRS_META } from '@/lib/scanConfig';
import { cleanSectorDescription } from '@/lib/sectors';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 300;

const POLYGON_KEY = process.env.POLYGON_API_KEY || '';
const FMP_KEY = process.env.FMP_API_KEY || '';
const BASE = 'https://api.polygon.io';

const EXCLUDED_ETFS = new Set([
  'SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'VTI', 'EEM', 'EFA', 'XLF', 'XLE', 'XLK',
  'XLI', 'XLV', 'XLU', 'XLP', 'XLY', 'XLB', 'XLRE', 'XLC', 'SMH', 'SOXX',
  'TQQQ', 'SQQQ', 'QLD', 'QID', 'SOXL', 'SOXS', 'TECL', 'TECS', 'SPXL', 'SPXS',
  'SPXU', 'UPRO', 'SDS', 'SSO', 'TNA', 'TZA', 'FAS', 'FAZ', 'LABU', 'LABD',
  'UVXY', 'UVIX', 'SVIX', 'VIXY', 'VXX', 'FNGU', 'FNGD', 'GLD', 'SLV', 'GDX',
  'GDXJ', 'USO', 'UNG', 'TLT', 'HYG', 'LQD', 'ARKK', 'IBIT', 'BITO', 'BITX',
  'NUGT', 'DUST', 'JNUG', 'ERX', 'ERY', 'BOIL', 'KOLD', 'NAIL', 'URAA',
  'MSTX', 'MSTU', 'CONL', 'NVDL', 'TSLL', 'AAPU', 'MSFU', 'AMZU',
]);

const TRADING_TO_CALENDAR = 1.45;
const ENRICH_CONCURRENCY = 8;

interface Bar { o: number; h: number; l: number; c: number; v: number; t: number }

interface SnapInfo {
  price: number;
  prevClose: number;
  changePct: number;
  vol: number;
  mktCap: number | null;
}

interface WeakDay {
  date: string;
  qqqChange: number;
}

interface MarketRegime {
  active: boolean;
  qqqReturn5d: number;
  qqqReturn10d: number;
  downDays5: number;
  downDays10: number;
  weakDays: WeakDay[];
  severity: 'severe' | 'moderate' | 'mild' | 'inactive';
  vixLevel: number | null;
}

export interface HrsCandidate {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  changePct: number;
  vol: number;
  dVol: number;
  avgVol: number;
  mktCap: number | null;

  score: number;
  grade: string;
  scoreBreakdown: Record<string, number>;

  alphaOnWeakDays: number;
  weakDayOutperformPct: number;
  avgDailyAlpha: number;

  high52w: number;
  pctBelow52wHigh: number;

  sma10: number;
  sma20: number;
  sma10Slope: number;
  sma20Slope: number;

  rsRating: number | null;
  stage: string;

  cnfScore: number | null;
  cnfGrade: string | null;
  catalyst: string | null;
  catalystUrl: string | null;
  newsPublisher: string | null;
  newsAge: string | null;
  newsCausal: boolean | null;
  newsSentiment: string | null;
  thesis: string | null;

  weakDayDetail: { date: string; qqq: number; stock: number; alpha: number }[];
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------
async function polygon<T = any>(path: string): Promise<T> {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${BASE}${path}${sep}apiKey=${POLYGON_KEY}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Polygon ${res.status}: ${path.split('?')[0]}`);
  return res.json() as Promise<T>;
}

async function polygonSafe<T = any>(path: string, fallback: T): Promise<T> {
  try { return await polygon<T>(path); } catch { return fallback; }
}

const ymd = (d: Date): string => d.toISOString().slice(0, 10);
const dateDaysAgo = (n: number): Date => new Date(Date.now() - n * 86400000);

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R | null>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const results = await Promise.allSettled(items.slice(i, i + size).map(fn));
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) out.push(r.value);
    }
  }
  return out;
}

// ---------------------------------------------------------------
// Stage 1: universe from snapshot
// ---------------------------------------------------------------
async function getUniverse(): Promise<Map<string, SnapInfo>> {
  const data = await polygon<{ tickers?: any[] }>('/v2/snapshot/locale/us/markets/stocks/tickers');
  const tickers = data.tickers ?? [];
  const snapMap = new Map<string, SnapInfo>();

  for (const t of tickers) {
    const sym: string = t.ticker ?? '';
    if (!/^[A-Z]{1,5}$/.test(sym)) continue;
    if (EXCLUDED_ETFS.has(sym)) continue;

    const price = t.lastTrade?.p || t.min?.c || t.day?.c || t.prevDay?.c || 0;
    if (price < HRS.minPrice) continue;

    const vol = t.day?.v || t.prevDay?.v || 0;
    const prevClose = t.prevDay?.c || 0;
    let changePct = 0;
    if (t.todaysChangePerc != null && t.todaysChangePerc !== 0) {
      changePct = t.todaysChangePerc;
    } else if (prevClose > 0 && price > 0) {
      changePct = ((price - prevClose) / prevClose) * 100;
    }

    snapMap.set(sym, {
      price,
      prevClose,
      changePct: Number.isNaN(changePct) ? 0 : changePct,
      vol,
      mktCap: t.market_cap ?? null,
    });
  }

  return snapMap;
}

// ---------------------------------------------------------------
// Stage 2: recent window from grouped aggregates
// ---------------------------------------------------------------
async function fetchRecentWindow(
  tradingDays: number
): Promise<{ seriesMap: Map<string, Bar[]>; dates: string[] }> {
  const calendarDays = Math.ceil(tradingDays * TRADING_TO_CALENDAR) + 10;

  const candidateDates: string[] = [];
  for (let d = calendarDays; d >= 1; d--) {
    const dt = dateDaysAgo(d);
    const day = dt.getUTCDay();
    if (day === 0 || day === 6) continue;
    candidateDates.push(ymd(dt));
  }

  const dayResults: { date: string; results: any[] }[] = [];
  const BATCH = 7;
  for (let i = 0; i < candidateDates.length; i += BATCH) {
    const chunk = candidateDates.slice(i, i + BATCH);
    const settled = await Promise.allSettled(chunk.map(async (date) => {
      const d = await polygonSafe<{ results?: any[] }>(
        `/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true`,
        { results: [] }
      );
      return { date, results: d.results ?? [] };
    }));
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value.results.length > 0) dayResults.push(r.value);
    }
  }

  dayResults.sort((a, b) => a.date.localeCompare(b.date));
  const kept = dayResults.slice(-tradingDays);

  const seriesMap = new Map<string, Bar[]>();
  for (const day of kept) {
    const t = new Date(day.date).getTime();
    for (const bar of day.results) {
      const sym = bar.T;
      if (!sym || !/^[A-Z]{1,5}$/.test(sym)) continue;
      let arr = seriesMap.get(sym);
      if (!arr) { arr = []; seriesMap.set(sym, arr); }
      arr.push({ t, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v });
    }
  }

  return { seriesMap, dates: kept.map(d => d.date) };
}

// ---------------------------------------------------------------
// Stage 2b: detect market regime from QQQ data
// ---------------------------------------------------------------
function detectRegime(qqqBars: Bar[], vixLevel: number | null): MarketRegime {
  if (qqqBars.length < 5) {
    return {
      active: false, qqqReturn5d: 0, qqqReturn10d: 0,
      downDays5: 0, downDays10: 0, weakDays: [], severity: 'inactive', vixLevel,
    };
  }

  const closes = qqqBars.map(b => b.c);
  const len = closes.length;

  const dailyChanges: { idx: number; pct: number }[] = [];
  for (let i = 1; i < len; i++) {
    if (closes[i - 1] > 0) {
      dailyChanges.push({ idx: i, pct: ((closes[i] - closes[i - 1]) / closes[i - 1]) * 100 });
    }
  }

  const last5 = dailyChanges.slice(-5);
  const last10 = dailyChanges.slice(-10);

  const qqqReturn5d = last5.reduce((s, d) => s + d.pct, 0);
  const qqqReturn10d = last10.reduce((s, d) => s + d.pct, 0);
  const downDays5 = last5.filter(d => d.pct < 0).length;
  const downDays10 = last10.filter(d => d.pct < 0).length;

  const weakDays: WeakDay[] = [];
  for (const d of dailyChanges) {
    if (d.pct < HRS.weakDayThreshold) {
      const barDate = new Date(qqqBars[d.idx].t);
      weakDays.push({ date: ymd(barDate), qqqChange: +d.pct.toFixed(2) });
    }
  }

  let severity: MarketRegime['severity'] = 'inactive';
  if (qqqReturn5d < -3 || qqqReturn10d < -5) {
    severity = 'severe';
  } else if (qqqReturn5d < -1.5 || qqqReturn10d < -3 || downDays5 >= 4) {
    severity = 'moderate';
  } else if (qqqReturn5d < -0.5 || qqqReturn10d < -1.5 || downDays5 >= 3) {
    severity = 'mild';
  }

  const active = severity !== 'inactive';

  return { active, qqqReturn5d, qqqReturn10d, downDays5, downDays10, weakDays, severity, vixLevel };
}

// ---------------------------------------------------------------
// Stage 2c: fetch VIX level
// ---------------------------------------------------------------
async function fetchVix(): Promise<number | null> {
  if (!FMP_KEY) return null;
  try {
    const res = await fetch(
      `https://financialmodelingprep.com/stable/quote?symbol=%5EVIX&apikey=${FMP_KEY}`,
      { cache: 'no-store' }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) return data[0].price ?? null;
    return null;
  } catch { return null; }
}

// ---------------------------------------------------------------
// Stage 3: prefilter — relative performance + SMA stack
// ---------------------------------------------------------------
interface PrefilterResult {
  symbol: string;
  alphaOnWeakDays: number;
  weakDayOutperformPct: number;
  avgDailyAlpha: number;
  sma10: number;
  sma20: number;
  sma10Slope: number;
  sma20Slope: number;
  avgVol: number;
  avgDollarVol: number;
  weakDayDetail: { date: string; qqq: number; stock: number; alpha: number }[];
  closes: number[];
  bars: Bar[];
}

function prefilter(
  snapMap: Map<string, SnapInfo>,
  seriesMap: Map<string, Bar[]>,
  regime: MarketRegime,
  qqqDailyMap: Map<string, number>,
  dates: string[]
): PrefilterResult[] {
  const results: PrefilterResult[] = [];

  const weakDateSet = new Set(regime.weakDays.map(w => w.date));
  const qqqChangeByDate = new Map<string, number>();
  for (const w of regime.weakDays) {
    qqqChangeByDate.set(w.date, w.qqqChange);
  }

  for (const [sym, bars] of seriesMap) {
    if (EXCLUDED_ETFS.has(sym)) continue;
    const snap = snapMap.get(sym);
    if (!snap) continue;
    if (bars.length < 20) continue;

    const closes = bars.map(b => b.c);

    // Average volume and dollar volume
    const volumes = bars.slice(-20).map(b => b.v);
    const avgVol = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    if (avgVol < HRS.minAvgVolume) continue;

    const avgPrice = closes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(closes.length, 20);
    const avgDollarVol = avgVol * avgPrice;
    if (avgDollarVol < HRS.minDollarVol) continue;

    // 10 SMA and 20 SMA
    const sma10Now = sma(closes, 10);
    const sma20Now = sma(closes, 20);
    if (sma10Now == null || sma20Now == null) continue;
    if (sma10Now <= sma20Now) continue; // hard gate: 10 > 20

    // SMA slopes — compare current vs 5 bars ago
    const closes5ago = closes.slice(0, -5);
    const sma10_5ago = sma(closes5ago, 10);
    const sma20_5ago = sma(closes5ago, 20);
    if (sma10_5ago == null || sma20_5ago == null) continue;

    const sma10Slope = ((sma10Now - sma10_5ago) / sma10_5ago) * 100;
    const sma20Slope = ((sma20Now - sma20_5ago) / sma20_5ago) * 100;
    if (sma10Slope <= 0 || sma20Slope <= 0) continue; // both must be rising

    // Relative performance on weak days
    if (regime.weakDays.length === 0) {
      // No weak days — can't measure hidden RS, but still include candidates
      // with strong SMA structure for completeness
      results.push({
        symbol: sym,
        alphaOnWeakDays: 0,
        weakDayOutperformPct: 100,
        avgDailyAlpha: 0,
        sma10: sma10Now,
        sma20: sma20Now,
        sma10Slope,
        sma20Slope,
        avgVol,
        avgDollarVol,
        weakDayDetail: [],
        closes,
        bars,
      });
      continue;
    }

    const weakDayDetail: { date: string; qqq: number; stock: number; alpha: number }[] = [];
    let outperformCount = 0;
    let totalAlpha = 0;

    for (let i = 1; i < bars.length; i++) {
      const barDate = ymd(new Date(bars[i].t));
      if (!weakDateSet.has(barDate)) continue;

      const stockChange = bars[i - 1].c > 0
        ? ((bars[i].c - bars[i - 1].c) / bars[i - 1].c) * 100
        : 0;
      const qqqChange = qqqChangeByDate.get(barDate) ?? 0;
      const alpha = stockChange - qqqChange;

      weakDayDetail.push({ date: barDate, qqq: +qqqChange.toFixed(2), stock: +stockChange.toFixed(2), alpha: +alpha.toFixed(2) });
      totalAlpha += alpha;
      if (alpha > 0) outperformCount++;
    }

    if (weakDayDetail.length === 0) continue;

    const weakDayOutperformPct = (outperformCount / weakDayDetail.length) * 100;
    if (weakDayOutperformPct < HRS.minWeakDayOutperformPct) continue;

    const avgDailyAlpha = totalAlpha / weakDayDetail.length;

    results.push({
      symbol: sym,
      alphaOnWeakDays: +totalAlpha.toFixed(2),
      weakDayOutperformPct: +weakDayOutperformPct.toFixed(0),
      avgDailyAlpha: +avgDailyAlpha.toFixed(2),
      sma10: sma10Now,
      sma20: sma20Now,
      sma10Slope: +sma10Slope.toFixed(2),
      sma20Slope: +sma20Slope.toFixed(2),
      avgVol,
      avgDollarVol,
      weakDayDetail,
      closes,
      bars,
    });
  }

  // Sort by alpha descending and take a generous shortlist for the confirm stage
  results.sort((a, b) => b.alphaOnWeakDays - a.alphaOnWeakDays);
  return results.slice(0, 150);
}

// ---------------------------------------------------------------
// Stage 4: confirm — fetch 1-year daily bars for 52-week high
// ---------------------------------------------------------------
async function confirm(
  candidates: PrefilterResult[],
  snapMap: Map<string, SnapInfo>,
  rsLookup: RsLookup
): Promise<HrsCandidate[]> {
  const from = ymd(dateDaysAgo(370));
  const to = ymd(dateDaysAgo(1));

  const confirmed = await inBatches(candidates, ENRICH_CONCURRENCY, async (c) => {
    const snap = snapMap.get(c.symbol);
    if (!snap) return null;

    const rs = rsLookup.get(c.symbol);
    if (rs != null && rs < HRS.minRsRating) return null;

    try {
      // Fetch 1-year daily bars + ticker details in parallel
      const [barsData, details] = await Promise.all([
        polygon<{ results?: any[] }>(
          `/v2/aggs/ticker/${c.symbol}/range/1/day/${from}/${to}?adjusted=true&limit=260`
        ),
        polygonSafe<{ results?: any }>(
          `/v3/reference/tickers/${c.symbol}`,
          { results: {} }
        ),
      ]);

      const yearBars = barsData.results ?? [];
      let high52w = 0;
      for (const b of yearBars) {
        if (b.h > high52w) high52w = b.h;
      }

      const companyName = details?.results?.name || c.symbol;
      const sector = cleanSectorDescription(
        details?.results?.sic_description,
        details?.results?.sector,
        details?.results?.industry
      );

      // Stage analysis from the longer history
      const stageBars = yearBars.map((b: any) => ({ c: b.c }));
      const stage = stageBars.length >= 200
        ? computeStage(stageBars, { order: 'asc', price: snap.price })
        : computeStage(c.bars.map(b => ({ c: b.c })), { order: 'asc', price: snap.price });

      if (high52w <= 0) high52w = Math.max(...c.bars.map(b => b.h));
      const pctBelow52wHigh = high52w > 0 ? ((high52w - snap.price) / high52w) * 100 : 0;
      if (pctBelow52wHigh > HRS.maxPctBelow52wHigh) return null;

      // Score
      const breakdown = scoreHrs(c, pctBelow52wHigh, rs);
      const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
      const grade = score >= 70 ? 'A' : score >= 50 ? 'B' : 'C';

      return {
        symbol: c.symbol,
        name: companyName,
        sector,
        price: snap.price,
        changePct: snap.changePct,
        vol: snap.vol,
        dVol: +(snap.vol * snap.price).toFixed(0),
        avgVol: +c.avgVol.toFixed(0),
        mktCap: details?.results?.market_cap ?? snap.mktCap,

        score: +score.toFixed(0),
        grade,
        scoreBreakdown: breakdown,

        alphaOnWeakDays: c.alphaOnWeakDays,
        weakDayOutperformPct: c.weakDayOutperformPct,
        avgDailyAlpha: c.avgDailyAlpha,

        high52w: +high52w.toFixed(2),
        pctBelow52wHigh: +pctBelow52wHigh.toFixed(1),

        sma10: +c.sma10.toFixed(2),
        sma20: +c.sma20.toFixed(2),
        sma10Slope: c.sma10Slope,
        sma20Slope: c.sma20Slope,

        rsRating: rs,
        stage,

        cnfScore: null,
        cnfGrade: null,
        catalyst: null,
        catalystUrl: null,
        newsPublisher: null,
        newsAge: null,
        newsCausal: null,
        newsSentiment: null,
        thesis: null,

        weakDayDetail: c.weakDayDetail,
      } satisfies HrsCandidate;
    } catch {
      return null;
    }
  });

  confirmed.sort((a, b) => b.score - a.score);
  return confirmed.slice(0, HRS.finalSize);
}

// ---------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------
function scoreHrs(
  c: PrefilterResult,
  pctBelow52wHigh: number,
  rs: number | null
): Record<string, number> {
  // Relative alpha on weak days: 0–40 pts
  const alphaRaw = Math.max(0, c.avgDailyAlpha);
  const alphaPts = Math.min(alphaRaw / 2, 1) * 30 + Math.min(c.weakDayOutperformPct / 100, 1) * 10;

  // Proximity to 52-week high: 0–25 pts
  const proxPts = pctBelow52wHigh <= 3 ? 25
    : pctBelow52wHigh <= 5 ? 22
    : pctBelow52wHigh <= 8 ? 18
    : pctBelow52wHigh <= 12 ? 12
    : pctBelow52wHigh <= 15 ? 6 : 0;

  // SMA quality: 0–20 pts
  const smaStackPts = 10; // already gated on 10 > 20
  const slopePts = Math.min((c.sma10Slope + c.sma20Slope) / 2, 1) * 10;

  // RS Rating: 0–15 pts
  const rsPts = rs != null ? Math.min(Math.max(rs - 60, 0) / 30, 1) * 15 : 0;

  return {
    alpha: +alphaPts.toFixed(1),
    proximity: +proxPts.toFixed(1),
    smaStack: +(smaStackPts + slopePts).toFixed(1),
    rs: +rsPts.toFixed(1),
  };
}

// ---------------------------------------------------------------
// Main scan
// ---------------------------------------------------------------
async function runScan(): Promise<void> {
  const t0 = Date.now();
  console.log('[HRS] Starting scan...');

  // Stage 1 + 2 + RS + VIX in parallel
  const [snapMap, windowData, rsLookup, vixLevel] = await Promise.all([
    getUniverse(),
    fetchRecentWindow(HRS.recentTradingDays),
    loadRsRatings(),
    fetchVix(),
  ]);

  const { seriesMap, dates } = windowData;
  console.log(`[HRS] Universe: ${snapMap.size} tickers, ${dates.length} trading days`);

  // Extract QQQ bars and daily changes
  const qqqBars = seriesMap.get('QQQ') ?? [];
  const qqqDailyMap = new Map<string, number>();
  for (let i = 1; i < qqqBars.length; i++) {
    if (qqqBars[i - 1].c > 0) {
      const pct = ((qqqBars[i].c - qqqBars[i - 1].c) / qqqBars[i - 1].c) * 100;
      const d = ymd(new Date(qqqBars[i].t));
      qqqDailyMap.set(d, +pct.toFixed(2));
    }
  }

  // Market regime
  const regime = detectRegime(qqqBars, vixLevel);
  console.log(`[HRS] Regime: ${regime.severity}, QQQ 5d: ${regime.qqqReturn5d.toFixed(2)}%, weak days: ${regime.weakDays.length}`);

  // Stage 3: prefilter
  const prefiltered = prefilter(snapMap, seriesMap, regime, qqqDailyMap, dates);
  console.log(`[HRS] Prefiltered: ${prefiltered.length} candidates`);

  // Stage 4: confirm
  const candidates = await confirm(prefiltered, snapMap, rsLookup);
  console.log(`[HRS] Confirmed: ${candidates.length} candidates in ${Date.now() - t0}ms`);

  // Merge CNF scores + catalyst from daily setups scanner (1 KV read)
  try {
    const dailySetups = await kv.get<any[]>('daily_setups_v6');
    if (dailySetups?.length) {
      const cnfMap = new Map<string, any>();
      for (const row of dailySetups) {
        const sym = row.ticker || row.symbol;
        if (sym && row.cnfScore != null) cnfMap.set(sym, row);
      }
      for (const c of candidates) {
        const row = cnfMap.get(c.symbol);
        if (row) {
          c.cnfScore = row.cnfScore ?? null;
          c.cnfGrade = row.cnfGrade ?? null;
          c.catalyst = row.catalyst ?? null;
          c.catalystUrl = row.catalystUrl ?? null;
          c.newsPublisher = row.newsPublisher ?? null;
          c.newsAge = row.newsAge ?? null;
          c.newsCausal = row.newsCausal ?? null;
          c.newsSentiment = row.newsSentiment ?? null;
          c.thesis = row.thesis ?? row.news ?? row.headline ?? null;
        }
      }
    }
  } catch { /* non-critical — CNF column will show — */ }

  // Write to KV
  const meta = {
    ...HRS_META,
    liveGates: HRS_META.gates,
    regime,
    universe: snapMap.size,
    prefiltered: prefiltered.length,
    confirmed: candidates.length,
    rsAvailable: rsLookup.available,
    rsAsOf: rsLookup.asOf,
  };

  await Promise.all([
    kv.set('hrs_results_v1', candidates),
    kv.set('hrs_last_scan_v1', Date.now()),
    kv.set('hrs_meta_v1', meta),
  ]);

  console.log(`[HRS] Scan complete: ${candidates.length} results written in ${Date.now() - t0}ms`);
}

// ---------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------
export async function GET(request: Request) {
  if (!isDetachedRun(request)) {
    const bg = await runInBackground(request, 'HRS', runScan);
    return NextResponse.json(
      { success: true, ...bg },
      { headers: BG_HEADERS }
    );
  }

  try {
    await runScan();
    return NextResponse.json({ success: true, mode: 'inline' }, { headers: BG_HEADERS });
  } catch (error: any) {
    console.error('[HRS] inline run failed:', error?.message || error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500, headers: BG_HEADERS }
    );
  }
}

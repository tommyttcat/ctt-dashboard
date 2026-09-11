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
import { loadRsRatings, type RsLookup } from '@/lib/indicators/rs';
import { computeStage } from '@/lib/indicators/stage';
import { runInBackground, isDetachedRun, BG_HEADERS } from '@/lib/background';
import { HRS, HRS_META } from '@/lib/scanConfig';
import { cleanSectorDescription } from '@/lib/sectors';
/* Regime detection, the weak-day prefilter and the score live in
   lib/scans/hrs so the backtest replays the identical rules. */
import {
  EXCLUDED_ETFS, ymd, detectRegime, prefilter, scoreHrs,
  type Bar, type SnapInfo, type PrefilterResult,
} from '@/lib/scans/hrs';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 300;

const POLYGON_KEY = process.env.POLYGON_API_KEY || '';
const FMP_KEY = process.env.FMP_API_KEY || '';
const BASE = 'https://api.polygon.io';


const TRADING_TO_CALENDAR = 1.45;
const ENRICH_CONCURRENCY = 8;


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

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
  minPrice: 1,
  maxPrice: 2000,
  minPrevDayDollarVol: 20_000_000,

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

  maxSymbolsToAnalyze: 120, // trimmed slightly: 3 API calls per symbol now
  concurrency: 10,
};

// ---------------------------------------------------------------
// Types
// ---------------------------------------------------------------
interface Bar { t: number; o: number; h: number; l: number; c: number; v: number; }

interface SnapInfo {
  vwap: number | null;
  livePrice: number | null;
  changePct: number;
  vol: number;
}

interface Candidate {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  score: number;
  changePct: number;
  vol: number;
  dVol: number;
  rvol: number | null;
  float: number | null;
  shortPct: number | null;
  mktCap: number | null;
  stage: string;
  vwapStatus: 'above' | 'below' | 'neutral';
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
  range10Pct?: number;
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

async function polygonSafe<T = any>(path: string, fallback: T): Promise<T> {
  try { return await polygon<T>(path); } catch { return fallback; }
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
// Sector classification — ported from the scanner's cleanSectorDescription
// (reads SIC description, which is the field Polygon actually populates)
// ---------------------------------------------------------------
function cleanSectorDescription(sic: string | undefined, sector: string | undefined, industry: string | undefined): string {
  const ind = (industry || '').toLowerCase();
  const sicTxt = (sic || '').toLowerCase();
  const blob = `${ind} ${sicTxt}`;

  if (/nuclear|uranium/.test(blob)) return 'Nuclear';
  if (/solar|photovoltaic/.test(blob)) return 'Solar';
  if (/electric vehicle|auto manufacturer|motor vehicle|passenger car/.test(blob)) return 'EV';
  if (/biotechnolog|biological product|in vitro|medicinal chem/.test(blob)) return 'Biotech';
  if (/semiconductor/.test(blob)) return "Semi's";
  if (/artificial intelligence/.test(blob)) return 'AI';
  if (/cybersecurity|security software/.test(blob)) return 'Cyber';
  if (/fintech|financial technology/.test(blob)) return 'Fintech';
  if (/aerospace|\bdefense\b|aircraft|guided missile|space vehicle/.test(blob)) return 'Aerospace';

  if (sicTxt) {
    if (/software|prepackaged|computer program|data processing|information retrieval|computer integrated|computer communication|electronic computer|computer peripheral|computer storage|computer terminal|electronic component|printed circuit/.test(sicTxt)) return 'IT';
    if (/pharmaceutical|drug|medicinal|surgical|\bmedical\b|\bhealth\b|dental|hospital|diagnostic|laborator/.test(sicTxt)) return 'Healthcare';
    if (/crude petroleum|natural gas|petroleum|drilling|\boil\b|\bcoal\b|\benergy\b/.test(sicTxt)) return 'Energy';
    if (/\bbank\b|savings instit|credit institution|insurance|investment office|securities broker|security broker|personal credit|holding compan|fire, marine/.test(sicTxt)) return 'Financials';
    if (/real estate|land subdivid|operators of apartment|operators of nonresident/.test(sicTxt)) return 'Real Estate';
    if (/electric services|gas & other|water supply|cogeneration|electric & other services/.test(sicTxt)) return 'Utilities';
    if (/telephone|telecommunic|radio|television|broadcast|cable|motion picture|advertising|publishing|newspaper|periodical|entertainment/.test(sicTxt)) return 'Comm Serv';
    if (/retail|catalog|mail-order|eating place|restaurant|apparel|footwear|hotel|department store|grocery|variety store|jewelry/.test(sicTxt)) return 'Con Disc';
    if (/beverage|\bfood\b|tobacco|soap|cosmetic|household|dairy|bakery/.test(sicTxt)) return 'Con Staples';
    if (/gold mining|metal mining|steel|aluminum|chemical|industrial inorganic|plastics material|paper mill|fertilizer|\bmining\b/.test(sicTxt)) return 'Materials';
    if (/aircraft|machinery|industrial|construction|engineering|electrical industrial|transportation|railroad|trucking|air transport/.test(sicTxt)) return 'Industrials';
  }

  const sec = (sector || '').toLowerCase();
  if (sec.includes('technology')) return 'IT';
  if (sec.includes('healthcare') || sec.includes('health care')) return 'Healthcare';
  if (sec.includes('financial')) return 'Financials';
  if (sec.includes('consumer discretionary')) return 'Con Disc';
  if (sec.includes('consumer staples')) return 'Con Staples';
  if (sec.includes('energy')) return 'Energy';
  if (sec.includes('materials')) return 'Materials';
  if (sec.includes('industrials')) return 'Industrials';
  if (sec.includes('real estate')) return 'Real Estate';
  if (sec.includes('utilities')) return 'Utilities';
  if (sec.includes('communication')) return 'Comm Serv';

  return 'Other';
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

// Weinstein Stage from the 150-SMA slope — same logic as the scanner
function computeStage(closes: number[], price: number): string {
  if (closes.length < 210) return '-';
  const smaAt = (endOffset: number): number | null => {
    const end = closes.length - endOffset;
    if (end < 150) return null;
    let sum = 0;
    for (let i = end - 150; i < end; i++) sum += closes[i];
    return sum / 150;
  };
  const now = smaAt(0);
  const d20 = smaAt(20);
  const d60 = smaAt(60);
  if (!now || !d20 || !d60) return '-';
  const slope = (now - d20) / d20;
  if (slope > 0.015 && price > now) return 'Stage 2A';
  if (slope < -0.015 && price < now) return 'Stage 4A';
  return d20 > d60 ? 'Stage 3A' : 'Stage 1A';
}

// ---------------------------------------------------------------
// Stage 1: coarse universe from the full-market snapshot (1 call)
// ---------------------------------------------------------------
async function getUniverse(): Promise<{ symbols: string[]; snapMap: Map<string, SnapInfo>; snapMapAll: Map<string, SnapInfo> }> {
  const data = await polygon<{ tickers?: any[] }>(
    `/v2/snapshot/locale/us/markets/stocks/tickers`
  );
  const tickers = data.tickers ?? [];

  const filtered = tickers
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
    .slice(0, CONFIG.maxSymbolsToAnalyze);

  const buildSnap = (t: any): SnapInfo => {
    const livePrice = t.lastTrade?.p || t.min?.c || t.day?.c || t.prevDay?.c || null;
    const prevClose = t.prevDay?.c || 0;
    const vwap = t.day?.vw || null;
    const vol = t.day?.v || t.prevDay?.v || 0;
    let changePct = 0;
    if (t.todaysChangePerc !== undefined && t.todaysChangePerc !== null && t.todaysChangePerc !== 0) {
      changePct = t.todaysChangePerc;
    } else if (prevClose > 0 && livePrice) {
      changePct = ((livePrice - prevClose) / prevClose) * 100;
    }
    return { vwap, livePrice, changePct: Number.isNaN(changePct) ? 0 : changePct, vol };
  };

  const snapMap = new Map<string, SnapInfo>();
  for (const t of filtered) snapMap.set(t.ticker, buildSnap(t));

  // Full-market snap map for the consolidation shortlist — every clean symbol
  // in the tradeable price band, NOT just the top names by dollar volume.
  const snapMapAll = new Map<string, SnapInfo>();
  for (const t of tickers) {
    const sym: string = t.ticker ?? "";
    if (!/^[A-Z]{1,5}$/.test(sym)) continue;
    const prev = t.prevDay;
    if (!prev || !prev.c) continue;
    if (prev.c < CONFIG.minPrice || prev.c > CONFIG.maxPrice) continue;
    snapMapAll.set(sym, buildSnap(t));
  }

  return { symbols: filtered.map(t => t.ticker as string), snapMap, snapMapAll };
}

// ---------------------------------------------------------------
// Market-wide grouped history: ~35 daily bars for EVERY US stock in
// ~35 API calls total. This is what lets the 10/21 scan see the whole
// market instead of only the loudest names by dollar volume.
// ---------------------------------------------------------------
interface LiteBar { c: number; h: number; l: number; v: number; }

async function getGroupedSeries(validSymbols: Set<string>): Promise<Map<string, LiteBar[]>> {
  // Candidate weekdays, oldest -> newest
  const dates: string[] = [];
  for (let d = CONSOL_SHORTLIST.maxCalendarDays; d >= 1; d--) {
    const dt = new Date(Date.now() - d * 86400000);
    const day = dt.getUTCDay();
    if (day === 0 || day === 6) continue;
    dates.push(dt.toISOString().slice(0, 10));
  }

  const series = new Map<string, LiteBar[]>();
  const dayResults: { date: string; results: any[] }[] = [];

  // Fetch grouped days in small parallel batches
  const BATCH = 7;
  for (let i = 0; i < dates.length; i += BATCH) {
    const chunk = dates.slice(i, i + BATCH);
    const settled = await Promise.allSettled(chunk.map(async (date) => {
      const data = await polygonSafe<{ results?: any[] }>(
        `/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true`,
        { results: [] }
      );
      return { date, results: data.results ?? [] };
    }));
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value.results.length > 0) dayResults.push(r.value);
    }
  }

  // Keep the most recent N trading days, in ascending order
  dayResults.sort((a, b) => a.date.localeCompare(b.date));
  const kept = dayResults.slice(-CONSOL_SHORTLIST.groupedDays);

  for (const day of kept) {
    for (const t of day.results) {
      const sym = t.T;
      if (!validSymbols.has(sym)) continue;
      let arr = series.get(sym);
      if (!arr) { arr = []; series.set(sym, arr); }
      arr.push({ c: t.c, h: t.h, l: t.l, v: t.v });
    }
  }
  return series;
}

// ---------------------------------------------------------------
// First-pass shortlist: cheap 10/21 math on the grouped series.
// Returns the tightest coils market-wide for the full deep analysis.
// ---------------------------------------------------------------
function shortlistConsolidation(series: Map<string, LiteBar[]>): string[] {
  const emaLite = (closes: number[], period: number): number | null => {
    if (closes.length < period) return null;
    const k = 2 / (period + 1);
    let e = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < closes.length; i++) e = closes[i] * k + e * (1 - k);
    return e;
  };

  const picks: { sym: string; range10: number }[] = [];

  series.forEach((bars, sym) => {
    if (bars.length < 28) return;
    const closes = bars.map(b => b.c);
    const price = closes[closes.length - 1];
    if (price < CONFIG.minPrice || price > CONFIG.maxPrice) return;

    // Liquidity: 20-day average dollar volume
    const dv = bars.slice(-20).map(b => b.c * b.v);
    const avgDollarVol = dv.reduce((a, b) => a + b, 0) / dv.length;
    if (avgDollarVol < CONFIG.minPrevDayDollarVol) return;

    const e10 = emaLite(closes, 10);
    const e21 = emaLite(closes, 21);
    const e21Prev = emaLite(closes.slice(0, -3), 21);
    if (!e10 || !e21) return;

    const dist10 = ((price - e10) / e10) * 100;
    const dist21 = ((price - e21) / e21) * 100;
    if (Math.abs(dist10) > CONSOL_CONFIG.maxDistToEma10) return;
    if (dist21 > CONSOL_CONFIG.maxAboveEma21 || dist21 < -CONSOL_CONFIG.maxBelowEma21) return;
    if (e21Prev != null && e21 <= e21Prev) return; // 21 EMA must be rising

    const win10 = bars.slice(-10);
    const hi10 = Math.max(...win10.map(b => b.h));
    const lo10 = Math.min(...win10.map(b => b.l));
    const range10 = lo10 > 0 ? ((hi10 - lo10) / lo10) * 100 : 999;
    if (range10 > CONSOL_CONFIG.maxRange10) return;

    const prevClose = closes[closes.length - 2];
    const dayChg = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
    if (Math.abs(dayChg) > CONSOL_CONFIG.maxDayChange) return;

    picks.push({ sym, range10 });
  });

  // Tightest coils first
  picks.sort((a, b) => a.range10 - b.range10);
  return picks.slice(0, CONSOL_SHORTLIST.shortlistSize).map(p => p.sym);
}

// ---------------------------------------------------------------
// Earnings blackout — Benzinga calendar directly. Fails open.
// ---------------------------------------------------------------
async function getEarningsBlackout(): Promise<Set<string>> {
  if (!BENZINGA_KEY) return new Set();
  try {
    const from = dateStr(0);
    const to = dateStr(-CONFIG.earningsBlackoutDays);
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
function analyze(
  symbol: string,
  bars: Bar[],
  spyReturn: number | null,
  details: any,
  shortData: any,
  snap: SnapInfo | undefined
): Candidate | null {
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

  // 20-day average share volume for RVOL
  const vols = bars.slice(-20).map(b => b.v).filter(v => v > 0);
  const avgVol = vols.length > 0 ? vols.reduce((a, b) => a + b, 0) / vols.length : 0;

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

  // Score (0-100), rescaled to the CNF grade lines (A>=70, B>=50):
  // RS 35 (saturates at +20 vs SPY), pullback 30, volatility fit 20, trend 15.
  const rsScore = Math.min(rsVsSpy / 20, 1) * 35;
  const pullbackScore =
    (1 - Math.abs(distToEma21) / CONFIG.maxDistToEma21) * 15 +
    (1 - kVal / CONFIG.maxStochK) * 15;
  const volScore = Math.max(0, (1 - Math.abs(atrPct - 3.0) / 3.0) * 20);
  const trendScore = (sma50 > sma200 ? 10 : 0) + (ema21Rising ? 5 : 0);
  const score = Math.round(Math.max(0, rsScore + pullbackScore + volScore + trendScore));

  const stage = computeStage(closes, price);

  // Snapshot-derived live fields (fall back to daily-bar data off-hours)
  const changePct = snap?.changePct ?? 0;
  const vol = snap?.vol || bars[bars.length - 1].v || 0;
  const rvol = avgVol > 0 && vol > 0 ? +(vol / avgVol).toFixed(2) : null;

  let vwapStatus: 'above' | 'below' | 'neutral' = 'neutral';
  if (snap?.vwap && snap?.livePrice) {
    vwapStatus = snap.livePrice >= snap.vwap ? 'above' : 'below';
  }

  // Details-derived fields (same sources as the scanner)
  const name = details?.results?.name || symbol;
  const mktCap = details?.results?.market_cap || null;
  const float = details?.results?.share_class_shares_outstanding || (mktCap && price ? mktCap / price : null);
  const sector = cleanSectorDescription(details?.results?.sic_description, details?.results?.sector, details?.results?.industry);

  let shortPct: number | null = null;
  if (shortData?.results && shortData.results.length > 0 && float) {
    shortPct = +((shortData.results[0].short_interest / float) * 100).toFixed(1);
  }

  return {
    symbol,
    name,
    sector,
    price: +price.toFixed(2),
    score,
    changePct: +changePct.toFixed(2),
    vol,
    dVol: Math.round(price * vol),
    rvol,
    float,
    shortPct,
    mktCap,
    stage,
    vwapStatus,
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
// Stage 2b: 10/21 consolidation analyzer — same inputs, different setup.
// Finds names coiling tightly on rising 10/21 EMAs in a confirmed uptrend:
// the Minervini/Wish trend-hold entry BEFORE the breakout, not after it.
// ---------------------------------------------------------------
const CONSOL_CONFIG = {
  maxDistToEma10: 5,      // permissive outer bound — the card's steppers filter tighter
  maxAboveEma21: 8,       // permissive outer bound — the card's steppers filter tighter
  maxBelowEma21: 3,       // small undercuts tolerated, no breakdowns
  maxRange10: 14,         // permissive outer bound — the card's steppers filter tighter
  maxDayChange: 5,        // quiet-ish tape today, no event bars
  maxPctOffHigh: 25,      // permissive outer bound — the card's steppers filter tighter
};

// Market-wide consolidation shortlist settings
const CONSOL_SHORTLIST = {
  groupedDays: 35,        // trading days of grouped history for the first pass
  maxCalendarDays: 55,    // calendar window to find those trading days in
  shortlistSize: 50,      // finalists that get the full 450-day treatment
};

function analyzeConsolidation(
  symbol: string,
  bars: Bar[],
  spyReturn: number | null,
  details: any,
  shortData: any,
  snap: SnapInfo | undefined
): Candidate | null {
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
  const vols = bars.slice(-20).map(b => b.v).filter(v => v > 0);
  const avgVol = vols.length > 0 ? vols.reduce((a, b) => a + b, 0) / vols.length : 0;

  const ret = pctReturn(closes, CONFIG.rsLookback);
  const rsVsSpy = ret != null && spyReturn != null ? ret - spyReturn : null;

  // The coil: 10-day high-low range
  const win10 = bars.slice(-10);
  const hi10 = Math.max(...win10.map(b => b.h));
  const lo10 = Math.min(...win10.map(b => b.l));
  const range10 = lo10 > 0 ? ((hi10 - lo10) / lo10) * 100 : 999;

  const changePct = snap?.changePct ?? 0;

  // --- Gates: liquid, trending, riding the EMAs, tight, quiet, near highs ---
  if (avgDollarVol < CONFIG.minPrevDayDollarVol) return null;
  if (price < sma50 || price < sma200) return null;
  if (!(sma50 > sma200)) return null;
  if (!ema21Rising) return null;
  if (Math.abs(distToEma10) > CONSOL_CONFIG.maxDistToEma10) return null;
  if (distToEma21 > CONSOL_CONFIG.maxAboveEma21 || distToEma21 < -CONSOL_CONFIG.maxBelowEma21) return null;
  if (range10 > CONSOL_CONFIG.maxRange10) return null;
  if (Math.abs(changePct) > CONSOL_CONFIG.maxDayChange) return null;
  if (pctOffHigh > CONSOL_CONFIG.maxPctOffHigh) return null;
  if (rsVsSpy == null || rsVsSpy <= 0) return null;

  // Score (0-100) on the CNF grade lines (A>=70, B>=50):
  // tightness 30 (range 4% or less saturates), EMA proximity 25,
  // RS 30 (saturates at +20 vs SPY), trend quality 15.
  const tightScore = Math.max(0, Math.min(1, (CONSOL_CONFIG.maxRange10 - range10) / (CONSOL_CONFIG.maxRange10 - 4))) * 30;
  const proxScore =
    (1 - Math.abs(distToEma10) / CONSOL_CONFIG.maxDistToEma10) * 15 +
    Math.max(0, 1 - Math.abs(distToEma21) / CONSOL_CONFIG.maxAboveEma21) * 10;
  const rsScore = Math.min(rsVsSpy / 20, 1) * 30;
  const trendScore = 10 + (pctOffHigh <= 7 ? 5 : 0);
  const score = Math.round(Math.max(0, Math.min(100, tightScore + proxScore + rsScore + trendScore)));

  const stage = computeStage(closes, price);
  const vol = snap?.vol || bars[bars.length - 1].v || 0;
  const rvol = avgVol > 0 && vol > 0 ? +(vol / avgVol).toFixed(2) : null;

  let vwapStatus: 'above' | 'below' | 'neutral' = 'neutral';
  if (snap?.vwap && snap?.livePrice) {
    vwapStatus = snap.livePrice >= snap.vwap ? 'above' : 'below';
  }

  const name = details?.results?.name || symbol;
  const mktCap = details?.results?.market_cap || null;
  const float = details?.results?.share_class_shares_outstanding || (mktCap && price ? mktCap / price : null);
  const sector = cleanSectorDescription(details?.results?.sic_description, details?.results?.sector, details?.results?.industry);

  let shortPct: number | null = null;
  if (shortData?.results && shortData.results.length > 0 && float) {
    shortPct = +((shortData.results[0].short_interest / float) * 100).toFixed(1);
  }

  return {
    symbol,
    name,
    sector,
    price: +price.toFixed(2),
    score,
    changePct: +changePct.toFixed(2),
    vol,
    dVol: Math.round(price * vol),
    rvol,
    float,
    shortPct,
    mktCap,
    stage,
    vwapStatus,
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
    range10Pct: +range10.toFixed(1),
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

    const [{ symbols: universe, snapMap, snapMapAll }, earningsBlackout] = await Promise.all([getUniverse(), getEarningsBlackout()]);
    const toScan = universe.filter(sym => !earningsBlackout.has(sym));

    // Market-wide 10/21 shortlist: grouped history for every symbol in the
    // tradeable band, cheap EMA/coil math, keep the tightest names.
    const groupedSeries = await getGroupedSeries(new Set(snapMapAll.keys()));
    const consolShortlist = shortlistConsolidation(groupedSeries)
      .filter(sym => !earningsBlackout.has(sym));
    const swingSet = new Set(toScan);
    const consolExtra = consolShortlist.filter(sym => !swingSet.has(sym));

    const results = await inBatches(toScan, CONFIG.concurrency, async (sym) => {
      // Bars + details (mktCap/float/sector) + short interest, in parallel per symbol.
      // Both analyzers share the same fetched data — the 10/21 scan costs zero extra API calls.
      const [bars, details, shortData] = await Promise.all([
        getDailyBars(sym),
        polygonSafe<any>(`/v3/reference/tickers/${sym}`, {}),
        polygonSafe<any>(`/stocks/v1/short-interest?ticker=${sym}`, { results: [] }),
      ]);
      const swing = analyze(sym, bars, spyReturn, details, shortData, snapMap.get(sym));
      const consol = analyzeConsolidation(sym, bars, spyReturn, details, shortData, snapMap.get(sym));
      if (!swing && !consol) return null;
      return { swing, consol };
    });

    // Deep-analyze the shortlisted consolidation names not already covered above
    const extraConsols = await inBatches(consolExtra, CONFIG.concurrency, async (sym) => {
      const [bars, details, shortData] = await Promise.all([
        getDailyBars(sym),
        polygonSafe<any>(`/v3/reference/tickers/${sym}`, {}),
        polygonSafe<any>(`/stocks/v1/short-interest?ticker=${sym}`, { results: [] }),
      ]);
      return analyzeConsolidation(sym, bars, spyReturn, details, shortData, snapMapAll.get(sym));
    });

    const candidates = results.map(r => r.swing).filter((c): c is Candidate => !!c);
    const consols = [
      ...results.map(r => r.consol).filter((c): c is Candidate => !!c),
      ...extraConsols,
    ];

    candidates.sort((a, b) => b.score - a.score);
    consols.sort((a, b) => b.score - a.score);

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

    // 10/21 consolidation list — an empty list is a legitimate result on a
    // loose tape, so persist whenever the universe resolved at all.
    if (universe.length > 0) {
      await kv.set('consol_1021_v1', consols.slice(0, 40));
      await kv.set('consol_1021_meta_v1', { count: consols.length });
      await kv.set('consol_1021_last_scan_v1', scanTime);
    }

    return NextResponse.json({
      success: true,
      lastScanTime: scanTime,
      count: candidates.length,
      consolCount: consols.length,
      consolShortlisted: consolShortlist.length,
      universeSize: universe.length,
      excludedForEarnings: universe.length - toScan.length,
      dataPersisted: hasRealData,
    });
  } catch (error: any) {
    console.error("SWING_RUN_ERROR:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
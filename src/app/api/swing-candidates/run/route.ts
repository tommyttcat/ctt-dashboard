// app/api/swing-candidates/run/route.ts — v1.5
// v1.1: + RMV(15) on Swing and 10/21; + batched Benzinga WIIM catalysts
// v1.2: RMV imported from lib/indicators/rmv
// v1.3: Weinstein sub-stages via lib/indicators/stage
// v1.4: + Money Flow (21); + T2108 market breadth from the grouped series
// v1.5: thresholds moved to lib/scanConfig and shipped in the payload, so the
//       on-screen key renders the gates the scan ACTUALLY used.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { computeRMV } from '@/lib/indicators/rmv';
import { computeStage } from '@/lib/indicators/stage';
import { computeMoneyFlow, moneyFlowTrend } from '@/lib/indicators/moneyflow';
import { SWING, CONSOL, SWING_META, CONSOL_META } from '@/lib/scanConfig';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

const POLYGON_KEY = process.env.NEXT_PUBLIC_POLYGON_API_KEY || process.env.POLYGON_API_KEY || '';
const BENZINGA_KEY = process.env.NEXT_PUBLIC_BENZINGA_API_KEY || process.env.BENZINGA_API_KEY || '';
const BASE = "https://api.polygon.io";

// Grouped-history windows. Not scan gates — these are fetch mechanics, so they
// stay local rather than living in scanConfig. 45 trading days because T2108
// needs a 40-day MA per symbol.
const GROUPED = {
  days: 45,
  maxCalendarDays: 70,
  shortlistSize: 80,
};

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
  daysToCover: number | null;
  mktCap: number | null;
  stage: string;
  vwapStatus: 'above' | 'below' | 'neutral';
  atrPct: number;
  adrPct?: number;
  rmv?: number | null;
  mf?: number | null;
  mfTrend?: number;
  rme?: number | null;
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
  coilRatio?: number;
  blueDot?: boolean;
  coilDays?: number | null;
  priorMovePct?: number | null;
  bvrRatio?: number | null;
  bvrReady?: boolean | null;
  ema1021GapPct?: number | null;
  catalyst?: string | null;
  catalystUrl?: string | null;
  thesis?: string | null;
}

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

// Average Daily Range % — the Minervini definition: SMA(High/Low) - 1.
// Distinct from ATR: no gap component, so it measures how much intraday
// room the stock actually gives you on a typical session.
function adrPct(bars: Bar[], period = 20): number | null {
  if (bars.length < period) return null;
  const recent = bars.slice(-period);
  let sum = 0;
  let n = 0;
  for (const b of recent) {
    if (b.l > 0 && b.h > 0) { sum += b.h / b.l; n++; }
  }
  if (n === 0) return null;
  return ((sum / n) - 1) * 100;
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
      if (prev.c < SWING.minPrice || prev.c > SWING.maxPrice) return false;
      if (prev.c * prev.v < SWING.minAvgDollarVol) return false;
      return true;
    })
    .sort((a, b) => (b.prevDay.c * b.prevDay.v) - (a.prevDay.c * a.prevDay.v))
    .slice(0, SWING.universeSize);

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

  const snapMapAll = new Map<string, SnapInfo>();
  for (const t of tickers) {
    const sym: string = t.ticker ?? "";
    if (!/^[A-Z]{1,5}$/.test(sym)) continue;
    const prev = t.prevDay;
    if (!prev || !prev.c) continue;
    if (prev.c < SWING.minPrice || prev.c > SWING.maxPrice) continue;
    snapMapAll.set(sym, buildSnap(t));
  }

  return { symbols: filtered.map(t => t.ticker as string), snapMap, snapMapAll };
}

interface LiteBar { c: number; h: number; l: number; v: number; }

async function getGroupedSeries(validSymbols: Set<string>): Promise<Map<string, LiteBar[]>> {
  const dates: string[] = [];
  for (let d = GROUPED.maxCalendarDays; d >= 1; d--) {
    const dt = new Date(Date.now() - d * 86400000);
    const day = dt.getUTCDay();
    if (day === 0 || day === 6) continue;
    dates.push(dt.toISOString().slice(0, 10));
  }

  const series = new Map<string, LiteBar[]>();
  const dayResults: { date: string; results: any[] }[] = [];

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

  dayResults.sort((a, b) => a.date.localeCompare(b.date));
  const kept = dayResults.slice(-GROUPED.days);

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
// T2108 — percentage of stocks trading above their own 40-day MA.
//
// Bonde's primary regime gauge. Below 20 the market is washed out and he
// hunts reversals aggressively; below 10 he considers a bounce close to
// guaranteed. Above 80 is the mirror — froth, and breakouts start failing.
//
// Classically NYSE-only. This computes it across the full scanned universe,
// which is a broader base and runs a few points off the official print. The
// LEVELS still work; don't expect an exact match to a TradingView chart.
//
// Free: reuses the grouped series already fetched for the 10/21 shortlist.
// ---------------------------------------------------------------
function computeT2108(series: Map<string, LiteBar[]>): {
  value: number | null;
  above: number;
  total: number;
  zone: string;
} {
  let above = 0;
  let total = 0;

  series.forEach((bars) => {
    if (bars.length < 41) return;
    const closes = bars.map(b => b.c).filter(c => c > 0);
    if (closes.length < 41) return;

    const window = closes.slice(-40);
    const ma40 = window.reduce((a, b) => a + b, 0) / 40;
    if (!isFinite(ma40) || ma40 <= 0) return;

    total++;
    if (closes[closes.length - 1] > ma40) above++;
  });

  // Too thin a sample is worse than no reading — a breadth number built on
  // 40 names says nothing about the market.
  if (total < 100) return { value: null, above, total, zone: 'unknown' };

  const value = (above / total) * 100;
  const zone =
    value <= 10 ? 'washed out' :
    value <= 20 ? 'deeply oversold' :
    value <= 35 ? 'oversold' :
    value <= 65 ? 'neutral' :
    value <= 80 ? 'extended' : 'frothy';

  return { value: Math.round(value * 10) / 10, above, total, zone };
}

function shortlistConsolidation(series: Map<string, LiteBar[]>): string[] {
  const emaLite = (closes: number[], period: number): number | null => {
    if (closes.length < period) return null;
    const k = 2 / (period + 1);
    let e = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < closes.length; i++) e = closes[i] * k + e * (1 - k);
    return e;
  };

  const atrPctLite = (bars: LiteBar[], period = 14): number | null => {
    if (bars.length < period + 1) return null;
    const trs: number[] = [];
    for (let i = 1; i < bars.length; i++) {
      const pc = bars[i - 1].c;
      trs.push(Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - pc), Math.abs(bars[i].l - pc)));
    }
    let a = trs.slice(0, period).reduce((x, y) => x + y, 0) / period;
    for (let i = period; i < trs.length; i++) a = (a * (period - 1) + trs[i]) / period;
    const price = bars[bars.length - 1].c;
    return price > 0 ? (a / price) * 100 : null;
  };

  const adrPctLite = (bars: LiteBar[], period = 20): number | null => {
    if (bars.length < period) return null;
    const recent = bars.slice(-period);
    let sum = 0;
    let n = 0;
    for (const b of recent) {
      if (b.l > 0 && b.h > 0) { sum += b.h / b.l; n++; }
    }
    if (n === 0) return null;
    return ((sum / n) - 1) * 100;
  };

  const picks: { sym: string; ratio: number }[] = [];

  series.forEach((bars, sym) => {
    if (bars.length < 28) return;
    const closes = bars.map(b => b.c);
    const price = closes[closes.length - 1];
    if (price < SWING.minPrice || price > SWING.maxPrice) return;

    const dv = bars.slice(-20).map(b => b.c * b.v);
    const avgDollarVol = dv.reduce((a, b) => a + b, 0) / dv.length;
    if (avgDollarVol < CONSOL.minDollarVol) return;

    const adr = adrPctLite(bars, 20);
    if (adr == null || adr < CONSOL.minAdrPct) return;

    const e10 = emaLite(closes, 10);
    const e21 = emaLite(closes, 21);
    const e21Prev = emaLite(closes.slice(0, -3), 21);
    if (!e10 || !e21) return;

    const dist10 = ((price - e10) / e10) * 100;
    const dist21 = ((price - e21) / e21) * 100;
    if (Math.abs(dist10) > CONSOL.maxDistToEma10) return;
    if (dist21 > CONSOL.maxAboveEma21 || dist21 < -CONSOL.maxBelowEma21) return;
    if (e21Prev != null && e21 <= e21Prev) return;

    const win10 = bars.slice(-10);
    const hi10 = Math.max(...win10.map(b => b.h));
    const lo10 = Math.min(...win10.map(b => b.l));
    const range10 = lo10 > 0 ? ((hi10 - lo10) / lo10) * 100 : 999;
    if (range10 > CONSOL.maxRange10) return;

    const aPct = atrPctLite(bars, 14);
    const ratio = aPct && aPct > 0 ? range10 / aPct : range10 / 3;
    if (ratio > CONSOL.maxCoilRatio) return;

    const prevClose = closes[closes.length - 2];
    const dayChg = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
    if (Math.abs(dayChg) > CONSOL.maxDayChange) return;

    picks.push({ sym, ratio });
  });

  picks.sort((a, b) => a.ratio - b.ratio);
  return picks.slice(0, GROUPED.shortlistSize).map(p => p.sym);
}

async function getEarningsBlackout(): Promise<Set<string>> {
  if (!BENZINGA_KEY) return new Set();
  try {
    const from = dateStr(0);
    const to = dateStr(-SWING.earningsBlackoutDays);
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

const WIIM_MAX_AGE_DAYS = 4;
const WIIM_MAX_BREADTH = 12;

function classifyWiim(title: string): string {
  const s = (title || '').toLowerCase();
  if (/\b(earnings|eps|revenue|beat|miss|quarter|q[1-4]\b)/.test(s)) return 'Earnings';
  if (/\b(fda|approval|phase\s*[123]|trial|clinical|topline|drug|therap)/.test(s)) return 'FDA / Data';
  if (/\b(upgrade|downgrade|price target|initiat|analyst|rating|overweight|underweight|outperform|reiterat)/.test(s)) return 'Analyst';
  if (/\b(merger|acquir|acquisition|buyout|takeover|to acquire|stake|going private)/.test(s)) return 'M&A';
  if (/\b(offering|dilut|prices?\s|secondary|registered direct|atm |capital raise|warrant)/.test(s)) return 'Offering';
  if (/\b(contract|partnership|collaborat|agreement|awarded|order|wins |selected)/.test(s)) return 'Contract';
  if (/\b(guidance|raises|lowers|cuts |reaffirm|outlook|forecast)/.test(s)) return 'Guidance';
  if (/\b(lawsuit|sec |investigat|probe|fraud|settle|recall|halt)/.test(s)) return 'Legal / Risk';
  if (/\b(short|squeeze|volatil|spik|surg|plung|tumbl)/.test(s)) return 'Volatility';
  if (/\b(sector|broader market|index|futures|rotat|peers)/.test(s)) return 'Sector Move';
  return 'News';
}

async function fetchBenzingaWiims(
  tickers: string[]
): Promise<Map<string, { title: string; url: string | null; daysOld: number; score: number }>> {
  const out = new Map<string, { title: string; url: string | null; daysOld: number; score: number }>();
  if (!BENZINGA_KEY || tickers.length === 0) return out;

  const now = Date.now();
  const BATCH = 50;
  for (let i = 0; i < tickers.length; i += BATCH) {
    const batch = tickers.slice(i, i + BATCH);
    const url =
      `https://api.benzinga.com/api/v2/news?token=${BENZINGA_KEY}` +
      `&tickers=${encodeURIComponent(batch.join(','))}` +
      `&channels=WIIM&displayOutput=full&pageSize=100`;

    let items: any = [];
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res.ok) continue;
      items = await res.json();
    } catch {
      continue;
    }
    if (!Array.isArray(items)) continue;

    for (const item of items) {
      const isWiim =
        Array.isArray(item?.channels) &&
        item.channels.some((c: any) => (c?.name || '').toUpperCase() === 'WIIM');
      if (!isWiim) continue;

      const title = (item?.title || '').trim();
      if (!title) continue;

      const stocks = Array.isArray(item?.stocks) ? item.stocks : [];
      if (stocks.length === 0 || stocks.length > WIIM_MAX_BREADTH) continue;

      const created = item?.created ? new Date(item.created).getTime() : 0;
      const daysOld = created > 0 ? (now - created) / (1000 * 60 * 60 * 24) : 999;
      if (daysOld > WIIM_MAX_AGE_DAYS) continue;

      const score = daysOld + stocks.length * 0.02;
      for (const s of stocks) {
        const sym = (s?.name || '').toUpperCase();
        if (!sym) continue;
        const prev = out.get(sym);
        if (!prev || score < prev.score) {
          out.set(sym, { title, url: item?.url || null, daysOld, score });
        }
      }
    }
  }
  return out;
}

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

  const atrPctVal = (atr14 / price) * 100;
  const adr = adrPct(bars, 20);
  const rmv = computeRMV(bars, { lookback: 15 });
  // Money Flow (21) — on a pullback candidate this is the key confirmation:
  // price pulling back with MF still above 55 is orderly profit-taking, not
  // distribution.
  const mf = computeMoneyFlow(bars, { length: 21 });
  const mfTrend = moneyFlowTrend(bars, { length: 21, lookback: 5 });
  const hi52 = Math.max(...bars.slice(-252).map(b => b.h));
  const pctOffHigh = ((hi52 - price) / hi52) * 100;
  const distToEma21 = ((price - ema21) / ema21) * 100;
  const distToEma10 = ((price - ema10) / ema10) * 100;
  const ema21Rising = ema21Prev != null && ema21 > ema21Prev;

  const dollarVols = bars.slice(-20).map(b => b.c * b.v);
  const avgDollarVol = dollarVols.reduce((a, b) => a + b, 0) / dollarVols.length;

  const vols = bars.slice(-20).map(b => b.v).filter(v => v > 0);
  const avgVol = vols.length > 0 ? vols.reduce((a, b) => a + b, 0) / vols.length : 0;

  const ret = pctReturn(closes, SWING.rsLookback);
  const rsVsSpy = ret != null && spyReturn != null ? ret - spyReturn : null;

  if (avgDollarVol < SWING.minAvgDollarVol) return null;
  if (price < sma50) return null;
  if (price < sma200) return null;
  if (atrPctVal < SWING.minAtrPct || atrPctVal > SWING.maxAtrPct) return null;
  if (pctOffHigh < SWING.minPctOffHigh || pctOffHigh > SWING.maxPctOffHigh) return null;
  if (Math.abs(distToEma21) > SWING.maxDistToEma21) return null;
  if (kVal > SWING.maxStochK) return null;
  if (rsVsSpy == null || rsVsSpy <= 0) return null;

  const rsScore = Math.min(rsVsSpy / 20, 1) * 35;
  const pullbackScore =
    (1 - Math.abs(distToEma21) / SWING.maxDistToEma21) * 15 +
    (1 - kVal / SWING.maxStochK) * 15;
  const volScore = Math.max(0, (1 - Math.abs(atrPctVal - 3.0) / 3.0) * 20);
  const trendScore = (sma50 > sma200 ? 10 : 0) + (ema21Rising ? 5 : 0);
  const score = Math.round(Math.max(0, rsScore + pullbackScore + volScore + trendScore));

  // Live snapshot price when available — the 30 and 50 SMAs sit close
  // together, so a stale close misclassifies 2A/2B.
  const stage = computeStage(closes, { price: snap?.livePrice ?? price });

  const changePct = snap?.changePct ?? 0;
  const vol = snap?.vol || bars[bars.length - 1].v || 0;
  const rvolVal = avgVol > 0 && vol > 0 ? +(vol / avgVol).toFixed(2) : null;

  let vwapStatus: 'above' | 'below' | 'neutral' = 'neutral';
  if (snap?.vwap && snap?.livePrice) {
    vwapStatus = snap.livePrice >= snap.vwap ? 'above' : 'below';
  }

  const name = details?.results?.name || symbol;
  const mktCap = details?.results?.market_cap || null;
  const float = details?.results?.share_class_shares_outstanding || (mktCap && price ? mktCap / price : null);
  const sector = cleanSectorDescription(details?.results?.sic_description, details?.results?.sector, details?.results?.industry);

  let shortPct: number | null = null;
  let daysToCover: number | null = null;
  const shortInterest = shortData?.results?.[0]?.short_interest;
  if (shortInterest && float) shortPct = +((shortInterest / float) * 100).toFixed(1);
  if (shortInterest && avgVol > 0) daysToCover = +(shortInterest / avgVol).toFixed(1);

  return {
    symbol,
    name,
    sector,
    price: +price.toFixed(2),
    score,
    changePct: +changePct.toFixed(2),
    vol,
    dVol: Math.round(price * vol),
    rvol: rvolVal,
    float,
    shortPct,
    daysToCover,
    mktCap,
    stage,
    vwapStatus,
    atrPct: +atrPctVal.toFixed(2),
    adrPct: adr != null ? +adr.toFixed(2) : undefined,
    rmv,
    mf,
    mfTrend,
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

  const atrPctVal = (atr14 / price) * 100;
  const adr = adrPct(bars, 20);
  const rmv = computeRMV(bars, { lookback: 15 });
  // Money Flow matters most on this table: a tight coil with MF above 55 is
  // accumulation inside the base. The same coil under 45 is a name being
  // quietly distributed while it looks like it's resting.
  const mf = computeMoneyFlow(bars, { length: 21 });
  const mfTrend = moneyFlowTrend(bars, { length: 21, lookback: 5 });
  const hi52 = Math.max(...bars.slice(-252).map(b => b.h));
  const pctOffHigh = ((hi52 - price) / hi52) * 100;
  const distToEma21 = ((price - ema21) / ema21) * 100;
  const distToEma10 = ((price - ema10) / ema10) * 100;
  const ema21Rising = ema21Prev != null && ema21 > ema21Prev;

  const dollarVols = bars.slice(-20).map(b => b.c * b.v);
  const avgDollarVol = dollarVols.reduce((a, b) => a + b, 0) / dollarVols.length;
  const vols = bars.slice(-20).map(b => b.v).filter(v => v > 0);
  const avgVol = vols.length > 0 ? vols.reduce((a, b) => a + b, 0) / vols.length : 0;

  const ret = pctReturn(closes, SWING.rsLookback);
  const rsVsSpy = ret != null && spyReturn != null ? ret - spyReturn : null;

  const win10 = bars.slice(-10);
  const hi10 = Math.max(...win10.map(b => b.h));
  const lo10 = Math.min(...win10.map(b => b.l));
  const range10 = lo10 > 0 ? ((hi10 - lo10) / lo10) * 100 : 999;
  const coilRatio = atrPctVal > 0 ? range10 / atrPctVal : 999;

  const changePct = snap?.changePct ?? 0;

  const rawKAt = (offset: number): number => {
    const idx = bars.length - 1 - offset;
    if (idx < 9) return 50;
    const win = bars.slice(idx - 9, idx + 1);
    const hh = Math.max(...win.map(b => b.h));
    const ll = Math.min(...win.map(b => b.l));
    return hh === ll ? 50 : ((bars[idx].c - ll) / (hh - ll)) * 100;
  };
  const oversoldRecent = rawKAt(0) <= 25 || rawKAt(1) <= 25 || rawKAt(2) <= 25;
  const upDay = closes.length >= 2 && closes[closes.length - 1] > closes[closes.length - 2];
  const blueDot = oversoldRecent && upDay && price >= ema21;

  // --- Consolidation sub-row stats -------------------------------------------
  // DIC: count consecutive bars (from most recent backward) that stay inside
  // the 10-day high/low range. When a bar breaks outside, the coil started.
  let coilDays = 0;
  for (let i = bars.length - 1; i >= Math.max(0, bars.length - 30); i--) {
    if (bars[i].h <= hi10 * 1.005 && bars[i].l >= lo10 * 0.995) coilDays++;
    else break;
  }

  // PM: prior move — how far did price run before entering the coil?
  // Compare the close at the coil's start to the low of the 30 bars before it.
  const coilStartIdx = bars.length - coilDays;
  let priorMovePct: number | null = null;
  if (coilStartIdx > 30) {
    const preCoilBars = bars.slice(coilStartIdx - 30, coilStartIdx);
    const preLow = Math.min(...preCoilBars.map(b => b.l));
    const coilEntry = bars[coilStartIdx]?.c ?? price;
    if (preLow > 0) priorMovePct = +(((coilEntry - preLow) / preLow) * 100).toFixed(1);
  }

  // BVR: breakout volume readiness — is volume drying up inside the coil?
  // Ratio of recent 5-day avg volume to 20-day avg volume. Below 0.7 = dry.
  const vol5 = bars.slice(-5).map(b => b.v).filter(v => v > 0);
  const avg5 = vol5.length > 0 ? vol5.reduce((a, b) => a + b, 0) / vol5.length : 0;
  const bvrRatio = avgVol > 0 && avg5 > 0 ? +(avg5 / avgVol).toFixed(2) : null;
  const bvrReady = bvrRatio != null ? bvrRatio <= 0.7 : null;

  // 10/21%: signed gap between the 10 and 21 EMAs as a % of price.
  // Positive = 10 above 21 (stacked). Near zero = coiling into the cross.
  const ema1021GapPct = price > 0 ? +(((ema10 - ema21) / price) * 100).toFixed(2) : null;

  if (avgDollarVol < CONSOL.minDollarVol) return null;
  if (adr == null || adr < CONSOL.minAdrPct) return null;
  if (price < sma50 || price < sma200) return null;
  if (!(sma50 > sma200)) return null;
  if (!ema21Rising) return null;
  if (Math.abs(distToEma10) > CONSOL.maxDistToEma10) return null;
  if (distToEma21 > CONSOL.maxAboveEma21 || distToEma21 < -CONSOL.maxBelowEma21) return null;
  if (range10 > CONSOL.maxRange10) return null;
  if (coilRatio > CONSOL.maxCoilRatio) return null;
  if (Math.abs(changePct) > CONSOL.maxDayChange) return null;
  if (pctOffHigh > CONSOL.maxPctOffHigh) return null;
  if (rsVsSpy == null || rsVsSpy <= 0) return null;

  const tightScore = Math.max(0, Math.min(1,
    (CONSOL.maxCoilRatio - coilRatio) / (CONSOL.maxCoilRatio - 2.0)
  )) * 30;
  const proxScore =
    (1 - Math.abs(distToEma10) / CONSOL.maxDistToEma10) * 15 +
    Math.max(0, 1 - Math.abs(distToEma21) / CONSOL.maxAboveEma21) * 10;
  const rsScore = Math.min(rsVsSpy / 20, 1) * 30;
  const trendScore = 10 + (pctOffHigh <= 7 ? 5 : 0);
  const score = Math.round(Math.max(0, Math.min(100, tightScore + proxScore + rsScore + trendScore)));

  const stage = computeStage(closes, { price: snap?.livePrice ?? price });
  const vol = snap?.vol || bars[bars.length - 1].v || 0;
  const rvolVal = avgVol > 0 && vol > 0 ? +(vol / avgVol).toFixed(2) : null;

  let vwapStatus: 'above' | 'below' | 'neutral' = 'neutral';
  if (snap?.vwap && snap?.livePrice) {
    vwapStatus = snap.livePrice >= snap.vwap ? 'above' : 'below';
  }

  const name = details?.results?.name || symbol;
  const mktCap = details?.results?.market_cap || null;
  if (mktCap && mktCap > 0 && mktCap < CONSOL.minMarketCap) return null;
  const float = details?.results?.share_class_shares_outstanding || (mktCap && price ? mktCap / price : null);
  const sector = cleanSectorDescription(details?.results?.sic_description, details?.results?.sector, details?.results?.industry);

  let shortPct: number | null = null;
  let daysToCover: number | null = null;
  const shortInterest = shortData?.results?.[0]?.short_interest;
  if (shortInterest && float) shortPct = +((shortInterest / float) * 100).toFixed(1);
  if (shortInterest && avgVol > 0) daysToCover = +(shortInterest / avgVol).toFixed(1);

  return {
    symbol,
    name,
    sector,
    price: +price.toFixed(2),
    score,
    changePct: +changePct.toFixed(2),
    vol,
    dVol: Math.round(price * vol),
    rvol: rvolVal,
    float,
    shortPct,
    daysToCover,
    mktCap,
    stage,
    vwapStatus,
    atrPct: +atrPctVal.toFixed(2),
    adrPct: +adr.toFixed(2),
    rmv,
    mf,
    mfTrend,
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
    coilRatio: +coilRatio.toFixed(2),
    blueDot,
    coilDays,
    priorMovePct,
    bvrRatio,
    bvrReady,
    ema1021GapPct,
  };
}

export async function GET() {
  try {
    if (!POLYGON_KEY) {
      return NextResponse.json({ success: false, error: 'Missing Polygon API Key' }, { status: 500 });
    }

    const spyBars = await getDailyBars("SPY");
    const spyReturn = pctReturn(spyBars.map(b => b.c), SWING.rsLookback);

    const [{ symbols: universe, snapMap, snapMapAll }, earningsBlackout] = await Promise.all([getUniverse(), getEarningsBlackout()]);
    const toScan = universe.filter(sym => !earningsBlackout.has(sym));

    const groupedSeries = await getGroupedSeries(new Set(snapMapAll.keys()));

    // T2108 — market-wide breadth from the same grouped data. Persisted
    // independently so the Scorecard can read it without touching the
    // swing payload.
    const t2108 = computeT2108(groupedSeries);
    try {
      await kv.set('t2108_v1', {
        ...t2108,
        updatedAt: new Date().toISOString(),
      });
    } catch (e) { console.error('t2108 persist failed', e); }

    const consolShortlist = shortlistConsolidation(groupedSeries)
      .filter(sym => !earningsBlackout.has(sym));
    const swingSet = new Set(toScan);
    const consolExtra = consolShortlist.filter(sym => !swingSet.has(sym));

    const results = await inBatches(toScan, 10, async (sym) => {
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

    const extraConsols = await inBatches(consolExtra, 10, async (sym) => {
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

    // --- Catalysts: one batched WIIM lookup across both final lists --------
    const consolKeep = consols.slice(0, CONSOL.finalSize);
    const newsSymbols = Array.from(new Set([
      ...candidates.map(c => c.symbol),
      ...consolKeep.map(c => c.symbol),
    ]));
    const wiimMap = await fetchBenzingaWiims(newsSymbols);

    const attachCatalyst = (c: Candidate) => {
      const w = wiimMap.get(c.symbol);
      if (!w) {
        c.catalyst = null;
        c.thesis = null;
        c.catalystUrl = null;
        return;
      }
      const tag = classifyWiim(w.title);
      c.catalyst = w.daysOld >= 1.5 ? `${tag} (Delayed)` : tag;
      c.thesis = w.title;
      c.catalystUrl = w.url;
    };
    candidates.forEach(attachCatalyst);
    consolKeep.forEach(attachCatalyst);

    const scanTime = Date.now();
    const hasRealData = universe.length > 0 && candidates.length > 0;

    if (hasRealData) {
      await kv.set('swing_candidates_v1', candidates);
      await kv.set('swing_meta_v1', {
        spyReturn3M: spyReturn != null ? +spyReturn.toFixed(1) : null,
        universeSize: universe.length,
        excludedForEarnings: universe.length - toScan.length,
        count: candidates.length,
        // Gate metadata for the on-screen key — the config this run enforced.
        scanMeta: SWING_META,
      });
      await kv.set('swing_last_scan_v1', scanTime);
    } else {
      console.warn('Swing scan produced no candidates; preserving previous KV snapshot.');
    }

    if (universe.length > 0) {
      await kv.set('consol_1021_v1', consolKeep);
      await kv.set('consol_1021_meta_v1', {
        count: consols.length,
        scanMeta: CONSOL_META,
      });
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
      catalystsFound: wiimMap.size,
      t2108: t2108.value,
      t2108Zone: t2108.zone,
      t2108Sample: t2108.total,
      scanMeta: { swing: SWING_META, consol: CONSOL_META },
      dataPersisted: hasRealData,
    });
  } catch (error: any) {
    console.error("SWING_RUN_ERROR:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
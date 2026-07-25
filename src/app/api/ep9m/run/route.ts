// app/api/ep9m/run/route.ts — v1.0
//
// EP9M — 9 Million Episodic Pivot (Pradeep Bonde / Stockbee)
//
// The premise: fewer than ~2% of US listings trade 9M+ shares in a session.
// When a stock that normally trades 800k suddenly does 12M, institutions are
// accumulating and the news hasn't been priced yet. The volume IS the signal —
// you research the catalyst after the scan flags it, not before.
//
// CRITICAL DESIGN POINT: the 9M threshold alone is nearly useless. NVDA trades
// 9M shares before 10am every day. The scan only works as a joint condition —
// 9M shares AND that volume is abnormal FOR THIS STOCK. RVOL is the real gate;
// 9M is the floor beneath it that keeps illiquid junk out.
//
// Deliberately does NOT gate on % change. A non-gapping stock quietly trading
// 10x its normal volume is the highest-value case this scan exists to find.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { computeRMV } from '@/lib/indicators/rmv';
import { computeRMEDetail } from '@/lib/indicators/rme';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 300;

const POLYGON_KEY = process.env.NEXT_PUBLIC_POLYGON_API_KEY || process.env.POLYGON_API_KEY || '';
const BENZINGA_KEY = process.env.NEXT_PUBLIC_BENZINGA_API_KEY || process.env.BENZINGA_API_KEY || '';
const BASE = 'https://api.polygon.io';

// ---------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------
const CONFIG = {
  // The namesake threshold. Absolute, not time-weighted — a stock either has
  // traded 9M shares today or it hasn't. Names therefore appear progressively
  // through the session, which mirrors how the scan is actually run live
  // (once in the 9:30-10:30 window, again around 1:30).
  minVolume: 9_000_000,

  minPrice: 3.00,      // Bonde's floor — below this the volume is noise
  maxPrice: 2000,

  // THE gate. Without this the scan returns mega caps every day.
  minRvol: 3.0,

  minDollarVol: 20_000_000,  // has to be actually tradeable

  volProfileDays: 60,        // trailing window for avg + "unprecedented" test
  maxCalendarDays: 90,       // calendar span to find those trading days in

  shortlistSize: 40,         // how many get per-symbol enrichment
  finalSize: 25,

  registryDays: 90,          // how long a trigger stays on the DEP registry
  concurrency: 8,
};

// ETFs that clear 9M shares on any ordinary day. Most would fail the RVOL gate
// anyway, but leveraged products spike hard enough to sneak through, and they
// aren't EP candidates — there's no company to re-rate. Backstopped by a
// ticker `type` check at enrichment.
const HIGH_VOLUME_ETFS = new Set([
  'SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'VTI', 'EEM', 'EFA', 'XLF', 'XLE', 'XLK',
  'XLI', 'XLV', 'XLU', 'XLP', 'XLY', 'XLB', 'XLRE', 'XLC', 'SMH', 'SOXX',
  'TQQQ', 'SQQQ', 'QLD', 'QID', 'SOXL', 'SOXS', 'TECL', 'TECS', 'SPXL', 'SPXS',
  'SPXU', 'UPRO', 'SDS', 'SSO', 'TNA', 'TZA', 'FAS', 'FAZ', 'LABU', 'LABD',
  'UVXY', 'UVIX', 'SVIX', 'VIXY', 'VXX', 'FNGU', 'FNGD', 'GLD', 'SLV', 'GDX',
  'GDXJ', 'USO', 'UNG', 'TLT', 'HYG', 'LQD', 'ARKK', 'IBIT', 'BITO', 'BITX',
  'NUGT', 'DUST', 'JNUG', 'ERX', 'ERY', 'BOIL', 'KOLD', 'NAIL', 'URAA',
]);

interface Bar { t: number; o: number; h: number; l: number; c: number; v: number; }
interface LiteBar { c: number; h: number; l: number; v: number; }

interface SnapInfo {
  price: number;
  prevClose: number;
  changePct: number;
  vol: number;
  vwap: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  dayOpen: number | null;
}

interface Ep9mCandidate {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  score: number;
  grade: string;
  changePct: number;
  vol: number;
  dVol: number;
  avgVol: number;
  rvol: number;
  volVs60dMax: number | null;
  unprecedented: boolean;
  floatTurnover: number | null;
  daysToCover: number | null;
  closeStrength: number | null;
  float: number | null;
  shortPct: number | null;
  mktCap: number | null;
  stage: string;
  vwapStatus: 'above' | 'below' | 'neutral';
  atrPct: number | null;
  adrPct: number | null;
  rmv: number | null;
  rme: number | null;
  aboveEma10: boolean | null;
  aboveEma21: boolean | null;
  distToEma21: number | null;
  ema21Rising: boolean | null;
  goldenCross: boolean | null;
  pctOffHigh: number | null;
  rsVsSpy: number | null;
  priorTriggers: number;
  sugarBaby: boolean;
  catalyst: string | null;
  catalystUrl: string | null;
  thesis: string | null;
  scoreBreakdown: Record<string, number>;
}

// ---------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------
async function polygon<T = any>(path: string): Promise<T> {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${BASE}${path}${sep}apiKey=${POLYGON_KEY}`);
  if (!res.ok) throw new Error(`Polygon ${res.status}: ${path.split('?')[0]}`);
  return res.json() as Promise<T>;
}

async function polygonSafe<T = any>(path: string, fallback: T): Promise<T> {
  try { return await polygon<T>(path); } catch { return fallback; }
}

function dateStr(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
}

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
// Sector classification — same logic as the other two routes
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
// Indicator math (ascending bars)
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

function pctReturn(closes: number[], lookback: number): number | null {
  if (closes.length < lookback + 1) return null;
  const then = closes[closes.length - 1 - lookback];
  return then > 0 ? ((closes[closes.length - 1] - then) / then) * 100 : null;
}

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
// Stage 1: universe from the full-market snapshot (1 call)
// ---------------------------------------------------------------
async function getUniverse(): Promise<{ symbols: string[]; snapMap: Map<string, SnapInfo> }> {
  const data = await polygon<{ tickers?: any[] }>('/v2/snapshot/locale/us/markets/stocks/tickers');
  const tickers = data.tickers ?? [];

  const snapMap = new Map<string, SnapInfo>();
  const symbols: string[] = [];

  for (const t of tickers) {
    const sym: string = t.ticker ?? '';
    if (!/^[A-Z]{1,5}$/.test(sym)) continue;
    if (HIGH_VOLUME_ETFS.has(sym)) continue;

    const price = t.lastTrade?.p || t.min?.c || t.day?.c || t.prevDay?.c || 0;
    const vol = t.day?.v || 0;
    if (price < CONFIG.minPrice || price > CONFIG.maxPrice) continue;

    // The namesake gate.
    if (vol < CONFIG.minVolume) continue;

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
      vwap: t.day?.vw ?? null,
      dayHigh: t.day?.h ?? null,
      dayLow: t.day?.l ?? null,
      dayOpen: t.day?.o ?? null,
    });
    symbols.push(sym);
  }

  return { symbols, snapMap };
}

// ---------------------------------------------------------------
// Stage 2: market-wide volume profile from grouped daily bars.
// ~60 calls total for every US stock's recent history — the only affordable
// way to answer "is 9M abnormal FOR THIS NAME" across the whole market.
// ---------------------------------------------------------------
async function getVolumeProfile(validSymbols: Set<string>): Promise<Map<string, LiteBar[]>> {
  const dates: string[] = [];
  for (let d = CONFIG.maxCalendarDays; d >= 1; d--) {
    const dt = new Date(Date.now() - d * 86400000);
    const day = dt.getUTCDay();
    if (day === 0 || day === 6) continue;
    dates.push(dt.toISOString().slice(0, 10));
  }

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
  const kept = dayResults.slice(-CONFIG.volProfileDays);

  const series = new Map<string, LiteBar[]>();
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
// Stage 3: abnormality shortlist.
//
// Grouped history includes today's partial bar during a live session, so the
// trailing window is taken from bars BEFORE the last one — otherwise today's
// spike inflates its own baseline and suppresses the very signal we want.
// ---------------------------------------------------------------
interface Abnormality {
  sym: string;
  avgVol: number;
  rvol: number;
  vol60dMax: number | null;
  volVs60dMax: number | null;
  unprecedented: boolean;
}

function shortlistAbnormal(
  series: Map<string, LiteBar[]>,
  snapMap: Map<string, SnapInfo>
): Abnormality[] {
  const picks: Abnormality[] = [];

  series.forEach((bars, sym) => {
    const snap = snapMap.get(sym);
    if (!snap) return;
    if (bars.length < 25) return; // too little history to call anything abnormal

    // Exclude the most recent bar — it may be today, partially formed.
    const prior = bars.slice(0, -1);
    if (prior.length < 20) return;

    const recent20 = prior.slice(-20).map(b => b.v).filter(v => v > 0);
    if (recent20.length < 15) return;
    const avgVol = recent20.reduce((a, b) => a + b, 0) / recent20.length;
    if (avgVol <= 0) return;

    const rvol = snap.vol / avgVol;
    if (rvol < CONFIG.minRvol) return;

    const dVol = snap.vol * snap.price;
    if (dVol < CONFIG.minDollarVol) return;

    const priorVols = prior.map(b => b.v).filter(v => v > 0);
    const vol60dMax = priorVols.length > 0 ? Math.max(...priorVols) : null;
    const volVs60dMax = vol60dMax && vol60dMax > 0 ? snap.vol / vol60dMax : null;

    picks.push({
      sym,
      avgVol,
      rvol,
      vol60dMax,
      volVs60dMax,
      // "Never traded anywhere near this level" — literally, not rhetorically.
      unprecedented: volVs60dMax != null && volVs60dMax >= 1.0,
    });
  });

  // Most abnormal first — that's the whole ranking premise.
  picks.sort((a, b) => b.rvol - a.rvol);
  return picks.slice(0, CONFIG.shortlistSize);
}

// ---------------------------------------------------------------
// WIIM catalysts — Bonde researches the story AFTER the scan flags the
// volume. This surfaces it inline so that step is one glance, not a search.
// ---------------------------------------------------------------
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

function isNegativeHeadline(title: string | null | undefined): boolean {
  if (!title) return false;
  const s = title.toLowerCase();
  return /offering|dilut|reverse split|reverse stock split|going concern|delist|bankrupt|chapter 11|at-the-market|atm program|warrant exercise|registered direct|shelf registration/.test(s);
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

// ---------------------------------------------------------------
// EP9M score (0-100), on the same grade lines as CNF (A>=70, B>=50)
//
// Volume abnormality carries half the weight because it IS the setup.
// Close strength matters more than it looks: a stock that traded 12M shares
// and closed on its low moved that volume from buyers to sellers. That's
// distribution wearing an accumulation costume.
// ---------------------------------------------------------------
function scoreEp9m(q: {
  rvol: number;
  volVs60dMax: number | null;
  floatTurnover: number | null;
  daysToCover: number | null;
  closeStrength: number | null;
  catalystTier: 'strong' | 'neutral' | 'negative' | 'none';
  priorTriggers: number;
}): { score: number; grade: string; breakdown: Record<string, number> } {
  const b: Record<string, number> = {};

  // --- Volume abnormality: the core signal ---
  b.rvol = 0;
  if (q.rvol >= 10) b.rvol = 30;
  else if (q.rvol >= 7) b.rvol = 26;
  else if (q.rvol >= 5) b.rvol = 22;
  else if (q.rvol >= 4) b.rvol = 17;
  else if (q.rvol >= 3) b.rvol = 12;

  // --- Unprecedented: exceeding its own 60-day volume record ---
  b.unprecedented = 0;
  if (q.volVs60dMax != null) {
    if (q.volVs60dMax >= 2.0) b.unprecedented = 20;
    else if (q.volVs60dMax >= 1.5) b.unprecedented = 16;
    else if (q.volVs60dMax >= 1.0) b.unprecedented = 12;
    else if (q.volVs60dMax >= 0.7) b.unprecedented = 5;
  }

  // --- Float turnover: a small float churning multiples of itself is the
  // purest version of "something significant is happening here".
  b.floatTurnover = 0;
  if (q.floatTurnover != null) {
    if (q.floatTurnover >= 1.0) b.floatTurnover = 15;
    else if (q.floatTurnover >= 0.5) b.floatTurnover = 12;
    else if (q.floatTurnover >= 0.25) b.floatTurnover = 8;
    else if (q.floatTurnover >= 0.10) b.floatTurnover = 4;
  }

  // --- Catalyst quality. Unlike the main scanner this is a bonus rather than
  // a requirement — the volume alone is a valid EP9M trigger, and finding the
  // story before the crowd is the entire edge.
  b.catalyst = 0;
  if (q.catalystTier === 'strong') b.catalyst = 15;
  else if (q.catalystTier === 'neutral') b.catalyst = 9;
  else if (q.catalystTier === 'negative') b.catalyst = -20; // pump-then-offering

  // --- Close strength: where in the day's range it settled ---
  b.closeStrength = 0;
  if (q.closeStrength != null) {
    if (q.closeStrength >= 0.85) b.closeStrength = 10;
    else if (q.closeStrength >= 0.70) b.closeStrength = 7;
    else if (q.closeStrength >= 0.50) b.closeStrength = 3;
    else if (q.closeStrength <= 0.25) b.closeStrength = -8;
  }

  // --- Days to cover: the "5" in MAGNA 53. Short interest is squeeze fuel.
  b.daysToCover = 0;
  if (q.daysToCover != null) {
    if (q.daysToCover >= 5) b.daysToCover = 10;
    else if (q.daysToCover >= 3) b.daysToCover = 6;
    else if (q.daysToCover >= 1.5) b.daysToCover = 3;
  }

  // --- Sugar baby: repeat EP9M offenders make repeatable swings ---
  b.repeatOffender = q.priorTriggers >= 2 ? 5 : q.priorTriggers === 1 ? 3 : 0;

  const raw = Object.values(b).reduce((s, v) => s + v, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  const grade = score >= 70 ? 'A' : score >= 50 ? 'B' : 'C';
  return { score, grade, breakdown: b };
}

// ---------------------------------------------------------------
// Registry — every trigger, kept for 90 days.
// Free to maintain, and it's the prerequisite for the Delayed Reaction EP
// (Bonde's highest-size setup): watch these names for a tight pullback over
// the following weeks, then buy the re-break with a sub-1% stop.
// Also gives "sugar baby" detection for free.
// ---------------------------------------------------------------
interface RegistryEntry {
  ticker: string;
  date: string;
  price: number;
  vol: number;
  rvol: number;
  score: number;
}

async function readRegistry(): Promise<RegistryEntry[]> {
  try {
    const stored = await kv.get<RegistryEntry[]>('ep9m_registry_v1');
    if (!Array.isArray(stored)) return [];
    const cutoff = dateStr(CONFIG.registryDays);
    return stored.filter(e => e?.date && e.date >= cutoff);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------
// Handler
// ---------------------------------------------------------------
export async function GET() {
  try {
    if (!POLYGON_KEY) {
      return NextResponse.json({ success: false, error: 'Missing Polygon API Key' }, { status: 500 });
    }

    const today = dateStr(0);

    // SPY 3-month return for the RS column
    const spyRes = await polygonSafe<{ results?: Bar[] }>(
      `/v2/aggs/ticker/SPY/range/1/day/${dateStr(450)}/${today}?adjusted=true&sort=asc&limit=5000`,
      { results: [] }
    );
    const spyBars = spyRes.results ?? [];
    const spyReturn = pctReturn(spyBars.map(b => b.c), 63);

    // Stage 1 — who traded 9M+ today
    const { symbols, snapMap } = await getUniverse();

    if (symbols.length === 0) {
      const scanTime = Date.now();
      await kv.set('ep9m_v1', []);
      await kv.set('ep9m_last_scan_v1', scanTime);
      await kv.set('ep9m_meta_v1', { raw9m: 0, shortlisted: 0, count: 0 });
      return NextResponse.json({
        success: true, lastScanTime: scanTime, raw9m: 0, shortlisted: 0, count: 0,
        note: 'No names above the 9M share threshold yet — expected early in the session.',
      });
    }

    // Stage 2 + 3 — is that volume abnormal for them
    const profile = await getVolumeProfile(new Set(symbols));
    const shortlist = shortlistAbnormal(profile, snapMap);

    const registry = await readRegistry();
    const priorCounts = new Map<string, number>();
    for (const e of registry) {
      if (e.date === today) continue; // today's own trigger isn't "prior"
      priorCounts.set(e.ticker, (priorCounts.get(e.ticker) || 0) + 1);
    }

    // Stage 4 — full enrichment, shortlist only
    const enriched = await inBatches(shortlist, CONFIG.concurrency, async (ab) => {
      const sym = ab.sym;
      const snap = snapMap.get(sym);
      if (!snap) return null;

      const [barsRes, details, shortData] = await Promise.all([
        polygonSafe<{ results?: Bar[] }>(
          `/v2/aggs/ticker/${encodeURIComponent(sym)}/range/1/day/${dateStr(450)}/${today}?adjusted=true&sort=asc&limit=5000`,
          { results: [] }
        ),
        polygonSafe<any>(`/v3/reference/tickers/${sym}`, {}),
        polygonSafe<any>(`/stocks/v1/short-interest?ticker=${sym}`, { results: [] }),
      ]);

      // Backstop for ETFs/funds that slipped past the static exclusion list.
      const tickerType = (details?.results?.type || '').toUpperCase();
      if (tickerType && tickerType !== 'CS' && tickerType !== 'ADRC') return null;

      const bars = barsRes.results ?? [];
      if (bars.length < 30) return null;

      const closes = bars.map(b => b.c);
      const price = snap.price;

      const atr14 = atr(bars, 14);
      const atrPctVal = atr14 && price > 0 ? (atr14 / price) * 100 : null;
      const adr = adrPct(bars, 20);
      const rmv = computeRMV(bars, { lookback: 15 });
      const rmeDetail = computeRMEDetail(bars, { maLength: 21, lookback: 250 });

      const e10 = ema(closes, 10);
      const e21 = ema(closes, 21);
      const e21Prev = ema(closes.slice(0, -3), 21);
      const sma50 = sma(closes, 50);
      const sma200 = sma(closes, 200);

      const hiWindow = bars.slice(-Math.min(252, bars.length)).map(b => b.h);
      const hi52 = hiWindow.length ? Math.max(...hiWindow) : null;
      const pctOffHigh = hi52 && hi52 > 0 ? ((price - hi52) / hi52) * 100 : null;

      const ret3M = pctReturn(closes, 63);
      const rsVsSpy = ret3M != null && spyReturn != null ? ret3M - spyReturn : null;

      const mktCap = details?.results?.market_cap || null;
      const float = details?.results?.share_class_shares_outstanding || (mktCap && price ? mktCap / price : null);

      let shortPct: number | null = null;
      let daysToCover: number | null = null;
      const si = shortData?.results?.[0]?.short_interest;
      if (si && float && float > 0) shortPct = (si / float) * 100;
      if (si && ab.avgVol > 0) daysToCover = si / ab.avgVol;

      // How much of the tradeable float changed hands today.
      const floatTurnover = float && float > 0 ? snap.vol / float : null;

      // Where in the day's range price settled. 1.0 = closed on the high.
      let closeStrength: number | null = null;
      if (snap.dayHigh != null && snap.dayLow != null && snap.dayHigh > snap.dayLow) {
        closeStrength = (price - snap.dayLow) / (snap.dayHigh - snap.dayLow);
      }

      let vwapStatus: 'above' | 'below' | 'neutral' = 'neutral';
      if (snap.vwap && snap.vwap > 0) vwapStatus = price >= snap.vwap ? 'above' : 'below';

      const sector = cleanSectorDescription(
        details?.results?.sic_description,
        details?.results?.sector,
        details?.results?.industry
      );

      return {
        ab,
        snap,
        raw: {
          name: details?.results?.name || sym,
          sector,
          mktCap,
          float,
          shortPct,
          daysToCover,
          floatTurnover,
          closeStrength,
          vwapStatus,
          atrPct: atrPctVal,
          adrPct: adr,
          rmv,
          rme: rmeDetail.rme,
          aboveEma10: e10 != null ? price >= e10 : null,
          aboveEma21: e21 != null ? price >= e21 : null,
          distToEma21: e21 && e21 > 0 ? ((price - e21) / e21) * 100 : null,
          ema21Rising: e21 != null && e21Prev != null ? e21 > e21Prev : null,
          goldenCross: sma50 != null && sma200 != null ? sma50 > sma200 : null,
          pctOffHigh,
          rsVsSpy,
          stage: computeStage(closes, price),
        },
      };
    });

    // Stage 5 — catalysts for survivors only
    const wiimMap = await fetchBenzingaWiims(enriched.map(e => e.ab.sym));
    const STRONG_TAGS = new Set(['Earnings', 'FDA / Data', 'M&A', 'Guidance', 'Contract']);
    const NEGATIVE_TAGS = new Set(['Offering', 'Legal / Risk']);

    const candidates: Ep9mCandidate[] = enriched.map(({ ab, snap, raw }) => {
      const wiim = wiimMap.get(ab.sym);
      let catalyst: string | null = null;
      let catalystUrl: string | null = null;
      let thesis: string | null = null;
      let tier: 'strong' | 'neutral' | 'negative' | 'none' = 'none';

      if (wiim) {
        const tag = classifyWiim(wiim.title);
        catalyst = wiim.daysOld >= 1.5 ? `${tag} (Delayed)` : tag;
        catalystUrl = wiim.url;
        thesis = wiim.title;
        if (NEGATIVE_TAGS.has(tag) || isNegativeHeadline(wiim.title)) tier = 'negative';
        else if (STRONG_TAGS.has(tag)) tier = 'strong';
        else tier = 'neutral';
      }

      const priorTriggers = priorCounts.get(ab.sym) || 0;

      const scored = scoreEp9m({
        rvol: ab.rvol,
        volVs60dMax: ab.volVs60dMax,
        floatTurnover: raw.floatTurnover,
        daysToCover: raw.daysToCover,
        closeStrength: raw.closeStrength,
        catalystTier: tier,
        priorTriggers,
      });

      return {
        ticker: ab.sym,
        name: raw.name,
        sector: raw.sector,
        price: +snap.price.toFixed(2),
        score: scored.score,
        grade: scored.grade,
        changePct: +snap.changePct.toFixed(2),
        vol: snap.vol,
        dVol: Math.round(snap.price * snap.vol),
        avgVol: Math.round(ab.avgVol),
        rvol: +ab.rvol.toFixed(2),
        volVs60dMax: ab.volVs60dMax != null ? +ab.volVs60dMax.toFixed(2) : null,
        unprecedented: ab.unprecedented,
        floatTurnover: raw.floatTurnover != null ? +raw.floatTurnover.toFixed(3) : null,
        daysToCover: raw.daysToCover != null ? +raw.daysToCover.toFixed(1) : null,
        closeStrength: raw.closeStrength != null ? +raw.closeStrength.toFixed(2) : null,
        float: raw.float,
        shortPct: raw.shortPct != null ? +raw.shortPct.toFixed(1) : null,
        mktCap: raw.mktCap,
        stage: raw.stage,
        vwapStatus: raw.vwapStatus,
        atrPct: raw.atrPct != null ? +raw.atrPct.toFixed(2) : null,
        adrPct: raw.adrPct != null ? +raw.adrPct.toFixed(2) : null,
        rmv: raw.rmv,
        rme: raw.rme,
        aboveEma10: raw.aboveEma10,
        aboveEma21: raw.aboveEma21,
        distToEma21: raw.distToEma21 != null ? +raw.distToEma21.toFixed(2) : null,
        ema21Rising: raw.ema21Rising,
        goldenCross: raw.goldenCross,
        pctOffHigh: raw.pctOffHigh != null ? +raw.pctOffHigh.toFixed(1) : null,
        rsVsSpy: raw.rsVsSpy != null ? +raw.rsVsSpy.toFixed(1) : null,
        priorTriggers,
        sugarBaby: priorTriggers >= 2,
        catalyst,
        catalystUrl,
        thesis,
        scoreBreakdown: scored.breakdown,
      };
    });

    candidates.sort((a, b) => b.score - a.score);
    const finalList = candidates.slice(0, CONFIG.finalSize);

    // Update the registry — one entry per ticker per day, best score wins.
    const cutoff = dateStr(CONFIG.registryDays);
    const registryMap = new Map<string, RegistryEntry>();
    for (const e of registry) {
      if (e.date >= cutoff) registryMap.set(`${e.ticker}|${e.date}`, e);
    }
    for (const c of finalList) {
      const key = `${c.ticker}|${today}`;
      const prev = registryMap.get(key);
      if (!prev || c.score > prev.score) {
        registryMap.set(key, {
          ticker: c.ticker, date: today, price: c.price,
          vol: c.vol, rvol: c.rvol, score: c.score,
        });
      }
    }
    const nextRegistry = Array.from(registryMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    const scanTime = Date.now();
    await kv.set('ep9m_v1', finalList);
    await kv.set('ep9m_last_scan_v1', scanTime);
    await kv.set('ep9m_meta_v1', {
      raw9m: symbols.length,
      shortlisted: shortlist.length,
      count: finalList.length,
      minRvol: CONFIG.minRvol,
      minVolume: CONFIG.minVolume,
    });
    await kv.set('ep9m_registry_v1', nextRegistry);

    return NextResponse.json({
      success: true,
      lastScanTime: scanTime,
      raw9m: symbols.length,
      shortlisted: shortlist.length,
      count: finalList.length,
      registrySize: nextRegistry.length,
      catalystsFound: wiimMap.size,
    });
  } catch (error: any) {
    console.error('EP9M_RUN_ERROR:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
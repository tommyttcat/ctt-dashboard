// app/api/ep9m/run/route.ts — v1.5
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
// v1.1: Weinstein sub-stages via lib/indicators/stage.
// v1.2: + Money Flow (21), also scored — heavy abnormal volume with MF under
//       45 is 21 sessions of distribution, however good today's print looks.
// v1.3: thresholds moved to lib/scanConfig and shipped in the payload.
// v1.4: + Stochastic %K(10) emitted as stochK.
// v1.5: + TRADE PLAN, matching scanner v6.15 and swing v1.8.
//
//       This route already computed ema10 and ema21 and kept only the
//       percentage distances. Fine for ranking, useless for planning: you
//       cannot place a stop relative to "3.2% below the 21 EMA". The raw
//       levels are retained now, ema50 is added as a resistance reference,
//       and priorSwingHigh gives the planner something above the averages to
//       measure against.
//
//       SETUP NAME IS DELIBERATELY LEFT NULL, which resolves to the generic
//       family and triggers off the day high. That is the honest read here:
//       an EP9M name has no pattern by construction — the scan gates on
//       volume abnormality, not on shape — so there is no 10 EMA reclaim or
//       range high to key off. The day high is the level that says the
//       volume produced follow-through rather than just churn.
//
//       WHAT THE PLAN WILL AND WILL NOT SHOW HERE. The `collapsed` flag can
//       never fire on this table, because the negative-change gate below
//       (see the NOTE ON THE CHANGE GATE) removes every down name before
//       scoring. `trigger already passed` also cannot fire, since the day
//       high is by definition at or above price. So the two live signals are
//       `overextended` — the name already ran too far past its 21 EMA to
//       place a sane stop — and the R figure itself, which measures how much
//       room there is before the first average overhead.
//
// ---------------------------------------------------------------------------
// NOTE ON THE CHANGE GATE — a contradiction that predates this version.
//
// The original header claimed this scan "deliberately does NOT gate on %
// change", on the reasoning that a non-gapping stock quietly trading 10x its
// normal volume is the highest-value case the scan exists to find. That line
// has been removed from the header because it is not what the code does:
//
//     if ((snap.changePct ?? 0) < 0) return null;
//
// A stock down 0.4% on 11x volume — precisely the quiet accumulation the
// premise describes — is discarded. Only exactly-flat or positive names
// survive. The gate is defensible on its own terms (a down day on heavy
// volume is often distribution, and MF already scores that), but it is a
// real filter and the header should not have claimed otherwise.
//
// Left in place: changing scan semantics is a separate decision from adding
// a trade plan, and reversing it would alter what appears on the table.
// Flagged here so the choice is visible rather than buried.
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { computeRMV } from '@/lib/indicators/rmv';
import { computeRMEDetail } from '@/lib/indicators/rme';
import { computeStage } from '@/lib/indicators/stage';
import { computeMoneyFlow, moneyFlowTrend } from '@/lib/indicators/moneyflow';
import { computeTradePlan } from '@/lib/indicators/tradeplan';
import { EP9M, EP9M_META } from '@/lib/scanConfig';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 300;

const POLYGON_KEY = process.env.NEXT_PUBLIC_POLYGON_API_KEY || process.env.POLYGON_API_KEY || '';
const BENZINGA_KEY = process.env.NEXT_PUBLIC_BENZINGA_API_KEY || process.env.BENZINGA_API_KEY || '';
const BASE = 'https://api.polygon.io';

// Fetch-window mechanics, not scan gates — these stay local rather than
// living in scanConfig, since they describe how much history to pull rather
// than what qualifies a name.
const WINDOW = {
  maxCalendarDays: 90,
  concurrency: 8,
};

// Prior swing high window. 63 sessions back, EXCLUDING the most recent five —
// without that exclusion a name that just ran becomes its own resistance and
// every fresh mover reports a trigger already blocked. Matters more here than
// anywhere else: an EP9M name IS a fresh mover by definition.
const SWING_HIGH_LOOKBACK = 63;
const SWING_HIGH_EXCLUDE_RECENT = 5;

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

interface TradePlanOut {
  family?: string;
  trigger?: number | null;
  triggerLabel?: string;
  stop?: number | null;
  stopPct?: number | null;
  target?: number | null;
  rMultiple?: number;
  resistanceR?: number | null;
  resistanceLabel?: string | null;
  clear?: boolean;
  collapsed?: boolean;
  overextended?: boolean;
  tradeable: boolean;
  note?: string;
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
  mf: number | null;
  mfTrend: number;
  stochK: number | null;
  rme: number | null;
  aboveEma10: boolean | null;
  aboveEma21: boolean | null;
  distToEma21: number | null;
  distToEma10: number | null;
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
  // v1.5 — raw levels and the plan built from them.
  ema10: number | null;
  ema21: number | null;
  ema50: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  priorSwingHigh: number | null;
  plan: TradePlanOut | null;
}

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

const round2 = (v: number | null | undefined): number | null =>
  v == null || !Number.isFinite(v) ? null : parseFloat(v.toFixed(2));

// Serialises the planner output for the wire. Every numeric goes through
// round2 so a NaN escaping a degenerate bar series cannot reach the component,
// where it would render as "NaN" in a price field.
function serialisePlan(p: ReturnType<typeof computeTradePlan>): TradePlanOut {
  if (!p.tradeable) {
    return {
      tradeable: false,
      collapsed: p.collapsed,
      overextended: p.overextended,
      note: p.note,
      family: p.family,
    };
  }
  return {
    family: p.family,
    trigger: round2(p.trigger),
    triggerLabel: p.triggerLabel,
    stop: round2(p.stop),
    stopPct: p.stopPct != null ? parseFloat(p.stopPct.toFixed(2)) : null,
    target: round2(p.target),
    rMultiple: p.rMultiple,
    resistanceR: p.resistanceR != null ? parseFloat(p.resistanceR.toFixed(2)) : null,
    resistanceLabel: p.resistanceLabel,
    clear: p.clear,
    collapsed: p.collapsed,
    overextended: p.overextended,
    tradeable: true,
    note: p.note,
  };
}

// Highest high in the lookback window, excluding the most recent few bars.
// Bars arrive sorted ascending, so the recent end is the tail.
function priorSwingHighOf(bars: Bar[]): number | null {
  if (bars.length < 20) return null;
  const end = bars.length - SWING_HIGH_EXCLUDE_RECENT;
  const start = Math.max(0, bars.length - SWING_HIGH_LOOKBACK);
  if (end <= start) return null;
  const win = bars.slice(start, end);
  if (win.length === 0) return null;
  return Math.max(...win.map(b => b.h));
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

// Average Daily Range % — no gap component, so it measures the intraday room
// a typical session offers. This is the stop basis in the trade plan, for
// exactly that reason.
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

// Stochastic %K(period) — where today's close sits within the period's
// high/low range. Low readings near a rising 21 EMA are the Blue Dot
// precondition. Returns null when the window is too short or flat.
function stochasticK(bars: Bar[], period = 10): number | null {
  if (bars.length < period) return null;
  const window = bars.slice(-period);
  const highestHigh = Math.max(...window.map(b => b.h));
  const lowestLow = Math.min(...window.map(b => b.l));
  const close = bars[bars.length - 1].c;
  const range = highestHigh - lowestLow;
  if (range <= 0) return null;
  return Math.round(((close - lowestLow) / range) * 100 * 10) / 10;
}

function pctReturn(closes: number[], lookback: number): number | null {
  if (closes.length < lookback + 1) return null;
  const then = closes[closes.length - 1 - lookback];
  return then > 0 ? ((closes[closes.length - 1] - then) / then) * 100 : null;
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
    if (price < EP9M.minPrice || price > EP9M.maxPrice) continue;

    // The namesake gate.
    if (vol < EP9M.minVolume) continue;

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
  for (let d = WINDOW.maxCalendarDays; d >= 1; d--) {
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
  const kept = dayResults.slice(-EP9M.volProfileDays);

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
    if (bars.length < 25) return;

    const prior = bars.slice(0, -1);
    if (prior.length < 20) return;

    const recent20 = prior.slice(-20).map(b => b.v).filter(v => v > 0);
    if (recent20.length < 15) return;
    const avgVol = recent20.reduce((a, b) => a + b, 0) / recent20.length;
    if (avgVol <= 0) return;

    const rvol = snap.vol / avgVol;
    if (rvol < EP9M.minRvol) return;

    const dVol = snap.vol * snap.price;
    if (dVol < EP9M.minDollarVol) return;

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

  picks.sort((a, b) => b.rvol - a.rvol);
  return picks.slice(0, EP9M.shortlistSize);
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
// and closed on its low moved that volume from buyers to sellers.
//
// Money Flow is a modifier. Close strength is one day; MF is 21. A name can
// close strong on the trigger day while the prior month was steady
// distribution — that combination is a trap, and only MF sees it.
//
// NOTE: this score says nothing about whether the name is enterable. That is
// the trade plan's job, and the two are deliberately kept apart — a 90 here
// means the volume event is exceptional, not that there is room to be paid.
// ---------------------------------------------------------------
function scoreEp9m(q: {
  rvol: number;
  volVs60dMax: number | null;
  floatTurnover: number | null;
  daysToCover: number | null;
  closeStrength: number | null;
  mf: number | null;
  catalystTier: 'strong' | 'neutral' | 'negative' | 'none';
  priorTriggers: number;
}): { score: number; grade: string; breakdown: Record<string, number> } {
  const b: Record<string, number> = {};

  b.rvol = 0;
  if (q.rvol >= 10) b.rvol = 30;
  else if (q.rvol >= 7) b.rvol = 26;
  else if (q.rvol >= 5) b.rvol = 22;
  else if (q.rvol >= 4) b.rvol = 17;
  else if (q.rvol >= 3) b.rvol = 12;

  b.unprecedented = 0;
  if (q.volVs60dMax != null) {
    if (q.volVs60dMax >= 2.0) b.unprecedented = 20;
    else if (q.volVs60dMax >= 1.5) b.unprecedented = 16;
    else if (q.volVs60dMax >= 1.0) b.unprecedented = 12;
    else if (q.volVs60dMax >= 0.7) b.unprecedented = 5;
  }

  b.floatTurnover = 0;
  if (q.floatTurnover != null) {
    if (q.floatTurnover >= 1.0) b.floatTurnover = 15;
    else if (q.floatTurnover >= 0.5) b.floatTurnover = 12;
    else if (q.floatTurnover >= 0.25) b.floatTurnover = 8;
    else if (q.floatTurnover >= 0.10) b.floatTurnover = 4;
  }

  b.catalyst = 0;
  if (q.catalystTier === 'strong') b.catalyst = 15;
  else if (q.catalystTier === 'neutral') b.catalyst = 9;
  else if (q.catalystTier === 'negative') b.catalyst = -20;

  b.closeStrength = 0;
  if (q.closeStrength != null) {
    if (q.closeStrength >= 0.85) b.closeStrength = 10;
    else if (q.closeStrength >= 0.70) b.closeStrength = 7;
    else if (q.closeStrength >= 0.50) b.closeStrength = 3;
    else if (q.closeStrength <= 0.25) b.closeStrength = -8;
  }

  b.moneyFlow = 0;
  if (q.mf != null) {
    if (q.mf >= 65) b.moneyFlow = 8;
    else if (q.mf >= 55) b.moneyFlow = 5;
    else if (q.mf <= 35) b.moneyFlow = -10;
    else if (q.mf <= 45) b.moneyFlow = -5;
  }

  b.daysToCover = 0;
  if (q.daysToCover != null) {
    if (q.daysToCover >= 5) b.daysToCover = 10;
    else if (q.daysToCover >= 3) b.daysToCover = 6;
    else if (q.daysToCover >= 1.5) b.daysToCover = 3;
  }

  b.repeatOffender = q.priorTriggers >= 2 ? 5 : q.priorTriggers === 1 ? 3 : 0;

  const raw = Object.values(b).reduce((s, v) => s + v, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  const grade = score >= 70 ? 'A' : score >= 50 ? 'B' : 'C';
  return { score, grade, breakdown: b };
}

// ---------------------------------------------------------------
// Registry — every trigger, kept for 90 days. Free to maintain, and it's the
// prerequisite for the Delayed Reaction EP: watch these names for a tight
// pullback over the following weeks, then buy the re-break with a sub-1% stop.
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
    const cutoff = dateStr(EP9M.registryDays);
    return stored.filter(e => e?.date && e.date >= cutoff);
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    if (!POLYGON_KEY) {
      return NextResponse.json({ success: false, error: 'Missing Polygon API Key' }, { status: 500 });
    }

    const today = dateStr(0);

    const spyRes = await polygonSafe<{ results?: Bar[] }>(
      `/v2/aggs/ticker/SPY/range/1/day/${dateStr(450)}/${today}?adjusted=true&sort=asc&limit=5000`,
      { results: [] }
    );
    const spyBars = spyRes.results ?? [];
    const spyReturn = pctReturn(spyBars.map(b => b.c), 63);

    const { symbols, snapMap } = await getUniverse();

    if (symbols.length === 0) {
      const scanTime = Date.now();
      await kv.set('ep9m_v1', []);
      await kv.set('ep9m_last_scan_v1', scanTime);
      await kv.set('ep9m_meta_v1', { raw9m: 0, shortlisted: 0, count: 0, scanMeta: EP9M_META });
      return NextResponse.json({
        success: true, lastScanTime: scanTime, raw9m: 0, shortlisted: 0, count: 0,
        scanMeta: EP9M_META,
        note: 'No names above the 9M share threshold yet — expected early in the session.',
      });
    }

    const profile = await getVolumeProfile(new Set(symbols));
    const shortlist = shortlistAbnormal(profile, snapMap);

    const registry = await readRegistry();
    const priorCounts = new Map<string, number>();
    for (const e of registry) {
      if (e.date === today) continue;
      priorCounts.set(e.ticker, (priorCounts.get(e.ticker) || 0) + 1);
    }

    const enriched = await inBatches(shortlist, WINDOW.concurrency, async (ab) => {
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

      // Money Flow (21) — the sharpest cross-check this scan has. Heavy
      // abnormal volume with MF under 45 means the last month was steady
      // distribution, however good today's single-day print looks.
      const mf = computeMoneyFlow(bars, { length: 21 });
      const mfTrend = moneyFlowTrend(bars, { length: 21, lookback: 5 });
      const stochK = stochasticK(bars, 10);

      const e10 = ema(closes, 10);
      const e21 = ema(closes, 21);
      // v1.5: the 50 exists purely as a resistance reference for the plan —
      // nothing else on this table reads it.
      const e50 = ema(closes, 50);
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

      const floatTurnover = float && float > 0 ? snap.vol / float : null;

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

      // --- TRADE PLAN (v1.5) -----------------------------------------------
      // setupName left null on purpose — see the header note. The generic
      // family triggers off the day high, which is the only defensible entry
      // on a scan that gates on volume rather than shape.
      //
      // Snapshot dayHigh preferred over the daily bar: during a live session
      // the snapshot is minutes old while the aggregate bar can lag.
      const dayHigh = snap.dayHigh ?? bars[bars.length - 1]?.h ?? null;
      const priorSwingHigh = priorSwingHighOf(bars);
      const plan = computeTradePlan({
        price,
        adrPct: adr,
        atrPct: atrPctVal,
        changePct: snap.changePct,
        ema10: e10,
        ema21: e21,
        ema50: e50,
        dayHigh,
        priorSwingHigh,
        aboveEma10: e10 != null ? price >= e10 : null,
        aboveEma21: e21 != null ? price >= e21 : null,
        setupName: null,
      });

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
          mf,
          mfTrend,
          stochK,
          rme: rmeDetail.rme,
          aboveEma10: e10 != null ? price >= e10 : null,
          aboveEma21: e21 != null ? price >= e21 : null,
          distToEma10: e10 && e10 > 0 ? ((price - e10) / e10) * 100 : null,
          distToEma21: e21 && e21 > 0 ? ((price - e21) / e21) * 100 : null,
          ema21Rising: e21 != null && e21Prev != null ? e21 > e21Prev : null,
          goldenCross: sma50 != null && sma200 != null ? sma50 > sma200 : null,
          pctOffHigh,
          rsVsSpy,
          stage: computeStage(closes, { price }),
          ema10: e10,
          ema21: e21,
          ema50: e50,
          dayHigh,
          dayLow: snap.dayLow ?? bars[bars.length - 1]?.l ?? null,
          priorSwingHigh,
          plan: serialisePlan(plan),
        },
      };
    });

    const wiimMap = await fetchBenzingaWiims(enriched.map(e => e.ab.sym));
    const STRONG_TAGS = new Set(['Earnings', 'FDA / Data', 'M&A', 'Guidance', 'Contract']);
    const NEGATIVE_TAGS = new Set(['Offering', 'Legal / Risk']);

    const candidates: Ep9mCandidate[] = enriched.map(({ ab, snap, raw }): Ep9mCandidate | null => {
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
        mf: raw.mf,
        catalystTier: tier,
        priorTriggers,
      });

      // Gate: exclude negative-change stocks — distribution, not accumulation.
      // See the NOTE ON THE CHANGE GATE in the header: this is a real filter
      // and it is why plan.collapsed can never fire on this table.
      if ((snap.changePct ?? 0) < 0) return null;

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
        mf: raw.mf,
        mfTrend: raw.mfTrend,
        stochK: raw.stochK,
        rme: raw.rme,
        aboveEma10: raw.aboveEma10,
        aboveEma21: raw.aboveEma21,
        distToEma21: raw.distToEma21 != null ? +raw.distToEma21.toFixed(2) : null,
        distToEma10: raw.distToEma10 != null ? +raw.distToEma10.toFixed(2) : null,
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
        ema10: round2(raw.ema10),
        ema21: round2(raw.ema21),
        ema50: round2(raw.ema50),
        dayHigh: round2(raw.dayHigh),
        dayLow: round2(raw.dayLow),
        priorSwingHigh: round2(raw.priorSwingHigh),
        plan: raw.plan,
      };
    }).filter((c): c is Ep9mCandidate => c !== null);

    candidates.sort((a, b) => b.score - a.score);
    const finalList = candidates.slice(0, EP9M.finalSize);

    // Update the registry — one entry per ticker per day, best score wins.
    const cutoff = dateStr(EP9M.registryDays);
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
      minRvol: EP9M.minRvol,
      minVolume: EP9M.minVolume,
      // Gate metadata for the on-screen key — the config this run enforced.
      scanMeta: EP9M_META,
    });
    await kv.set('ep9m_registry_v1', nextRegistry);

    // Plan diagnostics. If `planned` sits far below `count`, the stop basis
    // is failing — most likely ADR missing on short-history names.
    const planCoverage = {
      planned: finalList.filter(c => c.plan?.tradeable).length,
      clear: finalList.filter(c => c.plan?.tradeable && c.plan.clear).length,
      overextended: finalList.filter(c => c.plan?.overextended).length,
      noStopBasis: finalList.filter(c => c.plan?.note === 'no ADR/ATR to size a stop').length,
    };

    return NextResponse.json({
      success: true,
      lastScanTime: scanTime,
      raw9m: symbols.length,
      shortlisted: shortlist.length,
      count: finalList.length,
      registrySize: nextRegistry.length,
      catalystsFound: wiimMap.size,
      scanMeta: EP9M_META,
      planCoverage,
    });
  } catch (error: any) {
    console.error('EP9M_RUN_ERROR:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
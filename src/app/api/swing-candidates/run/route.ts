// src/app/api/swing-candidates/run/route.ts — v1.9
//
// v1.10: NEWS MOVED FROM BENZINGA WIIM TO POLYGON.
//
//   The Benzinga news endpoint returns an empty JSON array for a key without
//   the news product, and fetchBenzingaWiims swallowed errors, so a dead
//   credential was indistinguishable from a quiet news day. Both tables this
//   route feeds — Reversal/Swing and 10/21 Consolidation — showed no
//   catalyst on any row, and on a pullback scan that looked entirely
//   plausible.
//
//   THE BATCH SHAPE CHANGES. WIIM took many tickers per request, so one call
//   covered both final lists. Polygon's news endpoint is per-ticker, so this
//   is now a concurrent fan-out — but only across the FINAL lists, a few
//   dozen names, not the shortlist and certainly not the universe. Fetching
//   during per-ticker enrichment would have meant a news call for every name
//   that gets analysed and discarded.
//
//   DISPLAY ONLY. Neither analyze() nor analyzeConsolidation() takes a
//   catalyst term, so no score moves and no row appears or disappears. That
//   is deliberate on a pullback scan: the setup is the ABSENCE of a move, so
//   a headline published during the base is not evidence for the setup. It
//   is context you want before sizing — an upgrade mid-pullback is support,
//   a dilutive offering mid-pullback is why the pullback will not hold — and
//   the row cannot tell you which, which is exactly why it should not score.
//
// v1.9: rsVsSpy REPLACED by the market-wide RS RATING from /api/rs/run, on
//       BOTH analyzers.
//
//   THIS ONE IS NOT A COSMETIC SWAP, unlike the same change in the scanner
//   and ep9m routes where rsVsSpy was display-only. Here it did two jobs:
//
//       if (rsVsSpy == null || rsVsSpy <= 0) return null;   // hard gate
//       const rsScore = Math.min(rsVsSpy / 20, 1) * 35;     // 35 of 100 pts
//
//   so the unit change moves both WHICH names appear and WHAT they score.
//   The mapping below is chosen to preserve current behaviour rather than to
//   adopt Minervini's stricter floor, and that is deliberate — swapping the
//   measure and tightening the scan in one commit would make any change in
//   the candidate count impossible to attribute.
//
//   THE GATE: rsVsSpy > 0 means "beat SPY over the lookback, by any amount",
//   which is a WEAK gate — a stock outperforming by 0.3 points cleared it.
//   Its percentile equivalent is roughly the median, so RS >= 50. Minervini
//   gates at 70 and that is the more defensible number for a leadership
//   scan, but it is a materially stricter screen and belongs in its own
//   change once there is a week of data showing what it costs. Moving
//   RS_GATE below to 70 is the entire edit when that day comes.
//
//   THE SCORE: the old curve ran 0 at parity with SPY and saturated at +20
//   points of outperformance. The new one runs 0 at RS 50 and saturates at
//   RS 90 — the level at which Minervini calls a stock a genuine leader.
//   Same shape, same weights, expressed in ranks instead of spreads.
//
//   spyReturn is gone with it: pctReturn against SPY existed only to derive
//   rsVsSpy, and the rating arrives pre-ranked. That also removes a 450-day
//   SPY history fetch from every scan.
// v1.1: + RMV(15) on Swing and 10/21; + batched Benzinga WIIM catalysts
// v1.2: RMV imported from lib/indicators/rmv
// v1.3: Weinstein sub-stages via lib/indicators/stage
// v1.4: + Money Flow (21); + T2108 market breadth from the grouped series
// v1.5: thresholds moved to lib/scanConfig and shipped in the payload
// v1.6: maxDuration 60 -> 300; + ?bg=true background wrapper
// v1.7: write-guard symmetry — each table gates on its own results so an
//       empty run never destroys a good previous snapshot
// v1.8: + TRADE PLAN on both tables, matching scanner v6.15.
//
//       Both analyzers already computed ema10, ema21, ATR and ADR and threw
//       the EMA VALUES away, keeping only the percentage distances. Fine for
//       ranking, useless for planning: you cannot place a stop relative to
//       "3.2% below the 21 EMA". The raw levels are now retained and shipped.
//
//       TRIGGER DIFFERS BY TABLE, which is the whole point of passing
//       setupName rather than letting the planner guess:
//
//       SWING is a pullback into a rising trend. Price has already come back
//       to the 10/21 and the question is when it turns. Trigger is today's
//       high — the first level that says the pullback is over. Tagged
//       'EMA PB', which resolves to the first-touch family.
//
//       CONSOLIDATION is a coil. The actionable level is the top of the
//       10-day range, not today's high, because a tight base can print
//       several inside days before it resolves. Tagged 'Coil' and passed
//       rangeHigh explicitly.
//
//       NOTE ON BLUE DOTS: a consolidation row with blueDot true is still
//       tagged 'Coil', not 'Blue Dot Rev'. Tagging it as a reversal would
//       route it to the reversal family, which triggers off the 10 or 21
//       EMA — both of which sit BELOW price on a coil that is holding its
//       averages, producing a trigger already passed. The dot is a signal
//       about condition; the range high is still the entry.
//
// v1.9: + PER-TICKER CHOPPINESS INDEX (chop14) on BOTH tables — but it means
//       opposite things on each, and only one of them should ever filter on
//       it.
//
//           CHOP = 100 x log10( sum TR(n) / (maxHigh(n) - minLow(n)) ) / log10(n)
//
//       distance travelled over ground covered. Above 61.8 the name churns;
//       below 38.2 it trends.
//
//       ON SWING IT IS A GENUINE FILTER. A pullback into a trending name and
//       a pullback inside a range look identical on the EMAs — same distance
//       to the 10, same distance to the 21, same stochastic — and behave
//       nothing alike. The first resumes; the second reverses at the range
//       edge it has already reversed at four times. Nothing else on that
//       table separates them.
//
//       ON CONSOLIDATION IT IS EXPECTED TO BE HIGH AND MUST NOT FILTER.
//       A coil IS churn by construction. Fourteen days of oscillation inside
//       a range roughly twice the daily range gives sum(TR)/range around 7,
//       which scores near 74 — solidly "choppy". That is not a warning about
//       the row, it is a restatement of why the row qualified. Filtering the
//       consolidation table on chop would reject every good base on the
//       board, and coilRatio already measures tightness directly and better
//       (it normalises the 10-day range by ATR rather than inferring it).
//
//       So chop is emitted on both — it costs nothing, dailyBars is already
//       in hand — and Consolidation1021 gets no CHOP filter. The asymmetry
//       is the point, and consolidationChopNote in the response says so on
//       the wire rather than only in this comment.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { computeRMV } from '@/lib/indicators/rmv';
import { computeStage } from '@/lib/indicators/stage';
import { computeMoneyFlow, moneyFlowTrend } from '@/lib/indicators/moneyflow';
import { computeTradePlan } from '@/lib/indicators/tradeplan';
import { choppiness, CHOP_PERIOD_DEFAULT, CHOP_CHOP_MIN, CHOP_TREND_MAX } from '@/lib/indicators/chop';
import { SWING, CONSOL, SWING_META, CONSOL_META } from '@/lib/scanConfig';
import { loadRsRatings, type RsLookup } from '@/lib/indicators/rs';
import { cleanSectorDescription } from '@/lib/sectors';
import { sma, ema, atr, adrPct, stochK } from '@/lib/indicators/marketMath';
import { pickBestNews, polygonNewsPath, fetchBenzingaNewsIndex, type NewsItem } from '@/lib/indicators/news';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 300;

const POLYGON_KEY = process.env.POLYGON_API_KEY || '';
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

// Prior swing high window. 63 sessions back, EXCLUDING the most recent five —
// without that exclusion a name that just ran becomes its own resistance and
// every fresh mover reports a trigger already blocked.
// ADR level at which a name is "wide" for the chop-trap read. Reporting only
// on these tables — neither scan has an ADR floor that this would reinforce.
const CHOP_TRAP_MIN_ADR = 5;

/* Fan-out width for the news pass. Higher than the enrichment concurrency
   because these are single small responses with no downstream computation —
   the limit is politeness rather than memory or CPU. */
const NEWS_CONCURRENCY = 10;

/* ---- RS Rating mapping (v1.9) -------------------------------------------
   Both analyzers gate and score on the rating, so the numbers live in one
   place — two copies drifting apart would let the swing and consolidation
   tables disagree about what counts as strong.

   RS_GATE 50 preserves the strictness of the old `rsVsSpy > 0` test, which
   was satisfied by beating SPY by any margin at all. Raising it to 70 adopts
   Minervini's floor and makes this a leadership scan rather than a pullback
   scan; that is a real change in what the table is for, and it is one edit
   here when you want it.

   RS_SATURATE 90 is where the score stops improving — the old curve topped
   out at 20 points of outperformance, and 90 is the percentile at which
   Minervini stops calling a stock strong and starts calling it a leader. */
const RS_GATE = 50;
const RS_SATURATE = 90;

/* 0 at the gate, 1 at saturation, clamped. Multiplied by each analyzer's own
   RS weight — 35 on swing, 30 on consolidation — so the relative importance
   of relative strength inside each score is unchanged from v1.8. */
const rsFraction = (rs: number): number =>
  Math.max(0, Math.min((rs - RS_GATE) / (RS_SATURATE - RS_GATE), 1));

const SWING_HIGH_LOOKBACK = 63;
const SWING_HIGH_EXCLUDE_RECENT = 5;

interface Bar { t: number; o: number; h: number; l: number; c: number; v: number; }

interface SnapInfo {
  vwap: number | null;
  livePrice: number | null;
  changePct: number;
  vol: number;
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
  // v1.9 — regime. Read the header before using this on Consolidation: a coil
  // scores high by construction and the value is descriptive there, not a
  // warning.
  chop14?: number | null;
  chopTrap?: boolean;
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
  rsRating: number;
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
  newsPublisher?: string | null;
  newsAge?: string | null;
  newsSentiment?: 'positive' | 'negative' | 'neutral' | null;
  // v1.8 — raw levels and the plan built from them.
  setupName?: string | null;
  ema10?: number | null;
  ema21?: number | null;
  ema50?: number | null;
  dayHigh?: number | null;
  dayLow?: number | null;
  priorSwingHigh?: number | null;
  plan?: TradePlanOut | null;
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

const round2 = (v: number | null | undefined): number | null =>
  v == null || !Number.isFinite(v) ? null : parseFloat(v.toFixed(2));

// Serialises the planner output for the wire. Every numeric goes through
// round2 so a NaN sneaking out of a degenerate bar series cannot reach the
// component, where it would render as "NaN" in a price field.
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
function priorSwingHighOf(bars: Bar[]): number | null {
  if (bars.length < 20) return null;
  const end = bars.length - SWING_HIGH_EXCLUDE_RECENT;
  const start = Math.max(0, bars.length - SWING_HIGH_LOOKBACK);
  if (end <= start) return null;
  const win = bars.slice(start, end);
  if (win.length === 0) return null;
  return Math.max(...win.map(b => b.h));
}





// Average Daily Range % — the Minervini definition: SMA(High/Low) - 1.
// Distinct from ATR: no gap component, so it measures how much intraday
// room the stock actually gives you on a typical session. This is also the
// stop basis in the trade plan, for exactly that reason.


/* Currently unused — its only caller was the SPY benchmark return behind
   rsVsSpy, which v1.9 replaced with the shared RS Rating. Kept because it is
   a correct generic helper and the next thing needing a trailing return
   should not have to rewrite it. */

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

// Matches scanner v6.8. At pageSize=100 a 50-ticker batch truncates — the
// first few tickers consume the item budget and the rest come back empty.

/* fetchBenzingaWiims and classifyWiim used to live here. Their rejection
   cases — law-firm solicitations, over-broad baskets, stale items — are all
   covered inside @/lib/indicators/news, and keeping a local copy as a second
   opinion is how two classifiers drift apart on the same headline.

   BENZINGA_KEY survives only for fetchEarningsCalendar above, which powers
   the earnings blackout. That endpoint is on the same credential and is
   probably also dead — worth a direct check, since a blackout that never
   fires means earnings-week names are reaching both tables unflagged. */

function analyze(
  symbol: string,
  bars: Bar[],
  rsLookup: RsLookup,
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
  const ema50 = ema(closes, 50);
  const ema21Prev = ema(closes.slice(0, -3), 21);
  const atr14 = atr(bars, 14);
  const kVal = stochK(bars, 10, 4);

  if (!sma50 || !sma200 || !ema10 || !ema21 || !atr14 || kVal == null) return null;

  const atrPctVal = (atr14 / price) * 100;
  const adr = adrPct(bars, 20);

  /* --- CHOP (v1.9) ------------------------------------------------------
     NO REVERSE NEEDED. getDailyBars fetches with sort=asc, so bars are
     already oldest-first, which is what choppiness() expects. The scanner
     route sorts descending and has to reverse a slice; this one does not.
     Silent either way — a wrongly ordered array returns a plausible number
     computed from the wrong end of the series — so the confirmation is that
     every other helper here treats bars[bars.length - 1] as today.

     THIS IS THE FILTER THAT MATTERS ON THE SWING TABLE. A pullback into a
     trending name and a pullback inside a range are indistinguishable on the
     EMAs and behave nothing alike. Nothing else computed here separates
     them. */
  const chop14 = choppiness(bars, CHOP_PERIOD_DEFAULT);

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

  /* A lookup, not a calculation. Null means the name is unrated — below the
     ranking floor, or listed less than a quarter ago — and an unrated name
     fails the gate below rather than passing on a missing value. */
  const rsRating = rsLookup.get(symbol);

  if (avgDollarVol < SWING.minAvgDollarVol) return null;
  if (price < sma50) return null;
  if (price < sma200) return null;
  if (atrPctVal < SWING.minAtrPct || atrPctVal > SWING.maxAtrPct) return null;
  if (pctOffHigh < SWING.minPctOffHigh || pctOffHigh > SWING.maxPctOffHigh) return null;
  if (Math.abs(distToEma21) > SWING.maxDistToEma21) return null;
  if (kVal > SWING.maxStochK) return null;
  if (rsRating == null || rsRating < RS_GATE) return null;

  const rsScore = rsFraction(rsRating) * 35;
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

  // --- TRADE PLAN (v1.8) ---------------------------------------------------
  // Tagged 'EMA PB', which resolves to the first-touch family and triggers
  // off today's high. This is a pullback into a rising trend: price has
  // already come back to the 10/21 and the entry is the level that says the
  // pullback is finished, not a moving average it is already sitting on.
  const lastBar = bars[bars.length - 1];
  const setupName = 'EMA PB';
  const plan = computeTradePlan({
    price,
    adrPct: adr,
    atrPct: atrPctVal,
    changePct,
    ema10,
    ema21,
    ema50,
    dayHigh: lastBar?.h ?? null,
    priorSwingHigh: priorSwingHighOf(bars),
    aboveEma10: price >= ema10,
    aboveEma21: price >= ema21,
    setupName,
  });

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
    chop14: chop14 != null ? +chop14.toFixed(1) : null,
    chopTrap: chop14 != null && adr != null && adr >= CHOP_TRAP_MIN_ADR && chop14 >= CHOP_CHOP_MIN,
    rmv,
    mf,
    mfTrend,
    pctOffHigh: +pctOffHigh.toFixed(1),
    distToEma21: +distToEma21.toFixed(2),
    distToEma10: +distToEma10.toFixed(2),
    aboveEma10: price >= ema10,
    aboveEma21: price >= ema21,
    stochK: +kVal.toFixed(1),
    rsRating,
    avgDollarVolM: Math.round(avgDollarVol / 1e6),
    goldenCross: sma50 > sma200,
    ema21Rising,
    setupName,
    ema10: round2(ema10),
    ema21: round2(ema21),
    ema50: round2(ema50),
    dayHigh: round2(lastBar?.h ?? null),
    dayLow: round2(lastBar?.l ?? null),
    priorSwingHigh: round2(priorSwingHighOf(bars)),
    plan: serialisePlan(plan),
  };
}

function analyzeConsolidation(
  symbol: string,
  bars: Bar[],
  rsLookup: RsLookup,
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
  const ema50 = ema(closes, 50);
  const ema21Prev = ema(closes.slice(0, -3), 21);
  const atr14 = atr(bars, 14);
  const kVal = stochK(bars, 10, 4);

  if (!sma50 || !sma200 || !ema10 || !ema21 || !atr14 || kVal == null) return null;

  const atrPctVal = (atr14 / price) * 100;
  const adr = adrPct(bars, 20);

  /* Descriptive only — see the note on the return field below and the v1.9
     header. Computed because it costs nothing and the number is genuinely
     interesting for comparing one base against another (a coil at 66 is
     resolving faster than one at 80), but it is never a gate here and
     Consolidation1021 renders no CHOP filter. */
  const consChop = choppiness(bars, CHOP_PERIOD_DEFAULT);
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

  /* A lookup, not a calculation. Null means the name is unrated — below the
     ranking floor, or listed less than a quarter ago — and an unrated name
     fails the gate below rather than passing on a missing value. */
  const rsRating = rsLookup.get(symbol);

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
  if (rsRating == null || rsRating < RS_GATE) return null;

  const tightScore = Math.max(0, Math.min(1,
    (CONSOL.maxCoilRatio - coilRatio) / (CONSOL.maxCoilRatio - 2.0)
  )) * 30;
  const proxScore =
    (1 - Math.abs(distToEma10) / CONSOL.maxDistToEma10) * 15 +
    Math.max(0, 1 - Math.abs(distToEma21) / CONSOL.maxAboveEma21) * 10;
  const rsScore = rsFraction(rsRating) * 30;
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

  // --- TRADE PLAN (v1.8) ---------------------------------------------------
  // Tagged 'Coil' and passed the 10-day range high, which is the level this
  // base actually resolves through. Today's high would be an earlier and
  // looser entry — a tight coil prints several inside days before it breaks,
  // and buying each one is how you get chopped inside the base.
  //
  // Deliberately NOT tagged 'Blue Dot Rev' when blueDot fires. That would
  // route to the reversal family, which triggers off the 10 or 21 EMA — both
  // sitting below price on a coil that is holding its averages — and the
  // planner would report the entry as already passed. The dot describes the
  // condition; the range high is still where the trade begins.
  const lastBar = bars[bars.length - 1];
  const setupName = 'Coil';
  const plan = computeTradePlan({
    price,
    adrPct: adr,
    atrPct: atrPctVal,
    changePct,
    ema10,
    ema21,
    ema50,
    dayHigh: lastBar?.h ?? null,
    rangeHigh: hi10,
    priorSwingHigh: priorSwingHighOf(bars),
    aboveEma10: price >= ema10,
    aboveEma21: price >= ema21,
    setupName,
  });

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
    /* Emitted, never filtered. A coil scores high here BY CONSTRUCTION —
       fourteen days of oscillation inside a tight range is exactly what the
       Choppiness Index is built to detect, and it is also exactly what
       qualified this row. Read it as a description of the base, not a
       verdict on it; coilRatio is the tightness measure that discriminates. */
    chop14: consChop != null ? +consChop.toFixed(1) : null,
    rmv,
    mf,
    mfTrend,
    pctOffHigh: +pctOffHigh.toFixed(1),
    distToEma21: +distToEma21.toFixed(2),
    distToEma10: +distToEma10.toFixed(2),
    aboveEma10: price >= ema10,
    aboveEma21: price >= ema21,
    stochK: +kVal.toFixed(1),
    rsRating,
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
    setupName,
    ema10: round2(ema10),
    ema21: round2(ema21),
    ema50: round2(ema50),
    dayHigh: round2(lastBar?.h ?? null),
    dayLow: round2(lastBar?.l ?? null),
    priorSwingHigh: round2(priorSwingHighOf(bars)),
    plan: serialisePlan(plan),
  };
}

// ---------------------------------------------------------------------------
// SCAN BODY
// ---------------------------------------------------------------------------
async function runSwingScan() {
  try {
    if (!POLYGON_KEY) {
      return NextResponse.json({ success: false, error: 'Missing Polygon API Key' }, { status: 500 });
    }

    const startedAt = Date.now();

    /* One lookup for the whole scan, replacing the SPY benchmark return.

       THIS ALSO REMOVED A POLYGON CALL. rsVsSpy needed a full SPY history
       fetch on every scan just to compute one benchmark number; the rating
       arrives pre-ranked, so the fetch is gone entirely.

       Loading it here rather than inside the analyzers matters: those run
       once per shortlisted name across concurrent batches, and a KV read per
       ticker would be hundreds of requests for a map that cannot change
       mid-scan. The analyzers take it as a parameter. */
    const rsLookup: RsLookup = await loadRsRatings();

    const [{ symbols: universe, snapMap, snapMapAll }, earningsBlackout] = await Promise.all([getUniverse(), getEarningsBlackout()]);
    const toScan = universe.filter(sym => !earningsBlackout.has(sym));

    const groupedSeries = await getGroupedSeries(new Set(snapMapAll.keys()));

    // T2108 — market-wide breadth from the same grouped data. Persisted
    // independently so the Scorecard can read it without touching the
    // swing payload. Guarded: a null value means the sample was too thin to
    // mean anything, so keep the previous reading rather than blanking it.
    const t2108 = computeT2108(groupedSeries);
    if (t2108.value != null) {
      try {
        await kv.set('t2108_v1', {
          ...t2108,
          updatedAt: new Date().toISOString(),
        });
      } catch (e) { console.error('t2108 persist failed', e); }
    } else {
      console.warn(`T2108 sample too thin (${t2108.total} names); preserving previous reading.`);
    }

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
      const swing = analyze(sym, bars, rsLookup, details, shortData, snapMap.get(sym));
      const consol = analyzeConsolidation(sym, bars, rsLookup, details, shortData, snapMap.get(sym));
      if (!swing && !consol) return null;
      return { swing, consol };
    });

    const extraConsols = await inBatches(consolExtra, 10, async (sym) => {
      const [bars, details, shortData] = await Promise.all([
        getDailyBars(sym),
        polygonSafe<any>(`/v3/reference/tickers/${sym}`, {}),
        polygonSafe<any>(`/stocks/v1/short-interest?ticker=${sym}`, { results: [] }),
      ]);
      return analyzeConsolidation(sym, bars, rsLookup, details, shortData, snapMapAll.get(sym));
    });

    const candidates = results.map(r => r.swing).filter((c): c is Candidate => !!c);
    const consols = [
      ...results.map(r => r.consol).filter((c): c is Candidate => !!c),
      ...extraConsols,
    ];

    candidates.sort((a, b) => b.score - a.score);
    consols.sort((a, b) => b.score - a.score);

    /* --- Catalysts: Polygon news across both final lists ------------------

       ONLY THE FINAL LISTS. Polygon's news endpoint is per-ticker, so this
       is a fan-out where WIIM was a batch — and the cost is bounded by
       running it here rather than during enrichment. Enrichment analyses the
       whole shortlist and discards most of it; a news call there would be
       spent on names that never reach a table.

       The symbol set is deduped because a name can qualify as both a swing
       pullback and a coil, and fetching its news twice would be two
       identical requests and two chances to disagree. */
    const consolKeep = consols.slice(0, CONSOL.finalSize);
    const newsSymbols = Array.from(new Set([
      ...candidates.map(c => c.symbol),
      ...consolKeep.map(c => c.symbol),
    ]));

    /* Benzinga leads, Polygon backs it up — Polygon's per-ticker feed is Motley
       Fool wall-to-wall on this plan and pickBestNews blocks that publisher,
       which is why this map came back empty for every symbol. The Benzinga side
       is one fetch for the whole scan because this plan's endpoint ignores
       per-ticker params entirely; the index does the filtering. */
    const bzIndex = await fetchBenzingaNewsIndex(POLYGON_KEY);

    const newsMap = new Map<string, NewsItem | null>();
    await inBatches(newsSymbols, NEWS_CONCURRENCY, async (sym) => {
      const res = await polygonSafe<any>(polygonNewsPath(sym, 20), { results: [] });
      newsMap.set(sym, pickBestNews([...(bzIndex.get(sym) ?? []), ...(res?.results ?? [])], sym));
      return sym;
    });

    /* Age at which the chip gains "(Delayed)". Thirty-six hours is a long
       time on a momentum table and almost nothing on a base that has been
       building for weeks — but the label describes the READER's expectation
       of freshness, not the pattern's timescale, so it stays consistent with
       every other table. */
    const DELAYED_AGE_HOURS = 36;

    const attachCatalyst = (c: Candidate) => {
      const n = newsMap.get(c.symbol) ?? null;
      if (!n) {
        c.catalyst = null;
        c.thesis = null;
        c.catalystUrl = null;
        c.newsPublisher = null;
        c.newsAge = null;
        c.newsSentiment = null;
        (c as any).newsCausal = null;
        return;
      }
      c.catalyst = n.ageHours >= DELAYED_AGE_HOURS ? `${n.tag} (Delayed)` : n.tag;
      c.thesis = n.title;
      c.catalystUrl = n.url;
      c.newsPublisher = n.publisher;
      c.newsAge = n.ageLabel;
      c.newsSentiment = n.sentiment;
      (c as any).newsCausal = n.causal;
    };
    candidates.forEach(attachCatalyst);
    consolKeep.forEach(attachCatalyst);

    const scanTime = Date.now();

    // --- WRITE GUARDS (v1.7) -------------------------------------------------
    // Each table is gated on ITS OWN results. Previously the swing keys used
    // `universe.length > 0 && candidates.length > 0` while consolidation used
    // only `universe.length > 0`, so a run with zero coils would preserve
    // stale swing data and simultaneously wipe a perfectly good consolidation
    // list. Symmetric now: an empty result never destroys a good snapshot.
    //
    // A truly empty market IS possible on both tables — the swing scan
    // returned 2 of 120 names on 2026-07-29 — so preserving beats blanking.
    const universeOk = universe.length > 0;
    const swingPersisted = universeOk && candidates.length > 0;
    const consolPersisted = universeOk && consolKeep.length > 0;

    if (swingPersisted) {
      await kv.set('swing_candidates_v1', candidates);
      await kv.set('swing_meta_v1', {
        /* spyReturn3M is gone — it existed only to derive rsVsSpy. What
           replaces it is the RS map's own provenance, which is what you
           actually need when a column of ratings looks wrong: whether the
           map loaded, how old it is, and how many names were ranked. */
        rsAvailable: rsLookup.available,
        rsAsOf: rsLookup.asOf,
        rsAgeDays: rsLookup.ageDays,
        rsRankedUniverse: rsLookup.ranked,
        rsReason: rsLookup.reason,
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

    if (consolPersisted) {
      await kv.set('consol_1021_v1', consolKeep);
      await kv.set('consol_1021_meta_v1', {
        count: consols.length,
        scanMeta: CONSOL_META,
      });
      await kv.set('consol_1021_last_scan_v1', scanTime);
    } else {
      console.warn('Consolidation scan produced no candidates; preserving previous KV snapshot.');
    }

    // Plan diagnostics. If `planned` sits far below the row count, the stop
    // basis is failing — most likely ADR missing on short-history names.
    const planStats = (list: Candidate[]) => ({
      planned: list.filter(c => c.plan?.tradeable).length,
      clear: list.filter(c => c.plan?.tradeable && c.plan.clear).length,
      overextended: list.filter(c => c.plan?.overextended).length,
      triggerPassed: list.filter(c => c.plan?.note === 'trigger already passed').length,
    });

    return NextResponse.json({
      success: true,
      lastScanTime: scanTime,
      elapsedMs: scanTime - startedAt,
      count: candidates.length,
      consolCount: consols.length,
      consolShortlisted: consolShortlist.length,
      universeSize: universe.length,
      excludedForEarnings: universe.length - toScan.length,
      /* Renamed from catalystsFound, which counted WIIM matches and had been
         reporting zero for weeks without being read as a fault. Split by
         table because the two mean different things: a swing pullback with
         news is a name to read before sizing, while a coil with news is
         rarer and more interesting — most bases form in silence. */
      newsFound: {
        swing: candidates.filter(c => c.thesis != null).length,
        consolidation: consolKeep.filter(c => c.thesis != null).length,
      },
      t2108: t2108.value,
      t2108Zone: t2108.zone,
      t2108Sample: t2108.total,
      scanMeta: { swing: SWING_META, consol: CONSOL_META },
      planCoverage: {
        swing: planStats(candidates),
        consolidation: planStats(consolKeep),
      },
      /* v1.9 CHOP DISTRIBUTION. Reported unwired so a future gate on the
         SWING table can be sized before it is applied.

         READ THE TWO BLOCKS DIFFERENTLY. On swing, `choppy` counts pullbacks
         that will resolve back into a range rather than a trend — the number
         a gate would remove, and the one worth watching. On consolidation the
         same field is expected to be high, because a coil is churn by
         construction; a LOW count there would be the surprising result and
         would suggest the coil gate is admitting names that are not actually
         basing. */
      chopStats: {
        swing: {
          scored: candidates.filter(c => c.chop14 != null).length,
          trending: candidates.filter(c => c.chop14 != null && c.chop14 <= CHOP_TREND_MAX).length,
          choppy: candidates.filter(c => c.chop14 != null && c.chop14 >= CHOP_CHOP_MIN).length,
          trap: candidates.filter(c => c.chopTrap === true).length,
        },
        consolidation: {
          scored: consolKeep.filter(c => c.chop14 != null).length,
          // Expected to be most of the list. See the note above.
          choppy: consolKeep.filter(c => c.chop14 != null && c.chop14 >= CHOP_CHOP_MIN).length,
          trending: consolKeep.filter(c => c.chop14 != null && c.chop14 <= CHOP_TREND_MAX).length,
        },
      },
      consolidationChopNote:
        'chop14 is descriptive on the consolidation table, not a quality signal — a coil scores high by construction. Filter on coilRatio (STAT) instead.',
      // Per-table write outcome. `false` means the previous snapshot was kept
      // because this run found nothing — not that the run failed.
      dataPersisted: {
        swing: swingPersisted,
        consolidation: consolPersisted,
        t2108: t2108.value != null,
      },
    });
  } catch (error: any) {
    console.error("SWING_RUN_ERROR:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// BACKGROUND WRAPPER
// ---------------------------------------------------------------------------
// Mirrors scanner v6.7. A plain GET is unchanged — it runs the scan and
// returns the full payload, so the dashboard and manual browser runs behave
// exactly as before.
//
// ?bg=true replies in ~50ms and lets the scan continue via Next's after(),
// so cron-job.org's 30s ceiling never fires.
//
//   cron-job.org URL:  /api/swing-candidates/run?bg=true
//   browser / manual:  /api/swing-candidates/run

const bgHeaders = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
};

// Keeps the function alive after the response is sent. Uses Next's after(),
// which needs no extra package. Returns false if this Next version lacks it.
async function scheduleAfterResponse(work: () => Promise<any>): Promise<boolean> {
  try {
    const nx: any = await import('next/server');
    const after = nx.after || nx.unstable_after;
    if (typeof after === 'function') {
      after(() => work());
      return true;
    }
  } catch {
    // fall through
  }
  return false;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const background = searchParams.get('bg') === 'true';

  if (!background) return runSwingScan();

  const work = async () => {
    const started = Date.now();
    try {
      const res = await runSwingScan();
      console.log(`[swing] background run finished ${res.status} in ${Date.now() - started}ms`);
    } catch (err: any) {
      console.error(`[swing] background run failed after ${Date.now() - started}ms:`, err?.message || err);
    }
  };

  const scheduled = await scheduleAfterResponse(work);

  if (!scheduled) {
    // after() unavailable on this runtime — replying now would freeze the
    // function and kill the scan, so run it inline instead.
    await work();
    return NextResponse.json(
      { success: true, mode: 'inline-fallback', startedAt: new Date().toISOString() },
      { headers: bgHeaders }
    );
  }

  return NextResponse.json(
    { success: true, mode: 'background', startedAt: new Date().toISOString() },
    { headers: bgHeaders }
  );
}

export async function POST(request: Request) {
  return GET(request);
}
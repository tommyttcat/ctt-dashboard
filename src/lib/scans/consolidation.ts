// lib/scans/consolidation.ts — the 10/21 Consolidation scan, in one place.
//
// analyzeConsolidation and the helpers both analysers share (RS fraction,
// prior swing high, the plan serialiser, the row shape) move here verbatim
// from app/api/swing-candidates/run, so the historical backtest replays the
// rules production runs rather than a copy of them. The swing analyser in
// that route imports the same helpers back — still one definition of each.
//
// Pure: no fetch, no KV, no clock. Moved 11 Sep 2026; no behaviour change.

import { computeRMV } from '@/lib/indicators/rmv';
import { computeStage } from '@/lib/indicators/stage';
import { computeMoneyFlow, moneyFlowTrend } from '@/lib/indicators/moneyflow';
import { computeTradePlan } from '@/lib/indicators/tradeplan';
import { choppiness, CHOP_PERIOD_DEFAULT } from '@/lib/indicators/chop';
import { CONSOL, SWING } from '@/lib/scanConfig';
import { type RsLookup } from '@/lib/indicators/rs';
import { cleanSectorDescription } from '@/lib/sectors';
import { sma, ema, atr, adrPct, stochK } from '@/lib/indicators/marketMath';

export const RS_GATE = 50;
export const RS_SATURATE = 90;

/* 0 at the gate, 1 at saturation, clamped. Multiplied by each analyzer's own
   RS weight — 35 on swing, 30 on consolidation — so the relative importance
   of relative strength inside each score is unchanged from v1.8. */
export const rsFraction = (rs: number): number =>
  Math.max(0, Math.min((rs - RS_GATE) / (RS_SATURATE - RS_GATE), 1));

export const SWING_HIGH_LOOKBACK = 63;
export const SWING_HIGH_EXCLUDE_RECENT = 5;

export interface Bar { t: number; o: number; h: number; l: number; c: number; v: number; }

export interface SnapInfo {
  vwap: number | null;
  livePrice: number | null;
  changePct: number;
  vol: number;
}

export interface TradePlanOut {
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

export interface Candidate {
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

export const round2 = (v: number | null | undefined): number | null =>
  v == null || !Number.isFinite(v) ? null : parseFloat(v.toFixed(2));

// Serialises the planner output for the wire. Every numeric goes through
// round2 so a NaN sneaking out of a degenerate bar series cannot reach the
// component, where it would render as "NaN" in a price field.
export function serialisePlan(p: ReturnType<typeof computeTradePlan>): TradePlanOut {
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
export function priorSwingHighOf(bars: Bar[]): number | null {
  if (bars.length < 20) return null;
  const end = bars.length - SWING_HIGH_EXCLUDE_RECENT;
  const start = Math.max(0, bars.length - SWING_HIGH_LOOKBACK);
  if (end <= start) return null;
  const win = bars.slice(start, end);
  if (win.length === 0) return null;
  return Math.max(...win.map(b => b.h));
}


export function analyzeConsolidation(
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

/* The market-wide prefilter: 45 sessions of grouped bars narrow the whole
   market to the tightest GROUPED.shortlistSize names before any per-ticker
   history is fetched. Moved verbatim with the analyser it feeds. */
export const GROUPED = {
  days: 45,
  maxCalendarDays: 70,
  shortlistSize: 80,
};

export interface LiteBar { c: number; h: number; l: number; v: number; }

export function shortlistConsolidation(series: Map<string, LiteBar[]>): string[] {
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

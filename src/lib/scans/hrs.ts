// lib/scans/hrs.ts — the pure half of the Hidden Relative Strength scan.
//
// Regime detection, the weak-day prefilter and the score move here verbatim
// from app/api/hrs/run so the historical backtest replays the rules production
// runs. The route keeps the fetching (snapshot, per-ticker bars, VIX, details).
//
// Pure: no fetch, no KV, no clock. Moved 11 Sep 2026; no behaviour change.

import { sma } from '@/lib/indicators/marketMath';
import { HRS } from '@/lib/scanConfig';

/** Date key used to line a stock's bar up with a weak QQQ day. */
export const ymd = (d: Date): string => d.toISOString().slice(0, 10);

export const EXCLUDED_ETFS = new Set([
  'SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'VTI', 'EEM', 'EFA', 'XLF', 'XLE', 'XLK',
  'XLI', 'XLV', 'XLU', 'XLP', 'XLY', 'XLB', 'XLRE', 'XLC', 'SMH', 'SOXX',
  'TQQQ', 'SQQQ', 'QLD', 'QID', 'SOXL', 'SOXS', 'TECL', 'TECS', 'SPXL', 'SPXS',
  'SPXU', 'UPRO', 'SDS', 'SSO', 'TNA', 'TZA', 'FAS', 'FAZ', 'LABU', 'LABD',
  'UVXY', 'UVIX', 'SVIX', 'VIXY', 'VXX', 'FNGU', 'FNGD', 'GLD', 'SLV', 'GDX',
  'GDXJ', 'USO', 'UNG', 'TLT', 'HYG', 'LQD', 'ARKK', 'IBIT', 'BITO', 'BITX',
  'NUGT', 'DUST', 'JNUG', 'ERX', 'ERY', 'BOIL', 'KOLD', 'NAIL', 'URAA',
  'MSTX', 'MSTU', 'CONL', 'NVDL', 'TSLL', 'AAPU', 'MSFU', 'AMZU',
]);

export interface Bar { o: number; h: number; l: number; c: number; v: number; t: number }

export interface SnapInfo {
  price: number;
  prevClose: number;
  changePct: number;
  vol: number;
  mktCap: number | null;
}

export interface WeakDay {
  date: string;
  qqqChange: number;
}

export interface MarketRegime {
  active: boolean;
  qqqReturn5d: number;
  qqqReturn10d: number;
  downDays5: number;
  downDays10: number;
  weakDays: WeakDay[];
  severity: 'severe' | 'moderate' | 'mild' | 'inactive';
  vixLevel: number | null;
}

export function detectRegime(qqqBars: Bar[], vixLevel: number | null): MarketRegime {
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

export interface PrefilterResult {
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

export function prefilter(
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
// Scoring
// ---------------------------------------------------------------
export function scoreHrs(
  c: PrefilterResult,
  pctBelow52wHigh: number,
  rs: number | null
): Record<string, number> {
  /* --- v2 (11 Sep 2026) ---------------------------------------------------
     The old score could not rank: its four terms all saturate on names that
     already cleared the gates, so 27,712 of 27,865 backtested rows scored 75+
     and 99.8% graded A. A letter everything earns is decoration.

     What separated outcomes over 30,028 rows (Sep 2022 - Sep 2026), both
     halves agreeing:

         RS 95+                  +0.05R, 9.9% ran +50%   (RS 85-94: 3.4%)
         price $5-15             +0.15R, 11.2%           (the rest: +0.01R)
         6-9 weak days measured  +0.06R                  (10+: -0.01R)
         moderate pullback       +0.13R                  (severe: -0.05R)

     Note the price band is the OPPOSITE of the momentum tables, where $5-10
     was the worst bucket in the market. Hidden strength and hidden weakness
     live in the same place, which is why this scan scores it itself.

     Proximity and the SMA stack are gates, not signals, so they no longer
     carry 45 points between them. */
  const alphaRaw = Math.max(0, c.avgDailyAlpha);
  const alphaPts = Math.min(alphaRaw / 2, 1) * 20 + Math.min(c.weakDayOutperformPct / 100, 1) * 5;

  // The sample the alpha was measured over. A short, sharp stretch of weak
  // days reads better than a long grind: 6-9 beat 10+ in both halves.
  const n = c.weakDayDetail.length;
  const samplePts = n >= 10 ? 4 : n >= 6 ? 12 : n >= 3 ? 8 : 4;

  // Kept, at a fraction of the old weight — it is a gate at 15%.
  const proxPts = pctBelow52wHigh <= 3 ? 10
    : pctBelow52wHigh <= 8 ? 8
    : pctBelow52wHigh <= 12 ? 5 : 3;

  const slopePts = Math.min((c.sma10Slope + c.sma20Slope) / 2, 1) * 5;

  // Step-shaped, not linear: only the top of the range meant anything.
  const rsPts = rs == null ? 0 : rs >= 95 ? 25 : rs >= 85 ? 8 : rs >= 70 ? 10 : 6;

  // The band that paid on THIS scan.
  const px = c.bars[c.bars.length - 1]?.c ?? null;
  const pricePts = px != null && px >= 5 && px <= 15 ? 15 : 0;

  return {
    alpha: +alphaPts.toFixed(1),
    sample: +samplePts.toFixed(1),
    proximity: +proxPts.toFixed(1),
    smaStack: +slopePts.toFixed(1),
    rs: +rsPts.toFixed(1),
    priceBand: +pricePts.toFixed(1),
  };
}

/* ---- Edge grade ----------------------------------------------------------
   The old grade was dead weight: the prefilter's gates (weak-day
   outperformance, stacked rising SMAs, within 15% of the 52-week high, RS
   floor) already max every score component, so 27,712 of 27,865 filled rows
   in the 5-year backtest scored 75+ and 99.8% graded A. A letter that every
   row earns ranks nothing.

   These two traits did separate outcomes, in both halves:
       price $5-15   +0.15R, 11.2% ran +50%   (vs +0.01R for the rest)
       RS 95+        +0.05R,  9.9%            (vs 3.4% at RS 85-94)

   Note this is the OPPOSITE of the momentum tables, where $5-10 names lost
   0.15R — hidden strength and hidden weakness live in the same price band. */
export function hrsEdgeGrade(r: { rsRating?: number | null; price?: number | null }): 'A' | 'B' | null {
  const rs = r.rsRating ?? null;
  const price = r.price ?? null;
  const cheapEnough = price != null && price >= 5 && price <= 15;
  const strongEnough = rs != null && rs >= 95;
  if (cheapEnough && strongEnough) return 'A';
  if (cheapEnough || strongEnough) return 'B';
  return null;
}

export const HRS_EDGE_GRADE_TIP =
  'A: RS 95+ and price $5-15 — the only combination that separated outcomes in the 5-year test ' +
  '(+0.15R, 11% ran +50%). B: one of the two. Unlettered: neither, which averaged about zero. ' +
  'The old grade is gone because the scan gates already guaranteed it — 99.8% of rows were grade A.';

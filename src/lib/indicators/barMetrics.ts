/* Per-name metrics derived from daily bars — stochastic, the 10/21/50 EMAs,
 * the golden cross, distance off the 52-week high, and ATR%.
 *
 * WHY THIS EXISTS. `scanner/run` computed all of these inline, and the Dollar
 * Volume scan needs the same numbers for its 10/21, STOCH and CNF columns. A
 * second inline copy is how `parseSectorItems` ended up in three files with
 * two different behaviours — so the math lives here instead, once.
 *
 * The formulas are scanner/run's, verbatim, including the choices that look
 * arbitrary: %K is the mean of four raw 10-bar readings rather than an SMA of
 * %K, the EMA seed is a close up to 100 bars back rather than an SMA, and the
 * golden cross is 50/200 SIMPLE averages while everything else is exponential.
 * They are reproduced rather than improved because the point is that DVol
 * reports the same figure the other tables report for the same stock. Changing
 * one of these changes every scan at once — which is the intended property.
 *
 * ⚠️ scanner/run still carries its own inline copy. Migrating it to this module
 * is safe but must be proven behaviour-neutral against a live scan first (the
 * same way computeCnfScore was extracted), so it has not been done yet.
 *
 * BAR ORDER IS DESCENDING — index 0 is the most recent session, matching
 * scanner/run. Callers holding ascending bars (Polygon's `sort=asc`) must
 * reverse before calling; `fromAscending` does it for you.
 */

export interface MetricBar { h: number; l: number; c: number; v?: number }

export interface BarMetrics {
  stochK: number | null;
  ema10: number | null;
  ema21: number | null;
  ema50: number | null;
  aboveEma10: boolean | null;
  aboveEma21: boolean | null;
  distToEma10: number | null;
  distToEma21: number | null;
  ema21Rising: boolean | null;
  goldenCross: boolean | null;
  pctOffHigh: number | null;
  atrPct: number | null;
}

const EMPTY: BarMetrics = {
  stochK: null, ema10: null, ema21: null, ema50: null,
  aboveEma10: null, aboveEma21: null, distToEma10: null, distToEma21: null,
  ema21Rising: null, goldenCross: null, pctOffHigh: null, atrPct: null,
};

/** Descending bars (index 0 = latest). `price` is the current/last price. */
export function computeBarMetrics(barsDesc: MetricBar[], price: number): BarMetrics {
  const bars = Array.isArray(barsDesc) ? barsDesc : [];
  if (!bars.length || !isFinite(price) || price <= 0) return { ...EMPTY };

  const out: BarMetrics = { ...EMPTY };

  /* Stochastic %K, smoothed by averaging the last four raw readings. */
  if (bars.length >= 14) {
    const rawK = (idx: number) => {
      const win = bars.slice(idx, idx + 10);
      const hi = Math.max(...win.map(b => b.h));
      const lo = Math.min(...win.map(b => b.l));
      return hi === lo ? 50 : ((bars[idx].c - lo) / (hi - lo)) * 100;
    };
    out.stochK = (rawK(0) + rawK(1) + rawK(2) + rawK(3)) / 4;
  }

  if (bars.length >= 30) {
    const warm = Math.min(100, bars.length - 1);
    let e10 = bars[warm].c, e21 = bars[warm].c, e50 = bars[warm].c;
    let e21FiveAgo: number | null = null;
    const k10 = 2 / 11, k21 = 2 / 22, k50 = 2 / 51;
    for (let i = warm - 1; i >= 0; i--) {
      e10 = bars[i].c * k10 + e10 * (1 - k10);
      e21 = bars[i].c * k21 + e21 * (1 - k21);
      e50 = bars[i].c * k50 + e50 * (1 - k50);
      if (i === 5) e21FiveAgo = e21;
    }
    out.ema10 = e10;
    out.ema21 = e21;
    out.ema50 = bars.length >= 60 ? e50 : null;
    out.aboveEma10 = price >= e10;
    out.aboveEma21 = price >= e21;
    if (e10 > 0) out.distToEma10 = ((price - e10) / e10) * 100;
    if (e21 > 0) out.distToEma21 = ((price - e21) / e21) * 100;
    if (e21FiveAgo != null) out.ema21Rising = e21 > e21FiveAgo;
  }

  if (bars.length >= 200) {
    let s50 = 0, s200 = 0;
    for (let i = 0; i < 200; i++) {
      s200 += bars[i].c;
      if (i < 50) s50 += bars[i].c;
    }
    out.goldenCross = s50 / 50 > s200 / 200;
  }

  /* Distance below the highest high of the last year, as a positive percent. */
  const yr = bars.slice(0, 252);
  if (yr.length >= 30) {
    const hi = Math.max(...yr.map(b => b.h));
    if (hi > 0) out.pctOffHigh = ((hi - price) / hi) * 100;
  }

  /* True-range ATR over 14 sessions, as a percent of price. */
  if (bars.length >= 15) {
    let sum = 0;
    for (let i = 0; i < 14; i++) {
      const prevClose = bars[i + 1].c;
      sum += Math.max(
        bars[i].h - bars[i].l,
        Math.abs(bars[i].h - prevClose),
        Math.abs(bars[i].l - prevClose),
      );
    }
    const atr = sum / 14;
    if (price > 0) out.atrPct = (atr / price) * 100;
  }

  return out;
}

/** Convenience for Polygon's `sort=asc` payloads. */
export const fromAscending = (barsAsc: MetricBar[], price: number): BarMetrics =>
  computeBarMetrics([...(barsAsc ?? [])].reverse(), price);

/* Core bar math — the arithmetic every scan route needs.
 *
 * This module exists because sma/ema/atr/adrPct/stochastic had been written
 * independently in ep9m/run, swing-candidates/run, scanner/run, and several
 * indicator files. The copies agreed on some values and not others; the
 * stochastic in particular had three genuinely different formulas feeding a
 * single `stochK` column, one of them contradicting the documentation in
 * COLUMN_NOTES. There is one implementation of each here now.
 *
 * BAR ORDER: every function below expects OLDEST-FIRST (ascending) bars.
 * The scanner historically worked from descending arrays; those call sites
 * must reverse before calling rather than relying on a window that happens
 * to be symmetric.
 */

export interface Bar { o: number; h: number; l: number; c: number; v: number; t?: number }

/** Simple moving average of the trailing `period` values. */
export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  return values.slice(-period).reduce((a, b) => a + b, 0) / period;
}

/** Exponential moving average, seeded with the SMA of the first `period` values. */
export function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

/** Wilder-smoothed Average True Range. */
export function atr(bars: Bar[], period = 14): number | null {
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

/* Average Daily Range % — the Minervini definition: SMA(High/Low) - 1.
   Distinct from ATR: no gap component, so it measures how much intraday
   room the stock actually gives you on a typical session. This is also the
   stop basis in the trade plan, for exactly that reason. */
export function adrPct(bars: Bar[], period = 20): number | null {
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

/* Smoothed stochastic %K — the (10, 4) "Dr. Wish" setting the column notes
   document. A flat window reads 50 rather than null: a stock that has not
   moved is neither overbought nor oversold, and returning null there would
   drop it out of the Ready/Forming test entirely.

   EP9M previously used a raw, unsmoothed single-window %K here while its
   column claimed to be smoothed. It now gets the same number as everything
   else. */
export function stochK(bars: Bar[], length = 10, smooth = 4): number | null {
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

/** Trailing percentage return over `lookback` bars. */
export function pctReturn(closes: number[], lookback: number): number | null {
  if (closes.length < lookback + 1) return null;
  const then = closes[closes.length - 1 - lookback];
  const now = closes[closes.length - 1];
  if (!then) return null;
  return ((now - then) / then) * 100;
}

/* ---- Flow accessors ------------------------------------------------------

   Scanner rows arrive with inconsistent field names depending on which list
   they came from, so reading them needs one agreed order of preference. The
   dashboard and the analyst page previously disagreed: one read
   `change ?? changePct` and fell back to price x volume for dollar volume,
   the other read `changePct` only and treated a missing dVol as zero. Same
   ETF, opposite bucket. */

export const chgOf = (s: any): number => Number(s?.change ?? s?.changePct) || 0;

export const dVolOf = (s: any): number => {
  const d = Number(s?.dVol);
  if (!isNaN(d) && d > 0) return d;
  const p = Number(s?.price) || 0;
  const v = Number(s?.volume ?? s?.vol) || 0;
  return p * v;
};

/** Deduplicates by ticker, keeping first occurrence. */
export function dedupeByTicker<T extends { ticker?: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (!r?.ticker || seen.has(r.ticker)) return false;
    seen.add(r.ticker);
    return true;
  });
}

/* Share of dollar volume on the advancing side, 0-100. Must be computed over
   a DEDUPED pool: a name appearing in two mover buckets would otherwise count
   its dollars twice, and the duplicates are not random — they cluster in the
   most active names, which carry the most weight. */
export function advancingDollarShare(rows: any[]): number {
  const pool = dedupeByTicker(rows);
  const total = pool.reduce((a, s) => a + dVolOf(s), 0);
  if (total <= 0) return 0;
  const adv = pool.filter((s) => chgOf(s) > 0).reduce((a, s) => a + dVolOf(s), 0);
  return Math.round((adv / total) * 100);
}

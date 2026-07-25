// lib/indicators/rmv.ts
//
// RMV — Relative Measured Volatility
// Port of CTT RMV V1.0 / Deepvue "DV - Relative Measured Volatility".
//
// Composite ATR (5/10/15, Wilder RMA) ranked against its own high/low across
// a 15-bar window:
//   0   = tightest price action of the window (max compression)
//   100 = most volatile of the window
//
// Companion to ADR, not a duplicate. ADR is absolute room the stock gives you
// on a typical session; RMV is where the stock sits right now relative to its
// own recent behaviour. The pair worth hunting is high ADR + low RMV — a real
// mover that happens to be coiled.
//
// Single source of truth for both scan routes. They fetch bars in opposite
// orders (the main scanner sorts descending, the swing/10-21 route uses
// Polygon's sort=asc), so pass `order` rather than reversing at the call site.

export interface RmvBar {
  h: number;
  l: number;
  c: number;
}

export type BarOrder = 'asc' | 'desc';

export interface RmvOptions {
  /** Bar ordering of the input array. 'asc' = oldest first. Default 'asc'. */
  order?: BarOrder;
  /** Ranking window length. Default 15 (matches the Pine default). */
  lookback?: number;
  /** ATR lengths averaged into the composite. Default [5, 10, 15]. */
  atrLens?: number[];
}

/** Bars of warm-up fed to the recursive average — ample for a 15-period RMA. */
const WARMUP_BARS = 150;

/**
 * Wilder's RMA (a.k.a. SMMA) — exactly what Pine's ta.atr() uses under the
 * hood. Seeded with a simple average of the first `len` values; entries before
 * that are NaN, same as Pine's na.
 */
function rma(src: number[], len: number): number[] {
  const out: number[] = new Array(src.length).fill(NaN);
  if (src.length < len) return out;

  let seed = 0;
  for (let i = 0; i < len; i++) seed += src[i];
  out[len - 1] = seed / len;

  for (let i = len; i < src.length; i++) {
    out[i] = (out[i - 1] * (len - 1) + src[i]) / len;
  }
  return out;
}

/** True Range over ascending bars. First bar falls back to high-low. */
function trueRange(bars: RmvBar[]): number[] | null {
  const tr: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    const h = bars[i]?.h;
    const l = bars[i]?.l;
    if (h == null || l == null || !isFinite(h) || !isFinite(l)) return null;
    if (i === 0) {
      tr.push(h - l);
      continue;
    }
    const pc = bars[i - 1].c;
    if (pc == null || !isFinite(pc)) return null;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  return tr;
}

/**
 * Relative Measured Volatility for the most recent bar.
 * Returns null when history is too thin to answer honestly — callers should
 * render a dash rather than substituting a zero.
 */
export function computeRMV(bars: RmvBar[] | null | undefined, opts: RmvOptions = {}): number | null {
  const { order = 'asc', lookback = 15, atrLens = [5, 10, 15] } = opts;

  if (!Array.isArray(bars) || bars.length === 0) return null;
  if (lookback < 2 || atrLens.length === 0) return null;

  const need = Math.max(...atrLens) + lookback + 5;
  if (bars.length < need) return null;

  // Normalize to ascending, newest last, trimmed to the warm-up window.
  const asc =
    order === 'desc'
      ? bars.slice(0, Math.min(WARMUP_BARS, bars.length)).slice().reverse()
      : bars.slice(-Math.min(WARMUP_BARS, bars.length));

  const tr = trueRange(asc);
  if (!tr) return null;

  const atrSeries = atrLens.map((len) => rma(tr, len));

  // Composite ATR: the mean of the three smoothed series, NaN until all warm.
  const comp: number[] = asc.map((_, i) => {
    let sum = 0;
    for (const s of atrSeries) {
      const v = s[i];
      if (!isFinite(v)) return NaN;
      sum += v;
    }
    return sum / atrSeries.length;
  });

  // Pine's ta.highest/ta.lowest include the current bar.
  const win = comp.slice(-lookback);
  if (win.length < lookback || win.some((v) => !isFinite(v))) return null;

  const cur = win[win.length - 1];
  const hi = Math.max(...win);
  const lo = Math.min(...win);
  const span = hi - lo;

  const rmv = span > 0 ? ((cur - lo) / span) * 100 : 0;
  return Math.round(rmv * 10) / 10;
}

/**
 * Tailwind text class for an RMV reading. Low = tight = green, high = red.
 * Shared by the four scanner tables so the scale can't drift between them.
 */
export function rmvColor(rmv: number | null | undefined): string {
  if (rmv == null || !isFinite(Number(rmv))) return 'text-slate-500';
  const r = Number(rmv);
  if (r <= 10) return 'text-emerald-400';
  if (r <= 25) return 'text-lime-400';
  if (r <= 45) return 'text-yellow-400';
  if (r <= 65) return 'text-amber-400';
  if (r <= 80) return 'text-orange-400';
  return 'text-rose-400';
}
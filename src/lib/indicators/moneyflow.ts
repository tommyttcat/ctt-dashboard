// lib/indicators/moneyflow.ts
//
// Money Flow — Chaikin-style accumulation/distribution, scaled 0-100.
//
// The question this answers that nothing else in the dashboard does: RVOL
// tells you volume showed up, but not WHICH SIDE got filled. A stock can
// trade 5x its average volume and close on its low — that's 5x distribution.
// MF reads where each bar closed within its own range, weights that by the
// bar's volume, and sums it over N sessions.
//
//   > 60  strong accumulation — buyers taking the closes
//   50-60 mild accumulation
//   40-50 mild distribution
//   < 40  strong distribution — sellers taking the closes
//
// Ported from the VPCI 92 Pine (f_calc_flo / mf_score), same formula and the
// same 150x scaling factor so the dashboard and the chart agree.

export interface MfBar {
  h: number;
  l: number;
  c: number;
  v: number;
}

export type BarOrder = 'asc' | 'desc';

export interface MfOptions {
  /** Bar ordering of the input array. 'asc' = oldest first. Default 'asc'. */
  order?: BarOrder;
  /**
   * Lookback in bars. Default 21 — a full trading month, which is the right
   * window for a daily-bar swing read. The Pine uses 10 for intraday and 21
   * for swing; this module is daily-only, so 21 is the sensible default.
   */
  length?: number;
}

/**
 * Scaling factor applied to raw CMF before centering on 50.
 * CMF runs -1..+1 in theory but rarely exceeds ±0.4 in practice, so 150
 * spreads the realistic range across most of the 0-100 scale. Matches the
 * Pine so both surfaces print the same number.
 */
const SCALE = 150;

/**
 * Money Flow score, 0-100, centered on 50.
 * Returns null when there aren't enough bars or the data is unusable —
 * callers should render a dash rather than substituting the neutral 50,
 * which would falsely read as "balanced".
 */
export function computeMoneyFlow(
  bars: MfBar[] | null | undefined,
  opts: MfOptions = {}
): number | null {
  const { order = 'asc', length = 21 } = opts;

  if (!Array.isArray(bars) || bars.length < length) return null;
  if (length < 2) return null;

  // Normalize to ascending, then take the trailing window.
  const asc = order === 'desc' ? bars.slice(0, length).slice().reverse() : bars.slice(-length);
  if (asc.length < length) return null;

  let sumMfVol = 0;
  let sumVol = 0;

  for (const b of asc) {
    const h = b?.h;
    const l = b?.l;
    const c = b?.c;
    const v = b?.v;

    if (h == null || l == null || c == null || v == null) return null;
    if (!isFinite(h) || !isFinite(l) || !isFinite(c) || !isFinite(v)) return null;
    if (v <= 0) continue; // a zero-volume bar carries no information either way

    const range = h - l;
    // A doji with h === l has no directional information — multiplier is 0,
    // but the volume still counts toward the denominator. That's deliberate:
    // heavy volume going nowhere should dilute the reading toward neutral.
    const mult = range > 0 ? ((c - l) - (h - c)) / range : 0;

    sumMfVol += mult * v;
    sumVol += v;
  }

  if (sumVol <= 0) return null;

  const cmf = sumMfVol / sumVol;         // -1..+1
  const score = 50 + cmf * SCALE;         // centered on 50

  return Math.round(Math.max(0, Math.min(100, score)) * 10) / 10;
}

/**
 * Direction of the MF reading over the last few bars — is accumulation
 * building or fading? Returns +1 rising, -1 falling, 0 flat/unknown.
 * More useful than the level alone: MF 55 and rising is a different story
 * from MF 55 and rolling over.
 */
export function moneyFlowTrend(
  bars: MfBar[] | null | undefined,
  opts: MfOptions & { lookback?: number } = {}
): number {
  const { order = 'asc', length = 21, lookback = 5 } = opts;
  if (!Array.isArray(bars) || bars.length < length + lookback) return 0;

  const asc = order === 'desc' ? bars.slice().reverse() : bars;

  const now = computeMoneyFlow(asc, { order: 'asc', length });
  const then = computeMoneyFlow(asc.slice(0, asc.length - lookback), { order: 'asc', length });

  if (now == null || then == null) return 0;
  const delta = now - then;
  if (delta > 1.5) return 1;
  if (delta < -1.5) return -1;
  return 0;
}

/**
 * Tailwind text class for an MF reading. Shared so all five tables color
 * it identically. Purple for the extremes, matching the house convention
 * where purple = "unusual, look at this".
 */
export function mfColor(mf: number | null | undefined): string {
  if (mf == null || !isFinite(Number(mf))) return 'text-slate-500';
  const v = Number(mf);
  if (v >= 70) return 'text-purple-400';
  if (v >= 60) return 'text-emerald-400';
  if (v >= 50) return 'text-lime-400';
  if (v >= 40) return 'text-amber-400';
  if (v >= 30) return 'text-orange-400';
  return 'text-rose-400';
}

/** Short human label for tooltips. */
export function mfLabel(mf: number | null | undefined): string {
  if (mf == null || !isFinite(Number(mf))) return 'n/a';
  const v = Number(mf);
  if (v >= 70) return 'heavy accumulation';
  if (v >= 60) return 'accumulation';
  if (v >= 50) return 'mild accumulation';
  if (v >= 40) return 'mild distribution';
  if (v >= 30) return 'distribution';
  return 'heavy distribution';
}

/** Arrow glyph for the trend value from moneyFlowTrend(). */
export function mfArrow(trend: number): string {
  if (trend > 0) return ' ↑';
  if (trend < 0) return ' ↓';
  return '';
}
// lib/indicators/rme.ts
//
// RME — Relative Measured Extension
// Same construction as RMV, different input: rank a value against its own
// history rather than against an absolute threshold.
//
//   RMV ranks volatility  → "is this stock coiled right now?"
//   RME ranks extension   → "is this stock stretched right now?"
//
// Scale is -100..+100, anchored on the 21 EMA to match the 10/21 framework
// used everywhere else in the dashboard:
//   +100 = the furthest above its 21 EMA it has been in the lookback window
//      0 = sitting on the 21 EMA
//   -100 = the furthest below it has been in the lookback window
//
// Why this beats the ATR-multiple extension check it replaces: `dist > 3×ATR%`
// asks whether the move is large relative to daily noise. RME asks whether the
// move is large relative to what this specific stock has historically done.
// A name that routinely runs 15% above its 21 EMA before pulling back is not
// extended at 12%. A name that has never exceeded 6% is very extended at 5.5%.
// The ATR test cannot tell those apart; RME can.

export interface RmeBar {
  c: number;
}

export type BarOrder = 'asc' | 'desc';

export interface RmeOptions {
  /** Bar ordering of the input array. 'asc' = oldest first. Default 'asc'. */
  order?: BarOrder;
  /** Anchor MA length. Default 21 (the 10/21 framework anchor). */
  maLength?: number;
  /** Ranking window, in bars. Default 250 (~1 year). */
  lookback?: number;
  /**
   * Minimum ranked bars required before a reading is trustworthy. Below this
   * the function returns null rather than ranking against a handful of bars.
   * Default 60 (~3 months) — enough to be meaningful for recent IPOs, which
   * would otherwise always return null at the full 250.
   */
  minLookback?: number;
}

export interface RmeResult {
  /** -100..+100, or null when history is insufficient. */
  rme: number | null;
  /** Raw current extension from the anchor MA, in percent. */
  extPct: number | null;
  /** How many bars the ranking actually used — below `lookback` on young names. */
  sampled: number;
}

/** EMA warm-up cap. 21-period converges long before this. */
const MAX_BARS = 420;

/**
 * EMA series, seeded with an SMA of the first `period` closes.
 * Entries before the seed are NaN, matching Pine's na.
 */
function emaSeries(closes: number[], period: number): number[] {
  const out: number[] = new Array(closes.length).fill(NaN);
  if (closes.length < period) return out;

  let seed = 0;
  for (let i = 0; i < period; i++) seed += closes[i];
  let e = seed / period;
  out[period - 1] = e;

  const k = 2 / (period + 1);
  for (let i = period; i < closes.length; i++) {
    e = closes[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

/**
 * Full RME result, including the raw extension and the sample size actually
 * used. Prefer this when you want to know how much history backed the number.
 */
export function computeRMEDetail(
  bars: RmeBar[] | null | undefined,
  opts: RmeOptions = {}
): RmeResult {
  const {
    order = 'asc',
    maLength = 21,
    lookback = 250,
    minLookback = 60,
  } = opts;

  const empty: RmeResult = { rme: null, extPct: null, sampled: 0 };

  if (!Array.isArray(bars) || bars.length === 0) return empty;
  if (maLength < 2 || lookback < 2) return empty;

  // Normalize to ascending, newest last, trimmed to the warm-up cap.
  const asc =
    order === 'desc'
      ? bars.slice(0, Math.min(MAX_BARS, bars.length)).slice().reverse()
      : bars.slice(-Math.min(MAX_BARS, bars.length));

  const closes: number[] = [];
  for (const b of asc) {
    const c = b?.c;
    if (c == null || !isFinite(c)) return empty;
    closes.push(c);
  }

  // Need the anchor warmed up plus a usable ranking window.
  if (closes.length < maLength + minLookback) return empty;

  const ma = emaSeries(closes, maLength);

  // Extension in percent at every bar where the anchor is defined.
  const ext: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const m = ma[i];
    if (!isFinite(m) || m === 0) continue;
    ext.push(((closes[i] - m) / m) * 100);
  }

  if (ext.length < minLookback) return empty;

  // Rank against the trailing window — the whole series if the name is young.
  const win = ext.slice(-Math.min(lookback, ext.length));
  const cur = win[win.length - 1];

  // Pine's math.max(ext, 0) / math.min(ext, 0) before the extremes: positive
  // extension ranks only against prior positive extension, and vice versa.
  // Without the clamp a stock that has only ever traded above its MA would
  // have a meaningless negative floor.
  let maxExt = 0;
  let minExt = 0;
  for (const v of win) {
    if (v > maxExt) maxExt = v;
    if (v < minExt) minExt = v;
  }

  let rme = 0;
  if (cur > 0) {
    rme = maxExt > 0 ? (cur / maxExt) * 100 : 0;
  } else if (cur < 0) {
    rme = minExt < 0 ? (cur / Math.abs(minExt)) * 100 : 0;
  }

  // Clamp guards float drift at the exact extreme (cur === maxExt → 100.0000001).
  rme = Math.max(-100, Math.min(100, rme));

  return {
    rme: Math.round(rme * 10) / 10,
    extPct: Math.round(cur * 100) / 100,
    sampled: win.length,
  };
}

/** Convenience wrapper when only the score matters. */
export function computeRME(
  bars: RmeBar[] | null | undefined,
  opts: RmeOptions = {}
): number | null {
  return computeRMEDetail(bars, opts).rme;
}

/**
 * CNF contribution for a long-biased setup. Negative = penalty.
 *
 * Deliberately NOT symmetric. A stock pinned at its historical ceiling is a
 * bad entry regardless of setup — you are buying where this name has always
 * turned. A stock at its historical floor is context-dependent: bad for a
 * breakout, which is why `reversalSetup` softens rather than rewards it. The
 * caller decides which case applies, same as the existing regime gate does.
 */
export function rmeScoreAdjustment(
  rme: number | null | undefined,
  reversalSetup = false
): number {
  if (rme == null || !isFinite(Number(rme))) return 0;
  const r = Number(rme);

  // Stretched above the anchor — the chase zone.
  if (r >= 90) return -12;
  if (r >= 75) return -8;
  if (r >= 60) return -4;

  // Deeply below the anchor. A reversal setup is looking for exactly this;
  // a breakout setup is catching a falling knife.
  if (r <= -75) return reversalSetup ? 0 : -6;
  if (r <= -50) return reversalSetup ? 0 : -3;

  return 0;
}

/** Short human label for the CNF tooltip. */
export function rmeLabel(rme: number | null | undefined): string {
  if (rme == null || !isFinite(Number(rme))) return 'n/a';
  const r = Number(rme);
  if (r >= 90) return 'at historical extension high';
  if (r >= 75) return 'heavily extended';
  if (r >= 60) return 'extended';
  if (r >= 25) return 'moderately above anchor';
  if (r > -25) return 'near anchor';
  if (r > -60) return 'moderately below anchor';
  if (r > -85) return 'deeply below anchor';
  return 'at historical extension low';
}
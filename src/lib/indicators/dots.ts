// src/lib/indicators/dots.ts — v1.0
//
// Dr. Wish blue dot / red dot reversal detection.
//
// The blue dot logic already lived inline inside detectPattern() in the
// scanner route, computing a fast %K over a 10-bar window, checking whether
// ANY of the last three bars printed oversold, then requiring price to close
// above the prior bar and hold a reference MA. That worked, but it produced
// only a pattern NAME — nothing downstream could ask "is this a blue dot"
// without string-matching setupName, and there was no red-dot equivalent at
// all despite red dots being half the signal in practice.
//
// This file owns both. The blue-dot conditions are reproduced exactly as the
// route had them so nothing shifts on existing rows; the red dot is the
// strict mirror.
//
// WHY THE THREE-BAR LOOKBACK: a reversal rarely triggers on the same bar that
// prints the extreme. Stochastic bottoms, then price turns a day or two later.
// Requiring oversold ON the signal bar would miss most real entries, so the
// condition is "was oversold recently AND is turning now."

export type DotKind = 'blue' | 'red';

export interface DotDetail {
  kind: DotKind | null;
  // Fast %K on the signal bar. Exposed so callers can rank by depth — a dot
  // firing from 8 is not the same as one firing from 24.
  stochK: number | null;
  // How many bars back the extreme printed (0 = this bar). Higher means the
  // reversal has been developing longer and is closer to being priced in.
  barsSinceExtreme: number | null;
  // Did price reclaim the reference MA, or is it merely up on the day?
  reclaimedMa: boolean;
  // Both dots at once is impossible; this flags data problems rather than
  // silently preferring one.
  conflict: boolean;
}

export interface DotOptions {
  order?: 'asc' | 'desc';
  // Window for the fast stochastic. Dr. Wish uses 10.
  stochLength?: number;
  // Oversold / overbought thresholds on that fast %K.
  oversold?: number;
  overbought?: number;
  // How many bars back to accept the extreme from.
  lookback?: number;
  // Live intraday price. When omitted the last bar's close is used.
  price?: number | null;
}

interface Bar { h: number; l: number; c: number; o?: number; v?: number; t?: number }

const DEFAULTS = {
  stochLength: 10,
  oversold: 25,
  overbought: 75,
  lookback: 3,
};

// Normalize to DESC (newest first) — the scanner's daily bars already arrive
// that way, but the ep9m and consolidation paths sort differently and passing
// the wrong order silently inverts every signal.
const toDesc = (bars: Bar[], order: 'asc' | 'desc'): Bar[] =>
  order === 'desc' ? bars : bars.slice().reverse();

// Fast %K at an index, over the `length` bars starting there.
const fastK = (bars: Bar[], idx: number, length: number): number | null => {
  if (idx < 0 || idx + length > bars.length) return null;
  const win = bars.slice(idx, idx + length);
  let hi = -Infinity;
  let lo = Infinity;
  for (const b of win) {
    if (b.h > hi) hi = b.h;
    if (b.l < lo) lo = b.l;
  }
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
  if (hi === lo) return 50;
  return ((bars[idx].c - lo) / (hi - lo)) * 100;
};

const smaOf = (bars: Bar[], length: number): number | null => {
  if (bars.length < length) return null;
  let sum = 0;
  for (let i = 0; i < length; i++) sum += bars[i].c;
  return sum / length;
};

// EMA seeded far enough back that the warm-up has decayed out.
const emaOf = (bars: Bar[], length: number): number | null => {
  if (bars.length < length + 5) return null;
  const warm = Math.min(100, bars.length - 1);
  let e = bars[warm].c;
  const k = 2 / (length + 1);
  for (let i = warm - 1; i >= 0; i--) e = (bars[i].c * k) + (e * (1 - k));
  return e;
};

export function computeDotDetail(bars: Bar[], opts: DotOptions = {}): DotDetail {
  const empty: DotDetail = {
    kind: null, stochK: null, barsSinceExtreme: null,
    reclaimedMa: false, conflict: false,
  };

  const order = opts.order ?? 'desc';
  const stochLength = opts.stochLength ?? DEFAULTS.stochLength;
  const oversold = opts.oversold ?? DEFAULTS.oversold;
  const overbought = opts.overbought ?? DEFAULTS.overbought;
  const lookback = opts.lookback ?? DEFAULTS.lookback;

  const d = toDesc(bars || [], order);
  // Need the stochastic window plus the lookback plus enough for a 30 SMA.
  if (d.length < stochLength + lookback + 30) return empty;

  const price = opts.price != null && Number.isFinite(opts.price) ? opts.price : d[0].c;
  const prevClose = d[1]?.c;
  if (prevClose == null) return empty;

  const sma30 = smaOf(d, 30);
  const ema21 = emaOf(d, 21);
  if (sma30 == null && ema21 == null) return empty;

  // Find the most recent extreme inside the lookback window, in either
  // direction, and note how far back it was.
  let lowestK: number | null = null;
  let lowestIdx: number | null = null;
  let highestK: number | null = null;
  let highestIdx: number | null = null;

  for (let i = 0; i < lookback; i++) {
    const k = fastK(d, i, stochLength);
    if (k == null) continue;
    if (lowestK == null || k < lowestK) { lowestK = k; lowestIdx = i; }
    if (highestK == null || k > highestK) { highestK = k; highestIdx = i; }
  }

  const wasOversold = lowestK != null && lowestK <= oversold;
  const wasOverbought = highestK != null && highestK >= overbought;

  // --- BLUE DOT: oversold recently, turning up, holding a reference MA -----
  // Reproduces the original inline logic exactly: price above the prior
  // close, and above EITHER the 30 SMA or the 21 EMA. The OR matters — in a
  // deep reversal the 21 is usually still overhead and requiring both would
  // suppress most valid signals.
  const blueTurn = price > prevClose;
  const blueMa =
    (sma30 != null && price > sma30) || (ema21 != null && price > ema21);
  const isBlue = wasOversold && blueTurn && blueMa;

  // --- RED DOT: the strict mirror -----------------------------------------
  // Overbought recently, closing DOWN, and LOSING the reference MA. The
  // mirror of an OR is an AND: blue accepts holding either line, so red
  // requires losing both. A name that has slipped under its 21 but is still
  // over the 30 SMA has not lost its footing yet, and calling that a red dot
  // would fire on every ordinary pullback inside an uptrend.
  const redTurn = price < prevClose;
  const redMa =
    (sma30 == null || price < sma30) && (ema21 == null || price < ema21);
  const isRed = wasOverbought && redTurn && redMa;

  if (isBlue && isRed) {
    // Genuinely unreachable — price cannot be both above and below the prior
    // close. Surfaced rather than silently resolved so a future edit to
    // either branch that breaks the mutual exclusion is visible in the data.
    return { ...empty, conflict: true };
  }

  if (isBlue) {
    return {
      kind: 'blue',
      stochK: lowestK != null ? Math.round(lowestK * 10) / 10 : null,
      barsSinceExtreme: lowestIdx,
      reclaimedMa: blueMa,
      conflict: false,
    };
  }

  if (isRed) {
    return {
      kind: 'red',
      stochK: highestK != null ? Math.round(highestK * 10) / 10 : null,
      barsSinceExtreme: highestIdx,
      reclaimedMa: false,
      conflict: false,
    };
  }

  return empty;
}

// Convenience wrapper for callers that only need the kind.
export function computeDot(bars: Bar[], opts: DotOptions = {}): DotKind | null {
  return computeDotDetail(bars, opts).kind;
}
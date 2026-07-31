/* Volatility Contraction Pattern — detection library
   ==================================================================
   Minervini's VCP: a stock that has already advanced builds a base of
   SUCCESSIVELY SHALLOWER pullbacks on SUCCESSIVELY LIGHTER volume, then
   breaks out through the high of the final contraction.

   The contractions are supply being absorbed. Each pullback finds buyers
   sooner than the last because there is less stock left to sell; by the
   final leg the float in weak hands is exhausted and the pivot gives way
   on expansion.

   ------------------------------------------------------------------
   WHY THIS IS NOT THE DETECTOR ALREADY IN /api/scanner/run.

   detectPattern() there identifies a VCP only when

       contracting && volDrying && tightFinalLeg && price > baseHigh

   — the last clause meaning it fires ONLY AFTER the breakout. That is
   useful for confirming what happened; it is useless for finding a base
   while it is still forming, which is the entire point of watching a VCP.
   By the time that detector names one, the pivot is behind you.

   It is also coarse: three fixed 12-bar windows, comparing high-to-low
   range across each. Real contractions are not evenly spaced. A base can
   put in a 20% leg over three weeks and a 6% leg over four days, and
   fixed windows will straddle both and see neither.

   This module finds the ACTUAL SWING LEGS and measures each one.
   ------------------------------------------------------------------

   BAR ORDER: every function here takes bars OLDEST FIRST. This has bitten
   the codebase twice — the scanner route sorts descending, the swing and
   ep9m routes ascending — and a reversed array does not throw, it returns
   a plausible number computed from the wrong end of the series. Callers
   must sort before calling. There is a cheap guard in analyzeVcp() that
   catches the obvious case.
   ================================================================== */

export interface VcpBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/* ---- Pivot detection ----------------------------------------------------
   A ZigZag: walk forward tracking the running extreme, and commit a pivot
   only once price has retraced far enough in the other direction to prove
   the extreme was real.

   THE THRESHOLD IS ATR-SCALED, NOT A FIXED PERCENTAGE, and that is the
   single most important choice in this file. A 3% pullback in a utility is
   a structural leg; the same 3% in a biotech is one ordinary session. A
   fixed threshold finds phantom contractions in volatile names and misses
   real ones in quiet names — and since the whole pattern is defined by
   COMPARING leg depths, noise legs do not merely add rows, they corrupt the
   sequence that decides whether a base qualifies.

   2.0 ATRs is the working default: large enough that a single wide bar
   cannot manufacture a leg, small enough to catch the tight final
   contractions that matter most. */
export const PIVOT_ATR_MULTIPLE = 2.0;

/* Floor and ceiling on the derived threshold. Without the floor, a name
   whose ATR has collapsed inside the base would generate a pivot on every
   bar; without the ceiling, a post-earnings ATR spike would flatten the
   whole base into a single leg. */
const PIVOT_MIN_PCT = 1.5;
const PIVOT_MAX_PCT = 12;

export interface Pivot {
  index: number;
  price: number;
  kind: 'high' | 'low';
}

export function atrPercent(bars: VcpBar[], period = 14): number | null {
  if (bars.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const pc = bars[i - 1].c;
    trs.push(Math.max(
      bars[i].h - bars[i].l,
      Math.abs(bars[i].h - pc),
      Math.abs(bars[i].l - pc)
    ));
  }
  let a = trs.slice(0, period).reduce((x, y) => x + y, 0) / period;
  for (let i = period; i < trs.length; i++) a = (a * (period - 1) + trs[i]) / period;
  const last = bars[bars.length - 1].c;
  return last > 0 ? (a / last) * 100 : null;
}

/* Pivots, oldest first. The final running extreme is committed as a pivot
   even though it has not been confirmed by a retrace — a base being watched
   in real time always ends mid-leg, and refusing to report that leg would
   hide the newest and most relevant contraction. Callers that care can check
   whether the last pivot is confirmed via `confirmedPivots`. */
export function findPivots(bars: VcpBar[], thresholdPct: number): Pivot[] {
  if (bars.length < 3) return [];

  const pivots: Pivot[] = [];
  const t = thresholdPct / 100;

  let direction: 1 | -1 = 1;
  let extremeIdx = 0;
  let extremePrice = bars[0].h;
  let lowIdx = 0;
  let lowPrice = bars[0].l;

  for (let i = 1; i < bars.length; i++) {
    const { h, l } = bars[i];

    if (direction === 1) {
      if (h > extremePrice) {
        extremePrice = h;
        extremeIdx = i;
      } else if (l < extremePrice * (1 - t)) {
        pivots.push({ index: extremeIdx, price: extremePrice, kind: 'high' });
        direction = -1;
        lowPrice = l;
        lowIdx = i;
      }
    } else {
      if (l < lowPrice) {
        lowPrice = l;
        lowIdx = i;
      } else if (h > lowPrice * (1 + t)) {
        pivots.push({ index: lowIdx, price: lowPrice, kind: 'low' });
        direction = 1;
        extremePrice = h;
        extremeIdx = i;
      }
    }
  }

  // Commit the unconfirmed final extreme — see the note above.
  if (direction === 1) {
    pivots.push({ index: extremeIdx, price: extremePrice, kind: 'high' });
  } else {
    pivots.push({ index: lowIdx, price: lowPrice, kind: 'low' });
  }

  return pivots;
}

/* ---- Contractions -------------------------------------------------------
   A contraction is one high-to-low leg. Minervini writes them T1, T2, T3…
   with each shallower than the last — 25%, then 12%, then 6% is the
   textbook shape.

   Each leg also carries the average volume across its bars, because the
   depth sequence alone is not a VCP. Price contracting on RISING volume is
   distribution being absorbed by fewer and fewer buyers, which looks
   identical on a depth chart and resolves in the opposite direction. */
export interface Contraction {
  fromIndex: number;
  toIndex: number;
  high: number;
  low: number;
  depthPct: number;
  bars: number;
  avgVolume: number;
}

export function extractContractions(bars: VcpBar[], pivots: Pivot[]): Contraction[] {
  const out: Contraction[] = [];

  for (let i = 0; i < pivots.length - 1; i++) {
    const a = pivots[i];
    const b = pivots[i + 1];
    if (a.kind !== 'high' || b.kind !== 'low') continue;
    if (a.price <= 0) continue;

    const slice = bars.slice(a.index, b.index + 1);
    const vol = slice.length
      ? slice.reduce((s, x) => s + (x.v || 0), 0) / slice.length
      : 0;

    out.push({
      fromIndex: a.index,
      toIndex: b.index,
      high: a.price,
      low: b.price,
      depthPct: ((a.price - b.price) / a.price) * 100,
      bars: b.index - a.index,
      avgVolume: vol,
    });
  }

  return out;
}

/* ---- Trend Template -----------------------------------------------------
   Minervini's eight structural preconditions. A VCP inside a downtrend is
   not a VCP — it is a bear flag with the same silhouette, and the
   distinction is not visible in the contraction sequence itself.

   Criterion 8 (RS Rating) is NOT evaluated here: the rating is a percentile
   against the whole market, so it cannot be computed from one stock's bars.
   The route supplies it and the caller merges. This function returns the
   seven that are computable locally, and `templateScore` reports out of 7
   for that reason — a caller that silently treated it as 8 would understate
   every name. */
export interface TrendTemplate {
  aboveMa150: boolean;
  aboveMa200: boolean;
  ma150AboveMa200: boolean;
  ma200Rising: boolean;
  ma50AboveOthers: boolean;
  aboveMa50: boolean;
  pctAbove52wLow: number | null;
  pctBelow52wHigh: number | null;
  above30PctFromLow: boolean;
  within25PctOfHigh: boolean;
  passed: number;
  total: number;
  failures: string[];
}

const smaAt = (closes: number[], period: number, endIdx: number): number | null => {
  const start = endIdx - period + 1;
  if (start < 0) return null;
  let s = 0;
  for (let i = start; i <= endIdx; i++) s += closes[i];
  return s / period;
};

/* The 200-day rising test looks back ONE MONTH (21 bars), which is
   Minervini's own wording. A shorter window turns a single quiet week into
   a failed criterion; a longer one lets a rolling-over average still pass
   weeks after it topped. */
const MA200_RISING_LOOKBACK = 21;

export function evaluateTrendTemplate(bars: VcpBar[]): TrendTemplate | null {
  if (bars.length < 200) return null;

  const closes = bars.map(b => b.c);
  const last = closes.length - 1;
  const price = closes[last];

  const ma50 = smaAt(closes, 50, last);
  const ma150 = smaAt(closes, 150, last);
  const ma200 = smaAt(closes, 200, last);
  const ma200Prev = smaAt(closes, 200, last - MA200_RISING_LOOKBACK);

  if (ma50 == null || ma150 == null || ma200 == null) return null;

  const window = bars.slice(Math.max(0, bars.length - 252));
  const hi52 = Math.max(...window.map(b => b.h));
  const lo52 = Math.min(...window.map(b => b.l));

  const pctAbove52wLow = lo52 > 0 ? ((price - lo52) / lo52) * 100 : null;
  const pctBelow52wHigh = hi52 > 0 ? ((price - hi52) / hi52) * 100 : null;

  const t: Omit<TrendTemplate, 'passed' | 'total' | 'failures'> = {
    aboveMa150: price > ma150,
    aboveMa200: price > ma200,
    ma150AboveMa200: ma150 > ma200,
    ma200Rising: ma200Prev != null ? ma200 > ma200Prev : false,
    ma50AboveOthers: ma50 > ma150 && ma50 > ma200,
    aboveMa50: price > ma50,
    pctAbove52wLow,
    pctBelow52wHigh,
    above30PctFromLow: pctAbove52wLow != null && pctAbove52wLow >= 30,
    within25PctOfHigh: pctBelow52wHigh != null && pctBelow52wHigh >= -25,
  };

  const checks: [boolean, string][] = [
    [t.aboveMa150 && t.aboveMa200, 'price below the 150 or 200 day'],
    [t.ma150AboveMa200, '150 day below the 200 day'],
    [t.ma200Rising, '200 day not rising'],
    [t.ma50AboveOthers, '50 day not above the 150 and 200'],
    [t.aboveMa50, 'price below the 50 day'],
    [t.above30PctFromLow, 'less than 30% off the 52-week low'],
    [t.within25PctOfHigh, 'more than 25% below the 52-week high'],
  ];

  const failures = checks.filter(([ok]) => !ok).map(([, msg]) => msg);

  return {
    ...t,
    passed: checks.length - failures.length,
    total: checks.length,
    failures,
  };
}

/* ---- RS Rating ----------------------------------------------------------
   IBD's published rating is proprietary; this is the standard public
   approximation, weighting the most recent quarter double:

       raw = 2·(P0/P63) + (P0/P126) + (P0/P189) + (P0/P252)

   THE RAW NUMBER IS MEANINGLESS ON ITS OWN. What makes an RS Rating an RS
   Rating is the PERCENTILE RANK of that raw value against every other stock
   — which is exactly what the dashboard's existing rsVsSpy cannot give you.
   "+18 points versus SPY over three months" does not say whether that is
   top-decile leadership or the middle of the pack, and in a strong tape it
   is often the latter. A percentile answers the question directly.

   Ranking has to happen where the whole universe is in scope, so this file
   computes the raw value and the ROUTE does the ranking. */
export interface RsAnchors {
  p0: number;
  p63: number | null;
  p126: number | null;
  p189: number | null;
  p252: number | null;
}

export function rawRsScore(a: RsAnchors): number | null {
  if (!a.p0 || a.p0 <= 0) return null;
  // The 63-day leg is required — a stock without a quarter of history has no
  // relative strength worth ranking. The longer legs degrade: a name that
  // listed eight months ago still gets a rating, computed from what exists.
  if (!a.p63 || a.p63 <= 0) return null;

  let score = 2 * (a.p0 / a.p63);
  let weight = 2;

  if (a.p126 && a.p126 > 0) { score += a.p0 / a.p126; weight += 1; }
  if (a.p189 && a.p189 > 0) { score += a.p0 / a.p189; weight += 1; }
  if (a.p252 && a.p252 > 0) { score += a.p0 / a.p252; weight += 1; }

  // Normalise to the full-weight scale so a short-history name is not
  // penalised for the legs it cannot have. Without this, a stock with only
  // 63 days of data would score 2.x against a full-history stock's 5.x and
  // rank in the bottom percentile purely for being young.
  return (score / weight) * 5;
}

/* Percentile rank, 1-99, IBD convention. Higher is stronger. */
export function percentileRank(value: number, sortedAscending: number[]): number {
  if (sortedAscending.length === 0) return 50;

  let lo = 0;
  let hi = sortedAscending.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAscending[mid] <= value) lo = mid + 1;
    else hi = mid;
  }

  const pct = (lo / sortedAscending.length) * 100;
  return Math.max(1, Math.min(99, Math.round(pct)));
}

/* ---- VCP analysis -------------------------------------------------------
   The thresholds below are Minervini's own numbers where he states them and
   deliberately loose where he does not.

   TWO CONTRACTIONS IS THE MINIMUM, not three. Minervini describes 2-6 (T2
   through T6). Requiring three would reject the shortest and often
   highest-quality bases outright.

   THE SHALLOWING TEST HAS TOLERANCE. Textbook is each leg roughly half the
   last, but real bases put in 14% then 13% and are still absorbing supply.
   Requiring strict monotonic decrease throws away valid patterns for the
   sake of a tidy rule; requiring a 15% relative improvement on each leg is
   the compromise — meaningful contraction without demanding textbook shape. */
export const VCP_MIN_CONTRACTIONS = 2;
export const VCP_MAX_CONTRACTIONS = 6;

// Each leg must be at least this much shallower than the one before it,
// as a fraction of the previous leg's depth.
export const VCP_SHALLOWING_TOLERANCE = 0.85;

// The final contraction has to be genuinely tight. Above this the base has
// not finished; the name is still correcting rather than coiling.
export const VCP_MAX_FINAL_DEPTH = 15;

// A first leg deeper than this is a correction, not a base.
export const VCP_MAX_FIRST_DEPTH = 40;

// Prior advance into the base. Without it there is no supply overhang to
// absorb and the "base" is just a quiet stock going sideways.
export const VCP_MIN_PRIOR_MOVE = 25;

// How far back to look for the start of the prior advance, in bars.
const PRIOR_MOVE_LOOKBACK = 120;

// Distance to the pivot at which a base is called ready rather than forming.
export const VCP_PIVOT_PROXIMITY_PCT = 3;

export type VcpStatus = 'forming' | 'pivot-ready' | 'breaking-out' | 'failed';

export interface VcpResult {
  valid: boolean;
  reason: string | null;

  contractions: Contraction[];
  contractionCount: number;
  depths: number[];
  finalDepthPct: number | null;
  firstDepthPct: number | null;

  // The buy point: the high of the final contraction.
  pivot: number | null;
  pctToPivot: number | null;

  baseStartIndex: number | null;
  baseLengthBars: number | null;
  baseHigh: number | null;
  baseLow: number | null;

  priorMovePct: number | null;

  // Volume across the base vs the prior period, and across the legs.
  volumeDryingRatio: number | null;
  finalLegVolumeRatio: number | null;

  status: VcpStatus;
  atrPct: number | null;
  pivotThresholdPct: number | null;
}

const emptyResult = (reason: string): VcpResult => ({
  valid: false,
  reason,
  contractions: [],
  contractionCount: 0,
  depths: [],
  finalDepthPct: null,
  firstDepthPct: null,
  pivot: null,
  pctToPivot: null,
  baseStartIndex: null,
  baseLengthBars: null,
  baseHigh: null,
  baseLow: null,
  priorMovePct: null,
  volumeDryingRatio: null,
  finalLegVolumeRatio: null,
  status: 'failed',
  atrPct: null,
  pivotThresholdPct: null,
});

export function analyzeVcp(bars: VcpBar[], opts?: { lookback?: number }): VcpResult {
  const lookback = opts?.lookback ?? 90;

  if (!Array.isArray(bars) || bars.length < 60) {
    return emptyResult('not enough history');
  }

  /* Cheap guard against the recurring bar-order mistake. Not a proof —
     a series can legitimately fall over its span — but a descending array
     fails this most of the time, and the alternative is a plausible number
     computed backwards. */
  if (bars[0].t > bars[bars.length - 1].t) {
    return emptyResult('bars are newest-first — this module needs oldest-first');
  }

  const atrP = atrPercent(bars, 14);
  if (atrP == null || atrP <= 0) return emptyResult('no ATR');

  const threshold = Math.max(
    PIVOT_MIN_PCT,
    Math.min(PIVOT_MAX_PCT, atrP * PIVOT_ATR_MULTIPLE)
  );

  const window = bars.slice(Math.max(0, bars.length - lookback));
  const pivots = findPivots(window, threshold);
  const allContractions = extractContractions(window, pivots);

  if (allContractions.length < VCP_MIN_CONTRACTIONS) {
    return {
      ...emptyResult('fewer than two contractions'),
      atrPct: atrP,
      pivotThresholdPct: threshold,
    };
  }

  /* Take the LAST N contractions rather than all of them. A stock that has
     been basing for months may have an old, deep leg that no longer
     describes the current structure — including it would fail the shallowing
     test on history that has already been absorbed. The current base is the
     recent sequence. */
  const contractions = allContractions.slice(-VCP_MAX_CONTRACTIONS);
  const depths = contractions.map(c => c.depthPct);

  const firstDepth = depths[0];
  const finalDepth = depths[depths.length - 1];

  const baseStartLocal = contractions[0].fromIndex;
  const baseStartIndex = bars.length - window.length + baseStartLocal;
  const baseSlice = window.slice(baseStartLocal);
  const baseHigh = Math.max(...baseSlice.map(b => b.h));
  const baseLow = Math.min(...baseSlice.map(b => b.l));

  const price = bars[bars.length - 1].c;
  const pivot = contractions[contractions.length - 1].high;
  const pctToPivot = pivot > 0 ? ((pivot - price) / price) * 100 : null;

  // Prior advance: from the lowest low before the base to the base high.
  const priorStart = Math.max(0, baseStartIndex - PRIOR_MOVE_LOOKBACK);
  const priorSlice = bars.slice(priorStart, baseStartIndex + 1);
  const priorLow = priorSlice.length ? Math.min(...priorSlice.map(b => b.l)) : null;
  const priorMovePct = priorLow && priorLow > 0
    ? ((baseHigh - priorLow) / priorLow) * 100
    : null;

  // Volume drying: base-window average against the prior equivalent span.
  const baseVol = baseSlice.length
    ? baseSlice.reduce((s, b) => s + (b.v || 0), 0) / baseSlice.length
    : 0;
  const priorVolSlice = bars.slice(
    Math.max(0, baseStartIndex - baseSlice.length),
    baseStartIndex
  );
  const priorVol = priorVolSlice.length
    ? priorVolSlice.reduce((s, b) => s + (b.v || 0), 0) / priorVolSlice.length
    : 0;
  const volumeDryingRatio = priorVol > 0 ? baseVol / priorVol : null;

  // Final leg volume against the first leg's — the within-base version of
  // the same question.
  const firstLegVol = contractions[0].avgVolume;
  const finalLegVol = contractions[contractions.length - 1].avgVolume;
  const finalLegVolumeRatio = firstLegVol > 0 ? finalLegVol / firstLegVol : null;

  const base = {
    contractions,
    contractionCount: contractions.length,
    depths,
    finalDepthPct: finalDepth,
    firstDepthPct: firstDepth,
    pivot,
    pctToPivot,
    baseStartIndex,
    baseLengthBars: bars.length - baseStartIndex,
    baseHigh,
    baseLow,
    priorMovePct,
    volumeDryingRatio,
    finalLegVolumeRatio,
    atrPct: atrP,
    pivotThresholdPct: threshold,
  };

  // ---- Validity gates ----------------------------------------------------
  if (firstDepth > VCP_MAX_FIRST_DEPTH) {
    return { ...base, valid: false, reason: `first leg ${firstDepth.toFixed(0)}% — a correction, not a base`, status: 'failed' };
  }

  if (finalDepth > VCP_MAX_FINAL_DEPTH) {
    return { ...base, valid: false, reason: `final leg ${finalDepth.toFixed(0)}% — still correcting`, status: 'failed' };
  }

  // Shallowing, with tolerance. Checked pairwise rather than first-to-last:
  // a base that goes 20 / 8 / 14 has widened again and is not contracting,
  // even though the last leg is shallower than the first.
  for (let i = 1; i < depths.length; i++) {
    if (depths[i] > depths[i - 1] * VCP_SHALLOWING_TOLERANCE) {
      return {
        ...base,
        valid: false,
        reason: `leg ${i + 1} (${depths[i].toFixed(0)}%) is not meaningfully shallower than leg ${i} (${depths[i - 1].toFixed(0)}%)`,
        status: 'failed',
      };
    }
  }

  if (priorMovePct != null && priorMovePct < VCP_MIN_PRIOR_MOVE) {
    return {
      ...base,
      valid: false,
      reason: `only ${priorMovePct.toFixed(0)}% advance into the base — no supply to absorb`,
      status: 'failed',
    };
  }

  // ---- Status ------------------------------------------------------------
  let status: VcpStatus;
  if (price > pivot) {
    status = 'breaking-out';
  } else if (pctToPivot != null && pctToPivot <= VCP_PIVOT_PROXIMITY_PCT) {
    status = 'pivot-ready';
  } else {
    status = 'forming';
  }

  return { ...base, valid: true, reason: null, status };
}

/* ---- Scoring ------------------------------------------------------------
   0-100, on the same grade lines as CNF and EP (A >= 70, B >= 50).

   CONTRACTION QUALITY CARRIES THE MOST because it is the pattern itself.
   Everything else is context that makes a valid pattern more or less worth
   trading; the shape is what makes it a VCP at all.

   RS is scored here but supplied by the caller — see the note on rawRsScore.
   It is weighted heavily because Minervini's own screen treats it as a hard
   gate rather than a nicety: a VCP in a laggard is a well-formed base in a
   stock nobody wants. */
export interface VcpScoreInput {
  vcp: VcpResult;
  rsRating: number | null;
  template: TrendTemplate | null;
}

export interface VcpScore {
  score: number;
  grade: 'A' | 'B' | 'C';
  breakdown: Record<string, number>;
}

export function scoreVcp(input: VcpScoreInput): VcpScore {
  const b: Record<string, number> = {};
  const { vcp, rsRating, template } = input;

  // --- Contraction quality (35) ---
  // Tightness of the final leg, which is the readiness signal.
  b.finalTightness = 0;
  if (vcp.finalDepthPct != null) {
    const d = vcp.finalDepthPct;
    if (d <= 5) b.finalTightness = 20;
    else if (d <= 8) b.finalTightness = 16;
    else if (d <= 11) b.finalTightness = 11;
    else if (d <= 15) b.finalTightness = 6;
  }

  // Degree of contraction across the whole base. Each leg roughly halving is
  // the textbook shape and scores full marks.
  b.contractionRatio = 0;
  if (vcp.firstDepthPct != null && vcp.finalDepthPct != null && vcp.firstDepthPct > 0) {
    const ratio = vcp.finalDepthPct / vcp.firstDepthPct;
    if (ratio <= 0.3) b.contractionRatio = 15;
    else if (ratio <= 0.45) b.contractionRatio = 12;
    else if (ratio <= 0.6) b.contractionRatio = 8;
    else if (ratio <= 0.85) b.contractionRatio = 4;
  }

  // --- Volume (20) ---
  // Drying volume across the base is the absorption signature. Without it a
  // contracting price is just a stock nobody is trading.
  b.volumeDrying = 0;
  if (vcp.volumeDryingRatio != null) {
    const r = vcp.volumeDryingRatio;
    if (r <= 0.55) b.volumeDrying = 12;
    else if (r <= 0.70) b.volumeDrying = 9;
    else if (r <= 0.85) b.volumeDrying = 5;
    else if (r <= 1.0) b.volumeDrying = 2;
  }

  b.finalLegVolume = 0;
  if (vcp.finalLegVolumeRatio != null) {
    const r = vcp.finalLegVolumeRatio;
    if (r <= 0.5) b.finalLegVolume = 8;
    else if (r <= 0.7) b.finalLegVolume = 6;
    else if (r <= 0.9) b.finalLegVolume = 3;
  }

  // --- RS Rating (25) ---
  // Minervini's floor is 70; he prefers 80-90+. Scored steeply because a
  // laggard with a perfect base is still a laggard.
  b.rsRating = 0;
  if (rsRating != null) {
    if (rsRating >= 90) b.rsRating = 25;
    else if (rsRating >= 80) b.rsRating = 20;
    else if (rsRating >= 70) b.rsRating = 13;
    else if (rsRating >= 60) b.rsRating = 5;
    else b.rsRating = -8;
  }

  // --- Trend Template (12) ---
  b.trendTemplate = 0;
  if (template) {
    const frac = template.passed / template.total;
    if (frac === 1) b.trendTemplate = 12;
    else if (frac >= 0.85) b.trendTemplate = 8;
    else if (frac >= 0.7) b.trendTemplate = 4;
    else b.trendTemplate = -6;
  }

  // --- Base maturity (8) ---
  // Minervini's guidance is a base of at least three weeks. Shorter ones can
  // work but fail more often — not enough time has passed for supply to
  // actually change hands.
  b.baseLength = 0;
  if (vcp.baseLengthBars != null) {
    const n = vcp.baseLengthBars;
    if (n >= 25) b.baseLength = 8;
    else if (n >= 15) b.baseLength = 6;
    else if (n >= 10) b.baseLength = 3;
    else b.baseLength = -4;
  }

  // --- Contraction count bonus ---
  // Three or four legs is the sweet spot: enough repetitions to prove supply
  // is thinning, not so many that the base has become a stalled range.
  b.legCount = 0;
  if (vcp.contractionCount === 3 || vcp.contractionCount === 4) b.legCount = 5;
  else if (vcp.contractionCount === 2) b.legCount = 2;
  else if (vcp.contractionCount >= 5) b.legCount = -3;

  const raw = Object.values(b).reduce((s, v) => s + v, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  const grade: 'A' | 'B' | 'C' = score >= 70 ? 'A' : score >= 50 ? 'B' : 'C';

  return { score, grade, breakdown: b };
}

export const VCP_SCORE_LABELS: Record<string, string> = {
  finalTightness: 'Final contraction tightness',
  contractionRatio: 'Degree of contraction',
  volumeDrying: 'Volume drying across base',
  finalLegVolume: 'Final leg volume',
  rsRating: 'RS Rating',
  trendTemplate: 'Trend Template',
  baseLength: 'Base maturity',
  legCount: 'Contraction count',
};
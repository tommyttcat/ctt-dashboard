// lib/indicators/stage.ts
//
// Weinstein Stage Analysis with sub-stages.
//
// The four stages come from the 150-SMA (30-week) slope. The SUB-stage comes
// from where price sits relative to the shorter averages, and it's the part
// that actually changes decisions:
//
//   2A — advancing, above the 30 SMA. The buy zone.
//   2B — advancing, below the 30 but above the 50. Still fine, losing thrust.
//   2C — advancing, below the 50 SMA. Technically Stage 2, actually sagging.
//        THIS is the one worth having: it looks healthy in a scan (slope is
//        still positive, price is still above the 150) while the stock quietly
//        rolls over. Without the letter, 2C is indistinguishable from 2A.
//
//   4A — early decline, 4B — mature decline, 4C — bear-market rally.
//   1A/1B, 3A/3B — early vs mature basing / topping.
//
// PRIMARY STAGE LOGIC IS UNCHANGED from what the four scan routes already
// used (1.5% slope over 20 days, plus a price-vs-150SMA confirmation). Only
// the letter is new, so no row changes its stage NUMBER on deploy.
//
// Note: the VPCI 92 Pine uses a 0.5% slope threshold and no price check, so
// its stage numbers can disagree with the dashboard's on borderline names.
// Reconciling the two is a deliberate call, not a bug fix — left alone here.

export interface StageBar {
  c: number;
}

export type BarOrder = 'asc' | 'desc';

export interface StageOptions {
  /** Bar ordering of the input. 'asc' = oldest first. Default 'asc'. */
  order?: BarOrder;
  /**
   * Current price. Defaults to the most recent close. Pass the live snapshot
   * price during a session so the sub-stage reflects the intraday print
   * rather than yesterday's close.
   */
  price?: number;
}

export interface StageResult {
  /** 1-4, or 0 when there isn't enough history. */
  stage: number;
  /** 'A' | 'B' | 'C', or '' when unresolved. */
  sub: string;
  /** e.g. "Stage 2C" — the string the scan routes store. */
  label: string;
  /** e.g. "2C" — what the STAGE column renders. */
  short: string;
  /** One-line explanation for the column tooltip. */
  description: string;
  /** 150-SMA slope over 20 bars, in percent. Positive = advancing. */
  slopePct: number | null;
}

const UNRESOLVED: StageResult = {
  stage: 0,
  sub: '',
  label: '-',
  short: '—',
  description: 'Insufficient history for stage analysis',
  slopePct: null,
};

const DESCRIPTIONS: Record<string, string> = {
  '1A': 'Stage 1A — early basing, price below the 150 SMA',
  '1B': 'Stage 1B — mature basing, price reclaiming the 150 SMA',
  '2A': 'Stage 2A — strong advance, above the 30 SMA',
  '2B': 'Stage 2B — mature advance, below the 30 but holding the 50',
  '2C': 'Stage 2C — pullback inside an uptrend, below the 50 SMA',
  '3A': 'Stage 3A — early topping, still above the 150 SMA',
  '3B': 'Stage 3B — mature topping, lost the 150 SMA',
  '4A': 'Stage 4A — early decline',
  '4B': 'Stage 4B — mature decline, below the 50 and the 150',
  '4C': 'Stage 4C — bear-market rally, above the 50 but below the 150',
};

/** Trailing SMA of `period` closes ending `offset` bars back from the newest. */
function smaAt(closesAsc: number[], period: number, offset = 0): number | null {
  const end = closesAsc.length - offset;
  if (end < period) return null;
  let sum = 0;
  for (let i = end - period; i < end; i++) sum += closesAsc[i];
  return sum / period;
}

/**
 * Full Weinstein stage with sub-stage.
 * Needs ~210 bars; returns UNRESOLVED below that rather than guessing.
 */
export function computeStageDetail(
  bars: StageBar[] | number[] | null | undefined,
  opts: StageOptions = {}
): StageResult {
  const { order = 'asc', price } = opts;

  if (!Array.isArray(bars) || bars.length === 0) return UNRESOLVED;

  // Accept either a bar array or a bare close array.
  const raw: number[] = typeof bars[0] === 'number'
    ? (bars as number[])
    : (bars as StageBar[]).map(b => b?.c);

  const closesAsc = order === 'desc' ? raw.slice().reverse() : raw;

  // Filter out any null/NaN closes rather than aborting entirely — a few
  // bad bars in a 350-bar series shouldn't blank the stage column.
  const cleanAsc = closesAsc.filter(c => c != null && isFinite(c));
  if (cleanAsc.length < 60) return UNRESOLVED;
  const closesClean = cleanAsc;

  const px = price != null && isFinite(price) ? price : closesClean[closesClean.length - 1];

  // Short-history fallback: use 50-SMA slope when <210 bars but >=60.
  if (closesClean.length < 210) {
    const sma50s = smaAt(closesClean, 50, 0);
    const sma50s_10 = smaAt(closesClean, 50, 10);
    const sma20s = smaAt(closesClean, 20, 0);
    if (!sma50s || !sma50s_10 || !sma20s) return UNRESOLVED;
    const slope50 = (sma50s - sma50s_10) / sma50s_10;
    let stage = 0, sub = '';
    if (slope50 > 0.01 && px > sma50s) {
      stage = 2;
      sub = px > sma20s ? 'A' : 'C';
    } else if (slope50 < -0.01 && px < sma50s) {
      stage = 4;
      sub = px < sma20s ? 'B' : 'A';
    } else if (slope50 >= 0) {
      stage = 3; sub = px > sma50s ? 'A' : 'B';
    } else {
      stage = 1; sub = px < sma50s ? 'A' : 'B';
    }
    const short = `${stage}${sub}`;
    return { stage, sub, label: `Stage ${short}`, short, description: DESCRIPTIONS[short] || `Stage ${short}`, slopePct: Math.round(slope50 * 10000) / 100 };
  }

  const sma150 = smaAt(closesClean, 150, 0);
  const sma150_20d = smaAt(closesClean, 150, 20);
  const sma150_60d = smaAt(closesClean, 150, 60);
  const sma50 = smaAt(closesClean, 50, 0);
  const sma30 = smaAt(closesClean, 30, 0);

  if (!sma150 || !sma150_20d || !sma150_60d || !sma50 || !sma30) return UNRESOLVED;

  // Slope of the 150 SMA over the last 20 sessions, as a fraction.
  const slope = (sma150 - sma150_20d) / sma150_20d;
  const slopePct = Math.round(slope * 10000) / 100;

  let stage = 0;
  let sub = '';

  if (slope > 0.015 && px > sma150) {
    // --- STAGE 2: advancing ---
    stage = 2;
    if (px > sma30) sub = 'A';        // riding the fast average — the buy zone
    else if (px > sma50) sub = 'B';   // slipped off the 30, still constructive
    else sub = 'C';                   // below the 50 — sagging inside an uptrend
  } else if (slope < -0.015 && px < sma150) {
    // --- STAGE 4: declining ---
    stage = 4;
    if (px < sma50 && sma50 < sma150) sub = 'B';        // full breakdown
    else if (px < sma150 && px > sma50) sub = 'C';      // rally into resistance
    else sub = 'A';                                     // early decline
  } else if (sma150_20d > sma150_60d) {
    // --- STAGE 3: topping (150 still rising over the longer window) ---
    stage = 3;
    sub = px > sma150 ? 'A' : 'B';
  } else {
    // --- STAGE 1: basing ---
    stage = 1;
    sub = px < sma150 ? 'A' : 'B';
  }

  const short = `${stage}${sub}`;
  return {
    stage,
    sub,
    label: `Stage ${short}`,
    short,
    description: DESCRIPTIONS[short] || `Stage ${short}`,
    slopePct,
  };
}

/** Convenience wrapper — returns just the label the routes store in KV. */
export function computeStage(
  bars: StageBar[] | number[] | null | undefined,
  opts: StageOptions = {}
): string {
  return computeStageDetail(bars, opts).label;
}

/**
 * Display helpers, shared so every table colours stages identically.
 *
 * The ladder reads as a traffic signal around the trade:
 *   1 blue   — basing. Not a trade yet, but the one worth watching.
 *   2 green  — uptrend. Go.
 *   3 amber  — topping.
 *   4 rose   — decline.
 *
 * 2C is deliberately amber rather than green: it IS Stage 2, but it's the
 * sub-stage where the trade has stopped working. 4C gets orange for the same
 * reason in reverse — still Stage 4, but the part where it may be turning.
 */
export function stageColor(stage: string | null | undefined): string {
  if (!stage || stage === '-' || stage === '—') return 'text-slate-500';
  const s = String(stage).replace(/Stage\s*/i, '').trim().toUpperCase();

  if (s.startsWith('2')) {
    if (s === '2C') return 'text-amber-400';
    if (s === '2B') return 'text-emerald-300';
    return 'text-emerald-400';
  }
  if (s.startsWith('4')) {
    if (s === '4C') return 'text-orange-400';
    return 'text-rose-400';
  }
  if (s.startsWith('3')) return 'text-amber-400';
  if (s.startsWith('1')) return 'text-sky-400';
  return 'text-slate-500';
}

/* Badge form — the tinted pill the tables render, matching rsBadge in
   indicators/rs.ts and cnfBadgeCls in indicators/columnColors.ts. A pill gives
   the column a constant footprint whatever the label's width, which is what
   keeps STG and RS aligned down the table; bare text of varying length does
   not.

   ⚠️ Written out longhand rather than derived from stageColor's output.
   Tailwind compiles the classes it can SEE as literal strings in the source,
   so a template like `bg-${hue}-500/10` produces markup referencing CSS that
   was never generated — the badge renders transparent and nothing errors.
   Keep the two functions in step by hand. */
export function stageBadge(stage: string | null | undefined): string {
  if (!stage || stage === '-' || stage === '—') return 'bg-white/[0.02] text-slate-600 border-white/5';
  const s = String(stage).replace(/Stage\s*/i, '').trim().toUpperCase();

  if (s.startsWith('2')) {
    if (s === '2C') return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    if (s === '2B') return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20';
    return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
  }
  if (s.startsWith('4')) {
    if (s === '4C') return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
    return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
  }
  if (s.startsWith('3')) return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
  if (s.startsWith('1')) return 'bg-sky-500/10 text-sky-400 border-sky-500/20';
  return 'bg-white/[0.02] text-slate-600 border-white/5';
}

/** Hex equivalent of stageColor, for the email, which cannot use classes. */
export function stageHex(stage: string | null | undefined): string {
  if (!stage || stage === '-' || stage === '—') return '#64748b';
  const s = String(stage).replace(/Stage\s*/i, '').trim().toUpperCase();

  if (s.startsWith('2')) {
    if (s === '2C') return '#fbbf24';
    if (s === '2B') return '#6ee7b7';
    return '#34d399';
  }
  if (s.startsWith('4')) {
    if (s === '4C') return '#fb923c';
    return '#fb7185';
  }
  if (s.startsWith('3')) return '#fbbf24';
  if (s.startsWith('1')) return '#38bdf8';
  return '#64748b';
}

/** "Stage 2C" -> "2C". Handles the legacy '-' sentinel. */
export function stageShort(stage: string | null | undefined): string {
  if (!stage || stage === '-' || stage === '—') return '—';
  return String(stage).replace(/Stage\s*/i, '').trim();
}

/** Tooltip text for a stored stage label. */
export function stageDescription(stage: string | null | undefined): string {
  const s = stageShort(stage);
  if (s === '—') return 'Stage unavailable — insufficient history';
  return DESCRIPTIONS[s.toUpperCase()] || `Stage ${s}`;
}
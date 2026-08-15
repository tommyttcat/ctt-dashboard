/* Table column colouring — the ladders every scan table paints its numbers
 * with, and the CNF grade cutoffs.
 *
 * These had no shared home. `getAdrColor` existed in five components,
 * `getStochColor` in six, the grade ladder in eight-plus files including two
 * API routes and the email. The canonical ladders were documented only as
 * prose inside scanConfig's COLUMN_NOTES, which the components then re-encoded
 * by hand — so the documentation and the behaviour were separate artifacts
 * that could disagree, and did.
 *
 * Where a surface intentionally differs (EP9M floors at 3x RVOL, so its ladder
 * starts higher) that variant is exported by name rather than left as a local
 * copy that looks like drift.
 */

/* ---- CNF score / grade ---------------------------------------------------

   70 and 50 are the same cutoffs the scoring routes use to stamp the letter,
   so a badge colour and a grade letter can never disagree. */
export const GRADE_A_MIN = 70;
export const GRADE_B_MIN = 50;

export type Grade = 'A' | 'B' | 'C';

export const gradeOf = (score: number | null | undefined): Grade | null => {
  if (score == null) return null;
  return score >= GRADE_A_MIN ? 'A' : score >= GRADE_B_MIN ? 'B' : 'C';
};

/** Badge classes for a numeric CNF score. */
export function cnfBadgeCls(score: number | null | undefined): string {
  if (score == null) return 'bg-zinc-800/50 text-zinc-400 border-zinc-700/50';
  if (score >= GRADE_A_MIN) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
  if (score >= GRADE_B_MIN) return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
  return 'bg-zinc-800/50 text-zinc-400 border-zinc-700/50';
}

/* ---- Ticker chip --------------------------------------------------------

   The grade used to be carried only by the score badge, three columns from
   the name it described — so the thing your eye actually lands on, the
   ticker, was the one cell with no read on it. The chip now takes the grade
   tint and the score renders as a plain number, the same trade the briefing
   panel already made when its grade column was folded into the chip.

   Palette matches MarketSummary's TICKER_CHIP_A/B exactly; a scan table and
   the briefing must not disagree about what an A looks like. Sizing is the
   table chip's (11px, px-1.5 py-0.5) rather than the briefing's inline 9px. */
const TICKER_CHIP_BASE = 'inline-block text-[7px] font-bold tracking-wider px-1 py-[1px] rounded border';

export function tickerChipCls(grade: Grade | string | null | undefined): string {
  if (grade === 'A') return `${TICKER_CHIP_BASE} bg-emerald-500/10 text-emerald-300 border-emerald-400/30`;
  if (grade === 'B') return `${TICKER_CHIP_BASE} bg-amber-500/10 text-amber-300 border-amber-400/30`;
  return `${TICKER_CHIP_BASE} bg-slate-500/10 text-slate-300 border-white/10`;
}

/** Same chip, for the tables that hold a raw score rather than a letter. */
export const tickerChipForScore = (score: number | null | undefined): string =>
  tickerChipCls(gradeOf(score));

/** Appends the grade to a ticker's hover text, so the colour is never mute. */
export function tickerTitle(name: string | null | undefined, ticker: string, score: number | null | undefined): string {
  const base = name || ticker;
  const g = gradeOf(score);
  return g == null ? base : `${base} — Grade ${g} (${score})`;
}

/* The score cell — a bordered pill carrying the grade colour, the shape the
   Dollar Volume board uses.

   It went plain when the grade moved onto the ticker, on the reasoning that
   one signal should live in one place. Reverted 13 Aug 2026 at the user's
   request after seeing both side by side: the pill reads as a score you can
   scan down a column, and the tint on the ticker reads as a property of the
   name. Carrying the grade twice is the intent, not an oversight. */
export const scoreCellCls = (score: number | null | undefined): string =>
  `inline-block px-1 py-[1px] rounded border text-[9px] font-bold tabular-nums cursor-help ${cnfBadgeCls(score)}`;

/** Text colour for a grade letter. */
export function gradeColor(grade: Grade | string | null | undefined): string {
  if (grade === 'A') return 'text-emerald-400';
  if (grade === 'B') return 'text-amber-400';
  return 'text-slate-500';
}

/** Hex equivalents, for the email. */
export function gradeHex(grade: Grade | string | null | undefined): string {
  if (grade === 'A') return '#34d399';
  if (grade === 'B') return '#fbbf24';
  return '#64748b';
}

export function cnfHex(score: number | null | undefined): string {
  if (score == null) return '#94a3b8';
  if (score >= GRADE_A_MIN) return '#34d399';
  if (score >= GRADE_B_MIN) return '#fbbf24';
  return '#94a3b8';
}

/* Hex equivalents of the Tailwind ladders below, for the email — mail clients
   have no Tailwind, and the briefing email is meant to be the analyst page in
   an inbox. Same thresholds, same colours: a number must not change meaning
   between the two surfaces. Keep each in step with its class-based twin. */
export function rvolHex(v: number | null | undefined): string {
  if (v == null) return '#64748b';
  if (v >= 2) return '#fbbf24';
  if (v >= 1.5) return '#34d399';
  return '#64748b';
}

/* Mirrors rsColor in indicators/rs.ts — 90 purple, 80 green, 70 slate, red
   below the floor. */
export function rsHex(rs: number | null | undefined): string {
  if (rs == null) return '#64748b';
  if (rs >= 90) return '#c084fc';
  if (rs >= 80) return '#34d399';
  if (rs >= 70) return '#cbd5e1';
  return '#fb7185';
}

/* ---- ADR % --------------------------------------------------------------
   Purple >= 10% - green >= 5% - grey >= 3%. */
export function adrColor(a: number | null | undefined): string {
  if (a == null) return 'text-slate-500';
  if (a >= 10) return 'text-purple-400';
  if (a >= 5) return 'text-emerald-400';
  if (a >= 3) return 'text-slate-300';
  return 'text-slate-500';
}

/* ---- Stochastic %K ------------------------------------------------------
   Purple <= 20 - green <= 30. Low is good: it is room to run, not weakness. */
export function stochColor(k: number | null | undefined): string {
  if (k == null) return 'text-slate-500';
  if (k <= 20) return 'text-purple-400';
  if (k <= 30) return 'text-emerald-400';
  return 'text-slate-400';
}

/* ---- RVOL ---------------------------------------------------------------
   Amber >= 2x - green >= 1.5x. Amber is the louder colour here because
   very high relative volume is as often a blow-off as a breakout. */
export function rvolColor(v: number | null | undefined): string {
  if (v == null) return 'text-slate-500';
  if (v >= 2) return 'text-amber-400';
  if (v >= 1.5) return 'text-emerald-400';
  return 'text-slate-500';
}

/* EP9M's own floor is 3x, so the standard ladder would paint every row amber
   and say nothing. This one starts where that table's data actually begins. */
export function rvolColorHighFloor(v: number | null | undefined): string {
  if (v == null) return 'text-slate-500';
  if (v >= 10) return 'text-fuchsia-400';
  if (v >= 7) return 'text-purple-400';
  if (v >= 5) return 'text-emerald-400';
  return 'text-lime-400';
}

/* The 100-bagger screen runs on small, thinly traded names where 2x relative
   volume is already a real event. Reading them against the standard ladder
   would call almost the whole table quiet. */
export function rvolColorLowFloor(v: number | null | undefined): string {
  if (v == null) return 'text-slate-500';
  if (v >= 3) return 'text-fuchsia-400';
  if (v >= 2) return 'text-emerald-400';
  if (v >= 1.5) return 'text-lime-400';
  if (v >= 1) return 'text-slate-300';
  return 'text-slate-500';
}

/* ---- Days to cover ------------------------------------------------------
   Purple >= 5 - green >= 3 - grey >= 1.5. */
export function dtcColor(d: number | null | undefined): string {
  if (d == null) return 'text-slate-500';
  if (d >= 5) return 'text-purple-400';
  if (d >= 3) return 'text-emerald-400';
  if (d >= 1.5) return 'text-slate-300';
  return 'text-slate-500';
}

/* ---- Float --------------------------------------------------------------
   Purple <= 20M - green <= 50M. Small float means a move can go further on
   the same dollars. */
export function floatColor(f: number | null | undefined): string {
  if (f == null) return 'text-slate-500';
  if (f <= 20_000_000) return 'text-purple-400';
  if (f <= 50_000_000) return 'text-emerald-400';
  return 'text-slate-300';
}

/* ---- Change % ----------------------------------------------------------- */
export const changeColor = (v: number): string => (v >= 0 ? 'text-emerald-400' : 'text-rose-400');
export const changeHex = (v: number): string => (v >= 0 ? '#34d399' : '#fb7185');

/* ---- Ready / Forming ----------------------------------------------------

   The rule `readinessTooltip` in state.ts describes. It was implemented
   independently in the scanner route and three components; the constants
   agreed, but nothing made them. */
export const READY_MAX_STOCH = 25;
export const READY_MAX_DIST_EMA21 = 2.5;

export function isReady(stochK: number | null | undefined, distToEma21: number | null | undefined): boolean {
  if (stochK == null || distToEma21 == null) return false;
  return stochK <= READY_MAX_STOCH && Math.abs(distToEma21) <= READY_MAX_DIST_EMA21;
}

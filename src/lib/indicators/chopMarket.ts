/* Market-level CHOP — the composite reading, its sensitivity bands, and the
 * zone vocabulary that turns a number into a word.
 *
 * NOT the same thing as `./chop.ts`. That module measures a single ticker's
 * Choppiness Index and labels it against fixed 61.8/38.2 thresholds for the
 * per-ticker scan tables. This module is the market-wide reading shown on the
 * dashboard scorecard, the analyst page, and the briefing email — a blended
 * QQQ/SPY value adjusted by breadth, read against a user-selectable band set.
 * The split is deliberate: filtering a stock list and describing the tape are
 * different jobs. What was NOT deliberate is that the three market surfaces
 * each carried their own copy of the math below, with different modifier caps
 * and one of them missing a modifier outright, so the same payload produced
 * three different numbers. That is what this module ends.
 */

export type ChopMode = 'asis' | 'med' | 'strong' | 'extreme';

export interface ChopBands {
  chop: number;
  trend: number;
  dead: number;
  extreme: number;
  strongTrend: number;
  label: string;
  blurb: string;
}

export const CHOP_MODES: ChopMode[] = ['asis', 'med', 'strong', 'extreme'];
export const DEFAULT_CHOP_MODE: ChopMode = 'extreme';

/* The upper bands are derived rather than declared so a sensitivity change
   moves the whole ladder together. Only the chop/trend pair is a judgement
   call; dead/extreme/strongTrend follow from it. */
const DEAD_OFFSET = 8;
const EXTREME_OFFSET = 16;
const STRONG_TREND_OFFSET = 8;

const makeBands = (chop: number, trend: number, label: string, blurb: string): ChopBands => ({
  chop,
  trend,
  dead: chop + DEAD_OFFSET,
  extreme: chop + EXTREME_OFFSET,
  strongTrend: trend - STRONG_TREND_OFFSET,
  label,
  blurb,
});

export const CHOP_BANDS: Record<ChopMode, ChopBands> = {
  asis: makeBands(
    61.8,
    38.2,
    'AS IS',
    'Textbook Fibonacci bands — 61.8 and 38.2, the thresholds the Choppiness Index shipped with. Conventional rather than derived.'
  ),
  med: makeBands(
    55,
    33,
    'MED',
    'Chop called at 55. On a 14-bar window that is roughly where price has travelled more than three times the ground it covered — the practical signature of a range handing back its moves.'
  ),
  strong: makeBands(
    50,
    28,
    'STRONG',
    'Chop called at dead centre. Above 50 the tape spends more effort than it gains, so anything not decisively directional reads as chop. Expect CHOPPY most days.'
  ),
  extreme: makeBands(
    45,
    23,
    'EXTREME',
    'Maximum chop sensitivity. Anything above 45 is called choppy — only a decisively directional tape passes this filter. Use when you want to avoid marginal setups entirely.'
  ),
};

export const bandsFor = (mode: string | null | undefined): ChopBands =>
  CHOP_BANDS[(mode as ChopMode)] ?? CHOP_BANDS[DEFAULT_CHOP_MODE];

/* ---- Composite -----------------------------------------------------------

   The raw blended Choppiness value is a price measurement only. These two
   modifiers add what price alone cannot see: whether the move had the market
   behind it. Both push toward "choppier" when the internals are ambiguous.

   THE SENSITIVITY SETTING DOES NOT TOUCH THIS. The composite is the
   measurement; the bands are the interpretation. Letting the setting reach
   into the modifier weights would mean the number itself changed when you
   changed how you read it.

   IT IS ALSO NOT APPLIED TO THE INTRADAY LEG. Breadth and the high/low line
   are daily measures; using them to adjust a 3.5-hour reading would import
   three weeks of context into a number whose entire job is to be current. */
export const CHOP_MODIFIER_CAP = 12;

export interface ChopBreadthInput {
  score?: number | null;
  newHighs?: number | null;
  newLows?: number | null;
}

export function chopComposite(raw: number | null, breadth: ChopBreadthInput | null): number | null {
  if (raw == null) return null;

  let adj = 0;

  // Breadth centrality — 3/6 is dead centre and maximally uninformative.
  if (breadth && typeof breadth.score === 'number') {
    const centrality = 1 - Math.abs(breadth.score - 3) / 3;
    adj += (centrality - 0.5) * 2 * CHOP_MODIFIER_CAP;
  }

  // High/low balance — highs ~ lows is the structural signature of churn.
  const nh = breadth?.newHighs ?? 0;
  const nl = breadth?.newLows ?? 0;
  if (nh > 0 || nl > 0) {
    const highsShare = (nh / (nh + nl)) * 100;
    const balance = 1 - Math.abs(highsShare - 50) / 50;
    adj += (balance - 0.5) * 2 * CHOP_MODIFIER_CAP;
  }

  return Math.max(0, Math.min(100, raw + adj));
}

/** Pulls the raw blended value out of an /api/chop payload, nested or flat. */
export const rawChopOf = (chop: any): number | null =>
  chop?.daily?.blended ?? chop?.blended ?? null;

/* ---- Zones --------------------------------------------------------------- */

export function chopZoneLabel(v: number | null, b: ChopBands): string {
  if (v == null) return 'NO DATA';
  if (v >= b.extreme) return 'EXTREME';
  if (v >= b.dead) return 'DEAD CHOP';
  if (v >= b.chop) return 'CHOPPY';
  if (v > b.trend) return 'MIXED';
  if (v > b.strongTrend) return 'TRENDING';
  return 'STRONG TREND';
}

/** Tailwind text class — for the React surfaces. */
export function chopTextColor(v: number | null, b: ChopBands): string {
  if (v == null) return 'text-slate-500';
  if (v >= b.extreme) return 'text-fuchsia-400';
  if (v >= b.dead) return 'text-rose-400';
  if (v >= b.chop) return 'text-amber-400';
  if (v > b.trend) return 'text-slate-300';
  if (v > b.strongTrend) return 'text-emerald-400';
  return 'text-teal-300';
}

/** Hex equivalent of chopTextColor — for the email, which cannot use classes. */
export function chopHexColor(v: number | null, b: ChopBands): string {
  if (v == null) return '#64748b';
  if (v >= b.extreme) return '#e879f9';
  if (v >= b.dead) return '#fb7185';
  if (v >= b.chop) return '#fbbf24';
  if (v > b.trend) return '#cbd5e1';
  if (v > b.strongTrend) return '#34d399';
  return '#5eead4';
}

export function chopBadgeBg(v: number | null, b: ChopBands): string {
  if (v == null) return 'bg-slate-500/10 border-white/10';
  if (v >= b.extreme) return 'bg-fuchsia-500/10 border-fuchsia-500/20';
  if (v >= b.dead) return 'bg-rose-500/10 border-rose-500/20';
  if (v >= b.chop) return 'bg-amber-500/10 border-amber-500/20';
  if (v > b.trend) return 'bg-slate-500/10 border-white/10';
  return 'bg-emerald-500/10 border-emerald-500/20';
}

/* Scorecard cell tone — a deliberately coarser read than the six-tier palette
   above. DEAD CHOP and EXTREME collapse to the same red because on a bare
   cell both mean the same thing: stop trading breakouts. Everything below the
   chop line reads green, MIXED included, because the cell has no bar or
   midpoint next to it to give a third colour any meaning. */
export type CellTone = 'green' | 'amber' | 'red' | 'slate';

export function chopCellTone(v: number | null, b: ChopBands): CellTone {
  if (v == null) return 'slate';
  if (v >= b.dead) return 'red';
  if (v >= b.chop) return 'amber';
  return 'green';
}

/* ---- Verdicts and notes --------------------------------------------------

   One line, tooltip only. This is the only place the chop reading gives an
   instruction — the strip itself is measurement, the same split the tone
   narrative uses. */
export function chopVerdict(v: number | null, b: ChopBands): string {
  if (v == null) return '';
  if (v >= b.extreme) return 'Extreme chop. The tape is handing back every move — no edge exists. Do not trade breakouts.';
  if (v >= b.dead) return 'Nothing is trending. Breakout triggers will fire and reverse — sit out or trade the range.';
  if (v >= b.chop) return 'Consolidation regime. Expect failed breakouts; favour reversals at range edges.';
  if (v > b.trend) return 'No clear regime edge. Setup quality has to carry the trade on its own.';
  if (v > b.strongTrend) return 'Trending tape. Breakouts have follow-through — triggers are worth taking.';
  return 'Strong trend. This is the regime breakout entries are built for.';
}

/* The QQQ/SPY spread is the rotation tell. 6 points is roughly where the two
   benchmarks stop describing the same market. Tooltip wording only. */
export const CHOP_SPREAD_NOTABLE = 6;

export function chopSpreadNote(qqq: number | null, spy: number | null): string {
  if (qqq == null || spy == null) return '';
  const gap = spy - qqq;
  const abs = Math.abs(gap).toFixed(1);
  if (Math.abs(gap) < CHOP_SPREAD_NOTABLE) {
    return `Benchmark spread ${abs} pts — QQQ and SPY describe the same tape.`;
  }
  return gap > 0
    ? `Benchmark spread ${abs} pts — the Nasdaq is trending better than the broad market, which favours momentum names.`
    : `Benchmark spread ${abs} pts — the broad market is trending better than the Nasdaq; growth leadership is the weaker side.`;
}

/* Every setting's verdict on the current composite, so the active one can
   never hide what the others would say. A reading of 52 is MIXED at AS IS
   and CHOPPY at STRONG — seeing that disagreement is how you work out which
   setting you actually believe. */
export function chopAllBandsNote(v: number | null, active: ChopMode): string {
  if (v == null) return '';
  const lines: string[] = ['Same reading, all four settings:'];
  for (const m of CHOP_MODES) {
    const b = CHOP_BANDS[m];
    const mark = m === active ? '▸' : ' ';
    lines.push(`${mark} ${b.label.padEnd(6)} ${chopZoneLabel(v, b).padEnd(13)} (chop ≥ ${b.chop}, trend ≤ ${b.trend})`);
  }
  return lines.join('\n');
}

/* ---- Divergence ----------------------------------------------------------

   The whole reason the intraday leg exists. Four states, and only one of them
   is a call to act.

   SIGN CONVENTION: positive gap means the DAILY reading is higher — the
   three-week backdrop is choppier than the last few hours. That is the
   range-starting-to-break case, so the interesting direction is positive. */
export type DivergenceTone = 'break' | 'digest' | 'aligned-chop' | 'aligned-trend' | 'none';

export interface DivergenceRead {
  label: string;
  detail: string;
  tone: DivergenceTone;
}

/* How far apart the daily and intraday readings must sit before the gap is
   called a divergence rather than noise. 8 points is a little over half the
   width of the MIXED band at AS IS — wide enough that the two timeframes are
   genuinely disagreeing, narrow enough to catch a break on the session it
   starts. */
export const CHOP_DIVERGENCE_MIN = 8;

export function divergenceOf(daily: number | null, intra: number | null, b: ChopBands): DivergenceRead {
  if (daily == null || intra == null) {
    return { label: '', detail: '', tone: 'none' };
  }

  const dailyChoppy = daily >= b.chop;
  const dailyTrending = daily <= b.trend;
  const intraChoppy = intra >= b.chop;
  const intraTrending = intra <= b.trend;
  const gap = daily - intra;

  if (dailyChoppy && intraTrending && gap >= CHOP_DIVERGENCE_MIN) {
    return {
      tone: 'break',
      label: 'RANGE BREAKING',
      detail: `The session is trending inside a backdrop that has not been. ${gap.toFixed(0)} points of separation — this is what a range starting to resolve looks like before the daily reading notices.`,
    };
  }

  if (dailyTrending && intraChoppy && -gap >= CHOP_DIVERGENCE_MIN) {
    return {
      tone: 'digest',
      label: 'DIGESTING',
      detail: 'The trend is intact on the daily but today is going nowhere. Read the pause as consolidation inside a trend, not as failure — do not exit on the intraday reading alone.',
    };
  }

  if (dailyChoppy && intraChoppy) {
    return {
      tone: 'aligned-chop',
      label: 'BOTH CHOPPY',
      detail: 'Neither timeframe is resolving. Nothing to press — this is the stand-down combination.',
    };
  }

  if (dailyTrending && intraTrending) {
    return {
      tone: 'aligned-trend',
      label: 'BOTH TRENDING',
      detail: 'Backdrop and session agree. Breakout entries have both timeframes behind them.',
    };
  }

  return {
    tone: 'none',
    label: 'NO DIVERGENCE',
    detail: `Daily and intraday are ${Math.abs(gap).toFixed(0)} points apart — not enough separation to read anything into.`,
  };
}

/* The intraday reading is only interesting while it is current. Past this the
   marker still renders — a Friday-afternoon reading is real information on a
   Sunday — but it is dimmed and labelled rather than left to imply it is
   live. */
export const INTRADAY_STALE_MINUTES = 90;

/* A 14-day Choppiness Index moves in tenths of a point per session. The
   original 0.5 dead-band was borrowed from the A/D strip, where the underlying
   ratio genuinely swings intraday, and applied to a metric with an order of
   magnitude less daily velocity. It would have printed flat every session. */
export const CHOP_TREND_BAND = 0.15;

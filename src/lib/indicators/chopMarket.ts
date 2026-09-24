/* Market-level CHOP — the composite reading, its sensitivity bands, and the
 * zone vocabulary that turns a number into a word.
 *
 * NOT the same thing as `./chop.ts`. That module measures a single ticker's
 * Choppiness Index and labels it against fixed 61.8/38.2 thresholds for the
 * per-ticker scan tables. This module is the market-wide reading shown on the
 * dashboard scorecard, the analyst page, and the briefing email — a blended
 * QQQ/SPY value (plus a 15-minute intraday leg when current), read against a
 * user-selectable band set. It is NOT adjusted by breadth: that was tried,
 * removed on 5 Sep 2026, and re-tested on 24 Sep — see chopComposite.
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
/* STANDARD, not MAX. Replayed over four years of daily bars (24 Sep 2026,
   scripts/backtest/analyze-chop.ts): MAX called the market choppy on 60% of
   days and trending on 1% — a reading that says the same thing nearly every
   day tells you nothing. STANDARD calls chop on ~5% and trending on ~18%, and
   its trending line (38.2) sits on the one measured edge: momentum breakouts
   did best on the most-trending fifth of days (<= 38.8). The key stays 'asis'
   because it is what KV stores. */
export const DEFAULT_CHOP_MODE: ChopMode = 'asis';

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

/* Labels are what the reader sees, so they are plain words for how eagerly
   the setting calls chop. The KEYS ('asis', 'med', ...) are what KV stores
   and must not change. Every frequency below was measured, not estimated:
   share of the 1,240 sessions from Oct 2021 to Sep 2026 in each zone. */
export const CHOP_BANDS: Record<ChopMode, ChopBands> = {
  asis: makeBands(
    61.8,
    38.2,
    'STANDARD',
    'Calls the market choppy only on the clearest ranges — about 1 day in 20 over four years — and trending on about 1 in 5. Its trending line is where momentum breakouts measurably did best.'
  ),
  med: makeBands(
    55,
    33,
    'SENSITIVE',
    'Calls the market choppy on about 1 day in 5, and trending on about 1 in 15.'
  ),
  strong: makeBands(
    50,
    28,
    'VERY SENSITIVE',
    'Calls the market choppy on about 2 days in 5, and trending almost never (2% of days).'
  ),
  extreme: makeBands(
    45,
    23,
    'MAX',
    'Calls the market choppy on 3 days in 5 and trending on 1% — so often that the reading stops telling you anything. Kept for comparison.'
  ),
};

export const bandsFor = (mode: string | null | undefined): ChopBands =>
  CHOP_BANDS[(mode as ChopMode)] ?? CHOP_BANDS[DEFAULT_CHOP_MODE];

/* ---- Composite -----------------------------------------------------------
   Pure price action: the blended daily Choppiness value, with the intraday
   leg blended in when current so the composite can reflect a regime shift
   the 14-day reading has not absorbed yet.

   NO BREADTH OR SESSION ADJUSTMENT, deliberately, and tested twice. Until
   5 Sep 2026 three modifiers moved the reading by up to +/-12 each: breadth
   balance, new highs vs new lows (the "rotation guard" — a rotation day
   looks like chop to an index), and the size of the day's move. Re-tested on
   24 Sep over four years (scripts/backtest/analyze-chop-rotation.ts): the
   raw reading put trending days above choppy days in both halves for 2 of 5
   scans; adding the rotation guard made it 1 of 5; all three, 2 of 5. It did
   not explain Swing doing best on "choppy" days either — that got stronger.
   The `_breadth` and `_session` slots stay only so existing callers compile;
   nothing reads them. Do not re-add the modifiers without re-running that. */
export const CHOP_INTRADAY_WEIGHT = 0.3;

export interface ChopBreadthInput {
  score?: number | null;
  newHighs?: number | null;
  newLows?: number | null;
}

export interface ChopIntradayInput {
  blended: number | null;
  stale: boolean;
}

export interface ChopSessionInput {
  qqqPct?: number | null;
  spyPct?: number | null;
}

export function chopComposite(
  raw: number | null,
  _breadth: ChopBreadthInput | null,
  intraday?: ChopIntradayInput | null,
  _session?: ChopSessionInput | null,
): number | null {
  if (raw == null) return null;

  let result = raw;

  // Blend intraday when current — the daily CI cannot see today's regime.
  if (intraday && intraday.blended != null && !intraday.stale) {
    result = result * (1 - CHOP_INTRADAY_WEIGHT) + intraday.blended * CHOP_INTRADAY_WEIGHT;
  }

  return Math.max(0, Math.min(100, result));
}

/** Pulls the raw blended value out of an /api/chop payload, nested or flat. */
export const rawChopOf = (chop: any): number | null =>
  chop?.daily?.blended ?? chop?.blended ?? null;

/* ---- Concordance boost ---------------------------------------------------
   When both the daily composite and the intraday leg land in the same zone,
   that agreement is information the blended average alone does not capture.
   A +5 push for BOTH CHOPPY makes a borderline 46 read 51 — clearly in chop
   rather than ambiguously on the line. The symmetric −5 for BOTH TRENDING
   rewards the same kind of agreement on the other side. */
export const CHOP_CONCORDANCE_BOOST = 5;

export function chopWithConcordance(
  composite: number | null,
  intraday: number | null,
  bands: ChopBands,
): number | null {
  if (composite == null || intraday == null) return composite;
  const bothChoppy = composite >= bands.chop && intraday >= bands.chop;
  const bothTrending = composite <= bands.trend && intraday <= bands.trend;
  if (bothChoppy) return Math.min(100, composite + CHOP_CONCORDANCE_BOOST);
  if (bothTrending) return Math.max(0, composite - CHOP_CONCORDANCE_BOOST);
  return composite;
}

/* ---- Zones --------------------------------------------------------------- */

export function chopZoneLabel(v: number | null, b: ChopBands): string {
  if (v == null) return 'NO DATA';
  if (v >= b.extreme) return 'EXTREMELY CHOPPY';
  if (v >= b.dead) return 'VERY CHOPPY';
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

export type CellTone = 'green' | 'amber' | 'red' | 'slate';

export function chopCellTone(v: number | null, b: ChopBands): CellTone {
  if (v == null) return 'slate';
  if (v >= b.dead) return 'red';
  if (v > b.trend) return 'amber';
  return 'green';
}

/* ---- Verdicts and notes --------------------------------------------------

   One line, tooltip only, and it says only what four years of replays
   support (24 Sep 2026, scripts/backtest/analyze-chop.ts):
     - Stocks in Play / Daily Setups and 10/21 did better on trending days
       than choppy ones, in both halves of the period.
     - Choppy days did NOT reliably hurt breakouts. Stocks in Play / Daily
       roughly broke even on them; Swing did BEST on them; VCP and HRS showed
       no link. Breakouts triggered just as often (76-79% in every fifth).
   So the old instructions — "do not trade breakouts", "sit out", "breakout
   triggers will fire and reverse" — are gone: they were never tested and the
   test does not back them. The choppy side describes; it does not instruct. */
export function chopVerdict(v: number | null, b: ChopBands): string {
  if (v == null) return '';
  if (v >= b.chop) return 'The market is going sideways. Over four years this did not reliably hurt breakouts — Stocks in Play and Daily Setups roughly broke even on days like this, and Swing did best on them. Context, not a reason to sit out.';
  if (v > b.trend) return 'No clear trend either way. The setup has to carry the trade on its own.';
  return 'The market is trending. Over four years, Stocks in Play, Daily Setups and 10/21 breakouts did best on days like this, in both halves of the period.';
}

/* The QQQ/SPY spread is the rotation tell. 6 points is roughly where the two
   benchmarks stop describing the same market. Tooltip wording only. */
export const CHOP_SPREAD_NOTABLE = 6;

export function chopSpreadNote(qqq: number | null, spy: number | null): string {
  if (qqq == null || spy == null) return '';
  const gap = spy - qqq;
  const abs = Math.abs(gap).toFixed(1);
  if (Math.abs(gap) < CHOP_SPREAD_NOTABLE) {
    return `The Nasdaq (QQQ) and S&P (SPY) readings are ${abs} points apart — they describe the same market.`;
  }
  return gap > 0
    ? `The Nasdaq (QQQ) is trending more cleanly than the S&P (SPY), ${abs} points apart.`
    : `The S&P (SPY) is trending more cleanly than the Nasdaq (QQQ), ${abs} points apart.`;
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
    lines.push(`${mark} ${b.label.padEnd(14)} ${chopZoneLabel(v, b).padEnd(16)} (choppy ≥ ${b.chop}, trending ≤ ${b.trend})`);
  }
  return lines.join('\n');
}

/* ---- Divergence ----------------------------------------------------------

   The whole reason the intraday leg exists. Descriptive only: there is no
   intraday history to test any of these against, so none of them instructs.

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
      detail: `Today is trending even though the last three weeks have gone sideways — ${gap.toFixed(0)} points apart. This is how a range starts to break, before the longer reading notices.`,
    };
  }

  if (dailyTrending && intraChoppy && -gap >= CHOP_DIVERGENCE_MIN) {
    return {
      tone: 'digest',
      label: 'PAUSING',
      detail: 'The longer trend is intact, but today is going sideways — a pause inside a trend rather than a failure of it.',
    };
  }

  if (dailyChoppy && intraChoppy) {
    return {
      tone: 'aligned-chop',
      label: 'BOTH CHOPPY',
      detail: 'Both the last three weeks and today are going sideways.',
    };
  }

  if (dailyTrending && intraTrending) {
    return {
      tone: 'aligned-trend',
      label: 'BOTH TRENDING',
      detail: 'Both the last three weeks and today are trending.',
    };
  }

  return {
    tone: 'none',
    label: 'IN LINE',
    detail: `The three-week and today's readings are ${Math.abs(gap).toFixed(0)} points apart — too close to mean anything.`,
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

/* When intraday is current, direction should reflect what's happening NOW
   (intra vs daily composite) rather than what happened yesterday (daily vs
   daily prev). A 15M at 61 with daily at 46 means chop is rising, even if
   the daily dropped since yesterday. The dead-band is wider here because
   intraday and daily are structurally different measurements. */
export const CHOP_INTRA_TREND_BAND = 4;

export function chopTrendOf(
  chopRaw: number | null,
  chopRawPrev: number | null,
  intraVal: number | null,
  intraStale: boolean,
  composite: number | null,
): 'up' | 'down' | 'flat' {
  if (intraVal != null && !intraStale && composite != null) {
    const gap = intraVal - composite;
    if (gap > CHOP_INTRA_TREND_BAND) return 'up';
    if (gap < -CHOP_INTRA_TREND_BAND) return 'down';
    return 'flat';
  }
  const delta = chopRaw != null && chopRawPrev != null ? chopRaw - chopRawPrev : null;
  if (delta == null || Math.abs(delta) < CHOP_TREND_BAND) return 'flat';
  return delta > 0 ? 'up' : 'down';
}

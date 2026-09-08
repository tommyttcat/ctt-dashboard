/* The market scorecard values — tone, T2108, breadth participation, high/low
 * balance, VIX. Everything the dashboard strip and the analyst page's 8-cell
 * grid render.
 *
 * These were previously written out separately in Scorecard.tsx,
 * AnalystBrief.tsx and the briefing email. Tone was three byte-identical
 * copies of a nine-constant formula. T2108 was worse: the two pages used the
 * same words for different ranges, so a reading of 28 was "OVERSOLD" on one
 * and "WASHED" on the other.
 */

import { isTradingDay } from '@/lib/marketCalendar';

export type CellTone = 'green' | 'amber' | 'red' | 'slate';

/* ---- Market tone ---------------------------------------------------------

   Weighted index move, with volatility and crypto as risk-appetite tells and
   breadth as a confirmation nudge. SPY carries the most weight, IWM the least
   — a small-cap-only move is not the market. VIX only counts when it moves
   more than 2%, below which it is noise; it is inverted, since rising fear is
   a bearish input. */
export interface ToneQuotes { [id: string]: { pct?: number | null } | undefined }

export function marketToneScore(
  getPct: (id: string) => number,
  breadthScore: number | null | undefined,
): number {
  const eqScore = (getPct('SPY') * 3.0) + (getPct('QQQ') * 2.5) + (getPct('IWM') * 1.0);
  const vixPct = getPct('VIX');
  const volScore = Math.abs(vixPct) > 2 ? (vixPct * -0.6) : 0;
  const cryptoScore = (getPct('BTC') * 0.25);
  const breadthAdj = typeof breadthScore === 'number' ? ((breadthScore - 3) / 3) * 1.5 : 0;
  return eqScore + volScore + cryptoScore + breadthAdj;
}

export type MarketTone = 'BULLISH' | 'NEUTRAL' | 'BEARISH';

export const toneFromScore = (total: number): MarketTone =>
  total >= 1.0 ? 'BULLISH' : total <= -1.0 ? 'BEARISH' : 'NEUTRAL';

/** Convenience: score and label in one call, from a quotes map. */
export function marketTone(quotes: ToneQuotes, breadthScore: number | null | undefined): {
  score: number;
  tone: MarketTone;
} {
  const getPct = (id: string) => quotes[id]?.pct || 0;
  const score = marketToneScore(getPct, breadthScore);
  return { score, tone: toneFromScore(score) };
}

export const toneCellTone = (t: MarketTone): CellTone =>
  t === 'BULLISH' ? 'green' : t === 'BEARISH' ? 'red' : 'amber';

/* ---- T2108 ---------------------------------------------------------------

   Percentage of stocks above their 40-day moving average. The vocabulary here
   matches the producer's own zone strings (computeT2108 in
   swing-candidates/run), so a label rendered on a page and a zone tested in
   code mean the same thing. */
export function t2108ZoneLabel(v: number | null): string {
  if (v == null) return 'NO DATA';
  if (v <= 10) return 'WASHED OUT';
  if (v <= 20) return 'DEEP OVERSOLD';
  if (v <= 35) return 'OVERSOLD';
  if (v <= 65) return 'NEUTRAL';
  if (v <= 80) return 'EXTENDED';
  return 'FROTHY';
}

export function t2108TextColor(v: number | null): string {
  if (v == null) return 'text-slate-500';
  if (v <= 10) return 'text-purple-400';
  if (v <= 20) return 'text-emerald-400';
  if (v <= 35) return 'text-lime-400';
  if (v <= 65) return 'text-slate-200';
  if (v <= 80) return 'text-amber-400';
  return 'text-rose-400';
}

export function t2108CardStyle(v: number | null): { bg: string; border: string } {
  if (v == null) return { bg: 'bg-[#161c2a]/60', border: 'border-white/5' };
  if (v <= 20) return { bg: 'bg-emerald-950/10', border: 'border-emerald-500/20' };
  if (v <= 35) return { bg: 'bg-lime-950/10', border: 'border-lime-500/20' };
  if (v <= 65) return { bg: 'bg-[#161c2a]/60', border: 'border-white/10' };
  if (v <= 80) return { bg: 'bg-amber-950/10', border: 'border-amber-500/20' };
  return { bg: 'bg-rose-950/10', border: 'border-rose-500/20' };
}

export function t2108CellTone(v: number | null): CellTone {
  if (v == null) return 'slate';
  if (v <= 35) return 'green';
  if (v <= 65) return 'slate';
  if (v <= 80) return 'amber';
  return 'red';
}

/* ---- Breadth -------------------------------------------------------------

   The 0-6 score arrives from the scanner; only its presentation lives here.
   Signal cutoffs (>= 4 GREEN, <= 2 RED) are the producer's, and the numeric
   token colouring below matches them — previously the dashboard called 2/6
   amber and the analyst page called it rose, neither agreeing with the
   GREEN/NEUTRAL/RED the same payload carried. */
export const breadthSignalTone = (signal: string | null | undefined): CellTone =>
  signal === 'GREEN' ? 'green' : signal === 'RED' ? 'red' : 'amber';

export function breadthScoreColor(score: number | null | undefined): string {
  if (score == null) return 'text-slate-500';
  if (score >= 4) return 'text-emerald-400';
  if (score <= 2) return 'text-rose-400';
  return 'text-amber-400';
}

/* ---- Participation percentages -------------------------------------------

   Two ladders, deliberately distinct and now explicitly named rather than
   drifting apart by accident:

   - PARTICIPATION (60/40) is symmetric around an even tape. Used for the bar
     strips, where the bar's own position already shows the midpoint.
   - CELL (advancers 60/50, highs 65/50) treats "barely more than half" as a
     warning rather than a positive, because a bare cell has no midpoint
     reference to argue with. */
export function participationColor(v: number): string {
  return v >= 60 ? 'text-emerald-400' : v <= 40 ? 'text-rose-400' : 'text-amber-400';
}

export function participationBg(v: number): string {
  return v >= 60
    ? 'bg-emerald-500/10 border-emerald-500/20'
    : v <= 40
      ? 'bg-rose-500/10 border-rose-500/20'
      : 'bg-amber-500/10 border-amber-500/20';
}

export const BREADTH_TICK_LOW = 40;
export const BREADTH_TICK_HIGH = 60;

/** Share of advancers, as a percentage of advancers + decliners. */
export function advPct(advancers: number | null | undefined, decliners: number | null | undefined): number {
  const a = advancers ?? 0;
  const d = decliners ?? 0;
  const total = a + d;
  return total > 0 ? (a / total) * 100 : 50;
}

export const advCellTone = (pct: number): CellTone =>
  pct >= 60 ? 'green' : pct >= 50 ? 'amber' : 'red';

/** Share of new highs, as a percentage of new highs + new lows. */
export function highsPct(newHighs: number | null | undefined, newLows: number | null | undefined): number {
  const h = newHighs ?? 0;
  const l = newLows ?? 0;
  const total = h + l;
  return total > 0 ? (h / total) * 100 : 50;
}

export const highsCellTone = (pct: number): CellTone =>
  pct >= 65 ? 'green' : pct >= 50 ? 'amber' : 'red';

/* ---- Market Monitor -------------------------------------------------------

   Today's 4% breakouts against today's 4% breakdowns, counted on a stricter
   universe than the A/D line — close >= $3, volume >= 100k. That filter is
   the whole point: a $1.20 stock moving four cents clears a 4% move without
   meaning anything, and those names dominate the raw count.

   The 5-day ratio rides alongside as the smoothing leg — five sessions of
   breakouts over five sessions of breakdowns. A ratio rather than a
   difference, so it reads the same whether the tape is producing 400 signals
   a day or 40. */
export interface MarketMonitor {
  ratio5: number | null;
  up5: number | null;
  down5: number | null;
  days: number;
  up4: number | null;
  down4: number | null;
  quarter25: number | null;
}

export function marketMonitorOf(raw: any): MarketMonitor | null {
  if (!raw || raw.mm4Up == null) return null;
  const up5 = raw.mm5Up ?? null;
  const down5 = raw.mm5Down ?? null;
  /* A zero denominator is a real reading, not an error — five sessions with
     no 4% breakdowns at all is about as one-sided as breadth gets. Reported
     as null so the cell shows the count rather than Infinity. */
  const ratio5 = up5 != null && down5 != null && down5 > 0 ? up5 / down5 : null;
  return {
    ratio5,
    up5,
    down5,
    days: raw.mm5Days ?? 0,
    up4: raw.mm4Up ?? null,
    down4: raw.mm4Down ?? null,
    quarter25: raw.mm25Quarter ?? null,
  };
}

/** Today's up vs down — the card background color. */
export function mmTodayTone(up: number | null, down: number | null): CellTone {
  if (up == null || down == null) return 'slate';
  if (up > down) return 'green';
  if (down > up) return 'red';
  return 'amber';
}

/* 1.0 is parity. The bands sit either side of it rather than at it, because a
   ratio hovering at exactly even is the least actionable reading there is. */
export function mmCellTone(ratio: number | null): CellTone {
  if (ratio == null) return 'slate';
  if (ratio >= 1.5) return 'green';
  if (ratio >= 0.9) return 'amber';
  return 'red';
}

export function mmRatioLabel(mm: MarketMonitor): string {
  if (mm.ratio5 != null) return mm.ratio5.toFixed(2);
  if (mm.up5 != null && mm.up5 > 0) return '∞';
  return '—';
}

/* ---- McClellan ----------------------------------------------------------- */

export function mkmCellTone(mkm: number, signal: number, rising: boolean): CellTone {
  if (mkm > signal && rising) return 'green';
  if (mkm < signal && !rising) return 'red';
  return 'amber';
}

/* ---- VIX ----------------------------------------------------------------- */

export const vixCellTone = (price: number): CellTone =>
  price >= 25 ? 'red' : price >= 18 ? 'amber' : 'green';

export const vixPctTone = (pct: number): CellTone =>
  pct >= 0.5 ? 'red' : pct <= -0.5 ? 'green' : 'amber';

/** Tickers where a rising price is a bearish signal. */
export const INVERSE_TICKERS = new Set(['VIX', 'UVXY', 'SQQQ', 'SPXS', 'SDOW', 'SOXS']);

/* ---- Institutional Direction ------------------------------------------------

   Three-signal algo/institutional detection:

   1. VIX-ES CORRELATION — the original signal. VIX pricing drives ~90% of
      S&P algorithmic volume. Rising VIX = put demand = sell programs.
      Reference: SPY/QQQ vs previous-day low (PDL), both from Polygon's
      snapshot `prevDay`. VIX has no previous-day level — it is an index and
      this plan has no Polygon indices entitlement — so its day move stands in
      for one when judging whether a break is being hedged.

   2. VIX VELOCITY — a VIX move of 3%+ intraday is algo-driven, not retail.
      Retail traders don't move the VIX 3% in a session. When VIX spikes
      that fast, market makers are delta-hedging options flow, which IS the
      algorithm. Replaces the old ±0.5% PRESSURE ON/OFF with a tiered read.

   3. VOLUME ANOMALY — SPY volume > 1.5× its 20-day average means large
      blocks are moving. Direction (positive or negative day) determines
      whether it is accumulation or distribution.

   4. VIX TERM STRUCTURE — VIX vs VIX9D. When VIX > VIX9D (backwardation),
      institutions are bidding up short-dated protection: hedging urgency.
      When VIX < VIX9D (contango), hedges are being unwound. Optional —
      degrades to the other signals when VIX9D is unavailable, which is the
      case today: VIX9D is a Polygon index and the plan does not carry them,
      so HEDGING cannot currently fire. */

export type InstDirSetup =
  | 'BEAR TRAP'
  | 'CONFIRMED ↓'
  | '1% DIVG'
  | 'EXHAUSTION'
  | 'HEDGING'
  | 'ALGO SELL'
  | 'ALGO BUY'
  | 'DISTRIBUTION'
  | 'ACCUMULATION'
  | 'FLOW IN'
  | 'FLOW OUT'
  | 'PRESSURE ON'
  | 'PRESSURE OFF'
  | 'CLEAR';

export type InstDirSignal = 'BULLS' | 'BEARS' | 'NEUTRAL';

export interface InstDirOpts {
  vix9dPrice?: number | null;
  spyVolume?: number | null;
  spyAvgVolume?: number | null;
  /** SPY Chaikin money flow, 0-100 centred on 50. See lib/indicators/moneyflow. */
  spyMoneyFlow?: number | null;
}

/* Matches the noise floor `marketToneScore` applies to VIX. */
const VIX_PRESSURE_PCT = 2;

/* Money-flow bands, taken from the thresholds moneyflow.ts documents:
   above 60 is strong accumulation, below 40 strong distribution. The mild
   40-60 band is deliberately not a signal. */
const MF_ACCUM = 60;
const MF_DISTRIB = 40;

export function instDirSetup(
  spyPrice: number, spyPdl: number | null, spyPct: number,
  qqqPrice: number, qqqPdl: number | null,
  vixPrice: number, vixPdh: number | null, vixPct: number,
  opts?: InstDirOpts,
): InstDirSetup {
  if (spyPct >= 1 && vixPct >= 1) return '1% DIVG';
  if (spyPct <= -1 && vixPct <= -1) return 'EXHAUSTION';

  const spyBrokePdl = spyPdl != null && spyPrice < spyPdl;
  const qqqBrokePdl = qqqPdl != null && qqqPrice < qqqPdl;

  /* Is volatility confirming the break? Prefer the previous-day high when it
     is available, but this plan has no Polygon indices entitlement, so VIX
     carries no level and the day's move stands in for it.

     THE ABSENCE OF A LEVEL MUST NOT READ AS "NOT CONFIRMING". The old code
     wrote `!vixAbovePdh`, which was true whenever the level was missing — so
     once the index levels started arriving, every genuine breakdown would have
     been labelled BEAR TRAP, a bullish read, on the strength of data that was
     simply absent. Confirming and dismissive are now separate tests with an
     ambiguous band between them that falls through to the rest of the chain. */
  const vixConfirming = vixPdh != null ? vixPrice >= vixPdh : vixPct >= 1;
  const vixDismissive = vixPdh != null ? vixPrice < vixPdh : vixPct <= 0;

  if (spyBrokePdl && qqqBrokePdl && vixConfirming) return 'CONFIRMED ↓';
  if (spyBrokePdl && vixDismissive) return 'BEAR TRAP';

  const v9d = opts?.vix9dPrice;
  if (v9d != null && v9d > 0 && vixPrice / v9d > 1.05) return 'HEDGING';

  const volRatio = opts?.spyVolume && opts?.spyAvgVolume && opts.spyAvgVolume > 0
    ? opts.spyVolume / opts.spyAvgVolume
    : null;

  if (vixPct >= 3 && spyPct <= -0.75) return 'ALGO SELL';
  if (vixPct <= -3 && spyPct >= 0.75) return 'ALGO BUY';

  if (volRatio != null && volRatio >= 1.5) {
    return spyPct < -0.1 ? 'DISTRIBUTION' : spyPct > 0.1 ? 'ACCUMULATION' : 'PRESSURE ON';
  }

  /* THE FALLBACK MUST NOT FIRE ON NOISE. This branch catches everything the
     rules above did not, so its threshold decides the card's resting state.
     At the old +/-0.5% it caught nearly every session — VIX clears half a
     percent most days — which made BULLS or BEARS the default reading and left
     the card directional on nothing. It also contradicted `marketToneScore` in
     this same file, which ignores VIX moves under 2% as noise.

     Both now use 2%. Below that the card says CLEAR, which is the honest
     answer when no rule has actually matched. */
  /* MONEY FLOW — the only reading here that measures which side actually got
     filled. Everything above infers intent from price and volume; this weights
     where each of 21 sessions closed inside its own range by that session's
     volume. It is slower than the rules above, so it sits below them — but
     above the VIX fallback, because three weeks of accumulation is a better
     answer than today's volatility tick when nothing else has matched. */
  const mf = opts?.spyMoneyFlow;
  if (mf != null) {
    if (mf >= MF_ACCUM) return 'FLOW IN';
    if (mf <= MF_DISTRIB) return 'FLOW OUT';
  }

  if (vixPct >= VIX_PRESSURE_PCT) return 'PRESSURE ON';
  if (vixPct <= -VIX_PRESSURE_PCT) return 'PRESSURE OFF';

  return 'CLEAR';
}

const BULL_SETUPS: Set<InstDirSetup> = new Set([
  'BEAR TRAP', 'PRESSURE OFF', 'EXHAUSTION', 'ALGO BUY', 'ACCUMULATION', 'FLOW IN',
]);
const BEAR_SETUPS: Set<InstDirSetup> = new Set([
  'CONFIRMED ↓', '1% DIVG', 'PRESSURE ON', 'HEDGING', 'ALGO SELL', 'DISTRIBUTION', 'FLOW OUT',
]);

export function instDirSignal(setup: InstDirSetup): InstDirSignal {
  if (BULL_SETUPS.has(setup)) return 'BULLS';
  if (BEAR_SETUPS.has(setup)) return 'BEARS';
  return 'NEUTRAL';
}

/* ---- Setup strength ------------------------------------------------------

   Every setup used to render identically, so CONFIRMED — three independent
   conditions agreeing — carried the same visual weight as PRESSURE ON, which
   is one VIX reading and the fallback branch at that. A reader could not tell
   a real signal from the default.

   STRONG    several independent conditions agree, or one is at an extreme.
   MODERATE  two conditions, or a single structural read.
   WEAK      one ordinary reading, including the fallback.                   */

export type InstDirStrength = 'STRONG' | 'MODERATE' | 'WEAK';

const STRONG_SETUPS: Set<InstDirSetup> = new Set([
  'CONFIRMED ↓',   // both indices through their previous-day lows, volatility confirming
  'ALGO SELL',     // VIX 3%+ against a falling tape
  'ALGO BUY',      // VIX -3%+ against a rising tape
  '1% DIVG',       // index and volatility both up 1%+ — they should not agree
  'EXHAUSTION',    // index and volatility both down 1%+
]);

const MODERATE_SETUPS: Set<InstDirSetup> = new Set([
  'BEAR TRAP',     // index broke its low, volatility declined to confirm
  'DISTRIBUTION',  // volume anomaly with a negative tape
  'ACCUMULATION',  // volume anomaly with a positive tape
  'HEDGING',       // term structure in backwardation
  'FLOW IN',       // 21 sessions of accumulation
  'FLOW OUT',      // 21 sessions of distribution
]);

export function instDirStrength(setup: InstDirSetup): InstDirStrength {
  if (STRONG_SETUPS.has(setup)) return 'STRONG';
  if (MODERATE_SETUPS.has(setup)) return 'MODERATE';
  return 'WEAK';
}

/** Filled/empty pips, so strength reads at a glance without another word. */
export const instDirStrengthPips = (setup: InstDirSetup): string => {
  const st = instDirStrength(setup);
  return st === 'STRONG' ? '●●●' : st === 'MODERATE' ? '●●○' : '●○○';
};

export const instDirCellTone = (s: InstDirSignal): CellTone =>
  s === 'BULLS' ? 'green' : s === 'BEARS' ? 'red' : 'amber';

export function instDirCardStyle(s: InstDirSignal): { bg: string; border: string } {
  if (s === 'BULLS') return { bg: 'bg-emerald-950/10', border: 'border-emerald-500/20' };
  if (s === 'BEARS') return { bg: 'bg-rose-950/10', border: 'border-rose-500/20' };
  return { bg: 'bg-[#161c2a]/60', border: 'border-white/10' };
}

export const instDirTextColor = (s: InstDirSignal): string =>
  s === 'BULLS' ? 'text-emerald-400' : s === 'BEARS' ? 'text-rose-400' : 'text-slate-200';

export function instDirSetupBadge(setup: InstDirSetup): string {
  if (BULL_SETUPS.has(setup)) return 'bg-emerald-500/10 text-emerald-400';
  if (BEAR_SETUPS.has(setup)) return 'bg-rose-500/10 text-rose-400';
  return 'bg-slate-500/10 text-slate-300';
}

/* ---- Market session ------------------------------------------------------

   Written out separately in Scorecard.tsx, /api/macro and /api/sectors. The
   three agreed, but only by coincidence. */
export type MarketSession = 'Pre-Market' | 'Open' | 'Post-Market' | 'Closed';

export function getMarketSession(): MarketSession {
  const est = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const t = est.getHours() + est.getMinutes() / 60;
  if (!isTradingDay()) return 'Closed';
  if (t >= 4 && t < 9.5) return 'Pre-Market';
  if (t >= 9.5 && t < 16) return 'Open';
  if (t >= 16 && t < 20) return 'Post-Market';
  return 'Closed';
}

export function sessionTextColor(session: MarketSession): string {
  if (session === 'Open') return 'text-emerald-400';
  if (session === 'Pre-Market' || session === 'Post-Market') return 'text-amber-400';
  return 'text-slate-500';
}

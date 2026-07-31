/* Choppiness Index — shared implementation
   ------------------------------------------------------------------
       CHOP = 100 × log10( Σ TR(n) / (maxHigh(n) − minLow(n)) ) / log10(n)

   Distance travelled over ground covered. A name that moves 8% in total
   to end 8% higher has a low ratio and a low score: it trended. One that
   moves 8% in total and ends flat has a high ratio and a high score: it
   churned. log10 normalises to roughly 0-100 regardless of n.

   WHY THIS IS NOT REDUNDANT WITH ADR, which is the question that matters
   for the scan gate. ADR says the name MOVES. CHOP says it moves
   SOMEWHERE. A stock with 8% ADR and CHOP 75 travels enormous distance
   daily and ends the month where it started — it clears an ADR floor
   cleanly and it is the worst thing on the board. The two measure
   different halves of tradeability and neither substitutes for the other.

   SUM RAW TRUE RANGE, NOT ATR. The canonical formula sums TR; summing an
   n-period ATR over n bars approximates n×ATR and is close in steady
   state, but ATR is an RMA and therefore lags. After a volatility spike
   ATR stays elevated while actual TR contracts, which inflates the
   numerator and reports MORE chop than exists — precisely when you most
   want the reading to be right. This module is the single source so the
   market-level route and the per-ticker scans cannot drift apart on it.
   ------------------------------------------------------------------ */

export const CHOP_PERIOD_DEFAULT = 14;

// Fibonacci thresholds, the convention the indicator ships with.
export const CHOP_TREND_MAX = 38.2;
export const CHOP_CHOP_MIN = 61.8;

export type ChopZone = 'trend' | 'mixed' | 'chop';

export interface ChopBar {
  h: number;
  l: number;
  c: number;
}

/* Bars must be OLDEST FIRST. Polygon's aggs endpoint with sort=asc already
   returns them this way; a descending array produces a valid-looking number
   computed from the wrong window, which is worse than an error. */
export function choppiness(
  bars: ChopBar[],
  period: number = CHOP_PERIOD_DEFAULT
): number | null {
  if (!Array.isArray(bars) || bars.length < period + 1) return null;

  const window = bars.slice(-period);
  const prior = bars[bars.length - period - 1];
  if (!prior || typeof prior.c !== 'number') return null;

  let trSum = 0;
  let maxHigh = -Infinity;
  let minLow = Infinity;

  for (let i = 0; i < window.length; i++) {
    const bar = window[i];
    if (
      !bar ||
      typeof bar.h !== 'number' ||
      typeof bar.l !== 'number' ||
      typeof bar.c !== 'number'
    ) {
      return null;
    }

    const prevClose = i === 0 ? prior.c : window[i - 1].c;
    trSum += Math.max(
      bar.h - bar.l,
      Math.abs(bar.h - prevClose),
      Math.abs(bar.l - prevClose)
    );

    if (bar.h > maxHigh) maxHigh = bar.h;
    if (bar.l < minLow) minLow = bar.l;
  }

  const range = maxHigh - minLow;

  /* A zero range means every bar printed the same high and low — not a real
     condition on a liquid name, but the division would give Infinity and the
     log would give nonsense. Halted or barely-traded tickers can reach here. */
  if (range <= 0 || trSum <= 0) return null;

  const raw = (100 * Math.log10(trSum / range)) / Math.log10(period);

  // The formula can drift a point or two outside 0-100 on extreme inputs.
  return Math.max(0, Math.min(100, raw));
}

export const chopZone = (v: number | null): ChopZone | null => {
  if (v == null) return null;
  if (v <= CHOP_TREND_MAX) return 'trend';
  if (v >= CHOP_CHOP_MIN) return 'chop';
  return 'mixed';
};

export const chopLabel = (v: number | null): string => {
  if (v == null) return '—';
  if (v >= 70) return 'DEAD CHOP';
  if (v >= CHOP_CHOP_MIN) return 'CHOPPY';
  if (v > CHOP_TREND_MAX) return 'MIXED';
  if (v > 30) return 'TRENDING';
  return 'STRONG TREND';
};

/* Tailwind classes live here rather than in each component so the five
   tables cannot render the same number in three different colours. */
export const chopColor = (v: number | null): string => {
  if (v == null) return 'text-slate-500';
  if (v >= 70) return 'text-rose-400';
  if (v >= CHOP_CHOP_MIN) return 'text-amber-400';
  if (v > CHOP_TREND_MAX) return 'text-slate-300';
  if (v > 30) return 'text-emerald-400';
  return 'text-teal-300';
};

export const chopBadge = (v: number | null): string => {
  if (v == null) return 'bg-white/[0.02] text-slate-600 border-white/5';
  if (v >= 70) return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
  if (v >= CHOP_CHOP_MIN) return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
  if (v > CHOP_TREND_MAX) return 'bg-slate-500/10 text-slate-300 border-white/10';
  return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
};

/* Per-ticker tooltip. Says what the number means for THIS name rather than
   for the market, and pairs it with ADR because the pair is the read — high
   ADR with high CHOP is the specific trap the scan's ADR floor lets through. */
export const chopTooltip = (v: number | null, adrPct?: number | null): string => {
  if (v == null) return 'CHOP — not enough daily bars to compute.';

  const lines: string[] = [`CHOP ${v.toFixed(0)} — ${chopLabel(v)}`];
  lines.push('');
  lines.push(
    v >= 70
      ? 'Travels a lot of distance and covers no ground. Breakouts here fire and reverse.'
      : v >= CHOP_CHOP_MIN
        ? 'Consolidation regime. Expect failed breakouts; range edges are the trade.'
        : v > CHOP_TREND_MAX
          ? 'No regime edge either way. The setup has to carry it.'
          : v > 30
            ? 'Trending — moves have follow-through.'
            : 'Strong trend. Breakout entries are built for this.'
  );

  if (adrPct != null && !isNaN(Number(adrPct))) {
    const adr = Number(adrPct);
    lines.push('');
    lines.push(`ADR ${adr.toFixed(1)}%`);
    // The interesting quadrant. ADR clears the scan floor and CHOP says the
    // movement goes nowhere — a name that looks tradeable and is not.
    if (adr >= 5 && v >= CHOP_CHOP_MIN) {
      lines.push('Wide range, no direction — this is the chop trap the ADR floor lets through.');
    } else if (adr >= 5 && v <= CHOP_TREND_MAX) {
      lines.push('Wide range AND trending — the combination worth having.');
    } else if (adr < 5 && v <= CHOP_TREND_MAX) {
      lines.push('Trending but tight — clean structure, smaller moves.');
    }
  }

  lines.push('');
  lines.push(`Above ${CHOP_CHOP_MIN} is consolidation, below ${CHOP_TREND_MAX} is trend. 14-day.`);
  return lines.join('\n');
};
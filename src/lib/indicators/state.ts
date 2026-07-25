// lib/indicators/state.ts
//
// Price state — RMV and RME collapsed into one readable label.
//
// The two can't be averaged into a single number without destroying what they
// say: RMV measures how WIDE price is moving, RME how FAR it's displaced from
// its anchor. Those are orthogonal. A stock can be tight-and-extended or
// wild-and-anchored, and a mean of the two puts both in the same bucket.
//
// So instead of a value, a quadrant label. Six states, each one a sentence
// you'd actually say out loud about a chart:
//
//   COILED   tight + at the anchor      the 10/21 entry
//   DRIFT    tight + stretched up       quietly extended — the trap
//   WASHED   tight + far below          quiet capitulation, reversal watch
//   IMPULSE  wide + stretched up        real expansion — normal on a gapper
//   FLUSH    wide + far below           active capitulation
//   CHOP     wide + at the anchor       violent, going nowhere
//   NORMAL   everything else            no edge either way
//
// DRIFT is the one that earns its keep. RMV alone reads it as "calm" and you
// take it as a pullback entry; RME alone reads it as "extended" and you skip a
// name that's actually resting. Only the pair identifies it.

export type PriceState =
  | 'COILED' | 'DRIFT' | 'WASHED'
  | 'IMPULSE' | 'FLUSH' | 'CHOP'
  | 'NORMAL' | 'UNKNOWN';

export interface StateResult {
  state: PriceState;
  /** Tailwind text class for the label. */
  color: string;
  /** One-line explanation for the tooltip. */
  description: string;
}

/** RMV at or below this is "tight". Above the upper bound is "wide". */
const RMV_TIGHT = 35;
const RMV_WIDE = 65;

/** |RME| below this is "at the anchor". Beyond the outer bound is "far". */
const RME_NEAR = 30;
const RME_FAR = 60;

const META: Record<PriceState, { color: string; description: string }> = {
  COILED: {
    color: 'text-emerald-400',
    description: 'tight range, sitting on its anchor — the classic 10/21 entry',
  },
  DRIFT: {
    color: 'text-amber-400',
    description: 'quiet, but stretched above the anchor — reads calm, is extended',
  },
  WASHED: {
    color: 'text-sky-400',
    description: 'quiet and far below the anchor — reversal watch, not a breakdown',
  },
  IMPULSE: {
    color: 'text-purple-400',
    description: 'range expanding and price extended — normal on a gapper, late for a swing',
  },
  FLUSH: {
    color: 'text-rose-400',
    description: 'wide range, far below the anchor — active capitulation',
  },
  CHOP: {
    color: 'text-orange-400',
    description: 'violent range with price going nowhere — no edge, sit it out',
  },
  NORMAL: {
    color: 'text-slate-400',
    description: 'no compression or extension worth acting on',
  },
  UNKNOWN: {
    color: 'text-slate-600',
    description: 'insufficient history for a state read',
  },
};

/**
 * Classify a row from its RMV and RME readings.
 * Either being null yields UNKNOWN — a half-read would be misleading, since
 * both axes are needed to tell DRIFT from COILED.
 */
export function stateOf(
  rmv: number | null | undefined,
  rme: number | null | undefined
): StateResult {
  const v = rmv == null || !isFinite(Number(rmv)) ? null : Number(rmv);
  const e = rme == null || !isFinite(Number(rme)) ? null : Number(rme);

  if (v == null || e == null) {
    return { state: 'UNKNOWN', ...META.UNKNOWN };
  }

  const tight = v <= RMV_TIGHT;
  const wide = v >= RMV_WIDE;
  const near = Math.abs(e) <= RME_NEAR;
  const high = e >= RME_FAR;
  const low = e <= -RME_FAR;

  let state: PriceState = 'NORMAL';

  if (tight) {
    if (near) state = 'COILED';
    else if (high) state = 'DRIFT';
    else if (low) state = 'WASHED';
  } else if (wide) {
    if (high) state = 'IMPULSE';
    else if (low) state = 'FLUSH';
    else if (near) state = 'CHOP';
  }

  return { state, ...META[state] };
}

/**
 * Compact tooltip — the current state plus the raw inputs. Used on the
 * RMV/RME chip, where the numbers are already visible and you just want to
 * know what they mean.
 */
export function stateTooltip(
  rmv: number | null | undefined,
  rme: number | null | undefined
): string {
  const { state, description } = stateOf(rmv, rme);
  const lines = [
    state === 'UNKNOWN' ? 'No state read.' : `${state} — ${description}`,
    '',
  ];

  lines.push(
    rmv != null && isFinite(Number(rmv))
      ? `RMV ${Number(rmv).toFixed(0)} — volatility vs its own last 15 bars (0 = tightest, 100 = widest)`
      : 'RMV — unavailable'
  );
  lines.push(
    rme != null && isFinite(Number(rme))
      ? `RME ${Number(rme).toFixed(0)} — extension vs its own history off the 21 EMA (-100 to +100)`
      : 'RME — unavailable'
  );

  return lines.join('\n');
}

/**
 * Full legend — every state listed, with the current one named first.
 * Used on the STATE word itself, where the question is usually "what are the
 * other options" rather than "what is this one".
 */
export function stateLegend(
  rmv: number | null | undefined,
  rme: number | null | undefined
): string {
  const { state, description } = stateOf(rmv, rme);
  return [
    state === 'UNKNOWN'
      ? 'No state read — insufficient history.'
      : `${state} — ${description}`,
    '',
    'RMV = how WIDE price is moving vs its own last 15 bars (0 tightest, 100 widest).',
    'RME = how FAR from the 21 EMA vs a year of its own extension (-100 to +100).',
    '',
    'COILED    tight, at the anchor — the 10/21 entry',
    'DRIFT     tight but stretched — reads calm, is extended',
    'WASHED    quiet and far below — reversal watch',
    'IMPULSE   expanding and extended — normal on a gapper',
    'FLUSH     wide and far below — capitulation',
    'CHOP      violent, going nowhere — no edge',
    'NORMAL    nothing worth acting on',
  ].join('\n');
}

/** Readiness legend — what Ready and Forming actually test. */
export function readinessTooltip(status: 'Ready' | 'Forming' | null): string {
  const head =
    status === 'Ready' ? 'READY — the trigger could fire imminently.'
    : status === 'Forming' ? 'FORMING — the setup is building but is not at the trigger.'
    : 'No readiness read.';
  return [
    head,
    '',
    'Ready requires BOTH:',
    '• Stochastic %K ≤ 25 (oversold)',
    '• Price within 2.5% of the 21 EMA',
    '',
    'Anything else reads Forming. Day-trade names below VWAP never rate Ready.',
  ].join('\n');
}

/** Compact "14/8" pairing for the chip, when both are present. */
export function stateNumbers(
  rmv: number | null | undefined,
  rme: number | null | undefined
): string {
  const v = rmv == null || !isFinite(Number(rmv)) ? null : Math.round(Number(rmv));
  const e = rme == null || !isFinite(Number(rme)) ? null : Math.round(Number(rme));
  if (v == null && e == null) return '';
  const vs = v == null ? '—' : String(v);
  const es = e == null ? '—' : String(e);
  return `${vs}/${es}`;
}
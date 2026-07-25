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
    description: 'Coiled — tight range, sitting on its anchor. The classic 10/21 entry.',
  },
  DRIFT: {
    color: 'text-amber-400',
    description: 'Drift — quiet, but stretched above the anchor. Reads calm; it is extended.',
  },
  WASHED: {
    color: 'text-sky-400',
    description: 'Washed — quiet and far below the anchor. Reversal watch, not a breakdown.',
  },
  IMPULSE: {
    color: 'text-purple-400',
    description: 'Impulse — range expanding and price extended. Normal on a gapper, late for a swing.',
  },
  FLUSH: {
    color: 'text-rose-400',
    description: 'Flush — wide range, far below the anchor. Active capitulation.',
  },
  CHOP: {
    color: 'text-orange-400',
    description: 'Chop — violent range with price going nowhere. No edge; sit it out.',
  },
  NORMAL: {
    color: 'text-slate-400',
    description: 'Normal — no compression or extension worth acting on.',
  },
  UNKNOWN: {
    color: 'text-slate-600',
    description: 'Insufficient history for a state read.',
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
 * Full tooltip text — the state description plus the raw inputs, so the
 * label is the glance and the numbers are one hover away.
 */
export function stateTooltip(
  rmv: number | null | undefined,
  rme: number | null | undefined
): string {
  const { description } = stateOf(rmv, rme);
  const lines = [description, ''];

  lines.push(
    rmv != null && isFinite(Number(rmv))
      ? `RMV ${Number(rmv).toFixed(0)} — volatility vs its own last 15 bars (0 = tightest, 100 = widest)`
      : 'RMV — unavailable'
  );
  lines.push(
    rme != null && isFinite(Number(rme))
      ? `RME ${Number(rme) > 0 ? '+' : ''}${Number(rme).toFixed(0)} — extension vs its own history off the 21 EMA (-100 to +100)`
      : 'RME — unavailable'
  );

  return lines.join('\n');
}

/** Compact "14/+8" pairing for the chip, when both are present. */
export function stateNumbers(
  rmv: number | null | undefined,
  rme: number | null | undefined
): string {
  const v = rmv == null || !isFinite(Number(rmv)) ? null : Math.round(Number(rmv));
  const e = rme == null || !isFinite(Number(rme)) ? null : Math.round(Number(rme));
  if (v == null && e == null) return '';
  const vs = v == null ? '—' : String(v);
  const es = e == null ? '—' : `${e > 0 ? '+' : ''}${e}`;
  return `${vs}/${es}`;
}
// lib/scans/fit.ts — OK / LATE on the SIP and Daily tables (replaced the CNF grade, 9 Oct 2026).
//
// From scripts/backtest/cnf-rebuild.ts (pre-registered 9 Oct): components and
// quintile cut points chosen on Sep 2022 - Sep 2024 replay rows only, then
// judged once on Sep 2024 - Sep 2026. All eight held direction on the untouched
// period. The three-grade version failed (A +1.26% < B +1.48% over 20 sessions
// vs QQQ); the bottom half, LATE, lost -3.78%. The two-way cut was picked
// AFTER seeing that, so it still needs the live record to confirm it.
//
// What LATE means: a name that already ran hard today — a big % gain, a range
// blowing out, way ahead of the market, closing off its high, trending
// straight up, thin dollar volume, below VWAP, already above its 50-day. On
// these tables those did worst over the next month. The numbers are cut points
// in the units the scanner stores; they are not to be re-fitted on the same data.

export interface FitInput {
  changePct?: number | null;
  atrExpansion?: number | null;
  closeStrength?: number | null;   // 0 = day low, 1 = day high
  rsVsMkt?: number | null;
  chop14?: number | null;
  dVol?: number | null;
  vwapStatus?: string | null;
  aboveSma50?: boolean | null;
}

/** dir 1 = higher is better, -1 = lower is better. */
const CONT: { k: keyof FitInput; dir: 1 | -1; cuts: [number, number, number, number] }[] = [
  { k: 'changePct', dir: -1, cuts: [4.799, 6, 8.2803, 15.075] },
  { k: 'atrExpansion', dir: -1, cuts: [0.9353, 1.2319, 1.5564, 2.1529] },
  { k: 'closeStrength', dir: 1, cuts: [0.5879, 0.7629, 0.8659, 0.9381] },
  { k: 'rsVsMkt', dir: -1, cuts: [4.551, 5.8794, 8.2092, 15.1391] },
  { k: 'chop14', dir: 1, cuts: [30.9994, 39.0468, 45.5243, 52.3335] },
  { k: 'dVol', dir: 1, cuts: [161510067, 299276968, 536550255, 1071516577] },
];
const COMPONENTS = CONT.length + 2;
/** The median score on the training rows: below it is LATE. */
export const FIT_LATE_BELOW = 53.125;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** 0-100, or null when fewer than half the components are known. */
export function fitScore(r: FitInput): number | null {
  let s = 0, n = 0;
  for (const c of CONT) {
    const x = num(r[c.k]);
    if (x == null) continue;
    n++;
    const q = c.cuts.filter(cut => x >= cut).length;
    s += c.dir > 0 ? q : 4 - q;
  }
  if (r.vwapStatus === 'above' || r.vwapStatus === 'below') { n++; s += r.vwapStatus === 'above' ? 4 : 0; }
  if (typeof r.aboveSma50 === 'boolean') { n++; s += r.aboveSma50 ? 0 : 4; }
  if (n < COMPONENTS / 2) return null;
  // A missing component scores 0, exactly as cnf-rebuild.ts scored it.
  return (s / (4 * COMPONENTS)) * 100;
}

export const isLate = (score: number | null | undefined): boolean | null => (score == null ? null : score < FIT_LATE_BELOW);

export const FIT_TIP = {
  ok: "OK — hasn't run hard today. In the held-out test (Sep 2024 – Sep 2026) the OK half beat QQQ by about +1.4% over the next 20 sessions.",
  late: 'LATE — already ran hard today (big % gain, range blowing out, far ahead of the market, closed off its high or below VWAP). In the held-out test this half trailed QQQ by −3.8% over the next 20 sessions.',
};

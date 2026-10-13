// lib/scans/swingWide.ts — the wider Swing universe's cheap pre-check (12 Oct 2026).
//
// Swing used to analyse only the top 120 names by dollar volume, so mid caps pulling back to
// the 21 EMA never appeared. Any name trading $20M+ a day can now join, but only if the
// whole-market daily bars the scan already downloads (45 sessions, lib/scans/consolidation
// GROUPED) say it is near the pattern — the full gates (52-week high, 50/200 SMA, RS, the
// exact stochastic) then run on far fewer names. Deliberately looser than SWING's gates, so
// it only throws out names that could not pass them.
//   |close / EMA21 - 1| <= 5%  (Swing: 4%)
//   stochastic %K(10, 4) <= 45  (Swing: 35)
//   14-day average range 2.5% - 7%  (Swing ATR: 3% - 6% since 13 Oct 2026)

export type LBar = { c: number; h: number; l: number; v: number };

export const WIDE_MIN_DOLLAR_VOL = 20e6;
export const WIDE_MAX_EXTRA = 150;

export function swingPrecheck(bars: LBar[] | undefined): boolean {
  if (!bars || bars.length < 30) return false;
  const n = bars.length, c = bars[n - 1].c;
  if (!(c > 0)) return false;
  let e = bars[0].c; for (let i = 1; i < n; i++) e = bars[i].c * (2 / 22) + e * (20 / 22);
  if (!(Math.abs(c / e - 1) <= 0.05)) return false;
  const raw: number[] = [];
  for (let i = n - 4; i < n; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - 9; j <= i; j++) { hi = Math.max(hi, bars[j].h); lo = Math.min(lo, bars[j].l); }
    raw.push(hi > lo ? ((bars[i].c - lo) / (hi - lo)) * 100 : 50);
  }
  if (!(raw.reduce((a, b) => a + b, 0) / raw.length <= 45)) return false;
  let rng = 0; for (let i = n - 14; i < n; i++) rng += (bars[i].h - bars[i].l) / bars[i].c;
  const atrPct = (rng / 14) * 100;
  return atrPct >= 2.5 && atrPct <= 7;
}

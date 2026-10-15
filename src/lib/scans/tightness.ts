// lib/scans/tightness.ts — "tight and quiet" for the swing checklist (12 Oct 2026).
//   tight5 = the last 5 bars' high-low span, in ADRs (20-bar average daily range).
//   volDry = the last 3 bars' average volume over the 20 bars before them.
//   lowerHigh = the failed bounce high under a recent peak (lowerHighOf below).
// Bars oldest first. An intraday scan's last bar is today's so far, so its volume reads low
// early in the session — a checklist read, not a measurement.

export type TBar = { h: number; l: number; c: number; v: number };

/* Lower high (15 Oct 2026): after the highest high of the last 40 bars, the latest bounce
   (a pivot high, 2 bars either side) topped out at least half an ADR (1% minimum) under that
   peak, and no close since has got back above it. Returns the bounce high so the checklist
   can test the LIVE price against it; 0 = no lower high; null = too few bars.
   Measured on 15 Oct 2026 rows: flags TWLO, ILMN, NTRA, LFST; passes NSP, ATRC, VSTS, NIQ. */
export function lowerHighOf(bars: TBar[], look = 40, k = 2): number | null {
  const n = bars.length;
  if (n < 25) return null;
  const last20 = bars.slice(-20).filter(b => b.l > 0 && b.h > 0);
  if (last20.length < 15) return null;
  const adr = last20.reduce((a, b) => a + b.h / b.l - 1, 0) / last20.length;
  let pk = Math.max(0, n - look);
  for (let i = pk + 1; i < n; i++) if (bars[i].h > bars[pk].h) pk = i;
  let p = -1;
  for (let i = n - 1 - k; i > pk + k && p < 0; i--) {   // within k of the peak cannot be a pivot
    let pivot = true;
    for (let j = i - k; j <= i + k; j++) if (j !== i && bars[j].h >= bars[i].h) { pivot = false; break; }
    if (pivot) p = i;
  }
  if (p < 0) return 0;
  const peak = bars[pk].h, bounce = bars[p].h;
  if (!(peak > 0) || (peak - bounce) / peak < Math.max(0.5 * adr, 0.01)) return 0;
  for (let i = p + 1; i < n; i++) if (bars[i].c >= bounce) return 0;
  return +bounce.toFixed(4);
}

export function tightnessOf(bars: TBar[]): { tight5: number | null; volDry: number | null; lowerHigh: number | null } {
  const n = bars.length;
  if (n < 25) return { tight5: null, volDry: null, lowerHigh: null };
  const last20 = bars.slice(-20).filter(b => b.l > 0 && b.h > 0);
  const adr = last20.length >= 15 ? last20.reduce((a, b) => a + b.h / b.l - 1, 0) / last20.length : null;
  const five = bars.slice(-5);
  const hi = Math.max(...five.map(b => b.h)), lo = Math.min(...five.map(b => b.l)), c = bars[n - 1].c;
  const tight5 = adr && adr > 0 && c > 0 && lo > 0 ? +(((hi - lo) / c) / adr).toFixed(2) : null;
  const v3 = bars.slice(-3).map(b => b.v), v20 = bars.slice(-23, -3).map(b => b.v).filter(v => v > 0);
  const avg20 = v20.length >= 15 ? v20.reduce((a, b) => a + b, 0) / v20.length : null;
  const volDry = avg20 && avg20 > 0 ? +((v3.reduce((a, b) => a + b, 0) / 3) / avg20).toFixed(2) : null;
  return { tight5, volDry, lowerHigh: lowerHighOf(bars) };
}

// lib/scans/tightness.ts — "tight and quiet" for the swing checklist (12 Oct 2026).
//   tight5 = the last 5 bars' high-low span, in ADRs (20-bar average daily range).
//   volDry = the last 3 bars' average volume over the 20 bars before them.
// Bars oldest first. An intraday scan's last bar is today's so far, so its volume reads low
// early in the session — a checklist read, not a measurement.

export type TBar = { h: number; l: number; c: number; v: number };

export function tightnessOf(bars: TBar[]): { tight5: number | null; volDry: number | null } {
  const n = bars.length;
  if (n < 25) return { tight5: null, volDry: null };
  const last20 = bars.slice(-20).filter(b => b.l > 0 && b.h > 0);
  const adr = last20.length >= 15 ? last20.reduce((a, b) => a + b.h / b.l - 1, 0) / last20.length : null;
  const five = bars.slice(-5);
  const hi = Math.max(...five.map(b => b.h)), lo = Math.min(...five.map(b => b.l)), c = bars[n - 1].c;
  const tight5 = adr && adr > 0 && c > 0 && lo > 0 ? +(((hi - lo) / c) / adr).toFixed(2) : null;
  const v3 = bars.slice(-3).map(b => b.v), v20 = bars.slice(-23, -3).map(b => b.v).filter(v => v > 0);
  const avg20 = v20.length >= 15 ? v20.reduce((a, b) => a + b, 0) / v20.length : null;
  const volDry = avg20 && avg20 > 0 ? +((v3.reduce((a, b) => a + b, 0) / 3) / avg20).toFixed(2) : null;
  return { tight5, volDry };
}

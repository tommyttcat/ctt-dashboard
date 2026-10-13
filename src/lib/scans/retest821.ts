// lib/scans/retest821.ts — the "8/21 RETEST" tag (13 Oct 2026, the owner's ask, from a setup
// diagram: wait for the 8/21 EMA cross → break a key level → retest the level and the 8 EMA →
// enter on confirmation). A tag on Swing and 10/21 rows, not a colour and not a tested edge —
// the close cousin, Kell's EMA crossback, lost to QQQ on every stock (scripts/backtest/kell-cycle).
//
//   cross    EMA8 crossed above EMA21 within the last 40 sessions and is still above it
//   level    the highest high of the 60 sessions before the cross (the prior high on the left, where
//            the decline started); broken by a close above it since
//   retest   in the last 3 sessions a low came within 1% of the level AND within 1% of the 8 EMA
//   holding  the latest close >= level x 0.99 and above the 21 EMA
//   confirmed  holding AND the latest close above the prior session's high

export type RBar = { h: number; l: number; c: number };
export interface Retest821 { level: number; crossAgo: number; breakAgo: number; confirmed: boolean }

export function retest821Of(bars: RBar[]): Retest821 | null {
  const n = bars.length; if (n < 80) return null;
  const k8 = 2 / 9, k21 = 2 / 22;
  const e8: number[] = [], e21: number[] = [];
  for (let i = 0; i < n; i++) { const c = bars[i].c; e8.push(i ? c * k8 + e8[i - 1] * (1 - k8) : c); e21.push(i ? c * k21 + e21[i - 1] * (1 - k21) : c); }
  const t = n - 1;
  if (!(e8[t] > e21[t])) return null;
  let x = -1;
  for (let i = t; i >= Math.max(1, t - 40); i--) if (e8[i - 1] <= e21[i - 1] && e8[i] > e21[i]) { x = i; break; }
  if (x < 61) return null;
  let level = -Infinity; for (let i = x - 60; i < x; i++) level = Math.max(level, bars[i].h);
  let b = -1; for (let i = x; i <= t; i++) if (bars[i].c > level) { b = i; break; }
  if (b < 0) return null;
  let touched = false;
  for (let i = Math.max(b + 1, t - 2); i <= t; i++) if (bars[i].l <= level * 1.01 && bars[i].l <= e8[i] * 1.01) touched = true;
  if (!touched) return null;
  const c = bars[t].c;
  if (!(c >= level * 0.99 && c > e21[t])) return null;
  return { level: +level.toFixed(2), crossAgo: t - x, breakAgo: t - b, confirmed: c > bars[t - 1].h };
}

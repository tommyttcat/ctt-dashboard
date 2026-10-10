// lib/structure.ts — Chart Structure: what shape each liquid stock's chart is in.
//
// Descriptive, not a tested signal. Built nightly by /api/structure/nightly over
// the Liquid Leaders universe (~1,000 NASDAQ / NYSE names, $10+, $100M+ a day)
// from each name's last ~260 daily bars. Definitions (fixed 9 Oct 2026):
//
//   fit       straight line through the last 126 closes on a log scale;
//             slope = % per month (21 sessions), fit = R-squared (1 = dead straight).
//   UPTREND   slope >= +3% a month and fit >= 0.6
//   DOWNTREND slope <= -3% a month and fit >= 0.6
//   CHANNEL   an up- or downtrend whose highs AND lows both respect the line:
//             2+ swing highs at or above +1 sd of the fit and 2+ swing lows
//             at or below -1 sd (5-bar swings, last 126 sessions)
//   RANGE     sideways: over the last 60 sessions fit < 0.4 and the high-low
//             range within 10 x ADR, with 2+ swing touches near each edge (1.5 ADR)
//   BOUNCE    today's low reached support and the close came back up into the
//             upper half of the day's range: the lower channel line (-1 sd)
//             for trends / channels, the range low for ranges — within half an ADR
//   BREAKOUT  a range name closing above its prior 60-session high
//   pos       where the close sits in the trend's channel, in sd (0 = on the line)
//   smooth    "frog in the pan" over 252 sessions: sign(return) x (% down days -
//             % up days). LOW = the move came in many small steady days. Inside the
//             Momentum Leaders list the smoothest third beat the jumpiest by 1.4 / 1.6
//             points a month in both halves of 2022-26 (scripts/backtest/
//             next-move-channels.ts) — the closest anything came to passing there,
//             but it did not pass (every third trailed QQQ in 2022-24).

export const STRUCTURE_KEY = 'chart_structure_v1';

export type Shape = 'uptrend' | 'downtrend' | 'channel-up' | 'channel-down' | 'range';
export interface Bar { h: number; l: number; c: number }
export interface StructureRead {
  shape: Shape | null;
  bounce: boolean;
  breakout: boolean;
  slopeMo: number | null;      // % per month
  fit: number | null;          // R-squared, 126 sessions
  pos: number | null;          // close vs the fit, in sd
  smooth: number | null;       // frog in the pan, 252 sessions (lower = smoother)
  support: number | null;      // the lower channel line or the range low, today
  resistance: number | null;   // the upper channel line or the range high, today
  adr: number | null;          // %
}
export interface StructureRow extends StructureRead { t: string; n?: string; price: number; chg: number }
export interface StructureState { asOf: string; builtAt: string; universe: number; rows: StructureRow[] }

function logFit(c: number[]) {
  const n = c.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { const y = Math.log(c[i]); sx += i; sy += y; sxx += i * i; sxy += i * y; }
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - b * sx) / n;
  let ssr = 0, sst = 0; const my = sy / n;
  for (let i = 0; i < n; i++) { const y = Math.log(c[i]); ssr += (y - (a + b * i)) ** 2; sst += (y - my) ** 2; }
  return { a, b, sd: Math.sqrt(ssr / Math.max(1, n - 2)), r2: sst > 0 ? 1 - ssr / sst : 0 };
}
const swingHigh = (bars: Bar[], i: number) => { for (let j = i - 5; j <= i + 5; j++) if (j !== i && !(bars[j].h < bars[i].h)) return false; return true; };
const swingLow = (bars: Bar[], i: number) => { for (let j = i - 5; j <= i + 5; j++) if (j !== i && !(bars[j].l > bars[i].l)) return false; return true; };

/** Bars oldest first, today last. Needs 127+ bars; 253+ for `smooth`. */
export function readStructure(bars: Bar[]): StructureRead {
  const empty: StructureRead = { shape: null, bounce: false, breakout: false, slopeMo: null, fit: null, pos: null, smooth: null, support: null, resistance: null, adr: null };
  const n = bars.length;
  if (n < 127 || bars.some(b => !(b.c > 0 && b.h > 0 && b.l > 0))) return empty;
  let adr = 0; for (let i = n - 20; i < n; i++) adr += bars[i].h / bars[i].l - 1; adr /= 20;
  const win = bars.slice(n - 126);
  const f = logFit(win.map(b => b.c));
  const slopeMo = (Math.exp(21 * f.b) - 1) * 100;
  const line = (i: number, k: number) => Math.exp(f.a + f.b * i + k * f.sd);
  const today = bars[n - 1];
  const pos = f.sd > 0 ? (Math.log(today.c) - (f.a + f.b * 125)) / f.sd : null;
  let up = 0, dn = 0;
  if (n >= 253) for (let i = n - 252; i < n; i++) { const r = bars[i].c / bars[i - 1].c - 1; if (r > 0) up++; else if (r < 0) dn++; }
  const smooth = n >= 253 ? Math.sign(today.c / bars[n - 253].c - 1) * (dn - up) / 252 : null;

  let shape: Shape | null = null, support: number | null = null, resistance: number | null = null;
  const trendUp = slopeMo >= 3 && f.r2 >= 0.6, trendDn = slopeMo <= -3 && f.r2 >= 0.6;
  if (trendUp || trendDn) {
    let hiT = 0, loT = 0;
    for (let i = 5; i < 126 - 5; i++) {
      if (swingHigh(win, i) && win[i].h >= line(i, 1)) hiT++;
      if (swingLow(win, i) && win[i].l <= line(i, -1)) loT++;
    }
    shape = hiT >= 2 && loT >= 2 ? (trendUp ? 'channel-up' : 'channel-down') : trendUp ? 'uptrend' : 'downtrend';
    support = line(125, -1); resistance = line(125, 1);
  }
  let breakout = false;
  if (!shape) {
    const w60 = bars.slice(n - 61, n - 1);   // the 60 sessions before today
    const f60 = logFit(w60.map(b => b.c));
    const hi = Math.max(...w60.map(b => b.h)), lo = Math.min(...w60.map(b => b.l));
    let nearHi = 0, nearLo = 0;
    for (let i = 5; i < 55; i++) {
      if (swingHigh(w60, i) && w60[i].h >= hi * (1 - 1.5 * adr)) nearHi++;
      if (swingLow(w60, i) && w60[i].l <= lo * (1 + 1.5 * adr)) nearLo++;
    }
    if (f60.r2 < 0.4 && hi / lo - 1 <= 10 * adr && nearHi >= 2 && nearLo >= 2) {
      shape = 'range'; support = lo; resistance = hi;
      breakout = today.c > hi;
    }
  }
  const cs = today.h > today.l ? (today.c - today.l) / (today.h - today.l) : 0.5;
  const bounce = support != null && !breakout && today.l <= support * (1 + adr / 2) && today.c > support && cs >= 0.5;
  return { shape, bounce, breakout, slopeMo: +slopeMo.toFixed(2), fit: +f.r2.toFixed(3), pos: pos != null ? +pos.toFixed(2) : null, smooth: smooth != null ? +smooth.toFixed(3) : null, support: support != null ? +support.toFixed(2) : null, resistance: resistance != null ? +resistance.toFixed(2) : null, adr: +(adr * 100).toFixed(2) };
}

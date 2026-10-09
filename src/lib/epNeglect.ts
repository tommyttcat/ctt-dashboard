// lib/epNeglect.ts — the neglected episodic pivot, as a forward paper record.
//
// The rules are scripts/backtest/ep-neglect.ts's, fixed 9 Oct 2026 before
// that test ran. The 5-year result (86 trades, Jul 2022 - Sep 2026): +0.93% a
// trade after costs, positive in both halves (+1.72% / +0.15%), but too few
// trades to beat SPY and not distinguishable from luck (t ~ 1.4). So it is
// paper-tracked forward, shown nowhere on the site, to see whether the
// per-trade edge survives on trades the test never saw. Do NOT change a
// threshold here without changing the backtest and saying so: the forward
// record is only worth anything if it runs the rules that were tested.
//
// scripts/backtest/epn-equivalence.ts replays the backtest's 785 signals
// through these functions and must agree with it trade for trade.

export type DayBar = { o: number; h: number; l: number; c: number; v: number };
export type Minute = [number, number, number, number, number, number]; // t o h l c v

export const EPN_KEY = 'epn_paper_v1';
export const EPN_RECENT_CAP = 200;

export interface EpnCheck {
  ok: boolean;
  why?: string;
  prevClose: number;
  gap: number;
  atr: number;
  adv: number;        // 20-session average share volume before the gap
}

/**
 * The daily half of the rules. `hist` is the 200+ sessions BEFORE the gap
 * day, oldest first, every one present; `open` is the gap day's open.
 */
export function epnDaily(hist: DayBar[], open: number): EpnCheck {
  const n = hist.length;
  const base = { prevClose: n ? hist[n - 1].c : NaN, gap: n ? open / hist[n - 1].c - 1 : NaN, atr: NaN, adv: NaN };
  if (n < 200) return { ok: false, why: 'history', ...base };
  const p = hist[n - 1].c;
  if (!(open >= 5)) return { ok: false, why: 'price', ...base };
  if (!(open >= 1.10 * p)) return { ok: false, why: 'gap', ...base };                       // G1
  let dv = 0, vol = 0;
  for (let j = n - 20; j < n; j++) { dv += hist[j].c * hist[j].v; vol += hist[j].v; }
  if (!(dv / 20 >= 2e6)) return { ok: false, why: 'liquidity', ...base };                   // G2
  if (!(hist[n - 1].o < 1.06 * hist[n - 2].c)) return { ok: false, why: 'back-to-back', ...base }; // G3
  if (!(p / hist[n - 64].c - 1 <= 0.15 && p / hist[n - 127].c - 1 <= 0.30)) return { ok: false, why: 'already-run', ...base }; // N1
  let hi = -Infinity, lo = Infinity;
  for (let j = n - 60; j < n; j++) { hi = Math.max(hi, hist[j].h); lo = Math.min(lo, hist[j].l); }
  if ((hi - lo) / lo > 0.60) return { ok: false, why: 'not-quiet', ...base };              // N2
  if (!(open > hi)) return { ok: false, why: 'inside-base', ...base };                     // N3
  const sma = (k: number) => { let t = 0; for (let j = n - k; j < n; j++) t += hist[j].c; return t / k; };
  if (!(open > sma(50) && open > sma(100) && open > sma(200))) return { ok: false, why: 'below-averages', ...base }; // N4
  let atr = 0;
  for (let j = n - 14; j < n; j++) {
    const b = hist[j], pc = hist[j - 1].c;
    atr += Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
  }
  return { ok: true, prevClose: p, gap: open / p - 1, atr: atr / 14, adv: vol / 20 };
}

export type EpnEntry =
  | { ok: true; k: number; fill: number; stop: number; lod: number }
  | { ok: false; why: 'noOR' | 'negOR' | 'thin' | 'nofill' | 'widestop' };

/**
 * The intraday half: regular-hours minutes of the gap day, oldest first, and
 * the minute-of-day (ET) for each. Positive 5-minute range, volume pace,
 * first break of the 5-minute high from 9:35, stop at the low of day so far.
 */
export function epnEntry(mins: Minute[], etMin: (ms: number) => number, adv: number, atr: number): EpnEntry {
  const or = mins.filter(m => etMin(m[0]) < 575);
  if (or.length === 0) return { ok: false, why: 'noOR' };
  if (!(or[or.length - 1][4] > or[0][1])) return { ok: false, why: 'negOR' };             // E1
  if (or.reduce((a, m) => a + m[5], 0) < 0.15 * adv) return { ok: false, why: 'thin' };    // E2
  const orH = Math.max(...or.map(m => m[2]));
  const k = mins.findIndex(m => etMin(m[0]) >= 575 && m[2] > orH);
  if (k < 0) return { ok: false, why: 'nofill' };
  const fill = Math.max(orH, mins[k][1]);
  let lod = Infinity;
  for (let j = 0; j <= k; j++) lod = Math.min(lod, mins[j][3]);
  if (fill - lod > 1.5 * atr) return { ok: false, why: 'widestop' };
  return { ok: true, k, fill, stop: Math.min(lod, fill * 0.995), lod };
}

/** A paper position, stepped one session at a time on daily bars. */
export interface EpnPosition {
  t: string;
  d: string;             // gap (entry) date
  gap: number;
  fill: number;
  stop: number;          // live stop (moves to breakeven after the day-3 sale)
  stop0: number;         // the entry stop, for the record
  day: number;           // sessions held, entry day = 1
  left: number;          // fraction still held
  closes: number[];      // last 9 closes before today, for SMA10
  exits: { d: string; f: number; px: number }[];
  ret: number | null;    // whole-trade return after costs once closed
}

export const EPN_COST = 0.001;

/** Entry-day stop: only minutes after the fill can reach it. */
export function epnEntryDay(pos: EpnPosition, mins: Minute[], k: number): void {
  for (let j = k + 1; j < mins.length; j++) {
    if (mins[j][3] <= pos.stop) { closeOut(pos, pos.d, 1, Math.min(pos.stop, mins[j][1])); return; }
  }
}

function closeOut(pos: EpnPosition, d: string, f: number, px: number) {
  pos.exits.push({ d, f, px });
  pos.left = +(pos.left - f).toFixed(6);
  if (pos.left <= 0) {
    pos.left = 0;
    pos.ret = pos.exits.reduce((a, x) => a + x.f * (x.px / pos.fill - 1), 0) - 2 * EPN_COST;
  }
}

/**
 * Sessions 2+: stop first (a gap through it fills at the open), half sold at
 * the close of session 3 with the rest moved to breakeven, the rest sold on
 * the first close below SMA10 from session 3, 120-session cap.
 */
export function epnStep(pos: EpnPosition, bar: DayBar, date: string): void {
  if (pos.left <= 0) return;
  pos.day += 1;
  if (bar.o <= pos.stop) { closeOut(pos, date, pos.left, bar.o); return; }
  if (bar.l <= pos.stop) { closeOut(pos, date, pos.left, pos.stop); return; }
  const window = [...pos.closes.slice(-9), bar.c];
  const sma10 = window.length === 10 ? window.reduce((a, b) => a + b, 0) / 10 : NaN;
  if (pos.day === 3) { closeOut(pos, date, 0.5, bar.c); pos.stop = Math.max(pos.stop, pos.fill); }
  if (pos.left > 0 && pos.day >= 3 && bar.c < sma10) { closeOut(pos, date, pos.left, bar.c); }
  else if (pos.left > 0 && pos.day >= 120) { closeOut(pos, date, pos.left, bar.c); }
  pos.closes = window.slice(-9);
}

export interface EpnRecord {
  startedOn: string;
  lastDate?: string;
  open: EpnPosition[];
  closed: EpnPosition[];   // newest first, capped
  tally: { trades: number; closed: number; wins: number; sumRet: number; skipped: Record<string, number> };
  updatedAt?: string;
}

export const emptyEpnRecord = (date: string): EpnRecord => ({
  startedOn: date, open: [], closed: [], tally: { trades: 0, closed: 0, wins: 0, sumRet: 0, skipped: {} },
});

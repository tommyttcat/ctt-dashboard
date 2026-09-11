// scripts/backtest/simulate.ts — one position, walked forward.
//
// Shared by every scanner's scorer (EP9M, VCP, …) so a "home run", a stop and
// an exit mean exactly the same thing on every table. Rules fixed 11 Sep 2026
// before any result was read:
//
//   Stop        Gap through it exits at the open, not the stop.
//   Ambiguity   Daily bars cannot order a same-day stop and target. Any session
//               touching both counts as the stop — including the entry day,
//               whose low may have come before the fill.
//   Home run    +50% OR +10R from the fill within HOLD sessions.
//                 homeRunHeld = reached BEFORE the stop (tradeable)
//                 homeRunPath = reached at all (the stock ran; you may be out)
//   Exits       fixedTarget  target vs stop, else close of day HOLD
//               trail10      stop until the first close below the 10 EMA (day 2+)
//               trail21      same on the 21 EMA
//               hold20       stop, else close of day 20
//   Costs       none — commissions and slippage are not modelled.

import type { BarCache } from './cache';
import { ema } from '@/lib/indicators/marketMath';

export const HOLD = 60;
export const HR_PCT = 0.5;
export const HR_R = 10;

export type Exit = { r: number; pct: number; days: number; how: string };
export type Trade = Record<string, unknown>;

export function simulate(
  c: BarCache, id: number, flagIdx: number, entryIdx: number,
  fill: number, stop: number, target: number | null,
): Trade {
  const { O, H, L, C } = c;
  const N = c.sessions.length;
  const risk = fill - stop;
  const hrLevel = Math.min(fill * (1 + HR_PCT), fill + HR_R * risk);
  const last = Math.min(N - 1, entryIdx + HOLD - 1);

  const hist: number[] = [];
  for (let j = Math.max(0, flagIdx - 300); j < entryIdx; j++) if (!Number.isNaN(C[id][j])) hist.push(C[id][j]);

  let peak = fill, stopHitDay = -1, hrHeld = false, hrPath = false;
  const exits: Record<string, Exit | null> = { fixedTarget: null, trail10: null, trail21: null, hold20: null };
  const stopExit = (j: number): number => (j === entryIdx ? stop : Math.min(stop, O[id][j]));
  const mk = (px: number, day: number, how: string): Exit =>
    ({ r: +((px - fill) / risk).toFixed(3), pct: +((px / fill - 1) * 100).toFixed(2), days: day, how });

  let day = 0, lastClose = fill;
  for (let j = entryIdx; j <= last; j++) {
    if (Number.isNaN(C[id][j])) continue;
    day++;
    const lo = L[id][j], hi = H[id][j], cl = C[id][j];
    const stopToday = lo <= stop;
    const openAt = j === entryIdx ? fill : O[id][j];
    hist.push(cl);
    lastClose = cl;
    if (hi > peak) peak = hi;
    if (hi >= hrLevel) hrPath = true;
    if (stopHitDay < 0 && !hrHeld) {
      if (stopToday) stopHitDay = day;
      else if (hi >= hrLevel) hrHeld = true;
    }
    if (!exits.fixedTarget) {
      if (stopToday) exits.fixedTarget = mk(stopExit(j), day, 'stop');
      else if (target != null && hi >= target) exits.fixedTarget = mk(Math.max(target, openAt), day, 'target');
    }
    for (const [key, len] of [['trail10', 10], ['trail21', 21]] as const) {
      if (exits[key]) continue;
      if (stopToday) { exits[key] = mk(stopExit(j), day, 'stop'); continue; }
      const e2 = ema(hist, len);
      if (day >= 2 && e2 != null && cl < e2) exits[key] = mk(cl, day, 'ema');
    }
    if (!exits.hold20) {
      if (stopToday) exits.hold20 = mk(stopExit(j), day, 'stop');
      else if (day >= 20) exits.hold20 = mk(cl, day, 'time');
    }
  }
  for (const k of Object.keys(exits)) if (!exits[k]) exits[k] = mk(lastClose, day, 'time');

  return {
    status: 'traded', entryDelay: entryIdx - flagIdx, fill: +fill.toFixed(4), stop: +stop.toFixed(4),
    riskPct: +((risk / fill) * 100).toFixed(2),
    peakPct: +((peak / fill - 1) * 100).toFixed(2), peakR: +((peak - fill) / risk).toFixed(2),
    homeRunHeld: hrHeld, homeRunPath: hrPath, stoppedDay: stopHitDay > 0 ? stopHitDay : null, exits,
  };
}

/** Plan-free forward path from the session after the flag — comparable across scans. */
export function forwardPath(c: BarCache, id: number, flagIdx: number) {
  const { O, H, L, C } = c;
  const o1 = O[id][flagIdx + 1];
  if (!(o1 > 0)) return null;
  let hi = -Infinity, lo = Infinity, k = 0;
  const f: Record<string, number | null> = { ret5: null, ret20: null, ret60: null };
  for (let j = flagIdx + 1; j <= flagIdx + HOLD && j < c.sessions.length; j++) {
    if (Number.isNaN(C[id][j])) continue;
    k++; hi = Math.max(hi, H[id][j]); lo = Math.min(lo, L[id][j]);
    if (k === 5) f.ret5 = +((C[id][j] / o1 - 1) * 100).toFixed(2);
    if (k === 20) f.ret20 = +((C[id][j] / o1 - 1) * 100).toFixed(2);
    if (k === HOLD) f.ret60 = +((C[id][j] / o1 - 1) * 100).toFixed(2);
  }
  return { ...f, run60: +((hi / o1 - 1) * 100).toFixed(2), dd60: +((lo / o1 - 1) * 100).toFixed(2) };
}

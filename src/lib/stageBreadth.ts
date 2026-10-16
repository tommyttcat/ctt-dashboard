// lib/stageBreadth.ts — "S2": the share of liquid US stocks in Weinstein Stage 2 (12-13 Oct
// 2026, the owner's ask, after the S2-USA breadth reading). Computed nightly by the System job
// from closes it already holds (~2,000 names, $2+, $20M+/day, a year of bars), with the site's
// own stage function (lib/indicators/stage, 2A/2B/2C all count). A breadth READING, not a
// tested signal.

import { computeStageDetail } from './indicators/stage';

export const STAGE2_KEY = 'stage2_breadth_v1';
/* Per-name stage (16 Oct 2026): the same stage function on the same closes, saved for the cards
   that list names no scan carries (Liquid Leaders, Oversold Bounce), so their STG column is the
   scans' own reading instead of a dash. Written by the System nightly, read by the leaders nightly. */
export const STAGE_MAP_KEY = 'system_stage_v1';
export interface StageMapState { asOf: string; stage: Record<string, string> }
/** '2A', '4B', ... per ticker at session index t, for names with 210+ bars. */
export function stageMapAt(closes: Float64Array[], tickers: string[], t: number): Record<string, string> {
  const out: Record<string, string> = {};
  closes.forEach((c, i) => {
    const upto: number[] = [];
    for (let j = Math.max(0, t - 260); j <= t; j++) if (Number.isFinite(c[j]) && c[j] > 0) upto.push(c[j]);
    if (upto.length < 210 || !Number.isFinite(c[t])) return;
    const sh = computeStageDetail(upto).label.replace(/^Stage\s*/i, '').trim();
    if (/^[1-4]/.test(sh)) out[tickers[i]] = sh;
  });
  return out;
}

export interface Stage2Point { d: string; pct: number; n: number }
export interface Stage2State { asOf: string; pct: number; n: number; counts: Record<string, number>; history: Stage2Point[] }

/** Share in Stage 2 at session index t, from each name's closes (oldest first; NaN = no bar). */
export function stage2At(closes: Float64Array[], t: number): { pct: number; n: number; counts: Record<string, number> } {
  const counts: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0 };
  let n = 0;
  for (const c of closes) {
    const upto: number[] = [];
    for (let j = Math.max(0, t - 260); j <= t; j++) if (Number.isFinite(c[j]) && c[j] > 0) upto.push(c[j]);
    if (upto.length < 210 || !Number.isFinite(c[t])) continue;
    const s = computeStageDetail(upto).label.replace(/^Stage\s*/i, '').trim().charAt(0);
    if (!counts[s] && counts[s] !== 0) continue;
    counts[s]++; n++;
  }
  return { pct: n ? +((100 * counts['2']) / n).toFixed(1) : 0, n, counts };
}

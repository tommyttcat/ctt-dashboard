// scripts/backtest/rs.ts — rebuild the RS Rating as of any past session.
//
// /api/rs/run ranks the whole liquid market once a day from the PRIOR
// session's close, writes percentiles to KV, and every scan looks them up.
// A replay therefore needs that map as it stood before each session — rebuilt
// here from the same cached bars, with the same formula (rawRsScore), the same
// floors and the same exclusions as the live route.
//
// Difference from live, deliberate: anchors are session-exact (63/126/189/252
// sessions back), where the live route approximates them in calendar days and
// walks back to the nearest session with data.

import type { BarCache } from './cache';
import { rawRsScore, percentileRank } from '@/lib/indicators/vcp';

// Mirrors RANK_MIN_* and EXCLUDED in app/api/rs/run (11 Sep 2026).
export const RS_MIN_PRICE = 5;
export const RS_MIN_VOLUME = 100_000;
export const RS_EXCLUDED = new Set([
  'SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'VTI', 'EEM', 'EFA', 'XLF', 'XLE', 'XLK',
  'XLI', 'XLV', 'XLU', 'XLP', 'XLY', 'XLB', 'XLRE', 'XLC', 'SMH', 'SOXX',
  'TQQQ', 'SQQQ', 'QLD', 'QID', 'SOXL', 'SOXS', 'TECL', 'TECS', 'SPXL', 'SPXS',
  'SPXU', 'UPRO', 'SDS', 'SSO', 'TNA', 'TZA', 'FAS', 'FAZ', 'LABU', 'LABD',
  'UVXY', 'UVIX', 'SVIX', 'VIXY', 'VXX', 'FNGU', 'FNGD', 'GLD', 'SLV', 'GDX',
  'GDXJ', 'USO', 'UNG', 'TLT', 'HYG', 'LQD', 'ARKK', 'IBIT', 'BITO', 'BITX',
  'NUGT', 'DUST', 'JNUG', 'ERX', 'ERY', 'BOIL', 'KOLD', 'NAIL', 'URAA',
  'MSTX', 'MSTU', 'CONL', 'NVDL', 'TSLL', 'AAPU', 'MSFU', 'AMZU', 'GGLL',
  'AGG', 'BND', 'SHY', 'IEF', 'VXUS', 'VEA', 'VWO', 'SCHD', 'JEPI', 'JEPQ',
]);

export interface RsSnapshot { ratings: Map<string, number>; sortedRaws: number[] }

/** rsFor(p0) — ratings as they would have been published from session p0's close. */
export function makeRsFor(c: BarCache): (p0: number) => RsSnapshot {
  const { syms, C, V } = c;
  const at = (id: number, s: number) => (s >= 0 && !Number.isNaN(C[id][s]) && C[id][s] > 0 ? C[id][s] : null);
  return (p0: number): RsSnapshot => {
    const ratings = new Map<string, number>();
    if (p0 - 63 < 0) return { ratings, sortedRaws: [] };
    const raws: [string, number][] = [];
    for (let id = 0; id < syms.length; id++) {
      const sym = syms[id];
      if (RS_EXCLUDED.has(sym) || !/^[A-Z]{1,5}$/.test(sym)) continue;
      const c0 = at(id, p0);
      if (c0 == null || c0 < RS_MIN_PRICE) continue;
      if (!(V[id][p0] >= RS_MIN_VOLUME)) continue;
      const c63 = at(id, p0 - 63);
      if (c63 == null) continue;
      const raw = rawRsScore({ p0: c0, p63: c63, p126: at(id, p0 - 126), p189: at(id, p0 - 189), p252: at(id, p0 - 252) });
      if (raw != null) raws.push([sym, raw]);
    }
    const sortedRaws = raws.map(r => r[1]).sort((a, b) => a - b);
    for (const [sym, raw] of raws) ratings.set(sym, percentileRank(raw, sortedRaws));
    return { ratings, sortedRaws };
  };
}

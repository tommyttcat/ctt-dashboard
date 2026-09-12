// lib/scans/vcp.ts — the pure half of the VCP scan.
//
// The pattern maths already lives in lib/indicators/vcp (analyzeVcp, scoreVcp,
// evaluateTrendTemplate, findPivots, extractContractions). What was still
// stranded inside app/api/vcp/run was the scan's own judgement: which symbols
// may enter the universe, the cheap structural prefilter run market-wide, and
// the levels the trade is built from. Those live here so the historical
// backtest (scripts/backtest/replay-vcp.ts) replays the same rules production
// runs, instead of a copy that drifts the first time a threshold moves.
//
// No fetch, no KV, no clock — everything is a function of its arguments.
// Moved verbatim from the route on 11 Sep 2026; no behaviour change.

import { VCP as VCP_GATES } from '@/lib/scanConfig';
import {
  atrPercent, findPivots, extractContractions,
  PIVOT_ATR_MULTIPLE, VCP_MIN_CONTRACTIONS, VCP_MAX_CONTRACTIONS,
  VCP_SHALLOWING_TOLERANCE, VCP_MAX_FINAL_DEPTH,
  type VcpBar, type VcpResult,
} from '@/lib/indicators/vcp';

// ETFs that clear the liquidity floors. Most would fail the structural test
// anyway, but leveraged products can produce textbook-looking contractions
// that mean nothing — there is no company being accumulated. Backstopped by
// a ticker `type` check at confirmation.
export const VCP_EXCLUDED_ETFS = new Set([
  'SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'VTI', 'EEM', 'EFA', 'XLF', 'XLE', 'XLK',
  'XLI', 'XLV', 'XLU', 'XLP', 'XLY', 'XLB', 'XLRE', 'XLC', 'SMH', 'SOXX',
  'TQQQ', 'SQQQ', 'QLD', 'QID', 'SOXL', 'SOXS', 'TECL', 'TECS', 'SPXL', 'SPXS',
  'SPXU', 'UPRO', 'SDS', 'SSO', 'TNA', 'TZA', 'FAS', 'FAZ', 'LABU', 'LABD',
  'UVXY', 'UVIX', 'SVIX', 'VIXY', 'VXX', 'FNGU', 'FNGD', 'GLD', 'SLV', 'GDX',
  'GDXJ', 'USO', 'UNG', 'TLT', 'HYG', 'LQD', 'ARKK', 'IBIT', 'BITO', 'BITX',
  'NUGT', 'DUST', 'JNUG', 'ERX', 'ERY', 'BOIL', 'KOLD', 'NAIL', 'URAA',
  'MSTX', 'MSTU', 'CONL', 'NVDL', 'TSLL', 'AAPU', 'MSFU', 'AMZU',
]);

/** Symbol shape, fund exclusion and the price band, before any history. */
export function passesVcpUniverseGate(sym: string, price: number): boolean {
  if (!/^[A-Z]{1,5}$/.test(sym)) return false;
  if (VCP_EXCLUDED_ETFS.has(sym)) return false;
  return price >= VCP_GATES.minPrice && price <= VCP_GATES.maxPrice;
}

/** 20-bar average volume, the liquidity basis for both floors. */
export function avgVolume20(bars: { v: number }[]): number {
  return bars.length >= 20 ? bars.slice(-20).reduce((s, b) => s + (b.v || 0), 0) / 20 : 0;
}

/** Both liquidity floors: shares traded, and dollars at the current price. */
export function passesVcpLiquidity(avgVol: number, price: number): boolean {
  return avgVol >= VCP_GATES.minAvgVolume && avgVol * price >= VCP_GATES.minDollarVol;
}

/* ---- Structural prefilter -----------------------------------------------
   DELIBERATELY LOOSER THAN THE REAL TEST, for a reason that matters.

   analyzeVcp() gates on the prior advance — at least 25% up into the base,
   because without an advance there is no supply overhang to absorb and the
   "base" is just a quiet stock. Measuring that needs bars from BEFORE the
   base began, and a 90-bar window whose base occupies the last 40 leaves
   only 50 bars of prior history. On a base that formed after a long run,
   that truncation understates the advance and would reject the name.

   So this pass checks only what 90 bars can answer honestly — are there two
   or more contractions, is the final one tight, are they shallowing — and
   defers every judgement that needs deeper history to the confirmation pass,
   which fetches 400 bars per survivor.

   A prefilter that is stricter than the real test silently loses candidates
   and no downstream count will ever reveal it. Looser is the safe direction:
   the cost is a few extra per-ticker fetches. */
export function prefilterVcp(bars: VcpBar[]): boolean {
  if (bars.length < 60) return false;

  const atrP = atrPercent(bars, 14);
  if (atrP == null || atrP <= 0) return false;

  const threshold = Math.max(1.5, Math.min(12, atrP * PIVOT_ATR_MULTIPLE));
  const pivots = findPivots(bars, threshold);
  const all = extractContractions(bars, pivots);
  if (all.length < VCP_MIN_CONTRACTIONS) return false;

  const cons = all.slice(-VCP_MAX_CONTRACTIONS);
  const depths = cons.map(c => c.depthPct);

  if (depths[depths.length - 1] > VCP_MAX_FINAL_DEPTH) return false;

  for (let i = 1; i < depths.length; i++) {
    if (depths[i] > depths[i - 1] * VCP_SHALLOWING_TOLERANCE) return false;
  }

  return true;
}

/* ---- The trade ----------------------------------------------------------
   Trigger is the PIVOT — the high of the final contraction — not the day
   high and not the base high. Minervini's buy point is the point at which
   the last supply that defended the base gives way.

   Stop is the low of the final contraction, which is what invalidates the
   pattern: price back through the bottom of the tightest leg means the
   absorption read was wrong. That is usually a tighter stop than an ATR
   rule would produce, which is the reason to trade a VCP at all — the
   pattern defines its own risk. A floor is applied so a freakishly tight
   final leg does not produce a stop inside normal daily noise. */
export const MIN_STOP_PCT = 2.0;

export function buildLevels(vcp: VcpResult): {
  trigger: number | null;
  stop: number | null;
  stopPct: number | null;
  target: number | null;
} {
  if (!vcp.valid || vcp.pivot == null || vcp.contractions.length === 0) {
    return { trigger: null, stop: null, stopPct: null, target: null };
  }

  const finalLeg = vcp.contractions[vcp.contractions.length - 1];
  const trigger = vcp.pivot;

  let stop = finalLeg.low;
  let stopPct = ((trigger - stop) / trigger) * 100;

  if (stopPct < MIN_STOP_PCT) {
    stopPct = MIN_STOP_PCT;
    stop = trigger * (1 - MIN_STOP_PCT / 100);
  }

  const risk = trigger - stop;
  const target = trigger + risk * 2;

  return { trigger, stop, stopPct, target };
}

/* ---- Edge grade ----------------------------------------------------------
   What the letter on a VCP row means, rebuilt from the 5-year backtest
   (1,812 distinct bases, Sep 2022 - Sep 2026, pivot entry).

   The old grade came from the pattern score, and the pattern score rewards
   tightness — which is precisely the trait that lost money. Measured, both
   halves of the period agreeing:

       ATR under 2%      -0.03R,  0% home runs
       ATR 3.5-5%        +0.22R,  5.5%
       ATR 5%+           +0.39R, 19.4%
       stop under 3%     -0.53R
       stop 8%+          +0.23R, 6.9%

   A base too quiet to travel cannot pay for its own spread, and a 2% stop on
   such a name sits inside ordinary noise, so it is taken out before the move
   it was built for. The letter now says "has room to pay", not "is tight". */
export function vcpEdgeGrade(r: { atrPct?: number | null; stopPct?: number | null }): 'A' | 'B' | null {
  const atr = r.atrPct ?? null;
  const stop = r.stopPct ?? null;
  if (atr == null) return null;
  if (atr >= 3.5 && stop != null && stop >= 8) return 'A';
  if (atr >= 2.5) return 'B';
  return null;
}

export const VCP_EDGE_GRADE_TIP =
  'A: ATR 3.5%+ with an 8%+ stop. B: ATR 2.5%+. Unlettered: the tightest bases. ' +
  'What separates them is the TAIL, not the average: 10.7% of the widest bases ran +50%, against 1.7% ' +
  'for the middle and ZERO for the tightest in five years. The averages swing with the tape — this scan ' +
  'was negative through 2022-24 and positive since — so an R figure per bucket says more about which ' +
  'half it fell in than about the base. A base too quiet to travel, with a stop too tight to survive ' +
  'noise, cannot produce the move the pattern is drawn for.';

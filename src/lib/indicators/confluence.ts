/* Confluence scoring — the CNF number.
 *
 * Lifted out of app/api/scanner/run/route.ts, where it was a private const.
 * Nothing about the maths changed in the move; the point was that a SECOND
 * consumer needed it. The dollar-volume scan shows a CNF column, and the only
 * two ways to do that are to share this function or to write another one —
 * and two functions producing a number called "CNF" would give the same
 * ticker different scores depending on which card you were looking at.
 *
 * That is the same failure this codebase already had seven times over with
 * hasNews and six times with cleanSector. One definition, many callers.
 */

import { rmeScoreAdjustment } from '@/lib/indicators/rme';

export const isReversalSetupName = (setupName: string | null | undefined): boolean =>
  /blue dot|ema pb|sqz building|inside day|reversal/.test((setupName || '').toLowerCase());

export const isBreakoutSetupName = (setupName: string | null | undefined): boolean =>
  /gap & go|r2g|sqz fired|episodic|glb/.test((setupName || '').toLowerCase());

// --- Absolute extension thresholds (v6.17) ---------------------------------
// In ATRs above the 21 EMA. EXT_HARD reuses the same 3x the scanner's own
// `extended` flag and tradeplan's `overextended` use — one number, one
// meaning, three consumers.
export const EXT_HARD_ATRS = 3;
export const EXT_PARABOLIC_ATRS = 6;
// Fallbacks in raw percent when ATR is unavailable.
export const EXT_HARD_PCT_NO_ATR = 25;
export const EXT_PARABOLIC_PCT_NO_ATR = 60;

// --- Chop trap threshold (v6.18) -------------------------------------------
// ADR at or above this WITH chop at or above CHOP_CHOP_MIN is the specific
// combination the ADR floor cannot see: wide range, no direction. Reported in
// catalystCoverage so the gate in a later version can be set on evidence
// rather than on the textbook 61.8.

export const atrsAboveAnchor = (distToEma21: number | null, atrPct: number | null): number | null => {
  if (distToEma21 == null || distToEma21 <= 0) return null;
  if (atrPct != null && atrPct > 0) return distToEma21 / atrPct;
  return null;
};

export const computeCnfScore = (
  rvol: number | null,
  gapPct: number | null,
  atrExpansion: number | null,
  rsVsMkt: number | null,
  q: {
    catalystTier: 'strong' | 'neutral' | 'headline' | 'negative' | 'none';
    hasEarnings: boolean;
    scanStreak: number;
    rme: number | null;
    vwapStatus: string;
    tradeType: string;
    setupName: string | null;
    breadthSignal: string;
    spyAbove21: boolean | null;
    inHotSector: boolean;
    stageNum: number | null;
    goldenCross: boolean | null;
    pctOffHigh: number | null;
    dotKind: 'blue' | 'red' | null;
    dotBarsSince: number | null;
    isBearInstrument: boolean;
    aboveEma10: boolean | null;
    planTradeable: boolean;
    planResistanceR: number | null;
    planClear: boolean;
    planCollapsed: boolean;
    distToEma21: number | null;
    atrPct: number | null;
  }
): { score: number; grade: string; breakdown: Record<string, number>; ceiling: number; ceilingReason: string | null } => {
  const b: Record<string, number> = {};

  b.rvol = 0;
  if (rvol != null) {
    if (rvol >= 3) b.rvol = 30;
    else if (rvol >= 2) b.rvol = 24;
    else if (rvol >= 1.5) b.rvol = 18;
    else if (rvol >= 1) b.rvol = 10;
  }

  b.gap = 0;
  if (gapPct != null) {
    const g = Math.abs(gapPct);
    if (g >= 5) b.gap = 20;
    else if (g >= 3) b.gap = 15;
    else if (g >= 1.5) b.gap = 8;
  }

  b.rangeExpansion = 0;
  if (atrExpansion != null) {
    if (atrExpansion >= 2) b.rangeExpansion = 20;
    else if (atrExpansion >= 1.5) b.rangeExpansion = 15;
    else if (atrExpansion >= 1) b.rangeExpansion = 8;
  }

  b.relStrength = 0;
  if (rsVsMkt != null) {
    const d = Math.abs(rsVsMkt);
    if (d >= 3) b.relStrength = 10;
    else if (d >= 1.5) b.relStrength = 6;
  }

  b.catalyst = 0;
  if (q.catalystTier === 'strong') b.catalyst = 18;
  else if (q.catalystTier === 'neutral') b.catalyst = 10;
  else if (q.catalystTier === 'headline') b.catalyst = 8;
  else if (q.catalystTier === 'negative') b.catalyst = -15;

  b.earnings = q.hasEarnings ? 5 : 0;

  b.persistence = 0;
  if (q.scanStreak >= 4) b.persistence = 10;
  else if (q.scanStreak >= 3) b.persistence = 8;
  else if (q.scanStreak === 2) b.persistence = 4;

  // RME is a PERCENTILE and saturates. It cannot tell 7% above the anchor
  // from 198% above — both read 100. The absolute ceiling below is what
  // separates them.
  b.extension = rmeScoreAdjustment(q.rme, isReversalSetupName(q.setupName));

  b.vwap = q.vwapStatus === 'below' ? -(q.tradeType === 'Day Trade' ? 12 : 4) : 0;

  b.regime = 0;
  const isBreakout = isBreakoutSetupName(q.setupName);
  const isReversal = isReversalSetupName(q.setupName);
  if (q.breadthSignal === 'RED') {
    if (isBreakout) b.regime -= 8;
    if (isReversal) b.regime += 4;
  } else if (q.breadthSignal === 'GREEN' && q.spyAbove21 !== false) {
    if (isBreakout) b.regime += 4;
  }

  b.sector = q.inHotSector ? 5 : 0;

  b.dot = 0;
  if (q.dotKind === 'blue') b.dot = q.dotBarsSince === 0 ? 10 : 6;

  b.reclaim = 0;
  if (q.setupName === 'Reversal' && q.aboveEma10 === true) b.reclaim = 8;

  // Runway, graded on distance to the nearest overhead level. A tradeable
  // plan with no resistance reading scores 0 rather than a penalty — that is
  // the overextended case from tradeplan v1.4, and the ceiling below handles
  // it properly.
  b.runway = 0;
  if (q.planCollapsed) {
    b.runway = -10;
  } else if (q.planTradeable) {
    if (q.planClear) b.runway = 8;
    else if (q.planResistanceR == null) b.runway = 0;
    else if (q.planResistanceR >= 1.0) b.runway = -2;
    else if (q.planResistanceR >= 0.5) b.runway = -6;
    else b.runway = -10;
  }

  // NOTE (v6.18): chop14 is deliberately NOT a component here. It is emitted
  // on every row and reported in catalystCoverage, but folding it into the
  // score would move every grade at once and make its effect impossible to
  // isolate from the ceilings already in place. Score it in v6.19, once the
  // distribution has been watched.

  const raw = Object.values(b).reduce((s, v) => s + v, 0);

  // --- CEILING 1: structural ----------------------------------------------
  let structuralCeiling = 100;
  let structuralReason: string | null = null;
  const deepDrawdown = q.pctOffHigh != null && q.pctOffHigh <= -50;
  const stage4 = q.stageNum === 4;
  const deadCross = q.goldenCross === false;

  if (stage4 && deadCross) {
    structuralCeiling = isReversal ? 79 : 69;
    structuralReason = 'Stage 4 with 50<200';
  } else if (stage4 || deadCross) {
    structuralCeiling = 84;
    structuralReason = stage4 ? 'Stage 4' : '50<200';
  }
  if (deepDrawdown && (q.stageNum == null || q.stageNum >= 3)) {
    if (59 < structuralCeiling) {
      structuralCeiling = 59;
      structuralReason = '50%+ off highs';
    }
  }

  // --- CEILING 2: red dot -------------------------------------------------
  let dotCeiling = 100;
  let dotReason: string | null = null;
  if (q.dotKind === 'red' && !q.isBearInstrument) {
    const since = q.dotBarsSince ?? 0;
    if (since === 0) { dotCeiling = 44; dotReason = 'red dot today'; }
    else if (since === 1) { dotCeiling = 49; dotReason = 'red dot 1 bar ago'; }
    else { dotCeiling = 59; dotReason = `red dot ${since} bars ago`; }
  }

  // --- CEILING 3: collapse ------------------------------------------------
  let collapseCeiling = 100;
  let collapseReason: string | null = null;
  if (q.planCollapsed) {
    collapseCeiling = 44;
    collapseReason = 'price collapsed away from its own averages';
  }

  // --- CEILING 4: absolute extension (v6.17) ------------------------------
  // The one RME could not express. PN at 198% above its 21 EMA and MA at 7%
  // both scored extension -12 because the percentile saturates; this is the
  // measure that separates them.
  //
  // No bear-instrument exemption here, unlike the red-dot ceiling. An inverse
  // ETF 20 ATRs above its own anchor is exactly as un-enterable as a long
  // one — the direction of the underlying does not make a vertical move
  // buyable.
  let extCeiling = 100;
  let extReason: string | null = null;
  const atrsAbove = atrsAboveAnchor(q.distToEma21, q.atrPct);

  if (atrsAbove != null) {
    if (atrsAbove > EXT_PARABOLIC_ATRS) {
      extCeiling = 49;
      extReason = `${atrsAbove.toFixed(1)} ATRs above the 21 EMA — parabolic`;
    } else if (atrsAbove > EXT_HARD_ATRS) {
      extCeiling = 69;
      extReason = `${atrsAbove.toFixed(1)} ATRs above the 21 EMA — extended`;
    }
  } else if (q.distToEma21 != null && q.distToEma21 > 0) {
    // No ATR to normalise against. Fall back to raw percent, bluntly.
    if (q.distToEma21 > EXT_PARABOLIC_PCT_NO_ATR) {
      extCeiling = 49;
      extReason = `${q.distToEma21.toFixed(0)}% above the 21 EMA — parabolic`;
    } else if (q.distToEma21 > EXT_HARD_PCT_NO_ATR) {
      extCeiling = 69;
      extReason = `${q.distToEma21.toFixed(0)}% above the 21 EMA — extended`;
    }
  }

  const ceiling = Math.min(structuralCeiling, dotCeiling, collapseCeiling, extCeiling);
  const ceilingReason =
    ceiling === 100 ? null :
    ceiling === collapseCeiling && collapseReason ? collapseReason :
    ceiling === dotCeiling && dotReason ? dotReason :
    ceiling === extCeiling && extReason ? extReason :
    structuralReason;

  const score = Math.max(0, Math.min(ceiling, Math.round(raw)));
  const grade = score >= 70 ? 'A' : score >= 50 ? 'B' : 'C';
  return { score, grade, breakdown: b, ceiling, ceilingReason };
};

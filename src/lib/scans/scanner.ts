// lib/scans/scanner.ts — the pure half of the Stocks in Play / Daily Setups scan.
//
// app/api/scanner/run builds three of the dashboard's tables from one pass:
// Stocks in Play (share volume, must hold VWAP), Daily Setups (dollar volume,
// no VWAP test) and the setup NAME on each row — Reversal, Gap & Go, GLB, VCP
// and the rest. The naming and the gates are the scan's judgement, so they
// live here and the historical backtest (scripts/backtest/replay-scanner.ts)
// replays them instead of a copy that drifts.
//
// No fetch, no KV, no clock. Moved verbatim from the route on 11 Sep 2026;
// no behaviour change.

import { SCANNER } from '@/lib/scanConfig';
import { computeStageDetail } from '@/lib/indicators/stage';

export interface ScannerBar { t?: number; o: number; h: number; l: number; c: number; v: number }

/** The scan's universe: symbol shape, price floor, an absolute volume floor. */
export function passesScannerUniverse(sym: string, price: number, vol: number): boolean {
  return /^[A-Z]{1,5}$/.test(sym) && price >= SCANNER.minPrice && vol >= SCANNER.minVolume;
}

/** Stocks in Play: moving hard AND holding the day's average buyer. */
export function isSipCandidate(changePct: number, price: number, vwap: number): boolean {
  return Math.abs(changePct) >= SCANNER.minChange && price >= vwap;
}

/** Daily Setups: the same move, no VWAP requirement. */
export function isDailyCandidate(changePct: number): boolean {
  return changePct >= SCANNER.minChange;
}

export interface ScannerRowGates {
  vol: number; dVol: number; changePct: number;
  atr: number; avgVol: number; adrPct: number | null;
}

/** Final SIP gate — adds the liquidity and range floors to the candidate test. */
export function passesSipFinal(r: ScannerRowGates): boolean {
  return r.vol >= SCANNER.minVolume
    && r.dVol >= SCANNER.minDollarVol
    && r.changePct >= SCANNER.minChange
    && r.atr >= SCANNER.minAtr
    && r.avgVol >= SCANNER.minAvgVol
    && r.adrPct != null && r.adrPct >= SCANNER.minAdrPct;
}

/** Final Daily gate — looser: no ATR floor, no average-volume floor. */
export function passesDailyFinal(r: ScannerRowGates): boolean {
  return r.vol >= SCANNER.minVolume
    && r.dVol >= SCANNER.minDollarVol
    && r.changePct >= SCANNER.minChange
    && r.adrPct != null && r.adrPct >= SCANNER.minAdrPct;
}

/* ---- Setup naming --------------------------------------------------------
   One name per row, first match wins, checked most-specific first. BARS ARE
   DESCENDING here (bars[0] is today), which is the opposite of every lib that
   takes ascending series — the route fetches with sort=desc and this walks
   EMAs backwards from the oldest warm-up bar. */
export function detectPattern(
  bars: ScannerBar[],
  currentPrice: number,
  currentOpen: number,
  vwap: number,
  rvol: number | null,
  dotKind: 'blue' | 'red' | null,
  stochK: number | null,
): { name: string | null, stage: string, stageNum: number | null } {
  let stage = '-';
  if (!bars || bars.length < 80) return { name: null, stage, stageNum: null };

  const yest = bars[1];
  const day3 = bars[2];

  const warmUpBars = Math.min(100, bars.length - 1);
  let ema20 = bars[warmUpBars].c;
  const k20 = 2 / (20 + 1);
  for (let i = warmUpBars - 1; i >= 0; i--) {
    ema20 = (bars[i].c * k20) + (ema20 * (1 - k20));
  }

  const stageDetail = computeStageDetail(bars, { order: 'desc', price: currentPrice });
  stage = stageDetail.label;
  const stageNum = stageDetail.stage;

  const checkSqueeze = (offset: number) => {
    let sum = 0;
    for (let i = offset; i < offset + 20; i++) sum += bars[i].c;
    const sma = sum / 20;
    let variance = 0;
    for (let i = offset; i < offset + 20; i++) variance += Math.pow(bars[i].c - sma, 2);
    const stdDev = Math.sqrt(variance / 20);
    const upperBB_25 = sma + (2.5 * stdDev);
    const lowerBB_25 = sma - (2.5 * stdDev);
    const upperBB_35 = sma + (3.5 * stdDev);
    const lowerBB_35 = sma - (3.5 * stdDev);
    let sumTR = 0;
    for (let i = offset; i < offset + 20; i++) {
      const high = bars[i].h;
      const low = bars[i].l;
      const prevClose = bars[i + 1] ? bars[i + 1].c : low;
      sumTR += Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    }
    const avgTR = sumTR / 20;
    const upperKC = sma + (1.5 * avgTR);
    const lowerKC = sma - (1.5 * avgTR);
    return (upperBB_25 < upperKC && lowerBB_25 > lowerKC) || (upperBB_35 < upperKC && lowerBB_35 > lowerKC);
  };

  const isSqueezingToday = checkSqueeze(0);
  const wasSqueezingYest = checkSqueeze(1);

  if (wasSqueezingYest && !isSqueezingToday && currentPrice > ema20) {
    return { name: 'BB SQZ Fired', stage, stageNum };
  }

  if (dotKind === 'blue') {
    return { name: 'Blue Dot Rev', stage, stageNum };
  }

  const hasConvictionVol = rvol !== null && rvol >= 1.0;

  const windowRange = (start: number, len: number) => {
    const slice = bars.slice(start, start + len);
    const hi = Math.max(...slice.map(b => b.h));
    const lo = Math.min(...slice.map(b => b.l));
    return lo > 0 ? (hi - lo) / lo : 1;
  };
  const windowVol = (start: number, len: number) => {
    const slice = bars.slice(start, start + len);
    return slice.reduce((s, b) => s + (b.v || 0), 0) / Math.max(slice.length, 1);
  };
  if ((stageNum === 2 || stageNum === 3) && bars.length >= 50) {
    const rNear = windowRange(1, 12), rMid = windowRange(13, 12), rFar = windowRange(25, 12);
    const vNear = windowVol(1, 12), vMid = windowVol(13, 12), vFar = windowVol(25, 12);
    const contracting = rNear < rMid && rMid < rFar;
    const volDrying = (vNear > 0 && vMid > 0 && vFar > 0) ? (vNear < vMid && vMid < vFar) : true;
    const tightFinalLeg = rNear < 0.15;
    const baseHigh = Math.max(...bars.slice(1, 37).map(b => b.h));
    if (contracting && volDrying && tightFinalLeg && currentPrice > baseHigh && hasConvictionVol) {
      return { name: 'VCP', stage, stageNum };
    }
  }

  if (rvol !== null && rvol >= 2.0 && currentOpen >= yest.c * 1.04 && currentPrice >= currentOpen * 0.98) {
    return { name: 'Episodic Pivot', stage, stageNum };
  }

  const priorATH = Math.max(...bars.slice(1).map(b => b.h));
  const recentBaseHigh = Math.max(...bars.slice(1, 64).map(b => b.h));
  const baseOldEnough = recentBaseHigh < priorATH * 0.999;
  if (hasConvictionVol && currentPrice > priorATH && yest.c <= priorATH && baseOldEnough) {
    return { name: 'GLB', stage, stageNum };
  }

  if (hasConvictionVol && currentOpen > (yest.h * 1.01) && currentPrice >= currentOpen) {
    return { name: 'Gap & Go', stage, stageNum };
  }

  if (hasConvictionVol && currentOpen <= yest.c && currentPrice > yest.c) {
    return { name: 'R2G', stage, stageNum };
  }

  if (hasConvictionVol && yest.h < day3.h && yest.l > day3.l && currentPrice > yest.h) {
    return { name: 'Inside Day BRK', stage, stageNum };
  }

  if (currentPrice > ema20 && yest.l <= (ema20 * 1.02) && currentPrice > yest.h) {
    return { name: '20 EMA PB', stage, stageNum };
  }

  if (isSqueezingToday) {
    return { name: 'BB SQZ Building', stage, stageNum };
  }

  if (currentPrice > ema20 && currentPrice > vwap) {
    return { name: 'Trend Hold', stage, stageNum };
  }

  let ema10 = bars[warmUpBars].c;
  let ema21 = bars[warmUpBars].c;
  const k10 = 2 / (10 + 1);
  const k21 = 2 / (21 + 1);
  for (let i = warmUpBars - 1; i >= 0; i--) {
    ema10 = (bars[i].c * k10) + (ema10 * (1 - k10));
    ema21 = (bars[i].c * k21) + (ema21 * (1 - k21));
  }

  const upToday = currentPrice > yest.c;
  const underThe21 = currentPrice < ema21;

  if (upToday && underThe21) {
    const reclaimedTen = currentPrice > ema10;
    const washedOut = stochK != null && stochK <= 35;
    if (reclaimedTen || washedOut) {
      return { name: 'Reversal', stage, stageNum };
    }
  }

  return { name: null, stage, stageNum };
}

'use client';

// Consolidation1021 — v2.9
// v2.5: dropped the ? badge — the cluster wrapper is cursor-help with the
//       combined tooltip, and each stat keeps its own hover.
// v2.6: DIC / PM / BVR / 10/21% collapsed into a single RDY score.
// v2.7: RMV/RME moved to the far left of the sub-row.
// v2.8: parity with SIPs v3.0 / Daily v2.0 — RTR column and the trade plan
//       on the sub-row. RMV/RME moved back right; colspan bug fixed.
// v2.9: filter consolidation — 10 groups / 19 buttons down to 8 / 13.
//
//       THIS TABLE DOES NOT GET THE POSTURE FILTER, and that is deliberate
//       rather than an omission. SIPs, Daily and Swing all collapsed STAGE +
//       10/21 into POSTURE, whose load-bearing part is the extension check —
//       catching a name several ATRs past its anchor that passes every other
//       filter. A CONSOLIDATING NAME CANNOT BE EXTENDED BY CONSTRUCTION:
//       tight range, converging EMAs, that is the entire admission criterion.
//       And the first-touch/stacked split depends on price crossing the 10
//       EMA meaningfully, which inside a base is noise — it flips daily
//       without signalling anything. Porting posture here would have added a
//       control whose useful bucket is always empty and whose other two
//       buckets sort on coin flips.
//
//       THE REAL REDUNDANCY HERE IS 10/21 AGAINST RDY. The EMA gap is
//       already 25 of RDY's 100 points, and RDY reads it in a way a boolean
//       cannot: at the cross scores 25, ribbon opening 22, ribbon already
//       wide 12, 10 well under 21 only 5. A ">10" toggle treats a name 8%
//       above its 10 EMA identically to one sitting on it — on a coil table
//       that is backwards, because the tight one is the better base. The
//       toggle was overriding the better measurement with a worse one.
//
//       VWAP IS GONE ENTIRELY, not trimmed to Above. It is a single-session
//       measure and this is a multi-week structure. Whether price sits above
//       today's VWAP says nothing about whether a 20-day base resolves. The
//       dot stays in the price cell for the rows you are actually watching.
//
//       PLAN CLEAR → 2R+. Clear was `p.clear === true` and 1R+ was
//       `p.clear === true || resistanceR >= 1`, so every Clear row already
//       passed 1R+ — a threshold and its own subset presented as two
//       options. 2R+ is a second real level.
//
//       MKT CAP ALL removed; every group is a toggle now, so a second click
//       on the active option clears it.
//
//       WHAT SURVIVED, and why each earns its place: RDY (base quality),
//       STAT (tightness — note that coilRatio is NOT in RDY, so this is
//       genuinely orthogonal), PLAN (reward once it breaks), CNF (tape),
//       $VOL (can you get filled on the resolution), ADR (volatility), CAP,
//       STAGE (200-day structure — a coil in Stage 2 is a continuation base,
//       the same coil in Stage 4 is a bear flag, and RDY's prior-move term
//       looks at 60 days so it does not cover this).

import React, { useState, useEffect, useMemo } from 'react';
import { useMarketData } from './MarketDataContext';
import { stageColor, stageShort, stageDescription } from '@/lib/indicators/stage';
import { mfColor, mfLabel, mfArrow } from '@/lib/indicators/moneyflow';
import { stateOf, stateTooltip, stateLegend } from '@/lib/indicators/state';
import { CONSOL_META, COLUMN_NOTES } from '@/lib/scanConfig';
import MetricsKey from './MetricsKey';

const FALLBACK_NOTES: Record<string, { what: string; colour?: string }> = {
  TICKER: { what: 'Symbol. Hover shows the company name. The blue dot marks an oversold stochastic reset firing on the daily.' },
  CNF: {
    what: 'Confluence score 0–100 — how many independent factors line up: RVOL, gap, range expansion, RS, catalyst quality, persistence, VWAP, regime, sector heat. Hover the badge for the per-row breakdown.',
    colour: 'Green 70+ (A) · amber 50+ (B) · grey below (C).',
  },
  RDY: {
    what: 'Readiness 0–100 — base quality, not tape action. Combines breakout volume readiness (BVR), the 10/21 EMA gap, days in coil, and the prior move. CNF says whether it is moving; RDY says whether the base is ready. Hover a row badge for the breakdown.',
    colour: 'Purple 75+ · green 55+ · amber 35+ · grey below.',
  },
  RTR: {
    what: 'Room to resistance. How far the nearest overhead level sits above the trigger, measured in stop-widths (R = trigger minus stop). On this table the trigger is the 10-day range high — the level the coil resolves through, not today\'s high. Trigger, stop and target prices are on the sub-row.',
    colour: 'Green 2R+ (clear) · slate 1R+ · amber 0.5R+ · red under 0.5R · EXT extended · ✕ no plan.',
  },
  PRICE: {
    what: 'Last price. The dot beside it is VWAP position — a single-session read, shown for context on rows you are watching rather than used as a filter on a multi-week base.',
    colour: 'Green dot above VWAP · red dot below.',
  },
  'CHG%': {
    what: 'Change vs prior close.',
    colour: 'Green up · red down.',
  },
  '10/21': {
    what: 'Price vs the 10 and 21 EMAs — the Dr. Wish trend pair. There is no 10/21 filter on this table because the signed gap already carries 25 of RDY\'s 100 points, scored the way a coil needs it: at the cross is best, ribbon already wide is worse. Filter on RDY instead.',
    colour: 'Green dot above that EMA · red below · grey no data.',
  },
  VOL: { what: 'Shares traded today.' },
  '$VOL': { what: 'Dollar volume — price × volume. The liquidity question: can you get filled when the base resolves.' },
  RVOL: {
    what: 'Relative volume vs the 20-day average at this time of day.',
    colour: 'Amber 2x+ · green 1.5x+ · grey below.',
  },
  COIL: {
    what: 'Tightness of the last 10 days: raw 10-day range % on top, and below it that range normalized by daily ATR (N× ATR). Lower is tighter. Coiled ≤ 2.5× · Setting Up ≤ 4.0×. Not part of RDY — the STAT filter is the direct control for it.',
    colour: 'Purple ≤2.5× (coiled) · green ≤4× (setting up) · grey looser.',
  },
  ADR: {
    what: '20-day average daily range. The anti-chop gate — scan floor is 3%. Also the basis for the stop: 1.25× ADR or 2.5%, whichever is wider.',
    colour: 'Purple 10%+ · green 5%+ · grey at the floor.',
  },
  MF: {
    what: 'Money Flow (21) — volume-weighted accumulation vs distribution, 0–100. A tight coil above 55 is accumulation inside the base; the same coil under 45 is quiet distribution. Arrow shows the bar-over-bar trend.',
    colour: 'Green high (accumulation) · red low (distribution).',
  },
  RS: {
    what: 'Relative strength vs SPY over three months, in percentage points.',
    colour: 'Purple +20 · green +10 · grey positive · red negative.',
  },
  STOCH: {
    what: 'Stochastic %K (10). Low readings near a rising 21 EMA are the Blue Dot precondition.',
    colour: 'Purple ≤20 · green ≤30 · grey above.',
  },
  DTC: {
    what: 'Days to cover — sessions of normal volume for shorts to exit. Above 5 is trapped supply that has to buy at some point.',
    colour: 'Purple 5+ · green 3+ · grey below.',
  },
  MCAP: { what: 'Market cap.' },
  STAGE: {
    what: 'Weinstein stage with sub-stage. 2A strong advance · 2B extended · 2C sagging below the 50 SMA. On this table it is the structural context RDY does not carry: a coil in Stage 2 is a continuation base, the same coil in Stage 4 is a bear flag.',
    colour: 'Green healthy Stage 2 · amber sagging · red Stage 4.',
  },
  SECTOR: { what: 'Sector, cleaned of ticker prefixes.' },
};

const colTip = (key: string): string | undefined => {
  const n = COLUMN_NOTES?.[key] ?? FALLBACK_NOTES[key];
  if (!n) return undefined;
  return n.colour ? `${n.what}\n\n${n.colour}` : n.what;
};

interface TradePlanRow {
  family?: string;
  trigger?: number | null;
  triggerLabel?: string;
  stop?: number | null;
  stopPct?: number | null;
  target?: number | null;
  rMultiple?: number;
  resistanceR?: number | null;
  resistanceLabel?: string | null;
  clear?: boolean;
  collapsed?: boolean;
  overextended?: boolean;
  tradeable?: boolean;
  note?: string;
}

interface ConsolidationCandidate {
  symbol: string;
  name?: string;
  sector?: string;
  price: number;
  score: number;
  changePct?: number;
  vol?: number;
  dVol?: number;
  rvol?: number | null;
  float?: number | null;
  shortPct?: number | null;
  daysToCover?: number | null;
  mktCap?: number | null;
  stage?: string;
  vwapStatus?: 'above' | 'below' | 'neutral';
  atrPct?: number;
  adrPct?: number | null;
  rmv?: number | null;
  mf?: number | null;
  mfTrend?: number;
  rme?: number | null;
  rmeExtPct?: number | null;
  pctOffHigh?: number;
  distToEma21?: number;
  distToEma10?: number;
  aboveEma10?: boolean;
  aboveEma21?: boolean;
  stochK?: number;
  rsVsSpy?: number;
  avgDollarVolM?: number;
  goldenCross?: boolean;
  ema21Rising?: boolean;
  range10Pct?: number | null;
  coilRatio?: number | null;
  coilDays?: number | null;
  priorMovePct?: number | null;
  bvrRatio?: number | null;
  bvrReady?: boolean;
  ema1021GapPct?: number | null;
  blueDot?: boolean;
  setupName?: string | null;
  catalyst?: string | null;
  catalystUrl?: string | null;
  cnfBreakdown?: Record<string, number> | null;
  cnfCeiling?: number | null;
  cnfCeilingReason?: string | null;
  thesis?: string | null;
  news?: string | null;
  newsUrl?: string | null;
  headline?: string | null;
  plan?: TradePlanRow | null;
}

type SortDirection = 'asc' | 'desc';
type CnfFilterType = 'All' | 'A' | 'B';
type RdyFilterType = 'All' | '55' | '75';
type AdrFilterType = 'All' | '5' | '10';
type StatFilterType = 'All' | 'Coiled' | 'Setting Up';
type VolFilterType = 'All' | '20' | '50' | '100';
type PlanFilterType = 'All' | '1R' | '2R';
type CapFilterType = 'All' | 'Small' | 'Large';

const CNF_BUCKETS: CnfFilterType[] = ['A', 'B'];
const CNF_MIN_SCORE: Record<'A' | 'B', number> = { A: 70, B: 50 };
const RDY_BUCKETS: RdyFilterType[] = ['55', '75'];
const ADR_BUCKETS: AdrFilterType[] = ['5', '10'];
const VOL_BUCKETS: VolFilterType[] = ['20', '50', '100'];
const PLAN_BUCKETS: PlanFilterType[] = ['1R', '2R'];
const CAP_BUCKETS: CapFilterType[] = ['Small', 'Large'];
const STAT_BUCKETS: StatFilterType[] = ['Coiled', 'Setting Up'];

const COIL_COILED_MAX = 2.5;
const COIL_SETTING_MAX = 4.0;

const CNF_LABELS: Record<string, string> = {
  rvol: 'Relative volume',
  gap: 'Gap',
  rangeExpansion: 'Range expansion',
  relStrength: 'RS vs market',
  catalyst: 'Catalyst',
  earnings: 'Earnings proximity',
  persistence: 'Scan persistence',
  extension: 'Extension (RME)',
  vwap: 'VWAP',
  regime: 'Market regime',
  sector: 'Sector heat',
  moneyFlow: 'Money Flow',
  coil: 'Coil tightness',
  dot: 'Blue dot',
  reclaim: '10 EMA reclaimed',
  runway: 'Runway to target',
};

const formatTime = (timestamp: number | Date) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'America/New_York' });
};

const formatNumber = (num: number | null | undefined) => {
  if (num === null || num === undefined || num === 0 || isNaN(num)) return '—';
  if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return num.toLocaleString();
};

const formatCurrency = (num: number | null | undefined) => {
  if (num === null || num === undefined || num === 0 || isNaN(num)) return '—';
  if (num >= 1e9) return '$' + (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return '$' + (num / 1e6).toFixed(1) + 'M';
  return '$' + num.toLocaleString();
};

// Price levels drop the cents on anything three digits or more — at $886 the
// pennies are noise, at $4.18 they are the whole trade.
const formatLevel = (v: number | null | undefined): string => {
  if (v == null || isNaN(Number(v))) return '—';
  const n = Number(v);
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(2);
};

const formatRs = (rs: number | null | undefined): string => {
  if (rs == null || isNaN(Number(rs))) return '—';
  const v = Number(rs);
  const sign = v >= 0 ? '+' : '-';
  const abs = Math.abs(v);
  if (abs >= 1000) {
    const k = abs / 1000;
    const s = k >= 10
      ? Math.round(k).toString()
      : (Math.round(k * 10) / 10).toString().replace(/\.0$/, '');
    return `${sign}${s}k%`;
  }
  return `${sign}${Math.round(abs)}%`;
};

const statePair = (rmv: number | null, rme: number | null): string => {
  const v = rmv == null ? '—' : String(Math.round(rmv));
  const e = rme == null ? '—' : String(Math.round(rme));
  return `${v}/${e}`;
};

const BlueDot = ({ className = '' }: { className?: string }) => (
  <span
    title="Blue Dot — oversold stoch reset firing on the daily"
    className={`inline-block w-1.5 h-1.5 rounded-full bg-sky-400 shadow-[0_0_5px_rgba(56,189,248,0.6)] align-middle shrink-0 ${className}`}
  />
);

const cleanSector = (sector: string | null | undefined, ticker?: string): string => {
  if (!sector || sector === '—' || sector === '-') return '—';
  let s = String(sector).trim();
  if (ticker) {
    const rx = new RegExp(`^${ticker}\\s*[-–—:]\\s*`, 'i');
    s = s.replace(rx, '');
  }
  s = s.replace(/^[A-Z]{1,5}\s*[-–—:]\s*/, '');
  return s.trim() || '—';
};

const isGenericCatalyst = (catalyst: string | null | undefined) => {
  if (!catalyst) return true;
  const c = catalyst.toLowerCase().trim();
  return c.startsWith('technical momentum') || c === 'recent news' || c === 'news' || c === 'technical';
};

const catalystTagOf = (c: ConsolidationCandidate): string | null => {
  if (isGenericCatalyst(c.catalyst)) return null;
  return String(c.catalyst).trim().replace(/\.$/, '') || null;
};

const headlineOf = (c: ConsolidationCandidate): string | null => {
  const raw = c.thesis ?? c.news ?? c.headline ?? null;
  if (!raw) return null;
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
};

const catalystUrlOf = (c: ConsolidationCandidate): string | null => c.catalystUrl ?? c.newsUrl ?? null;

const numField = (v: any): number | null => {
  if (v == null || isNaN(Number(v))) return null;
  return Number(v);
};

const adrOf = (c: ConsolidationCandidate): number | null => numField(c.adrPct);
const mfOf = (c: ConsolidationCandidate): number | null => numField(c.mf);
const rmeOf = (c: ConsolidationCandidate): number | null => numField(c.rme);
const rmvOf = (c: ConsolidationCandidate): number | null => numField(c.rmv);
const coilRatioOf = (c: ConsolidationCandidate): number | null => numField(c.coilRatio);
const range10Of = (c: ConsolidationCandidate): number | null => numField(c.range10Pct);
const coilDaysOf = (c: ConsolidationCandidate): number | null => numField(c.coilDays);
const priorMoveOf = (c: ConsolidationCandidate): number | null => numField(c.priorMovePct);
const bvrRatioOf = (c: ConsolidationCandidate): number | null => numField(c.bvrRatio);
const gap1021Of = (c: ConsolidationCandidate): number | null => numField(c.ema1021GapPct);

/* ---- RDY: base-readiness composite -------------------------------------
   Replaces the DIC / PM / BVR / 10/21% cluster with one number.

   WEIGHTS, and why:

   BVR carries the most (35). Volume drying up inside the coil is the actual
   pre-breakout signature — a tight base on undiminished volume is just a
   pause, not accumulation finishing. It is also the field most likely to be
   ✗ on a name that otherwise looks good, which is exactly why it needs the
   heaviest weight rather than a small ✗ glyph at the end of a row.

   The 10/21 gap is next (25). Sign matters more than magnitude: the 10 above
   the 21 and opening is the ribbon confirming, at the cross is the moment of
   resolution, and the 10 below the 21 means the trend pair has not turned
   yet. A negative gap does not disqualify — a coil resolving upward crosses
   from below — but it is earlier and therefore worth fewer points.

   THIS TERM IS WHY THERE IS NO 10/21 FILTER on this table as of v2.9. A
   ">10" boolean cannot express that AT THE CROSS beats RIBBON ALREADY WIDE,
   which on a coil is the whole point — it would have let the cruder measure
   override the better one.

   Days in coil (20) and prior move (20) split the rest. Both are context: a
   long base is more meaningful than a three-day pause, and a coil after a
   strong advance is a continuation setup while a coil after nothing is just
   a quiet stock.

   COIL TIGHTNESS IS DELIBERATELY NOT IN HERE. It is the admission criterion
   for the scan rather than a differentiator within it, and it already drives
   the COIL column and the STAT filter. Folding it in would double-count the
   one thing every row on this table has in common.

   Every component degrades to 0 rather than throwing when its field is
   missing, and `sampled` reports how many of the four actually resolved so
   a score built on two inputs can be read as the weaker evidence it is.

   RDY AND RTR ANSWER DIFFERENT QUESTIONS and both are worth a column here.
   RDY is about the base: has volume dried up, is the ribbon set, has it
   coiled long enough. RTR is about the trade: once it breaks, is there room
   to be paid before something stops it. A perfect base into immediate
   resistance is a real and common shape.
   ---------------------------------------------------------------------- */
interface RdyDetail {
  score: number | null;
  parts: { label: string; value: number; max: number; detail: string }[];
  sampled: number;
}

const RDY_MAX = { bvr: 35, gap: 25, dic: 20, pm: 20 };

const computeRdy = (c: ConsolidationCandidate): RdyDetail => {
  const parts: RdyDetail['parts'] = [];
  let sampled = 0;

  // --- BVR: coil-window volume vs the prior window. Lower is drier. -------
  const bvr = bvrRatioOf(c);
  if (bvr != null) {
    sampled++;
    let v: number;
    let detail: string;
    if (bvr <= 0.55) { v = 35; detail = `${bvr.toFixed(2)}× — volume fully dried up`; }
    else if (bvr <= 0.70) { v = 28; detail = `${bvr.toFixed(2)}× — dried up, ready`; }
    else if (bvr <= 0.85) { v = 16; detail = `${bvr.toFixed(2)}× — thinning but not there`; }
    else if (bvr <= 1.0) { v = 6; detail = `${bvr.toFixed(2)}× — volume still full`; }
    else { v = 0; detail = `${bvr.toFixed(2)}× — volume rising inside the base`; }
    parts.push({ label: 'BVR', value: v, max: RDY_MAX.bvr, detail });
  } else {
    parts.push({ label: 'BVR', value: 0, max: RDY_MAX.bvr, detail: 'no data' });
  }

  // --- 10/21 gap: signed, as % of price ----------------------------------
  const gap = gap1021Of(c);
  if (gap != null) {
    sampled++;
    let v: number;
    let detail: string;
    const a = Math.abs(gap);
    if (a <= 0.5) { v = 25; detail = `${gap >= 0 ? '+' : ''}${gap.toFixed(1)}% — at the cross`; }
    else if (gap > 0.5 && gap <= 2.5) { v = 22; detail = `+${gap.toFixed(1)}% — 10 over 21, ribbon opening`; }
    else if (gap > 2.5 && gap <= 5) { v = 12; detail = `+${gap.toFixed(1)}% — ribbon already wide`; }
    else if (gap > 5) { v = 4; detail = `+${gap.toFixed(1)}% — extended off the pair`; }
    else if (gap < -0.5 && gap >= -1.5) { v = 14; detail = `${gap.toFixed(1)}% — 10 under 21, coiling into the cross`; }
    else { v = 5; detail = `${gap.toFixed(1)}% — 10 well under 21, pair has not turned`; }
    parts.push({ label: '10/21', value: v, max: RDY_MAX.gap, detail });
  } else {
    parts.push({ label: '10/21', value: 0, max: RDY_MAX.gap, detail: 'no data' });
  }

  // --- Days in coil ------------------------------------------------------
  const dic = coilDaysOf(c);
  if (dic != null) {
    sampled++;
    let v: number;
    if (dic >= 20) v = 20;
    else if (dic >= 14) v = 17;
    else if (dic >= 10) v = 13;
    else if (dic >= 7) v = 8;
    else v = 3;
    parts.push({ label: 'DIC', value: v, max: RDY_MAX.dic, detail: `${dic} days in the base` });
  } else {
    parts.push({ label: 'DIC', value: 0, max: RDY_MAX.dic, detail: 'no data' });
  }

  // --- Prior move --------------------------------------------------------
  const pm = priorMoveOf(c);
  if (pm != null) {
    sampled++;
    let v: number;
    let detail: string;
    if (pm >= 50) { v = 20; detail = `+${pm.toFixed(0)}% runup — strong advance into the base`; }
    else if (pm >= 30) { v = 17; detail = `+${pm.toFixed(0)}% runup`; }
    else if (pm >= 15) { v = 11; detail = `+${pm.toFixed(0)}% runup — modest`; }
    else if (pm >= 0) { v = 4; detail = `+${pm.toFixed(0)}% — little advance to continue`; }
    else { v = 0; detail = `${pm.toFixed(0)}% — base formed after a decline`; }
    parts.push({ label: 'PM', value: v, max: RDY_MAX.pm, detail });
  } else {
    parts.push({ label: 'PM', value: 0, max: RDY_MAX.pm, detail: 'no data' });
  }

  // Fewer than two resolved fields is not a score, it is a guess.
  if (sampled < 2) return { score: null, parts, sampled };

  const raw = parts.reduce((s, p) => s + p.value, 0);
  return { score: Math.round(raw), parts, sampled };
};

const rdyTooltip = (c: ConsolidationCandidate, d: RdyDetail): string => {
  const lines: string[] = [];
  if (d.score == null) {
    lines.push('RDY — not enough data to score');
  } else {
    const band =
      d.score >= 75 ? 'base is ready' :
      d.score >= 55 ? 'setting up' :
      d.score >= 35 ? 'early' : 'not there yet';
    lines.push(`RDY ${d.score} — ${band}`);
  }
  lines.push('');
  lines.push('Base readiness, not tape action. CNF says whether it is moving; RTR says whether there is room once it breaks.');
  lines.push('');
  for (const p of d.parts) {
    lines.push(`${String(p.value).padStart(2)}/${p.max}  ${p.label} — ${p.detail}`);
  }
  if (d.sampled < 4) {
    lines.push('');
    lines.push(`Built from ${d.sampled} of 4 inputs — treat as weaker evidence.`);
  }
  return lines.join('\n');
};

/* ---- Trade plan ---------------------------------------------------------
   Reads the `plan` object the swing route ships. Nothing is recalculated
   here, so the table cannot disagree with the score.

   The trigger on this table is the 10-DAY RANGE HIGH, not today's high —
   the route tags these rows 'Coil' so the planner uses rangeHigh. That is
   the level the base actually resolves through.                          */
const planOf = (c: ConsolidationCandidate): TradePlanRow | null => {
  const p = c.plan;
  return p && typeof p === 'object' ? p : null;
};

const PLAN_SORT_CLEAR = 99;
const PLAN_SORT_NONE = -1;

const planSortValue = (c: ConsolidationCandidate): number => {
  const p = planOf(c);
  if (!p || p.tradeable !== true) return PLAN_SORT_NONE;
  if (p.collapsed) return PLAN_SORT_NONE;
  if (p.overextended) return PLAN_SORT_NONE;
  if (p.clear) return p.resistanceR != null ? p.resistanceR : PLAN_SORT_CLEAR;
  return p.resistanceR != null ? p.resistanceR : PLAN_SORT_NONE;
};

const planShort = (c: ConsolidationCandidate): string => {
  const p = planOf(c);
  if (!p) return '—';
  if (p.collapsed) return '✕';
  if (p.tradeable !== true) return '—';
  if (p.overextended) return 'EXT';
  if (p.clear) return p.resistanceR != null ? `${p.resistanceR.toFixed(1)}R` : '2R+';
  if (p.resistanceR == null) return '—';
  return `${p.resistanceR.toFixed(1)}R`;
};

const planBadge = (c: ConsolidationCandidate): string => {
  const p = planOf(c);
  if (!p) return 'bg-white/[0.02] text-slate-600 border-white/5';
  if (p.collapsed) return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
  if (p.tradeable !== true) return 'bg-white/[0.02] text-slate-600 border-white/5';
  if (p.overextended) return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
  if (p.clear) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
  const r = p.resistanceR;
  if (r == null) return 'bg-white/[0.02] text-slate-600 border-white/5';
  if (r >= 1.0) return 'bg-slate-500/10 text-slate-300 border-white/10';
  if (r >= 0.5) return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
  return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
};

const planTooltip = (c: ConsolidationCandidate): string => {
  const p = planOf(c);
  if (!p) return 'No trade plan on this row — rerun the swing scan.';
  if (p.tradeable !== true) return `No plan — ${p.note || 'not computable'}.`;

  const lines: string[] = [];
  lines.push(`Trigger  ${p.trigger != null ? p.trigger.toFixed(2) : '—'}  (${p.triggerLabel || '—'})`);
  lines.push(`Stop     ${p.stop != null ? p.stop.toFixed(2) : '—'}  (${p.stopPct != null ? `−${p.stopPct.toFixed(1)}%` : '—'})`);
  lines.push(`Target   ${p.target != null ? p.target.toFixed(2) : '—'}  (2R)`);
  if (p.trigger != null && p.stop != null) {
    lines.push(`Risk     ${(p.trigger - p.stop).toFixed(2)} per share`);
  }
  lines.push('');
  if (p.resistanceR != null) {
    lines.push(`Nearest overhead: ${p.resistanceLabel || 'level'} at ${p.resistanceR.toFixed(1)}R`);
  } else {
    lines.push('No overhead level between trigger and target.');
  }
  if (p.note) {
    lines.push('');
    lines.push(p.note);
  }
  lines.push('');
  lines.push('Stop is the wider of 1.25× ADR or 2.5%. Target is a fixed 2R.');
  return lines.join('\n');
};

const coilStat = (c: ConsolidationCandidate): 'Coiled' | 'Setting Up' | null => {
  const r = coilRatioOf(c);
  if (r == null) return null;
  if (r <= COIL_COILED_MAX) return 'Coiled';
  if (r <= COIL_SETTING_MAX) return 'Setting Up';
  return null;
};

const rmeLabel = (rme: number | null): string => {
  if (rme == null) return 'n/a';
  if (rme >= 90) return 'at historical extension high';
  if (rme >= 75) return 'heavily extended';
  if (rme >= 60) return 'extended';
  if (rme >= 25) return 'moderately above anchor';
  if (rme > -25) return 'near anchor';
  if (rme > -60) return 'moderately below anchor';
  if (rme > -85) return 'deeply below anchor';
  return 'at historical extension low';
};

const cnfTooltip = (c: ConsolidationCandidate): string => {
  const score = c.score;
  const lines: string[] = [
    score != null ? `CNF ${score} — ${score >= 70 ? 'A' : score >= 50 ? 'B' : 'C'}` : 'CNF — not scored',
  ];

  const bd = c.cnfBreakdown;
  if (bd && typeof bd === 'object') {
    const entries = Object.entries(bd)
      .filter(([, v]) => typeof v === 'number' && v !== 0)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    if (entries.length > 0) {
      lines.push('');
      for (const [k, v] of entries) {
        lines.push(`${v > 0 ? '+' : ''}${v}  ${CNF_LABELS[k] || k}`);
      }
    }
  }

  if (c.cnfCeiling != null && c.cnfCeiling < 100) {
    lines.push('');
    lines.push(`Capped at ${c.cnfCeiling}${c.cnfCeilingReason ? ` — ${c.cnfCeilingReason}` : ''}`);
  }

  const rme = rmeOf(c);
  if (rme != null) {
    lines.push('');
    lines.push(`RME ${rme > 0 ? '+' : ''}${rme.toFixed(0)} — ${rmeLabel(rme)}`);
    if (c.rmeExtPct != null) {
      lines.push(`(${c.rmeExtPct >= 0 ? '+' : ''}${c.rmeExtPct.toFixed(1)}% from the 21 EMA)`);
    }
  }

  lines.push('');
  lines.push('CNF does not read BVR or the 10/21 gap — see RDY for base quality.');

  return lines.join('\n');
};

// Still used by the EMA dots in the 10/21 column. The FILTER that read these
// is gone in v2.9 — the gap is scored inside RDY, where the coil-specific
// interpretation lives — but the column itself stays.
const above21 = (c: ConsolidationCandidate) => c.aboveEma21 ?? (c.distToEma21 != null ? c.distToEma21 >= 0 : null);
const above10 = (c: ConsolidationCandidate) => c.aboveEma10 ?? (c.distToEma10 != null ? c.distToEma10 >= 0 : null);

export default function Consolidation1021() {
  const { session } = useMarketData();

  const [candidates, setCandidates] = useState<ConsolidationCandidate[]>([]);
  const [status, setStatus] = useState<string>('Syncing...');
  const [generatedAt, setGeneratedAt] = useState<number | null>(null);
  const [scanMeta, setScanMeta] = useState<any>(null);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: SortDirection } | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [showStage2Only, setShowStage2Only] = useState<boolean>(false);
  const [marketCapFilter, setMarketCapFilter] = useState<CapFilterType>('All');
  const [cnfFilter, setCnfFilter] = useState<CnfFilterType>('All');
  const [rdyFilter, setRdyFilter] = useState<RdyFilterType>('All');
  const [adrFilter, setAdrFilter] = useState<AdrFilterType>('All');
  const [statFilter, setStatFilter] = useState<StatFilterType>('All');
  const [volFilter, setVolFilter] = useState<VolFilterType>('All');
  const [planFilter, setPlanFilter] = useState<PlanFilterType>('All');
  const [showFilters, setShowFilters] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    const fetchCandidates = async () => {
      try {
        const res = await fetch(`/api/consolidation/latest?t=${Date.now()}`, { cache: 'no-store' });
        const data = await res.json();

        if (isMounted && data && data.success && Array.isArray(data.candidates)) {
          setCandidates(data.candidates);
          setGeneratedAt(data.lastScanTime ? Number(data.lastScanTime) : Date.now());
          if (data.scanMeta?.consolidation) setScanMeta(data.scanMeta.consolidation);
          else if (data.scanMeta) setScanMeta(data.scanMeta);
          setStatus('Live');
        } else if (isMounted && data?.error) {
          setStatus('Feed Error');
        }
      } catch {
        if (isMounted) setStatus('Feed Offline');
      }
    };
    fetchCandidates();
    const interval = setInterval(fetchCandidates, 60000);
    return () => { isMounted = false; clearInterval(interval); };
  }, []);

  // RDY is derived, not a payload field, so it is memoized per row and keyed
  // by symbol — recomputing it inside the sort comparator would run it
  // O(n log n) times per render.
  const rdyBySymbol = useMemo(() => {
    const m = new Map<string, RdyDetail>();
    for (const c of candidates) m.set(c.symbol, computeRdy(c));
    return m;
  }, [candidates]);

  const handleSort = (key: string) => {
    let direction: SortDirection = 'desc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') direction = 'asc';
    else if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') { setSortConfig(null); return; }
    setSortConfig({ key, direction });
  };

  // Every group is a toggle: pressing the active option clears it. That is
  // what removed the need for a MKT CAP "All" button — nothing selected
  // already means all, and a second click gets you there.
  const handleAdrFilter = (val: AdrFilterType) => setAdrFilter(prev => prev === val ? 'All' : val);
  const handleCnfFilter = (val: CnfFilterType) => setCnfFilter(prev => prev === val ? 'All' : val);
  const handleRdyFilter = (val: RdyFilterType) => setRdyFilter(prev => prev === val ? 'All' : val);
  const handleStatFilter = (val: StatFilterType) => setStatFilter(prev => prev === val ? 'All' : val);
  const handleVolFilter = (val: VolFilterType) => setVolFilter(prev => prev === val ? 'All' : val);
  const handlePlanFilter = (val: PlanFilterType) => setPlanFilter(prev => prev === val ? 'All' : val);
  const handleCapFilter = (val: CapFilterType) => setMarketCapFilter(prev => prev === val ? 'All' : val);

  const filteredAndSorted = useMemo(() => {
    let filtered = [...candidates];
    if (showStage2Only) filtered = filtered.filter(c => stageShort(c.stage).startsWith('2'));
    if (marketCapFilter !== 'All') {
      filtered = filtered.filter(c => {
        const mc = c.mktCap;
        if (!mc) return true;
        if (marketCapFilter === 'Large') return mc >= 2e9;
        if (marketCapFilter === 'Small') return mc < 2e9;
        return true;
      });
    }
    if (cnfFilter !== 'All') {
      const minScore = CNF_MIN_SCORE[cnfFilter];
      filtered = filtered.filter(c => (c.score ?? -1) >= minScore);
    }
    /* RDY replaces the old 10/21 filter as the way to ask about the trend
       pair — the gap is 25 of its 100 points, scored so that AT THE CROSS
       outranks RIBBON ALREADY WIDE. A row that cannot be scored (fewer than
       two resolved inputs) falls out rather than passing on a null. */
    if (rdyFilter !== 'All') {
      const minRdy = Number(rdyFilter);
      filtered = filtered.filter(c => {
        const r = rdyBySymbol.get(c.symbol)?.score;
        return r != null && r >= minRdy;
      });
    }
    if (adrFilter !== 'All') {
      const minAdr = Number(adrFilter);
      filtered = filtered.filter(c => {
        const a = adrOf(c);
        return a != null && a >= minAdr;
      });
    }
    // Tightness. NOT part of RDY — coilRatio is the scan's admission
    // criterion rather than a differentiator inside it, so this is the
    // direct control and the two do not double-count.
    if (statFilter !== 'All') {
      filtered = filtered.filter(c => coilStat(c) === statFilter);
    }
    if (volFilter !== 'All') {
      const minVol = Number(volFilter) * 1e6;
      filtered = filtered.filter(c => (c.dVol ?? (c.avgDollarVolM ? c.avgDollarVolM * 1e6 : 0)) >= minVol);
    }
    /* Plan filter drops anything without a usable entry, then applies a
       threshold in stop-widths.

       `clear` rows carry no resistanceR at all — there is nothing overhead to
       measure — so they satisfy BOTH levels rather than falling out of the
       stricter one. That is the correction v2.9 makes: the old pair had
       "Clear" as a subset of "1R+" and called them two options. */
    if (planFilter !== 'All') {
      const minR = planFilter === '2R' ? 2.0 : 1.0;
      filtered = filtered.filter(c => {
        const p = planOf(c);
        if (!p || p.tradeable !== true || p.collapsed || p.overextended) return false;
        if (p.clear === true) return true;
        return p.resistanceR != null && p.resistanceR >= minR;
      });
    }
    if (!sortConfig) return filtered;
    return filtered.sort((a, b) => {
      const aVal = sortConfig.key === 'rdy'
        ? (rdyBySymbol.get(a.symbol)?.score ?? null)
        : sortConfig.key === 'planR'
          ? planSortValue(a)
          : ((a as any)[sortConfig.key] as any);
      const bVal = sortConfig.key === 'rdy'
        ? (rdyBySymbol.get(b.symbol)?.score ?? null)
        : sortConfig.key === 'planR'
          ? planSortValue(b)
          : ((b as any)[sortConfig.key] as any);
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [candidates, rdyBySymbol, sortConfig, showStage2Only, marketCapFilter, cnfFilter, rdyFilter, adrFilter, statFilter, volFilter, planFilter]);

  const handleCopyTickers = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const tickers = filteredAndSorted.map(c => c.symbol).join(',');
    if (!tickers) return;
    try {
      await navigator.clipboard.writeText(tickers);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = tickers;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch {}
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const getSortIcon = (columnKey: string) => sortConfig?.key === columnKey ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓') : '';

  const getScoreBadge = (score: number) => {
    if (score >= 70) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    if (score >= 50) return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    return 'bg-zinc-800/50 text-zinc-400 border-zinc-700/50';
  };
  const getRdyBadge = (score: number | null) => {
    if (score == null) return 'bg-zinc-800/50 text-zinc-500 border-zinc-700/50';
    if (score >= 75) return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
    if (score >= 55) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    if (score >= 35) return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    return 'bg-zinc-800/50 text-zinc-400 border-zinc-700/50';
  };
  const getRvolColor = (rvol: number | null | undefined) => {
    if (!rvol) return 'text-slate-500';
    if (rvol >= 2) return 'text-amber-400';
    if (rvol >= 1.5) return 'text-emerald-400';
    return 'text-slate-500';
  };
  const getAdrColor = (a: number | null) => {
    if (a == null) return 'text-slate-500';
    if (a >= 10) return 'text-purple-400';
    if (a >= 5) return 'text-emerald-400';
    if (a >= 3) return 'text-slate-300';
    return 'text-slate-500';
  };
  const getDtcColor = (d: number | null | undefined) => {
    if (d == null) return 'text-slate-500';
    if (d >= 5) return 'text-purple-400';
    if (d >= 3) return 'text-emerald-400';
    if (d >= 1.5) return 'text-slate-300';
    return 'text-slate-500';
  };
  const getStochColor = (k: number | null | undefined) => {
    if (k == null) return 'text-slate-500';
    if (k <= 20) return 'text-purple-400';
    if (k <= 30) return 'text-emerald-400';
    return 'text-slate-400';
  };
  const getRsColor = (rs: number | null | undefined) => {
    if (rs == null) return 'text-slate-500';
    if (rs >= 20) return 'text-purple-400';
    if (rs >= 10) return 'text-emerald-400';
    if (rs >= 0) return 'text-slate-300';
    return 'text-rose-400';
  };
  const getCoilColor = (r: number | null) => {
    if (r == null) return 'text-slate-500';
    if (r <= COIL_COILED_MAX) return 'text-purple-400';
    if (r <= COIL_SETTING_MAX) return 'text-emerald-400';
    return 'text-slate-400';
  };

  const emaDot = (state: boolean | null | undefined) => {
    if (state === null || state === undefined) return 'bg-slate-600';
    return state ? 'bg-emerald-400' : 'bg-rose-500';
  };

  const displaySession = ['Pre-Market', 'Open', 'Post-Market', 'Closed'].includes(session) ? session : 'Closed';
  const getSessionTextColor = () => {
    if (displaySession === 'Pre-Market') return 'text-amber-500';
    if (displaySession === 'Open') return 'text-[#00e676]';
    if (displaySession === 'Post-Market') return 'text-indigo-400';
    return 'text-slate-500';
  };

  const thBase = "px-0.5 py-2.5 text-[10px] text-slate-500 font-bold tracking-wide leading-tight cursor-pointer hover:text-slate-300 transition-colors text-center";
  const tdBase = "px-0.5 pt-2.5 pb-1.5 text-center";

  const thStage = "px-0.5 pl-1.5 py-2.5 text-[10px] text-slate-500 font-bold tracking-wide leading-tight cursor-pointer hover:text-slate-300 transition-colors text-left";
  const tdStage = "px-0.5 pl-1.5 pt-2.5 pb-1.5 text-left";

  const thSector = "px-0.5 pl-1.5 py-2.5 text-[10px] text-slate-500 font-bold tracking-wide leading-tight cursor-pointer hover:text-slate-300 transition-colors text-left";
  const tdSector = "px-0.5 pl-1.5 pt-2.5 pb-1.5 text-left";

  const filterBtnActive = "bg-[#1e293b] text-indigo-400 border border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.1)]";
  const filterBtnIdle = "text-slate-500 border border-transparent hover:text-slate-300 hover:bg-white/[0.02]";
  const pillWrap = "flex items-center gap-3 px-4 py-1 bg-[#161c2a] border border-white/5 rounded-lg shrink-0";
  const pillLabel = "text-[11px] font-bold tracking-widest uppercase text-slate-400";
  const pillBtn = "px-3 py-1 rounded-lg text-[11px] font-bold tracking-widest uppercase transition-all duration-300 whitespace-nowrap";

  const activeFilterCount =
    (rdyFilter !== 'All' ? 1 : 0) +
    (statFilter !== 'All' ? 1 : 0) +
    (planFilter !== 'All' ? 1 : 0) +
    (cnfFilter !== 'All' ? 1 : 0) +
    (volFilter !== 'All' ? 1 : 0) +
    (adrFilter !== 'All' ? 1 : 0) +
    (marketCapFilter !== 'All' ? 1 : 0) +
    (showStage2Only ? 1 : 0);

  return (
    <div className="bg-[#101623] border border-white/5 rounded-2xl p-3 md:p-5 relative overflow-visible shadow-xl w-full max-w-[1280px] mx-auto">
      <div onClick={() => setIsExpanded(!isExpanded)} className={`flex justify-between items-center relative z-30 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-5 border-b border-white/5 pb-4' : ''}`}>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs md:text-sm font-bold text-[#7c8bfa] bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 group-hover:bg-white/[0.02] transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
            10/21 CONSOLIDATION
          </span>
          {filteredAndSorted.length > 0 && (
            <button
              onClick={handleCopyTickers}
              title={`Copy ${filteredAndSorted.length} ticker${filteredAndSorted.length !== 1 ? 's' : ''} for TradingView`}
              className={`text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded border transition-all duration-200 ${
                copied
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-[#161c2a] text-slate-400 border-white/5 hover:text-slate-200 hover:bg-white/[0.04]'
              }`}
            >
              {copied ? `✓ Copied ${filteredAndSorted.length}` : `Copy ${filteredAndSorted.length}`}
            </button>
          )}
          <span className="relative z-40 inline-flex">
            <MetricsKey meta={CONSOL_META} liveGates={scanMeta?.gates} />
          </span>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-center justify-center border border-white/5 bg-[#161c2a]/40 px-4 py-1.5 rounded-[10px] min-w-[120px]">
            <span className={`text-[10px] font-bold tracking-widest uppercase ${getSessionTextColor()}`}>{displaySession}</span>
          </div>
          {generatedAt && (<span className="text-[11px] text-slate-400/80 font-medium px-1 tracking-wide">Scanned: {formatTime(generatedAt)} EST</span>)}
        </div>
      </div>

      {isExpanded && (
        <>
          <div className="flex flex-col gap-3 mb-4 relative z-10" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-center">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`px-4 py-1.5 rounded-lg text-[11px] font-bold tracking-widest uppercase transition-all duration-300 flex items-center gap-2 ${
                  activeFilterCount > 0
                    ? 'bg-[#1e293b] text-indigo-400 border border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.1)]'
                    : 'bg-[#161c2a] text-slate-400 border border-white/5 hover:bg-white/[0.04]'
                }`}
              >
                <span className={`inline-block transition-transform duration-200 ${showFilters ? 'rotate-90' : ''}`}>▸</span>
                Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
              </button>
            </div>
            {showFilters && (
              <div className="flex flex-wrap justify-center items-center gap-3 w-full">
                {/* RDY and STAT lead because they are the two coil-specific
                    questions — is the base ready, and is it tight. Everything
                    after them is generic screening this table shares with the
                    others. */}
                <div className={pillWrap}>
                  <span className={pillLabel}>RDY</span>
                  <div className="flex items-center gap-1">
                    {RDY_BUCKETS.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => handleRdyFilter(opt)}
                        title={opt === '75'
                          ? 'Base ready — RDY 75 and above. Volume dried up, ribbon set, coiled long enough.'
                          : 'Setting up or better — RDY 55 and above. Also the way to filter on the 10/21 pair: the signed gap is 25 of RDY\'s 100 points.'}
                        className={`${pillBtn} ${rdyFilter === opt ? filterBtnActive : filterBtnIdle}`}
                      >
                        {opt}+
                      </button>
                    ))}
                  </div>
                </div>
                <div className={pillWrap}>
                  <span className={pillLabel}>STAT</span>
                  <div className="flex items-center gap-1">
                    {STAT_BUCKETS.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => handleStatFilter(opt)}
                        title={opt === 'Coiled'
                          ? '10-day range at or under 2.5× daily ATR — genuinely tight'
                          : '10-day range at or under 4× daily ATR — narrowing but not there'}
                        className={`${pillBtn} ${statFilter === opt ? filterBtnActive : filterBtnIdle}`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={pillWrap}>
                  <span className={pillLabel}>PLAN</span>
                  <div className="flex items-center gap-1">
                    {PLAN_BUCKETS.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => handlePlanFilter(opt)}
                        title={opt === '2R'
                          ? 'At least two stop-widths above the range high before the first level overhead, or clear air'
                          : 'At least one stop-width above the range high before the first level overhead'}
                        className={`${pillBtn} ${planFilter === opt ? filterBtnActive : filterBtnIdle}`}
                      >
                        {opt === '1R' ? '1R+' : '2R+'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={pillWrap}>
                  <span className={pillLabel}>CNF</span>
                  <div className="flex items-center gap-1">
                    {CNF_BUCKETS.map((g) => (
                      <button
                        key={g}
                        onClick={() => handleCnfFilter(g)}
                        title={g === 'A' ? 'A only — CNF 70 and above' : 'B and above — includes A (CNF 50+)'}
                        className={`${pillBtn} ${cnfFilter === g ? filterBtnActive : filterBtnIdle}`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={pillWrap}>
                  <span className={pillLabel}>$VOL</span>
                  <div className="flex items-center gap-1">
                    {VOL_BUCKETS.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => handleVolFilter(opt)}
                        title={`Dollar volume of $${opt}M and above — can you get filled when the base resolves`}
                        className={`${pillBtn} ${volFilter === opt ? filterBtnActive : filterBtnIdle}`}
                      >
                        {opt}M+
                      </button>
                    ))}
                  </div>
                </div>
                <div className={pillWrap}>
                  <span className={pillLabel}>ADR</span>
                  <div className="flex items-center gap-1">
                    {ADR_BUCKETS.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => handleAdrFilter(opt)}
                        title={`20-day average daily range of ${opt}% and above — scan floor is 3%`}
                        className={`${pillBtn} ${adrFilter === opt ? filterBtnActive : filterBtnIdle}`}
                      >
                        {opt}%+
                      </button>
                    ))}
                  </div>
                </div>
                <div className={pillWrap}>
                  <span className={pillLabel}>CAP</span>
                  <div className="flex items-center gap-1">
                    {CAP_BUCKETS.map((cap) => (
                      <button
                        key={cap}
                        onClick={() => handleCapFilter(cap)}
                        title={cap === 'Large' ? 'Market cap $2B and above' : 'Market cap under $2B'}
                        className={`${pillBtn} ${marketCapFilter === cap ? filterBtnActive : filterBtnIdle}`}
                      >
                        {cap}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={pillWrap}>
                  <span className={pillLabel}>STAGE</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setShowStage2Only(!showStage2Only)}
                      title="Stage 2 only — includes 2A, 2B and 2C. A coil in Stage 2 is a continuation base; the same coil in Stage 4 is a bear flag."
                      className={`${pillBtn} ${showStage2Only ? filterBtnActive : filterBtnIdle}`}
                    >
                      2
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="relative z-0 overflow-x-auto custom-scrollbar" style={{ scrollbarWidth: 'thin' }}>
            {/* 19 columns — min-w 980. */}
            <table className="w-full min-w-[980px] table-fixed border-collapse">
              <thead>
                <tr className="border-b border-white/5 select-none">
                  <th className={`${thBase} w-[7%]`} title={colTip('TICKER')} onClick={() => handleSort('symbol')}>TICKER{getSortIcon('symbol')}</th>
                  <th className={`${thBase} w-[4%]`} title={colTip('CNF')} onClick={() => handleSort('score')}>CNF{getSortIcon('score')}</th>
                  <th className={`${thBase} w-[4%]`} title={colTip('RDY')} onClick={() => handleSort('rdy')}>RDY{getSortIcon('rdy')}</th>
                  <th className={`${thBase} w-[5%]`} title={colTip('RTR')} onClick={() => handleSort('planR')}>RTR{getSortIcon('planR')}</th>
                  <th className={`${thBase} w-[6%]`} title={colTip('PRICE')} onClick={() => handleSort('price')}>PRICE{getSortIcon('price')}</th>
                  <th className={`${thBase} w-[6%]`} title={colTip('CHG%')} onClick={() => handleSort('changePct')}>CHG%{getSortIcon('changePct')}</th>
                  <th className={`${thBase} w-[6%]`} title={colTip('10/21')}>10/21</th>
                  <th className={`${thBase} w-[5%]`} title={colTip('VOL')} onClick={() => handleSort('vol')}>VOL{getSortIcon('vol')}</th>
                  <th className={`${thBase} w-[5%]`} title={colTip('$VOL')} onClick={() => handleSort('dVol')}>$VOL{getSortIcon('dVol')}</th>
                  <th className={`${thBase} w-[5%]`} title={colTip('RVOL')} onClick={() => handleSort('rvol')}>RVOL{getSortIcon('rvol')}</th>
                  <th className={`${thBase} w-[6%]`} title={colTip('COIL')} onClick={() => handleSort('coilRatio')}>COIL{getSortIcon('coilRatio')}</th>
                  <th className={`${thBase} w-[5%]`} title={colTip('ADR')} onClick={() => handleSort('adrPct')}>ADR{getSortIcon('adrPct')}</th>
                  <th className={`${thBase} w-[4%]`} title={colTip('MF')} onClick={() => handleSort('mf')}>MF{getSortIcon('mf')}</th>
                  <th className={`${thBase} w-[6%]`} title={colTip('RS')} onClick={() => handleSort('rsVsSpy')}>RS{getSortIcon('rsVsSpy')}</th>
                  <th className={`${thBase} w-[5%]`} title={colTip('STOCH')} onClick={() => handleSort('stochK')}>STOCH{getSortIcon('stochK')}</th>
                  <th className={`${thBase} w-[4%]`} title={colTip('DTC')} onClick={() => handleSort('daysToCover')}>DTC{getSortIcon('daysToCover')}</th>
                  <th className={`${thBase} w-[5%]`} title={colTip('MCAP')} onClick={() => handleSort('mktCap')}>MCAP{getSortIcon('mktCap')}</th>
                  <th className={`${thStage} w-[5%] border-l border-white/5`} title={colTip('STAGE')} onClick={() => handleSort('stage')}>STAGE{getSortIcon('stage')}</th>
                  <th className={`${thSector} w-[7%]`} title={colTip('SECTOR')} onClick={() => handleSort('sector')}>SECTOR{getSortIcon('sector')}</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-white/5">
                {filteredAndSorted.length === 0 ? (
                  <tr><td colSpan={19} className="py-12 text-center text-slate-500 text-sm font-medium">{status === 'Live' ? (candidates.length > 0 ? 'No candidates match current filter criteria.' : 'No consolidations in the current scan.') : status === 'Syncing...' ? 'Running scan…' : 'Feed unavailable — awaiting next scheduled scan.'}</td></tr>
                ) : (
                  filteredAndSorted.map((row) => {
                    const isPositive = (row.changePct ?? 0) >= 0;
                    const tag = catalystTagOf(row);
                    const headline = headlineOf(row);
                    const catUrl = catalystUrlOf(row);
                    const sectorText = cleanSector(row.sector, row.symbol);
                    const adr = adrOf(row);
                    const mf = mfOf(row);
                    const rmv = rmvOf(row);
                    const rme = rmeOf(row);
                    const stateRes = stateOf(rmv, rme);
                    const coilR = coilRatioOf(row);
                    const range10 = range10Of(row);
                    const st = coilStat(row);
                    const rdy = rdyBySymbol.get(row.symbol) ?? computeRdy(row);
                    const plan = planOf(row);
                    const gap = gap1021Of(row);
                    return (
                      <React.Fragment key={row.symbol}>
                        <tr className="hover:bg-white/[0.02] transition-colors group">
                          <td className={tdBase}>
                            <div className="flex items-center justify-center gap-1.5">
                              <span title={row.name || row.symbol} className="inline-block bg-indigo-500/10 text-[#7c8bfa] text-[11px] font-bold px-1.5 py-0.5 rounded border border-indigo-500/20 cursor-help">{row.symbol}</span>
                              {row.blueDot && <BlueDot />}
                            </div>
                          </td>
                          <td className={tdBase}>
                            <span
                              title={cnfTooltip(row)}
                              className={`inline-block whitespace-nowrap px-1.5 py-[2px] rounded text-[9px] font-bold border cursor-help ${getScoreBadge(row.score)}`}
                            >
                              {row.score}
                            </span>
                          </td>
                          <td className={tdBase}>
                            <span
                              title={rdyTooltip(row, rdy)}
                              className={`inline-block whitespace-nowrap px-1.5 py-[2px] rounded text-[9px] font-bold border cursor-help ${getRdyBadge(rdy.score)}`}
                            >
                              {rdy.score ?? '—'}
                            </span>
                          </td>
                          <td className={tdBase}>
                            <span
                              title={planTooltip(row)}
                              className={`inline-block whitespace-nowrap px-1.5 py-[2px] rounded text-[9px] font-bold border cursor-help ${planBadge(row)}`}
                            >
                              {planShort(row)}
                            </span>
                          </td>
                          <td className={`${tdBase} text-xs text-slate-300 font-medium whitespace-nowrap tabular-nums`}>
                            <div className="flex items-center justify-center gap-1">${row.price.toFixed(2)}{row.vwapStatus && row.vwapStatus !== 'neutral' && (<div className={`w-1.5 h-1.5 rounded-full shrink-0 ${row.vwapStatus === 'above' ? 'bg-emerald-400' : 'bg-rose-500'}`} title={`VWAP: ${row.vwapStatus}`}></div>)}</div>
                          </td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>{row.changePct != null ? `${isPositive ? '+' : ''}${row.changePct.toFixed(2)}%` : '—'}</td>
                          {/* The dots stay; the FILTER that read them is gone.
                              Hover now names the gap and its RDY contribution,
                              so the column points at where the trend pair is
                              actually scored. */}
                          <td className={`${tdBase} whitespace-nowrap`}>
                            <div
                              className="flex items-center justify-center gap-1"
                              title={gap != null
                                ? `10/21 gap ${gap >= 0 ? '+' : ''}${gap.toFixed(1)}% — scored inside RDY, hover that badge for the value`
                                : undefined}
                            >
                              <div className="flex items-center gap-px">
                                <span className="text-[8px] font-bold text-slate-500">10</span>
                                <div className={`w-1.5 h-1.5 rounded-full ${emaDot(above10(row))}`} title={`10 EMA: ${above10(row) == null ? 'n/a' : above10(row) ? 'above' : 'below'}`}></div>
                              </div>
                              <div className="flex items-center gap-px">
                                <span className="text-[8px] font-bold text-slate-500">21</span>
                                <div className={`w-1.5 h-1.5 rounded-full ${emaDot(above21(row))}`} title={`21 EMA: ${above21(row) == null ? 'n/a' : above21(row) ? 'above' : 'below'}`}></div>
                              </div>
                            </div>
                          </td>
                          <td className={`${tdBase} text-xs text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{formatNumber(row.vol)}</td>
                          <td className={`${tdBase} text-xs text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{row.dVol ? formatCurrency(row.dVol) : (row.avgDollarVolM ? `$${row.avgDollarVolM}M` : '—')}</td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getRvolColor(row.rvol)}`}>{row.rvol ? `${row.rvol.toFixed(1)}x` : '—'}</td>
                          <td className={`${tdBase} whitespace-nowrap tabular-nums ${getCoilColor(coilR)}`} title={coilR != null ? `10-day range normalized to ${coilR.toFixed(1)}× daily ATR` : undefined}>
                            <div className="flex flex-col leading-tight">
                              <span className="text-xs font-bold">{range10 != null ? `${range10.toFixed(1)}%` : '—'}</span>
                              <span className="text-[8px] font-semibold opacity-80">{coilR != null ? `${coilR.toFixed(1)}× ATR` : ''}</span>
                            </div>
                          </td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getAdrColor(adr)}`}>
                            {adr != null ? `${adr.toFixed(1)}%` : '—'}
                          </td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${mfColor(mf)}`} title={mf != null ? `Money Flow ${mf.toFixed(0)} — ${mfLabel(mf)}` : undefined}>
                            {mf != null ? `${mf.toFixed(0)}${mfArrow(row.mfTrend ?? 0)}` : '—'}
                          </td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getRsColor(row.rsVsSpy)}`} title={row.rsVsSpy != null ? `${row.rsVsSpy >= 0 ? '+' : ''}${row.rsVsSpy.toFixed(1)} percentage points vs SPY over three months` : undefined}>
                            {formatRs(row.rsVsSpy)}
                          </td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getStochColor(row.stochK)}`}>{row.stochK != null ? row.stochK.toFixed(1) : '—'}</td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getDtcColor(row.daysToCover)}`}>
                            {row.daysToCover != null ? row.daysToCover.toFixed(1) : '—'}
                          </td>
                          <td className={`${tdBase} text-xs text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{formatNumber(row.mktCap)}</td>
                          <td className={`${tdStage} whitespace-nowrap border-l border-white/5`}>
                            <span
                              title={stageDescription(row.stage)}
                              className={`text-[9px] font-bold tracking-wide cursor-help ${stageColor(row.stage)}`}
                            >
                              {stageShort(row.stage)}
                            </span>
                          </td>
                          <td className={tdSector}>
                            <span title={sectorText} className="block truncate text-left text-[8px] font-semibold tracking-wide uppercase text-slate-400">{sectorText}</span>
                          </td>
                        </tr>
                        {/* Sub-row: colSpan 17 covers TICKER..MCAP, then STAGE
                            and SECTOR get their own cells — 19 total, matching
                            the header.

                            Levels sit under the ticker where the setup name
                            goes on the other tables. There is no setup name to
                            show here — every row is a coil — so the trigger
                            leads instead. */}
                        <tr className="bg-transparent border-t border-white/5">
                          <td colSpan={17} className="pb-1.5 pt-1 pr-3">
                            <div className="flex items-center text-left gap-0 min-w-0">
                              {plan?.tradeable && plan.trigger != null ? (
                                <span
                                  title={planTooltip(row)}
                                  className="shrink-0 flex items-baseline gap-2 pl-1 pr-2.5 cursor-help whitespace-nowrap"
                                >
                                  <span className="flex items-baseline gap-1">
                                    <span className="text-[8px] font-bold tracking-[0.08em] uppercase text-slate-600">TRIG</span>
                                    <span className="text-[9px] font-bold tabular-nums text-slate-200">{formatLevel(plan.trigger)}</span>
                                  </span>
                                  <span className="flex items-baseline gap-1">
                                    <span className="text-[8px] font-bold tracking-[0.08em] uppercase text-slate-600">STOP</span>
                                    <span className="text-[9px] font-bold tabular-nums text-rose-400/90">{formatLevel(plan.stop)}</span>
                                  </span>
                                  <span className="flex items-baseline gap-1">
                                    <span className="text-[8px] font-bold tracking-[0.08em] uppercase text-slate-600">TGT</span>
                                    <span className="text-[9px] font-bold tabular-nums text-emerald-400/90">{formatLevel(plan.target)}</span>
                                  </span>
                                </span>
                              ) : (
                                <span className="shrink-0 pl-1 pr-2.5 text-[9px] font-semibold text-slate-600 italic whitespace-nowrap">
                                  {plan?.collapsed ? 'no long plan' : plan?.note === 'trigger already passed' ? 'entry passed' : 'no plan'}
                                </span>
                              )}
                              <p className="flex-1 min-w-0 text-[10px] leading-relaxed border-l border-white/10 pl-2.5 pr-3 truncate" title={headline || undefined}>
                                {headline || tag ? (
                                  <>
                                    {tag && (
                                      <>
                                        <span className="text-[8px] font-bold tracking-[0.12em] uppercase text-amber-400/70">{tag}</span>
                                        {headline ? ' ' : ''}
                                      </>
                                    )}
                                    {headline && (
                                      catUrl ? (
                                        <a href={catUrl} target="_blank" rel="noopener noreferrer" className="text-slate-500 font-normal hover:text-slate-300 hover:underline transition-colors">{headline}</a>
                                      ) : (
                                        <span className="text-slate-500 font-normal">{headline}</span>
                                      )
                                    )}
                                  </>
                                ) : (
                                  <span className="text-slate-600 italic">No news catalyst — technical setup only.</span>
                                )}
                              </p>
                              <span
                                title={stateTooltip(rmv, rme)}
                                className="shrink-0 flex items-baseline gap-1.5 cursor-help whitespace-nowrap"
                              >
                                <span className="text-[8px] font-bold tracking-[0.1em] uppercase text-slate-600">RMV/RME</span>
                                <span className="text-[9px] font-semibold text-slate-500 tabular-nums">{statePair(rmv, rme)}</span>
                              </span>
                            </div>
                          </td>
                          <td className="pb-1.5 pt-1 pl-1.5 text-left align-middle border-l border-white/5">
                            <span
                              title={stateLegend(rmv, rme)}
                              className={`text-[8px] font-bold cursor-help whitespace-nowrap ${stateRes.color}`}
                            >
                              {stateRes.state === 'UNKNOWN' ? '—' : stateRes.state}
                            </span>
                          </td>
                          <td className="pb-1.5 pt-1 pl-1.5 text-left align-middle">
                            {st === 'Coiled' ? (
                              <span className="text-[8px] font-semibold text-emerald-400 whitespace-nowrap">Coiled</span>
                            ) : st === 'Setting Up' ? (
                              <span className="text-[8px] font-semibold text-amber-400 whitespace-nowrap">Setting Up</span>
                            ) : null}
                          </td>
                        </tr>
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
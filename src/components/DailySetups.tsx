'use client';

// DailySetups — v2.2
// v1.7: matched SIPs v2.8 — header z-30, SECTOR left-aligned, min-w 880.
// v1.8: column widths copied 1:1 from SIPs v2.8 (FLOAT dropped).
// v1.9: DAY/SWING chip text off-white — text-slate-300 → text-slate-200.
// v2.0: brought in line with SIPs v3.0 — RTR column, trade plan on the
//       sub-row, setup name under the ticker, DAY/SWING chip removed into
//       the plan tooltip.
// v2.1: filter consolidation — POSTURE replaces STAGE + 10/21, PLAN Clear →
//       2R+, HOLD added, MKT CAP All and VWAP Below removed.
// v2.2: + CHOPPINESS INDEX (chop14), from scanner route v6.18. Matches
//       StocksInPlay v3.2.
//
//       CHOP SHARES THE ADR CELL rather than taking a column of its own.
//       ADR and CHOP answer two halves of one question and are misleading
//       apart: ADR says the name MOVES, CHOP says it moves SOMEWHERE. A row
//       reading ADR 8.2% looks like the best kind of candidate right up until
//       you learn it is CHOP 74, at which point it is the worst thing on the
//       board — huge daily travel, no resolution. Adjacent columns would let
//       the eye take one without the other, which is the exact failure the
//       field exists to prevent.
//
//       THIS TABLE NOW CARRIES EIGHT FILTER GROUPS, which is more than any
//       other, and that is defensible only because every one asks a different
//       question: POSTURE where price sits, CHOP whether the range resolves,
//       PLAN what the reward looks like, HOLD how long you are in it, CNF how
//       it scored, ADR how much it moves, CAP how big it is, VWAP whether
//       today is being bought. None of them is a rephrasing of another. The
//       v2.1 consolidation removed the pairs that WERE rephrasings; adding a
//       genuinely new dimension back is not a reversal of it.
//
//       THE FILTER IS A THRESHOLD PAIR, matching PLAN. TREND is the narrow
//       cut (38.2 and below); NO CHOP is the broad one (under 61.8, excludes
//       only the churners) and is the one worth pressing daily.

import React, { useState, useEffect, useMemo } from 'react';
import { useMarketData } from './MarketDataContext';
import { stageColor, stageShort, stageDescription } from '@/lib/indicators/stage';
import { mfColor, mfLabel, mfArrow } from '@/lib/indicators/moneyflow';
import { stateOf, stateTooltip, stateLegend, readinessTooltip } from '@/lib/indicators/state';
import {
  chopColor,
  chopTooltip,
  CHOP_TREND_MAX,
  CHOP_CHOP_MIN,
} from '@/lib/indicators/chop';
import { SCANNER_DAILY_META, COLUMN_NOTES } from '@/lib/scanConfig';
import MetricsKey from './MetricsKey';

const FALLBACK_NOTES: Record<string, { what: string; colour?: string }> = {
  TICKER: { what: 'Symbol. Hover shows the company name. The setup name sits directly beneath it.' },
  CNF: {
    what: 'Confluence score 0–100 — how many independent factors line up: RVOL, gap, range expansion, RS, catalyst quality, persistence, VWAP, regime, sector heat, dots, runway. Hover the badge for the per-row breakdown and any grade ceiling.',
    colour: 'Green 70+ (A) · amber 50+ (B) · grey below (C).',
  },
  RTR: {
    what: 'Room to resistance. How far the nearest overhead level sits above the trigger, measured in stop-widths (R = trigger minus stop). 2R+ means the target is reachable before anything blocks it. Trigger, stop and target prices are on the sub-row; hover this badge for the full plan and the holding period.',
    colour: 'Green 2R+ (clear) · slate 1R+ · amber 0.5R+ · red under 0.5R · EXT extended · ✕ no plan.',
  },
  PRICE: {
    what: 'Last price. The dot beside it is VWAP position.',
    colour: 'Green dot above VWAP · red dot below.',
  },
  'CHG%': {
    what: 'Change vs prior close. Scan floor is +4%.',
    colour: 'Green up · red down.',
  },
  '10/21': {
    what: 'Price vs the 10 and 21 EMAs — the Dr. Wish trend pair. This pair drives the POSTURE filter: above 21 and below 10 is a first touch, above both is stacked, below 21 is broken.',
    colour: 'Green dot above that EMA · red below · grey no data.',
  },
  VOL: { what: 'Shares traded today. Scan floor is 500K.' },
  '$VOL': { what: 'Dollar volume — price × volume. Scan floor is $5M.' },
  RVOL: {
    what: 'Relative volume vs the 20-day average at this time of day.',
    colour: 'Amber 2x+ · green 1.5x+ · grey below.',
  },
  ADR: {
    what: 'Two readings, stacked, because neither means much alone.\n\nTOP — ADR: 20-day average daily range. The scan floor is 3%. Also the stop basis: 1.25× ADR or 2.5%, whichever is wider.\n\nBOTTOM — CHOP: 14-day Choppiness Index. Distance travelled over ground covered. ADR says the name MOVES; CHOP says it moves SOMEWHERE. A wide ADR with CHOP above 61.8 is the trap — huge daily range, no resolution, triggers fire and reverse.',
    colour: 'ADR: purple 10%+ · green 5%+ · grey at the floor.\nCHOP: teal/green trending · slate mixed · amber choppy · red dead chop.',
  },
  MF: {
    what: 'Money Flow (21) — volume-weighted accumulation vs distribution, 0–100. Arrow shows the bar-over-bar trend.',
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
  MCAP: { what: 'Market cap. Scan floor is $20M.' },
  STAGE: {
    what: 'Weinstein stage with sub-stage. 2A strong advance · 2B extended · 2C sagging below the 50 SMA. Hover the value for the row-specific read.',
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

interface SetupData {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  vwapStatus: 'above' | 'below' | 'neutral';
  changePct: number;
  vol: number;
  dVol: number;
  rvol: number | null;
  float: number | null;
  shortPct: number | null;
  daysToCover: number | null;
  mktCap: number | null;
  stage: string;
  setupName: string | null;
  catalyst?: string | null;
  catalystUrl?: string | null;
  conviction?: number | null;
  thesis?: string | null;
  tradeType?: string | null;
  aboveEma10?: boolean | null;
  aboveEma21?: boolean | null;
  stochK?: number | null;
  rsVsSpy?: number | null;
  distToEma21?: number | null;
  adrPct?: number | null;
  chop14?: number | null;
  chopTrap?: boolean | null;
  rmv?: number | null;
  mf?: number | null;
  mfTrend?: number;
  rme?: number | null;
  rmeExtPct?: number | null;
  cnfBreakdown?: Record<string, number> | null;
  cnfCeiling?: number | null;
  cnfCeilingReason?: string | null;
  goldenCross?: boolean | null;
  ema21Rising?: boolean | null;
  status?: string | null;
  dotKind?: 'blue' | 'red' | null;
  dotBarsSince?: number | null;
  plan?: TradePlanRow | null;
}

type SortDirection = 'asc' | 'desc';
type CnfFilterType = 'All' | 'A' | 'B';
type VwapFilterType = 'All' | 'above';
type AdrFilterType = 'All' | '5' | '10';
type PlanFilterType = 'All' | '1R' | '2R';
type CapFilterType = 'All' | 'Small' | 'Large';
type PostureFilterType = 'All' | 'first-touch' | 'stacked' | 'extended';
type HoldFilterType = 'All' | 'DAY' | 'SWING';
type ChopFilterType = 'All' | 'trend' | 'nochop';

const CNF_BUCKETS: CnfFilterType[] = ['A', 'B'];
const CNF_MIN_SCORE: Record<'A' | 'B', number> = { A: 70, B: 50 };
const ADR_BUCKETS: AdrFilterType[] = ['5', '10'];
const PLAN_BUCKETS: PlanFilterType[] = ['1R', '2R'];
const CAP_BUCKETS: CapFilterType[] = ['Small', 'Large'];
const POSTURE_BUCKETS: PostureFilterType[] = ['first-touch', 'stacked', 'extended'];
const HOLD_BUCKETS: HoldFilterType[] = ['DAY', 'SWING'];
const CHOP_BUCKETS: ChopFilterType[] = ['trend', 'nochop'];

const CHOP_META: Record<ChopFilterType, { label: string; title: string }> = {
  'All': { label: 'ALL', title: '' },
  'trend': {
    label: 'TREND',
    title: `Choppiness ${CHOP_TREND_MAX} or below — the name is covering ground rather than travelling in circles. The narrow cut; expect it to empty the table on a rangebound tape.`,
  },
  'nochop': {
    label: 'NO CHOP',
    title: `Choppiness under ${CHOP_CHOP_MIN} — excludes only the churners. The broad cut, and the one worth leaving on: it removes names whose triggers fire and reverse without demanding a clean trend.`,
  },
};

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
  dot: 'Blue dot',
  reclaim: '10 EMA reclaimed',
  runway: 'Runway to target',
};

const formatTime = (timestamp: number | Date) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'America/New_York' });
};

const formatNumber = (num: number | null) => {
  if (num === null || num === 0 || isNaN(num)) return '—';
  if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return num.toLocaleString();
};

const formatCurrency = (num: number | null) => {
  if (num === null || num === 0 || isNaN(num)) return '—';
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

const formatSetupName = (name: string | null) => {
  if (!name || name === '-' || name === '—') return '—';
  if (name.includes('BB SQZ')) return 'BB SQZ';
  if (name === 'Blue Dot Rev') return 'BD Rev';
  if (name === 'Episodic Pivot') return 'EP';
  return name;
};

const isBlueDotSetup = (name: string | null | undefined): boolean => {
  if (!name) return false;
  const n = String(name).toLowerCase();
  return n === 'blue dot rev' || n.includes('blue dot') || n.includes('bd rev');
};

const BlueDot = ({ className = '' }: { className?: string }) => (
  <span
    title="Blue Dot Reversal"
    className={`inline-block w-1.5 h-1.5 rounded-full bg-sky-400 shadow-[0_0_5px_rgba(56,189,248,0.6)] align-middle shrink-0 ${className}`}
  />
);

const RedDot = ({ className = '' }: { className?: string }) => (
  <span
    title="Red Dot — overbought reversal against a long"
    className={`inline-block w-1.5 h-1.5 rounded-full bg-rose-500 shadow-[0_0_5px_rgba(244,63,94,0.6)] align-middle shrink-0 ${className}`}
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

const catalystTagOf = (row: SetupData): string | null => {
  if (isGenericCatalyst(row.catalyst)) return null;
  const cat = String(row.catalyst).trim().replace(/\.$/, '');
  return cat || null;
};

const headlineOf = (row: SetupData): string | null => {
  if (!row.thesis) return null;
  const s = String(row.thesis).trim();
  return s.length > 0 ? s : null;
};

const adrOf = (row: SetupData): number | null => {
  if (row.adrPct == null || isNaN(Number(row.adrPct))) return null;
  return Number(row.adrPct);
};

const chopOf = (row: SetupData): number | null => {
  if (row.chop14 == null || isNaN(Number(row.chop14))) return null;
  return Number(row.chop14);
};

const mfOf = (row: SetupData): number | null => {
  if (row.mf == null || isNaN(Number(row.mf))) return null;
  return Number(row.mf);
};

const rmeOf = (row: SetupData): number | null => {
  if (row.rme == null || isNaN(Number(row.rme))) return null;
  return Number(row.rme);
};

const rmvOf = (row: SetupData): number | null => {
  if (row.rmv == null || isNaN(Number(row.rmv))) return null;
  return Number(row.rmv);
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

const tradeTypeLabel = (tradeType: string | null | undefined): string | null => {
  if (!tradeType) return null;
  const t = tradeType.toLowerCase();
  if (t.startsWith('day')) return 'DAY';
  if (t.startsWith('swing')) return 'SWING';
  return tradeType.toUpperCase();
};

/* ---- Trade plan ---------------------------------------------------------
   The scanner computes trigger / stop / 2R target / distance-to-resistance
   and ships them on every row. These read that object; nothing is
   recalculated here, so the table cannot disagree with the score.

   SORT VALUE needs care. A name with no plan must sort to the bottom rather
   than the top, and `clear` rows have no resistanceR at all when price is
   above every average — those are the BEST rows, so they need a high
   sentinel rather than a null.                                           */
const planOf = (row: SetupData): TradePlanRow | null => {
  const p = row.plan;
  return p && typeof p === 'object' ? p : null;
};

const PLAN_SORT_CLEAR = 99;
const PLAN_SORT_NONE = -1;

const planSortValue = (row: SetupData): number => {
  const p = planOf(row);
  if (!p || p.tradeable !== true) return PLAN_SORT_NONE;
  if (p.collapsed) return PLAN_SORT_NONE;
  if (p.overextended) return PLAN_SORT_NONE;
  if (p.clear) return p.resistanceR != null ? p.resistanceR : PLAN_SORT_CLEAR;
  return p.resistanceR != null ? p.resistanceR : PLAN_SORT_NONE;
};

const planShort = (row: SetupData): string => {
  const p = planOf(row);
  if (!p) return '—';
  if (p.collapsed) return '✕';
  if (p.tradeable !== true) return '—';
  if (p.overextended) return 'EXT';
  if (p.clear) return p.resistanceR != null ? `${p.resistanceR.toFixed(1)}R` : '2R+';
  if (p.resistanceR == null) return '—';
  return `${p.resistanceR.toFixed(1)}R`;
};

const planBadge = (row: SetupData): string => {
  const p = planOf(row);
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

// Holding period leads the tooltip. It also has its own filter now, but the
// tooltip is where you are already looking when you care about the levels,
// and the same trigger means a different position depending on whether you
// intend to be out by the close.
const planTooltip = (row: SetupData): string => {
  const p = planOf(row);
  const tt = tradeTypeLabel(row.tradeType);
  if (!p) return 'No trade plan on this row — rerun the scan.';
  if (p.tradeable !== true) return `No plan — ${p.note || 'not computable'}.`;

  const lines: string[] = [];
  if (tt) lines.push(`${tt}${tt === 'DAY' ? ' — intraday only' : ' — multi-day hold viable'}`);
  if (tt) lines.push('');
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

  /* A chop reading belongs in the PLAN tooltip, not just the ADR cell,
     because it is the thing most likely to invalidate the plan. A clean 2R
     setup inside a churning range is a trigger that fires and reverses —
     the levels are correct and the trade still does not work.

     WORSE ON A SWING ROW THAN A DAY ROW. A day trade is out by the close and
     only needs the move to hold for hours; a swing is held across sessions,
     which is exactly the window a churning range uses to take it back. */
  const chop = chopOf(row);
  if (chop != null && chop >= CHOP_CHOP_MIN) {
    lines.push('');
    lines.push(
      tt === 'SWING'
        ? `CHOP ${chop.toFixed(0)} — the levels are sound but the range keeps rejecting both edges. A multi-day hold is the worst way to own that.`
        : `CHOP ${chop.toFixed(0)} — the levels are sound but the range has been rejecting both edges. Expect this trigger to fail.`
    );
  }

  lines.push('');
  lines.push('Stop is the wider of 1.25× ADR or 2.5%. Target is a fixed 2R.');
  return lines.join('\n');
};

/* ---- POSTURE ------------------------------------------------------------
   One structural read, replacing the old STAGE 2 and 10/21 controls.

   THE ORDER OF THESE CHECKS IS THE WHOLE POINT. Extension is tested FIRST,
   because a name can be above both EMAs, pass "Stage 2", pass ">21", and
   still be four ATRs past its anchor with nowhere to put a stop. Under the
   old pair that row sailed through every filter. Here it lands in EXTENDED,
   where you can see it and exclude it.

   POSTURE AND CHOP ARE ORTHOGONAL and both are worth having. Posture asks
   where price sits relative to its averages; chop asks whether the range it
   sits in resolves. A textbook first touch inside a churning range is a
   perfect-looking entry that does not work.                               */
type PostureBucket = 'first-touch' | 'stacked' | 'extended' | 'below-21';

const EXTENSION_ATR_MULTIPLE = 3;
const EXTENSION_FALLBACK_PCT = 12;

const postureOf = (row: SetupData): PostureBucket | null => {
  const above21 = row.aboveEma21;
  if (above21 == null) return null;

  // Extension first — see the note above. The scanner's own verdict wins if
  // it has one, since that is what the RTR column is already showing.
  const p = planOf(row);
  if (p?.overextended === true) return 'extended';

  const d21 = row.distToEma21;
  const adr = adrOf(row);
  if (above21 === true && d21 != null) {
    const ceiling = adr != null && adr > 0 ? EXTENSION_ATR_MULTIPLE * adr : EXTENSION_FALLBACK_PCT;
    if (d21 > ceiling) return 'extended';
  }

  if (above21 === false) return 'below-21';
  // Holding the 21 but back under the 10 — the Dr. Wish first touch, the one
  // bucket where the stop is both defined and close.
  if (row.aboveEma10 === false) return 'first-touch';
  return 'stacked';
};

const POSTURE_META: Record<PostureFilterType, { label: string; title: string }> = {
  'All': { label: 'ALL', title: '' },
  'first-touch': {
    label: 'FIRST TOUCH',
    title: 'Holding the 21 EMA but pulled back under the 10 — the Dr. Wish first touch, where the stop is defined and close.',
  },
  'stacked': {
    label: 'STACKED',
    title: 'Above both the 10 and the 21, and not extended past the anchor. Trend intact, entry on strength.',
  },
  'extended': {
    label: 'EXTENDED',
    title: 'More than three ATRs above the 21 EMA — no room to place a stop. Select to inspect these; leave off to exclude them.',
  },
};

const cnfTooltip = (row: SetupData): string => {
  const score = row.conviction;
  const lines: string[] = [
    score != null ? `CNF ${score} — ${score >= 70 ? 'A' : score >= 50 ? 'B' : 'C'}` : 'CNF — not scored',
  ];

  const bd = row.cnfBreakdown;
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

  // A capped score is a different claim than a low one — the tape may have
  // scored well and been overruled. Say which.
  if (row.cnfCeiling != null && row.cnfCeiling < 100) {
    lines.push('');
    lines.push(`Capped at ${row.cnfCeiling}${row.cnfCeilingReason ? ` — ${row.cnfCeilingReason}` : ''}`);
  }

  const rme = rmeOf(row);
  if (rme != null) {
    lines.push('');
    lines.push(`RME ${rme > 0 ? '+' : ''}${rme.toFixed(0)} — ${rmeLabel(rme)}`);
    if (row.rmeExtPct != null) {
      lines.push(`(${row.rmeExtPct >= 0 ? '+' : ''}${row.rmeExtPct.toFixed(1)}% from the 21 EMA)`);
    }
  }

  // CNF does not read chop — the scanner emits it unscored on purpose. Say so
  // here rather than letting a high CNF imply the regime was considered.
  const chop = chopOf(row);
  if (chop != null && chop >= CHOP_CHOP_MIN) {
    lines.push('');
    lines.push(`CHOP ${chop.toFixed(0)} — not scored into CNF. This grade rates the tape, not whether the range resolves.`);
  }

  return lines.join('\n');
};

const rowStatus = (row: SetupData): 'Ready' | 'Forming' | null => {
  if (row.status === 'Ready' || row.status === 'Forming') return row.status;
  if (row.stochK != null && row.distToEma21 != null) {
    return (row.stochK <= 25 && Math.abs(row.distToEma21) <= 2.5) ? 'Ready' : 'Forming';
  }
  return null;
};

export default function DailySetups() {
  const { session } = useMarketData();

  const [setups, setSetups] = useState<SetupData[]>([]);
  const [status, setStatus] = useState<string>('Syncing DB...');
  const [lastScanTime, setLastScanTime] = useState<number | null>(null);
  const [scanMeta, setScanMeta] = useState<any>(null);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: SortDirection } | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [postureFilter, setPostureFilter] = useState<PostureFilterType>('All');
  const [chopFilter, setChopFilter] = useState<ChopFilterType>('All');
  const [marketCapFilter, setMarketCapFilter] = useState<CapFilterType>('All');
  const [cnfFilter, setCnfFilter] = useState<CnfFilterType>('All');
  const [adrFilter, setAdrFilter] = useState<AdrFilterType>('All');
  const [vwapFilter, setVwapFilter] = useState<VwapFilterType>('All');
  const [planFilter, setPlanFilter] = useState<PlanFilterType>('All');
  const [holdFilter, setHoldFilter] = useState<HoldFilterType>('All');
  const [showFilters, setShowFilters] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    const fetchDatabaseSnapshot = async () => {
      try {
        const res = await fetch(`/api/scanner/latest?t=${Date.now()}`, { cache: 'no-store' });
        const data = await res.json();

        if (isMounted && data.success) {
          const rawList = data.dailySetups || [];
          const safeData = rawList.map((item: any) => {
            const rawThesis = item.thesis || item.aiThesis || item.analysis || item.reasoning || null;
            return {
              ticker: item.ticker || '—',
              name: item.name || '',
              sector: item.sector && item.sector !== '—' ? item.sector : '—',
              price: Number(item.price) || 0,
              vwapStatus: item.vwapStatus || 'neutral',
              changePct: Number((item.change ?? item.changePct) || 0),
              vol: Number((item.volume ?? item.vol) || 0),
              dVol: Number(item.dVol) || (Number(item.price || 0) * Number((item.volume ?? item.vol) || 0)),
              rvol: item.rvol || null,
              float: item.float || null,
              shortPct: item.shortPct || null,
              daysToCover: item.daysToCover ?? null,
              mktCap: item.mktCap || null,
              stage: item.stage || '—',
              setupName: item.setupName || null,
              catalyst: item.catalyst || null,
              catalystUrl: item.catalystUrl || null,
              conviction: item.conviction != null ? Number(item.conviction) : ((item.cnfScore ?? item.smbScore ?? item.aiScore ?? item.score) ?? null),
              thesis: rawThesis,
              tradeType: item.tradeType || null,
              aboveEma10: item.aboveEma10 ?? null,
              aboveEma21: item.aboveEma21 ?? null,
              stochK: item.stochK ?? null,
              rsVsSpy: item.rsVsSpy ?? null,
              distToEma21: item.distToEma21 ?? null,
              adrPct: item.adrPct ?? null,
              chop14: item.chop14 ?? null,
              chopTrap: item.chopTrap ?? null,
              rmv: item.rmv ?? null,
              mf: item.mf ?? null,
              mfTrend: item.mfTrend ?? 0,
              rme: item.rme ?? null,
              rmeExtPct: item.rmeExtPct ?? null,
              cnfBreakdown: item.cnfBreakdown ?? null,
              cnfCeiling: item.cnfCeiling ?? null,
              cnfCeilingReason: item.cnfCeilingReason ?? null,
              goldenCross: item.goldenCross ?? null,
              ema21Rising: item.ema21Rising ?? null,
              status: item.status ?? null,
              dotKind: item.dotKind ?? null,
              dotBarsSince: item.dotBarsSince ?? null,
              plan: item.plan ?? null,
            };
          });

          setSetups(safeData);
          setLastScanTime(data.lastScanTime || Date.now());
          if (data.scanMeta?.daily) setScanMeta(data.scanMeta.daily);
          setStatus('Live');
        }
      } catch (error) {
        if (isMounted) setStatus('DB Offline');
      }
    };

    fetchDatabaseSnapshot();
    const interval = setInterval(fetchDatabaseSnapshot, 60000);
    return () => { isMounted = false; clearInterval(interval); };
  }, []);

  const handleSort = (key: string) => {
    let direction: SortDirection = 'desc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') direction = 'asc';
    else if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') { setSortConfig(null); return; }
    setSortConfig({ key, direction });
  };

  // Every group is a toggle: pressing the active option clears it. That is
  // what removed the need for a MKT CAP "All" button — nothing selected
  // already means all, and a second click gets you there.
  const handleCnfFilter = (val: CnfFilterType) => setCnfFilter(prev => prev === val ? 'All' : val);
  const handleAdrFilter = (val: AdrFilterType) => setAdrFilter(prev => prev === val ? 'All' : val);
  const handleChopFilter = (val: ChopFilterType) => setChopFilter(prev => prev === val ? 'All' : val);
  const handleVwapFilter = (val: VwapFilterType) => setVwapFilter(prev => prev === val ? 'All' : val);
  const handlePlanFilter = (val: PlanFilterType) => setPlanFilter(prev => prev === val ? 'All' : val);
  const handleCapFilter = (val: CapFilterType) => setMarketCapFilter(prev => prev === val ? 'All' : val);
  const handlePostureFilter = (val: PostureFilterType) => setPostureFilter(prev => prev === val ? 'All' : val);
  const handleHoldFilter = (val: HoldFilterType) => setHoldFilter(prev => prev === val ? 'All' : val);

  /* Does ANY row carry a chop reading? Drives whether the CHOP group renders
     at all. Until the scanner has run since v6.18 the field is absent on
     every row, and a filter that empties the table rather than narrowing it
     is worse than no filter. Flips to true on its own once the scan runs. */
  const anyChop = useMemo(() => setups.some(s => chopOf(s) != null), [setups]);

  // A hidden group must not keep filtering. Without this, selecting NO CHOP
  // and then losing chop data on the next poll would leave an invisible
  // filter holding the table empty with no control to clear it.
  useEffect(() => {
    if (!anyChop && chopFilter !== 'All') setChopFilter('All');
  }, [anyChop, chopFilter]);

  const filteredAndSortedSetups = useMemo(() => {
    let filtered = setups.filter(s => s.changePct >= 4.0 && s.vol >= 500000 && s.mktCap !== null && s.mktCap >= 20000000);

    if (postureFilter !== 'All') {
      filtered = filtered.filter(s => postureOf(s) === postureFilter);
    }
    /* CHOP. Rows with no reading fall OUT of either selection rather than
       passing — a name with too few daily bars to score is not evidence of a
       trend, and letting it through would quietly defeat the filter on
       exactly the thin-history names most likely to churn. */
    if (chopFilter !== 'All') {
      filtered = filtered.filter(s => {
        const c = chopOf(s);
        if (c == null) return false;
        return chopFilter === 'trend' ? c <= CHOP_TREND_MAX : c < CHOP_CHOP_MIN;
      });
    }
    // Rows with no tradeType fall out of either selection rather than
    // defaulting into one — an unclassified name is not evidence that it is
    // a day trade.
    if (holdFilter !== 'All') {
      filtered = filtered.filter(s => tradeTypeLabel(s.tradeType) === holdFilter);
    }
    if (marketCapFilter !== 'All') {
      filtered = filtered.filter(s => {
        const mc = s.mktCap;
        if (!mc) return true;
        if (marketCapFilter === 'Large') return mc >= 2e9;
        if (marketCapFilter === 'Small') return mc < 2e9;
        return true;
      });
    }
    if (cnfFilter !== 'All') {
      const minScore = CNF_MIN_SCORE[cnfFilter];
      filtered = filtered.filter(s => (s.conviction ?? -1) >= minScore);
    }
    if (adrFilter !== 'All') {
      const minAdr = Number(adrFilter);
      filtered = filtered.filter(s => {
        const a = adrOf(s);
        return a != null && a >= minAdr;
      });
    }
    if (vwapFilter !== 'All') {
      filtered = filtered.filter(s => s.vwapStatus === vwapFilter);
    }
    /* Plan filter drops anything without a usable entry, then applies a
       threshold in stop-widths.

       `clear` rows carry no resistanceR at all — there is nothing overhead to
       measure — so they satisfy BOTH levels rather than falling out of the
       stricter one. */
    if (planFilter !== 'All') {
      const minR = planFilter === '2R' ? 2.0 : 1.0;
      filtered = filtered.filter(s => {
        const p = planOf(s);
        if (!p || p.tradeable !== true || p.collapsed || p.overextended) return false;
        if (p.clear === true) return true;
        return p.resistanceR != null && p.resistanceR >= minR;
      });
    }
    if (!sortConfig) return filtered;
    return [...filtered].sort((a, b) => {
      const aVal = sortConfig.key === 'planR' ? planSortValue(a) : (a as any)[sortConfig.key];
      const bVal = sortConfig.key === 'planR' ? planSortValue(b) : (b as any)[sortConfig.key];
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [setups, sortConfig, postureFilter, chopFilter, holdFilter, marketCapFilter, cnfFilter, adrFilter, vwapFilter, planFilter]);

  const handleCopyTickers = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const tickers = filteredAndSortedSetups.map(s => s.ticker).join(',');
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

  const getRvolColor = (rvol: number | null) => {
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
  const getDtcColor = (d: number | null) => {
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
  const getScoreBadge = (score: number | null | undefined) => {
    if (score == null) return 'bg-white/[0.02] text-slate-600 border-white/5';
    if (score >= 70) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    if (score >= 50) return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    return 'bg-zinc-800/50 text-zinc-400 border-zinc-700/50';
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

  // STAGE: left-aligned + 9px so short codes sit against the left edge.
  const thStage = "px-0.5 pl-1.5 py-2.5 text-[10px] text-slate-500 font-bold tracking-wide leading-tight cursor-pointer hover:text-slate-300 transition-colors text-left";
  const tdStage = "px-0.5 pl-1.5 pt-2.5 pb-1.5 text-left";

  // SECTOR: LEFT-aligned so it starts right after STAGE.
  const thSector = "px-0.5 pl-1.5 py-2.5 text-[10px] text-slate-500 font-bold tracking-wide leading-tight cursor-pointer hover:text-slate-300 transition-colors text-left";
  const tdSector = "px-0.5 pl-1.5 pt-2.5 pb-1.5 text-left";

  const filterBtnActive = "bg-[#1e293b] text-indigo-400 border border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.1)]";
  const filterBtnIdle = "text-slate-500 border border-transparent hover:text-slate-300 hover:bg-white/[0.02]";
  const pillWrap = "flex items-center gap-3 px-4 py-1 bg-[#161c2a] border border-white/5 rounded-lg shrink-0";
  const pillLabel = "text-[11px] font-bold tracking-widest uppercase text-slate-400";
  const pillBtn = "px-3 py-1 rounded-lg text-[11px] font-bold tracking-widest uppercase transition-all duration-300 whitespace-nowrap";

  const activeFilterCount =
    (postureFilter !== 'All' ? 1 : 0) +
    (chopFilter !== 'All' ? 1 : 0) +
    (holdFilter !== 'All' ? 1 : 0) +
    (marketCapFilter !== 'All' ? 1 : 0) +
    (cnfFilter !== 'All' ? 1 : 0) +
    (adrFilter !== 'All' ? 1 : 0) +
    (vwapFilter !== 'All' ? 1 : 0) +
    (planFilter !== 'All' ? 1 : 0);

  return (
    <div className="bg-[#101623] border border-white/5 rounded-2xl p-3 md:p-5 relative overflow-visible shadow-xl w-full max-w-[1280px] mx-auto">
      {/* Header raised z-10 → z-30 so the ? panel (z-[70]) paints above the
          FILTERS bar (z-10) instead of losing the sibling z-fight. */}
      <div onClick={() => setIsExpanded(!isExpanded)} className={`flex justify-between items-center relative z-30 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-5 border-b border-white/5 pb-4' : ''}`}>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs md:text-sm font-bold text-[#7c8bfa] bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 group-hover:bg-white/[0.02] transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
            DAILY SETUPS
          </span>
          {filteredAndSortedSetups.length > 0 && (
            <button
              onClick={handleCopyTickers}
              title={`Copy ${filteredAndSortedSetups.length} ticker${filteredAndSortedSetups.length !== 1 ? 's' : ''} for TradingView`}
              className={`text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded border transition-all duration-200 ${
                copied
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-[#161c2a] text-slate-400 border-white/5 hover:text-slate-200 hover:bg-white/[0.04]'
              }`}
            >
              {copied ? `✓ Copied ${filteredAndSortedSetups.length}` : `Copy ${filteredAndSortedSetups.length}`}
            </button>
          )}
          <span className="relative z-40 inline-flex">
            <MetricsKey meta={SCANNER_DAILY_META} liveGates={scanMeta?.gates} />
          </span>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-center justify-center border border-white/5 bg-[#161c2a]/40 px-4 py-1.5 rounded-[10px] min-w-[120px]">
            <span className={`text-[10px] font-bold tracking-widest uppercase ${getSessionTextColor()}`}>{displaySession}</span>
          </div>
          {lastScanTime && (<span className="text-[11px] text-slate-400/80 font-medium px-1 tracking-wide">Updated: {formatTime(lastScanTime)} EST</span>)}
        </div>
      </div>

      {isExpanded && (
        <>
          {/* FILTERS bar stays z-10 — below the header (z-30) so the ? panel
              covers it cleanly, still above the table. */}
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
                {/* POSTURE and CHOP lead together — they are the two questions
                    about whether a row is enterable at all. Posture asks where
                    price sits; chop asks whether the range resolves. */}
                <div className={pillWrap}>
                  <span className={pillLabel}>POSTURE</span>
                  <div className="flex items-center gap-1">
                    {POSTURE_BUCKETS.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => handlePostureFilter(opt)}
                        title={POSTURE_META[opt].title}
                        className={`${pillBtn} ${postureFilter === opt ? filterBtnActive : filterBtnIdle}`}
                      >
                        {POSTURE_META[opt].label}
                      </button>
                    ))}
                  </div>
                </div>
                {anyChop && (
                  <div className={pillWrap}>
                    <span className={pillLabel}>CHOP</span>
                    <div className="flex items-center gap-1">
                      {CHOP_BUCKETS.map((opt) => (
                        <button
                          key={opt}
                          onClick={() => handleChopFilter(opt)}
                          title={CHOP_META[opt].title}
                          className={`${pillBtn} ${chopFilter === opt ? filterBtnActive : filterBtnIdle}`}
                        >
                          {CHOP_META[opt].label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className={pillWrap}>
                  <span className={pillLabel}>PLAN</span>
                  <div className="flex items-center gap-1">
                    {PLAN_BUCKETS.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => handlePlanFilter(opt)}
                        title={opt === '2R'
                          ? 'At least two stop-widths to the nearest overhead level, or clear air above the trigger'
                          : 'At least one stop-width to the nearest overhead level'}
                        className={`${pillBtn} ${planFilter === opt ? filterBtnActive : filterBtnIdle}`}
                      >
                        {opt === '1R' ? '1R+' : '2R+'}
                      </button>
                    ))}
                  </div>
                </div>
                {/* HOLD is unique to this table — SIPs has no tradeType. It is
                    also the group most worth pairing with CHOP: a swing hold
                    is exactly the exposure a churning range punishes. */}
                <div className={pillWrap}>
                  <span className={pillLabel}>HOLD</span>
                  <div className="flex items-center gap-1">
                    {HOLD_BUCKETS.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => handleHoldFilter(opt)}
                        title={opt === 'DAY'
                          ? 'Intraday only — the setup does not survive an overnight hold'
                          : 'Multi-day hold viable. Worth pairing with the CHOP filter: a multi-day hold inside a churning range gives the range time to take it back.'}
                        className={`${pillBtn} ${holdFilter === opt ? filterBtnActive : filterBtnIdle}`}
                      >
                        {opt}
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
                  <span className={pillLabel}>ADR</span>
                  <div className="flex items-center gap-1">
                    {ADR_BUCKETS.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => handleAdrFilter(opt)}
                        title={`20-day average daily range of ${opt}% and above — scan floor is 3%. Pair with the CHOP filter: a wide ADR that is also choppy is range without direction.`}
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
                  <span className={pillLabel}>VWAP</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleVwapFilter('above')}
                      title="Only names trading above VWAP. Below-VWAP names still show their red dot in the price cell."
                      className={`flex items-center gap-1.5 ${pillBtn} ${vwapFilter === 'above' ? filterBtnActive : filterBtnIdle}`}
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400"></div>Above
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="relative z-0 overflow-x-auto custom-scrollbar" style={{ scrollbarWidth: 'thin' }}>
            {/* min-w 940 to fit RTR; widths match SIPs v3.0 minus FLOAT. */}
            <table className="w-full min-w-[940px] table-fixed border-collapse">
              <thead>
                <tr className="border-b border-white/5 select-none">
                  <th className={`${thBase} w-[7%]`} title={colTip('TICKER')} onClick={() => handleSort('ticker')}>TICKER{getSortIcon('ticker')}</th>
                  <th className={`${thBase} w-[4%]`} title={colTip('CNF')} onClick={() => handleSort('conviction')}>CNF{getSortIcon('conviction')}</th>
                  <th className={`${thBase} w-[5%]`} title={colTip('RTR')} onClick={() => handleSort('planR')}>RTR{getSortIcon('planR')}</th>
                  <th className={`${thBase} w-[6%]`} title={colTip('PRICE')} onClick={() => handleSort('price')}>PRICE{getSortIcon('price')}</th>
                  <th className={`${thBase} w-[6%]`} title={colTip('CHG%')} onClick={() => handleSort('changePct')}>CHG%{getSortIcon('changePct')}</th>
                  <th className={`${thBase} w-[6%]`} title={colTip('10/21')}>10/21</th>
                  <th className={`${thBase} w-[6%]`} title={colTip('VOL')} onClick={() => handleSort('vol')}>VOL{getSortIcon('vol')}</th>
                  <th className={`${thBase} w-[6%]`} title={colTip('$VOL')} onClick={() => handleSort('dVol')}>$VOL{getSortIcon('dVol')}</th>
                  <th className={`${thBase} w-[5%]`} title={colTip('RVOL')} onClick={() => handleSort('rvol')}>RVOL{getSortIcon('rvol')}</th>
                  {/* One header, two stacked readings. Clicking sorts by ADR;
                      CHOP is filtered rather than sorted, since a single
                      header cannot carry two sort keys. */}
                  <th className={`${thBase} w-[5%]`} title={colTip('ADR')} onClick={() => handleSort('adrPct')}>ADR{getSortIcon('adrPct')}</th>
                  <th className={`${thBase} w-[4%]`} title={colTip('MF')} onClick={() => handleSort('mf')}>MF{getSortIcon('mf')}</th>
                  <th className={`${thBase} w-[6%]`} title={colTip('RS')} onClick={() => handleSort('rsVsSpy')}>RS{getSortIcon('rsVsSpy')}</th>
                  <th className={`${thBase} w-[5%]`} title={colTip('STOCH')} onClick={() => handleSort('stochK')}>STOCH{getSortIcon('stochK')}</th>
                  <th className={`${thBase} w-[5%]`} title={colTip('DTC')} onClick={() => handleSort('daysToCover')}>DTC{getSortIcon('daysToCover')}</th>
                  <th className={`${thBase} w-[5%]`} title={colTip('MCAP')} onClick={() => handleSort('mktCap')}>MCAP{getSortIcon('mktCap')}</th>
                  <th className={`${thStage} w-[5%] border-l border-white/5`} title={colTip('STAGE')} onClick={() => handleSort('stage')}>STAGE{getSortIcon('stage')}</th>
                  <th className={`${thSector} w-[7%]`} title={colTip('SECTOR')} onClick={() => handleSort('sector')}>SECTOR{getSortIcon('sector')}</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-white/5">
                {status.includes('Syncing') && setups.length === 0 ? (
                  <tr><td colSpan={17} className="py-12 text-center border-b border-white/5"><div className="w-5 h-5 border-2 border-indigo-500/20 border-t-indigo-400 rounded-full animate-spin mx-auto mb-3"></div><span className="text-xs text-slate-500 font-medium">Fetching DB Snapshot...</span></td></tr>
                ) : filteredAndSortedSetups.length === 0 ? (
                  <tr><td colSpan={17} className="py-12 text-center text-slate-500 text-sm font-medium border-b border-white/5">{setups.length > 0 ? 'No names match the current filters.' : 'No active tracking items currently matching momentum criteria.'}</td></tr>
                ) : (
                  filteredAndSortedSetups.map((row, i) => {
                    const isPositive = row.changePct >= 0;
                    const st = rowStatus(row);
                    const tag = catalystTagOf(row);
                    const headline = headlineOf(row);
                    const sectorText = cleanSector(row.sector, row.ticker);
                    const bdRev = isBlueDotSetup(row.setupName);
                    const adr = adrOf(row);
                    const chop = chopOf(row);
                    const mf = mfOf(row);
                    const rmv = rmvOf(row);
                    const rme = rmeOf(row);
                    const stateRes = stateOf(rmv, rme);
                    const plan = planOf(row);
                    const posture = postureOf(row);
                    return (
                      <React.Fragment key={i}>
                        <tr className="hover:bg-white/[0.02] transition-colors group">
                          <td className={tdBase}>
                            <div className="flex items-center justify-center gap-1.5">
                              <span title={row.name || row.ticker} className="inline-block bg-indigo-500/10 text-[#7c8bfa] text-[11px] font-bold px-1.5 py-0.5 rounded border border-indigo-500/20 cursor-help">{row.ticker}</span>
                              {row.dotKind === 'blue' && <BlueDot />}
                              {row.dotKind === 'red' && <RedDot />}
                            </div>
                          </td>
                          <td className={tdBase}>
                            <span
                              title={cnfTooltip(row)}
                              className={`inline-block whitespace-nowrap px-1.5 py-[2px] rounded text-[9px] font-bold border cursor-help ${getScoreBadge(row.conviction)}`}
                            >
                              {row.conviction != null ? row.conviction : '--'}
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
                            <div className="flex items-center justify-center gap-1">${row.price.toFixed(2)}{row.vwapStatus !== 'neutral' && (<div className={`w-1.5 h-1.5 rounded-full shrink-0 ${row.vwapStatus === 'above' ? 'bg-emerald-400' : 'bg-rose-500'}`} title={`VWAP: ${row.vwapStatus}`}></div>)}</div>
                          </td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>{isPositive ? '+' : ''}{row.changePct.toFixed(2)}%</td>
                          {/* The 10/21 dots ARE the posture read — above 21
                              and below 10 is a first touch, both green is
                              stacked. Hover states the bucket so the filter
                              and the column can never be read apart. */}
                          <td className={`${tdBase} whitespace-nowrap`}>
                            <div
                              className="flex items-center justify-center gap-1"
                              title={posture ? `Posture: ${POSTURE_META[posture as PostureFilterType]?.label ?? 'BELOW 21'}` : undefined}
                            >
                              <div className="flex items-center gap-px">
                                <span className="text-[8px] font-bold text-slate-500">10</span>
                                <div className={`w-1.5 h-1.5 rounded-full ${emaDot(row.aboveEma10)}`} title={`10 EMA: ${row.aboveEma10 == null ? 'n/a' : row.aboveEma10 ? 'above' : 'below'}`}></div>
                              </div>
                              <div className="flex items-center gap-px">
                                <span className="text-[8px] font-bold text-slate-500">21</span>
                                <div className={`w-1.5 h-1.5 rounded-full ${emaDot(row.aboveEma21)}`} title={`21 EMA: ${row.aboveEma21 == null ? 'n/a' : row.aboveEma21 ? 'above' : 'below'}`}></div>
                              </div>
                            </div>
                          </td>
                          <td className={`${tdBase} text-xs text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{formatNumber(row.vol)}</td>
                          <td className={`${tdBase} text-xs text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{formatCurrency(row.dVol)}</td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getRvolColor(row.rvol)}`}>{row.rvol ? `${row.rvol.toFixed(1)}x` : '—'}</td>
                          {/* ADR over CHOP, one cell. See the v2.2 header: the
                              two are misleading apart, and separate columns
                              would let the eye take one without the other.
                              The word CHOP is printed so the second line is
                              self-explaining without a header change. */}
                          <td
                            className={`${tdBase} whitespace-nowrap tabular-nums cursor-help`}
                            title={chopTooltip(chop, adr)}
                          >
                            <div className="flex flex-col leading-tight">
                              <span className={`text-xs font-bold ${getAdrColor(adr)}`}>
                                {adr != null ? `${adr.toFixed(1)}%` : '—'}
                              </span>
                              <span className={`text-[8px] font-semibold tracking-tight ${chopColor(chop)}`}>
                                {chop != null ? `CHOP ${chop.toFixed(0)}` : ''}
                              </span>
                            </div>
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
                        {/* Sub-row starts at column 1 so the setup name sits
                            directly under the ticker. Order down the left edge:
                            symbol, then what it is. Then the three levels you
                            would actually place, then the headline, then
                            RMV/RME. DAY/SWING is in the plan tooltip and the
                            HOLD filter. */}
                        <tr className="bg-transparent border-t border-white/5">
                          <td colSpan={15} className="pb-1.5 pt-1 pr-3">
                            <div className="flex items-center text-left gap-0 min-w-0">
                              <span className="shrink-0 w-[64px] px-0.5 text-center text-[#7c8bfa]/90 font-bold text-[9px] tracking-[0.04em] uppercase leading-none truncate">
                                {bdRev ? <BlueDot /> : (formatSetupName(row.setupName) !== '—' ? formatSetupName(row.setupName) : '—')}
                              </span>
                              {plan?.tradeable && plan.trigger != null ? (
                                <span
                                  title={planTooltip(row)}
                                  className="shrink-0 flex items-baseline gap-2 pl-2 pr-2.5 cursor-help whitespace-nowrap"
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
                                <span className="shrink-0 pl-2 pr-2.5 text-[9px] font-semibold text-slate-600 italic whitespace-nowrap">
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
                                      row.catalystUrl ? (
                                        <a href={row.catalystUrl} target="_blank" rel="noopener noreferrer" className="text-slate-500 font-normal hover:text-slate-300 hover:underline transition-colors">{headline}</a>
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
                            {st === 'Ready' ? (
                              <span title={readinessTooltip(st)} className="text-[8px] font-semibold text-emerald-400 cursor-help whitespace-nowrap">Ready</span>
                            ) : st === 'Forming' ? (
                              <span title={readinessTooltip(st)} className="text-[8px] font-semibold text-amber-400 cursor-help whitespace-nowrap">Forming</span>
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
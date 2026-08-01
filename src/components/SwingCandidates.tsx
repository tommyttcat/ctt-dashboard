'use client';

// SwingCandidates — v2.4
//
// v2.4: news asterisk beside the ticker, and provenance on the sub-row
//       headline. Same treatment as StocksInPlay v3.4 and DailySetups v2.4.
//
//   A headline has to be READ; an asterisk is SEEN. Answering "which of
//   these has a story" meant scanning every sub-row of prose, and the eye
//   catches a marker beside the name in one pass.
//
//   ON A PULLBACK TABLE THE ASTERISK MEANS SOMETHING SLIGHTLY DIFFERENT from
//   what it means on SIPs or Top Movers. There, news explains why a name
//   moved today. Here the setup IS the absence of a move — a leader resting
//   into its 21 EMA — so a headline is not the reason for the pullback, it
//   is a thing that happened during it. That cuts both ways and the row
//   cannot tell you which: an upgrade mid-pullback is support, a dilutive
//   offering mid-pullback is why the pullback will not hold. The marker
//   says "read this before you size it", not "this is bullish".
//
//   IT WILL STAY DARK UNTIL THE SWING ROUTE MOVES TO POLYGON. That route
//   still calls Benzinga WIIM, which returns an empty array for a key
//   without the news product — so catalystUrl and thesis are null on every
//   row and hasNews is false everywhere. The wiring is complete and correct;
//   it is waiting on the route, exactly as the RTR column waited in v2.0.
//
// v2.3: RS column switched from rsVsSpy (a SPREAD versus SPY) to the
//
// v2.3: RS column switched from rsVsSpy (a SPREAD versus SPY) to the
//       market-wide RS RATING (a PERCENTILE).
//
//   THIS TABLE IS THE ONE WHERE THE CHANGE IS VISIBLE BEYOND THE COLUMN.
//   On StocksInPlay, DailySetups and TopMovers rsVsSpy was display-only, so
//   the swap moved a number's units and nothing else. Here the scan route
//   GATES on relative strength and SCORES 35 of 100 points from it, so
//   route v1.9 changed both which names appear and what they score:
//
//       old   reject if rsVsSpy <= 0        score min(rsVsSpy/20, 1) x 35
//       new   reject if rsRating < 50       score ((rs-50)/40 clamped) x 35
//
//   The gate was chosen to preserve the old strictness rather than adopt
//   Minervini's 70 — "beat SPY by any margin" is roughly the median, so 50
//   is the translation and 70 would be a different, stricter scan. Expect
//   the candidate list to shift somewhat even so: SPY is cap-weighted, and
//   in a tape led by mega-caps beating SPY is HARDER than beating the median
//   stock, so the count can rise rather than fall.
//
//   The CNF column note below was also corrected. It described the scanner
//   route's confluence composite, which this table does not use — its score
//   is relative strength, pullback tightness, volatility fit and trend, and
//   listing the wrong components made the RS weight invisible.
//
// v2.2: + CHOPPINESS INDEX (chop14), from swing route v1.9.
// v1.5: full parity with DailySetups v1.9 + DAY/SWING chip.
// v1.6: build fix — scanConfig exports the swing meta as SWING_META.
// v2.0: parity with SIPs v3.0 / Daily v2.0 — RTR column, trade plan on the
//       sub-row, setup name under the ticker, DAY/SWING chip dropped.
//
//       (The v2.0 header warned that RTR would read "—" until the backend
//       caught up. Swing route v1.8 emits `plan`, so that note is retired.
//       If RTR still reads "—", the KV payload is stale rather than the
//       route being behind — rerun the scan.)
//
// v2.1: filter consolidation, matching SIPs v3.1 / Daily v2.1 — with three
//       deliberate divergences, because this scan is not those scans.
//
//       STAGE 2 and 10/21 collapse into POSTURE, same as the others. Stage 2
//       means price above a rising long MA, and a name above its 21 EMA is
//       Stage 2 nearly always — two controls, one dimension. Posture also
//       tests extension FIRST, so a name past its anchor lands in a bucket
//       you can see rather than passing both old filters cleanly.
//
//       BUT THE BUCKET DISTRIBUTION HERE IS THE INVERSE OF SIPs. That table
//       gates on +4% today, so its rows have usually run past the 10 EMA and
//       FIRST TOUCH is the rare bucket. This scan selects pullbacks in
//       uptrends by construction, so FIRST TOUCH should be the COMMON case
//       and EXTENDED should be nearly empty. If that inverts — if this table
//       fills with EXTENDED — the pullback gate upstream has stopped working,
//       and the filter has just told you something about the scan.
//
//       NO HOLD FILTER. Daily got one because tradeType genuinely varies
//       there. Here tradeTypeLabel() defaults to 'swing' when the field is
//       absent, so every row reads SWING and the control would be a no-op.
//
//       PLAN RENDERS ONLY WHEN A ROW CARRIES ONE — the `anyPlan` guard. Kept
//       even though the route now emits plans, because it costs nothing and
//       protects against a stale payload.
//
// v2.2: + CHOPPINESS INDEX (chop14), from swing route v1.9.
//
//       THIS IS THE MOST USEFUL TABLE FOR CHOP, and the reason is specific
//       rather than general.
//
//       A pullback into a trending name and a pullback inside a trading range
//       ARE INDISTINGUISHABLE ON EVERYTHING ELSE THIS TABLE MEASURES. Same
//       distance to the 10. Same distance to the 21. Same stochastic. Same
//       posture bucket — both read FIRST TOUCH. Same Ready flag. The scan
//       admits both because its gates are structural and both satisfy them.
//
//       They behave nothing alike. The first resumes the trend; the second
//       reverses at a range edge it has already reversed at four times this
//       month, and the "first touch" was price arriving at the bottom of a
//       box rather than at support in an advance.
//
//       CHOP is the only reading here that separates them. POSTURE says where
//       price sits; CHOP says whether the structure it sits in resolves.
//
//       CONSOLIDATION1021 DELIBERATELY DOES NOT GET THIS, even though the
//       same route now emits the field for it. On a coil table chop is
//       algebraically redundant with coilRatio: for a consolidating name
//       sum(TR,14) ≈ 14 × ATR and the 14-day range ≈ 1.15 × coilRatio × ATR,
//       so chop reduces to a log transform of coilRatio — around 60 at a
//       coilRatio of 2.5, 42 at 4.0, 27 at 6.0. Monotonic across the whole
//       band that scan admits. A CHOP filter there would print the same
//       measurement twice in worse units and reject every good base.
//
//       CHOP SHARES THE ADR CELL rather than taking a column. ADR says the
//       name MOVES; CHOP says it moves SOMEWHERE. Separate columns would let
//       the eye take one without the other, which is the failure the field
//       exists to prevent.

import React, { useState, useEffect, useMemo } from 'react';
import { useMarketData } from './MarketDataContext';
import { stageColor, stageShort, stageDescription } from '@/lib/indicators/stage';
import { mfColor, mfLabel, mfArrow } from '@/lib/indicators/moneyflow';
import { stateOf, stateTooltip, stateLegend, readinessTooltip } from '@/lib/indicators/state';
import { rsColor, rsTooltip } from '@/lib/indicators/rs';
import {
  chopColor,
  chopTooltip,
  CHOP_TREND_MAX,
  CHOP_CHOP_MIN,
} from '@/lib/indicators/chop';
import { SWING_META, COLUMN_NOTES } from '@/lib/scanConfig';
import MetricsKey from './MetricsKey';

const FALLBACK_NOTES: Record<string, { what: string; colour?: string }> = {
  TICKER: { what: 'Symbol. Hover shows the company name. The setup name sits directly beneath it.' },
  CNF: {
    what: 'Swing score 0–100, built from four parts: RS Rating (35), pullback tightness — distance to the 21 EMA and how deep the stochastic has reset (30), volatility fit, which rewards an ATR near 3% and penalises both ends (20), and trend structure, 50 over 200 plus a rising 21 (15).\n\nRelative strength is the largest single component AND a hard gate: a name below RS 50 never reaches this table at all.',
    colour: 'Green 70+ (A) · amber 50+ (B) · grey below (C).',
  },
  RTR: {
    what: 'Room to resistance. How far the nearest overhead level sits above the trigger, measured in stop-widths (R = trigger minus stop). 2R+ means the target is reachable before anything blocks it. Trigger, stop and target prices are on the sub-row.',
    colour: 'Green 2R+ (clear) · slate 1R+ · amber 0.5R+ · red under 0.5R · EXT extended · ✕ no plan.',
  },
  PRICE: {
    what: 'Last price. The dot beside it is VWAP position.',
    colour: 'Green dot above VWAP · red dot below.',
  },
  'CHG%': {
    what: 'Change vs prior close.',
    colour: 'Green up · red down.',
  },
  '10/21': {
    what: 'Price vs the 10 and 21 EMAs — the Dr. Wish trend pair. This pair drives the POSTURE filter: above 21 and below 10 is a first touch, which on a pullback scan is the expected shape. Note that it cannot tell a pullback in a trend from a pullback in a range — that is what CHOP is for.',
    colour: 'Green dot above that EMA · red below · grey no data.',
  },
  VOL: { what: 'Shares traded today.' },
  '$VOL': { what: 'Dollar volume — price × volume.' },
  RVOL: {
    what: 'Relative volume vs the 20-day average at this time of day.',
    colour: 'Amber 2x+ · green 1.5x+ · grey below.',
  },
  ADR: {
    what: 'Two readings, stacked, because neither means much alone.\n\nTOP — ADR: 20-day average daily range. The scan floor is 3%. Also the stop basis (1.25× ADR or 2.5%, whichever is wider) and the extension test behind the EXTENDED posture.\n\nBOTTOM — CHOP: 14-day Choppiness Index. Distance travelled over ground covered. ADR was long described here as the anti-chop gate, and it is not one — it says the name MOVES, not that it moves SOMEWHERE. CHOP is the actual anti-chop reading, and on this table it is the only thing separating a pullback into a trend from a pullback inside a range.',
    colour: 'ADR: purple 10%+ · green 5%+ · grey at the floor.\nCHOP: teal/green trending · slate mixed · amber choppy · red dead chop.',
  },
  MF: {
    what: 'Money Flow (21) — volume-weighted accumulation vs distribution, 0–100. On a pullback, above 55 is orderly profit-taking; below 45 is distribution. Arrow shows the bar-over-bar trend.',
    colour: 'Green high (accumulation) · red low (distribution).',
  },
  RS: {
    what: 'Minervini / IBD Relative Strength Rating — a PERCENTILE against every liquid US stock, not a spread versus SPY. 88 means stronger than 88% of the market over the trailing year, with the most recent quarter double-weighted.\n\nOn this table it is a GATE as well as a column: names below 50 are rejected by the scan, and the score scales from zero at 50 to full marks at 90. Computed on closing prices, so it does not move intraday.',
    colour: 'Purple 90+ · green 80+ · slate 70+ · red below the floor.',
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

interface SwingCandidate {
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
  atrPct: number;
  adrPct?: number | null;
  chop14?: number | null;
  chopTrap?: boolean | null;
  rmv?: number | null;
  mf?: number | null;
  mfTrend?: number;
  rme?: number | null;
  rmeExtPct?: number | null;
  pctOffHigh: number;
  distToEma21: number;
  distToEma10?: number;
  aboveEma10?: boolean;
  aboveEma21?: boolean;
  stochK: number;
  rsRating: number;
  avgDollarVolM: number;
  goldenCross: boolean;
  ema21Rising: boolean;
  blueDot?: boolean;
  dotKind?: 'blue' | 'red' | null;
  dotBarsSince?: number | null;
  tradeType?: string | null;
  setupName?: string | null;
  catalyst?: string | null;
  catalystUrl?: string | null;
  newsPublisher?: string | null;
  newsAge?: string | null;
  newsSentiment?: 'positive' | 'negative' | 'neutral' | null;
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
type VwapFilterType = 'All' | 'above';
type AdrFilterType = 'All' | '5' | '10';
type PlanFilterType = 'All' | '1R' | '2R';
type CapFilterType = 'All' | 'Small' | 'Large';
type PostureFilterType = 'All' | 'first-touch' | 'stacked' | 'extended';
type ChopFilterType = 'All' | 'trend' | 'nochop';

const CNF_BUCKETS: CnfFilterType[] = ['A', 'B'];
const CNF_MIN_SCORE: Record<'A' | 'B', number> = { A: 70, B: 50 };
const ADR_BUCKETS: AdrFilterType[] = ['5', '10'];
const PLAN_BUCKETS: PlanFilterType[] = ['1R', '2R'];
const CAP_BUCKETS: CapFilterType[] = ['Small', 'Large'];
const POSTURE_BUCKETS: PostureFilterType[] = ['first-touch', 'stacked', 'extended'];
const CHOP_BUCKETS: ChopFilterType[] = ['trend', 'nochop'];

const CHOP_META: Record<ChopFilterType, { label: string; title: string }> = {
  'All': { label: 'ALL', title: '' },
  'trend': {
    label: 'TREND',
    title: `Choppiness ${CHOP_TREND_MAX} or below — the pullback is into a genuine advance, not into the bottom of a box. The narrow cut, and the one that matches what this scan is supposed to be finding.`,
  },
  'nochop': {
    label: 'NO CHOP',
    title: `Choppiness under ${CHOP_CHOP_MIN} — excludes the range-bound names. Every row here reads FIRST TOUCH whether the structure is a trend or a box; this is what tells the two apart.`,
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

const statePair = (rmv: number | null, rme: number | null): string => {
  const v = rmv == null ? '—' : String(Math.round(rmv));
  const e = rme == null ? '—' : String(Math.round(rme));
  return `${v}/${e}`;
};

const formatSetupName = (name: string | null | undefined) => {
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
    title="Blue Dot — oversold stoch reset firing on the daily"
    className={`inline-block w-1.5 h-1.5 rounded-full bg-sky-400 shadow-[0_0_5px_rgba(56,189,248,0.6)] align-middle shrink-0 ${className}`}
  />
);

const RedDot = ({ className = '' }: { className?: string }) => (
  <span
    title="Red Dot — overbought reversal against a long"
    className={`inline-block w-1.5 h-1.5 rounded-full bg-rose-500 shadow-[0_0_5px_rgba(244,63,94,0.6)] align-middle shrink-0 ${className}`}
  />
);

// This scan predates the dots indicator and ships a `blueDot` boolean; the
// unified scanner ships `dotKind`. Read either.
const dotOf = (c: SwingCandidate): 'blue' | 'red' | null => {
  if (c.dotKind === 'blue' || c.dotKind === 'red') return c.dotKind;
  if (c.blueDot === true) return 'blue';
  return null;
};

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

const catalystTagOf = (c: SwingCandidate): string | null => {
  if (isGenericCatalyst(c.catalyst)) return null;
  return String(c.catalyst).trim().replace(/\.$/, '') || null;
};

const headlineOf = (c: SwingCandidate): string | null => {
  const raw = c.thesis ?? c.news ?? c.headline ?? null;
  if (!raw) return null;
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
};

const catalystUrlOf = (c: SwingCandidate): string | null => c.catalystUrl ?? c.newsUrl ?? null;

/* A row has news only when there is a HEADLINE AND a link, not merely a tag.
   Both go through the existing accessors rather than reading the fields
   directly, because this component still supports the older payload shape
   where the headline arrived as `news` or `headline` — bypassing them would
   make the asterisk disagree with the sub-row on exactly those rows. */
const hasNews = (c: SwingCandidate): boolean =>
  !!(headlineOf(c) && catalystUrlOf(c));

/* One tooltip for the asterisk and the sub-row, so the two can never
   describe the same article differently. */
const newsTooltip = (c: SwingCandidate): string => {
  const headline = headlineOf(c);
  if (!headline) return '';
  const meta = [c.catalyst, c.newsPublisher, c.newsAge].filter(Boolean).join(' · ');
  const lines: string[] = [];
  if (meta) { lines.push(meta); lines.push(''); }
  lines.push(headline);
  if (c.newsSentiment === 'negative') {
    lines.push('');
    lines.push('Reads negative — on a pullback that is the difference between a rest and a breakdown.');
  }
  return lines.join('\n');
};

const adrOf = (c: SwingCandidate): number | null => {
  if (c.adrPct == null || isNaN(Number(c.adrPct))) return null;
  return Number(c.adrPct);
};

const chopOf = (c: SwingCandidate): number | null => {
  if (c.chop14 == null || isNaN(Number(c.chop14))) return null;
  return Number(c.chop14);
};

const mfOf = (c: SwingCandidate): number | null => {
  if (c.mf == null || isNaN(Number(c.mf))) return null;
  return Number(c.mf);
};

const rmeOf = (c: SwingCandidate): number | null => {
  if (c.rme == null || isNaN(Number(c.rme))) return null;
  return Number(c.rme);
};

const rmvOf = (c: SwingCandidate): number | null => {
  if (c.rmv == null || isNaN(Number(c.rmv))) return null;
  return Number(c.rmv);
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
  const t = (tradeType || 'swing').toLowerCase();
  if (t.startsWith('day')) return 'DAY';
  if (t.startsWith('swing')) return 'SWING';
  return String(tradeType).toUpperCase();
};

/* ---- Trade plan ---------------------------------------------------------
   Reads the `plan` object the scanner ships. Nothing is recalculated here,
   so the table cannot disagree with the score.

   Route v1.8 emits these. Every helper still degrades to "—" rather than
   throwing, so a stale payload renders honestly instead of breaking.     */
const planOf = (c: SwingCandidate): TradePlanRow | null => {
  const p = c.plan;
  return p && typeof p === 'object' ? p : null;
};

const PLAN_SORT_CLEAR = 99;
const PLAN_SORT_NONE = -1;

const planSortValue = (c: SwingCandidate): number => {
  const p = planOf(c);
  if (!p || p.tradeable !== true) return PLAN_SORT_NONE;
  if (p.collapsed) return PLAN_SORT_NONE;
  if (p.overextended) return PLAN_SORT_NONE;
  if (p.clear) return p.resistanceR != null ? p.resistanceR : PLAN_SORT_CLEAR;
  return p.resistanceR != null ? p.resistanceR : PLAN_SORT_NONE;
};

const planShort = (c: SwingCandidate): string => {
  const p = planOf(c);
  if (!p) return '—';
  if (p.collapsed) return '✕';
  if (p.tradeable !== true) return '—';
  if (p.overextended) return 'EXT';
  if (p.clear) return p.resistanceR != null ? `${p.resistanceR.toFixed(1)}R` : '2R+';
  if (p.resistanceR == null) return '—';
  return `${p.resistanceR.toFixed(1)}R`;
};

const planBadge = (c: SwingCandidate): string => {
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

// Holding period leads the tooltip. There is no HOLD filter on this table —
// tradeTypeLabel defaults to 'swing', so every row would read SWING and the
// control would narrow nothing.
const planTooltip = (c: SwingCandidate): string => {
  const p = planOf(c);
  const tt = tradeTypeLabel(c.tradeType);
  if (!p) return 'No trade plan on this row — rerun the swing scan.';
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

  /* The swing trigger is TODAY'S HIGH — the level that says the pullback is
     over. Inside a range that level is nothing of the sort: it is one more
     bounce off the bottom of a box, and the box top is the real resistance
     the plan has not measured. The levels are arithmetically correct and the
     premise underneath them is wrong, which is the failure mode chop exists
     to catch on this table. */
  const chop = chopOf(c);
  if (chop != null && chop >= CHOP_CHOP_MIN) {
    lines.push('');
    lines.push(`CHOP ${chop.toFixed(0)} — the trigger assumes a pullback that resumes. In a range this is a bounce off the low, not the end of a pullback.`);
  }

  lines.push('');
  lines.push('Stop is the wider of 1.25× ADR or 2.5%. Target is a fixed 2R.');
  return lines.join('\n');
};

const cnfTooltip = (c: SwingCandidate): string => {
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

  // A capped score is a different claim than a low one — the tape may have
  // scored well and been overruled. Say which.
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

  // CNF does not read chop — the route emits it unscored on purpose. Say so
  // rather than letting a high score imply the structure was considered.
  const chop = chopOf(c);
  if (chop != null && chop >= CHOP_CHOP_MIN) {
    lines.push('');
    lines.push(`CHOP ${chop.toFixed(0)} — not scored into CNF. This grade rates the pullback, not whether it is a pullback in a trend or in a range.`);
  }

  return lines.join('\n');
};

// Backward-compatible: derive above-EMA from dist if payload predates booleans
const above21 = (c: SwingCandidate) => c.aboveEma21 ?? c.distToEma21 >= 0;
const above10 = (c: SwingCandidate) => c.aboveEma10 ?? (c.distToEma10 != null ? c.distToEma10 >= 0 : null);

/* ---- POSTURE ------------------------------------------------------------
   One structural read, replacing the old STAGE 2 and 10/21 controls.

   THE ORDER OF THESE CHECKS IS THE POINT. Extension is tested FIRST, because
   a name can be above both EMAs, pass "Stage 2", pass ">21", and still be
   several ATRs past its anchor with nowhere to put a stop. Under the old
   pair that row sailed through both filters.

   EXTENSION FALLS BACK TO atrPct HERE, not to a flat percentage. atrPct is a
   required field on this interface while adrPct is optional, so this scan can
   always size the ceiling to the name's own volatility — a 3%-ATR utility and
   a 14%-ATR biotech should not share one extension threshold.

   ABOVE-10 CAN BE UNKNOWN. distToEma10 and aboveEma10 are both optional, and
   when neither is present there is no way to tell a first touch from a
   stacked name. That returns null rather than guessing — the row falls out of
   every posture filter and shows no posture on hover, which is the honest
   outcome. Guessing 'stacked' would silently mislabel exactly the setup this
   scan exists to find.

   POSTURE CANNOT SEE STRUCTURE. Every bucket here is computed from where
   price sits relative to two moving averages, which is identical for a
   pullback in an advance and a pullback to the bottom of a range. CHOP is
   the companion read, and on this table the two are meant to be used
   together — FIRST TOUCH plus TREND is the setup; FIRST TOUCH alone is a
   shape.                                                                  */
type PostureBucket = 'first-touch' | 'stacked' | 'extended' | 'below-21';

const EXTENSION_ATR_MULTIPLE = 3;
const EXTENSION_FALLBACK_PCT = 12;

const postureOf = (c: SwingCandidate): PostureBucket | null => {
  const a21 = above21(c);

  // The scanner's own verdict wins if it has one, since that is what the RTR
  // column is already showing.
  const p = planOf(c);
  if (p?.overextended === true) return 'extended';

  const d21 = c.distToEma21;
  const adr = adrOf(c);
  if (a21 === true && d21 != null && !isNaN(d21)) {
    const basis = adr != null && adr > 0 ? adr : (c.atrPct > 0 ? c.atrPct : null);
    const ceiling = basis != null ? EXTENSION_ATR_MULTIPLE * basis : EXTENSION_FALLBACK_PCT;
    if (d21 > ceiling) return 'extended';
  }

  if (a21 === false) return 'below-21';

  const a10 = above10(c);
  if (a10 == null) return null;
  // Holding the 21 but back under the 10 — the Dr. Wish first touch, and on
  // a pullback scan the expected shape rather than the exception.
  if (a10 === false) return 'first-touch';
  return 'stacked';
};

const POSTURE_META: Record<PostureFilterType, { label: string; title: string }> = {
  'All': { label: 'ALL', title: '' },
  'first-touch': {
    label: 'FIRST TOUCH',
    title: 'Holding the 21 EMA but pulled back under the 10 — the Dr. Wish first touch, where the stop is defined and close. On this scan it should be the common case. Pair with CHOP: this bucket cannot tell a pullback in a trend from a bounce off the bottom of a range.',
  },
  'stacked': {
    label: 'STACKED',
    title: 'Above both the 10 and the 21, and not extended past the anchor. The pullback has already been bought back.',
  },
  'extended': {
    label: 'EXTENDED',
    title: 'More than three ATRs above the 21 EMA — no room to place a stop. This should be near-empty on a pullback scan; if it fills, the upstream pullback gate has stopped working.',
  },
};

// Ready = stoch deep and pullback tight — the blue dot could fire imminently.
const isReady = (c: SwingCandidate) => c.stochK <= 25 && Math.abs(c.distToEma21) <= 2.5;

export default function SwingCandidates() {
  const { session } = useMarketData();

  const [candidates, setCandidates] = useState<SwingCandidate[]>([]);
  const [status, setStatus] = useState<string>('Syncing...');
  const [generatedAt, setGeneratedAt] = useState<number | null>(null);
  const [spyReturn, setSpyReturn] = useState<number | null>(null);
  const [scanMeta, setScanMeta] = useState<any>(null);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: SortDirection } | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [showReadyOnly, setShowReadyOnly] = useState<boolean>(false);
  const [postureFilter, setPostureFilter] = useState<PostureFilterType>('All');
  const [chopFilter, setChopFilter] = useState<ChopFilterType>('All');
  const [marketCapFilter, setMarketCapFilter] = useState<CapFilterType>('All');
  const [cnfFilter, setCnfFilter] = useState<CnfFilterType>('All');
  const [adrFilter, setAdrFilter] = useState<AdrFilterType>('All');
  const [vwapFilter, setVwapFilter] = useState<VwapFilterType>('All');
  const [planFilter, setPlanFilter] = useState<PlanFilterType>('All');
  const [showFilters, setShowFilters] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    const fetchCandidates = async () => {
      try {
        const res = await fetch(`/api/swing-candidates/latest?t=${Date.now()}`, { cache: 'no-store' });
        const data = await res.json();

        if (isMounted && data && data.success && Array.isArray(data.candidates)) {
          setCandidates(data.candidates);
          setGeneratedAt(data.lastScanTime ? Number(data.lastScanTime) : Date.now());
          setSpyReturn(data.spyReturn3M ?? null);
          if (data.scanMeta?.swing) setScanMeta(data.scanMeta.swing);
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
  const handleChopFilter = (val: ChopFilterType) => setChopFilter(prev => prev === val ? 'All' : val);
  const handleVwapFilter = (val: VwapFilterType) => setVwapFilter(prev => prev === val ? 'All' : val);
  const handleCnfFilter = (val: CnfFilterType) => setCnfFilter(prev => prev === val ? 'All' : val);
  const handlePlanFilter = (val: PlanFilterType) => setPlanFilter(prev => prev === val ? 'All' : val);
  const handleCapFilter = (val: CapFilterType) => setMarketCapFilter(prev => prev === val ? 'All' : val);
  const handlePostureFilter = (val: PostureFilterType) => setPostureFilter(prev => prev === val ? 'All' : val);

  /* Does ANY row carry a plan object? Drives whether the PLAN group renders.
     Route v1.8 emits plans, so this should now be true — kept because it
     costs nothing and a stale payload would otherwise leave a filter that
     empties the table rather than narrowing it. */
  const anyPlan = useMemo(() => candidates.some(c => planOf(c) != null), [candidates]);

  /* Same guard for chop, which arrives with route v1.9. */
  const anyChop = useMemo(() => candidates.some(c => chopOf(c) != null), [candidates]);

  // A hidden group must not keep filtering. Without these, selecting an
  // option and then losing the underlying data on the next poll would leave
  // an invisible filter holding the table empty with no control to clear it.
  useEffect(() => {
    if (!anyPlan && planFilter !== 'All') setPlanFilter('All');
  }, [anyPlan, planFilter]);

  useEffect(() => {
    if (!anyChop && chopFilter !== 'All') setChopFilter('All');
  }, [anyChop, chopFilter]);

  const filteredAndSorted = useMemo(() => {
    let filtered = [...candidates];
    if (showReadyOnly) filtered = filtered.filter(isReady);
    if (postureFilter !== 'All') {
      filtered = filtered.filter(c => postureOf(c) === postureFilter);
    }
    /* CHOP. Rows with no reading fall OUT of either selection rather than
       passing — a name with too few daily bars to score is not evidence of a
       trend. On this scan that is a real population: the 210-bar minimum in
       the route means most rows will have a reading, but a recent listing
       that slipped through is exactly the case where structure is unknown
       and the churn risk is highest. */
    if (chopFilter !== 'All') {
      filtered = filtered.filter(c => {
        const v = chopOf(c);
        if (v == null) return false;
        return chopFilter === 'trend' ? v <= CHOP_TREND_MAX : v < CHOP_CHOP_MIN;
      });
    }
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
    if (adrFilter !== 'All') {
      const minAdr = Number(adrFilter);
      filtered = filtered.filter(c => {
        const a = adrOf(c);
        return a != null && a >= minAdr;
      });
    }
    if (vwapFilter !== 'All') {
      filtered = filtered.filter(c => c.vwapStatus === vwapFilter);
    }
    /* Plan filter drops anything without a usable entry, then applies a
       threshold in stop-widths.

       `clear` rows carry no resistanceR at all — there is nothing overhead to
       measure — so they satisfy BOTH levels rather than falling out of the
       stricter one. */
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
      const aVal = sortConfig.key === 'planR' ? planSortValue(a) : (a as any)[sortConfig.key];
      const bVal = sortConfig.key === 'planR' ? planSortValue(b) : (b as any)[sortConfig.key];
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [candidates, sortConfig, showReadyOnly, postureFilter, chopFilter, marketCapFilter, cnfFilter, adrFilter, vwapFilter, planFilter]);

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
  const getStochColor = (k: number) => {
    if (k <= 20) return 'text-purple-400';
    if (k <= 30) return 'text-emerald-400';
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
    (showReadyOnly ? 1 : 0) +
    (postureFilter !== 'All' ? 1 : 0) +
    (chopFilter !== 'All' ? 1 : 0) +
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
            REVERSAL / SWING
          </span>
          {spyReturn !== null && (
            <span className="hidden md:inline text-[10px] text-slate-500 font-medium tracking-wide">SPY 3M: {spyReturn >= 0 ? '+' : ''}{spyReturn.toFixed(1)}%</span>
          )}
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
            <MetricsKey meta={SWING_META} liveGates={scanMeta?.gates} />
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
                {/* POSTURE and CHOP are meant to be used together on this
                    table. Posture says price pulled back to the anchor; chop
                    says whether that anchor sits in an advance or in a box.
                    FIRST TOUCH + TREND is the setup. FIRST TOUCH alone is
                    just a shape. */}
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
                {/* STAT is orthogonal to both: POSTURE asks where price sits,
                    CHOP asks what structure it sits in, STAT asks whether the
                    stochastic reset is close enough to fire. A first touch in
                    a trend that is not yet Ready is a watch item. */}
                <div className={pillWrap}>
                  <span className={pillLabel}>STAT</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setShowReadyOnly(!showReadyOnly)}
                      title="Stochastic at or below 25 with price within 2.5% of the 21 EMA — the blue dot could fire on the next bar"
                      className={`${pillBtn} ${showReadyOnly ? filterBtnActive : filterBtnIdle}`}
                    >
                      Ready
                    </button>
                  </div>
                </div>
                {/* PLAN only renders once a row actually carries one — see
                    the note by `anyPlan`. */}
                {anyPlan && (
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
                )}
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
                        title={`20-day average daily range of ${opt}% and above — scan floor is 3%. This measures how much the name moves, not whether it goes anywhere; the CHOP filter is the one that answers that.`}
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
                  <th className={`${thBase} w-[7%]`} title={colTip('TICKER')} onClick={() => handleSort('symbol')}>TICKER{getSortIcon('symbol')}</th>
                  <th className={`${thBase} w-[4%]`} title={colTip('CNF')} onClick={() => handleSort('score')}>CNF{getSortIcon('score')}</th>
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
                  <th className={`${thBase} w-[6%]`} title={colTip('RS')} onClick={() => handleSort('rsRating')}>RS{getSortIcon('rsRating')}</th>
                  <th className={`${thBase} w-[5%]`} title={colTip('STOCH')} onClick={() => handleSort('stochK')}>STOCH{getSortIcon('stochK')}</th>
                  <th className={`${thBase} w-[5%]`} title={colTip('DTC')} onClick={() => handleSort('daysToCover')}>DTC{getSortIcon('daysToCover')}</th>
                  <th className={`${thBase} w-[5%]`} title={colTip('MCAP')} onClick={() => handleSort('mktCap')}>MCAP{getSortIcon('mktCap')}</th>
                  <th className={`${thStage} w-[5%] border-l border-white/5`} title={colTip('STAGE')} onClick={() => handleSort('stage')}>STAGE{getSortIcon('stage')}</th>
                  <th className={`${thSector} w-[7%]`} title={colTip('SECTOR')} onClick={() => handleSort('sector')}>SECTOR{getSortIcon('sector')}</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-white/5">
                {filteredAndSorted.length === 0 ? (
                  <tr><td colSpan={17} className="py-12 text-center text-slate-500 text-sm font-medium">{status === 'Live' ? (candidates.length > 0 ? 'No candidates match current filter criteria.' : 'No candidates in the current scan.') : status === 'Syncing...' ? 'Running scan…' : 'Feed unavailable — awaiting next scheduled scan.'}</td></tr>
                ) : (
                  filteredAndSorted.map((row) => {
                    const isPositive = (row.changePct ?? 0) >= 0;
                    const tag = catalystTagOf(row);
                    const headline = headlineOf(row);
                    const catUrl = catalystUrlOf(row);
                    const sectorText = cleanSector(row.sector, row.symbol);
                    const bdRev = isBlueDotSetup(row.setupName);
                    const adr = adrOf(row);
                    const chop = chopOf(row);
                    const mf = mfOf(row);
                    const rmv = rmvOf(row);
                    const rme = rmeOf(row);
                    const stateRes = stateOf(rmv, rme);
                    const st = isReady(row) ? 'Ready' : 'Forming';
                    const dot = dotOf(row);
                    const plan = planOf(row);
                    const posture = postureOf(row);
                    return (
                      <React.Fragment key={row.symbol}>
                        <tr className="hover:bg-white/[0.02] transition-colors group">
                          <td className={tdBase}>
                            <div className="flex items-center justify-center gap-1.5">
                              <span title={row.name || row.symbol} className="inline-block bg-indigo-500/10 text-[#7c8bfa] text-[11px] font-bold px-1.5 py-0.5 rounded border border-indigo-500/20 cursor-help">{row.symbol}</span>
                              {/* Fixed-width whether or not there is news, so
                                  the dots that follow sit at the same x on
                                  every row. */}
                              <span className="inline-block w-[9px] text-center leading-none shrink-0">
                                {hasNews(row) && (
                                  <a
                                    href={catUrl!}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={newsTooltip(row)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-amber-400/90 hover:text-amber-300 font-bold text-[11px] cursor-pointer transition-colors"
                                  >
                                    *
                                  </a>
                                )}
                              </span>
                              {dot === 'blue' && <BlueDot />}
                              {dot === 'red' && <RedDot />}
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
                                <div className={`w-1.5 h-1.5 rounded-full ${emaDot(above10(row))}`} title={`10 EMA: ${above10(row) == null ? 'n/a' : above10(row) ? 'above' : 'below'}`}></div>
                              </div>
                              <div className="flex items-center gap-px">
                                <span className="text-[8px] font-bold text-slate-500">21</span>
                                <div className={`w-1.5 h-1.5 rounded-full ${emaDot(above21(row))}`} title={`21 EMA: ${above21(row) ? 'above' : 'below'}`}></div>
                              </div>
                            </div>
                          </td>
                          <td className={`${tdBase} text-xs text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{formatNumber(row.vol)}</td>
                          <td className={`${tdBase} text-xs text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{row.dVol ? formatCurrency(row.dVol) : (row.avgDollarVolM ? `$${row.avgDollarVolM}M` : '—')}</td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getRvolColor(row.rvol)}`}>{row.rvol ? `${row.rvol.toFixed(1)}x` : '—'}</td>
                          {/* ADR over CHOP, one cell. On this table the pair
                              is the read: a wide-range name that never goes
                              anywhere looks like the best pullback candidate
                              on the board until you see the second line. */}
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
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums cursor-help ${rsColor(row.rsRating)}`} title={rsTooltip(row.rsRating)}>
                            {row.rsRating ?? '—'}
                          </td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getStochColor(row.stochK)}`}>{row.stochK.toFixed(1)}</td>
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
                            RMV/RME. DAY/SWING lives in the plan tooltip. */}
                        <tr className="bg-transparent border-t border-white/5">
                          <td colSpan={15} className="pb-1.5 pt-1 pr-3">
                            <div className="flex items-center text-left gap-0 min-w-0">
                              <span className="shrink-0 w-[64px] px-0.5 text-center text-[#7c8bfa]/90 font-bold text-[9px] tracking-[0.04em] uppercase leading-none truncate">
                                {bdRev ? <BlueDot /> : (formatSetupName(row.setupName) !== '—' ? formatSetupName(row.setupName) : 'EMA PB')}
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
                              <p className="flex-1 min-w-0 text-[10px] leading-relaxed border-l border-white/10 pl-2.5 pr-3 truncate" title={newsTooltip(row) || headline || undefined}>
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
                                    {/* Source and age, dimmer than the
                                        headline. On an aggregated feed the
                                        publisher is the main discriminator. */}
                                    {(row.newsPublisher || row.newsAge) && (
                                      <span className="text-[8px] text-slate-600 font-medium ml-1.5 whitespace-nowrap">
                                        {[row.newsPublisher, row.newsAge].filter(Boolean).join(' · ')}
                                      </span>
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
                            ) : (
                              <span title={readinessTooltip(st)} className="text-[8px] font-semibold text-amber-400 cursor-help whitespace-nowrap">Forming</span>
                            )}
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
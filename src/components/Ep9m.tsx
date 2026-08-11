'use client';

// Ep9m — 9 Million Episodic Pivot (Pradeep Bonde / Stockbee) — v2.6
//
// v2.6: news asterisk beside the ticker, and provenance on the sub-row.
//
//   ON THIS TABLE THE ASTERISK IS THE INVERSE OF "SILENT", which is already
//   the most important label here. Silent means heavy abnormal volume with
//   nothing published — the footprint before the story, and the whole
//   premise of the scan. The asterisk marks the complement: volume WITH an
//   explanation, where the work is reading the headline rather than hunting
//   for one.
//
//   Both facts were already on the row, but only on the SUB-row and only as
//   words. Moving the positive case to a marker beside the name means you
//   can sort the board by eye in one pass instead of reading twenty lines of
//   prose to find which four have a story.
//
//   Fed by ep9m route v1.8, which moved this scan off the dead Benzinga
//   endpoint. Before that every row was Silent — not because the market was
//   quiet, but because the dashboard could not see any news at all, and the
//   scan's central label was therefore meaningless.
//
// v2.5: + CHOPPINESS INDEX (chop14), from ep9m route v1.6.
//
// Fewer than ~2% of US listings trade 9M+ shares in a session. When a stock
// that normally trades 800k suddenly does 12M, institutions are accumulating
// and the news hasn't been priced yet. The volume IS the signal.
//
// This scan does NOT gate on % change — a flat stock on 10x volume is the point.
//
// v2.0: parity pass — MetricsKey ?, STATE chip, VS60D, GC/21↑ & CLS removed.
// v2.1: sub-row cluster shifted flush-left under TICKER; cluster group hover.
// v2.2: full column parity — added 10/21 dots and STOCH; D2C→DTC, RS/SPY→RS.
// v2.3: RTR column and the trade plan on the sub-row.
// v2.4: filter consolidation — RVOL and FLAGS merged into VOL, 10x dropped,
//       PLAN Clear → 2R+, MKT CAP All and VWAP Below removed.
// v2.5: + CHOPPINESS INDEX (chop14), from ep9m route v1.6.
//
//       CHOP MATTERS MORE ON THIS TABLE THAN ANY OTHER, and for the same
//       reason RTR does: this scan has NO TREND GATE and NO ADR FLOOR. Every
//       other table filters on structure somewhere. This one gates on volume
//       abnormality alone, so a name can print 12M shares while oscillating
//       inside the range it has held for a month, and it belongs here —
//       that volume is real information about institutional activity.
//
//       What the volume does not say is whether the range will resolve.
//       CHOP does. An EP9M name at CHOP 75 has size moving inside a range
//       that keeps rejecting both edges: worth researching, not worth a
//       breakout entry today.
//
//       THE PAIRING TO WATCH IS UNPRECEDENTED × CHOP. A name whose volume
//       beat its own 60-day record, landing in tape that cannot express it,
//       is the most interesting row this table produces and the easiest one
//       to misread — the fuchsia dot says "exceptional" and the chart says
//       "nothing happened". The dot's tooltip now says both.
//
//       CHOP SHARES THE ADR CELL, matching SIPs v3.2 and Daily v2.2. ADR
//       says the name MOVES; CHOP says it moves SOMEWHERE. Adjacent columns
//       would let the eye take one without the other.

import React, { useState, useEffect, useMemo } from 'react';
import { useMarketData } from './MarketDataContext';
import { stageColor, stageShort, stageDescription } from '@/lib/indicators/stage';
import { mfColor, mfLabel, mfArrow } from '@/lib/indicators/moneyflow';
import { stateOf, stateTooltip, stateLegend } from '@/lib/indicators/state';
import {
  chopColor,
  chopTooltip,
  chopLabel,
  CHOP_TREND_MAX,
  CHOP_CHOP_MIN,
} from '@/lib/indicators/chop';
import { EP9M_META, COLUMN_NOTES } from '@/lib/scanConfig';
import MetricsKey from './MetricsKey';

const FALLBACK_NOTES: Record<string, { what: string; colour?: string }> = {
  TICKER: { what: "Symbol. Hover shows the company name. Fuchsia dot = unprecedented (today's volume beat its own 60-day high); ★ = repeat EP9M offender. Hover the fuchsia dot on a choppy name — record volume inside a range that will not resolve is the most misread row on this table." },
  EP: {
    what: 'Episodic Pivot score 0–100 — volume abnormality, vs-60-day-high, float turnover, catalyst, close strength, Money Flow, days-to-cover, and repeat-trigger history. Hover the badge for the per-row breakdown.',
    colour: 'Green 70+ (A) · amber 50+ (B) · grey below (C).',
  },
  RTR: {
    what: 'Room to resistance. How far the nearest overhead level sits above the trigger, measured in stop-widths (R = trigger minus stop). This scan has no trend gate, so RTR is the column that separates abnormal volume you can trade from abnormal volume you cannot — and it is where over-extension shows up, since there is no posture filter on this table.',
    colour: 'Green 2R+ (clear) · slate 1R+ · amber 0.5R+ · red under 0.5R · EXT extended · ✕ collapsed.',
  },
  PRICE: {
    what: 'Last price. The dot beside it is VWAP position.',
    colour: 'Green dot above VWAP · red dot below.',
  },
  'CHG%': {
    what: 'Change vs prior close. Note: this scan does NOT gate on change — a flat stock on 10x volume is the point.',
    colour: 'Green up · red down.',
  },
  '10/21': {
    what: 'Price vs the 10 and 21 EMAs — the Dr. Wish trend pair. Shown for context; there is no filter on it here, because the extension case it would catch is already reported by RTR as EXT.',
    colour: 'Green dot above that EMA · red below · grey no data.',
  },
  VOL: {
    what: "Shares traded today, with the 20-day average below. Scan floor is 9M shares.",
  },
  '$VOL': { what: 'Dollar volume — price × volume.' },
  RVOL: {
    what: "Today's volume vs its own 20-day average. Scan floors at 3x — the headline metric here, so the scale runs hotter than other tables. For the extreme end, filter on UNPREC rather than a high RVOL: the 20-day average is inflated by prior spikes, while the 60-day high is not.",
    colour: 'Fuchsia 10x+ · purple 7x+ · green 5x+ · lime above the floor.',
  },
  TURN: {
    what: 'Float turnover — share of the tradeable float that changed hands today. Above 1.0x, the entire float traded, which is a genuine regime change.',
    colour: 'Fuchsia 1.0x+ · purple 0.5x+ · green 0.25x+ · lime 0.1x+.',
  },
  ADR: {
    what: 'Two readings, stacked, because neither means much alone.\n\nTOP — ADR: 20-day average daily range. The anti-chop measure, and the stop basis: 1.25× ADR or 2.5%, whichever is wider.\n\nBOTTOM — CHOP: 14-day Choppiness Index. Distance travelled over ground covered. This scan has no trend gate, so CHOP is the only reading that says whether the range the volume landed in can resolve. Above 61.8 the name churns; below 38.2 it trends.',
    colour: 'ADR: purple 10%+ · green 5%+ · grey at the floor.\nCHOP: teal/green trending · slate mixed · amber choppy · red dead chop.',
  },
  MF: {
    what: 'Money Flow (21) — accumulation vs distribution over the prior month. Heavy volume with MF under 45 is distribution however strong today looks. Arrow shows the 5-day direction.',
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
    what: 'Days to cover — short interest ÷ average daily volume. Trapped shorts are squeeze fuel.',
    colour: 'Purple 5+ · green 3+ · grey below.',
  },
  MCAP: { what: 'Market cap.' },
  STAGE: {
    what: 'Weinstein stage with sub-stage. This scan has no trend gate, so STAGE is the main way to separate accumulation in an uptrend from capitulation in a downtrend — which is why it keeps its own filter here while the other tables folded theirs into POSTURE.',
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

interface Ep9mCandidate {
  ticker: string;
  name?: string;
  sector?: string;
  price: number;
  score: number;
  grade?: string;
  changePct?: number;
  vol: number;
  dVol?: number;
  avgVol?: number;
  rvol: number;
  volVs60dMax?: number | null;
  unprecedented?: boolean;
  floatTurnover?: number | null;
  daysToCover?: number | null;
  closeStrength?: number | null;
  float?: number | null;
  shortPct?: number | null;
  mktCap?: number | null;
  stage?: string;
  vwapStatus?: 'above' | 'below' | 'neutral';
  atrPct?: number | null;
  adrPct?: number | null;
  chop14?: number | null;
  chopTrap?: boolean | null;
  rmv?: number | null;
  mf?: number | null;
  mfTrend?: number;
  rme?: number | null;
  rmeExtPct?: number | null;
  aboveEma10?: boolean | null;
  aboveEma21?: boolean | null;
  distToEma21?: number | null;
  distToEma10?: number | null;
  ema21Rising?: boolean | null;
  goldenCross?: boolean | null;
  pctOffHigh?: number | null;
  stochK?: number | null;
  rsVsSpy?: number | null;
  priorTriggers?: number;
  sugarBaby?: boolean;
  blueDot?: boolean;
  setupName?: string | null;
  catalyst?: string | null;
  catalystUrl?: string | null;
  newsPublisher?: string | null;
  newsAge?: string | null;
  newsSentiment?: 'positive' | 'negative' | 'neutral' | null;
  thesis?: string | null;
  scoreBreakdown?: Record<string, number>;
  plan?: TradePlanRow | null;
}

type SortDirection = 'asc' | 'desc';
type EpFilterType = 'All' | 'A' | 'B';
type RvolFilterType = 'All' | '5';
type CatalystFilterType = 'All' | 'News' | 'Silent';
type VwapFilterType = 'All' | 'above';
type PlanFilterType = 'All' | '1R' | '2R';
type CapFilterType = 'All' | 'Small' | 'Large';
type ChopFilterType = 'All' | 'trend' | 'nochop';

const EP_BUCKETS: EpFilterType[] = ['A', 'B'];
const EP_MIN_SCORE: Record<'A' | 'B', number> = { A: 70, B: 50 };

/* One entry. 10x came out in v2.4 — UNPREC is the better test for the
   extreme end, because RVOL's denominator is a 20-day average that prior
   spikes have already inflated. */
const RVOL_BUCKETS: RvolFilterType[] = ['5'];
const PLAN_BUCKETS: PlanFilterType[] = ['1R', '2R'];
const CAP_BUCKETS: CapFilterType[] = ['Small', 'Large'];
const CHOP_BUCKETS: ChopFilterType[] = ['trend', 'nochop'];

const CHOP_META: Record<ChopFilterType, { label: string; title: string }> = {
  'All': { label: 'ALL', title: '' },
  'trend': {
    label: 'TREND',
    title: `Choppiness ${CHOP_TREND_MAX} or below — the volume landed in tape that is actually going somewhere. The narrow cut; on a scan with no trend gate at all, expect it to remove most of the list.`,
  },
  'nochop': {
    label: 'NO CHOP',
    title: `Choppiness under ${CHOP_CHOP_MIN} — excludes only the churners. This scan has no trend filter of any kind, so this is the closest thing it has to one: it removes names whose range keeps rejecting both edges regardless of what today's volume did.`,
  },
};

const EP_LABELS: Record<string, string> = {
  rvol: 'Volume abnormality',
  unprecedented: 'Vs 60-day volume high',
  floatTurnover: 'Float turnover',
  catalyst: 'Catalyst',
  closeStrength: 'Close strength',
  moneyFlow: 'Money Flow',
  daysToCover: 'Days to cover',
  repeatOffender: 'Repeat trigger',
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

const catalystTagOf = (c: Ep9mCandidate): string | null => {
  if (isGenericCatalyst(c.catalyst)) return null;
  return String(c.catalyst).trim().replace(/\.$/, '');
};

const headlineOf = (c: Ep9mCandidate): string | null => {
  if (!c.thesis) return null;
  const s = String(c.thesis).trim();
  return s.length > 0 ? s : null;
};

const hasCatalyst = (c: Ep9mCandidate): boolean => catalystTagOf(c) != null || headlineOf(c) != null;

/* STRICTER THAN hasCatalyst, deliberately. That one drives the Silent filter
   and accepts a bare tag, because a name with an "Earnings" tag and no
   article genuinely is not silent. The asterisk needs a headline AND a link,
   because it is a control — an asterisk that opens nothing is worse than no
   asterisk, and the two questions are different enough to deserve different
   predicates rather than one loosened to cover both. */
const hasNews = (c: Ep9mCandidate): boolean =>
  !!(headlineOf(c) && c.catalystUrl);

/* One tooltip for the asterisk and the sub-row, so the two can never
   describe the same article differently. */
const newsTooltip = (c: Ep9mCandidate): string => {
  const headline = headlineOf(c);
  if (!headline) return '';
  const meta = [c.catalyst, c.newsPublisher, c.newsAge].filter(Boolean).join(' · ');
  const lines: string[] = [];
  if (meta) { lines.push(meta); lines.push(''); }
  lines.push(headline);
  if (c.newsSentiment === 'negative') {
    lines.push('');
    lines.push('Reads negative — heavy volume against bad news is distribution, not accumulation.');
  }
  return lines.join('\n');
};

const adrOf = (c: Ep9mCandidate): number | null =>
  c.adrPct == null || isNaN(Number(c.adrPct)) ? null : Number(c.adrPct);

const chopOf = (c: Ep9mCandidate): number | null =>
  c.chop14 == null || isNaN(Number(c.chop14)) ? null : Number(c.chop14);

const rmvOf = (c: Ep9mCandidate): number | null =>
  c.rmv == null || isNaN(Number(c.rmv)) ? null : Number(c.rmv);

const rmeOf = (c: Ep9mCandidate): number | null =>
  c.rme == null || isNaN(Number(c.rme)) ? null : Number(c.rme);

const mfOf = (c: Ep9mCandidate): number | null =>
  c.mf == null || isNaN(Number(c.mf)) ? null : Number(c.mf);

const vs60dOf = (c: Ep9mCandidate): number | null =>
  c.volVs60dMax == null || isNaN(Number(c.volVs60dMax)) ? null : Number(c.volVs60dMax);

/* ---- Trade plan ---------------------------------------------------------
   Reads the `plan` object the scan ships. Nothing is recalculated here, so
   the table cannot disagree with the score.

   SORT VALUE needs care. A name with no plan must sort to the bottom rather
   than the top, and `clear` rows have no resistanceR at all when price is
   above every average — those are the BEST rows, so they need a high
   sentinel rather than a null.                                            */
const planOf = (c: Ep9mCandidate): TradePlanRow | null => {
  const p = c.plan;
  return p && typeof p === 'object' ? p : null;
};

const PLAN_SORT_CLEAR = 99;
const PLAN_SORT_NONE = -1;

const planSortValue = (c: Ep9mCandidate): number => {
  const p = planOf(c);
  if (!p || p.tradeable !== true) return PLAN_SORT_NONE;
  if (p.collapsed) return PLAN_SORT_NONE;
  if (p.overextended) return PLAN_SORT_NONE;
  if (p.clear) return p.resistanceR != null ? p.resistanceR : PLAN_SORT_CLEAR;
  return p.resistanceR != null ? p.resistanceR : PLAN_SORT_NONE;
};

const planShort = (c: Ep9mCandidate): string => {
  const p = planOf(c);
  if (!p) return '—';
  if (p.collapsed) return '✕';
  if (p.tradeable !== true) return '—';
  if (p.overextended) return 'EXT';
  if (p.clear) return p.resistanceR != null ? `${p.resistanceR.toFixed(1)}R` : '2R+';
  if (p.resistanceR == null) return '—';
  return `${p.resistanceR.toFixed(1)}R`;
};

const planBadge = (c: Ep9mCandidate): string => {
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

const planTooltip = (c: Ep9mCandidate): string => {
  const p = planOf(c);
  if (!p) return 'No trade plan on this row — the EP9M scan does not yet compute one.';
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

  /* The trigger on this table is the DAY HIGH, because an EP9M name has no
     pattern by construction. That makes chop unusually corrosive here: a day
     high inside a churning range is the level the range has been rejecting,
     so the plan is keyed to precisely the price most likely to fail. */
  const chop = chopOf(c);
  if (chop != null && chop >= CHOP_CHOP_MIN) {
    lines.push('');
    lines.push(`CHOP ${chop.toFixed(0)} — the trigger is the day high, and in a churning range that is the level being rejected. Sound levels, poor odds.`);
  }

  lines.push('');
  lines.push('Stop is the wider of 1.25× ADR or 2.5%. Target is a fixed 2R.');
  return lines.join('\n');
};

const epTooltip = (c: Ep9mCandidate): string => {
  const lines: string[] = [
    `EP ${c.score} — ${c.score >= 70 ? 'A' : c.score >= 50 ? 'B' : 'C'}`,
  ];

  const bd = c.scoreBreakdown;
  if (bd && typeof bd === 'object') {
    const entries = Object.entries(bd)
      .filter(([, v]) => typeof v === 'number' && v !== 0)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    if (entries.length > 0) {
      lines.push('');
      for (const [k, v] of entries) {
        lines.push(`${v > 0 ? '+' : ''}${v}  ${EP_LABELS[k] || k}`);
      }
    }
  }

  if (c.priorTriggers && c.priorTriggers > 0) {
    lines.push('');
    lines.push(`${c.priorTriggers} prior trigger${c.priorTriggers !== 1 ? 's' : ''} in the last 90 days`);
  }

  // EP scores volume, not tradeability. Saying so here keeps a 90 from
  // reading as a recommendation on a name with nowhere to put a stop.
  lines.push('');
  lines.push('EP scores the volume event. See RTR for whether there is a trade.');

  // And chop is a third question again — the regime the volume landed in.
  const chop = chopOf(c);
  if (chop != null && chop >= CHOP_CHOP_MIN) {
    lines.push(`CHOP ${chop.toFixed(0)} — not scored into EP either. The volume event is real; the range it landed in is not resolving.`);
  }

  return lines.join('\n');
};

/* The fuchsia dot means today's volume beat this name's own 60-day record.
   On a trending name that is the purest form of the signal. On a churning
   one it is the most misread row the table produces — "exceptional" by every
   volume measure, and the chart shows a month of nothing. Say both. */
const unprecTooltip = (chop: number | null): string => {
  const base = "Unprecedented — today's volume exceeds this stock's own 60-day high.";
  if (chop == null) return base;
  if (chop >= CHOP_CHOP_MIN) {
    return `${base}\n\nBut CHOP ${chop.toFixed(0)} (${chopLabel(chop).toLowerCase()}) — record size is moving inside a range that keeps rejecting both edges. Research it; do not chase the break.`;
  }
  if (chop <= CHOP_TREND_MAX) {
    return `${base}\n\nCHOP ${chop.toFixed(0)} (${chopLabel(chop).toLowerCase()}) — and the tape is trending, so the volume has somewhere to go. This is the combination the scan exists to find.`;
  }
  return `${base}\n\nCHOP ${chop.toFixed(0)} — mixed regime, no strong read either way.`;
};

const UnprecedentedMark = ({ chop }: { chop: number | null }) => (
  <span
    title={unprecTooltip(chop)}
    className="inline-block w-2 h-2 rounded-full bg-fuchsia-400 shadow-[0_0_6px_rgba(232,121,249,0.7)] align-middle shrink-0 cursor-help"
  />
);

const SugarBabyMark = () => (
  <span
    title="Sugar Baby — has triggered EP9M multiple times in the last 90 days"
    className="text-[9px] font-bold text-amber-400/90 leading-none align-middle"
  >
    ★
  </span>
);

const above21 = (c: Ep9mCandidate) => c.aboveEma21 ?? (c.distToEma21 != null ? c.distToEma21 >= 0 : null);
const above10 = (c: Ep9mCandidate) => c.aboveEma10 ?? (c.distToEma10 != null ? c.distToEma10 >= 0 : null);

export default function Ep9m() {
  const { session } = useMarketData();

  const [candidates, setCandidates] = useState<Ep9mCandidate[]>([]);
  const [status, setStatus] = useState<string>('Syncing...');
  const [generatedAt, setGeneratedAt] = useState<number | null>(null);
  const [raw9m, setRaw9m] = useState<number | null>(null);
  const [shortlisted, setShortlisted] = useState<number | null>(null);
  const [scanMeta, setScanMeta] = useState<any>(null);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: SortDirection } | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [epFilter, setEpFilter] = useState<EpFilterType>('All');
  const [rvolFilter, setRvolFilter] = useState<RvolFilterType>('All');
  const [catalystFilter, setCatalystFilter] = useState<CatalystFilterType>('All');
  const [planFilter, setPlanFilter] = useState<PlanFilterType>('All');
  const [chopFilter, setChopFilter] = useState<ChopFilterType>('All');
  const [showUnprecedentedOnly, setShowUnprecedentedOnly] = useState<boolean>(false);
  const [showSugarBabyOnly, setShowSugarBabyOnly] = useState<boolean>(false);
  const [showStage2Only, setShowStage2Only] = useState<boolean>(false);
  const [marketCapFilter, setMarketCapFilter] = useState<CapFilterType>('All');
  const [vwapFilter, setVwapFilter] = useState<VwapFilterType>('All');
  const [showFilters, setShowFilters] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    const fetchCandidates = async () => {
      try {
        const res = await fetch(`/api/ep9m/latest?t=${Date.now()}`, { cache: 'no-store' });
        const data = await res.json();

        if (isMounted && data && data.success && Array.isArray(data.candidates)) {
          setCandidates(data.candidates);
          setGeneratedAt(data.lastScanTime ? Number(data.lastScanTime) : null);
          setRaw9m(data.raw9m ?? null);
          setShortlisted(data.shortlisted ?? null);
          if (data.scanMeta?.ep9m) setScanMeta(data.scanMeta.ep9m);
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

  const handleSort = (key: string) => {
    let direction: SortDirection = 'desc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') direction = 'asc';
    else if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') { setSortConfig(null); return; }
    setSortConfig({ key, direction });
  };

  // Every group is a toggle: pressing the active option clears it. That is
  // what removed the need for a MKT CAP "All" button — nothing selected
  // already means all, and a second click gets you there.
  const handleEpFilter = (val: EpFilterType) => setEpFilter(prev => prev === val ? 'All' : val);
  const handleRvolFilter = (val: RvolFilterType) => setRvolFilter(prev => prev === val ? 'All' : val);
  const handleCatalystFilter = (val: CatalystFilterType) => setCatalystFilter(prev => prev === val ? 'All' : val);
  const handleVwapFilter = (val: VwapFilterType) => setVwapFilter(prev => prev === val ? 'All' : val);
  const handlePlanFilter = (val: PlanFilterType) => setPlanFilter(prev => prev === val ? 'All' : val);
  const handleCapFilter = (val: CapFilterType) => setMarketCapFilter(prev => prev === val ? 'All' : val);
  const handleChopFilter = (val: ChopFilterType) => setChopFilter(prev => prev === val ? 'All' : val);

  /* Does ANY row carry a chop reading? Drives whether the CHOP group renders
     at all. Until /api/ep9m/run has executed since v1.6 the field is absent
     on every row, and a filter that empties the table rather than narrowing
     it is worse than no filter. Flips to true on its own once the scan runs. */
  const anyChop = useMemo(() => candidates.some(c => chopOf(c) != null), [candidates]);

  // A hidden group must not keep filtering. Without this, selecting NO CHOP
  // and then losing chop data on the next poll would leave an invisible
  // filter holding the table empty with no control to clear it.
  useEffect(() => {
    if (!anyChop && chopFilter !== 'All') setChopFilter('All');
  }, [anyChop, chopFilter]);

  const filteredAndSorted = useMemo(() => {
    let list = [...candidates];

    if (epFilter !== 'All') {
      const minScore = EP_MIN_SCORE[epFilter];
      list = list.filter(c => (c.score ?? -1) >= minScore);
    }
    if (rvolFilter !== 'All') {
      const minRvol = Number(rvolFilter);
      list = list.filter(c => (c.rvol ?? 0) >= minRvol);
    }
    if (catalystFilter !== 'All') {
      list = list.filter(c => catalystFilter === 'News' ? hasCatalyst(c) : !hasCatalyst(c));
    }
    /* CHOP. Rows with no reading fall OUT of either selection rather than
       passing — a name with too few daily bars to score is not evidence of a
       trend, and on this scan thin history is common: an EP9M trigger on a
       recent listing is exactly the case where the reading is missing and
       the churn risk is highest. */
    if (chopFilter !== 'All') {
      list = list.filter(c => {
        const v = chopOf(c);
        if (v == null) return false;
        return chopFilter === 'trend' ? v <= CHOP_TREND_MAX : v < CHOP_CHOP_MIN;
      });
    }
    /* Plan filter drops anything without a usable entry, then applies a
       threshold in stop-widths. On this table that is the sharpest cut
       available — it strips the collapsed and the already-run and leaves only
       volume events you could act on. */
    if (planFilter !== 'All') {
      const minR = planFilter === '2R' ? 2.0 : 1.0;
      list = list.filter(c => {
        const p = planOf(c);
        if (!p || p.tradeable !== true || p.collapsed || p.overextended) return false;
        if (p.clear === true) return true;
        return p.resistanceR != null && p.resistanceR >= minR;
      });
    }
    if (showUnprecedentedOnly) list = list.filter(c => c.unprecedented === true);
    if (showSugarBabyOnly) list = list.filter(c => c.sugarBaby === true);
    if (showStage2Only) list = list.filter(c => stageShort(c.stage).startsWith('2'));
    if (marketCapFilter !== 'All') {
      list = list.filter(c => {
        const mc = c.mktCap;
        if (!mc) return true;
        if (marketCapFilter === 'Large') return mc >= 2e9;
        if (marketCapFilter === 'Small') return mc < 2e9;
        return true;
      });
    }
    if (vwapFilter !== 'All') {
      list = list.filter(c => c.vwapStatus === vwapFilter);
    }

    if (!sortConfig) return list;
    return list.sort((a, b) => {
      const aVal = sortConfig.key === 'planR' ? planSortValue(a) : (a as any)[sortConfig.key];
      const bVal = sortConfig.key === 'planR' ? planSortValue(b) : (b as any)[sortConfig.key];
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [candidates, sortConfig, epFilter, rvolFilter, catalystFilter, planFilter, chopFilter, showUnprecedentedOnly, showSugarBabyOnly, showStage2Only, marketCapFilter, vwapFilter]);

  const handleCopyTickers = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const tickers = filteredAndSorted.map(c => c.ticker).join(',');
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

  const silentCount = useMemo(() => candidates.filter(c => !hasCatalyst(c)).length, [candidates]);
  const unprecedentedCount = useMemo(() => candidates.filter(c => c.unprecedented).length, [candidates]);

  /* Record volume landing in tape that cannot express it. Surfaced in the
     header because it is the most interesting thing this scan finds and the
     easiest to misread from the row alone. Only rendered when non-zero —
     a header chip reading "0 In Chop" every quiet day is noise. */
  const unprecInChopCount = useMemo(
    () => candidates.filter(c => {
      const v = chopOf(c);
      return c.unprecedented && v != null && v >= CHOP_CHOP_MIN;
    }).length,
    [candidates]
  );

  const getSortIcon = (columnKey: string) =>
    sortConfig?.key === columnKey ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓') : '';

  const getScoreBadge = (score: number) => {
    if (score >= 70) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    if (score >= 50) return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    return 'bg-zinc-800/50 text-zinc-400 border-zinc-700/50';
  };
  const getRvolColor = (rvol: number | null | undefined) => {
    if (!rvol) return 'text-slate-500';
    if (rvol >= 10) return 'text-fuchsia-400';
    if (rvol >= 7) return 'text-purple-400';
    if (rvol >= 5) return 'text-emerald-400';
    return 'text-lime-400';
  };
  const getTurnColor = (t: number | null | undefined) => {
    if (t == null) return 'text-slate-500';
    if (t >= 1.0) return 'text-fuchsia-400';
    if (t >= 0.5) return 'text-purple-400';
    if (t >= 0.25) return 'text-emerald-400';
    if (t >= 0.10) return 'text-lime-400';
    return 'text-slate-400';
  };
  const getDtcColor = (d: number | null | undefined) => {
    if (d == null) return 'text-slate-500';
    if (d >= 5) return 'text-purple-400';
    if (d >= 3) return 'text-emerald-400';
    if (d >= 1.5) return 'text-slate-300';
    return 'text-slate-500';
  };
  const getAdrColor = (a: number | null) => {
    if (a == null) return 'text-slate-500';
    if (a >= 10) return 'text-purple-400';
    if (a >= 5) return 'text-emerald-400';
    if (a >= 3) return 'text-slate-300';
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
  const getChgColor = (chg: number | null | undefined) => {
    if (chg == null) return 'text-slate-500';
    return chg >= 0 ? 'text-emerald-400' : 'text-rose-400';
  };
  const getVs60dColor = (v: number | null) => {
    if (v == null) return 'text-slate-600';
    if (v >= 1.0) return 'text-fuchsia-400';
    if (v >= 0.7) return 'text-purple-400';
    if (v >= 0.5) return 'text-emerald-400';
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
    (epFilter !== 'All' ? 1 : 0) +
    (planFilter !== 'All' ? 1 : 0) +
    (chopFilter !== 'All' ? 1 : 0) +
    (rvolFilter !== 'All' ? 1 : 0) +
    (showUnprecedentedOnly ? 1 : 0) +
    (showSugarBabyOnly ? 1 : 0) +
    (catalystFilter !== 'All' ? 1 : 0) +
    (showStage2Only ? 1 : 0) +
    (marketCapFilter !== 'All' ? 1 : 0) +
    (vwapFilter !== 'All' ? 1 : 0);

  const funnelNote = raw9m != null && shortlisted != null
    ? `${raw9m} names cleared 9M shares · ${shortlisted} were abnormal for themselves`
    : null;

  return (
    <div className="bg-[#101623] border border-white/5 rounded-2xl p-3 md:p-5 relative overflow-visible shadow-xl w-full max-w-[1280px] mx-auto">
      <div onClick={() => setIsExpanded(!isExpanded)} className={`flex justify-between items-center relative z-30 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-5 border-b border-white/5 pb-4' : ''}`}>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs md:text-sm font-bold text-[#7c8bfa] bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 group-hover:bg-white/[0.02] transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
            EP 9 MILLION
          </span>
          {candidates.length > 0 && (
            <span className="hidden md:flex items-center gap-2">
              <span className="text-[10px] font-bold tracking-wider uppercase text-fuchsia-400 bg-fuchsia-500/10 border border-fuchsia-500/20 px-2 py-0.5 rounded">{unprecedentedCount} Unprecedented</span>
              <span className="text-[10px] font-bold tracking-wider uppercase text-slate-400 bg-white/[0.03] border border-white/5 px-2 py-0.5 rounded">{silentCount} Silent</span>
              {/* Only when non-zero — a chip reading "0 In Chop" every quiet
                  day is noise, and this one is meant to be noticed. */}
              {unprecInChopCount > 0 && (
                <span
                  className="text-[10px] font-bold tracking-wider uppercase text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded cursor-help"
                  title={`${unprecInChopCount} name${unprecInChopCount === 1 ? '' : 's'} printed record volume INSIDE a chop regime — the volume event is real and the range is not resolving it. Research these; do not chase the break.`}
                >
                  {unprecInChopCount} In Chop
                </span>
              )}
            </span>
          )}
          {filteredAndSorted.length > 0 && (
            <button
            onClick={handleCopyTickers}
            disabled={filteredAndSorted.length === 0}
            title={filteredAndSorted.length > 0 ? `Copy ${filteredAndSorted.length} ticker${filteredAndSorted.length !== 1 ? 's' : ''} for TradingView` : 'No tickers to copy'}
            className={`text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded border transition-all duration-200 ${
              copied
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : filteredAndSorted.length === 0
                  ? 'bg-[#161c2a]/50 text-slate-600 border-white/5 cursor-not-allowed'
                  : 'bg-[#161c2a] text-slate-400 border-white/5 hover:text-slate-200 hover:bg-white/[0.04]'
            }`}
          >
            {copied ? `✓ Copied ${filteredAndSorted.length}` : `Copy ${filteredAndSorted.length}`}
          </button>
          )}
          <span className="relative z-40 inline-flex">
            <MetricsKey meta={EP9M_META} liveGates={scanMeta?.gates} />
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
                <div className={pillWrap}>
                  <span className={pillLabel}>EP</span>
                  <div className="flex items-center gap-1">
                    {EP_BUCKETS.map((g) => (
                      <button
                        key={g}
                        onClick={() => handleEpFilter(g)}
                        title={g === 'A' ? 'A only — EP 70 and above' : 'B and above — includes A (EP 50+)'}
                        className={`${pillBtn} ${epFilter === g ? filterBtnActive : filterBtnIdle}`}
                      >
                        {g}
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
                          ? 'At least two stop-widths to the nearest overhead level, or clear air above the trigger'
                          : 'At least one stop-width to the nearest overhead level — also strips the collapsed and the already-run'}
                        className={`${pillBtn} ${planFilter === opt ? filterBtnActive : filterBtnIdle}`}
                      >
                        {opt === '1R' ? '1R+' : '2R+'}
                      </button>
                    ))}
                  </div>
                </div>
                {/* CHOP sits high on this bar because this scan has no trend
                    gate of any kind — it is the closest thing the table has
                    to one. */}
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
                {/* One group for every read of this name's volume behaviour:
                    5x+ is today elevated, UNPREC is today a record, ★ is does
                    this often. */}
                <div className={pillWrap}>
                  <span className={pillLabel}>VOL</span>
                  <div className="flex items-center gap-1">
                    {RVOL_BUCKETS.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => handleRvolFilter(opt)}
                        title={`Relative volume of ${opt}x and above — scan floor is 3x. For the extreme end use UNPREC, which measures against the 60-day high rather than an average prior spikes have inflated.`}
                        className={`${pillBtn} ${rvolFilter === opt ? filterBtnActive : filterBtnIdle}`}
                      >
                        {opt}x+
                      </button>
                    ))}
                    <button
                      onClick={() => setShowUnprecedentedOnly(!showUnprecedentedOnly)}
                      title="Today's volume exceeds this stock's own 60-day record — the purest expression of the signal. Pair with the CHOP filter: record volume inside a churning range is real activity with nowhere to go."
                      className={`${pillBtn} ${showUnprecedentedOnly ? filterBtnActive : filterBtnIdle}`}
                    >
                      Unprec
                    </button>
                    <button
                      onClick={() => setShowSugarBabyOnly(!showSugarBabyOnly)}
                      title="Repeat EP9M offender — has triggered multiple times in the last 90 days"
                      className={`${pillBtn} ${showSugarBabyOnly ? filterBtnActive : filterBtnIdle}`}
                    >
                      ★
                    </button>
                  </div>
                </div>
                <div className={pillWrap}>
                  <span className={pillLabel}>STORY</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleCatalystFilter('News')}
                      title="Has a news catalyst attached"
                      className={`${pillBtn} ${catalystFilter === 'News' ? filterBtnActive : filterBtnIdle}`}
                    >
                      News
                    </button>
                    <button
                      onClick={() => handleCatalystFilter('Silent')}
                      title="Heavy volume with no headline yet — the footprint before the story"
                      className={`${pillBtn} ${catalystFilter === 'Silent' ? filterBtnActive : filterBtnIdle}`}
                    >
                      Silent
                    </button>
                  </div>
                </div>
                {/* STAGE keeps its own group here, unlike the other tables
                    where it folded into POSTURE. With no trend gate, STAGE and
                    CHOP are the two structural controls this table has —
                    STAGE for the 200-day picture, CHOP for the last fortnight. */}
                <div className={pillWrap}>
                  <span className={pillLabel}>STAGE</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setShowStage2Only(!showStage2Only)}
                      title="Stage 2 only — separates accumulation in an uptrend from capitulation in a downtrend. The long-horizon partner to the CHOP filter."
                      className={`${pillBtn} ${showStage2Only ? filterBtnActive : filterBtnIdle}`}
                    >
                      2
                    </button>
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
                      title="Only names holding above VWAP — on a heavy-volume day, whether the session is being bought or sold. Below-VWAP names still show their red dot in the price cell."
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
            {/* 18 columns. RTR sits after EP, matching every other table.
                min-w 960; widths sum ~99. */}
            <table className="w-full min-w-[960px] table-fixed border-collapse">
              <thead>
                <tr className="border-b border-white/5 select-none">
                  <th className={`${thBase} w-[7%]`} title={colTip('TICKER')} onClick={() => handleSort('ticker')}>TICKER{getSortIcon('ticker')}</th>
                  <th className={`${thBase} w-[4%]`} title={colTip('EP')} onClick={() => handleSort('score')}>EP{getSortIcon('score')}</th>
                  <th className={`${thBase} w-[5%]`} title={colTip('RTR')} onClick={() => handleSort('planR')}>RTR{getSortIcon('planR')}</th>
                  <th className={`${thBase} w-[6%]`} title={colTip('PRICE')} onClick={() => handleSort('price')}>PRICE{getSortIcon('price')}</th>
                  <th className={`${thBase} w-[6%]`} title={colTip('CHG%')} onClick={() => handleSort('changePct')}>CHG%{getSortIcon('changePct')}</th>
                  <th className={`${thBase} w-[6%]`} title={colTip('10/21')}>10/21</th>
                  <th className={`${thBase} w-[6%]`} title={colTip('VOL')} onClick={() => handleSort('vol')}>VOL{getSortIcon('vol')}</th>
                  <th className={`${thBase} w-[6%]`} title={colTip('$VOL')} onClick={() => handleSort('dVol')}>$VOL{getSortIcon('dVol')}</th>
                  <th className={`${thBase} w-[5%]`} title={colTip('RVOL')} onClick={() => handleSort('rvol')}>RVOL{getSortIcon('rvol')}</th>
                  <th className={`${thBase} w-[5%]`} title={colTip('TURN')} onClick={() => handleSort('floatTurnover')}>TURN{getSortIcon('floatTurnover')}</th>
                  {/* One header, two stacked readings. Clicking sorts by ADR;
                      CHOP is filtered rather than sorted, since a single
                      header cannot carry two sort keys. */}
                  <th className={`${thBase} w-[5%]`} title={colTip('ADR')} onClick={() => handleSort('adrPct')}>ADR{getSortIcon('adrPct')}</th>
                  <th className={`${thBase} w-[4%]`} title={colTip('MF')} onClick={() => handleSort('mf')}>MF{getSortIcon('mf')}</th>
                  <th className={`${thBase} w-[6%]`} title={colTip('RS')} onClick={() => handleSort('rsVsSpy')}>RS{getSortIcon('rsVsSpy')}</th>
                  <th className={`${thBase} w-[6%]`} title={colTip('STOCH')} onClick={() => handleSort('stochK')}>STOCH{getSortIcon('stochK')}</th>
                  <th className={`${thBase} w-[5%]`} title={colTip('DTC')} onClick={() => handleSort('daysToCover')}>DTC{getSortIcon('daysToCover')}</th>
                  <th className={`${thBase} w-[5%]`} title={colTip('MCAP')} onClick={() => handleSort('mktCap')}>MCAP{getSortIcon('mktCap')}</th>
                  <th className={`${thStage} w-[5%] border-l border-white/5`} title={colTip('STAGE')} onClick={() => handleSort('stage')}>STAGE{getSortIcon('stage')}</th>
                  <th className={`${thSector} w-[7%]`} title={colTip('SECTOR')} onClick={() => handleSort('sector')}>SECTOR{getSortIcon('sector')}</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-white/5">
                {filteredAndSorted.length === 0 ? (
                  <tr>
                    <td colSpan={18} className="py-12 text-center text-slate-500 text-sm font-medium">
                      {status === 'Live'
                        ? (candidates.length > 0
                            ? 'No names match the current filters.'
                            : 'Nothing trading abnormal size yet — volume builds through the session.')
                        : status === 'Syncing...'
                          ? 'Running scan…'
                          : 'Feed unavailable — awaiting next scheduled scan.'}
                    </td>
                  </tr>
                ) : (
                  filteredAndSorted.map((row) => {
                    const tag = catalystTagOf(row);
                    const headline = headlineOf(row);
                    const sectorText = cleanSector(row.sector, row.ticker);
                    const adr = adrOf(row);
                    const chop = chopOf(row);
                    const rmv = rmvOf(row);
                    const rme = rmeOf(row);
                    const mf = mfOf(row);
                    const vs60d = vs60dOf(row);
                    const stateRes = stateOf(rmv, rme);
                    const plan = planOf(row);
                    return (
                      <React.Fragment key={row.ticker}>
                        <tr className="hover:bg-white/[0.02] transition-colors group">
                          <td className={tdBase}>
                            <div className="flex items-center justify-center gap-1.5">
                              <a href={`https://www.tradingview.com/chart/?symbol=${row.ticker}`} target="_blank" rel="noopener noreferrer" title={row.name || row.ticker} className="inline-block bg-indigo-500/10 text-[#7c8bfa] text-[11px] font-bold px-1.5 py-0.5 rounded border border-indigo-500/20 hover:bg-indigo-500/20 hover:text-indigo-300 transition-colors">{row.ticker}</a>
                              {/* Fixed-width slot, immediately after the
                                  ticker and BEFORE the unprecedented dot and
                                  the star. Those two are conditional and
                                  already ragged; putting the news marker
                                  first gives it a stable column of its own
                                  rather than a position that depends on
                                  which other flags happen to be set. */}
                              <span className="inline-block w-[9px] text-center leading-none shrink-0">
                                {hasNews(row) && (
                                  <a
                                    href={row.catalystUrl!}
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
                              {row.unprecedented && <UnprecedentedMark chop={chop} />}
                              {row.sugarBaby && <SugarBabyMark />}
                            </div>
                          </td>
                          <td className={tdBase}>
                            <span
                              title={epTooltip(row)}
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
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getChgColor(row.changePct)}`}>
                            {row.changePct != null ? `${row.changePct >= 0 ? '+' : ''}${row.changePct.toFixed(2)}%` : '—'}
                          </td>
                          <td className={`${tdBase} whitespace-nowrap`}>
                            <div className="flex items-center justify-center gap-1">
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
                          <td
                            className={`${tdBase} whitespace-nowrap tabular-nums`}
                            title={row.avgVol ? `20-day average: ${formatNumber(row.avgVol)}${row.volVs60dMax != null ? ` · ${row.volVs60dMax.toFixed(2)}x its 60-day volume high` : ''}` : undefined}
                          >
                            <div className="text-xs font-bold leading-tight text-slate-200">{formatNumber(row.vol)}</div>
                            {row.avgVol ? (<div className="text-[9px] text-slate-500 font-medium leading-tight">avg {formatNumber(row.avgVol)}</div>) : null}
                          </td>
                          <td className={`${tdBase} text-xs text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{formatCurrency(row.dVol)}</td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getRvolColor(row.rvol)}`} title="Today's volume vs its own 20-day average">
                            {row.rvol ? `${row.rvol.toFixed(1)}x` : '—'}
                          </td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getTurnColor(row.floatTurnover)}`} title="Float turnover — share of the tradeable float that changed hands today. Above 1.0x the entire float traded.">
                            {row.floatTurnover != null ? `${row.floatTurnover.toFixed(2)}x` : '—'}
                          </td>
                          {/* ADR over CHOP, one cell. On this table CHOP is
                              the only reading that says whether the range the
                              volume landed in can resolve — there is no trend
                              gate anywhere in this scan. */}
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
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${mfColor(mf)}`} title={`Money Flow (21) — ${mfLabel(mf)}. Heavy volume with MF under 45 is distribution, however strong today's close. Arrow shows the 5-day direction.`}>
                            {mf != null ? `${mf.toFixed(0)}${mfArrow(row.mfTrend ?? 0)}` : '—'}
                          </td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getRsColor(row.rsVsSpy)}`} title={row.rsVsSpy != null ? `${row.rsVsSpy >= 0 ? '+' : ''}${row.rsVsSpy.toFixed(1)} percentage points vs SPY over three months` : undefined}>
                            {formatRs(row.rsVsSpy)}
                          </td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getStochColor(row.stochK)}`}>{row.stochK != null ? row.stochK.toFixed(1) : '—'}</td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getDtcColor(row.daysToCover)}`} title="Days to cover — short interest divided by average daily volume. Squeeze fuel.">
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
                        {/* Sub-row: colSpan 16 covers TICKER..MCAP, then STAGE
                            and SECTOR get their own cells — 18 total, matching
                            the header.

                            Levels lead, same slot the setup name occupies on
                            SIPs and Daily, then VS60D, which is the signal this
                            scan exists for. */}
                        <tr className="bg-transparent border-t border-white/5">
                          <td colSpan={16} className="pb-1.5 pt-1 pr-3">
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
                              <span
                                className="shrink-0 flex items-baseline gap-1 pr-2.5 cursor-help whitespace-nowrap"
                                title="Today's volume as a multiple of this stock's own 60-day volume high. Above 1.0× is unprecedented for this name — the purest expression of the EP9M signal, and what the UNPREC filter reads."
                              >
                                <span className="text-[8px] font-bold tracking-[0.08em] uppercase text-slate-600">VS60D</span>
                                <span className={`text-[9px] font-bold tabular-nums ${getVs60dColor(vs60d)}`}>{vs60d != null ? `${vs60d.toFixed(2)}×` : '—'}</span>
                              </span>
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
                                      row.catalystUrl ? (
                                        <a href={row.catalystUrl} target="_blank" rel="noopener noreferrer" className="text-slate-500 font-normal hover:text-slate-300 hover:underline transition-colors">{headline}</a>
                                      ) : (
                                        <span className="text-slate-500 font-normal">{headline}</span>
                                      )
                                    )}
                                    {/* Source and age. Age is unusually
                                        pointed here: 9M shares today against
                                        a headline from three days ago means
                                        the volume is NOT the news, which is
                                        the more interesting case. */}
                                    {(row.newsPublisher || row.newsAge) && (
                                      <span className="text-[8px] text-slate-600 font-medium ml-1.5 whitespace-nowrap">
                                        {[row.newsPublisher, row.newsAge].filter(Boolean).join(' · ')}
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <span className="text-slate-600 italic">No headline yet — the volume is the signal. Research the story.</span>
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
                            {row.unprecedented ? (
                              <span className="text-[8px] font-semibold text-fuchsia-400 whitespace-nowrap">Unprec</span>
                            ) : !hasCatalyst(row) ? (
                              <span className="text-[8px] font-semibold text-slate-500 whitespace-nowrap">Silent</span>
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

          {funnelNote && (
            <div className="relative z-10 mt-3 text-center">
              <span className="text-[10px] text-slate-600 font-medium tracking-wide">{funnelNote}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
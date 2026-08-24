'use client';

// Scorecard — v1.9  (component: MacroScorecard)
// v1.1: SOL removed; T2108 added as the twelfth card.
// v1.2: Tone narrative condensed to four lines; measurement separated from
//       verdict so the internals line and the regime line can no longer
//       contradict each other.
// v1.3: CHOP regime strip added below ATHI/ATLO.
// v1.4: Arrow band 0.5 -> 0.15; delta derived from raw rather than from two
//       composites that cancelled their own modifiers.
// v1.5: CHOP right cluster cut to the score and the zone label.
// v1.6: +4%/-4% dropped from Internals; all three strips normalised to a
//       shared width skeleton so the bars come out the same length.
// v1.7: CHOP cluster reordered — zone word in the note slot, score in the
//       badge, matching A/D 0.66 then 40%.
// v1.8: + CHOP sensitivity (AS IS / MED / STRONG) and the intraday marker.
// v1.9: CHOP split into TWO STACKED TRACKS, and the proportional bars given
//       the same visual depth — but NOT the same encoding.
//
//   ---- WHY CHOP STACKS ---------------------------------------------------
//
//   v1.8 put the daily marker on the track and the intraday caret beneath
//   it, which kept them distinguishable but made the divergence something
//   you computed rather than saw: two numbers in the sub-row, subtracted by
//   eye. Two tracks of identical width, vertically aligned, turn the same
//   information into a horizontal offset. One marker left of the other IS
//   the read — no arithmetic.
//
//   The tracks share thresholds, scale and width for that reason. If they
//   were scaled independently the offset would be meaningless.
//
//   ---- WHY A/D AND ATHI/ATLO DO NOT GET THE GRADIENT AS AN ENCODING ------
//
//   THE TWO BAR TYPES ENCODE DIFFERENT THINGS AND MUST NOT LOOK IDENTICAL.
//
//   A/D and ATHI/ATLO are PROPORTIONS. 722 advancing against 1,149 declining
//   — the fill IS the data, and where green stops and red starts is the
//   entire reading. Both sides remain literally true wherever the boundary
//   sits.
//
//   CHOP is ONE POINT ON A SCALE. There is no left side and no right side,
//   only a marker, with a gradient behind it purely for orientation.
//
//   Putting a spectrum gradient behind A/D would destroy that. The pixels at
//   30% would render greenish whether or not 30% is where the split falls,
//   so a heavily red tape would still show green on its left third and read
//   as "some advancing" when the truth is "almost none". The gradient would
//   be decoration that contradicts the data.
//
//   SO WHAT CARRIES OVER IS THE TREATMENT, NOT THE ENCODING:
//
//     · gradient WITHIN each side — green deepening toward its own edge, red
//       deepening toward its own edge, so the fill has the same depth as the
//       CHOP track while the boundary stays exactly where the numbers put it
//     · threshold ticks at 40 and 60 — these already existed as the points
//       where the badge changes colour, and were invisible. Now you can see
//       how close the tape is to flipping between "buyers in control" and
//       "sellers dominate" instead of only learning it after it happens
//     · a marker at the split, matching the CHOP marker, tying the bar to
//       the percentage badge at the end of the row
//
//   The result reads as one family without any bar claiming something false.

import React, { useEffect, useState, useRef, useCallback } from 'react';
import MacroScorecardPanel from './MacroScorecardPanel';
import BenchmarkStrips from './BenchmarkStrip';
import TickerChartHover from './TickerChartHover';
import { getMarketSession } from '@/lib/indicators/marketScorecard';
import {
  type ChopMode,
  type ChopBands,
  CHOP_BANDS,
  CHOP_MODES,
  chopComposite,
  chopZoneLabel,
  chopTextColor as chopColor,
  chopBadgeBg,
  chopCellTone,
  chopVerdict,
  chopSpreadNote,
  chopAllBandsNote,
  divergenceOf,
  CHOP_TREND_BAND,
  INTRADAY_STALE_MINUTES,
} from '@/lib/indicators/chopMarket';

// Unified Asset Dictionary
const MACRO_ASSETS = [
  { id: 'SPY', fmp: 'SPY', ws: 'SPY', chart: 'SPY', name: 'S&P 500', type: 'stock' },
  { id: 'QQQ', fmp: 'QQQ', ws: 'QQQ', chart: 'QQQ', name: 'Nasdaq 100', type: 'stock' },
  { id: 'DIA', fmp: 'DIA', ws: 'DIA', chart: 'DIA', name: 'Dow Jones', type: 'stock' },
  { id: 'IWM', fmp: 'IWM', ws: 'IWM', chart: 'IWM', name: 'Russell 2000', type: 'stock' },
  { id: 'VIX', fmp: '^VIX', ws: 'VIX', chart: 'VIX', name: 'VIX Index', type: 'stock' },
  { id: 'TLT', fmp: 'TLT', ws: 'TLT', chart: 'TLT', name: '20Y Treasury', type: 'stock' },
  { id: 'GLD', fmp: 'GLD', ws: 'GLD', chart: 'GLD', name: 'Gold ETF', type: 'stock' },
  { id: 'SLV', fmp: 'SLV', ws: 'SLV', chart: 'SLV', name: 'Silver ETF', type: 'stock' },
  { id: 'USO', fmp: 'USO', ws: 'USO', chart: 'USO', name: 'Crude Oil', type: 'stock' },
  { id: 'BTC', fmp: 'BTCUSD', ws: 'BTC-USD', chart: 'X:BTCUSD', name: 'Bitcoin', type: 'crypto' },
  { id: 'ETH', fmp: 'ETHUSD', ws: 'ETH-USD', chart: 'X:ETHUSD', name: 'Ethereum', type: 'crypto' },
];

interface TickData {
  price: number;
  baseline: number;
  pct: number;
  tickDirection: 'up' | 'down' | 'flat';
  synced: boolean;
  isExtended?: boolean;
}

interface BreadthData {
  score: number;
  signal: 'GREEN' | 'NEUTRAL' | 'RED';
  advancers: number;
  decliners: number;
  up4: number;
  down4: number;
  newHighs?: number;
  newLows?: number;
}

interface T2108Data {
  value: number | null;
  zone: string;
  above: number | null;
  total: number | null;
  updatedAt: string | null;
}

interface ChopIntraday {
  qqq: number | null;
  spy: number | null;
  blended: number | null;
  lastBarAt: string | null;
  windowMinutes: number | null;
  barMinutes: number | null;
  feedDelayMinutes: number | null;
}

interface ChopData {
  qqq: number | null;
  qqqPrev: number | null;
  spy: number | null;
  spyPrev: number | null;
  blended: number | null;
  blendedPrev: number | null;
  period: number;
  updatedAt: string | null;
  intraday: ChopIntraday | null;
}

type MarketSession = 'Pre-Market' | 'Open' | 'Post-Market' | 'Closed';

/* ---- Shared strip skeleton ----------------------------------------------
   The three internals strips are one component shape rendered three times,
   so every slot has to measure the same or nothing lines up.

   Applied from sm up only. Stacked on mobile there is nothing to align. */
const STRIP_LABEL_W = 'sm:w-[88px] sm:shrink-0';
const STRIP_ARROW_W = 'sm:w-[12px] sm:shrink-0';
const STRIP_SIDE_W = 'sm:w-[92px] sm:shrink-0';
const STRIP_NOTE_W = 'sm:w-[104px] sm:shrink-0 sm:justify-end sm:text-right';
const STRIP_BADGE_W = 'sm:min-w-[46px] text-center';
const STRIP_CLUSTER_W = 'sm:shrink-0 sm:justify-end';

/* Width of the tiny 1D / 15M prefix inside the CHOP bar area. Both tracks
   use it so their zero points align exactly — without that the vertical
   offset between markers would be measuring the labels rather than the
   readings. */
const CHOP_TRACK_LABEL_W = 'w-[24px] shrink-0';

/* The breadth badge changes colour at these points (see breadthPctColor).
   They were invisible until v1.9; drawing them is the whole reason the tick
   treatment was worth carrying over from the CHOP track. */
const BREADTH_TICK_LOW = 40;
const BREADTH_TICK_HIGH = 60;

// --- HELPERS ---

const formatTime = (date: Date) => {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'America/New_York'
  });
};

const formatClockShort = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });
};

/* ------------------------------------------------------------------
   T2108 — % of stocks above their own 40-day MA.
   NOT a simple good/bad scale: both extremes are actionable, in
   opposite directions. Low means washed out (Bonde hunts reversals
   aggressively under 20, calls sub-10 a near-guaranteed bounce).
   High means froth, where breakouts start failing.
   ------------------------------------------------------------------ */
const t2108Color = (v: number | null): string => {
  if (v == null) return 'text-slate-500';
  if (v <= 10) return 'text-purple-400';
  if (v <= 20) return 'text-emerald-400';
  if (v <= 35) return 'text-lime-400';
  if (v <= 65) return 'text-slate-200';
  if (v <= 80) return 'text-amber-400';
  return 'text-rose-400';
};

const t2108CardStyle = (v: number | null): { bg: string; border: string } => {
  if (v == null) return { bg: 'bg-[#161c2a]/60', border: 'border-white/5' };
  if (v <= 20) return { bg: 'bg-emerald-950/10', border: 'border-emerald-500/20' };
  if (v <= 35) return { bg: 'bg-lime-950/10', border: 'border-lime-500/20' };
  if (v <= 65) return { bg: 'bg-[#161c2a]/60', border: 'border-white/10' };
  if (v <= 80) return { bg: 'bg-amber-950/10', border: 'border-amber-500/20' };
  return { bg: 'bg-rose-950/10', border: 'border-rose-500/20' };
};

const t2108ZoneLabel = (v: number | null, zone: string): string => {
  if (v == null) return zone === 'unknown' ? 'NO DATA' : zone.toUpperCase();
  if (v <= 10) return 'WASHED OUT';
  if (v <= 20) return 'DEEP OVERSOLD';
  if (v <= 35) return 'OVERSOLD';
  if (v <= 65) return 'NEUTRAL';
  if (v <= 80) return 'EXTENDED';
  return 'FROTHY';
};

/* ---- CHOP SENSITIVITY ----------------------------------------------------
   Three threshold pairs.

       AS IS    61.8 / 38.2   the textbook Fibonacci bands
       MED      55.0 / 33.0
       STRONG   50.0 / 28.0

   61.8 and 38.2 come from the indicator's original publication and are
   conventional rather than derived — Fibonacci retracements applied to a
   0-100 scale because the author liked the symmetry. Nothing about a 14-bar
   window makes 61.8 the point where a market stops trending.

   55 is the more defensible middle: on a 14-bar lookback the ratio
   sum(TR)/range sits near 3.2 there, roughly where price has travelled over
   three times the ground it covered. 50 is dead centre — above it the tape
   spends more effort than it gains.

   THE TREND EDGE MOVES WITH THE CHOP EDGE. If only the chop threshold
   tightened, the middle band would widen and MIXED would swallow everything
   — the setting would make the strip LESS informative at the exact moment
   you asked for more discrimination.

   `dead` and `strongTrend` track their band at a CONSTANT OFFSET rather than
   being tuned separately. The escalation means "well past the line", and
   what counts as well past should move when the line does.

   SCOPE: THIS COMPONENT ONLY. It does not touch @/lib/indicators/chop, so
   the five per-ticker tables keep fixed 61.8/38.2 thresholds. Those FILTER
   ROWS and need stable semantics — a name appearing or vanishing because of
   a display preference would be indefensible. */
/* ---- CHOP composite ------------------------------------------------------
   The route hands over raw Choppiness Index. Two modifiers adjust it, because
   raw CHOP on an index has one specific failure mode:

   A ROTATION TAPE SCORES AS CHOP. When money rotates out of one group and
   into another, the index travels a lot of distance and covers no ground —
   exactly the signature CHOP is built to detect. But underneath, leadership
   is clean and breakouts in the receiving group follow through perfectly
   well. Raw CHOP would tell you to stand down on a day that pays.

   The distinguishing evidence is dispersion. In real chop nothing is
   winning: breadth sits pinned near the middle and new highs roughly equal
   new lows. In rotation, breadth and the high/low line both skew.

   The math, the band presets and the zone vocabulary all live in
   @/lib/indicators/chopMarket now. They used to live here, with cut-down
   copies in AnalystBrief and the briefing email that carried a smaller
   modifier cap and, in both cases, no high/low term at all — so the three
   surfaces printed three different numbers from one payload. */

/* A 14-day Choppiness Index moves in tenths of a point per session — the
   first live reading shifted 0.25 day-over-day. The original 0.5 dead-band
   was borrowed from the A/D strip, where the underlying ratio genuinely
   swings intraday, and applied to a metric with an order of magnitude less
   daily velocity. It would have printed flat every session. */

/* The QQQ/SPY spread is the rotation tell. 6 points is roughly where the two
   benchmarks stop describing the same market. Tooltip wording only. */

/* How far apart the daily and intraday readings must sit before the gap is
   called a divergence rather than noise. 8 points is a little over half the
   width of the MIXED band at AS IS — wide enough that the two timeframes are
   genuinely disagreeing, narrow enough to catch a break on the session it
   starts. */

/* The intraday reading is only interesting while it is current. Past this
   the marker still renders — a Friday-afternoon reading is real information
   on a Sunday — but it is dimmed and labelled rather than left to imply it
   is live. */

/* The bar marker is the one chop colour that stays local: it is a three-state
   position indicator on a gradient, not the six-tier zone palette. */
const chopMarkerBg = (v: number | null, b: ChopBands): string => {
  if (v == null) return 'bg-slate-500';
  if (v >= b.chop) return 'bg-amber-400';
  if (v <= b.trend) return 'bg-emerald-400';
  return 'bg-slate-300';
};

const chopStripStyle = (v: number | null, b: ChopBands): string => {
  if (v == null) return 'border-white/5 bg-[#161c2a]/40';
  if (v >= b.chop) return 'border-amber-500/20 bg-amber-500/[0.04]';
  if (v <= b.trend) return 'border-emerald-500/20 bg-emerald-500/[0.04]';
  return 'border-white/5 bg-[#161c2a]/40';
};

/* One line, tooltip only. This is the only place the chop reading gives an
   instruction — the strip itself is measurement, the same split the tone
   narrative uses. */





// Builds a data-driven market-tone read straight from the live quotes and
// breadth internals — no AI call, so it costs nothing and updates every
// refresh with the actual numbers. Sentences are newline-separated so the
// card can render one per line.
const buildToneNarrative = (
  q: Record<string, TickData>,
  breadth: BreadthData | null,
  session: MarketSession,
  t2108: T2108Data | null
): string => {
  const pct = (id: string): number | null => (q[id] && q[id].synced ? q[id].pct : null);
  const fmt = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

  const spy = pct('SPY');
  const qqq = pct('QQQ');
  if (spy === null || qqq === null) return '';

  const names: Record<string, string> = { SPY: 'S&P', QQQ: 'Nasdaq', DIA: 'Dow', IWM: 'small caps' };
  const idx = (['SPY', 'QQQ', 'DIA', 'IWM'])
    .map((id) => ({ id, v: pct(id) }))
    .filter((e): e is { id: string; v: number } => e.v !== null);

  const up = idx.filter((e) => e.v > 0.05).length;
  const down = idx.filter((e) => e.v < -0.05).length;

  const lead =
    session === 'Closed' ? 'At the close: ' :
    session === 'Pre-Market' ? 'Pre-market: ' :
    session === 'Post-Market' ? 'After hours: ' : '';

  // ---- 1. TAPE
  let s1 = '';
  if (down === 0 && up >= 2) {
    s1 = `${lead}Broadly higher | S&P ${fmt(spy)} | Nasdaq ${fmt(qqq)}.`;
  } else if (up === 0 && down >= 2) {
    s1 = `${lead}Broadly lower | S&P ${fmt(spy)} | Nasdaq ${fmt(qqq)}.`;
  } else if (idx.length >= 2) {
    const leader = idx.reduce((a, b) => (b.v > a.v ? b : a));
    const laggard = idx.reduce((a, b) => (b.v < a.v ? b : a));
    s1 = `${lead}Mixed | ${names[leader.id]} ${fmt(leader.v)} leads | ${names[laggard.id]} ${fmt(laggard.v)} lags. Rotation, not direction.`;
  }

  // ---- 2. RISK
  const vix = pct('VIX');
  const tlt = pct('TLT');
  const gld = pct('GLD');
  const btc = pct('BTC');

  const riskBits: string[] = [];
  if (vix !== null) riskBits.push(`VIX ${fmt(vix)}`);
  if (btc !== null) riskBits.push(`Bitcoin ${fmt(btc)}`);
  if (tlt !== null && gld !== null && tlt > 0.1 && gld > 0.1) riskBits.push('bonds and gold bid');

  let s2 = '';
  if (riskBits.length) {
    const tail =
      vix !== null && vix >= 3 ? ' — fear rising' :
      vix !== null && vix <= -2 ? ' — vol crushing' :
      btc !== null && btc <= -2 ? ' — risk appetite fading' :
      btc !== null && btc >= 2 ? ' — risk appetite firm' :
      tlt !== null && gld !== null && tlt > 0.1 && gld > 0.1 ? ' — defensive bid' :
      '';
    s2 = riskBits.join(' | ') + tail + '.';
  }

  // ---- 3. INTERNALS — measurement only, no verdict
  const nh = breadth?.newHighs ?? 0;
  const nl = breadth?.newLows ?? 0;

  let s3 = '';
  if (breadth) {
    const bits: string[] = [
      `Breadth ${breadth.score}/6`,
      `${breadth.advancers.toLocaleString()} adv vs ${breadth.decliners.toLocaleString()} dec`,
    ];
    if (breadth.up4 >= 25 || breadth.down4 >= 25) {
      bits.push(`${breadth.up4} up 4%+`);
      bits.push(`${breadth.down4} down 4%+`);
    }
    if (nh > 0 || nl > 0) bits.push(`${nh} highs vs ${nl} lows`);
    s3 = bits.join(' · ') + '.';
  }

  // ---- 4. VERDICT — the only line that tells you what to do
  const hlRatio = nl > 0 ? nh / nl : (nh > 0 ? Infinity : 0);
  const hlCall =
    (nh === 0 && nl === 0) ? 'No structural read — trade the setup, not the tape.' :
    hlRatio >= 2.0 ? 'Structural strength — breakouts have participation behind them.' :
    hlRatio >= 1.2 ? 'Leaning constructive, but not enough to chase extension.' :
    hlRatio >= 0.8 ? 'Index-level move, not broad — stay selective.' :
    hlRatio >= 0.5 ? 'More names breaking down than up — favour pullbacks over breakouts.' :
    'Structurally weak underneath — tighten stops, hunt reversals.';

  let s4 = '';
  const t = t2108?.value ?? null;
  if (t != null) {
    const regime =
      t <= 10 ? 'washed out' :
      t <= 20 ? 'deeply oversold' :
      t <= 35 ? 'oversold' :
      t >= 85 ? 'frothy' :
      t >= 70 ? 'extended' :
      'neutral';
    const action =
      t <= 10 ? 'Mean reversion pays here — hunt reversals, not breakouts.' :
      t <= 20 ? 'Reversals have the edge; breakouts into this tape fail.' :
      t <= 35 ? 'Favour pullback entries over chasing strength.' :
      t >= 85 ? 'Tighten stops — breakouts fail more often from here.' :
      t >= 70 ? 'Broad but late; the easy part of the move is behind us.' :
      hlCall;
    s4 = `T2108 | ${t.toFixed(0)} — ${regime}. ${action}`;
  } else if (nh > 0 || nl > 0) {
    s4 = hlCall;
  }

  return [s1, s2, s3, s4].filter(Boolean).join('\n');
};

/* ============================================================
   Tone narrative renderer — badges asset names, colors percents
   (VIX-aware), breadth scores, and the internals counts.

   ORDER IN THE REGEX IS LOAD-BEARING. "VIX +1.05%" has to match as
   one unit before the bare "VIX" and bare-percent alternatives get
   a chance, because a VIX percent is colour-INVERTED — up is red.
   Split into two tokens it would render green and say the opposite
   of what it means.
   ============================================================ */

const nameChipCls = "inline-block align-baseline text-[10px] font-bold text-slate-300 bg-slate-500/10 px-1.5 py-[1px] rounded border border-white/10 tracking-wider mx-0.5";
const valNum = "text-[12px] tabular-nums";

const renderToneText = (text: string): React.ReactNode[] => {
  const rx = /(VIX [+-]\d+(?:\.\d+)?%|T2108 \| \d+(?:\.\d+)?|S&P|Nasdaq|Dow|Bitcoin|VIX|[+-]\d+(?:\.\d+)?%|[Bb]readth \d\/6|[\d,]+ adv\b|[\d,]+ dec\b|\d+ (?:up|down) 4%\+|[\d,]+ highs|[\d,]+ lows)/g;
  const parts = text.split(rx);

  return parts.map((part, i) => {
    if (!part) return null;

    let m = part.match(/^VIX ([+-]\d+(?:\.\d+)?%)$/);
    if (m) {
      const v = parseFloat(m[1]);
      const cls = v > 0 ? 'text-rose-400' : 'text-emerald-400';
      return (
        <span key={i}>
          <span className={nameChipCls}>VIX</span>
          <span className={`${valNum} ${cls}`}>{m[1]}</span>
        </span>
      );
    }

    m = part.match(/^T2108 \| (\d+(?:\.\d+)?)$/);
    if (m) {
      const v = parseFloat(m[1]);
      return (
        <span key={i}>
          <span className={nameChipCls}>T2108</span>
          <span className={`${valNum} ${t2108Color(v)}`}>{m[1]}</span>
        </span>
      );
    }

    if (part === 'S&P' || part === 'Nasdaq' || part === 'Dow' || part === 'Bitcoin' || part === 'VIX') {
      return <span key={i} className={nameChipCls}>{part}</span>;
    }

    if (/^[+]\d+(?:\.\d+)?%$/.test(part)) {
      return <span key={i} className={`${valNum} text-emerald-400`}>{part}</span>;
    }
    if (/^-\d+(?:\.\d+)?%$/.test(part)) {
      return <span key={i} className={`${valNum} text-rose-400`}>{part}</span>;
    }

    m = part.match(/^([Bb]readth) (\d)\/6$/);
    if (m) {
      const s = parseInt(m[2], 10);
      const cls = s >= 5 ? 'text-emerald-400' : s <= 1 ? 'text-rose-400' : 'text-amber-400';
      return <span key={i}>{m[1]} <span className={`${valNum} ${cls}`}>{m[2]}/6</span></span>;
    }

    m = part.match(/^([\d,]+) adv$/);
    if (m) return <span key={i}><span className={`${valNum} text-emerald-400`}>{m[1]}</span> adv</span>;
    m = part.match(/^([\d,]+) dec$/);
    if (m) return <span key={i}><span className={`${valNum} text-rose-400`}>{m[1]}</span> dec</span>;

    m = part.match(/^(\d+) (up|down) 4%\+$/);
    if (m) {
      const cls = m[2] === 'up' ? 'text-emerald-400' : 'text-rose-400';
      return <span key={i}><span className={`${valNum} ${cls}`}>{m[1]}</span> {m[2]} <span className={`${valNum} ${cls}`}>4%+</span></span>;
    }

    m = part.match(/^([\d,]+) highs$/);
    if (m) return <span key={i}><span className={`${valNum} text-emerald-400`}>{m[1]}</span> highs</span>;
    m = part.match(/^([\d,]+) lows$/);
    if (m) return <span key={i}><span className={`${valNum} text-rose-400`}>{m[1]}</span> lows</span>;

    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
};

/* ---- Proportional bar ----------------------------------------------------
   A/D and ATHI/ATLO render through this. It is NOT the CHOP track and must
   not become it — see the v1.9 header. The fill boundary is the data; the
   gradient only adds depth WITHIN each side so the two bar families share a
   look without sharing an encoding.

   `pct` is the left (green) share, 0-100.

   The red base spans the full width and the green fill overlays the left
   portion, so the visible red always runs from the boundary to the right
   edge and deepens as it goes — regardless of where the boundary falls. */
const ProportionalBar = ({
  pct,
  title,
  leftTitle,
  rightTitle,
}: {
  pct: number;
  title?: string;
  leftTitle?: string;
  rightTitle?: string;
}) => (
  <div
    className="flex-1 relative min-w-[60px] h-1.5 rounded-full overflow-visible"
    title={title}
  >
    {/* Base: the declining side, deepening toward its own edge. */}
    <div className="absolute inset-0 rounded-full overflow-hidden bg-gradient-to-r from-rose-500/35 to-rose-500/75">
      {/* Fill: the advancing side, deepening toward its own edge. Width is
          the actual proportion — this is the measurement. */}
      <div
        className="h-full bg-gradient-to-r from-emerald-400/90 to-emerald-400/45 transition-all duration-500"
        style={{ width: `${pct}%` }}
        title={leftTitle}
      ></div>
    </div>

    {/* Threshold ticks — where the badge changes colour. Previously invisible;
        drawing them shows how close the tape is to flipping rather than only
        reporting it after it has. */}
    <div
      className="absolute top-[-2px] h-[9px] w-px bg-white/20 pointer-events-none"
      style={{ left: `${BREADTH_TICK_LOW}%` }}
      title={`${BREADTH_TICK_LOW}% — below this the tape reads as sellers in control`}
    ></div>
    <div
      className="absolute top-[-2px] h-[9px] w-px bg-white/20 pointer-events-none"
      style={{ left: `${BREADTH_TICK_HIGH}%` }}
      title={`${BREADTH_TICK_HIGH}% — above this the tape reads as buyers in control`}
    ></div>

    {/* Boundary marker, matching the CHOP marker treatment. Ties the bar to
        the percentage badge at the end of the row. */}
    <div
      className="absolute top-[-3px] h-[11px] w-[2px] rounded-sm bg-slate-100 shadow-[0_0_4px_rgba(255,255,255,0.35)] transition-all duration-500 pointer-events-none"
      style={{ left: `calc(${pct}% - 1px)` }}
      title={rightTitle}
    ></div>
  </div>
);

export default function MacroScorecard() {
  const [quotes, setQuotes] = useState<Record<string, TickData>>({});
  const [stockStatus, setStockStatus] = useState<'CONNECTING' | 'LIVE' | 'ERROR' | 'AUTH_ERROR'>('CONNECTING');
  const [session, setSession] = useState<MarketSession>('Closed');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // riskMode removed — tone and breadth badges cover the same ground
  const [marketTone, setMarketTone] = useState<'BULLISH' | 'NEUTRAL' | 'BEARISH'>('NEUTRAL');
  const [breadth, setBreadth] = useState<BreadthData | null>(null);
  const [t2108, setT2108] = useState<T2108Data | null>(null);
  const [chop, setChop] = useState<ChopData | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(true);

  /* NOT PERSISTED, deliberately. A saved sensitivity would mean opening the
     dashboard on Monday to a reading whose thresholds you set on Thursday
     for a reason you no longer remember — and since the setting changes what
     the words mean rather than which rows appear, a forgotten one is
     invisible until it misleads. Defaulting to AS IS every session means the
     number always starts at the textbook interpretation. */
  /* Persisted server-side so the briefing email reads the same bands the
     dashboard is showing — see /api/settings/chop. */
  const [chopMode, setChopModeState] = useState<ChopMode>('extreme');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/settings/chop')
      .then((r) => r.json())
      .then((d) => { if (!cancelled && d?.mode) setChopModeState(d.mode); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const setChopMode = useCallback((m: ChopMode) => {
    setChopModeState(m);
    fetch('/api/settings/chop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: m }),
    }).catch(() => {});
  }, []);

  // A/D trend: the feed only sends current counts, so direction is derived by
  // comparing the incoming ratio against the previous poll. Flat until the
  // move clears 1%, so tiny jitter doesn't flip the arrow every minute.
  const [adTrend, setAdTrend] = useState<'up' | 'down' | 'flat'>('flat');
  const prevAdRatio = useRef<number | null>(null);
  const [hlTrend, setHlTrend] = useState<'up' | 'down' | 'flat'>('flat');
  const prevHlRatio = useRef<number | null>(null);

  const cryptoWs = useRef<WebSocket | null>(null);

  // --- ENGINE 1: AUTO-MACRO SENTIMENT ALGO ---
  useEffect(() => {
    if (!quotes['SPY'] || !quotes['QQQ'] || !quotes['VIX']) return;

    const getPct = (id: string) => quotes[id]?.pct || 0;

    // Equities are the PRIMARY tape signal. VIX only confirms/tempers — a normal
    // uptick in VIX on a green day must NOT flip the read bearish, which the old
    // -3.0 weight did (it could swamp SPY+QQQ entirely). So VIX is lightly
    // weighted and ignored inside a small dead-band; only a genuine spike/crush
    // moves tone. Crypto is a minor risk-appetite tell.
    const eqScore = (getPct('SPY') * 3.0) + (getPct('QQQ') * 2.5) + (getPct('IWM') * 1.0);
    const vixPct = getPct('VIX');
    const volScore = Math.abs(vixPct) > 2 ? (vixPct * -0.6) : 0;
    const cryptoScore = (getPct('BTC') * 0.25);

    const breadthAdj = breadth ? ((breadth.score - 3) / 3) * 1.5 : 0;

    // Neither T2108 nor CHOP is folded into tone. T2108 is a MEAN-REVERSION
    // gauge and CHOP is a REGIME gauge — neither is directional. A washed-out
    // 15 is bearish today and bullish for what comes next; a CHOP of 75 says
    // nothing about which way. Blending either into a single bull/bear score
    // destroys exactly the information it carries. Both get their own strip.
    const totalScore = eqScore + volScore + cryptoScore + breadthAdj;

    if (totalScore >= 1.0) {
      setMarketTone('BULLISH');
    } else if (totalScore <= -1.0) {
      setMarketTone('BEARISH');
    } else {
      setMarketTone('NEUTRAL');
    }
  }, [quotes, breadth]);

  // --- A/D DIRECTION: compare each new ratio against the last one ---
  useEffect(() => {
    if (!breadth || breadth.decliners <= 0) return;
    const ratio = breadth.advancers / breadth.decliners;
    const prev = prevAdRatio.current;

    if (prev != null && prev > 0) {
      const delta = (ratio - prev) / prev;
      if (delta > 0.01) setAdTrend('up');
      else if (delta < -0.01) setAdTrend('down');
      // inside the dead-band: hold the previous arrow rather than flickering
    }
    prevAdRatio.current = ratio;
  }, [breadth]);

  // --- ATHI/ATLO DIRECTION: compare each new H/L ratio against the last one ---
  useEffect(() => {
    const nh = breadth?.newHighs ?? 0;
    const nl = breadth?.newLows ?? 0;
    if (nh === 0 && nl === 0) return;
    const ratio = nl > 0 ? nh / nl : (nh > 0 ? 999 : 1);
    const prev = prevHlRatio.current;

    if (prev != null && prev > 0) {
      const delta = (ratio - prev) / prev;
      if (delta > 0.01) setHlTrend('up');
      else if (delta < -0.01) setHlTrend('down');
    }
    prevHlRatio.current = ratio;
  }, [breadth]);

  // --- ENGINE 2: SERVER-CACHED MACRO QUOTES ---
  useEffect(() => {
    let isMounted = true;

    const fetchMacro = async () => {
      try {
        const res = await fetch('/api/macro', { cache: 'no-store' });
        if (!res.ok) {
          if (isMounted) setStockStatus('ERROR');
          return;
        }
        const data = await res.json();
        if (!isMounted || !data || !data.quotes) return;

        setSession(getMarketSession());
        setLastUpdated(new Date());
        setStockStatus('LIVE');

        if (data.breadth && typeof data.breadth.score === 'number') setBreadth(data.breadth);

        setQuotes(prev => {
          const next = { ...prev };
          Object.entries<any>(data.quotes).forEach(([id, v]) => {
            const prevQuote = prev[id];
            let direction: 'up' | 'down' | 'flat' = prevQuote?.tickDirection || 'flat';
            if (prevQuote && v.price > prevQuote.price) direction = 'up';
            else if (prevQuote && v.price < prevQuote.price) direction = 'down';

            next[id] = {
              price: v.price,
              baseline: v.baseline,
              pct: v.pct,
              tickDirection: direction,
              synced: true,
              isExtended: v.isExtended
            };
          });
          return next;
        });
      } catch (err) {
        if (isMounted) setStockStatus('ERROR');
      }
    };

    fetchMacro();

    const pollingInterval = setInterval(() => {
      if (isMounted) fetchMacro();
    }, 60000);

    return () => {
      isMounted = false;
      clearInterval(pollingInterval);
    };
  }, []);

  // --- ENGINE 2b: T2108 ---
  // Written by the swing-candidates scan, which runs on its own schedule.
  // Polls every 5 min — this is a slow-moving daily-bar metric, not a tick.
  useEffect(() => {
    let isMounted = true;

    const fetchT2108 = async () => {
      try {
        const res = await fetch('/api/t2108/latest', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (isMounted && data && data.success) {
          setT2108({
            value: data.value ?? null,
            zone: data.zone ?? 'unknown',
            above: data.above ?? null,
            total: data.total ?? null,
            updatedAt: data.updatedAt ?? null,
          });
        }
      } catch {
        // Silent — T2108 missing just leaves the card in its unsynced state.
      }
    };

    fetchT2108();
    const interval = setInterval(() => { if (isMounted) fetchT2108(); }, 300000);
    return () => { isMounted = false; clearInterval(interval); };
  }, []);

  // --- ENGINE 2c: CHOP ---
  /* Polls every 5 minutes. The route caches the daily leg for 15 and the
     intraday leg for one bar period, so most of these return cached numbers —
     the poll exists to pick up a new intraday bar reasonably soon after it
     closes rather than to drive recomputation.

     READS THE NESTED v1.2 SHAPE WITH A FLAT FALLBACK. Route v1.2 emits both
     `daily.blended` and a top-level `blended`, so this component could adopt
     the intraday leg without the two having to deploy together. Reading the
     flat fields as the fallback means an older cached payload still renders
     the daily track and simply omits the intraday one. */
  useEffect(() => {
    let isMounted = true;

    const fetchChop = async () => {
      try {
        const res = await fetch('/api/chop', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (isMounted && data && data.success) {
          const d = data.daily ?? {};
          const i = data.intraday ?? null;
          setChop({
            qqq: d.qqq ?? data.qqq ?? null,
            qqqPrev: d.qqqPrev ?? data.qqqPrev ?? null,
            spy: d.spy ?? data.spy ?? null,
            spyPrev: d.spyPrev ?? data.spyPrev ?? null,
            blended: d.blended ?? data.blended ?? null,
            blendedPrev: d.blendedPrev ?? data.blendedPrev ?? null,
            period: data.period ?? 14,
            updatedAt: data.updatedAt ?? null,
            intraday: i
              ? {
                  qqq: i.qqq ?? null,
                  spy: i.spy ?? null,
                  blended: i.blended ?? null,
                  lastBarAt: i.lastBarAt ?? null,
                  windowMinutes: i.windowMinutes ?? null,
                  barMinutes: i.barMinutes ?? null,
                  feedDelayMinutes: i.feedDelayMinutes ?? null,
                }
              : null,
          });
        }
      } catch {
        // Silent — no strip is better than a fabricated one.
      }
    };

    fetchChop();
    const interval = setInterval(() => { if (isMounted) fetchChop(); }, 300000);
    return () => { isMounted = false; clearInterval(interval); };
  }, []);

  // --- ENGINE 3: COINBASE WEBSOCKET (CRYPTO) ---
  useEffect(() => {
    let isMounted = true;
    const connectCoinbase = () => {
      if (cryptoWs.current && (cryptoWs.current.readyState === 0 || cryptoWs.current.readyState === 1)) return;

      const cWs = new WebSocket('wss://ws-feed.exchange.coinbase.com');
      cryptoWs.current = cWs;

      cWs.onopen = () => {
        if (!isMounted) return;
        const cryptoTickers = MACRO_ASSETS.filter(a => a.type === 'crypto').map(a => a.ws);
        cWs.send(JSON.stringify({
          type: 'subscribe',
          product_ids: cryptoTickers,
          channels: ['ticker']
        }));
      };

      cWs.onmessage = (event) => {
        if (!isMounted) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'ticker' && msg.product_id && msg.price) {
            const asset = MACRO_ASSETS.find(a => a.ws === msg.product_id && a.type === 'crypto');
            const currentPrice = parseFloat(msg.price);

            if (asset && currentPrice > 0) {
              setQuotes(prev => {
                const prevQuote = prev[asset.id];

                const msgOpen = msg.open_24h ? parseFloat(msg.open_24h) : 0;
                const baseline = msgOpen > 0 ? msgOpen : (prevQuote?.baseline || currentPrice);

                const pct = baseline > 0 ? ((currentPrice - baseline) / baseline) * 100 : 0;

                let direction: 'up' | 'down' | 'flat' = prevQuote?.tickDirection || 'flat';
                if (prevQuote && currentPrice > prevQuote.price) direction = 'up';
                else if (prevQuote && currentPrice < prevQuote.price) direction = 'down';

                return { ...prev, [asset.id]: { price: currentPrice, baseline, pct, tickDirection: direction, synced: true } };
              });
            }
          }
        } catch (e) {}
      };

      cWs.onclose = () => {
        if (isMounted) {
          setTimeout(connectCoinbase, 3000);
        }
      };
    };

    connectCoinbase();

    return () => {
      isMounted = false;
      if (cryptoWs.current) {
        cryptoWs.current.onclose = null;
        cryptoWs.current.close();
      }
    };
  }, []);

  const getSessionTextColor = () => {
    if (session === 'Pre-Market') return 'text-amber-500';
    if (session === 'Open') return 'text-[#00e676]';
    if (session === 'Post-Market') return 'text-indigo-400';
    return 'text-slate-500';
  };

  const getToneStyles = () => {
    if (marketTone === 'BULLISH') return { border: 'border-emerald-500/20', bg: 'bg-emerald-500/[0.04]', label: 'text-emerald-400', dot: 'bg-emerald-400' };
    if (marketTone === 'BEARISH') return { border: 'border-rose-500/20', bg: 'bg-rose-500/[0.04]', label: 'text-rose-400', dot: 'bg-rose-400' };
    return { border: 'border-amber-500/20', bg: 'bg-amber-500/[0.04]', label: 'text-amber-400', dot: 'bg-amber-400' };
  };

  const narrative = buildToneNarrative(quotes, breadth, session, t2108);
  const toneStyles = getToneStyles();

  // Advance/decline share for the internals bar (0-100)
  const adTotal = breadth ? breadth.advancers + breadth.decliners : 0;
  const advPct = breadth && adTotal > 0 ? (breadth.advancers / adTotal) * 100 : 50;
  const hlTotal = breadth ? (breadth.newHighs ?? 0) + (breadth.newLows ?? 0) : 0;
  const highsPct = breadth && hlTotal > 0 ? ((breadth.newHighs ?? 0) / hlTotal) * 100 : 50;

  const breadthPctColor = (v: number) => v >= 60 ? 'text-emerald-400' : v <= 40 ? 'text-rose-400' : 'text-amber-400';
  const breadthPctBg = (v: number) => v >= 60 ? 'bg-emerald-500/10 border-emerald-500/20' : v <= 40 ? 'bg-rose-500/10 border-rose-500/20' : 'bg-amber-500/10 border-amber-500/20';

  const tVal = t2108?.value ?? null;
  const tStyle = t2108CardStyle(tVal);

  // --- CHOP derived values ---
  const bands = CHOP_BANDS[chopMode];

  /* THE DELTA COMES FROM RAW, NOT FROM TWO COMPOSITES. v1.3 ran both the
     current and the previous reading through chopComposite, which looked
     rigorous and was not: only today's breadth exists in state, so the same
     modifier was added to both sides and cancelled exactly in the
     subtraction. The arrow was tracking raw movement while the code claimed
     otherwise. Raw-to-raw is the comparison actually available. */
  const chopRaw = chop?.blended ?? null;
  const chopRawPrev = chop?.blendedPrev ?? null;
  const chopVal = chopComposite(chopRaw, breadth);
  const chopDelta = chopRaw != null && chopRawPrev != null ? chopRaw - chopRawPrev : null;
  const chopTrend: 'up' | 'down' | 'flat' =
    chopDelta == null ? 'flat'
      : chopDelta > CHOP_TREND_BAND ? 'up'
      : chopDelta < -CHOP_TREND_BAND ? 'down'
      : 'flat';

  /* The intraday leg is RAW — see the note on chopComposite. */
  const intraVal = chop?.intraday?.blended ?? null;
  const intraLastBar = chop?.intraday?.lastBarAt ?? null;
  const intraAgeMin = intraLastBar
    ? (Date.now() - new Date(intraLastBar).getTime()) / 60000
    : null;
  const intraStale = intraAgeMin != null && intraAgeMin > INTRADAY_STALE_MINUTES;

  const divergence = divergenceOf(chopVal, intraVal, bands);

  const chopTooltipText = chopVal == null ? '' : [
    `CHOP ${chopVal.toFixed(0)} — ${chopZoneLabel(chopVal, bands)}   [${bands.label}]`,
    '',
    bands.blurb,
    '',
    `Daily (${chop?.period ?? 14} × 1d): QQQ ${chop?.qqq != null ? chop.qqq.toFixed(1) : '—'}, SPY ${chop?.spy != null ? chop.spy.toFixed(1) : '—'}, blended ${chopRaw != null ? chopRaw.toFixed(1) : '—'}`,
    `Adjusted ${chopRaw != null && chopVal - chopRaw >= 0 ? '+' : ''}${chopRaw != null ? (chopVal - chopRaw).toFixed(1) : '0'} by breadth centrality and high/low balance.`,
    chopSpreadNote(chop?.qqq ?? null, chop?.spy ?? null),
    intraVal != null
      ? `\nIntraday (${chop?.intraday?.windowMinutes ?? 210} min): ${intraVal.toFixed(1)} — ${chopZoneLabel(intraVal, bands)}. Raw, unadjusted.` +
        `\nNewest closed bar ${formatClockShort(intraLastBar)} EST` +
        (chop?.intraday?.feedDelayMinutes ? ` · feed is ${chop.intraday.feedDelayMinutes}-min delayed` : '') +
        (intraStale ? '\nThis reading is not current — it describes the last session that traded.' : '')
      : '\nIntraday leg unavailable — the strip is showing the daily reading only.',
    divergence.label ? `\n${divergence.label} — ${divergence.detail}` : '',
    '',
    chopAllBandsNote(chopVal, chopMode),
    '',
    chopVerdict(chopVal, bands),
  ].filter(Boolean).join('\n');

  return (
    <div className="bg-[#101623] border-0 md:border md:border-white/10 md:rounded-2xl p-2 md:p-8 relative overflow-hidden md:shadow-xl">

      <div className="absolute right-0 top-0 w-64 h-64 bg-indigo-500/5 blur-3xl rounded-full -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>

      {/* HEADER CONTAINER */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className={`relative z-10 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-6 border-b border-white/5 pb-4' : ''}`}
      >
        <div className="flex justify-between items-center">
          <span className="text-xs md:text-sm font-bold text-[#7c8bfa] bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 group-hover:bg-white/[0.02] transition-colors shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
            MACRO SCORECARD
          </span>

          <div className="flex flex-col items-center gap-1.5">
            <div className="flex items-center justify-center border border-white/5 bg-[#161c2a]/40 px-4 py-1.5 rounded-[10px] min-w-[120px]">
              <span className={`text-[10px] font-bold tracking-widest uppercase ${stockStatus === 'LIVE' ? getSessionTextColor() : 'text-slate-500'}`}>
                {stockStatus === 'LIVE' ? session : stockStatus === 'CONNECTING' ? 'Scouting...' : 'Offline'}
              </span>
            </div>
            {lastUpdated && (
               <span className="text-[11px] text-slate-400/80 font-medium px-1 tracking-wide">
                 Updated: {formatTime(lastUpdated)} EST
               </span>
            )}
          </div>
        </div>

        <div onClick={(e) => e.stopPropagation()} className="mt-2 md:overflow-x-auto" style={{ scrollbarWidth: 'none' } as React.CSSProperties}>
          <BenchmarkStrips />
        </div>
      </div>

      {/* COLLAPSIBLE CONTENT */}
      {isExpanded && (
        <>
          <MacroScorecardPanel
            marketTone={marketTone}
            quotes={quotes}
            breadth={breadth}
            tVal={tVal}
            chop={chop}
            chopVal={chopVal}
            chopRaw={chopRaw}
            chopDelta={chopDelta}
            chopTrend={chopTrend}
            adTrend={adTrend}
            hlTrend={hlTrend}
            advPct={advPct}
            highsPct={highsPct}
            intraVal={intraVal}
            intraStale={intraStale}
            intraLastBar={intraLastBar}
            chopTooltipText={chopTooltipText}
            chopMode={chopMode}
            setChopMode={setChopMode}
            bands={bands}
            divergence={divergence}
          />

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4 relative z-10">
            {MACRO_ASSETS.map((asset) => {
              const q = quotes[asset.id];

              if (!q || !q.synced || q.price === 0) {
                return (
                  <div key={asset.id} className="bg-[#161c2a]/60 border border-white/5 rounded-xl p-4 flex flex-col justify-between h-24 opacity-60">
                    <div className="flex justify-between items-start">
                      <span className="text-sm font-bold text-slate-300">{asset.id}</span>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{asset.name}</span>
                    </div>
                    <div className="flex flex-col mt-2">
                      <span className="text-sm font-medium text-slate-500 animate-pulse">Syncing...</span>
                    </div>
                  </div>
                );
              }

              const pct = q.pct || 0;
              const isMathPositive = pct >= 0;

              // Invert VIX color logic: Drop = Green (Bullish), Spike = Red (Bearish)
              const isBullish = asset.id === 'VIX' ? pct <= 0 : pct >= 0;

              const cardBg = isBullish ? 'bg-emerald-950/10' : 'bg-rose-950/10';
              const cardBorder = isBullish ? 'border-emerald-500/20' : 'border-rose-500/20';

              let tickColor = 'text-slate-100';
              if (q.tickDirection === 'up') {
                tickColor = asset.id === 'VIX' ? 'text-rose-300' : 'text-emerald-300';
              } else if (q.tickDirection === 'down') {
                tickColor = asset.id === 'VIX' ? 'text-emerald-300' : 'text-rose-300';
              }

              return (
                <TickerChartHover key={asset.id} symbol={asset.chart}>
                <div className={`rounded-xl p-4 flex flex-col justify-between h-24 transition-colors duration-300 border ${cardBg} ${cardBorder} hover:bg-white/[0.02] shadow-sm`}>

                  <div className="flex justify-between items-start">
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-slate-200">{asset.id}</span>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 truncate max-w-[90px]">
                        {asset.name}
                      </span>
                    </div>

                    <div className="flex flex-col items-end">
                      <span className={`text-[10px] font-bold tracking-wide px-1.5 py-0.5 rounded ${isBullish ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                        {isMathPositive ? '+' : ''}{pct.toFixed(2)}%
                      </span>
                      {q.isExtended && (
                        <span className="text-[8px] font-bold text-amber-500/80 tracking-wider mt-1 uppercase">
                          {session === 'Pre-Market' ? 'PRE' : 'POST'}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-end justify-between mt-2">
                    <span className={`text-2xl font-semibold tracking-tight transition-colors duration-200 ${tickColor}`}>
                      {asset.type === 'crypto' && q.price > 100 ? q.price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : q.price.toFixed(2)}
                    </span>
                    {q.isExtended && session === 'Pre-Market' && q.baseline > 0 && (
                      <span className="text-[9px] text-slate-500 font-medium">
                        Prev {q.baseline.toFixed(2)}
                      </span>
                    )}
                  </div>

                </div>
                </TickerChartHover>
              );
            })}

            {/* T2108 — the twelfth card. Not a price, so it renders a regime
                label where the others show a percent change. */}
            {tVal == null ? (
              <div className="bg-[#161c2a]/60 border border-white/5 rounded-xl p-4 flex flex-col justify-between h-24 opacity-60">
                <div className="flex justify-between items-start">
                  <span className="text-sm font-bold text-slate-300">T2108</span>
                  <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">% Above 40 MA</span>
                </div>
                <div className="flex flex-col mt-2">
                  <span className="text-sm font-medium text-slate-500 animate-pulse">Awaiting scan…</span>
                </div>
              </div>
            ) : (
              <div
                className={`rounded-xl p-4 flex flex-col justify-between h-24 transition-colors duration-300 border ${tStyle.bg} ${tStyle.border} hover:bg-white/[0.02] shadow-sm`}
                title={`T2108 — ${t2108?.above?.toLocaleString() ?? '?'} of ${t2108?.total?.toLocaleString() ?? '?'} scanned names are above their own 40-day MA.\n\nBelow 20: washed out, favour reversals.\nAbove 80: frothy, breakouts start failing.\n\nComputed across the full scanned universe rather than NYSE only, so it runs a few points off the official print.`}
              >
                <div className="flex justify-between items-start">
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-slate-200">T2108</span>
                    <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 truncate max-w-[90px]">
                      % Above 40 MA
                    </span>
                  </div>

                  <div className="flex flex-col items-end">
                    <span className={`text-[10px] font-bold tracking-wide px-1.5 py-0.5 rounded ${
                      tVal <= 20 ? 'bg-emerald-500/10 text-emerald-400'
                      : tVal <= 35 ? 'bg-lime-500/10 text-lime-400'
                      : tVal <= 65 ? 'bg-slate-500/10 text-slate-300'
                      : tVal <= 80 ? 'bg-amber-500/10 text-amber-400'
                      : 'bg-rose-500/10 text-rose-400'
                    }`}>
                      {t2108ZoneLabel(tVal, t2108?.zone ?? '')}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col items-start mt-2">
                  <span className={`text-2xl font-semibold tracking-tight transition-colors duration-200 ${t2108Color(tVal)}`}>
                    {tVal.toFixed(0)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
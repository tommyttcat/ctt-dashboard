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

import React, { useEffect, useState, useRef } from 'react';

// Unified Asset Dictionary
const MACRO_ASSETS = [
  { id: 'SPY', fmp: 'SPY', ws: 'SPY', name: 'S&P 500', type: 'stock' },
  { id: 'QQQ', fmp: 'QQQ', ws: 'QQQ', name: 'Nasdaq 100', type: 'stock' },
  { id: 'DIA', fmp: 'DIA', ws: 'DIA', name: 'Dow Jones', type: 'stock' },
  { id: 'IWM', fmp: 'IWM', ws: 'IWM', name: 'Russell 2000', type: 'stock' },
  { id: 'VIX', fmp: '^VIX', ws: 'VIX', name: 'VIX Index', type: 'stock' },
  { id: 'TLT', fmp: 'TLT', ws: 'TLT', name: '20Y Treasury', type: 'stock' },
  { id: 'GLD', fmp: 'GLD', ws: 'GLD', name: 'Gold ETF', type: 'stock' },
  { id: 'SLV', fmp: 'SLV', ws: 'SLV', name: 'Silver ETF', type: 'stock' },
  { id: 'USO', fmp: 'USO', ws: 'USO', name: 'Crude Oil', type: 'stock' },
  { id: 'BTC', fmp: 'BTCUSD', ws: 'BTC-USD', name: 'Bitcoin', type: 'crypto' },
  { id: 'ETH', fmp: 'ETHUSD', ws: 'ETH-USD', name: 'Ethereum', type: 'crypto' }
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
const getMarketSession = (): MarketSession => {
  const estDate = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = estDate.getDay();
  const timeStr = estDate.getHours() + estDate.getMinutes() / 60;
  if (day === 0 || day === 6) return 'Closed';
  if (timeStr >= 4 && timeStr < 9.5) return 'Pre-Market';
  if (timeStr >= 9.5 && timeStr < 16) return 'Open';
  if (timeStr >= 16 && timeStr < 20) return 'Post-Market';
  return 'Closed';
};

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
type ChopMode = 'asis' | 'med' | 'strong';

interface ChopBands {
  chop: number;
  trend: number;
  dead: number;
  strongTrend: number;
  label: string;
  blurb: string;
}

const DEAD_OFFSET = 8;
const STRONG_TREND_OFFSET = 8;

const makeBands = (chop: number, trend: number, label: string, blurb: string): ChopBands => ({
  chop,
  trend,
  dead: chop + DEAD_OFFSET,
  strongTrend: trend - STRONG_TREND_OFFSET,
  label,
  blurb,
});

const CHOP_BANDS: Record<ChopMode, ChopBands> = {
  asis: makeBands(
    61.8,
    38.2,
    'AS IS',
    'Textbook Fibonacci bands — 61.8 and 38.2, the thresholds the Choppiness Index shipped with. Conventional rather than derived.'
  ),
  med: makeBands(
    55,
    33,
    'MED',
    'Chop called at 55. On a 14-bar window that is roughly where price has travelled more than three times the ground it covered — the practical signature of a range handing back its moves.'
  ),
  strong: makeBands(
    50,
    28,
    'STRONG',
    'Chop called at dead centre. Above 50 the tape spends more effort than it gains, so anything not decisively directional reads as chop. Expect CHOPPY most days.'
  ),
};

const CHOP_MODES: ChopMode[] = ['asis', 'med', 'strong'];

/* ---- CHOP composite ------------------------------------------------------
   The route hands over raw Choppiness Index. The two modifiers below exist
   because raw CHOP on an index has one specific failure mode:

   A ROTATION TAPE SCORES AS CHOP. When money rotates out of one group and
   into another, the index travels a lot of distance and covers no ground —
   exactly the signature CHOP is built to detect. But underneath, leadership
   is clean and breakouts in the receiving group follow through perfectly
   well. Raw CHOP would tell you to stand down on a day that pays.

   The distinguishing evidence is dispersion. In real chop nothing is
   winning: breadth sits pinned near the middle and new highs roughly equal
   new lows. In rotation, breadth and the high/low line both skew.

   Both modifiers push the SAME direction: centred internals raise the score
   toward chop, skewed internals pull it back toward trend. Each is capped at
   +/-12, so together they can move the reading 24 points but never flip a
   decisive raw print. They arbitrate the middle, which is the only place the
   ambiguity lives.

   THE SENSITIVITY SETTING DOES NOT TOUCH THIS. The composite is the
   measurement; the bands are the interpretation. Letting the setting reach
   into the modifier weights would mean the number itself changed when you
   changed how you read it.

   IT IS ALSO NOT APPLIED TO THE INTRADAY LEG. Breadth and the high/low line
   are daily measures; using them to adjust a 3.5-hour reading would import
   three weeks of context into a number whose entire job is to be current. */
const CHOP_MODIFIER_CAP = 12;

const chopComposite = (raw: number | null, breadth: BreadthData | null): number | null => {
  if (raw == null) return null;

  let adj = 0;

  // Breadth centrality — 3/6 is dead centre and maximally uninformative.
  if (breadth && typeof breadth.score === 'number') {
    const centrality = 1 - Math.abs(breadth.score - 3) / 3;
    adj += (centrality - 0.5) * 2 * CHOP_MODIFIER_CAP;
  }

  // High/low balance — highs ~ lows is the structural signature of churn.
  const nh = breadth?.newHighs ?? 0;
  const nl = breadth?.newLows ?? 0;
  if (nh > 0 || nl > 0) {
    const highsShare = (nh / (nh + nl)) * 100;
    const balance = 1 - Math.abs(highsShare - 50) / 50;
    adj += (balance - 0.5) * 2 * CHOP_MODIFIER_CAP;
  }

  return Math.max(0, Math.min(100, raw + adj));
};

/* A 14-day Choppiness Index moves in tenths of a point per session — the
   first live reading shifted 0.25 day-over-day. The original 0.5 dead-band
   was borrowed from the A/D strip, where the underlying ratio genuinely
   swings intraday, and applied to a metric with an order of magnitude less
   daily velocity. It would have printed flat every session. */
const CHOP_TREND_BAND = 0.15;

/* The QQQ/SPY spread is the rotation tell. 6 points is roughly where the two
   benchmarks stop describing the same market. Tooltip wording only. */
const CHOP_SPREAD_NOTABLE = 6;

/* How far apart the daily and intraday readings must sit before the gap is
   called a divergence rather than noise. 8 points is a little over half the
   width of the MIXED band at AS IS — wide enough that the two timeframes are
   genuinely disagreeing, narrow enough to catch a break on the session it
   starts. */
const CHOP_DIVERGENCE_MIN = 8;

/* The intraday reading is only interesting while it is current. Past this
   the marker still renders — a Friday-afternoon reading is real information
   on a Sunday — but it is dimmed and labelled rather than left to imply it
   is live. */
const INTRADAY_STALE_MINUTES = 90;

const chopZoneLabel = (v: number | null, b: ChopBands): string => {
  if (v == null) return 'NO DATA';
  if (v >= b.dead) return 'DEAD CHOP';
  if (v >= b.chop) return 'CHOPPY';
  if (v > b.trend) return 'MIXED';
  if (v > b.strongTrend) return 'TRENDING';
  return 'STRONG TREND';
};

const chopColor = (v: number | null, b: ChopBands): string => {
  if (v == null) return 'text-slate-500';
  if (v >= b.dead) return 'text-rose-400';
  if (v >= b.chop) return 'text-amber-400';
  if (v > b.trend) return 'text-slate-300';
  if (v > b.strongTrend) return 'text-emerald-400';
  return 'text-teal-300';
};

const chopMarkerBg = (v: number | null, b: ChopBands): string => {
  if (v == null) return 'bg-slate-500';
  if (v >= b.chop) return 'bg-amber-400';
  if (v <= b.trend) return 'bg-emerald-400';
  return 'bg-slate-300';
};

const chopBadgeBg = (v: number | null, b: ChopBands): string => {
  if (v == null) return 'bg-slate-500/10 border-white/10';
  if (v >= b.dead) return 'bg-rose-500/10 border-rose-500/20';
  if (v >= b.chop) return 'bg-amber-500/10 border-amber-500/20';
  if (v > b.trend) return 'bg-slate-500/10 border-white/10';
  return 'bg-emerald-500/10 border-emerald-500/20';
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
const chopVerdict = (v: number | null, b: ChopBands): string => {
  if (v == null) return '';
  if (v >= b.dead) return 'Nothing is trending. Breakout triggers will fire and reverse — sit out or trade the range.';
  if (v >= b.chop) return 'Consolidation regime. Expect failed breakouts; favour reversals at range edges.';
  if (v > b.trend) return 'No clear regime edge. Setup quality has to carry the trade on its own.';
  if (v > b.strongTrend) return 'Trending tape. Breakouts have follow-through — triggers are worth taking.';
  return 'Strong trend. This is the regime breakout entries are built for.';
};

const chopSpreadNote = (qqq: number | null, spy: number | null): string => {
  if (qqq == null || spy == null) return '';
  const gap = spy - qqq;
  const abs = Math.abs(gap).toFixed(1);
  if (Math.abs(gap) < CHOP_SPREAD_NOTABLE) {
    return `Benchmark spread ${abs} pts — QQQ and SPY describe the same tape.`;
  }
  return gap > 0
    ? `Benchmark spread ${abs} pts — the Nasdaq is trending better than the broad market, which favours momentum names.`
    : `Benchmark spread ${abs} pts — the broad market is trending better than the Nasdaq; growth leadership is the weaker side.`;
};

/* Every setting's verdict on the current composite, so the active one can
   never hide what the others would say. A reading of 52 is MIXED at AS IS
   and CHOPPY at STRONG — seeing that disagreement is how you work out which
   setting you actually believe. */
const chopAllBandsNote = (v: number | null, active: ChopMode): string => {
  if (v == null) return '';
  const lines: string[] = ['Same reading, all three settings:'];
  for (const m of CHOP_MODES) {
    const b = CHOP_BANDS[m];
    const mark = m === active ? '▸' : ' ';
    lines.push(`${mark} ${b.label.padEnd(6)} ${chopZoneLabel(v, b).padEnd(13)} (chop ≥ ${b.chop}, trend ≤ ${b.trend})`);
  }
  return lines.join('\n');
};

/* ---- Divergence ----------------------------------------------------------
   The whole reason the intraday leg exists. Four states, and only one of
   them is a call to act.

   SIGN CONVENTION: positive gap means the DAILY reading is higher — the
   three-week backdrop is choppier than the last few hours. That is the
   range-starting-to-break case, so the interesting direction is positive. */
interface DivergenceRead {
  label: string;
  detail: string;
  tone: 'break' | 'digest' | 'aligned-chop' | 'aligned-trend' | 'none';
}

const divergenceOf = (
  daily: number | null,
  intra: number | null,
  b: ChopBands
): DivergenceRead => {
  if (daily == null || intra == null) {
    return { label: '', detail: '', tone: 'none' };
  }

  const dailyChoppy = daily >= b.chop;
  const dailyTrending = daily <= b.trend;
  const intraChoppy = intra >= b.chop;
  const intraTrending = intra <= b.trend;
  const gap = daily - intra;

  if (dailyChoppy && intraTrending && gap >= CHOP_DIVERGENCE_MIN) {
    return {
      tone: 'break',
      label: 'RANGE BREAKING',
      detail: `The session is trending inside a backdrop that has not been. ${gap.toFixed(0)} points of separation — this is what a range starting to resolve looks like before the daily reading notices.`,
    };
  }

  if (dailyTrending && intraChoppy && -gap >= CHOP_DIVERGENCE_MIN) {
    return {
      tone: 'digest',
      label: 'DIGESTING',
      detail: 'The trend is intact on the daily but today is going nowhere. Read the pause as consolidation inside a trend, not as failure — do not exit on the intraday reading alone.',
    };
  }

  if (dailyChoppy && intraChoppy) {
    return {
      tone: 'aligned-chop',
      label: 'BOTH CHOPPY',
      detail: 'Neither timeframe is resolving. Nothing to press — this is the stand-down combination.',
    };
  }

  if (dailyTrending && intraTrending) {
    return {
      tone: 'aligned-trend',
      label: 'BOTH TRENDING',
      detail: 'Backdrop and session agree. Breakout entries have both timeframes behind them.',
    };
  }

  return {
    tone: 'none',
    label: 'NO DIVERGENCE',
    detail: `Daily and intraday are ${Math.abs(gap).toFixed(0)} points apart — not enough separation to read anything into.`,
  };
};

const divergenceColor = (tone: DivergenceRead['tone']): string => {
  if (tone === 'break') return 'text-cyan-400';
  if (tone === 'aligned-trend') return 'text-emerald-400';
  if (tone === 'digest') return 'text-slate-300';
  if (tone === 'aligned-chop') return 'text-amber-400';
  return 'text-slate-600';
};

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
    s1 = `${lead}Broadly higher — S&P ${fmt(spy)}, Nasdaq ${fmt(qqq)}.`;
  } else if (up === 0 && down >= 2) {
    s1 = `${lead}Broadly lower — S&P ${fmt(spy)}, Nasdaq ${fmt(qqq)}.`;
  } else if (idx.length >= 2) {
    const leader = idx.reduce((a, b) => (b.v > a.v ? b : a));
    const laggard = idx.reduce((a, b) => (b.v < a.v ? b : a));
    s1 = `${lead}Mixed — ${names[leader.id]} ${fmt(leader.v)} leads, ${names[laggard.id]} ${fmt(laggard.v)} lags. Rotation, not direction.`;
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
    s2 = riskBits.join(', ') + tail + '.';
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
      bits.push(`${breadth.up4} up 4%+, ${breadth.down4} down 4%+`);
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
    s4 = `T2108 ${t.toFixed(0)} — ${regime}. ${action}`;
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
  const rx = /(VIX [+-]\d+(?:\.\d+)?%|T2108 \d+(?:\.\d+)?|S&P|Nasdaq|Dow|Bitcoin|VIX|[+-]\d+(?:\.\d+)?%|[Bb]readth \d\/6|[\d,]+ adv\b|[\d,]+ dec\b|\d+ (?:up|down) 4%\+|[\d,]+ highs|[\d,]+ lows)/g;
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

    m = part.match(/^T2108 (\d+(?:\.\d+)?)$/);
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
  const [chopMode, setChopMode] = useState<ChopMode>('strong');

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
        const res = await fetch(`/api/t2108/latest?t=${Date.now()}`, { cache: 'no-store' });
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
        const res = await fetch(`/api/chop?t=${Date.now()}`, { cache: 'no-store' });
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
    <div className="bg-[#101623] border border-white/10 rounded-2xl p-6 md:p-8 relative overflow-hidden shadow-xl">

      <div className="absolute right-0 top-0 w-64 h-64 bg-indigo-500/5 blur-3xl rounded-full -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>

      {/* HEADER CONTAINER */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex justify-between items-center relative z-10 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-6 border-b border-white/5 pb-4' : ''}`}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs md:text-sm font-bold text-[#7c8bfa] bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 group-hover:bg-white/[0.02] transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
            MACRO SCORECARD
          </span>
        </div>

        <div className="hidden sm:flex absolute left-1/2 -translate-x-1/2 items-center gap-3">
          <div className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-md border shadow-sm ${
              marketTone === 'BULLISH' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
              marketTone === 'BEARISH' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
              'bg-amber-500/10 text-amber-400 border-amber-500/20'
            }`}
          >
            TONE: {marketTone}
          </div>
          {breadth && (
            <div className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-md border shadow-sm ${
                breadth.signal === 'GREEN' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                breadth.signal === 'RED' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
                'bg-amber-500/10 text-amber-400 border-amber-500/20'
              }`}
              title={`Advancers ${breadth.advancers} / Decliners ${breadth.decliners} · +4%: ${breadth.up4} / -4%: ${breadth.down4}`}
            >
              BREADTH {breadth.score}/6
            </div>
          )}
          {chopVal != null && (
            <div className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-md border shadow-sm ${chopBadgeBg(chopVal, bands)} ${chopColor(chopVal, bands)}`}
              title={`CHOP ${chopVal.toFixed(0)} — ${chopZoneLabel(chopVal, bands)} at the ${bands.label} setting. ${chopVerdict(chopVal, bands)}`}
            >
              {chopZoneLabel(chopVal, bands)} {chopVal.toFixed(0)}
            </div>
          )}
          {tVal != null && (
            <div className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-md border shadow-sm ${
                tVal <= 20 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                tVal <= 35 ? 'bg-lime-500/10 text-lime-400 border-lime-500/20' :
                tVal <= 65 ? 'bg-slate-500/10 text-slate-300 border-white/10' :
                tVal <= 80 ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                'bg-rose-500/10 text-rose-400 border-rose-500/20'
              }`}
              title={`T2108 ${tVal.toFixed(0)}% of stocks above 40-day MA — ${t2108ZoneLabel(tVal, '')}`}
            >
              T2108 {t2108ZoneLabel(tVal, '')}
            </div>
          )}
        </div>

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

      {/* COLLAPSIBLE CONTENT */}
      {isExpanded && (
        <>
          <div className="flex sm:hidden justify-center items-center gap-3 mb-6 relative z-10 flex-wrap">
            <div className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-md border shadow-sm ${
                marketTone === 'BULLISH' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                marketTone === 'BEARISH' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
                'bg-amber-500/10 text-amber-400 border-amber-500/20'
              }`}
            >
              TONE: {marketTone}
            </div>
            {chopVal != null && (
              <div className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-md border shadow-sm ${chopBadgeBg(chopVal, bands)} ${chopColor(chopVal, bands)}`}>
                {chopZoneLabel(chopVal, bands)} {chopVal.toFixed(0)}
              </div>
            )}
            {tVal != null && (
              <div className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-md border shadow-sm ${
                  tVal <= 20 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                  tVal <= 35 ? 'bg-lime-500/10 text-lime-400 border-lime-500/20' :
                  tVal <= 65 ? 'bg-slate-500/10 text-slate-300 border-white/10' :
                  tVal <= 80 ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                  'bg-rose-500/10 text-rose-400 border-rose-500/20'
                }`}
              >
                T2108 {t2108ZoneLabel(tVal, '')}
              </div>
            )}
          </div>

          {narrative && (
            <div className={`flex items-start gap-3 mb-4 border rounded-xl px-4 py-3 relative z-10 ${toneStyles.bg} ${toneStyles.border}`}>
              <span className={`flex items-center gap-1.5 text-[9px] font-bold tracking-widest uppercase mt-1 shrink-0 ${toneStyles.label}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${toneStyles.dot}`}></span>
                Tone
              </span>
              <div className="space-y-2">
                {narrative.split('\n').filter(Boolean).map((line, li) => (
                  <p key={li} className="text-[13px] leading-relaxed text-slate-200">
                    {renderToneText(line)}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* INTERNALS — advance/decline. PROPORTIONAL bar: the fill boundary
              is the measurement, so the gradient only adds depth within each
              side. See the note above ProportionalBar. */}
          {breadth && (
            <div
              className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5 mb-6 border border-white/5 bg-[#161c2a]/40 rounded-xl px-4 py-3 relative z-10 cursor-help"
              title={`Advance / Decline — ${breadth.advancers.toLocaleString()} advancing vs ${breadth.decliners.toLocaleString()} declining (${advPct.toFixed(0)}% advancing). Above 60% = buyers in control. Below 40% = sellers dominate.\n\n4% movers: ${breadth.up4} up / ${breadth.down4} down.\nA/D ratio: ${breadth.decliners > 0 ? (breadth.advancers / breadth.decliners).toFixed(2) : 'n/a'}.`}
            >
              <span className={`flex items-center gap-1.5 text-[9px] font-bold tracking-widest uppercase text-slate-500 ${STRIP_LABEL_W}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa] shrink-0"></span>
                Internals
              </span>

              <span
                className={`text-sm font-bold leading-none ${STRIP_ARROW_W} ${
                  adTrend === 'up' ? 'text-emerald-400' : adTrend === 'down' ? 'text-rose-400' : 'text-slate-600'
                }`}
                title={
                  adTrend === 'up' ? 'A/D ratio improving since last refresh'
                  : adTrend === 'down' ? 'A/D ratio deteriorating since last refresh'
                  : 'A/D ratio unchanged'
                }
              >
                {adTrend === 'up' ? '▲' : adTrend === 'down' ? '▼' : '–'}
              </span>

              <div className="flex items-center gap-3 flex-1 min-w-0">
                <span className={`text-[11px] font-bold text-emerald-400 tabular-nums whitespace-nowrap ${STRIP_SIDE_W}`}>
                  ADV {breadth.advancers.toLocaleString()}
                </span>
                <ProportionalBar
                  pct={advPct}
                  leftTitle={`${breadth.advancers.toLocaleString()} advancing`}
                  rightTitle={`${advPct.toFixed(0)}% advancing`}
                />
                <span className={`text-[11px] font-bold text-rose-400 tabular-nums whitespace-nowrap sm:text-right ${STRIP_SIDE_W}`}>
                  DEC {breadth.decliners.toLocaleString()}
                </span>
              </div>

              <div className={`flex items-center gap-4 ${STRIP_CLUSTER_W}`}>
                <span className={`flex items-center gap-1.5 whitespace-nowrap ${STRIP_NOTE_W}`} title="A/D ratio">
                  <span className="text-[9px] font-bold tracking-widest uppercase text-slate-500">A/D:</span>
                  <span className={`text-[11px] font-bold tabular-nums ${breadth.decliners > 0 && breadth.advancers / breadth.decliners >= 1 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {breadth.decliners > 0 ? (breadth.advancers / breadth.decliners).toFixed(2) : '—'}
                  </span>
                </span>
                <span className={`text-[10px] font-bold tabular-nums px-2 py-0.5 rounded border ${STRIP_BADGE_W} ${breadthPctBg(advPct)} ${breadthPctColor(advPct)}`}>
                  {advPct.toFixed(0)}%
                </span>
              </div>
            </div>
          )}

          {/* ATHI/ATLO — new highs vs new lows. Same proportional treatment. */}
          {breadth && ((breadth.newHighs ?? 0) > 0 || (breadth.newLows ?? 0) > 0) && (
            <div
              className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5 mb-6 border border-white/5 bg-[#161c2a]/40 rounded-xl px-4 py-3 relative z-10 cursor-help"
              title={`ATHI/ATLO — ${breadth.newHighs ?? 0} stocks within 1% of 52-week high vs ${breadth.newLows ?? 0} near 52-week low (${highsPct.toFixed(0)}% near highs). Above 60% = structural strength. Below 40% = defensive tape. H/L ratio: ${(breadth.newLows ?? 0) > 0 ? ((breadth.newHighs ?? 0) / (breadth.newLows ?? 0)).toFixed(2) : '∞'}.`}
            >
              <span className={`flex items-center gap-1.5 text-[9px] font-bold tracking-widest uppercase text-slate-500 ${STRIP_LABEL_W}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa] shrink-0"></span>
                ATHI / ATLO
              </span>

              <span
                className={`text-sm font-bold leading-none ${STRIP_ARROW_W} ${
                  hlTrend === 'up' ? 'text-emerald-400' : hlTrend === 'down' ? 'text-rose-400' : 'text-slate-600'
                }`}
                title={
                  hlTrend === 'up' ? 'H/L ratio improving since last refresh'
                  : hlTrend === 'down' ? 'H/L ratio deteriorating since last refresh'
                  : 'H/L ratio unchanged'
                }
              >
                {hlTrend === 'up' ? '▲' : hlTrend === 'down' ? '▼' : '–'}
              </span>

              <div className="flex items-center gap-3 flex-1 min-w-0">
                <span className={`text-[11px] font-bold text-emerald-400 tabular-nums whitespace-nowrap ${STRIP_SIDE_W}`}>
                  HIGHS {(breadth.newHighs ?? 0).toLocaleString()}
                </span>
                <ProportionalBar
                  pct={highsPct}
                  leftTitle={`${(breadth.newHighs ?? 0).toLocaleString()} near 52-week highs`}
                  rightTitle={`${highsPct.toFixed(0)}% making new highs`}
                />
                <span className={`text-[11px] font-bold text-rose-400 tabular-nums whitespace-nowrap sm:text-right ${STRIP_SIDE_W}`}>
                  LOWS {(breadth.newLows ?? 0).toLocaleString()}
                </span>
              </div>

              <div className={`flex items-center gap-4 ${STRIP_CLUSTER_W}`}>
                <span className={`flex items-center gap-1.5 whitespace-nowrap ${STRIP_NOTE_W}`} title="New Highs / New Lows ratio">
                  <span className="text-[9px] font-bold tracking-widest uppercase text-slate-500">H/L:</span>
                  <span className={`text-[11px] font-bold tabular-nums ${(breadth.newHighs ?? 0) >= (breadth.newLows ?? 0) ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {(breadth.newLows ?? 0) > 0 ? ((breadth.newHighs ?? 0) / (breadth.newLows ?? 0)).toFixed(2) : (breadth.newHighs ?? 0) > 0 ? '∞' : '—'}
                  </span>
                </span>
                <span className={`text-[10px] font-bold tabular-nums px-2 py-0.5 rounded border ${STRIP_BADGE_W} ${breadthPctBg(highsPct)} ${breadthPctColor(highsPct)}`}>
                  {highsPct.toFixed(0)}%
                </span>
              </div>
            </div>
          )}

          {/* CHOP — regime strip, TWO STACKED TRACKS.

              The tracks share thresholds, scale and width, and are vertically
              aligned, so ONE MARKER LEFT OF THE OTHER IS THE DIVERGENCE. That
              is the entire reason for stacking: v1.8 had the two readings as
              numbers in the sub-row, which made the gap something you
              computed rather than saw.

              The bar is a SPECTRUM WITH A MARKER, not a proportional fill —
              the opposite of the two strips above. CHOP is a single point on
              a 0-100 scale; there is no left side and right side to fill. */}
          {chopVal != null && (
            <div className={`mb-6 border rounded-xl px-4 py-3 relative z-10 ${chopStripStyle(chopVal, bands)}`}>
              <div
                className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5 cursor-help"
                title={chopTooltipText}
              >
                <span className={`flex items-center gap-1.5 text-[9px] font-bold tracking-widest uppercase text-slate-500 ${STRIP_LABEL_W}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa] shrink-0"></span>
                  Chop
                </span>

                <span
                  className={`text-sm font-bold leading-none ${STRIP_ARROW_W} ${
                    chopTrend === 'up' ? 'text-amber-400' : chopTrend === 'down' ? 'text-emerald-400' : 'text-slate-600'
                  }`}
                  title={
                    chopDelta == null ? 'No prior bar to compare'
                    : chopTrend === 'up' ? `Raw daily choppiness rising vs yesterday (+${chopDelta.toFixed(2)}) — conditions deteriorating for breakouts`
                    : chopTrend === 'down' ? `Raw daily choppiness falling vs yesterday (${chopDelta.toFixed(2)}) — trend conditions improving`
                    : `Raw daily choppiness flat vs yesterday (${chopDelta >= 0 ? '+' : ''}${chopDelta.toFixed(2)})`
                  }
                >
                  {chopTrend === 'up' ? '▲' : chopTrend === 'down' ? '▼' : '–'}
                </span>

                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className={`text-[11px] font-bold text-emerald-400 tabular-nums whitespace-nowrap ${STRIP_SIDE_W}`}>
                    TREND
                  </span>

                  <div className="flex-1 min-w-[80px] flex flex-col gap-2.5">
                    {/* --- TRACK 1: DAILY --- */}
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[8px] font-bold tracking-wider uppercase text-slate-600 text-right ${CHOP_TRACK_LABEL_W}`}>
                        1D
                      </span>
                      <div className="flex-1 h-1.5 rounded-full relative overflow-hidden">
                        <div className="absolute inset-0 flex transition-all duration-300" style={{ borderRadius: 'inherit' }}>
                          <div className="h-full bg-teal-400/45" style={{ width: `${bands.strongTrend}%` }}></div>
                          <div className="h-full bg-emerald-400/35" style={{ width: `${bands.trend - bands.strongTrend}%` }}></div>
                          <div className="h-full bg-slate-400/20" style={{ width: `${bands.chop - bands.trend}%` }}></div>
                          <div className="h-full bg-amber-400/35" style={{ width: `${bands.dead - bands.chop}%` }}></div>
                          <div className="h-full bg-rose-400/35" style={{ width: `${100 - bands.dead}%` }}></div>
                        </div>
                        <div
                          className="absolute top-[-2px] h-[9px] w-px bg-white/30 transition-all duration-300"
                          style={{ left: `${bands.trend}%` }}
                          title={`Trend threshold — ${bands.trend} (${bands.label})`}
                        ></div>
                        <div
                          className="absolute top-[-2px] h-[9px] w-px bg-white/30 transition-all duration-300"
                          style={{ left: `${bands.chop}%` }}
                          title={`Chop threshold — ${bands.chop} (${bands.label})`}
                        ></div>

                        {chop?.qqq != null && (
                          <div
                            className="absolute top-[-1px] h-[7px] w-px bg-violet-400/70 transition-all duration-500"
                            style={{ left: `${chop.qqq}%` }}
                            title={`QQQ daily ${chop.qqq.toFixed(1)}`}
                          ></div>
                        )}
                        {chop?.spy != null && (
                          <div
                            className="absolute top-[-1px] h-[7px] w-px bg-sky-400/70 transition-all duration-500"
                            style={{ left: `${chop.spy}%` }}
                            title={`SPY daily ${chop.spy.toFixed(1)}`}
                          ></div>
                        )}

                        <div
                          className={`absolute top-[-3px] h-[11px] w-[3px] rounded-sm transition-all duration-500 ${chopMarkerBg(chopVal, bands)}`}
                          style={{ left: `calc(${chopVal}% - 1.5px)` }}
                          title={`Daily composite ${chopVal.toFixed(0)} — ${chopZoneLabel(chopVal, bands)}`}
                        ></div>
                      </div>
                      <span className={`text-[9px] font-bold tabular-nums w-[18px] text-right ${chopColor(chopVal, bands)}`}>
                        {chopVal.toFixed(0)}
                      </span>
                    </div>

                    {/* --- TRACK 2: INTRADAY ---
                        Same width, same thresholds, same scale as the track
                        above. Rendered dimmer throughout so the daily reading
                        stays the headline — the intraday leg qualifies it
                        rather than competing with it. */}
                    {intraVal != null ? (
                      <div className={`flex items-center gap-1.5 ${intraStale ? 'opacity-45' : ''}`}>
                        <span className={`text-[8px] font-bold tracking-wider uppercase text-slate-600 text-right ${CHOP_TRACK_LABEL_W}`}>
                          {chop?.intraday?.barMinutes ?? 15}M
                        </span>
                        <div className="flex-1 h-1.5 rounded-full relative overflow-hidden">
                          <div className="absolute inset-0 flex transition-all duration-300" style={{ borderRadius: 'inherit' }}>
                            <div className="h-full bg-teal-400/25" style={{ width: `${bands.strongTrend}%` }}></div>
                            <div className="h-full bg-emerald-400/20" style={{ width: `${bands.trend - bands.strongTrend}%` }}></div>
                            <div className="h-full bg-slate-400/12" style={{ width: `${bands.chop - bands.trend}%` }}></div>
                            <div className="h-full bg-amber-400/20" style={{ width: `${bands.dead - bands.chop}%` }}></div>
                            <div className="h-full bg-rose-400/20" style={{ width: `${100 - bands.dead}%` }}></div>
                          </div>
                          <div
                            className="absolute top-[-2px] h-[9px] w-px bg-white/15 transition-all duration-300"
                            style={{ left: `${bands.trend}%` }}
                          ></div>
                          <div
                            className="absolute top-[-2px] h-[9px] w-px bg-white/15 transition-all duration-300"
                            style={{ left: `${bands.chop}%` }}
                          ></div>

                          <div
                            className={`absolute top-[-3px] h-[11px] w-[3px] rounded-sm transition-all duration-500 ${chopMarkerBg(intraVal, bands)}`}
                            style={{ left: `calc(${intraVal}% - 1.5px)` }}
                            title={
                              `Intraday ${intraVal.toFixed(0)} — ${chopZoneLabel(intraVal, bands)}` +
                              `\nLast ${chop?.intraday?.windowMinutes ?? 210} minutes, newest closed bar ${formatClockShort(intraLastBar)} EST` +
                              (intraStale ? '\nNot current — this is the last session that traded.' : '')
                            }
                          ></div>
                        </div>
                        <span className={`text-[9px] font-bold tabular-nums w-[18px] text-right ${chopColor(intraVal, bands)}`}>
                          {intraVal.toFixed(0)}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[8px] font-bold tracking-wider uppercase text-slate-700 text-right ${CHOP_TRACK_LABEL_W}`}>
                          15M
                        </span>
                        <div className="flex-1 h-1.5 rounded-full bg-white/[0.03] border border-dashed border-white/5"></div>
                        <span className="text-[9px] font-bold tabular-nums w-[18px] text-right text-slate-700">—</span>
                      </div>
                    )}
                  </div>

                  <span className={`text-[11px] font-bold text-amber-400 tabular-nums whitespace-nowrap sm:text-right ${STRIP_SIDE_W}`}>
                    CHOP
                  </span>
                </div>

                {/* Zone word in the note slot, score in the badge — the same
                    grammar as A/D 0.66 then 40%. Both describe the DAILY
                    reading; the intraday number lives on its own track. */}
                <div className={`flex items-center gap-4 ${STRIP_CLUSTER_W}`}>
                  <span className={`flex items-center whitespace-nowrap ${STRIP_NOTE_W}`}>
                    <span className={`text-[9px] font-bold tracking-widest uppercase ${chopColor(chopVal, bands)}`}>
                      {chopZoneLabel(chopVal, bands)}
                    </span>
                  </span>
                  <span className={`text-[10px] font-bold tabular-nums px-2 py-0.5 rounded border ${STRIP_BADGE_W} ${chopBadgeBg(chopVal, bands)} ${chopColor(chopVal, bands)}`}>
                    {chopVal.toFixed(0)}
                  </span>
                </div>
              </div>

              {/* SUB-ROW: sensitivity left, divergence right. Indented to the
                  label-slot width so it reads as belonging to this strip
                  rather than as a fourth strip. */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-2.5 pt-2.5 border-t border-white/5 sm:pl-[100px]">
                <div className="flex items-center gap-1.5">
                  <span className="text-[8px] font-bold tracking-widest uppercase text-slate-600 mr-0.5">
                    Sensitivity
                  </span>
                  {CHOP_MODES.map((m) => {
                    const b = CHOP_BANDS[m];
                    const active = m === chopMode;
                    return (
                      <button
                        key={m}
                        onClick={() => setChopMode(m)}
                        title={`${b.blurb}\n\nChop called at ${b.chop} and above; trend at ${b.trend} and below.` +
                          (chopVal != null ? `\n\nToday's ${chopVal.toFixed(0)} would read ${chopZoneLabel(chopVal, b)} here.` : '')}
                        className={`text-[9px] font-bold tracking-wider uppercase px-2 py-0.5 rounded border transition-all duration-200 ${
                          active
                            ? 'bg-[#1e293b] text-indigo-400 border-indigo-500/30'
                            : 'bg-transparent text-slate-600 border-transparent hover:text-slate-400 hover:bg-white/[0.03]'
                        }`}
                      >
                        {b.label}
                      </button>
                    );
                  })}
                </div>

                {chopRaw != null && chopVal != null && Math.abs(chopVal - chopRaw) >= 2 && (
                  <span
                    className="flex items-center gap-1 whitespace-nowrap cursor-help"
                    title={`Raw CHOP ${chopRaw.toFixed(1)} adjusted ${chopVal - chopRaw >= 0 ? '+' : ''}${(chopVal - chopRaw).toFixed(1)} by breadth centrality and high/low balance → composite ${chopVal.toFixed(1)}.\n\nCentred internals push toward chop; skewed internals pull toward trend.`}
                  >
                    <span className="text-[9px] font-medium tabular-nums text-slate-600">
                      raw {chopRaw.toFixed(0)}
                    </span>
                    <span className={`text-[9px] font-bold tabular-nums ${chopVal - chopRaw > 0 ? 'text-amber-500/70' : 'text-emerald-500/70'}`}>
                      {chopVal - chopRaw >= 0 ? '→+' : '→'}{(chopVal - chopRaw).toFixed(0)}
                    </span>
                  </span>
                )}

                {intraVal != null && divergence.label && (
                  <span
                    className="flex items-center gap-2 whitespace-nowrap cursor-help"
                    title={`${divergence.detail}\n\nDaily ${chopVal.toFixed(0)} vs intraday ${intraVal.toFixed(0)} at the ${bands.label} setting.` +
                      (intraStale ? '\n\nThe intraday leg is not current — treat this read as describing the last session that traded.' : '')}
                  >
                    <span className={`text-[9px] font-bold tracking-widest uppercase ${divergenceColor(divergence.tone)}`}>
                      {divergence.label}
                    </span>
                    {intraStale && (
                      <span className="text-[8px] font-bold tracking-wider uppercase text-slate-600">
                        stale
                      </span>
                    )}
                  </span>
                )}

                {intraVal == null && (
                  <span className="text-[9px] font-medium text-slate-600 italic">
                    Intraday leg unavailable — daily reading only.
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4 relative z-10">
            {MACRO_ASSETS.map((asset) => {
              const q = quotes[asset.id];

              if (!q || !q.synced || q.price === 0) {
                return (
                  <div key={asset.id} className="bg-[#161c2a]/60 border border-white/5 rounded-xl p-4 flex flex-col justify-between h-24 opacity-60">
                    <div className="flex justify-between items-start">
                      <a href={`https://www.tradingview.com/chart/?symbol=${asset.type === 'crypto' ? asset.fmp : asset.id}`} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-slate-300 hover:text-indigo-300 transition-colors">{asset.id}</a>
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
                <div key={asset.id} className={`rounded-xl p-4 flex flex-col justify-between h-24 transition-colors duration-300 border ${cardBg} ${cardBorder} hover:bg-white/[0.02] shadow-sm`}>

                  <div className="flex justify-between items-start">
                    <div className="flex flex-col">
                      <a href={`https://www.tradingview.com/chart/?symbol=${asset.type === 'crypto' ? asset.fmp : asset.id}`} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-slate-200 hover:text-indigo-300 transition-colors">{asset.id}</a>
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

                  <div className="flex flex-col items-start mt-2">
                    <span className={`text-2xl font-semibold tracking-tight transition-colors duration-200 ${tickColor}`}>
                      {asset.type === 'crypto' && q.price > 100 ? q.price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : q.price.toFixed(2)}
                    </span>
                  </div>

                </div>
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
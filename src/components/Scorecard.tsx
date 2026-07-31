'use client';

// MacroScorecard — v1.3
// v1.1: SOL removed; T2108 added as the twelfth card (11 assets + T2108 keeps
//       the 4-column grid square). T2108 also feeds the tone narrative — it's
//       Bonde's primary regime gauge and it changes which setups to hunt.
// v1.2: Tone narrative condensed from five prose sentences to four dense
//       lines. The old s3 could contradict itself in a single breath —
//       "the tape is weak ... stay selective" followed by "momentum is broad,
//       not just index-level" — because the breadth read and the 4%-mover
//       append were written independently and neither knew about the other.
//       Now exactly ONE line issues an instruction (the verdict), and the
//       internals line is pure measurement.
// v1.3: CHOP regime strip added below ATHI/ATLO. Raw Choppiness Index comes
//       from /api/chop (needs daily bars, which /api/macro does not carry);
//       the breadth and high/low modifiers are applied HERE because this
//       component already holds both in state.

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

interface ChopData {
  qqq: number | null;
  qqqPrev: number | null;
  spy: number | null;
  spyPrev: number | null;
  blended: number | null;
  blendedPrev: number | null;
  period: number;
  updatedAt: string | null;
}

type MarketSession = 'Pre-Market' | 'Open' | 'Post-Market' | 'Closed';

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

/* ---- CHOP composite ------------------------------------------------------
   The route hands over raw Choppiness Index. The two modifiers below are
   applied here, and they exist because raw CHOP on an index has one
   specific failure mode that matters for this dashboard:

   A ROTATION TAPE SCORES AS CHOP. When money rotates out of one group and
   into another, the index travels a lot of distance and covers no ground —
   which is exactly the signature CHOP is built to detect. But underneath,
   leadership is clean and breakouts in the receiving group follow through
   perfectly well. Raw CHOP would tell you to stand down on a day that pays.

   The distinguishing evidence is dispersion. In real chop nothing is
   winning: breadth sits pinned near the middle and new highs roughly equal
   new lows. In rotation, breadth and the high/low line both skew, because
   one side genuinely is winning — just not the side the index tracks.

   So both modifiers push the SAME direction: centred internals raise the
   score toward chop, skewed internals pull it back toward trend. Each is
   capped at ±12, so together they can move the reading 24 points but never
   flip a decisive raw print on their own — a raw 20 cannot become chop and
   a raw 80 cannot become trend. They arbitrate the middle, which is the
   only place the ambiguity lives. */
const CHOP_MODIFIER_CAP = 12;

const chopComposite = (raw: number | null, breadth: BreadthData | null): number | null => {
  if (raw == null) return null;

  let adj = 0;

  // Breadth centrality — 3/6 is dead centre and maximally uninformative.
  if (breadth && typeof breadth.score === 'number') {
    const centrality = 1 - Math.abs(breadth.score - 3) / 3;
    adj += (centrality - 0.5) * 2 * CHOP_MODIFIER_CAP;
  }

  // High/low balance — highs ≈ lows is the structural signature of churn.
  const nh = breadth?.newHighs ?? 0;
  const nl = breadth?.newLows ?? 0;
  if (nh > 0 || nl > 0) {
    const highsShare = (nh / (nh + nl)) * 100;
    const balance = 1 - Math.abs(highsShare - 50) / 50;
    adj += (balance - 0.5) * 2 * CHOP_MODIFIER_CAP;
  }

  return Math.max(0, Math.min(100, raw + adj));
};

// Fibonacci thresholds, the convention the indicator ships with. 61.8 and
// above is consolidation; 38.2 and below is trend.
const chopZoneLabel = (v: number | null): string => {
  if (v == null) return 'NO DATA';
  if (v >= 70) return 'DEAD CHOP';
  if (v >= 61.8) return 'CHOPPY';
  if (v > 38.2) return 'MIXED';
  if (v > 30) return 'TRENDING';
  return 'STRONG TREND';
};

const chopColor = (v: number | null): string => {
  if (v == null) return 'text-slate-500';
  if (v >= 70) return 'text-rose-400';
  if (v >= 61.8) return 'text-amber-400';
  if (v > 38.2) return 'text-slate-300';
  if (v > 30) return 'text-emerald-400';
  return 'text-teal-300';
};

const chopBadgeBg = (v: number | null): string => {
  if (v == null) return 'bg-slate-500/10 border-white/10';
  if (v >= 70) return 'bg-rose-500/10 border-rose-500/20';
  if (v >= 61.8) return 'bg-amber-500/10 border-amber-500/20';
  if (v > 38.2) return 'bg-slate-500/10 border-white/10';
  return 'bg-emerald-500/10 border-emerald-500/20';
};

const chopStripStyle = (v: number | null): string => {
  if (v == null) return 'border-white/5 bg-[#161c2a]/40';
  if (v >= 61.8) return 'border-amber-500/20 bg-amber-500/[0.04]';
  if (v <= 38.2) return 'border-emerald-500/20 bg-emerald-500/[0.04]';
  return 'border-white/5 bg-[#161c2a]/40';
};

/* One line, shown under the strip. This is the only place the chop reading
   gives an instruction — the strip itself is measurement, same split the
   tone narrative uses. */
const chopVerdict = (v: number | null): string => {
  if (v == null) return '';
  if (v >= 70) return 'Nothing is trending. Breakout triggers will fire and reverse — sit out or trade the range.';
  if (v >= 61.8) return 'Consolidation regime. Expect failed breakouts; favour reversals at range edges.';
  if (v > 38.2) return 'No clear regime edge. Setup quality has to carry the trade on its own.';
  if (v > 30) return 'Trending tape. Breakouts have follow-through — triggers are worth taking.';
  return 'Strong trend. This is the regime breakout entries are built for.';
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

export default function MacroScorecard() {
  const [quotes, setQuotes] = useState<Record<string, TickData>>({});
  const [stockStatus, setStockStatus] = useState<'CONNECTING' | 'LIVE' | 'ERROR' | 'AUTH_ERROR'>('CONNECTING');
  const [session, setSession] = useState<MarketSession>('Closed');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [riskMode, setRiskMode] = useState<'ON' | 'OFF'>('ON');
  const [marketTone, setMarketTone] = useState<'BULLISH' | 'NEUTRAL' | 'BEARISH'>('NEUTRAL');
  const [breadth, setBreadth] = useState<BreadthData | null>(null);
  const [t2108, setT2108] = useState<T2108Data | null>(null);
  const [chop, setChop] = useState<ChopData | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(true);

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
      setRiskMode('ON');
    } else if (totalScore <= -1.0) {
      setMarketTone('BEARISH');
      setRiskMode('OFF');
    } else {
      setMarketTone('NEUTRAL');
      setRiskMode(totalScore >= 0 ? 'ON' : 'OFF');
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
  // Daily-bar metric behind a 15-min server cache, so a 10-minute client poll
  // is already faster than the data can change. Failure is silent: the strip
  // simply doesn't render rather than showing a placeholder that looks like a
  // reading of zero.
  useEffect(() => {
    let isMounted = true;

    const fetchChop = async () => {
      try {
        const res = await fetch(`/api/chop?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (isMounted && data && data.success) {
          setChop({
            qqq: data.qqq ?? null,
            qqqPrev: data.qqqPrev ?? null,
            spy: data.spy ?? null,
            spyPrev: data.spyPrev ?? null,
            blended: data.blended ?? null,
            blendedPrev: data.blendedPrev ?? null,
            period: data.period ?? 14,
            updatedAt: data.updatedAt ?? null,
          });
        }
      } catch {
        // Silent — no strip is better than a fabricated one.
      }
    };

    fetchChop();
    const interval = setInterval(() => { if (isMounted) fetchChop(); }, 600000);
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

  // CHOP composite and its day-over-day direction. Both the current and the
  // previous reading go through the SAME modifier function, so the arrow
  // reflects a change in the composite rather than a change in raw CHOP that
  // the modifiers might have cancelled out.
  const chopVal = chopComposite(chop?.blended ?? null, breadth);
  const chopPrevVal = chopComposite(chop?.blendedPrev ?? null, breadth);
  const chopDelta = chopVal != null && chopPrevVal != null ? chopVal - chopPrevVal : null;
  const chopTrend: 'up' | 'down' | 'flat' =
    chopDelta == null ? 'flat' : chopDelta > 0.5 ? 'up' : chopDelta < -0.5 ? 'down' : 'flat';
  const chopRaw = chop?.blended ?? null;

  return (
    <div className="bg-[#101623] border border-white/5 rounded-2xl p-6 md:p-8 relative overflow-hidden shadow-xl">
      
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
              riskMode === 'ON' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
            }`}
          >
            RISK {riskMode}
          </div>
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
            <div className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-md border shadow-sm ${chopBadgeBg(chopVal)} ${chopColor(chopVal)}`}
              title={`CHOP ${chopVal.toFixed(0)} — ${chopZoneLabel(chopVal)}. ${chopVerdict(chopVal)}`}
            >
              CHOP {chopVal.toFixed(0)}
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
          <div className="flex sm:hidden justify-center items-center gap-3 mb-6 relative z-10">
            <div className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-md border shadow-sm ${
                riskMode === 'ON' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
              }`}
            >
              RISK {riskMode}
            </div>
            <div className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-md border shadow-sm ${
                marketTone === 'BULLISH' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 
                marketTone === 'BEARISH' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
                'bg-amber-500/10 text-amber-400 border-amber-500/20'
              }`}
            >
              TONE: {marketTone}
            </div>
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

          {/* INTERNALS — advance/decline strip from the breadth feed */}
          {breadth && (
            <div
              className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5 mb-6 border border-white/5 bg-[#161c2a]/40 rounded-xl px-4 py-3 relative z-10 cursor-help"
              title={`Advance / Decline — ${breadth.advancers.toLocaleString()} advancing vs ${breadth.decliners.toLocaleString()} declining (${advPct.toFixed(0)}% advancing). Above 60% = buyers in control. Below 40% = sellers dominate. +4% movers: ${breadth.up4} up / ${breadth.down4} down. A/D ratio: ${breadth.decliners > 0 ? (breadth.advancers / breadth.decliners).toFixed(2) : 'n/a'}.`}
            >
              <span className="flex items-center gap-1.5 text-[9px] font-bold tracking-widest uppercase text-slate-500 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
                Internals
              </span>

              <span
                className={`text-sm font-bold leading-none shrink-0 ${
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
                <span className="text-[11px] font-bold text-emerald-400 tabular-nums whitespace-nowrap">
                  ADV {breadth.advancers.toLocaleString()}
                </span>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-rose-500/30 min-w-[60px]" title={`${advPct.toFixed(0)}% of movers advancing`}>
                  <div
                    className="h-full bg-emerald-400/80 rounded-full transition-all duration-500"
                    style={{ width: `${advPct}%` }}
                  ></div>
                </div>
                <span className="text-[11px] font-bold text-rose-400 tabular-nums whitespace-nowrap">
                  DEC {breadth.decliners.toLocaleString()}
                </span>
              </div>

              <div className="flex items-center gap-4 shrink-0">
                <span className="flex items-center gap-1.5 whitespace-nowrap" title="Names up 4%+ today">
                  <span className="text-[9px] font-bold tracking-widest uppercase text-slate-500">+4%:</span>
                  <span className="text-[11px] font-bold text-emerald-400 tabular-nums">{breadth.up4}</span>
                </span>
                <span className="flex items-center gap-1.5 whitespace-nowrap" title="Names down 4%+ today">
                  <span className="text-[9px] font-bold tracking-widest uppercase text-slate-500">-4%:</span>
                  <span className="text-[11px] font-bold text-rose-400 tabular-nums">{breadth.down4}</span>
                </span>
                <span className="flex items-center gap-1.5 whitespace-nowrap" title="A/D ratio">
                  <span className="text-[9px] font-bold tracking-widest uppercase text-slate-500">A/D:</span>
                  <span className={`text-[11px] font-bold tabular-nums ${breadth.decliners > 0 && breadth.advancers / breadth.decliners >= 1 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {breadth.decliners > 0 ? (breadth.advancers / breadth.decliners).toFixed(2) : '—'}
                  </span>
                </span>
                <span className={`text-[10px] font-bold tabular-nums px-2 py-0.5 rounded border ${breadthPctBg(advPct)} ${breadthPctColor(advPct)}`}>
                  {advPct.toFixed(0)}%
                </span>
              </div>
            </div>
          )}

          {/* ATHI/ATLO — new highs vs new lows from the scanned universe */}
          {breadth && ((breadth.newHighs ?? 0) > 0 || (breadth.newLows ?? 0) > 0) && (
            <div
              className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5 mb-6 border border-white/5 bg-[#161c2a]/40 rounded-xl px-4 py-3 relative z-10 cursor-help"
              title={`ATHI/ATLO — ${breadth.newHighs ?? 0} stocks within 1% of 52-week high vs ${breadth.newLows ?? 0} near 52-week low (${highsPct.toFixed(0)}% near highs). Above 60% = structural strength. Below 40% = defensive tape. H/L ratio: ${(breadth.newLows ?? 0) > 0 ? ((breadth.newHighs ?? 0) / (breadth.newLows ?? 0)).toFixed(2) : '∞'}.`}
            >
              <span className="flex items-center gap-1.5 text-[9px] font-bold tracking-widest uppercase text-slate-500 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
                ATHI / ATLO
              </span>

              <span
                className={`text-sm font-bold leading-none shrink-0 ${
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
                <span className="text-[11px] font-bold text-emerald-400 tabular-nums whitespace-nowrap">
                  HIGHS {(breadth.newHighs ?? 0).toLocaleString()}
                </span>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-rose-500/30 min-w-[60px]" title={`${highsPct.toFixed(0)}% making new highs`}>
                  <div
                    className="h-full bg-emerald-400/80 rounded-full transition-all duration-500"
                    style={{ width: `${highsPct}%` }}
                  ></div>
                </div>
                <span className="text-[11px] font-bold text-rose-400 tabular-nums whitespace-nowrap">
                  LOWS {(breadth.newLows ?? 0).toLocaleString()}
                </span>
              </div>

              <div className="flex items-center gap-4 shrink-0">
                <span className="flex items-center gap-1.5 whitespace-nowrap" title="New Highs / New Lows ratio">
                  <span className="text-[9px] font-bold tracking-widest uppercase text-slate-500">H/L:</span>
                  <span className={`text-[11px] font-bold tabular-nums ${(breadth.newHighs ?? 0) >= (breadth.newLows ?? 0) ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {(breadth.newLows ?? 0) > 0 ? ((breadth.newHighs ?? 0) / (breadth.newLows ?? 0)).toFixed(2) : (breadth.newHighs ?? 0) > 0 ? '∞' : '—'}
                  </span>
                </span>
                <span className={`text-[10px] font-bold tabular-nums px-2 py-0.5 rounded border ${breadthPctBg(highsPct)} ${breadthPctColor(highsPct)}`}>
                  {highsPct.toFixed(0)}%
                </span>
              </div>
            </div>
          )}

          {/* CHOP — regime strip. Same geometry as the two above, but the bar
              is a SPECTRUM WITH A MARKER rather than a proportional fill.
              A/D and H/L are shares of a total, so a fill is an honest
              picture of them. CHOP is a single reading on a 0-100 scale —
              filling it left-to-right would imply a ratio that does not
              exist. The marker sits at the score; the gradient behind it
              shows which end of the scale the score is near. */}
          {chopVal != null && (
            <div
              className={`flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5 mb-6 border rounded-xl px-4 py-3 relative z-10 cursor-help ${chopStripStyle(chopVal)}`}
              title={`CHOP ${chopVal.toFixed(0)} — ${chopZoneLabel(chopVal)}.\n\nRaw Choppiness Index (${chop?.period ?? 14}-day): QQQ ${chop?.qqq != null ? chop.qqq.toFixed(1) : '—'}, SPY ${chop?.spy != null ? chop.spy.toFixed(1) : '—'}, blended ${chopRaw != null ? chopRaw.toFixed(1) : '—'}.\nAdjusted ${chopVal - (chopRaw ?? 0) >= 0 ? '+' : ''}${chopRaw != null ? (chopVal - chopRaw).toFixed(1) : '0'} by breadth centrality and high/low balance.\n\nAbove 61.8 = consolidation, breakouts fail. Below 38.2 = trending, breakouts follow through.\n\n${chopVerdict(chopVal)}`}
            >
              <span className="flex items-center gap-1.5 text-[9px] font-bold tracking-widest uppercase text-slate-500 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
                Chop
              </span>

              <span
                className={`text-sm font-bold leading-none shrink-0 ${
                  chopTrend === 'up' ? 'text-amber-400' : chopTrend === 'down' ? 'text-emerald-400' : 'text-slate-600'
                }`}
                title={
                  chopTrend === 'up' ? `Choppiness rising vs yesterday${chopDelta != null ? ` (+${chopDelta.toFixed(1)})` : ''} — conditions deteriorating for breakouts`
                  : chopTrend === 'down' ? `Choppiness falling vs yesterday${chopDelta != null ? ` (${chopDelta.toFixed(1)})` : ''} — trend conditions improving`
                  : 'Choppiness unchanged vs yesterday'
                }
              >
                {chopTrend === 'up' ? '▲' : chopTrend === 'down' ? '▼' : '–'}
              </span>

              <div className="flex items-center gap-3 flex-1 min-w-0">
                <span className="text-[11px] font-bold text-emerald-400 tabular-nums whitespace-nowrap">
                  TREND
                </span>
                <div
                  className="flex-1 h-1.5 rounded-full relative min-w-[60px] bg-gradient-to-r from-emerald-400/35 via-slate-400/25 to-amber-400/40"
                  title={`Marker at ${chopVal.toFixed(0)} on a 0-100 scale`}
                >
                  {/* Fibonacci threshold ticks at 38.2 and 61.8 — the marker
                      means nothing without the boundaries it sits between. */}
                  <div className="absolute top-[-2px] h-[9px] w-px bg-white/15" style={{ left: '38.2%' }}></div>
                  <div className="absolute top-[-2px] h-[9px] w-px bg-white/15" style={{ left: '61.8%' }}></div>
                  <div
                    className={`absolute top-[-4px] h-[13px] w-[3px] rounded-sm transition-all duration-500 ${
                      chopVal >= 61.8 ? 'bg-amber-400' : chopVal <= 38.2 ? 'bg-emerald-400' : 'bg-slate-300'
                    }`}
                    style={{ left: `calc(${chopVal}% - 1.5px)` }}
                  ></div>
                </div>
                <span className="text-[11px] font-bold text-amber-400 tabular-nums whitespace-nowrap">
                  CHOP
                </span>
              </div>

              <div className="flex items-center gap-4 shrink-0">
                <span className="flex items-center gap-1.5 whitespace-nowrap" title={`Raw ${chop?.period ?? 14}-day Choppiness Index before breadth adjustment`}>
                  <span className="text-[9px] font-bold tracking-widest uppercase text-slate-500">RAW:</span>
                  <span className="text-[11px] font-bold text-slate-400 tabular-nums">
                    {chopRaw != null ? chopRaw.toFixed(0) : '—'}
                  </span>
                </span>
                <span className={`text-[10px] font-bold tabular-nums px-2 py-0.5 rounded border ${chopBadgeBg(chopVal)} ${chopColor(chopVal)}`}>
                  {chopVal.toFixed(0)}
                </span>
                <span className={`text-[9px] font-bold tracking-widest uppercase px-2 py-0.5 rounded border whitespace-nowrap ${chopBadgeBg(chopVal)} ${chopColor(chopVal)}`}>
                  {chopZoneLabel(chopVal)}
                </span>
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
                <div key={asset.id} className={`rounded-xl p-4 flex flex-col justify-between h-24 transition-colors duration-300 border ${cardBg} ${cardBorder} hover:bg-white/[0.02] shadow-sm`}>
                  
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
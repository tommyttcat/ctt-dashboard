'use client';

// Vcp — Volatility Contraction Pattern (Mark Minervini) — v1.2
//
// v1.2: news asterisk beside the ticker, and provenance on the sub-row.
//       Completes the set — the same amber asterisk now means the same thing
//       on all six tables and the summary cards.
//
//   THIS TABLE IS WHERE THE DEAD NEWS FEED HID BEST, and the fix is worth
//   understanding as more than plumbing. "No catalyst — the base is the
//   thesis" is TRUE of most VCP rows: a base forming quietly is the normal
//   case. So a broken feed produced output indistinguishable from correct
//   output, for weeks, on the one table where nobody would think to check.
//
//   Now that it works, the asterisk marks the genuinely unusual state: a
//   stock that has news AND is not moving. Something was published and the
//   price did not respond, which during a contraction is either the market
//   not paying attention yet, or the market having decided it does not
//   matter. Both are worth knowing before the pivot goes.
//
//   The empty state keeps its wording, and should. It was never wrong — it
//   was just unfalsifiable while the feed was dead.
//
// v1.1: + the ? key, now that VCP_META exists in scanConfig.
//
// The only table on the dashboard that surfaces a setup BEFORE it triggers.
// Every other scan gates on something that has already happened — +4% today,
// 9M shares today, a blue dot that has fired. A VCP is worth watching for the
// two to six weeks while the base is still building, and this table is
// ordered around that.
//
// ---------------------------------------------------------------------------
// THE CONTRACTION SEQUENCE IS THE HEADLINE COLUMN, and it is the one thing no
// other table here shows. "24 → 11 → 5" is the entire pattern in nine
// characters: three pullbacks, each roughly half the last, supply drying out.
// A score can summarise that but cannot replace it — 24 → 11 → 5 and
// 14 → 13 → 12 can produce similar scores and are completely different
// structures, and only the sequence makes that visible at a glance.
//
// ---------------------------------------------------------------------------
// ON THE BREAKING-OUT STATUS, which needs care.
//
// The lib sets status to 'breaking-out' whenever price is above the pivot,
// with NO BOUND ON HOW FAR ABOVE. A name that cleared its pivot three weeks
// ago and ran 18% still reports 'breaking-out' — the pattern is real, the
// entry is long gone. On the first live scan five of nine names were in that
// state, so untreated this table would be half names you already missed.
//
// Handled here rather than in the lib because pctToPivot already carries the
// distance and the fix is a display decision: a breakout within
// FRESH_BREAKOUT_PCT of the pivot is actionable, beyond that it is labelled
// EXTENDED and coloured as a warning. The underlying `status` field is left
// untouched so the route's statusCounts stay comparable across scans.
//
// The cleaner long-term fix is a bound inside analyzeVcp so the route stops
// reporting stale breakouts as live ones. Worth doing once there is a week of
// data showing how often it happens.
// ---------------------------------------------------------------------------
//
// RS RATING IS A PERCENTILE, not the rsVsSpy the other tables show. 88 means
// stronger than 88% of every liquid stock in the market — which is a claim
// rsVsSpy cannot make. Minervini gates at 70 and wants 80-90+.
//
// v1.1: + the ? key, now that VCP_META exists in scanConfig.
//
//   It was left out of v1.0 deliberately rather than forgotten: MetricsKey
//   takes a meta object whose shape is defined in that file, and inventing
//   one would have produced a key documenting thresholds nobody had checked
//   against the scan. The gates now live in scanConfig, the route imports
//   them, and `liveGates` renders what the last run ACTUALLY enforced rather
//   than what the config currently says — those differ whenever the config
//   has been edited since the scan ran, and the key should show the former.

import React, { useState, useEffect, useMemo } from 'react';
import { useMarketData } from './MarketDataContext';
import { stageColor, stageShort, stageDescription } from '@/lib/indicators/stage';
import { mfColor, mfLabel, mfArrow } from '@/lib/indicators/moneyflow';
import { VCP_META } from '@/lib/scanConfig';
import MetricsKey from './MetricsKey';
import TickerChartHover from './TickerChartHover';
import { newsStarCount } from '@/lib/newsStars';

/* A breakout further than this above the pivot has run away from its own
   entry. Three percent is roughly one ordinary session on a liquid mid-cap —
   past that you are chasing rather than entering. */
const FRESH_BREAKOUT_PCT = 3;

const COLUMN_NOTES: Record<string, { what: string; colour?: string }> = {
  TICKER: {
    what: 'Symbol. Hover for the company name. The dot is base status — see the STATUS column.',
  },
  VCP: {
    what: 'Pattern score 0–100. Weights the contraction shape most heavily (final leg tightness and how far the legs contract), then volume drying, then RS Rating, then the Trend Template. Hover the badge for the per-row breakdown.',
    colour: 'Green 70+ (A) · amber 50+ (B) · grey below (C).',
  },
  RS: {
    what: 'Minervini / IBD Relative Strength Rating — a PERCENTILE against every liquid stock in the market, not a spread versus SPY. 88 means stronger than 88% of the market over the trailing year, with the most recent quarter double-weighted. Minervini gates at 70 and prefers 80–90+.',
    colour: 'Purple 90+ · green 80+ · slate 70+ · red below the floor.',
  },
  PRICE: {
    what: 'Last price. The dot is VWAP position.',
    colour: 'Green dot above VWAP · red dot below.',
  },
  'CHG%': { what: 'Change vs prior close. Not a gate on this scan — a base is built on quiet days.' },
  CONTRACTIONS: {
    what: 'The pattern itself: the depth of each pullback in the base, oldest first. 24 → 11 → 5 is textbook — each leg roughly half the last, supply thinning as it goes. Two to six legs qualify; three or four is the sweet spot.',
    colour: 'The final figure is coloured by tightness — green under 8%, slate under 12%, amber above.',
  },
  PIVOT: {
    what: 'The buy point — the high of the final contraction — and how far price sits from it. Negative means price is already above the pivot.',
    colour: 'Green within 3% below · slate further out · amber already extended past it.',
  },
  BASE: { what: 'Length of the base in trading days, measured from the start of the first contraction. Minervini wants at least three weeks; shorter bases fail more often because supply has not had time to change hands.' },
  VOL: {
    what: 'Volume drying ratio — average volume across the base against the equivalent span before it. Below 0.7 is real accumulation-side quiet. Above 1.0 the price is contracting on RISING volume, which looks identical on a depth chart and resolves the opposite way.',
    colour: 'Green under 0.7 · slate under 0.9 · amber above.',
  },
  TT: {
    what: 'Trend Template — how many of Minervini\'s seven computable structural criteria the name passes (price vs the 50/150/200 day, the stacking of those averages, the 200 rising, distance off the 52-week low and high). The eighth criterion is the RS Rating, which has its own column. Hover for which ones fail.',
    colour: 'Green 7/7 · slate 6/7 · amber 5/7 · red below.',
  },
  ATR: { what: '14-day ATR as a percent of price. Also the basis for the pivot-detection threshold — a leg has to exceed 2 ATRs to count as a contraction rather than noise.' },
  MF: {
    what: 'Money Flow (21). Inside a base this is the accumulation read: contracting price with MF above 55 is supply being absorbed; below 45 it is quiet distribution.',
    colour: 'Green high · red low.',
  },
  STAGE: {
    what: 'Weinstein stage. A VCP should be a Stage 2 phenomenon — the same silhouette in Stage 4 is a bear flag.',
    colour: 'Green healthy Stage 2 · amber sagging · red Stage 4.',
  },
  SECTOR: { what: 'Sector, derived from SIC where available.' },
};

const colTip = (key: string): string | undefined => {
  const n = COLUMN_NOTES[key];
  if (!n) return undefined;
  return n.colour ? `${n.what}\n\n${n.colour}` : n.what;
};

interface VcpCandidate {
  symbol: string;
  name?: string;
  sector?: string;
  price: number;
  changePct?: number;
  vol?: number;
  dVol?: number;
  avgVol?: number;
  rvol?: number | null;
  mktCap?: number | null;
  float?: number | null;

  score: number;
  grade?: string;
  scoreBreakdown?: Record<string, number> | null;

  rsRating?: number | null;
  rsRaw?: number | null;

  contractionCount: number;
  depths?: number[];
  firstDepthPct?: number | null;
  finalDepthPct?: number | null;
  pivot?: number | null;
  pctToPivot?: number | null;
  baseLengthBars?: number | null;
  baseHigh?: number | null;
  baseLow?: number | null;
  priorMovePct?: number | null;
  volumeDryingRatio?: number | null;
  finalLegVolumeRatio?: number | null;
  status?: string;
  atrPct?: number | null;

  templatePassed?: number | null;
  templateTotal?: number | null;
  templateFailures?: string[];
  pctAbove52wLow?: number | null;
  pctBelow52wHigh?: number | null;

  stage?: string;
  mf?: number | null;
  mfTrend?: number;
  vwapStatus?: 'above' | 'below' | 'neutral';
  catalyst?: string | null;
  catalystUrl?: string | null;
  thesis?: string | null;
  newsPublisher?: string | null;
  newsAge?: string | null;
  newsSentiment?: 'positive' | 'negative' | 'neutral' | null;
  newsCausal?: boolean | null;

  trigger?: number | null;
  stop?: number | null;
  stopPct?: number | null;
  target?: number | null;
}

type SortDirection = 'asc' | 'desc';
type StatusFilterType = 'All' | 'watch' | 'ready' | 'fresh' | 'extended';
type RsFilterType = 'All' | '80' | '90';
type GradeFilterType = 'All' | 'A' | 'B';
type TtFilterType = 'All' | 'perfect';
type LegsFilterType = 'All' | 'sweet';

const RS_BUCKETS: RsFilterType[] = ['80', '90'];
const GRADE_BUCKETS: GradeFilterType[] = ['A', 'B'];

const SCORE_LABELS: Record<string, string> = {
  finalTightness: 'Final contraction tightness',
  contractionRatio: 'Degree of contraction',
  volumeDrying: 'Volume drying across base',
  finalLegVolume: 'Final leg volume',
  rsRating: 'RS Rating',
  trendTemplate: 'Trend Template',
  baseLength: 'Base maturity',
  legCount: 'Contraction count',
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

const formatLevel = (v: number | null | undefined): string => {
  if (v == null || isNaN(Number(v))) return '—';
  const n = Number(v);
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(2);
};

const cleanSector = (sector: string | null | undefined): string => {
  if (!sector || sector === '—' || sector === '-') return '—';
  return String(sector).trim();
};

/* ---- Effective status ---------------------------------------------------
   The route's `status` does not bound how far past the pivot a breakout is.
   See the header. This derives the version the table actually displays:

     watch      forming, still building the base
     ready      within 3% below the pivot — the alert level
     fresh      just cleared the pivot, still within 3% above it
     extended   cleared it and ran; the pattern is real, the entry is gone */
type EffStatus = 'watch' | 'ready' | 'fresh' | 'extended' | 'unknown';

const effStatusOf = (row: VcpCandidate): EffStatus => {
  const p = row.pctToPivot;
  if (p == null) return row.status === 'breaking-out' ? 'fresh' : 'unknown';

  // pctToPivot is (pivot - price) / price: positive means price is BELOW the
  // pivot and has that far to travel; negative means it is already through.
  if (p > FRESH_BREAKOUT_PCT) return 'watch';
  if (p >= 0) return 'ready';
  if (p >= -FRESH_BREAKOUT_PCT) return 'fresh';
  return 'extended';
};

const STATUS_META: Record<EffStatus, { label: string; dot: string; text: string; title: string }> = {
  watch: {
    label: 'WATCH',
    dot: 'bg-slate-400',
    text: 'text-slate-400',
    title: 'Base still building — price is more than 3% below the pivot. Nothing to do yet; this is the list to keep an eye on.',
  },
  ready: {
    label: 'READY',
    dot: 'bg-emerald-400',
    text: 'text-emerald-400',
    title: 'Within 3% of the pivot and still below it. This is the alert level — set the trigger and wait for volume.',
  },
  fresh: {
    label: 'FRESH',
    dot: 'bg-cyan-400',
    text: 'text-cyan-400',
    title: 'Just cleared the pivot and still within 3% of it. The entry is live rather than passed.',
  },
  extended: {
    label: 'EXTENDED',
    dot: 'bg-amber-400',
    text: 'text-amber-400',
    title: 'Cleared the pivot and ran. The pattern was real and the entry has gone — chasing from here gives up the tight stop that made the setup worth taking.',
  },
  unknown: {
    label: '—',
    dot: 'bg-slate-600',
    text: 'text-slate-600',
    title: 'No pivot computed.',
  },
};

/* A row has news only when there is a HEADLINE and a link. An asterisk that
   opens nothing is worse than no asterisk. */
const hasNews = (row: VcpCandidate): boolean => !!(row.thesis && row.catalystUrl);

/* One tooltip for the asterisk and the sub-row, so the two can never
   describe the same article differently.

   The closing line is specific to this table. Elsewhere a headline explains
   a move; here there IS no move, so the interesting fact is the absence of a
   reaction rather than the news itself. */
const newsTooltip = (row: VcpCandidate): string => {
  if (!row.thesis) return '';
  const meta = [row.catalyst, row.newsPublisher, row.newsAge].filter(Boolean).join(' · ');
  const lines: string[] = [];
  if (meta) { lines.push(meta); lines.push(''); }
  lines.push(String(row.thesis));
  lines.push('');
  lines.push(
    row.newsSentiment === 'negative'
      ? 'Reads negative — during a contraction that is often why the base is tightening downward rather than coiling.'
      : 'Published while the base was building, with no price reaction. Either the market has not priced it yet, or it decided this does not matter.'
  );
  return lines.join('\n');
};

const rsColor = (rs: number | null | undefined): string => {
  if (rs == null) return 'text-slate-500';
  if (rs >= 90) return 'text-purple-400';
  if (rs >= 80) return 'text-emerald-400';
  if (rs >= 70) return 'text-slate-300';
  return 'text-rose-400';
};

const rsBadge = (rs: number | null | undefined): string => {
  if (rs == null) return 'bg-white/[0.02] text-slate-600 border-white/5';
  if (rs >= 90) return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
  if (rs >= 80) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
  if (rs >= 70) return 'bg-slate-500/10 text-slate-300 border-white/10';
  return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
};

const scoreBadge = (score: number | null | undefined): string => {
  if (score == null) return 'bg-white/[0.02] text-slate-600 border-white/5';
  if (score >= 70) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
  if (score >= 50) return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
  return 'bg-zinc-800/50 text-zinc-400 border-zinc-700/50';
};

const finalDepthColor = (d: number | null | undefined): string => {
  if (d == null) return 'text-slate-500';
  if (d <= 8) return 'text-emerald-400';
  if (d <= 12) return 'text-slate-300';
  return 'text-amber-400';
};

const pivotColor = (p: number | null | undefined): string => {
  if (p == null) return 'text-slate-500';
  if (p < -FRESH_BREAKOUT_PCT) return 'text-amber-400';
  if (p < 0) return 'text-cyan-400';
  if (p <= FRESH_BREAKOUT_PCT) return 'text-emerald-400';
  return 'text-slate-400';
};

const volDryColor = (r: number | null | undefined): string => {
  if (r == null) return 'text-slate-500';
  if (r <= 0.7) return 'text-emerald-400';
  if (r <= 0.9) return 'text-slate-300';
  return 'text-amber-400';
};

const ttColor = (passed: number | null | undefined, total: number | null | undefined): string => {
  if (passed == null || total == null) return 'text-slate-500';
  if (passed === total) return 'text-emerald-400';
  if (passed === total - 1) return 'text-slate-300';
  if (passed === total - 2) return 'text-amber-400';
  return 'text-rose-400';
};

const atrColor = (a: number | null | undefined): string => {
  if (a == null) return 'text-slate-500';
  if (a >= 6) return 'text-purple-400';
  if (a >= 3) return 'text-emerald-400';
  return 'text-slate-400';
};

const baseLenColor = (n: number | null | undefined): string => {
  if (n == null) return 'text-slate-500';
  if (n >= 25) return 'text-emerald-400';
  if (n >= 15) return 'text-slate-300';
  return 'text-amber-400';
};

const vcpTooltip = (row: VcpCandidate): string => {
  const lines: string[] = [
    `VCP ${row.score} — ${row.score >= 70 ? 'A' : row.score >= 50 ? 'B' : 'C'}`,
  ];

  const bd = row.scoreBreakdown;
  if (bd && typeof bd === 'object') {
    const entries = Object.entries(bd)
      .filter(([, v]) => typeof v === 'number' && v !== 0)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    if (entries.length) {
      lines.push('');
      for (const [k, v] of entries) {
        lines.push(`${v > 0 ? '+' : ''}${v}  ${SCORE_LABELS[k] || k}`);
      }
    }
  }

  if (row.priorMovePct != null) {
    lines.push('');
    lines.push(`Prior advance into the base: +${row.priorMovePct.toFixed(0)}%`);
  }
  if (row.finalLegVolumeRatio != null) {
    lines.push(`Final leg volume vs first leg: ${row.finalLegVolumeRatio.toFixed(2)}x`);
  }

  lines.push('');
  lines.push('The score rates the pattern. See the STATUS dot for whether the entry is still available.');

  return lines.join('\n');
};

const contractionTooltip = (row: VcpCandidate): string => {
  const d = row.depths ?? [];
  if (!d.length) return 'No contraction data.';

  const lines: string[] = [
    `${d.length} contraction${d.length === 1 ? '' : 's'}, oldest first:`,
    '',
  ];
  d.forEach((depth, i) => {
    lines.push(`  T${i + 1}   ${depth.toFixed(1)}%`);
  });

  if (d.length >= 2 && d[0] > 0) {
    const ratio = d[d.length - 1] / d[0];
    lines.push('');
    lines.push(`Final leg is ${(ratio * 100).toFixed(0)}% of the first — textbook is under 45%.`);
  }

  if (row.baseHigh != null && row.baseLow != null) {
    lines.push('');
    lines.push(`Base range ${formatLevel(row.baseLow)} – ${formatLevel(row.baseHigh)}`);
  }

  return lines.join('\n');
};

const ttTooltip = (row: VcpCandidate): string => {
  const p = row.templatePassed;
  const t = row.templateTotal;
  if (p == null || t == null) return 'Trend Template not computed — needs 200 daily bars.';

  const lines: string[] = [`Trend Template ${p}/${t}`];

  const fails = row.templateFailures ?? [];
  if (fails.length) {
    lines.push('');
    lines.push('Failing:');
    for (const f of fails) lines.push(`  · ${f}`);
  } else {
    lines.push('');
    lines.push('All structural criteria pass.');
  }

  if (row.pctAbove52wLow != null || row.pctBelow52wHigh != null) {
    lines.push('');
    if (row.pctAbove52wLow != null) lines.push(`${row.pctAbove52wLow.toFixed(0)}% above the 52-week low`);
    if (row.pctBelow52wHigh != null) lines.push(`${Math.abs(row.pctBelow52wHigh).toFixed(0)}% below the 52-week high`);
  }

  lines.push('');
  lines.push('The eighth Minervini criterion is the RS Rating — its own column.');

  return lines.join('\n');
};

const planTooltip = (row: VcpCandidate): string => {
  if (row.trigger == null) return 'No levels — the pivot could not be resolved.';

  const lines: string[] = [
    `Trigger  ${formatLevel(row.trigger)}   (pivot — high of the final contraction)`,
    `Stop     ${formatLevel(row.stop)}   (${row.stopPct != null ? `−${row.stopPct.toFixed(1)}%` : '—'}, low of the final contraction)`,
    `Target   ${formatLevel(row.target)}   (2R)`,
  ];

  if (row.trigger != null && row.stop != null) {
    lines.push(`Risk     ${(row.trigger - row.stop).toFixed(2)} per share`);
  }

  lines.push('');
  lines.push('The stop is the pattern\'s own invalidation — price back under the tightest leg means the absorption read was wrong. That is usually tighter than an ATR stop, and it is the reason to trade a VCP at all.');

  const eff = effStatusOf(row);
  if (eff === 'extended') {
    lines.push('');
    lines.push('PRICE IS ALREADY WELL ABOVE THE TRIGGER. Entering here gives up the tight stop that made the setup worth taking.');
  }

  return lines.join('\n');
};

export default function Vcp() {
  const { session } = useMarketData();

  const [candidates, setCandidates] = useState<VcpCandidate[]>([]);
  const [status, setStatus] = useState<string>('Syncing...');
  const [generatedAt, setGeneratedAt] = useState<number | null>(null);
  const [funnel, setFunnel] = useState<{ universe: number | null; prefiltered: number | null; confirmed: number | null }>({
    universe: null, prefiltered: null, confirmed: null,
  });
  const [scanMeta, setScanMeta] = useState<any>(null);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: SortDirection } | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  const [statusFilter, setStatusFilter] = useState<StatusFilterType>('All');
  const [rsFilter, setRsFilter] = useState<RsFilterType>('All');
  const [gradeFilter, setGradeFilter] = useState<GradeFilterType>('All');
  const [ttFilter, setTtFilter] = useState<TtFilterType>('All');
  const [legsFilter, setLegsFilter] = useState<LegsFilterType>('All');
  const [showFilters, setShowFilters] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    const fetchCandidates = async () => {
      try {
        const res = await fetch(`/api/vcp/latest?t=${Date.now()}`, { cache: 'no-store' });
        const data = await res.json();

        if (isMounted && data && data.success && Array.isArray(data.candidates)) {
          setCandidates(data.candidates);
          setGeneratedAt(data.lastScanTime ? Number(data.lastScanTime) : null);
          setFunnel({
            universe: data.universe ?? null,
            prefiltered: data.prefiltered ?? null,
            confirmed: data.confirmed ?? null,
          });
          if (data.scanMeta?.vcp) setScanMeta(data.scanMeta.vcp);
          setStatus('Live');
        } else if (isMounted && data?.error) {
          setStatus('Feed Error');
        }
      } catch {
        if (isMounted) setStatus('Feed Offline');
      }
    };
    fetchCandidates();
    // Bases move on daily bars — a five-minute poll is already faster than
    // the data can change.
    const interval = setInterval(fetchCandidates, 300000);
    return () => { isMounted = false; clearInterval(interval); };
  }, []);

  const handleSort = (key: string) => {
    let direction: SortDirection = 'desc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') direction = 'asc';
    else if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') { setSortConfig(null); return; }
    setSortConfig({ key, direction });
  };

  // Every group is a toggle: pressing the active option clears it.
  const handleStatusFilter = (v: StatusFilterType) => setStatusFilter(p => p === v ? 'All' : v);
  const handleRsFilter = (v: RsFilterType) => setRsFilter(p => p === v ? 'All' : v);
  const handleGradeFilter = (v: GradeFilterType) => setGradeFilter(p => p === v ? 'All' : v);
  const handleTtFilter = (v: TtFilterType) => setTtFilter(p => p === v ? 'All' : v);
  const handleLegsFilter = (v: LegsFilterType) => setLegsFilter(p => p === v ? 'All' : v);

  const filteredAndSorted = useMemo(() => {
    let list = [...candidates];

    /* STATUS is the filter that matters most on this table. Half the list
       can be names that already broke out and ran, and those are not
       actionable however good the pattern was. */
    if (statusFilter !== 'All') {
      list = list.filter(c => {
        const eff = effStatusOf(c);
        if (statusFilter === 'watch') return eff === 'watch';
        if (statusFilter === 'ready') return eff === 'ready';
        if (statusFilter === 'fresh') return eff === 'fresh';
        if (statusFilter === 'extended') return eff === 'extended';
        return true;
      });
    }

    if (rsFilter !== 'All') {
      const min = Number(rsFilter);
      list = list.filter(c => (c.rsRating ?? -1) >= min);
    }

    if (gradeFilter !== 'All') {
      const min = gradeFilter === 'A' ? 70 : 50;
      list = list.filter(c => (c.score ?? -1) >= min);
    }

    if (ttFilter === 'perfect') {
      list = list.filter(c =>
        c.templatePassed != null && c.templateTotal != null && c.templatePassed === c.templateTotal
      );
    }

    // Three or four legs: enough repetitions to prove supply is thinning,
    // not so many that the base has become a stalled range.
    if (legsFilter === 'sweet') {
      list = list.filter(c => c.contractionCount === 3 || c.contractionCount === 4);
    }

    if (!sortConfig) return list;
    return list.sort((a, b) => {
      const aVal = (a as any)[sortConfig.key];
      const bVal = (b as any)[sortConfig.key];
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [candidates, sortConfig, statusFilter, rsFilter, gradeFilter, ttFilter, legsFilter]);

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

  const statusCounts = useMemo(() => {
    const c = { watch: 0, ready: 0, fresh: 0, extended: 0 };
    for (const row of candidates) {
      const e = effStatusOf(row);
      if (e in c) (c as any)[e]++;
    }
    return c;
  }, [candidates]);

  const getSortIcon = (columnKey: string) =>
    sortConfig?.key === columnKey ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓') : '';

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
    (statusFilter !== 'All' ? 1 : 0) +
    (rsFilter !== 'All' ? 1 : 0) +
    (gradeFilter !== 'All' ? 1 : 0) +
    (ttFilter !== 'All' ? 1 : 0) +
    (legsFilter !== 'All' ? 1 : 0);

  const funnelNote = funnel.universe != null && funnel.prefiltered != null
    ? `${funnel.universe.toLocaleString()} liquid names scanned · ${funnel.prefiltered} showed contraction structure · ${funnel.confirmed ?? 0} confirmed`
    : null;

  return (
    <div className="bg-[#101623] border border-white/5 rounded-2xl p-3 md:p-5 relative overflow-visible shadow-xl w-full max-w-[1280px] mx-auto">
      <div onClick={() => setIsExpanded(!isExpanded)} className={`flex justify-between items-center relative z-30 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-5 border-b border-white/5 pb-4' : ''}`}>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs md:text-sm font-bold text-[#7c8bfa] bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 group-hover:bg-white/[0.02] transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
            VCP
          </span>

          {/* Status counts in the header, because the split between watchable
              and already-gone is the first thing worth knowing about this
              table on any given day. */}
          {candidates.length > 0 && (
            <span className="hidden md:flex items-center gap-2">
              {statusCounts.ready > 0 && (
                <button onClick={() => handleStatusFilter('ready')}
                  className={`text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded border transition-all cursor-pointer ${statusFilter === 'ready' ? 'text-emerald-300 bg-emerald-500/20 border-emerald-400/40 ring-1 ring-emerald-400/30' : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20'}`}
                  title="Within 3% of the pivot and still below it — click to filter">
                  {statusCounts.ready} Ready
                </button>
              )}
              {statusCounts.fresh > 0 && (
                <button onClick={() => handleStatusFilter('fresh')}
                  className={`text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded border transition-all cursor-pointer ${statusFilter === 'fresh' ? 'text-cyan-300 bg-cyan-500/20 border-cyan-400/40 ring-1 ring-cyan-400/30' : 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20 hover:bg-cyan-500/20'}`}
                  title="Just cleared the pivot, entry still live — click to filter">
                  {statusCounts.fresh} Fresh
                </button>
              )}
              <button onClick={() => handleStatusFilter('watch')}
                className={`text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded border transition-all cursor-pointer ${statusFilter === 'watch' ? 'text-slate-200 bg-white/[0.08] border-white/20 ring-1 ring-white/20' : 'text-slate-400 bg-white/[0.03] border-white/5 hover:bg-white/[0.06]'}`}
                title="Base still building, more than 3% below the pivot — click to filter">
                {statusCounts.watch} Watch
              </button>
              {statusCounts.extended > 0 && (
                <button onClick={() => handleStatusFilter('extended')}
                  className={`text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded border transition-all cursor-pointer ${statusFilter === 'extended' ? 'text-amber-300 bg-amber-500/20 border-amber-400/40 ring-1 ring-amber-400/30' : 'text-amber-400 bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/20'}`}
                  title="Cleared the pivot and ran — click to filter">
                  {statusCounts.extended} Extended
                </button>
              )}
            </span>
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
          {/* z-40 so the panel paints above the FILTERS bar (z-10) rather
              than losing the sibling z-fight to it. */}
          <span className="relative z-40 inline-flex">
            <MetricsKey meta={VCP_META} liveGates={scanMeta?.gates} />
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
                {/* STATUS leads. On the first live scan five of nine names had
                    already broken out and run — the pattern was real and the
                    entry was gone. This is the control that separates a
                    watchlist from a history lesson. */}
                <div className={pillWrap}>
                  <span className={pillLabel}>STATUS</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleStatusFilter('watch')}
                      title={STATUS_META.watch.title}
                      className={`${pillBtn} ${statusFilter === 'watch' ? filterBtnActive : filterBtnIdle}`}
                    >
                      Watch
                    </button>
                    <button
                      onClick={() => handleStatusFilter('ready')}
                      title={STATUS_META.ready.title}
                      className={`${pillBtn} ${statusFilter === 'ready' ? filterBtnActive : filterBtnIdle}`}
                    >
                      Ready
                    </button>
                    <button
                      onClick={() => handleStatusFilter('fresh')}
                      title={STATUS_META.fresh.title}
                      className={`${pillBtn} ${statusFilter === 'fresh' ? filterBtnActive : filterBtnIdle}`}
                    >
                      Fresh
                    </button>
                  </div>
                </div>

                <div className={pillWrap}>
                  <span className={pillLabel}>RS</span>
                  <div className="flex items-center gap-1">
                    {RS_BUCKETS.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => handleRsFilter(opt)}
                        title={opt === '90'
                          ? 'RS Rating 90+ — stronger than 90% of the liquid market. Minervini\'s preferred zone.'
                          : 'RS Rating 80+ — the level he wants before taking a base seriously. The scan floor is 70.'}
                        className={`${pillBtn} ${rsFilter === opt ? filterBtnActive : filterBtnIdle}`}
                      >
                        {opt}+
                      </button>
                    ))}
                  </div>
                </div>

                <div className={pillWrap}>
                  <span className={pillLabel}>VCP</span>
                  <div className="flex items-center gap-1">
                    {GRADE_BUCKETS.map((g) => (
                      <button
                        key={g}
                        onClick={() => handleGradeFilter(g)}
                        title={g === 'A' ? 'A only — pattern score 70 and above' : 'B and above — includes A (50+)'}
                        className={`${pillBtn} ${gradeFilter === g ? filterBtnActive : filterBtnIdle}`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={pillWrap}>
                  <span className={pillLabel}>TT</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleTtFilter('perfect')}
                      title="Only names passing every computable Trend Template criterion. The eighth, RS Rating, has its own filter."
                      className={`${pillBtn} ${ttFilter === 'perfect' ? filterBtnActive : filterBtnIdle}`}
                    >
                      Perfect
                    </button>
                  </div>
                </div>

                <div className={pillWrap}>
                  <span className={pillLabel}>LEGS</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleLegsFilter('sweet')}
                      title="Three or four contractions — enough repetitions to prove supply is thinning, not so many that the base has stalled into a range."
                      className={`${pillBtn} ${legsFilter === 'sweet' ? filterBtnActive : filterBtnIdle}`}
                    >
                      3–4
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="relative z-0 overflow-x-auto custom-scrollbar" style={{ scrollbarWidth: 'thin' }}>
            <table className="w-full min-w-[940px] table-fixed border-collapse">
              <thead>
                <tr className="border-b border-white/5 select-none">
                  <th className={`${thBase} w-[8%]`} title={colTip('TICKER')} onClick={() => handleSort('symbol')}>TICKER{getSortIcon('symbol')}</th>
                  <th className={`${thBase} w-[5%]`} title={colTip('VCP')} onClick={() => handleSort('score')}>VCP{getSortIcon('score')}</th>
                  <th className={`${thBase} w-[5%]`} title={colTip('RS')} onClick={() => handleSort('rsRating')}>RS{getSortIcon('rsRating')}</th>
                  <th className={`${thBase} w-[3%]`}>N</th>
                  <th className={`${thBase} w-[7%]`} title={colTip('PRICE')} onClick={() => handleSort('price')}>PRICE{getSortIcon('price')}</th>
                  <th className={`${thBase} w-[6%]`} title={colTip('CHG%')} onClick={() => handleSort('changePct')}>CHG%{getSortIcon('changePct')}</th>
                  {/* The signature column — the pattern itself, not a summary
                      of it. Wider than anything else for that reason. */}
                  <th className={`${thBase} w-[13%]`} title={colTip('CONTRACTIONS')} onClick={() => handleSort('contractionCount')}>CONTRACTIONS{getSortIcon('contractionCount')}</th>
                  <th className={`${thBase} w-[9%]`} title={colTip('PIVOT')} onClick={() => handleSort('pctToPivot')}>PIVOT{getSortIcon('pctToPivot')}</th>
                  <th className={`${thBase} w-[5%]`} title={colTip('BASE')} onClick={() => handleSort('baseLengthBars')}>BASE{getSortIcon('baseLengthBars')}</th>
                  <th className={`${thBase} w-[5%]`} title={colTip('VOL')} onClick={() => handleSort('volumeDryingRatio')}>VOL{getSortIcon('volumeDryingRatio')}</th>
                  <th className={`${thBase} w-[5%]`} title={colTip('TT')} onClick={() => handleSort('templatePassed')}>TT{getSortIcon('templatePassed')}</th>
                  <th className={`${thBase} w-[5%]`} title={colTip('ATR')} onClick={() => handleSort('atrPct')}>ATR{getSortIcon('atrPct')}</th>
                  <th className={`${thBase} w-[5%]`} title={colTip('MF')} onClick={() => handleSort('mf')}>MF{getSortIcon('mf')}</th>
                  <th className={`${thStage} w-[6%] border-l border-white/5`} title={colTip('STAGE')} onClick={() => handleSort('stage')}>STAGE{getSortIcon('stage')}</th>
                  <th className={`${thSector} w-[8%]`} title={colTip('SECTOR')} onClick={() => handleSort('sector')}>SECTOR{getSortIcon('sector')}</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-white/5">
                {filteredAndSorted.length === 0 ? (
                  <tr>
                    <td colSpan={15} className="py-12 text-center text-slate-500 text-sm font-medium">
                      {status === 'Live'
                        ? (candidates.length > 0
                            ? 'No bases match the current filters.'
                            : 'No qualifying VCPs in the current scan. On a trending or falling tape that is the normal result — bases form in the pause between advances.')
                        : status === 'Syncing...'
                          ? 'Loading…'
                          : 'Feed unavailable — awaiting the next scheduled scan.'}
                    </td>
                  </tr>
                ) : (
                  filteredAndSorted.map((row) => {
                    const eff = effStatusOf(row);
                    const meta = STATUS_META[eff];
                    const isPositive = (row.changePct ?? 0) >= 0;
                    const sectorText = cleanSector(row.sector);
                    const depths = row.depths ?? [];

                    return (
                      <React.Fragment key={row.symbol}>
                        <tr className="hover:bg-white/[0.02] transition-colors group">
                          <td className={tdBase}>
                            <div className="flex items-center justify-center gap-1.5">
                              <TickerChartHover symbol={row.symbol}><span title={row.name || row.symbol} className="inline-block bg-slate-500/10 text-slate-300 text-[11px] font-bold px-1.5 py-0.5 rounded border border-white/10">{row.symbol}</span></TickerChartHover>
                              <span
                                className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`}
                                title={`${meta.label} — ${meta.title}`}
                              ></span>
                            </div>
                          </td>

                          <td className={tdBase}>
                            <span
                              title={vcpTooltip(row)}
                              className={`inline-block whitespace-nowrap px-1.5 py-[2px] rounded text-[9px] font-bold border cursor-help ${scoreBadge(row.score)}`}
                            >
                              {row.score}
                            </span>
                          </td>

                          <td className={tdBase}>
                            <span
                              title={`RS Rating ${row.rsRating ?? '—'} — stronger than ${row.rsRating ?? '—'}% of every liquid stock in the market over the trailing year, most recent quarter double-weighted.${row.rsRaw != null ? `\n\nRaw score ${row.rsRaw.toFixed(2)} before ranking.` : ''}`}
                              className={`inline-block whitespace-nowrap px-1.5 py-[2px] rounded text-[9px] font-bold border cursor-help ${rsBadge(row.rsRating)}`}
                            >
                              {row.rsRating ?? '—'}
                            </span>
                          </td>

                          <td className={`${tdBase} text-[7px] font-bold whitespace-nowrap`}>{(() => { const n = newsStarCount(row); const url = row.catalystUrl; if (n === 0) return <span className="text-slate-700">&mdash;</span>; const cls = n >= 2 ? 'text-amber-400' : 'text-slate-500'; const s = <span className={`leading-none ${cls}`}>{'★'.repeat(n)}</span>; return url ? <a href={url} target="_blank" rel="noopener noreferrer" className="hover:brightness-125 transition-all">{s}</a> : s; })()}</td>

                          <td className={`${tdBase} text-xs text-slate-300 font-medium whitespace-nowrap tabular-nums`}>
                            <div className="flex items-center justify-center gap-1">
                              ${row.price.toFixed(2)}
                              {row.vwapStatus && row.vwapStatus !== 'neutral' && (
                                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${row.vwapStatus === 'above' ? 'bg-emerald-400' : 'bg-rose-500'}`} title={`VWAP: ${row.vwapStatus}`}></div>
                              )}
                            </div>
                          </td>

                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {row.changePct != null ? `${isPositive ? '+' : ''}${row.changePct.toFixed(2)}%` : '—'}
                          </td>

                          {/* The pattern, rendered as the sequence it is. Each
                              depth in its own span so the final one can carry
                              the tightness colour — that last figure is the
                              readiness signal and deserves to be found without
                              counting arrows. */}
                          <td className={`${tdBase} whitespace-nowrap cursor-help`} title={contractionTooltip(row)}>
                            <div className="flex items-center justify-center gap-0.5 tabular-nums">
                              {depths.length === 0 ? (
                                <span className="text-xs text-slate-600">—</span>
                              ) : (
                                depths.map((d, i) => (
                                  <React.Fragment key={i}>
                                    {i > 0 && <span className="text-[8px] text-slate-600 px-px">→</span>}
                                    <span className={`text-[11px] font-bold ${
                                      i === depths.length - 1 ? finalDepthColor(d) : 'text-slate-400'
                                    }`}>
                                      {d.toFixed(0)}
                                    </span>
                                  </React.Fragment>
                                ))
                              )}
                            </div>
                          </td>

                          <td className={`${tdBase} whitespace-nowrap tabular-nums cursor-help`} title={planTooltip(row)}>
                            <div className="flex flex-col leading-tight">
                              <span className="text-xs font-bold text-slate-200">
                                {formatLevel(row.pivot)}
                              </span>
                              <span className={`text-[9px] font-semibold ${pivotColor(row.pctToPivot)}`}>
                                {row.pctToPivot != null
                                  ? `${row.pctToPivot >= 0 ? '+' : ''}${row.pctToPivot.toFixed(1)}%`
                                  : ''}
                              </span>
                            </div>
                          </td>

                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${baseLenColor(row.baseLengthBars)}`}
                            title={row.baseLengthBars != null ? `${row.baseLengthBars} trading days since the base began — about ${(row.baseLengthBars / 5).toFixed(0)} weeks` : undefined}>
                            {row.baseLengthBars ?? '—'}d
                          </td>

                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${volDryColor(row.volumeDryingRatio)}`}
                            title={row.volumeDryingRatio != null ? `Base volume is ${(row.volumeDryingRatio * 100).toFixed(0)}% of the equivalent span before the base began.` : undefined}>
                            {row.volumeDryingRatio != null ? `${row.volumeDryingRatio.toFixed(2)}x` : '—'}
                          </td>

                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums cursor-help ${ttColor(row.templatePassed, row.templateTotal)}`}
                            title={ttTooltip(row)}>
                            {row.templatePassed != null && row.templateTotal != null
                              ? `${row.templatePassed}/${row.templateTotal}`
                              : '—'}
                          </td>

                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${atrColor(row.atrPct)}`}>
                            {row.atrPct != null ? `${row.atrPct.toFixed(1)}%` : '—'}
                          </td>

                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${mfColor(row.mf ?? null)}`}
                            title={row.mf != null ? `Money Flow ${row.mf.toFixed(0)} — ${mfLabel(row.mf)}. Inside a base, above 55 is absorption and below 45 is quiet distribution.` : undefined}>
                            {row.mf != null ? `${row.mf.toFixed(0)}${mfArrow(row.mfTrend ?? 0)}` : '—'}
                          </td>

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

                        {/* Sub-row: status word first, then the three levels,
                            then the headline. Status leads because on this
                            table it decides whether the rest of the row is a
                            trade or a post-mortem. */}
                        <tr className="bg-transparent border-t border-white/5">
                          <td colSpan={13} className="pb-1.5 pt-1 pr-3">
                            <div className="flex items-center text-left gap-0 min-w-0">
                              <span
                                className={`shrink-0 w-[64px] px-0.5 text-center font-bold text-[9px] tracking-[0.04em] uppercase leading-none truncate cursor-help ${meta.text}`}
                                title={meta.title}
                              >
                                {meta.label}
                              </span>

                              {row.trigger != null ? (
                                <span
                                  title={planTooltip(row)}
                                  className="shrink-0 flex items-baseline gap-2 pl-2 pr-2.5 cursor-help whitespace-nowrap"
                                >
                                  <span className="flex items-baseline gap-1">
                                    <span className="text-[8px] font-bold tracking-[0.08em] uppercase text-slate-600">TRIG</span>
                                    <span className="text-[9px] font-bold tabular-nums text-slate-200">{formatLevel(row.trigger)}</span>
                                  </span>
                                  <span className="flex items-baseline gap-1">
                                    <span className="text-[8px] font-bold tracking-[0.08em] uppercase text-slate-600">STOP</span>
                                    <span className="text-[9px] font-bold tabular-nums text-rose-400/90">{formatLevel(row.stop)}</span>
                                  </span>
                                  <span className="flex items-baseline gap-1">
                                    <span className="text-[8px] font-bold tracking-[0.08em] uppercase text-slate-600">TGT</span>
                                    <span className="text-[9px] font-bold tabular-nums text-emerald-400/90">{formatLevel(row.target)}</span>
                                  </span>
                                  {row.stopPct != null && (
                                    <span className="flex items-baseline gap-1">
                                      <span className="text-[8px] font-bold tracking-[0.08em] uppercase text-slate-600">RISK</span>
                                      <span className="text-[9px] font-bold tabular-nums text-slate-400">{row.stopPct.toFixed(1)}%</span>
                                    </span>
                                  )}
                                </span>
                              ) : (
                                <span className="shrink-0 pl-2 pr-2.5 text-[9px] font-semibold text-slate-600 italic whitespace-nowrap">
                                  no pivot
                                </span>
                              )}

                              <p className="flex-1 min-w-0 text-[10px] leading-relaxed border-l border-white/10 pl-2.5 pr-3 truncate" title={newsTooltip(row) || undefined}>
                                {row.thesis || row.catalyst ? (
                                  <>
                                    {row.catalyst && (
                                      <>
                                        <span className="text-[8px] font-bold tracking-[0.12em] uppercase text-amber-400/70">{row.catalyst}</span>
                                        {row.thesis ? ' ' : ''}
                                      </>
                                    )}
                                    {row.thesis && (
                                      row.catalystUrl ? (
                                        <a href={row.catalystUrl} target="_blank" rel="noopener noreferrer" className="text-slate-500 font-normal hover:text-slate-300 hover:underline transition-colors">{row.thesis}</a>
                                      ) : (
                                        <span className="text-slate-500 font-normal">{row.thesis}</span>
                                      )
                                    )}
                                    {/* Source and age. Age carries real
                                        weight on a base: a headline from
                                        four days ago that price still has
                                        not reacted to says something the
                                        same headline this morning does
                                        not. */}
                                    {(row.newsPublisher || row.newsAge) && (
                                      <span className="text-[8px] text-slate-600 font-medium ml-1.5 whitespace-nowrap">
                                        {[row.newsPublisher, row.newsAge].filter(Boolean).join(' · ')}
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <span className="text-slate-600 italic">No catalyst — the base is the thesis.</span>
                                )}
                              </p>

                              <span
                                className="shrink-0 flex items-baseline gap-1.5 cursor-help whitespace-nowrap"
                                title={row.priorMovePct != null
                                  ? `The stock advanced ${row.priorMovePct.toFixed(0)}% into this base. That prior run is what creates the supply the contractions absorb — without it there is nothing to absorb and the base is just a quiet stock.`
                                  : undefined}
                              >
                                <span className="text-[8px] font-bold tracking-[0.1em] uppercase text-slate-600">RUN-UP</span>
                                <span className="text-[9px] font-semibold text-slate-500 tabular-nums">
                                  {row.priorMovePct != null ? `+${row.priorMovePct.toFixed(0)}%` : '—'}
                                </span>
                              </span>
                            </div>
                          </td>

                          <td className="pb-1.5 pt-1 pl-1.5 text-left align-middle border-l border-white/5">
                            <span
                              className="text-[8px] font-semibold text-slate-500 whitespace-nowrap cursor-help"
                              title={`${row.contractionCount} contraction${row.contractionCount === 1 ? '' : 's'} in the current base`}
                            >
                              T{row.contractionCount}
                            </span>
                          </td>

                          <td className="pb-1.5 pt-1 pl-1.5 text-left align-middle">
                            <span className="text-[8px] font-semibold text-slate-600 whitespace-nowrap tabular-nums">
                              {formatNumber(row.avgVol)}
                            </span>
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
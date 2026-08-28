/* The macro scorecard panel — the 7-cell grid, the two internals strips and
 * the CHOP regime card.
 *
 * Lifted out of Scorecard.tsx so the analyst briefing renders the SAME
 * component rather than a second implementation of the same idea. The two
 * pages previously drew this from independently written code and had drifted
 * on nearly every threshold: CHOP used a different modifier cap, T2108 used
 * the same words for different ranges, and the cell ladders disagreed with
 * the bar ladders on the very same screen.
 *
 * This file owns PRESENTATION only. Every threshold and formula it renders
 * comes from @/lib/indicators/{chopMarket,marketScorecard}.
 */

'use client';

import React from 'react';
import InfoDot from './InfoDot';
import {
  type ChopMode,
  type ChopBands,
  CHOP_BANDS,
  CHOP_MODES,
  chopZoneLabel,
  chopTextColor as chopColor,
  chopCellTone,
  chopBadgeBg,
} from '@/lib/indicators/chopMarket';
import {
  t2108ZoneLabel,
  participationBg as breadthPctBg,
  participationColor as breadthPctColor,
  BREADTH_TICK_LOW,
  BREADTH_TICK_HIGH,
  toneCellTone,
  vixPctTone,
  breadthSignalTone,
  advPct as advPctOf,
  advCellTone,
  highsPct as highsPctOf,
  highsCellTone,
  t2108CellTone,
  mkmCellTone,
  marketMonitorOf,
  mmTodayTone,
  mmCellTone,
  mmRatioLabel,
  instDirCellTone,
  type InstDirSetup,
  type InstDirSignal,
} from '@/lib/indicators/marketScorecard';

/* ---- Shared slot widths --------------------------------------------------
   The internals strips are one component shape rendered three times, so every
   slot has to measure the same or nothing lines up. Applied from sm up only;
   stacked on mobile there is nothing to align. */
const STRIP_LABEL_W = 'sm:w-[88px] sm:shrink-0';
const STRIP_ARROW_W = 'sm:w-[12px] sm:shrink-0';
const STRIP_SIDE_W = 'sm:w-[92px] sm:shrink-0';
const STRIP_NOTE_W = 'sm:w-[104px] sm:shrink-0 sm:justify-end sm:text-right';
const STRIP_BADGE_W = 'sm:min-w-[46px] text-center';
const STRIP_CLUSTER_W = 'sm:shrink-0 sm:justify-end';

/* Width of the tiny 1D / 15M prefix inside the CHOP bar area. Both tracks use
   it so their zero points align exactly. */
const CHOP_TRACK_LABEL_W = 'w-[24px] shrink-0';

const formatClockShort = (iso: string | null | undefined): string => {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '\u2014';
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });
};

const chopStripStyle = (v: number | null, b: ChopBands): string => {
  if (v == null) return 'border-white/5 bg-[#161c2a]/40';
  if (v >= b.dead) return 'border-rose-500/20 bg-rose-500/[0.04]';
  if (v >= b.chop) return 'border-amber-500/20 bg-amber-500/[0.04]';
  if (v <= b.trend) return 'border-emerald-500/20 bg-emerald-500/[0.04]';
  return 'border-white/5 bg-[#161c2a]/40';
};

const chopMarkerBg = (v: number | null, b: ChopBands): string => {
  if (v == null) return 'bg-slate-500';
  if (v >= b.dead) return 'bg-rose-400';
  if (v >= b.chop) return 'bg-amber-400';
  if (v <= b.trend) return 'bg-emerald-400';
  return 'bg-slate-300';
};

/* A/D and ATHI/ATLO are PROPORTIONS, so the fill boundary IS the measurement
   and the gradient only adds depth within each side. Contrast the CHOP track,
   which is a single point on a scale and therefore a marker, not a fill. */
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
  <div className="flex-1 relative min-w-[60px] h-1.5 rounded-full overflow-visible" title={title}>
    <div className="absolute inset-0 rounded-full overflow-hidden bg-gradient-to-r from-rose-500/35 to-rose-500/75">
      <div
        className="h-full bg-gradient-to-r from-emerald-400/90 to-emerald-400/45 transition-all duration-500"
        style={{ width: `${pct}%` }}
        title={leftTitle}
      ></div>
    </div>
    <div
      className="absolute top-[-2px] h-[9px] w-px bg-white/20 pointer-events-none"
      style={{ left: `${BREADTH_TICK_LOW}%` }}
      title={`${BREADTH_TICK_LOW}% \u2014 below this the tape reads as sellers in control`}
    ></div>
    <div
      className="absolute top-[-2px] h-[9px] w-px bg-white/20 pointer-events-none"
      style={{ left: `${BREADTH_TICK_HIGH}%` }}
      title={`${BREADTH_TICK_HIGH}% \u2014 above this the tape reads as buyers in control`}
    ></div>
    <div
      className="absolute top-[-3px] h-[11px] w-[2px] rounded-sm bg-slate-100 shadow-[0_0_4px_rgba(255,255,255,0.35)] transition-all duration-500 pointer-events-none"
      style={{ left: `calc(${pct}% - 1px)` }}
      title={rightTitle}
    ></div>
  </div>
);

export interface BreadthLike {
  score: number;
  signal: string;
  advancers: number;
  decliners: number;
  up4?: number;
  down4?: number;
  newHighs?: number | null;
  newLows?: number | null;
}

export type DivergenceTone = 'break' | 'digest' | 'aligned-chop' | 'aligned-trend' | 'none';

export interface DivergenceRead {
  label: string;
  detail: string;
  tone: DivergenceTone;
}

const divergenceColor = (tone: DivergenceTone): string => {
  if (tone === 'break') return 'text-cyan-400';
  if (tone === 'aligned-trend') return 'text-emerald-400';
  if (tone === 'digest') return 'text-slate-300';
  if (tone === 'aligned-chop') return 'text-amber-400';
  return 'text-slate-600';
};

export interface MacroScorecardPanelProps {
  marketTone: 'BULLISH' | 'NEUTRAL' | 'BEARISH';
  quotes: Record<string, any>;
  breadth: BreadthLike | null;
  tVal: number | null;
  chop: any;
  chopVal: number | null;
  chopRaw: number | null;
  chopDelta: number | null;
  divergence: DivergenceRead;
  chopTrend: 'up' | 'down' | 'flat';
  adTrend: 'up' | 'down' | 'flat';
  hlTrend: 'up' | 'down' | 'flat';
  advPct: number;
  highsPct: number;
  intraVal: number | null;
  intraStale: boolean;
  intraLastBar: string | null;
  chopTooltipText: string;
  chopMode: ChopMode;
  setChopMode: (m: ChopMode) => void;
  bands: ChopBands;
  instSetup?: InstDirSetup;
  instSignal?: InstDirSignal;
  instPrevSetup?: InstDirSetup | null;
  instFlash?: boolean;
  /* The briefing renders the cell grid alone — same cells, same thresholds,
     same styling, without the internals strips and CHOP regime card the
     dashboard carries underneath. */
  cellsOnly?: boolean;
}

export default function MacroScorecardPanel({
  marketTone,
  quotes,
  breadth,
  tVal,
  chop,
  chopVal,
  chopRaw,
  chopDelta,
  divergence,
  chopTrend,
  adTrend,
  hlTrend,
  advPct,
  highsPct,
  intraVal,
  intraStale,
  intraLastBar,
  chopTooltipText,
  chopMode,
  setChopMode,
  bands,
  instSetup,
  instSignal,
  instPrevSetup,
  instFlash,
  cellsOnly = false,
}: MacroScorecardPanelProps) {
  return (
    <>
      {/* Mini Scorecard Grid */}
      {(() => {
        const scCellCls = (color: 'green' | 'amber' | 'red' | 'slate') =>
          color === 'green' ? 'bg-emerald-500/8 border-emerald-500/20' : color === 'red' ? 'bg-rose-500/8 border-rose-500/20' : color === 'amber' ? 'bg-amber-500/8 border-amber-500/20' : 'bg-slate-500/8 border-white/10';
        const scValCls = (color: 'green' | 'amber' | 'red' | 'slate') =>
          color === 'green' ? 'text-emerald-400' : color === 'red' ? 'text-rose-400' : color === 'amber' ? 'text-amber-400' : 'text-slate-300';
        type SC = { label: string; value: string; valueNode?: React.ReactNode; sub?: string; subNode?: React.ReactNode; color: 'green' | 'amber' | 'red' | 'slate'; subColor?: 'green' | 'amber' | 'red' | 'slate'; title?: string; extraClass?: string };
        const cells: SC[] = [];

        /* ---- Order is the reading order ---------------------------------
           Verdict first, then the breadth family (score, 4% monitor,
           participation, structure), then extension and momentum, then
           regime, and volatility last. Market Monitor sits with breadth
           because that is what it is — a second breadth read on a stricter
           universe. */

        cells.push({
          label: 'TONE',
          value: marketTone,
          color: toneCellTone(marketTone),
          title: 'Weighted read of the session.\n\nSPY x3, QQQ x2.5, IWM x1 — a small-cap-only move is not the market. VIX counts only when it moves more than 2% and is inverted, since rising fear is bearish. Bitcoin carries a small risk-appetite weight. Breadth score nudges the total.\n\nBULLISH above +1.0, BEARISH below -1.0, NEUTRAL between.',
        });

        if (instSetup && instSignal) {
          cells.push({
            label: 'INST DIR',
            value: instSignal,
            subNode: instPrevSetup && instPrevSetup !== instSetup
              ? <>{instSetup}<br /><span className="text-[8px] text-slate-600">was {instPrevSetup}</span></>
              : <>{instSetup}</>,
            color: instDirCellTone(instSignal),
            extraClass: instFlash ? 'animate-inst-flash' : '',
            title: 'Institutional Direction — VIX-ES correlation.\n\nVIX pricing drives ~90% of S&P algorithmic volume. Rising VIX = put demand = sell programs. Falling VIX = pressure off = buy programs.\n\nBULLS: VIX pressure off, bear trap, or selling exhaustion.\nBEARS: VIX pressure on, confirmed breakdown, or 1% divergence.\nNEUTRAL: no active setup.',
          });
        }

        {
          const vixQ = quotes['VIX'];
          if (vixQ?.price) {
            const vPct = Number(vixQ.pct);
            const sign = vPct >= 0 ? '+' : '';
            cells.push({
              label: 'VIX',
              value: Number(vixQ.price).toFixed(2),
              sub: `${sign}${vPct.toFixed(2)}%`,
              color: vixPctTone(vPct),
              subColor: vixPctTone(vPct),
              title: 'CBOE Volatility Index — the market\'s 30-day expectation of movement.\n\nBelow 18 is calm, 18-25 is elevated, above 25 is stressed. Falling VIX into a rising tape is confirmation; rising VIX into a rising tape is a warning.',
            });
          }
        }

        if (breadth) {
          cells.push({
            label: 'BREADTH',
            value: `${breadth.score}/6`,
            sub: breadth.signal,
            color: breadthSignalTone(breadth.signal),
            title: 'Six breadth conditions, one point each:\n\n  advancers > decliners\n  55%+ of the tape advancing\n  more 4% gainers than 4% losers\n  100+ names up 4%\n  60%+ of 4% moves to the upside\n  fewer than 50 names down 4%\n\nGREEN at 4+, RED at 2 or below.',
          });
        }

        /* Market Monitor. The two counts ARE the reading, so they are the
           headline and each carries its own colour — the cell tint follows
           the ratio, but the triangles have to stay green-up / red-down or
           the pair stops being readable at a glance. */
        const mm = marketMonitorOf(breadth);
        if (mm) {
          const partial = mm.days > 0 && mm.days < 5;
          cells.push({
            label: 'MARKET MON',
            value: '',
            valueNode: (
              <span className="whitespace-nowrap">
                <span className="text-emerald-400">{mm.up4}&#9650;</span>
                <span className="text-slate-600 mx-1">/</span>
                <span className="text-rose-400">{mm.down4}&#9660;</span>
              </span>
            ),
            sub: mm.ratio5 != null
              ? `${mmRatioLabel(mm)}×${partial ? ` · ${mm.days}/5d` : ' 5d'}`
              : partial ? `${mm.days}/5d` : '',
            color: mmTodayTone(mm.up4, mm.down4),
            subColor: mmCellTone(mm.ratio5),
            title: [
              'Market Monitor — universe: close ≥ $3, volume ≥ 100k',
              '',
              `Today: ${mm.up4} up 4%+, ${mm.down4} down 4%+`,
              mm.up5 != null
                ? `5-day: ${mm.up5} up vs ${mm.down5} down${partial ? ` (only ${mm.days} sessions buffered so far)` : ''}`
                : '5-day: building history',
              mm.ratio5 != null
                ? `Ratio ${mm.ratio5.toFixed(2)} — above 1.0 favours the buyers, above 1.5 is genuine thrust.`
                : 'Ratio unavailable — no 4% breakdowns in the window.',
              mm.quarter25 != null
                ? `\n25%+ in a quarter: ${mm.quarter25} names over the last 65 sessions.`
                : '',
            ].filter(Boolean).join('\n'),
          });
        }

        if (breadth) {
          const adv = breadth.advancers ?? 0, dec = breadth.decliners ?? 0;
          const pct = advPctOf(adv, dec);
          cells.push({
            label: 'ADV / DEC',
            value: `${pct.toFixed(1)}%`,
            sub: `${adv} / ${dec}`,
            color: advCellTone(pct),
            title: `Share of the tape advancing — ${adv.toLocaleString()} up against ${dec.toLocaleString()} down.\n\nAbove 60% buyers are in control; below 50% sellers have it. Counted across all US equities above $1, so it tracks the market rather than the scanner's filtered list.`,
          });
        }

        if (breadth && (breadth.newHighs != null || breadth.newLows != null)) {
          const h = breadth.newHighs ?? 0, l = breadth.newLows ?? 0;
          const pct = highsPctOf(h, l);
          cells.push({
            label: 'HI / LO',
            value: `${pct.toFixed(1)}%`,
            sub: `${h} / ${l}`,
            color: highsCellTone(pct),
            title: `New 52-week highs against new 52-week lows — ${h.toLocaleString()} highs, ${l.toLocaleString()} lows.\n\nThe structural read: are names actually breaking out, or just bouncing inside ranges. Above 65% is genuine strength, below 50% a defensive tape.`,
          });
        }

        if (tVal != null) {
          cells.push({
            label: 'T2108',
            value: `${tVal.toFixed(0)}%`,
            sub: t2108ZoneLabel(tVal),
            color: t2108CellTone(tVal),
            title: 'Percentage of stocks trading above their own 40-day moving average.\n\nA mean-reversion gauge, not a trend one. Below 20 the tape is washed out and reversals pay; above 80 it is frothy and breakouts start failing. The middle is uninformative by design.',
          });
        }

        /* McClellan lived only on the analyst page before the panel was
           shared, so extracting the dashboard's grid dropped it. Both pages
           get it now. */
        const mkm = (breadth as any)?.mkm;
        if (mkm != null) {
          const rising = !!(breadth as any).mkmRising;
          const sig = Number((breadth as any).mkmSignal ?? 0);
          cells.push({
            label: 'McCLELLAN',
            value: `${Number(mkm).toFixed(0)}%`,
            sub: `${rising ? '\u25B2' : '\u25BC'} vs ${sig.toFixed(0)}`,
            color: mkmCellTone(Number(mkm), sig, rising),
            title: `Momentum oscillator on the new-high / new-low line.\n\nEMA(10) minus EMA(21) of the normalised ATHI/ATLO spread, rescaled 0-100 over a 500-session window, against a 9-EMA signal line.\n\nNow ${Number(mkm).toFixed(0)} vs signal ${sig.toFixed(0)}, ${rising ? 'rising' : 'falling'}. Green when it is both above signal and rising; rose when below and falling; amber when the two disagree.`,
          });
        }

        if (chopVal != null) {
          cells.push({
            label: 'CHOP',
            value: chopVal.toFixed(0),
            sub: chopZoneLabel(chopVal, bands),
            color: chopCellTone(chopVal, bands),
            title: chopTooltipText,
          });
        }

        return (
          <div className="mb-4 relative z-10">
            <div className={`grid grid-cols-3 md:grid-cols-5 gap-2 ${cells.length >= 9 ? 'xl:grid-cols-9' : cells.length === 8 ? 'xl:grid-cols-8' : 'xl:grid-cols-7'}`}>
              {cells.map((c) => (
                <div key={c.label} className={`rounded-lg border px-2.5 py-2 text-center flex flex-col items-center justify-center ${scCellCls(c.color)} ${c.extraClass ?? ''}`}>
                  <div className="text-[7px] font-bold uppercase tracking-[0.08em] text-slate-500 mb-0.5 flex items-center justify-center gap-1">
                    <span className="truncate">{c.label}</span>
                    {c.title && <InfoDot text={c.title} />}
                  </div>
                  <div className={`text-[13px] font-bold tabular-nums leading-tight ${scValCls(c.color)}`}>{c.valueNode ?? c.value}</div>
                  {(c.sub || c.subNode) && <div className={`text-[9px] mt-0.5 ${c.subNode ? '' : 'truncate'} ${c.subColor ? scValCls(c.subColor) : 'text-slate-500'}`}>{c.subNode ?? c.sub}</div>}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {!cellsOnly && (<>
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
          title={`ATHI/ATLO — ${breadth.newHighs ?? 0} at 52-week high vs ${breadth.newLows ?? 0} at 52-week low across US equities (${highsPct.toFixed(0)}% highs). Above 60% = structural strength. Below 40% = defensive tape. H/L ratio: ${(breadth.newLows ?? 0) > 0 ? ((breadth.newHighs ?? 0) / (breadth.newLows ?? 0)).toFixed(2) : '∞'}.`}
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
              leftTitle={`${(breadth.newHighs ?? 0).toLocaleString()} at 52-week highs`}
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
                chopTrend === 'up' ? chopColor(chopVal, bands) : chopTrend === 'down' ? chopColor(chopVal, bands) : 'text-slate-600'
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

              <span className={`text-[11px] font-bold tabular-nums whitespace-nowrap sm:text-right ${STRIP_SIDE_W} ${chopColor(chopVal, bands)}`}>
                {chopZoneLabel(chopVal, bands)}
              </span>
            </div>

            {/* Zone word in the note slot, score in the badge — the same
                grammar as A/D 0.66 then 40%. Both describe the DAILY
                reading; the intraday number lives on its own track. */}
            {/* DIRECTION, not just level. The zone word alone ("TRENDING")
                says where chop sits; it does not say which way it is going,
                and the way it is going is the tradeable part.

                THE LABEL DESCRIBES CHOP, because this is the CHOP strip and
                the number beside it is the chop composite: chop rising reads
                "Trending Up", chop falling reads "Trending Down".

                THE COLOUR DESCRIBES WHAT THAT MEANS FOR TRADING, which runs
                the other way — falling choppiness is IMPROVING conditions, so
                "Trending Down" is the green one and "Trending Up" is not.
                Same convention as the ▲/▼ arrow beside it, which is already
                amber-up / emerald-down for exactly this reason. Flat has no
                direction to report, so it keeps the zone word. */}
            <div className={`flex items-center gap-4 ${STRIP_CLUSTER_W}`}>
              <span className={`flex items-center whitespace-nowrap ${STRIP_NOTE_W}`}>
                <span className={`text-[9px] font-bold tracking-widest uppercase ${chopColor(chopVal, bands)}`}>
                  {chopTrend === 'down' ? 'Trending Down'
                    : chopTrend === 'up' ? 'Trending Up'
                    : chopZoneLabel(chopVal, bands)}
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
      </>)}
    </>
  );
}

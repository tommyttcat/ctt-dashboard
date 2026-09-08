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

const divergenceBadge = (tone: DivergenceTone): string => {
  if (tone === 'aligned-chop') return 'bg-amber-500/15 border border-amber-500/30 text-amber-400 px-2 py-0.5 rounded';
  if (tone === 'break') return 'bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 px-2 py-0.5 rounded';
  if (tone === 'aligned-trend') return 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 px-2 py-0.5 rounded';
  return '';
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
  hourVal: number | null;
  hourStale: boolean;
  hourLastBar: string | null;
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
  hourVal,
  hourStale,
  hourLastBar,
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
  /* The raw daily leg, straight off the API. `chopVal` is the composite —
     daily base plus an intraday blend and a concordance adjustment — so it is
     the headline number, not the day's own reading. When the hourly leg is
     live it takes over track 1, which used to leave the day with nowhere to
     show; it now gets a track of its own above the hour. */
  const dayVal: number | null = chop?.daily?.blended ?? chop?.blended ?? null;

  const ttRow = (label: string, reading: string, detail?: React.ReactNode) => (
    <div className="flex items-start gap-1.5 py-[3px]">
      <span className="text-slate-500 shrink-0 w-[70px]">{label}</span>
      <span className="text-slate-200 font-medium shrink-0 w-[80px]">{reading}</span>
      {detail && <span className="text-slate-400">{detail}</span>}
    </div>
  );
  const ttWrap = (header: string, rows: React.ReactNode) => (
    <div className="space-y-0">
      <div className="text-slate-200 font-medium mb-1.5">{header}</div>
      <div className="border-t border-white/10 pt-1.5">{rows}</div>
    </div>
  );

  return (
    <>
      {/* Mini Scorecard Grid */}
      {(() => {
        const scCellCls = (color: 'green' | 'amber' | 'red' | 'slate') =>
          color === 'green' ? 'bg-emerald-500/8 border-emerald-500/20' : color === 'red' ? 'bg-rose-500/8 border-rose-500/20' : color === 'amber' ? 'bg-amber-500/8 border-amber-500/20' : 'bg-slate-500/8 border-white/10';
        const scValCls = (color: 'green' | 'amber' | 'red' | 'slate') =>
          color === 'green' ? 'text-emerald-400' : color === 'red' ? 'text-rose-400' : color === 'amber' ? 'text-amber-400' : 'text-slate-300';
        type SC = { label: string; value: string; valueNode?: React.ReactNode; sub?: string; subNode?: React.ReactNode; color: 'green' | 'amber' | 'red' | 'slate'; subColor?: 'green' | 'amber' | 'red' | 'slate'; title?: string; titleContent?: React.ReactNode; extraClass?: string };
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
          titleContent: ttWrap('Weighted session read', <>
            {ttRow('Weights', '', <>SPY ×3 · QQQ ×2.5 · IWM ×1</>)}
            {ttRow('VIX', '', <>inverted, only when &gt;2% move</>)}
            {ttRow('Crypto', '', <>small risk-appetite weight</>)}
            {ttRow('Thresholds', '', <>BULL &gt;+1.0 · BEAR &lt;−1.0</>)}
          </>),
        });

        if (instSetup && instSignal) {
          const spyQ = quotes['SPY'];
          const vixQ2 = quotes['VIX'];
          const vix9dQ = quotes['VIX9D'];
          const vixPctVal = Number(vixQ2?.pct ?? 0);
          const spyPctVal = Number(spyQ?.pct ?? 0);
          const spyVol = spyQ?.volume as number | undefined;
          const spyAvgVol = spyQ?.avgVolume as number | undefined;
          const volRatio = spyVol && spyAvgVol && spyAvgVol > 0 ? spyVol / spyAvgVol : null;
          const termRatio = vix9dQ?.price && vixQ2?.price ? vixQ2.price / vix9dQ.price : null;
          const qqqQtt = quotes['QQQ'];
          const spyBrokePdlTt = spyQ?.prevLow != null && spyQ.price < spyQ.prevLow;
          const qqqBrokePdlTt = qqqQtt?.prevLow != null && qqqQtt.price < qqqQtt.prevLow;

          const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
          const dot = (on: boolean) => <span className={on ? 'text-amber-400' : 'text-emerald-400'}>{on ? '!' : '✓'}</span>;

          /* Mirrors instDirSetup's own floor. Below 2% the card says CLEAR, so
             the tooltip must not claim pressure the rule did not find. */
          const VIX_PRESSURE_PCT = 2;
          const vixVelLabel = Math.abs(vixPctVal) >= 3
            ? (vixPctVal <= -3 && spyPctVal >= 0.75 ? 'ALGO BUY'
              : vixPctVal >= 3 && spyPctVal <= -0.75 ? 'ALGO SELL'
              : `PRESSURE ${vixPctVal < 0 ? 'OFF' : 'ON'}`)
            : Math.abs(vixPctVal) >= VIX_PRESSURE_PCT
              ? `PRESSURE ${vixPctVal < 0 ? 'OFF' : 'ON'}`
              : 'quiet';

          const volLabel = volRatio != null
            ? (volRatio >= 1.5 ? (spyPctVal < -0.1 ? 'DISTRIBUTION' : 'ACCUMULATION') : 'normal')
            : 'n/a';

          const termLabel = termRatio != null
            ? (termRatio > 1.05 ? 'HEDGING' : termRatio < 0.95 ? 'contango' : 'flat')
            : 'n/a';

          const instTooltip = ttWrap(`${instSignal} — ${instSetup}`, <>
            {/* Both index legs, because CONFIRMED needs SPY *and* QQQ through
                their previous-day lows. VIX shows its day move rather than a
                level: it is an index and this plan carries no Polygon indices,
                so it has no previous-day high to test. */}
            {ttRow('Prev day',
              spyQ?.prevLow != null
                ? (spyBrokePdlTt && qqqBrokePdlTt ? 'BOTH BROKE' : spyBrokePdlTt ? 'SPY BROKE' : 'holding')
                : 'n/a',
              spyQ?.prevLow != null
                ? <>SPY {dot(spyBrokePdlTt)} {spyQ.prevLow.toFixed(2)} &nbsp; QQQ {dot(qqqBrokePdlTt)} {qqqQtt?.prevLow != null ? qqqQtt.prevLow.toFixed(2) : 'n/a'}</>
                : <>levels unavailable</>
            )}
            {ttRow('VIX Vel',
              vixVelLabel,
              <>VIX {fmtPct(vixPctVal)}{Math.abs(vixPctVal) >= 3 && <span className="text-amber-400 ml-1">algo</span>} · SPY {fmtPct(spyPctVal)}</>
            )}
            {ttRow('Volume',
              volLabel,
              volRatio != null
                ? <>{(spyVol! / 1e6).toFixed(1)}M vs {(spyAvgVol! / 1e6).toFixed(1)}M 20-day avg = {volRatio.toFixed(2)}x</>
                : <>unavailable</>
            )}
            {ttRow('Term Str',
              termLabel,
              termRatio != null
                ? <>VIX {vixQ2!.price.toFixed(1)} / 9D {vix9dQ!.price.toFixed(1)} = {termRatio.toFixed(3)}</>
                : <>VIX9D not on this data plan</>
            )}
          </>);

          cells.push({
            label: 'INST DIR',
            value: instSignal,
            subNode: instPrevSetup && instPrevSetup !== instSetup
              ? <>{instSetup}<br /><span className="text-[8px] text-slate-600">was {instPrevSetup}</span></>
              : <>{instSetup}</>,
            color: instDirCellTone(instSignal),
            extraClass: instFlash ? 'animate-inst-flash' : '',
            titleContent: instTooltip,
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
              titleContent: ttWrap('CBOE Volatility Index', <>
                {ttRow('What', '30d implied', <>expected market movement</>)}
                {ttRow('<18', 'calm')}
                {ttRow('18–25', 'elevated')}
                {ttRow('>25', 'stressed')}
                {ttRow('Read', '', <>VIX falling + tape rising = confirm</>)}
              </>),
            });
          }
        }

        if (breadth) {
          cells.push({
            label: 'BREADTH',
            value: `${breadth.score}/6`,
            sub: breadth.signal,
            color: breadthSignalTone(breadth.signal),
            titleContent: ttWrap('Breadth Score — 6 conditions', <>
              {ttRow('1', 'A > D', <>advancers beat decliners</>)}
              {ttRow('2', '55%+', <>tape advancing</>)}
              {ttRow('3', '4% up', <>more gainers than losers</>)}
              {ttRow('4', '100+', <>names up 4%+</>)}
              {ttRow('5', '60%+', <>of 4% moves to upside</>)}
              {ttRow('6', '<50', <>names down 4%+</>)}
              {ttRow('Signal', '', <>GREEN 4+ · RED ≤2</>)}
            </>),
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
            titleContent: ttWrap('Market Monitor — ≥$3, ≥100k vol', <>
              {ttRow('Today', `${mm.up4}▲ ${mm.down4}▼`, <>names moving 4%+</>)}
              {ttRow('5-day',
                mm.up5 != null ? `${mm.up5} / ${mm.down5}` : 'building',
                partial ? <>{mm.days}/5 sessions so far</> : undefined
              )}
              {mm.ratio5 != null && ttRow('Ratio', mm.ratio5.toFixed(2), <>&gt;1.0 buyers · &gt;1.5 thrust</>)}
              {mm.quarter25 != null && ttRow('25%/qtr', `${mm.quarter25}`, <>names up 25%+ in 65 sessions</>)}
            </>),
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
            titleContent: ttWrap('Advance / Decline', <>
              {ttRow('Now', `${adv.toLocaleString()} / ${dec.toLocaleString()}`, <>all US equities &gt;$1</>)}
              {ttRow('>60%', 'buyers', <>in control</>)}
              {ttRow('<50%', 'sellers', <>have it</>)}
            </>),
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
            titleContent: ttWrap('New 52-Week Highs / Lows', <>
              {ttRow('Now', `${h.toLocaleString()} / ${l.toLocaleString()}`, <>highs vs lows</>)}
              {ttRow('>65%', 'strength', <>names breaking out</>)}
              {ttRow('<50%', 'defensive', <>bouncing inside ranges</>)}
            </>),
          });
        }

        if (tVal != null) {
          cells.push({
            label: 'T2108',
            value: `${tVal.toFixed(0)}%`,
            sub: t2108ZoneLabel(tVal),
            color: t2108CellTone(tVal),
            titleContent: ttWrap('T2108 — % above 40d MA', <>
              {ttRow('What', 'mean-rev', <>not trend — reversion gauge</>)}
              {ttRow('<20', 'washed', <>reversals pay</>)}
              {ttRow('>80', 'frothy', <>breakouts start failing</>)}
              {ttRow('20–80', 'neutral', <>uninformative by design</>)}
            </>),
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
            titleContent: ttWrap('McClellan — HI/LO momentum', <>
              {ttRow('Method', '', <>EMA(10)−EMA(21) of HI/LO spread</>)}
              {ttRow('Now', `${Number(mkm).toFixed(0)}`, <>vs signal {sig.toFixed(0)}, {rising ? 'rising' : 'falling'}</>)}
              {ttRow('Green', '', <>above signal + rising</>)}
              {ttRow('Red', '', <>below signal + falling</>)}
              {ttRow('Amber', '', <>signal and direction disagree</>)}
            </>),
          });
        }

        if (chopVal != null) {
          const tf = hourVal != null ? '1H' : '1D';
          const qqq = hourVal != null ? chop?.hourly?.qqq : chop?.qqq;
          const spy = hourVal != null ? chop?.hourly?.spy : chop?.spy;
          cells.push({
            label: 'CHOP',
            value: chopVal.toFixed(0),
            sub: chopZoneLabel(chopVal, bands),
            color: chopCellTone(chopVal, bands),
            titleContent: ttWrap(`CHOP ${chopVal.toFixed(0)} — ${chopZoneLabel(chopVal, bands)} [${bands.label}]`, <>
              {ttRow('Timeframe', tf, <>{chop?.period ?? 14} bars</>)}
              {ttRow('QQQ', qqq != null ? qqq.toFixed(1) : '—')}
              {ttRow('SPY', spy != null ? spy.toFixed(1) : '—')}
              {ttRow('Composite', chopVal.toFixed(1), intraVal != null ? <>with 30% intraday blend</> : undefined)}
              {ttRow('Trend', `< ${bands.trend}`, <>trending</>)}
              {ttRow('Chop', `> ${bands.chop}`, <>choppy</>)}
              {intraVal != null && ttRow('Intraday', intraVal.toFixed(1), <>15m bars, unadjusted</>)}
            </>),
          });
        }

        return (
          <div className="mb-4 relative z-10">
            <div className={`grid grid-cols-3 md:grid-cols-5 gap-2 ${cells.length >= 9 ? 'xl:grid-cols-9' : cells.length === 8 ? 'xl:grid-cols-8' : 'xl:grid-cols-7'}`}>
              {cells.map((c) => (
                <div key={c.label} className={`rounded-lg border px-2.5 py-2 text-center flex flex-col items-center justify-center ${scCellCls(c.color)} ${c.extraClass ?? ''}`}>
                  <div className="text-[7px] font-bold uppercase tracking-[0.08em] text-slate-500 mb-0.5 flex items-center justify-center gap-1">
                    <span className="truncate">{c.label}</span>
                    {(c.title || c.titleContent) && <InfoDot text={c.title} content={c.titleContent} />}
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
          className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5 mb-6 border border-white/5 bg-[#161c2a]/40 rounded-xl px-4 py-3 relative z-10"
        >
          <span className={`flex items-center gap-1.5 text-[9px] font-bold tracking-widest uppercase text-slate-500 ${STRIP_LABEL_W}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa] shrink-0"></span>
            Internals
            <InfoDot content={ttWrap('Advance / Decline', <>
              {ttRow('Now', `${breadth.advancers.toLocaleString()} / ${breadth.decliners.toLocaleString()}`, <>{advPct.toFixed(0)}% advancing</>)}
              {ttRow('4% movers', `${breadth.up4} / ${breadth.down4}`, <>up vs down</>)}
              {ttRow('A/D ratio', breadth.decliners > 0 ? (breadth.advancers / breadth.decliners).toFixed(2) : '—')}
              {ttRow('>60%', 'buyers', <>in control</>)}
              {ttRow('<40%', 'sellers', <>dominate</>)}
            </>)} />
          </span>

          <span
            className={`text-sm font-bold leading-none ${STRIP_ARROW_W} ${
              adTrend === 'up' ? 'text-emerald-400' : adTrend === 'down' ? 'text-rose-400' : 'text-slate-600'
            }`}
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
          className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5 mb-6 border border-white/5 bg-[#161c2a]/40 rounded-xl px-4 py-3 relative z-10"
        >
          <span className={`flex items-center gap-1.5 text-[9px] font-bold tracking-widest uppercase text-slate-500 ${STRIP_LABEL_W}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa] shrink-0"></span>
            ATHI / ATLO
            <InfoDot content={ttWrap('New 52-Week Highs / Lows', <>
              {ttRow('Now', `${(breadth.newHighs ?? 0).toLocaleString()} / ${(breadth.newLows ?? 0).toLocaleString()}`, <>{highsPct.toFixed(0)}% highs</>)}
              {ttRow('H/L ratio', (breadth.newLows ?? 0) > 0 ? ((breadth.newHighs ?? 0) / (breadth.newLows ?? 0)).toFixed(2) : '∞')}
              {ttRow('>60%', 'strength', <>names breaking out</>)}
              {ttRow('<40%', 'defensive', <>bouncing in ranges</>)}
            </>)} />
          </span>

          <span
            className={`text-sm font-bold leading-none ${STRIP_ARROW_W} ${
              hlTrend === 'up' ? 'text-emerald-400' : hlTrend === 'down' ? 'text-rose-400' : 'text-slate-600'
            }`}
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
            className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5"
          >
            <span className={`flex items-center gap-1.5 text-[9px] font-bold tracking-widest uppercase text-slate-500 ${STRIP_LABEL_W}`}>
              <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa] shrink-0"></span>
              Chop
              {(() => {
                const chopRawV = chopRaw ?? chopVal;
                const adjV = chopVal - chopRawV;
                const tfV = hourVal != null ? '1H' : '1D';
                const qqqV = hourVal != null ? chop?.hourly?.qqq : chop?.qqq;
                const spyV = hourVal != null ? chop?.hourly?.spy : chop?.spy;
                return <InfoDot content={ttWrap(`CHOP ${chopVal.toFixed(0)} — ${chopZoneLabel(chopVal, bands)}`, <>
                  {ttRow('Timeframe', tfV, <>{chop?.period ?? 14} bars · {bands.label}</>)}
                  {ttRow('QQQ', qqqV != null ? qqqV.toFixed(1) : '—')}
                  {ttRow('SPY', spyV != null ? spyV.toFixed(1) : '—')}
                  {ttRow('Blended', chopVal.toFixed(1), <>adj {adjV >= 0 ? '+' : ''}{adjV.toFixed(1)}</>)}
                  {ttRow('Trend', `≤ ${bands.trend}`, <>breakouts work</>)}
                  {ttRow('Chop', `≥ ${bands.chop}`, <>sit out or fade</>)}
                  {intraVal != null && ttRow('Intraday', intraVal.toFixed(1), <>15m bars</>)}
                </>)} />;
              })()}
            </span>

            <span
              className={`text-sm font-bold leading-none ${STRIP_ARROW_W} ${
                chopTrend === 'up' ? chopColor(chopVal, bands) : chopTrend === 'down' ? chopColor(chopVal, bands) : 'text-slate-600'
              }`}
            >
              {chopTrend === 'up' ? '▲' : chopTrend === 'down' ? '▼' : '–'}
            </span>

            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="flex-1 min-w-[80px] flex flex-col gap-2.5">
                {/* --- TRACK 0: DAILY ---
                    Only rendered when the hourly leg is live, because without
                    it track 1 is already the daily. Same scale and thresholds
                    as the tracks below so the three read as one instrument. */}
                {hourVal != null && dayVal != null && (
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
                      ></div>
                      <div
                        className="absolute top-[-2px] h-[9px] w-px bg-white/30 transition-all duration-300"
                        style={{ left: `${bands.chop}%` }}
                      ></div>
                      <div
                        className={`absolute top-[-3px] h-[11px] w-[3px] rounded-sm transition-all duration-500 ${chopMarkerBg(dayVal, bands)}`}
                        style={{ left: `calc(${dayVal}% - 1.5px)` }}
                        title={`Daily ${dayVal.toFixed(0)} — ${chopZoneLabel(dayVal, bands)}\n${chop?.period ?? 14} daily bars, unadjusted`}
                      ></div>
                    </div>
                    <span className={`text-[9px] font-bold tabular-nums w-[18px] text-right ${chopColor(dayVal, bands)}`}>
                      {dayVal.toFixed(0)}
                    </span>
                  </div>
                )}

                {/* --- TRACK 1: HOURLY (or daily fallback) --- */}
                <div className="flex items-center gap-1.5">
                  <span className={`text-[8px] font-bold tracking-wider uppercase text-slate-600 text-right ${CHOP_TRACK_LABEL_W}`}>
                    {hourVal != null ? '1H' : '1D'}
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

                    {chop?.hourly?.qqq != null && (
                      <div
                        className="absolute top-[-1px] h-[7px] w-px bg-violet-400/70 transition-all duration-500"
                        style={{ left: `${chop.hourly.qqq}%` }}
                        title={`QQQ 1H ${chop.hourly.qqq.toFixed(1)}`}
                      ></div>
                    )}
                    {chop?.hourly?.spy != null && (
                      <div
                        className="absolute top-[-1px] h-[7px] w-px bg-sky-400/70 transition-all duration-500"
                        style={{ left: `${chop.hourly.spy}%` }}
                        title={`SPY 1H ${chop.hourly.spy.toFixed(1)}`}
                      ></div>
                    )}

                    <div
                      className={`absolute top-[-3px] h-[11px] w-[3px] rounded-sm transition-all duration-500 ${chopMarkerBg(hourVal ?? chopVal, bands)}`}
                      style={{ left: `calc(${hourVal ?? chopVal}% - 1.5px)` }}
                      title={`${hourVal != null ? 'Hourly' : 'Daily'} composite ${(hourVal ?? chopVal).toFixed(0)} — ${chopZoneLabel(hourVal ?? chopVal, bands)}`}
                    ></div>
                  </div>
                  <span className={`text-[9px] font-bold tabular-nums w-[18px] text-right ${chopColor(hourVal ?? chopVal, bands)}`}>
                    {(hourVal ?? chopVal).toFixed(0)}
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
            {/* DIRECTION label describes the trading implication:
                chop falling = conditions clearing for breakouts = "CLEARING"
                chop rising  = conditions worsening for breakouts = "CHOPPING UP" */}
            <div className={`flex items-center gap-4 ${STRIP_CLUSTER_W}`}>
              <span className={`flex items-center whitespace-nowrap ${STRIP_NOTE_W}`}>
                <span className={`text-[9px] font-bold tracking-widest uppercase ${chopColor(chopVal, bands)}`}>
                  {chopTrend === 'down' ? 'Clearing'
                    : chopTrend === 'up' ? 'Chopping Up'
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
                className="flex items-center gap-1 whitespace-nowrap"
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
                className="flex items-center gap-2 whitespace-nowrap"
              >
                <span className={`text-[10px] font-bold tracking-widest uppercase ${divergenceBadge(divergence.tone) || divergenceColor(divergence.tone)}`}>
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

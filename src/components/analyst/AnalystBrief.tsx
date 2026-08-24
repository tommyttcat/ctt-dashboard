'use client';

import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { fetchScannerLatest } from '@/lib/scannerLatest';
import { ThemeToggle } from '../ThemeProvider';
import HelpModal from '../HelpModal';
import DashNav from '../DashNav';
import TickerChartHover, { ActiveChartCtx, ActiveChartProvider, autoScrollRef, scrollingRef, HOVER_DELAY_MS } from '../TickerChartHover';
import { prefetchChart } from './MiniChart';
import { newsStarCount as newsStars } from '@/lib/newsStars';
import { stageColor, stageBadge } from '@/lib/indicators/stage';
import { rsColor, rsBadge } from '@/lib/indicators/rs';
import { dedupeByTicker, chgOf, dVolOf, advancingDollarShare } from '@/lib/indicators/marketMath';
import { industryHeat, type SectorHeat } from '@/lib/sectors';
import MacroScorecardPanel from '../MacroScorecardPanel';
import MacroEconPanel from '../MacroEconPanel';
import { useMacroScorecard } from '../useMacroScorecard';
import { rvolColor } from '@/lib/indicators/columnColors';
import {
  type ChopMode,
  type ChopBands,
  CHOP_BANDS as CHOP_MODE_BANDS,
  DEFAULT_CHOP_MODE,
  chopComposite,
  rawChopOf,
  chopZoneLabel as chopZone,
  chopCellTone as chopCellColor,
} from '@/lib/indicators/chopMarket';
import {
  marketTone,
  t2108ZoneLabel as t2108Zone,
  t2108CellTone,
  breadthSignalTone,
  advPct,
  advCellTone,
  highsPct,
  highsCellTone,
  mkmCellTone as mkmColor,
  vixPctTone,
  toneCellTone,
  getMarketSession,
  sessionTextColor,
} from '@/lib/indicators/marketScorecard';

const MiniChart = lazy(() => import('./MiniChart'));

interface StockEntryRaw {
  ticker: string;
  price: number;
  changePct: number;
  rvol?: number | null;
  vol?: number | null;
  dvol?: number | null;
  adrPct?: number | null;
  stage?: string;
  setup?: string;
  score?: number | null;
  cnfScore?: number | null;
  grade?: string | null;
  cnfGrade?: string | null;
  rs?: number | null;
  rsRating?: number | null;
  trigger?: number | null;
  stop?: number | null;
  target?: number | null;
  rMultiple?: number | null;
  thesis?: string;
  risk?: string;
  invalidation?: string;
  sentiment?: 'bullish' | 'bearish' | 'neutral';
  reason?: string;
}

interface StockEntry extends StockEntryRaw {
  score?: number | null;
  grade?: string | null;
  rs?: number | null;
}

function normalizeStock(raw: StockEntryRaw): StockEntry {
  const s = { ...raw };
  if (s.rs == null && s.rsRating != null) s.rs = s.rsRating;
  if (s.score == null && s.cnfScore != null) s.score = s.cnfScore;
  if (s.grade == null && s.cnfGrade != null) s.grade = s.cnfGrade;
  if (s.score == null && s.thesis) {
    const m = s.thesis.match(/score\s+(\d+)/i);
    if (m) s.score = parseInt(m[1], 10);
  }
  if (s.score == null && s.grade) {
    s.score = s.grade === 'A' ? 80 : s.grade === 'B' ? 65 : 50;
  }
  return s;
}

function normalizeStocks(stocks?: StockEntryRaw[]): StockEntry[] {
  return (stocks || []).map(normalizeStock);
}

interface RegimeBlock {
  regime: string;
  caution: string;
  posture: string;
}

interface SummaryBlock {
  conviction: string[];
  watchlist: string[];
  traps: string[];
}

interface SectionResult {
  section: string;
  analysis: string;
  stocks?: StockEntry[];
}

interface BriefData {
  generatedAt: string;
  generatedAtET: string;
  snapshotTime: string | null;
  sections: SectionResult[];
  regimeDetail?: RegimeBlock;
  summary?: SummaryBlock;
}

interface UpdateBlock {
  phase: string;
  timestamp: string;
  paragraphs: string[];
  takeawayLabel: string;
  takeaway: string;
  colorTheme: 'cyan' | 'emerald' | 'indigo' | 'amber' | 'rose';
}

type BlockKey = 'morning' | 'midday' | 'closing';
type Direction = 'up' | 'down' | 'neutral';

const BLOCK_WINDOWS: Record<BlockKey, { opens: number; supersededAt: number; nextLabel: string }> = {
  morning: { opens: 4.0, supersededAt: 11.5, nextLabel: 'midday' },
  midday: { opens: 11.5, supersededAt: 15.5, nextLabel: 'closing' },
  closing: { opens: 15.5, supersededAt: 24, nextLabel: '' },
};

const getEstNow = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
const estDecimal = () => { const d = getEstNow(); return d.getHours() + d.getMinutes() / 60; };
const isWeekendNow = () => { const d = getEstNow().getDay(); return d === 0 || d === 6; };

const isBlockStale = (key: BlockKey, weekend: boolean): boolean => {
  if (weekend) return false;
  return estDecimal() >= BLOCK_WINDOWS[key].supersededAt;
};

const INDEX_MOVE_RX = /\b(S&P|Nasdaq|Dow|Russell|SPX|NDX)\b[^.]{0,40}?([+-]\d+(?:\.\d+)?)%/gi;

const deriveDirection = (block: UpdateBlock): Direction | null => {
  const text = (block.paragraphs || []).join(' ');
  if (!text) return null;
  const moves: number[] = [];
  INDEX_MOVE_RX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INDEX_MOVE_RX.exec(text)) !== null) {
    const v = parseFloat(m[2]);
    if (!Number.isNaN(v)) moves.push(v);
  }
  if (moves.length === 0) return null;
  const avg = moves.reduce((a, b) => a + b, 0) / moves.length;
  if (Math.abs(avg) < 0.25) return 'neutral';
  return avg > 0 ? 'up' : 'down';
};

const sessionBlockTheme = (theme: string) => {
  switch (theme) {
    case 'cyan': return { bg: 'bg-cyan-500/5', text: 'text-cyan-400', boxBg: 'bg-cyan-500/10', boxBorder: 'border-cyan-500', boxText: 'text-cyan-100/90' };
    case 'emerald': return { bg: 'bg-emerald-500/5', text: 'text-emerald-400', boxBg: 'bg-emerald-500/10', boxBorder: 'border-emerald-500', boxText: 'text-emerald-100/90' };
    case 'rose': return { bg: 'bg-rose-500/5', text: 'text-rose-400', boxBg: 'bg-rose-500/10', boxBorder: 'border-rose-500', boxText: 'text-rose-100/90' };
    case 'amber': return { bg: 'bg-amber-500/5', text: 'text-amber-400', boxBg: 'bg-amber-500/10', boxBorder: 'border-amber-500', boxText: 'text-amber-100/90' };
    case 'indigo': default: return { bg: 'bg-indigo-500/5', text: 'text-indigo-400', boxBg: 'bg-indigo-500/10', boxBorder: 'border-indigo-500', boxText: 'text-indigo-100/90' };
  }
};

function formatVol(v: number | null | undefined): string {
  if (!v) return '';
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return String(v);
}

function setupBadge(stock: StockEntry) {
  const parts: string[] = [];
  if (stock.setup) parts.push(stock.setup);
  if (stock.score != null) parts.push(String(stock.score));
  if (stock.grade) parts.push(stock.grade);
  if (parts.length === 0) return null;
  return parts.join(' ');
}

const BRIEF_TICKER_CHIP = "inline-block align-baseline text-[7px] font-bold text-slate-300 bg-slate-500/10 px-1 py-[1px] rounded border border-white/10 tracking-wider mx-0.5 text-center min-w-[28px]";
const BRIEF_TICKER_CHIP_A = "inline-block align-baseline text-[7px] font-bold text-emerald-300 bg-emerald-500/10 px-1 py-[1px] rounded border border-emerald-400/30 tracking-wider mx-0.5 text-center min-w-[28px]";
const BRIEF_TICKER_CHIP_B = "inline-block align-baseline text-[7px] font-bold text-amber-300 bg-amber-500/10 px-1 py-[1px] rounded border border-amber-400/30 tracking-wider mx-0.5 text-center min-w-[28px]";
const BRIEF_TICKER_CHIP_RED = "inline-block align-baseline text-[7px] font-bold text-rose-200 bg-rose-950 px-1 py-[1px] rounded border border-rose-500/20 tracking-wider mx-0.5 text-center min-w-[28px]";

const MINI_CHIP = "inline-block align-baseline text-[7px] font-bold text-slate-300 bg-slate-500/10 px-1 py-[1px] rounded border border-white/10 tracking-wider mr-1 text-center min-w-[28px]";
const MINI_CHIP_RED = "inline-block align-baseline text-[7px] font-bold text-rose-200 bg-rose-950 px-1 py-[1px] rounded border border-rose-500/20 tracking-wider mr-1 text-center min-w-[28px]";

const briefChipCls = (ticker: string, gradeMap?: Record<string, 'A' | 'B'>, avoidSet?: Set<string>): string => {
  if (avoidSet?.has(ticker)) return BRIEF_TICKER_CHIP_RED;
  const g = gradeMap?.[ticker];
  if (g === 'A') return BRIEF_TICKER_CHIP_A;
  if (g === 'B') return BRIEF_TICKER_CHIP_B;
  return BRIEF_TICKER_CHIP;
};
const NOT_TICKERS = new Set([
  'THE','AND','FOR','BUT','NOT','YET','ALL','RED','ITS','HAS','ARE','WAS','HAD','NEW','LOW','HIGH',
  'ETF','IPO','GDP','CPI','PPI','RSI','EMA','SMA','VCP','ADR','ATR','ATH','ATL',
  'AI','RVOL','VOL','AVG','PCT','VS','PE','EPS','CEO','CFO','COO','CTO','RS','CNF','STG',
  'USD','EUR','YTD','QTD','MTD','MOM','YOY','QOQ','EOD','IOT','UTC','UTC',
  'FOMC','FED','SEC','ECB','BOJ','FDIC','OTC','FAQ','API','FDA','ET',
  'MA','PM','AM','IV','OI','DTE','BP','RR','UI','IS','OR','AN','AS','AT','BY','DO','GO','IF','IN','IT','MY','NO','OF','ON','SO','TO','UP','WE',
]);
const INDEX_TICKERS = new Set(['SPY','QQQ','DIA','IWM','VIX','TLT','GLD','SLV','USO','XLF','XLK','XLE','XLV','XLI','XLB','XLC','XLRE','XLU','XLP','XLY']);

function renderTickerChips(segment: string, keyBase: number, gradeMap?: Record<string, 'A' | 'B'>, avoidSet?: Set<string>): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /\b([A-Z]{1,5})\b/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(segment)) !== null) {
    const word = m[1];
    const isLikelyTicker = word.length >= 2 && !NOT_TICKERS.has(word);
    if (!isLikelyTicker) continue;
    if (m.index > last) parts.push(segment.slice(last, m.index));
    parts.push(<TickerChartHover key={keyBase + m.index} symbol={word}><span className={briefChipCls(word, gradeMap, avoidSet)}>{word}</span></TickerChartHover>);
    last = m.index + m[0].length;
  }
  if (last < segment.length) parts.push(segment.slice(last));
  if (last === 0) return [segment];
  return parts;
}

const INLINE_TICKER_CLS = "font-bold text-slate-200 cursor-pointer hover:text-white";

function renderTickerLinks(segment: string, keyBase: number): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /\b([A-Z]{1,5})\b/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(segment)) !== null) {
    const word = m[1];
    const isLikelyTicker = word.length >= 2 && !NOT_TICKERS.has(word);
    if (!isLikelyTicker) continue;
    if (m.index > last) parts.push(segment.slice(last, m.index));
    parts.push(<TickerChartHover key={keyBase + m.index} symbol={word}><span className={INLINE_TICKER_CLS}>{word}</span></TickerChartHover>);
    last = m.index + m[0].length;
  }
  if (last < segment.length) parts.push(segment.slice(last));
  if (last === 0) return [segment];
  return parts;
}

const INVERSE_TICKERS = new Set(['VIX', 'UVXY', 'SQQQ', 'SPXS', 'SDOW', 'SOXS']);

function contextPctColor(val: number, preceding: string, following: string): string {
  const ctx = (preceding + ' ' + following).toLowerCase();
  const isInverse = [...INVERSE_TICKERS].some(t => preceding.includes(t));

  if (/participation|advancing|pct\s*adv/i.test(ctx)) {
    return val >= 60 ? 'text-emerald-400 font-semibold' : val >= 45 ? 'text-amber-400 font-semibold' : 'text-rose-400 font-semibold';
  }
  if (/t2108/i.test(ctx)) {
    if (val <= 20 || val >= 80) return 'text-rose-400 font-semibold';
    if (val <= 35 || val >= 70) return 'text-amber-400 font-semibold';
    return 'text-slate-300 font-semibold';
  }
  if (/a\/d|ad ratio/i.test(preceding)) {
    return val >= 1.2 ? 'text-emerald-400 font-semibold' : val >= 0.8 ? 'text-amber-400 font-semibold' : 'text-rose-400 font-semibold';
  }
  if (/surprise/i.test(ctx)) {
    return val > 0 ? 'text-emerald-400 font-semibold' : val < 0 ? 'text-rose-400 font-semibold' : 'text-slate-400';
  }

  const effectiveVal = isInverse ? -val : val;
  return effectiveVal > 0 ? 'text-emerald-400 font-semibold' : effectiveVal < 0 ? 'text-rose-400 font-semibold' : 'text-slate-400';
}

function colorPcts(text: string, keyBase: number): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /(\b\d\/6\b)|(\bGREEN\b)|(\bRED\b)|([\d,]+\s+(?:advancers?|advancing))|(\b[\d,]+\s+(?:decliners?|declining))|([\d,]+\s+new\s+highs?)|([\d,]+\s+new\s+lows?)|(A\/D\s+[\d.]+)|((?:%K\s+)?[\d.]+\s+vs\s+(?:signal\s+)?[\d.]+)|([+-]?\d+\.?\d*%)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    let cls = 'text-slate-300 font-semibold';
    const matched = m[0];

    if (m[1]) {
      const score = parseInt(m[1]);
      cls = score >= 5 ? 'text-emerald-400 font-bold' : score >= 3 ? 'text-amber-400 font-bold' : 'text-rose-400 font-bold';
    } else if (m[2]) {
      cls = 'text-emerald-400 font-bold';
    } else if (m[3]) {
      cls = 'text-rose-400 font-bold';
    } else if (m[4]) {
      cls = 'text-emerald-400 font-semibold';
    } else if (m[5]) {
      cls = 'text-rose-400 font-semibold';
    } else if (m[6]) {
      cls = 'text-emerald-400 font-semibold';
    } else if (m[7]) {
      cls = 'text-rose-400 font-semibold';
    } else if (m[8]) {
      const adVal = parseFloat(matched.replace(/A\/D\s+/, ''));
      cls = adVal >= 1.2 ? 'text-emerald-400 font-semibold' : adVal >= 0.8 ? 'text-amber-400 font-semibold' : 'text-rose-400 font-semibold';
    } else if (m[9]) {
      cls = 'text-slate-200 font-semibold';
    } else if (m[10]) {
      const val = parseFloat(m[10].replace(/[^0-9.+-]/g, ''));
      const preceding = text.slice(Math.max(0, m.index - 80), m.index);
      const following = text.slice(m.index + m[0].length, Math.min(text.length, m.index + m[0].length + 30));
      cls = contextPctColor(val, preceding, following);
    }

    parts.push(<span key={keyBase + m.index} className={cls}>{matched}</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  if (last === 0) return [text];
  return parts;
}

function enrichSegment(seg: string, offset: number, pctColor?: boolean, tickers?: boolean, gradeMap?: Record<string, 'A' | 'B'>, avoidSet?: Set<string>): React.ReactNode[] {
  if (!pctColor && !tickers) return [seg];
  let nodes: React.ReactNode[] = pctColor ? colorPcts(seg, offset) : [seg];
  if (tickers) {
    nodes = nodes.flatMap((n, i) => typeof n === 'string' ? renderTickerChips(n, offset + i * 10000, gradeMap, avoidSet) : n);
  }
  return nodes;
}

function highlightBold(text: string, colorClass: string, pctColor?: boolean, tickers?: boolean, gradeMap?: Record<string, 'A' | 'B'>, avoidSet?: Set<string>): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(...enrichSegment(text.slice(last, match.index), last, pctColor, tickers, gradeMap, avoidSet));
    }
    const inner = match[1];
    const isTicker = tickers && /^[A-Z]{2,5}$/.test(inner) && !NOT_TICKERS.has(inner);
    if (isTicker) {
      parts.push(<TickerChartHover key={match.index} symbol={inner}><span className={briefChipCls(inner, gradeMap, avoidSet)}>{inner}</span></TickerChartHover>);
    } else {
      parts.push(
        <span key={match.index} className={`font-extrabold ${colorClass}`}>{inner}</span>
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    parts.push(...enrichSegment(text.slice(last), last, pctColor, tickers, gradeMap, avoidSet));
  }
  return <>{parts}</>;
}

const REGIME_COLORS: Record<string, { border: string; bg: string; label: string; highlight: string }> = {
  emerald: { border: 'border-l-emerald-500', bg: 'bg-emerald-500/[0.06]', label: 'text-emerald-400', highlight: 'text-emerald-300' },
  amber:   { border: 'border-l-amber-400',   bg: 'bg-amber-500/[0.06]',   label: 'text-amber-400',   highlight: 'text-amber-300' },
  rose:    { border: 'border-l-rose-500',     bg: 'bg-rose-500/[0.06]',    label: 'text-rose-400',    highlight: 'text-rose-300' },
  slate:   { border: 'border-l-slate-500',    bg: 'bg-slate-500/[0.06]',   label: 'text-slate-400',   highlight: 'text-slate-300' },
};

function RegimeDetail({ detail, color, breadth }: { detail: RegimeBlock; color: string; breadth?: SectionResult }) {
  const rc = REGIME_COLORS[color] || REGIME_COLORS.slate;
  const caution = REGIME_COLORS.amber;
  return (
    <div className="space-y-3 md:space-y-5">
      <div className={`md:border-l-[3px] ${rc.border} ${rc.bg} rounded-r-lg px-1.5 md:px-6 py-3 md:py-5`}>
        <div className={`text-[9px] font-bold ${rc.label} tracking-wider uppercase mb-3`}>
          Regime Assessment
        </div>
        <p className="text-[15px] text-slate-300 leading-[1.7]">
          {highlightBold(detail.regime, 'text-slate-100')}
        </p>
      </div>

      {breadth && breadth.analysis && (
        <div className="md:border-l-[3px] border-l-rose-400 bg-rose-500/[0.06] rounded-r-lg px-1.5 md:px-6 py-3 md:py-5">
          <div className="text-[9px] font-bold text-rose-400 tracking-wider uppercase mb-3">
            Sentiment &amp; Market Breadth
          </div>
          <FormattedBlock text={breadth.analysis} />
        </div>
      )}

      <div className={`md:border-l-[3px] ${caution.border} ${caution.bg} rounded-r-lg px-1.5 md:px-6 py-3 md:py-5`}>
        <div className={`text-[9px] font-bold ${caution.label} tracking-wider uppercase mb-3`}>
          Caution Flag
        </div>
        <FormattedBlock text={detail.caution} tickers />
      </div>
    </div>
  );
}

interface SummaryItem {
  ticker: string;
  setup?: string;
  score?: number | null;
  grade?: string | null;
  rs?: number | null;
  changePct?: number;
  rvol?: number | null;
  adrPct?: number | null;
  vol?: number | null;
  dvol?: number | null;
  price?: number;
  trigger?: number | null;
  rMultiple?: number | null;
  stage?: string;
  note?: string;
}

const TICKER_CHIP = 'inline-block align-baseline text-[7px] font-bold tracking-wider text-slate-300 bg-slate-500/10 border border-white/10 rounded px-1 py-[1px] mx-0.5 text-center';
const TICKER_CHIP_A_GRID = 'inline-block align-baseline text-[7px] font-bold tracking-wider text-emerald-300 bg-emerald-500/10 border border-emerald-400/30 rounded px-1 py-[1px] mx-0.5 text-center';
const TICKER_CHIP_B_GRID = 'inline-block align-baseline text-[7px] font-bold tracking-wider text-amber-300 bg-amber-500/10 border border-amber-400/30 rounded px-1 py-[1px] mx-0.5 text-center';
const TICKER_CHIP_RED = 'inline-block align-baseline text-[7px] font-bold tracking-wider text-rose-200 bg-rose-950 border border-rose-500/20 rounded px-1 py-[1px] mx-0.5 text-center';

const gridChipCls = (grade?: string | null, isAvoid?: boolean): string => {
  if (isAvoid) return TICKER_CHIP_RED;
  if (grade === 'A') return TICKER_CHIP_A_GRID;
  if (grade === 'B') return TICKER_CHIP_B_GRID;
  return TICKER_CHIP;
};

const SECTION_ACCENT: Record<string, string> = {
  'SIPs Thesis': '#22d3ee',
  '$Vol Summary': '#14b8a6',
  'Setups Summary': '#8b5cf6',
  '10/21 Thesis': '#8b5cf6',
  'VCP Thesis': '#14b8a6',
  'EP9M Thesis': '#f43f5e',
  '100-Bagger Thesis': '#d946ef',
  'ETF Flow': '#6366f1',
  'Money Flow': '#f43f5e',
  'Intraday Movers': '#34d399',
};

const SETUP_COLORS: Record<string, string> = {
  EP: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
  VCP: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
  COIL: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
  SWING: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  PB: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
};
const DEFAULT_SETUP_CLS = 'text-slate-400 bg-white/[0.06] border-white/[0.06]';

const SETUP_ABBR: Record<string, string> = {
  'GAP & GO': 'G&G', 'REVERSAL': 'REV', 'TREND HOLD': 'TRH',
  '20 EMA PB': 'EPB', 'BREAKOUT': 'BKO', 'PULLBACK': 'PLB',
  'RANGE BREAK': 'RNG', 'MOMENTUM': 'MOM', 'CONTINUATION': 'CNT',
  'BOUNCE': 'BNC', 'RECOVERY': 'RCV',
};
const shortSetup = (s: string) => SETUP_ABBR[s.toUpperCase()] || s.slice(0, 3).toUpperCase();

const stripStage = (s: string) => s.replace(/^Stage\s*/i, '');
const cnfBadgeCls = (v: number) => {
  if (v >= 70) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
  if (v >= 50) return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
  return 'bg-zinc-800/50 text-zinc-400 border-zinc-700/50';
};

type SortKey = 'cnf' | 'chg' | 'rvol' | 'vol' | 'dvol' | 'stg' | 'rs';
type SortDir = 'asc' | 'desc';

function getVal<T extends StockEntry>(s: T, key: SortKey): number {
  switch (key) {
    case 'cnf': return s.score ?? 0;
    case 'chg': return s.changePct;
    case 'rvol': return s.rvol ?? 0;
    case 'vol': return s.vol ?? 0;
    case 'dvol': return s.dvol ?? ((s.price ?? 0) * (s.vol ?? 0));
    case 'stg': return parseFloat(s.stage || '0');
    case 'rs': return s.rs ?? 0;
  }
}

function sortStocks<T extends StockEntry>(stocks: T[], key: SortKey, dir: SortDir): T[] {
  const sorted = [...stocks];
  const secondary: SortKey = key === 'cnf' ? 'rs' : 'cnf';
  sorted.sort((a, b) => {
    const av = getVal(a, key), bv = getVal(b, key);
    const cmp = dir === 'desc' ? bv - av : av - bv;
    if (cmp !== 0) return cmp;
    return getVal(b, secondary) - getVal(a, secondary);
  });
  return sorted;
}

const GRID_COLS = '42px 22px 58px 46px 44px 40px 52px 22px 22px 16px';
const GRID_COLS_GAP = '42px 22px 58px 46px 44px 40px 52px 22px 22px 16px';

const fmtPrice = (p: number | undefined | null): string => {
  if (p == null || p === 0) return '';
  if (p >= 1000) return p.toFixed(0);
  return p.toFixed(2);
};
/* overflow-y-hidden is required, not cosmetic — see the note on
   `scrollRowCls` in MarketSummary. Without it these rows scroll vertically. */
const scrollWrap = "overflow-x-auto overflow-y-hidden -mx-0.5 px-0.5";
const scrollStyle: React.CSSProperties = { scrollbarWidth: 'none', msOverflowStyle: 'none' };
const GRID_COLS_TRAP = '42px 58px 20px 1fr';

function SortArrow({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return null;
  return <span className="text-emerald-400 ml-[1px]">{dir === 'desc' ? '↓' : '↑'}</span>;
}

function SummaryHeader({ trap, gapper, sortKey, sortDir, onSort }: {
  trap?: boolean;
  gapper?: boolean;
  sortKey?: SortKey | null;
  sortDir?: SortDir;
  onSort?: (key: SortKey) => void;
}) {
  const hdrCls = 'cursor-pointer hover:text-slate-400 transition-colors select-none';
  if (trap) {
    return (
      <div className="grid items-center text-[7px] font-bold tracking-widest text-slate-600 uppercase pb-0.5 border-b border-white/5 mb-0.5" style={{ gridTemplateColumns: GRID_COLS_TRAP }}>
        <span className="text-center">TICKER</span><span className="text-right">CHG%</span><span className="text-center">STG</span><span />
      </div>
    );
  }
  return (
    <div className={scrollWrap} style={scrollStyle}>
      <div className="flex items-center whitespace-nowrap py-[2px] border-b border-white/5 mb-0.5">
        <span className="inline-block w-[44px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-center">TICKER</span>
        <span className="hidden md:inline-block w-[12px]" />
        <span className="inline-block w-[8px]" />
        <span className="inline-block w-[8px]" />
        <span className={`inline-block w-[22px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-center ml-1 ${hdrCls}`} onClick={() => onSort?.('cnf')}>CNF<SortArrow active={sortKey === 'cnf'} dir={sortDir || 'desc'} /></span>
        <span className={`inline-block w-[52px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-right ml-1 ${hdrCls}`} onClick={() => onSort?.('chg')}>CHG%<SortArrow active={sortKey === 'chg'} dir={sortDir || 'desc'} /></span>
        <span className="inline-block w-[42px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-right ml-2 md:ml-1">PRC</span>
        <span className={`inline-block w-[40px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-right ml-2 md:ml-1 ${hdrCls}`} onClick={() => onSort?.('rvol')}>RVOL<SortArrow active={sortKey === 'rvol'} dir={sortDir || 'desc'} /></span>
        <span className={`inline-block w-[36px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-right ml-2 md:ml-1 ${hdrCls}`} onClick={() => onSort?.('vol')}>VOL<SortArrow active={sortKey === 'vol'} dir={sortDir || 'desc'} /></span>
        <span className={`inline-block w-[42px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-right ml-2 md:ml-1 ${hdrCls}`} onClick={() => onSort?.('dvol')}>$VOL<SortArrow active={sortKey === 'dvol'} dir={sortDir || 'desc'} /></span>
        <span className={`inline-block w-[24px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-center ml-2 md:ml-1 ${hdrCls}`} onClick={() => onSort?.('rs')}>RS<SortArrow active={sortKey === 'rs'} dir={sortDir || 'desc'} /></span>
        <span className={`inline-block w-[24px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-center ml-2 md:ml-1 ${hdrCls}`} onClick={() => onSort?.('stg')}>STG<SortArrow active={sortKey === 'stg'} dir={sortDir || 'desc'} /></span>
        <span className="inline-block w-[16px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-center ml-2 md:ml-1">N</span>
      </div>
    </div>
  );
}

function TickerChip({ stock, red }: { stock: StockEntry; red?: boolean }) {
  const instanceId = React.useId();
  const { setActive, scheduleDismiss, cancelDismiss } = React.useContext(ActiveChartCtx);
  const spanRef = React.useRef<HTMLSpanElement>(null);
  const hoverDelayRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAvoid = red || stock.sentiment === 'bearish';

  const getTriggerX = () => {
    if (!spanRef.current) return 0;
    const rect = spanRef.current.getBoundingClientRect();
    return rect.left + rect.width / 2;
  };

  const activate = useCallback(() => {
    cancelDismiss();
    setActive(instanceId, stock.ticker, getTriggerX(), spanRef.current);
  }, [instanceId, stock.ticker, setActive, cancelDismiss]);

  const handleEnter = useCallback(() => {
    cancelDismiss();
    prefetchChart(stock.ticker);
    if (hoverDelayRef.current) clearTimeout(hoverDelayRef.current);
    hoverDelayRef.current = setTimeout(activate, HOVER_DELAY_MS);
  }, [cancelDismiss, activate, stock.ticker]);

  const handleLeave = useCallback(() => {
    if (hoverDelayRef.current) { clearTimeout(hoverDelayRef.current); hoverDelayRef.current = null; }
    scheduleDismiss();
  }, [scheduleDismiss]);

  const handleTap = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    setActive(instanceId, stock.ticker, getTriggerX(), spanRef.current);
    requestAnimationFrame(() => {
      if (!spanRef.current) return;
      const isMob = typeof window !== 'undefined' && window.innerWidth < 768;
      const popupBottom = isMob ? 400 : 500;
      const section = spanRef.current.closest('.rounded-r-xl, .rounded-2xl, [data-chart-section]') as HTMLElement | null;
      const target = section || spanRef.current;
      const rect = target.getBoundingClientRect();
      if (rect.top < popupBottom + 20) {
        autoScrollRef.current = true;
        scrollingRef.current = true;
        const targetScroll = window.scrollY + rect.top - popupBottom - 12;
        window.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
        setTimeout(() => { autoScrollRef.current = false; scrollingRef.current = false; }, 800);
      }
    });
  }, [instanceId, stock.ticker, setActive]);

  return (
    <span
      ref={spanRef}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onClick={(e) => { e.stopPropagation(); activate(); }}
      onTouchEnd={handleTap}
      className={`${gridChipCls(stock.grade, isAvoid)} cursor-default w-[38px] md:w-[44px]`}
    >
      {stock.ticker}
    </span>
  );
}

function SummaryRow({ item, stock, showNote, red }: { item: SummaryItem; stock?: StockEntry; showNote?: boolean; red?: boolean }) {
  const dolVol = (item.dvol != null) ? item.dvol : (item.price && item.vol) ? item.price * item.vol : null;
  const rv = item.rvol;
  const rs = item.rs;
  return (
    <div className={scrollWrap} style={scrollStyle}>
      <div className="flex items-center whitespace-nowrap py-[1px]">
        {stock ? <TickerChip stock={stock} red={red} /> : <TickerChartHover symbol={item.ticker}><span className={`${red ? TICKER_CHIP_RED : TICKER_CHIP} w-[44px]`}>{item.ticker}</span></TickerChartHover>}
        <span className="hidden md:inline-block w-[12px]" />
        <span className="inline-block w-[8px]" />
        <span className="inline-block w-[8px]" />
        <span className="inline-block w-[22px] text-center ml-1">{item.score != null ? <span className={`text-[7px] font-bold tabular-nums rounded border w-[22px] leading-[14px] text-center inline-block ${cnfBadgeCls(Number(item.score) || 0)}`}>{item.score}</span> : ''}</span>
        <span className={`text-[9px] tabular-nums font-semibold inline-block w-[52px] text-right ml-1 ${(item.changePct || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{item.changePct != null ? `${(item.changePct || 0) >= 0 ? '+' : ''}${item.changePct.toFixed(2)}%` : ''}</span>
        <span className="text-[9px] tabular-nums inline-block w-[42px] text-right text-slate-300 ml-2 md:ml-1">{fmtPrice(item.price)}</span>
        <span className={`text-[9px] tabular-nums font-semibold inline-block w-[40px] text-right ml-2 md:ml-1 ${rv != null ? rvolColor(rv) : ''}`}>{rv != null ? `${rv < 1 ? rv.toFixed(1) : Math.round(rv)}x` : ''}</span>
        <span className={`text-[9px] tabular-nums inline-block w-[36px] text-right ml-2 md:ml-1 text-slate-400`}>{item.vol != null ? formatVol(item.vol) : ''}</span>
        <span className={`text-[9px] tabular-nums inline-block w-[42px] text-right ml-2 md:ml-1 text-slate-300`}>{dolVol != null ? `$${formatVol(dolVol)}` : ''}</span>
        <span className="inline-block w-[24px] text-center ml-2 md:ml-1">{rs != null ? <span className={`text-[7px] font-bold tabular-nums rounded border w-[22px] leading-[14px] text-center inline-block ${rsBadge(rs)}`}>{rs}</span> : ''}</span>
        <span className="inline-block w-[24px] text-center ml-2 md:ml-1">{item.stage ? <span className={`text-[7px] font-bold tabular-nums rounded border w-[22px] leading-[14px] text-center inline-block ${stageBadge(item.stage)}`}>{stripStage(item.stage)}</span> : ''}</span>
        <span className="inline-block w-[16px] text-center ml-2 md:ml-1"><NewsStars count={newsStars(stock || item as any)} url={(stock || item as any)?.catalystUrl} /></span>
      </div>
    </div>
  );
}

function TrapRow({ item, stock }: { item: SummaryItem; stock?: StockEntry }) {
  return (
    <div className={`grid items-center gap-x-1 py-[1px] text-[9px] tabular-nums`} style={{ gridTemplateColumns: GRID_COLS_TRAP }}>
      {stock ? <TickerChip stock={stock} red /> : <TickerChartHover symbol={item.ticker}><span className={TICKER_CHIP_RED}>{item.ticker}</span></TickerChartHover>}
      <span className={`font-semibold text-right ${(item.changePct || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{item.changePct != null ? `${(item.changePct || 0) >= 0 ? '+' : ''}${item.changePct.toFixed(2)}%` : ''}</span>
      <span className={`text-[9px] font-bold text-center ${item.stage ? stageColor(item.stage) : 'text-slate-600'}`}>{item.stage ? stripStage(item.stage) : ''}</span>
      <span className="text-[9px] text-slate-600 italic truncate">{item.note || ''}</span>
    </div>
  );
}

function ActionableSummary({ summary, trades, avoidStocks, sortKey, sortDir, onSort }: {
  summary: SummaryBlock;
  trades?: StockEntry[];
  avoidStocks?: StockEntry[];
  sortKey: SortKey | null;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const rawTop2 = trades?.slice(0, 2) || [];
  const rawWatchlist = trades?.slice(2, 7) || [];
  const top2 = sortKey ? sortStocks(rawTop2, sortKey, sortDir) : rawTop2;
  const watchlist = sortKey ? sortStocks(rawWatchlist, sortKey, sortDir) : rawWatchlist;
  const rawTraps = avoidStocks?.slice(0, 5) || [];
  const traps = sortKey ? sortStocks(rawTraps, sortKey, sortDir) : rawTraps;

  function toItem(s: StockEntry, note?: string): SummaryItem {
    return {
      ticker: s.ticker, setup: s.setup, score: s.score, grade: s.grade,
      rs: s.rs, changePct: s.changePct, rvol: s.rvol, adrPct: s.adrPct,
      vol: s.vol, dvol: s.dvol, price: s.price, trigger: s.trigger,
      rMultiple: s.rMultiple, stage: s.stage, note,
    };
  }

  function watchNote(s: StockEntry): string {
    if (s.setup === 'VCP') return 'wait for pivot breakout';
    if (s.setup === 'COIL') return 'wait for range expansion';
    if (s.setup === 'SWING') return 'wait for StochK reversal';
    return 'needs confirmation';
  }

  return (
    <SectionCard title="Actionable Summary" accent="#34d399">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 lg:gap-4">
        <div className="py-2 md:py-3">
          <div className="text-[9px] font-bold text-slate-500 tracking-wider uppercase mb-2">
            Highest Conviction
          </div>
          <SummaryHeader sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
          {top2.map((s, i) => (
            <SummaryRow key={i} item={toItem(s)} stock={s} showNote={false} />
          ))}
          {top2.some(s => s.thesis) && (
            <div className="mt-2 border-t border-white/[0.04] pt-2">
              {top2.filter(s => s.thesis).map((s, i) => (
                <p key={i} className={`text-[10px] text-slate-400 leading-relaxed pl-1${i > 0 ? ' border-t border-white/[0.04] pt-2 mt-2' : ''}`}>
                  <TickerChartHover symbol={s.ticker}><span className={MINI_CHIP}>{s.ticker}</span></TickerChartHover>{s.thesis}
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="py-2 md:py-3">
          <div className="text-[9px] font-bold text-slate-500 tracking-wider uppercase mb-2">
            Watchlist — Not Yet Actionable
          </div>
          <SummaryHeader sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
          {watchlist.map((s, i) => (
            <SummaryRow key={i} item={toItem(s, watchNote(s))} stock={s} showNote />
          ))}
          {watchlist.some(s => s.thesis) && (
            <div className="mt-2 border-t border-white/[0.04] pt-2">
              {watchlist.filter(s => s.thesis).map((s, i) => (
                <p key={i} className={`text-[10px] text-slate-400 leading-relaxed pl-1${i > 0 ? ' border-t border-white/[0.04] pt-2 mt-2' : ''}`}>
                  <TickerChartHover symbol={s.ticker}><span className={MINI_CHIP}>{s.ticker}</span></TickerChartHover>{s.thesis}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>

      {traps.length > 0 && (
        <div className="py-2 md:py-3 mt-4">
          <div className="text-[9px] font-bold text-slate-500 tracking-wider uppercase mb-2">
            Traps to Avoid
          </div>
          <SummaryHeader sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
          {traps.map((s, i) => (
            <SummaryRow key={i} item={toItem(s)} stock={s} red />
          ))}
          {traps.some(s => s.reason) && (
            <div className="mt-2 border-t border-white/[0.04] pt-2">
              {traps.filter(s => s.reason).map((s, i) => (
                <p key={i} className={`text-[10px] text-slate-400 leading-relaxed pl-1${i > 0 ? ' border-t border-white/[0.04] pt-2 mt-2' : ''}`}>
                  <TickerChartHover symbol={s.ticker}><span className={MINI_CHIP_RED}>{s.ticker}</span></TickerChartHover>{s.reason}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

function AnalystCard({ stock, rank }: { stock: StockEntry; rank: number }) {
  const isPositive = stock.changePct >= 0;
  const isAvoid = stock.sentiment === 'bearish';
  const borderColor = isAvoid ? 'border-l-rose-500/60' : 'border-l-emerald-500/60';
  const bgColor = isAvoid ? 'bg-rose-500/[0.04]' : 'bg-[#0a1018]';
  const setupCls = stock.setup ? (SETUP_COLORS[stock.setup] || DEFAULT_SETUP_CLS) : '';

  return (
    <div className={`md:border-l-[3px] ${borderColor} ${bgColor} rounded-r-xl px-1.5 md:px-5 py-3 md:py-4`}>
      <div className="flex items-center gap-2 md:gap-3 flex-wrap mb-2 md:mb-3">
        <TickerChartHover symbol={stock.ticker}><span className={isAvoid ? TICKER_CHIP_RED : TICKER_CHIP}>{stock.ticker}</span></TickerChartHover>

        {stock.score != null && (
          <span className={`text-[7px] font-bold tabular-nums rounded border w-[20px] md:w-[22px] leading-[14px] text-center inline-block ${cnfBadgeCls(stock.score)}`}>
            {stock.score}
          </span>
        )}
        {stock.setup && (
          <span className={`text-[9px] font-bold px-1 py-[1px] rounded border uppercase tracking-wide ${setupCls}`}>
            {stock.setup}
          </span>
        )}

        <span className={`text-[9px] font-semibold tabular-nums ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
          {isPositive ? '+' : ''}{stock.changePct.toFixed(2)}%
        </span>

        {stock.rvol != null && (
          <span className="text-[9px] tabular-nums">
            <span className="text-[8px] text-slate-500">RVOL</span> <span className={`font-semibold ${rvolColor(stock.rvol)}`}>{stock.rvol < 1 ? stock.rvol.toFixed(1) : Math.round(stock.rvol)}x</span>
          </span>
        )}

        {stock.vol != null && formatVol(stock.vol) && (
          <span className="text-[9px] text-slate-400 tabular-nums">
            <span className="text-[8px] text-slate-500">Vol</span> <span className="text-slate-300 font-semibold">{formatVol(stock.vol)}</span>
          </span>
        )}

        {stock.dvol != null && (
          <span className="text-[9px] text-slate-400 tabular-nums">
            <span className="text-[8px] text-slate-500">$Vol</span> <span className="text-slate-300 font-semibold">${formatVol(stock.dvol)}</span>
          </span>
        )}

        {stock.stage && (
          <span className="text-[9px] tabular-nums">
            <span className="text-[8px] text-slate-500">STG</span> <span className={`font-semibold ${stageColor(stock.stage)}`}>{stripStage(stock.stage)}</span>
          </span>
        )}

        {stock.rs != null && (
          <span className="text-[9px] tabular-nums">
            <span className="text-[8px] text-slate-500">RS</span> <span className={`font-semibold ${rsColor(stock.rs)}`}>{stock.rs}</span>
          </span>
        )}

        {stock.adrPct != null && (
          <span className="text-[9px] text-slate-400 tabular-nums">
            <span className="text-[8px] text-slate-500">ADR</span> <span className="text-slate-300 font-semibold">{stock.adrPct.toFixed(1)}%</span>
          </span>
        )}
      </div>

      <div className="space-y-2.5">
        {stock.thesis && (
          <div className="flex gap-3">
            <span className="text-[9px] font-bold text-slate-500 tracking-wider uppercase shrink-0 w-24 pt-0.5">Core Thesis</span>
            <p className="text-[10px] text-slate-200 leading-relaxed">{renderTickerChips(stock.thesis, 0)}</p>
          </div>
        )}
        {stock.risk && (
          <div className="flex gap-3">
            <span className="text-[9px] font-bold text-amber-500/70 tracking-wider uppercase shrink-0 w-24 pt-0.5">Risk</span>
            <p className="text-[10px] text-slate-400 leading-relaxed">{stock.risk}</p>
          </div>
        )}
        {stock.invalidation && (
          <div className="flex gap-3">
            <span className="text-[9px] font-bold text-rose-500/70 tracking-wider uppercase shrink-0 w-24 pt-0.5">Invalidation</span>
            <p className="text-[10px] text-slate-400 leading-relaxed">{stock.invalidation}</p>
          </div>
        )}
      </div>

      {(stock.trigger != null || stock.stop != null || stock.target != null) && (
        <div className="flex items-center gap-4 mt-3 pt-2.5 border-t border-white/[0.04] text-[9px] tabular-nums">
          {stock.trigger != null && (
            <span className="text-slate-500">Trigger <span className="text-slate-200 font-semibold">${stock.trigger.toFixed(2)}</span></span>
          )}
          {stock.stop != null && (
            <span className="text-slate-500">Stop <span className="text-rose-400 font-semibold">${stock.stop.toFixed(2)}</span></span>
          )}
          {stock.target != null && (
            <span className="text-slate-500">Target <span className="text-emerald-400 font-semibold">${stock.target.toFixed(2)}</span></span>
          )}
          {stock.rMultiple != null && (
            <span className="text-cyan-400 font-semibold">{stock.rMultiple.toFixed(1)}R</span>
          )}
        </div>
      )}
    </div>
  );
}

const SECTION_STYLES: Record<string, { border: string; label: string }> = {
  'Futures & Macro Snapshot': { border: 'border-l-cyan-500', label: 'text-cyan-400' },
  'Key News & Catalysts': { border: 'border-l-violet-500', label: 'text-violet-400' },
  'Top Sectors & Money Flow': { border: 'border-l-amber-400', label: 'text-amber-400' },
  'Pre-Market Gappers': { border: 'border-l-emerald-500', label: 'text-emerald-400' },
  'Intraday Movers': { border: 'border-l-emerald-500', label: 'text-emerald-400' },
  'Post-Market Gappers': { border: 'border-l-emerald-500', label: 'text-emerald-400' },
  'Stocks in Play Today': { border: 'border-l-indigo-400', label: 'text-indigo-400' },
  'Economic Data & Catalysts Today': { border: 'border-l-orange-400', label: 'text-orange-400' },
  "Today's Earnings Calendar": { border: 'border-l-lime-400', label: 'text-lime-400' },
};

function GapperRow({ s, red }: { s: StockEntry; red?: boolean }) {
  const dolVol = s.dvol != null ? s.dvol : (s.price && s.vol) ? s.price * s.vol : null;
  return (
    <div className={scrollWrap} style={scrollStyle}>
      <div className="flex items-center whitespace-nowrap py-[1px]">
        <TickerChip stock={s} red={red} />
        <span className="hidden md:inline-block w-[12px]" />
        <span className="inline-block w-[8px]" />
        <span className="inline-block w-[8px]" />
        <span className="inline-block w-[22px] text-center ml-1">{s.score != null ? <span className={`text-[7px] font-bold tabular-nums rounded border w-[22px] leading-[14px] text-center inline-block ${cnfBadgeCls(Number(s.score) || 0)}`}>{s.score}</span> : ''}</span>
        <span className={`text-[9px] tabular-nums font-semibold inline-block w-[52px] text-right ml-1 ${(s.changePct || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{(s.changePct || 0) >= 0 ? '+' : ''}{s.changePct.toFixed(2)}%</span>
        <span className="text-[9px] tabular-nums inline-block w-[42px] text-right text-slate-300 ml-2 md:ml-1">{fmtPrice(s.price)}</span>
        <span className={`text-[9px] tabular-nums font-semibold inline-block w-[40px] text-right ml-2 md:ml-1 ${s.rvol != null ? rvolColor(s.rvol) : ''}`}>{s.rvol != null ? `${s.rvol < 1 ? s.rvol.toFixed(1) : Math.round(s.rvol)}x` : ''}</span>
        <span className="text-[9px] tabular-nums inline-block w-[36px] text-right ml-2 md:ml-1 text-slate-400">{s.vol != null ? formatVol(s.vol) : ''}</span>
        <span className="text-[9px] tabular-nums inline-block w-[42px] text-right ml-2 md:ml-1 text-slate-300">{dolVol != null ? `$${formatVol(dolVol)}` : ''}</span>
        <span className="inline-block w-[24px] text-center ml-2 md:ml-1">{s.rs != null ? <span className={`text-[7px] font-bold tabular-nums rounded border w-[22px] leading-[14px] text-center inline-block ${rsBadge(s.rs)}`}>{s.rs}</span> : ''}</span>
        <span className="inline-block w-[24px] text-center ml-2 md:ml-1">{s.stage ? <span className={`text-[7px] font-bold tabular-nums rounded border w-[22px] leading-[14px] text-center inline-block ${stageBadge(s.stage)}`}>{stripStage(s.stage)}</span> : ''}</span>
        <span className="inline-block w-[16px] text-center ml-2 md:ml-1"><NewsStars count={newsStars(s as any)} url={(s as any).catalystUrl} /></span>
      </div>
    </div>
  );
}

function GapperSection({ section, gradeMap, avoidSet, scannerGainers, scannerLosers }: { section: SectionResult; gradeMap?: Record<string, 'A' | 'B'>; avoidSet?: Set<string>; scannerGainers?: StockEntry[]; scannerLosers?: StockEntry[] }) {
  const [sk, setSk] = useState<SortKey | null>('chg');
  const [sd, setSd] = useState<SortDir>('desc');
  const handleSort = useCallback((key: SortKey) => {
    if (sk === key) { if (sd === 'desc') setSd('asc'); else { setSk(null); setSd('desc'); } }
    else { setSk(key); setSd('desc'); }
  }, [sk, sd]);

  const stocks = section.stocks || [];
  const briefUps = stocks.filter(s => (s as any).direction === 'up' || (s as any).direction === 'long' || (!['down','short'].includes((s as any).direction) && ((s as any).gapPct ?? (s as any).changePct ?? 0) > 0));
  const briefDowns = stocks.filter(s => (s as any).direction === 'down' || (s as any).direction === 'short' || (!['up','long'].includes((s as any).direction) && ((s as any).gapPct ?? (s as any).changePct ?? 0) < 0));
  const seenUp = new Set(briefUps.map(s => s.ticker));
  const seenDown = new Set(briefDowns.map(s => s.ticker));
  const rawUps = [...briefUps, ...(scannerGainers || []).filter(s => !seenUp.has(s.ticker))];
  const rawDowns = [...briefDowns, ...(scannerLosers || []).filter(s => !seenDown.has(s.ticker))];
  const ups = (sk ? sortStocks(rawUps, sk, sd) : rawUps.sort((a, b) => (b.changePct || 0) - (a.changePct || 0))).slice(0, 10);
  const downDir: SortDir = sk === 'chg' ? (sd === 'desc' ? 'asc' : 'desc') : sd;
  const downs = (sk ? sortStocks(rawDowns, sk, downDir) : rawDowns.sort((a, b) => (a.changePct || 0) - (b.changePct || 0))).slice(0, 10);

  return (
    <SectionCard title={section.section || 'Top Movers'} accent="#34d399">
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 md:gap-3">

      {ups.length > 0 && (
        <div className="py-2 md:py-3">
          <div className="text-[9px] font-bold text-emerald-400 tracking-wider uppercase mb-2">
            Movers Up
          </div>
          <div className={scrollWrap} style={scrollStyle}>
            <SummaryHeader gapper sortKey={sk} sortDir={sd} onSort={handleSort} />
            {ups.map((s, i) => <GapperRow key={i} s={s} red={avoidSet?.has(s.ticker)} />)}
          </div>
        </div>
      )}
      {downs.length > 0 && (
        <div className="py-2 md:py-3">
          <div className="text-[9px] font-bold text-rose-400 tracking-wider uppercase mb-2">
            Movers Down
          </div>
          <div className={scrollWrap} style={scrollStyle}>
            <SummaryHeader gapper sortKey={sk} sortDir={sd} onSort={handleSort} />
            {downs.map((s, i) => <GapperRow key={i} s={s} red />)}
          </div>
        </div>
      )}
    </div>
    {section.analysis && (
      <div className="mt-3 pt-3 border-t border-white/[0.04]">
        <div className="text-[8px] font-bold text-slate-500 tracking-wider uppercase mb-1">WIM</div>
        <div className="text-[10px] text-slate-200 leading-[1.7]">
          {section.analysis.split(/\n\n+/).filter(p => p.trim()).map((block, i) => (
            <div key={i} className={i > 0 ? 'pt-3 mt-3 border-t border-white/[0.06]' : ''}>
              <p className="leading-[1.7]">{highlightBold(block.replace(/\n/g, ' '), 'text-white', true, true, gradeMap, avoidSet)}</p>
            </div>
          ))}
        </div>
      </div>
    )}
    </SectionCard>
  );
}

function SIPSection({ section, gradeMap, avoidSet }: { section: SectionResult; gradeMap?: Record<string, 'A' | 'B'>; avoidSet?: Set<string> }) {
  const [sk, setSk] = useState<SortKey | null>('chg');
  const [sd, setSd] = useState<SortDir>('desc');
  const handleSort = useCallback((key: SortKey) => {
    if (sk === key) { if (sd === 'desc') setSd('asc'); else { setSk(null); setSd('desc'); } }
    else { setSk(key); setSd('desc'); }
  }, [sk, sd]);

  const rawStocks = section.stocks || [];
  const stocks = sk ? sortStocks(rawStocks, sk, sd) : rawStocks;
  return (
    <SectionCard title={section.section} accent={SECTION_ACCENT[section.section] || '#818cf8'}>
      {stocks.length > 0 && (() => {
        const top10 = stocks.slice(0, 10);
        const left = top10.slice(0, Math.ceil(top10.length / 2));
        const right = top10.slice(Math.ceil(top10.length / 2));
        const renderCol = (list: typeof stocks) => list.map((s, i) => {
          const setupLabel = s.setup && s.setup.toUpperCase() !== 'GENERIC' ? s.setup : null;
          const dolVol = s.dvol != null ? s.dvol : (s.price && s.vol) ? s.price * s.vol : null;
          return (
            <div key={i} className={scrollWrap} style={scrollStyle}>
              <div className="flex items-center whitespace-nowrap py-[1px]">
                <TickerChip stock={s} red={avoidSet?.has(s.ticker)} />
                <span className="inline-block w-[12px]" />
                <span className="inline-block w-[8px]" />
                <span className="inline-block w-[8px]" />
                <span className="inline-block w-[20px] md:w-[22px] text-center ml-1">{s.score != null ? <span className={`text-[7px] font-bold tabular-nums rounded border w-[20px] md:w-[22px] leading-[14px] text-center inline-block ${cnfBadgeCls(Number(s.score) || 0)}`}>{s.score}</span> : ''}</span>
                <span className={`text-[9px] tabular-nums font-semibold inline-block w-[46px] md:w-[52px] text-right ${(s.changePct || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{(s.changePct || 0) >= 0 ? '+' : ''}{s.changePct.toFixed(2)}%</span>
                <span className="text-[9px] tabular-nums inline-block w-[36px] md:w-[42px] text-right text-slate-300 ml-1">{fmtPrice(s.price)}</span>
                <span className={`text-[9px] tabular-nums font-semibold inline-block w-[36px] md:w-[40px] text-right ml-1 ${s.rvol != null ? rvolColor(s.rvol) : ''}`}>{s.rvol != null ? `${s.rvol < 1 ? s.rvol.toFixed(1) : Math.round(s.rvol)}x` : ''}</span>
                <span className="text-[9px] tabular-nums inline-block w-[30px] md:w-[36px] text-right ml-1 text-slate-400">{s.vol != null ? formatVol(s.vol) : ''}</span>
                <span className="text-[9px] tabular-nums inline-block w-[36px] md:w-[40px] text-right ml-1 text-slate-300">{dolVol != null ? `$${formatVol(dolVol)}` : ''}</span>
                <span className="inline-block w-[22px] md:w-[24px] text-center ml-1">{s.rs != null ? <span className={`text-[7px] font-bold tabular-nums rounded border w-[20px] md:w-[22px] leading-[14px] text-center inline-block ${rsBadge(s.rs)}`}>{s.rs}</span> : ''}</span>
                <span className="inline-block w-[22px] md:w-[24px] text-center ml-1">{s.stage ? <span className={`text-[7px] font-bold tabular-nums rounded border w-[20px] md:w-[22px] leading-[14px] text-center inline-block ${stageBadge(s.stage)}`}>{stripStage(s.stage)}</span> : ''}</span>
                <span className="inline-block w-[14px] md:w-[16px] text-center ml-1"><NewsStars count={newsStars(s as any)} url={(s as any).catalystUrl} /></span>
              </div>
            </div>
          );
        });
        return (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-3 lg:gap-x-6">
            <div className={scrollWrap} style={scrollStyle}>
              <SummaryHeader sortKey={sk} sortDir={sd} onSort={handleSort} />
              {renderCol(left)}
            </div>
            <div className={scrollWrap} style={scrollStyle}>
              <SummaryHeader sortKey={sk} sortDir={sd} onSort={handleSort} />
              {renderCol(right)}
            </div>
          </div>
        );
      })()}
      {section.analysis && (
        <div className="mt-3 pt-3 border-t border-white/[0.04]">
          <div className="text-[10px] text-slate-200 leading-[1.7]">
            {section.analysis.split(/\n\n+/).filter(p => p.trim()).map((block, i) => (
              <div key={i} className={i > 0 ? 'pt-3 mt-3 border-t border-white/[0.06]' : ''}>
                <p className="leading-[1.7]">{highlightBold(block.replace(/\n/g, ' '), 'text-white', true, true, gradeMap, avoidSet)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

const BOLD_TERMS = new Set([
  'FOMC','Fed','Federal Reserve','ECB','BOJ','BOE','PBOC','SEC','FDIC',
  'CPI','PPI','GDP','NFP','PCE','ISM','PMI','JOLTS','EIA','OPEC',
  'T2108','A/D',
  'Bitcoin','Ethereum','Gold','Silver','Crude Oil','Natural Gas','Copper','Treasury','Treasuries',
  'Healthcare','Health Care','Technology','Consumer Staples','Consumer Discretionary',
  'Energy','Financials','Materials','Industrials','Utilities','Real Estate','Communication Services',
  'Bias','Breadth','Momentum','Initial Claims','Philly Fed','Empire State',
]);
const BOLD_RX = new RegExp(`\\b(${Array.from(BOLD_TERMS).sort((a, b) => b.length - a.length).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'g');

function autoBold(segment: string, keyBase: number): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  BOLD_RX.lastIndex = 0;
  while ((m = BOLD_RX.exec(segment)) !== null) {
    if (m.index > last) parts.push(segment.slice(last, m.index));
    parts.push(<span key={keyBase + m.index} className="font-semibold text-slate-100">{m[0]}</span>);
    last = m.index + m[0].length;
  }
  if (last < segment.length) parts.push(segment.slice(last));
  if (last === 0) return [segment];
  return parts;
}

function richText(text: string, withTickers = false, gradeMap?: Record<string, 'A' | 'B'>, avoidSet?: Set<string>): React.ReactNode {
  const cleaned = text.replace(/\s*—\s*/g, '. ').replace(/\.\.\s/g, '. ');
  const boldParts = cleaned.split(/\*\*/);
  const elements: React.ReactNode[] = [];
  for (let i = 0; i < boldParts.length; i++) {
    const part = boldParts[i];
    if (!part) continue;
    if (i % 2 === 1) {
      const colored = colorPcts(part, i * 100);
      const rendered = withTickers
        ? colored.map((c, j) => typeof c === 'string' ? renderTickerChips(c, i * 1000 + j * 100, gradeMap, avoidSet) : c)
        : colored;
      elements.push(<span key={`b${i}`} className="font-semibold text-slate-100">{rendered}</span>);
    } else {
      const colored = colorPcts(part, i * 100);
      const processed = withTickers
        ? colored.map((c, j) => typeof c === 'string' ? renderTickerChips(c, i * 1000 + j * 100, gradeMap, avoidSet) : c)
        : colored;
      const flat = (Array.isArray(processed) ? processed : [processed]).flat();
      for (let k = 0; k < flat.length; k++) {
        const item = flat[k];
        if (typeof item === 'string') {
          elements.push(...autoBold(item, i * 10000 + k * 1000));
        } else {
          elements.push(<React.Fragment key={`r${i}-${k}`}>{item}</React.Fragment>);
        }
      }
    }
  }
  return <>{elements}</>;
}

function parseLabeled(text: string): { label: string; value: string; detail: string }[] {
  const rows: { label: string; value: string; detail: string }[] = [];
  const lines = text.split('\n').filter(l => l.trim());
  for (const line of lines) {
    const m = line.match(/^\*{0,2}([A-Za-z0-9\s/&']+?)\*{0,2}:(?!\d)\s*(.+)/);
    if (!m || m[1].trim().length > 15) continue;
    const label = m[1].trim().replace(/\*+/g, '');
    const rest = m[2].replace(/\*+/g, '').trim();
    const dashIdx = rest.indexOf(' — ');
    if (dashIdx > 0) {
      rows.push({ label, value: rest.slice(0, dashIdx).trim(), detail: rest.slice(dashIdx + 3).trim() });
    } else {
      rows.push({ label, value: rest, detail: '' });
    }
  }
  return rows;
}

function FormattedBlock({ text, tickers, summaryLabel, skipLabels, distributeLabel, gradeMap, avoidSet }: { text: string; tickers?: boolean; summaryLabel?: string; skipLabels?: RegExp; distributeLabel?: RegExp; gradeMap?: Record<string, 'A' | 'B'>; avoidSet?: Set<string> }) {
  let parsed = parseLabeled(text);
  if (skipLabels) parsed = parsed.filter(r => !skipLabels.test(r.label));

  if (distributeLabel) {
    const sourceRow = parsed.find(r => distributeLabel.test(r.label));
    if (sourceRow) {
      const sourceText = sourceRow.value + (sourceRow.detail ? ' ' + sourceRow.detail : '');
      const sentences = sourceText.split(/(?<=\.[""”]?)\s+(?=[A-Z])/).map(s => s.trim()).filter(Boolean);
      const NOISE = new Set(['SIGNAL', 'GREEN', 'RED', 'MA', 'AND', 'THE', 'NOT', 'EMA', 'SMA']);
      const otherRows = parsed.filter(r => r !== sourceRow);
      for (const sentence of sentences) {
        for (const row of otherRows) {
          const rowTickers = new Set(
            (row.value.match(/\b[A-Z]{2,5}\b/g) || []).filter(t => !NOISE.has(t))
          );
          if (rowTickers.size > 0 && Array.from(rowTickers).some(t => sentence.includes(t))) {
            let cleaned = sentence;
            for (const t of rowTickers) {
              cleaned = cleaned.replace(new RegExp(`${t}(?:[''’]s)?\\s+at\\s+\\$?[\\d.,]+\\s*\\([+-]?[\\d.]+%\\)\\s*`, 'g'), '');
              cleaned = cleaned.replace(new RegExp(`${t}(?:[''’]s)?\\s+[+-][\\d.]+%,?\\s*`, 'g'), '');
              cleaned = cleaned.replace(new RegExp(`\\b${t}\\b(?:[''’]s)?\\s*`, 'g'), '');
            }
            cleaned = cleaned.replace(/\(\s*[,\s]*\)/g, '');
            cleaned = cleaned.replace(/,\s*,/g, ',');
            cleaned = cleaned.replace(/^\s*[,;]\s*/, '');
            cleaned = cleaned.replace(/\s+/g, ' ').trim();
            if (cleaned) {
              cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
              row.detail = row.detail ? row.detail + ' ' + cleaned : cleaned;
            }
            break;
          }
        }
      }
      parsed = parsed.filter(r => r !== sourceRow);
    }
  }

  if (parsed.length === 0) {
    const paragraphs = text.split(/\n\n+/).map(p => p.replace(/\n/g, ' ').trim()).filter(Boolean);
    return (
      <div className="space-y-0">
        {paragraphs.map((para, i) => (
          <div key={i} className={i > 0 ? 'pt-3 mt-3 border-t border-white/[0.06]' : ''}>
            <p className="text-[10px] text-slate-200 leading-[1.7]">
              {richText(para, tickers, gradeMap, avoidSet)}
            </p>
          </div>
        ))}
      </div>
    );
  }

  const summary = parsed.find(r => /^(overall|takeaway|summary)/i.test(r.label));
  const metrics = parsed.filter(r => r !== summary);

  return (
    <div className="space-y-1.5 md:space-y-2">
      {metrics.map((r, i) => (
        <div key={i} className={i > 0 ? 'pt-3 mt-3 border-t border-white/[0.06]' : ''}>
          <div className="text-[10px] font-bold text-slate-500 tracking-wider uppercase mb-1.5">{r.label}</div>
          <p className="text-[10px] text-slate-200 leading-[1.7]">
            {richText(r.value, tickers, gradeMap, avoidSet)}
          </p>
          {r.detail && (
            <p className="text-[10px] text-slate-300 leading-[1.7] mt-2">
              {richText(r.detail.charAt(0).toUpperCase() + r.detail.slice(1), tickers, gradeMap, avoidSet)}
            </p>
          )}
        </div>
      ))}
      {summary && (
        <div className="pt-3 mt-3 border-t border-white/[0.06]">
          <div className="text-[10px] font-bold text-slate-500 tracking-wider uppercase mb-2">{summaryLabel || summary.label}</div>
          <p className="text-[10px] text-slate-200 leading-[1.7]">
            {richText(summary.value + (summary.detail ? ' — ' + summary.detail : ''), tickers, gradeMap, avoidSet)}
          </p>
        </div>
      )}
    </div>
  );
}

/* ---- Key Events section (econ + earnings, same data as main dashboard) ---- */
interface EconEvent { event: string; date: string; actual: number | null; previous: number | null; estimate: number | null; impact: string }
interface EarningsEvent { symbol: string; date: string; name: string; epsEstimated?: number | null; revenueEstimated?: number | null; epsActual?: number | null; epsSurprisePct?: number | null; mktCap?: number }

function KeyEventsSection() {
  const [econ, setEcon] = useState<EconEvent[]>([]);
  const [earnings, setEarnings] = useState<EarningsEvent[]>([]);

  useEffect(() => {
    Promise.all([
      fetch('/api/econ', { cache: 'no-store' }).then(r => r.ok ? r.json() : []).catch(() => []),
      fetch('/api/earnings', { cache: 'no-store' }).then(r => r.ok ? r.json() : { events: [] }).catch(() => ({ events: [] })),
    ]).then(([econData, earningsData]) => {
      if (Array.isArray(econData)) setEcon(econData);
      const list: any[] = Array.isArray(earningsData) ? earningsData : (earningsData?.events ?? []);
      setEarnings(list);
    });
  }, []);

  const getEtDate = (offset = 0) => {
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const getNowMinutes = () => {
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    return d.getHours() * 60 + d.getMinutes();
  };

  const today = getEtDate(0);
  const tomorrow = getEtDate(1);
  const nowMin = getNowMinutes();

  const parseTime = (s: string): number | null => {
    const m = String(s || '').match(/(\d{2}):(\d{2})/);
    return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : null;
  };
  const fmtTime = (min: number | null) => {
    if (min == null) return '';
    const h = Math.floor(min / 60) % 12 || 12;
    const mm = String(min % 60).padStart(2, '0');
    return `${h}:${mm} ${min >= 720 ? 'PM' : 'AM'}`;
  };
  const fmtNum = (v: number | null | undefined) => {
    if (v == null) return '—';
    const abs = Math.abs(v);
    if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
    return String(v);
  };

  const econToday = econ
    .map(e => ({ ...e, minutes: parseTime(e.date) }))
    .filter(e => e.date.startsWith(today) && e.impact !== 'Low')
    .sort((a, b) => (a.minutes ?? 0) - (b.minutes ?? 0));

  const earnFiltered = earnings
    .filter(e => {
      const dk = e.date?.slice(0, 10);
      const cap = (e as any).mktCap ?? 0;
      return (dk === today || dk === tomorrow) && cap >= 20e9;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const todayEarn = earnFiltered.filter(e => e.date?.slice(0, 10) === today);
  const tmrwEarn = earnFiltered.filter(e => e.date?.slice(0, 10) === tomorrow);

  if (econToday.length === 0 && earnFiltered.length === 0) return null;

  const impactCls = (i: string) => i === 'High' ? 'text-rose-400' : i === 'Medium' ? 'text-amber-400' : 'text-slate-500';
  const hdrCls = 'text-[7px] font-bold tracking-widest uppercase text-slate-600';

  const scrollCls = "overflow-x-auto overflow-y-hidden -mx-0.5 px-0.5";

  /* One set of column widths for the earnings header and every row under it,
     reported or pending. Changing a width here moves both together. */
  const EARN_W_MARK = 'w-[10px]';
  const EARN_W_TICKER = 'w-[56px] md:w-[64px]';
  const EARN_W_STATUS = 'w-[44px]';
  const EARN_W_EPS = 'w-[52px]';
  const EARN_W_EST = 'w-[46px]';
  const EARN_W_SURP = 'w-[54px]';
  const EARN_W_REV = 'w-[68px]';
  const EARN_ROW_W = 'min-w-[344px]';
  const scrollSty: React.CSSProperties = { scrollbarWidth: 'none', msOverflowStyle: 'none' };

  const renderEarnRow = (e: EarningsEvent, i: number) => {
    const pending = e.epsActual == null;
    const beat = !pending && e.epsEstimated != null && e.epsActual != null && e.epsActual >= e.epsEstimated;
    const surprise = e.epsSurprisePct != null ? `(${e.epsSurprisePct > 0 ? '+' : ''}${e.epsSurprisePct.toFixed(1)}%)` : '';
    const fmtRev = (v: number | null | undefined): string => {
      if (v == null) return '';
      if (v >= 1e9) return `rev ${(v / 1e9).toFixed(1)}B`;
      if (v >= 1e6) return `rev ${(v / 1e6).toFixed(0)}M`;
      return '';
    };
    /* Reported and pending rows share one column grid. They used to be two
       different shapes — BEAT rows carried an extra status word and a "vs"
       comparison, pending rows carried a trailing revenue figure — so no two
       adjacent rows lined up and neither matched the header. */
    return (
      <div key={i} className={scrollCls} style={scrollSty}>
        <div className={`flex items-center whitespace-nowrap py-[1px] ${EARN_ROW_W}`}>
          <span className={`inline-block ${EARN_W_MARK} text-[9px] ${pending ? 'text-amber-400' : 'text-transparent'}`}>{pending ? '▸' : ''}</span>
          <span className={`inline-block ${EARN_W_TICKER}`}>
            <TickerChartHover symbol={e.symbol}><span className={`${BRIEF_TICKER_CHIP} w-[48px] md:w-[56px]`}>{e.symbol}</span></TickerChartHover>
          </span>
          <span className={`inline-block ${EARN_W_STATUS} text-center`}>
            {!pending && (
              <span
                className={`inline-block text-[8px] font-bold tracking-wider uppercase px-1.5 py-[1px] rounded border ${
                  beat
                    ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                    : 'text-rose-400 bg-rose-500/10 border-rose-500/20'
                }`}
              >
                {beat ? 'Beat' : 'Miss'}
              </span>
            )}
          </span>
          <span className={`inline-block ${EARN_W_EPS} text-right text-[9px] tabular-nums font-semibold ${pending ? 'text-slate-300' : 'text-slate-200'}`}>
            {pending ? (e.epsEstimated?.toFixed(2) ?? '—') : e.epsActual?.toFixed(2)}
          </span>
          <span className={`inline-block ${EARN_W_EST} text-right text-[9px] tabular-nums font-semibold ${pending ? 'text-slate-600' : 'text-slate-400'}`}>
            {pending ? 'est' : e.epsEstimated?.toFixed(2) ?? '—'}
          </span>
          <span className={`inline-block ${EARN_W_SURP} text-right text-[9px] tabular-nums font-medium ${beat ? 'text-emerald-400/70' : 'text-rose-400/70'}`}>
            {pending ? '' : surprise}
          </span>
          <span className={`inline-block ${EARN_W_REV} text-right text-[9px] text-slate-500`}>
            {fmtRev(e.revenueEstimated) || ''}
          </span>
        </div>
      </div>
    );
  };

  const pendingEcon = econToday.filter(e => e.minutes != null && e.minutes > nowMin && e.actual == null);
  const highPending = pendingEcon.filter(e => e.impact === 'High');

  return (
    <SectionCard title="Key Events" accent="#fbbf24">
      <p className="text-[8px] text-slate-500 font-medium leading-snug mb-3">
        Today&apos;s releases and large-cap prints. ▸ marks what has not happened yet. The only forward-looking macro section.
      </p>
      {/* Economic (left) + Earnings (right) — side by side */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-y-3 md:gap-y-5">
        <div className="space-y-0 overflow-x-auto pr-4" style={scrollSty}>
          <p className="text-[9px] font-bold tracking-wider uppercase text-slate-500 pb-0.5">
            Economic {pendingEcon.length ? `— ${pendingEcon.length} still ahead` : '— all printed'}
          </p>
          <div className={scrollCls} style={scrollSty}>
            <div className="flex items-center whitespace-nowrap py-[2px] border-b border-white/5 mb-0.5">
              <span className="inline-block w-[10px]" />
              <span className={`inline-block w-[62px] md:w-[68px] ${hdrCls} ml-1`}>TIME</span>
              <span className={`inline-block w-[180px] md:w-[240px] ${hdrCls}`}>EVENT</span>
              <span className={`inline-block w-[52px] md:w-[60px] ${hdrCls} text-right ml-3`}>ACT</span>
              <span className={`inline-block w-[52px] md:w-[60px] ${hdrCls} text-right ml-1`}>EST</span>
              <span className={`inline-block w-[52px] md:w-[60px] ${hdrCls} text-right ml-1`}>PREV</span>
            </div>
          </div>
          {econToday.map((e, i) => {
            const isPending = e.minutes != null && e.minutes > nowMin && e.actual == null;
            return (
              <div key={i} className={scrollCls} style={scrollSty}>
                <div className="flex items-center whitespace-nowrap py-[1px]">
                  <span className={`inline-block w-[10px] text-[9px] ${isPending ? 'text-amber-400' : 'text-slate-600'}`}>{isPending ? '▸' : '∅'}</span>
                  <span className="inline-block w-[62px] md:w-[68px] text-[9px] tabular-nums font-semibold text-slate-400 ml-1">{fmtTime(e.minutes)}</span>
                  <span className={`inline-block w-[180px] md:w-[240px] text-[9px] font-medium truncate ${isPending ? 'text-slate-200' : impactCls(e.impact)}`}>{e.event}</span>
                  <span className={`inline-block w-[52px] md:w-[60px] text-[9px] tabular-nums font-semibold text-right ml-3 ${e.actual != null ? 'text-emerald-400' : 'text-slate-600'}`}>{fmtNum(e.actual)}</span>
                  <span className={`inline-block w-[52px] md:w-[60px] text-[9px] tabular-nums font-semibold text-right ml-1 ${e.estimate != null ? 'text-slate-300' : 'text-slate-600'}`}>{fmtNum(e.estimate)}</span>
                  <span className={`inline-block w-[52px] md:w-[60px] text-[9px] tabular-nums font-semibold text-right ml-1 ${e.previous != null ? 'text-slate-500' : 'text-slate-600'}`}>{fmtNum(e.previous)}</span>
                </div>
              </div>
            );
          })}
          {econToday.length === 0 && <p className="text-[9px] text-slate-600 py-2">Nothing scheduled today.</p>}
        </div>
        <div className="hidden md:block w-px bg-white/10 self-stretch" />
        <div className="space-y-4 pl-4">
          <div className="space-y-0">
            <p className="text-[9px] font-bold tracking-wider uppercase text-slate-500 pb-0.5">
              Today {todayEarn.filter(e => e.epsActual == null).length ? `— ${todayEarn.filter(e => e.epsActual == null).length} pending` : todayEarn.length ? '— all reported' : ''}
            </p>
            <div className={scrollCls} style={scrollSty}>
              <div className={`flex items-center whitespace-nowrap py-[2px] border-b border-white/5 mb-0.5 ${EARN_ROW_W}`}>
                <span className={`inline-block ${EARN_W_MARK}`} />
                <span className={`inline-block ${EARN_W_TICKER} ${hdrCls} text-center`}>TICKER</span>
                <span className={`inline-block ${EARN_W_STATUS} ${hdrCls} text-center`} />
                <span className={`inline-block ${EARN_W_EPS} ${hdrCls} text-right`}>EPS</span>
                <span className={`inline-block ${EARN_W_EST} ${hdrCls} text-right`}>EST</span>
                <span className={`inline-block ${EARN_W_SURP} ${hdrCls} text-right`}>SURP</span>
                <span className={`inline-block ${EARN_W_REV} ${hdrCls} text-right`}>REV</span>
              </div>
            </div>
            {todayEarn.length > 0 ? todayEarn.map(renderEarnRow) : <p className="text-[9px] text-slate-600 py-2">No large-cap prints.</p>}
          </div>
          <div className="space-y-0">
            <p className="text-[9px] font-bold tracking-wider uppercase text-slate-500 pb-0.5">
              Tomorrow {tmrwEarn.length ? `— ${tmrwEarn.length} pending` : ''}
            </p>
            <div className={scrollCls} style={scrollSty}>
              <div className={`flex items-center whitespace-nowrap py-[2px] border-b border-white/5 mb-0.5 ${EARN_ROW_W}`}>
                <span className={`inline-block ${EARN_W_MARK}`} />
                <span className={`inline-block ${EARN_W_TICKER} ${hdrCls} text-center`}>TICKER</span>
                <span className={`inline-block ${EARN_W_STATUS} ${hdrCls} text-center`} />
                <span className={`inline-block ${EARN_W_EPS} ${hdrCls} text-right`}>EPS</span>
                <span className={`inline-block ${EARN_W_EST} ${hdrCls} text-right`}>EST</span>
                <span className={`inline-block ${EARN_W_SURP} ${hdrCls} text-right`}>SURP</span>
                <span className={`inline-block ${EARN_W_REV} ${hdrCls} text-right`}>REV</span>
              </div>
            </div>
            {tmrwEarn.length > 0 ? tmrwEarn.map(renderEarnRow) : <p className="text-[9px] text-slate-600 py-2">No large-cap prints.</p>}
          </div>
        </div>
      </div>
      {highPending.length > 0 && (
        <p className="text-[10px] text-amber-400/70 mt-4 pt-3 border-t border-white/5">
          Setups are on a clock until this prints — breakouts into a scheduled release carry event risk the scan cannot price.
        </p>
      )}
    </SectionCard>
  );
}

const PCT_SECTIONS = new Set(['Futures & Macro Snapshot', 'Top Sectors & Money Flow']);

function BriefSection({ section }: { section: SectionResult }) {
  const style = SECTION_STYLES[section.section] || { border: 'border-l-slate-500', label: 'text-slate-400' };
  const usePct = PCT_SECTIONS.has(section.section);

  if (section.section === 'Top Sectors & Money Flow') {
    return <SectorSection section={section} />;
  }

  return (
    <div className={`md:border-l-[3px] ${style.border} bg-[#0a1220] rounded-r-lg px-5 py-4`}>
      <div className={`text-[9px] font-bold ${style.label} tracking-wider uppercase mb-3`}>
        {section.section}
      </div>
      {section.analysis && (
        <div className="text-[10px] text-slate-200 leading-[1.7]">
          {section.analysis.split(/\n\n+/).filter(p => p.trim()).map((block, i) => (
            <div key={i} className={i > 0 ? 'pt-3 mt-3 border-t border-white/[0.06]' : ''}>
              <p className="leading-[1.7]">{highlightBold(block.replace(/\n/g, ' '), 'text-slate-100', usePct, !usePct)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface SectorItem { name: string; pct: number; detail?: string }

function parseSectorItems(text: string): SectorItem[] {
  const items: SectorItem[] = [];
  /* Parentheses are OPTIONAL. The generator now writes "Technology +1.34%"
     rather than "Technology (+1.34%)", but briefs cached in KV keep the old
     shape for up to 40 minutes, and a parser that demanded the parens would
     silently return nothing for every one of them — an empty panel, no error.
     The sign is required instead, which is what actually delimits the name. */
  const re = /([A-Za-z][A-Za-z\s&/]*?)\s*\(?([+-]\d+\.?\d*)%\)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    items.push({ name: m[1].trim(), pct: parseFloat(m[2]) });
  }
  return items;
}

function parseEtfItems(text: string): SectorItem[] {
  const items: SectorItem[] = [];
  const re = /([A-Z]{2,5})\s+([+-]?\d+\.?\d*)%\s*(?:\(([^)]+)\))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    items.push({ name: m[1], pct: parseFloat(m[2]), detail: m[3]?.trim() });
  }
  return items;
}

function ChartTooltip({ symbol, children }: { symbol: string; children: React.ReactNode }) {
  return (
    <TickerChartHover symbol={symbol}>
      {children}
    </TickerChartHover>
  );
}

function SectorSection({ section, scannerData }: { section: SectionResult; scannerData?: any }) {
  const text = section.analysis || '';
  const lines = text.split('\n').filter(l => l.trim());

  let leadingRaw = '';
  let laggingRaw = '';

  for (const line of lines) {
    const stripped = line.replace(/^\*\*[^*]+\*\*:?\s*/, '');
    if (/^\*\*Leading/i.test(line.trim())) leadingRaw = stripped;
    else if (/^\*\*Lagging/i.test(line.trim())) laggingRaw = stripped;
  }

  const leading = parseSectorItems(leadingRaw);
  const lagging = parseSectorItems(laggingRaw);
  let allSectors = [...leading, ...lagging].sort((a, b) => b.pct - a.pct);

  const movers = scannerData?.topMovers || {};

  /* Dedupe before both the rows AND the share, and use the shared accessors —
     the share used to be computed over the raw concatenation with a bare
     `dVol || 0`, so an ETF listed in both Gainers and Losers counted twice and
     a row with no dVol field counted as zero dollars. */
  const etfAll = dedupeByTicker([...(movers['ETF Gainers'] || []), ...(movers['ETF Losers'] || [])]);
  const etfRows = etfAll
    .filter((e: any) => dVolOf(e) > 0)
    .sort((a: any, b: any) => Math.abs(chgOf(b)) - Math.abs(chgOf(a)))
    .slice(0, 5);

  const flowAll = dedupeByTicker([
    ...(movers['Gainers'] || []), ...(movers['Losers'] || []), ...(movers['Mega Caps'] || []),
  ]);
  const flowRows = flowAll
    .filter((s: any) => dVolOf(s) > 0)
    .sort((a: any, b: any) => Math.abs(chgOf(b)) - Math.abs(chgOf(a)))
    .slice(0, 5);

  /* Same aggregation the dashboard's Industry Heat uses — one implementation
     in lib/sectors, so the two pages cannot report different group averages. */
  const heat = industryHeat(flowAll, chgOf);

  if (allSectors.length === 0 && heat.length > 0) {
    allSectors = heat.map(h => ({ name: h.sector, pct: h.avgChg }));
  }
  const maxAbs = Math.max(...allSectors.map(s => Math.abs(s.pct)), 0.01);

  const etfAdvShare = advancingDollarShare(etfAll);
  const mfAdvShare = advancingDollarShare(flowAll);
  const totalDVol = flowAll.reduce((a: number, s: any) => a + dVolOf(s), 0);

  return (
    <SectionCard title="Sectors & Money Flow" accent="#fbbf24">
    {/* Same two rows as the dashboard: bars beside Industry Heat (the same
        groups drawn and listed), then ETF Flow beside Money Flow. */}
    <div className="space-y-2.5 md:space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 md:gap-3 items-stretch">
      {allSectors.length > 0 && (() => {
        const best = allSectors[0];
        const worst = allSectors[allSectors.length - 1];
        const spread = best.pct - worst.pct;
        return (
          <div className="overflow-hidden">
            <div className="flex items-center justify-end pb-0.5 pt-1">
              <span className="text-[9px] text-slate-600 tabular-nums">
                Spread {spread.toFixed(2)}%
              </span>
            </div>
            <div className="overflow-hidden px-1.5 py-1.5">
              {allSectors.map((s, i) => {
                const barWidth = (Math.abs(s.pct) / maxAbs) * 40;
                const isPositive = s.pct >= 0;
                const isFirst = i === 0;
                const isLast = i === allSectors.length - 1;
                return (
                  <div
                    key={i}
                    className="group flex items-center px-3 py-[1px] rounded transition-colors hover:bg-white/[0.02]"
                  >
                    <span className={`text-[9px] w-[140px] text-right shrink-0 pr-4 transition-colors ${isFirst ? 'text-emerald-300/90 font-medium' : isLast ? 'text-rose-300/90 font-medium' : 'text-slate-400 group-hover:text-slate-300'}`}>
                      {s.name}
                    </span>
                    <div className="flex-1 h-[20px] flex items-center">
                      <div className="relative w-full h-full">
                        <div className="absolute left-1/2 top-[2px] bottom-[2px] w-px bg-slate-700/40" />
                        {isPositive ? (
                          <div
                            className="absolute left-1/2 top-[2px] bottom-[2px] rounded-r-[3px]"
                            style={{
                              width: `${barWidth}%`,
                              background: isFirst
                                ? 'linear-gradient(90deg, rgba(16,185,129,0.3) 0%, rgba(16,185,129,0.85) 100%)'
                                : 'linear-gradient(90deg, rgba(16,185,129,0.2) 0%, rgba(16,185,129,0.55) 100%)',
                              boxShadow: isFirst ? '0 0 10px rgba(16,185,129,0.15)' : 'none',
                            }}
                          />
                        ) : (
                          <div
                            className="absolute right-1/2 top-[2px] bottom-[2px] rounded-l-[3px]"
                            style={{
                              width: `${barWidth}%`,
                              background: isLast
                                ? 'linear-gradient(270deg, rgba(244,63,94,0.3) 0%, rgba(244,63,94,0.85) 100%)'
                                : 'linear-gradient(270deg, rgba(244,63,94,0.2) 0%, rgba(244,63,94,0.55) 100%)',
                              boxShadow: isLast ? '0 0 10px rgba(244,63,94,0.15)' : 'none',
                            }}
                          />
                        )}
                      </div>
                    </div>
                    <span className={`text-[9px] font-semibold tabular-nums w-[58px] text-right shrink-0 pl-2 ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {isPositive ? '+' : ''}{s.pct.toFixed(2)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {heat.length >= 2 && (
        <div className="flex flex-col">
          <div className="pt-1 pb-1">
            <div className="text-[9px] font-bold text-amber-400 tracking-wider uppercase">Industry Heat</div>
            <p className="text-[9px] text-slate-500 mt-1">Sector rotation — where money is arriving and where it is leaving.</p>
          </div>
          <div className="flex-1 flex flex-col justify-center py-1.5">
            {heat.slice(0, 8).map((h: SectorHeat, i: number) => (
              <div key={i} className="flex items-center gap-2 py-[2px] text-[9px] tabular-nums">
                <span className={`font-semibold w-[52px] text-right shrink-0 ${h.avgChg >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {h.avgChg >= 0 ? '+' : ''}{h.avgChg.toFixed(1)}%
                </span>
                <span className="text-slate-300 truncate">{h.sector}</span>
                <span className="text-slate-600 text-[9px]">({h.count})</span>
              </div>
            ))}
          </div>
        </div>
      )}
      </div>

      {(etfRows.length > 0 || flowRows.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 md:gap-3 items-start">
          {etfRows.length > 0 && (
            <FlowTable
              title="ETF Flow"
              color="indigo"
              blurb={`${etfAdvShare}% of ETF dollars on the advancing side${etfAdvShare >= 60 ? ' — chasing strength.' : etfAdvShare <= 40 ? ' — favoring defense.' : ' — no clean bet.'}`}
              rows={etfRows}
            />
          )}
          {flowRows.length > 0 && (
            <FlowTable
              title="Money Flow"
              color="rose"
              blurb={`${fmtDollar(totalDVol)} tracked, ${mfAdvShare}% advancing${mfAdvShare >= 60 ? ' — buyers paying up.' : mfAdvShare <= 40 ? " — sellers control." : ' — two-sided fight.'}`}
              rows={flowRows}
            />
          )}
        </div>
      )}
    </div>
    </SectionCard>
  );
}

function NewsStars({ count, url }: { count: number; url?: string | null }) {
  if (count === 0) return null;
  const cls = count >= 2 ? 'text-amber-400' : 'text-slate-500';
  const stars = <span className={`text-[7px] leading-none ${cls}`}>{'★'.repeat(count)}</span>;
  if (url) return <a href={url} target="_blank" rel="noopener noreferrer" className="hover:brightness-125 transition-all">{stars}</a>;
  return stars;
}

function fmtDollar(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

function fmtVol(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

function fmtStage(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/^Stage\s*/i, '');
}

function cnfBadge(score: number, grade: string | undefined) {
  if (grade === 'A') return 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20';
  if (grade === 'B') return 'text-amber-400 bg-amber-500/10 border border-amber-500/20';
  if (score >= 70) return 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20';
  if (score >= 50) return 'text-amber-400 bg-amber-500/10 border border-amber-500/20';
  return 'text-slate-500 bg-slate-500/5 border border-white/5';
}

function FlowTable({ title, color, blurb, rows }: { title: string; color: string; blurb: string; rows: any[] }) {
  const borderCls = color === 'indigo' ? 'border-l-indigo-500' : 'border-l-rose-500';
  const bgCls = color === 'indigo' ? 'bg-indigo-500/[0.04]' : 'bg-rose-500/[0.04]';
  const titleCls = color === 'indigo' ? 'text-indigo-400' : 'text-rose-400';

  return (
    <div className={`py-2 md:py-3`}>
      <div className={`text-[9px] font-bold ${titleCls} tracking-wider uppercase mb-1.5`}>
        {title}
      </div>
      <p className="text-[8px] text-slate-500 font-medium leading-snug mb-2">{blurb}</p>
      <div className={scrollWrap} style={scrollStyle}>
        <div className="flex items-center whitespace-nowrap py-[2px] border-b border-white/5 mb-0.5">
          <span className="inline-block w-[38px] md:w-[44px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-center">TICKER</span>
          <span className="inline-block w-[12px]" />
          <span className="inline-block w-[8px]" />
          <span className="inline-block w-[8px]" />
          <span className="inline-block w-[20px] md:w-[22px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-center ml-1">CNF</span>
          <span className="inline-block w-[46px] md:w-[52px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-right">CHG%</span>
          <span className="inline-block w-[36px] md:w-[42px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-right ml-1">PRC</span>
          <span className="inline-block w-[36px] md:w-[40px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-right ml-1">RVOL</span>
          <span className="inline-block w-[30px] md:w-[36px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-right ml-1">VOL</span>
          <span className="inline-block w-[36px] md:w-[40px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-right ml-1">$VOL</span>
          <span className="inline-block w-[22px] md:w-[24px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-center ml-1">RS</span>
          <span className="inline-block w-[22px] md:w-[24px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-center ml-1">STG</span>
          <span className="inline-block w-[14px] md:w-[16px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-center ml-1">N</span>
        </div>
        {rows.map((r: any, i: number) => {
          const chg = r.changePct || 0;
          const cnf = r.cnfScore ?? 0;
          const grade = r.cnfGrade;
          const dot = r.dotKind;
          const rs = r.rsRating || 0;
          const stage = fmtStage(r.stage);
          const stars = newsStars(r);
          return (
            <div key={i} className={scrollWrap} style={scrollStyle}>
              <div className="flex items-center whitespace-nowrap py-[1px]">
                <ChartTooltip symbol={r.ticker}>
                  <span className={`${gridChipCls(grade)} cursor-default w-[38px] md:w-[44px]`}>
                    {r.ticker}
                  </span>
                </ChartTooltip>
                <span className="inline-block w-[12px] text-center shrink-0">
                  {dot === 'blue' && <span className="inline-block w-1.5 h-1.5 rounded-full bg-sky-400 shadow-[0_0_5px_rgba(56,189,248,0.6)]" />}
                </span>
                <span className="inline-block w-[8px] text-center shrink-0">
                  {dot === 'red' && <span className="inline-block w-1.5 h-1.5 rounded-full bg-rose-500" />}
                </span>
                <span className="inline-block w-[8px]" />
                <span className="inline-block w-[20px] md:w-[22px] text-center ml-1"><span className={`inline-block text-[7px] font-bold tabular-nums rounded border w-[20px] md:w-[22px] leading-[14px] text-center ${cnfBadge(cnf, grade)}`}>{cnf}</span></span>
                <span className={`text-[9px] tabular-nums font-semibold inline-block w-[46px] md:w-[52px] text-right ${chg >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{chg >= 0 ? '+' : ''}{chg.toFixed(2)}%</span>
                <span className="text-[9px] tabular-nums inline-block w-[36px] md:w-[42px] text-right text-slate-300 ml-1">{fmtPrice(r.price)}</span>
                <span className={`text-[9px] tabular-nums font-semibold inline-block w-[36px] md:w-[40px] text-right ml-1 ${(r.rvol || 0) >= 2 ? 'text-emerald-400' : (r.rvol || 0) >= 1 ? 'text-slate-300' : 'text-slate-500'}`}>{(r.rvol || 0) < 1 ? (r.rvol || 0).toFixed(1) : Math.round(r.rvol || 0)}x</span>
                <span className="text-[9px] tabular-nums inline-block w-[30px] md:w-[36px] text-right ml-1 text-slate-400">{fmtVol(r.vol || 0)}</span>
                <span className="text-[9px] tabular-nums inline-block w-[36px] md:w-[40px] text-right ml-1 text-slate-400">{fmtDollar(r.dVol || 0)}</span>
                <span className="inline-block w-[22px] md:w-[24px] text-center ml-1">{rs ? <span className={`text-[7px] font-bold tabular-nums rounded border w-[20px] md:w-[22px] leading-[14px] text-center inline-block ${rsBadge(rs)}`}>{rs}</span> : ''}</span>
                <span className="inline-block w-[22px] md:w-[24px] text-center ml-1">{stage ? <span className={`text-[7px] font-bold tabular-nums rounded border w-[20px] md:w-[22px] leading-[14px] text-center inline-block ${stageBadge(r.stage)}`}>{stage}</span> : ''}</span>
                <span className="inline-block w-[14px] md:w-[16px] text-center ml-1"><NewsStars count={stars} url={r.catalystUrl} /></span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* Reads the regime sentence for its directional verdict. This matched only the
   literal RISK-ON / RISK-OFF tokens, which the generator does not emit — so it
   fell through to amber on every brief. Matching the words the analyst
   actually writes ("bullish", "transitional-bearish") makes the header dot
   mean something. Transitional stays amber: it is genuinely the middle. */
function verdictColor(analysis: string): string {
  const t = analysis || '';
  if (/transitional/i.test(t)) return 'amber';
  if (/RISK-ON|\bbullish\b/i.test(t)) return 'emerald';
  if (/RISK-OFF|\bbearish\b/i.test(t)) return 'rose';
  return 'amber';
}

function formatInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(<strong key={match.index} className="text-slate-100 font-semibold">{match[1]}</strong>);
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

interface MacroBadges {
  tone: 'BULLISH' | 'NEUTRAL' | 'BEARISH';
  breadth: { score: number; signal: string } | null;
  chop: { value: number; zone: string } | null;
  t2108: { value: number; zone: string } | null;
  vix: { price: number; pct: number } | null;
}

/* CHOP bands, the composite math and the zone vocabulary are shared with the
   dashboard and the email — see @/lib/indicators/chopMarket. The active mode
   is whatever was last selected on the dashboard, read from
   /api/settings/chop.

   T2108 likewise: this file used to carry its own zone words, and they meant
   different ranges than the dashboard's. A reading of 28 was OVERSOLD there
   and WASHED here. */

function scorecardCellCls(color: 'green' | 'amber' | 'red' | 'slate'): string {
  if (color === 'green') return 'bg-emerald-500/8 border-emerald-500/20';
  if (color === 'red') return 'bg-rose-500/8 border-rose-500/20';
  if (color === 'amber') return 'bg-amber-500/8 border-amber-500/20';
  return 'bg-slate-500/8 border-white/10';
}
function scorecardValCls(color: 'green' | 'amber' | 'red' | 'slate'): string {
  if (color === 'green') return 'text-emerald-400';
  if (color === 'red') return 'text-rose-400';
  if (color === 'amber') return 'text-amber-400';
  return 'text-slate-300';
}

/* The dashboard's card shell, parameterised by accent colour. Sections used to
   be flat blocks with a coloured left rule; this matches the panel treatment
   every card on the main site uses — raised surface, hairline border, label
   pill, and a soft accent glow in the corner.

   Accent is an inline style rather than a class because Tailwind cannot build
   a class name from a runtime value. */
function SectionCard({
  title,
  accent,
  children,
  right,
}: {
  title: string;
  accent: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div
      className="md:border md:border-white/5 md:rounded-2xl p-2 md:p-8 relative overflow-hidden md:shadow-xl w-full rounded-xl"
      style={{ backgroundColor: `${accent}0a` }}
    >
      <div
        className="hidden md:block absolute right-0 top-0 w-64 h-64 blur-3xl rounded-full -translate-y-1/2 translate-x-1/3 pointer-events-none"
        style={{ backgroundColor: `${accent}0d` }}
      />
      <div className="flex justify-between items-center relative z-10 mb-3 md:mb-6 border-b border-white/5 pb-2 md:pb-4">
        <span
          className="text-[8px] font-bold bg-[#161c2a]/40 border border-white/5 px-2 py-0.5 rounded tracking-widest uppercase flex items-center gap-2"
          style={{ color: accent }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: accent }} />
          {title}
        </span>
        {right}
      </div>
      <div className="relative z-10 px-1 md:px-0">{children}</div>
    </div>
  );
}

interface ScorecardCell {
  label: string;
  value: string;
  sub?: string;
  color: 'green' | 'amber' | 'red' | 'slate';
  subColor?: 'green' | 'amber' | 'red' | 'slate';
}

function MacroScorecard({ badges, raw, chopBands }: { badges: MacroBadges | null; raw: any; chopBands: ChopBands }) {
  if (!badges) return null;

  const cells: ScorecardCell[] = [];

  cells.push({ label: 'TONE', value: badges.tone, color: toneCellTone(badges.tone) });

  if (badges.vix) {
    const v = badges.vix;
    const sign = v.pct >= 0 ? '+' : '';
    cells.push({ label: 'VIX', value: v.price.toFixed(2), sub: `${sign}${v.pct.toFixed(2)}%`, color: vixPctTone(v.pct), subColor: vixPctTone(v.pct) });
  }

  if (badges.breadth) {
    cells.push({
      label: 'BREADTH',
      value: `${badges.breadth.score}/6`,
      sub: badges.breadth.signal,
      color: breadthSignalTone(badges.breadth.signal),
    });
  }

  if (raw) {
    const adv = raw.advancers ?? 0;
    const dec = raw.decliners ?? 0;
    const pct = advPct(adv, dec);
    cells.push({ label: 'ADV / DEC', value: `${pct.toFixed(1)}%`, sub: `${adv} / ${dec}`, color: advCellTone(pct) });
  }

  if (badges.t2108) {
    cells.push({
      label: 'T2108',
      value: `${badges.t2108.value.toFixed(0)}%`,
      sub: t2108Zone(badges.t2108.value),
      color: t2108CellTone(badges.t2108.value),
    });
  }

  if (raw && raw.mkm != null) {
    const rising = !!raw.mkmRising;
    const arrow = rising ? '▲' : '▼';
    const color = mkmColor(raw.mkm, raw.mkmSignal ?? 0, rising);
    cells.push({ label: 'McCLELLAN', value: `${raw.mkm.toFixed(0)}%`, sub: `${arrow} vs ${(raw.mkmSignal ?? 0).toFixed(0)}`, color });
  }

  if (badges.chop) {
    cells.push({
      label: 'CHOP',
      value: badges.chop.value.toFixed(0),
      sub: chopZone(badges.chop.value, chopBands),
      color: chopCellColor(badges.chop.value, chopBands),
    });
  }

  if (raw && (raw.newHighs != null || raw.newLows != null)) {
    const h = raw.newHighs ?? 0;
    const l = raw.newLows ?? 0;
    const pct = highsPct(h, l);
    cells.push({ label: 'HI / LO', value: `${pct.toFixed(1)}%`, sub: `${h} / ${l}`, color: highsCellTone(pct) });
  }

  return (
    <div className="mb-5 max-w-[700px] mx-auto">
      <div className="grid grid-cols-4 md:grid-cols-8 gap-1.5">
        {cells.map((c) => (
          <div key={c.label} className={`rounded-lg border px-3 py-2.5 ${scorecardCellCls(c.color)}`}>
            <div className="text-[7px] font-bold uppercase tracking-wider text-slate-500 mb-1">{c.label}</div>
            <div className={`text-[13px] font-bold tabular-nums leading-tight ${scorecardValCls(c.color)}`}>{c.value}</div>
            {c.sub && <div className={`text-[9px] mt-0.5 truncate ${c.subColor ? scorecardValCls(c.subColor) : 'text-slate-500'}`}>{c.sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AnalystBrief() {
  const [brief, setBrief] = useState<BriefData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* Separate from `error`: the brief simply not being published yet is an
     expected state overnight, and must not paint a red failure box. */
  const [pending, setPending] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey | null>('chg');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [macroBadges, setMacroBadges] = useState<MacroBadges | null>(null);
  const [rawBreadth, setRawBreadth] = useState<any>(null);
  const [scannerData, setScannerData] = useState<any>(null);
  const macro = useMacroScorecard();
  const [session, setSession] = useState(getMarketSession());
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setSession(getMarketSession()), 30_000);
    return () => clearInterval(id);
  }, []);
  /* Follows the dashboard's sensitivity toggle — see /api/settings/chop. */
  const [chopBands, setChopBands] = useState<ChopBands>(CHOP_MODE_BANDS.extreme);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/settings/chop')
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d?.mode && CHOP_MODE_BANDS[d.mode as ChopMode]) {
          setChopBands(CHOP_MODE_BANDS[d.mode as ChopMode]);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      if (sortDir === 'desc') setSortDir('asc');
      else { setSortKey(null); setSortDir('desc'); }
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }, [sortKey, sortDir]);

  const fetchBrief = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      /* Not routed through cachedJson: this caller needs the 404 body to tell
         "not published yet" from a real failure, and the shared helper throws
         on non-ok. MarketSummary's copy of this poll IS cached, so the pair no
         longer double-fetches on mount. */
      const res = await fetch('/api/analyst/brief', { cache: 'no-store' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        /* An unpublished brief is not a failure — the analyst only runs
           4 AM – 8 PM ET, so overnight this is the normal state. Route it to
           the neutral empty state rather than the red error box. */
        if (res.status === 404 || body.pending) {
          setPending(body.error || 'No analysis published yet.');
          setBrief(null);
          return;
        }
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setPending(null);
      setBrief(await res.json());
    } catch (err: any) {
      setError(err.message || 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBrief();
    const interval = setInterval(fetchBrief, 60000);
    const onVisible = () => { if (document.visibilityState === 'visible') fetchBrief(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [fetchBrief]);

  useEffect(() => {
    const fetchMacro = async () => {
      try {
        const [macroRes, t2108Res, chopRes] = await Promise.all([
          fetch('/api/macro', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
          fetch('/api/t2108/latest', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
          fetch('/api/chop', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
        ]);

        const quotes = macroRes?.quotes || {};
        const bData = macroRes?.breadth;
        const { tone } = marketTone(quotes, bData?.score);

        const breadth = bData ? { score: bData.score, signal: bData.signal } : null;

        /* The zone is stored alongside the value but recomputed at render
           time against the live band setting — see MacroScorecard. */
        let chopObj: { value: number; zone: string } | null = null;
        if (chopRes?.success) {
          const composite = chopComposite(rawChopOf(chopRes), bData ?? null);
          if (composite != null) {
            chopObj = { value: composite, zone: chopZone(composite, CHOP_MODE_BANDS[DEFAULT_CHOP_MODE]) };
          }
        }

        let t2108Obj: { value: number; zone: string } | null = null;
        if (t2108Res?.value != null) {
          t2108Obj = { value: t2108Res.value, zone: t2108Zone(t2108Res.value) };
        }

        const vixQ = quotes['VIX'];
        const vixObj = vixQ ? { price: vixQ.price, pct: vixQ.pct } : null;
        setMacroBadges({ tone, breadth, chop: chopObj, t2108: t2108Obj, vix: vixObj });
        if (bData) setRawBreadth(bData);
      } catch { /* non-fatal */ }
    };
    fetchMacro();
  }, []);

  const [auxScanData, setAuxScanData] = useState<any[]>([]);

  useEffect(() => {
    /* Shared de-duplicated fetch — see lib/scannerLatest. */
    fetchScannerLatest()
      .then(d => { if (d) setScannerData(d); })
      .catch(() => {});
    Promise.all([
      fetch('/api/ep9m/latest').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/vcp/latest').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/swing-candidates/latest').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([ep9m, vcp, swing]) => {
      const rows: any[] = [
        ...(ep9m?.candidates || []),
        ...(vcp?.candidates || []),
        ...(swing?.candidates || []),
        ...(swing?.consolidation || []),
      ];
      if (rows.length) setAuxScanData(rows);
    });
  }, []);

  const sessionBlocks = React.useMemo(() => {
    const su = (brief as any)?.sessionUpdates;
    if (!su) return null;
    const weekend = isWeekendNow();
    const t = estDecimal();
    return {
      morning: (t >= BLOCK_WINDOWS.morning.opens || weekend) ? (su.morning || null) : null,
      midday: (t >= BLOCK_WINDOWS.midday.opens || weekend) ? (su.midday || null) : null,
      closing: (t >= BLOCK_WINDOWS.closing.opens || weekend) ? (su.closing || null) : null,
    };
  }, [brief]);

  const gradeMap = React.useMemo<Record<string, 'A' | 'B'>>(() => {
    const map: Record<string, 'A' | 'B'> = {};
    const rows = scannerData?.topMovers?.all ?? scannerData?.topMovers?.up ?? [];
    for (const r of rows) {
      const t = r?.ticker;
      if (!t || map[t]) continue;
      const sc = r.cnfScore ?? r.score ?? 0;
      if (sc >= 70) map[t] = 'A';
      else if (sc >= 50) map[t] = 'B';
    }
    return map;
  }, [scannerData]);

  const avoidSet = React.useMemo<Set<string>>(() => {
    const s = new Set<string>();
    const avoidStocks = brief?.sections.find(sec => sec.section === 'Top Avoid')?.stocks ?? [];
    for (const st of avoidStocks) if (st.ticker) s.add(st.ticker);
    return s;
  }, [brief]);

  /* The regime read comes from brief.regimeDetail (rendered as the Market
     Regime card), not from a section — there was a dead lookup for a
     'Market Regime' section here that the generator has never emitted. */
  const scannerLookup = React.useMemo<Record<string, any>>(() => {
    const map: Record<string, any> = {};
    const lists = [
      ...(Array.isArray(scannerData?.dailySetups) ? [scannerData.dailySetups] : []),
      ...(Array.isArray(scannerData?.stocksInPlay) ? [scannerData.stocksInPlay] : []),
      ...Object.values(scannerData?.topMovers || {}).filter(Array.isArray) as any[][],
    ];
    for (const group of lists) {
      for (const r of group) {
        if (r?.ticker && !map[r.ticker]) map[r.ticker] = r;
      }
    }
    for (const r of auxScanData) {
      if (r?.ticker && !map[r.ticker]) map[r.ticker] = r;
    }
    return map;
  }, [scannerData, auxScanData]);

  const enrichStock = useCallback((s: StockEntry): StockEntry => {
    const sc = scannerLookup[s.ticker];
    if (!sc) return s;
    return {
      ...s,
      rvol: s.rvol ?? sc.rvol ?? null,
      vol: s.vol ?? sc.vol ?? null,
      dvol: s.dvol ?? sc.dVol ?? sc.dvol ?? null,
      rs: s.rs ?? sc.rsRating ?? sc.rs ?? null,
      stage: s.stage || sc.stage || undefined,
      score: s.score ?? sc.cnfScore ?? sc.score ?? null,
      grade: s.grade ?? sc.cnfGrade ?? sc.grade ?? null,
      price: s.price || sc.price || 0,
      changePct: s.changePct || sc.changePct || 0,
      catalyst: (s as any).catalyst || sc.catalyst || undefined,
      catalystUrl: (s as any).catalystUrl || sc.catalystUrl || undefined,
      newsPublisher: (s as any).newsPublisher || sc.newsPublisher || undefined,
      newsAge: (s as any).newsAge || sc.newsAge || undefined,
      newsSentiment: (s as any).newsSentiment || sc.newsSentiment || undefined,
      newsCausal: (s as any).newsCausal ?? sc.newsCausal ?? undefined,
    } as any;
  }, [scannerLookup]);

  const tradesRaw = brief?.sections.find(s => s.section === 'Top Trades');
  const trades = tradesRaw ? { ...tradesRaw, stocks: normalizeStocks(tradesRaw.stocks).map(enrichStock) } : undefined;
  const avoidRaw = brief?.sections.find(s => s.section === 'Top Avoid');
  const avoid = avoidRaw ? { ...avoidRaw, stocks: normalizeStocks(avoidRaw.stocks).map(enrichStock) } : undefined;
  /* The generator names this section by session — "Pre-Market Gappers" before
     the open, "Intraday Movers" during, "Post-Market Gappers" after. Matching
     only the gapper spellings meant Top Movers silently vanished from the page
     for most of the trading day. */
  const preGapperRaw = brief?.sections.find(s => /Pre.*Gapper/i.test(s.section))
    || brief?.sections.find(s => /Gappers|Intraday Movers/i.test(s.section));
  const gapperSection = preGapperRaw ? { ...preGapperRaw, stocks: normalizeStocks(preGapperRaw.stocks).map(enrichStock) } : undefined;

  const scannerMoverGainers = React.useMemo<StockEntry[]>(() => {
    const raw: any[] = scannerData?.topMovers?.['Gainers'] || [];
    return raw.map(r => normalizeStock({
      ticker: r.ticker, price: r.price || 0, changePct: r.changePct || 0,
      rvol: r.rvol, vol: r.vol, dvol: r.dVol ?? r.dvol,
      rs: r.rsRating ?? r.rs, stage: r.stage, score: r.cnfScore ?? r.score,
      grade: r.cnfGrade ?? r.grade,
    })).sort((a, b) => (b.changePct || 0) - (a.changePct || 0));
  }, [scannerData]);

  const scannerMoverLosers = React.useMemo<StockEntry[]>(() => {
    const raw: any[] = scannerData?.topMovers?.['Losers'] || [];
    return raw.map(r => normalizeStock({
      ticker: r.ticker, price: r.price || 0, changePct: r.changePct || 0,
      rvol: r.rvol, vol: r.vol, dvol: r.dVol ?? r.dvol,
      rs: r.rsRating ?? r.rs, stage: r.stage, score: r.cnfScore ?? r.score,
      grade: r.cnfGrade ?? r.grade,
    })).sort((a, b) => (a.changePct || 0) - (b.changePct || 0));
  }, [scannerData]);

  const sipRaw = brief?.sections.find(s => s.section === 'Stocks in Play Today');
  const sipSection = sipRaw ? { ...sipRaw, stocks: normalizeStocks(sipRaw.stocks).map(enrichStock) } : undefined;

  const isGapper = (s: SectionResult) => /Gappers/i.test(s.section);
  const postSipSections = brief?.sections.filter(s => {
    const order = ['Economic Data & Catalysts Today', "Today's Earnings Calendar"];
    return order.includes(s.section);
  }) || [];

  const color = brief?.regimeDetail?.regime ? verdictColor(brief.regimeDetail.regime) : 'slate';
  const dotCls = color === 'emerald' ? 'bg-emerald-400' : color === 'rose' ? 'bg-rose-400' : 'bg-amber-400';
  const borderCls = color === 'emerald' ? 'border-emerald-500/30' : color === 'rose' ? 'border-rose-500/30' : 'border-amber-500/30';
  const bgCls = color === 'emerald' ? 'bg-emerald-500/[0.06]' : color === 'rose' ? 'bg-rose-500/[0.06]' : 'bg-amber-500/[0.06]';

  return (
    <>
    <ActiveChartProvider>
    {/* Same shell as the dashboard: centred rounded panel on the page ground,
        header rule, then a spaced stack of cards. */}
    <div className="min-h-screen bg-[#05080f] text-slate-300 font-sans md:py-10 flex justify-center">
      <div className="w-full max-w-[1200px] bg-[#0b101a] md:rounded-[2rem] md:border md:border-white/5 overflow-hidden md:shadow-2xl relative pb-20">

        <div className="px-3 md:px-10 pt-6 md:pt-8 pb-4 md:pb-6 border-b border-white/5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-3.5 md:gap-5">
            <img src="/logo.svg" alt="CTT" className="ctt-logo h-9 md:h-12 w-auto drop-shadow-[0_2px_10px_rgba(124,139,250,0.18)]" />
            <div className="leading-none">
              <h2 className="text-2xl md:text-[2.5rem] font-extrabold text-slate-50 tracking-[-0.025em] leading-[1.05] antialiased">
                Confluence Trading Tools
              </h2>
              <p className="text-[10px] md:text-[11px] font-semibold text-slate-500 tracking-[0.22em] uppercase mt-2">
                Market Briefing
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <DashNav />
            <button
              onClick={() => setHelpOpen(true)}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-sm font-bold bg-slate-700/60 hover:bg-slate-600 text-slate-400 hover:text-slate-200 transition-colors shrink-0"
              title="Help"
            >?</button>
          </div>
        </div>

        <div className="px-0 md:px-10 py-6 space-y-6">

        {/* Same card shell and header as the dashboard's Scorecard: label pill
            left, session and last-update right, indigo glow behind. */}
        <div className="bg-[#101623] border-0 md:border md:border-white/5 md:rounded-2xl p-2 md:p-8 relative overflow-hidden md:shadow-xl w-full">
          <div className="hidden md:block absolute right-0 top-0 w-64 h-64 bg-indigo-500/5 blur-3xl rounded-full -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>
          <div className="flex justify-between items-center relative z-10 mb-3 md:mb-6 border-b border-white/5 pb-2 md:pb-4">
            <span className="text-xs md:text-sm font-bold text-[#7c8bfa] bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
              Macro Scorecard
            </span>
            <div className="flex flex-col items-center gap-1.5">
              <div className="flex items-center justify-center border border-white/5 bg-[#161c2a]/40 px-4 py-1.5 rounded-[10px] min-w-[120px]">
                <span className={`text-[10px] font-bold tracking-widest uppercase ${sessionTextColor(session)}`}>
                  {session}
                </span>
              </div>
              {brief?.snapshotTime && (
                <span className="text-[11px] text-slate-400/80 font-medium px-1 tracking-wide">
                  Updated: {new Date(brief.snapshotTime).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit' })} EST
                </span>
              )}
            </div>
          </div>
          <MacroScorecardPanel
            marketTone={macro.marketTone}
            quotes={macro.quotes}
            breadth={macro.breadth}
            tVal={macro.tVal}
            chop={macro.chop}
            chopVal={macro.chopVal}
            chopRaw={macro.chopRaw}
            chopDelta={macro.chopDelta}
            chopTrend={macro.chopTrend}
            adTrend={macro.adTrend}
            hlTrend={macro.hlTrend}
            advPct={macro.advPct}
            highsPct={macro.highsPct}
            intraVal={macro.intraVal}
            intraStale={macro.intraStale}
            intraLastBar={macro.intraLastBar}
            chopTooltipText={macro.chopTooltipText}
            chopMode={macro.chopMode}
            setChopMode={macro.setChopMode}
            bands={macro.bands}
            divergence={macro.divergence}
            cellsOnly
          />
        </div>

        <MacroEconPanel />

        {loading && !brief && (
          <div className="flex items-center justify-center py-20 gap-3">
            <div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
            <span className="text-slate-500 text-sm">Loading...</span>
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm">{error}</div>
        )}

        {/* Waiting, not broken. Slate rather than red, and it says when the
            analyst next runs instead of naming an internal tool. */}
        {pending && !brief && !loading && (
          <div className="bg-white/[0.02] border border-white/5 rounded-xl p-6 text-center">
            <p className="text-slate-400 text-sm font-medium">{pending}</p>
            <p className="text-slate-600 text-xs mt-1.5">
              The scanners and macro scorecard above are live and unaffected.
            </p>
          </div>
        )}

        {brief && (
          <div className="space-y-6">

            {/* 1. Macro Snapshot */}
            {(() => {
              const macroSec = brief.sections.find(s => /Futures.*Macro|Macro.*Snapshot/i.test(s.section));
              return macroSec?.analysis ? (
                <SectionCard title="Macro Snapshot" accent="#22d3ee">
                  <div className="text-[10px] text-slate-200 leading-[1.7]">
                    {macroSec.analysis.split(/\n\n+/).filter(p => p.trim()).map((block, i) => (
                      <div key={i} className={i > 0 ? 'pt-3 mt-3 border-t border-white/[0.06]' : ''}>
                        <p className="leading-[1.7]">{highlightBold(block.replace(/\n/g, ' '), 'text-white', true, true, gradeMap, avoidSet)}</p>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              ) : null;
            })()}

            {/* 3. Key News & Catalysts */}
            {(() => {
              const newsSec = brief.sections.find(s => s.section === 'Key News & Catalysts');
              return newsSec?.analysis ? (
                <SectionCard title="Key News & Catalysts" accent="#a78bfa">
                  <FormattedBlock text={newsSec.analysis} tickers gradeMap={gradeMap} avoidSet={avoidSet} />
                </SectionCard>
              ) : null;
            })()}

            {/* 4. Market Regime — the analyst's Core Thesis, the readings that
                argue against it, and what the conditions structurally support.

                ALL THREE LIVE IN THIS ONE CARD, because that is how the
                dashboard renders them: MarketSummary builds a single
                "Market Regime:" paragraph out of regime + `Risk:` + `Structure:`
                and hands it to the shared briefing renderer. This page used to
                split the same three fields across a Market Regime card and a
                separate amber Caution Flag card, so the two surfaces disagreed
                about how many sections the regime read even has. The labels
                here are the dashboard's labels, verbatim.

                Rendered as two blocks rather than one because FormattedBlock
                DROPS unlabelled lines as soon as any line carries a label —
                the regime prose has no label, so pasting all three into one
                block would silently delete the thesis. */}
            {(brief.regimeDetail?.regime || brief.regimeDetail?.caution || brief.regimeDetail?.posture) && (() => {
              const rd = brief.regimeDetail!;
              const detail = [
                rd.caution ? `Risk: ${rd.caution.replace(/\n+/g, ' ')}` : null,
                rd.posture ? `Structure: ${rd.posture.replace(/\n+/g, ' ')}` : null,
              ].filter(Boolean).join('\n');
              return (
                <SectionCard title="Market Regime" accent="#22d3ee">
                  {rd.regime && <FormattedBlock text={rd.regime} tickers gradeMap={gradeMap} avoidSet={avoidSet} />}
                  {detail && (
                    <div className={rd.regime ? 'mt-3 pt-3 border-t border-white/5' : ''}>
                      <FormattedBlock text={detail} tickers gradeMap={gradeMap} avoidSet={avoidSet} />
                    </div>
                  )}
                </SectionCard>
              );
            })()}

            {/* Sectors */}
            {(() => {
              const sectorSec = brief.sections.find(s => s.section === 'Top Sectors & Money Flow');
              return sectorSec ? <SectorSection section={sectorSec} scannerData={scannerData} /> : null;
            })()}

            {/* Compact legend */}
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-x-3 gap-y-1 text-[9px] text-slate-500 leading-snug">
              <span className="cursor-help" title="CNF grade. A = 70+ (high conviction), B = 50–69. Combines RVOL, gap size, range expansion, relative strength, and catalyst quality."><span className="text-emerald-400 font-bold">A</span> 70+ <span className="text-amber-400 font-bold">B</span> 50&ndash;69</span>
              <span className="cursor-help" title="10/21 EMA posture. Green = price above both EMAs, trend intact. Amber = 10 and 21 converging, potential trend change. Rose = extended above or broken below the 21 EMA."><span className="inline-block w-[5px] h-[5px] rounded-full bg-emerald-400 relative top-[-1px]" /> stacked <span className="inline-block w-[5px] h-[5px] rounded-full bg-amber-400 relative top-[-1px]" /> pre-cross <span className="inline-block w-[5px] h-[5px] rounded-full bg-rose-400 relative top-[-1px]" /> ext/below</span>
              <span className="cursor-help" title="Analyst-flagged avoid: thin floats with no follow-through, crowded shorts squeezing into resistance, or patterns that look right but fail on closer inspection."><span className="text-rose-300 font-bold">TRAP</span> avoid</span>
              <span className="cursor-help" title="Structural reversal. Price is up today but still under the 21 EMA with no prior blue-dot setup. A contrarian signal, not a trend-following one."><span className="inline-block w-[5px] h-[5px] rounded-full bg-blue-500 relative top-[-1px]" /> blue dot</span>
              <span className="cursor-help" title="One star = a news headline exists today (earnings, FDA, upgrade, etc.). Two stars = a material catalyst is driving the move — higher conviction."><span className="text-slate-500">★</span> news <span className="text-amber-400">★★</span> catalyst</span>
              <span className="cursor-help" title="CNF = confluence score (0–100). RVOL = relative volume vs 20-day average. RS = relative strength percentile (0–99). STG = Weinstein stage (1B–4C)."><span className="font-semibold text-slate-400">CNF</span> score <span className="font-semibold text-slate-400">RVOL</span> vs avg <span className="font-semibold text-slate-400">RS</span> rel str <span className="font-semibold text-slate-400">STG</span> stage</span>
            </div>

            {/* Top Movers */}
            {gapperSection && <GapperSection section={gapperSection} gradeMap={gradeMap} avoidSet={avoidSet} scannerGainers={scannerMoverGainers} scannerLosers={scannerMoverLosers} />}

            {/* Stocks in Play with full grid */}
            {sipSection && <SIPSection section={sipSection} gradeMap={gradeMap} avoidSet={avoidSet} />}

            {/* Key Events: econ + earnings (same data as main dashboard) */}
            <KeyEventsSection />

          </div>
        )}

        {/* Session Updates — at the bottom, independent of brief load */}
        {sessionBlocks && (sessionBlocks.morning || sessionBlocks.midday || sessionBlocks.closing) && (() => {
          const weekend = isWeekendNow();
          const renderBlock = (block: UpdateBlock | null, key: BlockKey) => {
            if (!block) return null;
            const stale = isBlockStale(key, weekend);
            const dir = stale ? null : deriveDirection(block);
            const themeKey = dir === 'up' ? 'emerald' : dir === 'down' ? 'rose' : block.colorTheme;
            const st = sessionBlockTheme(themeKey);
            const nextLabel = BLOCK_WINDOWS[key].nextLabel;
            return (
              <div key={key} id={`tape-${key}`} className="bg-[#161c2a]/60 border border-white/5 rounded-xl p-4 sm:p-5 md:p-6 mt-3">
                <div className="flex items-center gap-2 sm:gap-3 mb-4 flex-wrap">
                  <div className={`w-2 h-2 rounded-full border border-current ${stale ? 'bg-slate-500/10 text-slate-500' : `${st.bg} ${st.text}`}`} />
                  <h4 className={`text-[10px] font-bold tracking-widest uppercase ${stale ? 'text-slate-400' : st.text}`}>
                    {block.phase}
                  </h4>
                  <span className="text-[8px] text-slate-500 font-medium tracking-wider px-2 py-0.5 bg-black/20 border border-white/5 rounded">
                    {block.timestamp}
                  </span>
                  {stale && (
                    <span className="text-[8px] font-bold tracking-widest uppercase text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded">
                      Superseded
                    </span>
                  )}
                </div>
                <div className="space-y-3 mb-5">
                  {block.paragraphs.map((p, idx) => (
                    <p key={idx} className="text-[10px] text-slate-400 leading-relaxed border-l-[2px] border-slate-500/30 pl-2.5 md:pl-3.5">
                      {highlightBold(p, 'text-white', true, true, gradeMap, avoidSet)}
                    </p>
                  ))}
                </div>
                <div className={`border-l-[4px] p-3 md:p-4 rounded-r-xl transition-colors duration-300 ${stale ? 'bg-slate-500/[0.07] border-slate-500' : `${st.boxBg} ${st.boxBorder}`}`}>
                  <p className={`text-[10px] leading-relaxed ${stale ? 'text-slate-300' : st.boxText}`}>
                    {highlightBold(block.takeaway, stale ? 'text-slate-100' : st.boxText, true, true, gradeMap, avoidSet)}
                  </p>
                </div>
                {stale && (
                  <p className="text-[10px] text-amber-400/90 font-medium mt-3 leading-snug">
                    Written for the {block.phase.toLowerCase()} window — the tape has moved past this read.
                    {nextLabel ? ` Treat it as history until the ${nextLabel} update posts.` : ''}
                  </p>
                )}
              </div>
            );
          };
          return (
            <div id="session-updates">
            <SectionCard title="Session Updates" accent="#818cf8">
              <div className="flex flex-col gap-2">
                {renderBlock(sessionBlocks.morning, 'morning')}
                {renderBlock(sessionBlocks.midday, 'midday')}
                {renderBlock(sessionBlocks.closing, 'closing')}
              </div>
            </SectionCard>
            </div>
          );
        })()}

        </div>

        <div className="text-center text-[10px] text-slate-600 pt-10 pb-4">
          Confluence Trading Tools LLC © {new Date().getFullYear()} • Not investment advice.
        </div>
      </div>
    </div>
    </ActiveChartProvider>
    <HelpModal isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}

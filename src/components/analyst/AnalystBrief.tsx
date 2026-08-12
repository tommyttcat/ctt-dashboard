'use client';

import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { ThemeToggle } from '../ThemeProvider';
import TickerChartHover, { ActiveChartCtx, ActiveChartProvider, autoScrollRef, scrollingRef } from '../TickerChartHover';
import { newsStarCount as newsStars } from '@/lib/newsStars';

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

const BRIEF_TICKER_CHIP = "inline-block align-baseline text-[9px] font-bold text-slate-300 bg-slate-500/10 px-1.5 py-[1px] rounded border border-white/10 tracking-wider mx-0.5 text-center min-w-[38px]";
const NOT_TICKERS = new Set([
  'THE','AND','FOR','BUT','NOT','YET','ALL','RED','ITS','HAS','ARE','WAS','HAD','NEW','LOW','HIGH',
  'ETF','IPO','GDP','CPI','PPI','RSI','EMA','SMA','VCP','ADR','ATR','ATH','ATL',
  'AI','RVOL','VOL','AVG','PCT','VS','PE','EPS','CEO','CFO','COO','CTO',
  'USD','EUR','YTD','QTD','MTD','MOM','YOY','QOQ','EOD','IOT','UTC',
  'FOMC','FED','SEC','ECB','BOJ','FDIC','OTC','FAQ','API',
  'MA','PM','AM','IV','OI','DTE','BP','RR','UI','IS','OR','AN','AS','AT','BY','DO','GO','IF','IN','IT','MY','NO','OF','ON','SO','TO','UP','WE',
]);
const INDEX_TICKERS = new Set(['SPY','QQQ','DIA','IWM','VIX','TLT','GLD','SLV','USO','XLF','XLK','XLE','XLV','XLI','XLB','XLC','XLRE','XLU','XLP','XLY']);

function renderTickerChips(segment: string, keyBase: number): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /\b([A-Z]{1,5})\b/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(segment)) !== null) {
    const word = m[1];
    const isLikelyTicker = word.length >= 2 && !NOT_TICKERS.has(word);
    if (!isLikelyTicker) continue;
    if (m.index > last) parts.push(segment.slice(last, m.index));
    parts.push(<TickerChartHover key={keyBase + m.index} symbol={word}><span className={BRIEF_TICKER_CHIP}>{word}</span></TickerChartHover>);
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

function highlightBold(text: string, colorClass: string, pctColor?: boolean): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      const seg = text.slice(last, match.index);
      if (pctColor) parts.push(...colorPcts(seg, last));
      else parts.push(seg);
    }
    parts.push(
      <span key={match.index} className={`font-extrabold ${colorClass}`}>{match[1]}</span>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    const seg = text.slice(last);
    if (pctColor) parts.push(...colorPcts(seg, last));
    else parts.push(seg);
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
    <div className="space-y-5">
      <div className={`border-l-[3px] ${rc.border} ${rc.bg} rounded-r-lg px-6 py-5`}>
        <div className={`text-[11px] font-bold ${rc.label} tracking-[0.15em] uppercase mb-3`}>
          Regime Assessment
        </div>
        <p className="text-[15px] text-slate-300 leading-[1.7]">
          {highlightBold(detail.regime, 'text-slate-100')}
        </p>
      </div>

      {breadth && breadth.analysis && (
        <div className="border-l-[3px] border-l-rose-400 bg-rose-500/[0.06] rounded-r-lg px-6 py-5">
          <div className="text-[11px] font-bold text-rose-400 tracking-[0.15em] uppercase mb-3">
            Sentiment &amp; Market Breadth
          </div>
          <FormattedBlock text={breadth.analysis} />
        </div>
      )}

      <div className={`border-l-[3px] ${caution.border} ${caution.bg} rounded-r-lg px-6 py-5`}>
        <div className={`text-[11px] font-bold ${caution.label} tracking-[0.15em] uppercase mb-3`}>
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

const TICKER_CHIP = 'text-[12px] md:text-[9px] font-bold tracking-wider text-slate-300 bg-slate-500/10 border border-white/10 rounded px-2 md:px-1.5 py-[2px] md:py-[1px] text-center';
const TICKER_CHIP_RED = 'text-[12px] md:text-[9px] font-bold tracking-wider text-rose-200 bg-rose-950 border border-rose-500/20 rounded px-2 md:px-1.5 py-[2px] md:py-[1px] text-center';

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
const rvolColor = (v: number) => (v >= 2 ? 'text-amber-400' : v >= 1.5 ? 'text-emerald-400' : 'text-slate-400');
const rsColor = (rs: number) => (rs >= 90 ? 'text-purple-400' : rs >= 80 ? 'text-emerald-400' : rs >= 70 ? 'text-slate-300' : 'text-rose-400');
const stageColor = (st: string) => {
  if (st.includes('2')) return 'text-emerald-400';
  if (st.includes('1')) return 'text-amber-400';
  return 'text-rose-400';
};
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

const GRID_COLS = '13px 3px 48px 24px 56px 40px 36px 44px 20px 22px 22px';
const GRID_COLS_GAP = '13px 3px 48px 24px 56px 40px 36px 44px 20px 22px 22px';
const scrollWrap = "overflow-x-auto";
const scrollStyle: React.CSSProperties = { scrollbarWidth: 'none', msOverflowStyle: 'none' };
const GRID_COLS_TRAP = '52px 62px 22px 1fr';

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
  const cols = GRID_COLS;
  return (
    <div className={scrollWrap} style={scrollStyle}>
      <div className="grid items-center gap-x-1 text-[7px] font-bold tracking-widest text-slate-600 uppercase pb-0.5 border-b border-white/5 mb-0.5" style={{ gridTemplateColumns: cols }}>
        <span /><span /><span className="text-center">TICKER</span><span className={`text-center ${hdrCls}`} onClick={() => onSort?.('cnf')}>CNF<SortArrow active={sortKey === 'cnf'} dir={sortDir || 'desc'} /></span><span className={`text-right ${hdrCls}`} onClick={() => onSort?.('chg')}>CHG%<SortArrow active={sortKey === 'chg'} dir={sortDir || 'desc'} /></span><span className={`text-right ${hdrCls}`} onClick={() => onSort?.('rvol')}>RVOL<SortArrow active={sortKey === 'rvol'} dir={sortDir || 'desc'} /></span><span className={`text-right ${hdrCls}`} onClick={() => onSort?.('vol')}>VOL<SortArrow active={sortKey === 'vol'} dir={sortDir || 'desc'} /></span><span className={`text-right ${hdrCls}`} onClick={() => onSort?.('dvol')}>$VOL<SortArrow active={sortKey === 'dvol'} dir={sortDir || 'desc'} /></span><span className={`text-center ${hdrCls}`} onClick={() => onSort?.('stg')}>STG<SortArrow active={sortKey === 'stg'} dir={sortDir || 'desc'} /></span><span className={`text-center ${hdrCls}`} onClick={() => onSort?.('rs')}>RS<SortArrow active={sortKey === 'rs'} dir={sortDir || 'desc'} /></span><span className="text-center">N</span>
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
    setActive(instanceId, stock.ticker, getTriggerX());
  }, [instanceId, stock.ticker, setActive, cancelDismiss]);

  const handleEnter = useCallback(() => {
    if (scrollingRef.current) return;
    cancelDismiss();
    if (hoverDelayRef.current) clearTimeout(hoverDelayRef.current);
    hoverDelayRef.current = setTimeout(() => {
      if (!scrollingRef.current) activate();
    }, 500);
  }, [cancelDismiss, activate]);

  const handleLeave = useCallback(() => {
    if (hoverDelayRef.current) { clearTimeout(hoverDelayRef.current); hoverDelayRef.current = null; }
    scheduleDismiss();
  }, [scheduleDismiss]);

  const handleTap = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    setActive(instanceId, stock.ticker, getTriggerX());
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
      className={`${isAvoid ? TICKER_CHIP_RED : TICKER_CHIP} cursor-default`}
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
      <div className={`grid items-center gap-x-1 py-[3px] text-[11px] tabular-nums `} style={{ gridTemplateColumns: GRID_COLS }}>
        <span className={`text-[9px] font-black text-center ${item.grade === 'A' ? 'text-emerald-400' : item.grade === 'B' ? 'text-amber-400' : 'text-transparent'}`}>{item.grade || ''}</span>
        <span />
        {stock ? <TickerChip stock={stock} red={red} /> : <TickerChartHover symbol={item.ticker}><span className={red ? TICKER_CHIP_RED : TICKER_CHIP}>{item.ticker}</span></TickerChartHover>}
        <span className="text-center">{item.score != null ? <span className={`font-bold px-1 py-[1px] rounded border text-[9px] ${cnfBadgeCls(Number(item.score) || 0)}`}>{item.score}</span> : ''}</span>
        <span className={`font-semibold text-right ${(item.changePct || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{item.changePct != null ? `${(item.changePct || 0) >= 0 ? '+' : ''}${item.changePct.toFixed(2)}%` : ''}</span>
        <span className={`font-semibold text-right ${rv != null ? rvolColor(rv) : ''}`}>{rv != null ? rv.toFixed(2) : ''}</span>
        <span className="text-slate-400 text-right">{item.vol != null ? formatVol(item.vol) : ''}</span>
        <span className="text-slate-300 text-right">{dolVol != null ? `$${formatVol(dolVol)}` : ''}</span>
        <span className={`text-[9px] font-bold text-center ${item.stage ? stageColor(item.stage) : ''}`}>{item.stage ? stripStage(item.stage) : ''}</span>
        <span className={`font-semibold text-right ${rs != null ? rsColor(rs) : ''}`}>{rs != null ? rs : ''}</span>
        <span className="text-center"><NewsStars count={newsStars(stock || item as any)} url={(stock || item as any)?.catalystUrl} /></span>
      </div>
    </div>
  );
}

function TrapRow({ item, stock }: { item: SummaryItem; stock?: StockEntry }) {
  return (
    <div className={`grid items-center gap-x-1 py-[3px] text-[11px] tabular-nums`} style={{ gridTemplateColumns: GRID_COLS_TRAP }}>
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
  const traps = avoidStocks?.slice(0, 5) || [];

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
    <div>
      <div className="text-xs font-bold text-emerald-400 tracking-[0.2em] uppercase mb-3">
        Actionable Summary
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border-l-[3px] border-l-indigo-400 bg-[#0a1220] rounded-r-lg px-5 py-3">
          <div className="text-[11px] font-bold text-slate-500 tracking-[0.15em] uppercase mb-2">
            Highest Conviction
          </div>
          <SummaryHeader sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
          {top2.map((s, i) => <SummaryRow key={i} item={toItem(s)} stock={s} showNote={false} />)}
        </div>

        <div className="border-l-[3px] border-l-amber-400/60 bg-[#0a1220] rounded-r-lg px-5 py-3">
          <div className="text-[11px] font-bold text-slate-500 tracking-[0.15em] uppercase mb-2">
            Watchlist — Not Yet Actionable
          </div>
          <SummaryHeader sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
          {watchlist.map((s, i) => <SummaryRow key={i} item={toItem(s, watchNote(s))} stock={s} showNote />)}
        </div>
      </div>

      {traps.length > 0 && (
        <div className="border-l-[3px] border-l-rose-500/60 bg-[#0a1220] rounded-r-lg px-5 py-3 mt-4">
          <div className="text-[11px] font-bold text-slate-500 tracking-[0.15em] uppercase mb-2">
            Traps to Avoid
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
            <div>
              <SummaryHeader sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              {traps.slice(0, Math.ceil(traps.length / 2)).map((s, i) => <SummaryRow key={i} item={toItem(s)} stock={s} red />)}
            </div>
            <div>
              <SummaryHeader sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              {traps.slice(Math.ceil(traps.length / 2)).map((s, i) => <SummaryRow key={i} item={toItem(s)} stock={s} red />)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AnalystCard({ stock, rank }: { stock: StockEntry; rank: number }) {
  const isPositive = stock.changePct >= 0;
  const isAvoid = stock.sentiment === 'bearish';
  const borderColor = isAvoid ? 'border-l-rose-500/60' : 'border-l-emerald-500/60';
  const bgColor = isAvoid ? 'bg-rose-500/[0.04]' : 'bg-[#0a1018]';
  const setupCls = stock.setup ? (SETUP_COLORS[stock.setup] || DEFAULT_SETUP_CLS) : '';

  return (
    <div className={`border-l-[3px] ${borderColor} ${bgColor} rounded-r-xl px-4 md:px-5 py-4`}>
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <TickerChartHover symbol={stock.ticker}><span className={isAvoid ? TICKER_CHIP_RED : TICKER_CHIP}>{stock.ticker}</span></TickerChartHover>

        {stock.score != null && (
          <span className={`text-[9px] font-bold px-1 py-[1px] rounded border tabular-nums ${stock.score >= 80 ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : stock.score >= 60 ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' : 'text-rose-400 bg-rose-500/10 border-rose-500/20'}`}>
            {stock.score}
          </span>
        )}
        {stock.grade && (
          <span className={`text-[9px] font-black ${stock.grade === 'A' ? 'text-emerald-400' : stock.grade === 'B' ? 'text-amber-400' : 'text-slate-400'}`}>
            {stock.grade}
          </span>
        )}
        {stock.setup && (
          <span className={`text-[9px] font-bold px-1 py-[1px] rounded border uppercase tracking-wide ${setupCls}`}>
            {stock.setup}
          </span>
        )}

        <span className={`text-[11px] font-semibold tabular-nums ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
          {isPositive ? '+' : ''}{stock.changePct.toFixed(2)}%
        </span>

        {stock.rvol != null && (
          <span className="text-[11px] tabular-nums">
            <span className="text-[8px] text-slate-500">RVOL</span> <span className={`font-semibold ${rvolColor(stock.rvol)}`}>{stock.rvol.toFixed(2)}</span>
          </span>
        )}

        {stock.vol != null && formatVol(stock.vol) && (
          <span className="text-[11px] text-slate-400 tabular-nums">
            <span className="text-[8px] text-slate-500">Vol</span> <span className="text-slate-300 font-semibold">{formatVol(stock.vol)}</span>
          </span>
        )}

        {stock.dvol != null && (
          <span className="text-[11px] text-slate-400 tabular-nums">
            <span className="text-[8px] text-slate-500">$Vol</span> <span className="text-slate-300 font-semibold">${formatVol(stock.dvol)}</span>
          </span>
        )}

        {stock.stage && (
          <span className="text-[11px] tabular-nums">
            <span className="text-[8px] text-slate-500">STG</span> <span className={`font-semibold ${stageColor(stock.stage)}`}>{stripStage(stock.stage)}</span>
          </span>
        )}

        {stock.rs != null && (
          <span className="text-[11px] tabular-nums">
            <span className="text-[8px] text-slate-500">RS</span> <span className={`font-semibold ${rsColor(stock.rs)}`}>{stock.rs}</span>
          </span>
        )}

        {stock.adrPct != null && (
          <span className="text-[11px] text-slate-400 tabular-nums">
            <span className="text-[8px] text-slate-500">ADR</span> <span className="text-slate-300 font-semibold">{stock.adrPct.toFixed(1)}%</span>
          </span>
        )}
      </div>

      <div className="space-y-2.5">
        {stock.thesis && (
          <div className="flex gap-3">
            <span className="text-[9px] font-bold text-slate-500 tracking-wider uppercase shrink-0 w-24 pt-0.5">Core Thesis</span>
            <p className="text-[11px] text-slate-300 leading-relaxed">{stock.thesis}</p>
          </div>
        )}
        {stock.risk && (
          <div className="flex gap-3">
            <span className="text-[9px] font-bold text-amber-500/70 tracking-wider uppercase shrink-0 w-24 pt-0.5">Risk</span>
            <p className="text-[11px] text-slate-400 leading-relaxed">{stock.risk}</p>
          </div>
        )}
        {stock.invalidation && (
          <div className="flex gap-3">
            <span className="text-[9px] font-bold text-rose-500/70 tracking-wider uppercase shrink-0 w-24 pt-0.5">Invalidation</span>
            <p className="text-[11px] text-slate-400 leading-relaxed">{stock.invalidation}</p>
          </div>
        )}
      </div>

      {(stock.trigger != null || stock.stop != null || stock.target != null) && (
        <div className="flex items-center gap-4 mt-3 pt-2.5 border-t border-white/[0.04] text-[11px] tabular-nums">
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
  'Post-Market Gappers': { border: 'border-l-emerald-500', label: 'text-emerald-400' },
  'Stocks in Play Today': { border: 'border-l-indigo-400', label: 'text-indigo-400' },
  'Economic Data & Catalysts Today': { border: 'border-l-orange-400', label: 'text-orange-400' },
  "Today's Earnings Calendar": { border: 'border-l-lime-400', label: 'text-lime-400' },
};

function GapperRow({ s, red }: { s: StockEntry; red?: boolean }) {
  const dolVol = s.dvol != null ? s.dvol : (s.price && s.vol) ? s.price * s.vol : null;
  return (
    <div className={scrollWrap} style={scrollStyle}>
      <div className="grid items-center gap-x-1 py-[3px] text-[11px] tabular-nums " style={{ gridTemplateColumns: GRID_COLS_GAP }}>
        <span className={`text-[9px] font-black text-center ${s.grade === 'A' ? 'text-emerald-400' : s.grade === 'B' ? 'text-amber-400' : 'text-transparent'}`}>{s.grade || ''}</span>
        <span />
        <TickerChip stock={s} red={red} />
        <span className="text-center">{s.score != null ? <span className={`font-bold px-1 py-[1px] rounded border text-[9px] ${cnfBadgeCls(Number(s.score) || 0)}`}>{s.score}</span> : ''}</span>
        <span className={`font-semibold text-right ${(s.changePct || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{(s.changePct || 0) >= 0 ? '+' : ''}{s.changePct.toFixed(2)}%</span>
        <span className={`font-semibold text-right ${s.rvol != null ? rvolColor(s.rvol) : ''}`}>{s.rvol != null ? s.rvol.toFixed(2) : ''}</span>
        <span className="text-slate-400 text-right">{s.vol != null ? formatVol(s.vol) : ''}</span>
        <span className="text-slate-300 text-right">{dolVol != null ? `$${formatVol(dolVol)}` : ''}</span>
        <span className={`text-[9px] font-bold text-center ${s.stage ? stageColor(s.stage) : ''}`}>{s.stage ? stripStage(s.stage) : ''}</span>
        <span className={`font-semibold text-right ${s.rs != null ? rsColor(s.rs) : ''}`}>{s.rs != null ? s.rs : ''}</span>
        <span className="text-center"><NewsStars count={newsStars(s as any)} url={(s as any).catalystUrl} /></span>
      </div>
    </div>
  );
}

function GapperSection({ section }: { section: SectionResult }) {
  const [sk, setSk] = useState<SortKey | null>('cnf');
  const [sd, setSd] = useState<SortDir>('desc');
  const handleSort = useCallback((key: SortKey) => {
    if (sk === key) { if (sd === 'desc') setSd('asc'); else { setSk(null); setSd('desc'); } }
    else { setSk(key); setSd('desc'); }
  }, [sk, sd]);

  const stocks = section.stocks || [];
  const rawUps = stocks.filter(s => (s as any).direction === 'up' || (s as any).gapPct > 0);
  const rawDowns = stocks.filter(s => (s as any).direction === 'down' || (s as any).gapPct < 0);
  const ups = (sk ? sortStocks(rawUps, sk, sd) : rawUps.sort((a, b) => (b.changePct || 0) - (a.changePct || 0))).slice(0, 10);
  const downs = (sk ? sortStocks(rawDowns, sk, sd) : rawDowns.sort((a, b) => (a.changePct || 0) - (b.changePct || 0))).slice(0, 5);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {ups.length > 0 && (
        <div className="border-l-[3px] border-l-emerald-500 bg-[#0a1220] rounded-r-lg px-4 py-3">
          <div className="text-[11px] font-bold text-emerald-400 tracking-[0.15em] uppercase mb-2">
            Top Movers Up
          </div>
          <SummaryHeader gapper sortKey={sk} sortDir={sd} onSort={handleSort} />
          {ups.map((s, i) => <GapperRow key={i} s={s} />)}
        </div>
      )}
      {downs.length > 0 && (
        <div className="border-l-[3px] border-l-rose-500 bg-[#0a1220] rounded-r-lg px-4 py-3">
          <div className="text-[11px] font-bold text-rose-400 tracking-[0.15em] uppercase mb-2">
            Top Movers Down
          </div>
          <SummaryHeader gapper sortKey={sk} sortDir={sd} onSort={handleSort} />
          {downs.map((s, i) => <GapperRow key={i} s={s} red />)}
        </div>
      )}
    </div>
  );
}

function SIPSection({ section }: { section: SectionResult }) {
  const [sk, setSk] = useState<SortKey | null>('cnf');
  const [sd, setSd] = useState<SortDir>('desc');
  const handleSort = useCallback((key: SortKey) => {
    if (sk === key) { if (sd === 'desc') setSd('asc'); else { setSk(null); setSd('desc'); } }
    else { setSk(key); setSd('desc'); }
  }, [sk, sd]);

  const rawStocks = section.stocks || [];
  const stocks = sk ? sortStocks(rawStocks, sk, sd) : rawStocks;
  return (
    <div className="border-l-[3px] border-l-indigo-400 bg-[#0a1220] rounded-r-lg px-5 py-4">
      <div className="text-[11px] font-bold text-indigo-400 tracking-[0.15em] uppercase mb-3">
        {section.section}
      </div>
      {section.analysis && (
        <div className="text-[12px] text-slate-300 leading-[1.75] mb-3">
          {highlightBold(section.analysis, 'text-slate-100')}
        </div>
      )}
      {stocks.length > 0 && (() => {
        const top10 = stocks.slice(0, 10);
        const left = top10.slice(0, Math.ceil(top10.length / 2));
        const right = top10.slice(Math.ceil(top10.length / 2));
        const renderCol = (list: typeof stocks) => list.map((s, i) => {
          const setupLabel = s.setup && s.setup.toUpperCase() !== 'GENERIC' ? s.setup : null;
          const dolVol = s.dvol != null ? s.dvol : (s.price && s.vol) ? s.price * s.vol : null;
          return (
            <div key={i} className={scrollWrap} style={scrollStyle}>
              <div className="grid items-center gap-x-1 py-[3px] text-[11px] tabular-nums min-w-[420px]" style={{ gridTemplateColumns: GRID_COLS }}>
                <span className={`text-[9px] font-black text-center ${s.grade === 'A' ? 'text-emerald-400' : s.grade === 'B' ? 'text-amber-400' : 'text-transparent'}`}>{s.grade || ''}</span>
                <span />
                <TickerChip stock={s} />
                <span className="text-center">{s.score != null ? <span className={`font-bold px-1 py-[1px] rounded border text-[9px] ${cnfBadgeCls(Number(s.score) || 0)}`}>{s.score}</span> : ''}</span>
                <span className={`font-semibold text-right ${(s.changePct || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{(s.changePct || 0) >= 0 ? '+' : ''}{s.changePct.toFixed(2)}%</span>
                <span className={`font-semibold text-right ${s.rvol != null ? rvolColor(s.rvol) : ''}`}>{s.rvol != null ? s.rvol.toFixed(2) : ''}</span>
                <span className="text-slate-400 text-right">{s.vol != null ? formatVol(s.vol) : ''}</span>
                <span className="text-slate-300 text-right">{dolVol != null ? `$${formatVol(dolVol)}` : ''}</span>
                <span className={`text-[9px] font-bold text-center ${s.stage ? stageColor(s.stage) : ''}`}>{s.stage ? stripStage(s.stage) : ''}</span>
                <span className={`font-semibold text-right ${s.rs != null ? rsColor(s.rs) : ''}`}>{s.rs != null ? s.rs : ''}</span>
                <span className="text-center"><NewsStars count={newsStars(s as any)} url={(s as any).catalystUrl} /></span>
              </div>
            </div>
          );
        });
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
            <div>
              <SummaryHeader sortKey={sk} sortDir={sd} onSort={handleSort} />
              {renderCol(left)}
            </div>
            <div>
              <SummaryHeader sortKey={sk} sortDir={sd} onSort={handleSort} />
              {renderCol(right)}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function richText(text: string, withTickers = false): React.ReactNode {
  const stripped = text.replace(/\*\*/g, '');
  const colored = colorPcts(stripped, 0);
  if (!withTickers) return <>{colored}</>;
  return <>{colored.map((part, i) => typeof part === 'string' ? renderTickerChips(part, i * 1000) : part)}</>;
}

function parseLabeled(text: string): { label: string; value: string; detail: string }[] {
  const rows: { label: string; value: string; detail: string }[] = [];
  const lines = text.split('\n').filter(l => l.trim());
  for (const line of lines) {
    const m = line.match(/^\*{0,2}([A-Za-z0-9\s/&']+?)\*{0,2}:\s*(.+)/);
    if (!m) continue;
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

function FormattedBlock({ text, tickers, summaryLabel, skipLabels, distributeLabel }: { text: string; tickers?: boolean; summaryLabel?: string; skipLabels?: RegExp; distributeLabel?: RegExp }) {
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
    const rawLines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const lines: string[] = [];
    for (const l of rawLines) {
      if (l.length > 200) {
        lines.push(...l.split(/(?<=\.)\s+(?=[A-Z])/).map(s => s.trim()).filter(Boolean));
      } else {
        lines.push(l);
      }
    }
    return (
      <div className="space-y-4">
        {lines.map((line, i) => {
          const tickerStart = line.match(/^([A-Z]{2,5})\s*—\s*/);
          const lastDash = line.lastIndexOf(' — ');
          if (tickerStart && lastDash > tickerStart[0].length) {
            const ticker = tickerStart[1];
            const headline = line.slice(0, lastDash);
            let stockData = line.slice(lastDash + 3).trim();
            stockData = stockData.replace(new RegExp(`^${ticker}\\s+is\\s+`, 'i'), 'Is ');
            stockData = stockData.replace(new RegExp(`^${ticker}\\s+`, ''), '');
            return (
              <div key={i} className={i > 0 ? 'pt-3 border-t border-white/10' : ''}>
                <p className="text-[12px] text-slate-300 leading-[1.7]">
                  {richText(headline, tickers)}
                </p>
                <p className="text-[11px] text-slate-300 leading-relaxed mt-2 pl-4">
                  {richText(stockData.charAt(0).toUpperCase() + stockData.slice(1), tickers)}
                </p>
              </div>
            );
          }
          return (
            <p key={i} className={`text-[12px] text-slate-300 leading-[1.7] ${i > 0 ? 'pt-3 border-t border-white/10' : ''}`}>
              {richText(line, tickers)}
            </p>
          );
        })}
      </div>
    );
  }

  const summary = parsed.find(r => /^(overall|takeaway|summary)/i.test(r.label));
  const metrics = parsed.filter(r => r !== summary);

  return (
    <div className="space-y-5">
      {metrics.map((r, i) => (
        <div key={i} className={i > 0 ? 'pt-3 border-t border-white/10' : ''}>
          <div className="text-[10px] font-bold text-[#d4d4d8] tracking-wider uppercase mb-3">{r.label}</div>
          <p className="text-[12px] text-slate-300 leading-relaxed pl-4">
            {richText(r.value, tickers)}
          </p>
          {r.detail && (
            <p className="text-[11px] text-slate-300 leading-relaxed mt-3 pl-4">
              {richText(r.detail.charAt(0).toUpperCase() + r.detail.slice(1), tickers)}
            </p>
          )}
        </div>
      ))}
      {summary && (
        <div className="pt-3 border-t border-white/10">
          <div className="text-[10px] font-bold text-[#d4d4d8] tracking-wider uppercase mb-3">{summaryLabel || summary.label}</div>
          <p className="text-[12px] text-slate-300 leading-[1.7] pl-4">
            {richText(summary.value + (summary.detail ? ' — ' + summary.detail : ''), tickers)}
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

  const renderEarnRow = (e: EarningsEvent, i: number) => {
    const pending = e.epsActual == null;
    const beat = !pending && e.epsEstimated != null && e.epsActual != null && e.epsActual >= e.epsEstimated;
    const pct = e.epsSurprisePct != null ? ` (${e.epsSurprisePct > 0 ? '+' : ''}${e.epsSurprisePct.toFixed(1)}%)` : '';
    return (
      <div key={i} className="flex items-center gap-2 py-[3px] text-[11px] tabular-nums">
        <span className="w-[10px] text-center">{pending ? '▸' : ''}</span>
        <TickerChartHover symbol={e.symbol}><span className={BRIEF_TICKER_CHIP}>{e.symbol}</span></TickerChartHover>
        <span className="text-slate-400 min-w-[100px] truncate text-[10px]">{e.name?.split(' ').slice(0, 3).join(' ')}</span>
        {pending ? (
          <span className="text-slate-300">est {e.epsEstimated?.toFixed(2) ?? '—'}</span>
        ) : (
          <span className={beat ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
            {beat ? 'BEAT' : 'MISS'} {e.epsActual?.toFixed(2)} vs {e.epsEstimated?.toFixed(2)}{pct}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="border-l-[3px] border-l-amber-400 bg-amber-500/[0.04] rounded-r-lg px-6 py-5">
      <div className="text-[11px] font-bold text-amber-400 tracking-[0.15em] uppercase mb-5">
        Key Events
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
        {/* Economic */}
        <div>
          <div className="text-[9px] font-bold tracking-wider uppercase text-slate-500 mb-2">
            Economic {econToday.filter(e => e.minutes != null && e.minutes > nowMin && e.actual == null).length ? `— ${econToday.filter(e => e.minutes != null && e.minutes > nowMin && e.actual == null).length} still ahead` : '— all printed'}
          </div>
          <div className="flex items-center gap-1 py-[2px] border-b border-white/5 mb-1">
            <span className={`w-[10px] ${hdrCls}`} />
            <span className={`w-[56px] ${hdrCls}`}>TIME</span>
            <span className={`flex-1 ${hdrCls}`}>EVENT</span>
            <span className={`w-[48px] text-right ${hdrCls}`}>ACT</span>
            <span className={`w-[48px] text-right ${hdrCls}`}>EST</span>
            <span className={`w-[48px] text-right ${hdrCls}`}>PREV</span>
          </div>
          {econToday.map((e, i) => {
            const pending = e.minutes != null && e.minutes > nowMin && e.actual == null;
            return (
              <div key={i} className="flex items-center gap-1 py-[3px] text-[11px] tabular-nums">
                <span className="w-[10px] text-center text-amber-400">{pending ? '▸' : ''}</span>
                <span className="w-[56px] text-slate-400 text-[10px]">{fmtTime(e.minutes)}</span>
                <span className={`flex-1 truncate ${impactCls(e.impact)}`}>{e.event}</span>
                <span className={`w-[48px] text-right ${e.actual != null ? 'text-slate-200 font-semibold' : 'text-slate-600'}`}>{fmtNum(e.actual)}</span>
                <span className="w-[48px] text-right text-slate-500">{fmtNum(e.estimate)}</span>
                <span className="w-[48px] text-right text-slate-500">{fmtNum(e.previous)}</span>
              </div>
            );
          })}
          {econToday.length === 0 && <p className="text-[11px] text-slate-600 py-2">No medium/high impact events today.</p>}
        </div>
        {/* Earnings */}
        <div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <div className="text-[9px] font-bold tracking-wider uppercase text-slate-500 mb-2">
                Today {todayEarn.filter(e => e.epsActual == null).length ? `— ${todayEarn.filter(e => e.epsActual == null).length} pending` : todayEarn.length ? '— all reported' : ''}
              </div>
              {todayEarn.length > 0 ? todayEarn.map(renderEarnRow) : <p className="text-[11px] text-slate-600 py-2">No large-cap prints.</p>}
            </div>
            <div>
              <div className="text-[9px] font-bold tracking-wider uppercase text-slate-500 mb-2">
                Tomorrow {tmrwEarn.length ? `— ${tmrwEarn.length} pending` : ''}
              </div>
              {tmrwEarn.length > 0 ? tmrwEarn.map(renderEarnRow) : <p className="text-[11px] text-slate-600 py-2">No large-cap prints.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
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
    <div className={`border-l-[3px] ${style.border} bg-[#0a1220] rounded-r-lg px-5 py-4`}>
      <div className={`text-[11px] font-bold ${style.label} tracking-[0.15em] uppercase mb-3`}>
        {section.section}
      </div>
      {section.analysis && (
        <div className="text-[12px] text-slate-300 leading-[1.75] whitespace-pre-line">
          {highlightBold(section.analysis, 'text-slate-100', usePct)}
        </div>
      )}
    </div>
  );
}

interface SectorItem { name: string; pct: number; detail?: string }

function parseSectorItems(text: string): SectorItem[] {
  const items: SectorItem[] = [];
  const re = /([A-Za-z\s&/]+?)\s*\(([+-]?\d+\.?\d*)%\)/g;
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
  const allSectors = [...leading, ...lagging].sort((a, b) => b.pct - a.pct);
  const maxAbs = Math.max(...allSectors.map(s => Math.abs(s.pct)), 0.01);

  const movers = scannerData?.topMovers || {};
  const etfAll = [...(movers['ETF Gainers'] || []), ...(movers['ETF Losers'] || [])];
  const etfSeen = new Set<string>();
  const etfRows = etfAll
    .filter((e: any) => { if (!e?.ticker || etfSeen.has(e.ticker)) return false; etfSeen.add(e.ticker); return true; })
    .filter((e: any) => (e.dVol || 0) > 0)
    .sort((a: any, b: any) => (b.dVol || 0) - (a.dVol || 0))
    .slice(0, 5);

  const flowAll = [
    ...(movers['Gainers'] || []), ...(movers['Losers'] || []), ...(movers['Mega Caps'] || []),
  ];
  const flowSeen = new Set<string>();
  const flowRows = flowAll
    .filter((s: any) => { if (!s?.ticker || flowSeen.has(s.ticker)) return false; flowSeen.add(s.ticker); return true; })
    .filter((s: any) => (s.dVol || 0) > 0)
    .sort((a: any, b: any) => (b.dVol || 0) - (a.dVol || 0))
    .slice(0, 5);

  const etfUpD = etfAll.filter((e: any) => (e.changePct || 0) > 0).reduce((a: number, e: any) => a + (e.dVol || 0), 0);
  const etfTotD = etfAll.reduce((a: number, e: any) => a + (e.dVol || 0), 0);
  const etfAdvShare = etfTotD > 0 ? Math.round((etfUpD / etfTotD) * 100) : 0;

  const totalDVol = flowAll.reduce((a: number, s: any) => a + (s.dVol || 0), 0);
  const advDVol = flowAll.filter((s: any) => (s.changePct || 0) > 0).reduce((a: number, s: any) => a + (s.dVol || 0), 0);
  const mfAdvShare = totalDVol > 0 ? Math.round((advDVol / totalDVol) * 100) : 0;

  return (
    <div className="space-y-4">
      {allSectors.length > 0 && (() => {
        const best = allSectors[0];
        const worst = allSectors[allSectors.length - 1];
        const spread = best.pct - worst.pct;
        return (
          <div className="bg-gradient-to-b from-[#0b1424] to-[#0a1220] rounded-xl border border-white/[0.04] overflow-hidden">
            <div className="px-5 pt-4 pb-2 flex items-center justify-between">
              <div className="text-[10px] font-semibold text-slate-400 tracking-[0.15em] uppercase">
                Sector Performance
              </div>
              <div className="text-[10px] text-slate-600 tabular-nums">
                Spread {spread.toFixed(2)}%
              </div>
            </div>
            <div className="px-2 pb-3">
              {allSectors.map((s, i) => {
                const barWidth = (Math.abs(s.pct) / maxAbs) * 40;
                const isPositive = s.pct >= 0;
                const isFirst = i === 0;
                const isLast = i === allSectors.length - 1;
                return (
                  <div
                    key={i}
                    className="group flex items-center px-3 py-[3px] rounded transition-colors hover:bg-white/[0.02]"
                  >
                    <span className={`text-[11px] w-[140px] text-right shrink-0 pr-4 transition-colors ${isFirst ? 'text-emerald-300/90 font-medium' : isLast ? 'text-rose-300/90 font-medium' : 'text-slate-400 group-hover:text-slate-300'}`}>
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
                    <span className={`text-[11px] font-semibold tabular-nums w-[58px] text-right shrink-0 pl-2 ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {isPositive ? '+' : ''}{s.pct.toFixed(2)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {(etfRows.length > 0 || flowRows.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
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
  );
}

function NewsStars({ count, url }: { count: number; url?: string | null }) {
  if (count === 0) return <span className="text-slate-700">—</span>;
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
    <div className={`border-l-[3px] ${borderCls} ${bgCls} rounded-r-lg px-4 py-3`}>
      <div className={`text-[11px] font-bold ${titleCls} tracking-[0.15em] uppercase mb-1.5`}>
        {title}
      </div>
      <p className="text-[10px] text-slate-400 leading-relaxed mb-2">{blurb}</p>
      <div className="overflow-x-auto">
        <table className="text-[11px] tabular-nums" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr className="text-[8px] font-bold tracking-widest text-slate-600 uppercase border-b border-white/5">
              <th className="text-left pb-1 pr-1">Ticker</th>
              <th className="text-center pb-1 px-1">CNF</th>
              <th className="text-right pb-1 px-1">CHG%</th>
              <th className="text-right pb-1 px-1">RVOL</th>
              <th className="text-right pb-1 px-1">VOL</th>
              <th className="text-right pb-1 px-1">$VOL</th>
              <th className="text-center pb-1 px-1">STG</th>
              <th className="text-right pb-1 px-1">RS</th>
              <th className="text-center pb-1 pl-1">N</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any, i: number) => {
              const chg = r.changePct || 0;
              const cnf = r.cnfScore ?? 0;
              const grade = r.cnfGrade;
              const dot = r.dotKind;
              const rs = r.rsRating || 0;
              const stage = fmtStage(r.stage);
              const stars = newsStars(r);
              return (
                <tr key={i} className="border-b border-white/[0.03]">
                  <td className="py-[4px] pr-1 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      <ChartTooltip symbol={r.ticker}>
                        <span className={`text-[10px] font-bold tracking-wider rounded px-1.5 py-[1px] text-center ${chg >= 0 ? 'text-emerald-300 bg-emerald-500/10 border border-emerald-500/20' : 'text-rose-300 bg-rose-500/10 border border-rose-500/20'}`}>
                          {r.ticker}
                        </span>
                      </ChartTooltip>
                      {dot === 'red' && <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />}
                      {dot === 'blue' && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />}
                    </span>
                  </td>
                  <td className="py-[4px] px-1 text-center whitespace-nowrap">
                    <span className={`inline-block text-[10px] font-bold rounded px-1.5 py-[1px] min-w-[22px] text-center ${cnfBadge(cnf, grade)}`}>
                      {cnf}
                    </span>
                  </td>
                  <td className={`py-[4px] px-1 text-right whitespace-nowrap font-semibold ${chg >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {chg >= 0 ? '+' : ''}{chg.toFixed(2)}%
                  </td>
                  <td className={`py-[4px] px-1 text-right whitespace-nowrap ${(r.rvol || 0) >= 2 ? 'text-emerald-400 font-semibold' : (r.rvol || 0) >= 1 ? 'text-slate-300' : 'text-slate-500'}`}>
                    {(r.rvol || 0).toFixed(2)}
                  </td>
                  <td className="py-[4px] px-1 text-right whitespace-nowrap text-slate-400">{fmtVol(r.vol || 0)}</td>
                  <td className="py-[4px] px-1 text-right whitespace-nowrap text-slate-400">{fmtDollar(r.dVol || 0)}</td>
                  <td className={`py-[4px] px-1 text-center whitespace-nowrap text-[10px] ${/^[12]/.test(stage) ? 'text-emerald-400' : /^[4]/.test(stage) ? 'text-rose-400' : 'text-slate-500'}`}>{stage}</td>
                  <td className={`py-[4px] px-1 text-right whitespace-nowrap font-semibold ${rs >= 80 ? 'text-emerald-400' : rs >= 50 ? 'text-slate-300' : rs > 0 ? 'text-rose-400' : 'text-slate-600'}`}>{rs || ''}</td>
                  <td className="py-[4px] pl-1 text-center whitespace-nowrap"><NewsStars count={stars} url={r.catalystUrl} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function verdictColor(analysis: string): string {
  if (/RISK-ON/i.test(analysis)) return 'emerald';
  if (/RISK-OFF/i.test(analysis)) return 'rose';
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
}

const CHOP_BANDS = { chop: 50, trend: 28, dead: 58, strongTrend: 20 };

function chopZone(v: number): string {
  if (v >= CHOP_BANDS.dead) return 'DEAD CHOP';
  if (v >= CHOP_BANDS.chop) return 'CHOPPY';
  if (v > CHOP_BANDS.trend) return 'MIXED';
  if (v > CHOP_BANDS.strongTrend) return 'TRENDING';
  return 'STRONG TREND';
}

function chopBadgeCls(v: number): string {
  if (v >= CHOP_BANDS.dead) return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
  if (v >= CHOP_BANDS.chop) return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
  if (v > CHOP_BANDS.trend) return 'bg-slate-500/10 text-slate-300 border-white/10';
  return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
}

function t2108Zone(v: number): string {
  if (v <= 20) return 'OVERSOLD';
  if (v <= 35) return 'WASHED';
  if (v <= 65) return 'NEUTRAL';
  if (v <= 80) return 'WARM';
  return 'OVERBOUGHT';
}

function t2108BadgeCls(v: number): string {
  if (v <= 20) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
  if (v <= 35) return 'bg-lime-500/10 text-lime-400 border-lime-500/20';
  if (v <= 65) return 'bg-slate-500/10 text-slate-300 border-white/10';
  if (v <= 80) return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
  return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
}

function MacroBadgeBar({ badges }: { badges: MacroBadges | null }) {
  if (!badges) return null;
  const toneCls = badges.tone === 'BULLISH' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
    badges.tone === 'BEARISH' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
    'bg-amber-500/10 text-amber-400 border-amber-500/20';
  const breadthCls = badges.breadth
    ? (badges.breadth.signal === 'GREEN' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
       badges.breadth.signal === 'RED' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
       'bg-amber-500/10 text-amber-400 border-amber-500/20')
    : '';
  return (
    <div className="flex flex-wrap items-center gap-2 mb-5">
      <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-md border ${toneCls}`}>
        TONE: {badges.tone}
      </span>
      {badges.breadth && (
        <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-md border ${breadthCls}`}>
          BREADTH {badges.breadth.score}/6
        </span>
      )}
      {badges.chop && (
        <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-md border ${chopBadgeCls(badges.chop.value)}`}>
          CHOP: {badges.chop.zone} {badges.chop.value.toFixed(0)}
        </span>
      )}
      {badges.t2108 && (
        <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-md border ${t2108BadgeCls(badges.t2108.value)}`}>
          T2108 {badges.t2108.zone}
        </span>
      )}
    </div>
  );
}

export default function AnalystBrief() {
  const [brief, setBrief] = useState<BriefData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey | null>('cnf');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [macroBadges, setMacroBadges] = useState<MacroBadges | null>(null);
  const [scannerData, setScannerData] = useState<any>(null);

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
      const res = await fetch('/api/analyst/brief', { cache: 'no-store' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
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
          fetch(`/api/chop?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
        ]);

        const quotes = macroRes?.quotes || {};
        const getPct = (id: string) => quotes[id]?.pct || 0;
        const eqScore = (getPct('SPY') * 3.0) + (getPct('QQQ') * 2.5) + (getPct('IWM') * 1.0);
        const vixPct = getPct('VIX');
        const volScore = Math.abs(vixPct) > 2 ? (vixPct * -0.6) : 0;
        const cryptoScore = (getPct('BTC') * 0.25);
        const bData = macroRes?.breadth;
        const breadthAdj = bData ? ((bData.score - 3) / 3) * 1.5 : 0;
        const totalScore = eqScore + volScore + cryptoScore + breadthAdj;
        const tone: 'BULLISH' | 'NEUTRAL' | 'BEARISH' = totalScore >= 1.0 ? 'BULLISH' : totalScore <= -1.0 ? 'BEARISH' : 'NEUTRAL';

        const breadth = bData ? { score: bData.score, signal: bData.signal } : null;

        let chopObj: { value: number; zone: string } | null = null;
        if (chopRes?.success) {
          const raw = chopRes.daily?.blended ?? chopRes.blended ?? null;
          if (raw != null) {
            let adj = 0;
            if (bData && typeof bData.score === 'number') {
              const centrality = 1 - Math.abs(bData.score - 3) / 3;
              adj += (centrality - 0.5) * 2 * 3;
            }
            const composite = Math.max(0, Math.min(100, raw + adj));
            chopObj = { value: composite, zone: chopZone(composite) };
          }
        }

        let t2108Obj: { value: number; zone: string } | null = null;
        if (t2108Res?.value != null) {
          t2108Obj = { value: t2108Res.value, zone: t2108Zone(t2108Res.value) };
        }

        setMacroBadges({ tone, breadth, chop: chopObj, t2108: t2108Obj });
      } catch { /* non-fatal */ }
    };
    fetchMacro();
  }, []);

  useEffect(() => {
    fetch('/api/scanner/latest', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setScannerData(d); })
      .catch(() => {});
  }, []);

  const regime = brief?.sections.find(s => s.section === 'Market Regime');
  const tradesRaw = brief?.sections.find(s => s.section === 'Top Trades');
  const trades = tradesRaw ? { ...tradesRaw, stocks: normalizeStocks(tradesRaw.stocks) } : undefined;
  const avoidRaw = brief?.sections.find(s => s.section === 'Top Avoid');
  const avoid = avoidRaw ? { ...avoidRaw, stocks: normalizeStocks(avoidRaw.stocks) } : undefined;
  const breadthSection = brief?.sections.find(s => s.section === 'Sentiment & Market Breadth');
  const preGapperRaw = brief?.sections.find(s => /Pre.*Gapper/i.test(s.section)) || brief?.sections.find(s => /Gappers/i.test(s.section));
  const gapperSection = preGapperRaw ? { ...preGapperRaw, stocks: normalizeStocks(preGapperRaw.stocks) } : undefined;
  const sipRaw = brief?.sections.find(s => s.section === 'Stocks in Play Today');
  const sipSection = sipRaw ? { ...sipRaw, stocks: normalizeStocks(sipRaw.stocks) } : undefined;

  const isGapper = (s: SectionResult) => /Gappers/i.test(s.section);
  const postSipSections = brief?.sections.filter(s => {
    const order = ['Economic Data & Catalysts Today', "Today's Earnings Calendar"];
    return order.includes(s.section);
  }) || [];

  const color = regime ? verdictColor(regime.analysis) : 'slate';
  const dotCls = color === 'emerald' ? 'bg-emerald-400' : color === 'rose' ? 'bg-rose-400' : 'bg-amber-400';
  const borderCls = color === 'emerald' ? 'border-emerald-500/30' : color === 'rose' ? 'border-rose-500/30' : 'border-amber-500/30';
  const bgCls = color === 'emerald' ? 'bg-emerald-500/[0.06]' : color === 'rose' ? 'bg-rose-500/[0.06]' : 'bg-amber-500/[0.06]';

  return (
    <ActiveChartProvider>
    <div className="min-h-screen bg-[#05080f] text-slate-300 font-sans">
      <div className="max-w-[900px] mx-auto px-4 md:px-8 py-8">

        <div className="flex justify-between items-center mb-6">
          <div>
            <a href="/" className="text-slate-500 hover:text-slate-300 text-xs transition-colors">&larr; Dashboard</a>
            <div className="flex items-center gap-3 mt-1">
              <img src="/logo.svg" alt="CTT" className="ctt-logo h-7 md:h-9 w-auto" />
              <h1 className="text-xl md:text-2xl font-extrabold text-slate-100">Confluence Trading Tools Market Briefing</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              onClick={() => fetchBrief()}
              disabled={loading}
              className="px-4 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
        </div>

        <MacroBadgeBar badges={macroBadges} />

        {brief && (
          <div className="text-[10px] text-slate-600 mb-5">
            Updated {brief.snapshotTime ? new Date(brief.snapshotTime).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) : brief.generatedAtET} ET
          </div>
        )}

        {loading && !brief && (
          <div className="flex items-center justify-center py-20 gap-3">
            <div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
            <span className="text-slate-500 text-sm">Loading...</span>
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm">{error}</div>
        )}

        {brief && (
          <div className="space-y-8">

            {/* 1. Sentiment & Market Breadth */}
            {breadthSection && breadthSection.analysis && (
              <div className="border-l-[3px] border-l-rose-400 bg-rose-500/[0.06] rounded-r-lg px-6 py-5">
                <div className="text-[11px] font-bold text-rose-400 tracking-[0.15em] uppercase mb-5">
                  Sentiment &amp; Market Breadth
                </div>
                <FormattedBlock text={breadthSection.analysis} />
              </div>
            )}

            {/* 2. Macro Snapshot */}
            {(() => {
              const macroSec = brief.sections.find(s => /Futures.*Macro|Macro.*Snapshot/i.test(s.section));
              return macroSec?.analysis ? (
                <div className="border-l-[3px] border-l-cyan-500 bg-cyan-500/[0.04] rounded-r-lg px-6 py-5">
                  <div className="text-[11px] font-bold text-cyan-400 tracking-[0.15em] uppercase mb-5">
                    Macro Snapshot
                  </div>
                  <FormattedBlock text={macroSec.analysis} tickers skipLabels={/^futures/i} distributeLabel={/^macro read/i} />
                </div>
              ) : null;
            })()}

            {/* 3. Key News & Catalysts */}
            {(() => {
              const newsSec = brief.sections.find(s => s.section === 'Key News & Catalysts');
              return newsSec?.analysis ? (
                <div className="border-l-[3px] border-l-violet-500 bg-violet-500/[0.04] rounded-r-lg px-6 py-5">
                  <div className="text-[11px] font-bold text-violet-400 tracking-[0.15em] uppercase mb-5">
                    Key News &amp; Catalysts
                  </div>
                  <FormattedBlock text={newsSec.analysis} tickers />
                </div>
              ) : null;
            })()}

            {/* 4. Caution Flag */}
            {brief.regimeDetail && (
              <div className={`border-l-[3px] ${REGIME_COLORS.amber.border} ${REGIME_COLORS.amber.bg} rounded-r-lg px-6 py-5`}>
                <div className={`text-[11px] font-bold ${REGIME_COLORS.amber.label} tracking-[0.15em] uppercase mb-5`}>
                  Caution Flag
                </div>
                <FormattedBlock text={brief.regimeDetail.caution} tickers />
              </div>
            )}

            {/* Sectors */}
            {(() => {
              const sectorSec = brief.sections.find(s => s.section === 'Top Sectors & Money Flow');
              return sectorSec ? <SectorSection section={sectorSec} scannerData={scannerData} /> : null;
            })()}

            {/* Legend key */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-1">
              <span className="flex items-center gap-1.5 text-[9px] text-slate-500 font-bold tracking-wider uppercase">
                Grade:
                <span className="text-[9px] font-black text-emerald-400">A</span>
                <span className="text-[9px] font-black text-amber-400">B</span>
              </span>
              <span className="flex items-center gap-1.5 text-[9px] text-slate-500 font-bold tracking-wider uppercase cursor-help" title="Confluence score 0–100. Measures conviction from RVOL, gap, range expansion, relative strength, and catalyst quality.">
                CNF:
                <span className="font-bold px-1 py-[1px] rounded border text-emerald-400 bg-emerald-500/10 border-emerald-500/20">70+</span>
                <span className="font-bold px-1 py-[1px] rounded border text-amber-400 bg-amber-500/10 border-amber-500/20">50–69</span>
              </span>
              <span className="flex items-center gap-1.5 text-[9px] text-slate-500 font-bold tracking-wider uppercase">
                Setup:
                {Object.entries(SETUP_COLORS).map(([k, cls]) => (
                  <span key={k} className={`font-bold px-1 py-[1px] rounded border uppercase tracking-wide ${cls}`}>{k}</span>
                ))}
              </span>
              <span className="flex items-center gap-1.5 text-[9px] text-slate-500 font-bold tracking-wider uppercase">
                <span className="text-[9px] font-bold tracking-wider text-rose-200 bg-rose-950 border border-rose-500/20 rounded px-1.5 py-[1px] text-center">TRAP</span>
              </span>
            </div>
            <hr className="border-white/10" />

            {/* Top Movers */}
            {gapperSection && <GapperSection section={gapperSection} />}

            {/* Stocks in Play with full grid */}
            {sipSection && <SIPSection section={sipSection} />}

            {/* Actionable Summary (below Stocks in Play) */}
            {brief.summary && <ActionableSummary summary={brief.summary} trades={trades?.stocks} avoidStocks={avoid?.stocks} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />}

            {/* Key Events: econ + earnings (same data as main dashboard) */}
            <KeyEventsSection />

          </div>
        )}

        <div className="mt-8 pt-4 border-t border-white/10 text-center text-[10px] text-slate-700">
          Not investment advice · Scanner data only
        </div>
      </div>
    </div>
    </ActiveChartProvider>
  );
}

'use client';

// Multibagger — 100-Bagger Scorecard — v1.0
//
// Fundamental scan for potential compounders. Screens on revenue growth,
// return on capital, low debt, market cap (room to multiply), valuation,
// and cash generation. Updated daily from SEC filings.

import React, { useState, useEffect, useMemo } from 'react';
import { cachedJson } from '@/lib/scannerLatest';
import { MULTIBAGGER } from '@/lib/scanConfig';
import { rsBadge } from '@/lib/indicators/rs';

import { useMarketData } from './MarketDataContext';
import TickerChartHover from './TickerChartHover';
import { NewsStars } from '@/lib/catalyst';
import { stageColor as stgColor, stageBadge, stageShort as stgShort, stageDescription } from '@/lib/indicators/stage';
import { rvolColorLowFloor as rvolColor, tickerChipCls, scoreCellCls } from '@/lib/indicators/columnColors';
import { displaySector } from '@/lib/sectors';

const ATTR_LABELS: Record<string, string> = {
  revenueGrowth: 'Revenue Growth',
  returnOnCapital: 'Return on Capital',
  lowDebt: 'Low Debt',
  marketCap: 'Market Cap',
  valuation: 'Valuation',
  cashGeneration: 'Cash Generation',
};

const ATTR_MAX: Record<string, number> = {
  revenueGrowth: 25,
  returnOnCapital: 20,
  lowDebt: 15,
  marketCap: 20,
  valuation: 10,
  cashGeneration: 10,
};

const attrStatus = (val: number, max: number): { passed: boolean; pct: number } => {
  const pct = max > 0 ? val / max : 0;
  return { passed: pct >= 0.5, pct };
};

const fmtPct = (v: number | null): string =>
  v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : '—';

const fmtRatio = (v: number | null): string =>
  v != null ? v.toFixed(2) : '—';

const fmtPe = (v: number | null): string =>
  v != null ? v.toFixed(1) : '—';

const mcapColor = (tier: string): string => {
  if (tier === 'Micro') return 'text-fuchsia-400';
  if (tier === 'Small') return 'text-emerald-400';
  if (tier === 'Mid') return 'text-slate-300';
  return 'text-slate-500';
};

const revColor = (v: number | null): string => {
  if (v == null) return 'text-slate-500';
  if (v >= 25) return 'text-fuchsia-400';
  if (v >= 15) return 'text-emerald-400';
  if (v >= 5) return 'text-lime-400';
  return 'text-red-400';
};

const roicColor = (v: number | null): string => {
  if (v == null) return 'text-slate-500';
  if (v >= 20) return 'text-fuchsia-400';
  if (v >= 15) return 'text-emerald-400';
  if (v >= 10) return 'text-lime-400';
  if (v >= 5) return 'text-slate-300';
  return 'text-red-400';
};

const debtColor = (v: number | null): string => {
  if (v == null) return 'text-slate-500';
  if (v <= 0.3) return 'text-emerald-400';
  if (v <= 0.5) return 'text-lime-400';
  if (v <= 1.0) return 'text-amber-400';
  return 'text-red-400';
};

const peColor = (v: number | null): string => {
  if (v == null) return 'text-slate-500';
  if (v <= 15) return 'text-emerald-400';
  if (v <= 25) return 'text-lime-400';
  if (v <= 35) return 'text-amber-400';
  return 'text-red-400';
};

const fcfColor = (v: number | null): string => {
  if (v == null) return 'text-slate-500';
  if (v >= 7) return 'text-emerald-400';
  if (v >= 3) return 'text-lime-400';
  if (v >= 0) return 'text-amber-400';
  return 'text-red-400';
};

const formatTime = (timestamp: number | Date) => {
  if (!timestamp) return '';
  const d = typeof timestamp === 'number' ? new Date(timestamp) : timestamp;
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'America/New_York' });
};

interface Candidate {
  ticker: string;
  name: string;
  price: number;
  marketCap: number;
  marketCapFmt: string;
  mcapTier: string;
  sector: string;
  employees?: number | null;
  changePct: number;
  vol: number;
  dvol: number;
  avgVol?: number;
  rvol?: number | null;
  stage?: string | null;
  stageShort?: string;
  rs?: number | null;
  vwapStatus?: 'above' | 'below' | 'neutral';
  score: number;
  grade: string;
  breakdown: Record<string, number>;
  attrs: {
    revGrowthPct: number | null;
    revGrowthYears: number;
    roic: number | null;
    debtToEquity: number | null;
    pe: number | null;
    fcfYield: number | null;
  };
}

const chgColor = (v: number): string => {
  if (v >= 5) return 'text-emerald-400';
  if (v >= 1) return 'text-lime-400';
  if (v >= -1) return 'text-slate-300';
  if (v >= -5) return 'text-red-400';
  return 'text-red-500';
};


const fmtVol = (v: number): string => {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
};

const fmtDvol = (v: number): string => {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v}`;
};

type SortKey = 'score' | 'chg' | 'vol' | 'dvol' | 'rvol' | 'rs' | 'stage' | 'revGrowth' | 'roic' | 'debt' | 'pe' | 'mcap' | 'fcf';
type GradeFilter = 'All' | 'A' | 'B';
type McapFilter = 'All' | 'Micro' | 'Small' | 'Mid';
type VwapFilterType = 'All' | 'above' | 'below';

const GRADE_BUCKETS: GradeFilter[] = ['A', 'B'];
const MCAP_BUCKETS: McapFilter[] = ['Micro', 'Small', 'Mid'];

const COLUMN_TIPS: Record<string, string> = {
  TICKER: 'Symbol. Hover for company name.',
  SCORE: 'Multibagger score 0–100. Sum of six fundamental attributes: Revenue Growth (25), Return on Capital (20), Low Debt (15), Market Cap (20), Valuation (10), Cash Generation (10). Hover the number for the breakdown.',
  PRICE: 'Current price. Green/red dot = above/below VWAP — click to filter.',
  'CHG%': 'Today\'s price change percentage from Polygon snapshot.',
  VOL: 'Today\'s trading volume.',
  DVOL: 'Dollar volume — price × volume. Measures liquidity in dollar terms.',
  RVOL: 'Relative volume — today\'s volume / 20-day average volume. ≥2 = unusual activity.\n\nFuchsia ≥3 · green ≥2 · lime ≥1.5 · grey below.',
  RS: 'IBD-style Relative Strength Rating — percentile against all liquid US stocks. 88 = stronger than 88% of the market.\n\nFuchsia ≥90 · green ≥80 · grey ≥70 · red below 50.',
  STAGE: 'Weinstein stage from the 150-SMA slope.\n\n2A = strong advance (buy zone) · 2B = mature advance · 2C = pullback in uptrend · 1 = basing · 3 = topping · 4 = decline.',
  'REV%': 'Average annual revenue growth rate, calculated from the last 2–4 years of SEC filings.\n\nFuchsia ≥25% · green ≥15% · lime ≥5% · red below.',
  ROIC: 'Return on Invested Capital — NOPAT / (Total Assets − Current Liabilities). The compounding engine: how much value each reinvested dollar creates.\n\nFuchsia ≥20% · green ≥15% · lime ≥10% · red below.',
  'D/E': 'Debt to Equity — non-current liabilities / shareholders equity. Lower is better for compounders.\n\nGreen ≤0.3 · lime ≤0.5 · amber ≤1.0 · red above.',
  MCAP: 'Market capitalisation tier. Micro ≤$300M · Small ≤$2B · Mid ≤$10B. Smaller companies have more room to multiply.\n\nFuchsia micro · green small · grey mid.',
  'P/E': 'Price to Earnings — market cap / net income from the latest annual filing. Lower means cheaper entry.\n\nGreen ≤15 · lime ≤25 · amber ≤35 · red above.',
  'FCF%': 'Free Cash Flow Yield — (operating cash flow − capex) / market cap. Cash generation the business actually produces.\n\nGreen ≥7% · lime ≥3% · amber ≥0% · red negative.',
  SECTOR: 'Abbreviated SIC sector.',
};

export default function Multibagger() {
  const { session } = useMarketData();
  const displaySession = ['Pre-Market', 'Open', 'Post-Market', 'Closed'].includes(session) ? session : 'Closed';
  const sessionColor = displaySession === 'Open' ? 'text-[#00e676]' : displaySession === 'Pre-Market' ? 'text-amber-500' : displaySession === 'Post-Market' ? 'text-indigo-400' : 'text-slate-400';

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [lastScanTime, setLastScanTime] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [scanMeta, setScanMeta] = useState<any>(null);
  const [funnelInfo, setFunnelInfo] = useState<{ universeSize?: number; mcapFiltered?: number; scored?: number }>({});

  const [isExpanded, setIsExpanded] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [gradeFilter, setGradeFilter] = useState<GradeFilter>('All');
  const [mcapFilter, setMcapFilter] = useState<McapFilter>('All');
  const [hideDecline, setHideDecline] = useState(true);
  const [minRvol, setMinRvol] = useState<number | null>(null);
  const [minRs, setMinRs] = useState<number | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [vwapFilter, setVwapFilter] = useState<VwapFilterType>('All');
  const toggleVwap = (status: 'above' | 'below') => setVwapFilter(prev => prev === status ? 'All' : status);

  const gradeACount = useMemo(() => candidates.filter(c => c.grade === 'A').length, [candidates]);
  const gradeBCount = useMemo(() => candidates.filter(c => c.grade === 'B').length, [candidates]);
  const stage2Count = useMemo(() => candidates.filter(c => {
    const s = (c.stageShort || '').toUpperCase();
    return s.startsWith('2');
  }).length, [candidates]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        /* Shared TTL cache — see lib/scannerLatest. Throws on non-ok, so the
           explicit status check it replaced is preserved. */
        const data = await cachedJson('/api/multibagger/latest');
        if (data.success) {
          setCandidates(data.candidates || []);
          setLastScanTime(data.lastScanTime);
          setScanMeta(data.scanMeta);
          setFunnelInfo({
            universeSize: data.universeSize,
            mcapFiltered: data.mcapFiltered,
            scored: data.scored,
          });
        }
      } catch (e) {
        console.error('Multibagger fetch error:', e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, []);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const [copied, setCopied] = useState(false);
  const handleCopyTickers = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const tickers = filtered.map(c => c.ticker).join(',');
    if (!tickers) return;
    try { await navigator.clipboard.writeText(tickers); } catch {
      const ta = document.createElement('textarea'); ta.value = tickers; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch {} document.body.removeChild(ta);
    }
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  };

  const [txtDone, setTxtDone] = useState(false);
  const handleDownloadTxt = (e: React.MouseEvent) => {
    e.stopPropagation();
    const t = filtered.map(c => c.ticker);
    if (!t.length) return;
    const blob = new Blob([t.join(',')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'watchlist.txt';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setTxtDone(true); setTimeout(() => setTxtDone(false), 1800);
  };

  const filtered = useMemo(() => {
    let rows = [...candidates];
    if (gradeFilter !== 'All') {
      const minScore = gradeFilter === 'A' ? 70 : 50;
      rows = rows.filter(r => r.score >= minScore);
    }
    if (mcapFilter !== 'All') {
      rows = rows.filter(r => r.mcapTier === mcapFilter);
    }
    if (hideDecline) {
      rows = rows.filter(r => {
        const s = (r.stageShort || '').replace(/Stage\s*/i, '').trim().toUpperCase();
        return !s.startsWith('3') && !s.startsWith('4');
      });
    }
    if (minRvol != null) {
      rows = rows.filter(r => r.rvol != null && r.rvol >= minRvol);
    }
    if (minRs != null) {
      rows = rows.filter(r => r.rs != null && r.rs >= minRs);
    }
    if (vwapFilter !== 'All') {
      rows = rows.filter(r => r.vwapStatus === vwapFilter);
    }

    const dir = sortDir === 'desc' ? -1 : 1;
    rows.sort((a, b) => {
      let av: number, bv: number;
      switch (sortKey) {
        case 'score': av = a.score; bv = b.score; break;
        case 'chg': av = a.changePct; bv = b.changePct; break;
        case 'vol': av = a.vol; bv = b.vol; break;
        case 'dvol': av = a.dvol; bv = b.dvol; break;
        case 'rvol': av = a.rvol ?? -999; bv = b.rvol ?? -999; break;
        case 'rs': av = a.rs ?? -999; bv = b.rs ?? -999; break;
        case 'stage': {
          const sn = (s: string | null | undefined) => {
            if (!s || s === '—') return 0;
            const n = s.replace(/Stage\s*/i, '');
            return parseFloat(n) || 0;
          };
          av = sn(a.stageShort); bv = sn(b.stageShort); break;
        }
        case 'revGrowth': av = a.attrs.revGrowthPct ?? -999; bv = b.attrs.revGrowthPct ?? -999; break;
        case 'roic': av = a.attrs.roic ?? -999; bv = b.attrs.roic ?? -999; break;
        case 'debt': av = a.attrs.debtToEquity ?? 999; bv = b.attrs.debtToEquity ?? 999;
          return dir * (bv - av);
        case 'pe': av = a.attrs.pe ?? 999; bv = b.attrs.pe ?? 999;
          return dir * (bv - av);
        case 'mcap': av = a.marketCap; bv = b.marketCap;
          return dir * (bv - av);
        case 'fcf': av = a.attrs.fcfYield ?? -999; bv = b.attrs.fcfYield ?? -999; break;
        default: av = a.score; bv = b.score;
      }
      const primary = dir * (av - bv);
      if (primary !== 0 || sortKey === 'rs') return primary;
      return (b.rs ?? -999) - (a.rs ?? -999);
    });

    return rows;
  }, [candidates, gradeFilter, mcapFilter, hideDecline, minRvol, minRs, vwapFilter, sortKey, sortDir]);

  const buildBreakdownTip = (c: Candidate): string => {
    const lines = Object.entries(c.breakdown).map(([k, v]) => {
      const label = ATTR_LABELS[k] || k;
      const max = ATTR_MAX[k] || 0;
      return `${label}: ${v}/${max}`;
    });
    return lines.join('\n');
  };

  const SortArrow = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return null;
    return <span className="ml-0.5 text-[8px]">{sortDir === 'desc' ? '▼' : '▲'}</span>;
  };

  const filterBtnActive = "bg-[#1e293b] text-indigo-400 border border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.1)]";
  const filterBtnIdle = "text-slate-500 border border-transparent hover:text-slate-300 hover:bg-white/[0.02]";
  const pillBtnCls = "px-3 py-1 rounded-lg text-[11px] font-bold tracking-widest uppercase transition-all duration-300 whitespace-nowrap";
  const Pill = ({ label, active, onClick, title }: { label: string; active: boolean; onClick: () => void; title?: string }) => (
    <button
      onClick={onClick}
      title={title}
      className={`${pillBtnCls} ${active ? filterBtnActive : filterBtnIdle}`}
    >
      {label}
    </button>
  );

  const thBase = "px-0.5 py-2.5 text-[10px] text-slate-500 font-bold tracking-wide leading-tight cursor-pointer hover:text-slate-300 transition-colors text-center";
  const tdBase = "px-0.5 pt-2.5 pb-1.5 text-center";
  const thStage = "px-0.5 pl-1.5 py-2.5 text-[10px] text-slate-500 font-bold tracking-wide leading-tight cursor-pointer hover:text-slate-300 transition-colors text-left";
  const tdStage = "px-0.5 pl-1.5 pt-2.5 pb-1.5 text-left";
  const thSector = "px-0.5 pl-1.5 py-2.5 text-[10px] text-slate-500 font-bold tracking-wide leading-tight cursor-pointer hover:text-slate-300 transition-colors text-left";
  const tdSector = "px-0.5 pl-1.5 pt-2.5 pb-1.5 text-left";

  return (
    <div className="bg-[#101623] border-0 md:border md:border-white/5 md:rounded-2xl p-2 md:p-5 relative overflow-visible md:shadow-xl w-full max-w-[1280px] mx-auto">
      <div onClick={() => setIsExpanded(!isExpanded)} className={`flex justify-between items-center relative z-30 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-5 border-b border-white/5 pb-4' : ''}`}>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs md:text-sm font-bold text-[#7c8bfa] bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 group-hover:bg-white/[0.02] transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
            100-BAGGER SCORECARD
          </span>
          {filtered.length > 0 && (
            <button
              onClick={handleCopyTickers}
              title={`Copy ${filtered.length} ticker${filtered.length !== 1 ? 's' : ''} for TradingView`}
              className={`text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded border transition-all duration-200 ${
                copied
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-[#161c2a] text-slate-400 border-white/5 hover:text-slate-200 hover:bg-white/[0.04]'
              }`}
            >
              {copied ? `✓ Copied ${filtered.length}` : `Copy ${filtered.length}`}
            </button>
          )}
          {filtered.length > 0 && (
            <button
              onClick={handleDownloadTxt}
              title={`Download ${filtered.length} ticker${filtered.length !== 1 ? 's' : ''} as .txt for TradingView import`}
              className={`text-[10px] font-bold tracking-wider uppercase px-2 py-1 rounded border transition-all duration-200 ${
                txtDone
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-[#161c2a] text-slate-400 border-white/5 hover:text-slate-200 hover:bg-white/[0.04]'
              }`}
            >
              {txtDone ? '✓ TXT' : 'TXT'}
            </button>
          )}
          {!isLoading && candidates.length > 0 && (
            <span className="hidden md:flex basis-full items-center gap-1.5 mt-1" onClick={e => e.stopPropagation()}>
              <button
                onClick={() => { setGradeFilter(gradeFilter === 'A' ? 'All' : 'A'); setIsExpanded(true); }}
                className={`text-[9px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded border transition-all cursor-pointer ${
                  gradeFilter === 'A'
                    ? 'text-emerald-300 bg-emerald-500/20 border-emerald-400/40 ring-1 ring-emerald-500/30'
                    : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20'
                }`}
              >{gradeACount} Grade A</button>
              <button
                onClick={() => { setGradeFilter(gradeFilter === 'B' ? 'All' : 'B'); setIsExpanded(true); }}
                className={`text-[9px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded border transition-all cursor-pointer ${
                  gradeFilter === 'B'
                    ? 'text-amber-300 bg-amber-500/20 border-amber-400/40 ring-1 ring-amber-500/30'
                    : 'text-amber-400 bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/20'
                }`}
              >{gradeBCount} Grade B</button>
              {stage2Count > 0 && (
                <button
                  onClick={() => { setHideDecline(true); setIsExpanded(true); }}
                  className={`text-[9px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded border transition-all cursor-pointer ${
                    hideDecline
                      ? 'text-slate-300 bg-white/[0.06] border-white/10 ring-1 ring-white/10'
                      : 'text-slate-400 bg-white/[0.03] border-white/5 hover:bg-white/[0.06]'
                  }`}
                >{stage2Count} Stage 2</button>
              )}
            </span>
          )}
          {!isLoading && candidates.length > 0 && (
            <span className="hidden md:block basis-full text-[10px] font-bold tracking-wider uppercase text-slate-500 mt-1">
              Top {filtered.length} of {candidates.length} · ${MULTIBAGGER.minMarketCap >= 1e6 ? `${MULTIBAGGER.minMarketCap/1e6}M` : ''}–${MULTIBAGGER.maxMarketCap >= 1e9 ? `${MULTIBAGGER.maxMarketCap/1e9}B` : ''} cap · ${MULTIBAGGER.minPrice}+ · 10%+ rev growth · 10%+ ROIC
            </span>
          )}
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-center justify-center border border-white/5 bg-[#161c2a]/40 px-4 py-1.5 rounded-[10px] min-w-[120px]">
            <span className={`text-[10px] font-bold tracking-widest uppercase ${sessionColor}`}>{displaySession}</span>
          </div>
          {lastScanTime && (
            <span className="text-[11px] text-slate-400/80 font-medium px-1 tracking-wide">
              Scanned: {formatTime(lastScanTime)} EST
            </span>
          )}
        </div>
      </div>

      {isLoading && isExpanded && (
        <div className="p-8 text-center text-slate-600 text-sm">
          Loading fundamentals...
        </div>
      )}

      {isExpanded && !isLoading && (
        <div onClick={e => e.stopPropagation()}>

        {/* Filters */}
        {candidates.length > 0 && (
          <div className="px-5 py-2.5 border-b border-white/5 flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-3 px-4 py-1 bg-[#161c2a] border border-white/5 rounded-lg shrink-0">
              <span className="text-[11px] font-bold tracking-widest uppercase text-slate-400">Grade</span>
              {GRADE_BUCKETS.map(b => (
                <Pill
                  key={b}
                  label={b === 'A' ? 'A (70+)' : 'B (50+)'}
                  active={gradeFilter === b}
                  onClick={() => setGradeFilter(gradeFilter === b ? 'All' : b)}
                />
              ))}
            </div>
            <div className="flex items-center gap-3 px-4 py-1 bg-[#161c2a] border border-white/5 rounded-lg shrink-0">
              <span className="text-[11px] font-bold tracking-widest uppercase text-slate-400">Stage</span>
              <Pill
                label="Hide 3/4"
                active={hideDecline}
                onClick={() => setHideDecline(v => !v)}
                title="Hide Stage 3 (topping) and Stage 4 (declining) stocks"
              />
            </div>
            <div className="flex items-center gap-3 px-4 py-1 bg-[#161c2a] border border-white/5 rounded-lg shrink-0">
              <span className="text-[11px] font-bold tracking-widest uppercase text-slate-400">Cap</span>
              {MCAP_BUCKETS.map(b => (
                <Pill
                  key={b}
                  label={b}
                  active={mcapFilter === b}
                  onClick={() => setMcapFilter(mcapFilter === b ? 'All' : b)}
                  title={b === 'Micro' ? '≤$300M' : b === 'Small' ? '$300M–$2B' : '$2B–$10B'}
                />
              ))}
            </div>
            <div className="flex items-center gap-3 px-4 py-1 bg-[#161c2a] border border-white/5 rounded-lg shrink-0">
              <span className="text-[11px] font-bold tracking-widest uppercase text-slate-400">RVol</span>
              {[1.5, 2].map(v => (
                <Pill
                  key={v}
                  label={`≥${v}x`}
                  active={minRvol === v}
                  onClick={() => setMinRvol(minRvol === v ? null : v)}
                  title={`Show only stocks with relative volume ≥ ${v}x`}
                />
              ))}
            </div>
            <div className="flex items-center gap-3 px-4 py-1 bg-[#161c2a] border border-white/5 rounded-lg shrink-0">
              <span className="text-[11px] font-bold tracking-widest uppercase text-slate-400">RS</span>
              {[50, 70, 80].map(v => (
                <Pill
                  key={v}
                  label={`≥${v}`}
                  active={minRs === v}
                  onClick={() => setMinRs(minRs === v ? null : v)}
                  title={`Show only stocks with RS Rating ≥ ${v}`}
                />
              ))}
            </div>
            <div className="flex items-center gap-2.5 text-[9px] font-semibold text-slate-500">
              <span onClick={() => toggleVwap('above')} className={`flex items-center gap-1 cursor-pointer hover:text-slate-300 transition-colors ${vwapFilter === 'above' ? 'text-emerald-400' : ''}`} title={vwapFilter === 'above' ? 'Filtering above VWAP — click to show all' : 'Click to filter above VWAP only'}><span className={`w-1.5 h-1.5 rounded-full bg-emerald-400 ${vwapFilter === 'above' ? 'ring-1 ring-white/40' : ''}`}></span>Above VWAP</span>
              <span onClick={() => toggleVwap('below')} className={`flex items-center gap-1 cursor-pointer hover:text-slate-300 transition-colors ${vwapFilter === 'below' ? 'text-rose-400' : ''}`} title={vwapFilter === 'below' ? 'Filtering below VWAP — click to show all' : 'Click to filter below VWAP only'}><span className={`w-1.5 h-1.5 rounded-full bg-rose-500 ${vwapFilter === 'below' ? 'ring-1 ring-white/40' : ''}`}></span>Below</span>
            </div>
          </div>
        )}

        {/* Table */}
        {candidates.length === 0 ? (
          <div className="p-8 text-center text-slate-600 text-sm">
            No data yet — run the scan at <code className="text-indigo-400">/api/multibagger/run?force=true</code>
          </div>
        ) : (
          <div className="relative z-0 overflow-x-auto custom-scrollbar" style={{ scrollbarWidth: 'thin' }}>
            <table className="w-full min-w-[940px] table-fixed border-collapse">
              <thead>
                <tr className="border-b border-white/5 select-none">
                  <th className={`${thBase} w-[7%] !text-left pl-1`} title={COLUMN_TIPS.TICKER}>TICKER</th>
                  <th className={`${thBase} w-[2%]`} title="News — ★ has an article, ★★ has a causal catalyst">N</th>
                  <th className={`${thBase} w-[4%]`} title={COLUMN_TIPS.SCORE} onClick={() => toggleSort('score')}>
                    CNF<SortArrow col="score" />
                  </th>
                  <th className={`${thBase} w-[4%]`} title={COLUMN_TIPS.RS} onClick={() => toggleSort('rs')}>
                    RS<SortArrow col="rs" />
                  </th>
                  <th className={`${thBase} w-[7%]`} title={COLUMN_TIPS.PRICE}>Price</th>
                  <th className={`${thBase} w-[5%]`} title={COLUMN_TIPS['CHG%']} onClick={() => toggleSort('chg')}>
                    Chg%<SortArrow col="chg" />
                  </th>
                  <th className={`${thBase} w-[5%] hidden md:table-cell`} title={COLUMN_TIPS.VOL} onClick={() => toggleSort('vol')}>
                    Vol<SortArrow col="vol" />
                  </th>
                  <th className={`${thBase} w-[6%] hidden md:table-cell`} title={COLUMN_TIPS.DVOL} onClick={() => toggleSort('dvol')}>
                    DVol<SortArrow col="dvol" />
                  </th>
                  <th className={`${thBase} w-[5%]`} title={COLUMN_TIPS.RVOL} onClick={() => toggleSort('rvol')}>
                    RVol<SortArrow col="rvol" />
                  </th>
                  <th className={`${thBase} w-[6%]`} title={COLUMN_TIPS['REV%']} onClick={() => toggleSort('revGrowth')}>
                    Rev%<SortArrow col="revGrowth" />
                  </th>
                  <th className={`${thBase} w-[5%]`} title={COLUMN_TIPS.ROIC} onClick={() => toggleSort('roic')}>
                    ROIC<SortArrow col="roic" />
                  </th>
                  <th className={`${thBase} w-[5%]`} title={COLUMN_TIPS['D/E']} onClick={() => toggleSort('debt')}>
                    D/E<SortArrow col="debt" />
                  </th>
                  <th className={`${thBase} w-[7%]`} title={COLUMN_TIPS.MCAP} onClick={() => toggleSort('mcap')}>
                    MCap<SortArrow col="mcap" />
                  </th>
                  <th className={`${thBase} w-[5%]`} title={COLUMN_TIPS['P/E']} onClick={() => toggleSort('pe')}>
                    P/E<SortArrow col="pe" />
                  </th>
                  <th className={`${thBase} w-[5%]`} title={COLUMN_TIPS['FCF%']} onClick={() => toggleSort('fcf')}>
                    FCF%<SortArrow col="fcf" />
                  </th>
                  <th className={`${thStage} w-[5%] border-l border-white/5`} title={COLUMN_TIPS.STAGE} onClick={() => toggleSort('stage')}>
                    Stage<SortArrow col="stage" />
                  </th>
                  <th className={`${thSector} w-[7%] hidden md:table-cell`} title={COLUMN_TIPS.SECTOR}>SECTOR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filtered.map((c, idx) => {
                  const isExpanded = expandedRow === c.ticker;
                  return (
                    <React.Fragment key={c.ticker}>
                      <tr
                        className="hover:bg-white/[0.02] transition-colors cursor-pointer group"
                        onClick={() => setExpandedRow(isExpanded ? null : c.ticker)}
                      >
                        {/* Ticker */}
                        <td className={tdBase}>
                          <div className="flex items-center justify-start gap-1.5">
                            <TickerChartHover symbol={c.ticker}><span className={tickerChipCls(c.grade)} title={`${c.name} — Grade ${c.grade} (${c.score})`}>{c.ticker}</span></TickerChartHover>
                          </div>
                        </td>

                        {/* News */}
                        <td className={tdBase}><NewsStars row={c as any} /></td>

                        {/* Score Badge */}
                        <td className={tdBase}>
                          <span
                            className={scoreCellCls(c.score)}
                            title={buildBreakdownTip(c)}
                          >
                            {c.score}
                          </span>
                        </td>

                        {/* RS */}
                        <td className={tdBase}>
                          <span className={`inline-block px-1 py-[1px] rounded border text-[9px] font-bold tabular-nums ${rsBadge(c.rs)}`}>{c.rs != null ? c.rs : '—'}</span>
                        </td>

                        {/* Price + VWAP dot */}
                        <td className={tdBase}>
                          <div className="flex items-center justify-center gap-1">
                            <span className="text-[10px] text-slate-300 font-medium whitespace-nowrap tabular-nums">${c.price.toFixed(2)}</span>
                            {c.vwapStatus && c.vwapStatus !== 'neutral' && (
                              <div
                                onClick={(e) => { e.stopPropagation(); toggleVwap(c.vwapStatus as 'above' | 'below'); }}
                                className={`w-1.5 h-1.5 rounded-full shrink-0 cursor-pointer ${c.vwapStatus === 'above' ? 'bg-emerald-400' : 'bg-rose-500'} ${vwapFilter === c.vwapStatus ? 'ring-1 ring-white/40' : ''}`}
                                title={`VWAP: ${c.vwapStatus} — click to filter`}
                              ></div>
                            )}
                          </div>
                        </td>

                        {/* Change % */}
                        <td className={`${tdBase} text-[10px] font-bold whitespace-nowrap tabular-nums ${chgColor(c.changePct)}`}>
                          {c.changePct >= 0 ? '+' : ''}{c.changePct.toFixed(2)}%
                        </td>

                        {/* Volume */}
                        <td className={`${tdBase} text-[10px] text-slate-400 font-medium whitespace-nowrap tabular-nums hidden md:table-cell`}>
                          {fmtVol(c.vol)}
                        </td>

                        {/* Dollar Volume */}
                        <td className={`${tdBase} text-[10px] text-slate-400 font-medium whitespace-nowrap tabular-nums hidden md:table-cell`}>
                          {fmtDvol(c.dvol)}
                        </td>

                        {/* RVol */}
                        <td className={`${tdBase} text-[10px] font-bold whitespace-nowrap tabular-nums ${rvolColor(c.rvol)}`}>
                          {c.rvol != null ? `${c.rvol < 1 ? c.rvol.toFixed(1) : Math.round(c.rvol)}x` : '—'}
                        </td>

                        {/* Revenue Growth */}
                        <td className={`${tdBase} text-[10px] font-bold whitespace-nowrap tabular-nums ${revColor(c.attrs.revGrowthPct)}`}>
                          {fmtPct(c.attrs.revGrowthPct)}
                          {c.attrs.revGrowthYears > 0 && (
                            <span className="text-[9px] text-slate-600 ml-0.5">{c.attrs.revGrowthYears}y</span>
                          )}
                        </td>

                        {/* ROIC */}
                        <td className={`${tdBase} text-[10px] font-bold whitespace-nowrap tabular-nums ${roicColor(c.attrs.roic)}`}>
                          {c.attrs.roic != null ? `${c.attrs.roic.toFixed(1)}%` : '—'}
                        </td>

                        {/* Debt/Equity */}
                        <td className={`${tdBase} text-[10px] font-bold whitespace-nowrap tabular-nums ${debtColor(c.attrs.debtToEquity)}`}>
                          {fmtRatio(c.attrs.debtToEquity)}
                        </td>

                        {/* Market Cap */}
                        <td className={`${tdBase} text-[10px] text-slate-400 font-medium whitespace-nowrap tabular-nums`}>
                          {c.marketCapFmt}
                        </td>

                        {/* P/E */}
                        <td className={`${tdBase} text-[10px] font-bold whitespace-nowrap tabular-nums ${peColor(c.attrs.pe)}`}>
                          {fmtPe(c.attrs.pe)}
                        </td>

                        {/* FCF Yield */}
                        <td className={`${tdBase} text-[10px] font-bold whitespace-nowrap tabular-nums ${fcfColor(c.attrs.fcfYield)}`}>
                          {c.attrs.fcfYield != null ? `${c.attrs.fcfYield.toFixed(1)}%` : '—'}
                        </td>

                        {/* Stage */}
                        <td className={`${tdStage} whitespace-nowrap border-l border-white/5`}>
                          <span
                            title={stageDescription(c.stage)}
                            className={`inline-block px-1 py-[1px] rounded border text-[9px] font-bold tabular-nums tracking-wide cursor-help ${stageBadge(c.stage)}`}
                          >
                            {stgShort(c.stage) || c.stageShort || '—'}
                          </span>
                        </td>

                        {/* Sector */}
                        <td className={`${tdSector} hidden md:table-cell`}>
                          <span className="block truncate text-left text-[8px] font-semibold tracking-wide uppercase text-slate-400">{displaySector(c.sector, c.ticker)}</span>
                        </td>
                      </tr>

                      {/* Expanded breakdown row */}
                      {isExpanded && (
                        <tr className="border-b border-white/[0.03]">
                          <td colSpan={17} className="px-4 py-3 bg-[#0a0e18]">
                            <div className="flex flex-wrap gap-4">
                              {/* Scorecard bars */}
                              <div className="flex-1 min-w-[280px]">
                                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-2">
                                  Score Breakdown ({c.score}/100)
                                </div>
                                <div className="space-y-1.5">
                                  {Object.entries(c.breakdown).map(([key, val]) => {
                                    const max = ATTR_MAX[key] || 1;
                                    const pct = Math.round((val / max) * 100);
                                    const st = attrStatus(val, max);
                                    return (
                                      <div key={key} className="flex items-center gap-2">
                                        <span className="text-[10px] text-slate-400 w-[110px] shrink-0 truncate">
                                          {ATTR_LABELS[key] || key}
                                        </span>
                                        <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                                          <div
                                            className={`h-full rounded-full transition-all ${
                                              st.passed ? 'bg-indigo-500' : 'bg-slate-600'
                                            }`}
                                            style={{ width: `${pct}%` }}
                                          />
                                        </div>
                                        <span className={`text-[10px] tabular-nums font-semibold w-[36px] text-right ${
                                          st.passed ? 'text-indigo-400' : 'text-slate-500'
                                        }`}>
                                          {val}/{max}
                                        </span>
                                        <span className="text-[10px] w-3 text-center">
                                          {st.passed
                                            ? <span className="text-emerald-400">✓</span>
                                            : <span className="text-slate-600">✕</span>
                                          }
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* Key stats */}
                              <div className="min-w-[180px]">
                                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-2">
                                  Details
                                </div>
                                <div className="space-y-1 text-[11px]">
                                  <div className="flex justify-between gap-4">
                                    <span className="text-slate-500">Price</span>
                                    <span className="text-slate-200 tabular-nums">${c.price.toFixed(2)}</span>
                                  </div>
                                  <div className="flex justify-between gap-4">
                                    <span className="text-slate-500">Market Cap</span>
                                    <span className={`tabular-nums ${mcapColor(c.mcapTier)}`}>{c.marketCapFmt}</span>
                                  </div>
                                  <div className="flex justify-between gap-4">
                                    <span className="text-slate-500">Rev Growth</span>
                                    <span className={`tabular-nums ${revColor(c.attrs.revGrowthPct)}`}>{fmtPct(c.attrs.revGrowthPct)}</span>
                                  </div>
                                  <div className="flex justify-between gap-4">
                                    <span className="text-slate-500">ROIC</span>
                                    <span className={`tabular-nums ${roicColor(c.attrs.roic)}`}>
                                      {c.attrs.roic != null ? `${c.attrs.roic.toFixed(1)}%` : '—'}
                                    </span>
                                  </div>
                                  <div className="flex justify-between gap-4">
                                    <span className="text-slate-500">Debt/Equity</span>
                                    <span className={`tabular-nums ${debtColor(c.attrs.debtToEquity)}`}>{fmtRatio(c.attrs.debtToEquity)}</span>
                                  </div>
                                  <div className="flex justify-between gap-4">
                                    <span className="text-slate-500">P/E</span>
                                    <span className={`tabular-nums ${peColor(c.attrs.pe)}`}>{fmtPe(c.attrs.pe)}</span>
                                  </div>
                                  <div className="flex justify-between gap-4">
                                    <span className="text-slate-500">FCF Yield</span>
                                    <span className={`tabular-nums ${fcfColor(c.attrs.fcfYield)}`}>
                                      {c.attrs.fcfYield != null ? `${c.attrs.fcfYield.toFixed(1)}%` : '—'}
                                    </span>
                                  </div>
                                  {c.employees && (
                                    <div className="flex justify-between gap-4">
                                      <span className="text-slate-500">Employees</span>
                                      <span className="text-slate-300 tabular-nums">{c.employees?.toLocaleString()}</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

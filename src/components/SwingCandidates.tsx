'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useMarketData } from './MarketDataContext';

interface SwingCandidate {
  symbol: string;
  name?: string;
  sector?: string;
  price: number;
  score: number;
  changePct?: number;
  vol?: number;
  dVol?: number;
  rvol?: number | null;
  float?: number | null;
  shortPct?: number | null;
  mktCap?: number | null;
  stage?: string;
  vwapStatus?: 'above' | 'below' | 'neutral';
  atrPct: number;
  pctOffHigh: number;
  distToEma21: number;
  distToEma10?: number;
  aboveEma10?: boolean;
  aboveEma21?: boolean;
  stochK: number;
  rsVsSpy: number;
  avgDollarVolM: number;
  goldenCross: boolean;
  ema21Rising: boolean;
  blueDot?: boolean;
  catalyst?: string | null;
  catalystUrl?: string | null;
  news?: string | null;
  newsUrl?: string | null;
  headline?: string | null;
}

type SortDirection = 'asc' | 'desc';
type CnfFilterType = 'All' | 'A' | 'B' | 'C';
type EmaFilterType = 'All' | '>10' | '>21' | 'Both';
type VwapFilterType = 'All' | 'above' | 'below';

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

const formatStageText = (stage: string | undefined) => {
  if (!stage || stage === '-' || stage === '—') return '—';
  return stage.replace(/Stage\s*/i, '');
};

// Ready = stoch deep and pullback tight — the blue dot could fire imminently.
const isReady = (c: SwingCandidate) => c.stochK <= 25 && Math.abs(c.distToEma21) <= 2.5;

// CNF grade from the score: A >= 70, B >= 50, C below (same lines as all cards).
const cnfGradeOf = (score: number | null | undefined): CnfFilterType | null => {
  if (score == null) return null;
  if (score >= 70) return 'A';
  if (score >= 50) return 'B';
  return 'C';
};

// Blue Dot marker — same treatment as the 10/21 consolidation table.
const BlueDot = ({ className = '' }: { className?: string }) => (
  <span
    title="Blue Dot — oversold stoch reset firing on the daily"
    className={`inline-block w-2 h-2 rounded-full bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.7)] align-middle shrink-0 ${className}`}
  />
);

// Sector strings sometimes arrive ticker-prefixed ("RKLB - AEROSPACE") from the
// scanner payload. Strip the prefix so one bad row can't widen the column.
const cleanSector = (sector: string | null | undefined, ticker?: string): string => {
  if (!sector || sector === '—' || sector === '-') return '—';
  let s = String(sector).trim();
  if (ticker) {
    const rx = new RegExp(`^${ticker}\\s*[-–—:]\\s*`, 'i');
    s = s.replace(rx, '');
  }
  // Generic fallback: any leading 1-5 char all-caps token followed by a dash
  s = s.replace(/^[A-Z]{1,5}\s*[-–—:]\s*/, '');
  return s.trim() || '—';
};

// Fallback labels the backend uses when there's no real headline.
const isGenericCatalyst = (catalyst: string | null | undefined) => {
  if (!catalyst) return true;
  const c = catalyst.toLowerCase().trim();
  return c.startsWith('technical momentum') || c === 'recent news' || c === 'news' || c === 'technical';
};

// Real news headline for the thesis line — tolerant of the field name the
// swing feed uses. Returns null when there's only the generic fallback.
const catalystOf = (c: SwingCandidate): string | null => {
  const raw = c.catalyst ?? c.news ?? c.headline ?? null;
  if (isGenericCatalyst(raw)) return null;
  return String(raw).trim().replace(/\.$/, '');
};

const catalystUrlOf = (c: SwingCandidate): string | null => c.catalystUrl ?? c.newsUrl ?? null;

// Plain-English setup readout for the sub-row, built from the row's own numbers.
const buildReadout = (c: SwingCandidate) => {
  const emaSide = c.distToEma21 >= 0 ? 'above' : 'below';
  const emaState = c.ema21Rising ? 'rising' : 'flat/declining';
  const stochState = c.stochK <= 20 ? 'deeply oversold' : c.stochK <= 30 ? 'oversold' : 'approaching oversold';
  const structure = c.goldenCross ? '50>200 intact' : '50<200 — weaker structure';
  return `${Math.abs(c.distToEma21).toFixed(1)}% ${emaSide} ${emaState} 21 EMA, stoch ${c.stochK.toFixed(0)} (${stochState}), ATR ${c.atrPct.toFixed(1)}%, ${c.pctOffHigh.toFixed(0)}% off highs with RS +${c.rsVsSpy.toFixed(0)} vs SPY, ${structure}. Watching for BD + MACD confirmation.`;
};

// Backward-compatible: derive above-EMA from dist if the payload predates the booleans
const above21 = (c: SwingCandidate) => c.aboveEma21 ?? c.distToEma21 >= 0;
const above10 = (c: SwingCandidate) => c.aboveEma10 ?? (c.distToEma10 != null ? c.distToEma10 >= 0 : null);

export default function SwingCandidates() {
  const { session } = useMarketData();

  const [candidates, setCandidates] = useState<SwingCandidate[]>([]);
  const [status, setStatus] = useState<string>('Syncing...');
  const [generatedAt, setGeneratedAt] = useState<number | null>(null);
  const [spyReturn, setSpyReturn] = useState<number | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: keyof SwingCandidate; direction: SortDirection } | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [showReadyOnly, setShowReadyOnly] = useState<boolean>(false);
  const [showStage2AOnly, setShowStage2AOnly] = useState<boolean>(false);
  const [marketCapFilter, setMarketCapFilter] = useState<string>('All');
  const [cnfFilter, setCnfFilter] = useState<CnfFilterType>('All');
  const [emaFilter, setEmaFilter] = useState<EmaFilterType>('All');
  const [vwapFilter, setVwapFilter] = useState<VwapFilterType>('All');
  const [showFilters, setShowFilters] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    const fetchCandidates = async () => {
      try {
        const res = await fetch(`/api/swing-candidates/latest?t=${Date.now()}`, { cache: 'no-store' });
        const data = await res.json();

        if (isMounted && data && data.success && Array.isArray(data.candidates)) {
          setCandidates(data.candidates);
          setGeneratedAt(data.lastScanTime ? Number(data.lastScanTime) : Date.now());
          setSpyReturn(data.spyReturn3M ?? null);
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

  const handleSort = (key: keyof SwingCandidate) => {
    let direction: SortDirection = 'desc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') direction = 'asc';
    else if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') { setSortConfig(null); return; }
    setSortConfig({ key, direction });
  };

  // Clicking the active option clears back to All (toggle behavior)
  const handleEmaFilter = (val: EmaFilterType) => setEmaFilter(prev => prev === val ? 'All' : val);
  const handleVwapFilter = (val: VwapFilterType) => setVwapFilter(prev => prev === val ? 'All' : val);
  const handleCnfFilter = (val: CnfFilterType) => setCnfFilter(prev => prev === val ? 'All' : val);

  const filteredAndSorted = useMemo(() => {
    let filtered = [...candidates];
    if (showReadyOnly) filtered = filtered.filter(isReady);
    if (showStage2AOnly) filtered = filtered.filter(c => c.stage && c.stage.includes('2A'));
    if (marketCapFilter !== 'All') {
      filtered = filtered.filter(c => {
        const mc = c.mktCap;
        if (!mc) return true;
        if (marketCapFilter === 'Large') return mc >= 2e9;
        if (marketCapFilter === 'Small') return mc < 2e9;
        return true;
      });
    }
    if (cnfFilter !== 'All') {
      filtered = filtered.filter(c => cnfGradeOf(c.score) === cnfFilter);
    }
    if (emaFilter !== 'All') {
      filtered = filtered.filter(c => {
        const a10 = above10(c);
        const a21 = above21(c);
        if (emaFilter === '>10') return a10 === true;
        if (emaFilter === '>21') return a21 === true;
        if (emaFilter === 'Both') return a10 === true && a21 === true;
        return true;
      });
    }
    if (vwapFilter !== 'All') {
      filtered = filtered.filter(c => c.vwapStatus === vwapFilter);
    }
    if (!sortConfig) return filtered;
    return filtered.sort((a, b) => {
      const aVal = a[sortConfig.key] as any;
      const bVal = b[sortConfig.key] as any;
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [candidates, sortConfig, showReadyOnly, showStage2AOnly, marketCapFilter, cnfFilter, emaFilter, vwapFilter]);

  const getSortIcon = (columnKey: keyof SwingCandidate) => sortConfig?.key === columnKey ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓') : '';

  // CNF-graded score badge: green = A (>=70), amber = B (>=50), gray = C
  const getScoreBadge = (score: number) => {
    if (score >= 70) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    if (score >= 50) return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    return 'bg-zinc-800/50 text-zinc-400 border-zinc-700/50';
  };
  const getStageColor = (stage: string | undefined) => {
    if (!stage || stage === '-') return 'text-slate-500';
    if (stage.includes('1')) return 'text-slate-400';
    if (stage.includes('2')) return 'text-emerald-400';
    if (stage.includes('3')) return 'text-amber-400';
    if (stage.includes('4')) return 'text-rose-400';
    return 'text-slate-500';
  };
  const getRvolColor = (rvol: number | null | undefined) => {
    if (!rvol) return 'text-slate-500';
    if (rvol >= 2) return 'text-amber-400';
    if (rvol >= 1.5) return 'text-emerald-400';
    return 'text-slate-500';
  };
  const getFloatColor = (float: number | null | undefined) => {
    if (!float) return 'text-slate-500';
    if (float <= 20000000) return 'text-purple-400';
    if (float <= 50000000) return 'text-emerald-400';
    return 'text-slate-300';
  };
  const getShortColor = (short: number | null | undefined) => {
    if (!short) return 'text-slate-500';
    if (short >= 20) return 'text-purple-400';
    if (short >= 10) return 'text-emerald-400';
    return 'text-slate-300';
  };
  const getStochColor = (k: number) => {
    if (k <= 20) return 'text-purple-400';
    if (k <= 30) return 'text-emerald-400';
    return 'text-slate-400';
  };
  const getRsColor = (rs: number) => {
    if (rs >= 20) return 'text-purple-400';
    if (rs >= 10) return 'text-emerald-400';
    if (rs >= 0) return 'text-slate-300';
    return 'text-rose-400';
  };

  const emaDot = (state: boolean | null | undefined) => {
    if (state === null || state === undefined) return 'bg-slate-600';
    return state ? 'bg-emerald-400' : 'bg-rose-500';
  };

  // STR data color: emerald = true, rose = false
  const structColor = (state: boolean | null | undefined) => {
    if (state === null || state === undefined) return 'text-slate-600';
    return state ? 'text-emerald-400' : 'text-rose-400';
  };

  const displaySession = ['Pre-Market', 'Open', 'Post-Market', 'Closed'].includes(session) ? session : 'Closed';
  const getSessionTextColor = () => {
    if (displaySession === 'Pre-Market') return 'text-amber-500';
    if (displaySession === 'Open') return 'text-[#00e676]';
    if (displaySession === 'Post-Market') return 'text-indigo-400';
    return 'text-slate-500';
  };

  // Shared styles — every column centered, uniform tight padding
  const thBase = "px-1 py-2.5 text-[10px] text-slate-500 font-bold tracking-wide leading-tight cursor-pointer hover:text-slate-300 transition-colors text-center";
  const tdBase = "px-1 pt-2.5 pb-1.5 text-center";
  const filterBtnActive = "bg-[#1e293b] text-indigo-400 border border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.1)]";
  const filterBtnIdle = "text-slate-500 border border-transparent hover:text-slate-300 hover:bg-white/[0.02]";
  // Filter pills — matched to the Filter: 2A button (same height, font, tracking)
  const pillWrap = "flex items-center gap-3 px-4 py-1 bg-[#161c2a] border border-white/5 rounded-lg shrink-0";
  const pillLabel = "text-[11px] font-bold tracking-widest uppercase text-slate-400";
  const pillBtn = "px-3 py-1 rounded-lg text-[11px] font-bold tracking-widest uppercase transition-all duration-300 whitespace-nowrap";

  const activeFilterCount =
    (showStage2AOnly ? 1 : 0) +
    (showReadyOnly ? 1 : 0) +
    (marketCapFilter !== 'All' ? 1 : 0) +
    (cnfFilter !== 'All' ? 1 : 0) +
    (emaFilter !== 'All' ? 1 : 0) +
    (vwapFilter !== 'All' ? 1 : 0);

  return (
    <div className="bg-[#101623] border border-white/5 rounded-2xl p-3 md:p-5 relative overflow-hidden shadow-xl w-full max-w-[1280px] mx-auto">
      <div onClick={() => setIsExpanded(!isExpanded)} className={`flex justify-between items-center relative z-10 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-5 border-b border-white/5 pb-4' : ''}`}>
        <div className="flex items-center gap-3">
          <span className="text-xs md:text-sm font-bold text-[#7c8bfa] bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 group-hover:bg-white/[0.02] transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
            REVERSAL / SWING
          </span>
          {spyReturn !== null && (
            <span className="hidden md:inline text-[10px] text-slate-500 font-medium tracking-wide">SPY 3M: {spyReturn >= 0 ? '+' : ''}{spyReturn.toFixed(1)}%</span>
          )}
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
            {/* Collapsed disclosure — one button, shows active filter count */}
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
            {/* Expanded: one uniform pill strip */}
            {showFilters && (
              <div className="flex flex-wrap justify-center items-center gap-3 w-full">
                <div className={pillWrap}>
                  <span className={pillLabel}>STAGE</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setShowStage2AOnly(!showStage2AOnly)} className={`${pillBtn} ${showStage2AOnly ? filterBtnActive : filterBtnIdle}`}>2A</button>
                  </div>
                </div>
                <div className={pillWrap}>
                  <span className={pillLabel}>STAT</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setShowReadyOnly(!showReadyOnly)} className={`${pillBtn} ${showReadyOnly ? filterBtnActive : filterBtnIdle}`}>Ready</button>
                  </div>
                </div>
                <div className={pillWrap}>
                  <span className={pillLabel}>MKT CAP</span>
                  <div className="flex items-center gap-1">
                    {['All', 'Small', 'Large'].map((cap) => (
                      <button key={cap} onClick={() => setMarketCapFilter(cap)} className={`${pillBtn} ${marketCapFilter === cap ? filterBtnActive : filterBtnIdle}`}>{cap}</button>
                    ))}
                  </div>
                </div>
                <div className={pillWrap}>
                  <span className={pillLabel}>CNF</span>
                  <div className="flex items-center gap-1">
                    {(['A', 'B', 'C'] as CnfFilterType[]).map((g) => (
                      <button key={g} onClick={() => handleCnfFilter(g)} className={`${pillBtn} ${cnfFilter === g ? filterBtnActive : filterBtnIdle}`}>
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={pillWrap}>
                  <span className={pillLabel}>10/21</span>
                  <div className="flex items-center gap-1">
                    {(['>10', '>21', 'Both'] as EmaFilterType[]).map((opt) => (
                      <button key={opt} onClick={() => handleEmaFilter(opt)} className={`${pillBtn} ${emaFilter === opt ? filterBtnActive : filterBtnIdle}`}>
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={pillWrap}>
                  <span className={pillLabel}>VWAP</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => handleVwapFilter('above')} className={`flex items-center gap-1.5 ${pillBtn} ${vwapFilter === 'above' ? filterBtnActive : filterBtnIdle}`}>
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400"></div>Above
                    </button>
                    <button onClick={() => handleVwapFilter('below')} className={`flex items-center gap-1.5 ${pillBtn} ${vwapFilter === 'below' ? filterBtnActive : filterBtnIdle}`}>
                      <div className="w-1.5 h-1.5 rounded-full bg-rose-500"></div>Below
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="relative z-10 overflow-x-auto custom-scrollbar" style={{ scrollbarWidth: 'thin' }}>
            <table className="w-full min-w-[1060px] table-fixed border-collapse">
              <thead>
                <tr className="border-b border-white/5 select-none">
                  <th className={`${thBase} w-[7%]`} onClick={() => handleSort('symbol')}>TICKER{getSortIcon('symbol')}</th>
                  <th className={`${thBase} w-[4%]`} onClick={() => handleSort('score')}>CNF{getSortIcon('score')}</th>
                  <th className={`${thBase} w-[7%]`} onClick={() => handleSort('price')}>PRICE{getSortIcon('price')}</th>
                  <th className={`${thBase} w-[7%]`} onClick={() => handleSort('changePct')}>CHG%{getSortIcon('changePct')}</th>
                  <th className={`${thBase} w-[7%]`}>10/21</th>
                  <th className={`${thBase} w-[6%]`} onClick={() => handleSort('vol')}>VOL{getSortIcon('vol')}</th>
                  <th className={`${thBase} w-[7%]`} onClick={() => handleSort('dVol')}>$VOL{getSortIcon('dVol')}</th>
                  <th className={`${thBase} w-[6%]`} onClick={() => handleSort('rvol')}>RVOL{getSortIcon('rvol')}</th>
                  <th className={`${thBase} w-[6%]`} onClick={() => handleSort('float')}>FLOAT{getSortIcon('float')}</th>
                  <th className={`${thBase} w-[6%]`} onClick={() => handleSort('rsVsSpy')}>RS/SPY{getSortIcon('rsVsSpy')}</th>
                  <th className={`${thBase} w-[6%]`} onClick={() => handleSort('stochK')}>STOCH{getSortIcon('stochK')}</th>
                  <th className={`${thBase} w-[6%]`} onClick={() => handleSort('shortPct')}>SHT%{getSortIcon('shortPct')}</th>
                  <th className={`${thBase} w-[6%]`} onClick={() => handleSort('mktCap')}>MCAP{getSortIcon('mktCap')}</th>
                  <th className={`${thBase} w-[4%] border-l border-white/5`} onClick={() => handleSort('stage')}>STAGE{getSortIcon('stage')}</th>
                  <th className={`${thBase} w-[15%]`} onClick={() => handleSort('sector')}>SECTOR{getSortIcon('sector')}</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-white/5">
                {candidates.length === 0 ? (
                  <tr><td colSpan={15} className="py-12 text-center text-slate-500 text-sm font-medium">{status === 'Live' ? 'No candidates match current filter criteria.' : status === 'Syncing...' ? 'Running scan…' : 'Feed unavailable — awaiting next scheduled scan.'}</td></tr>
                ) : (
                  filteredAndSorted.map((row) => {
                    const isPositive = (row.changePct ?? 0) >= 0;
                    const cat = catalystOf(row);
                    const catUrl = catalystUrlOf(row);
                    const sectorText = cleanSector(row.sector, row.symbol);
                    return (
                      <React.Fragment key={row.symbol}>
                        <tr className="hover:bg-white/[0.02] transition-colors group">
                          <td className={tdBase}>
                            <div className="flex items-center justify-center gap-1.5">
                              <span title={row.name || row.symbol} className="inline-block bg-indigo-500/10 text-[#7c8bfa] text-[11px] font-bold px-1.5 py-0.5 rounded border border-indigo-500/20 cursor-help">{row.symbol}</span>
                              {row.blueDot && <BlueDot />}
                            </div>
                          </td>
                          <td className={tdBase}>
                            <span className={`inline-block whitespace-nowrap px-1.5 py-[2px] rounded text-[9px] font-bold border ${getScoreBadge(row.score)}`}>{row.score}</span>
                          </td>
                          <td className={`${tdBase} text-xs text-slate-300 font-medium whitespace-nowrap tabular-nums`}>
                            <div className="flex items-center justify-center gap-1">${row.price.toFixed(2)}{row.vwapStatus && row.vwapStatus !== 'neutral' && (<div className={`w-1.5 h-1.5 rounded-full shrink-0 ${row.vwapStatus === 'above' ? 'bg-emerald-400' : 'bg-rose-500'}`} title={`VWAP: ${row.vwapStatus}`}></div>)}</div>
                          </td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>{row.changePct != null ? `${isPositive ? '+' : ''}${row.changePct.toFixed(2)}%` : '—'}</td>
                          <td className={`${tdBase} whitespace-nowrap`}>
                            <div className="flex items-center justify-center gap-1.5">
                              <div className="flex items-center gap-0.5">
                                <span className="text-[9px] font-bold text-slate-500">10</span>
                                <div className={`w-1.5 h-1.5 rounded-full ${emaDot(above10(row))}`} title={`10 EMA: ${above10(row) == null ? 'n/a' : above10(row) ? 'above' : 'below'}`}></div>
                              </div>
                              <div className="flex items-center gap-0.5">
                                <span className="text-[9px] font-bold text-slate-500">21</span>
                                <div className={`w-1.5 h-1.5 rounded-full ${emaDot(above21(row))}`} title={`21 EMA: ${above21(row) ? 'above' : 'below'}`}></div>
                              </div>
                            </div>
                          </td>
                          <td className={`${tdBase} text-xs text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{formatNumber(row.vol)}</td>
                          <td className={`${tdBase} text-xs text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{row.dVol ? formatCurrency(row.dVol) : (row.avgDollarVolM ? `$${row.avgDollarVolM}M` : '—')}</td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getRvolColor(row.rvol)}`}>{row.rvol ? `${row.rvol.toFixed(1)}x` : '—'}</td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getFloatColor(row.float)}`}>{formatNumber(row.float)}</td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getRsColor(row.rsVsSpy)}`}>{row.rsVsSpy >= 0 ? '+' : ''}{row.rsVsSpy.toFixed(1)}</td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getStochColor(row.stochK)}`}>{row.stochK.toFixed(1)}</td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getShortColor(row.shortPct)}`}>{row.shortPct ? `${row.shortPct.toFixed(1)}%` : '—'}</td>
                          <td className={`${tdBase} text-xs text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{formatNumber(row.mktCap)}</td>
                          <td className={`${tdBase} whitespace-nowrap border-l border-white/5`}>
                            <span className={`text-[11px] font-bold tracking-wide ${getStageColor(row.stage)}`}>{formatStageText(row.stage)}</span>
                          </td>
                          <td className={tdBase}>
                            <span title={sectorText} className="block truncate text-[10px] font-semibold tracking-wide uppercase text-slate-400">{sectorText}</span>
                          </td>
                        </tr>
                        {/* Sub-row: spacer | EMA PB + readout + catalyst | STR/STAT centered */}
                        <tr className="bg-transparent border-t border-white/5">
                          <td className="w-[7%]"></td>
                          <td colSpan={12} className="pb-2.5 pt-1.5 pr-3">
                            <div className="flex items-center text-left">
                              <span className="shrink-0 w-[104px] pr-2 text-[#7c8bfa] font-bold text-[11px] tracking-[0.08em] uppercase leading-tight">EMA PB</span>
                              <p className="flex-1 text-[11px] leading-relaxed whitespace-normal border-l border-white/10 pl-3">
                                <span className="text-slate-500">{buildReadout(row)}</span>
                                {cat && (
                                  <>
                                    {' '}
                                    <span className="text-[9px] font-bold tracking-widest uppercase text-amber-400/90">News:</span>
                                    {' '}
                                    {catUrl ? (
                                      <a href={catUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-300/90 font-medium hover:text-[#7c8bfa] hover:underline transition-colors">{cat}</a>
                                    ) : (
                                      <span className="text-indigo-300/90 font-medium">{cat}</span>
                                    )}
                                  </>
                                )}
                              </p>
                            </div>
                          </td>
                          <td colSpan={2} className="pb-2.5 pt-1.5 align-middle">
                            <div className="flex items-center justify-center gap-2 border-l border-white/10 px-1 py-1">
                              <span className="flex items-center gap-1">
                                <span className="text-[10px] text-slate-500">STR:</span>
                                <span className={`text-[10px] font-semibold ${structColor(row.goldenCross)}`} title="50 SMA > 200 SMA">GC</span>
                                <span className={`text-[10px] font-semibold ${structColor(row.ema21Rising)}`} title="21 EMA rising">21↑</span>
                              </span>
                              <span className="flex items-center gap-1">
                                <span className="text-[10px] text-slate-500">STAT:</span>
                                {isReady(row) ? (
                                  <span className="text-[10px] font-semibold text-emerald-400">Ready</span>
                                ) : (
                                  <span className="text-[10px] font-semibold text-amber-400">Forming</span>
                                )}
                              </span>
                            </div>
                          </td>
                        </tr>
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
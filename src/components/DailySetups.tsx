'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useMarketData } from './MarketDataContext';

interface SetupData {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  vwapStatus: 'above' | 'below' | 'neutral';
  changePct: number;
  vol: number;
  dVol: number;
  rvol: number | null;
  float: number | null;
  shortPct: number | null;
  mktCap: number | null;
  stage: string;
  setupName: string | null;
  catalyst?: string | null;
  catalystUrl?: string | null;
  conviction?: number | null; 
  thesis?: string | null;     
  tradeType?: string | null;  
  aboveEma10?: boolean | null;
  aboveEma21?: boolean | null;
  stochK?: number | null;
  rsVsSpy?: number | null;
  distToEma21?: number | null;
  goldenCross?: boolean | null;
  ema21Rising?: boolean | null;
  status?: string | null;
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

const formatNumber = (num: number | null) => {
  if (num === null || num === 0 || isNaN(num)) return '—';
  if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return num.toLocaleString();
};

const formatCurrency = (num: number | null) => {
  if (num === null || num === 0 || isNaN(num)) return '—';
  if (num >= 1e9) return '$' + (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return '$' + (num / 1e6).toFixed(1) + 'M';
  return '$' + num.toLocaleString();
};

const formatStageText = (stage: string | undefined) => {
  if (!stage || stage === '-' || stage === '—') return '—';
  return stage.replace(/Stage\s*/i, ''); 
};

const formatSetupName = (name: string | null) => {
  if (!name || name === '-' || name === '—') return '—';
  if (name.includes('BB SQZ')) return 'BB SQZ';
  if (name === 'Blue Dot Rev') return 'BD Rev';
  if (name === 'Episodic Pivot') return 'EP';
  return name;
};

// True only for the backend's generic no-news fallback labels.
const isGenericCatalyst = (catalyst: string | null | undefined) =>
  !catalyst || catalyst.toLowerCase().startsWith('technical momentum');

// Day Trade vs Swing label — rendered as a chip identical to the CNF score chip.
const tradeTypeLabel = (tradeType: string | null | undefined): string | null => {
  if (!tradeType) return null;
  const t = tradeType.toLowerCase();
  if (t.startsWith('day')) return 'DAY';
  if (t.startsWith('swing')) return 'SWING';
  return tradeType.toUpperCase();
};

// CNF grade from the unified score: A >= 70, B >= 50, C below.
const cnfGradeOf = (score: number | null | undefined): CnfFilterType | null => {
  if (score == null) return null;
  if (score >= 70) return 'A';
  if (score >= 50) return 'B';
  return 'C';
};

// Status: prefer the backend field; derive from the raw metrics when the KV
// payload predates it (Ready = stoch <= 25 and within 2.5% of the 21 EMA).
const rowStatus = (row: SetupData): 'Ready' | 'Forming' | null => {
  if (row.status === 'Ready' || row.status === 'Forming') return row.status;
  if (row.stochK != null && row.distToEma21 != null) {
    return (row.stochK <= 25 && Math.abs(row.distToEma21) <= 2.5) ? 'Ready' : 'Forming';
  }
  return null;
};

export default function DailySetups() {
  const { session } = useMarketData(); 

  const [setups, setSetups] = useState<SetupData[]>([]);
  const [status, setStatus] = useState<string>('Syncing DB...');
  const [lastScanTime, setLastScanTime] = useState<number | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: keyof SetupData; direction: SortDirection } | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [showStage2AOnly, setShowStage2AOnly] = useState<boolean>(false); 
  const [marketCapFilter, setMarketCapFilter] = useState<string>('All'); 
  const [cnfFilter, setCnfFilter] = useState<CnfFilterType>('All');
  const [emaFilter, setEmaFilter] = useState<EmaFilterType>('All');
  const [vwapFilter, setVwapFilter] = useState<VwapFilterType>('All');

  useEffect(() => {
    let isMounted = true;
    const fetchDatabaseSnapshot = async () => {
      try {
        const res = await fetch(`/api/scanner/latest?t=${Date.now()}`, { cache: 'no-store' });
        const data = await res.json();
        
        if (isMounted && data.success) {
          const rawList = data.dailySetups || [];
          const safeData = rawList.map((item: any) => {
            const rawCatalyst = item.catalyst || null;
            let finalThesis = item.thesis || item.aiThesis || item.analysis || item.reasoning || null;

            if (!finalThesis && rawCatalyst) {
              const cleanedCat = rawCatalyst.trim().replace(/\.$/, '');
              finalThesis = `Institutional buying triggered by ${cleanedCat.toLowerCase()}.`;
            }

            return {
              ticker: item.ticker || '—',
              name: item.name || '',
              sector: item.sector && item.sector !== '—' ? item.sector : '—',
              price: Number(item.price) || 0,
              vwapStatus: item.vwapStatus || 'neutral',
              changePct: Number((item.change ?? item.changePct) || 0),
              vol: Number((item.volume ?? item.vol) || 0),
              dVol: Number(item.dVol) || (Number(item.price || 0) * Number((item.volume ?? item.vol) || 0)),
              rvol: item.rvol || null,
              float: item.float || null,
              shortPct: item.shortPct || null,
              mktCap: item.mktCap || null,
              stage: item.stage || '2A',
              setupName: item.setupName || null,
              catalyst: rawCatalyst,
              catalystUrl: item.catalystUrl || null,
              conviction: item.conviction != null ? Number(item.conviction) : ((item.cnfScore ?? item.smbScore ?? item.aiScore ?? item.score) ?? null), 
              thesis: finalThesis,         
              tradeType: item.tradeType || null,
              aboveEma10: item.aboveEma10 ?? null,
              aboveEma21: item.aboveEma21 ?? null,
              stochK: item.stochK ?? null,
              rsVsSpy: item.rsVsSpy ?? null,
              distToEma21: item.distToEma21 ?? null,
              goldenCross: item.goldenCross ?? null,
              ema21Rising: item.ema21Rising ?? null,
              status: item.status ?? null,
            };
          });

          setSetups(safeData);
          setLastScanTime(data.lastScanTime || Date.now());
          setStatus('Live');
        }
      } catch (error) {
        if (isMounted) setStatus('DB Offline');
      }
    };

    fetchDatabaseSnapshot();
    const interval = setInterval(fetchDatabaseSnapshot, 60000);

    return () => { 
      isMounted = false; 
      clearInterval(interval); 
    };
  }, []);

  const handleSort = (key: keyof SetupData) => {
    let direction: SortDirection = 'desc'; 
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') direction = 'asc';
    else if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') { setSortConfig(null); return; }
    setSortConfig({ key, direction });
  };

  // Clicking the active option clears back to All (toggle behavior)
  const handleCnfFilter = (val: CnfFilterType) => setCnfFilter(prev => prev === val ? 'All' : val);
  const handleEmaFilter = (val: EmaFilterType) => setEmaFilter(prev => prev === val ? 'All' : val);
  const handleVwapFilter = (val: VwapFilterType) => setVwapFilter(prev => prev === val ? 'All' : val);

  const filteredAndSortedSetups = useMemo(() => {
    let filtered = setups.filter(s => 
      s.changePct >= 4.0 && 
      s.vol >= 500000 && 
      s.mktCap !== null && s.mktCap >= 20000000
    );
    
    if (showStage2AOnly) {
      filtered = filtered.filter(s => s.stage && s.stage.includes('2A'));
    }
    
    if (marketCapFilter !== 'All') {
      filtered = filtered.filter(s => {
        const mc = s.mktCap;
        if (!mc) return true; 
        if (marketCapFilter === 'Mega') return mc >= 200e9;
        if (marketCapFilter === 'Large') return mc >= 10e9 && mc < 200e9;
        if (marketCapFilter === 'Mid') return mc >= 2e9 && mc < 10e9;
        if (marketCapFilter === 'Small') return mc >= 300e6 && mc < 2e9;
        if (marketCapFilter === 'Micro') return mc < 300e6;
        return true;
      });
    }

    if (cnfFilter !== 'All') {
      filtered = filtered.filter(s => cnfGradeOf(s.conviction) === cnfFilter);
    }

    if (emaFilter !== 'All') {
      filtered = filtered.filter(s => {
        if (emaFilter === '>10') return s.aboveEma10 === true;
        if (emaFilter === '>21') return s.aboveEma21 === true;
        if (emaFilter === 'Both') return s.aboveEma10 === true && s.aboveEma21 === true;
        return true;
      });
    }

    if (vwapFilter !== 'All') {
      filtered = filtered.filter(s => s.vwapStatus === vwapFilter);
    }

    if (!sortConfig) return filtered;
    
    return [...filtered].sort((a, b) => {
      const aVal = a[sortConfig.key] as any;
      const bVal = b[sortConfig.key] as any;
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [setups, sortConfig, showStage2AOnly, marketCapFilter, cnfFilter, emaFilter, vwapFilter]);

  const getSortIcon = (columnKey: keyof SetupData) => sortConfig?.key === columnKey ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓') : '';
  const getStageColor = (stage: string | undefined) => {
    if (!stage || stage === '-') return 'text-slate-500';
    if (stage.includes('1')) return 'text-slate-400';
    if (stage.includes('2')) return 'text-emerald-400';
    if (stage.includes('3')) return 'text-amber-400';
    if (stage.includes('4')) return 'text-rose-400';
    return 'text-slate-500'; 
  };
  const getRvolColor = (rvol: number | null) => {
    if (!rvol) return 'text-slate-500';
    if (rvol >= 2) return 'text-amber-400';
    if (rvol >= 1.5) return 'text-emerald-400';
    return 'text-slate-500';
  };
  const getFloatColor = (float: number | null) => {
    if (!float) return 'text-slate-500';
    if (float <= 20000000) return 'text-purple-400'; 
    if (float <= 50000000) return 'text-emerald-400';
    return 'text-slate-300';
  };
  const getShortColor = (short: number | null) => {
    if (!short) return 'text-slate-500';
    if (short >= 20) return 'text-purple-400'; 
    if (short >= 10) return 'text-emerald-400';
    return 'text-slate-300';
  };

  const getStochColor = (k: number | null | undefined) => {
    if (k == null) return 'text-slate-500';
    if (k <= 20) return 'text-purple-400';
    if (k <= 30) return 'text-emerald-400';
    return 'text-slate-400';
  };

  const getRsColor = (rs: number | null | undefined) => {
    if (rs == null) return 'text-slate-500';
    if (rs >= 20) return 'text-purple-400';
    if (rs >= 10) return 'text-emerald-400';
    if (rs >= 0) return 'text-slate-300';
    return 'text-rose-400';
  };

  // CNF-graded score badge: green = A (>=70), amber = B (>=50), gray = C
  const getScoreBadge = (score: number | null | undefined) => {
    if (score == null) return 'bg-white/[0.02] text-slate-600 border-white/5';
    if (score >= 70) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    if (score >= 50) return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    return 'bg-zinc-800/50 text-zinc-400 border-zinc-700/50';
  };

  const emaDot = (state: boolean | null | undefined) => {
    if (state === null || state === undefined) return 'bg-slate-600';
    return state ? 'bg-emerald-400' : 'bg-rose-500';
  };

  // STR data color: emerald = true, rose = false, dim gray = unknown
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

  // Shared styles — every column centered, uniform tight padding, no h-scroll
  const thBase = "px-1 py-3 text-[10px] text-slate-500 font-bold tracking-wider cursor-pointer hover:text-slate-300 transition-colors text-center";
  const tdBase = "px-1 pt-3 pb-2 text-center";
  const filterBtnActive = "bg-[#1e293b] text-indigo-400 border border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.1)]";
  const filterBtnIdle = "text-slate-500 border border-transparent hover:text-slate-300 hover:bg-white/[0.02]";
  // Filter pills — matched to the Filter: 2A button (same height, font, tracking)
  const pillWrap = "flex items-center gap-3 px-4 py-1 bg-[#161c2a] border border-white/5 rounded-lg shrink-0";
  const pillLabel = "text-[11px] font-bold tracking-widest uppercase text-slate-400";
  const pillBtn = "px-3 py-1 rounded-lg text-[11px] font-bold tracking-widest uppercase transition-all duration-300 whitespace-nowrap";
  // DAY/SWING chip — identical to the CNF score chip, off-white text
  const typeChip = "inline-block whitespace-nowrap px-1.5 py-[2px] rounded text-[9px] font-bold border bg-zinc-800/50 text-slate-300 border-zinc-700/50";

  return (
    <div className="bg-[#101623] border border-white/5 rounded-2xl p-4 md:p-8 relative overflow-hidden shadow-xl w-full max-w-[1280px] mx-auto">
      <div onClick={() => setIsExpanded(!isExpanded)} className={`flex justify-between items-center relative z-10 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-6 border-b border-white/5 pb-4' : ''}`}>
        <div className="flex items-center gap-3">
          <span className="text-xs md:text-sm font-bold text-[#7c8bfa] bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 group-hover:bg-white/[0.02] transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
            DAILY SETUPS
          </span>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-center justify-center border border-white/5 bg-[#161c2a]/40 px-4 py-1.5 rounded-[10px] min-w-[120px]">
            <span className={`text-[10px] font-bold tracking-widest uppercase ${getSessionTextColor()}`}>{displaySession}</span>
          </div>
          {lastScanTime && (<span className="text-[11px] text-slate-400/80 font-medium px-1 tracking-wide">Updated: {formatTime(lastScanTime)} EST</span>)}
        </div>
      </div>
      
      {isExpanded && (
        <>
          <div className="flex flex-col gap-3 mb-4 relative z-10">
            {/* Row 1, centered: 2A → MKT CAP → CNF (A/B/C) */}
            <div className="flex flex-wrap justify-center items-center gap-4 w-full" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => setShowStage2AOnly(!showStage2AOnly)} className={`px-4 py-2 rounded-lg text-[11px] font-bold tracking-widest uppercase transition-all duration-300 ${showStage2AOnly ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-[0_0_10px_rgba(52,211,153,0.1)]' : 'bg-[#161c2a] text-slate-400 border border-white/5 hover:bg-white/[0.04]'}`}>Filter: 2A</button>
              <div className={pillWrap}>
                <span className={pillLabel}>MKT CAP</span>
                <div className="flex items-center gap-1">
                  {['All', 'Micro', 'Small', 'Mid', 'Large', 'Mega'].map((cap) => (
                    <button key={cap} onClick={() => setMarketCapFilter(cap)} className={`${pillBtn} ${marketCapFilter === cap ? filterBtnActive : filterBtnIdle}`}>{cap}</button>
                  ))}
                </div>
              </div>
              {/* CNF grade — clickable filter pill */}
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
            </div>
            {/* Row 2, centered: 10/21 → VWAP */}
            <div className="flex flex-wrap justify-center items-center gap-4 w-full" onClick={(e) => e.stopPropagation()}>
              {/* 10/21 — clickable filter pill */}
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
              {/* VWAP — clickable filter pill */}
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
          </div>

          <div className="relative z-10">
            <table className="w-full table-fixed border-collapse">
              <thead>
                <tr className="border-b border-white/5 select-none">
                  <th className={`${thBase} w-[6%]`} onClick={() => handleSort('ticker')}>TICKER{getSortIcon('ticker')}</th>
                  <th className={`${thBase} w-[4%]`} onClick={() => handleSort('conviction')}>CNF{getSortIcon('conviction')}</th>
                  <th className={`${thBase} w-[7%]`} onClick={() => handleSort('price')}>PRICE{getSortIcon('price')}</th>
                  <th className={`${thBase} w-[6%]`} onClick={() => handleSort('changePct')}>CHG%{getSortIcon('changePct')}</th>
                  <th className={`${thBase} w-[7%]`}>10/21</th>
                  <th className={`${thBase} w-[6%]`} onClick={() => handleSort('vol')}>VOL{getSortIcon('vol')}</th>
                  <th className={`${thBase} w-[6%]`} onClick={() => handleSort('dVol')}>$VOL{getSortIcon('dVol')}</th>
                  <th className={`${thBase} w-[5%]`} onClick={() => handleSort('rvol')}>RVOL{getSortIcon('rvol')}</th>
                  <th className={`${thBase} w-[6%]`} onClick={() => handleSort('float')}>FLOAT{getSortIcon('float')}</th>
                  <th className={`${thBase} w-[6%]`} onClick={() => handleSort('rsVsSpy')}>RS/SPY{getSortIcon('rsVsSpy')}</th>
                  <th className={`${thBase} w-[6%]`} onClick={() => handleSort('stochK')}>STOCH{getSortIcon('stochK')}</th>
                  <th className={`${thBase} w-[5%]`} onClick={() => handleSort('shortPct')}>SHT%{getSortIcon('shortPct')}</th>
                  <th className={`${thBase} w-[6%]`} onClick={() => handleSort('mktCap')}>MCAP{getSortIcon('mktCap')}</th>
                  <th className={`${thBase} w-[5%] border-l border-white/5`} onClick={() => handleSort('stage')}>STAGE{getSortIcon('stage')}</th>
                  <th className={`${thBase} w-[9%]`} onClick={() => handleSort('sector')}>SECTOR{getSortIcon('sector')}</th>
                  <th className={`${thBase} w-[10%]`} onClick={() => handleSort('catalyst')}>CATALYST{getSortIcon('catalyst')}</th>
                </tr>
              </thead>
              
              <tbody className="divide-y divide-white/5">
                {status.includes('Syncing') && setups.length === 0 ? (
                  <tr><td colSpan={16} className="py-12 text-center border-b border-white/5"><div className="w-5 h-5 border-2 border-indigo-500/20 border-t-indigo-400 rounded-full animate-spin mx-auto mb-3"></div><span className="text-xs text-slate-500 font-medium">Fetching DB Snapshot...</span></td></tr>
                ) : filteredAndSortedSetups.length === 0 ? (
                  <tr><td colSpan={16} className="py-12 text-center text-slate-500 text-sm font-medium border-b border-white/5">No active tracking items currently matching momentum criteria.</td></tr>
                ) : (
                  filteredAndSortedSetups.map((row, i) => {
                    const isPositive = row.changePct >= 0;
                    const tt = tradeTypeLabel(row.tradeType);
                    const st = rowStatus(row);
                    return (
                      <React.Fragment key={i}>
                        <tr className="hover:bg-white/[0.02] transition-colors group">
                          <td className={tdBase}>
                            <span title={row.name || row.ticker} className="inline-block bg-indigo-500/10 text-[#7c8bfa] text-[11px] font-bold px-1.5 py-0.5 rounded border border-indigo-500/20 cursor-help">{row.ticker}</span>
                          </td>
                          <td className={tdBase}>
                            <span className={`inline-block whitespace-nowrap px-1.5 py-[2px] rounded text-[9px] font-bold border ${getScoreBadge(row.conviction)}`}>{row.conviction != null ? row.conviction : '--'}</span>
                          </td>
                          <td className={`${tdBase} text-xs text-slate-300 font-medium whitespace-nowrap tabular-nums`}>
                            <div className="flex items-center justify-center gap-1">${row.price.toFixed(2)}{row.vwapStatus !== 'neutral' && (<div className={`w-1.5 h-1.5 rounded-full shrink-0 ${row.vwapStatus === 'above' ? 'bg-emerald-400' : 'bg-rose-500'}`} title={`VWAP: ${row.vwapStatus}`}></div>)}</div>
                          </td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>{isPositive ? '+' : ''}{row.changePct.toFixed(2)}%</td>
                          <td className={`${tdBase} whitespace-nowrap`}>
                            <div className="flex items-center justify-center gap-1.5">
                              <div className="flex items-center gap-0.5">
                                <span className="text-[9px] font-bold text-slate-500">10</span>
                                <div className={`w-1.5 h-1.5 rounded-full ${emaDot(row.aboveEma10)}`} title={`10 EMA: ${row.aboveEma10 == null ? 'n/a' : row.aboveEma10 ? 'above' : 'below'}`}></div>
                              </div>
                              <div className="flex items-center gap-0.5">
                                <span className="text-[9px] font-bold text-slate-500">21</span>
                                <div className={`w-1.5 h-1.5 rounded-full ${emaDot(row.aboveEma21)}`} title={`21 EMA: ${row.aboveEma21 == null ? 'n/a' : row.aboveEma21 ? 'above' : 'below'}`}></div>
                              </div>
                            </div>
                          </td>
                          <td className={`${tdBase} text-xs text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{formatNumber(row.vol)}</td>
                          <td className={`${tdBase} text-xs text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{formatCurrency(row.dVol)}</td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getRvolColor(row.rvol)}`}>{row.rvol ? `${row.rvol.toFixed(1)}x` : '—'}</td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getFloatColor(row.float)}`}>{formatNumber(row.float)}</td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getRsColor(row.rsVsSpy)}`}>{row.rsVsSpy != null ? `${row.rsVsSpy >= 0 ? '+' : ''}${row.rsVsSpy.toFixed(1)}` : '—'}</td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getStochColor(row.stochK)}`}>{row.stochK != null ? row.stochK.toFixed(1) : '—'}</td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getShortColor(row.shortPct)}`}>{row.shortPct ? `${row.shortPct.toFixed(1)}%` : '—'}</td>
                          <td className={`${tdBase} text-xs text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{formatNumber(row.mktCap)}</td>
                          <td className={`${tdBase} whitespace-nowrap border-l border-white/5`}>
                            <span className={`text-[11px] font-bold tracking-wide ${getStageColor(row.stage)}`}>{formatStageText(row.stage)}</span>
                          </td>
                          <td className={tdBase}>
                            <span className="block truncate text-[10px] font-semibold tracking-wide uppercase text-slate-400">{row.sector || '—'}</span>
                          </td>
                          <td className={`${tdBase} text-[10px] whitespace-normal break-words`}>
                            {!isGenericCatalyst(row.catalyst) ? (
                              row.catalystUrl ? (
                                <a href={row.catalystUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-300/90 font-medium hover:text-[#7c8bfa] transition-colors hover:underline">{row.catalyst}</a>
                              ) : (
                                <span className="text-indigo-300/90 font-medium">{row.catalyst}</span>
                              )
                            ) : formatSetupName(row.setupName) !== '—' ? (
                              <span className="text-slate-400 font-medium whitespace-nowrap">{formatSetupName(row.setupName)}</span>
                            ) : (
                              <span className="text-slate-500 font-medium">Technical</span>
                            )}
                          </td>
                        </tr>
                        {/* Sub-row: DAY/SWING chip under TICKER | name + thesis | STR/STAT centered */}
                        <tr className="bg-transparent border-t border-white/5">
                          <td className="w-[6%] text-center align-middle">
                            {tt && (<span className={typeChip}>{tt}</span>)}
                          </td>
                          <td colSpan={12} className="pb-3.5 pt-2.5 pr-4">
                            <div className="flex items-center text-left">
                              <span className="shrink-0 w-[92px] text-[#7c8bfa] font-bold text-[11px] tracking-[0.1em] uppercase">{formatSetupName(row.setupName) !== '—' ? formatSetupName(row.setupName) : '—'}</span>
                              <p className="flex-1 text-[11px] leading-relaxed whitespace-normal border-l border-white/10 pl-4">
                                {row.thesis ? (<span className="text-slate-500">{row.thesis}</span>) : (<span className="text-slate-600 italic">Awaiting quantitative confluence analysis…</span>)}
                              </p>
                            </div>
                          </td>
                          <td colSpan={3} className="pb-3.5 pt-2.5 align-middle">
                            <div className="flex items-center justify-center gap-4 border-l border-white/10 px-2 py-1">
                              <span className="flex items-center gap-1.5">
                                <span className="text-[11px] text-slate-500">STR:</span>
                                <span className={`text-[11px] font-semibold ${structColor(row.goldenCross)}`} title="50 SMA > 200 SMA">GC</span>
                                <span className={`text-[11px] font-semibold ${structColor(row.ema21Rising)}`} title="21 EMA rising">21↑</span>
                              </span>
                              <span className="flex items-center gap-1.5">
                                <span className="text-[11px] text-slate-500">STAT:</span>
                                {st === 'Ready' ? (
                                  <span className="text-[11px] font-semibold text-emerald-400">Ready</span>
                                ) : st === 'Forming' ? (
                                  <span className="text-[11px] font-semibold text-amber-400">Forming</span>
                                ) : (
                                  <span className="text-[11px] font-semibold text-slate-600">—</span>
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
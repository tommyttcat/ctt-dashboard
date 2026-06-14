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
  conviction?: number | null; 
  thesis?: string | null;     
}

type SortDirection = 'asc' | 'desc';
type ConvictionFilterType = 'All' | 'High' | 'Med' | 'Low';

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
  return name;
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
  const [convictionFilter, setConvictionFilter] = useState<ConvictionFilterType>('All');

  useEffect(() => {
    let isMounted = true;

    const fetchDatabaseSnapshot = async () => {
      try {
        const res = await fetch(`/api/scanner/latest?t=${Date.now()}`, { cache: 'no-store' });
        const data = await res.json();
        
        if (isMounted && data.success) {
          const rawList = data.dailySetups || [];
          const safeData = rawList.map((item: any) => ({
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
            catalyst: item.catalyst || null,
            conviction: item.conviction != null ? Number(item.conviction) : ((item.aiScore ?? item.score) ?? null), 
            thesis: item.thesis || item.aiThesis || item.analysis || item.reasoning || null,         
          }));

          setSetups(safeData);
          setLastScanTime(data.lastScanTime);
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

    if (convictionFilter !== 'All') {
      filtered = filtered.filter(s => {
        if (s.conviction == null) return false;
        if (convictionFilter === 'High') return s.conviction >= 85;
        if (convictionFilter === 'Med') return s.conviction >= 70 && s.conviction < 85;
        if (convictionFilter === 'Low') return s.conviction < 70;
        return true;
      });
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
  }, [setups, sortConfig, showStage2AOnly, marketCapFilter, convictionFilter]);

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

  const getSessionTextColor = () => {
    if (status.includes('Err') || status.includes('Offline')) return 'text-rose-500';
    if (status.includes('Syncing')) return 'text-amber-500';
    if (session === 'Pre-Market') return 'text-amber-500';
    if (session === 'Open') return 'text-[#00e676]';
    if (session === 'Post-Market') return 'text-indigo-400';
    return 'text-slate-500';
  };

  return (
    <div className="bg-[#101623] border border-white/5 rounded-2xl p-5 md:p-8 relative overflow-hidden shadow-xl w-full">
      
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex justify-between items-center relative z-10 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-6 border-b border-white/5 pb-4' : ''}`}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs md:text-sm font-bold text-[#7c8bfa] bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 group-hover:bg-white/[0.02] transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
            DAILY SETUPS
          </span>
        </div>

        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-center justify-center border border-white/5 bg-[#161c2a]/40 px-4 py-1.5 rounded-[10px] min-w-[120px]">
            <span className={`text-[10px] font-bold tracking-widest uppercase ${getSessionTextColor()}`}>
              {status === 'Live' ? session : status}
            </span>
          </div>
          {lastScanTime && (
             <span className="text-[11px] text-slate-400/80 font-medium px-1 tracking-wide">
               Updated: {formatTime(lastScanTime)} EST
             </span>
          )}
        </div>
      </div>
      
      {isExpanded && (
        <>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4 relative z-10">
            <div className="flex flex-wrap items-center gap-4">
              <button
                onClick={(e) => { e.stopPropagation(); setShowStage2AOnly(!showStage2AOnly); }}
                className={`px-4 py-1.5 rounded-lg text-[10px] font-bold tracking-widest uppercase transition-all duration-300 ${
                  showStage2AOnly 
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-[0_0_10px_rgba(52,211,153,0.1)]' 
                    : 'bg-[#161c2a] text-slate-400 border border-white/5 hover:bg-white/[0.04]'
                }`}
              >
                {showStage2AOnly ? '2A' : 'Filter: 2A'}
              </button>

              <div className="flex items-center bg-[#161c2a] border border-white/5 rounded-xl p-1" onClick={(e) => e.stopPropagation()}>
                {['All', 'Small', 'Mid', 'Large', 'Mega'].map((cap) => (
                  <button
                    key={cap}
                    onClick={() => setMarketCapFilter(cap)}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-widest uppercase transition-all duration-300 ${
                      marketCapFilter === cap
                        ? 'bg-[#1e293b] text-indigo-400 border border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.1)]'
                        : 'text-slate-500 border border-transparent hover:text-slate-300 hover:bg-white/[0.02]'
                    }`}
                  >
                    {cap}
                  </button>
                ))}
              </div>

              <div className="flex items-center bg-[#161c2a] border border-white/5 rounded-xl p-1" onClick={(e) => e.stopPropagation()}>
                <div className="px-2 border-r border-white/10 mr-1">
                  <span className="text-[9px] font-bold tracking-widest uppercase text-slate-500">CONF</span>
                </div>
                {['All', 'High', 'Med', 'Low'].map((level) => (
                  <button
                    key={level}
                    onClick={() => setConvictionFilter(level as ConvictionFilterType)}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-widest uppercase transition-all duration-300 ${
                      convictionFilter === level
                        ? 'bg-[#1e293b] text-indigo-400 border border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.1)]'
                        : 'text-slate-500 border border-transparent hover:text-slate-300 hover:bg-white/[0.02]'
                    }`}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-4 px-3 py-1.5 bg-[#161c2a] border border-white/5 rounded-lg shrink-0">
                <span className="text-[9px] font-bold tracking-widest uppercase text-slate-500">STAGE</span>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5"><span className="text-[10px] font-bold text-slate-400">1</span></div>
                  <div className="flex items-center gap-1.5"><span className="text-[10px] font-bold text-emerald-400">2</span></div>
                  <div className="flex items-center gap-1.5"><span className="text-[10px] font-bold text-amber-400">3</span></div>
                  <div className="flex items-center gap-1.5"><span className="text-[10px] font-bold text-rose-400">4</span></div>
                </div>
              </div>

              <div className="flex items-center gap-4 px-3 py-1.5 bg-[#161c2a] border border-white/5 rounded-lg shrink-0">
                <span className="text-[9px] font-bold tracking-widest uppercase text-slate-500">VWAP</span>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400"></div>
                    <span className="text-[10px] font-medium text-slate-400">Above</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-rose-500"></div>
                    <span className="text-[10px] font-medium text-slate-400">Below</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto custom-scrollbar relative z-10" style={{ scrollbarWidth: 'none' }}>
            <table className="w-full min-w-[1200px] border-collapse">
              <thead>
                <tr className="border-b border-white/5 select-none">
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[14%]" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                    <div className="flex items-center gap-3">
                      <span className="cursor-pointer hover:text-slate-300" onClick={() => handleSort('ticker')}>TICKER{getSortIcon('ticker')}</span>
                      <span className="cursor-pointer text-indigo-400/60 hover:text-indigo-400" onClick={() => handleSort('conviction')}>CONFLUENCE{getSortIcon('conviction')}</span>
                    </div>
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[6%] cursor-pointer hover:text-slate-300" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('price')}>PRICE{getSortIcon('price')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[6%] cursor-pointer hover:text-slate-300" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('changePct')}>CHG%{getSortIcon('changePct')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[6%] cursor-pointer hover:text-slate-300" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('vol')}>VOL{getSortIcon('vol')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[6%] cursor-pointer hover:text-slate-300" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('dVol')}>$VOL{getSortIcon('dVol')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[5%] cursor-pointer hover:text-slate-300" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('rvol')}>RVOL{getSortIcon('rvol')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[6%] cursor-pointer hover:text-slate-300" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('float')}>FLOAT{getSortIcon('float')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[5%] cursor-pointer hover:text-slate-300" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('shortPct')}>SHT%{getSortIcon('shortPct')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[6%] cursor-pointer hover:text-slate-300" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('mktCap')}>MCAP{getSortIcon('mktCap')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[8%] cursor-pointer hover:text-slate-300" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('sector')}>SECTOR{getSortIcon('sector')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[12%] cursor-pointer hover:text-slate-300" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('catalyst')}>CATALYST{getSortIcon('catalyst')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[6%] cursor-pointer hover:text-slate-300" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('stage')}>STAGE{getSortIcon('stage')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[14%] cursor-pointer hover:text-slate-300" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('setupName')}>STRATEGY{getSortIcon('setupName')}</th>
                </tr>
              </thead>
              
              {status.includes('Syncing') && setups.length === 0 ? (
                <tbody>
                  <tr>
                    <td colSpan={13} className="py-12 text-center border-b border-white/5">
                      <div className="w-5 h-5 border-2 border-indigo-500/20 border-t-indigo-400 rounded-full animate-spin mx-auto mb-3"></div>
                      <span className="text-xs text-slate-500 font-medium">Fetching DB Snapshot...</span>
                    </td>
                  </tr>
                </tbody>
              ) : filteredAndSortedSetups.length === 0 ? (
                <tbody>
                  <tr>
                    <td colSpan={13} className="py-12 text-center text-slate-500 text-sm font-medium border-b border-white/5">No active tracking items currently matching momentum criteria.</td>
                  </tr>
                </tbody>
              ) : (
                filteredAndSortedSetups.map((row, i) => {
                  const isPositive = row.changePct >= 0;
                  
                  return (
                    <tbody key={i} className="group border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                      <tr className="bg-transparent">
                        <td className="pt-3 pb-1.5" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          <div className="flex items-center gap-2">
                            <div className="relative inline-flex items-center group/ticker">
                              <span className="inline-block bg-indigo-500/10 text-[#7c8bfa] text-[11px] font-bold px-2 py-0.5 rounded border border-indigo-500/20 cursor-help">{row.ticker}</span>
                              <div className="absolute left-full ml-3 px-3 py-1.5 bg-[#1e293b] border border-white/10 text-slate-200 text-xs font-semibold tracking-wide rounded-md shadow-2xl opacity-0 invisible group-hover/ticker:opacity-100 group-hover/ticker:visible transition-all z-[60] whitespace-nowrap pointer-events-none">{row.name || row.ticker}</div>
                            </div>
                            
                            {row.conviction != null ? (
                              <span className={`inline-block whitespace-nowrap px-1.5 py-[2px] rounded text-[9px] font-bold border uppercase ${
                                row.conviction >= 85 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_8px_rgba(52,211,153,0.1)]' : 
                                row.conviction >= 70 ? 'bg-amber-500/10 text-amber-400 border-amber-500/20 shadow-[0_0_8px_rgba(251,191,36,0.1)]' : 
                                'bg-zinc-800/50 text-zinc-400 border-zinc-700/50'
                              }`}>
                                CNF: {row.conviction}%
                              </span>
                            ) : (
                              <span className="inline-block whitespace-nowrap px-1.5 py-[2px] rounded text-[9px] font-bold border uppercase bg-white/[0.02] text-slate-600 border-white/5">
                                CNF: --%
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="pt-3 pb-1.5 text-xs text-slate-300 font-medium whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          <div className="flex items-center gap-1.5">
                            ${row.price.toFixed(2)}
                            {row.vwapStatus !== 'neutral' && (<div className={`w-1.5 h-1.5 rounded-full shrink-0 ${row.vwapStatus === 'above' ? 'bg-emerald-400' : 'bg-rose-500'}`}></div>)}
                          </div>
                        </td>
                        <td className={`pt-3 pb-1.5 text-xs font-bold whitespace-nowrap ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`} style={{ textAlign: 'left', paddingLeft: '16px' }}>{isPositive ? '+' : ''}{row.changePct.toFixed(2)}%</td>
                        <td className="pt-3 pb-1.5 text-xs text-slate-400 font-medium whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '16px' }}>{formatNumber(row.vol)}</td>
                        <td className="pt-3 pb-1.5 text-xs text-slate-400 font-medium whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '16px' }}>{formatCurrency(row.dVol)}</td>
                        <td className={`pt-3 pb-1.5 text-xs font-bold whitespace-nowrap ${getRvolColor(row.rvol)}`} style={{ textAlign: 'left', paddingLeft: '16px' }}>{row.rvol ? `${row.rvol.toFixed(1)}x` : '—'}</td>
                        <td className={`pt-3 pb-1.5 text-xs font-bold whitespace-nowrap ${getFloatColor(row.float)}`} style={{ textAlign: 'left', paddingLeft: '16px' }}>{formatNumber(row.float)}</td>
                        <td className={`pt-3 pb-1.5 text-xs font-bold whitespace-nowrap ${getShortColor(row.shortPct)}`} style={{ textAlign: 'left', paddingLeft: '16px' }}>{row.shortPct ? `${row.shortPct.toFixed(1)}%` : '—'}</td>
                        <td className="pt-3 pb-1.5 text-xs text-slate-400 font-medium whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '16px' }}>{formatNumber(row.mktCap)}</td>
                        <td className="pt-3 pb-1.5 text-[10px] text-slate-400 font-medium whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          <div className="truncate bg-[#161c2a] px-1.5 py-0.5 rounded border border-white/5 inline-block">{row.sector || '—'}</div>
                        </td>
                        <td className="pt-3 pb-1.5 text-[11px] text-indigo-300/90 font-medium truncate max-w-[140px]" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          {row.catalyst || '—'}
                        </td>
                        <td className="pt-3 pb-1.5 text-xs font-bold whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          <span className={getStageColor(row.stage)}>{formatStageText(row.stage)}</span>
                        </td>
                        <td className="pt-3 pb-1.5 text-[11px] text-slate-200 font-semibold truncate max-w-[200px]" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          <div className="flex items-center gap-1.5">
                            {row.setupName === 'Blue Dot Rev' && <div className="w-1.5 h-1.5 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.8)]"></div>}
                            <span>{formatSetupName(row.setupName)}</span>
                          </div>
                        </td>
                      </tr>

                      <tr className="bg-transparent">
                        <td colSpan={13} className="pb-3 pt-0.5 px-4 pl-[16px]">
                          <div className="flex items-start">
                            <div className="flex-1 mt-[1px]">
                              {row.thesis ? (
                                <p className="text-[11px] text-slate-400/90 leading-relaxed pr-8 whitespace-normal line-clamp-3">
                                  <span className="text-indigo-400/80 font-bold mr-2 text-[10px] tracking-widest uppercase">THESIS:</span>
                                  {row.thesis}
                                </p>
                              ) : (
                                <p className="text-[11px] text-slate-600 italic leading-relaxed pr-8 whitespace-normal mt-0.5">
                                  Awaiting quantitative confluence analysis...
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  );
                })
              )}
            </table>
          </div>
        </>
      )}
    </div>
  );
}
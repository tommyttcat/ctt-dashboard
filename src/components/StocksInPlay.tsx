'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useMarketData } from './MarketDataContext';

interface StockInPlay {
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
  catalyst: string | null;
  catalystUrl: string | null;
}

type SortDirection = 'asc' | 'desc';

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

export default function StocksInPlay() {
  const { session } = useMarketData(); 

  const [stocks, setStocks] = useState<StockInPlay[]>([]);
  const [status, setStatus] = useState<string>('Syncing DB...');
  const [lastScanTime, setLastScanTime] = useState<number | null>(null);
  
  const [sortConfig, setSortConfig] = useState<{ key: keyof StockInPlay; direction: SortDirection } | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  
  const [showStage2AOnly, setShowStage2AOnly] = useState<boolean>(true); 
  const [marketCapFilter, setMarketCapFilter] = useState<string>('All'); 

  useEffect(() => {
    let isMounted = true;

    const fetchDatabaseSnapshot = async () => {
      try {
        const res = await fetch('/api/scanner/latest');
        const data = await res.json();
        
        if (isMounted && data.success) {
          
          // SAFETY TRANSLATOR: Maps backend keys to frontend expectations
          const rawList = data.stocksInPlay || [];
          const safeData = rawList.map((item: any) => ({
            ticker: item.ticker || '—',
            name: item.name || '',
            sector: item.sector && item.sector !== '—' ? item.sector : '—',
            price: Number(item.price) || 0,
            vwapStatus: item.vwapStatus || 'neutral',
            changePct: Number(item.change ?? item.changePct) || 0,
            vol: Number(item.volume ?? item.vol) || 0,
            dVol: Number(item.dVol) || (Number(item.price || 0) * Number((item.volume ?? item.vol) || 0)),
            rvol: item.rvol || null,
            float: item.float || null,
            shortPct: item.shortPct || null,
            mktCap: item.mktCap || null,
            stage: item.stage || 'Stage 2A',
            setupName: item.setupName || null,
            catalyst: item.catalyst || null,
            catalystUrl: item.catalystUrl || null,
          }));

          setStocks(safeData);
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

  const handleSort = (key: keyof StockInPlay) => {
    let direction: SortDirection = 'desc'; 
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') direction = 'asc';
    else if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') { setSortConfig(null); return; }
    setSortConfig({ key, direction });
  };

  const filteredAndSortedStocks = useMemo(() => {
    let filtered = stocks;
    
    // STRICT FILTER: Exact case matching
    if (showStage2AOnly) {
      filtered = filtered.filter(s => s.stage === 'Stage 2A');
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

    if (!sortConfig) return filtered;
    
    return [...filtered].sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [stocks, sortConfig, showStage2AOnly, marketCapFilter]);

  const getSortIcon = (columnKey: keyof StockInPlay) => sortConfig?.key === columnKey ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓') : '';
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
            STOCKS IN PLAY
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
            <div className="flex items-center gap-4">
              <button
                onClick={(e) => { e.stopPropagation(); setShowStage2AOnly(!showStage2AOnly); }}
                className={`px-4 py-1.5 rounded-lg text-[10px] font-bold tracking-widest uppercase transition-all duration-300 ${
                  showStage2AOnly 
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-[0_0_10px_rgba(52,211,153,0.1)]' 
                    : 'bg-[#161c2a] text-slate-400 border border-white/5 hover:bg-white/[0.04]'
                }`}
              >
                {showStage2AOnly ? 'Stage 2A' : 'Filter: Stage 2A'}
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
            <table className="w-full min-w-[1300px] border-collapse">
              <thead>
                <tr className="border-b border-white/5 select-none">
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[5%] cursor-pointer hover:text-slate-300" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('ticker')}>TICKER{getSortIcon('ticker')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[5%] cursor-pointer hover:text-slate-300" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('price')}>PRICE{getSortIcon('price')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[6%] cursor-pointer hover:text-slate-300" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('changePct')}>CHG%{getSortIcon('changePct')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[5%] cursor-pointer hover:text-slate-300" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('vol')}>VOL{getSortIcon('vol')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[6%] cursor-pointer hover:text-slate-300" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('dVol')}>$VOL{getSortIcon('dVol')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[5%] cursor-pointer hover:text-slate-300" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('rvol')}>RVOL{getSortIcon('rvol')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[5%] cursor-pointer hover:text-slate-300" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('float')}>FLOAT{getSortIcon('float')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[5%] cursor-pointer hover:text-slate-300" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('shortPct')}>SHT%{getSortIcon('shortPct')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[6%] cursor-pointer hover:text-slate-300" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('mktCap')}>MCAP{getSortIcon('mktCap')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[12%] cursor-pointer hover:text-slate-300" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('sector')}>SECTOR{getSortIcon('sector')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[4%] cursor-pointer hover:text-slate-300" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('stage')}>STAGE{getSortIcon('stage')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[11%] cursor-pointer hover:text-slate-300" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('setupName')}>STRATEGY{getSortIcon('setupName')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[25%] cursor-pointer hover:text-slate-300" style={{ textAlign: 'left', paddingLeft: '24px' }} onClick={() => handleSort('catalyst')}>CATALYST'S{getSortIcon('catalyst')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {status.includes('Syncing') && stocks.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="py-12 text-center">
                      <div className="w-5 h-5 border-2 border-indigo-500/20 border-t-indigo-400 rounded-full animate-spin mx-auto mb-3"></div>
                      <span className="text-xs text-slate-500 font-medium">Fetching DB Snapshot...</span>
                    </td>
                  </tr>
                ) : filteredAndSortedStocks.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="py-12 text-center text-slate-500 text-sm font-medium">No active tracking items currently matching momentum criteria.</td>
                  </tr>
                ) : (
                  filteredAndSortedStocks.map((row, i) => {
                    const isPositive = row.changePct >= 0;
                    return (
                      <tr key={i} className="hover:bg-white/[0.02] transition-colors group">
                        <td className="py-3" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          <div className="relative inline-flex items-center group/ticker">
                            <span className="inline-block bg-indigo-500/10 text-[#7c8bfa] text-[11px] font-bold px-2 py-0.5 rounded border border-indigo-500/20 cursor-help">{row.ticker}</span>
                            <div className="absolute left-full ml-3 px-3 py-1.5 bg-[#1e293b] border border-white/10 text-slate-200 text-xs font-semibold tracking-wide rounded-md shadow-2xl opacity-0 invisible group-hover/ticker:opacity-100 group-hover/ticker:visible transition-all z-50 whitespace-nowrap pointer-events-none">{row.name || row.ticker}</div>
                          </div>
                        </td>
                        <td className="py-3 text-xs text-slate-300 font-medium whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          <div className="flex items-center gap-1.5">
                            ${row.price.toFixed(2)}
                            {row.vwapStatus !== 'neutral' && (<div className={`w-1.5 h-1.5 rounded-full shrink-0 ${row.vwapStatus === 'above' ? 'bg-emerald-400' : 'bg-rose-500'}`}></div>)}
                          </div>
                        </td>
                        <td className={`py-3 text-xs font-bold whitespace-nowrap ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`} style={{ textAlign: 'left', paddingLeft: '16px' }}>{isPositive ? '+' : ''}{row.changePct.toFixed(2)}%</td>
                        <td className="py-3 text-xs text-slate-400 font-medium whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '16px' }}>{formatNumber(row.vol)}</td>
                        <td className="py-3 text-xs text-slate-400 font-medium whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '16px' }}>{formatCurrency(row.dVol)}</td>
                        <td className={`py-3 text-xs font-bold whitespace-nowrap ${getRvolColor(row.rvol)}`} style={{ textAlign: 'left', paddingLeft: '16px' }}>{row.rvol ? `${row.rvol.toFixed(1)}x` : '—'}</td>
                        <td className={`py-3 text-xs font-bold whitespace-nowrap ${getFloatColor(row.float)}`} style={{ textAlign: 'left', paddingLeft: '16px' }}>{formatNumber(row.float)}</td>
                        <td className={`py-3 text-xs font-bold whitespace-nowrap ${getShortColor(row.shortPct)}`} style={{ textAlign: 'left', paddingLeft: '16px' }}>{row.shortPct ? `${row.shortPct.toFixed(1)}%` : '—'}</td>
                        <td className="py-3 text-xs text-slate-400 font-medium whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '16px' }}>{formatNumber(row.mktCap)}</td>
                        <td className="py-3 text-[10px] text-slate-400 font-medium whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          <div className="truncate bg-[#161c2a] px-1.5 py-0.5 rounded border border-white/5 inline-block">{row.sector || '—'}</div>
                        </td>
                        <td className="py-3 text-xs font-bold whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          <span className={getStageColor(row.stage)}>{row.stage}</span>
                        </td>
                        <td className="py-3 text-[11px] text-slate-200 font-semibold truncate max-w-[280px]" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          <div className="flex items-center gap-1.5">
                            {row.setupName === 'Blue Dot Rev' && <div className="w-1.5 h-1.5 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.8)]"></div>}
                            <span>{row.setupName || '—'}</span>
                          </div>
                        </td>
                        <td className="py-3 text-[11px] text-slate-400 font-medium" style={{ textAlign: 'left', paddingLeft: '24px' }}>
                          <div className="flex items-center gap-2 group/cat">
                            {row.catalyst && row.catalyst !== '—' ? (
                              row.catalystUrl ? (
                                <a href={row.catalystUrl} target="_blank" rel="noopener noreferrer" className="truncate max-w-[450px] md:max-w-[550px] lg:max-w-[750px] xl:max-w-[950px] group-hover/cat:text-[#7c8bfa] transition-colors hover:underline">{row.catalyst}</a>
                              ) : (<span className="truncate max-w-[450px] md:max-w-[550px] lg:max-w-[750px] xl:max-w-[950px] group-hover/cat:text-slate-200 transition-colors">{row.catalyst}</span>)
                            ) : (<span className="text-slate-600 font-medium">—</span>)}
                          </div>
                        </td>
                      </tr>
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
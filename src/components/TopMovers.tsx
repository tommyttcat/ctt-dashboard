'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useMarketData } from './MarketDataContext';

interface StockData {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  vwapStatus: 'above' | 'below' | 'neutral';
  changePct: number;
  vol: number;
  dVol: number;
  rvol: number | null;
  mktCap: number | null;
  float: number | null;
  shortPct: number | null;
  catalyst: string | null;
  catalystUrl: string | null;
  stage: string;
  setupName: string | null;
}

type TabType = 'Mega Caps' | 'Gainers' | 'Losers' | 'ETF Gainers' | 'ETF Losers';
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

export default function TopMovers() {
  const { session } = useMarketData();
  
  const [topMoversData, setTopMoversData] = useState<Record<TabType, StockData[]>>({
    'Mega Caps': [], 'Gainers': [], 'Losers': [], 'ETF Gainers': [], 'ETF Losers': []
  });
  
  const [activeTab, setActiveTab] = useState<TabType>('Gainers');
  const [status, setStatus] = useState<string>('Syncing DB...');
  const [lastScanTime, setLastScanTime] = useState<number | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: keyof StockData; direction: SortDirection } | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [marketCapFilter, setMarketCapFilter] = useState<string>('All'); 

  const isEtfTab = activeTab.includes('ETF');

  useEffect(() => { setSortConfig(null); }, [activeTab]);

  useEffect(() => {
    let isMounted = true;
    const fetchDatabaseSnapshot = async () => {
      try {
        const res = await fetch(`/api/scanner/latest?t=${Date.now()}`, { cache: 'no-store' });
        const data = await res.json();
        
        if (isMounted && data.success && data.topMovers) {
          
          const safeData: Record<TabType, StockData[]> = {
            'Mega Caps': [], 'Gainers': [], 'Losers': [], 'ETF Gainers': [], 'ETF Losers': []
          };
          
          const categories: TabType[] = ['Mega Caps', 'Gainers', 'Losers', 'ETF Gainers', 'ETF Losers'];
          
          categories.forEach(category => {
            const rawList = data.topMovers[category] || [];
            
            safeData[category] = rawList.map((item: any) => ({
              ticker: item.ticker || '—',
              name: item.name || '',
              sector: item.sector || '',
              price: Number(item.price) || 0,
              vwapStatus: item.vwapStatus || 'neutral',
              changePct: Number((item.change ?? item.changePct) || 0), 
              vol: Number((item.volume ?? item.vol) || 0),
              dVol: Number(item.dVol) || (Number(item.price || 0) * Number((item.volume ?? item.vol) || 0)),
              rvol: item.rvol || null,
              mktCap: item.mktCap || null,
              float: item.float || null,
              shortPct: item.shortPct || null,
              catalyst: item.catalyst || null,
              catalystUrl: item.catalystUrl || null,
              stage: item.stage || '—',
              setupName: item.setupName || null,
            }));
          });

          setTopMoversData(safeData);
          setLastScanTime(data.lastScanTime || Date.now()); 
          setStatus('Live');
        }
      } catch (error) {
        if (isMounted) setStatus('DB Offline');
      }
    };

    fetchDatabaseSnapshot();
    const interval = setInterval(fetchDatabaseSnapshot, 60000);
    return () => { isMounted = false; clearInterval(interval); };
  }, []);

  const handleSort = (key: keyof StockData) => {
    let direction: SortDirection = 'desc'; 
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') direction = 'asc';
    else if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') { setSortConfig(null); return; }
    setSortConfig({ key, direction });
  };

  const sortedStocks = useMemo(() => {
    let currentList = topMoversData[activeTab] || [];

    if (marketCapFilter !== 'All') {
      currentList = currentList.filter(s => {
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

    if (!sortConfig) return currentList.slice(0, 10);
    
    return [...currentList].sort((a, b) => {
      const aVal = a[sortConfig.key] as any;
      const bVal = b[sortConfig.key] as any;
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    }).slice(0, 10);
  }, [topMoversData, activeTab, sortConfig, marketCapFilter]);

  const getSortIcon = (columnKey: keyof StockData) => sortConfig?.key === columnKey ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓') : '';
  
  const getSessionTextColor = () => {
    if (status.includes('Err') || status.includes('Offline')) return 'text-rose-500';
    if (status.includes('Syncing')) return 'text-amber-500'; 
    if (session === 'Pre-Market') return 'text-amber-500';
    if (session === 'Open') return 'text-[#00e676]';
    if (session === 'Post-Market') return 'text-indigo-400';
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

  return (
    <div className="bg-[#101623] border border-white/5 rounded-2xl p-4 md:p-8 relative overflow-hidden shadow-xl w-full">
      
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex justify-between items-center relative z-10 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-6 border-b border-white/5 pb-4' : ''}`}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs md:text-sm font-bold text-[#7c8bfa] bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 group-hover:bg-white/[0.02] transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
            TOP MOVERS
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
          <div className="flex flex-col gap-4 mb-6 relative z-10 pb-2">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 w-full">
              <div className="flex gap-3 overflow-x-auto custom-scrollbar w-full md:w-auto" style={{ scrollbarWidth: 'none' }}>
                {(['Mega Caps', 'Gainers', 'Losers', 'ETF Gainers', 'ETF Losers'] as TabType[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={(e) => { e.stopPropagation(); setActiveTab(tab); }}
                    className={`px-5 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-all duration-300 ${
                      activeTab === tab 
                        ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.1)]' 
                        : 'bg-[#161c2a] text-slate-400 border border-white/5 hover:bg-white/[0.04]'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-4 px-3 py-1.5 bg-[#161c2a] border border-white/5 rounded-lg shrink-0 w-full md:w-auto">
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

            <div className="flex items-center w-full">
              <div className="flex items-center bg-[#161c2a] border border-white/5 rounded-xl p-1 overflow-x-auto custom-scrollbar w-full md:w-auto" onClick={(e) => e.stopPropagation()}>
                {['All', 'Micro', 'Small', 'Mid', 'Large', 'Mega'].map((cap) => (
                  <button
                    key={cap}
                    onClick={() => setMarketCapFilter(cap)}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-widest uppercase transition-all duration-300 whitespace-nowrap ${
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
          </div>
          
          <div className="overflow-x-auto custom-scrollbar" style={{ scrollbarWidth: 'none' }}>
            <table className="w-full min-w-[1200px] border-collapse">
              <thead>
                <tr className="border-b border-white/5 select-none">
                  <th className="pt-3 pb-2 text-[10px] text-slate-500 font-bold tracking-wider cursor-pointer hover:text-slate-300 text-left pl-2 w-[10%]" onClick={() => handleSort('ticker')}>TICKER{getSortIcon('ticker')}</th>
                  <th className="pt-3 pb-2 text-[10px] text-slate-500 font-bold tracking-wider cursor-pointer hover:text-slate-300 text-left w-[6%]" onClick={() => handleSort('price')}>PRICE{getSortIcon('price')}</th>
                  <th className="pt-3 pb-2 text-[10px] text-slate-500 font-bold tracking-wider cursor-pointer hover:text-slate-300 text-left w-[6%]" onClick={() => handleSort('changePct')}>CHG%{getSortIcon('changePct')}</th>
                  <th className="pt-3 pb-2 text-[10px] text-slate-500 font-bold tracking-wider cursor-pointer hover:text-slate-300 text-left w-[6%]" onClick={() => handleSort('vol')}>VOL{getSortIcon('vol')}</th>
                  <th className="pt-3 pb-2 text-[10px] text-slate-500 font-bold tracking-wider cursor-pointer hover:text-slate-300 text-left w-[6%]" onClick={() => handleSort('dVol')}>$VOL{getSortIcon('dVol')}</th>
                  <th className="pt-3 pb-2 text-[10px] text-slate-500 font-bold tracking-wider cursor-pointer hover:text-slate-300 text-left w-[6%]" onClick={() => handleSort('rvol')}>RVOL{getSortIcon('rvol')}</th>
                  {!isEtfTab && (
                    <>
                      <th className="pt-3 pb-2 text-[10px] text-slate-500 font-bold tracking-wider cursor-pointer hover:text-slate-300 text-left w-[6%]" onClick={() => handleSort('float')}>FLOAT{getSortIcon('float')}</th>
                      <th className="pt-3 pb-2 text-[10px] text-slate-500 font-bold tracking-wider cursor-pointer hover:text-slate-300 text-left w-[6%]" onClick={() => handleSort('shortPct')}>SHT%{getSortIcon('shortPct')}</th>
                      <th className="pt-3 pb-2 text-[10px] text-slate-500 font-bold tracking-wider cursor-pointer hover:text-slate-300 text-left w-[6%]" onClick={() => handleSort('mktCap')}>MCAP{getSortIcon('mktCap')}</th>
                    </>
                  )}
                  <th className="pt-3 pb-2 text-[10px] text-slate-500 font-bold tracking-wider cursor-pointer hover:text-slate-300 text-left w-[8%]" onClick={() => handleSort('sector')}>{isEtfTab ? 'ETF' : 'SECTOR'}{getSortIcon('sector')}</th>
                  <th className="pt-3 pb-2 text-[10px] text-slate-500 font-bold tracking-wider cursor-pointer hover:text-slate-300 text-left pr-4 w-[34%]" onClick={() => handleSort('catalyst')}>CATALYST{getSortIcon('catalyst')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {status.includes('Syncing') && topMoversData[activeTab].length === 0 ? (
                  <tr>
                    <td colSpan={isEtfTab ? 8 : 11} className="py-12 text-center">
                      <div className="w-5 h-5 border-2 border-indigo-500/20 border-t-indigo-400 rounded-full animate-spin mx-auto mb-3"></div>
                      <span className="text-xs text-slate-500 font-medium">Fetching DB Snapshot...</span>
                    </td>
                  </tr>
                ) : sortedStocks.length === 0 ? (
                  <tr>
                    <td colSpan={isEtfTab ? 8 : 11} className="py-12 text-center text-slate-500 text-sm font-medium">No tracking instruments currently found matching criteria.</td>
                  </tr>
                ) : (
                  sortedStocks.map((row, i) => {
                    const isPositive = row.changePct >= 0;
                    return (
                      <tr key={i} className="hover:bg-white/[0.02] transition-colors group">
                        <td className="pt-3 pb-2 text-left pl-2">
                          <div className="relative inline-flex items-center group/ticker">
                            <span className="inline-block bg-indigo-500/10 text-[#7c8bfa] text-[11px] font-bold px-2 py-0.5 rounded border border-indigo-500/20 cursor-help">{row.ticker}</span>
                            <div className="absolute left-full ml-3 px-3 py-1.5 bg-[#1e293b] border border-white/10 text-slate-200 text-xs font-semibold tracking-wide rounded-md shadow-2xl opacity-0 invisible group-hover/ticker:opacity-100 group-hover/ticker:visible transition-all z-[60] whitespace-nowrap pointer-events-none">{row.name || row.ticker}</div>
                          </div>
                        </td>
                        <td className="pt-3 pb-2 text-xs text-slate-300 font-medium whitespace-nowrap text-left">
                          <div className="flex items-center gap-1.5">
                            ${row.price.toFixed(2)}
                            {row.vwapStatus !== 'neutral' && (<div className={`w-1.5 h-1.5 rounded-full shrink-0 ${row.vwapStatus === 'above' ? 'bg-emerald-400' : 'bg-rose-500'}`}></div>)}
                          </div>
                        </td>
                        <td className={`pt-3 pb-2 text-xs font-bold whitespace-nowrap text-left ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>{isPositive ? '+' : ''}{row.changePct.toFixed(2)}%</td>
                        <td className="pt-3 pb-2 text-xs text-slate-400 font-medium whitespace-nowrap text-left">{formatNumber(row.vol)}</td>
                        <td className="pt-3 pb-2 text-xs text-slate-400 font-medium whitespace-nowrap text-left">{formatCurrency(row.dVol)}</td>
                        <td className={`pt-3 pb-2 text-xs font-bold whitespace-nowrap text-left ${getRvolColor(row.rvol)}`}>{row.rvol ? `${row.rvol.toFixed(1)}x` : '—'}</td>
                        {!isEtfTab && (
                          <>
                            <td className={`pt-3 pb-2 text-xs font-bold whitespace-nowrap text-left ${getFloatColor(row.float)}`}>{formatNumber(row.float)}</td>
                            <td className={`pt-3 pb-2 text-xs font-bold whitespace-nowrap text-left ${getShortColor(row.shortPct)}`}>{row.shortPct ? `${row.shortPct.toFixed(1)}%` : '—'}</td>
                            <td className="pt-3 pb-2 text-xs text-slate-400 font-medium whitespace-nowrap text-left">{formatNumber(row.mktCap)}</td>
                          </>
                        )}
                        <td className="pt-3 pb-2 text-[10px] text-slate-400 font-medium whitespace-nowrap text-left">
                          <div className="truncate bg-[#161c2a] px-1.5 py-0.5 rounded border border-white/5 inline-block">{row.sector || '—'}</div>
                        </td>
                        <td className="pt-3 pb-2 text-[11px] text-indigo-300/90 font-medium text-left pr-4 whitespace-normal break-words">
                          {row.catalyst ? (
                            row.catalystUrl ? (
                              <a href={row.catalystUrl} target="_blank" rel="noopener noreferrer" className="group-hover/cat:text-[#7c8bfa] transition-colors hover:underline">{row.catalyst}</a>
                            ) : (<span className="group-hover/cat:text-slate-200 transition-colors">{row.catalyst}</span>)
                          ) : (<span className="text-slate-600 font-medium">—</span>)}
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
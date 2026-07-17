'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useMarketData } from './MarketDataContext';

interface SwingCandidate {
  symbol: string;
  price: number;
  score: number;
  atrPct: number;
  pctOffHigh: number;
  distToEma21: number;
  stochK: number;
  rsVsSpy: number;
  avgDollarVolM: number;
  goldenCross: boolean;
  ema21Rising: boolean;
}

type SortDirection = 'asc' | 'desc';
type ScoreFilterType = 'All' | 'High' | 'Med' | 'Low';

const formatTime = (timestamp: number | Date) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'America/New_York' });
};

// A candidate is "ready" when the stochastic is deep and the pullback is tight —
// i.e. the blue dot could fire on the next bar or two.
const isReady = (c: SwingCandidate) => c.stochK <= 25 && Math.abs(c.distToEma21) <= 2.5;

// Plain-English setup readout for the sub-row (mirrors the thesis line in StocksInPlay)
const buildReadout = (c: SwingCandidate) => {
  const emaSide = c.distToEma21 >= 0 ? 'above' : 'below';
  const emaState = c.ema21Rising ? 'rising' : 'flat/declining';
  const stochState = c.stochK <= 20 ? 'deeply oversold' : c.stochK <= 30 ? 'oversold' : 'approaching oversold';
  const structure = c.goldenCross ? '50>200 intact' : '50<200 — weaker structure';
  return `${Math.abs(c.distToEma21).toFixed(1)}% ${emaSide} ${emaState} 21 EMA, stoch ${c.stochK.toFixed(0)} (${stochState}), ${c.pctOffHigh.toFixed(0)}% off highs with RS +${c.rsVsSpy.toFixed(0)} vs SPY, ${structure}. Watching for BD + MACD confirmation.`;
};

export default function SwingCandidates() {
  const { session } = useMarketData();

  const [candidates, setCandidates] = useState<SwingCandidate[]>([]);
  const [status, setStatus] = useState<string>('Syncing...');
  const [generatedAt, setGeneratedAt] = useState<number | null>(null);
  const [spyReturn, setSpyReturn] = useState<number | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [sortConfig, setSortConfig] = useState<{ key: keyof SwingCandidate; direction: SortDirection } | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [showReadyOnly, setShowReadyOnly] = useState<boolean>(false);
  const [scoreFilter, setScoreFilter] = useState<ScoreFilterType>('All');

  const fetchCandidates = useCallback(async (forceRefresh: boolean = false) => {
    try {
      if (forceRefresh) setIsRefreshing(true);
      const url = forceRefresh ? `/api/swing-candidates?refresh=true` : `/api/swing-candidates?t=${Date.now()}`;
      const res = await fetch(url, { cache: 'no-store' });
      const data = await res.json();

      if (data && Array.isArray(data.candidates)) {
        setCandidates(data.candidates);
        setGeneratedAt(data.generatedAt ? new Date(data.generatedAt).getTime() : Date.now());
        setSpyReturn(data.spyReturn3M ?? null);
        setStatus('Live');
      } else if (data?.error) {
        setStatus('Feed Error');
      }
    } catch {
      setStatus('Feed Offline');
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const run = async () => { if (isMounted) await fetchCandidates(false); };
    run();
    const interval = setInterval(run, 300000); // 5 min — server cache is 30 min
    return () => { isMounted = false; clearInterval(interval); };
  }, [fetchCandidates]);

  const handleSort = (key: keyof SwingCandidate) => {
    let direction: SortDirection = 'desc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') direction = 'asc';
    else if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') { setSortConfig(null); return; }
    setSortConfig({ key, direction });
  };

  const filteredAndSorted = useMemo(() => {
    let filtered = [...candidates];
    if (showReadyOnly) filtered = filtered.filter(isReady);
    if (scoreFilter !== 'All') {
      filtered = filtered.filter(c => {
        if (scoreFilter === 'High') return c.score >= 70;
        if (scoreFilter === 'Med') return c.score >= 55 && c.score < 70;
        if (scoreFilter === 'Low') return c.score < 55;
        return true;
      });
    }
    if (!sortConfig) return filtered; // default order = score desc from API
    return filtered.sort((a, b) => {
      const aVal = a[sortConfig.key] as any;
      const bVal = b[sortConfig.key] as any;
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [candidates, sortConfig, showReadyOnly, scoreFilter]);

  const getSortIcon = (columnKey: keyof SwingCandidate) => sortConfig?.key === columnKey ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓') : '';

  const getScoreBadge = (score: number) => {
    if (score >= 70) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    if (score >= 55) return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    return 'bg-zinc-800/50 text-zinc-400 border-zinc-700/50';
  };
  const getStochColor = (k: number) => {
    if (k <= 20) return 'text-purple-400';
    if (k <= 30) return 'text-emerald-400';
    return 'text-slate-400';
  };
  const getDistColor = (d: number) => {
    if (Math.abs(d) <= 1.5) return 'text-emerald-400';
    if (Math.abs(d) <= 3) return 'text-slate-300';
    return 'text-slate-500';
  };
  const getRsColor = (rs: number) => {
    if (rs >= 20) return 'text-purple-400';
    if (rs >= 10) return 'text-emerald-400';
    return 'text-slate-300';
  };
  const getAtrColor = (a: number) => {
    if (a >= 2.5 && a <= 4) return 'text-emerald-400';
    return 'text-slate-400';
  };

  const displaySession = ['Pre-Market', 'Open', 'Post-Market', 'Closed'].includes(session) ? session : 'Closed';
  const getSessionTextColor = () => {
    if (displaySession === 'Pre-Market') return 'text-amber-500';
    if (displaySession === 'Open') return 'text-[#00e676]';
    if (displaySession === 'Post-Market') return 'text-indigo-400';
    return 'text-slate-500';
  };

  const thBase = "px-3.5 py-3 text-[10px] text-slate-500 font-bold tracking-wider cursor-pointer hover:text-slate-300 transition-colors";
  const tdBase = "px-3.5 pt-3 pb-2";

  return (
    <div className="bg-[#101623] border border-white/5 rounded-2xl p-4 md:p-8 relative overflow-hidden shadow-xl w-full max-w-[1280px] mx-auto">
      <div onClick={() => setIsExpanded(!isExpanded)} className={`flex justify-between items-center relative z-10 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-6 border-b border-white/5 pb-4' : ''}`}>
        <div className="flex items-center gap-3">
          <span className="text-xs md:text-sm font-bold text-[#7c8bfa] bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 group-hover:bg-white/[0.02] transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
            SWING CANDIDATES
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
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4 relative z-10">
            <div className="flex flex-wrap items-center gap-4">
              <button onClick={(e) => { e.stopPropagation(); setShowReadyOnly(!showReadyOnly); }} className={`px-4 py-1.5 rounded-lg text-[10px] font-bold tracking-widest uppercase transition-all duration-300 ${showReadyOnly ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-[0_0_10px_rgba(52,211,153,0.1)]' : 'bg-[#161c2a] text-slate-400 border border-white/5 hover:bg-white/[0.04]'}`}>Filter: Ready</button>
              <div className="flex items-center bg-[#161c2a] border border-white/5 rounded-xl p-1" onClick={(e) => e.stopPropagation()}>
                <div className="px-2 border-r border-white/10 mr-1"><span className="text-[9px] font-bold tracking-widest uppercase text-slate-500">SCORE</span></div>
                {['All', 'High', 'Med', 'Low'].map((level) => (
                  <button key={level} onClick={() => setScoreFilter(level as ScoreFilterType)} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-widest uppercase transition-all duration-300 ${scoreFilter === level ? 'bg-[#1e293b] text-indigo-400 border border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.1)]' : 'text-slate-500 border border-transparent hover:text-slate-300 hover:bg-white/[0.02]'}`}>{level}</button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-4 px-3 py-1.5 bg-[#161c2a] border border-white/5 rounded-lg shrink-0">
                <span className="text-[9px] font-bold tracking-widest uppercase text-slate-500">STOCH</span>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-purple-400"></div><span className="text-[10px] font-medium text-slate-400">&le;20</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-emerald-400"></div><span className="text-[10px] font-medium text-slate-400">&le;30</span></div>
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); fetchCandidates(true); }}
                disabled={isRefreshing}
                className={`px-4 py-1.5 rounded-lg text-[10px] font-bold tracking-widest uppercase transition-all duration-300 border ${isRefreshing ? 'bg-[#161c2a] text-slate-600 border-white/5 cursor-wait' : 'bg-[#161c2a] text-slate-400 border-white/5 hover:bg-white/[0.04] hover:text-slate-300'}`}
              >
                {isRefreshing ? 'Scanning…' : 'Rescan'}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto custom-scrollbar relative z-10" style={{ scrollbarWidth: 'none' }}>
            <table className="w-full min-w-[1000px] table-fixed border-collapse">
              <thead>
                <tr className="border-b border-white/5 select-none">
                  <th className={`${thBase} text-left w-[9%]`} onClick={() => handleSort('symbol')}>TICKER{getSortIcon('symbol')}</th>
                  <th className="pl-1 pr-3.5 py-3 text-[10px] text-slate-500 font-bold tracking-wider text-left w-[7%] cursor-pointer hover:text-slate-300 transition-colors" onClick={() => handleSort('score')}>SCORE{getSortIcon('score')}</th>
                  <th className={`${thBase} text-right w-[9%]`} onClick={() => handleSort('price')}>PRICE{getSortIcon('price')}</th>
                  <th className={`${thBase} text-right w-[9%]`} onClick={() => handleSort('stochK')}>STOCH{getSortIcon('stochK')}</th>
                  <th className={`${thBase} text-right w-[10%]`} onClick={() => handleSort('distToEma21')}>21EMA Δ{getSortIcon('distToEma21')}</th>
                  <th className={`${thBase} text-right w-[10%]`} onClick={() => handleSort('pctOffHigh')}>OFF HIGH{getSortIcon('pctOffHigh')}</th>
                  <th className={`${thBase} text-right w-[8%]`} onClick={() => handleSort('atrPct')}>ATR%{getSortIcon('atrPct')}</th>
                  <th className={`${thBase} text-right w-[9%]`} onClick={() => handleSort('rsVsSpy')}>RS/SPY{getSortIcon('rsVsSpy')}</th>
                  <th className={`${thBase} text-right w-[9%]`} onClick={() => handleSort('avgDollarVolM')}>$VOL{getSortIcon('avgDollarVolM')}</th>
                  <th className={`${thBase} text-left w-[10%] border-l border-white/5`}>STRUCT</th>
                  <th className={`${thBase} text-left w-[10%]`}>STATUS</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-white/5">
                {candidates.length === 0 ? (
                  <tr><td colSpan={11} className="py-12 text-center text-slate-500 text-sm font-medium">{status === 'Live' ? 'No candidates match current filter criteria.' : status === 'Syncing...' ? 'Running scan…' : 'Feed unavailable — try Rescan.'}</td></tr>
                ) : (
                  filteredAndSorted.map((row, i) => (
                    <React.Fragment key={row.symbol}>
                      <tr className="hover:bg-white/[0.02] transition-colors group">
                        <td className={`${tdBase} text-left`}>
                          <span className="inline-block bg-indigo-500/10 text-[#7c8bfa] text-[11px] font-bold px-2 py-0.5 rounded border border-indigo-500/20">{row.symbol}</span>
                        </td>
                        <td className="pl-1 pr-3.5 pt-3 pb-2 text-left">
                          <span className={`inline-block whitespace-nowrap px-1.5 py-[2px] rounded text-[9px] font-bold border ${getScoreBadge(row.score)}`}>{row.score}</span>
                        </td>
                        <td className={`${tdBase} text-xs text-slate-300 font-medium whitespace-nowrap text-right tabular-nums`}>${row.price.toFixed(2)}</td>
                        <td className={`${tdBase} text-xs font-bold whitespace-nowrap text-right tabular-nums ${getStochColor(row.stochK)}`}>{row.stochK.toFixed(1)}</td>
                        <td className={`${tdBase} text-xs font-bold whitespace-nowrap text-right tabular-nums ${getDistColor(row.distToEma21)}`}>{row.distToEma21 >= 0 ? '+' : ''}{row.distToEma21.toFixed(1)}%</td>
                        <td className={`${tdBase} text-xs text-slate-400 font-medium whitespace-nowrap text-right tabular-nums`}>-{row.pctOffHigh.toFixed(1)}%</td>
                        <td className={`${tdBase} text-xs font-bold whitespace-nowrap text-right tabular-nums ${getAtrColor(row.atrPct)}`}>{row.atrPct.toFixed(1)}%</td>
                        <td className={`${tdBase} text-xs font-bold whitespace-nowrap text-right tabular-nums ${getRsColor(row.rsVsSpy)}`}>+{row.rsVsSpy.toFixed(1)}</td>
                        <td className={`${tdBase} text-xs text-slate-400 font-medium whitespace-nowrap text-right tabular-nums`}>${row.avgDollarVolM}M</td>
                        <td className={`${tdBase} text-left whitespace-nowrap border-l border-white/5`}>
                          <div className="flex items-center gap-1.5">
                            <span className={`text-[10px] font-bold ${row.goldenCross ? 'text-emerald-400' : 'text-slate-600'}`} title="50 SMA > 200 SMA">GC</span>
                            <span className={`text-[10px] font-bold ${row.ema21Rising ? 'text-emerald-400' : 'text-slate-600'}`} title="21 EMA rising">21↑</span>
                          </div>
                        </td>
                        <td className={`${tdBase} text-left whitespace-nowrap`}>
                          {isReady(row) ? (
                            <span className="inline-block px-2 py-[2px] rounded text-[9px] font-bold tracking-wide uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Ready</span>
                          ) : (
                            <span className="inline-block px-2 py-[2px] rounded text-[9px] font-bold tracking-wide uppercase bg-white/[0.02] text-slate-500 border border-white/5">Forming</span>
                          )}
                        </td>
                      </tr>
                      <tr className="bg-transparent border-t border-white/5">
                        <td colSpan={11} className="pb-3.5 pt-2.5 pr-2 pl-[56px]">
                          <div className="flex items-baseline gap-3">
                            <span className="shrink-0 w-[88px] text-[#7c8bfa] font-bold text-[10px] tracking-[0.1em] uppercase">EMA PB</span>
                            <p className="flex-1 text-[11px] leading-relaxed pr-8 whitespace-normal max-w-[780px]">
                              <span className="text-slate-500">{buildReadout(row)}</span>
                            </p>
                          </div>
                        </td>
                      </tr>
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
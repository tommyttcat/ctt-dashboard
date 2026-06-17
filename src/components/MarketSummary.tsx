'use client';

import React, { useState, useEffect } from 'react';

interface ActionableEvent {
  time: string;
  event: string;
  impact: 'High' | 'Medium' | 'Low';
}

interface UpdateBlock {
  phase: string;
  timestamp: string;
  paragraphs: string[];
  takeawayLabel: string;
  takeaway: string;
  colorTheme: 'cyan' | 'emerald' | 'indigo' | 'amber' | 'rose';
}

interface SummaryData {
  morning: UpdateBlock | null;
  midday: UpdateBlock | null;
  closing: UpdateBlock | null;
  actionableEvents?: ActionableEvent[]; 
}

interface WatchItem {
  symbol: string;
  score?: number | string;
  reason: string;
}

interface MacroInsights {
  theme: string;
  briefing: string;
  watching: WatchItem[];
}

type MarketSession = 'Pre-Market' | 'Open' | 'Post-Market' | 'Closed';

const getEstDateInfo = () => {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
};

const getCurrentEstDecimal = () => {
  const est = getEstDateInfo();
  return est.getHours() + est.getMinutes() / 60;
};

const isWeekendNow = () => {
  const day = getEstDateInfo().getDay();
  return day === 0 || day === 6;
};

const getMarketSession = (): MarketSession => {
  const est = getEstDateInfo();
  const day = est.getDay();
  const timeStr = est.getHours() + est.getMinutes() / 60;
  if (day === 0 || day === 6) return 'Closed';
  if (timeStr >= 4 && timeStr < 9.5) return 'Pre-Market';
  if (timeStr >= 9.5 && timeStr < 16) return 'Open';
  if (timeStr >= 16 && timeStr < 20) return 'Post-Market';
  return 'Closed'; 
};

const formatTime = (date: Date) => {
  return date.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit', 
    second: '2-digit',
    timeZone: 'America/New_York'
  });
};

export default function MarketSummary() {
  const [data, setData] = useState<SummaryData | null>(null);
  const [macroInsights, setMacroInsights] = useState<MacroInsights | null>(null);
  const [status, setStatus] = useState<'Loading' | 'Synced' | 'Error'>('Loading');
  const [session, setSession] = useState<MarketSession>('Closed');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(true);

  const isWeekend = isWeekendNow();

  useEffect(() => {
    let isMounted = true;
    if (!data && !macroInsights) setStatus('Loading');

    const fetchMarketData = async () => {
      if (isMounted) setSession(getMarketSession());

      try {
        // 1. Fetch Narrative Data (Actionable Events & Session Updates)
        const narrativeRes = await fetch('/api/market-summary', { cache: 'no-store' });

        if (!narrativeRes.ok) {
          if (narrativeRes.status === 404 && isMounted) {
            setData({ morning: null, midday: null, closing: null, actionableEvents: [] });
          } else {
            throw new Error(`Narrative API returned status: ${narrativeRes.status}`);
          }
        } else {
          const payload: SummaryData = await narrativeRes.json();
          if (isMounted) {
            const estTime = getCurrentEstDecimal();
            const gatedData: SummaryData = {
              morning: (estTime >= 4.0 || isWeekend) ? (payload.morning || null) : null,
              midday: (estTime >= 11.5 || isWeekend) ? (payload.midday || null) : null,
              closing: (estTime >= 15.5 || isWeekend) ? (payload.closing || null) : null,
              actionableEvents: payload.actionableEvents || [] 
            };
            setData(gatedData);
          }
        }
      } catch (error) {
        console.error("Narrative Sync Error:", error);
      }

      // 2. Fetch AI Macro Insights & Watchlist
      try {
        const scannerRes = await fetch('/api/scanner/latest', { cache: 'no-store' });
        if (!scannerRes.ok) throw new Error(`Scanner API returned status: ${scannerRes.status}`);
        
        const scannerData = await scannerRes.json();
        
        if (isMounted) {
          if (scannerData.macroInsights) {
            setMacroInsights(scannerData.macroInsights);
          } else if (scannerData.watching || scannerData.theme) {
            setMacroInsights(scannerData); // Fallback if data is flat
          }
        }
      } catch (error) {
        console.error("Scanner Macro Sync Error:", error);
      }

      // Finish Sync
      if (isMounted) {
        setStatus('Synced');
        setLastUpdated(new Date());
      }
    };

    fetchMarketData();
    const interval = setInterval(fetchMarketData, 60000); 
    return () => { isMounted = false; clearInterval(interval); };
  }, [isWeekend]); 

  const getThemeStyles = (theme: string) => {
    switch (theme) {
      case 'cyan': return { border: 'border-cyan-500/20', bg: 'bg-cyan-500/5', text: 'text-cyan-400', boxBg: 'bg-cyan-500/10', boxBorder: 'border-cyan-500', boxText: 'text-cyan-100/90' };
      case 'emerald': return { border: 'border-emerald-500/20', bg: 'bg-emerald-500/5', text: 'text-emerald-400', boxBg: 'bg-emerald-500/10', boxBorder: 'border-emerald-500', boxText: 'text-emerald-100/90' };
      case 'rose': return { border: 'border-rose-500/20', bg: 'bg-rose-500/5', text: 'text-rose-400', boxBg: 'bg-rose-500/10', boxBorder: 'border-rose-500', boxText: 'text-rose-100/90' };
      case 'amber': return { border: 'border-amber-500/20', bg: 'bg-amber-500/5', text: 'text-amber-400', boxBg: 'bg-amber-500/10', boxBorder: 'border-amber-500', boxText: 'text-amber-100/90' };
      case 'indigo': default: return { border: 'border-indigo-500/30', bg: 'bg-indigo-500/5', text: 'text-indigo-400', boxBg: 'bg-indigo-500/10', boxBorder: 'border-indigo-500', boxText: 'text-indigo-100/90' };
    }
  };

  const getSessionTextColor = () => {
    if (session === 'Pre-Market') return 'text-amber-500';
    if (session === 'Open') return 'text-[#00e676]';
    if (session === 'Post-Market') return 'text-indigo-400';
    return 'text-slate-500';
  };

  const formatBriefing = (text: string) => {
    if (!text) return "";
    return text
      .replace(/(Daily Setups Thesis:)/gi, '\n\n$1')
      .replace(/(Sector Flow:)/gi, '\n\n$1');
  };

  const renderSingleUpdateBlock = (block: UpdateBlock | null) => {
    if (!block) return null;
    const styles = getThemeStyles(block.colorTheme);

    return (
      <div className="bg-[#161c2a]/60 border border-white/5 rounded-xl p-5 md:p-6 mt-3">
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-2 h-2 rounded-full ${styles.bg} border border-current ${styles.text}`}></div>
          <h4 className={`text-[11px] font-bold tracking-widest uppercase ${styles.text}`}>
            {block.phase}
          </h4>
          <span className="text-[9px] text-slate-500 font-medium tracking-wider px-2 py-0.5 bg-black/20 border border-white/5 rounded">
            {block.timestamp}
          </span>
        </div>

        <div className="space-y-3 text-[13px] text-slate-300 leading-relaxed mb-5">
          {block.paragraphs.map((p, idx) => (
            <p key={idx}>{p}</p>
          ))}
        </div>

        <div className={`border-l-[4px] p-4 rounded-r-xl transition-colors duration-300 ${styles.boxBg} ${styles.boxBorder}`}>
          <p className={`text-sm leading-relaxed ${styles.boxText}`}>
            {block.takeaway}
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-[#101623] border border-white/10 rounded-2xl p-6 md:p-8 relative overflow-hidden shadow-2xl w-full">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-500 via-emerald-500 to-indigo-500 opacity-40"></div>
      
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex justify-between items-start md:items-center relative z-10 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-8 border-b border-white/5 pb-4' : ''}`}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs md:text-sm font-bold border px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 transition-colors text-[#7c8bfa] bg-[#161c2a]/40 border-white/5 group-hover:bg-white/[0.02]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
            LIVE SESSION NARRATIVE
          </span>
        </div>

        <div className="flex flex-col items-center gap-1.5 mt-3 md:mt-0">
          <div className="flex items-center justify-center border border-white/5 bg-[#161c2a]/40 px-4 py-1.5 rounded-[10px] min-w-[120px]">
            <span className={`text-[10px] font-bold tracking-widest uppercase ${status === 'Loading' ? 'text-amber-500' : status === 'Error' ? 'text-rose-400' : getSessionTextColor()}`}>
              {status === 'Synced' ? session : status}
            </span>
          </div>
          {lastUpdated && (
             <span className="text-[11px] text-slate-400/80 font-medium px-1 tracking-wide">
               Updated: {formatTime(lastUpdated)} EST
             </span>
          )}
        </div>
      </div>

      {isExpanded && (
        <>
          {/* 1. Live AI Macro Briefing */}
          {macroInsights && (
            <div className="mb-8 bg-[#161c2a]/60 border border-cyan-500/20 rounded-xl p-5 md:p-6 relative overflow-hidden shadow-[0_0_15px_rgba(34,211,238,0.03)]">
              <div className="absolute right-0 top-0 w-64 h-64 bg-cyan-500/10 blur-3xl rounded-full -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>

              <div className="flex items-center gap-3 mb-6 relative z-10">
                <span className="text-[10px] font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-3 py-1 rounded tracking-widest uppercase flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
                  AI MARKET BRIEFING
                </span>
                <span className="text-sm md:text-base font-black text-white tracking-wide">{macroInsights.theme}</span>
              </div>

              <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div>
                  <h3 className="text-[9px] font-bold tracking-widest uppercase text-slate-500 mb-3">Narrative Breakdown</h3>
                  <p className="text-xs text-slate-300 leading-relaxed font-medium whitespace-pre-line">
                    {formatBriefing(macroInsights.briefing)}
                  </p>
                </div>

                <div>
                  <h3 className="text-[9px] font-bold tracking-widest uppercase text-slate-500 mb-3">What To Watch & Why</h3>
                  <ul className="space-y-3">
                    {macroInsights.watching?.map((item, idx) => {
                      const symbol = typeof item === 'string' ? item : item.symbol;
                      const reason = typeof item === 'string' ? 'Momentum continuation and algorithmic confluence.' : item.reason;
                      
                      let parsedScore: number | undefined = undefined;
                      if (typeof item === 'object' && item.score !== undefined && item.score !== null) {
                        const num = Number(item.score.toString().replace(/\D/g, ''));
                        if (!isNaN(num)) parsedScore = num;
                      }

                      return (
                        <li key={idx} className="flex flex-col gap-2 bg-[#161c2a]/60 p-3.5 rounded-xl border border-white/5 hover:border-cyan-500/20 transition-colors">
                          <div className="flex items-center justify-between">
                            {/* STRIPPED font-mono HERE */}
                            <span className="text-[11px] font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20 tracking-wider">
                              {symbol}
                            </span>
                            {parsedScore !== undefined && (
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded border tracking-wide ${
                                parsedScore >= 80 
                                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                                  : parsedScore >= 50 
                                    ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400' 
                                    : 'bg-slate-500/10 border-white/10 text-slate-400'
                              }`}>
                                CNF: {parsedScore}%
                              </span>
                            )}
                          </div>
                          <p className="text-[13px] text-slate-300 font-medium leading-relaxed">
                            {reason}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* 2. Session Narrative Feed (Render sequentially) */}
          <div className="border-t border-white/5 pt-6 mt-4">
            <h3 className="text-[9px] font-bold tracking-widest uppercase text-slate-500 mb-2 px-2">LIVE SESSION UPDATES</h3>
            {status === 'Loading' && !data ? (
              <div className="animate-pulse bg-[#161c2a]/40 border border-white/5 rounded-xl p-5 md:p-6 mt-3">
                <div className="h-3 bg-white/5 rounded w-1/4 mb-4"></div>
                <div className="h-3 bg-white/5 rounded w-full mb-2"></div>
                <div className="h-3 bg-white/5 rounded w-11/12 mb-6"></div>
                <div className="h-12 bg-white/5 border-l-[4px] border-white/10 rounded-r-xl w-full"></div>
              </div>
            ) : (
              <div className="animate-in fade-in duration-500 flex flex-col gap-2">
                {data?.morning && renderSingleUpdateBlock(data.morning)}
                {data?.midday && renderSingleUpdateBlock(data.midday)}
                {data?.closing && renderSingleUpdateBlock(data.closing)}
                
                {!data?.morning && !data?.midday && !data?.closing && (
                  <div className="text-center py-8 text-slate-500 text-sm font-medium border border-dashed border-white/10 rounded-xl mt-3">
                    Awaiting pre-market data ingestion...
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
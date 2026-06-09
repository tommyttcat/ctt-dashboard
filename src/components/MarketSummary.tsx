'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

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
  actionableEvents?: ActionableEvent[]; // <-- NEW CATALYST RADAR ARRAY
}

type MarketSession = 'Pre-Market' | 'Open' | 'Post-Market' | 'Closed';

const getCurrentEstDecimal = () => {
  const estDate = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  return estDate.getHours() + estDate.getMinutes() / 60;
};

const getMarketSession = (): MarketSession => {
  const estDate = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = estDate.getDay();
  const timeStr = estDate.getHours() + estDate.getMinutes() / 60;
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
  const searchParams = useSearchParams();
  
  const todayStr = new Date().toISOString().split('T')[0];
  const selectedDate = searchParams.get('date') || todayStr;
  const isHistorical = selectedDate !== todayStr;

  const [data, setData] = useState<SummaryData | null>(null);
  const [status, setStatus] = useState<'Loading' | 'Synced' | 'Error'>('Loading');
  const [session, setSession] = useState<MarketSession>('Closed');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;
    
    if (!data) setStatus('Loading');

    const fetchDailySummary = async () => {
      try {
        if (isMounted) setSession(getMarketSession());

        const url = `/api/market-summary?date=${selectedDate}`;
        const res = await fetch(url, { cache: 'no-store' });

        if (!res.ok) {
          if (res.status === 404) {
             if (isMounted) {
                setData({ morning: null, midday: null, closing: null, actionableEvents: [] });
                setStatus('Synced');
             }
             return;
          }
          throw new Error(`API returned status: ${res.status}`);
        }

        const payload: SummaryData = await res.json();

        if (!isMounted) return;

        const estTime = getCurrentEstDecimal();
        const gatedData: SummaryData = {
          morning: isHistorical || estTime >= 4.0 ? (payload.morning || null) : null,
          midday: isHistorical || estTime >= 10.0 ? (payload.midday || null) : null,
          closing: isHistorical || estTime >= 15.5 ? (payload.closing || null) : null,
          actionableEvents: payload.actionableEvents || [] 
        };

        setData(gatedData);
        setStatus('Synced');
        setLastUpdated(new Date());
      } catch (error) {
        console.error("Narrative Sync Error:", error);
        if (isMounted && !data) setStatus('Error'); 
      }
    };

    fetchDailySummary();
    const interval = setInterval(fetchDailySummary, 300000); 
    return () => { isMounted = false; clearInterval(interval); };
  }, [selectedDate, isHistorical]); 

  const getThemeStyles = (theme: string, isHistorical: boolean) => {
    if (isHistorical) return {
      border: 'border-amber-500/30', bg: 'bg-amber-500/5', text: 'text-amber-400',
      boxBg: 'bg-amber-500/10', boxBorder: 'border-amber-500', boxText: 'text-amber-100/90'
    };

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

  const renderUpdateBlock = (block: UpdateBlock | null, isLast: boolean) => {
    if (!block) return null;
    const styles = getThemeStyles(block.colorTheme, isHistorical);

    return (
      <div className={`relative pl-6 md:pl-8 pb-8 ${isLast ? '' : 'border-l border-white/10'}`}>
        <div className={`absolute left-[-5px] top-1 w-2.5 h-2.5 rounded-full ${styles.bg} border border-current ${styles.text}`}></div>
        
        <div className="flex items-center gap-3 mb-3">
          <h4 className={`text-[11px] font-bold tracking-widest uppercase ${styles.text}`}>
            {block.phase}
          </h4>
          <span className="text-[9px] text-slate-500 font-mono tracking-wider px-2 py-0.5 bg-[#161c2a] border border-white/5 rounded">
            {block.timestamp}
          </span>
        </div>

        <div className="space-y-3 text-sm text-slate-300 leading-relaxed mb-5">
          {block.paragraphs.map((p, idx) => (
            <p key={idx}>{p}</p>
          ))}
        </div>

        <div className={`border-l-[4px] p-4 rounded-r-xl transition-colors duration-300 ${styles.boxBg} ${styles.boxBorder}`}>
          <p className={`text-sm leading-relaxed ${styles.boxText}`}>
            <strong className={`tracking-wider uppercase text-[10px] mr-2 ${styles.text}`}>
              {block.takeawayLabel}:
            </strong> 
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
          <span className={`text-xs md:text-sm font-bold border px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 transition-colors ${isHistorical ? 'text-amber-400 bg-amber-500/10 border-amber-500/20 group-hover:bg-amber-500/20' : 'text-[#7c8bfa] bg-[#161c2a]/40 border-white/5 group-hover:bg-white/[0.02]'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isHistorical ? 'bg-amber-400' : 'bg-[#7c8bfa]'}`}></span>
            {isHistorical ? `ARCHIVE: ${selectedDate}` : 'SESSION NARRATIVE'}
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
          {/* ACTIONABLE EVENT RADAR */}
          {data?.actionableEvents && data.actionableEvents.length > 0 && (
            <div className="mb-8 bg-rose-500/5 border border-rose-500/20 rounded-xl p-4 animate-in fade-in">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
                <span className="text-[10px] font-bold text-rose-400 tracking-widest uppercase">Actionable Catalysts Today</span>
              </div>
              <div className="flex flex-col gap-2">
                {data.actionableEvents.map((evt, idx) => (
                  <div key={idx} className="flex justify-between items-center bg-[#161c2a] border border-white/5 px-4 py-2.5 rounded-lg">
                    <span className="text-sm font-bold text-slate-200">{evt.event}</span>
                    <span className="text-[11px] font-mono text-rose-300 bg-rose-500/10 border border-rose-500/20 px-2 py-1 rounded">
                      {evt.time} EST
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {status === 'Loading' && !data ? (
            <div className="animate-pulse space-y-6">
              <div className="border-l border-white/10 pl-6 space-y-4">
                <div className="h-3 bg-white/5 rounded w-1/4"></div>
                <div className="h-3 bg-white/5 rounded w-full"></div>
                <div className="h-3 bg-white/5 rounded w-11/12 mb-4"></div>
                <div className="h-12 bg-white/5 border-l-[4px] border-white/10 rounded-r-xl w-full"></div>
              </div>
            </div>
          ) : (
            <div className="animate-in fade-in duration-500 ml-1">
              {renderUpdateBlock(data?.morning || null, !data?.midday && !data?.closing)}
              {renderUpdateBlock(data?.midday || null, !data?.closing)}
              {renderUpdateBlock(data?.closing || null, true)}
              
              {!data?.morning && !data?.midday && !data?.closing && (
                <div className="text-center py-8 text-slate-500 text-sm font-medium border border-dashed border-white/10 rounded-xl">
                  Awaiting pre-market data ingestion...
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
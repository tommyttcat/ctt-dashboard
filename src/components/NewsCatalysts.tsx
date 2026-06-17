'use client';

import React, { useState, useEffect } from 'react';

// --- INTERFACES ---
interface CatalystItem {
  event: string;   // full catalyst text, e.g. "NVDA: Q3 earnings beat, raises guidance"
  time: string;    // "HH:MM AM" (EST appended in render)
  impact: string;  // "High" | "Medium" | "Low"
}

// Impact-based badge tint (mirrors the original Actionable Catalysts panel).
const getImpactBadge = (impact: string) => {
  const u = (impact || '').toLowerCase();
  if (u === 'high') return 'bg-rose-500/10 border-rose-500/20 text-rose-400';
  if (u === 'medium') return 'bg-amber-500/10 border-amber-500/20 text-amber-400';
  return 'bg-slate-500/10 border-white/10 text-slate-400';
};

// Split "SPCX: SpaceX ETF frenzy..." into a bold ticker head ("SPCX:") and the
// rest of the summary, so only the ticker renders bold.
const splitEvent = (event: string): { head: string; rest: string } => {
  const idx = event.indexOf(':');
  if (idx > 0 && idx <= 12) {
    return { head: event.slice(0, idx + 1), rest: event.slice(idx + 1).trim() };
  }
  return { head: '', rest: event };
};

export default function NewsFeed() {
  const [news, setNews] = useState<CatalystItem[]>([]);
  const [status, setStatus] = useState<string>('Offline');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(true);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'America/New_York'
    });
  };

  useEffect(() => {
    let isMounted = true;

    const fetchCatalysts = async () => {
      try {
        if (isMounted && news.length === 0) setStatus('Loading Catalysts...');

        const res = await fetch(`/api/market-summary?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) {
          if (isMounted && news.length === 0) setStatus('Offline');
          return;
        }

        const data = await res.json();
        const events = Array.isArray(data.actionableEvents) ? data.actionableEvents : [];

        const processed: CatalystItem[] = events
          .filter((e: any) => e && typeof e.event === 'string' && e.event.trim().length > 0)
          .map((e: any) => ({
            event: e.event.trim(),
            time: typeof e.time === 'string' ? e.time : '',
            impact: ['High', 'Medium', 'Low'].includes(e.impact) ? e.impact : 'Medium'
          }));

        if (isMounted) {
          setNews(processed);
          setLastUpdated(new Date());
          setStatus('Live');
        }
      } catch {
        if (isMounted && news.length === 0) setStatus('Offline');
      }
    };

    fetchCatalysts();
    const interval = setInterval(fetchCatalysts, 60000);
    return () => { isMounted = false; clearInterval(interval); };
  }, []);

  const getSessionTextColor = () => {
    const estDate = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const day = estDate.getDay();
    const hour = estDate.getHours();
    const min = estDate.getMinutes();
    const timeStr = hour + min / 60;

    if (day === 0 || day === 6) return 'text-slate-500';
    if (timeStr >= 4 && timeStr < 9.5) return 'text-amber-500';
    if (timeStr >= 9.5 && timeStr < 16) return 'text-[#00e676]';
    if (timeStr >= 16 && timeStr < 20) return 'text-indigo-400';
    return 'text-slate-500';
  };

  const displaySession = () => {
    const estDate = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const day = estDate.getDay();
    if (day === 0 || day === 6) return 'Closed';

    const hour = estDate.getHours();
    const min = estDate.getMinutes();
    const timeStr = hour + min / 60;

    if (timeStr >= 4 && timeStr < 9.5) return 'Pre-Market';
    if (timeStr >= 9.5 && timeStr < 16) return 'Open';
    if (timeStr >= 16 && timeStr < 20) return 'Post-Market';
    return 'Closed';
  };

  const isLoading = status.includes('Loading');

  return (
    <div className="bg-[#101623] border border-white/5 rounded-2xl p-6 md:p-8 relative overflow-hidden shadow-xl w-full">

      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex justify-between items-center relative z-10 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-6 border-b border-white/5 pb-4' : ''}`}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs md:text-sm font-bold text-rose-400 bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 group-hover:bg-white/[0.02] transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>
            ACTIONABLE CATALYSTS
          </span>
        </div>

        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-center justify-center border border-white/5 bg-[#161c2a]/40 px-4 py-1.5 rounded-[10px] min-w-[120px]">
            <span className={`text-[10px] font-bold tracking-widest uppercase ${status === 'Live' ? getSessionTextColor() : 'text-slate-500'}`}>
              {status === 'Live' ? displaySession() : status}
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
        <div className="relative z-10 custom-scrollbar max-h-[600px] overflow-y-auto pr-1" style={{ scrollbarWidth: 'none' }}>
          {isLoading && news.length === 0 ? (
            <div className="py-12 text-center">
              <div className="w-5 h-5 border-2 border-indigo-500/20 border-t-indigo-400 rounded-full animate-spin mx-auto mb-3"></div>
              <span className="text-xs text-slate-500 font-medium">Synthesizing market-moving catalysts...</span>
            </div>
          ) : news.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-sm font-medium">
              No market-moving catalysts detected yet today.
            </div>
          ) : (
            <div className="bg-rose-500/5 border border-rose-500/20 rounded-xl p-3 flex flex-col gap-2 animate-in fade-in">
              {news.map((item, i) => (
                <div key={i} className="flex justify-between items-center gap-3 bg-[#161c2a] border border-white/5 px-4 py-2.5 rounded-lg hover:border-rose-500/20 transition-colors">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {(() => {
                      const { head, rest } = splitEvent(item.event);
                      const ticker = head.replace(/:$/, '');
                      return ticker ? (
                        <>
                          <span className="inline-block shrink-0 w-[72px] text-center truncate bg-indigo-500/10 text-[#7c8bfa] text-[11px] font-bold px-2 py-0.5 rounded border border-indigo-500/20" title={ticker}>{ticker}</span>
                          <span className="font-medium text-slate-200 text-sm leading-snug min-w-0">{rest}</span>
                        </>
                      ) : (
                        <span className="font-medium text-slate-200 text-sm leading-snug min-w-0">{rest}</span>
                      );
                    })()}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded border ${getImpactBadge(item.impact)}`}>
                      {item.impact}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
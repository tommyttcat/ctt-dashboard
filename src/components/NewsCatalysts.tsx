'use client';

import React, { useState, useEffect } from 'react';

// --- INTERFACES ---
interface CatalystItem {
  ticker: string;      // parsed prefix, e.g. "NVDA", "MKT", "GSK/SPERO"
  headline: string;    // catalyst text after the ticker prefix
  time: string;        // "HH:MM AM" (EST appended in render)
  impact: string;      // "High" | "Medium" | "Low"
}

// Impact-based badge tint (mirrors the Actionable Catalysts panel).
const getImpactBadge = (impact: string) => {
  const u = (impact || '').toLowerCase();
  if (u === 'high') return 'text-rose-400 bg-rose-500/10 border-rose-500/20';
  if (u === 'medium') return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
  return 'text-slate-400 bg-slate-500/10 border-white/10';
};

// Split "NVDA: Q3 earnings beat..." -> { ticker: "NVDA", headline: "Q3 earnings beat..." }.
// Only treats a leading short token before the first colon as a ticker prefix so
// a colon deep in the sentence is never mistaken for a delimiter.
const parseEvent = (raw: string): { ticker: string; headline: string } => {
  const text = raw.trim();
  const idx = text.indexOf(':');
  if (idx > 0 && idx <= 12) {
    return { ticker: text.slice(0, idx).trim(), headline: text.slice(idx + 1).trim() };
  }
  return { ticker: '', headline: text };
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
          .map((e: any) => {
            const { ticker, headline } = parseEvent(e.event);
            return {
              ticker,
              headline,
              time: typeof e.time === 'string' ? e.time : '',
              impact: ['High', 'Medium', 'Low'].includes(e.impact) ? e.impact : 'Medium'
            };
          });

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
        <div className="relative z-10 custom-scrollbar max-h-[600px] overflow-y-auto pr-2 divide-y divide-white/5" style={{ scrollbarWidth: 'none' }}>
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
            news.map((item, i) => (
              <div key={i} className="py-4 flex flex-col xl:flex-row xl:items-center justify-between gap-4 hover:bg-white/[0.01] px-2 rounded-xl transition-colors group">

                <div className="flex items-center gap-3 shrink-0 flex-wrap sm:flex-nowrap">
                  {item.ticker && (
                    <span className="inline-block bg-indigo-500/10 text-[#7c8bfa] text-[11px] font-bold px-2 py-0.5 rounded border border-indigo-500/20 w-16 text-center truncate" title={item.ticker}>
                      {item.ticker}
                    </span>
                  )}
                  {item.time && (
                    <span className="text-[11px] text-slate-500 font-medium whitespace-nowrap w-[70px] text-right">
                      {item.time} EST
                    </span>
                  )}
                </div>

                <div className="min-w-0 flex-1 xl:pl-4">
                  <span className="text-xs font-medium text-slate-300 leading-snug block">
                    {item.headline}
                  </span>
                </div>

                <div className="shrink-0 flex items-center xl:justify-end">
                  <span className={`text-[10px] font-bold tracking-widest px-1.5 py-0.5 rounded border uppercase ${getImpactBadge(item.impact)}`}>
                    {item.impact}
                  </span>
                </div>

              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
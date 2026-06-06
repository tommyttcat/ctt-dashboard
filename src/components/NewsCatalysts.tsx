'use client';

import React, { useState, useEffect } from 'react';

// --- INTERFACES ---
interface NewsItem {
  id: string;
  ticker: string;
  companyName: string;
  title: string;
  source: string;
  url: string;
  timeStr: string;
  publishedUtc: Date;
  tag: { label: string; color: string };
}

// --- HELPERS ---
const getCatalystTag = (site: string | undefined, title: string | undefined) => {
  const sStr = (site || '').toLowerCase();
  const tStr = (title || '').toLowerCase();
  const hasInsider = tStr.includes('form 4') || tStr.includes('insider');

  if (hasInsider) {
    return { label: 'INSIDER BUY', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' };
  }
  if (sStr.includes('analyst') || /upgrade|downgrade|price target/i.test(tStr)) {
    return { label: 'ANALYST', color: 'text-purple-400 bg-purple-500/10 border-purple-500/20' };
  }
  if (sStr.includes('earnings') || /earn|q[1-4]|revenue|eps/i.test(tStr)) {
    return { label: 'EARNINGS', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' };
  }
  if (sStr.includes('fda') || sStr.includes('biotech') || /fda|clinical|trial/i.test(tStr)) {
    return { label: 'BIOTECH', color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20' };
  }
  if (sStr.includes('m&a') || sStr.includes('merger') || /buyout|takeover/i.test(tStr)) {
    return { label: 'M&A', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' };
  }
  
  if (site) {
    const formattedSite = site.substring(0, 10).toUpperCase();
    return { label: formattedSite, color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' };
  }

  return { label: 'NEWS', color: 'text-slate-400 bg-slate-500/10 border-slate-500/20' };
};

export default function NewsFeed() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [status, setStatus] = useState<string>('Offline');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  
  // --- COLLAPSE STATE ---
  const [isExpanded, setIsExpanded] = useState<boolean>(true);

  const polygonApiKey = process.env.NEXT_PUBLIC_POLYGON_API_KEY || '';

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
    if (!polygonApiKey) { setStatus('Offline'); return; }

    const fetchNewsFeed = async () => {
      try {
        if (isMounted) setStatus('Scouting...');

        // Fetch streaming financial news from the unified market data router
        const res = await fetch(`https://api.massive.com/v2/reference/news?limit=25&apiKey=${polygonApiKey}`);
        if (!res.ok) throw new Error('Network error');
        
        const data = await res.json();
        const results = data.results || [];

        if (results.length === 0) {
          if (isMounted) setStatus('No Valid Data Found');
          return;
        }

        const processedNews: NewsItem[] = results
          .filter((item: any) => item.tickers && item.tickers.length > 0)
          .slice(0, 15)
          .map((item: any) => {
            const pubDate = new Date(item.published_utc);
            const isToday = pubDate.toDateString() === new Date().toDateString();
            const timePart = pubDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
            const displayTime = isToday ? timePart : `${pubDate.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })} ${timePart}`;

            const publisherName = item.publisher?.name || 'MASSIVE';
            const dynamicTag = getCatalystTag(publisherName, item.title);

            return {
              id: item.id,
              ticker: item.tickers[0],
              companyName: item.ticker_details?.find((d: any) => d.ticker === item.tickers[0])?.name || item.tickers[0],
              title: item.title,
              source: publisherName,
              url: item.article_url || '#',
              timeStr: displayTime,
              publishedUtc: pubDate,
              tag: dynamicTag
            };
          });

        if (isMounted) {
          setNews(processedNews);
          setLastUpdated(new Date());
          setStatus('Live');
        }
      } catch (error) {
        if (isMounted) setStatus('Offline');
      }
    };

    fetchNewsFeed();
    const interval = setInterval(fetchNewsFeed, 30000); // 30-second interval cycle
    return () => { isMounted = false; clearInterval(interval); };
  }, [polygonApiKey]);

  const getSessionTextColor = () => {
    const estDate = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const day = estDate.getDay();
    const hour = estDate.getHours();
    const min = estDate.getMinutes();
    const timeStr = hour + min / 60;

    if (day === 0 || day === 6) return 'text-slate-500'; // Weekend Force
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

  const isLoading = status === 'Scouting' && news.length === 0;

  return (
    <div className="bg-[#101623] border border-white/5 rounded-2xl p-6 md:p-8 relative overflow-hidden shadow-xl w-full">
      
      {/* HEADER CONTAINER - CLICKABLE */}
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex justify-between items-center relative z-10 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-6 border-b border-white/5 pb-4' : ''}`}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs md:text-sm font-bold text-[#7c8bfa] bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 group-hover:bg-white/[0.02] transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
            NEWS FEED
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

      {/* COLLAPSIBLE CONTENT */}
      {isExpanded && (
        <div className="relative z-10 custom-scrollbar max-h-[600px] overflow-y-auto pr-2 divide-y divide-white/5" style={{ scrollbarWidth: 'none' }}>
          {isLoading ? (
            <div className="py-12 text-center">
              <div className="w-5 h-5 border-2 border-indigo-500/20 border-t-indigo-400 rounded-full animate-spin mx-auto mb-3"></div>
              <span className="text-xs text-slate-500 font-medium">Connecting Catalyst Stream...</span>
            </div>
          ) : news.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-sm font-medium">
              No recent catalysts populated on current feed session.
            </div>
          ) : (
            news.map((item) => (
              <div key={item.id} className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-white/[0.01] px-2 rounded-xl transition-colors group">
                
                {/* LEFT: TIME + TICKER */}
                <div className="flex items-start gap-3 shrink-0">
                  <span className="text-xs text-slate-500 font-medium whitespace-nowrap pt-1 w-16 text-right">
                    {item.timeStr}
                  </span>

                  {/* STANDARDIZED TICKER CELL WITH NAME HOVER */}
                  <div className="relative inline-flex items-center group/ticker pt-0.5">
                    <span className="inline-block bg-indigo-500/10 text-[#7c8bfa] text-[11px] font-bold px-2 py-0.5 rounded border border-indigo-500/20 cursor-help">
                      {item.ticker}
                    </span>
                    {/* POP-OUT TOOLTIP BOX */}
                    <div className="absolute left-full ml-3 px-3 py-1.5 bg-[#1e293b] border border-white/10 text-slate-200 text-xs font-semibold tracking-wide rounded-md shadow-2xl opacity-0 invisible group-hover/ticker:opacity-100 group-hover/ticker:visible transition-all z-[60] whitespace-nowrap pointer-events-none">
                      {item.companyName || item.ticker}
                    </div>
                  </div>
                </div>

                {/* MIDDLE: INTERACTIVE CLICK-THROUGH NEWS HEADLINE WITH ADDED GAP */}
                <div className="min-w-0 flex-1 pl-2 md:pl-4">
                  <a 
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-semibold text-slate-200 leading-snug group-hover:text-[#7c8bfa] transition-colors underline-offset-4 hover:underline block"
                  >
                    {item.title}
                  </a>
                </div>

                {/* RIGHT: DYNAMIC SIPs STYLE CATEGORY BADGE */}
                <div className="shrink-0 flex items-center md:justify-end">
                  <span className={`text-[10px] font-bold tracking-widest px-1.5 py-0.5 rounded border uppercase ${item.tag.color}`}>
                    {item.tag.label}
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
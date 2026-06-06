'use client';

import React, { useState, useEffect, useMemo } from 'react';

// --- INTERFACES ---
interface EarningEvent {
  ticker: string;
  name: string;
  date: string;
  rawDate: string; 
  time: 'BMO' | 'AMC' | 'TBD';
  epsEst: number | null;
  epsAct: number | null;
  revEst: number | null;
  revAct: number | null;
  parsedDate: Date;
}

type SortDirection = 'asc' | 'desc';
type MarketSession = 'Pre-Market' | 'Open' | 'Post-Market' | 'Closed';

// --- HELPERS ---
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

const formatCurrency = (num: number | null | undefined) => {
  if (typeof num !== 'number' || isNaN(num)) return '-';
  if (num >= 1e9) return '$' + (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return '$' + (num / 1e6).toFixed(1) + 'M';
  return '$' + num.toLocaleString();
};

const fetchSafeJson = async (url: string, fallback: any, timeoutMs = 15000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    if (!res.ok) return fallback;
    return await res.json();
  } catch (error) {
    clearTimeout(id);
    return fallback;
  }
};

export default function EarningsCalendar() {
  const [earnings, setEarnings] = useState<EarningEvent[]>([]);
  const [status, setStatus] = useState<string>('Offline');
  const [session, setSession] = useState<MarketSession>('Closed');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: keyof EarningEvent; direction: SortDirection } | null>(null);

  // --- COLLAPSE STATE ---
  const [isExpanded, setIsExpanded] = useState<boolean>(true);

  const fmpApiKey = process.env.NEXT_PUBLIC_FMP_API_KEY || '';

  useEffect(() => {
    let isMounted = true;
    if (!fmpApiKey) { setStatus('Offline'); return; }

    const fetchEarningsData = async () => {
      try {
        const currentSession = getMarketSession();
        if (isMounted) setSession(currentSession);
        setStatus(`Scouting...`);

        const today = new Date();
        const estToday = new Date(today.toLocaleString("en-US", { timeZone: "America/New_York" }));
        const todayStr = estToday.toISOString().split('T')[0];
        
        // PULL BACK 3 DAYS to capture Friday's earnings on the weekend
        const pastDate = new Date(estToday);
        pastDate.setDate(estToday.getDate() - 3);

        const futureDate = new Date(estToday);
        futureDate.setDate(estToday.getDate() + 14); 
        
        const fromStr = pastDate.toISOString().split('T')[0];
        const toStr = futureDate.toISOString().split('T')[0];

        const targetUrl = `https://financialmodelingprep.com/stable/earnings-calendar?from=${fromStr}&to=${toStr}&apikey=${fmpApiKey}`;
        const rawEarnings = await fetchSafeJson(targetUrl, []);

        if (!Array.isArray(rawEarnings) || rawEarnings.length === 0) {
          if (isMounted) setStatus('No Valid Data Found');
          return;
        }

        // --- STRICT CLIENT-SIDE FILTERS ---
        const validUpcomingEarnings = rawEarnings.filter((e: any) => {
          if (!e.date || !e.symbol) return false;
          
          const eventDateStr = e.date.split(' ')[0]; 
          const isWithinWindow = eventDateStr >= fromStr && eventDateStr <= toStr;
          
          // Exclude foreign exchanges, numbered tickers, and OTCs (anything over 4 characters)
          const isStandardUS = !e.symbol.includes('.') && !/\d/.test(e.symbol) && e.symbol.length <= 4;
          
          // Small Cap Floor Proxy: Drop anything with less than $20M est. quarterly revenue
          const isSmallCapOrLarger = e.revenueEstimated !== null && e.revenueEstimated >= 20000000;

          // If the date is deeply in the past, verify it has actuals (otherwise it's dead data)
          const isPast = eventDateStr < todayStr;
          const hasActualsIfPast = !isPast || (e.eps !== null || e.revenue !== null);

          return isWithinWindow && isStandardUS && isSmallCapOrLarger && hasActualsIfPast;
        });

        if (validUpcomingEarnings.length === 0) {
          if (isMounted) setStatus('No Valid Data Found');
          return;
        }

        // 1. Sort initially by revenue estimate to isolate the top companies
        const sortedByRev = validUpcomingEarnings.sort((a: any, b: any) => {
          return (b.revenueEstimated || 0) - (a.revenueEstimated || 0);
        });

        // Slice top 20, then re-sort them chronologically for the display
        const chronologicalTop20 = sortedByRev.slice(0, 20).sort((a: any, b: any) => {
            const dateA = new Date(a.date).getTime();
            const dateB = new Date(b.date).getTime();
            return dateA - dateB;
        });

        // 2. Map payload initially
        const processedEvents: EarningEvent[] = chronologicalTop20.map((e: any) => {
            const parsedDate = new Date(e.date);
            const formattedDate = parsedDate.toLocaleDateString('en-US', { 
              weekday: 'short', 
              month: 'short', 
              day: 'numeric',
              timeZone: 'America/New_York'
            });
            
            const rawDateStr = e.date.split(' ')[0]; 
            
            let timeCode: 'BMO' | 'AMC' | 'TBD' = 'TBD';
            if (e.time === 'bmo') timeCode = 'BMO';
            if (e.time === 'amc') timeCode = 'AMC';

            return {
              ticker: e.symbol || 'N/A',
              name: '', // Will be populated in the enrichment phase
              date: formattedDate,
              rawDate: rawDateStr, 
              time: timeCode,
              epsEst: e.epsEstimated,
              epsAct: e.eps,
              revEst: e.revenueEstimated,
              revAct: e.revenue,
              parsedDate: parsedDate
            };
          });

        if (isMounted) setStatus('Enriching...');

        // 3. Robust Enrichment 
        if (processedEvents.length > 0) {
           // A. Fetch ALL Company Names in one clean batch to avoid rate limits
           const allTickers = processedEvents.map(e => e.ticker).join(',');
           const quoteUrl = `https://financialmodelingprep.com/api/v3/quote/${allTickers}?apikey=${fmpApiKey}`;
           const quotesData = await fetchSafeJson(quoteUrl, []);
           
           if (Array.isArray(quotesData)) {
               processedEvents.forEach(event => {
                   const match = quotesData.find((q: any) => q.symbol === event.ticker);
                   if (match && match.name) {
                       event.name = match.name; 
                   }
               });
           }

           // B. Fetch Missing Historical Actuals for any event today or in the past
           for (const event of processedEvents) {
               const isPastOrToday = event.rawDate <= todayStr;
               
               if (isPastOrToday && (event.epsAct === null || event.revAct === null)) {
                   const histUrl = `https://financialmodelingprep.com/api/v3/historical/earning_calendar/${event.ticker}?limit=3&apikey=${fmpApiKey}`;
                   const histData = await fetchSafeJson(histUrl, []);
                   
                   if (Array.isArray(histData) && histData.length > 0) {
                       // Looser match: Ensure it's the exact same Year and Month to prevent strict day-shift misses
                       const eventMonth = event.rawDate.substring(0, 7); 
                       const matchingReport = histData.find((h: any) => h.date && h.date.startsWith(eventMonth));
                       
                       if (matchingReport) {
                           event.epsAct = matchingReport.eps !== null ? matchingReport.eps : event.epsAct;
                           event.revAct = matchingReport.revenue !== null ? matchingReport.revenue : event.revAct;
                       }
                   }
               }
           }
        }

        if (isMounted) {
          setEarnings(processedEvents);
          setLastUpdated(new Date());
          setStatus('Live'); 
        }
      } catch (error: any) {
        if (isMounted) setStatus('Offline');
      }
    };

    fetchEarningsData();
    const interval = setInterval(fetchEarningsData, 300000); 
    return () => { isMounted = false; clearInterval(interval); };
  }, [fmpApiKey]);

  const handleSort = (key: keyof EarningEvent) => {
    let direction: SortDirection = 'desc'; 
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') direction = 'asc';
    else if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') { setSortConfig(null); return; }
    setSortConfig({ key, direction });
  };

  const sortedEarnings = useMemo(() => {
    const list = [...earnings];
    if (!sortConfig) {
      return list; // Defaults to chronological
    }
    return list.sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [earnings, sortConfig]);

  const isLoading = status.includes('Scouting') || status.includes('Enriching') || status.includes('Connecting');
  const getSortIcon = (columnKey: keyof EarningEvent) => sortConfig?.key === columnKey ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓') : '';

  const getSessionTextColor = () => {
    if (session === 'Pre-Market') return 'text-amber-500';
    if (session === 'Open') return 'text-[#00e676]';
    if (session === 'Post-Market') return 'text-indigo-400';
    return 'text-slate-500';
  };

  return (
    <div className="bg-[#101623] border border-white/5 rounded-2xl p-5 md:p-8 relative overflow-hidden shadow-xl w-full">
      {/* Background aesthetic glow */}
      <div className="absolute left-0 top-0 w-64 h-64 bg-indigo-500/5 blur-3xl rounded-full -translate-y-1/2 -translate-x-1/3 pointer-events-none"></div>

      {/* HEADER CONTAINER - CLICKABLE */}
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex justify-between items-center relative z-10 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-6 border-b border-white/5 pb-4' : ''}`}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs md:text-sm font-bold text-[#7c8bfa] bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 group-hover:bg-white/[0.02] transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
            TOP EARNINGS
          </span>
        </div>

        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-center justify-center border border-white/5 bg-[#161c2a]/40 px-4 py-1.5 rounded-[10px] min-w-[120px]">
            <span className={`text-[10px] font-bold tracking-widest uppercase ${status === 'Live' ? getSessionTextColor() : 'text-slate-500'}`}>
              {status === 'Live' ? session : status}
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
        <div className="overflow-x-auto custom-scrollbar relative z-10 mt-6" style={{ scrollbarWidth: 'none' }}>
          <table className="w-full min-w-[900px] border-collapse">
            <thead>
              <tr className="border-b border-white/5 select-none">
                <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[12%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('ticker')}>
                  TICKER{getSortIcon('ticker')}
                </th>
                <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[18%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('parsedDate')}>
                  REPORT DATE{getSortIcon('parsedDate')}
                </th>
                <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[10%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('time')}>
                  TIME{getSortIcon('time')}
                </th>
                <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[15%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('epsEst')}>
                  EPS EST{getSortIcon('epsEst')}
                </th>
                <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[15%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('epsAct')}>
                  EPS ACTUAL{getSortIcon('epsAct')}
                </th>
                <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[15%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('revEst')}>
                  REV EST{getSortIcon('revEst')}
                </th>
                <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[15%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('revAct')}>
                  REV ACTUAL{getSortIcon('revAct')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {isLoading && earnings.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center">
                    <div className="w-5 h-5 border-2 border-indigo-500/20 border-t-indigo-400 rounded-full animate-spin mx-auto mb-3"></div>
                    <span className="text-xs text-slate-500 font-medium">Fetching Upcoming Earnings...</span>
                  </td>
                </tr>
              ) : sortedEarnings.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500 text-sm font-medium">
                    No major earnings data found in the current window.
                  </td>
                </tr>
              ) : (
                sortedEarnings.map((row, i) => {
                  const now = new Date();
                  
                  // Keep opacity 100% for today, yesterday, and future. Only dim older events.
                  const isPastAndNotYesterday = row.parsedDate < now && 
                                                row.parsedDate.getDate() !== now.getDate() &&
                                                (now.getTime() - row.parsedDate.getTime()) > (24 * 60 * 60 * 1000 * 2);
                  const opacityClass = isPastAndNotYesterday ? 'opacity-40' : 'opacity-100';

                  // --- BEAT / MISS LOGIC ---
                  let epsColor = 'text-slate-300';
                  if (row.epsAct !== null && row.epsEst !== null) {
                      if (row.epsAct > row.epsEst) epsColor = 'text-emerald-400';
                      if (row.epsAct < row.epsEst) epsColor = 'text-rose-400';
                  }

                  let revColor = 'text-slate-300';
                  if (row.revAct !== null && row.revEst !== null) {
                      if (row.revAct > row.revEst) revColor = 'text-emerald-400';
                      if (row.revAct < row.revEst) revColor = 'text-rose-400';
                  }

                  return (
                    <tr key={i} className={`hover:bg-white/[0.02] transition-colors group ${opacityClass}`}>
                      
                      {/* TICKER CELL WITH CUSTOM COMPANY NAME TOOLTIP */}
                      <td className="py-3.5 relative" style={{ textAlign: 'left', paddingLeft: '12px' }}>
                        <div className="relative inline-flex items-center group/ticker">
                          <span className="inline-block bg-indigo-500/10 text-[#7c8bfa] text-[11px] font-bold px-2 py-0.5 rounded border border-indigo-500/20 cursor-help">
                            {row.ticker}
                          </span>
                          {/* POP-OUT TOOLTIP */}
                          <div className="absolute left-full ml-3 px-3 py-1.5 bg-[#1e293b] border border-white/10 text-slate-200 text-xs font-semibold tracking-wide rounded-md shadow-2xl opacity-0 invisible group-hover/ticker:opacity-100 group-hover/ticker:visible transition-all z-[60] whitespace-nowrap pointer-events-none">
                            {row.name || row.ticker}
                          </div>
                        </div>
                      </td>
                      
                      <td className="py-3.5 text-xs text-slate-300 font-medium whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '12px' }}>
                        {row.date}
                      </td>
                      
                      <td className="py-3.5" style={{ textAlign: 'left', paddingLeft: '12px' }}>
                        <span className={`text-[10px] font-bold tracking-widest px-1.5 py-0.5 rounded border inline-block ${row.time === 'BMO' ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' : row.time === 'AMC' ? 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20' : 'text-slate-400 bg-slate-500/10 border-slate-500/20'}`}>
                          {row.time}
                        </span>
                      </td>

                      <td className="py-3.5 text-xs text-slate-500 font-medium whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '12px' }}>
                        {typeof row.epsEst === 'number' ? `$${row.epsEst.toFixed(2)}` : '-'}
                      </td>

                      <td className={`py-3.5 text-xs font-bold whitespace-nowrap ${epsColor}`} style={{ textAlign: 'left', paddingLeft: '12px' }}>
                        {typeof row.epsAct === 'number' ? `$${row.epsAct.toFixed(2)}` : '-'}
                      </td>

                      <td className="py-3.5 text-xs text-slate-500 font-medium whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '12px' }}>
                        {typeof row.revEst === 'number' ? formatCurrency(row.revEst) : '-'}
                      </td>
                      
                      <td className={`py-3.5 text-xs font-bold whitespace-nowrap ${revColor}`} style={{ textAlign: 'left', paddingLeft: '12px' }}>
                        {typeof row.revAct === 'number' ? formatCurrency(row.revAct) : '-'}
                      </td>
                      
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
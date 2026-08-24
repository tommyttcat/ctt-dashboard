'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { getMarketSession } from '@/lib/indicators/marketScorecard';

// ---------------------------------------------------------------------------
// Economic Calendar — v1.2
//
// v1.1 FIXES:
//   (a) TIMEZONE. The old formatEventDate did `new Date("2026-07-29T14:00:00")`
//       which JS parses in the BROWSER's timezone, then rendered it with
//       timeZone:'America/New_York' — double-converting. From Arizona (UTC-7)
//       a 2:00 PM ET release displayed as 5:00 PM ET.
//   (b) Day label and time label now agree near midnight.
//   (c) Stable row ids so re-sorting does not remount rows.
//   (d) An empty response no longer leaves stale events on screen.
//
// v1.2: Low-impact events dropped entirely. The feed carries CFTC positioning,
//       Baker Hughes rig counts, and similar — data points, not decisions, and
//       none of them move a session. Filtered at ingest so they never reach
//       state, which also means the tab counts reflect what is actually
//       tradeable.
// ---------------------------------------------------------------------------

// --- INTERFACES ---
interface EconEvent {
  id: string;
  event: string;
  date: string; 
  country: string;
  currency: string;
  actual: number | null;
  previous: number | null;
  estimate: number | null;
  impact: 'High' | 'Medium' | 'Low' | string;
  rawDateString: string; 
}

type TabType = 'High' | 'Medium';
type MarketSession = 'Pre-Market' | 'Open' | 'Post-Market' | 'Closed';
type SortDirection = 'asc' | 'desc';

// --- HELPERS ---

// Enforce EST timezone globally for the UI timestamp
const formatTime = (date: Date) => {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'America/New_York' });
};

// Formats JS Date to strict YYYY-MM-DD for the API
const getIsoDateString = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The feed sends ET wall-clock strings ("2026-07-29 14:00:00") with no zone
// marker. They are ALREADY Eastern — there is nothing to convert. Parsing
// through Date() would apply the viewer's local zone and shift every time by
// their UTC offset, so pull the components out with a regex instead.
//
// Date.UTC is used purely to derive the weekday from the calendar date; no
// timezone conversion happens because we only read UTC fields back out.
const formatEventDate = (dateStr: string): string => {
  const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return dateStr || '-';

  const year = parseInt(m[1], 10);
  const monthIdx = parseInt(m[2], 10) - 1;
  const dayNum = parseInt(m[3], 10);

  const weekday = WEEKDAY_NAMES[new Date(Date.UTC(year, monthIdx, dayNum)).getUTCDay()];
  const dayLabel = `${weekday}, ${MONTH_NAMES[monthIdx]} ${dayNum}`;

  if (m[4] == null) return dayLabel;

  const h24 = parseInt(m[4], 10);
  const mm = m[5];
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;

  return `${dayLabel} • ${h12}:${mm} ${ampm}`;
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

export default function EconomicCalendar() {
  const searchParams = useSearchParams();
  
  // 1. Core Date Management (Anchored to EST)
  const estNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const todayStr = getIsoDateString(estNow);
  const selectedDate = searchParams.get('date') || todayStr;
  const isHistorical = selectedDate !== todayStr;

  const [activeTab, setActiveTab] = useState<TabType>('High'); 
  const [events, setEvents] = useState<EconEvent[]>([]);
  const [status, setStatus] = useState<string>('Offline');
  const [session, setSession] = useState<MarketSession>('Closed');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: keyof EconEvent; direction: SortDirection } | null>(null);

  // --- COLLAPSE STATE ---
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;

    const fetchEconData = async () => {
      try {
        const currentSession = getMarketSession();
        if (isMounted) setSession(currentSession);
        setStatus(`Scouting...`);

        // Smart Rolling Window Calculation
        const [y, m, d] = selectedDate.split('-').map(Number);
        const baseDate = new Date(y, m - 1, d);
        
        // Always anchor the 'from' date to the most recent Friday (or yesterday if mid-week)
        const fromDate = new Date(baseDate);
        const dayOfWeek = fromDate.getDay(); 
        if (dayOfWeek === 0) fromDate.setDate(baseDate.getDate() - 2); // Sunday goes back to Friday
        else if (dayOfWeek === 6) fromDate.setDate(baseDate.getDate() - 1); // Saturday goes back to Friday
        else if (dayOfWeek === 1) fromDate.setDate(baseDate.getDate() - 3); // Monday goes back to Friday
        else fromDate.setDate(baseDate.getDate() - 1); // Tue-Fri go back 1 day

        const fromStr = getIsoDateString(fromDate);

        // Look forward 10 days to guarantee we capture the entire upcoming week
        const toDate = new Date(fromDate);
        toDate.setDate(fromDate.getDate() + 10); 
        const toStrCutoff = getIsoDateString(toDate);

        const targetUrl = `/api/econ?from=${fromStr}&to=${toStrCutoff}`;
        const rawEvents = await fetchSafeJson(targetUrl, []);

        if (!Array.isArray(rawEvents)) {
          if (isMounted) setStatus('API Key / Tier Error');
          return;
        }

        if (rawEvents.length === 0) {
          // Clear the table too — leaving stale rows next to a "no data"
          // status is worse than showing nothing.
          if (isMounted) {
            setEvents([]);
            setStatus('No Valid Data Found');
          }
          return;
        }

        // Process, map, and strictly filter the payload to our date window
        const processedEvents: EconEvent[] = rawEvents
          .filter((e: any) => {
            const countryStr = (e.country || '').toUpperCase();
            const currencyStr = (e.currency || '').toUpperCase();
            const isUS = countryStr.includes('US') || countryStr === 'UNITED STATES' || currencyStr === 'USD';
            
            const eventDateStr = e.date ? e.date.substring(0, 10) : '';
            const isWithinWindow = eventDateStr >= fromStr && eventDateStr <= toStrCutoff;

            // v1.2: Low impact never enters state. CFTC positioning, rig
            // counts, and the like are reference data, not session events.
            const impact = e.impact || 'Low';
            const isTradeable = impact === 'High' || impact === 'Medium';

            return isUS && isWithinWindow && isTradeable;
          })
          .map((e: any) => ({
            // Keyed on the event's own identity, not array position, so
            // re-sorting does not remount every row.
            id: `${e.date}|${e.event}`,
            event: e.event,
            date: e.date,
            country: e.country || '',
            currency: e.currency || '',
            actual: e.actual,
            previous: e.previous,
            estimate: e.estimate,
            impact: e.impact || 'Low',
            rawDateString: e.date || '' 
          }));

        if (isMounted) {
          setEvents(processedEvents);
          setLastUpdated(new Date());
          setStatus('Live'); 
        }
      } catch (error: any) {
        if (isMounted) setStatus('Offline');
      }
    };

    fetchEconData();
    const interval = setInterval(fetchEconData, 1800000); // 30 minute refresh
    return () => { isMounted = false; clearInterval(interval); };
  }, [selectedDate]);

  const handleSort = (key: keyof EconEvent) => {
    let direction: SortDirection = 'desc'; 
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') direction = 'asc';
    else if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') { setSortConfig(null); return; }
    setSortConfig({ key, direction });
  };

  // 1. Filter based on active tab
  const filteredEvents = useMemo(() => {
    return events.filter(e => e.impact === activeTab);
  }, [events, activeTab]);

  // Per-tab counts for the tab buttons — an empty High tab should look empty
  // before you click it, not after.
  const tabCounts = useMemo(() => {
    return {
      High: events.filter(e => e.impact === 'High').length,
      Medium: events.filter(e => e.impact === 'Medium').length,
    };
  }, [events]);

  // 2. Sort the filtered data
  const sortedEvents = useMemo(() => {
    const list = [...filteredEvents];
    if (!sortConfig) {
      // Default sort by raw string (chronological ISO sorting is 100% accurate)
      return list.sort((a, b) => a.rawDateString.localeCompare(b.rawDateString));
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
  }, [filteredEvents, sortConfig]);

  const isLoading = status.includes('Scouting') || status.includes('Connecting');
  const getSortIcon = (columnKey: keyof EconEvent) => sortConfig?.key === columnKey ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓') : '';

  const getImpactBadgeColors = (impact: string) => {
    if (impact === 'High') return 'text-rose-400 bg-rose-500/10 border-rose-500/20';
    if (impact === 'Medium') return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
    return 'text-slate-400 bg-slate-500/10 border-slate-500/20';
  };
  
  // Unified logic matching the rest of the dashboard
  const getSessionTextColor = () => {
    if (status.includes('Err') || status.includes('Offline')) return 'text-rose-500';
    if (status.includes('Scouting') || status.includes('Connecting')) return 'text-amber-500';
    if (isHistorical) return 'text-amber-500/70';
    if (session === 'Pre-Market') return 'text-amber-500';
    if (session === 'Open') return 'text-[#00e676]';
    if (session === 'Post-Market') return 'text-indigo-400';
    return 'text-slate-500';
  };

  // ET "now" as a comparable wall-clock string. The feed's dates are ET wall
  // clock, so a plain lexicographic compare is exact — no Date parsing needed.
  const nowIsoStr = useMemo(() => {
    const nowEst = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${nowEst.getFullYear()}-${pad(nowEst.getMonth() + 1)}-${pad(nowEst.getDate())} ${pad(nowEst.getHours())}:${pad(nowEst.getMinutes())}:${pad(nowEst.getSeconds())}`;
  }, [lastUpdated]);

  return (
    <div className="bg-[#101623] border-0 md:border md:border-white/5 md:rounded-2xl p-2 md:p-8 relative overflow-hidden md:shadow-xl w-full">
      <div className="absolute right-0 top-0 w-64 h-64 bg-cyan-500/5 blur-3xl rounded-full -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>

      {/* HEADER CONTAINER - CLICKABLE */}
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex justify-between items-center relative z-10 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-6 border-b border-white/5 pb-4' : ''}`}
      >
        <div className="flex items-center gap-3">
          <span className={`text-xs md:text-sm font-bold border px-3 py-1.5 rounded tracking-widest uppercase flex items-center gap-2 transition-colors ${isHistorical ? 'text-amber-400 bg-amber-500/10 border-amber-500/20 group-hover:bg-amber-500/20' : 'text-[#7c8bfa] bg-[#161c2a]/40 border-white/5 group-hover:bg-white/[0.02]'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isHistorical ? 'bg-amber-400' : 'bg-[#7c8bfa]'}`}></span>
            ECONOMIC CALENDAR
          </span>
          {!isExpanded && tabCounts.High > 0 && (
            <span className="text-[10px] font-bold text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded tracking-wider">
              {tabCounts.High} HIGH
            </span>
          )}
        </div>

        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-center justify-center border border-white/5 bg-[#161c2a]/40 px-4 py-1.5 rounded-[10px] min-w-[120px]">
            <span className={`text-[10px] font-bold tracking-widest uppercase ${getSessionTextColor()}`}>
              {status === 'Live' ? (isHistorical ? `ARCHIVE: ${selectedDate}` : session) : status}
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
        <>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 relative z-10 pb-2">
            <div className="flex gap-3 overflow-x-auto custom-scrollbar w-full md:w-auto" style={{ scrollbarWidth: 'none' }}>
              {(['High', 'Medium'] as TabType[]).map((tab) => (
                <button
                  key={tab}
                  onClick={(e) => { e.stopPropagation(); setActiveTab(tab); }}
                  className={`px-5 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-all duration-300 ${
                    activeTab === tab 
                      ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 shadow-[0_0_10px_rgba(34,211,238,0.1)]' 
                      : 'bg-[#161c2a] text-slate-400 border border-white/5 hover:bg-white/[0.04]'
                  }`}
                >
                  {tab}
                  <span className={`ml-2 text-[10px] font-bold ${activeTab === tab ? 'text-cyan-300/70' : 'text-slate-600'}`}>
                    {tabCounts[tab]}
                  </span>
                </button>
              ))}
            </div>
            <span className="text-[10px] text-slate-500 font-medium tracking-wide">
              Low-impact releases hidden
            </span>
          </div>
          
          <div className="overflow-x-auto custom-scrollbar relative z-10" style={{ scrollbarWidth: 'none' }}>
            <table className="w-full min-w-[900px] border-collapse">
              <thead>
                <tr className="border-b border-white/5 select-none">
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[20%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('rawDateString')}>
                    DATE / TIME (EST){getSortIcon('rawDateString')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[35%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('event')}>
                    MACRO EVENT{getSortIcon('event')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[15%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('impact')}>
                    IMPACT RATING{getSortIcon('impact')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[10%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('actual')}>
                    ACTUAL{getSortIcon('actual')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[10%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('estimate')}>
                    ESTIMATE{getSortIcon('estimate')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[10%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('previous')}>
                    PREVIOUS{getSortIcon('previous')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {isLoading && events.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center">
                      <div className="w-5 h-5 border-2 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin mx-auto mb-3"></div>
                      <span className="text-xs text-slate-500 font-medium">Fetching Economic Outlook...</span>
                    </td>
                  </tr>
                ) : sortedEvents.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-500 text-sm font-medium">
                      No upcoming {activeTab.toLowerCase()} impact events scheduled for this timeframe.
                    </td>
                  </tr>
                ) : (
                  sortedEvents.map((row) => {
                    const isPast = row.rawDateString < nowIsoStr;
                    const isSelectedDay = row.rawDateString.startsWith(selectedDate);
                    // Still ahead today — the rows that actually carry risk.
                    const isPending = isSelectedDay && !isPast && row.actual === null;

                    const rowBgClass = isPending
                      ? 'bg-rose-500/[0.06]'
                      : isSelectedDay ? 'bg-cyan-500/[0.06]' : 'hover:bg-white/[0.02]';
                    const opacityClass = isPast && !isSelectedDay ? 'opacity-40' : 'opacity-100';
                    const dateTextColor = isPending
                      ? 'text-rose-300 font-bold'
                      : isSelectedDay ? 'text-cyan-400 font-bold' : 'text-slate-300 font-bold';
                    const eventTextColor = isSelectedDay ? 'text-white font-bold' : 'text-slate-200 font-medium';

                    return (
                      <tr key={row.id} className={`transition-colors group ${rowBgClass} ${opacityClass}`}>
                        
                        <td className="py-3.5" style={{ textAlign: 'left', paddingLeft: '12px' }}>
                          <span className={`text-xs whitespace-nowrap ${dateTextColor}`}>
                            {formatEventDate(row.rawDateString)}
                          </span>
                        </td>
                        
                        <td className={`py-3.5 text-xs whitespace-nowrap truncate max-w-[300px] ${eventTextColor}`} style={{ textAlign: 'left', paddingLeft: '12px' }}>
                          {row.event}
                          {isPending && (
                            <span className="ml-2 text-[8px] font-bold tracking-widest uppercase text-rose-400 bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.5 rounded">
                              AHEAD
                            </span>
                          )}
                        </td>

                        <td className="py-3.5" style={{ textAlign: 'left', paddingLeft: '12px' }}>
                          <span className={`inline-block text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border text-center min-w-[70px] ${getImpactBadgeColors(row.impact)}`}>
                            {row.impact}
                          </span>
                        </td>

                        <td className={`py-3.5 text-xs font-bold whitespace-nowrap ${isSelectedDay ? 'text-slate-100' : 'text-slate-300'}`} style={{ textAlign: 'left', paddingLeft: '12px' }}>
                          {row.actual !== null ? row.actual.toLocaleString() : '-'}
                        </td>

                        <td className={`py-3.5 text-xs font-medium whitespace-nowrap ${isSelectedDay ? 'text-slate-300' : 'text-slate-400'}`} style={{ textAlign: 'left', paddingLeft: '12px' }}>
                          {row.estimate !== null ? row.estimate.toLocaleString() : '-'}
                        </td>
                        
                        <td className={`py-3.5 text-xs font-medium whitespace-nowrap ${isSelectedDay ? 'text-slate-400' : 'text-slate-500'}`} style={{ textAlign: 'left', paddingLeft: '12px' }}>
                          {row.previous !== null ? row.previous.toLocaleString() : '-'}
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
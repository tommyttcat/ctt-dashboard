'use client';

import React, { useState, useEffect, useMemo } from 'react';

// ---------------------------------------------------------------------------
// Earnings Calendar — v2.0
//
// v2.0 REMOVES THE MARKET-CAP ENRICHMENT ENTIRELY.
//
//   The old version called `https://api.massive.com/v3/reference/tickers/...`
//   with NEXT_PUBLIC_POLYGON_API_KEY. That host is not a market data provider —
//   it appears to be the result of a find-and-replace on "polygon" that caught
//   the URL string. Every call failed silently into the fetchSafeJson fallback,
//   so mktCap was ALWAYS null, which meant:
//
//     - the SMALL/MID/MEGA tier filter rejected every non-thematic row
//       (they all need a cap to pass any gate), so the table only ever showed
//       tickers hardcoded in SECTOR_MAP with a thematic sector
//     - an API key was being sent from the browser to a third-party domain
//     - up to N sequential round trips ran on every load, for nothing
//
//   Rather than proxy Polygon server-side for a column that mostly duplicates
//   what `importance` already tells us, the tier filter is replaced with an
//   importance filter using data the /api/earnings payload already carries.
//   No external calls, no key on the client, and the filter actually works.
//
//   Also fixed: formatEventDate parsed "YYYY-MM-DD" through Date() with a
//   UTC noon anchor, then formatted with no timeZone — which rendered in the
//   viewer's local zone. Now parsed by component, same as EconomicCalendar.
// ---------------------------------------------------------------------------

// --- INTERFACES ---
interface EarningEvent {
  id: string;
  date: string; 
  ticker: string;
  name: string;
  sector: string;
  importance: number;
  epsEst: number | null;
  revEst: number | null;
  epsActual: number | null;
  epsSurprisePct: number | null;
  result: 'BEAT' | 'MISS' | 'INLINE' | null;
  rawDateString: string; 
  isThematic?: boolean;
}

type MarketSession = 'Pre-Market' | 'Open' | 'Post-Market' | 'Closed';
type SortDirection = 'asc' | 'desc';
// Replaces the cap tiers. Benzinga importance runs 0–5; 5 is the mega-cap
// name that moves the index, 3–4 is a real but second-tier print.
type RelevanceTier = 'ALL' | 'NOTABLE' | 'MAJOR';

// --- CONSTANTS & MAPS ---
const SECTOR_MAP: Record<string, string> = {
  'AAPL': 'IT', 'MSFT': 'IT', 'SMCI': 'IT',
  'NVDA': "Semi's", 'AMD': "Semi's", 'INTC': "Semi's", 
  'AVGO': "Semi's", 'MU': "Semi's", 'ARM': "Semi's", 
  'QCOM': "Semi's", 'TSM': "Semi's", 'ALOT': 'IT',
  'PLTR': 'AI', 'SOUN': 'AI', 'BBAI': 'AI', 'AI': 'AI',
  'CRWD': 'Cyber', 'PANW': 'Cyber', 'ZS': 'Cyber',
  'IONQ': 'Quantum', 'RGTI': 'Quantum', 'QBTS': 'Quantum', 
  'COIN': 'Fintech', 'MSTR': 'Fintech', 'MARA': 'Fintech', 'RIOT': 'Fintech', 'HOOD': 'Fintech', 'SOFI': 'Fintech',
  'TSLA': 'EV', 'NIO': 'EV', 'LI': 'EV', 'XPEV': 'EV',
  'LUNR': 'Aerospace', 'ASTS': 'Aerospace', 'RKLB': 'Aerospace', 
  'CEG': 'Nuclear', 'OKLO': 'Nuclear', 'CCJ': 'Nuclear', 'SMR': 'Nuclear', 'LEU': 'Nuclear',
  'FSLR': 'Solar', 'ENPH': 'Solar', 'RUN': 'Solar',
  'HIMS': 'Healthcare', 'NVO': 'Healthcare', 'LLY': 'Healthcare', 'ASTX': 'Biotech', 'COO': 'Healthcare',
  'AMZN': 'Con Disc', 'UBER': 'Con Disc', 'BABA': 'Con Disc', 'DLTH': 'Con Disc',
  'PG': 'Con Staples', 'CPB': 'Con Staples', 'AVO': 'Con Staples',
  'META': 'Comm Serv', 'GOOGL': 'Comm Serv', 'NFLX': 'Comm Serv', 
  'GHM': 'Industrials'
};

const THEMATIC_SECTORS = ['AI', 'Nuclear', 'Quantum', "Semi's", 'Cyber', 'Aerospace'];

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'America/New_York' });
};

const getIsoDateString = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Calendar dates are plain "YYYY-MM-DD" with no zone. Parse by component so
// the label never shifts with the viewer's timezone. Date.UTC is used only to
// derive the weekday; no conversion happens since we read UTC fields back out.
const formatEventDate = (dateStr: string): string => {
  const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return dateStr || '-';
  const year = parseInt(m[1], 10);
  const monthIdx = parseInt(m[2], 10) - 1;
  const dayNum = parseInt(m[3], 10);
  const weekday = WEEKDAY_NAMES[new Date(Date.UTC(year, monthIdx, dayNum)).getUTCDay()];
  return `${weekday}, ${MONTH_NAMES[monthIdx]} ${dayNum}`;
};

const formatCurrency = (num: number | null) => {
  if (num === null || num === 0 || isNaN(num)) return '-';
  if (num >= 1e9) return '$' + (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return '$' + (num / 1e6).toFixed(1) + 'M';
  return '$' + num.toLocaleString();
};

const getResultBadge = (result: string | null) => {
  if (result === 'BEAT') return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
  if (result === 'MISS') return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
  if (result === 'INLINE') return 'bg-slate-500/10 text-slate-300 border-white/10';
  return '';
};

// Importance badge — the replacement for the market cap column.
const getImportanceBadge = (importance: number) => {
  if (importance >= 5) return { label: 'MAJOR', cls: 'text-rose-400 bg-rose-500/10 border-rose-500/20' };
  if (importance >= 3) return { label: 'NOTABLE', cls: 'text-amber-400 bg-amber-500/10 border-amber-500/20' };
  return { label: 'MINOR', cls: 'text-slate-400 bg-slate-500/10 border-white/10' };
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
  const [events, setEvents] = useState<EarningEvent[]>([]);
  const [status, setStatus] = useState<string>('Offline');
  const [session, setSession] = useState<MarketSession>('Closed');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: keyof EarningEvent; direction: SortDirection } | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  // Defaults to MAJOR — the prints that actually move an index. ALL is there
  // when you want the full board.
  const [tier, setTier] = useState<RelevanceTier>('MAJOR');

  useEffect(() => {
    let isMounted = true;

    const fetchEarningsData = async () => {
      try {
        const currentSession = getMarketSession();
        if (isMounted) setSession(currentSession);
        setStatus('Scouting Calendar...');

        const estNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
        const baseDate = new Date(estNow);
        
        const fromDate = new Date(baseDate);
        const dayOfWeek = fromDate.getDay(); 
        if (dayOfWeek === 0) fromDate.setDate(baseDate.getDate() - 2); 
        else if (dayOfWeek === 6) fromDate.setDate(baseDate.getDate() - 1); 
        else if (dayOfWeek === 1) fromDate.setDate(baseDate.getDate() - 3); 
        else fromDate.setDate(baseDate.getDate() - 1); 

        const fromStr = getIsoDateString(fromDate);

        const toDate = new Date(fromDate);
        toDate.setDate(fromDate.getDate() + 45); 
        const toStrCutoff = getIsoDateString(toDate);

        const calendarUrl = `/api/earnings?from=${fromStr}&to=${toStrCutoff}`;
        const rawEarnings = await fetchSafeJson(calendarUrl, []);

        if (!Array.isArray(rawEarnings) || rawEarnings.length === 0) {
          if (isMounted) {
            setEvents([]);
            setStatus('No Events Scheduled');
          }
          return;
        }

        const usEarnings = rawEarnings.filter((e: any) => {
            if (!e.symbol || e.symbol.includes('.')) return false;
            if (e.symbol.length >= 5) return false;
            const eventDateStr = e.date ? e.date.substring(0, 10) : '';
            return eventDateStr >= fromStr && eventDateStr <= toStrCutoff;
        });

        if (usEarnings.length === 0) {
            if (isMounted) {
              setEvents([]);
              setStatus('No US Events Scheduled');
            }
            return;
        }

        // Straight map — no enrichment pass, no external calls. Everything
        // rendered below comes from the /api/earnings payload directly.
        const processedEvents: EarningEvent[] = usEarnings.map((e: any) => {
            const sym = e.symbol;
            const mappedSector = SECTOR_MAP[sym] || 'General';
            const isThematic = THEMATIC_SECTORS.includes(mappedSector);

            const epsEst = (e.epsEstimated !== null && e.epsEstimated !== undefined) ? e.epsEstimated : null;
            const revEst = (e.revenueEstimated !== null && e.revenueEstimated !== undefined) ? e.revenueEstimated : null;
            const epsActual = (e.epsActual !== null && e.epsActual !== undefined) ? e.epsActual : null;
            const epsSurprisePct = (e.epsSurprisePct !== null && e.epsSurprisePct !== undefined) ? e.epsSurprisePct : null;

            // Beat / miss only once an actual has been reported.
            let result: 'BEAT' | 'MISS' | 'INLINE' | null = null;
            if (epsActual !== null && epsEst !== null) {
              const diff = epsActual - epsEst;
              result = diff > 0 ? 'BEAT' : diff < 0 ? 'MISS' : 'INLINE';
            } else if (epsActual !== null && epsSurprisePct !== null) {
              result = epsSurprisePct > 0 ? 'BEAT' : epsSurprisePct < 0 ? 'MISS' : 'INLINE';
            }

            return {
                // Keyed on identity, not array index, so sorting does not remount rows.
                id: `${sym}|${e.date}`,
                date: formatEventDate(e.date),
                rawDateString: e.date,
                ticker: sym,
                name: e.name || sym,
                sector: mappedSector,
                importance: Number(e.importance) || 0,
                epsEst,
                revEst,
                epsActual,
                epsSurprisePct,
                result,
                isThematic
            };
        });

        if (isMounted) {
          setEvents(processedEvents);
          setLastUpdated(new Date());
          setStatus('Live'); 
        }

      } catch (error: any) {
        if (isMounted) setStatus('Offline');
      }
    };

    fetchEarningsData();
    const interval = setInterval(fetchEarningsData, 43200000); 
    return () => { isMounted = false; };
  }, []);

  const handleSort = (key: keyof EarningEvent) => {
    let direction: SortDirection = 'desc'; 
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') direction = 'asc';
    else if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') { setSortConfig(null); return; }
    setSortConfig({ key, direction });
  };

  // Thematic names bypass the importance gate — a Quantum or Nuclear print
  // matters to this dashboard even when Benzinga rates it a 2.
  const passesTier = (e: EarningEvent, t: RelevanceTier): boolean => {
    if (t === 'ALL') return true;
    if (e.isThematic) return true;
    if (t === 'MAJOR') return e.importance >= 5;
    return e.importance >= 3;
  };

  const tierCounts = useMemo(() => ({
    ALL: events.length,
    NOTABLE: events.filter(e => passesTier(e, 'NOTABLE')).length,
    MAJOR: events.filter(e => passesTier(e, 'MAJOR')).length,
  }), [events]);

  const finalRenderedEvents = useMemo(() => {
    const list = events.filter(e => passesTier(e, tier));

    if (!sortConfig) {
      // Chronological, then most important first within a day.
      return list
        .sort((a, b) =>
          a.rawDateString.localeCompare(b.rawDateString) ||
          b.importance - a.importance ||
          a.ticker.localeCompare(b.ticker))
        .slice(0, 25);
    }
    
    list.sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return list.slice(0, 25);
  }, [events, sortConfig, tier]);

  const isLoading = status.includes('Scouting');
  const getSortIcon = (columnKey: keyof EarningEvent) => sortConfig?.key === columnKey ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓') : '';

  const getSessionTextColor = () => {
    if (session === 'Pre-Market') return 'text-amber-500';
    if (session === 'Open') return 'text-[#00e676]';
    if (session === 'Post-Market') return 'text-indigo-400';
    return 'text-slate-500';
  };

  const todayStr = useMemo(() => {
    const nowEst = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${nowEst.getFullYear()}-${pad(nowEst.getMonth() + 1)}-${pad(nowEst.getDate())}`;
  }, [lastUpdated]);

  const todayCount = useMemo(
    () => events.filter(e => e.rawDateString.startsWith(todayStr) && passesTier(e, 'MAJOR')).length,
    [events, todayStr]
  );

  return (
    <div className="bg-[#101623] border border-white/5 rounded-2xl p-5 md:p-8 relative overflow-hidden shadow-xl w-full">
      <div className="absolute right-0 top-0 w-64 h-64 bg-cyan-500/5 blur-3xl rounded-full -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>
      
      {/* Clickable Header for Collapsing */}
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex justify-between items-center relative z-10 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-6 border-b border-white/5 pb-4' : ''}`}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs md:text-sm font-bold text-[#7c8bfa] bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 group-hover:bg-white/[0.02] transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
            EARNINGS
          </span>
          {!isExpanded && todayCount > 0 && (
            <span className="text-[10px] font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded tracking-wider">
              {todayCount} TODAY
            </span>
          )}
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

      {/* Expanded Content Wrapper */}
      {isExpanded && (
        <>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 relative z-10 pb-2">
            <div className="flex gap-3 overflow-x-auto custom-scrollbar w-full md:w-auto" style={{ scrollbarWidth: 'none' }}>
              <div className="flex items-center gap-1 bg-[#161c2a] border border-white/5 rounded-lg p-1">
                {(['MAJOR', 'NOTABLE', 'ALL'] as RelevanceTier[]).map(t => (
                  <button
                    key={t}
                    onClick={(e) => { e.stopPropagation(); setTier(t); }}
                    className={`px-3 py-1.5 rounded-md text-[10px] font-bold tracking-wide uppercase transition-all duration-300 ${
                      tier === t 
                        ? 'bg-indigo-500/20 text-[#7c8bfa] border border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.1)]' 
                        : 'text-slate-500 hover:text-slate-300 border border-transparent hover:bg-white/[0.02]'
                    }`}
                  >
                    {t}
                    <span className={`ml-1.5 text-[9px] ${tier === t ? 'text-[#7c8bfa]/60' : 'text-slate-600'}`}>
                      {tierCounts[t]}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <span className="text-[10px] text-slate-500 font-medium tracking-wide">
              Thematic sectors always shown
            </span>
          </div>

          <div className="overflow-x-auto custom-scrollbar relative z-10" style={{ scrollbarWidth: 'none' }}>
            <table className="w-full min-w-[920px] border-collapse">
              <thead>
                <tr className="border-b border-white/5 select-none">
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[11%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('rawDateString')}>DATE{getSortIcon('rawDateString')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[8%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('ticker')}>TICKER{getSortIcon('ticker')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[22%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('name')}>COMPANY{getSortIcon('name')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[12%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('sector')}>SECTOR{getSortIcon('sector')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[11%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('importance')}>WEIGHT{getSortIcon('importance')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[9%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('epsEst')}>EST EPS{getSortIcon('epsEst')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[9%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('epsActual')}>ACTUAL{getSortIcon('epsActual')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[107%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('result')}>RESULT{getSortIcon('result')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[11%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('revEst')}>EST REV{getSortIcon('revEst')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {isLoading && events.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center">
                      <div className="w-5 h-5 border-2 border-indigo-500/20 border-t-indigo-400 rounded-full animate-spin mx-auto mb-3"></div>
                      <span className="text-xs text-slate-500 font-medium">Loading earnings calendar...</span>
                    </td>
                  </tr>
                ) : finalRenderedEvents.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center">
                      <div className="text-slate-400 text-sm font-medium mb-2">
                        No {tier.toLowerCase()} earnings in the next 45 days.
                      </div>
                      <div className="text-slate-500 text-xs">
                        Widen the filter above to see more of the calendar.
                      </div>
                    </td>
                  </tr>
                ) : (
                  finalRenderedEvents.map((row) => {
                    const isPast = row.rawDateString < todayStr;
                    const isToday = row.rawDateString.startsWith(todayStr);
                    const imp = getImportanceBadge(row.importance);
                    
                    const rowBgClass = isToday ? 'bg-cyan-500/[0.06]' : 'hover:bg-white/[0.02]';
                    const opacityClass = isPast && !isToday ? 'opacity-40' : 'opacity-100';
                    const dateTextColor = isToday ? 'text-cyan-400 font-bold' : 'text-slate-300 font-bold';
                    const tickerBgColor = isToday ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30 shadow-[0_0_8px_rgba(34,211,238,0.2)]' : 'bg-indigo-500/10 text-[#7c8bfa] border border-indigo-500/20';
                    const nameTextColor = isToday ? 'text-white font-bold' : 'text-slate-200 font-medium';
                    const actualColor = row.result === 'BEAT' ? 'text-emerald-400' : row.result === 'MISS' ? 'text-rose-400' : (isToday ? 'text-slate-100' : 'text-slate-300');

                    return (
                      <tr key={row.id} className={`transition-colors group ${rowBgClass} ${opacityClass}`}>
                        
                        <td className="py-3.5" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          <span className={`text-xs whitespace-nowrap ${dateTextColor}`}>{row.date}</span>
                        </td>
                        
                        <td className="py-3.5" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded border ${tickerBgColor}`}>{row.ticker}</span>
                        </td>

                        <td className={`py-3.5 text-xs whitespace-nowrap truncate max-w-[220px] ${nameTextColor}`} style={{ textAlign: 'left', paddingLeft: '16px' }}>{row.name}</td>

                        <td className="py-3.5 text-[10px] text-slate-400 font-medium whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          <div className={`truncate px-1.5 py-0.5 rounded border inline-block ${row.isThematic ? 'bg-violet-500/10 text-violet-300 border-violet-500/20' : 'bg-[#161c2a] border-white/5'}`} title={row.sector}>{row.sector}</div>
                        </td>

                        <td className="py-3.5 whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          <span className={`inline-block text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border text-center min-w-[62px] ${imp.cls}`}>
                            {imp.label}
                          </span>
                        </td>

                        <td className="py-3.5 text-xs font-medium whitespace-nowrap text-slate-400" style={{ textAlign: 'left', paddingLeft: '16px' }}>{row.epsEst !== null ? `$${row.epsEst.toFixed(2)}` : '-'}</td>

                        <td className={`py-3.5 text-xs font-bold whitespace-nowrap ${actualColor}`} style={{ textAlign: 'left', paddingLeft: '16px' }}>{row.epsActual !== null ? `$${row.epsActual.toFixed(2)}` : '—'}</td>

                        <td className="py-3.5 whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          {row.result ? (
                            <span className={`inline-block text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${getResultBadge(row.result)}`}>
                              {row.result}{row.epsSurprisePct !== null ? ` ${row.epsSurprisePct > 0 ? '+' : ''}${row.epsSurprisePct.toFixed(1)}%` : ''}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-600 font-medium tracking-wide">Upcoming</span>
                          )}
                        </td>
                        
                        <td className={`py-3.5 text-xs font-medium whitespace-nowrap ${isToday ? 'text-slate-300' : 'text-slate-400'}`} style={{ textAlign: 'left', paddingLeft: '16px' }}>{formatCurrency(row.revEst)}</td>
                        
                      </tr>
                    )
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
'use client';

import React, { useState, useEffect, useMemo } from 'react';

// ---------------------------------------------------------------------------
// Earnings Calendar — v3.0
//
// v3.0: THREE CHANGES.
//
//   (a) READS THE NEW ROUTE RESPONSE. The route (v2.1) now returns
//       { events, meta } instead of a bare array, with a $1B market-cap
//       floor applied server-side via cached Polygon reference data. The
//       component no longer filters by importance or market cap — that work
//       is done before the data arrives.
//
//   (b) PERIOD SELECTOR replaces the importance tier filter. Three options:
//       Today (default), This Week, Next Week. The old MAJOR/NOTABLE/ALL
//       filter gated on Benzinga's importance score, which FMP does not
//       provide — every row came through as 0 and the filter did nothing.
//
//       TODAY IS THE DEFAULT because the question the calendar answers most
//       mornings is "who reports today and is any of them a name I hold or
//       watch." That is a five-second check, and it should not require
//       scrolling past three days of prints that already happened.
//
//   (c) THE WEIGHT COLUMN IS GONE. It showed Benzinga's importance badge
//       (MAJOR / NOTABLE / MINOR). FMP has no equivalent, and with a $1B
//       floor applied server-side the column would read MINOR on every row —
//       pure noise. Market cap replaces it, since the route now includes
//       mktCap from the Polygon reference data.
//
// v2.0: removed broken Massive market-cap enrichment entirely.
// ---------------------------------------------------------------------------

// --- INTERFACES ---
interface EarningEvent {
  id: string;
  date: string;
  ticker: string;
  name: string;
  sector: string;
  mktCap: number | null;
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
type PeriodFilter = 'TODAY' | 'WEEK' | 'NEXT';

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
  'GHM': 'Industrials',
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

const formatTime = (date: Date) =>
  date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'America/New_York' });

const getIsoDateString = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

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
  if (num >= 1e12) return '$' + (num / 1e12).toFixed(1) + 'T';
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

/* Monday of the current or upcoming trading week. On a weekend, that's NEXT
   Monday — same logic as the route, so the two agree on what "this week"
   means. */
const tradingWeekMonday = (d: Date): Date => {
  const clone = new Date(d);
  const day = clone.getDay();
  if (day === 0) clone.setDate(clone.getDate() + 1);
  else if (day === 6) clone.setDate(clone.getDate() + 2);
  else clone.setDate(clone.getDate() - (day - 1));
  return clone;
};

const fridayOf = (mon: Date): Date => {
  const fri = new Date(mon);
  fri.setDate(mon.getDate() + 4);
  return fri;
};

const fetchSafeJson = async (url: string, fallback: any, timeoutMs = 30000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    if (!res.ok) return fallback;
    return await res.json();
  } catch {
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

  /* Default to TODAY. The question most mornings is "who reports today and is
     any of them a name I hold." That is a five-second check and should not
     require scrolling past three days of completed prints. */
  const [period, setPeriod] = useState<PeriodFilter>('TODAY');

  /* The route defaults to the current trading week, so the component fetches
     TWO weeks (this + next) and filters client-side by period. That way
     switching between Today / This Week / Next Week is instant — no
     re-fetch. */
  useEffect(() => {
    let isMounted = true;

    const fetchEarningsData = async () => {
      try {
        const currentSession = getMarketSession();
        if (isMounted) setSession(currentSession);
        setStatus('Scouting Calendar...');

        const estNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
        const mon = tradingWeekMonday(estNow);
        const nextFri = new Date(mon);
        nextFri.setDate(mon.getDate() + 11); // this Fri + next full week

        const fromStr = getIsoDateString(mon);
        const toStr = getIsoDateString(nextFri);

        const calendarUrl = `/api/earnings?from=${fromStr}&to=${toStr}`;
        const rawData = await fetchSafeJson(calendarUrl, null);

        /* The route returns { events, meta } in v2.1+, or a bare array in
           older cached responses. Handle both so a deploy doesn't blank the
           table until the cache expires. */
        let earningsList: any[] = [];
        if (rawData && typeof rawData === 'object' && Array.isArray(rawData.events)) {
          earningsList = rawData.events;
        } else if (Array.isArray(rawData)) {
          earningsList = rawData;
        }

        if (earningsList.length === 0) {
          if (isMounted) {
            setEvents([]);
            setStatus('No Events Scheduled');
          }
          return;
        }

        const usEarnings = earningsList.filter((e: any) => {
          if (!e.symbol || e.symbol.includes('.')) return false;
          if (e.symbol.length >= 5) return false;
          return true;
        });

        const processedEvents: EarningEvent[] = usEarnings.map((e: any) => {
          const sym = e.symbol;
          const mappedSector = SECTOR_MAP[sym] || 'General';
          const isThematic = THEMATIC_SECTORS.includes(mappedSector);

          const epsEst = e.epsEstimated ?? null;
          const revEst = e.revenueEstimated ?? null;
          const epsActual = e.epsActual ?? null;
          const epsSurprisePct = e.epsSurprisePct ?? null;

          let result: 'BEAT' | 'MISS' | 'INLINE' | null = null;
          if (epsActual !== null && epsEst !== null) {
            const diff = epsActual - epsEst;
            result = diff > 0 ? 'BEAT' : diff < 0 ? 'MISS' : 'INLINE';
          } else if (epsActual !== null && epsSurprisePct !== null) {
            result = epsSurprisePct > 0 ? 'BEAT' : epsSurprisePct < 0 ? 'MISS' : 'INLINE';
          }

          return {
            id: `${sym}|${e.date}`,
            date: formatEventDate(e.date),
            rawDateString: e.date,
            ticker: sym,
            name: e.name || sym,
            sector: mappedSector,
            mktCap: e.mktCap ?? null,
            epsEst: typeof epsEst === 'number' ? epsEst : null,
            revEst: typeof revEst === 'number' ? revEst : null,
            epsActual: typeof epsActual === 'number' ? epsActual : null,
            epsSurprisePct: typeof epsSurprisePct === 'number' ? epsSurprisePct : null,
            result,
            isThematic,
          };
        });

        if (isMounted) {
          setEvents(processedEvents);
          setLastUpdated(new Date());
          setStatus('Live');
        }
      } catch {
        if (isMounted) setStatus('Offline');
      }
    };

    fetchEarningsData();
    const interval = setInterval(fetchEarningsData, 4 * 60 * 60 * 1000);
    return () => { isMounted = false; clearInterval(interval); };
  }, []);

  const handleSort = (key: keyof EarningEvent) => {
    let direction: SortDirection = 'desc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') direction = 'asc';
    else if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') { setSortConfig(null); return; }
    setSortConfig({ key, direction });
  };

  /* Date boundaries for the period filter. Computed once per render from the
     current EST date, which is cheap. */
  const estNow = useMemo(() =>
    new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" })),
    [lastUpdated]
  );

  const todayStr = useMemo(() => getIsoDateString(estNow), [estNow]);

  const thisWeekMon = useMemo(() => tradingWeekMonday(estNow), [estNow]);
  const thisWeekFri = useMemo(() => fridayOf(thisWeekMon), [thisWeekMon]);
  const nextWeekMon = useMemo(() => {
    const m = new Date(thisWeekMon);
    m.setDate(m.getDate() + 7);
    return m;
  }, [thisWeekMon]);
  const nextWeekFri = useMemo(() => fridayOf(nextWeekMon), [nextWeekMon]);

  const inPeriod = (rawDate: string, p: PeriodFilter): boolean => {
    if (!rawDate) return false;
    const d = rawDate.substring(0, 10);
    if (p === 'TODAY') return d === todayStr;
    if (p === 'WEEK') return d >= getIsoDateString(thisWeekMon) && d <= getIsoDateString(thisWeekFri);
    /* NEXT */ return d >= getIsoDateString(nextWeekMon) && d <= getIsoDateString(nextWeekFri);
  };

  const periodCounts = useMemo(() => ({
    TODAY: events.filter(e => inPeriod(e.rawDateString, 'TODAY')).length,
    WEEK: events.filter(e => inPeriod(e.rawDateString, 'WEEK')).length,
    NEXT: events.filter(e => inPeriod(e.rawDateString, 'NEXT')).length,
  }), [events, todayStr]);

  const todayCount = periodCounts.TODAY;

  const finalRenderedEvents = useMemo(() => {
    const list = events.filter(e => inPeriod(e.rawDateString, period));

    if (!sortConfig) {
      return list
        .sort((a, b) =>
          a.rawDateString.localeCompare(b.rawDateString) ||
          (b.mktCap ?? 0) - (a.mktCap ?? 0) ||
          a.ticker.localeCompare(b.ticker))
        .slice(0, 50);
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

    return list.slice(0, 50);
  }, [events, sortConfig, period, todayStr]);

  const isLoading = status.includes('Scouting');
  const getSortIcon = (columnKey: keyof EarningEvent) =>
    sortConfig?.key === columnKey ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓') : '';

  const getSessionTextColor = () => {
    if (session === 'Pre-Market') return 'text-amber-500';
    if (session === 'Open') return 'text-[#00e676]';
    if (session === 'Post-Market') return 'text-indigo-400';
    return 'text-slate-500';
  };

  const PERIOD_LABELS: Record<PeriodFilter, string> = {
    TODAY: 'Today',
    WEEK: 'This Week',
    NEXT: 'Next Week',
  };

  const filterBtnActive = "bg-indigo-500/20 text-[#7c8bfa] border border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.1)]";
  const filterBtnIdle = "text-slate-500 hover:text-slate-300 border border-transparent hover:bg-white/[0.02]";

  return (
    <div className="bg-[#101623] border border-white/5 rounded-2xl p-5 md:p-8 relative overflow-hidden shadow-xl w-full">
      <div className="absolute right-0 top-0 w-64 h-64 bg-cyan-500/5 blur-3xl rounded-full -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>

      {/* Header */}
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

      {/* Expanded */}
      {isExpanded && (
        <>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 relative z-10 pb-2">
            <div className="flex gap-3 overflow-x-auto w-full md:w-auto" style={{ scrollbarWidth: 'none' }}>
              <div className="flex items-center gap-1 bg-[#161c2a] border border-white/5 rounded-lg p-1">
                {(['TODAY', 'WEEK', 'NEXT'] as PeriodFilter[]).map(p => (
                  <button
                    key={p}
                    onClick={(e) => { e.stopPropagation(); setPeriod(p); }}
                    className={`px-3 py-1.5 rounded-md text-[10px] font-bold tracking-wide uppercase transition-all duration-300 ${
                      period === p ? filterBtnActive : filterBtnIdle
                    }`}
                  >
                    {PERIOD_LABELS[p]}
                    <span className={`ml-1.5 text-[9px] ${period === p ? 'text-[#7c8bfa]/60' : 'text-slate-600'}`}>
                      {periodCounts[p]}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <span className="text-[10px] text-slate-500 font-medium tracking-wide">
              $1B+ market cap · thematic sectors always shown
            </span>
          </div>

          <div className="overflow-x-auto relative z-10" style={{ scrollbarWidth: 'thin' }}>
            <table className="w-full min-w-[920px] border-collapse">
              <thead>
                <tr className="border-b border-white/5 select-none">
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[12%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('rawDateString')}>DATE{getSortIcon('rawDateString')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[8%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('ticker')}>TICKER{getSortIcon('ticker')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[18%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('name')}>COMPANY{getSortIcon('name')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[10%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('sector')}>SECTOR{getSortIcon('sector')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[10%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('mktCap')}>MKT CAP{getSortIcon('mktCap')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[9%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('epsEst')}>EST EPS{getSortIcon('epsEst')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[9%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('epsActual')}>ACTUAL{getSortIcon('epsActual')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[12%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('result')}>RESULT{getSortIcon('result')}</th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[12%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('revEst')}>EST REV{getSortIcon('revEst')}</th>
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
                        {period === 'TODAY'
                          ? 'No earnings reports today.'
                          : period === 'WEEK'
                            ? 'No earnings this week above $1B market cap.'
                            : 'No earnings next week above $1B market cap.'}
                      </div>
                      <div className="text-slate-500 text-xs">
                        {period === 'TODAY'
                          ? 'Switch to This Week or Next Week to see the full calendar.'
                          : 'The $1B floor is applied server-side. Smaller names are excluded.'}
                      </div>
                    </td>
                  </tr>
                ) : (
                  finalRenderedEvents.map((row) => {
                    const isPast = row.rawDateString < todayStr;
                    const isToday = row.rawDateString.startsWith(todayStr);

                    const rowBgClass = isToday ? 'bg-cyan-500/[0.06]' : 'hover:bg-white/[0.02]';
                    const opacityClass = isPast && !isToday ? 'opacity-40' : 'opacity-100';
                    const dateTextColor = isToday ? 'text-cyan-400 font-bold' : 'text-slate-300 font-bold';
                    const tickerBgColor = isToday
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30 shadow-[0_0_8px_rgba(34,211,238,0.2)]'
                      : 'bg-indigo-500/10 text-[#7c8bfa] border border-indigo-500/20';
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

                        <td className="py-3.5 text-xs font-medium whitespace-nowrap text-slate-400 tabular-nums" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          {formatCurrency(row.mktCap)}
                        </td>

                        <td className="py-3.5 text-xs font-medium whitespace-nowrap text-slate-400 tabular-nums" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          {row.epsEst !== null ? `$${row.epsEst.toFixed(2)}` : '-'}
                        </td>

                        <td className={`py-3.5 text-xs font-bold whitespace-nowrap tabular-nums ${actualColor}`} style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          {row.epsActual !== null ? `$${row.epsActual.toFixed(2)}` : '—'}
                        </td>

                        <td className="py-3.5 whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          {row.result ? (
                            <span className={`inline-block text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${getResultBadge(row.result)}`}>
                              {row.result}{row.epsSurprisePct !== null ? ` ${row.epsSurprisePct > 0 ? '+' : ''}${row.epsSurprisePct.toFixed(1)}%` : ''}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-600 font-medium tracking-wide">Upcoming</span>
                          )}
                        </td>

                        <td className={`py-3.5 text-xs font-medium whitespace-nowrap tabular-nums ${isToday ? 'text-slate-300' : 'text-slate-400'}`} style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          {formatCurrency(row.revEst)}
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
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import TickerChartHover from './TickerChartHover';
import { getMarketSession } from '@/lib/indicators/marketScorecard';

// ---------------------------------------------------------------------------
// Earnings Calendar — v3.1
//
// v3.1: MARKET CAP FILTER. Adds All / Small / Mid / Large / Mega pills
//       matching the pattern used in the scanner tables. Filter is combined
//       with the existing period selector; counts update per-period.
//
// v3.0: Period selector (Today/This Week/Next Week), route returns
//       { events, meta } with $1B floor, weight column removed.
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
type CapFilter = 'ALL' | 'SMALL' | 'MID' | 'LARGE' | 'MEGA';

// --- CONSTANTS & MAPS ---
const SECTOR_MAP: Record<string, string> = {
  'AAPL': 'Tech', 'MSFT': 'Tech', 'SMCI': 'Tech',
  'NVDA': "Semi's", 'AMD': "Semi's", 'INTC': "Semi's",
  'AVGO': "Semi's", 'MU': "Semi's", 'ARM': "Semi's",
  'QCOM': "Semi's", 'TSM': "Semi's", 'ALOT': 'Tech',
  'PLTR': 'AI', 'SOUN': 'AI', 'BBAI': 'AI', 'AI': 'AI',
  'CRWD': 'Cyber', 'PANW': 'Cyber', 'ZS': 'Cyber',
  'IONQ': 'Quantum', 'RGTI': 'Quantum', 'QBTS': 'Quantum',
  'COIN': 'Fintech', 'MSTR': 'Fintech', 'MARA': 'Fintech', 'RIOT': 'Fintech', 'HOOD': 'Fintech', 'SOFI': 'Fintech', 'BMNR': 'Fintech',
  'TSLA': 'EV', 'NIO': 'EV', 'LI': 'EV', 'XPEV': 'EV',
  'LUNR': 'Aerospace', 'ASTS': 'Aerospace', 'RKLB': 'Aerospace',
  'CEG': 'Nuclear', 'OKLO': 'Nuclear', 'CCJ': 'Nuclear', 'SMR': 'Nuclear', 'LEU': 'Nuclear',
  'FSLR': 'Solar', 'ENPH': 'Solar', 'RUN': 'Solar',
  'HIMS': 'Health', 'NVO': 'Health', 'LLY': 'Health', 'ASTX': 'Biotech', 'COO': 'Health',
  'AMZN': 'Con Disc', 'UBER': 'Con Disc', 'BABA': 'Con Disc', 'DLTH': 'Con Disc',
  'PG': 'Staples', 'CPB': 'Staples', 'AVO': 'Staples',
  'META': 'Comm Svc', 'GOOGL': 'Comm Svc', 'NFLX': 'Comm Svc',
  'GHM': 'Industrl',
};

const THEMATIC_SECTORS = ['AI', 'Nuclear', 'Quantum', "Semi's", 'Cyber', 'Aerospace'];

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* Market cap filter — thresholds in dollars. ALL passes everything. */
const CAP_THRESHOLDS: Record<CapFilter, number> = {
  ALL:   0,
  SMALL: 1e9,
  MID:   5e9,
  LARGE: 20e9,
  MEGA:  100e9,
};

const CAP_LABELS: Record<CapFilter, string> = {
  ALL:   'All',
  SMALL: 'Small',
  MID:   'Mid',
  LARGE: 'Large',
  MEGA:  'Mega',
};

const passesCapFilter = (cap: number | null, f: CapFilter): boolean => {
  if (f === 'ALL') return true;
  return (cap ?? 0) >= CAP_THRESHOLDS[f];
};

// --- HELPERS ---

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
  const [period, setPeriod] = useState<PeriodFilter>('TODAY');
  const [capFilter, setCapFilter] = useState<CapFilter>('LARGE');

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
        nextFri.setDate(mon.getDate() + 11);

        const fromStr = getIsoDateString(mon);
        const toStr = getIsoDateString(nextFri);

        const calendarUrl = `/api/earnings?from=${fromStr}&to=${toStr}`;
        const rawData = await fetchSafeJson(calendarUrl, null);

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

  const estNow = useMemo(() =>
    new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    return d >= getIsoDateString(nextWeekMon) && d <= getIsoDateString(nextWeekFri);
  };

  /* Period-filtered list (before cap filter) — used for cap counts. */
  const periodFiltered = useMemo(() =>
    events.filter(e => inPeriod(e.rawDateString, period)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, period, todayStr]
  );

  /* Period counts — independent of cap filter so the period pills always
     show the total count for each period. */
  const periodCounts = useMemo(() => ({
    TODAY: events.filter(e => inPeriod(e.rawDateString, 'TODAY')).length,
    WEEK:  events.filter(e => inPeriod(e.rawDateString, 'WEEK')).length,
    NEXT:  events.filter(e => inPeriod(e.rawDateString, 'NEXT')).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [events, todayStr]);

  /* Cap filter counts — scoped to the active period so you see how many
     names are in each bucket *within* the period you're looking at. */
  const capFilterCounts = useMemo(() => ({
    ALL:   periodFiltered.length,
    SMALL: periodFiltered.filter(e => passesCapFilter(e.mktCap, 'SMALL')).length,
    MID:   periodFiltered.filter(e => passesCapFilter(e.mktCap, 'MID')).length,
    LARGE: periodFiltered.filter(e => passesCapFilter(e.mktCap, 'LARGE')).length,
    MEGA:  periodFiltered.filter(e => passesCapFilter(e.mktCap, 'MEGA')).length,
  }), [periodFiltered]);

  const todayCount = periodCounts.TODAY;

  const finalRenderedEvents = useMemo(() => {
    const list = periodFiltered.filter(e => passesCapFilter(e.mktCap, capFilter));

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
  }, [periodFiltered, sortConfig, capFilter]);

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
    <div className="bg-[#101623] border-0 md:border md:border-white/5 md:rounded-2xl p-2 md:p-8 relative overflow-hidden md:shadow-xl w-full">
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
              {/* Period pills */}
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

              {/* Cap filter pills */}
              <div className="flex items-center gap-1 bg-[#161c2a] border border-white/5 rounded-lg p-1">
                <div className="px-2 border-r border-white/10 mr-1">
                  <span className="text-[9px] font-bold tracking-widest uppercase text-slate-500">CAP</span>
                </div>
                {(['ALL', 'SMALL', 'MID', 'LARGE', 'MEGA'] as CapFilter[]).map(c => (
                  <button
                    key={c}
                    onClick={(e) => { e.stopPropagation(); setCapFilter(c); }}
                    className={`px-3 py-1.5 rounded-md text-[10px] font-bold tracking-wide uppercase transition-all duration-300 ${
                      capFilter === c ? filterBtnActive : filterBtnIdle
                    }`}
                  >
                    {CAP_LABELS[c]}
                    <span className={`ml-1.5 text-[9px] ${capFilter === c ? 'text-[#7c8bfa]/60' : 'text-slate-600'}`}>
                      {capFilterCounts[c]}
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
                      : 'bg-slate-500/10 text-slate-300 border border-white/10';
                    const nameTextColor = isToday ? 'text-white font-bold' : 'text-slate-200 font-medium';
                    const actualColor = row.result === 'BEAT' ? 'text-emerald-400' : row.result === 'MISS' ? 'text-rose-400' : (isToday ? 'text-slate-100' : 'text-slate-300');

                    return (
                      <tr key={row.id} className={`transition-colors group ${rowBgClass} ${opacityClass}`}>
                        <td className="py-3.5" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          <span className={`text-xs whitespace-nowrap ${dateTextColor}`}>{row.date}</span>
                        </td>

                        <td className="py-3.5" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          <TickerChartHover symbol={row.ticker}><span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded border ${tickerBgColor}`}>{row.ticker}</span></TickerChartHover>
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
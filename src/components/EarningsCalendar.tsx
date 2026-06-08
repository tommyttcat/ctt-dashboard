'use client';

import React, { useState, useEffect, useMemo } from 'react';

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
  rawDateString: string; 
  isThematic?: boolean;
}

type MarketSession = 'Pre-Market' | 'Open' | 'Post-Market' | 'Closed';
type SortDirection = 'asc' | 'desc';
type CapTier = 'SMALL' | 'MID' | 'MEGA';

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

const formatEventDate = (dateStr: string) => {
  if (!dateStr) return '-';
  try {
    const d = new Date(`${dateStr}T12:00:00Z`); 
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch (e) {
    return dateStr;
  }
};

const formatNumber = (num: number | null) => {
  if (num === null || num === 0 || isNaN(num)) return '-';
  if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return num.toLocaleString();
};

const formatCurrency = (num: number | null) => {
  if (num === null || num === 0 || isNaN(num)) return '-';
  if (num >= 1e9) return '$' + (num / 1e9).toFixed(1) + 'B';
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

const cleanSectorDescription = (sic: string | undefined, sector: string | undefined, industry: string | undefined) => {
  const ind = (industry || '').toLowerCase();
  if (ind.includes('nuclear')) return 'Nuclear';
  if (ind.includes('solar')) return 'Solar';
  if (ind.includes('electric vehicle') || ind.includes('auto manufacturer')) return 'EV';
  if (ind.includes('biotechnology')) return 'Biotech';
  if (ind.includes('semiconductor')) return "Semi's";
  if (ind.includes('artificial intelligence') || ind.includes('ai ')) return 'AI';
  if (ind.includes('cybersecurity') || ind.includes('security software')) return 'Cyber';
  if (ind.includes('fintech') || ind.includes('financial technology')) return 'Fintech';
  if (ind.includes('aerospace') || ind.includes('defense')) return 'Aerospace';

  const sec = (sector || '').toLowerCase();
  if (sec.includes('technology')) return 'IT';
  if (sec.includes('healthcare') || sec.includes('health care')) return 'Healthcare';
  if (sec.includes('financial')) return 'Financials';
  if (sec.includes('consumer discretionary')) return 'Con Disc';
  if (sec.includes('consumer staples')) return 'Con Staples';
  if (sec.includes('energy')) return 'Energy';
  if (sec.includes('materials')) return 'Materials';
  if (sec.includes('industrials')) return 'Industrials';
  if (sec.includes('real estate')) return 'Real Estate';
  if (sec.includes('utilities')) return 'Utilities';
  if (sec.includes('communication')) return 'Comm Serv';

  const s = (sic || '').toLowerCase();
  if (!s) return 'General'; 

  if (s.includes('semiconductor')) return "Semi's";
  if (s.includes('biological products') || s.includes('in vitro')) return 'Biotech';
  if (s.includes('aircraft') || s.includes('defense')) return 'Aerospace';
  if (s.includes('prepackaged software') || s.includes('computer programming') || s.includes('tech')) return 'IT';
  if (s.includes('pharmaceutical') || s.includes('surgical') || s.includes('medical') || s.includes('health') || s.includes('drug') || s.includes('ophthalmic')) return 'Healthcare';
  if (s.includes('bank') || s.includes('financial') || s.includes('trust') || s.includes('broker') || s.includes('investment') || s.includes('commodity') || s.includes('fund') || s.includes('blank check')) return 'Financials';
  if (s.includes('real estate') || s.includes('reit')) return 'Real Estate';
  if (s.includes('petroleum') || s.includes('drilling') || s.includes('oil') || s.includes('gas') || s.includes('energy')) return 'Energy';
  if (s.includes('motor') || s.includes('retail') || s.includes('apparel') || s.includes('restaurant') || s.includes('eating') || s.includes('entertainment')) return 'Con Disc';
  if (s.includes('soap') || s.includes('detergent') || s.includes('food') || s.includes('beverage') || s.includes('grocery') || s.includes('staple') || s.includes('tobacco')) return 'Con Staples';
  if (s.includes('transport') || s.includes('freight') || s.includes('machinery') || s.includes('industrial') || s.includes('airline') || s.includes('air transportation')) return 'Industrials';
  if (s.includes('telecommunication') || s.includes('telephone') || s.includes('radio') || s.includes('communication')) return 'Comm Serv';
  if (s.includes('metal') || s.includes('mining') || s.includes('gold') || s.includes('chemical') || s.includes('wood') || s.includes('paper')) return 'Materials';
  if (s.includes('electric services') || s.includes('utilities') || s.includes('water')) return 'Utilities';

  return 'General';
};

export default function EarningsCalendar() {
  const [events, setEvents] = useState<EarningEvent[]>([]);
  const [status, setStatus] = useState<string>('Offline');
  const [session, setSession] = useState<MarketSession>('Closed');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: keyof EarningEvent; direction: SortDirection } | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  
  const [tier, setTier] = useState<CapTier>('SMALL');

  const fmpApiKey = process.env.NEXT_PUBLIC_FMP_API_KEY || '';
  const polygonApiKey = process.env.NEXT_PUBLIC_POLYGON_API_KEY || '';

  useEffect(() => {
    let isMounted = true;
    if (!fmpApiKey) { setStatus('Offline'); return; }

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
        toDate.setDate(fromDate.getDate() + 14); 
        const toStrCutoff = getIsoDateString(toDate);

        const calendarUrl = `https://financialmodelingprep.com/stable/earnings-calendar?from=${fromStr}&to=${toStrCutoff}&apikey=${fmpApiKey}`;
        const rawEarnings = await fetchSafeJson(calendarUrl, []);

        if (!Array.isArray(rawEarnings) || rawEarnings.length === 0) {
          if (isMounted) setStatus('No Events Scheduled');
          return;
        }

        const usEarnings = rawEarnings.filter((e: any) => {
            if (!e.symbol || e.symbol.includes('.')) return false;
            if (e.symbol.length >= 5) return false;
            const eventDateStr = e.date ? e.date.substring(0, 10) : '';
            return eventDateStr >= fromStr && eventDateStr <= toStrCutoff;
        });

        if (usEarnings.length === 0) {
            if (isMounted) setStatus('No US Events Scheduled');
            return;
        }

        const uniqueTickers = Array.from(new Set(usEarnings.map((e: any) => e.symbol)));

        if (isMounted) setStatus('Enriching Market Caps...');

        const massiveDataMap = new Map();
        if (polygonApiKey) {
            const chunkSize = 15; 
            for (let i = 0; i < uniqueTickers.length; i += chunkSize) {
                const chunk = uniqueTickers.slice(i, i + chunkSize);
                const chunkPromises = chunk.map(async (sym) => {
                    let res = null;
                    try {
                      // REVERTED BACK TO MASSIVE API WITH SAFETY NET
                      res = await fetchSafeJson(`https://api.massive.com/v3/reference/tickers/${sym}?apiKey=${polygonApiKey}`, {});
                    } catch (error) {
                      console.warn(`Massive API skipped ticker ${sym} in Earnings`);
                    }
                    return { sym, details: res?.results || res || null };
                });
                
                const chunkResults = await Promise.all(chunkPromises);
                chunkResults.forEach(({ sym, details }) => {
                    if (details) massiveDataMap.set(sym, details);
                });
                
                await new Promise(r => setTimeout(r, 100));
            }
        }

        const processedEvents: EarningEvent[] = usEarnings.reduce((acc: EarningEvent[], e: any, index: number) => {
            const sym = e.symbol;
            const massiveInfo = massiveDataMap.get(sym);
            
            const mktCap = massiveInfo?.market_cap || null;
            const companyName = massiveInfo?.name || sym;
            
            let mappedSector = SECTOR_MAP[sym] || massiveInfo?.sector || 'General';
            const isThematic = ['AI', 'Nuclear', 'Quantum', "Semi's", 'Cyber', 'Aerospace'].includes(mappedSector);

            acc.push({
                id: `${sym}-${e.date}-${index}`,
                date: formatEventDate(e.date),
                rawDateString: e.date,
                ticker: sym,
                name: companyName,
                sector: mappedSector,
                mktCap: mktCap,
                epsEst: e.epsEstimated !== null ? e.epsEstimated : null,
                revEst: e.revenueEstimated !== null ? e.revenueEstimated : null,
                isThematic: isThematic
            });
            
            return acc;
        }, []);

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
    return () => { isMounted = false; clearInterval(interval); };
  }, [fmpApiKey, polygonApiKey]);

  const handleSort = (key: keyof EarningEvent) => {
    let direction: SortDirection = 'desc'; 
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') direction = 'asc';
    else if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') { setSortConfig(null); return; }
    setSortConfig({ key, direction });
  };

  const finalRenderedEvents = useMemo(() => {
    let list = events.filter(e => {
        if (e.isThematic) return true;
        
        const m = e.mktCap || 0;
        
        if (tier === 'SMALL') return m >= 100000000 && m < 2000000000;
        if (tier === 'MID') return m >= 2000000000 && m < 10000000000;
        if (tier === 'MEGA') return m >= 10000000000;
        
        return false;
    });

    if (!sortConfig) {
      return list.sort((a, b) => a.rawDateString.localeCompare(b.rawDateString)).slice(0, 20);
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

    return list.slice(0, 20);
  }, [events, sortConfig, tier]);

  const isLoading = status.includes('Scouting') || status.includes('Enriching');
  const getSortIcon = (columnKey: keyof EarningEvent) => sortConfig?.key === columnKey ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓') : '';

  const getSessionTextColor = () => {
    if (session === 'Pre-Market') return 'text-amber-500';
    if (session === 'Open') return 'text-[#00e676]';
    if (session === 'Post-Market') return 'text-indigo-400';
    return 'text-slate-500';
  };

  return (
    <div className="bg-[#101623] border border-white/5 rounded-2xl p-5 md:p-8 relative overflow-hidden shadow-xl w-full">
      <div className="absolute right-0 top-0 w-64 h-64 bg-cyan-500/5 blur-3xl rounded-full -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>
      
      <div className="flex justify-between items-center mb-6 border-b border-white/5 pb-4 relative z-10 group transition-all duration-200">
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
            <span className="text-xs md:text-sm font-bold text-[#7c8bfa] bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 group-hover:bg-white/[0.02] transition-colors">
              <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
              EARNINGS
            </span>
          </div>

          <div className="hidden md:flex items-center gap-1 bg-[#161c2a] border border-white/5 rounded-lg p-1">
            {(['SMALL', 'MID', 'MEGA'] as CapTier[]).map(t => (
               <button
                  key={t}
                  onClick={() => setTier(t)}
                  className={`px-3 py-1.5 rounded-md text-[10px] font-bold tracking-wide uppercase transition-all duration-300 ${
                    tier === t 
                      ? 'bg-indigo-500/20 text-[#7c8bfa] border border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.1)]' 
                      : 'text-slate-500 hover:text-slate-300 border border-transparent'
                  }`}
                >
                  {t}
                </button>
            ))}
          </div>
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

      <div className="md:hidden mb-4 flex justify-start relative z-10">
        <div className="flex items-center gap-1 bg-[#161c2a] border border-white/5 rounded-lg p-1">
          {(['SMALL', 'MID', 'MEGA'] as CapTier[]).map(t => (
              <button
                key={t}
                onClick={() => setTier(t)}
                className={`px-3 py-1.5 rounded-md text-[10px] font-bold tracking-wide uppercase transition-all duration-300 ${
                  tier === t 
                    ? 'bg-indigo-500/20 text-[#7c8bfa] border border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.1)]' 
                    : 'text-slate-500 hover:text-slate-300 border border-transparent'
                }`}
              >
                {t}
              </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto custom-scrollbar relative z-10" style={{ scrollbarWidth: 'none' }}>
        <table className="w-full min-w-[900px] border-collapse">
          <thead>
            <tr className="border-b border-white/5 select-none">
              <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[12%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('rawDateString')}>DATE{getSortIcon('rawDateString')}</th>
              <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[10%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('ticker')}>TICKER{getSortIcon('ticker')}</th>
              <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[32%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('name')}>COMPANY{getSortIcon('name')}</th>
              <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[16%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('sector')}>SECTOR{getSortIcon('sector')}</th>
              <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[12%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('mktCap')}>MCAP{getSortIcon('mktCap')}</th>
              <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[8%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('epsEst')}>EST EPS{getSortIcon('epsEst')}</th>
              <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[10%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('revEst')}>EST REV{getSortIcon('revEst')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {isLoading && events.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center">
                  <div className="w-5 h-5 border-2 border-indigo-500/20 border-t-indigo-400 rounded-full animate-spin mx-auto mb-3"></div>
                  <span className="text-xs text-slate-500 font-medium">Scouting {tier} Market Caps...</span>
                </td>
              </tr>
            ) : finalRenderedEvents.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center">
                  <div className="text-slate-400 text-sm font-medium mb-2">
                    No matching earnings scheduled for the {tier} tier.
                  </div>
                  <div className="text-slate-500 text-xs">
                    The engine scanned and filtered the raw earnings data.<br/>Toggle a different tier above to view more setups.
                  </div>
                </td>
              </tr>
            ) : (
              finalRenderedEvents.map((row) => {
                const nowEst = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
                const pad = (n: number) => String(n).padStart(2, '0');
                const nowIsoStr = `${nowEst.getFullYear()}-${pad(nowEst.getMonth()+1)}-${pad(nowEst.getDate())} ${pad(nowEst.getHours())}:${pad(nowEst.getMinutes())}:${pad(nowEst.getSeconds())}`;
                const todayStr = `${nowEst.getFullYear()}-${pad(nowEst.getMonth()+1)}-${pad(nowEst.getDate())}`;

                const isPast = row.rawDateString < nowIsoStr;
                const isToday = row.rawDateString.startsWith(todayStr);
                
                const rowBgClass = isToday ? 'bg-cyan-500/[0.06]' : 'hover:bg-white/[0.02]';
                const opacityClass = isPast && !isToday ? 'opacity-40' : 'opacity-100';
                const dateTextColor = isToday ? 'text-cyan-400 font-bold' : 'text-slate-300 font-bold';
                const tickerBgColor = isToday ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30 shadow-[0_0_8px_rgba(34,211,238,0.2)]' : 'bg-indigo-500/10 text-[#7c8bfa] border border-indigo-500/20';
                const nameTextColor = isToday ? 'text-white font-bold' : 'text-slate-200 font-medium';

                return (
                  <tr key={row.id} className={`transition-colors group ${rowBgClass} ${opacityClass}`}>
                    
                    <td className="py-3.5" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                      <span className={`text-xs whitespace-nowrap ${dateTextColor}`}>{row.date}</span>
                    </td>
                    
                    <td className="py-3.5" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                      <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded border ${tickerBgColor}`}>{row.ticker}</span>
                    </td>

                    <td className={`py-3.5 text-xs whitespace-nowrap truncate max-w-[250px] ${nameTextColor}`} style={{ textAlign: 'left', paddingLeft: '16px' }}>{row.name}</td>

                    <td className="py-3.5 text-[10px] text-slate-400 font-medium whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                      <div className="truncate bg-[#161c2a] px-1.5 py-0.5 rounded border border-white/5 inline-block" title={row.sector}>{row.sector}</div>
                    </td>

                    <td className={`py-3.5 text-xs font-bold whitespace-nowrap ${isToday ? 'text-slate-100' : 'text-slate-300'}`} style={{ textAlign: 'left', paddingLeft: '16px' }}>{formatNumber(row.mktCap)}</td>

                    <td className={`py-3.5 text-xs font-medium whitespace-nowrap ${isToday ? 'text-emerald-400' : 'text-emerald-400/90'}`} style={{ textAlign: 'left', paddingLeft: '16px' }}>{row.epsEst !== null ? `$${row.epsEst.toFixed(2)}` : '-'}</td>
                    
                    <td className={`py-3.5 text-xs font-medium whitespace-nowrap ${isToday ? 'text-slate-300' : 'text-slate-400'}`} style={{ textAlign: 'left', paddingLeft: '16px' }}>{formatCurrency(row.revEst)}</td>
                    
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
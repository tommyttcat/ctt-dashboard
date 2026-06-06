'use client';

import React, { useState, useEffect } from 'react';

// --- INTERFACES ---
interface PerformanceData {
  sector?: string;
  industry?: string;
  changesPercentage: number;
  isSummary?: boolean; 
}

interface SectorWeight {
  sector: string;
  weightPercentage: number;
}

type MarketSession = 'Pre-Market' | 'Open' | 'Post-Market' | 'Closed';

const ETF_TICKERS = ['SPY', 'QQQ', 'DIA', 'IWM'];

// --- HELPERS ---
const getFallbackDates = (): string[] => {
  const dates = [];
  const d = new Date();
  for (let i = 0; i < 3; i++) {
    if (d.getDay() === 0) d.setDate(d.getDate() - 2); 
    if (d.getDay() === 6) d.setDate(d.getDate() - 1); 
    dates.push(d.toISOString().split('T')[0]);
    d.setDate(d.getDate() - 1);
  }
  return dates;
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

// --- COMPONENT ---
export default function MarketFlow() {
  // States
  const [sectors, setSectors] = useState<PerformanceData[]>([]);
  const [industries, setIndustries] = useState<PerformanceData[]>([]);
  const [etfWeights, setEtfWeights] = useState<SectorWeight[]>([]);
  
  // UI Controls
  const [activeEtf, setActiveEtf] = useState<string>('SPY');
  const [activeTab, setActiveTab] = useState<'ETF' | 'INDUSTRIES'>('INDUSTRIES'); 
  
  // Status States
  const [status, setStatus] = useState<string>('Offline');
  const [session, setSession] = useState<MarketSession>('Closed');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // --- COLLAPSE STATE ---
  const [isExpanded, setIsExpanded] = useState<boolean>(true);

  const fmpApiKey = process.env.NEXT_PUBLIC_FMP_API_KEY || '';

  // 1. Fetch Market Snapshots (Sectors & Industries)
  useEffect(() => {
    let isMounted = true;
    if (!fmpApiKey) {
      setStatus('Offline');
      return;
    }

    const fetchSnapshotData = async () => {
      try {
        const currentSession = getMarketSession();
        if (isMounted) setSession(currentSession);
        setStatus('Scouting...');

        const tryDates = getFallbackDates();
        let finalSectorsData: any[] = [];
        let finalIndustriesData: any[] = [];

        for (const targetDate of tryDates) {
          const [sectorsRes, indRes] = await Promise.all([
            fetch(`https://financialmodelingprep.com/stable/sector-performance-snapshot?date=${targetDate}&apikey=${fmpApiKey}`),
            fetch(`https://financialmodelingprep.com/stable/industry-performance-snapshot?date=${targetDate}&apikey=${fmpApiKey}`)
          ]);

          const sText = await sectorsRes.text();
          const iText = await indRes.text();
          let sData = [];
          let iData = [];
          try { sData = JSON.parse(sText); } catch(e) {}
          try { iData = JSON.parse(iText); } catch(e) {}

          const hasRealData = sData.some((s: any) => {
            const pct = s.averageChange ?? s.changesPercentage ?? 0;
            return parseFloat(pct) !== 0 && !isNaN(parseFloat(pct));
          });

          if (hasRealData) {
            finalSectorsData = sData;
            finalIndustriesData = iData;
            break; 
          }
        }

        if (isMounted && finalSectorsData.length > 0) {
          const mappedSectors = finalSectorsData.map((s: any) => ({
            sector: s.sector,
            changesPercentage: parseFloat(s.averageChange ?? s.changesPercentage ?? 0)
          })).sort((a, b) => b.changesPercentage - a.changesPercentage);
          setSectors(mappedSectors.slice(0, 11)); 
          
          const mappedInd = finalIndustriesData.map((i: any) => ({
            industry: i.industry,
            changesPercentage: parseFloat(i.averageChange ?? i.changesPercentage ?? 0)
          })).sort((a, b) => b.changesPercentage - a.changesPercentage);
          setIndustries(mappedInd.slice(0, 10)); // Top 10

          setLastUpdated(new Date());
          setStatus('Live');
        } else if (isMounted) {
          setStatus('Offline');
        }
      } catch (error: any) {
        if (isMounted) setStatus('Network Error');
      }
    };

    fetchSnapshotData();
    const interval = setInterval(fetchSnapshotData, 300000); // 5 mins
    return () => { isMounted = false; clearInterval(interval); };
  }, [fmpApiKey]);

  // 2. Fetch ETF Weightings (Runs when activeEtf changes)
  useEffect(() => {
    let isMounted = true;
    if (!fmpApiKey) return;

    const fetchWeightings = async () => {
      try {
        const res = await fetch(`https://financialmodelingprep.com/stable/etf/sector-weightings?symbol=${activeEtf}&apikey=${fmpApiKey}`);
        const data = await res.json();

        if (isMounted && Array.isArray(data)) {
          const mappedWeights = data.map((item: any) => ({
            sector: item.sector,
            weightPercentage: parseFloat(String(item.weightPercentage).replace('%', '')) || 0
          })).sort((a, b) => b.weightPercentage - a.weightPercentage);
          
          setEtfWeights(mappedWeights.slice(0, 8)); // Top 8 concentrations
        }
      } catch (error) {}
    };

    fetchWeightings();
    return () => { isMounted = false; };
  }, [activeEtf, fmpApiKey]);

  // --- DERIVED MATH ---
  const isLoaded = sectors.length > 0;
  const greenSectors = sectors.filter(s => s.changesPercentage >= 0).length;
  const redSectors = sectors.filter(s => s.changesPercentage < 0).length;
  const totalSectors = (greenSectors + redSectors) || 11; 
  const breadthHealth = sectors.length === 0 ? 50 : (greenSectors / totalSectors) * 100;

  // 12th Sector Card (Average)
  const displaySectors = [...sectors];
  if (isLoaded && displaySectors.length > 0) {
    const avgPercentage = displaySectors.reduce((acc, curr) => acc + curr.changesPercentage, 0) / displaySectors.length;
    displaySectors.push({ sector: 'Sector Average', changesPercentage: avgPercentage, isSummary: true });
  }

  // Rotation Extractors
  const topSector = sectors.length > 0 ? sectors[0] : null;
  const bottomSector = sectors.length > 0 ? sectors[sectors.length - 1] : null;

  // Max weight for scaling ETF bars perfectly
  const maxEtfWeight = etfWeights.length > 0 ? Math.max(...etfWeights.map(w => w.weightPercentage)) : 100;

  // UI Helpers
  const getSessionTextColor = () => {
    if (session === 'Pre-Market') return 'text-amber-500';
    if (session === 'Open') return 'text-[#00e676]';
    if (session === 'Post-Market') return 'text-indigo-400';
    return 'text-slate-500';
  };

  return (
    <div className="bg-[#0b101a] border border-white/10 rounded-2xl p-6 md:p-8 relative overflow-hidden flex flex-col gap-6 shadow-xl">
      
      <div className="absolute right-0 top-0 w-64 h-64 bg-indigo-500/5 blur-3xl rounded-full -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>
      <div className="absolute left-1/2 bottom-0 w-64 h-64 bg-indigo-500/5 blur-3xl rounded-full translate-y-1/2 -translate-x-1/2 pointer-events-none"></div>

      {/* HEADER CONTAINER - CLICKABLE */}
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex justify-between items-center relative z-10 cursor-pointer group transition-all duration-200 ${isExpanded ? 'border-b border-white/10 pb-4' : ''}`}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs md:text-sm font-bold text-[#7c8bfa] bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 group-hover:bg-white/[0.02] transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
            SECTOR FLOW
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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 relative z-10">
          
          {/* LEFT AREA: Sector Performance (2 columns wide) */}
          <div className="col-span-1 lg:col-span-2 flex flex-col gap-5">
            
            <div className="flex flex-col gap-3">
              {/* 1. Market Rotation Banner */}
              {isLoaded && topSector && bottomSector ? (
                <div className="bg-gradient-to-r from-emerald-500/5 via-white/[0.02] to-rose-500/5 border border-white/5 rounded-xl p-4 flex justify-between items-center shadow-inner">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 hidden sm:flex">
                      <span className="text-emerald-400 text-sm font-medium">↑</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">Leading Sector</span>
                      <span className="text-sm font-semibold text-emerald-400">
                        {topSector.sector} <span className="text-xs opacity-75 font-normal ml-1">+{topSector.changesPercentage.toFixed(2)}%</span>
                      </span>
                    </div>
                  </div>
                  <div className="h-8 w-px bg-white/10 mx-2"></div>
                  <div className="flex items-center gap-3 text-right">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">Lagging Sector</span>
                      <span className="text-sm font-semibold text-rose-400">
                        {bottomSector.sector} <span className="text-xs opacity-75 font-normal ml-1">{bottomSector.changesPercentage > 0 ? '+' : ''}{bottomSector.changesPercentage.toFixed(2)}%</span>
                      </span>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-rose-500/10 flex items-center justify-center border border-rose-500/20 hidden sm:flex">
                      <span className="text-rose-400 text-sm font-medium">↓</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-[74px] bg-[#161c2a]/50 animate-pulse rounded-xl border border-white/5"></div>
              )}

              {/* 2. Breadth Bar */}
              <div className="bg-[#121722] border border-white/5 rounded-xl p-4 flex flex-col gap-2.5 shadow-inner">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] font-bold tracking-widest text-slate-500 uppercase">Participation Breadth</span>
                  <span className="text-xs font-bold text-slate-300">
                    {isLoaded ? `${greenSectors} Up / ${redSectors} Down` : 'Loading...'}
                  </span>
                </div>
                <div className="w-full h-2 bg-black/40 rounded-full overflow-hidden flex shadow-inner">
                  <div className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-1000" style={{ width: `${breadthHealth}%` }}></div>
                  <div className="h-full bg-gradient-to-r from-rose-400 to-rose-600 transition-all duration-1000" style={{ width: `${100 - breadthHealth}%` }}></div>
                </div>
              </div>
            </div>

            {/* 3. 12 Sector Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
              {!isLoaded ? (
                Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="h-12 bg-[#161c2a]/50 animate-pulse rounded-xl border border-white/5"></div>
                ))
              ) : (
                displaySectors.map((sector, idx) => {
                  const isPositive = sector.changesPercentage > 0;
                  const isZero = sector.changesPercentage === 0;
                  const bgTint = isPositive ? 'bg-emerald-500/[0.03]' : isZero ? 'bg-slate-500/[0.02]' : 'bg-rose-500/[0.03]';
                  const borderTint = sector.isSummary 
                    ? 'border-indigo-500/20 shadow-[0_0_10px_rgba(99,102,241,0.05)]' 
                    : (isPositive ? 'border-emerald-500/10' : isZero ? 'border-white/5' : 'border-rose-500/10');

                  return (
                    <div key={idx} className={`flex justify-between items-center ${bgTint} border ${borderTint} rounded-xl p-3.5 hover:bg-white/[0.04] transition-colors group`}>
                      <span className={`text-xs font-semibold truncate pr-2 transition-colors ${sector.isSummary ? 'text-indigo-400/90' : 'text-slate-300 group-hover:text-white'}`} title={sector.sector}>
                        {sector.sector}
                      </span>
                      <span className={`text-xs font-bold px-2 py-1 rounded-md ${isPositive ? 'bg-emerald-500/10 text-emerald-400' : isZero ? 'bg-slate-500/10 text-slate-400' : 'bg-rose-500/10 text-rose-400'}`}>
                        {isPositive ? '+' : ''}{sector.changesPercentage.toFixed(2)}%
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* RIGHT AREA: Unified Insights Panel (1 column wide) */}
          <div className="col-span-1 flex flex-col h-full">
            <div className="bg-[#121722] border border-white/5 rounded-xl p-5 flex flex-col shadow-lg h-full">
              
              {/* Master Toggle */}
              <div className="flex bg-[#161c2a] rounded-lg p-1 mb-5 border border-white/5">
                <button
                  onClick={(e) => { e.stopPropagation(); setActiveTab('INDUSTRIES'); }}
                  className={`flex-1 text-[10px] font-bold tracking-widest uppercase py-2.5 rounded-md transition-all ${
                    activeTab === 'INDUSTRIES' ? 'bg-amber-500/20 text-amber-400 shadow-sm border border-amber-500/20' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  Industries Heat
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setActiveTab('ETF'); }}
                  className={`flex-1 text-[10px] font-bold tracking-widest uppercase py-2.5 rounded-md transition-all ${
                    activeTab === 'ETF' ? 'bg-indigo-500/20 text-indigo-400 shadow-sm border border-indigo-500/20' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  ETF Exposure
                </button>
              </div>

              {/* Dynamic Content Area */}
              <div className="flex-grow flex flex-col justify-start">
                
                {/* TAB 1: TOP INDUSTRIES HEAT */}
                {activeTab === 'INDUSTRIES' && (
                  <div className="flex flex-col gap-3.5 animate-in fade-in duration-500">
                    {!isLoaded ? (
                      Array.from({ length: 10 }).map((_, i) => <div key={i} className="h-8 bg-white/5 animate-pulse rounded-lg"></div>)
                    ) : (
                      industries.map((ind, idx) => {
                        const isPositive = ind.changesPercentage > 0;
                        const isZero = ind.changesPercentage === 0;
                        return (
                          <div key={idx} className="flex justify-between items-center group border-b border-white/[0.02] pb-1.5 last:border-0 last:pb-0">
                            <span className="text-xs font-medium text-slate-300 truncate pr-3 group-hover:text-white transition-colors">{ind.industry}</span>
                            <span className={`text-xs font-bold ${isPositive ? 'text-emerald-400' : isZero ? 'text-slate-400' : 'text-rose-400'}`}>
                              {isPositive ? '+' : ''}{ind.changesPercentage.toFixed(2)}%
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {/* TAB 2: ETF EXPOSURE */}
                {activeTab === 'ETF' && (
                  <div className="flex flex-col gap-4 animate-in fade-in duration-500">
                    <div className="flex gap-2 mb-2">
                      {ETF_TICKERS.map((ticker) => (
                        <button
                          key={ticker}
                          onClick={(e) => { e.stopPropagation(); setActiveEtf(ticker); }}
                          className={`flex-1 py-1.5 rounded text-[11px] font-bold transition-colors ${
                            activeEtf === ticker ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 'bg-white/5 text-slate-400 hover:bg-white/10'
                          }`}
                        >
                          {ticker}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-col gap-3.5">
                      {etfWeights.length === 0 ? (
                        Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-8 bg-white/5 animate-pulse rounded-lg"></div>)
                      ) : (
                        etfWeights.map((item, idx) => (
                          <div key={idx} className="flex flex-col gap-1.5 group">
                            <div className="flex justify-between items-end">
                              <span className="text-xs font-medium text-slate-300 truncate pr-2 group-hover:text-white transition-colors">{item.sector}</span>
                              <span className="text-xs font-bold text-indigo-400">{item.weightPercentage.toFixed(2)}%</span>
                            </div>
                            <div className="w-full h-1.5 bg-black/40 rounded-full overflow-hidden flex">
                              <div className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400 transition-all duration-1000 ease-out" style={{ width: `${Math.max((item.weightPercentage / maxEtfWeight) * 100, 2)}%` }}></div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

              </div>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
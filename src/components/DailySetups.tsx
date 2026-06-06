'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useMarketData } from './MarketDataContext';

// --- INTERFACES ---
interface SetupData {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  vwapStatus: 'above' | 'below' | 'neutral';
  changePct: number;
  vol: number;
  dVol: number;
  rvol: number | null;
  float: number | null;
  shortPct: number | null;
  mktCap: number | null;
  setupCategory: 'MOMENTUM' | 'CONSOLIDATION' | 'SWING PB' | 'VOLATILITY';
  setupName: string;
}

type SortDirection = 'asc' | 'desc';

// --- CONSTANTS & MAPS ---
const SECTOR_MAP: Record<string, string> = {
  'AAPL': 'Consumer Electronics', 'NVDA': 'Semiconductors', 'TSLA': 'Auto Manufacturers', 'MSFT': 'Software',
  'AMZN': 'E-Commerce', 'META': 'Internet Content', 'GOOGL': 'Internet Content', 'AMD': 'Semiconductors',
  'INTC': 'Semiconductors', 'NFLX': 'Entertainment', 'PLTR': 'Software / Data', 'COIN': 'Crypto Exchange',
  'MSTR': 'Bitcoin Proxy', 'SMCI': 'Computer Hardware', 'MARA': 'Bitcoin Mining', 'RIOT': 'Bitcoin Mining',
  'HOOD': 'Capital Markets', 'UBER': 'Ride Sharing', 'AVGO': 'Semiconductors', 'MU': 'Semiconductors',
  'HIMS': 'Healthcare / Telehealth', 'LUNR': 'Aerospace / Space', 'ASTX': 'Biotech', 'SOUN': 'AI Audio',
  'RDDT': 'Social Media', 'DJT': 'Social Media'
};

const ETF_TARGET_MAP: Record<string, string> = {
  'MSTX': 'MSTR 2X', 'MSTU': 'MSTR 2X', 'CONL': 'COIN 2X', 'AMZU': 'AMZN 2X', 'TSLL': 'TSLA 2X', 
  'AAPU': 'AAPL 2X', 'APLX': 'AAPL 2X', 'MSFU': 'MSFT 2X', 'GGLL': 'GOOGL 2X', 'BABX': 'BABA 2X', 
  'LLYX': 'LLY 2X', 'NVDL': 'NVDA 2X', 'NVDX': 'NVDA 2X', 'AMDL': 'AMD 2X', 'AVGX': 'AVGO 2X', 
  'SMU': 'SMCI 2X', 'DLLL': 'DELL 2X', 'MRAL': 'MARA 2X', 'RIOX': 'RIOT 2X', 'LUNL': 'LUNR 2X', 
  'OKLL': 'OKLO 2X', 'PLTU': 'PLTR 2X', 'METU': 'META 2X', 'TEMT': 'META 2X', 'SOFX': 'SOFI 2X', 
  'ROBN': 'HOOD 2X', 'RVNL': 'RIVN 2X', 'LCDL': 'LCID 2X', 'CRWV': 'CRWD 2X', 'CRDU': 'CRWD 2X', 
  'INTW': 'INTC 2X', 'GMEU': 'GME 2X', 'APPX': 'APP 2X', 'SNXX': 'SNOW 2X', 'AXTX': 'AXON 2X', 
  'IONX': 'IONQ 2X', 'QPUX': 'IONQ 2X', 'CEGX': 'CEG 2X', 'ASMG': 'ASML 2X', 'UUUG': 'U 2X', 
  'AAOX': 'AI 2X', 'FBL': 'META 2X', 'HIMZ': 'HIMS 2X', 'RDTL': 'RDDT 2X', 'RKLX': 'RKLB 2X',
  'RCAX': 'RCAT 2X', 'SOUX': 'SOUN 2X', 'ASTX': 'ASTS 2X'
};

// --- HELPERS ---
const cleanSicDescription = (sic: string | undefined) => {
  if (!sic) return null;
  let s = sic.toLowerCase().replace(/^(services|manufacturing|retail|wholesale)-?/g, '').trim();
  if (s.includes('pharmaceutical')) return 'Pharmaceuticals';
  if (s.includes('semiconductor')) return 'Semiconductors';
  if (s.includes('prepackaged software')) return 'Software';
  if (s.includes('real estate investment trusts')) return 'REIT';
  if (s.includes('state commercial banks')) return 'Banking';
  if (s.includes('biological products')) return 'Biotech';
  if (s.includes('crude petroleum')) return 'Oil & Gas';
  if (s.includes('motor vehicles')) return 'Auto Manufacturer';
  if (s.includes('air transportation')) return 'Airlines';
  if (s.includes('telecommunications')) return 'Telecom';
  if (s.includes('electrical machinery') || s.includes('equipment & supplies')) return 'Electrical Equipment';
  return s.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
};

const formatTime = (date: Date) => {
  return date.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit', 
    second: '2-digit',
    timeZone: 'America/New_York'
  });
};

const formatNumber = (num: number | null) => {
  if (num === null || num === 0 || isNaN(num)) return '—';
  if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return num.toLocaleString();
};

const formatCurrency = (num: number | null) => {
  if (num === null || num === 0 || isNaN(num)) return '—';
  if (num >= 1e9) return '$' + (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return '$' + (num / 1e6).toFixed(1) + 'M';
  return '$' + num.toLocaleString();
};

const fetchSafeJson = async (url: string, fallback: any, timeoutMs = 10000) => {
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

// --- ALGORITHMIC PATTERN ENGINE ---
const detectPattern = (bars: any[], currentPrice: number, currentOpen: number, vwap: number): { category: any, name: string } | null => {
  if (!bars || bars.length < 80) return null; 
  
  const yest = bars[1];
  const day3 = bars[2];

  const high3Months = Math.max(...bars.slice(1, 65).map(b => b.h));
  if (currentPrice > high3Months && yest.c <= high3Months && currentPrice >= Math.max(...bars.slice(1, 80).map(b => b.h))) {
    return { category: 'MOMENTUM', name: 'GLB' };
  }

  let sum20 = 0;
  for(let i=0; i<20; i++) sum20 += bars[i].c;
  const sma20 = sum20 / 20;

  let variance = 0;
  for(let i=0; i<20; i++) variance += Math.pow(bars[i].c - sma20, 2);
  const stdDev = Math.sqrt(variance / 20);

  const upperBB = sma20 + (2.0 * stdDev);
  const lowerBB = sma20 - (2.0 * stdDev);

  let sumTR = 0;
  for(let i=0; i<20; i++) {
    const high = bars[i].h;
    const low = bars[i].l;
    const prevClose = bars[i+1] ? bars[i+1].c : low;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    sumTR += tr;
  }
  const avgTR = sumTR / 20;

  const upperKC = sma20 + (1.5 * avgTR);
  const lowerKC = sma20 - (1.5 * avgTR);

  if (upperBB < upperKC && lowerBB > lowerKC) {
    return { category: 'VOLATILITY', name: 'BB SQZ' };
  }

  const getRawK = (idx: number) => {
    const slice = bars.slice(idx, idx + 10);
    const high10 = Math.max(...slice.map(b => b.h));
    const low10 = Math.min(...slice.map(b => b.l));
    if (high10 === low10) return 50; 
    return ((bars[idx].c - low10) / (high10 - low10)) * 100;
  };

  const getSmoothedK = (idx: number) => {
    let sum = 0;
    for (let i = 0; i < 4; i++) sum += getRawK(idx + i);
    return sum / 4;
  };

  const smoothedKArray = [];
  for (let i = 0; i < 11; i++) smoothedKArray.push(getSmoothedK(i));

  const currentK = smoothedKArray[0];
  const prevK = smoothedKArray[1];

  let sumStoch = 0;
  for (let i = 0; i < 10; i++) sumStoch += smoothedKArray[i];
  const stochSma = sumStoch / 10;
  let stochVar = 0;
  for (let i = 0; i < 10; i++) stochVar += Math.pow(smoothedKArray[i] - stochSma, 2);
  const stochStdDev = Math.sqrt(stochVar / 10);
  const currentLowerStochBB = stochSma - (1.0 * stochStdDev);

  let prevSumStoch = 0;
  for (let i = 1; i < 11; i++) prevSumStoch += smoothedKArray[i];
  const prevStochSma = prevSumStoch / 10;
  let prevStochVar = 0;
  for (let i = 1; i < 11; i++) prevStochVar += Math.pow(smoothedKArray[i] - prevStochSma, 2);
  const prevStochStdDev = Math.sqrt(prevStochVar / 10);
  const prevLowerStochBB = prevStochSma - (1.0 * prevStochStdDev);

  if (prevK <= prevLowerStochBB && currentK > currentLowerStochBB) {
    return { category: 'SWING PB', name: 'Blue Dot Rev' };
  }

  if (currentOpen <= yest.c && currentPrice > yest.c) {
    return { category: 'MOMENTUM', name: 'R2G' };
  }

  if (currentOpen > (yest.h * 1.01) && currentPrice >= currentOpen) {
    return { category: 'MOMENTUM', name: 'Gap & Go' };
  }

  if (yest.h < day3.h && yest.l > day3.l && currentPrice > yest.h) {
    return { category: 'CONSOLIDATION', name: 'Inside Day BRK' };
  }

  if (currentPrice > sma20 && yest.l <= (sma20 * 1.02) && currentPrice > yest.h) {
    return { category: 'SWING PB', name: '20 EMA PB' };
  }

  if (currentPrice > sma20 && currentPrice > vwap) {
    return { category: 'MOMENTUM', name: 'Trend Hold' };
  }

  return null;
};

export default function DailySetups() {
  const { sipsUniverse, session, lastUpdated: contextLastUpdated, isLoading: isContextLoading } = useMarketData();
  
  const [setups, setSetups] = useState<SetupData[]>([]);
  const [status, setStatus] = useState<string>('Offline');
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [sortConfig, setSortConfig] = useState<{ key: keyof SetupData; direction: SortDirection } | null>(null);

  // --- COLLAPSE STATE ---
  const [isExpanded, setIsExpanded] = useState<boolean>(true);

  const polygonApiKey = process.env.NEXT_PUBLIC_POLYGON_API_KEY || '';

  useEffect(() => {
    let isMounted = true;

    if (!polygonApiKey || sipsUniverse.length === 0) {
      if (isMounted) {
        setIsScanning(false);
        setStatus(isContextLoading ? 'Syncing...' : 'Offline');
      }
      return;
    }

    const runStructuralEnrichment = async () => {
      if (isMounted) {
        setIsScanning(true);
        setStatus('Scanning Technicals...');
      }

      try {
        const today = new Date();
        const lookbackDate = new Date();
        lookbackDate.setDate(today.getDate() - 150); 
        const toStr = today.toISOString().split('T')[0];
        const fromStr = lookbackDate.toISOString().split('T')[0];

        // PHASE 1: Fetch ONLY the daily bars for the whole universe (protects rate limits)
        const aggsData: any[] = [];
        const chunkSize = 15;
        
        for (let i = 0; i < sipsUniverse.length; i += chunkSize) {
          const chunk = sipsUniverse.slice(i, i + chunkSize);
          const chunkPromises = chunk.map(async (t: any) => {
            const sym = t.ticker;
            const aggs = await fetchSafeJson(`https://api.massive.com/v2/aggs/ticker/${sym}/range/1/day/${fromStr}/${toStr}?adjusted=true&sort=desc&limit=100&apiKey=${polygonApiKey}`, { results: [] });
            return { sym, t, aggs };
          });
          
          const chunkResults = await Promise.all(chunkPromises);
          aggsData.push(...chunkResults);
          
          await new Promise(r => setTimeout(r, 150)); 
        }

        if (isMounted) setStatus('Analyzing Patterns...');

        // PHASE 2: Detect patterns BEFORE fetching heavy detail/short payloads
        const preliminarySetups: any[] = [];
        
        aggsData.forEach(({ sym, t, aggs }) => {
          const currentPrice = t.day?.c || t.min?.c || 0;
          const currentOpen = t.day?.o || currentPrice;
          const vwap = t.day?.vw || currentPrice;
          const dailyBars = aggs.results || [];
          
          const setupMatched = detectPattern(dailyBars, currentPrice, currentOpen, vwap);
          if (setupMatched) {
            preliminarySetups.push({ sym, t, dailyBars, setupMatched, currentPrice, vwap, currentOpen });
          }
        });

        if (preliminarySetups.length === 0) {
          if (isMounted) {
            setSetups([]);
            setStatus('Live');
            setIsScanning(false);
          }
          return;
        }

        if (isMounted) setStatus('Enriching Matches...');

        // PHASE 3: Fetch Details/Short data ONLY for the matches
        const detectedSetups: SetupData[] = [];
        const setupsToEnrich = preliminarySetups.slice(0, 20); // Cap at 20 to keep UI clean
        
        for (let i = 0; i < setupsToEnrich.length; i += 5) {
          const chunk = setupsToEnrich.slice(i, i + 5);
          const chunkPromises = chunk.map(async ({ sym, t, dailyBars, setupMatched, currentPrice, vwap }) => {
            
            const [details, shortData] = await Promise.all([
              fetchSafeJson(`https://api.massive.com/v3/reference/tickers/${sym}?apiKey=${polygonApiKey}`, {}),
              fetchSafeJson(`https://api.massive.com/stocks/v1/short-interest?ticker=${sym}&apiKey=${polygonApiKey}`, { results: [] }) 
            ]);

            const marketCap = details?.results?.market_cap || 0;
            const companyName = details?.results?.name || details?.name || sym;

            const chgPct = t.todaysChangePerc || 0;
            const vol = t.day?.v || 0;
            const dVol = vol * vwap;
            
            let vwapStatus: 'above' | 'below' | 'neutral' = 'neutral';
            if (vwap > 0 && currentPrice > 0) {
              vwapStatus = currentPrice >= vwap ? 'above' : 'below';
            }

            const float = details?.results?.share_class_shares_outstanding || (marketCap && currentPrice ? marketCap / currentPrice : null);
            let shortPct = null;
            if (shortData?.results && shortData.results.length > 0 && float) {
                const shortShares = shortData.results[0].short_interest || 0;
                shortPct = (shortShares / float) * 100;
            }

            const apiSector = cleanSicDescription(details?.results?.sic_description);
            const deepSector = ETF_TARGET_MAP[sym] || SECTOR_MAP[sym] || apiSector || 'Equity';

            let sumVol = 0;
            let barCount = 0;
            dailyBars.forEach((bar: any) => {
              if (bar.v) { sumVol += bar.v; barCount++; }
            });
            const avgVol = barCount > 0 ? sumVol / barCount : 0;
            const rvol = (avgVol > 0 && vol > 0) ? (vol / avgVol) : null;

            return {
              ticker: sym,
              name: companyName,
              sector: deepSector,
              price: currentPrice,
              vwapStatus: vwapStatus,
              changePct: chgPct,
              vol: vol,
              dVol: dVol,
              rvol: rvol,
              float: float,
              shortPct: shortPct,
              mktCap: marketCap,
              setupCategory: setupMatched.category,
              setupName: setupMatched.name
            };
          });

          const enrichedResults = await Promise.all(chunkPromises);
          
          // Final cleanup filter -> Require 20M Market Cap floor
          const validEnriched = enrichedResults.filter(r => r.mktCap >= 20000000);
          detectedSetups.push(...validEnriched);

          await new Promise(r => setTimeout(r, 100)); 
        }

        if (isMounted) {
          setSetups(detectedSetups.slice(0, 15));
          setStatus('Live');
          setIsScanning(false);
        }

      } catch (error) {
        if (isMounted) {
          setStatus('Offline');
          setIsScanning(false);
        }
      }
    };
    
    runStructuralEnrichment();

    return () => { isMounted = false; };
  }, [sipsUniverse, polygonApiKey]);

  // --- SORTING LOGIC ---
  const handleSort = (key: keyof SetupData) => {
    let direction: SortDirection = 'desc'; 
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') direction = 'asc';
    else if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') { setSortConfig(null); return; }
    setSortConfig({ key, direction });
  };

  const sortedSetups = useMemo(() => {
    if (!sortConfig) return setups;
    return [...setups].sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [setups, sortConfig]);

  const getSortIcon = (columnKey: keyof SetupData) => {
    if (sortConfig?.key !== columnKey) return '';
    return sortConfig.direction === 'asc' ? ' ↑' : ' ↓';
  };

  const getCategoryBadge = (category: SetupData['setupCategory']) => {
    switch (category) {
      case 'MOMENTUM': return 'text-rose-400 bg-rose-500/10 border-rose-500/20';
      case 'CONSOLIDATION': return 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20';
      case 'SWING PB': return 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20';
      case 'VOLATILITY': return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
      default: return 'text-slate-400 bg-slate-500/10 border-slate-500/20';
    }
  };

  const getSessionTextColor = () => {
    if (session === 'Pre-Market') return 'text-amber-500';
    if (session === 'Open') return 'text-[#00e676]';
    if (session === 'Post-Market') return 'text-indigo-400';
    return 'text-slate-500';
  };
  
  const getRvolColor = (rvol: number | null) => {
    if (!rvol) return 'text-slate-500';
    if (rvol >= 3) return 'text-amber-400';
    if (rvol >= 1.5) return 'text-emerald-400';
    return 'text-slate-300';
  };

  const getFloatColor = (float: number | null) => {
    if (!float) return 'text-slate-500';
    if (float <= 20000000) return 'text-purple-400'; 
    if (float <= 50000000) return 'text-emerald-400';
    return 'text-slate-300';
  };

  const getShortColor = (short: number | null) => {
    if (!short) return 'text-slate-500';
    if (short >= 20) return 'text-purple-400'; 
    if (short >= 10) return 'text-emerald-400';
    return 'text-slate-300';
  };

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
            DAILY TIME-FRAME SETUPS
          </span>
        </div>

        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-center justify-center border border-white/5 bg-[#161c2a]/40 px-4 py-1.5 rounded-[10px] min-w-[120px]">
            <span className={`text-[10px] font-bold tracking-widest uppercase ${status === 'Live' ? getSessionTextColor() : 'text-slate-500'}`}>
              {status === 'Live' ? session : status}
            </span>
          </div>
          {contextLastUpdated && (
             <span className="text-[11px] text-slate-400/80 font-medium px-1 tracking-wide">
               Updated: {formatTime(contextLastUpdated)} EST
             </span>
          )}
        </div>
      </div>

      {/* COLLAPSIBLE CONTENT */}
      {isExpanded && (
        <>
          <div className="flex justify-end mb-4 relative z-10">
            <div className="flex items-center gap-4 px-3 py-1.5 bg-[#161c2a] border border-white/5 rounded-lg shrink-0">
              <span className="text-[9px] font-bold tracking-widest uppercase text-slate-500">VWAP</span>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400"></div>
                  <span className="text-[10px] font-medium text-slate-400">Above</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-rose-500"></div>
                  <span className="text-[10px] font-medium text-slate-400">Below</span>
                </div>
              </div>
            </div>
          </div>
          
          <div className="overflow-x-auto custom-scrollbar relative z-10" style={{ scrollbarWidth: 'none' }}>
            <table className="w-full min-w-[1100px] border-collapse">
              <thead>
                <tr className="border-b border-white/5 select-none">
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[7%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('ticker')}>
                    TICKER{getSortIcon('ticker')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[11%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('sector')}>
                    SECTOR{getSortIcon('sector')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[7%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('price')}>
                    PRICE{getSortIcon('price')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[7%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('changePct')}>
                    CHG%{getSortIcon('changePct')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[6%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('vol')}>
                    VOL{getSortIcon('vol')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[7%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('dVol')}>
                    $VOL{getSortIcon('dVol')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[5%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('rvol')}>
                    RVOL{getSortIcon('rvol')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[6%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('float')}>
                    FLOAT{getSortIcon('float')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[6%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('shortPct')}>
                    SHT%{getSortIcon('shortPct')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[6%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('mktCap')}>
                    MCAP{getSortIcon('mktCap')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[11%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('setupCategory')}>
                    STRATEGY{getSortIcon('setupCategory')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[21%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('setupName')}>
                    CHART PATTERN{getSortIcon('setupName')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {isContextLoading || isScanning ? (
                  <tr>
                    <td colSpan={12} className="py-12 text-center">
                      <div className="flex flex-col items-center justify-center gap-3">
                        <div className="w-5 h-5 border-2 border-indigo-500/20 border-t-indigo-400 rounded-full animate-spin"></div>
                        <span className="text-xs text-slate-500 font-medium">Scanning Market Data...</span>
                      </div>
                    </td>
                  </tr>
                ) : setups.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="py-12 text-center text-slate-500 text-sm font-medium">
                      No high-probability setups detected.
                    </td>
                  </tr>
                ) : (
                  sortedSetups.map((row, i) => {
                    const isPositive = row.changePct >= 0;
                    
                    return (
                      <tr key={i} className="hover:bg-white/[0.02] transition-colors group">
                        
                        {/* TICKER CELL WITH CUSTOM COMPANY NAME TOOLTIP */}
                        <td className="py-3" style={{ textAlign: 'left', paddingLeft: '12px' }}>
                          <div className="relative inline-flex items-center group/ticker">
                            <span className="inline-block bg-indigo-500/10 text-indigo-400 text-[11px] font-bold px-2 py-0.5 rounded border border-indigo-500/20 cursor-help">
                              {row.ticker}
                            </span>
                            {/* POP-OUT TOOLTIP */}
                            <div className="absolute left-full ml-3 px-3 py-1.5 bg-[#1e293b] border border-white/10 text-slate-200 text-xs font-semibold tracking-wide rounded-md shadow-2xl opacity-0 invisible group-hover/ticker:opacity-100 group-hover/ticker:visible transition-all z-50 whitespace-nowrap pointer-events-none">
                              {row.name}
                            </div>
                          </div>
                        </td>

                        <td className="py-3 text-xs text-slate-400 font-medium whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '12px' }}>
                          <div className="truncate max-w-[120px]" title={row.sector}>
                            {row.sector}
                          </div>
                        </td>
                        
                        <td className="py-3 text-xs text-slate-300 font-medium whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '12px' }}>
                          <div className="flex items-center gap-1.5">
                            ${row.price.toFixed(2)}
                            {row.vwapStatus !== 'neutral' && (
                              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${row.vwapStatus === 'above' ? 'bg-emerald-400' : 'bg-rose-500'}`} title={row.vwapStatus === 'above' ? 'Price Above VWAP' : 'Price Below VWAP'}></div>
                            )}
                          </div>
                        </td>

                        <td className={`py-3 text-xs font-bold whitespace-nowrap ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`} style={{ textAlign: 'left', paddingLeft: '12px' }}>
                          {isPositive ? '+' : ''}{row.changePct.toFixed(2)}%
                        </td>

                        <td className="py-3 text-xs text-slate-400 font-medium whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '12px' }}>
                          {formatNumber(row.vol)}
                        </td>

                        <td className="py-3 text-xs text-slate-400 font-medium whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '12px' }}>
                          {formatCurrency(row.dVol)}
                        </td>
                        
                        <td className={`py-3 text-xs font-bold whitespace-nowrap ${getRvolColor(row.rvol)}`} style={{ textAlign: 'left', paddingLeft: '12px' }}>
                          {row.rvol ? `${row.rvol.toFixed(1)}x` : '—'}
                        </td>

                        <td className={`py-3 text-xs font-bold whitespace-nowrap ${getFloatColor(row.float)}`} style={{ textAlign: 'left', paddingLeft: '12px' }}>
                          {formatNumber(row.float)}
                        </td>

                        <td className={`py-3 text-xs font-bold whitespace-nowrap ${getShortColor(row.shortPct)}`} style={{ textAlign: 'left', paddingLeft: '12px' }}>
                          {row.shortPct ? `${row.shortPct.toFixed(1)}%` : '—'}
                        </td>

                        <td className="py-3 text-xs text-slate-400 font-medium whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '12px' }}>
                          {formatNumber(row.mktCap)}
                        </td>

                        <td className="py-3" style={{ textAlign: 'left', paddingLeft: '12px' }}>
                          <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border inline-block ${getCategoryBadge(row.setupCategory)}`}>
                            {row.setupCategory}
                          </span>
                        </td>
                        
                        <td className="py-3 text-xs text-slate-200 font-semibold truncate max-w-[280px]" style={{ textAlign: 'left', paddingLeft: '12px' }}>
                          <div className="flex items-center gap-1.5">
                            {row.setupName === 'Blue Dot Rev' && (
                              <div className="w-2 h-2 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.8)]" title="Blue Dot Reversal Triggered"></div>
                            )}
                            <span>{row.setupName}</span>
                          </div>
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
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useMarketData } from './MarketDataContext';

// --- INTERFACES ---
interface StockData {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  vwapStatus: 'above' | 'below' | 'neutral';
  changesPercentage: number;
  volume: number | null;
  dollarVolume: number | null;
  rvol: number | null;
  mktCap: number | null;
  float: number | null;
  shortPct: number | null;
  catalyst: string | null;
  catalystTag: { label: string; color: string } | null;
  catalystUrl: string | null;
}

type TabType = 'Mega Caps' | 'Gainers' | 'Losers' | 'ETF Gainers' | 'ETF Losers';
type SortDirection = 'asc' | 'desc';

// --- WATCHLISTS ---
const FALLBACK_ETFS = [
  'SPY','QQQ','IWM','DIA','VOO','VTI','TQQQ','SQQQ','SOXL','SOXS',
  'ARKK','XLF','XLE','XLK','XLV','XLI','XLY','XLP','XLU','XLB',
  'XLRE','VNQ','GLD','SLV','TLT','HYG','LQD','EEM','EFA','VXX',
  'UVXY','TNA','TZA','FAS','FAZ','KRE','KBE','XBI','IBB','SMH',
  'XRT','XHB','XOP','OIH','GDX','GDXJ','URNM','URA','BITO','IBIT',
  'QQQM','SCHD','JEPI','JEPQ','TLH','IEF','SHY','BND','AGG','MUB',
  'RDTL','MSOX','LLYX','HIMZ','NAIL','PLTU','METU','TEMT','FBL','APPX',
  'GMEU','SOFX','HIMS','GGLL','MSTX','ROBN','MSTU','AMZU','SOUX','NFLX',
  'RCAX','MSFU','RKLX','BMNU','AAPU','ETHZ','LCDL','TSLL','BABX','SNXX',
  'RVNL','AXTX','CONL','NVDL','NVDX','ETU','CEGX','ASTX','LUNR','ETHU',
  'ZSL','URAA','ASMG','ARCX','CRWV','IONX','XRPT','BITX','LUNL','OKLL',
  'SOLT','INTW','SMU','DLLL','GDXD','UUUG','RIOX','QPUX','FNGU','CRDU',
  'MRAL','APLX','TECL','RGTX','RGTU','AAOX','LABX','AMDL','KORU','AVGX'
].join(',');

const MEGA_CAPS = [
  'AAPL','NVDA','TSLA','MSFT','AMZN','META','GOOGL','AMD','INTC',
  'NFLX','PLTR','COIN','MSTR','SMCI','MARA','RIOT','HOOD','UBER','AVGO','MU'
].join(',');

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
  'RCAX': 'RCAT 2X', 'SOUX': 'SOUN 2X', 'ASTX': 'ASTS 2X',
  'BITX': 'BTC 2X', 'IBIT': 'BTC', 'BITO': 'BTC', 'ETHU': 'ETH 2X', 'ETHZ': 'ETH 2X', 
  'ETU': 'ETH 2X', 'SOLT': 'SOL 2X', 'XRPT': 'XRP',
  'TQQQ': 'QQQ 3X', 'SQQQ': 'QQQ -3X', 'SOXL': 'SOXX 3X', 'SOXS': 'SOXX -3X', 'TECL': 'XLK 3X',
  'FNGU': 'Big Tech 3X', 'TNA': 'IWM 3X', 'TZA': 'IWM -3X', 'FAS': 'XLF 3X', 'FAZ': 'XLF -3X',
  'MSOX': 'MSOS 2X', 'NAIL': 'XHB 3X', 'LABX': 'XBI 2X', 'KORU': 'EWY 3X', 'ZSL': 'Silver -2X',
  'URAA': 'URA 2X', 'GDXD': 'GDX -3X', 'SPY': 'SPX', 'QQQ': 'NDX', 'IWM': 'RUT', 
  'DIA': 'DJI', 'VOO': 'SPX', 'VTI': 'Total Market'
};

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

const getCatalystTag = (site: string | undefined, title: string | undefined) => {
  const sStr = (site || '').toLowerCase();
  const tStr = (title || '').toLowerCase();
  if (sStr.includes('analyst') || /upgrade|downgrade|price target/i.test(tStr)) return { label: 'ANALYST', color: 'text-purple-400 bg-purple-500/10 border-purple-500/20' };
  if (sStr.includes('earnings') || /earn|q[1-4]|revenue|eps/i.test(tStr)) return { label: 'EARNINGS', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' };
  if (sStr.includes('fda') || sStr.includes('biotech') || /fda|clinical|trial/i.test(tStr)) return { label: 'BIOTECH', color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20' };
  if (sStr.includes('m&a') || sStr.includes('merger') || /buyout|takeover/i.test(tStr)) return { label: 'M&A', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' };
  if (site) return { label: site.substring(0, 10).toUpperCase(), color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' };
  return { label: 'NEWS', color: 'text-slate-400 bg-slate-500/10 border-slate-500/20' };
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

export default function TopMovers() {
  const { session } = useMarketData();
  
  const [activeTab, setActiveTab] = useState<TabType>('Mega Caps');
  const [stocks, setStocks] = useState<StockData[]>([]);
  const [status, setStatus] = useState<string>('Offline');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: keyof StockData; direction: SortDirection } | null>(null);

  // --- COLLAPSE STATE ---
  const [isExpanded, setIsExpanded] = useState<boolean>(true);

  const polygonApiKey = process.env.NEXT_PUBLIC_POLYGON_API_KEY || '';
  const isEtfTab = activeTab.includes('ETF');

  useEffect(() => { setSortConfig(null); }, [activeTab]);

  useEffect(() => {
    let isMounted = true;
    if (!polygonApiKey) { setStatus('Offline'); return; }

    const fetchMarketData = async () => {
      try {
        setStatus(`Scouting...`);
        
        let targetUrl = '';
        let isV3Engine = false;
        
        if (activeTab === 'Gainers') targetUrl = `https://api.massive.com/v2/snapshot/locale/us/markets/stocks/gainers?apiKey=${polygonApiKey}`;
        else if (activeTab === 'Losers') targetUrl = `https://api.massive.com/v2/snapshot/locale/us/markets/stocks/losers?apiKey=${polygonApiKey}`;
        else if (activeTab === 'Mega Caps') { isV3Engine = true; targetUrl = `https://api.massive.com/v3/snapshot?ticker.any_of=${MEGA_CAPS}&limit=250&apiKey=${polygonApiKey}`; }
        else { isV3Engine = true; targetUrl = `https://api.massive.com/v3/snapshot?ticker.any_of=${FALLBACK_ETFS}&limit=250&apiKey=${polygonApiKey}`; }

        const snapshotData = await fetchSafeJson(targetUrl, { results: [], tickers: [] });
        let rawTickers = isV3Engine ? (snapshotData.results || []) : (snapshotData.tickers || []);

        if (rawTickers.length === 0) { if (isMounted) setStatus('No Valid Data Found'); return; }

        rawTickers = rawTickers.map((t: any) => {
           const symbol = t.ticker || t.single_ticker || '';
           const dayClose = t.day?.c || t.session?.close || t.min?.c || 0;
           const prevClose = t.prevDay?.c || t.session?.previous_close || 0;
           let chg = t.todaysChangePerc || t.session?.change_percent || 0;
           if (chg === 0 && prevClose > 0) chg = ((dayClose - prevClose) / prevClose) * 100;
           
           const vwap = t.day?.vw || t.session?.vwap || 0;
           let vwapStatus: 'above' | 'below' | 'neutral' = 'neutral';
           if (vwap > 0 && dayClose > 0) {
             vwapStatus = dayClose >= vwap ? 'above' : 'below';
           }

           return { ...t, normalizedTicker: symbol, smartChg: chg, computedPrice: dayClose, computedVwapStatus: vwapStatus };
        })
        .filter((t: any) => t.computedPrice >= 1.0); 

        if (activeTab === 'Gainers' || activeTab === 'ETF Gainers') {
           rawTickers = rawTickers.filter((t: any) => t.smartChg > 0).sort((a: any, b: any) => b.smartChg - a.smartChg); 
        } else if (activeTab === 'Losers' || activeTab === 'ETF Losers') {
           rawTickers = rawTickers.filter((t: any) => t.smartChg < 0).sort((a: any, b: any) => a.smartChg - b.smartChg);
        } else if (activeTab === 'Mega Caps') {
           rawTickers = rawTickers.sort((a: any, b: any) => {
             const volA = a.session?.volume || a.day?.v || 0;
             const volB = b.session?.volume || b.day?.v || 0;
             return volB - volA;
           });
        }

        const topTickersCandidate = rawTickers.slice(0, 50);

        if (topTickersCandidate.length === 0) { if (isMounted) setStatus('No Valid Data Found'); return; }

        setStatus('Enriching...');

        const today = new Date();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(today.getDate() - 45); 
        const toStr = today.toISOString().split('T')[0];
        const fromStr = thirtyDaysAgo.toISOString().split('T')[0];

        const enrichments: any[] = [];
        const chunkSize = 5; 
        
        for (let i = 0; i < topTickersCandidate.length; i += chunkSize) {
            const chunk = topTickersCandidate.slice(i, i + chunkSize);
            const chunkPromises = chunk.map(async (item: any) => {
                const sym = item.normalizedTicker;
                const price = item.computedPrice || 0;

                const [details, aggs, newsData, shortData] = await Promise.all([
                    fetchSafeJson(`https://api.massive.com/v3/reference/tickers/${sym}?apiKey=${polygonApiKey}`, {}),
                    fetchSafeJson(`https://api.massive.com/v2/aggs/ticker/${sym}/range/1/day/${fromStr}/${toStr}?adjusted=true&sort=desc&limit=30&apiKey=${polygonApiKey}`, { results: [] }),
                    fetchSafeJson(`https://api.massive.com/v2/reference/news?ticker=${sym}&limit=10&apiKey=${polygonApiKey}`, { results: [] }),
                    fetchSafeJson(`https://api.massive.com/stocks/v1/short-interest?ticker=${sym}&apiKey=${polygonApiKey}`, { results: [] })
                ]);

                const mktCap = details.results?.market_cap || null;
                const name = details.results?.name || sym;
                const apiSector = cleanSicDescription(details.results?.sic_description);
                const specificNews = newsData.results || [];
                
                let avgVol = 0;
                if (aggs.results && aggs.results.length > 0) {
                    let totalVol = 0;
                    aggs.results.forEach((b: any) => totalVol += (b.v || 0));
                    avgVol = totalVol / aggs.results.length;
                }

                const float = details.results?.share_class_shares_outstanding || (mktCap && price ? mktCap / price : null);
                let shortPct = null;
                if (shortData.results && shortData.results.length > 0 && float) {
                    const shortShares = shortData.results[0].short_interest || 0;
                    shortPct = (shortShares / float) * 100;
                }

                return { ticker: sym, mktCap, float, shortPct, avgVol, name, apiSector, specificNews };
            });
            
            const chunkResults = await Promise.all(chunkPromises);
            enrichments.push(...chunkResults);
            
            await new Promise(r => setTimeout(r, 200)); 
        }

        if (isMounted) {
          let mergedList = topTickersCandidate.map((item: any) => {
            const sym = item.normalizedTicker;
            const enriched = enrichments.find((e: any) => e.ticker === sym);
            
            const newsList = enriched?.specificNews || [];
            let relatedNews = null;
            let finalCatalyst = null;
            let finalTag = null;
            let finalCatalystUrl = null;

            if (newsList.length > 0) {
               relatedNews = newsList.find((n: any) => {
                 const pub = (n.publisher?.name || '').toLowerCase();
                 return pub.includes('benzinga') || pub.includes('massive') || pub.includes('yahoo') || pub.includes('google');
               }) || newsList[0];

               if (relatedNews) {
                 const pubDate = relatedNews.published_utc;
                 let fDate = '';
                 if (pubDate) {
                    const d = new Date(pubDate);
                    const isToday = d.toDateString() === new Date().toDateString();
                    const timePart = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                    fDate = isToday ? timePart : `${d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })} ${timePart}`;
                 }
                 finalCatalyst = fDate ? `${fDate} — ${relatedNews.title}` : relatedNews.title;
                 finalTag = getCatalystTag(relatedNews.publisher?.name, relatedNews.title);
                 finalCatalystUrl = relatedNews.article_url || null;
               }
            }
            
            const price = item.computedPrice || 0;
            const liveVolume = item.day?.v || item.session?.volume || 0;
            const chgPct = item.smartChg || 0;
            const vwap = item.day?.vw || item.session?.vwap || price;
            const liveDollarVol = liveVolume > 0 ? liveVolume * vwap : null;
            
            let realRvol = null;
            const avgVol = enriched?.avgVol || 0;
            if (avgVol > 0 && liveVolume > 0) realRvol = liveVolume / avgVol;
            
            let deepSector = '';
            if (isEtfTab) deepSector = ETF_TARGET_MAP[sym] || SECTOR_MAP[sym] || 'ETF';
            else deepSector = SECTOR_MAP[sym] || enriched?.apiSector || 'Equity';
            
            return {
              symbol: sym,
              name: enriched?.name || sym, 
              sector: deepSector, 
              price: price,
              vwapStatus: item.computedVwapStatus,
              changesPercentage: chgPct,
              volume: liveVolume > 0 ? liveVolume : null,
              dollarVolume: liveDollarVol,
              rvol: realRvol ? parseFloat(realRvol.toFixed(2)) : null,
              mktCap: enriched?.mktCap || null,
              float: enriched?.float || null,
              shortPct: enriched?.shortPct || null,
              catalyst: finalCatalyst,
              catalystTag: finalTag,
              catalystUrl: finalCatalystUrl
            };
          });

          mergedList = mergedList.filter((item: StockData) => {
              if (!isEtfTab) {
                  return item.mktCap === null || item.mktCap >= 10000000;
              }
              return true;
          }).slice(0, 20); 

          setStocks(mergedList);
          setLastUpdated(new Date());
          setStatus('Live'); 
        }
      } catch (error: any) {
        if (isMounted) setStatus('Offline');
      }
    };

    fetchMarketData();
    const interval = setInterval(fetchMarketData, 60000);
    return () => { isMounted = false; clearInterval(interval); };
  }, [activeTab, polygonApiKey]);

  const handleSort = (key: keyof StockData) => {
    let direction: SortDirection = 'desc'; 
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') direction = 'asc';
    else if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') { setSortConfig(null); return; }
    setSortConfig({ key, direction });
  };

  const sortedStocks = useMemo(() => {
    if (!sortConfig) return stocks;
    return [...stocks].sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [stocks, sortConfig]);

  const isLoading = status.includes('Scouting') || status.includes('Enriching') || status.includes('Connecting');
  const getSortIcon = (columnKey: keyof StockData) => sortConfig?.key === columnKey ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓') : '';

  const getSessionTextColor = () => {
    if (session === 'Pre-Market') return 'text-amber-500';
    if (session === 'Open') return 'text-[#00e676]';
    if (session === 'Post-Market') return 'text-indigo-400';
    return 'text-slate-500';
  };

  const getRvolColor = (rvol: number | null) => {
    if (!rvol) return 'text-slate-500';
    if (rvol >= 2) return 'text-amber-400';
    if (rvol >= 1.5) return 'text-emerald-400';
    return 'text-slate-500';
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
    <div className="bg-[#101623] border border-white/5 rounded-2xl p-5 md:p-8 relative overflow-hidden shadow-xl w-full">
      
      {/* HEADER CONTAINER - CLICKABLE */}
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex justify-between items-center relative z-10 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-6 border-b border-white/5 pb-4' : ''}`}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs md:text-sm font-bold text-[#7c8bfa] bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 group-hover:bg-white/[0.02] transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
            TOP MOVERS
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
        <>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 relative z-10 pb-2">
            <div className="flex gap-3 overflow-x-auto custom-scrollbar w-full md:w-auto" style={{ scrollbarWidth: 'none' }}>
              {(['Mega Caps', 'Gainers', 'Losers', 'ETF Gainers', 'ETF Losers'] as TabType[]).map((tab) => (
                <button
                  key={tab}
                  onClick={(e) => { e.stopPropagation(); setActiveTab(tab); }}
                  className={`px-5 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-all duration-300 ${
                    activeTab === tab 
                      ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.1)]' 
                      : 'bg-[#161c2a] text-slate-400 border border-white/5 hover:bg-white/[0.04]'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

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
          
          <div className="overflow-x-auto custom-scrollbar" style={{ scrollbarWidth: 'none' }}>
            <table className="w-full min-w-[1200px] border-collapse">
              <thead>
                <tr className="border-b border-white/5 select-none">
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[6%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('symbol')}>
                    TICKER{getSortIcon('symbol')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[10%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('sector')}>
                    {isEtfTab ? 'ETF' : 'SECTOR'}{getSortIcon('sector')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[6%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('price')}>
                    PRICE{getSortIcon('price')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[6%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('changesPercentage')}>
                    CHG%{getSortIcon('changesPercentage')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[6%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('volume')}>
                    VOL{getSortIcon('volume')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[7%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('dollarVolume')}>
                    $VOL{getSortIcon('dollarVolume')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[5%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('rvol')}>
                    RVOL{getSortIcon('rvol')}
                  </th>
                  {!isEtfTab && (
                    <>
                      <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[6%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('float')}>
                        FLOAT{getSortIcon('float')}
                      </th>
                      <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[6%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('shortPct')}>
                        SHT%{getSortIcon('shortPct')}
                      </th>
                      <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[6%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '12px' }} onClick={() => handleSort('mktCap')}>
                        MCAP{getSortIcon('mktCap')}
                      </th>
                    </>
                  )}
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[36%]" style={{ textAlign: 'left', paddingLeft: '50px' }}>
                    CATALYST
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {isLoading && stocks.length === 0 ? (
                  <tr>
                    <td colSpan={isEtfTab ? 8 : 11} className="py-12 text-center">
                      <div className="w-5 h-5 border-2 border-indigo-500/20 border-t-indigo-400 rounded-full animate-spin mx-auto mb-3"></div>
                      <span className="text-xs text-slate-500 font-medium">Scanning Market Movers...</span>
                    </td>
                  </tr>
                ) : stocks.length === 0 ? (
                  <tr>
                    <td colSpan={isEtfTab ? 8 : 11} className="py-12 text-center text-slate-500 text-sm font-medium">
                      No tracking instruments currently found matching criteria.
                    </td>
                  </tr>
                ) : (
                  sortedStocks.map((row, i) => {
                    const isPositive = row.changesPercentage > 0;
                    
                    return (
                      <tr key={i} className="hover:bg-white/[0.02] transition-colors group">
                        
                        {/* TICKER CELL WITH CUSTOM COMPANY NAME TOOLTIP */}
                        <td className="py-3" style={{ textAlign: 'left', paddingLeft: '12px' }}>
                          <div className="relative inline-flex items-center group/ticker">
                            <span className="inline-block bg-indigo-500/10 text-[#7c8bfa] text-[11px] font-bold px-2 py-0.5 rounded border border-indigo-500/20 cursor-help">
                              {row.symbol}
                            </span>
                            {/* POP-OUT TOOLTIP WITH FAILSAFE */}
                            <div className="absolute left-full ml-3 px-3 py-1.5 bg-[#1e293b] border border-white/10 text-slate-200 text-xs font-semibold tracking-wide rounded-md shadow-2xl opacity-0 invisible group-hover/ticker:opacity-100 group-hover/ticker:visible transition-all z-[60] whitespace-nowrap pointer-events-none">
                              {row.name || row.symbol}
                            </div>
                          </div>
                        </td>

                        <td className="py-3 text-xs text-slate-400 font-medium whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '12px' }}>
                          <div className="truncate max-w-[150px]" title={row.sector || ''}>
                            {row.sector || '—'}
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
                          {isPositive ? '+' : ''}{row.changesPercentage.toFixed(2)}%
                        </td>
                        <td className="py-3 text-xs text-slate-400 font-medium whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '12px' }}>
                          {formatNumber(row.volume)}
                        </td>
                        <td className="py-3 text-xs text-slate-400 font-medium whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '12px' }}>
                          {formatCurrency(row.dollarVolume)}
                        </td>
                        <td className={`py-3 text-xs font-bold whitespace-nowrap ${getRvolColor(row.rvol)}`} style={{ textAlign: 'left', paddingLeft: '12px' }}>
                          {row.rvol ? `${row.rvol.toFixed(1)}x` : '—'}
                        </td>
                        {!isEtfTab && (
                          <>
                            <td className={`py-3 text-xs font-bold whitespace-nowrap ${getFloatColor(row.float)}`} style={{ textAlign: 'left', paddingLeft: '12px' }}>
                              {formatNumber(row.float)}
                            </td>
                            <td className={`py-3 text-xs font-bold whitespace-nowrap ${getShortColor(row.shortPct)}`} style={{ textAlign: 'left', paddingLeft: '12px' }}>
                              {row.shortPct ? `${row.shortPct.toFixed(1)}%` : '—'}
                            </td>
                            <td className="py-3 text-xs text-slate-400 font-medium whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '12px' }}>
                              {formatNumber(row.mktCap)}
                            </td>
                          </>
                        )}

                        {/* CATALYST CELL WITH HOVER REMOVED AND NATIVE TITLE FALLBACK */}
                        <td className="py-3 text-[11px] text-slate-400 font-medium" style={{ textAlign: 'left', paddingLeft: '50px' }}>
                          <div className="flex items-center gap-2 group/cat">
                            {row.catalyst ? (
                              <>
                                {row.catalystTag && (
                                  <span className={`text-[10px] font-bold tracking-widest px-1.5 py-0.5 rounded border shrink-0 ${row.catalystTag.color}`}>
                                    {row.catalystTag.label}
                                  </span>
                                )}
                                
                                {row.catalystUrl ? (
                                  <a 
                                    href={row.catalystUrl} 
                                    target="_blank" 
                                    rel="noopener noreferrer" 
                                    className="truncate max-w-[300px] xl:max-w-[420px] group-hover/cat:text-[#7c8bfa] transition-colors underline-offset-4 hover:underline"
                                    title={row.catalyst}
                                  >
                                    {row.catalyst}
                                  </a>
                                ) : (
                                  <span 
                                    className="truncate max-w-[300px] xl:max-w-[420px] group-hover/cat:text-slate-200 transition-colors"
                                    title={row.catalyst}
                                  >
                                    {row.catalyst}
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-slate-600 font-medium">—</span>
                            )}
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
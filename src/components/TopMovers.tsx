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

// --- CONSTANTS & MAPS ---
const SECTOR_MAP: Record<string, string> = {
  // Semiconductors & IT
  'AAPL': 'IT', 'MSFT': 'IT', 'SMCI': 'IT',
  'NVDA': "Semi's", 'AMD': "Semi's", 'INTC': "Semi's", 
  'AVGO': "Semi's", 'MU': "Semi's", 'ARM': "Semi's", 
  'QCOM': "Semi's", 'TSM': "Semi's",
  
  // AI, Cyber, Fintech
  'PLTR': 'AI', 'SOUN': 'AI', 'BBAI': 'AI', 
  'AI': 'AI', 'CRWD': 'Cyber', 'PANW': 'Cyber', 'ZS': 'Cyber',
  'COIN': 'Fintech', 'MSTR': 'Fintech', 'MARA': 'Fintech', 'RIOT': 'Fintech', 'CLSK': 'Fintech', 
  'IREN': 'Fintech', 'CIFR': 'Fintech', 'HUT': 'Fintech', 'HOOD': 'Fintech', 'SOFI': 'Fintech', 'UPST': 'Fintech',
  
  // EVs & Aerospace
  'TSLA': 'EV', 'NIO': 'EV', 'LI': 'EV', 'XPEV': 'EV',
  'LUNR': 'Aerospace', 'ASTS': 'Aerospace', 'RKLB': 'Aerospace', 
  
  // Clean Energy & Nuclear
  'CEG': 'Nuclear', 'OKLO': 'Nuclear', 'CCJ': 'Nuclear', 'SMR': 'Nuclear', 'LEU': 'Nuclear',
  'FSLR': 'Solar', 'ENPH': 'Solar', 'RUN': 'Solar',
  
  // Healthcare & Biotech
  'HIMS': 'Healthcare', 'NVO': 'Healthcare', 'LLY': 'Healthcare', 'ASTX': 'Biotech', 'COO': 'Healthcare',
  
  // Discretionary, Staples, Comms
  'AMZN': 'Con Disc', 'UBER': 'Con Disc', 'BABA': 'Con Disc', 
  'PDD': 'Con Disc', 'JD': 'Con Disc',
  'PG': 'Con Staples',
  'META': 'Comm Serv', 'GOOGL': 'Comm Serv', 'NFLX': 'Comm Serv', 
  'RDDT': 'Comm Serv', 'DJT': 'Comm Serv'
};

const ETF_TARGET_MAP: Record<string, string> = {
  // Leveraged Crypto & Digital Assets
  'MSTX': 'MSTR - Fintech', 'MSTU': 'MSTR - Fintech', 'MSTZ': 'MSTR - Fintech', 'MSTD': 'MSTR - Fintech',
  'CONL': 'COIN - Fintech', 'CONZ': 'COIN - Fintech', 'COND': 'COIN - Fintech',
  'MRAL': 'MARA - Fintech', 'RIOX': 'RIOT - Fintech',
  'BITX': 'BTC - Bitcoin', 'BITZ': 'BTC - Bitcoin', 'BTCZ': 'BTC - Bitcoin', 'IBIT': 'BTC - Bitcoin', 'BITO': 'BTC - Bitcoin', 
  'ETHU': 'ETH - Ethereum', 'ETHZ': 'ETH - Ethereum', 'ETU': 'ETH - Ethereum', 'SOLT': 'SOL - Solana', 'XRPT': 'XRP - Crypto',
  
  // Single Stock ETFs
  'TSLL': 'TSLA - EV', 'TSLS': 'TSLA - EV', 'TSLQ': 'TSLA - EV', 'TSDD': 'TSLA - EV',
  'NVDL': "NVDA - Semi's", 'NVDX': "NVDA - Semi's", 'NVD': "NVDA - Semi's", 'NVDD': "NVDA - Semi's", 'NVDQ': "NVDA - Semi's",
  'AMZU': 'AMZN - Con Disc', 'AMZD': 'AMZN - Con Disc',
  'AAPU': 'AAPL - IT', 'AAPD': 'AAPL - IT', 'APLX': 'AAPL - IT', 
  'MSFU': 'MSFT - IT', 'MSFD': 'MSFT - IT', 
  'GGLL': 'GOOGL - Comm Serv', 'GGLS': 'GOOGL - Comm Serv',
  'BABX': 'BABA - Con Disc', 'BABD': 'BABA - Con Disc',
  'LLYX': 'LLY - Healthcare', 'LLYD': 'LLY - Healthcare',
  'AMDL': "AMD - Semi's", 'AMDS': "AMD - Semi's",
  'AVGX': "AVGO - Semi's", 
  'SMU': 'SMCI - IT', 'SMCX': 'SMCI - IT', 'SMCZ': 'SMCI - IT',
  'DLLL': 'DELL - IT', 'LUNL': 'LUNR - Aerospace', 'OKLL': 'OKLO - Nuclear', 'PLTU': 'PLTR - AI', 
  'METU': 'META - Comm Serv', 'TEMT': 'META - Comm Serv', 'SOFX': 'SOFI - Fintech', 'ROBN': 'HOOD - Fintech', 
  'RVNL': 'RIVN - EV', 'LCDL': 'LCID - EV', 'CRWV': 'CRWD - Cyber', 'CRDU': 'CRWD - Cyber', 'INTW': "INTC - Semi's", 
  'GMEU': 'GME - Con Disc', 'APPX': 'APP - IT', 'SNXX': 'SNOW - IT', 'AXTX': 'AXON - Industrials', 
  'IONX': 'IONQ - IT', 'IONZ': 'IONQ - IT', 'QPUX': 'IONQ - IT', 'CEGX': 'CEG - Nuclear', 
  'ASMG': "ASML - Semi's", 'UUUG': 'U - IT', 'AAOX': 'AI - AI', 'FBL': 'META - Comm Serv', 'HIMZ': 'HIMS - Healthcare', 
  'RDTL': 'RDDT - Comm Serv', 'RKLX': 'RKLB - Aerospace', 'RCAX': 'RCAT - Aerospace', 'SOUX': 'SOUN - AI', 'ASTX': 'ASTS - Aerospace',
  'RGTX': 'RGT - IT', 'RGTU': 'RGT - IT', 'RGTZ': 'RGT - IT',
  
  // Market / Sector / Volatility ETFs
  'TQQQ': 'QQQ - Nasdaq 3X', 'SQQQ': 'QQQ - Nasdaq -3X', 'QID': 'QQQ - Nasdaq -2X', 'QLD': 'QQQ - Nasdaq 2X', 'SNDQ': 'QQQ - Nasdaq ETF',
  'SOXL': "SOXX - Semi's 3X", 'SOXS': "SOXX - Semi's -3X", 'TECL': 'XLK - Tech 3X', 'TECS': 'XLK - Tech -3X',
  'FNGU': 'FNGU - Big Tech 3X', 'FNGD': 'FNGD - Big Tech -3X', 
  'TNA': 'IWM - Small Cap 3X', 'TZA': 'IWM - Small Cap -3X', 'FAS': 'XLF - Financials 3X', 'FAZ': 'XLF - Financials -3X', 
  'SPY': 'SPY - S&P 500', 'UPRO': 'SPY - S&P 3X', 'SPXL': 'SPY - S&P 3X', 'SPXS': 'SPY - S&P -3X', 'SPXU': 'SPY - S&P -3X',
  'UVXY': 'VIX - Volatility 1.5X', 'UVIX': 'VIX - Volatility 2X', 'SVIX': 'VIX - Volatility -1X', 'VIXY': 'VIX - Volatility',
  'MSOX': 'MSOS - Cannabis 2X', 'NAIL': 'XHB - Homebuilders 3X', 'LABX': 'XBI - Biotech 2X', 'KORU': 'EWY - South Korea 3X', 
  'ZSL': 'SLV - Silver -2X', 'URAA': 'URA - Uranium 2X', 'GDXD': 'GDX - Gold Miners -3X', 
  'QQQ': 'QQQ - Nasdaq', 'IWM': 'IWM - Small Cap', 'DIA': 'DIA - Dow Jones', 'VOO': 'VOO - S&P 500', 'VTI': 'VTI - Total Market'
};

// --- SMART ETF FALLBACK ENGINE ---
const resolveEtfSector = (sym: string, isEtfTab: boolean, apiSector: string | undefined, apiName: string | undefined): string => {
  // 1. Check Hardcoded Maps
  if (ETF_TARGET_MAP[sym]) return ETF_TARGET_MAP[sym];
  if (SECTOR_MAP[sym]) return SECTOR_MAP[sym]; // Regular stocks bypass ETF dashes

  // 2. Intelligent Root Symbol Extractor (e.g. QBTZ -> QBTS)
  // Most leveraged ETFs are 4 letters, ending in X, Z, D, S, L, U, Q
  if (sym.length === 4) {
    const rootCandidate = sym.substring(0, 3) + 'S'; // Standard swap format
    if (SECTOR_MAP[rootCandidate]) {
       return `${rootCandidate} - ${SECTOR_MAP[rootCandidate]}`;
    }
  }

  // 3. Name-based ETF Detection
  const n = (apiName || '').toLowerCase();
  const isFund = isEtfTab || n.includes(' etf') || n.includes('proshares') || n.includes('direxion') || n.includes('defiance') || n.includes('fund') || n.includes('trust');
  
  if (isFund) return `${sym} - ETF`;

  // 4. Ultimate Fallback
  return apiSector || 'Financials';
};

// --- HELPERS ---
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
  if (!s) return 'Financials'; 

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

  return 'Financials';
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
                
                const apiSector = cleanSectorDescription(
                  details.results?.sic_description, 
                  details.results?.sector, 
                  details.results?.industry
                );
                
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
            
            const deepSector = resolveEtfSector(sym, isEtfTab, enriched?.apiSector, enriched?.name);
            
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
      
      {/* HEADER CONTAINER */}
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
                  {/* EXPANDED COLUMN WIDTH LAYOUT FOR BETTER RUNWAY PATTERNS */}
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider cursor-pointer hover:text-slate-300 transition-colors" style={{ width: isEtfTab ? '9%' : '6%', textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('symbol')}>
                    TICKER{getSortIcon('symbol')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider cursor-pointer hover:text-slate-300 transition-colors" style={{ width: isEtfTab ? '9%' : '6%', textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('price')}>
                    PRICE{getSortIcon('price')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider cursor-pointer hover:text-slate-300 transition-colors" style={{ width: isEtfTab ? '9%' : '6%', textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('changesPercentage')}>
                    CHG%{getSortIcon('changesPercentage')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider cursor-pointer hover:text-slate-300 transition-colors" style={{ width: isEtfTab ? '9%' : '6%', textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('volume')}>
                    VOL{getSortIcon('volume')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider cursor-pointer hover:text-slate-300 transition-colors" style={{ width: isEtfTab ? '10%' : '7%', textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('dollarVolume')}>
                    $VOL{getSortIcon('dollarVolume')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider cursor-pointer hover:text-slate-300 transition-colors" style={{ width: isEtfTab ? '8%' : '5%', textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('rvol')}>
                    RVOL{getSortIcon('rvol')}
                  </th>

                  {!isEtfTab && (
                    <>
                      <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider cursor-pointer hover:text-slate-300 transition-colors" style={{ width: '6%', textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('float')}>
                        FLOAT{getSortIcon('float')}
                      </th>
                      <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider cursor-pointer hover:text-slate-300 transition-colors" style={{ width: '6%', textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('shortPct')}>
                        SHT%{getSortIcon('shortPct')}
                      </th>
                      <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider cursor-pointer hover:text-slate-300 transition-colors" style={{ width: '6%', textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('mktCap')}>
                        MCAP{getSortIcon('mktCap')}
                      </th>
                    </>
                  )}

                  {/* IDENTIFIERS (ALLOCATING SIGNIFICANT ROOM FOR THE CATALYST RUNWAY ON THE RIGHT) */}
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider cursor-pointer hover:text-slate-300 transition-colors" style={{ width: isEtfTab ? '16%' : '11%', textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('sector')}>
                    {isEtfTab ? 'ETF' : 'SECTOR'}{getSortIcon('sector')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider cursor-pointer hover:text-slate-300 transition-colors" style={{ width: isEtfTab ? '30%' : '41%', textAlign: 'left', paddingLeft: '24px' }} onClick={() => handleSort('catalyst')}>
                    CATALYST'S{getSortIcon('catalyst')}
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
                    const isPositive = row.changesPercentage >= 0;
                    
                    return (
                      <tr key={i} className="hover:bg-white/[0.02] transition-colors group">
                        
                        {/* TICKER CELL */}
                        <td className="py-3" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          <div className="relative inline-flex items-center group/ticker">
                            <span className="inline-block bg-indigo-500/10 text-[#7c8bfa] text-[11px] font-bold px-2 py-0.5 rounded border border-indigo-500/20 cursor-help">
                              {row.symbol}
                            </span>
                            <div className="absolute left-full ml-3 px-3 py-1.5 bg-[#1e293b] border border-white/10 text-slate-200 text-xs font-semibold tracking-wide rounded-md shadow-2xl opacity-0 invisible group-hover/ticker:opacity-100 group-hover/ticker:visible transition-all z-[60] whitespace-nowrap pointer-events-none">
                              {row.name || row.symbol}
                            </div>
                          </div>
                        </td>

                        {/* PRICE */}
                        <td className="py-3 text-xs text-slate-300 font-medium whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          <div className="flex items-center gap-1.5">
                            ${row.price.toFixed(2)}
                            {row.vwapStatus !== 'neutral' && (
                              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${row.vwapStatus === 'above' ? 'bg-emerald-400' : 'bg-rose-500'}`} title={row.vwapStatus === 'above' ? 'Price Above VWAP' : 'Price Below VWAP'}></div>
                            )}
                          </div>
                        </td>

                        {/* CHG% */}
                        <td className={`py-3 text-xs font-bold whitespace-nowrap ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`} style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          {isPositive ? '+' : ''}{row.changesPercentage.toFixed(2)}%
                        </td>

                        {/* VOLUME METRICS */}
                        <td className="py-3 text-xs text-slate-400 font-medium whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          {formatNumber(row.volume)}
                        </td>
                        <td className="py-3 text-xs text-slate-400 font-medium whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          {formatCurrency(row.dollarVolume)}
                        </td>
                        <td className={`py-3 text-xs font-bold whitespace-nowrap ${getRvolColor(row.rvol)}`} style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          {row.rvol ? `${row.rvol.toFixed(1)}x` : '—'}
                        </td>

                        {!isEtfTab && (
                          <>
                            <td className={`py-3 text-xs font-bold whitespace-nowrap ${getFloatColor(row.float)}`} style={{ textAlign: 'left', paddingLeft: '16px' }}>
                              {formatNumber(row.float)}
                            </td>
                            <td className={`py-3 text-xs font-bold whitespace-nowrap ${getShortColor(row.shortPct)}`} style={{ textAlign: 'left', paddingLeft: '16px' }}>
                              {row.shortPct ? `${row.shortPct.toFixed(1)}%` : '—'}
                            </td>
                            <td className="py-3 text-xs text-slate-400 font-medium whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                              {formatNumber(row.mktCap)}
                            </td>
                          </>
                        )}

                        {/* COMPACT SECTOR BADGE CELL */}
                        <td className="py-3 text-[10px] text-slate-400 font-medium whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          <div 
                            className="truncate bg-[#161c2a] px-1.5 py-0.5 rounded border border-white/5 inline-block" 
                            title={row.sector || ''}
                          >
                            {row.sector || '—'}
                          </div>
                        </td>

                        {/* CATALYST CELL - TEXT ONLY */}
                        <td className="py-3 text-[11px] text-slate-400 font-medium" style={{ textAlign: 'left', paddingLeft: '24px' }}>
                          <div className="flex items-center gap-2 group/cat">
                            {row.catalyst ? (
                              row.catalystUrl ? (
                                <a 
                                  href={row.catalystUrl} 
                                  target="_blank" 
                                  rel="noopener noreferrer" 
                                  className="truncate max-w-[450px] md:max-w-[550px] lg:max-w-[750px] xl:max-w-[950px] group-hover/cat:text-[#7c8bfa] transition-colors underline-offset-4 hover:underline"
                                  title={row.catalyst}
                                >
                                  {row.catalyst}
                                </a>
                              ) : (
                                <span 
                                  className="truncate max-w-[450px] md:max-w-[550px] lg:max-w-[750px] xl:max-w-[950px] group-hover/cat:text-slate-200 transition-colors"
                                  title={row.catalyst}
                                >
                                  {row.catalyst}
                                </span>
                              )
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
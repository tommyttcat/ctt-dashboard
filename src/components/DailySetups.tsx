'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  stage: string;
  setupName: string;
  catalyst: string | null;
  catalystUrl: string | null;
}

type SortDirection = 'asc' | 'desc';

// --- CONSTANTS & MAPS ---
const SECTOR_MAP: Record<string, string> = {
  'AAPL': 'IT', 'MSFT': 'IT', 'SMCI': 'IT',
  'NVDA': "Semi's", 'AMD': "Semi's", 'INTC': "Semi's", 
  'AVGO': "Semi's", 'MU': "Semi's", 'ARM': "Semi's", 
  'QCOM': "Semi's", 'TSM': "Semi's",
  'PLTR': 'AI', 'SOUN': 'AI', 'BBAI': 'AI', 
  'AI': 'AI', 'CRWD': 'Cyber', 'PANW': 'Cyber', 'ZS': 'Cyber',
  'COIN': 'Fintech', 'MSTR': 'Fintech', 'MARA': 'Fintech', 'RIOT': 'Fintech', 'CLSK': 'Fintech', 
  'IREN': 'Fintech', 'CIFR': 'Fintech', 'HUT': 'Fintech', 'HOOD': 'Fintech', 'SOFI': 'Fintech', 'UPST': 'Fintech',
  'TSLA': 'EV', 'NIO': 'EV', 'LI': 'EV', 'XPEV': 'EV',
  'LUNR': 'Aerospace', 'ASTS': 'Aerospace', 'RKLB': 'Aerospace', 
  'CEG': 'Nuclear', 'OKLO': 'Nuclear', 'CCJ': 'Nuclear', 'SMR': 'Nuclear', 'LEU': 'Nuclear',
  'FSLR': 'Solar', 'ENPH': 'Solar', 'RUN': 'Solar',
  'HIMS': 'Healthcare', 'NVO': 'Healthcare', 'LLY': 'Healthcare', 'ASTX': 'Biotech', 'COO': 'Healthcare',
  'AMZN': 'Con Disc', 'UBER': 'Con Disc', 'BABA': 'Con Disc', 
  'PDD': 'Con Disc', 'JD': 'Con Disc',
  'PG': 'Con Staples',
  'META': 'Comm Serv', 'GOOGL': 'Comm Serv', 'NFLX': 'Comm Serv', 
  'RDDT': 'Comm Serv', 'DJT': 'Comm Serv'
};

const ETF_TARGET_MAP: Record<string, string> = {
  'MSTX': 'MSTR - Fintech', 'MSTU': 'MSTR - Fintech', 'MSTZ': 'MSTR - Fintech', 'MSTD': 'MSTR - Fintech',
  'CONL': 'COIN - Fintech', 'CONZ': 'COIN - Fintech', 'COND': 'COIN - Fintech',
  'MRAL': 'MARA - Fintech', 'RIOX': 'RIOT - Fintech',
  'BITX': 'BTC - Bitcoin', 'BITZ': 'BTC - Bitcoin', 'BTCZ': 'BTC - Bitcoin', 'IBIT': 'BTC - Bitcoin', 'BITO': 'BTC - Bitcoin', 
  'ETHU': 'ETH - Ethereum', 'ETHZ': 'ETH - Ethereum', 'ETU': 'ETH - Ethereum', 'SOLT': 'SOL - Solana', 'XRPT': 'XRP - Crypto',
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

const resolveEtfSector = (sym: string, isEtfTab: boolean, apiSector: string | undefined, apiName: string | undefined): string => {
  if (ETF_TARGET_MAP[sym]) return ETF_TARGET_MAP[sym];
  if (SECTOR_MAP[sym]) return SECTOR_MAP[sym]; 

  if (sym.length === 4) {
    const rootCandidate = sym.substring(0, 3) + 'S'; 
    if (SECTOR_MAP[rootCandidate]) {
       return `${rootCandidate} - ${SECTOR_MAP[rootCandidate]}`;
    }
  }

  const n = (apiName || '').toLowerCase();
  const isFund = isEtfTab || n.includes(' etf') || n.includes('proshares') || n.includes('direxion') || n.includes('defiance') || n.includes('fund') || n.includes('trust');
  
  if (isFund) return `${sym} - ETF`;

  return apiSector || 'Financials';
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
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'America/New_York' });
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

// --- ALGORITHMIC PATTERN ENGINE ---
const detectPattern = (bars: any[], currentPrice: number, currentOpen: number, vwap: number, rvol: number | null): { name: string | null, stage: string } => {
  let stage = '-';
  if (!bars || bars.length < 80) return { name: null, stage }; 
  
  const yest = bars[1];
  const day3 = bars[2];

  const warmUpBars = Math.min(100, bars.length - 1);
  let ema20 = bars[warmUpBars].c;
  const k20 = 2 / (20 + 1);
  for (let i = warmUpBars - 1; i >= 0; i--) {
      ema20 = (bars[i].c * k20) + (ema20 * (1 - k20));
  }

  if (bars.length >= 210) {
    const getSMA = (startIndex: number, periods: number) => {
      if (bars.length < startIndex + periods) return 0;
      let sum = 0;
      for (let i = startIndex; i < startIndex + periods; i++) sum += bars[i].c;
      return sum / periods;
    };

    const sma150_now = getSMA(0, 150);
    const sma150_20d = getSMA(20, 150);
    const sma150_60d = getSMA(60, 150);

    if (sma150_now > 0 && sma150_20d > 0 && sma150_60d > 0) {
      const slope = (sma150_now - sma150_20d) / sma150_20d;
      const subStage = currentPrice >= ema20 ? 'A' : 'B'; 

      if (slope > 0.015 && currentPrice > sma150_now) {
        stage = `2${subStage}`; 
      } else if (slope < -0.015 && currentPrice < sma150_now) {
        stage = `4${subStage}`; 
      } else {
        if (sma150_20d > sma150_60d) {
          stage = `3${subStage}`; 
        } else {
          stage = `1${subStage}`; 
        }
      }
    }
  }

  const checkSqueeze = (offset: number) => {
    let sum = 0;
    for(let i=offset; i<offset+20; i++) sum += bars[i].c;
    const sma = sum / 20;

    let variance = 0;
    for(let i=offset; i<offset+20; i++) variance += Math.pow(bars[i].c - sma, 2);
    const stdDev = Math.sqrt(variance / 20);

    const upperBB = sma + (2.0 * stdDev);
    const lowerBB = sma - (2.0 * stdDev);

    let sumTR = 0;
    for(let i=offset; i<offset+20; i++) {
      const high = bars[i].h;
      const low = bars[i].l;
      const prevClose = bars[i+1] ? bars[i+1].c : low;
      sumTR += Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    }
    const avgTR = sumTR / 20;

    const upperKC = sma + (1.5 * avgTR);
    const lowerKC = sma - (1.5 * avgTR);

    return (upperBB < upperKC && lowerBB > lowerKC);
  };

  const isSqueezingToday = checkSqueeze(0);
  const wasSqueezingYest = checkSqueeze(1);

  if (wasSqueezingYest && !isSqueezingToday && currentPrice > ema20) {
      return { name: 'BB SQZ Fired', stage };
  }

  const getRawK = (idx: number) => {
    const slice = bars.slice(idx, idx + 14); 
    const highPeriod = Math.max(...slice.map(b => b.h));
    const lowPeriod = Math.min(...slice.map(b => b.l));
    if (highPeriod === lowPeriod) return 50; 
    return ((bars[idx].c - lowPeriod) / (highPeriod - lowPeriod)) * 100;
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
    return { name: 'Blue Dot Rev', stage };
  }

  const hasConvictionVol = rvol !== null && rvol >= 1.0;
  const high3Months = Math.max(...bars.slice(1, 65).map(b => b.h));

  if (hasConvictionVol && currentPrice > high3Months && yest.c <= high3Months && currentPrice >= Math.max(...bars.slice(1, 80).map(b => b.h))) {
    return { name: 'GLB', stage };
  }

  if (hasConvictionVol && currentOpen > (yest.h * 1.01) && currentPrice >= currentOpen) {
    return { name: 'Gap & Go', stage };
  }

  if (hasConvictionVol && currentOpen <= yest.c && currentPrice > yest.c) {
    return { name: 'R2G', stage };
  }

  if (hasConvictionVol && yest.h < day3.h && yest.l > day3.l && currentPrice > yest.h) {
    return { name: 'Inside Day BRK', stage };
  }

  if (currentPrice > ema20 && yest.l <= (ema20 * 1.02) && currentPrice > yest.h) {
    return { name: '20 EMA PB', stage };
  }

  if (isSqueezingToday) {
      return { name: 'BB SQZ Building', stage };
  }

  if (currentPrice > ema20 && currentPrice > vwap) {
    return { name: 'Trend Hold', stage };
  }

  return { name: null, stage }; 
};

export default function DailySetups() {
  // WE PULL FROM RAW SNAPSHOT TO MATCH TOP MOVERS SORTING POOL EXACTLY
  const { rawSnapshot = [], session, lastUpdated: contextLastUpdated, isLoading: isContextLoading } = useMarketData();
  
  const [setups, setSetups] = useState<SetupData[]>([]);
  const [status, setStatus] = useState<string>('Offline');
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [sortConfig, setSortConfig] = useState<{ key: keyof SetupData; direction: SortDirection } | null>(null);

  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [showStage2Only, setShowStage2Only] = useState<boolean>(false); 

  const polygonApiKey = process.env.NEXT_PUBLIC_POLYGON_API_KEY || '';
  
  // 🚀 CRITICAL FIX: Track scan times to decouple price updates from heavy API fetches
  const lastHeavyScanTime = useRef<number>(0);
  const hasInitialScanCompleted = useRef<boolean>(false);

  useEffect(() => {
    let isMounted = true;

    if (!polygonApiKey || rawSnapshot.length === 0) {
      if (isMounted) {
        setIsScanning(false);
        setStatus(isContextLoading ? 'Syncing...' : 'Offline');
      }
      return;
    }

    const runStructuralEnrichment = async () => {
      const now = Date.now();
      
      // --- PHASE 1: LIGHTWEIGHT SILENT PRICE SYNC ---
      // If we already did the heavy Polygon scan in the last 5 minutes (300000ms),
      // do NOT wipe the table or re-scan patterns. Just quietly update prices.
      if (hasInitialScanCompleted.current && now - lastHeavyScanTime.current < 300000) {
        if (isMounted) {
          setSetups(prev => prev.map(setup => {
            const snap = rawSnapshot.find((t: any) => (t.ticker || t.single_ticker) === setup.ticker);
            if (snap) {
              const currentPrice = snap.day?.c || snap.prevDay?.c || setup.price;
              const vol = (snap.day?.v > 0 ? snap.day.v : snap.prevDay?.v) || setup.vol;
              const vwap = snap.day?.vw || snap.prevDay?.vw || setup.price;
              
              let vwapStatus: 'above' | 'below' | 'neutral' = 'neutral';
              if (vwap > 0 && currentPrice > 0) {
                vwapStatus = currentPrice >= vwap ? 'above' : 'below';
              }
              const dVol = vol * vwap;
              
              return { ...setup, price: currentPrice, vol, vwapStatus, dVol };
            }
            return setup;
          }));
          setStatus('Live');
        }
        return; // Exit here. Do not run the heavy fetch below!
      }

      // --- PHASE 2: HEAVY STRUCTURAL SCAN ---
      // We only reach this point on initial load OR every 5 minutes.
      lastHeavyScanTime.current = now;

      if (isMounted) {
        setIsScanning(true);
        // Only show "Aligning" on first load. Afterwards, do it silently.
        setStatus(hasInitialScanCompleted.current ? 'Background Sync...' : 'Aligning with Top Movers...');
      }

      try {
        // Intake Valve: Identical to Top Movers
        let viableSetups = rawSnapshot.filter((t: any) => {
          const price = t.day?.c || t.prevDay?.c || 0;
          const vol = (t.day?.v > 0 ? t.day.v : t.prevDay?.v) || 0;
          return price >= 1.00 && vol >= 500000;
        });

        const sortedMovers = viableSetups.sort((a: any, b: any) => {
          const cA = a.todaysChangePerc || 0;
          const cB = b.todaysChangePerc || 0;
          return cB - cA; 
        });

        const top30Candidates = sortedMovers.slice(0, 30);
        
        if (top30Candidates.length === 0) {
          if (isMounted) {
            setSetups([]);
            setStatus('Live');
            setIsScanning(false);
          }
          return;
        }

        if (isMounted && !hasInitialScanCompleted.current) setStatus('Scanning Technicals...');

        const today = new Date();
        const lookbackDate = new Date();
        lookbackDate.setDate(today.getDate() - 400); 
        const toStr = today.toISOString().split('T')[0];
        const fromStr = lookbackDate.toISOString().split('T')[0];

        const detectedSetups: SetupData[] = [];
        const chunkSize = 5; 
        
        for (let i = 0; i < top30Candidates.length; i += chunkSize) {
          const chunk = top30Candidates.slice(i, i + chunkSize);
          const chunkPromises = chunk.map(async (t: any) => {
            const sym = t.ticker || t.single_ticker;
            const price = t.day?.c || t.prevDay?.c || 0;
            const vol = (t.day?.v > 0 ? t.day.v : t.prevDay?.v) || 0;
            const currentOpen = t.day?.o || t.prevDay?.o || price;
            const vwap = t.day?.vw || t.prevDay?.vw || price;
            const dVol = vol * vwap;

            const [details, aggs, newsData, shortData] = await Promise.all([
              fetchSafeJson(`https://api.massive.com/v3/reference/tickers/${sym}?apiKey=${polygonApiKey}`, {}),
              fetchSafeJson(`https://api.massive.com/v2/aggs/ticker/${sym}/range/1/day/${fromStr}/${toStr}?adjusted=true&sort=desc&limit=350&apiKey=${polygonApiKey}`, { results: [] }),
              fetchSafeJson(`https://api.massive.com/v2/reference/news?ticker=${sym}&limit=5&apiKey=${polygonApiKey}`, { results: [] }),
              fetchSafeJson(`https://api.massive.com/stocks/v1/short-interest?ticker=${sym}&apiKey=${polygonApiKey}`, { results: [] })
            ]);

            const rawBars = aggs.results || [];
            const dailyBars = rawBars.sort((a: any, b: any) => b.t - a.t); 

            let chgPct = t.todaysChangePerc || 0;
            
            if (dailyBars.length >= 2) {
              const currentBarClose = dailyBars[0].c;
              const priorBarClose = dailyBars[1].c;
              if (priorBarClose > 0) {
                chgPct = ((currentBarClose - priorBarClose) / priorBarClose) * 100;
              }
            }

            if (chgPct < 4.0) return null;

            let avgVol = 0;
            if (dailyBars.length > 0) {
              let sumVol = 0;
              let barCount = 0;
              dailyBars.forEach((bar: any) => {
                if (bar.v) { sumVol += bar.v; barCount++; }
              });
              avgVol = barCount > 0 ? sumVol / barCount : 0;
            }
            const rvol = (avgVol > 0 && vol > 0) ? (vol / avgVol) : null;

            const setupMatched = detectPattern(dailyBars, price, currentOpen, vwap, rvol);
            
            if (!setupMatched || setupMatched.name === null) return null;

            const marketCap = details?.results?.market_cap || 0;
            if (marketCap < 20000000) return null;

            const companyName = details?.results?.name || sym;
            
            let vwapStatus: 'above' | 'below' | 'neutral' = 'neutral';
            if (vwap > 0 && price > 0) {
              vwapStatus = price >= vwap ? 'above' : 'below';
            }

            const float = details?.results?.share_class_shares_outstanding || (marketCap && price ? marketCap / price : null);
            let shortPct = null;
            if (shortData?.results && shortData.results.length > 0 && float) {
                const shortShares = shortData.results[0].short_interest || 0;
                shortPct = (shortShares / float) * 100;
            }

            const apiSectorRaw = cleanSectorDescription(
              details?.results?.sic_description, 
              details?.results?.sector, 
              details?.results?.industry
            );
            
            const deepSector = resolveEtfSector(sym, false, apiSectorRaw, companyName); 

            const newsList = newsData?.results || [];
            let finalCatalyst = null;
            let finalCatalystUrl = null;

            if (newsList.length > 0) {
              const relatedNews = newsList.find((n: any) => {
                const pub = (n.publisher?.name || '').toLowerCase();
                return pub.includes('benzinga') || pub.includes('massive') || pub.includes('yahoo') || pub.includes('google');
              }) || newsList[0];
              
              if (relatedNews) {
                const pubDate = relatedNews.published_utc;
                let formattedDateStr = '';
                if (pubDate) {
                   const d = new Date(pubDate);
                   const isToday = d.toDateString() === new Date().toDateString();
                   const timePart = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                   formattedDateStr = isToday ? timePart : `${d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })} ${timePart}`;
                }
                finalCatalyst = formattedDateStr ? `${formattedDateStr} — ${relatedNews.title}` : relatedNews.title;
                finalCatalystUrl = relatedNews.article_url || null;
              }
            }

            return {
              ticker: sym,
              name: companyName,
              sector: deepSector,
              price: price,
              vwapStatus: vwapStatus,
              changePct: chgPct,
              vol: vol,
              dVol: dVol,
              rvol: rvol ? parseFloat(rvol.toFixed(2)) : null,
              float: float,
              shortPct: shortPct,
              mktCap: marketCap,
              stage: setupMatched.stage,
              setupName: setupMatched.name,
              catalyst: finalCatalyst || null,
              catalystTag: null,
              catalystUrl: finalCatalystUrl
            };
          });

          const enrichedResults = await Promise.all(chunkPromises);
          const validEnriched = enrichedResults.filter(r => r !== null) as SetupData[];
          
          detectedSetups.push(...validEnriched);
          await new Promise(r => setTimeout(r, 100)); 
        }

        if (isMounted) {
          detectedSetups.sort((a, b) => b.changePct - a.changePct);
          setSetups(detectedSetups.slice(0, 20));
          
          hasInitialScanCompleted.current = true; // Mark initial load as complete!
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
  }, [rawSnapshot, polygonApiKey]);

  // --- SORTING LOGIC ---
  const handleSort = (key: keyof SetupData) => {
    let direction: SortDirection = 'desc'; 
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') direction = 'asc';
    else if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') { setSortConfig(null); return; }
    setSortConfig({ key, direction });
  };

  const filteredAndSortedSetups = useMemo(() => {
    let filtered = setups;
    
    if (showStage2Only) {
        filtered = filtered.filter(s => s.stage.includes('2'));
    }

    if (!sortConfig) return filtered;
    
    return [...filtered].sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [setups, sortConfig, showStage2Only]);

  const getSortIcon = (columnKey: keyof SetupData) => {
    if (sortConfig?.key !== columnKey) return '';
    return sortConfig.direction === 'asc' ? ' ↑' : ' ↓';
  };

  const getStageColor = (stage: string | undefined) => {
    if (!stage || stage === '-') return 'text-slate-500';
    if (stage.includes('1')) return 'text-slate-400';
    if (stage.includes('2')) return 'text-emerald-400';
    if (stage.includes('3')) return 'text-amber-400';
    if (stage.includes('4')) return 'text-rose-400';
    return 'text-slate-500'; 
  };

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
            DAILY SETUPS
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
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4 relative z-10">
            
            {/* QUICK FILTERS */}
            <div className="flex items-center gap-3">
              <button
                onClick={(e) => { e.stopPropagation(); setShowStage2Only(!showStage2Only); }}
                className={`px-4 py-1.5 rounded-lg text-[10px] font-bold tracking-wide uppercase transition-all duration-300 ${
                  showStage2Only 
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-[0_0_10px_rgba(52,211,153,0.1)]' 
                    : 'bg-[#161c2a] text-slate-400 border border-white/5 hover:bg-white/[0.04]'
                }`}
              >
                {showStage2Only ? 'Showing Stage 2 Only' : 'Filter: Stage 2 Only'}
              </button>
            </div>

            <div className="flex items-center gap-4">
              {/* STAGE LEGEND (TEXT ONLY) */}
              <div className="flex items-center gap-4 px-3 py-1.5 bg-[#161c2a] border border-white/5 rounded-lg shrink-0">
                <span className="text-[9px] font-bold tracking-widest uppercase text-slate-500">STAGE</span>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-slate-400">1</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-emerald-400">2</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-amber-400">3</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-rose-400">4</span>
                  </div>
                </div>
              </div>

              {/* VWAP LEGEND */}
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
          </div>
          
          <div className="overflow-x-auto custom-scrollbar" style={{ scrollbarWidth: 'none' }}>
            <table className="w-full min-w-[1300px] border-collapse">
              <thead>
                <tr className="border-b border-white/5 select-none">
                  {/* RE-BALANCED COLUMN WIDTHS */}
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[6%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('ticker')}>
                    TICKER{getSortIcon('ticker')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[6%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('price')}>
                    PRICE{getSortIcon('price')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[6%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('changePct')}>
                    CHG%{getSortIcon('changePct')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[6%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('vol')}>
                    VOL{getSortIcon('vol')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[7%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('dVol')}>
                    $VOL{getSortIcon('dVol')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[5%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('rvol')}>
                    RVOL{getSortIcon('rvol')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[6%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('float')}>
                    FLOAT{getSortIcon('float')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[6%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('shortPct')}>
                    SHT%{getSortIcon('shortPct')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[6%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('mktCap')}>
                    MCAP{getSortIcon('mktCap')}
                  </th>
                  
                  {/* IDENTIFIERS PUSHED RIGHT WITH NARROWED STAGE AND EXPANDED STRATEGY/CATALYST */}
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[11%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('sector')}>
                    SECTOR{getSortIcon('sector')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[6%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('stage')}>
                    STAGE{getSortIcon('stage')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[11%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '16px' }} onClick={() => handleSort('setupName')}>
                    STRATEGY{getSortIcon('setupName')}
                  </th>
                  <th className="py-3 text-[10px] text-slate-500 font-bold tracking-wider w-[18%] cursor-pointer hover:text-slate-300 transition-colors" style={{ textAlign: 'left', paddingLeft: '24px' }} onClick={() => handleSort('catalyst')}>
                    CATALYST'S{getSortIcon('catalyst')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {/* 🚀 CRITICAL FIX: Only show the big loading spinner if we don't have ANY setups yet. */}
                {isContextLoading || (isScanning && setups.length === 0) ? (
                  <tr>
                    <td colSpan={13} className="py-12 text-center">
                      <div className="flex flex-col items-center justify-center gap-3">
                        <div className="w-5 h-5 border-2 border-indigo-500/20 border-t-indigo-400 rounded-full animate-spin mx-auto mb-3"></div>
                        <span className="text-xs text-slate-500 font-medium">Scanning Top Movers...</span>
                      </div>
                    </td>
                  </tr>
                ) : filteredAndSortedSetups.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="py-12 text-center text-slate-500 text-sm font-medium">
                      No tracking instruments currently found matching criteria.
                    </td>
                  </tr>
                ) : (
                  filteredAndSortedSetups.map((row, i) => {
                    const isPositive = row.changePct >= 0;
                    
                    return (
                      <tr key={i} className="hover:bg-white/[0.02] transition-colors group">
                        
                        {/* TICKER CELL */}
                        <td className="py-3" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          <div className="relative inline-flex items-center group/ticker">
                            <span className="inline-block bg-indigo-500/10 text-[#7c8bfa] text-[11px] font-bold px-2 py-0.5 rounded border border-indigo-500/20 cursor-help">
                              {row.ticker}
                            </span>
                            <div className="absolute left-full ml-3 px-3 py-1.5 bg-[#1e293b] border border-white/10 text-slate-200 text-xs font-semibold tracking-wide rounded-md shadow-2xl opacity-0 invisible group-hover/ticker:opacity-100 group-hover/ticker:visible transition-all z-[60] whitespace-nowrap pointer-events-none">
                              {row.name || row.ticker}
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
                          {isPositive ? '+' : ''}{row.changePct.toFixed(2)}%
                        </td>

                        {/* VOLUME METRICS */}
                        <td className="py-3 text-xs text-slate-400 font-medium whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          {formatNumber(row.vol)}
                        </td>
                        <td className="py-3 text-xs text-slate-400 font-medium whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          {formatCurrency(row.dVol)}
                        </td>
                        <td className={`py-3 text-xs font-bold whitespace-nowrap ${getRvolColor(row.rvol)}`} style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          {row.rvol ? `${row.rvol.toFixed(1)}x` : '—'}
                        </td>

                        {/* ASSET METRICS */}
                        <td className={`py-3 text-xs font-bold whitespace-nowrap ${getFloatColor(row.float)}`} style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          {formatNumber(row.float)}
                        </td>
                        <td className={`py-3 text-xs font-bold whitespace-nowrap ${getShortColor(row.shortPct)}`} style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          {row.shortPct ? `${row.shortPct.toFixed(1)}%` : '—'}
                        </td>
                        <td className="py-3 text-xs text-slate-400 font-medium whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          {formatNumber(row.mktCap)}
                        </td>

                        {/* COMPACT SECTOR BADGE CELL */}
                        <td className="py-3 text-[10px] text-slate-400 font-medium whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          <div 
                            className="truncate bg-[#161c2a] px-1.5 py-0.5 rounded border border-white/5 inline-block" 
                            title={row.sector || ''}
                          >
                            {row.sector || '—'}
                          </div>
                        </td>
                        
                        {/* TEXT-ONLY STAGE WITH A/B SUB-STAGES */}
                        <td className="py-3 text-xs font-bold whitespace-nowrap" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          <span className={getStageColor(row.stage)}>
                            {row.stage}
                          </span>
                        </td>
                        
                        {/* STRATEGY */}
                        <td className="py-3 text-[11px] text-slate-200 font-semibold truncate max-w-[280px]" style={{ textAlign: 'left', paddingLeft: '16px' }}>
                          <div className="flex items-center gap-1.5">
                            {row.setupName === 'Blue Dot Rev' && (
                              <div className="w-1.5 h-1.5 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.8)]" title="Blue Dot Reversal Triggered"></div>
                            )}
                            <span>{row.setupName}</span>
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
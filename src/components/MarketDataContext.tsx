'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { getMarketSession } from '@/lib/indicators/marketScorecard';
import { fetchScannerLatest } from '@/lib/scannerLatest';

// --- INTERFACES ---
interface MarketDataContextType {
  rawSnapshot: any[];
  benchmarks: any[];
  topMovers: any[];
  sipsUniverse: any[]; 
  session: string;
  effectiveDate: string; 
  lastUpdated: Date | null;
  isLoading: boolean;
}

const MarketDataContext = createContext<MarketDataContextType>({
  rawSnapshot: [],
  benchmarks: [],
  topMovers: [],
  sipsUniverse: [],
  session: 'Unknown',
  effectiveDate: '',
  lastUpdated: null,
  isLoading: true,
});

export const useMarketData = () => useContext(MarketDataContext);

// --- HELPER: CALCULATE MARKET SESSION ---

// --- HELPER: CALCULATE EFFECTIVE TRADING DATE ---
const getEffectiveTradingDate = () => {
  const est = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = est.getDay();
  const time = est.getHours() + est.getMinutes() / 60;

  if (day === 6) est.setDate(est.getDate() - 1); 
  else if (day === 0) est.setDate(est.getDate() - 2); 
  else if (day === 1 && time < 4) est.setDate(est.getDate() - 3); 
  else if (time < 4) est.setDate(est.getDate() - 1); 

  const y = est.getFullYear();
  const m = String(est.getMonth() + 1).padStart(2, '0');
  const d = String(est.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// --- THE PROVIDER COMPONENT ---
export const MarketDataProvider = ({ children }: { children: ReactNode }) => {
  const [rawSnapshot, setRawSnapshot] = useState<any[]>([]);
  const [benchmarks, setBenchmarks] = useState<any[]>([]);
  const [topMovers, setTopMovers] = useState<any[]>([]);
  const [sipsUniverse, setSipsUniverse] = useState<any[]>([]);
  const [session, setSession] = useState<string>('Unknown');
  const [effectiveDate, setEffectiveDate] = useState<string>(''); 
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;

    if (isMounted) {
       setEffectiveDate(getEffectiveTradingDate());
    }

    const fetchMasterSnapshot = async () => {
      try {
        /* Shared de-duplicated fetch — see lib/scannerLatest. It throws on a
           non-ok response, so the catch below behaves as it did before. */
        const data = await fetchScannerLatest();

        if (isMounted && data.success) {
          
          const combinedMovers: any[] = [];
          if (data.topMovers) {
            Object.values(data.topMovers).forEach((categoryArray: any) => {
              if (Array.isArray(categoryArray)) {
                combinedMovers.push(...categoryArray);
              }
            });
          }

          const uniqueMoversMap = new Map();
          combinedMovers.forEach(t => {
            if (t.ticker) uniqueMoversMap.set(t.ticker, t);
          });

          const sipsArray = data.stocksInPlay || data.sips || [];
          const dailyArray = data.dailySetups || [];
          const combinedAI = [...sipsArray, ...dailyArray];

          const uniqueAIMap = new Map();
          combinedAI.forEach(t => {
            if (t.ticker) uniqueAIMap.set(t.ticker, t);
          });

          combinedAI.forEach(t => {
            if (t.ticker) {
              if (uniqueMoversMap.has(t.ticker)) {
                uniqueMoversMap.set(t.ticker, { ...uniqueMoversMap.get(t.ticker), ...t });
              } else {
                uniqueMoversMap.set(t.ticker, t);
              }
            }
          });

          const masterList = Array.from(uniqueMoversMap.values());

          setBenchmarks(data.benchmarks || (data.benchmark ? [data.benchmark] : []));
          setRawSnapshot(masterList);
          setTopMovers(masterList);
          setSipsUniverse(Array.from(uniqueAIMap.values()));

          setSession(getMarketSession());
          setEffectiveDate(getEffectiveTradingDate());
          setLastUpdated(data.lastScanTime ? new Date(data.lastScanTime) : new Date());
          setIsLoading(false);
        }
      } catch (error) {
        console.error("Market Engine Error:", error);
        if (isMounted) {
          setSession(getMarketSession());
          setEffectiveDate(getEffectiveTradingDate());
          setIsLoading(false);
        }
      }
    };

    fetchMasterSnapshot();

    let intervalId: NodeJS.Timeout;
    const estDate = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const day = estDate.getDay();
    const timeStr = estDate.getHours() + estDate.getMinutes() / 60;
    
    const isWeekendMode = (day === 6 || day === 0) || (day === 5 && timeStr >= 20) || (day === 1 && timeStr < 4);

    if (!isWeekendMode) {
       intervalId = setInterval(fetchMasterSnapshot, 60000);
    }

    return () => {
      isMounted = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  return (
    <MarketDataContext.Provider 
      value={{ 
        rawSnapshot, 
        benchmarks,
        topMovers, 
        sipsUniverse, 
        session, 
        effectiveDate,
        lastUpdated, 
        isLoading 
      }}
    >
      {children}
    </MarketDataContext.Provider>
  );
};
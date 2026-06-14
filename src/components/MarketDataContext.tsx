'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

// --- INTERFACES ---
interface MarketDataContextType {
  rawSnapshot: any[];
  topMovers: any[];
  sipsUniverse: any[]; 
  session: string;
  effectiveDate: string; 
  lastUpdated: Date | null;
  isLoading: boolean;
}

const MarketDataContext = createContext<MarketDataContextType>({
  rawSnapshot: [],
  topMovers: [],
  sipsUniverse: [],
  session: 'Unknown',
  effectiveDate: '',
  lastUpdated: null,
  isLoading: true,
});

export const useMarketData = () => useContext(MarketDataContext);

// --- HELPER: CALCULATE MARKET SESSION ---
const getMarketSession = () => {
  const estDate = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = estDate.getDay();
  
  if (day === 0 || day === 6) return 'Closed';

  const hour = estDate.getHours();
  const min = estDate.getMinutes();
  const timeStr = hour + min / 60;

  if (timeStr >= 4 && timeStr < 9.5) return 'Pre-Market';
  if (timeStr >= 9.5 && timeStr < 16) return 'Open';
  if (timeStr >= 16 && timeStr < 20) return 'Post-Market';
  return 'Closed';
};

// --- HELPER: CALCULATE EFFECTIVE TRADING DATE ---
const getEffectiveTradingDate = () => {
  const est = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = est.getDay();
  const time = est.getHours() + est.getMinutes() / 60;

  if (day === 6) est.setDate(est.getDate() - 1); // Saturday snaps to Friday
  else if (day === 0) est.setDate(est.getDate() - 2); // Sunday snaps to Friday
  else if (day === 1 && time < 4) est.setDate(est.getDate() - 3); // Monday before 4am snaps to Friday
  else if (time < 4) est.setDate(est.getDate() - 1); // Tue-Fri before 4am snaps to Yesterday

  const y = est.getFullYear();
  const m = String(est.getMonth() + 1).padStart(2, '0');
  const d = String(est.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// --- THE PROVIDER COMPONENT ---
export const MarketDataProvider = ({ children }: { children: ReactNode }) => {
  const [rawSnapshot, setRawSnapshot] = useState<any[]>([]);
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
        // THE FIX: Fetch from our internal backend API, NOT Polygon directly
        const res = await fetch('/api/scanner/run', { cache: 'no-store' });
        
        if (!res.ok) throw new Error(`API Status ${res.status}`);
        
        const data = await res.json();

        if (isMounted) {
          // Flatten the categorized Top Movers from the API into a single array for the UI
          const combinedMovers: any[] = [];
          if (data.topMovers) {
            Object.values(data.topMovers).forEach((categoryArray: any) => {
              if (Array.isArray(categoryArray)) {
                combinedMovers.push(...categoryArray);
              }
            });
          }

          // Deduplicate the combined list
          const uniqueMap = new Map();
          combinedMovers.forEach(t => uniqueMap.set(t.ticker, t));
          
          // Ensure backward compatibility with UI components expecting legacy Polygon naming
          const flattenedUniqueMovers = Array.from(uniqueMap.values()).map((t: any) => ({
             ...t,
             day: { c: t.price, v: t.vol },
             todaysChangePerc: t.changePct,
             marketCap: t.mktCap
          }));

          const formattedSips = (data.sips || []).map((t: any) => ({
             ...t,
             day: { c: t.price, v: t.vol },
             todaysChangePerc: t.changePct,
             marketCap: t.mktCap
          }));

          setRawSnapshot(flattenedUniqueMovers);
          setTopMovers(flattenedUniqueMovers);
          setSipsUniverse(formattedSips);

          setSession(data.marketStatus || getMarketSession());
          setEffectiveDate(getEffectiveTradingDate());
          setLastUpdated(new Date());
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
    const isWeekend = estDate.getDay() === 0 || estDate.getDay() === 6;

    if (!isWeekend) {
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
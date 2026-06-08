'use client';

import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';

// --- INTERFACES ---
interface MarketDataContextType {
  rawSnapshot: any[];
  topMovers: any[];
  sipsUniverse: any[]; 
  session: string;
  lastUpdated: Date | null;
  isLoading: boolean;
}

const MarketDataContext = createContext<MarketDataContextType>({
  rawSnapshot: [],
  topMovers: [],
  sipsUniverse: [],
  session: 'Unknown',
  lastUpdated: null,
  isLoading: true,
});

export const useMarketData = () => useContext(MarketDataContext);

// --- HELPER: CALCULATE MARKET SESSION ---
const getMarketSession = () => {
  const estDate = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = estDate.getDay();
  
  if (day === 0 || day === 6) return 'Weekend';

  const hour = estDate.getHours();
  const min = estDate.getMinutes();
  const timeStr = hour + min / 60;

  if (timeStr >= 4 && timeStr < 9.5) return 'Pre-Market';
  if (timeStr >= 9.5 && timeStr < 16) return 'Open';
  if (timeStr >= 16 && timeStr < 20) return 'Post-Market';
  return 'Closed';
};

// --- THE PROVIDER COMPONENT ---
export const MarketDataProvider = ({ children }: { children: ReactNode }) => {
  const [rawSnapshot, setRawSnapshot] = useState<any[]>([]);
  const [session, setSession] = useState<string>('Unknown');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const polygonApiKey = process.env.NEXT_PUBLIC_POLYGON_API_KEY || '';

  useEffect(() => {
    let isMounted = true;

    if (!polygonApiKey) {
      if (isMounted) setIsLoading(false);
      return;
    }

    const fetchMasterSnapshot = async () => {
      try {
        const url = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?apiKey=${polygonApiKey}`;
        const res = await fetch(url);
        
        if (!res.ok) throw new Error(`Status ${res.status}`);
        
        const data = await res.json();
        const tickers = data.tickers || [];

        // --- NORMALIZATION ENGINE: FIX POLYGON'S WEEKEND WIPE ---
        const normalizedTickers = tickers.map((t: any) => {
          const isWeekendWipe = !t.day || !t.day.v || t.day.v === 0;

          if (isWeekendWipe && t.prevDay && t.prevDay.v > 0) {
            t.day = t.prevDay;
            // Provide a temporary Open-to-Close estimate so high-volume stocks make it to the SIPs true calculator
            if (!t.todaysChangePerc || t.todaysChangePerc === 0) {
              t.todaysChangePerc = t.day.o > 0 ? ((t.day.c - t.day.o) / t.day.o) * 100 : 0;
            }
          } else if (!isWeekendWipe) {
            // Normal weekday true Close-to-Close
            if ((!t.todaysChangePerc || t.todaysChangePerc === 0) && t.prevDay && t.prevDay.c > 0) {
              t.todaysChangePerc = ((t.day.c - t.prevDay.c) / t.prevDay.c) * 100;
            }
          }
          return t;
        });

        if (isMounted) {
          setRawSnapshot(normalizedTickers);
          const currentSess = getMarketSession();
          setSession(currentSess === 'Weekend' ? 'Closed' : currentSess);
          setLastUpdated(new Date());
          setIsLoading(false);
        }
      } catch (error) {
        console.error("Market Engine Error:", error);
        if (isMounted) {
          const currentSess = getMarketSession();
          setSession(currentSess === 'Weekend' ? 'Closed' : currentSess);
          setIsLoading(false);
        }
      }
    };

    fetchMasterSnapshot();

    const initialSession = getMarketSession();
    let intervalId: NodeJS.Timeout;
    
    if (initialSession !== 'Weekend') {
       intervalId = setInterval(fetchMasterSnapshot, 60000);
    }

    return () => {
      isMounted = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [polygonApiKey]);

  // --- TOP MOVERS GENERATOR ---
  const topMovers = useMemo(() => {
    if (!rawSnapshot || rawSnapshot.length === 0) return [];

    const filtered = rawSnapshot.filter((t: any) => {
      const price = t.day?.c || 0;
      const vol = t.day?.v || 0;
      return price >= 1.00 && vol >= 500000;
    });

    const sorted = filtered.sort((a: any, b: any) => {
      const volA = a.day?.v || 0;
      const volB = b.day?.v || 0;
      return volB - volA; 
    });

    return sorted.slice(0, 150);
  }, [rawSnapshot]);

  return (
    <MarketDataContext.Provider 
      value={{ 
        rawSnapshot, 
        topMovers, 
        sipsUniverse: topMovers, 
        session, 
        lastUpdated, 
        isLoading 
      }}
    >
      {children}
    </MarketDataContext.Provider>
  );
};
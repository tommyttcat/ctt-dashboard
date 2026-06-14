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
        const res = await fetch(url, { cache: 'no-store' }); 
        
        if (!res.ok) throw new Error(`Status ${res.status}`);
        
        const data = await res.json();
        const tickers = data.tickers || [];

        const currentSess = getMarketSession();

        const normalizedTickers = tickers.map((t: any) => {
          // Safely ensure day object exists to prevent downstream crashes
          if (!t.day) t.day = { c: 0, v: 0, o: 0, h: 0, l: 0 };

          // 1. WEEKEND FREEZE LOGIC
          if (currentSess === 'Weekend' && (!t.day.v || t.day.v === 0)) {
            t.day.c = t.prevDay?.c || t.day.c;
            t.day.v = t.prevDay?.v || t.day.v;
            if (!t.todaysChangePerc || t.todaysChangePerc === 0) {
              t.todaysChangePerc = (t.prevDay && t.prevDay.o > 0) 
                ? ((t.prevDay.c - t.prevDay.o) / t.prevDay.o) * 100 
                : 0;
            }
          } 
          // 2. LIVE MATH CORRECTION (Pre-Market, Open, Post-Market)
          else {
            // Favor the last precise trade if the daily candle hasn't fully populated yet
            let livePrice = t.day?.c > 0 ? t.day.c : (t.lastTrade?.p || t.min?.c || t.prevDay?.c || 0);
            let prevClose = t.prevDay?.c || 0;
            
            // Polygon frequently drops the percentage calculation early in the day. Force the exact math.
            if (prevClose > 0 && livePrice > 0) {
               t.todaysChangePerc = ((livePrice - prevClose) / prevClose) * 100;
            }
            
            t.day.c = livePrice;
            t.day.v = t.day?.v || t.min?.v || 0;
          }

          return t;
        });

        if (isMounted) {
          setRawSnapshot(normalizedTickers);
          setSession(currentSess);
          setLastUpdated(new Date());
          setIsLoading(false);
        }
      } catch (error) {
        console.error("Market Engine Error:", error);
        if (isMounted) {
          setSession(getMarketSession());
          setIsLoading(false);
        }
      }
    };

    fetchMasterSnapshot();

    const initialSession = getMarketSession();
    let intervalId: NodeJS.Timeout;
    
    // Suspend API polling entirely if it's the weekend to save data limits and freeze the UI
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
      const pct = t.todaysChangePerc || 0;
      
      // Look for market cap fields if the endpoint or backend provides them
      const mktCap = t.marketCap || t.market_cap || t.fm || 0;
      
      // STRICT MOMENTUM CRITERIA
      const meetsPrice = price >= 1.00;
      const meetsGain = pct >= 4.0; // Must be up at least 4%
      
      // Enforce the 20 Million Market Cap limit (If the API omits market cap entirely, let it pass so it doesn't blind the screener)
      const meetsCap = mktCap === 0 || mktCap >= 20000000; 

      return meetsPrice && meetsGain && meetsCap;
    });

    // Sort strictly by the magnitude of the momentum gain, completely ignoring volume
    const sorted = filtered.sort((a: any, b: any) => {
      const pctA = Math.abs(a.todaysChangePerc || 0);
      const pctB = Math.abs(b.todaysChangePerc || 0);
      return pctB - pctA; 
    });

    return sorted.slice(0, 300);
  }, [rawSnapshot, session]);

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
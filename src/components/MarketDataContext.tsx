'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

type MarketSession = 'Pre-Market' | 'Open' | 'Post-Market' | 'Closed';

interface MarketDataContextType {
  rawSnapshot: any[];
  sipsUniverse: any[];
  session: MarketSession;
  lastUpdated: Date | null;
  isLoading: boolean;
}

const MarketDataContext = createContext<MarketDataContextType | null>(null);

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

export function MarketDataProvider({ children }: { children: React.ReactNode }) {
  const [rawSnapshot, setRawSnapshot] = useState<any[]>([]);
  const [sipsUniverse, setSipsUniverse] = useState<any[]>([]);
  const [session, setSession] = useState<MarketSession>('Closed');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const polygonApiKey = process.env.NEXT_PUBLIC_POLYGON_API_KEY || '';

  useEffect(() => {
    let isMounted = true;

    const fetchMasterSnapshot = async () => {
      const currentSession = getMarketSession();
      if (isMounted) setSession(currentSession);

      if (!polygonApiKey) {
        if (isMounted) setIsLoading(false);
        return;
      }

      try {
        const snapshot = await fetchSafeJson(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?apiKey=${polygonApiKey}`, { tickers: [] });
        const rawTickers = snapshot.tickers || [];

        // Master SIPs Filter: Price >= $1.00, Vol >= 500k, Chg >= 4.0%, Price >= VWAP
        const sips = rawTickers.filter((t: any) => {
          const price = t.day?.c || t.min?.c || 0;
          const vol = t.day?.v || 0;
          const chg = t.todaysChangePerc || 0;
          const vwap = t.day?.vw || 0;
          return price >= 1.00 && vol >= 500000 && chg >= 4.0 && price >= vwap;
        }).sort((a: any, b: any) => ((b.day?.v || 0) * (b.day?.vw || 0) * (b.todaysChangePerc || 0)) - ((a.day?.v || 0) * (a.day?.vw || 0) * (a.todaysChangePerc || 0)))
        .slice(0, 105);

        if (isMounted) {
          setRawSnapshot(rawTickers);
          setSipsUniverse(sips);
          setLastUpdated(new Date());
          setIsLoading(false);
        }
      } catch (error) {
        if (isMounted) setIsLoading(false);
      }
    };

    // 1. Initial Fetch
    fetchMasterSnapshot();

    // 2. 15-Minute Sync with EOD Freeze
    const interval = setInterval(() => {
      const currentSession = getMarketSession();
      if (currentSession !== 'Closed') {
        fetchMasterSnapshot();
      }
    }, 900000); // 15 mins

    return () => { isMounted = false; clearInterval(interval); };
  }, [polygonApiKey]);

  return (
    <MarketDataContext.Provider value={{ rawSnapshot, sipsUniverse, session, lastUpdated, isLoading }}>
      {children}
    </MarketDataContext.Provider>
  );
}

export const useMarketData = () => {
  const context = useContext(MarketDataContext);
  if (!context) throw new Error('useMarketData must be used within a MarketDataProvider');
  return context;
};
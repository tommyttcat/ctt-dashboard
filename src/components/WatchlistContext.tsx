'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

interface WatchlistCtx {
  tickers: string[];
  loading: boolean;
  has: (ticker: string) => boolean;
  add: (ticker: string) => void;
  remove: (ticker: string) => void;
  clear: () => void;
  panelOpen: boolean;
  togglePanel: () => void;
}

const Ctx = createContext<WatchlistCtx>({
  tickers: [],
  loading: true,
  has: () => false,
  add: () => {},
  remove: () => {},
  clear: () => {},
  panelOpen: false,
  togglePanel: () => {},
});

export function useWatchlist() {
  return useContext(Ctx);
}

export function WatchlistProvider({ children }: { children: React.ReactNode }) {
  const [tickers, setTickers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/watchlist')
      .then(r => r.json())
      .then(d => { setTickers(d.tickers || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const has = useCallback((t: string) => tickers.includes(t.toUpperCase()), [tickers]);

  const add = useCallback((ticker: string) => {
    const sym = ticker.toUpperCase();
    setTickers(prev => prev.includes(sym) ? prev : [...prev, sym]);
    fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker: sym }),
    }).catch(() => {});
  }, []);

  const remove = useCallback((ticker: string) => {
    const sym = ticker.toUpperCase();
    setTickers(prev => prev.filter(t => t !== sym));
    fetch('/api/watchlist', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker: sym }),
    }).catch(() => {});
  }, []);

  const clear = useCallback(() => {
    tickers.forEach(t => {
      fetch('/api/watchlist', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: t }),
      }).catch(() => {});
    });
    setTickers([]);
  }, [tickers]);

  const [panelOpen, setPanelOpen] = useState(false);
  const togglePanel = useCallback(() => setPanelOpen(v => !v), []);

  return (
    <Ctx.Provider value={{ tickers, loading, has, add, remove, clear, panelOpen, togglePanel }}>
      {children}
    </Ctx.Provider>
  );
}

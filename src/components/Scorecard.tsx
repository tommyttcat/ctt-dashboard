'use client';

import React, { useEffect, useState, useRef } from 'react';

// Unified Asset Dictionary
const MACRO_ASSETS = [
  { id: 'SPY', fmp: 'SPY', ws: 'SPY', name: 'S&P 500', type: 'stock' },
  { id: 'QQQ', fmp: 'QQQ', ws: 'QQQ', name: 'Nasdaq 100', type: 'stock' },
  { id: 'DIA', fmp: 'DIA', ws: 'DIA', name: 'Dow Jones', type: 'stock' },
  { id: 'IWM', fmp: 'IWM', ws: 'IWM', name: 'Russell 2000', type: 'stock' },
  { id: 'VIXY', fmp: 'VIXY', ws: 'VIXY', name: 'Volatility ETF', type: 'stock' },
  { id: 'TLT', fmp: 'TLT', ws: 'TLT', name: '20Y Treasury', type: 'stock' },
  { id: 'GLD', fmp: 'GLD', ws: 'GLD', name: 'Gold ETF', type: 'stock' },
  { id: 'SLV', fmp: 'SLV', ws: 'SLV', name: 'Silver ETF', type: 'stock' },
  { id: 'USO', fmp: 'USO', ws: 'USO', name: 'Crude Oil', type: 'stock' },
  { id: 'BTC', fmp: 'BTCUSD', ws: 'BTC-USD', name: 'Bitcoin', type: 'crypto' },
  { id: 'ETH', fmp: 'ETHUSD', ws: 'ETH-USD', name: 'Ethereum', type: 'crypto' },
  { id: 'SOL', fmp: 'SOLUSD', ws: 'SOL-USD', name: 'Solana', type: 'crypto' }
];

interface TickData {
  price: number;
  open: number;
  tickDirection: 'up' | 'down' | 'flat';
  synced: boolean;
  isAH?: boolean;
}

type MarketSession = 'Pre-Market' | 'Open' | 'Post-Market' | 'Closed';

// --- HELPERS ---
const getTimestampMs = (val: string | number | undefined | null) => {
  if (!val) return 0;
  if (typeof val === 'string') return new Date(val).getTime();
  if (typeof val === 'number') return val > 1e11 ? val : val * 1000;
  return 0;
};

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

const formatTime = (date: Date) => {
  return date.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit', 
    second: '2-digit',
    timeZone: 'America/New_York' 
  });
};

export default function MacroScorecard() {
  const [quotes, setQuotes] = useState<Record<string, TickData>>({});
  
  const [stockStatus, setStockStatus] = useState<'CONNECTING' | 'LIVE' | 'ERROR' | 'AUTH_ERROR'>('CONNECTING');
  
  const [session, setSession] = useState<MarketSession>('Closed');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [riskMode, setRiskMode] = useState<'ON' | 'OFF'>('ON');
  const [marketTone, setMarketTone] = useState<'BULLISH' | 'NEUTRAL' | 'BEARISH'>('NEUTRAL');
  
  // --- COLLAPSE STATE ---
  const [isExpanded, setIsExpanded] = useState<boolean>(true);

  const cryptoWs = useRef<WebSocket | null>(null);

  // --- ENGINE 1: AUTO-MACRO SENTIMENT ALGO ---
  useEffect(() => {
    if (!quotes['SPY'] || !quotes['QQQ'] || !quotes['VIXY']) return;

    const getPct = (id: string) => {
      const q = quotes[id];
      if (!q || !q.open) return 0;
      return ((q.price - q.open) / q.open) * 100;
    };

    const eqScore = (getPct('SPY') * 2.0) + (getPct('QQQ') * 2.0) + (getPct('IWM') * 1.0);
    const volScore = (getPct('VIXY') * -3.0); 
    const cryptoScore = (getPct('BTC') * 0.5); 

    const totalScore = eqScore + volScore + cryptoScore;

    if (totalScore >= 1.2) {
      setMarketTone('BULLISH');
      setRiskMode('ON');
    } else if (totalScore <= -1.2) {
      setMarketTone('BEARISH');
      setRiskMode('OFF');
    } else {
      setMarketTone('NEUTRAL');
      setRiskMode(totalScore >= 0 ? 'ON' : 'OFF');
    }
  }, [quotes]);


  // --- ENGINE 2: FMP STABLE ENDPOINT POLLING ---
  useEffect(() => {
    let isMounted = true;
    const rawFmpKey = process.env.NEXT_PUBLIC_FMP_API_KEY || '';
    const fmpApiKey = rawFmpKey.trim();

    if (!fmpApiKey) {
      setStockStatus('AUTH_ERROR');
      return;
    }

    const fetchEquities = async () => {
      const stockAssets = MACRO_ASSETS.filter(a => a.type === 'stock');
      
      try {
        const stdPromises = stockAssets.map(asset => 
          fetch(`https://financialmodelingprep.com/stable/quote?symbol=${asset.fmp}&apikey=${fmpApiKey}`)
            .then(res => {
              if (res.status === 401) throw new Error('401_UNAUTHORIZED');
              if (res.status === 403) throw new Error('403_FORBIDDEN');
              return res.ok ? res.json() : [];
            })
            .catch((err) => {
              if (err.message === '401_UNAUTHORIZED') throw err; 
              return []; 
            }) 
        );
        
        const stdResults = await Promise.all(stdPromises);
        const stdData = stdResults.flat();

        let ahData: any[] = [];
        try {
          const ahPromises = stockAssets.map(asset => 
            fetch(`https://financialmodelingprep.com/stable/aftermarket-quote?symbol=${asset.fmp}&apikey=${fmpApiKey}`)
              .then(res => res.ok ? res.json() : [])
              .catch(() => [])
          );
          const ahResults = await Promise.all(ahPromises);
          ahData = ahResults.flat();
        } catch (e) {}
        
        if (stdData.length > 0 && isMounted) {
          setSession(getMarketSession());
          setLastUpdated(new Date());
          setStockStatus('LIVE'); 

          setQuotes(prev => {
            const next = { ...prev };
            
            stdData.forEach(q => {
              const asset = MACRO_ASSETS.find(a => a.fmp === q.symbol && a.type === 'stock');
              if (asset) {
                const ahMatch = ahData.find(a => a.symbol === q.symbol);
                const stdTime = getTimestampMs(q.timestamp || q.date);
                const ahTime = getTimestampMs(ahMatch?.timestamp || ahMatch?.date);
                
                const useAh = ahMatch && ahMatch.price > 0 && (ahTime > stdTime);
                const currentPrice = useAh ? ahMatch.price : (q.price || 0);
                
                const prevQuote = prev[asset.id];
                const baseline = prevQuote?.open || q.open || q.previousClose || currentPrice;
                
                let direction: 'up' | 'down' | 'flat' = prevQuote?.tickDirection || 'flat';
                if (prevQuote && currentPrice > prevQuote.price) direction = 'up';
                else if (prevQuote && currentPrice < prevQuote.price) direction = 'down';

                if (currentPrice > 0) {
                  next[asset.id] = { 
                    price: currentPrice, 
                    open: baseline, 
                    tickDirection: direction, 
                    synced: true,
                    isAH: useAh
                  };
                }
              }
            });
            return next;
          });
        }
      } catch (err: any) {
        if (!isMounted) return;
        if (err.message === '401_UNAUTHORIZED') {
          setStockStatus('AUTH_ERROR');
        } else {
          setStockStatus('ERROR');
        }
      }
    };

    fetchEquities();
    
    const pollingInterval = setInterval(() => {
      if (isMounted && stockStatus !== 'AUTH_ERROR') {
        fetchEquities();
      }
    }, 4000);

    return () => {
      isMounted = false;
      clearInterval(pollingInterval);
    };
  }, []);

  // --- ENGINE 3: COINBASE WEBSOCKET (CRYPTO) ---
  useEffect(() => {
    let isMounted = true;
    const connectCoinbase = () => {
      if (cryptoWs.current && (cryptoWs.current.readyState === 0 || cryptoWs.current.readyState === 1)) return;

      const cWs = new WebSocket('wss://ws-feed.exchange.coinbase.com');
      cryptoWs.current = cWs;

      cWs.onopen = () => {
        if (!isMounted) return;
        const cryptoTickers = MACRO_ASSETS.filter(a => a.type === 'crypto').map(a => a.ws);
        cWs.send(JSON.stringify({
          type: 'subscribe',
          product_ids: cryptoTickers,
          channels: ['ticker']
        }));
      };
      
      cWs.onmessage = (event) => {
        if (!isMounted) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'ticker' && msg.product_id && msg.price) {
            const asset = MACRO_ASSETS.find(a => a.ws === msg.product_id && a.type === 'crypto');
            const currentPrice = parseFloat(msg.price);
            
            if (asset && currentPrice > 0) {
              setQuotes(prev => {
                const prevQuote = prev[asset.id];
                const baseline = prevQuote?.open || parseFloat(msg.open_24h || msg.price);
                let direction: 'up' | 'down' | 'flat' = prevQuote?.tickDirection || 'flat';
                
                if (prevQuote && currentPrice > prevQuote.price) direction = 'up';
                else if (prevQuote && currentPrice < prevQuote.price) direction = 'down';

                return { ...prev, [asset.id]: { price: currentPrice, open: baseline, tickDirection: direction, synced: true } };
              });
            }
          }
        } catch (e) {}
      };
      
      cWs.onclose = () => {
        if (isMounted) {
          setTimeout(connectCoinbase, 3000);
        }
      };
    };

    connectCoinbase();

    return () => {
      isMounted = false;
      if (cryptoWs.current) {
        cryptoWs.current.onclose = null; 
        cryptoWs.current.close();
      }
    };
  }, []);

  const getSessionTextColor = () => {
    if (session === 'Pre-Market') return 'text-amber-500';
    if (session === 'Open') return 'text-[#00e676]';
    if (session === 'Post-Market') return 'text-indigo-400';
    return 'text-slate-500';
  };

  return (
    <div className="bg-[#101623] border border-white/5 rounded-2xl p-6 md:p-8 relative overflow-hidden shadow-xl">
      
      <div className="absolute right-0 top-0 w-64 h-64 bg-indigo-500/5 blur-3xl rounded-full -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>

      {/* HEADER CONTAINER - CLICKABLE */}
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex justify-between items-center relative z-10 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-6 border-b border-white/5 pb-4' : ''}`}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs md:text-sm font-bold text-[#7c8bfa] bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 group-hover:bg-white/[0.02] transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
            MACRO SCORECARD
          </span>
        </div>

        {/* Integrated Risk & Tone Badges - CENTERED */}
        <div className="hidden sm:flex absolute left-1/2 -translate-x-1/2 items-center gap-3">
          <div className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-md border shadow-sm ${
              riskMode === 'ON' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
            }`}
          >
            RISK {riskMode}
          </div>
          <div className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-md border shadow-sm ${
              marketTone === 'BULLISH' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 
              marketTone === 'BEARISH' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
              'bg-amber-500/10 text-amber-400 border-amber-500/20'
            }`}
          >
            TONE: {marketTone}
          </div>
        </div>

        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-center justify-center border border-white/5 bg-[#161c2a]/40 px-4 py-1.5 rounded-[10px] min-w-[120px]">
            <span className={`text-[10px] font-bold tracking-widest uppercase ${stockStatus === 'LIVE' ? getSessionTextColor() : 'text-slate-500'}`}>
              {stockStatus === 'LIVE' ? session : stockStatus === 'CONNECTING' ? 'Scouting...' : 'Offline'}
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
          {/* Mobile-Only Risk & Tone Badges */}
          <div className="flex sm:hidden justify-center items-center gap-3 mb-6 relative z-10">
            <div className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-md border shadow-sm ${
                riskMode === 'ON' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
              }`}
            >
              RISK {riskMode}
            </div>
            <div className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-md border shadow-sm ${
                marketTone === 'BULLISH' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 
                marketTone === 'BEARISH' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
                'bg-amber-500/10 text-amber-400 border-amber-500/20'
              }`}
            >
              TONE: {marketTone}
            </div>
          </div>

          {/* Quote Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4 relative z-10">
            {MACRO_ASSETS.map((asset) => {
              const q = quotes[asset.id];
              
              if (!q || !q.synced || q.price === 0) {
                return (
                  <div key={asset.id} className="bg-[#161c2a]/60 border border-white/5 rounded-xl p-4 flex flex-col justify-between h-24 opacity-60">
                    <div className="flex justify-between items-start">
                      <span className="text-sm font-bold text-slate-300">{asset.id}</span>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{asset.name}</span>
                    </div>
                    <div className="flex flex-col mt-2">
                      <span className="text-sm font-medium text-slate-500 animate-pulse">Syncing...</span>
                    </div>
                  </div>
                );
              }

              const change = q.price - q.open;
              const pct = q.open > 0 ? (change / q.open) * 100 : 0;
              const isPositive = pct >= 0;
              
              const cardBg = isPositive ? 'bg-emerald-950/10' : 'bg-rose-950/10';
              const cardBorder = isPositive ? 'border-emerald-500/20' : 'border-rose-500/20';
              const tickColor = q.tickDirection === 'up' ? 'text-emerald-300' : q.tickDirection === 'down' ? 'text-rose-300' : 'text-slate-100';

              return (
                <div key={asset.id} className={`rounded-xl p-4 flex flex-col justify-between h-24 transition-colors duration-300 border ${cardBg} ${cardBorder} hover:bg-white/[0.02] shadow-sm`}>
                  
                  <div className="flex justify-between items-start">
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-slate-200">{asset.id}</span>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 truncate max-w-[90px]">
                        {asset.name}
                      </span>
                    </div>
                    
                    <div className="flex flex-col items-end">
                      <span className={`text-[10px] font-bold tracking-wide px-1.5 py-0.5 rounded ${isPositive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                        {isPositive ? '+' : ''}{pct.toFixed(2)}%
                      </span>
                      {/* Subtle AH Badge */}
                      {q.isAH && (
                        <span className="text-[8px] font-bold text-amber-500/80 tracking-wider mt-1 uppercase">
                          AH Price
                        </span>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex flex-col items-start mt-2">
                    <span className={`text-2xl font-semibold tracking-tight transition-colors duration-200 ${tickColor}`}>
                      {asset.type === 'crypto' && q.price > 100 ? q.price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : q.price.toFixed(2)}
                    </span>
                  </div>

                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
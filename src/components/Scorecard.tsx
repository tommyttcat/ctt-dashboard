'use client';

import React, { useState, useEffect } from 'react';

interface MacroData {
  symbol: string;
  price: number;
  changePct: number;
}

const ASSETS = [
  { ticker: 'SPY', fmpSymbol: 'SPY', name: 'S&P 500' },
  { ticker: 'QQQ', fmpSymbol: 'QQQ', name: 'NASDAQ 100' },
  { ticker: 'DIA', fmpSymbol: 'DIA', name: 'DOW JONES' },
  { ticker: 'IWM', fmpSymbol: 'IWM', name: 'RUSSELL 2000' },
  { ticker: 'VIX', fmpSymbol: '^VIX', name: 'VIX INDEX' },
  { ticker: 'TLT', fmpSymbol: 'TLT', name: '20Y TREASURY' },
  { ticker: 'GLD', fmpSymbol: 'GLD', name: 'GOLD ETF' },
  { ticker: 'SLV', fmpSymbol: 'SLV', name: 'SILVER ETF' },
  { ticker: 'USO', fmpSymbol: 'USO', name: 'CRUDE OIL' },
  { ticker: 'BTC', fmpSymbol: 'BTCUSD', name: 'BITCOIN' },
  { ticker: 'ETH', fmpSymbol: 'ETHUSD', name: 'ETHEREUM' },
  { ticker: 'SOL', fmpSymbol: 'SOLUSD', name: 'SOLANA' }
];

export default function MacroScorecard() {
  const [data, setData] = useState<Record<string, MacroData>>({});
  const [status, setStatus] = useState<string>('Syncing...');

  useEffect(() => {
    let isMounted = true;

    const fetchMacro = async () => {
      try {
        const FMP_KEY = process.env.NEXT_PUBLIC_FMP_API_KEY;
        if (!FMP_KEY) {
           setStatus('API Key Missing');
           return;
        }

        // FMP's new stable endpoints strictly reject comma-separated batches (e.g., symbol=SPY,QQQ).
        // We execute 12 parallel requests directly to bypass the block completely.
        const promises = ASSETS.map(async (asset) => {
          try {
            const res = await fetch(`https://financialmodelingprep.com/stable/quote?symbol=${asset.fmpSymbol}&apikey=${FMP_KEY}`, { cache: 'no-store' });
            if (!res.ok) return null;
            
            const rawData = await res.json();
            // Catch silent JSON errors from FMP
            if (rawData && rawData["Error Message"]) return null;
            
            // Handle both object and array responses seamlessly
            const item = Array.isArray(rawData) ? rawData[0] : (rawData?.data ? rawData.data[0] : rawData);
            return item && item.symbol ? item : null;
          } catch (e) {
            return null;
          }
        });

        const results = await Promise.all(promises);
        const validResults = results.filter(Boolean);

        if (isMounted) {
          if (validResults.length > 0) {
            const newData: Record<string, MacroData> = {};
            validResults.forEach((item: any) => {
              newData[item.symbol] = {
                symbol: item.symbol,
                price: item.price || 0,
                changePct: item.changesPercentage || 0
              };
            });
            setData(newData);
            setStatus('LIVE');
          } else {
            setStatus('API BLOCKED');
          }
        }
      } catch (error) {
        if (isMounted) setStatus('OFFLINE');
      }
    };

    fetchMacro();
    const interval = setInterval(fetchMacro, 60000);
    
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const getRiskTone = () => {
    if (!data['SPY'] || !data['^VIX']) return { mode: 'NEUTRAL', color: 'text-amber-500', bg: 'bg-amber-500/10 border-amber-500/20' };
    
    const spyUp = data['SPY'].changePct > 0;
    const vixDown = data['^VIX'].changePct < 0;

    if (spyUp && vixDown) return { mode: 'RISK ON', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' };
    if (!spyUp && !vixDown) return { mode: 'RISK OFF', color: 'text-rose-400', bg: 'bg-rose-500/10 border-rose-500/20' };
    return { mode: 'NEUTRAL', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' };
  };

  const tone = getRiskTone();

  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-4">
          <span className="text-xs md:text-sm font-bold text-[#7c8bfa] bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
            MACRO SCORECARD
          </span>
          
          <div className={`px-3 py-1 rounded-md border text-[10px] font-bold tracking-widest uppercase ${tone.bg} ${tone.color}`}>
            TONE: {tone.mode}
          </div>
        </div>

        <div className="flex items-center border border-white/5 bg-[#161c2a]/40 px-4 py-1.5 rounded-[10px]">
          <span className={`text-[10px] font-bold tracking-widest uppercase ${status === 'LIVE' ? 'text-emerald-400' : 'text-slate-500'}`}>
            {status}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {ASSETS.map((asset) => {
          const quote = data[asset.fmpSymbol];
          const isPositive = quote?.changePct >= 0;

          return (
            <div key={asset.ticker} className="bg-[#161c2a] border border-white/5 rounded-xl p-4 flex flex-col justify-between h-[85px] hover:bg-white/[0.02] transition-colors">
              <div className="flex justify-between items-start">
                <span className="text-sm font-bold text-slate-200">{asset.ticker}</span>
                <span className="text-[9px] font-bold tracking-widest text-slate-500 uppercase">{asset.name}</span>
              </div>

              <div className="flex justify-between items-end mt-2">
                {quote ? (
                  <>
                    <span className="text-lg font-bold text-white">${quote.price.toFixed(2)}</span>
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded-md ${isPositive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                      {isPositive ? '+' : ''}{quote.changePct.toFixed(2)}%
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-slate-500 font-medium">Syncing...</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
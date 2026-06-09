import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const estDate = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const timeStr = estDate.getHours() + estDate.getMinutes() / 60;
  
  let currentVolumeThreshold = 500000;
  let currentMarketStatus = "Closed";
  
  if (timeStr >= 4 && timeStr < 9.5) {
    currentVolumeThreshold = 25000;
    currentMarketStatus = "Pre-Market";
  } else if (timeStr >= 9.5 && timeStr < 10.5) {
    currentVolumeThreshold = 100000;
    currentMarketStatus = "Open";
  } else if (timeStr >= 10.5 && timeStr < 16) {
    currentVolumeThreshold = 500000;
    currentMarketStatus = "Open";
  } else if (timeStr >= 16 && timeStr < 20) {
    currentVolumeThreshold = 25000;
    currentMarketStatus = "Post-Market";
  }

  try {
    // ALIGNED EXACTLY WITH YOUR VERCEL VARIABLES
    const POLYGON_KEY = process.env.NEXT_PUBLIC_POLYGON_API_KEY;
    if (!POLYGON_KEY) throw new Error("Missing POLYGON API KEY");

    const response = await fetch(
      `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?apiKey=${POLYGON_KEY}`,
      { cache: 'no-store' } 
    );
    
    if (!response.ok) throw new Error(`Polygon API returned ${response.status}`);
    const data = await response.json();
    const tickers = data.tickers || [];

    let gainers = [];
    let losers = [];
    let megaCaps = []; 
    let etfs = [];
    let stocksInPlay = [];
    let dailySetups = [];

    const megaCapTickers = ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "META", "GOOGL", "AMD", "NFLX", "AVGO", "COST", "TMUS", "CSCO", "INTC", "QCOM", "TXN", "AMAT", "ISRG", "HON", "BKNG"];
    const targetETFs = ["SPY", "QQQ", "IWM", "DIA", "TQQQ", "SQQQ", "SOXL", "SOXS", "SPXL", "SPXS", "UPRO", "SPXU", "TNA", "TZA", "UDOW", "SDOW", "UVXY", "VIXY"];

    for (const stock of tickers) {
      const volume = stock.day?.v || 0;
      const prevClose = stock.prevDay?.c || stock.day?.c || 1;
      const currentPrice = stock.day?.c || stock.lastTrade?.p || stock.min?.c || prevClose;
      const percentChange = ((currentPrice - prevClose) / prevClose) * 100;
      
      const tickerData = {
        ticker: stock.ticker,
        price: currentPrice,
        change: percentChange,
        volume: volume,
        stage: "Stage 2A",
        mktCap: null,
        sector: "—",
        float: null,     
        shortPct: null,
        rvol: null
      };

      if (targetETFs.includes(stock.ticker)) { etfs.push(tickerData); continue; }
      if (megaCapTickers.includes(stock.ticker)) { megaCaps.push(tickerData); continue; }

      if (volume >= currentVolumeThreshold && currentPrice >= 1.00) {
        if (percentChange >= 4) gainers.push(tickerData);
        else if (percentChange <= -4) losers.push(tickerData);

        if (Math.abs(percentChange) >= 4) stocksInPlay.push(tickerData);
        if (Math.abs(percentChange) >= 6 && volume > 1000000) dailySetups.push(tickerData);
      }
    }

    gainers.sort((a, b) => b.change - a.change);
    losers.sort((a, b) => a.change - b.change);
    megaCaps.sort((a, b) => b.change - a.change);
    stocksInPlay.sort((a, b) => b.volume - a.volume);
    dailySetups.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

    gainers = gainers.slice(0, 50);
    losers = losers.slice(0, 50);
    stocksInPlay = stocksInPlay.slice(0, 30);
    dailySetups = dailySetups.slice(0, 30);

    // ALIGNED EXACTLY WITH YOUR VERCEL VARIABLES
    const FMP_KEY = process.env.NEXT_PUBLIC_FMP_API_KEY; 

    if (FMP_KEY) {
      const sanitize = (t: string) => t.replace('.', '-');
      const allUniqueTickers = Array.from(new Set([
        ...gainers.map(t => sanitize(t.ticker)),
        ...losers.map(t => sanitize(t.ticker)),
        ...megaCaps.map(t => sanitize(t.ticker)),
        ...etfs.map(t => sanitize(t.ticker)),
        ...stocksInPlay.map(t => sanitize(t.ticker)),
        ...dailySetups.map(t => sanitize(t.ticker))
      ]));

      const profileMap: Record<string, any> = {};
      const chunkSize = 50;

      for (let i = 0; i < allUniqueTickers.length; i += chunkSize) {
        const chunk = allUniqueTickers.slice(i, i + chunkSize);
        try {
          const profileRes = await fetch(
            `https://financialmodelingprep.com/stable/profile?symbol=${chunk.join(',')}&apikey=${FMP_KEY}`,
            { cache: 'no-store' }
          );
          
          const quoteRes = await fetch(
            `https://financialmodelingprep.com/stable/quote?symbol=${chunk.join(',')}&apikey=${FMP_KEY}`,
            { cache: 'no-store' }
          );
          
          if (profileRes.ok && quoteRes.ok) {
            const rawProfiles = await profileRes.json();
            const rawQuotes = await quoteRes.json();
            
            const profiles = Array.isArray(rawProfiles) ? rawProfiles : (rawProfiles?.data || [rawProfiles]);
            const quotes = Array.isArray(rawQuotes) ? rawQuotes : (rawQuotes?.data || [rawQuotes]);
            
            profiles.forEach((p: any) => { 
              if (!p || !p.symbol) return;
              const originalTicker = p.symbol.replace('-', '.');
              if (!profileMap[originalTicker]) profileMap[originalTicker] = {};
              profileMap[originalTicker].mktCap = p.mktCap;
              profileMap[originalTicker].sector = p.sector;
            });

            quotes.forEach((q: any) => {
              if (!q || !q.symbol) return;
              const originalTicker = q.symbol.replace('-', '.');
              if (!profileMap[originalTicker]) profileMap[originalTicker] = {};
              profileMap[originalTicker].avgVolume = q.avgVolume;
              profileMap[originalTicker].float = q.sharesOutstanding; 
            });
          }
        } catch (e) {
          console.error("FMP Hydration chunk failed", e);
        }
      }

      const hydrate = (list: any[]) => list.map(item => {
        const fmpData = profileMap[item.ticker] || {};
        
        let calculatedRvol = null;
        if (item.volume && fmpData.avgVolume && fmpData.avgVolume > 0) {
           calculatedRvol = item.volume / fmpData.avgVolume;
        }

        return {
          ...item,
          mktCap: fmpData.mktCap || null,
          sector: fmpData.sector || "—",
          rvol: calculatedRvol,
          float: fmpData.float || null,
          shortPct: null 
        };
      });

      gainers = hydrate(gainers);
      losers = hydrate(losers);
      megaCaps = hydrate(megaCaps);
      etfs = hydrate(etfs);
      stocksInPlay = hydrate(stocksInPlay);
      
      // STRICT MARKET CAP FILTER RESTORED
      stocksInPlay = stocksInPlay.filter(stock => stock.mktCap && stock.mktCap >= 20000000);

      dailySetups = hydrate(dailySetups);
    }

    const finalTopMovers = { gainers, losers, megaCaps, etfs };

    await kv.set("top_movers", finalTopMovers);
    await kv.set("stocks_in_play", stocksInPlay);
    await kv.set("daily_setups", dailySetups);
    await kv.set("marketStatus", currentMarketStatus);
    await kv.set("last_scan_time", Date.now()); 

    return NextResponse.json({ 
      success: true, 
      marketStatus: currentMarketStatus,
      hydratedWithFMP: !!FMP_KEY
    });

  } catch (error: any) {
    console.error("Scanner Engine Error:", error.message);
    return NextResponse.json({ error: "Scanner failed to run", details: error.message }, { status: 500 });
  }
}
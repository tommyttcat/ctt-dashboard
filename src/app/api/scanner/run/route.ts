import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // 0. Security Gatekeeper
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // 1. Session Awareness
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
    const POLYGON_KEY = process.env.POLYGON_API_KEY || process.env.NEXT_PUBLIC_POLYGON_API_KEY;
    if (!POLYGON_KEY) throw new Error("Missing POLYGON API KEY");

    // ====================================================================
    // PHASE 1: THE SPEED SCAN (Powered by Polygon)
    // ====================================================================
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

    const megaCapTickers = [
      "AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "META", "GOOGL", "AMD", 
      "NFLX", "AVGO", "COST", "TMUS", "CSCO", "INTC", "QCOM", "TXN", 
      "AMAT", "ISRG", "HON", "BKNG"
    ];

    const targetETFs = [
      "SPY", "QQQ", "IWM", "DIA", "TQQQ", "SQQQ", "SOXL", "SOXS",
      "SPXL", "SPXS", "UPRO", "SPXU", "TNA", "TZA", "UDOW", "SDOW", "UVXY", "VIXY"
    ];

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
        // Placeholders waiting for FMP Hydration
        mktCap: null,
        sector: "—"
      };

      if (targetETFs.includes(stock.ticker)) {
        etfs.push(tickerData);
        continue; 
      }
      if (megaCapTickers.includes(stock.ticker)) {
        megaCaps.push(tickerData);
        continue; 
      }

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

    // Cap sizes to prevent massive payload limits
    gainers = gainers.slice(0, 50);
    losers = losers.slice(0, 50);
    stocksInPlay = stocksInPlay.slice(0, 30);
    dailySetups = dailySetups.slice(0, 30);

    // ====================================================================
    // PHASE 2: THE HYDRATION ENGINE (Powered by Financial Modeling Prep)
    // ====================================================================
    const FMP_KEY = process.env.FMP_API_KEY; 

    if (FMP_KEY) {
      // Gather every unique ticker that made it through the Polygon filters
      const allUniqueTickers = Array.from(new Set([
        ...gainers.map(t => t.ticker),
        ...losers.map(t => t.ticker),
        ...megaCaps.map(t => t.ticker),
        ...etfs.map(t => t.ticker),
        ...stocksInPlay.map(t => t.ticker),
        ...dailySetups.map(t => t.ticker)
      ]));

      // Fetch fundamentals in one massive batch
      if (allUniqueTickers.length > 0) {
        try {
          const fmpRes = await fetch(
            `https://financialmodelingprep.com/api/v3/profile/${allUniqueTickers.join(',')}?apikey=${FMP_KEY}`,
            { cache: 'no-store' }
          );
          
          if (fmpRes.ok) {
            const profiles = await fmpRes.json();
            const profileMap: Record<string, any> = {};
            profiles.forEach((p: any) => { profileMap[p.symbol] = p; });

            // Helper to map fundamentals back onto the objects
            const hydrate = (list: any[]) => list.map(item => ({
              ...item,
              mktCap: profileMap[item.ticker]?.mktCap || null,
              sector: profileMap[item.ticker]?.sector || "—"
            }));

            // Apply hydration
            gainers = hydrate(gainers);
            losers = hydrate(losers);
            megaCaps = hydrate(megaCaps);
            etfs = hydrate(etfs);
            stocksInPlay = hydrate(stocksInPlay);
            dailySetups = hydrate(dailySetups);
          }
        } catch (e) {
          console.error("FMP Hydration failed, saving standard Polygon data instead.", e);
        }
      }
    } else {
      console.warn("No FMP_API_KEY found in Vercel. Skipping fundamental hydration.");
    }

    // ====================================================================
    // PHASE 3: DATABASE SAVE
    // ====================================================================
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
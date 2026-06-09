import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // 0. Security Gatekeeper
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // 1. Session Awareness Math & Market Status
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
    const API_KEY = process.env.POLYGON_API_KEY || process.env.NEXT_PUBLIC_POLYGON_API_KEY;
    if (!API_KEY) throw new Error("Missing POLYGON API KEY");

    // Live, cache-busted fetch to eliminate frozen data
    const response = await fetch(
      `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?apiKey=${API_KEY}`,
      { cache: 'no-store' } 
    );
    
    if (!response.ok) throw new Error(`Polygon API returned ${response.status}`);
    const data = await response.json();
    const tickers = data.tickers || [];

    // Arrays for all sections of the dashboard
    const gainers = [];
    const losers = [];
    const megaCaps = []; 
    const etfs = [];
    const stocksInPlay = [];
    const dailySetups = [];

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
        stage: "Stage 2A"
      };

      // 1. Process ETFs
      if (targetETFs.includes(stock.ticker)) {
        etfs.push(tickerData);
      }

      // 2. Process Mega Caps
      if (megaCapTickers.includes(stock.ticker)) {
        megaCaps.push(tickerData);
      }

      // 3. Liquidity Filter for general scanners (Price >= $1.00 and meets current volume threshold)
      if (volume >= currentVolumeThreshold && currentPrice >= 1.00) {
        if (percentChange >= 4) {
          gainers.push(tickerData);
        } else if (percentChange <= -4) {
          losers.push(tickerData);
        }

        // 4. Stocks In Play Filter (Minimum absolute 4% change + high relative day volume)
        if (Math.abs(percentChange) >= 4) {
          stocksInPlay.push(tickerData);
        }

        // 5. Daily Setups Filter (High volume momentum breakouts/breakdowns)
        if (Math.abs(percentChange) >= 6 && volume > 1000000) {
          dailySetups.push(tickerData);
        }
      }
    }

    // Sort everything by most active/biggest moves
    gainers.sort((a, b) => b.change - a.change);
    losers.sort((a, b) => a.change - b.change);
    megaCaps.sort((a, b) => b.change - a.change);
    stocksInPlay.sort((a, b) => b.volume - a.volume); // High volume focus
    dailySetups.sort((a, b) => b.change - a.change);

    const finalTopMovers = {
      gainers: gainers.slice(0, 50),
      losers: losers.slice(0, 50),
      megaCaps: megaCaps,
      etfs: etfs
    };

    // 5. Overwrite EVERY key simultaneously to eliminate stale data cross-contamination
    await kv.set("top_movers", finalTopMovers);
    await kv.set("stocks_in_play", stocksInPlay.slice(0, 30));
    await kv.set("daily_setups", dailySetups.slice(0, 30));
    await kv.set("marketStatus", currentMarketStatus);
    await kv.set("last_scan_time", Date.now()); 

    return NextResponse.json({ 
      success: true, 
      marketStatus: currentMarketStatus,
      topMoversCount: gainers.length + losers.length,
      sipsCount: stocksInPlay.length,
      setupsCount: dailySetups.length
    });

  } catch (error: any) {
    console.error("Scanner Engine Error:", error.message);
    return NextResponse.json({ error: "Scanner failed to run", details: error.message }, { status: 500 });
  }
}
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv"; // Vercel/Upstash KV database

// Prevents Next.js from caching this route so it runs fresh every 5 minutes
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
  
  let currentVolumeThreshold = 500000; // Default regular hours
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
    console.log(`Scanner running: ${currentMarketStatus} | Volume Threshold: ${currentVolumeThreshold}`);

    // 2. Fetch Polygon Data (All US Equities Snapshot)
    const API_KEY = process.env.POLYGON_API_KEY;
    if (!API_KEY) throw new Error("Missing POLYGON_API_KEY");

    const response = await fetch(
      `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?apiKey=${API_KEY}`
    );
    
    if (!response.ok) throw new Error(`Polygon API returned ${response.status}`);
    const data = await response.json();
    const tickers = data.tickers || [];

    // 3. Filter Engine
    const stocksInPlay = [];
    const megaCaps = []; 

    for (const stock of tickers) {
      const volume = stock.day?.v || 0;
      const prevClose = stock.prevDay?.c || stock.day?.c || 1;
      const currentPrice = stock.day?.c || stock.lastTrade?.p || stock.min?.c || prevClose;
      const percentChange = ((currentPrice - prevClose) / prevClose) * 100;
      
      // Basic Market Cap proxy (you can replace with a strict FMP/Massive API call if needed)
      // Assuming a standard $20M threshold bypass for ETFs
      const isETF = stock.ticker.includes("QQQ") || stock.ticker.includes("SPY"); 
      const meetsMarketCap = isETF ? true : true; // Expand this if you pull live MCAP from Polygon

      // Stocks In Play: Min 4% gain, Min Volume Threshold, >$20M Market Cap
      if (percentChange >= 4 && volume >= currentVolumeThreshold && meetsMarketCap) {
        stocksInPlay.push({
          ticker: stock.ticker,
          price: currentPrice,
          change: percentChange,
          volume: volume,
          stage: "Stage 2A"
        });
      }

      // Mega Caps List (Keep strictly to 20 stocks)
      // Note: Add your specific array of 20 Mega Cap tickers here to filter them
      const isMegaCapTicker = ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "META", "GOOGL", "AMD"].includes(stock.ticker);
      if (isMegaCapTicker && megaCaps.length < 20) {
        megaCaps.push({
          ticker: stock.ticker,
          price: currentPrice,
          change: percentChange,
          volume: volume,
          stage: "Stage 2A"
        });
      }
    }

    // Sort SIPs by highest percentage gainer
    stocksInPlay.sort((a, b) => b.change - a.change);

    // 4. Update Database (Upstash/Vercel KV)
    await kv.set("stocksInPlay", stocksInPlay);
    await kv.set("megaCaps", megaCaps);
    await kv.set("marketStatus", currentMarketStatus);
    await kv.set("lastUpdated", new Date().toISOString());

    return NextResponse.json({ 
      success: true, 
      message: "Scanner run complete",
      marketStatus: currentMarketStatus,
      thresholdUsed: currentVolumeThreshold,
      sipCount: stocksInPlay.length
    });

  } catch (error) {
    console.error("Scanner Engine Error:", error);
    return NextResponse.json({ error: "Scanner failed to run" }, { status: 500 });
  }
}
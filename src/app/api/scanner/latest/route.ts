import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

export async function GET() {
  try {
    console.log("Fetching raw scanner data from KV...");

    // 1. Safely fetch each key individually
    const rawDailySetups = await kv.get('daily_setups');
    const rawStocksInPlay = await kv.get('stocks_in_play');
    const rawTopMovers = await kv.get('top_movers');
    const rawLastScanTime = await kv.get('last_scan_time');

    // 2. Helper function to safely handle stringified or object data
    const safeParse = (data: any, fallback: any) => {
      if (!data) return fallback;
      if (typeof data === 'string') {
        try {
          return JSON.parse(data);
        } catch {
          return data;
        }
      }
      return data;
    };

    // 3. Parse everything cleanly without throwing errors
    const dailySetups = safeParse(rawDailySetups, []);
    const stocksInPlay = safeParse(rawStocksInPlay, []);
    const topMovers = safeParse(rawTopMovers, {
      'Mega Caps': [], 'Gainers': [], 'Losers': [], 'ETF Gainers': [], 'ETF Losers': []
    });
    const lastScanTime = safeParse(rawLastScanTime, null);

    return NextResponse.json({ 
      success: true,
      dailySetups: Array.isArray(dailySetups) ? dailySetups : [dailySetups], 
      stocksInPlay: Array.isArray(stocksInPlay) ? stocksInPlay : [stocksInPlay], 
      topMovers,
      lastScanTime 
    });

  } catch (error: any) {
    console.error("BYPASS_ROUTE_ERROR:", error.message);
    return NextResponse.json({ 
      success: false, 
      error: error.message,
      dailySetups: [],
      stocksInPlay: [],
      topMovers: { 'Mega Caps': [], 'Gainers': [], 'Losers': [], 'ETF Gainers': [], 'ETF Losers': [] },
      lastScanTime: null
    }, { status: 200 }); // Return 200 fallback so the frontend never freezes
  }
}
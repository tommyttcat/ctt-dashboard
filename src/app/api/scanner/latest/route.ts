import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { headers } from 'next/headers'; // 1. Import Next.js headers API

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    // 2. THE SLEDGEHAMMER: By invoking headers(), Next.js is permanently 
    // banned from caching this route. It MUST pull fresh from Upstash.
    headers();

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
    
    // (If the scanner sends camelCase like 'gainers', map them to what the UI expects)
    let topMovers = safeParse(rawTopMovers, null);
    if (!topMovers || !topMovers['Gainers']) {
      // Map the new scanner engine keys to the exact labels your UI is looking for
      topMovers = {
        'Mega Caps': topMovers?.megaCaps || [],
        'Gainers': topMovers?.gainers || [],
        'Losers': topMovers?.losers || [],
        'ETF Gainers': topMovers?.etfs || [],
        'ETF Losers': []
      };
    }

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
    }, { status: 200 }); 
  }
}
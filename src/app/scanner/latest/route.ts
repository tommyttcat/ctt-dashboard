import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

export async function GET() {
  try {
    const dailySetups = await kv.get('daily_setups') || [];
    const stocksInPlay = await kv.get('stocks_in_play') || [];
    const topMovers = await kv.get('top_movers') || {
      'Mega Caps': [], 'Gainers': [], 'Losers': [], 'ETF Gainers': [], 'ETF Losers': []
    };
    const lastScanTime = await kv.get('last_scan_time') || null;

    return NextResponse.json({ 
      success: true,
      dailySetups, 
      stocksInPlay, 
      topMovers,
      lastScanTime 
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
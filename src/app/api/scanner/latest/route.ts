import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const dailySetups = await kv.get('daily_setups') || [];
    const stocksInPlay = await kv.get('stocks_in_play') || [];
    const topMovers = await kv.get('top_movers') || {
      'Mega Caps': [], 'Gainers': [], 'Losers': [], 'ETF Gainers': [], 'ETF Losers': []
    };
    const macroInsights = await kv.get('macro_insights') || null;

    return NextResponse.json({ 
      success: true,
      dailySetups: dailySetups, 
      stocksInPlay: stocksInPlay,   // Feeds your main table
      sips: stocksInPlay,           // Feeds your side widget
      topMovers: topMovers,
      macroInsights: macroInsights  // Feeds the AI insights
    });
    
  } catch (error: any) {
    console.error("CRITICAL_LATEST_ROUTE_ERROR:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
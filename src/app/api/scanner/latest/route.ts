// app/api/scanner/latest/route.ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/db'; // Your database client

// FORCE NEXT.JS TO NEVER CACHE THIS ROUTE
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    // 1. Fetch data directly from the DB without any server-side memoization
    const data = await db.marketData.findFirst({
      orderBy: { lastScanTime: 'desc' }
    });

    if (!data) {
      return NextResponse.json({ success: false, error: 'No data found' });
    }

    return NextResponse.json({
      success: true,
      session: data.session, // Pre-Market, Open, Post-Market, Closed
      lastScanTime: data.lastScanTime,
      topMovers: data.topMovers,
      stocksInPlay: data.stocksInPlay,
      dailySetups: data.dailySetups,
    }, {
      // Clear downstream/browser headers entirely
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      }
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
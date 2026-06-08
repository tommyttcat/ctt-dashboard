import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv'; // A lightning-fast Redis database

export async function GET(request: Request) {
  // 1. Verify this request actually came from Vercel's Cron system (Security)
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  // 2. Do the heavy lifting (120+ API calls, math, pattern matching)
  const finalTop20Setups = await runMassivePolygonScan(); 

  // 3. Save the results into the database
  await kv.set('latest_daily_setups', finalTop20Setups);

  return NextResponse.json({ success: true, message: 'Scan complete and cached!' });
}
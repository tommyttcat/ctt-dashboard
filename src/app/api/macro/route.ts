import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  // Swapped VIXY out for the true VIX index (%5EVIX is the URL encoded version of ^VIX)
  const symbols = "SPY,QQQ,DIA,IWM,%5EVIX,TLT,GLD,SLV,USO";
  
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      },
      cache: 'no-store'
    });

    if (!res.ok) throw new Error("Yahoo API Failed");

    const data = await res.json();
    return NextResponse.json({ success: true, data: data.quoteResponse.result });
    
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
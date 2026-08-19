import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface Bar { time: string; open: number; high: number; low: number; close: number; volume: number }

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await params;
  const tf = request.nextUrl.searchParams.get('tf') || 'daily';
  const apiKey = process.env.POLYGON_API_KEY || '';
  if (!apiKey) return NextResponse.json({ error: 'Missing Polygon key' }, { status: 500 });

  const timespan = tf === 'monthly' ? 'month' : tf === 'weekly' ? 'week' : 'day';
  const limit = 50000;

  const to = new Date();
  const from = new Date();
  if (tf === 'ytd') {
    from.setMonth(0, 1);
  } else if (tf === '3m') {
    from.setMonth(from.getMonth() - 3);
  } else {
    from.setDate(from.getDate() - (tf === 'monthly' ? 1825 : tf === 'weekly' ? 730 : 90));
  }
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol.toUpperCase())}/range/1/${timespan}/${fmt(from)}/${fmt(to)}?adjusted=true&sort=asc&limit=${limit}&apiKey=${apiKey}`;

  try {
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) return NextResponse.json({ error: `Polygon ${res.status}` }, { status: 502 });
    const data = await res.json();
    const results = data.results || [];

    const bars: Bar[] = results.map((r: any) => ({
      time: new Date(r.t).toISOString().slice(0, 10),
      open: r.o,
      high: r.h,
      low: r.l,
      close: r.c,
      volume: r.v,
    }));

    let profile: { name?: string; sector?: string; industry?: string; mktCap?: number } | undefined;
    try {
      const detUrl = `https://api.polygon.io/v3/reference/tickers/${encodeURIComponent(symbol.toUpperCase())}?apiKey=${apiKey}`;
      const detRes = await fetch(detUrl, { next: { revalidate: 86400 } });
      if (detRes.ok) {
        const det = await detRes.json();
        const r = det.results;
        if (r) profile = { name: r.name, sector: r.sic_description, industry: r.type === 'ETF' ? 'ETF' : undefined, mktCap: r.market_cap };
      }
    } catch {}

    return NextResponse.json({ bars, profile }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

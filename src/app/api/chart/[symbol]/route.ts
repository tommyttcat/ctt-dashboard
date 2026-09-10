import { NextRequest, NextResponse } from 'next/server';
import { webullConfigured, webullBars, webullDailyBarsWithToday, type WebullBar } from '@/lib/webull';

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
    /* Webull real-time bars first (today's bar is live rather than 15 minutes
       behind); Polygon on any failure or empty result. Both feeds stamp a bar
       with its opening time, so the date mapping is identical. */
    let bars: Bar[] = [];
    let source: 'webull' | 'polygon' = 'polygon';
    if (webullConfigured()) {
      try {
        const sym = symbol.toUpperCase();
        const fromMs = from.getTime();
        let wb: WebullBar[];
        if (timespan === 'day') {
          wb = await webullDailyBarsWithToday(sym, 320);
        } else {
          /* Weekly/monthly bars are closed-period only on Webull and stamped
             with their last session. Fold today's session (from the snapshot,
             via the daily helper) into the current period's bar, or start a
             new one if the newest bar belongs to a previous week/month. */
          const [periodBars, dailyTail] = await Promise.all([
            webullBars(sym, timespan === 'month' ? 'M' : 'W', timespan === 'month' ? 80 : 130),
            webullDailyBarsWithToday(sym, 2),
          ]);
          wb = periodBars;
          const today = dailyTail[dailyTail.length - 1];
          const last = wb[wb.length - 1];
          if (today && (!last || today.t > last.t)) {
            const et = (ms: number) => new Date(new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York' }));
            const periodKey = (ms: number) => {
              const d = et(ms);
              if (timespan === 'month') return `${d.getFullYear()}-${d.getMonth()}`;
              const monday = new Date(d); monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
              return monday.toDateString();
            };
            if (last && periodKey(last.t) === periodKey(today.t)) {
              wb = [...wb.slice(0, -1), { t: today.t, o: last.o, h: Math.max(last.h, today.h), l: Math.min(last.l, today.l), c: today.c, v: last.v + today.v }];
            } else {
              wb = [...wb, today];
            }
          }
        }
        bars = wb
          .filter((b) => b.t >= fromMs)
          .map((b) => ({ time: new Date(b.t).toISOString().slice(0, 10), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v }));
        if (bars.length > 0) source = 'webull';
      } catch (e) {
        console.error('[chart] Webull bars failed, using Polygon:', (e as Error)?.message || e);
      }
    }

    if (bars.length === 0) {
      const res = await fetch(url, { next: { revalidate: 300 } });
      if (!res.ok) return NextResponse.json({ error: `Polygon ${res.status}` }, { status: 502 });
      const data = await res.json();
      const results = data.results || [];
      bars = results.map((r: any) => ({
        time: new Date(r.t).toISOString().slice(0, 10),
        open: r.o,
        high: r.h,
        low: r.l,
        close: r.c,
        volume: r.v,
      }));
    }

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

    return NextResponse.json({ bars, profile, source }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

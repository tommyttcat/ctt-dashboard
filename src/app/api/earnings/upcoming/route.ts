// app/api/earnings/upcoming/route.ts — next earnings date by ticker, for the swing checklist's
// "no earnings within 3 days" check on every card (lib/scans/checklist). 12 Oct 2026.
//
// FMP's earnings calendar (the Earnings card's source) for today through 6 days out, reduced
// to { TICKER: 'YYYY-MM-DD' } — the earliest date per name. Benzinga's calendar was tried
// first and returned 5 names for the week of 12 Oct (JPM, GS, JNJ, UNH, TRV); FMP returned
// 312, including TSM (15 Oct) and ASML (14 Oct).
//
// COST, measured 12 Oct: one FMP call = 62 KB. Edge-cached 6 hours (dates do not move
// intraday), stale up to a day: at most ~4 calls per region per day, ~25 MB a month against
// the 20 GB plan. No KV. Flat in users. A failed call answers an empty map cached for a
// minute, so the check reads "not checked" rather than "clear".

import { NextResponse } from 'next/server';
import { cacheHeaders } from '@/lib/httpCache';

export const dynamic = 'force-dynamic';

const etDate = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

export async function GET() {
  const key = (process.env.FMP_API_KEY || '').trim();
  const from = etDate(Date.now()), to = etDate(Date.now() + 6 * 864e5);
  const dates: Record<string, string> = {};
  let ok = false;
  if (key) {
    try {
      const res = await fetch(`https://financialmodelingprep.com/stable/earnings-calendar?from=${from}&to=${to}&apikey=${key}`,
        { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const j = await res.json();
        for (const r of Array.isArray(j) ? j : []) {
          const t = String(r?.symbol || '').toUpperCase(), d = String(r?.date || '').slice(0, 10);
          if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
          if (!dates[t] || d < dates[t]) dates[t] = d;
        }
        ok = Object.keys(dates).length > 0;
      }
    } catch (e) {
      console.error('EARNINGS_UPCOMING_ERROR', String((e as Error)?.message || e).slice(0, 160));
    }
  }
  return NextResponse.json({ ok, from, to, count: Object.keys(dates).length, dates },
    { headers: cacheHeaders(ok ? { sMaxAge: 21600, swr: 86400 } : { sMaxAge: 60, swr: 60 }) });
}

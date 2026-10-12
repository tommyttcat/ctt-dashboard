// app/api/earnings/upcoming/route.ts — next earnings date by ticker, for the swing checklist's
// "no earnings within 3 days" check on every card (lib/scans/checklist). 12 Oct 2026.
//
// One Benzinga calendar call (the scanner's endpoint and key) for today through 6 days out,
// reduced to { TICKER: 'YYYY-MM-DD' } — the earliest date per name. Edge-cached (SLOW: 10 min,
// stale up to an hour): at most one Benzinga call per region per 10 minutes, no KV, flat in
// users. A failed call answers an empty map that is cached only briefly, so the check reads
// "not checked" rather than "clear".

import { NextResponse } from 'next/server';
import { CACHE, cacheHeaders } from '@/lib/httpCache';

export const dynamic = 'force-dynamic';

const etDate = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

export async function GET() {
  const key = (process.env.NEXT_PUBLIC_BENZINGA_API_KEY || process.env.BENZINGA_API_KEY || '').trim();
  const from = etDate(Date.now()), to = etDate(Date.now() + 6 * 864e5);
  const dates: Record<string, string> = {};
  let ok = false;
  if (key) {
    try {
      const res = await fetch(`https://api.benzinga.com/api/v2.1/calendar/earnings?token=${key}&parameters[date_from]=${from}&parameters[date_to]=${to}&pagesize=1000`,
        { headers: { accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const j = await res.json();
        for (const r of Array.isArray(j?.earnings) ? j.earnings : []) {
          const t = String(r?.ticker || '').toUpperCase(), d = String(r?.date || '');
          if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
          if (!dates[t] || d < dates[t]) dates[t] = d;
        }
        ok = true;
      }
    } catch (e) {
      console.error('EARNINGS_UPCOMING_ERROR', String((e as Error)?.message || e).slice(0, 160));
    }
  }
  return NextResponse.json({ ok, from, to, count: Object.keys(dates).length, dates },
    { headers: cacheHeaders(ok ? CACHE.SLOW : { sMaxAge: 60, swr: 60 }) });
}

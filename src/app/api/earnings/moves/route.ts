// app/api/earnings/moves/route.ts — options-priced earnings moves for the swing checklist's
// "earnings within 3 days" line (lib/earningsMoves). 12 Nov 2026.
//
//   GET                 → { ok, moves: { TICKER: { d, time, pct } } } for today + 3 calendar days
//   GET ?hist=A,B,C     → { ok, hist: { TICKER: { n, beat, max } } } (max 40 names)
//
// COST (measured 12 Nov): reporter lists = 2 Unusual Whales calls per weekday in the window
// (<=8), 14-72 KB each, held 1 hour per date in the server data cache, shared by every viewer:
// <=~100 calls a session day if a page is opened every hour, ~2K a month. History = 1 call per
// ticker (~75 KB), held for the ET day, asked for only by rows actually shown with earnings
// within 3 days: a few to ~20 a day, ~400 a month. No KV. Flat in users.
// Never edge-cached: an edge copy skips the login check, and this is licensed data.
// What silently defeats it: a cache key that changes faster than the date (keys are date and
// date+ticker only).

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { unstable_cache } from 'next/cache';
import { verifySession, SESSION_COOKIE } from '@/lib/auth';
import { noCacheHeaders } from '@/lib/httpCache';
import { uwConfigured } from '@/lib/uw';
import { etDateString } from '@/lib/marketCalendar';
import { reportersOn, historyFor, type EarnHist, type EarnMove } from '@/lib/earningsMoves';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const cachedDay = (date: string) => unstable_cache(() => reportersOn([date]), ['earn-moves-v1', date], { revalidate: 3_600 })();
const cachedHist = (date: string, t: string) => unstable_cache(() => historyFor(t), ['earn-hist-v1', date, t], { revalidate: 86_400 })();

/** Today plus the next 3 calendar days, weekends dropped (no reports). */
function windowDates(today: string): string[] {
  const out: string[] = [];
  for (let k = 0; k <= 3; k++) {
    const d = new Date(Date.parse(`${today}T12:00:00Z`) + k * 864e5);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export async function GET(req: Request) {
  const jar = await cookies();
  const session = await verifySession(jar.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!session) return NextResponse.json({ error: 'sign in' }, { status: 401, headers: noCacheHeaders() });
  if (!uwConfigured()) return NextResponse.json({ ok: false, error: 'flow feed key not set' }, { headers: noCacheHeaders() });

  const today = etDateString();
  const histParam = new URL(req.url).searchParams.get('hist');
  if (histParam) {
    const names = [...new Set(histParam.split(',').map(s => s.trim().toUpperCase()).filter(s => /^[A-Z.\-]{1,10}$/.test(s)))].slice(0, 40);
    const hist: Record<string, EarnHist> = {};
    let next = 0;
    const worker = async () => {            // 3 at a time: the plan's in-flight cap
      while (next < names.length) {
        const t = names[next++];
        const h = await cachedHist(today, t).catch(() => null);
        if (h) hist[t] = h;
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    console.log(`[earn-moves] hist asked ${names.length} got ${Object.keys(hist).length}`);
    return NextResponse.json({ ok: true, hist }, { headers: noCacheHeaders() });
  }

  const moves: Record<string, EarnMove> = {};
  let failed = 0;
  for (const d of windowDates(today)) {
    const m = await cachedDay(d).catch(() => { failed++; return null; });
    for (const [t, v] of Object.entries(m ?? {})) if (!moves[t] || v.d < moves[t].d) moves[t] = v;
  }
  console.log(`[earn-moves] ${Object.keys(moves).length} names, ${failed} days failed`);
  return NextResponse.json({ ok: Object.keys(moves).length > 0, moves }, { headers: noCacheHeaders() });
}

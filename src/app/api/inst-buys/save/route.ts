// app/api/inst-buys/save/route.ts — the Institutional Buys daily snapshot (12 Nov 2026).
//
// Vercel cron, 16:20 ET on weekdays: fires at 20:20 and 21:20 UTC and etGate
// keeps the one that is 16:xx in New York (lib/etCron). Builds the finished
// session's Buying / Selling lists fresh and appends them to inst_buys_hist_v1
// (lib/instBuysHist) — the card's "days in a row" and "held?" both read it.
//
// COST: 7 Unusual Whales calls, 1 KV read + 1 KV write (~2 KB a day, 10 days
// kept) per session day. The off-hour firing returns before reading anything.
// Flat in users. Silent failure to watch for: if this never fires, DAYS stays 1
// and HELD never shows — check inst_buys_hist_v1 has today's date after 16:20 ET.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { authorized } from '@/lib/apiAuth';
import { etGate } from '@/lib/etCron';
import { getMarketDay, etDateString } from '@/lib/marketCalendar';
import { uwConfigured } from '@/lib/uw';
import { buildInstBuys } from '@/lib/instBuys';
import { INST_HIST_KEY, toHistDay, mergeHist, type InstHist } from '@/lib/instBuysHist';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const gate = etGate([16], 'inst-buys snapshot');
  if (gate) return gate;

  const today = etDateString();
  if (!getMarketDay(today).isTradingDay) return NextResponse.json({ success: true, skipped: 'not a trading day', date: today });
  if (!uwConfigured()) return NextResponse.json({ success: false, error: 'flow feed key not set' }, { status: 500 });

  const p = await buildInstBuys(new Date(), null);
  if (p.session !== today) return NextResponse.json({ success: false, error: `built session ${p.session}, expected ${today}` }, { status: 500 });
  if (!p.buy.length && !p.sell.length) return NextResponse.json({ success: true, written: false, reason: 'empty lists', date: today });

  const day = toHistDay(p);
  const hist = mergeHist(await kv.get<InstHist>(INST_HIST_KEY), day);
  await kv.set(INST_HIST_KEY, hist);
  console.log(`[inst-buys/save] ${today} buy ${day.buy.length} sell ${day.sell.length} kept ${hist.days.length} days`);
  return NextResponse.json({
    success: true, written: true, date: today, days: hist.days.length,
    buy: day.buy.map(r => r.t), sell: day.sell.map(r => r.t),
    bets: [...day.buy, ...day.sell].filter(r => r.bet).length,
  });
}

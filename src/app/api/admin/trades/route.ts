// app/api/admin/trades/route.ts — the owner's trade log (lib/tradeLog), admin cookie only.
//
// GET: the log scored against QQQ. POST { action: 'save', trade } | { action: 'delete', id }.
//
// Cost: GET = 1 KV read + 1 Polygon call for QQQ's daily bars since the first buy + 1
// Polygon call per OPEN trade (last close). POST = 1 KV read + 1 write. Admin-only and
// never cached, so it is flat in subscribers: nothing runs unless the owner opens the page.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { kv } from '@vercel/kv';
import { verifySession, SESSION_COOKIE } from '@/lib/auth';
import { noCacheHeaders } from '@/lib/httpCache';
import { TRADE_LOG_KEY, MAX_TRADES, cleanTrade, scoreTrades, summarize, type Bars, type TradeLog } from '@/lib/tradeLog';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const KEY = process.env.POLYGON_API_KEY || '';
const etDate = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

async function admin(): Promise<boolean> {
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  return !!session?.isAdmin;
}

async function pg<T>(path: string): Promise<T | null> {
  if (!KEY) return null;
  const res = await fetch(`https://api.polygon.io${path}${path.includes('?') ? '&' : '?'}apiKey=${KEY}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) }).catch(() => null);
  return res?.ok ? ((await res.json().catch(() => null)) as T | null) : null;
}

export async function GET() {
  if (!(await admin())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const today = etDate(Date.now());
  const log = (await kv.get<TradeLog>(TRADE_LOG_KEY)) ?? { trades: [], updatedAt: '' };
  const trades = log.trades;
  const bars: Bars = {};
  const last: Record<string, number> = {};
  if (trades.length) {
    const from = trades.reduce((m, t) => (t.buyDate < m ? t.buyDate : m), today);
    const q = await pg<{ results?: { t: number; o: number; c: number }[] }>(`/v2/aggs/ticker/QQQ/range/1/day/${from}/${today}?adjusted=true&sort=asc&limit=5000`);
    for (const r of q?.results ?? []) bars[etDate(r.t)] = [r.o, r.c];
    const openTickers = [...new Set(trades.filter(t => t.sell == null).map(t => t.t))];
    await Promise.all(openTickers.map(async t => {
      const p = await pg<{ results?: { c: number }[] }>(`/v2/aggs/ticker/${encodeURIComponent(t)}/prev?adjusted=true`);
      const c = p?.results?.[0]?.c; if (c && c > 0) last[t] = c;
    }));
  }
  const rows = scoreTrades(trades, bars, last, today).sort((a, b) => (a.open !== b.open ? (a.open ? -1 : 1) : b.buyDate.localeCompare(a.buyDate)));
  return NextResponse.json({ rows, summary: summarize(rows), updatedAt: log.updatedAt, qqqBars: Object.keys(bars).length }, { headers: noCacheHeaders() });
}

export async function POST(req: Request) {
  if (!(await admin())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { action?: string; trade?: Record<string, unknown>; id?: string } | null;
  if (!body) return NextResponse.json({ error: 'bad request' }, { status: 400 });
  const log = (await kv.get<TradeLog>(TRADE_LOG_KEY)) ?? { trades: [], updatedAt: '' };
  if (body.action === 'delete') {
    log.trades = log.trades.filter(t => t.id !== body.id);
  } else if (body.action === 'save' && body.trade) {
    const t = cleanTrade(body.trade, etDate(Date.now()));
    if (typeof t === 'string') return NextResponse.json({ error: t }, { status: 400 });
    const i = log.trades.findIndex(x => x.id === t.id);
    if (i >= 0) log.trades[i] = t;
    else { if (log.trades.length >= MAX_TRADES) return NextResponse.json({ error: 'log is full' }, { status: 400 }); log.trades.push(t); }
  } else {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
  log.updatedAt = new Date().toISOString();
  await kv.set(TRADE_LOG_KEY, log);
  return NextResponse.json({ success: true, count: log.trades.length }, { headers: noCacheHeaders() });
}

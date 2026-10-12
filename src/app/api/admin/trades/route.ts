// app/api/admin/trades/route.ts — the owner's trade log (lib/tradeLog), admin cookie only.
//
// GET: the log scored against QQQ. POST { action: 'save', trade } | { action: 'delete', id }.
//
// Cost: GET = 1 KV read + 1 Polygon call for QQQ's daily bars since the first buy + 1
// Polygon call per OPEN trade (last close). POST = 1 KV read + 1 write, plus one 11-key mget when a NEW trade is
// logged on its buy day (its checklist colour at entry, from the scan rows). Admin-only and
// never cached, so it is flat in subscribers: nothing runs unless the owner opens the page.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { kv } from '@vercel/kv';
import { verifySession, SESSION_COOKIE } from '@/lib/auth';
import { noCacheHeaders } from '@/lib/httpCache';
import { TRADE_LOG_KEY, MAX_TRADES, cleanTrade, scoreTrades, summarize, type Bars, type Trade, type TradeLog } from '@/lib/tradeLog';
import { setMarketUp, setGroups } from '@/lib/scans/checklist';
import { checkedFor } from '@/lib/scans/edge';
import { EXPOSURE_KEY } from '@/lib/exposure';
import { SYSTEM_SCORES_KEY } from '@/lib/system';

/* Where to look a ticker up, in order: the day cards first for a day trade, the swing cards
   first for a swing. [KV key, label, the scan's source key]. */
const DAY_SRC: [string, string, string][] = [['stocks_in_play_v6', 'Stocks in Play', 'sip'], ['ep9m_v1', 'EP9M', 'ep9m']];
const SWING_SRC: [string, string, string][] = [
  ['swing_candidates_v1', 'Swing', 'swing'], ['consol_1021_v1', '10/21', 'coil'], ['vcp_v1', 'VCP', 'vcp'],
  ['daily_setups_v6', 'Daily', 'daily'], ['dvol_rows_v1', 'DVol', 'dvol'], ['hrs_results_v1', 'HRS', 'hrs'],
];

/** The ticker's checklist colour right now, from the scan rows in KV (one mget, admin saves only). */
async function colourAtEntry(t: string, mode: 'day' | 'swing'): Promise<Trade['atEntry']> {
  const order = mode === 'day' ? [...DAY_SRC, ...SWING_SRC] : [...SWING_SRC, ...DAY_SRC];
  const vals = await kv.mget<unknown[]>(...order.map(o => o[0]), EXPOSURE_KEY, SYSTEM_SCORES_KEY);
  const ex = vals[order.length] as { qqq?: number; sma200?: number } | null, sc = vals[order.length + 1] as { group?: Record<string, number> } | null;
  setMarketUp(ex && typeof ex.qqq === 'number' && typeof ex.sma200 === 'number' ? ex.qqq > ex.sma200 : null);
  setGroups(sc?.group ?? null);
  for (let i = 0; i < order.length; i++) {
    const v = vals[i] as unknown;
    const rows = (Array.isArray(v) ? v : (v as { rows?: unknown[] } | null)?.rows ?? []) as Record<string, unknown>[];
    const row = rows.find(r => String(r?.ticker ?? r?.symbol ?? r?.t ?? '').toUpperCase() === t);
    if (!row) continue;
    const c = checkedFor(order[i][2], row);   // the same colour the card shows (universal swing + measured green)
    if (!c) continue;
    return { tier: c.tier, mode, src: order[i][1], checks: c.checks.map(k => [k.label, k.ok]), reds: c.reds, at: new Date().toISOString() };
  }
  return null;
}

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
    if (i >= 0) log.trades[i] = { ...t, atEntry: log.trades[i].atEntry ?? null };   // an edit keeps the colour it was logged with
    else {
      if (log.trades.length >= MAX_TRADES) return NextResponse.json({ error: 'log is full' }, { status: 400 });
      /* Colour at entry only for a trade logged on its buy day — a back-filled trade would get
         today's colour, not the one it was bought on. */
      const today = etDate(Date.now());
      t.atEntry = t.buyDate === today ? await colourAtEntry(t.t, t.style ?? 'swing').catch(() => null) : null;
      log.trades.push(t);
    }
  } else {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
  log.updatedAt = new Date().toISOString();
  await kv.set(TRADE_LOG_KEY, log);
  return NextResponse.json({ success: true, count: log.trades.length }, { headers: noCacheHeaders() });
}

// app/api/track/epn/route.ts — the neglected-EP forward paper record.
//
// Nightly at 20:25 ET (after /api/track/tick). Shown nowhere on the site: it
// exists to find out whether the one idea that tested positive per trade
// (lib/epNeglect, 9 Oct 2026: +0.93% a trade over 86 trades, not
// distinguishable from luck) keeps that edge on trades the test never saw.
//
// Each night: step the open paper positions on today's daily bars; find
// today's 10%+ gaps from the whole-market daily bars; check the daily rules
// on each gapper's own 200-session history; for the ones that pass, judge
// the entry on today's 1-minute bars. Same functions the equivalence check
// proved identical to the backtest (scripts/backtest/epn-equivalence.ts).
//
// Cost per run: 1 KV get + 1 set (a few KB). Polygon: 2 grouped-daily calls,
// 1 SPY history call, 1 history call per 10%+ gapper (capped at 150), 1
// minute call per gapper that passes the daily rules (~0-2 a night). Flat in
// users — nothing here runs on a page view. `?view=1` (admin or key) reads
// the record without writing.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { etGate } from '@/lib/etCron';
import { authorized, authorizedOrAdmin } from '@/lib/apiAuth';
import { etMinute, fetchSessionMinutes } from '@/lib/orb';
import {
  EPN_KEY, EPN_RECENT_CAP, emptyEpnRecord, epnDaily, epnEntry, epnEntryDay, epnStep,
  type DayBar, type EpnPosition, type EpnRecord, type Minute,
} from '@/lib/epNeglect';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const POLYGON_KEY = process.env.POLYGON_API_KEY || '';
const MAX_GAPPERS = 150;
const etDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

type G = Map<string, DayBar>;

async function grouped(date: string): Promise<G | null> {
  const res = await fetch(`https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true&apiKey=${POLYGON_KEY}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) }).catch(() => null);
  if (!res?.ok) return null;
  const j = await res.json().catch(() => null);
  const rows: { T: string; o: number; h: number; l: number; c: number; v: number }[] = j?.results ?? [];
  if (!rows.length) return null;
  return new Map(rows.map(r => [r.T, { o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }]));
}

/** The latest two sessions with data, newest first. */
async function lastTwoSessions(): Promise<{ date: string; bars: G }[]> {
  const out: { date: string; bars: G }[] = [];
  for (let back = 0; back < 10 && out.length < 2; back++) {
    const date = etDate(new Date(Date.now() - back * 86400000));
    const bars = await grouped(date);
    if (bars) out.push({ date, bars });
  }
  return out;
}

type Hist = { date: string; bar: DayBar }[];
async function history(ticker: string, from: string, to: string): Promise<Hist | null> {
  const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=500&apiKey=${POLYGON_KEY}`;
  for (let a = 0; a < 2; a++) {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (res?.ok) {
      const j = await res.json().catch(() => null);
      if (j) return (j.results ?? []).map((r: { t: number; o: number; h: number; l: number; c: number; v: number }) => ({ date: etDate(new Date(r.t)), bar: { o: r.o, h: r.h, l: r.l, c: r.c, v: r.v } }));
    }
  }
  return null;
}

const summary = (r: EpnRecord) => ({
  startedOn: r.startedOn, lastDate: r.lastDate ?? null,
  trades: r.tally.trades, closed: r.tally.closed, open: r.open.length,
  winRate: r.tally.closed ? +(100 * r.tally.wins / r.tally.closed).toFixed(1) : null,
  avgRetPct: r.tally.closed ? +(100 * r.tally.sumRet / r.tally.closed).toFixed(2) : null,
  skipped: r.tally.skipped,
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get('view') === '1') {
    if (!(await authorizedOrAdmin(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const r = await kv.get<EpnRecord>(EPN_KEY);
    return NextResponse.json(r ? { ...summary(r), openPositions: r.open, recentClosed: r.closed.slice(0, 30) } : { empty: true });
  }
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const gate = etGate([20], 'EP neglect paper record');
  if (gate) return gate;
  if (!POLYGON_KEY) return NextResponse.json({ success: false, error: 'no data key' }, { status: 500 });

  const two = await lastTwoSessions();
  if (two.length < 2) return NextResponse.json({ success: false, error: 'no session bars' });
  const [{ date: D, bars: today }, { date: P, bars: prev }] = two;

  const rec = (await kv.get<EpnRecord>(EPN_KEY)) || emptyEpnRecord(D);
  if (rec.lastDate === D) return NextResponse.json({ success: true, note: `already ran ${D}`, ...summary(rec) });

  // 1. Walk the open paper positions one session forward.
  for (const pos of rec.open) {
    const b = today.get(pos.t);
    if (b) epnStep(pos, b, D);
  }

  // 2. Today's 10%+ gaps, biggest dollar volume first.
  const gappers = [...today.entries()]
    .filter(([t, b]) => { const p = prev.get(t); return !!p && b.o >= 5 && b.o >= 1.10 * p.c; })
    .sort((a, b) => b[1].c * b[1].v - a[1].c * a[1].v)
    .slice(0, MAX_GAPPERS);

  // The market calendar for "every one of the last 200 sessions present".
  const from = etDate(new Date(Date.parse(`${P}T12:00:00Z`) - 330 * 86400000));
  const spy = await history('SPY', from, P);
  const cal = spy ? spy.map(x => x.date).slice(-200) : null;
  if (!cal || cal.length < 200 || cal[cal.length - 1] !== P) {
    return NextResponse.json({ success: false, error: 'no SPY calendar', D, P });
  }

  const why: Record<string, number> = {};
  const added: string[] = [];
  for (let i = 0; i < gappers.length; i += 8) {
    const batch = gappers.slice(i, i + 8);
    const hists = await Promise.all(batch.map(([t]) => history(t, from, P)));
    for (let j = 0; j < batch.length; j++) {
      const [t, bar] = batch[j];
      const h = hists[j];
      if (!h) { why.fetch = (why.fetch ?? 0) + 1; continue; }
      const byDate = new Map(h.map(x => [x.date, x.bar]));
      if (cal.some(d => !byDate.has(d))) { why.history = (why.history ?? 0) + 1; continue; }
      const hist = cal.map(d => byDate.get(d)!);
      const chk = epnDaily(hist, bar.o);
      if (!chk.ok) { why[chk.why!] = (why[chk.why!] ?? 0) + 1; continue; }
      const raw = await fetchSessionMinutes(t, D, POLYGON_KEY);
      if (!raw) { why.minutes = (why.minutes ?? 0) + 1; continue; }
      const mins = (raw as Minute[]).filter(m => { const x = etMinute(m[0]); return x >= 570 && x < 960; });
      const e = epnEntry(mins, etMinute, chk.adv, chk.atr);
      if (!e.ok) { rec.tally.skipped[e.why] = (rec.tally.skipped[e.why] ?? 0) + 1; why[e.why] = (why[e.why] ?? 0) + 1; continue; }
      const pos: EpnPosition = {
        t, d: D, gap: chk.gap, fill: e.fill, stop: e.stop, stop0: e.stop, day: 1, left: 1,
        closes: [...hist.slice(-8).map(b => b.c), bar.c], exits: [], ret: null,
      };
      epnEntryDay(pos, mins, e.k);
      rec.open.push(pos);
      rec.tally.trades += 1;
      added.push(t);
    }
  }

  // 3. Retire the closed ones into the record.
  const done = rec.open.filter(p => p.left <= 0 && p.ret != null);
  for (const p of done) {
    rec.tally.closed += 1;
    rec.tally.sumRet = +(rec.tally.sumRet + (p.ret as number)).toFixed(6);
    if ((p.ret as number) > 0) rec.tally.wins += 1;
  }
  rec.closed = [...done.reverse(), ...rec.closed].slice(0, EPN_RECENT_CAP);
  rec.open = rec.open.filter(p => p.left > 0);
  rec.lastDate = D;
  rec.updatedAt = new Date().toISOString();
  await kv.set(EPN_KEY, rec);

  return NextResponse.json({ success: true, D, gappers: gappers.length, added, closedToday: done.map(p => p.t), why, ...summary(rec) });
}

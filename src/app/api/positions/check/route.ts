// app/api/positions/check/route.ts — stop alerts for the owner's open positions.
//
// 28 Sep 2026: the owner holds BE and CRDO (bought from the old brief's
// day-high levels) and asked for them to be "dialed in". Every minute from
// 4:00 AM to 7:59 PM ET on trading days this reads the live price (pre-market
// and after-hours included) for each position in the POSITION_STOPS env var
// ("BE:269.05,CRDO:198.86") and emails the owner (BREAKOUT_ALERT_TO) when one
// comes within 1% of its stop ("near") or trades at or below it ("broke") —
// each kind at most once per ticker per day. It sells nothing and advises
// nothing; the decision stays the owner's.
//
// Cost per run: one KV read (the day's sent-state), one Webull snapshot call
// for all positions; a KV write only when an alert goes out. About 960 runs a
// day, nothing per page view.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { Resend } from 'resend';
import { authorized } from '@/lib/apiAuth';
import { etGate } from '@/lib/etCron';
import { isTradingDay } from '@/lib/marketCalendar';
import { webullConfigured, webullSnapshot } from '@/lib/webull';
import { etToday } from '@/lib/orb';
import { buildStopAlertEmail, stopAlertSubject } from '@/lib/email/stopAlertEmail';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const STATE_KEY = 'position_alerts_v1';
const NEAR = 0.01;

type State = { date: string; sent: Record<string, string[]> };

function parseStops(raw: string | undefined): { t: string; stop: number }[] {
  return String(raw || '').split(',').map(x => x.trim()).filter(Boolean)
    .map(x => { const [t, s] = x.split(':'); return { t: (t || '').trim().toUpperCase(), stop: Number(s) }; })
    .filter(p => p.t && Number.isFinite(p.stop) && p.stop > 0);
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const gate = etGate([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19], 'position stops');
  if (gate) return gate;
  if (!isTradingDay(new Date())) return NextResponse.json({ success: true, skipped: 'not a trading day' });
  const positions = parseStops(process.env.POSITION_STOPS);
  if (!positions.length) return NextResponse.json({ success: true, skipped: 'no positions' });
  if (!webullConfigured()) return NextResponse.json({ success: false, error: 'webull not configured' }, { status: 500 });

  const snaps = await webullSnapshot(positions.map(p => p.t), 'US_STOCK', { extendedHours: true }).catch(() => []);
  const today = etToday();
  const prior = await kv.get<State>(STATE_KEY);
  const state: State = prior?.date === today ? prior : { date: today, sent: {} };

  const alerts: { t: string; kind: 'near' | 'broke'; price: number; stop: number }[] = [];
  const seen: Record<string, number> = {};
  for (const p of positions) {
    const q = snaps.find(x => x.symbol === p.t);
    // The latest print: the extended-hours one when there is one, else the regular price.
    const price = q ? (q.extPrice && q.extPrice > 0 ? q.extPrice : q.price) : NaN;
    if (!(price > 0)) continue;
    seen[p.t] = price;
    const kind = price <= p.stop ? 'broke' : price <= p.stop * (1 + NEAR) ? 'near' : null;
    const done = state.sent[p.t] ?? [];
    if (kind && !done.includes(kind)) alerts.push({ t: p.t, kind, price, stop: p.stop });
  }

  let sent = 0;
  const to = (process.env.BREAKOUT_ALERT_TO || '').split(',').map(e => e.trim()).filter(e => e.includes('@'));
  if (alerts.length && to.length && process.env.RESEND_API_KEY) {
    const etTime = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
    const resend = new Resend(process.env.RESEND_API_KEY);
    const res = await Promise.allSettled(to.map(addr => resend.emails.send({
      from: 'CTT <noreply@confluencetradingtools.com>', to: addr,
      subject: stopAlertSubject(alerts), html: buildStopAlertEmail(alerts, etTime),
    })));
    sent = res.filter(r => r.status === 'fulfilled').length;
    if (sent > 0) {
      for (const a of alerts) state.sent[a.t] = [...(state.sent[a.t] ?? []), a.kind];
      await kv.set(STATE_KEY, state);
    }
  }
  return NextResponse.json({ success: true, prices: seen, alerts: alerts.map(a => `${a.t}:${a.kind}`), sent });
}

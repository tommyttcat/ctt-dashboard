// app/api/orb/live/route.ts — today's breakout watch, judged in real time.
//
// Every minute from 10:00 to 16:00 ET on trading days (Vercel cron, both UTC
// hours covered, etGate keeps it to the ET window across DST). For each name
// on last night's watch (lib/orb ORB_WATCH_KEY) it pulls today's closed
// one-minute bars from Webull — real time — and runs the same orbWatchRow the
// scanner runs on Polygon's 15-minute-delayed bars. The result goes to
// ORB_LIVE_KEY; every reader takes the freshest status for today
// (freshestWatch), so the tables, the Buy & stop box, the watch strip, News
// and watchlist alerts see a breakout about a minute after it happens.
//
// Alerts: a name that turns GO, or STOPPED after GO, is emailed once per
// state per day to the addresses in the BREAKOUT_ALERT_TO env var (comma-
// separated; the owner only, 27 Sep 2026) plus any in BREAKOUT_TO_KEY. None
// at all is a dry run: everything is judged and stored, nothing is sent.
//
// Cost, per run: one KV mget (watch + live + recipients) and one set; one
// Webull minute-bar call per watch name (MAX_NAMES cap, 60/min endpoint
// limit). About 360 working runs a day. Nothing per page view.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { Resend } from 'resend';
import { authorized } from '@/lib/apiAuth';
import { etGate } from '@/lib/etCron';
import { isTradingDay } from '@/lib/marketCalendar';
import { webullConfigured, webullBars, webullSnapshot } from '@/lib/webull';
import {
  ORB_WATCH_KEY, ORB_LIVE_KEY, orbWatchRow, etMinute, etToday,
  type OrbWatch, type OrbLiveStatus, type OrbWatchRow, type Minute,
} from '@/lib/orb';
import { buildBreakoutEmail, breakoutSubject } from '@/lib/email/breakoutEmail';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_NAMES = 25;
/** string[] of recipient addresses; missing or empty = dry run. */
export const BREAKOUT_TO_KEY = 'breakout_alert_to_v1';

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const gate = etGate([10, 11, 12, 13, 14, 15], 'breakout live');
  if (gate) return gate;
  if (!isTradingDay(new Date())) return NextResponse.json({ success: true, skipped: 'not a trading day' });
  if (!webullConfigured()) return NextResponse.json({ success: false, error: 'webull not configured' }, { status: 500 });

  const [watch, prior, to] = await kv.mget<[OrbWatch | null, OrbLiveStatus | null, string[] | null]>(ORB_WATCH_KEY, ORB_LIVE_KEY, BREAKOUT_TO_KEY);
  const today = etToday();
  const ageDays = watch ? (Date.parse(today) - Date.parse(watch.pickedOn)) / 864e5 : Infinity;
  // The previous session's list only: after a weekend or a holiday, not a stale one.
  if (!watch?.names?.length || !(watch.pickedOn < today) || ageDays > 4) {
    return NextResponse.json({ success: true, skipped: 'no current watch', pickedOn: watch?.pickedOn ?? null });
  }

  const nowMin = etMinute(Date.now());
  const names = watch.names.slice(0, MAX_NAMES);
  // The dip buys' live prices: one snapshot call for all of them.
  const dipsIn = watch.dips ?? [];
  const snaps = dipsIn.length ? await webullSnapshot(dipsIn.map(d => d.t), 'US_STOCK').catch(() => []) : [];
  const px = new Map(snaps.map(q => [q.symbol, q.price]));
  const dips = dipsIn.map(d => ({ ...d, last: px.get(d.t) ?? (prior?.session === today ? prior.dips?.find(x => x.t === d.t)?.last : null) ?? null }));
  const judged = await Promise.all(names.map(async n => {
    const mins = await webullBars(n.t, 'M1', 420)
      .then(bs => bs.map(b => [b.t, b.o, b.h, b.l, b.c, b.v] as Minute))
      .catch(() => null);
    return orbWatchRow(n, mins, nowMin);
  }));

  // A failed fetch keeps the name's last good state for today rather than flipping to NO DATA.
  const before = new Map((prior?.session === today ? prior.rows : []).map(r => [r.t, r]));
  const rows = judged.map(r => (r.state === 'nodata' && before.get(r.t) ? before.get(r.t)! : r));
  const alerted: Record<string, string> = { ...(prior?.session === today ? prior.alerted ?? {} : {}) };
  const fresh: OrbWatchRow[] = rows.filter(r => (r.state === 'go' || r.state === 'stopped') && alerted[r.t] !== r.state);

  const fromEnv = (process.env.BREAKOUT_ALERT_TO || '').split(',').map(e => e.trim());
  const recipients = [...new Set([...fromEnv, ...(Array.isArray(to) ? to : [])])].filter(e => typeof e === 'string' && e.includes('@'));
  let sent = 0, failed = 0;
  if (fresh.length && recipients.length) {
    const apiKey = process.env.RESEND_API_KEY || '';
    if (apiKey) {
      const etTime = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
      const resend = new Resend(apiKey);
      const results = await Promise.allSettled(recipients.map(addr => resend.emails.send({
        from: 'CTT <noreply@confluencetradingtools.com>',
        to: addr,
        subject: breakoutSubject(fresh),
        html: buildBreakoutEmail(fresh, etTime),
      })));
      sent = results.filter(r => r.status === 'fulfilled').length;
      failed = results.length - sent;
      // Marked as alerted only once at least one address got it, so a Resend outage retries next minute.
      if (sent > 0) for (const r of fresh) alerted[r.t] = r.state;
    } else {
      console.error('ORB_LIVE: RESEND_API_KEY not configured');
    }
  }

  const status: OrbLiveStatus = { pickedOn: watch.pickedOn, session: today, asOf: Date.now(), rows, dips, source: 'webull', alerted };
  await kv.set(ORB_LIVE_KEY, status);

  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.state] = (counts[r.state] ?? 0) + 1;
  return NextResponse.json({
    success: true, pickedOn: watch.pickedOn, names: rows.length, states: counts,
    changed: fresh.map(r => `${r.t}:${r.state}`), sent, failed, dryRun: recipients.length === 0,
  });
}

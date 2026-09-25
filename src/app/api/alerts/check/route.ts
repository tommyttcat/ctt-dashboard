// app/api/alerts/check/route.ts — the watchlist alert cron (lib/alerts).
//
// Every 15 minutes, gated here to 9:30–16:15 ET on trading days (the cron
// fires across both candidate UTC ranges so DST never moves it; outside the
// window it returns before any KV call). Per check: HGETALL of the opted-in
// index, one MGET of the six plan-scan lists, the last-seen state, and one
// write — flat in users. Emails go only to opted-in users, only when a name
// they starred moves into HIT or OUT, at most once per kind per day.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { Resend } from 'resend';
import { authorized } from '@/lib/apiAuth';
import { etParts } from '@/lib/etCron';
import { isTradingDay } from '@/lib/marketCalendar';
import {
  ALERT_INDEX_KEY, ALERT_STATE_KEY, ALERT_SCANS,
  statusesFor, computeAlerts, normaliseIndex, type AlertState,
} from '@/lib/alerts';
import { buildAlertEmail, alertSubject } from '@/lib/email/alertEmail';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const etDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { hour, minute, hhmm } = etParts();
  const mins = hour * 60 + minute;
  if (!isTradingDay(new Date()) || mins < 9 * 60 + 30 || mins > 16 * 60 + 15) {
    return NextResponse.json({ success: true, skipped: 'outside market hours', etNow: hhmm });
  }

  const index = normaliseIndex(await kv.hgetall<Record<string, unknown>>(ALERT_INDEX_KEY));
  const wanted = new Set(Object.values(index).flat());
  if (wanted.size === 0) return NextResponse.json({ success: true, subscribers: Object.keys(index).length, watched: 0 });

  const keys = ALERT_SCANS.map(s => s.key);
  const lists = await kv.mget<unknown[][]>(...keys);
  const rowsByKey: Record<string, unknown> = Object.fromEntries(keys.map((k, i) => [k, lists?.[i] ?? []]));
  const prior = (await kv.get<AlertState>(ALERT_STATE_KEY)) || {};

  const today = etDate();
  const { byEmail, state } = computeAlerts(index, statusesFor(rowsByKey, wanted), prior, today);
  await kv.set(ALERT_STATE_KEY, state);

  const recipients = Object.keys(byEmail);
  let sent = 0, failed = 0;
  if (recipients.length) {
    const apiKey = process.env.RESEND_API_KEY || '';
    if (!apiKey) return NextResponse.json({ success: false, error: 'RESEND_API_KEY not configured', pending: recipients.length }, { status: 500 });
    const resend = new Resend(apiKey);
    const results = await Promise.allSettled(recipients.map(to => resend.emails.send({
      from: 'CTT <noreply@confluencetradingtools.com>',
      to,
      subject: alertSubject(byEmail[to]),
      html: buildAlertEmail(byEmail[to], hhmm),
    })));
    sent = results.filter(r => r.status === 'fulfilled').length;
    failed = results.length - sent;
  }

  return NextResponse.json({
    success: true, etNow: hhmm, subscribers: Object.keys(index).length, watched: wanted.size,
    alerts: Object.values(byEmail).reduce((n, a) => n + a.length, 0), sent, failed,
  });
}

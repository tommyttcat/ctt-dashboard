// app/api/health/scans/route.ts — does every card still have data behind it?
//
// WHY THIS EXISTS. Every failure this system has had has been silent. A scan
// writes an empty list, or stops writing at all, and the card renders an empty
// table that looks exactly like a quiet day. Nothing throws, nothing 500s, and
// the only alarm is a person noticing that something they expected is missing
// — which is the most expensive way to find out.
//
// So this reads what the pages read, decides whether each key is fresh and
// non-empty AT THE TIME OF DAY IT IS BEING ASKED, and — when called by its
// cron — emails when something is wrong. Silence means healthy: an alert that
// arrives daily stops being read by the second week.
//
// Freshness has to be time-aware or it is noise. Inside the session the
// scanners run every 15 minutes, so an hour-old key is broken. Outside it,
// nothing is meant to be writing, and a Monday-morning check would otherwise
// fire on a perfectly normal weekend.
//
// Cost: one KV mget covering every key, run once a day from the cron plus
// whatever manual checks happen. No page fetches this route, so it is flat in
// users by construction. The response is cached for a minute so a refresh loop
// on the admin side cannot turn it into a KV bill.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { Resend } from 'resend';
import { getMarketDay } from '@/lib/marketCalendar';
import { etParts, etGate } from '@/lib/etCron';
import { CACHE, cacheHeaders } from '@/lib/httpCache';

export const dynamic = 'force-dynamic';

/* The payload key each card reads, and the timestamp key beside it. Keep this
   list matched to TRACKED_SCANS in lib/track and to the /latest routes — a key
   that is missing from here is a card nothing is watching. */
const WATCHED: {
  label: string; key: string; tsKey: string | null; minRows: number;
  /* Some payloads are not a list of rows. RS is an object whose `ratings`
     field holds the symbol map and whose `generatedAt` field is its own
     timestamp — counting its top-level keys returned 6 and would have passed
     an empty ratings map, which is the exact failure this route exists for. */
  rowsPath?: string; tsField?: string;
}[] = [
  { label: 'Stocks in Play', key: 'stocks_in_play_v6', tsKey: 'last_scan_time_v6', minRows: 1 },
  { label: 'Daily Setups', key: 'daily_setups_v6', tsKey: 'last_scan_time_v6', minRows: 1 },
  { label: 'EP9M', key: 'ep9m_v1', tsKey: 'ep9m_last_scan_v1', minRows: 0 },
  { label: 'VCP', key: 'vcp_v1', tsKey: 'vcp_last_scan_v1', minRows: 0 },
  { label: '10/21 Coils', key: 'consol_1021_v1', tsKey: 'consol_1021_last_scan_v1', minRows: 0 },
  { label: 'Swing Candidates', key: 'swing_candidates_v1', tsKey: 'swing_last_scan_v1', minRows: 0 },
  { label: 'Hidden RS', key: 'hrs_results_v1', tsKey: 'hrs_last_scan_v1', minRows: 0 },
  { label: '100-Bagger', key: 'multibagger_v1', tsKey: 'multibagger_last_scan_v1', minRows: 1 },
  { label: '$Vol', key: 'dvol_rows_v1', tsKey: 'dvol_last_scan_v1', minRows: 1 },
  { label: 'Confluence', key: 'confluence_report_v1', tsKey: 'confluence_last_scan_v1', minRows: 0 },
  { label: 'RS ratings', key: 'rs_ratings_v1', tsKey: null, minRows: 100, rowsPath: 'ratings', tsField: 'generatedAt' },
];

/* EP9M and the pattern scans legitimately return nothing on a quiet day, which
   is why their minRows is 0 — an empty EP9M list is information, an empty
   Stocks in Play list is a bug. The difference is deliberate; do not
   "tidy" it by making them all 1. */

const SESSION_MAX_AGE_MIN = 90;     // inside the session: scans run every 15 min
const OVERNIGHT_MAX_AGE_H = 96;     // outside it: a long weekend plus a holiday

interface Check {
  label: string;
  rows: number | null;
  ageMin: number | null;
  ok: boolean;
  problem: string | null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const alert = url.searchParams.get('alert') === '1';

  /* The cron runs mid-session, when "stale" actually means something. Gate it
     to 15:00 ET so it keeps that meaning across the DST change — see
     lib/etCron. A manual check (no ?alert=1) is never gated. */
  if (alert) {
    const gate = etGate([15], 'scan health check');
    if (gate) return gate;
  }

  const market = getMarketDay();
  const { hour } = etParts();
  // "In session" is deliberately wider than the bell: the scanners start
  // pre-market and keep running after the close.
  const inSession = market.isTradingDay && hour >= 10 && hour < 16;

  const keys = WATCHED.flatMap(w => (w.tsKey ? [w.key, w.tsKey] : [w.key]));
  const values = await kv.mget<unknown[]>(...keys);
  const byKey = new Map<string, unknown>();
  keys.forEach((k, i) => byKey.set(k, values[i]));

  const now = Date.now();
  const checks: Check[] = WATCHED.map(w => {
    const raw = byKey.get(w.key);
    const payload = w.rowsPath && raw && typeof raw === 'object'
      ? (raw as Record<string, unknown>)[w.rowsPath]
      : raw;
    const rows = Array.isArray(payload) ? payload.length
      : payload && typeof payload === 'object' ? Object.keys(payload as Record<string, unknown>).length
      : payload == null ? null : -1;

    /* The timestamp is either a sibling key or a field on the payload itself. */
    let ts: number | null = null;
    if (w.tsKey) {
      const tsRaw = byKey.get(w.tsKey);
      ts = typeof tsRaw === 'number' ? tsRaw : null;
    } else if (w.tsField && raw && typeof raw === 'object') {
      const v = (raw as Record<string, unknown>)[w.tsField];
      const parsed = typeof v === 'string' ? Date.parse(v) : typeof v === 'number' ? v : NaN;
      ts = Number.isFinite(parsed) ? parsed : null;
    }
    const ageMin = ts ? Math.round((now - ts) / 60000) : null;

    let problem: string | null = null;
    if (raw == null) problem = 'key missing — the scan has never written, or it was cleared';
    else if (rows != null && rows >= 0 && rows < w.minRows) problem = `only ${rows} row${rows === 1 ? '' : 's'} (expected at least ${w.minRows})`;
    else if (ageMin == null && (w.tsKey || w.tsField)) problem = 'no timestamp — cannot tell whether it is current';
    else if (ageMin != null && inSession && ageMin > SESSION_MAX_AGE_MIN) {
      problem = `${ageMin} minutes old during the session (expected under ${SESSION_MAX_AGE_MIN})`;
    } else if (ageMin != null && !inSession && ageMin > OVERNIGHT_MAX_AGE_H * 60) {
      problem = `${Math.round(ageMin / 60)} hours old`;
    }

    return { label: w.label, rows, ageMin, ok: problem == null, problem };
  });

  const problems = checks.filter(c => !c.ok);
  const ok = problems.length === 0;

  let emailed = false;
  if (alert && !ok) {
    const apiKey = process.env.RESEND_API_KEY || '';
    /* One alert per day per problem set. A cron that fires twice, or a retry,
       must not turn a single broken scan into a mailbox full of the same
       sentence. */
    const stamp = `${new Date().toISOString().slice(0, 10)}:${problems.map(p => p.label).sort().join(',')}`;
    const lock = await kv.set(`health_alert_sent:${stamp}`, 1, { nx: true, ex: 60 * 60 * 30 });
    if (apiKey && lock) {
      const rowsHtml = problems.map(p =>
        `<tr><td style="padding:4px 10px 4px 0;color:#f87171;font-weight:600;">${p.label}</td>` +
        `<td style="padding:4px 0;color:#94a3b8;">${p.problem}</td></tr>`).join('');
      const okList = checks.filter(c => c.ok).map(c => c.label).join(' · ');
      await new Resend(apiKey).emails.send({
        from: 'CTT <noreply@confluencetradingtools.com>',
        to: 'thomasbeach@gmail.com',
        subject: `CTT scan health: ${problems.length} problem${problems.length > 1 ? 's' : ''} — ${problems.map(p => p.label).join(', ')}`,
        html:
          `<div style="font-family:system-ui,sans-serif;background:#0b0f1a;color:#cbd5e1;padding:20px;border-radius:10px;">` +
          `<h2 style="font-size:15px;margin:0 0 4px;color:#f1f5f9;">Scan health</h2>` +
          `<p style="font-size:11px;color:#64748b;margin:0 0 14px;">Checked ${new Date().toISOString()} · ${inSession ? 'during the session' : 'outside the session'}</p>` +
          `<table style="font-size:12px;border-collapse:collapse;">${rowsHtml}</table>` +
          `<p style="font-size:11px;color:#64748b;margin-top:16px;">Healthy: ${okList || 'none'}</p>` +
          `<p style="font-size:11px;color:#475569;margin-top:12px;">This only arrives when something is wrong. ` +
          `<a href="https://app.confluencetradingtools.com/api/health/scans" style="color:#818cf8;">Full check</a></p></div>`,
      });
      emailed = true;
    }
  }

  return NextResponse.json({
    ok,
    inSession,
    marketDay: market.isTradingDay ? 'trading day' : market.reason,
    etHour: hour,
    problems: problems.map(p => ({ label: p.label, problem: p.problem })),
    checks,
    emailed,
  }, { headers: cacheHeaders(CACHE.SCAN) });
}

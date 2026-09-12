// app/api/track/tick/route.ts — the daily forward-tracking tick.
//
// Runs once after the last scan of the day (00:10 UTC, i.e. 8:10pm ET) and does
// three things, in this order:
//
//   1. fills yesterday's picks at today's open (entry is never known on the
//      day of the pick — that is the whole point of a forward record)
//   2. walks every open position one session forward on today's bar
//   3. records today's picks as tomorrow's fills
//
// Cost per tick, measured 11 Sep 2026: 10 KV reads (8 scan lists + open
// positions + results), 2 KV writes, 1 Polygon grouped-daily call. Flat in
// users — nothing here happens on a page view. ~11 KB of new rows a day; the
// open-position key peaks near 200 KB because positions retire after 60
// sessions. On a day where something settles, one further read and write for
// the closed log (capped at CLOSED_CAP rows, ~150 KB full).
//
// Idempotent per session: a second run on the same bar date is a no-op, so a
// retry or a manual poke cannot double-count.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import {
  TRACK_OPEN_KEY, TRACK_RESULTS_KEY, TRACK_META_KEY, TRACK_CLOSED_KEY, TRACKED_SCANS,
  CLOSED_CAP, HOLD_SESSIONS, HOLD20, rMultiple, homeRunLevel, targetFor,
  type OpenPosition, type TrackResults, type ScanRecord,
} from '@/lib/track';
import { edgeTier, multibaggerTier, swingTier, consolidationTier, ep9mTier, vcpTier, hrsTier } from '@/lib/scans/edge';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const POLYGON_KEY = process.env.POLYGON_API_KEY || '';
const etDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

interface Bar { o: number; h: number; l: number; c: number }

/** The most recent session's bars for the whole market — one call, every ticker. */
async function latestBars(): Promise<{ date: string; bars: Map<string, Bar> } | null> {
  for (let back = 0; back < 6; back++) {
    const d = new Date(Date.now() - back * 86400000);
    const date = etDate(d);
    const res = await fetch(
      `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true&apiKey=${POLYGON_KEY}`,
      { cache: 'no-store' },
    ).catch(() => null);
    if (!res?.ok) continue;
    const j = await res.json().catch(() => null);
    const rows: { T: string; o: number; h: number; l: number; c: number }[] = j?.results ?? [];
    if (rows.length === 0) continue;       // weekend or holiday
    const bars = new Map<string, Bar>();
    for (const r of rows) bars.set(r.T, { o: r.o, h: r.h, l: r.l, c: r.c });
    return { date, bars };
  }
  return null;
}

/** The row tint at pick time, per scan — so the live record can be sliced by colour. */
function tierOf(scan: string, row: Record<string, unknown>): string | null {
  if (scan === 'multibagger') return multibaggerTier({ revGrowthPct: (row.attrs as { revGrowthPct?: number })?.revGrowthPct ?? null, marketCap: row.marketCap as number ?? null });
  if (scan === 'swing') return swingTier(row as never);
  if (scan === 'consolidation') return consolidationTier(row as never);
  if (scan === 'ep9m') return ep9mTier(row as never);
  if (scan === 'vcp') return vcpTier(row as never);
  if (scan === 'hrs') return hrsTier(row as never);
  return edgeTier(row as never);           // sip + daily, the tables it was measured on
}

function emptyRecord(): ScanRecord {
  return { picks: 0, entered: 0, settled: 0, hrRate: null, fixedAvgR: null, hold20AvgR: null, winRate: null, byTier: {} };
}

export async function GET() {
  if (!POLYGON_KEY) return NextResponse.json({ success: false, error: 'no polygon key' }, { status: 500 });

  const market = await latestBars();
  if (!market) return NextResponse.json({ success: true, skipped: 'no session bars' });
  const { date, bars } = market;

  const meta = (await kv.get<{ lastBarDate?: string }>(TRACK_META_KEY)) || {};
  if (meta.lastBarDate === date) {
    return NextResponse.json({ success: true, skipped: `already ticked ${date}` });
  }

  const open = (await kv.get<OpenPosition[]>(TRACK_OPEN_KEY)) || [];
  const results = (await kv.get<TrackResults>(TRACK_RESULTS_KEY)) || {};
  const settledToday: OpenPosition[] = [];

  // 1-2. Fill yesterday's picks at today's open, then walk every live position.
  for (const p of open) {
    const bar = bars.get(p.t);
    if (!bar) continue;

    if (p.fill == null) {
      if (!(bar.o > 0)) continue;
      p.fill = bar.o;
      if (p.stop == null || !(p.stop < p.fill)) p.stop = bar.l < p.fill ? bar.l : p.fill * 0.99;
      p.target = targetFor(p.fill, p.stop);
      p.peak = bar.h;
      p.n = 1;
    } else {
      p.n += 1;
      if (bar.h > (p.peak ?? 0)) p.peak = bar.h;
    }
    // One number per position so the drill-down can show what an open trade is
    // worth today without re-fetching a bar per row.
    p.last = bar.c;

    if (p.fill == null || p.stop == null) continue;
    const hrLevel = homeRunLevel(p.fill, p.stop);
    const stopToday = bar.l <= p.stop;

    if (!p.stopped && !p.hr) {
      if (stopToday) p.stopped = true;
      else if (bar.h >= hrLevel) p.hr = true;
    }
    if (p.exitFixed == null) {
      if (stopToday) p.exitFixed = rMultiple(p.fill, p.stop, Math.min(p.stop, p.n === 1 ? p.stop : bar.o));
      else if (p.target != null && bar.h >= p.target) p.exitFixed = rMultiple(p.fill, p.stop, p.target);
    }
    if (p.exitHold20 == null) {
      if (stopToday) p.exitHold20 = rMultiple(p.fill, p.stop, Math.min(p.stop, p.n === 1 ? p.stop : bar.o));
      else if (p.n >= HOLD20) p.exitHold20 = rMultiple(p.fill, p.stop, bar.c);
    }
    if (p.n >= HOLD_SESSIONS) {
      if (p.exitFixed == null) p.exitFixed = rMultiple(p.fill, p.stop, bar.c);
      if (p.exitHold20 == null) p.exitHold20 = rMultiple(p.fill, p.stop, bar.c);
      settledToday.push(p);
    }
  }

  // Fold settled positions into the running record.
  for (const p of settledToday) {
    const rec = (results[p.scan] ||= emptyRecord());
    rec.settled += 1;
    const tierKey = p.tier || 'untinted';
    const t = (rec.byTier[tierKey] ||= { n: 0, avgR: null, hr: null });
    const roll = (prev: number | null, n: number, v: number) => (prev == null ? v : (prev * (n - 1) + v) / n);
    if (p.exitFixed != null) {
      rec.fixedAvgR = +(roll(rec.fixedAvgR, rec.settled, p.exitFixed)).toFixed(4);
      rec.winRate = +(roll(rec.winRate, rec.settled, p.exitFixed > 0 ? 100 : 0)).toFixed(2);
      t.n += 1;
      t.avgR = +(roll(t.avgR, t.n, p.exitFixed)).toFixed(4);
      t.hr = +(roll(t.hr, t.n, p.hr ? 100 : 0)).toFixed(2);
    }
    if (p.exitHold20 != null) rec.hold20AvgR = +(roll(rec.hold20AvgR, rec.settled, p.exitHold20)).toFixed(4);
    rec.hrRate = +(roll(rec.hrRate, rec.settled, p.hr ? 100 : 0)).toFixed(2);
  }

  const settledKeys = new Set(settledToday.map(p => `${p.scan}|${p.t}|${p.d}`));
  const kept = open.filter(p => !settledKeys.has(`${p.scan}|${p.t}|${p.d}`));

  /* Retire the settled trades into the closed log rather than dropping them.
     Newest first and capped: the averages above are cumulative, so an evicted
     row costs the detail view its oldest entries, never the record itself. */
  let closed: OpenPosition[] = [];
  if (settledToday.length > 0) {
    const prior = (await kv.get<OpenPosition[]>(TRACK_CLOSED_KEY)) || [];
    closed = [...settledToday, ...prior].slice(0, CLOSED_CAP);
  }

  // 3. Record today's picks. A name already open for the same scan is not
  //    re-added — a base that sits on the table for six weeks is one idea.
  const live = new Set(kept.map(p => `${p.scan}|${p.t}`));
  let added = 0;
  const emptyScans: string[] = [];
  for (const { scan, key, sym } of TRACKED_SCANS) {
    const rows = (await kv.get<Record<string, unknown>[]>(key)) || [];
    if (!rows.length) { emptyScans.push(scan); continue; }
    const rec = (results[scan] ||= emptyRecord());
    for (const row of rows) {
      const t = String(row[sym] ?? '').toUpperCase();
      if (!t || live.has(`${scan}|${t}`)) continue;
      /* Stop, in order of preference: the row's own plan, a stop the scan
         publishes at the top level (VCP and 10/21 do), then the pick day's
         low. A row with none of the three fills its stop from the entry
         bar's low on the next tick rather than going untracked. */
      const plan = row.plan as { stop?: number | null } | undefined;
      const rowStop = typeof row.stop === 'number' ? row.stop : null;
      kept.push({
        scan: scan as OpenPosition['scan'], t, d: date,
        score: typeof row.score === 'number' ? row.score : typeof row.cnfScore === 'number' ? row.cnfScore : null,
        tier: tierOf(scan, row),
        fill: null, stop: plan?.stop ?? rowStop ?? (typeof row.dayLow === 'number' ? row.dayLow : null),
        target: null, n: 0, peak: null, hr: false, stopped: false, exitFixed: null, exitHold20: null,
      });
      live.add(`${scan}|${t}`);
      rec.picks += 1;
      added += 1;
    }
  }

  results.updatedAt = new Date().toISOString();
  await kv.set(TRACK_OPEN_KEY, kept);
  await kv.set(TRACK_RESULTS_KEY, results);
  if (closed.length > 0) await kv.set(TRACK_CLOSED_KEY, closed);
  await kv.set(TRACK_META_KEY, { lastBarDate: date, tickedAt: new Date().toISOString(), open: kept.length });

  return NextResponse.json({
    success: true, barDate: date, added, open: kept.length,
    settled: settledToday.length, emptyScans,
  });
}

// lib/etCron.ts — the guard that makes a UTC cron mean an ET wall-clock time.
//
// THE PROBLEM. Vercel cron schedules are UTC and have no notion of a timezone.
// New York is UTC-4 from March to November and UTC-5 the rest of the year, so
// a schedule written against the market in summer runs an HOUR EARLY against
// the market in winter. On 1 November 2026 every fixed-time job in
// vercel.json moves: the pre-market email would go out at 07:45 ET instead of
// 08:45, before the data it summarises exists; the evening tracking tick would
// run at 19:10 instead of 20:10, ahead of the last scan of the day. Nothing
// errors. The first symptom is an email with nothing in it.
//
// THE FIX, in two halves — both are needed, neither works alone:
//
//   1. vercel.json fires the job at BOTH candidate UTC hours (H and H+1), so
//      one of the two always lands on the intended ET time whichever side of
//      the DST boundary the year is on.
//   2. the route calls etGate() with the ET hours it is actually meant to run
//      in. The firing that is an hour out returns immediately, having read
//      nothing and sent nothing.
//
// So the schedule is deliberately loose and the route is strict, rather than
// the other way round. A skipped firing costs one function invocation and no
// KV read; see the note in vercel.json's neighbouring routes.
//
// Only fixed-time jobs need this. The scanners, RS, confluence and the analyst
// generator run on wide ranges every 15-30 minutes, so an hour of drift moves
// nothing a reader can see, and doubling them would double real work rather
// than add a cheap no-op.

import { NextResponse } from 'next/server';

/** Hour, minute and weekday as they read on a New York clock right now. */
export function etParts(d: Date = new Date()): { hour: number; minute: number; weekday: number; hhmm: string } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
  const hour = Number(parts.hour === '24' ? '0' : parts.hour);
  const minute = Number(parts.minute);
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return { hour, minute, weekday: Math.max(0, weekdays.indexOf(String(parts.weekday))), hhmm: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
}

/** True when the New York clock hour is one of `hours`. */
export function isEtHour(hours: number[], d: Date = new Date()): boolean {
  return hours.includes(etParts(d).hour);
}

/**
 * The guard itself. Returns null when this firing is the intended one and a
 * ready-to-return skip response when it is not.
 *
 *   const gate = etGate([8, 9], 'briefing pre');
 *   if (gate) return gate;
 *
 * `hours` is the set of NEW YORK hours the job is meant to run in — write the
 * hours the reader experiences, never the UTC ones, because the UTC ones are
 * the thing that moves.
 */
export function etGate(hours: number[], label: string, d: Date = new Date()): NextResponse | null {
  const { hhmm, hour } = etParts(d);
  if (hours.includes(hour)) return null;
  return NextResponse.json({
    success: true,
    skipped: `outside the ET window for ${label}`,
    etNow: hhmm,
    expectedEtHours: hours,
  });
}

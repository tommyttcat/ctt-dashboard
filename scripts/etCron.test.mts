/* scripts/etCron.test.mts — do the crons still mean the same New York time
 * on both sides of the daylight-saving boundary?
 *
 * This test reads the REAL vercel.json rather than a copy, so editing a
 * schedule there and breaking its ET time fails here instead of on 1 November
 * at 07:45 in a subscriber's inbox. For each guarded job it expands the cron
 * into UTC firings, converts them to New York time, applies the same hour
 * window the route applies, and asserts that what survives is the intended
 * wall-clock time in BOTH an EDT week and an EST week.
 *
 * If you add a fixed-time cron, add it to GUARDED below and to the route's
 * own etGate call. A job in one and not the other is the bug this guards.
 */

import fs from 'node:fs';
import { etParts, isEtHour } from '../src/lib/etCron.ts';
import { eq, ok, done } from './testkit.mts';

// The ET hours each guarded route allows, mirroring its etGate call.
const GUARDED: { match: string; hours: number[]; wants: string }[] = [
  { match: 'phase=pre', hours: [8, 9], wants: '08:45' },
  { match: 'phase=morning', hours: [10, 11], wants: '10:45' },
  { match: 'phase=midday', hours: [12, 13], wants: '12:45' },
  { match: 'phase=power', hours: [14, 15], wants: '14:45' },
  { match: 'phase=closing', hours: [16, 17], wants: '16:45' },
  { match: '/api/email/weekly', hours: [17], wants: '17:30' },
  { match: 'slot=open', hours: [10], wants: '10:55' },
  { match: 'slot=power', hours: [13], wants: '13:55' },
  { match: '/api/email/stats', hours: [21], wants: '21:00' },
  { match: '/api/analyst/ledger/write', hours: [17], wants: '17:50' },
  { match: '/api/track/tick', hours: [20], wants: '20:10' },
  { match: '/api/health/scans', hours: [15], wants: '15:30' },
];

const crons: { path: string; schedule: string }[] = JSON.parse(fs.readFileSync('vercel.json', 'utf8')).crons;

/** Minute and hour fields only — every guarded schedule uses explicit lists. */
const expand = (schedule: string): { h: number; m: number }[] => {
  const [min, hr] = schedule.split(' ');
  if (min.includes('-') || hr.includes('-') || min.includes('*')) return [];
  const mins = min.split(',').map(Number);
  const hrs = hr.split(',').map(Number);
  return hrs.flatMap(h => mins.map(m => ({ h, m })));
};

/** The ET times a job actually acts on, on a given UTC date. */
const actsOn = (g: (typeof GUARDED)[number], y: number, mo: number, d: number): string[] => {
  const times: string[] = [];
  for (const c of crons) {
    if (!c.path.includes(g.match)) continue;
    for (const { h, m } of expand(c.schedule)) {
      const at = new Date(Date.UTC(y, mo - 1, d, h, m));
      if (isEtHour(g.hours, at)) times.push(etParts(at).hhmm);
    }
  }
  return times.sort();
};

for (const g of GUARDED) {
  const matched = crons.filter(c => c.path.includes(g.match));
  ok(`${g.match} has a cron`, matched.length > 0);

  // A Wednesday in EDT and a Wednesday in EST, either side of 1 Nov 2026.
  const edt = actsOn(g, 2026, 10, 28);
  const est = actsOn(g, 2026, 11, 4);

  ok(`${g.match} still fires in EDT`, edt.length > 0);
  ok(`${g.match} still fires in EST`, est.length > 0);
  ok(`${g.match} keeps ${g.wants} in EDT`, edt.includes(g.wants));
  ok(`${g.match} keeps ${g.wants} in EST`, est.includes(g.wants));
}

// ---- the primitives --------------------------------------------------------
// 12:45 UTC is 08:45 in New York in October and 07:45 in November. That one
// hour is the entire bug this machinery exists for.
eq('Oct: 12:45 UTC is 08:45 ET', etParts(new Date(Date.UTC(2026, 9, 28, 12, 45))).hhmm, '08:45');
eq('Nov: 12:45 UTC is 07:45 ET', etParts(new Date(Date.UTC(2026, 10, 4, 12, 45))).hhmm, '07:45');
eq('Nov: 13:45 UTC is 08:45 ET', etParts(new Date(Date.UTC(2026, 10, 4, 13, 45))).hhmm, '08:45');
eq('midnight ET reads as hour 0', etParts(new Date(Date.UTC(2026, 9, 28, 4, 5))).hour, 0);
eq('weekday is ET, not UTC', etParts(new Date(Date.UTC(2026, 9, 29, 2, 0))).weekday, 3); // Wed 22:00 ET
ok('isEtHour matches', isEtHour([8], new Date(Date.UTC(2026, 9, 28, 12, 45))));
ok('isEtHour rejects', !isEtHour([9], new Date(Date.UTC(2026, 9, 28, 12, 45))));

done('ET cron guards');

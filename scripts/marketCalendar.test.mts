import { getMarketDay, isTradingDay, previousTradingDay, nextTradingDay, isMarketSessionWindow, etHour, lastCompletedSession, sessionsBetween } from '../src/lib/marketCalendar.ts';

let pass = 0, fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  if (got === want) { pass++; }
  else { fail++; console.log(`FAIL ${label}\n  got  ${got}\n  want ${want}`); }
};

// --- 2026 full-day closures (NYSE) ---
const h2026: Array<[string, string]> = [
  ['2026-01-01', "New Year's Day"],
  ['2026-01-19', 'Martin Luther King Jr. Day'],
  ['2026-02-16', "Washington's Birthday"],
  ['2026-04-03', 'Good Friday'],
  ['2026-05-25', 'Memorial Day'],
  ['2026-06-19', 'Juneteenth National Independence Day'],
  ['2026-07-03', 'Independence Day'],   // Jul 4 is a Saturday -> observed Friday
  ['2026-09-07', 'Labor Day'],
  ['2026-11-26', 'Thanksgiving Day'],
  ['2026-12-25', 'Christmas Day'],
];
for (const [d, name] of h2026) {
  const m = getMarketDay(d);
  eq(`${d} status`, m.status, 'holiday');
  eq(`${d} name`, m.holiday, name);
  eq(`${d} isTradingDay`, m.isTradingDay, false);
}

// --- 2025 spot checks (different Easter, different observances) ---
eq('2025-04-18 Good Friday', getMarketDay('2025-04-18').holiday, 'Good Friday');
eq('2025-01-01 NYD', getMarketDay('2025-01-01').holiday, "New Year's Day");
eq('2025-06-19 Juneteenth', getMarketDay('2025-06-19').holiday, 'Juneteenth National Independence Day');
eq('2025-11-27 Thanksgiving', getMarketDay('2025-11-27').holiday, 'Thanksgiving Day');

// --- 2027 spot checks ---
eq('2027-03-26 Good Friday', getMarketDay('2027-03-26').holiday, 'Good Friday');
eq('2027-07-05 Jul4 observed Mon', getMarketDay('2027-07-05').holiday, 'Independence Day');
eq('2027-12-24 Christmas observed Fri', getMarketDay('2027-12-24').holiday, 'Christmas Day');

// --- early closes ---
eq('2026-11-27 day after Tgiving', getMarketDay('2026-11-27').status, 'early-close');
eq('2026-11-27 trades', getMarketDay('2026-11-27').isTradingDay, true);
eq('2026-11-27 closes', getMarketDay('2026-11-27').closesAtET, '13:00');
eq('2026-12-24 Xmas Eve', getMarketDay('2026-12-24').status, 'early-close');
// 2026-07-03 is the OBSERVED holiday, so it must NOT be an early close
eq('2026-07-03 not early-close', getMarketDay('2026-07-03').status, 'holiday');

// --- weekends & normal days ---
eq('2026-09-05 Sat', getMarketDay('2026-09-05').status, 'weekend');
eq('2026-09-06 Sun', getMarketDay('2026-09-06').status, 'weekend');
eq('2026-09-04 Fri', getMarketDay('2026-09-04').status, 'open');
eq('2026-09-08 Tue', getMarketDay('2026-09-08').status, 'open');

// --- neighbour walks across the Labor Day weekend ---
eq('prev trading day from 2026-09-07', previousTradingDay('2026-09-07'), '2026-09-04');
eq('next trading day from 2026-09-07', nextTradingDay('2026-09-07'), '2026-09-08');
// Thanksgiving 2026: Thu closed, Fri half day
eq('prev from 2026-11-26', previousTradingDay('2026-11-26'), '2026-11-25');
eq('next from 2026-11-26', nextTradingDay('2026-11-26'), '2026-11-27');

// --- session window ---
eq('window on Labor Day 10am ET', isMarketSessionWindow(new Date('2026-09-07T14:00:00Z')), false);
eq('window on Tue 10am ET', isMarketSessionWindow(new Date('2026-09-08T14:00:00Z')), true);
eq('window on Tue 2am ET', isMarketSessionWindow(new Date('2026-09-08T06:00:00Z')), false);
eq('window on Sat', isMarketSessionWindow(new Date('2026-09-05T14:00:00Z')), false);

eq('isTradingDay Labor Day', isTradingDay('2026-09-07'), false);

// --- a real instant must resolve to the ET date, including 00:00-04:59 ET ---
// Regression: callers must pass a real instant, never a Date already shifted
// into ET wall clock. 05:00Z is 1:00 AM ET on Labor Day; double-converting
// that value rolls it back to 6 Sep, which would then read as a Sunday.
eq('01:00 ET on Labor Day', getMarketDay(new Date('2026-09-07T05:00:00Z')).date, '2026-09-07');
eq('01:00 ET Labor Day status', getMarketDay(new Date('2026-09-07T05:00:00Z')).status, 'holiday');
eq('23:00 ET stays same day', getMarketDay(new Date('2026-09-08T03:00:00Z')).date, '2026-09-07');
eq('midnight ET hour is 0', etHour(new Date('2026-09-08T04:00:00Z')), 0);
eq('noon ET hour is 12', etHour(new Date('2026-09-08T16:00:00Z')), 12);

// --- session helpers: RS staleness depends on these ---
const at = (iso: string) => new Date(iso);

// --- lastCompletedSession ---
eq('Tue 10:00 ET after Labor Day -> Friday', lastCompletedSession(at('2026-09-08T14:00:00Z')), '2026-09-04');
eq('Tue 17:00 ET after Labor Day -> Tuesday', lastCompletedSession(at('2026-09-08T21:00:00Z')), '2026-09-08');
eq('Labor Day itself 10:00 ET -> Friday', lastCompletedSession(at('2026-09-07T14:00:00Z')), '2026-09-04');
eq('Sat -> Friday', lastCompletedSession(at('2026-09-12T16:00:00Z')), '2026-09-11');
eq('normal Tue 10:00 ET -> Monday', lastCompletedSession(at('2026-09-15T14:00:00Z')), '2026-09-14');
// Fri 27 Nov 2026 is a 13:00 early close
eq('day after Thanksgiving 12:00 ET -> Wednesday', lastCompletedSession(at('2026-11-27T17:00:00Z')), '2026-11-25');
eq('day after Thanksgiving 14:00 ET -> itself', lastCompletedSession(at('2026-11-27T19:00:00Z')), '2026-11-27');

// --- sessionsBetween ---
eq('same session', sessionsBetween('2026-09-04', '2026-09-04'), 0);
eq('Fri -> Tue across Labor Day', sessionsBetween('2026-09-04', '2026-09-08'), 1);
eq('Fri -> Mon normal weekend', sessionsBetween('2026-09-11', '2026-09-14'), 1);
eq('Mon -> Tue', sessionsBetween('2026-09-14', '2026-09-15'), 1);
eq('Fri -> Wed (three sessions behind)', sessionsBetween('2026-09-11', '2026-09-16'), 3);
eq('Thu 24 Dec -> Mon 28 Dec across Christmas', sessionsBetween('2026-12-24', '2026-12-28'), 1);

// --- the regression, end to end: age in sessions vs the old 4-day cap ---
const laborDayAge = sessionsBetween('2026-09-04', lastCompletedSession(at('2026-09-08T14:00:00Z')));
eq('Labor Day Tue: Friday map is current (0 sessions)', laborDayAge, 0);
const xmasAge = sessionsBetween('2026-12-24', lastCompletedSession(at('2026-12-28T15:00:00Z')));
eq('28 Dec: 24 Dec map is current (0 sessions)', xmasAge, 0);
// genuinely stale: RS job dead for three sessions
eq('three sessions behind is refused (>1)', sessionsBetween('2026-09-11', '2026-09-17') > 1, true);


console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

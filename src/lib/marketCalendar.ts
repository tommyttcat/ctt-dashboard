/**
 * NYSE trading calendar.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 7 Sep 2026 (Labor Day) `/api/claude/snapshot` returned HTTP 200 with a
 * 257 KB body and `sourcesFailed: []` — a perfectly well-formed payload in
 * which every sector read 0.00%, every mover had `changePct/dayHigh/dayLow: 0`,
 * the Gainers list was empty and `macro.breadth` reported signal RED off a
 * score of 1. Nothing errored. A closed market is indistinguishable from a
 * flat, broad-selloff tape unless something knows the date.
 *
 * Three separate copies of a weekday-only window guard existed at the time and
 * none of them knew about holidays:
 *
 *   lib/scannerLatest.ts          isActiveWindow()
 *   api/analyst/generate/route.ts isWithinETWindow()
 *   api/market-summary/route.ts   isWeekend
 *
 * and `/api/email/briefing` had no market-day guard at all, so all four phase
 * emails went out on a day with no session. This module is the single source
 * those call sites now share.
 *
 * COST
 * ----
 * Pure date arithmetic. No network, no KV, no `fetch`. Cost is flat in users
 * and flat in call volume, which is the only reason it is safe to call from
 * inside a hot path — see CLAUDE.md on the 12 Aug 2026 quota exhaustion.
 *
 * RULES, NOT A TABLE
 * ------------------
 * Every holiday is derived from its rule (nth weekday of month, fixed date
 * plus weekend observance, or Easter for Good Friday) rather than listed as
 * literal dates. A hardcoded table is the same silent-failure shape this
 * module exists to fix: it would simply stop being right one January with no
 * error anywhere. The only thing a rule cannot predict is an ad-hoc closure
 * (a national day of mourning, a hurricane) — those go in UNSCHEDULED_CLOSURES.
 */

/** Ad-hoc, non-rule-derived closures. Add dated entries as they are announced. */
const UNSCHEDULED_CLOSURES: Record<string, string> = {
  // '2025-01-09': 'National Day of Mourning (Jimmy Carter)',
};

export type MarketStatus = 'open' | 'early-close' | 'weekend' | 'holiday';

export type MarketDay = {
  /** ET calendar date, YYYY-MM-DD. */
  date: string;
  status: MarketStatus;
  /** True for `open` and `early-close` — i.e. a session happens on this date. */
  isTradingDay: boolean;
  /** Holiday or closure name, when the market is shut for a named reason. */
  holiday?: string;
  /** ET close time, 24h. '13:00' on early-close days, '16:00' otherwise. */
  closesAtET: string;
  /** One line fit to put in an API `meta` block or a log. */
  reason: string;
};

// --- ET date helpers --------------------------------------------------------
// Everything below works on a plain YYYY-MM-DD string in ET plus a UTC-noon
// Date used only for weekday arithmetic. UTC noon is deliberate: it is far
// enough from both midnights that no timezone offset can roll the date over.

/** The current ET calendar date as YYYY-MM-DD. */
export function etDateString(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which is the format we want to compare on.
  return now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/** The current ET wall-clock hour (0-23). */
export function etHour(now: Date = new Date()): number {
  return Number.parseInt(
    now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }),
    10,
  );
}

function toUtcNoon(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function fromUtcNoon(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = toUtcNoon(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtcNoon(d);
}

/** 0 = Sunday … 6 = Saturday. */
function weekday(dateStr: string): number {
  return toUtcNoon(dateStr).getUTCDay();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Date of the nth given weekday in a month, e.g. 3rd Monday of January. */
function nthWeekdayOfMonth(year: number, month: number, dow: number, nth: number): string {
  const firstDow = new Date(Date.UTC(year, month - 1, 1, 12)).getUTCDay();
  const day = 1 + ((dow - firstDow + 7) % 7) + (nth - 1) * 7;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Date of the last given weekday in a month, e.g. last Monday of May. */
function lastWeekdayOfMonth(year: number, month: number, dow: number): string {
  const lastDay = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
  const lastDow = new Date(Date.UTC(year, month - 1, lastDay, 12)).getUTCDay();
  return `${year}-${pad(month)}-${pad(lastDay - ((lastDow - dow + 7) % 7))}`;
}

/**
 * NYSE observance for a fixed-date holiday: Saturday moves to the preceding
 * Friday, Sunday to the following Monday. Weekdays stay put.
 */
function observed(dateStr: string): string {
  const dow = weekday(dateStr);
  if (dow === 6) return addDays(dateStr, -1);
  if (dow === 0) return addDays(dateStr, 1);
  return dateStr;
}

/** Easter Sunday, anonymous Gregorian algorithm. Good Friday is two days before. */
function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}

// --- The calendar itself ----------------------------------------------------

/** Full-day market closures for a calendar year, keyed by YYYY-MM-DD. */
function holidaysForYear(year: number): Record<string, string> {
  const h: Record<string, string> = {};
  const set = (date: string, name: string) => { h[date] = name; };

  set(observed(`${year}-01-01`), "New Year's Day");
  set(nthWeekdayOfMonth(year, 1, 1, 3), 'Martin Luther King Jr. Day');
  set(nthWeekdayOfMonth(year, 2, 1, 3), "Washington's Birthday");
  set(addDays(easterSunday(year), -2), 'Good Friday');
  set(lastWeekdayOfMonth(year, 5, 1), 'Memorial Day');
  set(observed(`${year}-06-19`), 'Juneteenth National Independence Day');
  set(observed(`${year}-07-04`), 'Independence Day');
  set(nthWeekdayOfMonth(year, 9, 1, 1), 'Labor Day');
  set(nthWeekdayOfMonth(year, 11, 4, 4), 'Thanksgiving Day');
  set(observed(`${year}-12-25`), 'Christmas Day');

  return h;
}

/**
 * 1:00 PM ET closes. These are still trading days — the distinction matters
 * only to anything scheduled after 13:00 ET.
 */
function earlyClosesForYear(year: number): Record<string, string> {
  const e: Record<string, string> = {};
  const holidays = holidaysForYear(year);
  const mark = (date: string, name: string) => {
    // An early close only exists if that date is otherwise a normal session.
    if (!holidays[date] && weekday(date) >= 1 && weekday(date) <= 5) e[date] = name;
  };

  mark(`${year}-07-03`, 'Independence Day (early close)');
  mark(addDays(nthWeekdayOfMonth(year, 11, 4, 4), 1), 'Day after Thanksgiving (early close)');
  mark(`${year}-12-24`, 'Christmas Eve (early close)');

  return e;
}

// Years are computed on demand and memoised — the market runs for a long time
// and this keeps the per-call cost at a map lookup.
const yearCache = new Map<number, { holidays: Record<string, string>; earlyCloses: Record<string, string> }>();

function calendarFor(year: number) {
  let entry = yearCache.get(year);
  if (!entry) {
    entry = { holidays: holidaysForYear(year), earlyCloses: earlyClosesForYear(year) };
    yearCache.set(year, entry);
  }
  return entry;
}

// --- Public API -------------------------------------------------------------

/**
 * Classify an ET calendar date. Pass a YYYY-MM-DD string, or nothing for today
 * in ET.
 *
 * A `Date` argument must be a REAL INSTANT (e.g. `new Date()`), because this
 * does its own ET conversion. Do not pass the codebase's older
 * `new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }))`
 * idiom — that value is already shifted into ET wall clock, and converting it
 * again rolls the date back a day between midnight and 5 AM ET.
 */
export function getMarketDay(date?: string | Date): MarketDay {
  const dateStr = typeof date === 'string' ? date : etDateString(date ?? new Date());
  const year = Number.parseInt(dateStr.slice(0, 4), 10);
  const dow = weekday(dateStr);

  if (dow === 0 || dow === 6) {
    return {
      date: dateStr,
      status: 'weekend',
      isTradingDay: false,
      closesAtET: '16:00',
      reason: `${dow === 0 ? 'Sunday' : 'Saturday'} — market closed`,
    };
  }

  const unscheduled = UNSCHEDULED_CLOSURES[dateStr];
  if (unscheduled) {
    return {
      date: dateStr, status: 'holiday', isTradingDay: false, holiday: unscheduled,
      closesAtET: '16:00', reason: `${unscheduled} — market closed`,
    };
  }

  const { holidays, earlyCloses } = calendarFor(year);

  const holiday = holidays[dateStr];
  if (holiday) {
    return {
      date: dateStr, status: 'holiday', isTradingDay: false, holiday,
      closesAtET: '16:00', reason: `${holiday} — market closed`,
    };
  }

  const early = earlyCloses[dateStr];
  if (early) {
    return {
      date: dateStr, status: 'early-close', isTradingDay: true, holiday: early,
      closesAtET: '13:00', reason: `${early} — market closes 1:00 PM ET`,
    };
  }

  return { date: dateStr, status: 'open', isTradingDay: true, closesAtET: '16:00', reason: 'Regular trading session' };
}

/** True when a session happens on this ET date (early closes included). */
export function isTradingDay(date?: string | Date): boolean {
  return getMarketDay(date).isTradingDay;
}

/** The most recent trading day strictly before `date`. */
export function previousTradingDay(date?: string | Date): string {
  let d = typeof date === 'string' ? date : etDateString(date ?? new Date());
  for (let i = 0; i < 10; i++) {
    d = addDays(d, -1);
    if (isTradingDay(d)) return d;
  }
  return d;
}

/** The next trading day strictly after `date`. */
export function nextTradingDay(date?: string | Date): string {
  let d = typeof date === 'string' ? date : etDateString(date ?? new Date());
  for (let i = 0; i < 10; i++) {
    d = addDays(d, 1);
    if (isTradingDay(d)) return d;
  }
  return d;
}

/* The ET date of the most recent session that has finished. Before today's
   close that is the previous trading day, not today. */
export function lastCompletedSession(now: Date = new Date()): string {
  const today = etDateString(now);
  const day = getMarketDay(today);
  if (day.isTradingDay) {
    const closeHour = parseInt((day.closesAtET || '16:00').slice(0, 2), 10);
    if (etHour(now) >= closeHour) return today;
  }
  return previousTradingDay(today);
}

/* Sessions strictly after `from`, up to and including `to`. 0 when they are
   the same session, or when `from` is already at/after `to`. */
export function sessionsBetween(from: string, to: string): number {
  if (!from || !to || from >= to) return 0;
  let d = from;
  let n = 0;
  while (d < to && n <= 30) {
    d = nextTradingDay(d);
    if (d <= to) n++;
  }
  return n;
}

/**
 * Replacement for the weekday-only 4 AM – 8 PM ET checks that were duplicated
 * across scannerLatest, analyst/generate and market-summary. True only inside
 * the window in which a scan can actually write, on a day the market trades.
 */
export function isMarketSessionWindow(now: Date = new Date()): boolean {
  if (!isTradingDay(now)) return false;
  const hour = etHour(now);
  return hour >= 4 && hour < 20;
}

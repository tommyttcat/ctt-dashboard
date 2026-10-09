// lib/exposure.ts — the Market exposure rule (scripts/backtest/index-overlay.ts O4).
//
// How much of the index to hold, not which stocks:
//   - 150% QQQ for the 10 sessions after a washout: the share of stocks above
//     their own 40-day average closes at 20% or lower (panic.ts P2). A washout
//     inside an active 10-session window does not extend it.
//   - otherwise 100% QQQ while QQQ closed above its 200-day average,
//   - otherwise cash.
// Decided at the close, for the next session.
//
// Tested Jun 2022 - Sep 2026: +197% vs QQQ +156% and SPY +103%; worst drop
// -20% vs QQQ -23%. Weaknesses, stated on the dashboard too: only 11
// washouts, and that signal was found on the same data, so expect less; 10
// of 15 nearby settings beat QQQ, the tested one was the best of them; the
// 200-day half is the externally-backed part. 150% needs margin.
//
// Breadth is computed exactly as the test did (over every stock in the
// day's whole-market bars, 40-day average INCLUDING today), not the
// scanner-universe T2108 the Scorecard shows, which runs a few points off.

export const EXPOSURE_KEY = 'market_exposure_v1';
export const WASHOUT = 20;
export const BOOST_SESSIONS = 10;
export const BOOST = 1.5;
export const CASH_RATE = 0.04;
export const BORROW_RATE = 0.05;

/**
 * % of names above their own 40-day average, exactly as panic.ts computed
 * it: for every name trading today, its last 41 closes (skipping sessions it
 * did not trade), average of the latest 40 INCLUDING today. `days` = recent
 * sessions of closes, oldest first; give it enough history (~100 sessions)
 * that thinly traded names still find 41 closes.
 */
export function breadth(days: Map<string, number>[]): { value: number | null; above: number; total: number } {
  const n = days.length;
  if (n < 41) return { value: null, above: 0, total: 0 };
  const today = days[n - 1];
  let above = 0, total = 0;
  for (const [t, c] of today) {
    if (!(c > 0)) continue;
    let got = 0, s = 0;
    for (let i = n - 1; i >= 0 && got < 41; i--) {
      const x = days[i].get(t);
      if (!(x != null && x > 0)) continue;
      got++;
      if (got <= 40) s += x;
    }
    if (got < 41) continue;
    total++;
    if (c > s / 40) above++;
  }
  return { value: total >= 100 ? (100 * above) / total : null, above, total };
}

export type Mode = 'in' | 'out' | 'boost';

export interface ExposureState {
  asOf: string;                 // the close this was decided at
  mode: Mode;                   // for the NEXT session
  exposure: number;             // 0, 1 or 1.5
  qqq: number;
  sma200: number;
  pctFrom200: number;           // %
  breadth: number | null;       // %
  washout: { date: string; sessionsSince: number } | null;   // the active or last washout
  boostDay: number | null;      // 1..10 for the next session when boosted
  boostEndsAfter: string | null;
  /* the hidden forward record */
  record: {
    startedOn: string;
    nav: number;                // the rule, marked at each close
    qqqStart: number;
    spyStart: number;
    spyNow: number;
    daily: [string, number, number, number][];   // [date, rule NAV, QQQ growth, SPY growth]
  };
}

/**
 * One close forward. `closes` = QQQ closes, oldest first, today last (>= 200);
 * `sessions` = their dates. `prev` is last night's state (null on the first run).
 */
export function stepExposure(
  prev: ExposureState | null, date: string, closes: number[], sessions: string[], breadthPct: number | null, spyClose: number,
): ExposureState {
  if (prev && prev.asOf === date) return prev;
  const n = closes.length;
  const q = closes[n - 1];
  const sma200 = closes.slice(n - 200).reduce((a, b) => a + b, 0) / 200;

  // The forward record: yesterday's decision earns today's close-to-close move.
  const rec = prev?.record ?? { startedOn: date, nav: 1, qqqStart: q, spyStart: spyClose, spyNow: spyClose, daily: [] };
  if (prev) {
    const r = q / prev.qqq - 1;
    const e = prev.exposure;
    const fin = e > 1 ? -(e - 1) * BORROW_RATE / 252 : (1 - e) * CASH_RATE / 252;
    rec.nav = +(rec.nav * (1 + e * r + fin)).toFixed(6);
  }
  rec.spyNow = spyClose;
  rec.daily = [...rec.daily, [date, rec.nav, +(q / rec.qqqStart).toFixed(6), +(spyClose / rec.spyStart).toFixed(6)] as [string, number, number, number]].slice(-1500);

  // Washout window: sessionsSince counts sessions after the washout close.
  let washout = prev?.washout ? { ...prev.washout, sessionsSince: prev.washout.sessionsSince + 1 } : null;
  if (breadthPct != null && breadthPct <= WASHOUT && (!washout || washout.sessionsSince > BOOST_SESSIONS)) {
    washout = { date, sessionsSince: 0 };
  }
  const boosted = !!washout && washout.sessionsSince < BOOST_SESSIONS;
  const trendIn = q > sma200;
  const mode: Mode = boosted ? 'boost' : trendIn ? 'in' : 'out';
  let boostEndsAfter: string | null = null;
  if (boosted && washout) {
    // the 10th boosted session is BOOST_SESSIONS sessions after the washout close; not yet known as a date
    const i = sessions.indexOf(washout.date);
    boostEndsAfter = i >= 0 && i + BOOST_SESSIONS < sessions.length ? sessions[i + BOOST_SESSIONS] : null;
  }
  return {
    asOf: date, mode, exposure: mode === 'boost' ? BOOST : mode === 'in' ? 1 : 0,
    qqq: q, sma200: +sma200.toFixed(2), pctFrom200: +((q / sma200 - 1) * 100).toFixed(2),
    breadth: breadthPct != null ? +breadthPct.toFixed(1) : null,
    washout, boostDay: boosted && washout ? washout.sessionsSince + 1 : null, boostEndsAfter, record: rec,
  };
}

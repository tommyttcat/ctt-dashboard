// lib/scans/ep9m.ts — the pure half of the EP9M scan.
//
// Everything here is a function of its arguments: no fetch, no KV, no clock.
// The live route (app/api/ep9m/run) does the I/O and calls into this file;
// the historical backtest (scripts/backtest) replays past sessions through the
// SAME functions. Keeping one implementation is the point — a backtest that
// scores a copy of the rules is testing the copy, and the two drift apart the
// first time someone tunes a threshold in one place.
//
// Moved verbatim from the route on 11 Sep 2026; no behaviour change.
// + isPriorSessionBar / priorSessionRows (11 Sep 2026) — a live-only guard;
//   the backtest has no snapshot and does not call them.

import { EP9M } from '@/lib/scanConfig';
import type { NewsItem } from '@/lib/indicators/news';
import type { TradePlan } from '@/lib/indicators/tradeplan';

export interface Bar { t: number; o: number; h: number; l: number; c: number; v: number; }
export interface LiteBar { c: number; h: number; l: number; v: number; }
export interface OhlcvBar { o: number; h: number; l: number; c: number; v: number; }

export interface SnapInfo {
  price: number;
  prevClose: number;
  changePct: number;
  vol: number;
  vwap: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  dayOpen: number | null;
  /* The snapshot day bar's own close — not `price`, which prefers the latest
     minute. Only the stale-bar check reads it; optional so the backtest, which
     has no snapshot, need not supply it. */
  dayClose?: number | null;
}

// ---------------------------------------------------------------
// Stale snapshot rows — the previous session wearing today's date.
//
// Before the open, Polygon's full-market snapshot can still carry the PRIOR
// session in `day` while `min` already holds a fresh premarket print. The row
// looks current (price, `updated` and `min.t` are all today) but its volume is
// yesterday's, so yesterday's EPs were registered under today's date: 11
// entries on 13 and 18 Aug 2026, each within 0.2% of the prior session's
// volume, each with a premarket price. A timestamp check cannot see this —
// only the bar itself can.
//
// The test is identity with the ticker's grouped bar for the previous trading
// day. Measured 11 Sep 2026: the snapshot `day` equals the grouped bar to the
// cent on O/H/L/C for 283/283 names at 9M+, volume within 0.36%. Across five
// years of grouped history (292,020 name-days at 9M+) no genuine session
// matched the one before it on all four prices with volume within 1%. H/L/C
// alone did once (SH), which is why the open is part of the test.
// ---------------------------------------------------------------
const STALE_PRICE_EPS = 1e-4;
const STALE_VOL_TOL = 0.01;

export function isPriorSessionBar(
  day: { o: number | null; h: number | null; l: number | null; c: number | null; v: number },
  prior: OhlcvBar | undefined
): boolean {
  if (!prior || !(prior.v > 0)) return false;
  if (day.o == null || day.h == null || day.l == null || day.c == null) return false;
  const same = (a: number, b: number) => Math.abs(a - b) <= STALE_PRICE_EPS;
  return same(day.o, prior.o) && same(day.h, prior.h) && same(day.l, prior.l) && same(day.c, prior.c)
    && Math.abs(day.v / prior.v - 1) <= STALE_VOL_TOL;
}

/** Symbols whose snapshot day bar is really the previous session's. */
export function priorSessionRows(snapMap: Map<string, SnapInfo>, prior: Map<string, OhlcvBar>): string[] {
  const stale: string[] = [];
  snapMap.forEach((s, sym) => {
    const day = { o: s.dayOpen, h: s.dayHigh, l: s.dayLow, c: s.dayClose ?? null, v: s.vol };
    if (isPriorSessionBar(day, prior.get(sym))) stale.push(sym);
  });
  return stale;
}

// ETFs that clear 9M shares on any ordinary day. Most would fail the RVOL gate
// anyway, but leveraged products spike hard enough to sneak through, and they
// aren't EP candidates — there's no company to re-rate. Backstopped by a
// ticker `type` check at enrichment.
export const HIGH_VOLUME_ETFS = new Set([
  'SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'VTI', 'EEM', 'EFA', 'XLF', 'XLE', 'XLK',
  'XLI', 'XLV', 'XLU', 'XLP', 'XLY', 'XLB', 'XLRE', 'XLC', 'SMH', 'SOXX',
  'TQQQ', 'SQQQ', 'QLD', 'QID', 'SOXL', 'SOXS', 'TECL', 'TECS', 'SPXL', 'SPXS',
  'SPXU', 'UPRO', 'SDS', 'SSO', 'TNA', 'TZA', 'FAS', 'FAZ', 'LABU', 'LABD',
  'UVXY', 'UVIX', 'SVIX', 'VIXY', 'VXX', 'FNGU', 'FNGD', 'GLD', 'SLV', 'GDX',
  'GDXJ', 'USO', 'UNG', 'TLT', 'HYG', 'LQD', 'ARKK', 'IBIT', 'BITO', 'BITX',
  'NUGT', 'DUST', 'JNUG', 'ERX', 'ERY', 'BOIL', 'KOLD', 'NAIL', 'URAA',
]);

// Universe gates applied to the full-market snapshot, before any history is
// read. Symbol shape excludes warrants/units/preferreds with suffixes.
export function passesUniverseGate(sym: string, price: number, vol: number): boolean {
  if (!/^[A-Z]{1,5}$/.test(sym)) return false;
  if (HIGH_VOLUME_ETFS.has(sym)) return false;
  if (price < EP9M.minPrice || price > EP9M.maxPrice) return false;
  // The namesake gate.
  return vol >= EP9M.minVolume;
}

// Prior swing high window. 63 sessions back, EXCLUDING the most recent five —
// without that exclusion a name that just ran becomes its own resistance and
// every fresh mover reports a trigger already blocked. Matters more here than
// anywhere else: an EP9M name IS a fresh mover by definition.
const SWING_HIGH_LOOKBACK = 63;
const SWING_HIGH_EXCLUDE_RECENT = 5;

// Highest high in the lookback window, excluding the most recent few bars.
// Bars arrive sorted ascending, so the recent end is the tail.
export function priorSwingHighOf(bars: Bar[]): number | null {
  if (bars.length < 20) return null;
  const end = bars.length - SWING_HIGH_EXCLUDE_RECENT;
  const start = Math.max(0, bars.length - SWING_HIGH_LOOKBACK);
  if (end <= start) return null;
  const win = bars.slice(start, end);
  if (win.length === 0) return null;
  return Math.max(...win.map(b => b.h));
}

// ---------------------------------------------------------------
// Stage 3: abnormality shortlist.
//
// Grouped history includes today's partial bar during a live session, so the
// trailing window is taken from bars BEFORE the last one — otherwise today's
// spike inflates its own baseline and suppresses the very signal we want.
// ---------------------------------------------------------------
export interface Abnormality {
  sym: string;
  avgVol: number;
  rvol: number;
  vol60dMax: number | null;
  volVs60dMax: number | null;
  unprecedented: boolean;
}

export function shortlistAbnormal(
  series: Map<string, LiteBar[]>,
  snapMap: Map<string, SnapInfo>
): Abnormality[] {
  const picks: Abnormality[] = [];

  series.forEach((bars, sym) => {
    const snap = snapMap.get(sym);
    if (!snap) return;
    if (bars.length < 25) return;

    const prior = bars.slice(0, -1);
    if (prior.length < 20) return;

    const recent20 = prior.slice(-20).map(b => b.v).filter(v => v > 0);
    if (recent20.length < 15) return;
    const avgVol = recent20.reduce((a, b) => a + b, 0) / recent20.length;
    if (avgVol <= 0) return;

    const rvol = snap.vol / avgVol;
    if (rvol < EP9M.minRvol) return;

    const dVol = snap.vol * snap.price;
    if (dVol < EP9M.minDollarVol) return;

    const priorVols = prior.map(b => b.v).filter(v => v > 0);
    const vol60dMax = priorVols.length > 0 ? Math.max(...priorVols) : null;
    const volVs60dMax = vol60dMax && vol60dMax > 0 ? snap.vol / vol60dMax : null;

    picks.push({
      sym,
      avgVol,
      rvol,
      vol60dMax,
      volVs60dMax,
      // "Never traded anywhere near this level" — literally, not rhetorically.
      unprecedented: volVs60dMax != null && volVs60dMax >= 1.0,
    });
  });

  picks.sort((a, b) => b.rvol - a.rvol);
  return picks.slice(0, EP9M.shortlistSize);
}

// Share-count derived inputs. Float falls back to market cap / price when the
// reference data has no share-class count; `||` (not `??`) is deliberate — a
// reported 0 is missing data, not a zero float.
export function shareMetrics(p: {
  marketCap: number | null | undefined;
  sharesOutstanding: number | null | undefined;
  shortInterest: number | null | undefined;
  price: number;
  vol: number;
  avgVol: number;
}): {
  mktCap: number | null;
  float: number | null;
  shortPct: number | null;
  daysToCover: number | null;
  floatTurnover: number | null;
} {
  const mktCap = p.marketCap || null;
  const float = p.sharesOutstanding || (mktCap && p.price ? mktCap / p.price : null);

  let shortPct: number | null = null;
  let daysToCover: number | null = null;
  const si = p.shortInterest;
  if (si && float && float > 0) shortPct = (si / float) * 100;
  if (si && p.avgVol > 0) daysToCover = si / p.avgVol;

  const floatTurnover = float && float > 0 ? p.vol / float : null;
  return { mktCap, float, shortPct, daysToCover, floatTurnover };
}

// Where the close sits in the day's range, 0 = low, 1 = high.
export function closeStrengthOf(price: number, dayHigh: number | null, dayLow: number | null): number | null {
  if (dayHigh != null && dayLow != null && dayHigh > dayLow) {
    return (price - dayLow) / (dayHigh - dayLow);
  }
  return null;
}

export type CatalystTier = 'strong' | 'neutral' | 'negative' | 'none';

/* The news lib's tier maps straight onto scoreEp9m's, with one adjustment:
   'headline' has no slot there, and the honest translation is 'none' rather
   than 'neutral'. A tier of 'headline' means something was published that did
   NOT explain the move — exactly the filler this scan should not be paid for.
   Rounding it up to neutral would hand +9 points to a Zacks rank update.

   Negative sentiment on a strong tag demotes to neutral, same as the scanner:
   "Reports Q2 Results" tags Earnings whether it beat or missed, and the price
   action is already in the score, so applying a penalty here would count the
   same fact twice. */
export function catalystTierOf(news: NewsItem | null): CatalystTier {
  if (!news) return 'none';
  return news.tier === 'headline' ? 'none'
    : news.tier === 'strong' && news.sentiment === 'negative' ? 'neutral'
    : news.tier;
}

// ---------------------------------------------------------------
// EP9M score (0-100), on the same grade lines as CNF (A>=70, B>=50)
//
// Volume abnormality carries half the weight because it IS the setup.
// Close strength matters more than it looks: a stock that traded 12M shares
// and closed on its low moved that volume from buyers to sellers.
//
// Money Flow is a modifier. Close strength is one day; MF is 21. A name can
// close strong on the trigger day while the prior month was steady
// distribution — that combination is a trap, and only MF sees it.
//
// NOTE: this score says nothing about whether the name is enterable. That is
// the trade plan's job, and the two are deliberately kept apart — a 90 here
// means the volume event is exceptional, not that there is room to be paid.
//
// v1.6: chop14 is NOT a component here, for the same reason. It measures the
// regime the volume landed in, which is a third question again — a 90 in a
// chop regime is still an exceptional volume event, it just has nowhere to go.
// ---------------------------------------------------------------
/* EP9M SCORE v2 — 11 Sep 2026.
   This scan's job is finding names that MOVE, and the backtest is blunt about
   what the old score was doing. Over 11,696 flags (Sep 2022 - Sep 2026) the
   score had no relationship to outcome at all: grades A/B/C returned -0.10R,
   -0.16R and -0.12R, and score-versus-realised-R correlated 0.01. Tuning one
   component could not fix that — removing the repeat bonus moved the
   correlation from 0.0101 to 0.0102.

   What the inputs DO predict, consistently in both halves, is the size of the
   tail — how often a flag ran +50% inside 60 sessions:

       float turnover 1x+      23.5%        market cap under 300M   23.1%
       float turnover .5-1     17.5%        market cap 300M-2B      14.1%
       float turnover under .1  7.0%        market cap 10B+          5.4%
       RVOL 10x+               15.2%        strong catalyst          8.5%  <- LOWEST
       days to cover 5+        10.1%        days to cover under 1.5 20.1%

   So the score now ranks BIG-MOVE ODDS honestly rather than pretending to rank
   quality, and the two terms that pointed the wrong way are gone: the catalyst
   bonus (a "strong" catalyst marked the LEAST explosive names — the news is
   already in the price) and the days-to-cover ladder (inverted, the crowded
   shorts moved least). The row still shows its catalyst; it just no longer
   scores it.

   Read an A here as "most likely to make a big move, in either direction" —
   the same names carried the worst average outcome (-0.26R to -0.30R, median
   20-day -24%), which is why the table's tooltip says so and why these need a
   tight stop and small size. */
export function scoreEp9m(q: {
  rvol: number;
  volVs60dMax: number | null;
  floatTurnover: number | null;
  daysToCover: number | null;
  closeStrength: number | null;
  mf: number | null;
  catalystTier: CatalystTier;
  priorTriggers: number;
  /** v2: market cap, the other half of "room to move". */
  mktCap?: number | null;
}): { score: number; grade: string; breakdown: Record<string, number> } {
  const b: Record<string, number> = {};

  b.rvol = 0;
  if (q.rvol >= 10) b.rvol = 30;
  else if (q.rvol >= 7) b.rvol = 26;
  else if (q.rvol >= 5) b.rvol = 22;
  else if (q.rvol >= 4) b.rvol = 17;
  else if (q.rvol >= 3) b.rvol = 12;

  b.unprecedented = 0;
  if (q.volVs60dMax != null) {
    if (q.volVs60dMax >= 2.0) b.unprecedented = 20;
    else if (q.volVs60dMax >= 1.5) b.unprecedented = 16;
    else if (q.volVs60dMax >= 1.0) b.unprecedented = 12;
    else if (q.volVs60dMax >= 0.7) b.unprecedented = 5;
  }

  /* v2: promoted to the biggest term, because it is the best predictor of a
     big move the scan has — 23.5% of names that turned their whole float ran
     +50%, against 7.0% of those that turned under a tenth of it. */
  b.floatTurnover = 0;
  if (q.floatTurnover != null) {
    if (q.floatTurnover >= 1.0) b.floatTurnover = 30;
    else if (q.floatTurnover >= 0.5) b.floatTurnover = 22;
    else if (q.floatTurnover >= 0.25) b.floatTurnover = 12;
    else if (q.floatTurnover >= 0.10) b.floatTurnover = 5;
  }

  /* v2 NEW: size is the other half of the same story — 23.1% of sub-$300M
     names ran +50% against 5.4% of $10B+ names. Room to move is a property of
     the company, not of today's tape. */
  b.smallCap = 0;
  if (q.mktCap != null) {
    if (q.mktCap < 3e8) b.smallCap = 20;
    else if (q.mktCap < 2e9) b.smallCap = 12;
    else if (q.mktCap < 1e10) b.smallCap = 4;
  }

  /* v2: retired. "Strong" catalysts had the LOWEST big-move rate of the four
     tiers (8.5%) and the -20 "dilutive/legal" tier had the best expectancy of
     the four. A published explanation means the move is already priced. */
  b.catalyst = 0;

  b.closeStrength = 0;
  if (q.closeStrength != null) {
    if (q.closeStrength >= 0.85) b.closeStrength = 10;
    else if (q.closeStrength >= 0.70) b.closeStrength = 7;
    else if (q.closeStrength >= 0.50) b.closeStrength = 3;
    else if (q.closeStrength <= 0.25) b.closeStrength = -8;
  }

  b.moneyFlow = 0;
  if (q.mf != null) {
    if (q.mf >= 65) b.moneyFlow = 8;
    else if (q.mf >= 55) b.moneyFlow = 5;
    else if (q.mf <= 35) b.moneyFlow = -10;
    else if (q.mf <= 45) b.moneyFlow = -5;
  }

  /* v2: inverted, so retired. Days-to-cover 5+ ran +50% in 10.1% of cases
     against 20.1% for the UNDER-1.5 bucket — the crowded shorts moved least. */
  b.daysToCover = 0;

  b.repeatOffender = q.priorTriggers >= 2 ? 5 : q.priorTriggers === 1 ? 3 : 0;

  const raw = Object.values(b).reduce((s, v) => s + v, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  const grade = score >= 70 ? 'A' : score >= 50 ? 'B' : 'C';
  return { score, grade, breakdown: b };
}

// ---------------------------------------------------------------
// EP TYPE CLASSIFICATION — the Bonde framework.
//
// Five variations, checked in priority order. A name can match multiple
// types; the first match wins because it is the most actionable read.
//
//   1. Delayed Reaction — re-trigger 3–20 days after a prior EP. The initial
//      gap is priced; this is the re-break after a pullback, tighter stop.
//   2. Classical Growth — explosive revenue surprise (50%+ sales growth).
//   3. Turnaround — CEO change, or a cheap stock posting results.
//   4. Stories & Themes — narrative drives the move, not fundamentals.
//   5. Volume (default) — pure abnormality, no specific classification.
// ---------------------------------------------------------------

const EP_THEMES: { name: string; rx: RegExp }[] = [
  { name: 'AI', rx: /\b(?:artificial intelligence|machine learning|deep learning|neural|large language|generative ai|computer vision)\b|\bai\b/i },
  { name: 'Quantum', rx: /\bquantum\b/i },
  { name: 'Crypto', rx: /\b(?:bitcoin|crypto(?:currency)?|blockchain|digital asset)\b/i },
  { name: 'Space', rx: /\b(?:spacecraft|spaceflight|satellite|rocket|launch vehicle|orbital|lunar)\b/i },
  { name: 'Nuclear', rx: /\b(?:nuclear|uranium|reactor)\b/i },
  { name: 'Defense', rx: /\b(?:defense|defence|military|weapon|missile|unmanned)\b/i },
  { name: 'GLP-1', rx: /\b(?:glp.?1|anti.?obes|semaglutide|tirzepatide|incretin)\b/i },
];

export function classifyEpType(params: {
  fund: { attrs: { revGrowthPct: number | null; pe: number | null } } | null;
  newsTag: string | null;
  companyName: string;
  sector: string;
  catalyst: string | null;
  priorTriggers: number;
  mostRecentPriorDaysAgo: number | null;
}): { epType: 'growth' | 'turnaround' | 'delayed' | 'theme' | 'volume'; epTheme: string | null } {
  const { fund, newsTag, companyName, sector, catalyst, priorTriggers, mostRecentPriorDaysAgo } = params;
  const revGrowth = fund?.attrs?.revGrowthPct ?? null;
  const pe = fund?.attrs?.pe ?? null;

  // 1. Delayed Reaction — re-trigger 3–20 trading days after prior EP.
  if (priorTriggers > 0 && mostRecentPriorDaysAgo != null &&
      mostRecentPriorDaysAgo >= 3 && mostRecentPriorDaysAgo <= 20) {
    return { epType: 'delayed', epTheme: null };
  }

  // 2. Classical Growth — triple-digit sales growth is the headline case;
  //    50%+ with an earnings catalyst is the broader definition.
  const isEarningsCatalyst = newsTag === 'Earnings' || newsTag === 'Guidance';
  if (revGrowth != null && revGrowth >= 100 && isEarningsCatalyst) {
    return { epType: 'growth', epTheme: null };
  }
  if (revGrowth != null && revGrowth >= 50 && newsTag === 'Earnings') {
    return { epType: 'growth', epTheme: null };
  }

  // 3. Turnaround — CEO/CFO change, or cheap stock posting results.
  if (newsTag === 'Management') {
    return { epType: 'turnaround', epTheme: null };
  }
  if (pe != null && pe > 0 && pe < 15 && isEarningsCatalyst) {
    return { epType: 'turnaround', epTheme: null };
  }

  // 4. Stories & Themes — narrative drives the move, not fundamentals.
  //    Only fires when there is no strong fundamental story.
  const hasStrongFundamentals = revGrowth != null && revGrowth >= 25;
  if (!hasStrongFundamentals) {
    const text = `${companyName} ${sector} ${catalyst || ''}`;
    for (const t of EP_THEMES) {
      if (t.rx.test(text)) return { epType: 'theme', epTheme: t.name };
    }
  }

  // 5. Default — pure volume anomaly.
  return { epType: 'volume', epTheme: null };
}

/* ---- Big-move odds -------------------------------------------------------
   The letter on an EP row is NOT a quality grade. The 5-year backtest
   (11,696 flags, Sep 2022 - Sep 2026) is unambiguous: the EP9M score does not
   rank outcomes at all — grades A/B/C averaged -0.10R, -0.16R and -0.12R, and
   score-versus-realised-R correlates 0.01. What the inputs DO predict is the
   size of the tail:

       float turnover 1x+     23.5% ran +50%   but -0.30R and a -27% median
       market cap under 300M  23.1%            but -0.26R and a -24% median
       float turnover .5-1    17.5%
       market cap 10B+         5.4%

   So the letter answers "how likely is a big move", and the tooltip says the
   other half out loud: the same names have the worst average outcome. This is
   a hunting list with a tight stop and small size, not a quality ranking. */
export function epMoveOdds(r: { floatTurnover?: number | null; mktCap?: number | null }): 'A' | 'B' | null {
  const ft = r.floatTurnover ?? null;
  const cap = r.mktCap ?? null;
  if ((ft != null && ft >= 0.5) || (cap != null && cap < 3e8)) return 'A';
  if ((ft != null && ft >= 0.25) || (cap != null && cap < 2e9)) return 'B';
  return null;
}

export const EP_MOVE_ODDS_TIP =
  'Odds of a BIG MOVE, not quality. A: float turnover 0.5x+ or market cap under $300M — ' +
  '17-23% of these ran +50% within 60 sessions. The same names had the WORST average outcome ' +
  '(-0.26R to -0.30R, median 20-day -24%), so they need a tight stop and small size. ' +
  'B: float turnover 0.25x+ or cap under $2B. Unlettered: single-digit odds of a big move.';

/* ---- The EP trade plan ---------------------------------------------------
   Until 11 Sep 2026 this table shipped the generic plan: trigger the break of
   the EP day's high, stop 1.25x ADR below, fixed 2R target. The 5-year replay
   (11,696 flags, Sep 2022 - Sep 2026) says that entry is the reason the table
   loses money, and that it is the ENTRY rather than the exit:

     break of the day high, 2R target        -0.13R per trade
     break of the day high, trail 21 EMA     -0.19R
     buy the next open, stop at the EP low   -0.05R
     pullback to the EP-day midpoint         +0.02R with a 2R target
                                             +0.09R trailing the 21 EMA

   Only the last one is positive, and it was positive in both halves of the
   period. It is also the only entry that gets paid for the thing the scan
   actually detects: heavy volume marks a price where size changed hands, and
   the midpoint of that day is where you can buy it back from the people who
   bought the high.

   The rules below are the replay's, unchanged, so the card and the test agree:

     trigger   the midpoint of the EP day's range
     window    sessions 2-10 after the flag; the first touch fills. A gap that
               opens below the midpoint but above the EP low fills at the open.
     stop      the EP day's LOW — not an ADR multiple. The low is the level
               that says the day was a fake; a volatility stop on a name that
               just traded 9M+ shares is noise.
     cancel    a close below the EP low before any fill kills the setup.
     target    a fixed 2R, with the caveat in EXIT_GUIDANCE that trailing the
               21 EMA did better (+0.09R against +0.02R).

   Note what this means for the reader: the trigger sits BELOW the last price,
   which is the opposite of every other table here. That is deliberate. You
   are waiting for the name to come back to you, and if it never does, the
   setup expires unfilled rather than chasing. */


/** Same floor the backtest used — a stop this tight is inside the spread. */
const EP_MIN_RISK_PCT = 0.5;
const EP_TARGET_R = 2;
export const EP_PULLBACK_WINDOW = 10;

export interface EpPlanInput {
  price: number | null | undefined;
  dayHigh: number | null | undefined;
  dayLow: number | null | undefined;
  /** Nearest swing high above the EP day — the only overhead that is not fixed by construction. */
  priorSwingHigh?: number | null;
  changePct?: number | null;
}

const epNum = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export function epPullbackPlan(i: EpPlanInput): TradePlan {
  const empty = (note: string, collapsed = false): TradePlan => ({
    family: 'first-touch', trigger: null, triggerLabel: '—', stop: null, stopPct: null,
    target: null, rMultiple: 0, resistanceR: null, resistanceLabel: null,
    clear: false, collapsed, overextended: false, tradeable: false, note,
  });

  const price = epNum(i.price);
  const hi = epNum(i.dayHigh);
  const lo = epNum(i.dayLow);
  const chg = epNum(i.changePct);

  if (chg != null && chg <= -15) return empty('down more than 15% — not a long setup at any level', true);
  if (hi == null || lo == null || !(hi > lo)) return empty('no EP-day range to place a pullback entry');

  const trigger = (hi + lo) / 2;
  const risk = trigger - lo;
  const stopPct = (risk / trigger) * 100;
  if (!(risk > 0) || stopPct < EP_MIN_RISK_PCT) return empty('EP-day range too tight to size a stop');

  const target = trigger + EP_TARGET_R * risk;

  /* Overhead. The EP day's own high sits exactly 1R above this entry by
     construction, so quoting it as "resistance" would print the same number
     on every row. The useful level is the swing high ABOVE that day. */
  const swing = epNum(i.priorSwingHigh);
  const resistance = swing != null && swing > hi ? swing : null;
  const resistanceR = resistance != null ? (resistance - trigger) / risk : null;

  const note = price != null && price < lo
    ? `Setup dead — last ${price.toFixed(2)} is below the EP day's low. A close under the low cancels it.`
    : `Wait for a pullback to ${trigger.toFixed(2)} (EP-day midpoint) within ${EP_PULLBACK_WINDOW} sessions. ` +
      `A close below ${lo.toFixed(2)} cancels the setup; if it never pulls back, it expires unfilled.`;

  return {
    family: 'first-touch',
    trigger,
    triggerLabel: 'EP mid',
    stop: lo,
    stopPct,
    target,
    rMultiple: EP_TARGET_R,
    resistanceR,
    resistanceLabel: resistance != null ? 'prior swing high' : null,
    clear: resistance == null,
    collapsed: false,
    overextended: false,
    tradeable: !(price != null && price < lo),
    note,
  };
}

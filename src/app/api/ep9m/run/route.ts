// app/api/ep9m/run/route.ts — v1.6
//
// EP9M — 9 Million Episodic Pivot (Pradeep Bonde / Stockbee)
//
// The premise: fewer than ~2% of US listings trade 9M+ shares in a session.
// When a stock that normally trades 800k suddenly does 12M, institutions are
// accumulating and the news hasn't been priced yet. The volume IS the signal —
// you research the catalyst after the scan flags it, not before.
//
// CRITICAL DESIGN POINT: the 9M threshold alone is nearly useless. NVDA trades
// 9M shares before 10am every day. The scan only works as a joint condition —
// 9M shares AND that volume is abnormal FOR THIS STOCK. RVOL is the real gate;
// 9M is the floor beneath it that keeps illiquid junk out.
//
// v1.1: Weinstein sub-stages via lib/indicators/stage.
// v1.2: + Money Flow (21), also scored — heavy abnormal volume with MF under
//       45 is 21 sessions of distribution, however good today's print looks.
// v1.3: thresholds moved to lib/scanConfig and shipped in the payload.
// v1.4: + Stochastic %K(10) emitted as stochK.
// v1.5: + trade plan, raw EMA levels, dayHigh/dayLow, priorSwingHigh.
// v1.8: NEWS MOVED FROM BENZINGA WIIM TO POLYGON.
//
//   The Benzinga news endpoint returns an empty JSON array for a key without
//   the news product — indistinguishable from a quiet news day, and
//   fetchBenzingaWiims swallowed errors, so a dead credential looked exactly
//   like no news. On the scanner this showed up as 3 matches out of 80. Here
//   it meant EVERY row scored catalystTier 'none'.
//
//   THAT WAS NOT COSMETIC ON THIS SCAN. catalystTier is worth +15 for a
//   strong catalyst, +9 for neutral and -20 for a dilutive or legal one
//   inside scoreEp9m. With the feed dead, a name that had announced an
//   offering scored identically to one with a defence contract, and both
//   scored identically to one with no news at all. The 20-point spread that
//   was supposed to separate them never applied.
//
//   UNLIKE THE SCANNER, THIS ROUTE ADDS AN API CALL. The scanner was already
//   fetching /v2/reference/news per ticker and merely under-using it; this
//   route never fetched news at all, so news now rides in the existing
//   per-ticker Promise.all. It is one more request per SHORTLISTED name —
//   a few dozen, not the whole universe — and the shortlist is already
//   making three calls each.
//
//   EXPECT THE "SILENT" COUNT TO FALL, and read that as the scan getting
//   more accurate rather than less interesting. Silent means heavy abnormal
//   volume with no published explanation — the footprint before the story,
//   which is the premise of the whole scan. With a dead feed every name
//   qualified, so the label meant nothing. Names that drop out of it were
//   never silent; the dashboard just could not see their news.
//
// v1.7: two changes.
//
//   (a) BACKGROUND EXECUTION for cron. This scan completes well inside
//       Vercel's 300-second limit; what times out is cron-job.org, which
//       gives up waiting at around thirty seconds. The work finished, KV
//       updated, and the cron dashboard reported a failure anyway.
//
//       That is worse than it sounds. A monitor that cries wolf on every run
//       trains you to ignore it, and then a REAL failure — a Polygon outage,
//       an expired key, a bad deploy — arrives looking exactly like the noise
//       you have been dismissing. Point cron at ?bg=true and the response is
//       immediate and honest: received, running.
//
//   (b) rsVsSpy REPLACED by the market-wide RS RATING from /api/rs/run.
//       Until now "RS" meant a percentile on the VCP table and a spread
//       everywhere else — same column header, different claims. +18 versus
//       SPY might be 60th percentile in a strong tape and 95th in a weak
//       one, and the spread cannot tell you which.
//
//       The rating is looked up, not computed. Four routes each ranking
//       their own universe would give four different answers for the same
//       stock on the same day.
//
//       NOTE: rsVsSpy was NOT part of scoreEp9m, so no EP score moves.
//
// v1.6: + PER-TICKER CHOPPINESS INDEX (chop14).
//
//       CHOP MATTERS MORE ON THIS TABLE THAN ANY OTHER, and the reason is the
//       same one that makes RTR matter here: this scan has NO TREND GATE and
//       NO ADR FLOOR. Every other scan filters on structure somewhere — SIPs
//       and Daily need +4% and an ADR floor, Swing needs price over the 50 and
//       200, Consolidation needs a rising 21. This one gates on volume
//       abnormality alone, so a name can print 12M shares while oscillating
//       inside the same range it has held for a month, and it belongs here,
//       because that volume is real information.
//
//       What the volume does not say is whether the range will resolve. CHOP
//       does:
//
//           CHOP = 100 x log10( sum TR(n) / (maxHigh(n) - minLow(n)) ) / log10(n)
//
//       distance travelled over ground covered. Above 61.8 the name churns;
//       below 38.2 it trends. An EP9M name at CHOP 75 has institutions moving
//       size inside a range that keeps rejecting both edges — worth watching,
//       not worth a breakout entry.
//
//       BAR ORDER: this route fetches with sort=asc, so bars are ALREADY
//       oldest-first and pass to choppiness() directly. The scanner route
//       sorts descending and has to reverse a slice first. Same gotcha,
//       opposite direction, and silent either way — a wrongly ordered array
//       returns a plausible number computed from the wrong end of the series.
//       Every other helper here (atr, adrPct, stochasticK, pctReturn,
//       priorSwingHighOf) already treats the tail as recent, which is the
//       confirmation that ascending is correct.
//
//       NO NEW API CALL — `bars` is already fetched for ATR, ADR, EMA, RME,
//       Money Flow and the stochastic.
//
//       NOT SCORED, DELIBERATELY. chop14 is emitted and reported in
//       planCoverage but is not a scoreEp9m component and gates nothing.
//       Folding it into the score would move every grade at once and make its
//       effect impossible to isolate. Score it once the distribution has been
//       watched — see the chop block in the response payload.
//
// ---------------------------------------------------------------------------
// NOTE ON THE CHANGE GATE — a contradiction that predates this version.
//
// The original header claimed this scan "deliberately does NOT gate on %
// change", on the reasoning that a non-gapping stock quietly trading 10x its
// normal volume is the highest-value case the scan exists to find. That line
// has been removed from the header because it is not what the code does:
//
//     if ((snap.changePct ?? 0) < 0) return null;
//
// A stock down 0.4% on 11x volume — precisely the quiet accumulation the
// premise describes — is discarded. Only exactly-flat or positive names
// survive. The gate is defensible on its own terms (a down day on heavy
// volume is often distribution, and MF already scores that), but it is a
// real filter and the header should not have claimed otherwise.
//
// Left in place: changing scan semantics is a separate decision from adding
// an indicator, and reversing it would alter what appears on the table.
// Flagged here so the choice is visible rather than buried.
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { computeRMV } from '@/lib/indicators/rmv';
import { computeRMEDetail } from '@/lib/indicators/rme';
import { computeStage } from '@/lib/indicators/stage';
import { computeMoneyFlow, moneyFlowTrend } from '@/lib/indicators/moneyflow';
import { computeTradePlan } from '@/lib/indicators/tradeplan';
import { choppiness, CHOP_PERIOD_DEFAULT, CHOP_CHOP_MIN, CHOP_TREND_MAX } from '@/lib/indicators/chop';
import { EP9M, EP9M_META } from '@/lib/scanConfig';
import { enrichWithFundamentals } from '@/lib/indicators/fundamentals';
import { loadRsRatings, type RsLookup } from '@/lib/indicators/rs';
import { rawRsScore, percentileRank } from '@/lib/indicators/vcp';
import { cleanSectorDescription } from '@/lib/sectors';
import { sma, ema, atr, adrPct, stochK, pctReturn } from '@/lib/indicators/marketMath';
import { runInBackground, isDetachedRun, BG_HEADERS } from '@/lib/background';
import { pickBestNews, polygonNewsPath, fetchBenzingaNewsIndex, type NewsItem } from '@/lib/indicators/news';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 300;

const POLYGON_KEY = process.env.POLYGON_API_KEY || '';
/* Benzinga is back, for news only — never the earnings calendar, which is what
   was actually dead when it got pulled. Polygon's per-ticker news is Motley
   Fool wall-to-wall on this plan, so it now serves as the fallback source. */
const BENZINGA_KEY = (process.env.NEXT_PUBLIC_BENZINGA_API_KEY || process.env.BENZINGA_API_KEY || '').trim();
const BASE = 'https://api.polygon.io';

// Fetch-window mechanics, not scan gates — these stay local rather than
// living in scanConfig, since they describe how much history to pull rather
// than what qualifies a name.
const WINDOW = {
  maxCalendarDays: 90,
  concurrency: 8,
};

// Prior swing high window. 63 sessions back, EXCLUDING the most recent five —
// without that exclusion a name that just ran becomes its own resistance and
// every fresh mover reports a trigger already blocked. Matters more here than
// anywhere else: an EP9M name IS a fresh mover by definition.
const SWING_HIGH_LOOKBACK = 63;
const SWING_HIGH_EXCLUDE_RECENT = 5;

// ADR level at which a name is "wide" for the chop-trap read below. There is
// no ADR floor on this scan, so unlike the scanner route this is purely a
// reporting threshold — it identifies names whose range is big enough that
// the churn actually costs something.
const CHOP_TRAP_MIN_ADR = 5;

// ETFs that clear 9M shares on any ordinary day. Most would fail the RVOL gate
// anyway, but leveraged products spike hard enough to sneak through, and they
// aren't EP candidates — there's no company to re-rate. Backstopped by a
// ticker `type` check at enrichment.
const HIGH_VOLUME_ETFS = new Set([
  'SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'VTI', 'EEM', 'EFA', 'XLF', 'XLE', 'XLK',
  'XLI', 'XLV', 'XLU', 'XLP', 'XLY', 'XLB', 'XLRE', 'XLC', 'SMH', 'SOXX',
  'TQQQ', 'SQQQ', 'QLD', 'QID', 'SOXL', 'SOXS', 'TECL', 'TECS', 'SPXL', 'SPXS',
  'SPXU', 'UPRO', 'SDS', 'SSO', 'TNA', 'TZA', 'FAS', 'FAZ', 'LABU', 'LABD',
  'UVXY', 'UVIX', 'SVIX', 'VIXY', 'VXX', 'FNGU', 'FNGD', 'GLD', 'SLV', 'GDX',
  'GDXJ', 'USO', 'UNG', 'TLT', 'HYG', 'LQD', 'ARKK', 'IBIT', 'BITO', 'BITX',
  'NUGT', 'DUST', 'JNUG', 'ERX', 'ERY', 'BOIL', 'KOLD', 'NAIL', 'URAA',
]);

interface Bar { t: number; o: number; h: number; l: number; c: number; v: number; }
interface LiteBar { c: number; h: number; l: number; v: number; }

interface SnapInfo {
  price: number;
  prevClose: number;
  changePct: number;
  vol: number;
  vwap: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  dayOpen: number | null;
}

interface TradePlanOut {
  family?: string;
  trigger?: number | null;
  triggerLabel?: string;
  stop?: number | null;
  stopPct?: number | null;
  target?: number | null;
  rMultiple?: number;
  resistanceR?: number | null;
  resistanceLabel?: string | null;
  clear?: boolean;
  collapsed?: boolean;
  overextended?: boolean;
  tradeable: boolean;
  note?: string;
}

interface Ep9mCandidate {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  score: number;
  grade: string;
  changePct: number;
  vol: number;
  dVol: number;
  avgVol: number;
  rvol: number;
  volVs60dMax: number | null;
  unprecedented: boolean;
  floatTurnover: number | null;
  daysToCover: number | null;
  closeStrength: number | null;
  float: number | null;
  shortPct: number | null;
  mktCap: number | null;
  stage: string;
  vwapStatus: 'above' | 'below' | 'neutral';
  atrPct: number | null;
  adrPct: number | null;
  rmv: number | null;
  mf: number | null;
  mfTrend: number;
  stochK: number | null;
  rme: number | null;
  aboveEma10: boolean | null;
  aboveEma21: boolean | null;
  distToEma21: number | null;
  distToEma10: number | null;
  ema21Rising: boolean | null;
  goldenCross: boolean | null;
  pctOffHigh: number | null;
  rsRating: number | null;
  priorTriggers: number;
  sugarBaby: boolean;
  catalyst: string | null;
  catalystUrl: string | null;
  thesis: string | null;
  /* Provenance. An aggregated feed mixes GlobeNewswire 8-Ks with opinion
     pieces, and once the source is stripped the two are indistinguishable —
     which is why the news lib tiers publishers before choosing. Carrying it
     to the row makes that filtering auditable rather than trusted. */
  newsPublisher: string | null;
  newsAge: string | null;
  newsSentiment: 'positive' | 'negative' | 'neutral' | null;
  newsCausal: boolean | null;
  scoreBreakdown: Record<string, number>;
  // v1.5 — raw levels and the plan built from them.
  ema10: number | null;
  ema21: number | null;
  ema50: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  priorSwingHigh: number | null;
  plan: TradePlanOut | null;
  // v1.6 — regime.
  chop14: number | null;
  chopTrap: boolean;
}

async function polygon<T = any>(path: string): Promise<T> {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${BASE}${path}${sep}apiKey=${POLYGON_KEY}`);
  if (!res.ok) throw new Error(`Polygon ${res.status}: ${path.split('?')[0]}`);
  return res.json() as Promise<T>;
}

async function polygonSafe<T = any>(path: string, fallback: T): Promise<T> {
  try { return await polygon<T>(path); } catch { return fallback; }
}

function dateStr(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
}

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R | null>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const results = await Promise.allSettled(items.slice(i, i + size).map(fn));
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) out.push(r.value);
    }
  }
  return out;
}

const round2 = (v: number | null | undefined): number | null =>
  v == null || !Number.isFinite(v) ? null : parseFloat(v.toFixed(2));

// Serialises the planner output for the wire. Every numeric goes through
// round2 so a NaN escaping a degenerate bar series cannot reach the component,
// where it would render as "NaN" in a price field.
function serialisePlan(p: ReturnType<typeof computeTradePlan>): TradePlanOut {
  if (!p.tradeable) {
    return {
      tradeable: false,
      collapsed: p.collapsed,
      overextended: p.overextended,
      note: p.note,
      family: p.family,
    };
  }
  return {
    family: p.family,
    trigger: round2(p.trigger),
    triggerLabel: p.triggerLabel,
    stop: round2(p.stop),
    stopPct: p.stopPct != null ? parseFloat(p.stopPct.toFixed(2)) : null,
    target: round2(p.target),
    rMultiple: p.rMultiple,
    resistanceR: p.resistanceR != null ? parseFloat(p.resistanceR.toFixed(2)) : null,
    resistanceLabel: p.resistanceLabel,
    clear: p.clear,
    collapsed: p.collapsed,
    overextended: p.overextended,
    tradeable: true,
    note: p.note,
  };
}

// Highest high in the lookback window, excluding the most recent few bars.
// Bars arrive sorted ascending, so the recent end is the tail.
function priorSwingHighOf(bars: Bar[]): number | null {
  if (bars.length < 20) return null;
  const end = bars.length - SWING_HIGH_EXCLUDE_RECENT;
  const start = Math.max(0, bars.length - SWING_HIGH_LOOKBACK);
  if (end <= start) return null;
  const win = bars.slice(start, end);
  if (win.length === 0) return null;
  return Math.max(...win.map(b => b.h));
}





// Average Daily Range % — no gap component, so it measures the intraday room
// a typical session offers. This is the stop basis in the trade plan, for
// exactly that reason.

// Stochastic %K(period) — where today's close sits within the period's
// high/low range. Low readings near a rising 21 EMA are the Blue Dot
// precondition. Returns null when the window is too short or flat.

/* Currently unused — its only caller was the SPY benchmark return behind
   rsVsSpy, which v1.7 replaced with the shared RS Rating. Kept because it is
   a correct, generic helper and the next thing that needs a trailing return
   should not have to rewrite it. */

// ---------------------------------------------------------------
// Stage 1: universe from the full-market snapshot (1 call)
// ---------------------------------------------------------------
async function getUniverse(): Promise<{ symbols: string[]; snapMap: Map<string, SnapInfo> }> {
  const data = await polygon<{ tickers?: any[] }>('/v2/snapshot/locale/us/markets/stocks/tickers');
  const tickers = data.tickers ?? [];

  const snapMap = new Map<string, SnapInfo>();
  const symbols: string[] = [];

  for (const t of tickers) {
    const sym: string = t.ticker ?? '';
    if (!/^[A-Z]{1,5}$/.test(sym)) continue;
    if (HIGH_VOLUME_ETFS.has(sym)) continue;

    const price = t.lastTrade?.p || t.min?.c || t.day?.c || t.prevDay?.c || 0;
    const vol = t.day?.v || 0;
    if (price < EP9M.minPrice || price > EP9M.maxPrice) continue;

    // The namesake gate.
    if (vol < EP9M.minVolume) continue;

    const prevClose = t.prevDay?.c || 0;
    let changePct = 0;
    if (t.todaysChangePerc != null && t.todaysChangePerc !== 0) {
      changePct = t.todaysChangePerc;
    } else if (prevClose > 0 && price > 0) {
      changePct = ((price - prevClose) / prevClose) * 100;
    }

    snapMap.set(sym, {
      price,
      prevClose,
      changePct: Number.isNaN(changePct) ? 0 : changePct,
      vol,
      vwap: t.day?.vw ?? null,
      dayHigh: t.day?.h ?? null,
      dayLow: t.day?.l ?? null,
      dayOpen: t.day?.o ?? null,
    });
    symbols.push(sym);
  }

  return { symbols, snapMap };
}

// ---------------------------------------------------------------
// Stage 2: market-wide volume profile from grouped daily bars.
// ~60 calls total for every US stock's recent history — the only affordable
// way to answer "is 9M abnormal FOR THIS NAME" across the whole market.
// ---------------------------------------------------------------
async function getVolumeProfile(validSymbols: Set<string>): Promise<Map<string, LiteBar[]>> {
  const dates: string[] = [];
  for (let d = WINDOW.maxCalendarDays; d >= 1; d--) {
    const dt = new Date(Date.now() - d * 86400000);
    const day = dt.getUTCDay();
    if (day === 0 || day === 6) continue;
    dates.push(dt.toISOString().slice(0, 10));
  }

  const dayResults: { date: string; results: any[] }[] = [];
  const BATCH = 7;
  for (let i = 0; i < dates.length; i += BATCH) {
    const chunk = dates.slice(i, i + BATCH);
    const settled = await Promise.allSettled(chunk.map(async (date) => {
      const data = await polygonSafe<{ results?: any[] }>(
        `/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true`,
        { results: [] }
      );
      return { date, results: data.results ?? [] };
    }));
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value.results.length > 0) dayResults.push(r.value);
    }
  }

  dayResults.sort((a, b) => a.date.localeCompare(b.date));
  const kept = dayResults.slice(-EP9M.volProfileDays);

  const series = new Map<string, LiteBar[]>();
  for (const day of kept) {
    for (const t of day.results) {
      const sym = t.T;
      if (!validSymbols.has(sym)) continue;
      let arr = series.get(sym);
      if (!arr) { arr = []; series.set(sym, arr); }
      arr.push({ c: t.c, h: t.h, l: t.l, v: t.v });
    }
  }
  return series;
}

// ---------------------------------------------------------------
// Stage 3: abnormality shortlist.
//
// Grouped history includes today's partial bar during a live session, so the
// trailing window is taken from bars BEFORE the last one — otherwise today's
// spike inflates its own baseline and suppresses the very signal we want.
// ---------------------------------------------------------------
interface Abnormality {
  sym: string;
  avgVol: number;
  rvol: number;
  vol60dMax: number | null;
  volVs60dMax: number | null;
  unprecedented: boolean;
}

function shortlistAbnormal(
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

/* fetchBenzingaWiims, classifyWiim and isNegativeHeadline used to live here.
   Every case they covered is now inside @/lib/indicators/news — the spam and
   legal-solicitation shapes by its rejection layers, the dilutive and
   going-concern language by classifyNews landing on Offering or Legal / Risk.
   Keeping local copies as a defensive second opinion is how two classifiers
   drift apart and start disagreeing about the same headline. */

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
function scoreEp9m(q: {
  rvol: number;
  volVs60dMax: number | null;
  floatTurnover: number | null;
  daysToCover: number | null;
  closeStrength: number | null;
  mf: number | null;
  catalystTier: 'strong' | 'neutral' | 'negative' | 'none';
  priorTriggers: number;
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

  b.floatTurnover = 0;
  if (q.floatTurnover != null) {
    if (q.floatTurnover >= 1.0) b.floatTurnover = 15;
    else if (q.floatTurnover >= 0.5) b.floatTurnover = 12;
    else if (q.floatTurnover >= 0.25) b.floatTurnover = 8;
    else if (q.floatTurnover >= 0.10) b.floatTurnover = 4;
  }

  b.catalyst = 0;
  if (q.catalystTier === 'strong') b.catalyst = 15;
  else if (q.catalystTier === 'neutral') b.catalyst = 9;
  else if (q.catalystTier === 'negative') b.catalyst = -20;

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

  b.daysToCover = 0;
  if (q.daysToCover != null) {
    if (q.daysToCover >= 5) b.daysToCover = 10;
    else if (q.daysToCover >= 3) b.daysToCover = 6;
    else if (q.daysToCover >= 1.5) b.daysToCover = 3;
  }

  b.repeatOffender = q.priorTriggers >= 2 ? 5 : q.priorTriggers === 1 ? 3 : 0;

  const raw = Object.values(b).reduce((s, v) => s + v, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  const grade = score >= 70 ? 'A' : score >= 50 ? 'B' : 'C';
  return { score, grade, breakdown: b };
}

// ---------------------------------------------------------------
// Registry — every trigger, kept for 90 days. Free to maintain, and it's the
// prerequisite for the Delayed Reaction EP: watch these names for a tight
// pullback over the following weeks, then buy the re-break with a sub-1% stop.
// Also gives "sugar baby" detection for free.
// ---------------------------------------------------------------
interface RegistryEntry {
  ticker: string;
  date: string;
  price: number;
  vol: number;
  rvol: number;
  score: number;
}

async function readRegistry(): Promise<RegistryEntry[]> {
  try {
    const stored = await kv.get<RegistryEntry[]>('ep9m_registry_v1');
    if (!Array.isArray(stored)) return [];
    const cutoff = dateStr(EP9M.registryDays);
    return stored.filter(e => e?.date && e.date >= cutoff);
  } catch {
    return [];
  }
}

async function runScan(request: Request) {
  try {
    if (!POLYGON_KEY) {
      return NextResponse.json({ success: false, error: 'Missing Polygon API Key' }, { status: 500 });
    }

    const today = dateStr(0);

    /* One lookup for the whole scan. Loading it here rather than inside the
       per-ticker enrichment matters: that runs once per shortlisted name
       across concurrent batches, and a KV read per ticker would be dozens of
       requests for a map that cannot change mid-scan.

       THIS REPLACED A SPY HISTORY FETCH. rsVsSpy needed 450 days of SPY bars
       to compute a benchmark return; the rating needs none, because the
       ranking already happened in /api/rs/run. One fewer Polygon call per
       scan, and pctReturn() below now has no caller — left in place because
       it is a generic helper worth having, not because anything uses it. */
    const rsLookup: RsLookup = await loadRsRatings();

    const { symbols, snapMap } = await getUniverse();

    if (symbols.length === 0) {
      const scanTime = Date.now();
      await kv.set('ep9m_v1', []);
      await kv.set('ep9m_last_scan_v1', scanTime);
      await kv.set('ep9m_meta_v1', { raw9m: 0, shortlisted: 0, count: 0, scanMeta: EP9M_META });
      return NextResponse.json({
        success: true, lastScanTime: scanTime, raw9m: 0, shortlisted: 0, count: 0,
        scanMeta: EP9M_META,
        note: 'No names above the 9M share threshold yet — expected early in the session.',
      });
    }

    const profile = await getVolumeProfile(new Set(symbols));
    const shortlist = shortlistAbnormal(profile, snapMap);

    const registry = await readRegistry();
    const priorCounts = new Map<string, number>();
    for (const e of registry) {
      if (e.date === today) continue;
      priorCounts.set(e.ticker, (priorCounts.get(e.ticker) || 0) + 1);
    }

    /* One fetch for the whole scan, indexed by ticker — this plan's Benzinga
       endpoint ignores per-ticker params, so filtering happens here. */
    const bzIndex = await fetchBenzingaNewsIndex(POLYGON_KEY);

    const enriched = await inBatches(shortlist, WINDOW.concurrency, async (ab) => {
      const sym = ab.sym;
      const snap = snapMap.get(sym);
      if (!snap) return null;

      const [barsRes, details, shortData, newsRes] = await Promise.all([
        polygonSafe<{ results?: Bar[] }>(
          `/v2/aggs/ticker/${encodeURIComponent(sym)}/range/1/day/${dateStr(450)}/${today}?adjusted=true&sort=asc&limit=5000`,
          { results: [] }
        ),
        polygonSafe<any>(`/v3/reference/tickers/${sym}`, {}),
        polygonSafe<any>(`/stocks/v1/short-interest?ticker=${sym}`, { results: [] }),
        /* v1.8 — news, in the same round trip as everything else. Sequencing
           it after the bars would add a full latency hop per name for a
           field that has no dependency on them. */
        polygonSafe<any>(polygonNewsPath(sym, 20), { results: [] }),
      ]);

      // Backstop for ETFs/funds that slipped past the static exclusion list.
      const tickerType = (details?.results?.type || '').toUpperCase();
      if (tickerType && tickerType !== 'CS' && tickerType !== 'ADRC') return null;

      const bars = barsRes.results ?? [];
      if (bars.length < 30) return null;

      const closes = bars.map(b => b.c);
      const price = snap.price;

      const atr14 = atr(bars, 14);
      const atrPctVal = atr14 && price > 0 ? (atr14 / price) * 100 : null;
      const adr = adrPct(bars, 20);
      const rmv = computeRMV(bars, { lookback: 15 });
      const rmeDetail = computeRMEDetail(bars, { maLength: 21, lookback: 250 });

      /* --- CHOP (v1.6) ----------------------------------------------------
         NO REVERSE NEEDED HERE. The aggs fetch above uses sort=asc, so bars
         are already oldest-first — which is exactly what choppiness() wants,
         and the opposite of the scanner route, where dailyBars is descending
         and a slice has to be reversed before the call.

         Passing bars straight in is correct; the Bar interface (t/o/h/l/c/v)
         structurally satisfies ChopBar (h/l/c). Every other helper on this
         route already treats bars[bars.length - 1] as today, which is the
         standing confirmation that ascending holds. */
      const chop14 = choppiness(bars, CHOP_PERIOD_DEFAULT);

      // Money Flow (21) — the sharpest cross-check this scan has. Heavy
      // abnormal volume with MF under 45 means the last month was steady
      // distribution, however good today's single-day print looks.
      const mf = computeMoneyFlow(bars, { length: 21 });
      const mfTrend = moneyFlowTrend(bars, { length: 21, lookback: 5 });
      const stochKVal = stochK(bars, 10);

      const e10 = ema(closes, 10);
      const e21 = ema(closes, 21);
      // v1.5: the 50 exists purely as a resistance reference for the plan —
      // nothing else on this table reads it.
      const e50 = ema(closes, 50);
      const e21Prev = ema(closes.slice(0, -3), 21);
      const sma50 = sma(closes, 50);
      const sma200 = sma(closes, 200);

      const hiWindow = bars.slice(-Math.min(252, bars.length)).map(b => b.h);
      const hi52 = hiWindow.length ? Math.max(...hiWindow) : null;
      const pctOffHigh = hi52 && hi52 > 0 ? ((price - hi52) / hi52) * 100 : null;

      let rsRating = rsLookup.get(sym);
      if (rsRating == null && bars.length >= 63 && rsLookup.sortedRaws.length > 0) {
        const n = bars.length;
        const p0c = bars[n - 1]?.c;
        const p63c = bars[n - 1 - Math.min(63, n - 1)]?.c;
        const p126c = n > 126 ? bars[n - 1 - 126]?.c : null;
        const p189c = n > 189 ? bars[n - 1 - 189]?.c : null;
        const p252c = n > 252 ? bars[n - 1 - 252]?.c : null;
        const raw = rawRsScore({ p0: p0c, p63: p63c, p126: p126c, p189: p189c, p252: p252c });
        if (raw != null) rsRating = percentileRank(raw, rsLookup.sortedRaws);
      }

      const mktCap = details?.results?.market_cap || null;
      const float = details?.results?.share_class_shares_outstanding || (mktCap && price ? mktCap / price : null);

      let shortPct: number | null = null;
      let daysToCover: number | null = null;
      const si = shortData?.results?.[0]?.short_interest;
      if (si && float && float > 0) shortPct = (si / float) * 100;
      if (si && ab.avgVol > 0) daysToCover = si / ab.avgVol;

      const floatTurnover = float && float > 0 ? snap.vol / float : null;

      let closeStrength: number | null = null;
      if (snap.dayHigh != null && snap.dayLow != null && snap.dayHigh > snap.dayLow) {
        closeStrength = (price - snap.dayLow) / (snap.dayHigh - snap.dayLow);
      }

      let vwapStatus: 'above' | 'below' | 'neutral' = 'neutral';
      if (snap.vwap && snap.vwap > 0) vwapStatus = price >= snap.vwap ? 'above' : 'below';

      const sector = cleanSectorDescription(
        details?.results?.sic_description,
        details?.results?.sector,
        details?.results?.industry
      );

      // --- TRADE PLAN (v1.5) -----------------------------------------------
      // setupName left null on purpose — see the header note. The generic
      // family triggers off the day high, which is the only defensible entry
      // on a scan that gates on volume rather than shape.
      //
      // Snapshot dayHigh preferred over the daily bar: during a live session
      // the snapshot is minutes old while the aggregate bar can lag.
      const dayHigh = snap.dayHigh ?? bars[bars.length - 1]?.h ?? null;
      const priorSwingHigh = priorSwingHighOf(bars);
      const plan = computeTradePlan({
        price,
        adrPct: adr,
        atrPct: atrPctVal,
        changePct: snap.changePct,
        ema10: e10,
        ema21: e21,
        ema50: e50,
        dayHigh,
        priorSwingHigh,
        aboveEma10: e10 != null ? price >= e10 : null,
        aboveEma21: e21 != null ? price >= e21 : null,
        setupName: null,
      });

      return {
        ab,
        snap,
        raw: {
          name: details?.results?.name || sym,
          sector,
          mktCap,
          float,
          shortPct,
          daysToCover,
          floatTurnover,
          closeStrength,
          vwapStatus,
          atrPct: atrPctVal,
          adrPct: adr,
          rmv,
          mf,
          mfTrend,
          stochK: stochKVal,
          rme: rmeDetail.rme,
          chop14,
          aboveEma10: e10 != null ? price >= e10 : null,
          aboveEma21: e21 != null ? price >= e21 : null,
          distToEma10: e10 && e10 > 0 ? ((price - e10) / e10) * 100 : null,
          distToEma21: e21 && e21 > 0 ? ((price - e21) / e21) * 100 : null,
          ema21Rising: e21 != null && e21Prev != null ? e21 > e21Prev : null,
          goldenCross: sma50 != null && sma200 != null ? sma50 > sma200 : null,
          pctOffHigh,
          rsRating,
          stage: computeStage(closes, { price }),
          ema10: e10,
          ema21: e21,
          ema50: e50,
          dayHigh,
          dayLow: snap.dayLow ?? bars[bars.length - 1]?.l ?? null,
          priorSwingHigh,
          plan: serialisePlan(plan),
          news: pickBestNews([...(bzIndex.get(sym) ?? []), ...(newsRes?.results ?? [])], sym),
        },
      };
    });

    /* Age at which the chip gains "(Delayed)". A headline from yesterday
       morning explaining today's volume is a different trade — the market
       has had a session to price it and you are buying follow-through, not
       the news. */
    const DELAYED_AGE_HOURS = 36;

    const candidates: Ep9mCandidate[] = enriched.map(({ ab, snap, raw }): Ep9mCandidate | null => {
      const news: NewsItem | null = raw.news ?? null;

      let catalyst: string | null = null;
      let catalystUrl: string | null = null;
      let thesis: string | null = null;
      let newsPublisher: string | null = null;
      let newsAge: string | null = null;
      let newsSentiment: 'positive' | 'negative' | 'neutral' | null = null;
      let tier: 'strong' | 'neutral' | 'negative' | 'none' = 'none';

      if (news) {
        catalyst = news.ageHours >= DELAYED_AGE_HOURS ? `${news.tag} (Delayed)` : news.tag;
        catalystUrl = news.url;
        thesis = news.title;
        newsPublisher = news.publisher;
        newsAge = news.ageLabel;
        newsSentiment = news.sentiment;

        /* The lib's tier maps straight onto scoreEp9m's, with one
           adjustment: 'headline' has no slot there, and the honest
           translation is 'none' rather than 'neutral'. A tier of 'headline'
           means something was published that did NOT explain the move —
           exactly the filler this scan should not be paid for. Rounding it
           up to neutral would hand +9 points to a Zacks rank update.

           Negative sentiment on a strong tag demotes to neutral, same as the
           scanner: "Reports Q2 Results" tags Earnings whether it beat or
           missed, and the price action is already in the score, so applying
           a penalty here would count the same fact twice. */
        tier =
          news.tier === 'headline' ? 'none'
          : news.tier === 'strong' && news.sentiment === 'negative' ? 'neutral'
          : news.tier;
      }

      const priorTriggers = priorCounts.get(ab.sym) || 0;

      const scored = scoreEp9m({
        rvol: ab.rvol,
        volVs60dMax: ab.volVs60dMax,
        floatTurnover: raw.floatTurnover,
        daysToCover: raw.daysToCover,
        closeStrength: raw.closeStrength,
        mf: raw.mf,
        catalystTier: tier,
        priorTriggers,
      });

      // Gate: exclude negative-change stocks — distribution, not accumulation.
      // See the NOTE ON THE CHANGE GATE in the header: this is a real filter
      // and it is why plan.collapsed can never fire on this table.
      if ((snap.changePct ?? 0) < 0) return null;

      // v1.6: wide range AND churning. Reported, not gated. On this table it
      // reads as institutional size moving inside a range that keeps
      // rejecting both edges — real activity, no resolution.
      const chopTrap =
        raw.chop14 != null && raw.adrPct != null &&
        raw.adrPct >= CHOP_TRAP_MIN_ADR && raw.chop14 >= CHOP_CHOP_MIN;

      return {
        ticker: ab.sym,
        name: raw.name,
        sector: raw.sector,
        price: +snap.price.toFixed(2),
        score: scored.score,
        grade: scored.grade,
        changePct: +snap.changePct.toFixed(2),
        vol: snap.vol,
        dVol: Math.round(snap.price * snap.vol),
        avgVol: Math.round(ab.avgVol),
        rvol: +ab.rvol.toFixed(2),
        volVs60dMax: ab.volVs60dMax != null ? +ab.volVs60dMax.toFixed(2) : null,
        unprecedented: ab.unprecedented,
        floatTurnover: raw.floatTurnover != null ? +raw.floatTurnover.toFixed(3) : null,
        daysToCover: raw.daysToCover != null ? +raw.daysToCover.toFixed(1) : null,
        closeStrength: raw.closeStrength != null ? +raw.closeStrength.toFixed(2) : null,
        float: raw.float,
        shortPct: raw.shortPct != null ? +raw.shortPct.toFixed(1) : null,
        mktCap: raw.mktCap,
        stage: raw.stage,
        vwapStatus: raw.vwapStatus,
        atrPct: raw.atrPct != null ? +raw.atrPct.toFixed(2) : null,
        adrPct: raw.adrPct != null ? +raw.adrPct.toFixed(2) : null,
        rmv: raw.rmv,
        mf: raw.mf,
        mfTrend: raw.mfTrend,
        stochK: raw.stochK,
        rme: raw.rme,
        aboveEma10: raw.aboveEma10,
        aboveEma21: raw.aboveEma21,
        distToEma21: raw.distToEma21 != null ? +raw.distToEma21.toFixed(2) : null,
        distToEma10: raw.distToEma10 != null ? +raw.distToEma10.toFixed(2) : null,
        ema21Rising: raw.ema21Rising,
        goldenCross: raw.goldenCross,
        pctOffHigh: raw.pctOffHigh != null ? +raw.pctOffHigh.toFixed(1) : null,
        rsRating: raw.rsRating,
        priorTriggers,
        sugarBaby: priorTriggers >= 2,
        catalyst,
        catalystUrl,
        thesis,
        newsPublisher,
        newsAge,
        newsSentiment,
        newsCausal: news?.causal ?? null,
        scoreBreakdown: scored.breakdown,
        ema10: round2(raw.ema10),
        ema21: round2(raw.ema21),
        ema50: round2(raw.ema50),
        dayHigh: round2(raw.dayHigh),
        dayLow: round2(raw.dayLow),
        priorSwingHigh: round2(raw.priorSwingHigh),
        plan: raw.plan,
        chop14: raw.chop14 != null ? +raw.chop14.toFixed(1) : null,
        chopTrap,
      };
    }).filter((c): c is Ep9mCandidate => c !== null);

    candidates.sort((a, b) => b.score - a.score);
    const finalList = candidates.slice(0, EP9M.finalSize);

    // Update the registry — one entry per ticker per day, best score wins.
    const cutoff = dateStr(EP9M.registryDays);
    const registryMap = new Map<string, RegistryEntry>();
    for (const e of registry) {
      if (e.date >= cutoff) registryMap.set(`${e.ticker}|${e.date}`, e);
    }
    for (const c of finalList) {
      const key = `${c.ticker}|${today}`;
      const prev = registryMap.get(key);
      if (!prev || c.score > prev.score) {
        registryMap.set(key, {
          ticker: c.ticker, date: today, price: c.price,
          vol: c.vol, rvol: c.rvol, score: c.score,
        });
      }
    }
    const nextRegistry = Array.from(registryMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    // Enrich with fundamentals — cross-reference multibagger KV first, Polygon for the rest
    try {
      const mbData = await kv.get<any[]>('multibagger_v1');
      const fundInput = finalList
        .filter(c => c.ticker && c.price > 0)
        .map(c => ({ ticker: c.ticker, price: c.price, marketCap: (c as any).mktCap || undefined }));
      if (fundInput.length > 0) {
        const fundMap = await enrichWithFundamentals(fundInput, POLYGON_KEY, mbData ?? undefined);
        for (const c of finalList) {
          const f = fundMap.get((c.ticker ?? '').toUpperCase());
          if (f) (c as any)._fund = f;
        }
      }
    } catch (e) { console.error('[ep9m] fundamental enrichment failed:', e); }

    const scanTime = Date.now();
    await kv.set('ep9m_v1', finalList);
    await kv.set('ep9m_last_scan_v1', scanTime);
    await kv.set('ep9m_meta_v1', {
      raw9m: symbols.length,
      shortlisted: shortlist.length,
      count: finalList.length,
      minRvol: EP9M.minRvol,
      minVolume: EP9M.minVolume,
      // Gate metadata for the on-screen key — the config this run enforced.
      scanMeta: EP9M_META,
    });
    await kv.set('ep9m_registry_v1', nextRegistry);

    // Plan diagnostics. If `planned` sits far below `count`, the stop basis
    // is failing — most likely ADR missing on short-history names.
    const planCoverage = {
      planned: finalList.filter(c => c.plan?.tradeable).length,
      clear: finalList.filter(c => c.plan?.tradeable && c.plan.clear).length,
      overextended: finalList.filter(c => c.plan?.overextended).length,
      noStopBasis: finalList.filter(c => c.plan?.note === 'no ADR/ATR to size a stop').length,
    };

    /* v1.6 CHOP DISTRIBUTION. Ships unwired so the effect of a future gate can
       be sized before it is applied.

       chopChoppy IS THE NUMBER THAT MATTERS HERE, more than on any other
       table. This scan has no trend gate — a name churning inside a month-old
       range passes every filter it has. If that count is routinely half the
       list, the volume signal is regularly landing in tape that cannot
       resolve it, and the answer is probably a CHOP column the eye can sort
       on rather than a hard gate: an EP9M name in chop is still worth
       researching, it just is not worth a breakout entry today.

       chopScored guards the read — a low choppy count means nothing if the
       15-bar minimum was failing across the list. */
    const chopStats = {
      scored: finalList.filter(c => c.chop14 != null).length,
      trending: finalList.filter(c => c.chop14 != null && c.chop14 <= CHOP_TREND_MAX).length,
      mixed: finalList.filter(c => c.chop14 != null && c.chop14 > CHOP_TREND_MAX && c.chop14 < CHOP_CHOP_MIN).length,
      choppy: finalList.filter(c => c.chop14 != null && c.chop14 >= CHOP_CHOP_MIN).length,
      trap: finalList.filter(c => c.chopTrap).length,
      // Unprecedented volume landing in a chop regime — the volume event is
      // real and the tape cannot express it. The most interesting pairing on
      // this table and the one worth watching first.
      unprecedentedInChop: finalList.filter(c => c.unprecedented && c.chop14 != null && c.chop14 >= CHOP_CHOP_MIN).length,
    };

    return NextResponse.json({
      success: true,
      lastScanTime: scanTime,
      raw9m: symbols.length,
      shortlisted: shortlist.length,
      count: finalList.length,
      registrySize: nextRegistry.length,
      /* Renamed from catalystsFound, which counted WIIM matches and had been
         reporting near-zero for weeks without anyone reading it as a fault.
         `silent` is the one to watch here: it is the scan's whole premise —
         heavy abnormal volume with no published explanation — and it is only
         meaningful once the news feed actually works. A silent count equal to
         the full list means the feed is broken again, not that the market has
         gone quiet. */
      newsFound: finalList.filter(c => c.thesis != null).length,
      silent: finalList.filter(c => c.thesis == null).length,
      negativeCatalysts: finalList.filter(c => c.newsSentiment === 'negative').length,
      scanMeta: EP9M_META,
      planCoverage,
      chopStats,
    });
  } catch (error: any) {
    console.error('EP9M_RUN_ERROR:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/* ---- Entry point --------------------------------------------------------
   ?bg=true acknowledges immediately and runs the scan after the response
   flushes. That is what cron should hit: the client gets its 200 in under a
   second instead of waiting out a scan it has no reason to wait for.

   WITHOUT ?bg THE ROUTE STILL RUNS SYNCHRONOUSLY, which is what you want
   when triggering it by hand — the response carries the funnel, the plan
   coverage and the chop distribution, and none of that is worth having if
   the request returns before the numbers exist.

   isDetachedRun() forces the synchronous path even if `bg` somehow survived
   into a self-call. The background lib already strips the parameter, so this
   is belt-and-braces against a recursion that would spawn scans until the
   platform cut it off, with none of them ever finishing. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const background = searchParams.get('bg') === 'true' && !isDetachedRun(request);

  if (!background) return runScan(request);

  const result = await runInBackground(request, 'ep9m', () => runScan(request));
  return NextResponse.json({ success: true, ...result }, { headers: BG_HEADERS });
}

export async function POST(request: Request) {
  return GET(request);
}
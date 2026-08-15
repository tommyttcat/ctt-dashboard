// app/api/vcp/run/route.ts — v1.3
//
// v1.3: NEWS MOVED FROM BENZINGA WIIM TO POLYGON.
//
//   The Benzinga news endpoint returns an empty JSON array for a key without
//   the news product, which is indistinguishable from a quiet news day, so
//   every row on this table read "No catalyst — the base is the thesis."
//   That line is TRUE OF MOST VCP ROWS and was therefore the perfect
//   camouflage: a base forming quietly is the normal case, so a broken feed
//   produced output that looked exactly like correct output.
//
//   DISPLAY ONLY HERE, unlike ep9m. scoreVcp takes contraction shape, volume
//   drying, RS Rating and the Trend Template — no catalyst term — so nothing
//   about the ranking moves. That is deliberate and worth keeping: a base is
//   supply being absorbed over weeks, and rewarding it for a headline
//   published this morning would score the wrong thing.
//
//   News on a VCP row answers a different question from news on a momentum
//   row. It is not why the stock moved — it has not moved, that is the
//   point. It is what the market may be positioning around while the base
//   builds, and whether the eventual breakout has a story waiting behind it.
//
// v1.2: gates and meta imported from scanConfig rather than defined locally.
//
// v1.1: two changes.
//
//   (a) RS RATING NOW COMES FROM /api/rs/run rather than being computed
//       here. This route ranked its own universe — every stock clearing its
//       $10 / 200k floors — while the shared job ranks everything above
//       $5 / 100k. Same formula, DIFFERENT POPULATIONS, and therefore
//       different percentiles for the same stock on the same day: a name
//       rating 85 against the VCP universe rates a point or two higher
//       against the broader one, because the VCP population is already
//       filtered toward strength and is a tougher field to rank inside.
//
//       That was fine while this was the only percentile on the dashboard.
//       It is not fine now that four scans show an RS column, because two
//       tables could give the same stock two ratings and both would be
//       internally correct.
//
//       Removing the inline version also deletes ~15 grouped-aggregate
//       calls per scan — the anchor fetches the shared job already performs
//       once daily for the whole market.
//
//   (b) BACKGROUND EXECUTION for cron. This scan runs in about eleven
//       seconds today, comfortably inside cron-job.org's ~30s ceiling, but
//       its runtime scales with how many names clear the prefilter and a
//       day full of bases would push it over. Cheap to add now, irritating
//       to diagnose later.
//
// VCP — Volatility Contraction Pattern (Mark Minervini)
//
// Finds stocks BUILDING a base, not stocks that have already broken out of
// one. That distinction is the reason this scan exists separately from
// /api/scanner/run, whose detectPattern() names a VCP only when
// `currentPrice > baseHigh` — i.e. on the day the pivot is already behind
// you. A base is worth watching for the two to six weeks BEFORE that.
//
// ---------------------------------------------------------------------------
// THE PIPELINE, and why it is shaped this way.
//
// The expensive thing in any market-wide structural scan is per-ticker daily
// bars. At ~3,000 names that is 3,000 calls, which is slow even with
// unlimited quota. So the work is staged cheapest-first:
//
//   1. UNIVERSE (1 call)
//      Full-market snapshot. Price, volume and instrument-type floors.
//
//   2. RECENT WINDOW (~126 calls, whole market)
//      Grouped daily aggregates, one call per trading date. Gives OHLCV for
//      EVERY stock across the base window in ~126 requests rather than 3,000.
//      This is the same trick /api/ep9m/run uses for its volume profile.
//
//   3. RS ANCHORS (~15 calls, whole market)
//      Three far-back grouped dates for the 126/189/252-day legs of the RS
//      formula. The 63-day leg comes free from the window in step 2.
//
//   4. PREFILTER (no calls)
//      Structural screen on the window data — two or more contractions, final
//      leg tight, legs shallowing. Deliberately LOOSER than the real test
//      because 90 bars cannot measure the prior advance properly; see the
//      note on prefilterVcp().
//
//   5. CONFIRM (one call per survivor, typically 30-80)
//      Full history per shortlisted name. This is the AUTHORITATIVE pass:
//      analyzeVcp with enough bars behind the base to measure the prior
//      advance, plus the 200-day Trend Template, which needs 200 bars and
//      therefore cannot be done in step 4 at any price.
//
// Net: roughly 150 market-wide calls plus a few dozen per-ticker, instead of
// 3,000 per-ticker.
// ---------------------------------------------------------------------------
//
// RS RATING IS A PERCENTILE, which is the whole point of computing it here
// rather than reusing rsVsSpy from the other scans. "+18 points versus SPY
// over three months" does not say whether that is top-decile leadership or
// the middle of a strong tape — and in a strong tape it is usually the
// middle. Minervini gates at 70 and prefers 80-90+; those numbers only mean
// anything against a ranked universe.
//
// The ranking universe is EVERY stock that clears the liquidity floors, not
// just the VCP candidates. Ranking the candidates against each other would
// produce a rating that says "strongest of the stocks already selected for
// being strong", which is not information.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import {
  analyzeVcp,
  evaluateTrendTemplate,
  scoreVcp,
  atrPercent,
  findPivots,
  extractContractions,
  PIVOT_ATR_MULTIPLE,
  VCP_MIN_CONTRACTIONS,
  VCP_MAX_CONTRACTIONS,
  VCP_MAX_FINAL_DEPTH,
  VCP_SHALLOWING_TOLERANCE,
  type VcpBar,
  type VcpResult,
  type TrendTemplate,
} from '@/lib/indicators/vcp';
import { computeMoneyFlow, moneyFlowTrend } from '@/lib/indicators/moneyflow';
import { computeStage } from '@/lib/indicators/stage';
import { loadRsRatings, type RsLookup } from '@/lib/indicators/rs';
import { runInBackground, isDetachedRun, BG_HEADERS } from '@/lib/background';
import { pickBestNews, polygonNewsPath, fetchBenzingaNewsIndex, type NewsItem } from '@/lib/indicators/news';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 300;

const POLYGON_KEY = process.env.NEXT_PUBLIC_POLYGON_API_KEY || process.env.POLYGON_API_KEY || '';
/* Benzinga is back for news only (v1.4). The v1.3 move to Polygon is what made
   this column go dark: Polygon's per-ticker feed is Motley Fool wall-to-wall on
   this plan, and pickBestNews blocks that publisher by design. */
const BENZINGA_KEY = (process.env.NEXT_PUBLIC_BENZINGA_API_KEY || process.env.BENZINGA_API_KEY || '').trim();
const BASE = 'https://api.polygon.io';

/* ---- Gates --------------------------------------------------------------
   Defined in @/lib/scanConfig rather than here, and aliased so the rest of
   this file reads unchanged.

   That file's whole purpose is that the numbers doing the filtering and the
   numbers shown in the on-screen key are the SAME OBJECT. A local copy here
   would drift the moment either was edited alone, and the divergence would
   be invisible: the key would confidently document a threshold the scan had
   stopped enforcing. */
import { VCP as VCP_GATES, VCP_META } from '@/lib/scanConfig';
export { VCP_GATES };

const ENRICH_CONCURRENCY = 8;


/* Trading days to calendar days, roughly. 252 trading days is a year, so the
   ratio is about 1.45. Used only to guess where to start looking — each
   anchor then walks back day by day until a date returns data. */
const TRADING_TO_CALENDAR = 1.45;
const ANCHOR_MAX_ATTEMPTS = 6;

// ETFs that clear the liquidity floors. Most would fail the structural test
// anyway, but leveraged products can produce textbook-looking contractions
// that mean nothing — there is no company being accumulated. Backstopped by
// a ticker `type` check at confirmation.
const EXCLUDED_ETFS = new Set([
  'SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'VTI', 'EEM', 'EFA', 'XLF', 'XLE', 'XLK',
  'XLI', 'XLV', 'XLU', 'XLP', 'XLY', 'XLB', 'XLRE', 'XLC', 'SMH', 'SOXX',
  'TQQQ', 'SQQQ', 'QLD', 'QID', 'SOXL', 'SOXS', 'TECL', 'TECS', 'SPXL', 'SPXS',
  'SPXU', 'UPRO', 'SDS', 'SSO', 'TNA', 'TZA', 'FAS', 'FAZ', 'LABU', 'LABD',
  'UVXY', 'UVIX', 'SVIX', 'VIXY', 'VXX', 'FNGU', 'FNGD', 'GLD', 'SLV', 'GDX',
  'GDXJ', 'USO', 'UNG', 'TLT', 'HYG', 'LQD', 'ARKK', 'IBIT', 'BITO', 'BITX',
  'NUGT', 'DUST', 'JNUG', 'ERX', 'ERY', 'BOIL', 'KOLD', 'NAIL', 'URAA',
  'MSTX', 'MSTU', 'CONL', 'NVDL', 'TSLL', 'AAPU', 'MSFU', 'AMZU',
]);

interface SnapInfo {
  price: number;
  prevClose: number;
  changePct: number;
  vol: number;
  vwap: number | null;
  dayHigh: number | null;
  dayLow: number | null;
}

interface VcpCandidate {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  changePct: number;
  vol: number;
  dVol: number;
  avgVol: number;
  rvol: number | null;
  mktCap: number | null;
  float: number | null;

  score: number;
  grade: string;
  scoreBreakdown: Record<string, number>;

  rsRating: number | null;
  rsRaw: number | null;

  // VCP shape
  contractionCount: number;
  depths: number[];
  firstDepthPct: number | null;
  finalDepthPct: number | null;
  pivot: number | null;
  pctToPivot: number | null;
  baseLengthBars: number | null;
  baseHigh: number | null;
  baseLow: number | null;
  priorMovePct: number | null;
  volumeDryingRatio: number | null;
  finalLegVolumeRatio: number | null;
  status: string;
  atrPct: number | null;

  // Trend template
  templatePassed: number | null;
  templateTotal: number | null;
  templateFailures: string[];
  pctAbove52wLow: number | null;
  pctBelow52wHigh: number | null;

  // Context
  stage: string;
  mf: number | null;
  mfTrend: number;
  vwapStatus: 'above' | 'below' | 'neutral';
  catalyst: string | null;
  catalystUrl: string | null;
  thesis: string | null;
  newsPublisher: string | null;
  newsAge: string | null;
  newsSentiment: 'positive' | 'negative' | 'neutral' | null;

  // Levels for the trade
  trigger: number | null;
  stop: number | null;
  stopPct: number | null;
  target: number | null;
}

async function polygon<T = any>(path: string): Promise<T> {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${BASE}${path}${sep}apiKey=${POLYGON_KEY}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Polygon ${res.status}: ${path.split('?')[0]}`);
  return res.json() as Promise<T>;
}

async function polygonSafe<T = any>(path: string, fallback: T): Promise<T> {
  try { return await polygon<T>(path); } catch { return fallback; }
}

const ymd = (d: Date): string => d.toISOString().slice(0, 10);

const dateDaysAgo = (n: number): Date => new Date(Date.now() - n * 86400000);

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

// ---------------------------------------------------------------
// Stage 1: universe
// ---------------------------------------------------------------
async function getUniverse(): Promise<{ symbols: Set<string>; snapMap: Map<string, SnapInfo> }> {
  const data = await polygon<{ tickers?: any[] }>('/v2/snapshot/locale/us/markets/stocks/tickers');
  const tickers = data.tickers ?? [];

  const snapMap = new Map<string, SnapInfo>();
  const symbols = new Set<string>();

  for (const t of tickers) {
    const sym: string = t.ticker ?? '';
    if (!/^[A-Z]{1,5}$/.test(sym)) continue;
    if (EXCLUDED_ETFS.has(sym)) continue;

    const price = t.lastTrade?.p || t.min?.c || t.day?.c || t.prevDay?.c || 0;
    if (price < VCP_GATES.minPrice || price > VCP_GATES.maxPrice) continue;

    const vol = t.day?.v || t.prevDay?.v || 0;
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
    });
    symbols.add(sym);
  }

  return { symbols, snapMap };
}

// ---------------------------------------------------------------
// Stage 2: recent window from grouped aggregates
//
// One call per trading date returns every stock's bar for that date. ~126
// calls covers the base window for the whole market — the alternative is one
// call per ticker, which is twenty times as many.
// ---------------------------------------------------------------
async function fetchRecentWindow(
  universe: Set<string>,
  tradingDays: number
): Promise<{ series: Map<string, VcpBar[]>; datesUsed: string[] }> {
  const calendarDays = Math.ceil(tradingDays * TRADING_TO_CALENDAR) + 10;

  const dates: string[] = [];
  for (let d = calendarDays; d >= 1; d--) {
    const dt = dateDaysAgo(d);
    const day = dt.getUTCDay();
    if (day === 0 || day === 6) continue;
    dates.push(ymd(dt));
  }

  const dayResults: { date: string; results: any[] }[] = [];
  const BATCH = 7;
  for (let i = 0; i < dates.length; i += BATCH) {
    const chunk = dates.slice(i, i + BATCH);
    const settled = await Promise.allSettled(chunk.map(async (date) => {
      const d = await polygonSafe<{ results?: any[] }>(
        `/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true`,
        { results: [] }
      );
      return { date, results: d.results ?? [] };
    }));
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value.results.length > 0) dayResults.push(r.value);
    }
  }

  dayResults.sort((a, b) => a.date.localeCompare(b.date));
  const kept = dayResults.slice(-tradingDays);

  // Series are built OLDEST FIRST, which is what the vcp lib requires. The
  // sort above is what guarantees it; without it the pivot walk would run
  // backwards and return a plausible number computed from the wrong end.
  const series = new Map<string, VcpBar[]>();
  for (const day of kept) {
    const t = new Date(day.date).getTime();
    for (const bar of day.results) {
      const sym = bar.T;
      if (!universe.has(sym)) continue;
      let arr = series.get(sym);
      if (!arr) { arr = []; series.set(sym, arr); }
      arr.push({ t, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v });
    }
  }

  return { series, datesUsed: kept.map(d => d.date) };
}


/* ---- Stage 4b: structural prefilter -------------------------------------
   DELIBERATELY LOOSER THAN THE REAL TEST, for a reason that matters.

   analyzeVcp() gates on the prior advance — at least 25% up into the base,
   because without an advance there is no supply overhang to absorb and the
   "base" is just a quiet stock. Measuring that needs bars from BEFORE the
   base began, and a 90-bar window whose base occupies the last 40 leaves
   only 50 bars of prior history. On a base that formed after a long run,
   that truncation understates the advance and would reject the name.

   So this pass checks only what 90 bars can answer honestly — are there two
   or more contractions, is the final one tight, are they shallowing — and
   defers every judgement that needs deeper history to the confirmation pass,
   which fetches 400 bars per survivor.

   A prefilter that is stricter than the real test silently loses candidates
   and no downstream count will ever reveal it. Looser is the safe direction:
   the cost is a few extra per-ticker fetches. */
function prefilterVcp(bars: VcpBar[]): boolean {
  if (bars.length < 60) return false;

  const atrP = atrPercent(bars, 14);
  if (atrP == null || atrP <= 0) return false;

  const threshold = Math.max(1.5, Math.min(12, atrP * PIVOT_ATR_MULTIPLE));
  const pivots = findPivots(bars, threshold);
  const all = extractContractions(bars, pivots);
  if (all.length < VCP_MIN_CONTRACTIONS) return false;

  const cons = all.slice(-VCP_MAX_CONTRACTIONS);
  const depths = cons.map(c => c.depthPct);

  if (depths[depths.length - 1] > VCP_MAX_FINAL_DEPTH) return false;

  for (let i = 1; i < depths.length; i++) {
    if (depths[i] > depths[i - 1] * VCP_SHALLOWING_TOLERANCE) return false;
  }

  return true;
}

// ---------------------------------------------------------------
// Catalyst (optional, best-effort)
// ---------------------------------------------------------------
/* fetchWiims and classifyWiim used to live here. Their rejection cases —
   law-firm solicitations, over-broad baskets, stale items — are all covered
   inside @/lib/indicators/news, and keeping a local copy as a second opinion
   is how two classifiers drift apart on the same headline. */

function cleanSector(sic: string | undefined, sector: string | undefined, industry: string | undefined): string {
  const blob = `${(industry || '').toLowerCase()} ${(sic || '').toLowerCase()}`;
  if (/nuclear|uranium/.test(blob)) return 'Nuclear';
  if (/solar|photovoltaic/.test(blob)) return 'Solar';
  if (/electric vehicle|motor vehicle/.test(blob)) return 'EV';
  if (/biotechnolog|biological product|in vitro/.test(blob)) return 'Biotech';
  if (/semiconductor/.test(blob)) return "Semi's";
  if (/artificial intelligence/.test(blob)) return 'AI';
  if (/cybersecurity|security software/.test(blob)) return 'Cyber';
  if (/aerospace|\bdefense\b|aircraft|space vehicle/.test(blob)) return 'Aerospace';

  const s = (sic || '').toLowerCase();
  if (/software|prepackaged|data processing|computer/.test(s)) return 'IT';
  if (/pharmaceutical|drug|medical|health|surgical/.test(s)) return 'Healthcare';
  if (/petroleum|natural gas|drilling|\boil\b|energy/.test(s)) return 'Energy';
  if (/\bbank\b|insurance|investment|securities broker/.test(s)) return 'Financials';
  if (/real estate/.test(s)) return 'Real Estate';
  if (/electric services|water supply/.test(s)) return 'Utilities';
  if (/telephone|broadcast|publishing|entertainment/.test(s)) return 'Comm Serv';
  if (/retail|restaurant|apparel|hotel/.test(s)) return 'Con Disc';
  if (/beverage|\bfood\b|tobacco|household/.test(s)) return 'Con Staples';
  if (/mining|steel|chemical|paper mill/.test(s)) return 'Materials';
  if (/machinery|industrial|construction|transportation/.test(s)) return 'Industrials';

  const sec = (sector || '').toLowerCase();
  if (sec.includes('technology')) return 'IT';
  if (sec.includes('health')) return 'Healthcare';
  if (sec.includes('financial')) return 'Financials';
  if (sec.includes('energy')) return 'Energy';
  return 'Other';
}

const round2 = (v: number | null | undefined): number | null =>
  v == null || !Number.isFinite(v) ? null : parseFloat(v.toFixed(2));

/* ---- The trade ----------------------------------------------------------
   Trigger is the PIVOT — the high of the final contraction — not the day
   high and not the base high. Minervini's buy point is the point at which
   the last supply that defended the base gives way.

   Stop is the low of the final contraction, which is what invalidates the
   pattern: price back through the bottom of the tightest leg means the
   absorption read was wrong. That is usually a tighter stop than an ATR
   rule would produce, which is the reason to trade a VCP at all — the
   pattern defines its own risk. A floor is applied so a freakishly tight
   final leg does not produce a stop inside normal daily noise. */
const MIN_STOP_PCT = 2.0;

/* Age at which the chip gains "(Delayed)". Thirty-six hours is a long time
   on a momentum table and almost nothing on a base that has been forming for
   six weeks — but the label is about the READER's expectation, not the
   pattern's timescale, and a headline from yesterday should say so wherever
   it appears. */
const DELAYED_AGE_HOURS = 36;

function buildLevels(vcp: VcpResult, price: number): {
  trigger: number | null;
  stop: number | null;
  stopPct: number | null;
  target: number | null;
} {
  if (!vcp.valid || vcp.pivot == null || vcp.contractions.length === 0) {
    return { trigger: null, stop: null, stopPct: null, target: null };
  }

  const finalLeg = vcp.contractions[vcp.contractions.length - 1];
  const trigger = vcp.pivot;

  let stop = finalLeg.low;
  let stopPct = ((trigger - stop) / trigger) * 100;

  if (stopPct < MIN_STOP_PCT) {
    stopPct = MIN_STOP_PCT;
    stop = trigger * (1 - MIN_STOP_PCT / 100);
  }

  const risk = trigger - stop;
  const target = trigger + risk * 2;

  return { trigger, stop, stopPct, target };
}

async function runScan(request: Request) {
  const started = Date.now();

  try {
    if (!POLYGON_KEY) {
      return NextResponse.json({ success: false, error: 'Missing Polygon API Key' }, { status: 500 });
    }

    // --- 1. Universe ---
    const { symbols, snapMap } = await getUniverse();
    if (symbols.size === 0) {
      return NextResponse.json({ success: false, error: 'Empty universe from snapshot' }, { status: 502 });
    }

    /* --- 2 & 3. Market-wide history and the shared RS map, in parallel ---

       The anchor fetches that used to live here are gone: /api/rs/run pulls
       them once daily for the whole market and writes the ranked result to
       KV, so this is a single read instead of ~15 grouped calls.

       A missing or stale map is FATAL to this scan, unlike the others. RS is
       a hard gate here — VCP_GATES.minRsRating — so an absent map would send
       every name through the gate unrated and the scan would either return
       nothing or, worse, return bases with no strength requirement at all
       while looking like it worked. */
    const [{ series, datesUsed }, rsLookup] = await Promise.all([
      fetchRecentWindow(symbols, VCP_GATES.windowTradingDays),
      loadRsRatings(),
    ]);

    if (!rsLookup.available) {
      return NextResponse.json({
        success: false,
        error: `RS ratings unavailable — ${rsLookup.reason ?? 'unknown'}. This scan gates on RS, so it will not run without them.`,
        hint: 'Run /api/rs/run, then retry.',
      }, { status: 503 });
    }

    // --- 4b. Structural prefilter ---
    const prefiltered: { sym: string; rs: number }[] = [];
    let liquidityRejects = 0;
    let rsRejects = 0;
    let structureRejects = 0;

    series.forEach((bars, sym) => {
      const snap = snapMap.get(sym);
      if (!snap) return;

      const avgVol = bars.length >= 20
        ? bars.slice(-20).reduce((s, b) => s + (b.v || 0), 0) / 20
        : 0;
      if (avgVol < VCP_GATES.minAvgVolume) { liquidityRejects++; return; }
      if (avgVol * snap.price < VCP_GATES.minDollarVol) { liquidityRejects++; return; }

      const rs = rsLookup.get(sym);
      if (rs == null || rs < VCP_GATES.minRsRating) { rsRejects++; return; }

      if (!prefilterVcp(bars)) { structureRejects++; return; }

      prefiltered.push({ sym, rs });
    });

    // Strongest first, so the shortlist cap cuts the weakest rather than an
    // arbitrary alphabetical tail.
    prefiltered.sort((a, b) => b.rs - a.rs);
    const shortlist = prefiltered.slice(0, VCP_GATES.shortlistCap);

    // --- 5. Confirmation pass ---
    const to = ymd(new Date());
    const from = ymd(dateDaysAgo(500));

    /* One fetch for the whole scan, indexed by ticker — this plan's Benzinga
       endpoint ignores per-ticker params, so filtering happens here. */
    const bzIndex = await fetchBenzingaNewsIndex(BENZINGA_KEY);

    const confirmed = await inBatches(shortlist, ENRICH_CONCURRENCY, async ({ sym, rs }) => {
      const snap = snapMap.get(sym);
      if (!snap) return null;

      const [barsRes, details, newsRes] = await Promise.all([
        polygonSafe<{ results?: any[] }>(
          `/v2/aggs/ticker/${encodeURIComponent(sym)}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=5000`,
          { results: [] }
        ),
        polygonSafe<any>(`/v3/reference/tickers/${sym}`, {}),
        /* One extra call per CONFIRMED name — a few dozen, not the universe.
           It rides in the existing round trip rather than following the bars,
           because news has no dependency on them and sequencing would add a
           full latency hop per name for nothing. */
        polygonSafe<any>(polygonNewsPath(sym, 20), { results: [] }),
      ]);

      // Backstop for funds that slipped past the static exclusion list.
      const tickerType = (details?.results?.type || '').toUpperCase();
      if (tickerType && tickerType !== 'CS' && tickerType !== 'ADRC') return null;

      const raw = barsRes.results ?? [];
      if (raw.length < 200) return null;

      // sort=asc above, so these are already oldest-first — which is what
      // the vcp lib requires. analyzeVcp has a guard, but the order is the
      // caller's responsibility.
      const bars: VcpBar[] = raw
        .filter((b: any) => b && typeof b.h === 'number' && typeof b.l === 'number' && typeof b.c === 'number')
        .map((b: any) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));

      const vcp = analyzeVcp(bars, { lookback: VCP_GATES.windowTradingDays });
      if (!vcp.valid) return null;

      const template = evaluateTrendTemplate(bars);
      const scored = scoreVcp({ vcp, rsRating: rs, template });

      const avgVol = bars.length >= 20
        ? bars.slice(-20).reduce((s, b) => s + (b.v || 0), 0) / 20
        : 0;
      const rvol = avgVol > 0 && snap.vol > 0 ? snap.vol / avgVol : null;

      const mf = computeMoneyFlow(bars, { length: 21 });
      const mfTrend = moneyFlowTrend(bars, { length: 21, lookback: 5 });
      const stage = computeStage(bars.map(b => b.c), { price: snap.price });

      const levels = buildLevels(vcp, snap.price);

      /* A base is quiet by construction, so null here is the expected
         outcome on most rows rather than a gap. What matters is that it is
         now null because nothing was published, not because the feed was
         dead. */
      const news: NewsItem | null = pickBestNews(
        [...(bzIndex.get(sym) ?? []), ...(newsRes?.results ?? [])],
        sym
      );

      const mktCap = details?.results?.market_cap || null;
      const float = details?.results?.share_class_shares_outstanding
        || (mktCap && snap.price ? mktCap / snap.price : null);

      let vwapStatus: 'above' | 'below' | 'neutral' = 'neutral';
      if (snap.vwap && snap.vwap > 0) vwapStatus = snap.price >= snap.vwap ? 'above' : 'below';

      const out: VcpCandidate = {
        symbol: sym,
        name: details?.results?.name || sym,
        sector: cleanSector(
          details?.results?.sic_description,
          details?.results?.sector,
          details?.results?.industry
        ),
        price: +snap.price.toFixed(2),
        changePct: +snap.changePct.toFixed(2),
        vol: snap.vol,
        dVol: Math.round(snap.price * snap.vol),
        avgVol: Math.round(avgVol),
        rvol: rvol != null ? +rvol.toFixed(2) : null,
        mktCap,
        float,

        score: scored.score,
        grade: scored.grade,
        scoreBreakdown: scored.breakdown,

        rsRating: rs,
        /* rsRaw is gone. It was the pre-ranking score from this route's own
           computation, and the shared job does not publish per-symbol raws —
           only the ranked percentile, which is the number that means
           anything. */
        rsRaw: null,

        contractionCount: vcp.contractionCount,
        depths: vcp.depths.map(d => +d.toFixed(1)),
        firstDepthPct: vcp.firstDepthPct != null ? +vcp.firstDepthPct.toFixed(1) : null,
        finalDepthPct: vcp.finalDepthPct != null ? +vcp.finalDepthPct.toFixed(1) : null,
        pivot: round2(vcp.pivot),
        pctToPivot: vcp.pctToPivot != null ? +vcp.pctToPivot.toFixed(2) : null,
        baseLengthBars: vcp.baseLengthBars,
        baseHigh: round2(vcp.baseHigh),
        baseLow: round2(vcp.baseLow),
        priorMovePct: vcp.priorMovePct != null ? +vcp.priorMovePct.toFixed(1) : null,
        volumeDryingRatio: vcp.volumeDryingRatio != null ? +vcp.volumeDryingRatio.toFixed(2) : null,
        finalLegVolumeRatio: vcp.finalLegVolumeRatio != null ? +vcp.finalLegVolumeRatio.toFixed(2) : null,
        status: vcp.status,
        atrPct: vcp.atrPct != null ? +vcp.atrPct.toFixed(2) : null,

        templatePassed: template?.passed ?? null,
        templateTotal: template?.total ?? null,
        templateFailures: template?.failures ?? [],
        pctAbove52wLow: template?.pctAbove52wLow != null ? +template.pctAbove52wLow.toFixed(1) : null,
        pctBelow52wHigh: template?.pctBelow52wHigh != null ? +template.pctBelow52wHigh.toFixed(1) : null,

        stage,
        mf,
        mfTrend,
        vwapStatus,
        /* Filled from `news` below rather than left for a second pass. The
           old flow built every candidate with nulls and then looped again to
           patch in WIIM results; folding it here means one place where a row
           acquires its catalyst instead of two. */
        catalyst: news
          ? (news.ageHours >= DELAYED_AGE_HOURS ? `${news.tag} (Delayed)` : news.tag)
          : null,
        catalystUrl: news?.url ?? null,
        thesis: news?.title ?? null,
        newsPublisher: news?.publisher ?? null,
        newsAge: news?.ageLabel ?? null,
        newsSentiment: news?.sentiment ?? null,

        trigger: round2(levels.trigger),
        stop: round2(levels.stop),
        stopPct: levels.stopPct != null ? +levels.stopPct.toFixed(2) : null,
        target: round2(levels.target),
      };

      return out;
    });

    /* The catalyst back-fill loop that used to sit here is gone — news is
       assigned inside the confirmation pass now, where the row is built. */

    confirmed.sort((a, b) => b.score - a.score);
    const finalList = confirmed.slice(0, VCP_GATES.finalSize);

    const scanTime = Date.now();
    const meta = {
      ...VCP_META,
      gates: VCP_GATES,
      rsAsOf: rsLookup.asOf,
      rsAgeDays: rsLookup.ageDays,
      rsRankedUniverse: rsLookup.ranked,
      windowStart: datesUsed[0] ?? null,
      windowEnd: datesUsed[datesUsed.length - 1] ?? null,
      windowBars: datesUsed.length,
    };

    await kv.set('vcp_v1', finalList);
    await kv.set('vcp_last_scan_v1', scanTime);
    await kv.set('vcp_meta_v1', {
      ...meta,
      universe: symbols.size,
      prefiltered: prefiltered.length,
      confirmed: confirmed.length,
      count: finalList.length,
    });

    /* The funnel is the diagnostic that matters on a structural scan. If
       `prefiltered` is large and `confirmed` is tiny, the confirmation pass
       is rejecting on prior-move or trend-template and the shortlist cap may
       be cutting real candidates before they are tested. If `prefiltered` is
       near zero, the market has no bases — which on a trending tape is
       itself the finding. */
    return NextResponse.json({
      success: true,
      lastScanTime: scanTime,
      elapsedMs: scanTime - started,
      count: finalList.length,
      funnel: {
        universe: symbols.size,
        withHistory: series.size,
        rsRankedUniverse: rsLookup.ranked,
        liquidityRejects,
        rsRejects,
        structureRejects,
        prefiltered: prefiltered.length,
        shortlisted: shortlist.length,
        confirmed: confirmed.length,
      },
      /* `withNews` well under `count` is the EXPECTED shape on this table
         and not a warning: a base is a stock going quiet, and most of them
         have nothing published. The number that would signal a fault is
         ZERO across several runs, which is what the dead Benzinga feed
         produced — and which looked entirely plausible because "no catalyst,
         the base is the thesis" is true of most VCP rows anyway. */
      newsCoverage: {
        withNews: finalList.filter(c => c.thesis != null).length,
        negative: finalList.filter(c => c.newsSentiment === 'negative').length,
      },
      statusCounts: {
        forming: finalList.filter(c => c.status === 'forming').length,
        pivotReady: finalList.filter(c => c.status === 'pivot-ready').length,
        breakingOut: finalList.filter(c => c.status === 'breaking-out').length,
      },
      scanMeta: meta,
    });
  } catch (error: any) {
    console.error('VCP_RUN_ERROR:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/* ---- Entry point --------------------------------------------------------
   ?bg=true acknowledges immediately and runs the scan after the response
   flushes — that is what cron should hit. Without it the route runs
   synchronously, which is what you want by hand: the response carries the
   funnel, and the funnel is the only way to tell "the market has no bases"
   from "the scan is broken".

   isDetachedRun() forces the synchronous path even if `bg` survived into a
   self-call. The background lib already strips the parameter, so this guards
   against a recursion that would spawn scans until the platform cut them
   off, with none ever finishing. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const background = searchParams.get('bg') === 'true' && !isDetachedRun(request);

  if (!background) return runScan(request);

  const result = await runInBackground(request, 'vcp', () => runScan(request));
  return NextResponse.json({ success: true, ...result }, { headers: BG_HEADERS });
}

export async function POST(request: Request) {
  return GET(request);
}
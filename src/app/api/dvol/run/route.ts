// app/api/dvol/run/route.ts — v1.0
//
// DOLLAR VOLUME — where the money actually is.
//
// The card this feeds used to screen `rawSnapshot` from MarketDataContext: the
// 60-70 names the other scans had already flagged. That universe cannot answer
// the question the card is asking. "Where is the money" scoped to names already
// selected for being interesting only ever says "in the names we already
// picked" — the biggest dollar-volume prints of the day are routinely in stocks
// no momentum scan surfaces, and those were structurally invisible.
//
// So this scans the WHOLE MARKET, and does it in one request per trading day
// rather than one per ticker:
//
//   /v2/aggs/grouped/locale/us/market/stocks/{date}
//
// returns OHLCV for every US listing on that date. Dollar volume is close ×
// volume off that single payload — roughly 11,000 rows for one call.
//
// WHY 21 DAYS AND NOT 1. RVOL needs an average to be relative to, and the card
// showed an RVol column before this rebuild; dropping it would have been a
// regression. Twenty prior grouped days give a 20-day average volume for every
// ticker in the market at a cost of 21 calls total, versus ~11,000 if this were
// done per-ticker. They fire in parallel.
//
// MARKET CAP IS NOT IN THE GROUPED FEED, which is why the cap bands need a
// second call. Polygon has no bulk cap endpoint, so it comes per-ticker from
// /v3/reference/tickers — the same source scanner/run reads — and only for the
// few hundred names that clear the floor, never the full universe.
//
// THE $20M FLOOR IS THE PRODUCT DECISION, not a performance one. Below it the
// list fills with names whose "dollar volume" is a rounding error on a thin
// book, and the whole point of the card is size. (Was $10M until 13 Aug 2026,
// when the 10-20M band was dropped from the card.)

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { runInBackground, isDetachedRun, BG_HEADERS } from '@/lib/background';
import { computeStage } from '@/lib/indicators/stage';
import { loadRsRatings } from '@/lib/indicators/rs';
import { fetchBenzingaNewsIndex, pickBestNews } from '@/lib/indicators/news';
import { fromAscending } from '@/lib/indicators/barMetrics';
import { computeCnfScore } from '@/lib/indicators/confluence';
import { cleanSectorDescription } from '@/lib/sectors';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 300;

const POLYGON_KEY = process.env.NEXT_PUBLIC_POLYGON_API_KEY || process.env.POLYGON_API_KEY || '';
const BENZINGA_KEY = (process.env.NEXT_PUBLIC_BENZINGA_API_KEY || process.env.BENZINGA_API_KEY || '').trim();

const KV_ROWS = 'dvol_rows_v1';
const KV_TIME = 'dvol_last_scan_v1';
const KV_META = 'dvol_meta_v1';

/* Floor in dollars. MATCHES THE BOTTOM PILL ON THE CARD and must keep
   matching it: a pill offering a band the scan never collected would be
   silently lying about what it filtered. Raised 10M -> 20M on 13 Aug 2026
   when the 10-20M pill was dropped — leaving the floor at 10M would have
   meant collecting a cohort with no way to view it. */
const DVOL_FLOOR = 20e6;

/* Money alone was surfacing SPY, QQQ and the mega caps every day — true, and
   not actionable, because a large stock trading its normal size is not news.
   Pairing the dollar floor with a move filter asks the question the card is
   really for: where did SIZE show up somewhere that also WENT somewhere. */
const MIN_CHANGE_PCT = 4;

/* Sub-$2 names clear the dollar floor on share count alone and bring spreads
   and halts with them. */
const MIN_PRICE = 2;

/* Share-count floor, alongside the dollar floor. The two catch different
   things: $20M of dollar volume is one 10,000-share block in a $2,000 stock,
   which is size without participation. Requiring 5M shares as well asks that
   a crowd was involved, not just a large ticket. */
const MIN_VOL = 5e6;

/* Market-cap floor. Low by design — it is there to drop the shells and
   sub-scale listings that can clear a dollar floor on a single frenzied
   session, not to screen for size. */
const MIN_MKT_CAP = 25e6;

/* ADR and RVOL are still COMPUTED and still shown on the row — they were
   dropped as GATES on 13 Aug 2026 when the filter set was aligned with the
   TradingView screen this card mirrors (US · chg > 4% · mkt cap > 25M ·
   price x vol > 20M · price > $2 · vol > 5M). The share-count floor now does
   the work the RVOL gate was doing, and does it without penalising a name
   whose 20-day average has not had time to form. To reinstate either, filter
   on r.adrPct / r.rvol in `moved` below — the values are already there. */

/* Deep enough that the cap-band pills still have something to show when they
   narrow the list (a Nano-only view drops nearly everything at the top), while
   keeping the KV payload sane. The card itself renders 40. */
const KEEP = 120;

/* Extra rows carried through the per-ticker enrichment so the market-cap gate
   has something to cut into. See `candidates`. */
const CAP_HEADROOM = 40;

const HISTORY_DAYS = 20;     // prior sessions averaged for RVOL
const CAP_CONCURRENCY = 25;  // parallel ticker-reference lookups for market cap

async function safeJson<T>(url: string, fallback: T, timeoutMs = 20000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal as any, cache: 'no-store' });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

/* Trading dates come from SPY's own bars rather than from a calendar. Holidays
   and half days are then correct by construction — if SPY did not print, it was
   not a session, and no holiday table has to be maintained. */
async function tradingDates(count: number): Promise<string[]> {
  const to = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now() - (count + 20) * 86400e3).toISOString().split('T')[0];
  const bars = await safeJson<{ results?: { t: number }[] }>(
    `https://api.polygon.io/v2/aggs/ticker/SPY/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=5000&apiKey=${POLYGON_KEY}`,
    { results: [] }
  );
  const all = (bars.results ?? []).map(b => new Date(b.t).toISOString().split('T')[0]);
  return all.slice(-count);
}

/* Share classes and warrants arrive as CRWV.WS / BRK.B style symbols. The dot
   forms are not what this card is about and clutter the top of the list. */
const isTradeableSymbol = (t: string) => !!t && !t.includes('.') && !t.includes(':') && t.length <= 5;

async function runScan(req: Request) {
  const url = new URL(req.url);
  const force = url.searchParams.get('force') === 'true' || url.searchParams.get('force') === '1';

  if (!POLYGON_KEY) {
    return NextResponse.json({ success: false, error: 'POLYGON_API_KEY not configured' }, { status: 500 });
  }

  try {
    const dates = await tradingDates(HISTORY_DAYS + 1);
    if (dates.length < 2) {
      return NextResponse.json({ success: false, error: 'Could not resolve trading dates' }, { status: 500 });
    }

    const targetDate = dates[dates.length - 1];
    const priorDates = dates.slice(0, -1);

    const [targetRes, ...priorRes] = await Promise.all([
      safeJson<{ results?: any[] }>(
        `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${targetDate}?adjusted=true&apiKey=${POLYGON_KEY}`,
        { results: [] }
      ),
      ...priorDates.map(d =>
        safeJson<{ results?: any[] }>(
          `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${d}?adjusted=true&apiKey=${POLYGON_KEY}`,
          { results: [] }
        )
      ),
    ]);

    const today: any[] = targetRes.results ?? [];
    if (today.length === 0) {
      /* An empty grouped payload is the weekend/holiday signature. Writing it
         would replace a good list with nothing, so the previous scan stands. */
      return NextResponse.json(
        { success: false, error: `No grouped data for ${targetDate} — leaving the previous scan in place`, targetDate },
        { status: 503 }
      );
    }

    /* Volume history and previous close, both keyed by ticker. The last prior
       date doubles as the previous close for the change calculation. */
    const volHistory = new Map<string, number[]>();
    /* Daily range as a percentage of close, per session — averaged into ADR
       below. Collected in the same pass as volume so the 20 grouped payloads
       are only walked once. */
    const rangeHistory = new Map<string, number[]>();
    for (const day of priorRes) {
      for (const r of day.results ?? []) {
        if (!r?.T) continue;
        if (isFinite(r.v)) {
          const arr = volHistory.get(r.T);
          if (arr) arr.push(r.v);
          else volHistory.set(r.T, [r.v]);
        }
        if (isFinite(r.h) && isFinite(r.l) && isFinite(r.c) && r.c > 0) {
          const pct = ((r.h - r.l) / r.c) * 100;
          const arr = rangeHistory.get(r.T);
          if (arr) arr.push(pct);
          else rangeHistory.set(r.T, [pct]);
        }
      }
    }
    const prevClose = new Map<string, number>();
    for (const r of priorRes[priorRes.length - 1]?.results ?? []) {
      if (r?.T && isFinite(r.c)) prevClose.set(r.T, r.c);
    }

    let universeSize = 0;
    const rows = [];
    for (const r of today) {
      const ticker = r?.T;
      if (!isTradeableSymbol(ticker)) continue;
      const close = Number(r.c);
      const vol = Number(r.v);
      if (!isFinite(close) || !isFinite(vol) || close <= 0 || vol <= 0) continue;

      universeSize++;
      if (close < MIN_PRICE) continue;
      if (vol < MIN_VOL) continue;
      const dvol = close * vol;
      if (dvol < DVOL_FLOOR) continue;

      const hist = volHistory.get(ticker) ?? [];
      const avgVol = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : null;
      const ranges = rangeHistory.get(ticker) ?? [];
      const adrPct = ranges.length >= 10 ? ranges.reduce((a, b) => a + b, 0) / ranges.length : null;
      const pc = prevClose.get(ticker);

      rows.push({
        ticker,
        price: close,
        open: Number(r.o) || null,
        high: Number(r.h) || null,
        low: Number(r.l) || null,
        vwap: Number(r.vw) || null,
        vol,
        dvol,
        avgVol,
        rvol: avgVol && avgVol > 0 ? vol / avgVol : null,
        adrPct,
        changePct: pc && pc > 0 ? ((close - pc) / pc) * 100 : null,
        /* Where the close sits inside the day's range. A name printing huge
           dollar volume at the low of its range is a very different fact from
           one printing it at the high, and nothing else on the row says so. */
        rangePos:
          isFinite(r.h) && isFinite(r.l) && r.h > r.l ? ((close - r.l) / (r.h - r.l)) * 100 : null,
        gapPct: pc && pc > 0 && isFinite(r.o) ? ((Number(r.o) - pc) / pc) * 100 : null,
        /* Above or below the session VWAP, in the vocabulary computeCnfScore
           expects. */
        vwapStatus: isFinite(r.vw) && Number(r.vw) > 0
          ? (close >= Number(r.vw) ? 'above' : 'below')
          : 'neutral',
        mktCap: null as number | null,
        type: null as string | null,
        sector: null as string | null,
        float: null as number | null,
        daysToCover: null as number | null,
        stage: null as string | null,
        rsRating: null as number | null,
        stochK: null as number | null,
        aboveEma10: null as boolean | null,
        aboveEma21: null as boolean | null,
        distToEma21: null as number | null,
        atrPct: null as number | null,
        pctOffHigh: null as number | null,
        goldenCross: null as boolean | null,
        cnfScore: null as number | null,
        cnfGrade: null as string | null,
        cnfBreakdown: null as Record<string, number> | null,
        cnfCeiling: null as number | null,
        cnfCeilingReason: null as string | null,
        catalyst: null as string | null,
        catalystUrl: null as string | null,
        thesis: null as string | null,
        newsPublisher: null as string | null,
        newsAge: null as string | null,
        newsSentiment: null as string | null,
        newsCausal: null as boolean | null,
      });
    }

    /* The move filter is applied here rather than inside the loop so the meta
       can report both counts — how many cleared the money floor, and how many
       of those actually went somewhere. */
    /* Inclusive: "4% and higher" means a name printing exactly +4.00 belongs
       on the list. It was strictly-greater, which silently dropped the edge. */
    const moved = rows.filter(r => (r.changePct ?? 0) >= MIN_CHANGE_PCT);
    moved.sort((a, b) => b.dvol - a.dvol);

    /* Enriched wider than KEEP because the market-cap gate cannot be applied
       until the per-ticker lookup below has run — the grouped feed carries no
       cap. Cutting to KEEP first and filtering after would return short lists
       whenever caps were missing, so the headroom absorbs the drops. */
    const candidates = moved.slice(0, KEEP + CAP_HEADROOM);

    /* Market cap, the one field the grouped feed cannot supply. Polygon has no
       bulk cap endpoint, so this is per-ticker against the same reference
       endpoint scanner/run already uses — but only for the names that cleared
       the floor and survived the KEEP cut, not the 12,000-name universe.
       Concurrency-limited rather than fired all at once, which would trip rate
       limiting and return a page of nulls.

       A failure here degrades the cap pills, not the list: every row keeps its
       dollar volume either way. */
    /* RS is a whole-market lookup the shared job already computed, so it costs
       one KV read rather than any ranking work here — and crucially it is the
       SAME rating the other tables show. Computing a second one against this
       list's own universe would give the same stock two different RS numbers
       depending on which card you read. */
    const rs = await loadRsRatings();

    /* News for the slice, from the one global Benzinga fetch. */
    const bzIndex = await fetchBenzingaNewsIndex(BENZINGA_KEY);
    let newsResolved = 0;

    const barsFrom = new Date(Date.now() - 400 * 86400e3).toISOString().split('T')[0];

    /* SPY's own change, so CNF's relative-strength term has a benchmark.
       It is in the grouped payload already — no extra call. */
    const spyRow = today.find((x: any) => x?.T === 'SPY');
    const spyPrev = prevClose.get('SPY');
    const spyChangePct = spyRow && spyPrev && spyPrev > 0
      ? ((Number(spyRow.c) - spyPrev) / spyPrev) * 100
      : null;

    let capsResolved = 0;
    let stagesResolved = 0;
    let dtcResolved = 0;
    for (let i = 0; i < candidates.length; i += CAP_CONCURRENCY) {
      const batch = candidates.slice(i, i + CAP_CONCURRENCY);
      const [details, barSets, shortSets] = await Promise.all([
        Promise.all(batch.map(r =>
          safeJson<any>(
            `https://api.polygon.io/v3/reference/tickers/${encodeURIComponent(r.ticker)}?apiKey=${POLYGON_KEY}`,
            null,
            8000
          )
        )),
        /* Stage needs a long lookback the 21-day grouped window cannot supply,
           so it is fetched per ticker — but only for the slice that will be
           displayed, never the 12,000-name universe. */
        Promise.all(batch.map(r =>
          safeJson<{ results?: any[] }>(
            `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(r.ticker)}/range/1/day/${barsFrom}/${targetDate}?adjusted=true&sort=asc&limit=5000&apiKey=${POLYGON_KEY}`,
            { results: [] },
            10000
          )
        )),
        /* Short interest, for DTC. The only genuinely new call this enrichment
           added — everything else on the row is derived from payloads the scan
           was already fetching. Same endpoint scanner/run uses, so the two
           tables report the same days-to-cover for the same stock. */
        Promise.all(batch.map(r =>
          safeJson<{ results?: any[] }>(
            `https://api.polygon.io/stocks/v1/short-interest?ticker=${encodeURIComponent(r.ticker)}&apiKey=${POLYGON_KEY}`,
            { results: [] },
            8000
          )
        )),
      ]);

      batch.forEach((row, j) => {
        const bars = barSets[j]?.results ?? [];
        if (bars.length >= 50) {
          row.stage = computeStage(bars.map((b: any) => ({ h: b.h, l: b.l, c: b.c, v: b.v })));
          if (row.stage) stagesResolved++;
        }
        row.rsRating = rs.get(row.ticker);

        /* The 10/21, STOCH and CNF columns, off the bars already in hand —
           these cost no extra request. Polygon returns ascending. */
        const m = fromAscending(bars as any[], row.price);
        row.stochK = m.stochK;
        row.aboveEma10 = m.aboveEma10;
        row.aboveEma21 = m.aboveEma21;
        row.distToEma21 = m.distToEma21;
        row.atrPct = m.atrPct;
        row.pctOffHigh = m.pctOffHigh;
        row.goldenCross = m.goldenCross;

        const pick = pickBestNews(bzIndex.get(row.ticker) ?? [], row.ticker);
        if (pick) {
          newsResolved++;
          row.catalyst = pick.tag;
          row.catalystUrl = pick.url;
          row.thesis = pick.title;
          row.newsPublisher = pick.publisher;
          row.newsAge = pick.ageLabel;
          row.newsSentiment = pick.sentiment;
          row.newsCausal = pick.causal;
        }
      });

      details.forEach((d, j) => {
        const mc = d?.results?.market_cap;
        if (isFinite(mc) && mc > 0) { batch[j].mktCap = mc; capsResolved++; }
        /* Funds have no market cap by nature, so a blank band on SPY is not a
           failed lookup. Carrying the instrument type lets the card say ETF
           instead of an em dash that reads like missing data. */
        const t = String(d?.results?.type || '').toUpperCase();
        if (t) batch[j].type = t;

        /* Sector, from the same payload the cap came from — the SIC text, run
           through the shared cleaner so DVol names a sector the way every
           other table names it. */
        const sic = d?.results?.sic_description;
        if (sic) {
          batch[j].sector = cleanSectorDescription(
            String(sic), d?.results?.sector, d?.results?.industry,
          );
        }

        /* Float. Shares outstanding for the class is the closest figure
           Polygon's reference gives; cap/price is the fallback scanner/run
           uses when it is absent, and it is an approximation either way. */
        const shares = d?.results?.share_class_shares_outstanding;
        const cap = batch[j].mktCap;
        batch[j].float = isFinite(shares) && shares > 0
          ? shares
          : (cap && batch[j].price > 0 ? cap / batch[j].price : null);
      });

      /* DTC, and then CNF — which needs the whole row, so it runs last. */
      shortSets.forEach((s, j) => {
        const row = batch[j];
        const si = s?.results?.[0]?.short_interest;
        if (isFinite(si) && si > 0 && row.avgVol && row.avgVol > 0) {
          row.daysToCover = parseFloat((si / row.avgVol).toFixed(1));
          dtcResolved++;
        }
      });

      batch.forEach(row => {
        /* CONFLUENCE, on the shared scorer — the same function the daily scan
           grades with, so a stock appearing on both boards cannot carry two
           different CNF values.

           The market-context inputs are defaulted NEUTRAL rather than guessed:
           this scan has no scan-streak history, no dot detection, no trade
           plan and no sector-heat model, and inventing values for them would
           tilt every DVol score against the scanner's. A DVol CNF is therefore
           a slightly conservative read of the same scale, not a second scale. */
        const cnf = computeCnfScore(
          row.rvol,
          row.gapPct,
          /* Range expansion: today's range against the 20-day average range,
             which `adrPct` already holds. */
          row.adrPct && row.adrPct > 0 && row.high != null && row.low != null && row.price > 0
            ? ((row.high - row.low) / row.price * 100) / row.adrPct
            : null,
          row.changePct != null && spyChangePct != null ? row.changePct - spyChangePct : null,
          {
            catalystTier: row.newsSentiment === 'negative' ? 'negative'
              : row.catalyst && row.catalyst !== 'News' ? 'strong'
              : row.catalyst ? 'headline'
              : 'none',
            hasEarnings: /earning/i.test(row.catalyst || ''),
            scanStreak: 1,
            rme: null,
            vwapStatus: row.vwapStatus,
            tradeType: 'DAY',
            setupName: null,
            breadthSignal: '',
            spyAbove21: null,
            inHotSector: false,
            stageNum: row.stage ? parseInt(String(row.stage), 10) || null : null,
            goldenCross: row.goldenCross,
            pctOffHigh: row.pctOffHigh,
            dotKind: null,
            dotBarsSince: null,
            isBearInstrument: false,
            aboveEma10: row.aboveEma10,
            planTradeable: false,
            planResistanceR: null,
            planClear: false,
            planCollapsed: false,
            distToEma21: row.distToEma21,
            atrPct: row.atrPct,
          }
        );
        row.cnfScore = cnf.score;
        row.cnfGrade = cnf.grade;
        row.cnfBreakdown = cnf.breakdown;
        row.cnfCeiling = cnf.ceiling;
        row.cnfCeilingReason = cnf.ceilingReason;
      });
    }

    /* The cap gate, applied now that the lookups have landed.

       AN UNKNOWN CAP IS NOT A FAILING CAP. Funds carry no market cap by
       nature, so testing `mktCap >= MIN` directly would delete every ETF from
       a dollar-volume board — SPY and the leveraged trackers are among the
       largest prints on most days, and they are the point of the card as much
       as any single name. A cap is only enforced when Polygon returned one,
       which is the same treatment the ADR and RVOL gates used to give an
       unmeasurable value. */
    const capped = candidates.filter(r => r.mktCap == null || r.mktCap >= MIN_MKT_CAP);
    const kept = capped.slice(0, KEEP);
    const droppedOnCap = candidates.length - capped.length;

    const meta = {
      targetDate,
      universeSize,
      clearedFloor: rows.length,
      moved: moved.length,
      droppedOnCap,
      minChangePct: MIN_CHANGE_PCT,
      minVol: MIN_VOL,
      minMktCap: MIN_MKT_CAP,
      minPrice: MIN_PRICE,
      rsAvailable: rs.available,
      rsReason: rs.reason,
      newsResolved,
      kept: kept.length,
      capsResolved,
      stagesResolved,
      dtcResolved,
      historyDays: priorDates.length,
      floor: DVOL_FLOOR,
    };

    await Promise.all([
      kv.set(KV_ROWS, kept),
      kv.set(KV_TIME, Date.now()),
      kv.set(KV_META, meta),
    ]);

    return NextResponse.json({ success: true, forced: force, ...meta });
  } catch (error: any) {
    console.error('DVOL_RUN_ERROR:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const background = new URL(request.url).searchParams.get('bg') === 'true';
  if (!background || isDetachedRun(request)) return runScan(request);

  const result = await runInBackground(request, 'dvol', () => runScan(request));
  return NextResponse.json({ success: true, ...result }, { headers: BG_HEADERS });
}

export async function POST(request: Request) {
  return GET(request);
}

// app/api/rs/run/route.ts — v1.0
//
// RS RATING — one market-wide percentile ranking, computed once and read by
// every scan on the dashboard.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS AS ITS OWN JOB
//
// Before this, "RS" meant two different things on the same dashboard. The
// VCP table showed a PERCENTILE — 88 meaning stronger than 88% of the liquid
// market. Every other table showed `rsVsSpy`, a SPREAD — +18 meaning eighteen
// percentage points of three-month outperformance. Same three-letter header,
// different claims, no way to tell from the column which one you were reading.
//
// The percentile is the better measure, and the reason is exactly the case
// where you would want to know: +18 versus SPY might be 60th percentile in a
// strong tape and 95th in a weak one. The spread cannot distinguish those.
// Minervini's threshold of 70, and his preference for 80-90+, are percentile
// statements and are meaningless applied to a spread.
//
// But a percentile needs a RANKING UNIVERSE, and the four scan routes have
// wildly different amounts of market-wide data in hand — the scanner already
// pulls ~252 grouped days for ATHI/ATLO, ep9m pulls 60, and the swing and
// consolidation routes pull none at all. Computing the rating inside each
// would mean four implementations, four ranking populations, and four
// different answers for the same stock on the same day.
//
// So it is computed once, here, and written to KV as a plain symbol → rating
// map. Every consumer looks up. They cannot disagree.
//
// ---------------------------------------------------------------------------
// THE FORMULA
//
// IBD's published rating is proprietary. This is the standard public
// approximation, weighting the most recent quarter double:
//
//     raw = 2·(P0/P63) + (P0/P126) + (P0/P189) + (P0/P252)
//
// then percentile-ranked 1-99 against every stock that clears the liquidity
// floor. The raw number is meaningless on its own — the ranking is the
// rating.
//
// ---------------------------------------------------------------------------
// AS-OF-CLOSE, DELIBERATELY.
//
// The anchors are closing prices, including P0. A stock up 8% intraday does
// NOT move its rating until the next run, and that is correct rather than a
// limitation: IBD's works the same way. A rating that jumped around
// intraday would rank today's noise against a year of settled history and
// produce a number that means nothing in either timeframe.
//
// It will look wrong the first time you notice it. It is not.
//
// ---------------------------------------------------------------------------
// COST: about fifteen grouped-aggregate calls. Each returns every US stock's
// bar for one date, so five anchor dates (with retries for holidays) covers
// the whole market. The alternative — per-ticker history for ~9,000 names —
// is three orders of magnitude more requests for the same five numbers each.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { rawRsScore, percentileRank } from '@/lib/indicators/vcp';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 120;

const POLYGON_KEY = process.env.POLYGON_API_KEY || '';
const BASE = 'https://api.polygon.io';

export const RS_KEY = 'rs_ratings_v1';

/* Trading days back for each leg. P0 is the most recent close.

   These are the IBD quarters. 63 trading days is a quarter, 252 a year. */
const RS_LEGS = [0, 63, 126, 189, 252];

/* Trading days to calendar days. 252 trading days is a year, so ~1.45.
   Used only to guess where to start looking; each anchor then walks back a
   day at a time until a date returns data, which resolves holidays and
   weekends without needing a market calendar. */
const TRADING_TO_CALENDAR = 1.45;
const ANCHOR_MAX_ATTEMPTS = 8;

/* Liquidity floor for the RANKING POPULATION. This matters more than it
   looks: the floor defines what "stronger than 88% of the market" means.

   Too low and the population fills with illiquid names whose prices barely
   move, which inflates every real stock's percentile — a genuinely mediocre
   performer ranks 80th simply for being tradeable. Too high and the
   population becomes large caps only, and a strong small cap gets ranked
   against a peer group it does not belong to.

   $5 and 100k shares is deliberately looser than any individual scan's
   floor. The ranking population should be "the investable market", not
   "stocks this particular scan would surface" — ranking candidates against
   the criteria that selected them produces a number carrying no
   information. */
const RANK_MIN_PRICE = 5;
const RANK_MIN_VOLUME = 100_000;

// Funds and leveraged products. They rank fine mechanically but they are not
// companies being accumulated, and leaving them in shifts the percentile of
// every real stock for no benefit.
const EXCLUDED = new Set([
  'SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'VTI', 'EEM', 'EFA', 'XLF', 'XLE', 'XLK',
  'XLI', 'XLV', 'XLU', 'XLP', 'XLY', 'XLB', 'XLRE', 'XLC', 'SMH', 'SOXX',
  'TQQQ', 'SQQQ', 'QLD', 'QID', 'SOXL', 'SOXS', 'TECL', 'TECS', 'SPXL', 'SPXS',
  'SPXU', 'UPRO', 'SDS', 'SSO', 'TNA', 'TZA', 'FAS', 'FAZ', 'LABU', 'LABD',
  'UVXY', 'UVIX', 'SVIX', 'VIXY', 'VXX', 'FNGU', 'FNGD', 'GLD', 'SLV', 'GDX',
  'GDXJ', 'USO', 'UNG', 'TLT', 'HYG', 'LQD', 'ARKK', 'IBIT', 'BITO', 'BITX',
  'NUGT', 'DUST', 'JNUG', 'ERX', 'ERY', 'BOIL', 'KOLD', 'NAIL', 'URAA',
  'MSTX', 'MSTU', 'CONL', 'NVDL', 'TSLL', 'AAPU', 'MSFU', 'AMZU', 'GGLL',
  'AGG', 'BND', 'SHY', 'IEF', 'VXUS', 'VEA', 'VWO', 'SCHD', 'JEPI', 'JEPQ',
]);

const ymd = (d: Date): string => d.toISOString().slice(0, 10);
const dateDaysAgo = (n: number): Date => new Date(Date.now() - n * 86400000);

async function polygonSafe<T>(path: string, fallback: T): Promise<T> {
  try {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${BASE}${path}${sep}apiKey=${POLYGON_KEY}`, { cache: 'no-store' });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

interface AnchorDay {
  tradingBack: number;
  date: string;
  closes: Map<string, number>;
  volumes: Map<string, number>;
}

/* One grouped call per anchor, walking back until a date returns data.

   Attempts run SEQUENTIALLY rather than firing all candidate dates at once.
   Firing in parallel would be faster but would burn a call on every holiday
   candidate whether or not the first attempt already succeeded — and the
   first attempt succeeds most of the time, because most target dates are
   ordinary weekdays. */
async function fetchAnchor(tradingBack: number): Promise<AnchorDay | null> {
  const startCalendar = tradingBack === 0
    ? 1
    : Math.round(tradingBack * TRADING_TO_CALENDAR);

  for (let attempt = 0; attempt < ANCHOR_MAX_ATTEMPTS; attempt++) {
    const dt = dateDaysAgo(startCalendar + attempt);
    const day = dt.getUTCDay();
    if (day === 0 || day === 6) continue;

    const date = ymd(dt);
    const data = await polygonSafe<{ results?: any[] }>(
      `/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true`,
      { results: [] }
    );
    const results = data.results ?? [];
    if (results.length === 0) continue;

    const closes = new Map<string, number>();
    const volumes = new Map<string, number>();
    for (const bar of results) {
      const sym = bar.T;
      if (!sym || EXCLUDED.has(sym)) continue;
      if (!/^[A-Z]{1,5}$/.test(sym)) continue;
      if (typeof bar.c === 'number' && bar.c > 0) closes.set(sym, bar.c);
      if (typeof bar.v === 'number') volumes.set(sym, bar.v);
    }

    return { tradingBack, date, closes, volumes };
  }

  return null;
}

export async function GET(request: Request) {
  const started = Date.now();

  if (!POLYGON_KEY) {
    return NextResponse.json({ success: false, error: 'Missing Polygon API Key' }, { status: 500 });
  }

  try {
    const anchors = await Promise.all(RS_LEGS.map(fetchAnchor));
    const byLeg = new Map<number, AnchorDay>();
    for (const a of anchors) {
      if (a) byLeg.set(a.tradingBack, a);
    }

    const p0 = byLeg.get(0);
    const p63 = byLeg.get(63);

    /* P0 and P63 are both REQUIRED. Without the current close there is
       nothing to rate; without the quarter there is no recent leg, and the
       recent leg carries double weight in the formula. A rating built from
       the 126/189/252 legs alone would rank stocks on where they were six
       months ago, which is the opposite of what relative strength measures. */
    if (!p0 || !p63) {
      return NextResponse.json({
        success: false,
        error: `Missing a required anchor — P0 ${p0 ? 'ok' : 'MISSING'}, P63 ${p63 ? 'ok' : 'MISSING'}`,
      }, { status: 502 });
    }

    // --- Ranking population ---
    const raws = new Map<string, number>();
    let belowPrice = 0;
    let belowVolume = 0;
    let noQuarter = 0;

    p0.closes.forEach((close, sym) => {
      if (close < RANK_MIN_PRICE) { belowPrice++; return; }

      const vol = p0.volumes.get(sym) ?? 0;
      if (vol < RANK_MIN_VOLUME) { belowVolume++; return; }

      const prior63 = p63.closes.get(sym);
      if (!prior63 || prior63 <= 0) { noQuarter++; return; }

      const raw = rawRsScore({
        p0: close,
        p63: prior63,
        p126: byLeg.get(126)?.closes.get(sym) ?? null,
        p189: byLeg.get(189)?.closes.get(sym) ?? null,
        p252: byLeg.get(252)?.closes.get(sym) ?? null,
      });

      if (raw != null && Number.isFinite(raw)) raws.set(sym, raw);
    });

    if (raws.size < 500) {
      return NextResponse.json({
        success: false,
        error: `Ranking population too small (${raws.size}) — refusing to publish ratings that would be meaningless`,
      }, { status: 502 });
    }

    // --- Percentile rank ---
    const sorted = Array.from(raws.values()).sort((a, b) => a - b);
    const ratings: Record<string, number> = {};
    raws.forEach((raw, sym) => {
      ratings[sym] = percentileRank(raw, sorted);
    });

    /* Stored as a plain object rather than a Map so it survives KV's JSON
       round-trip unchanged. At ~5,000 symbols this is a few hundred KB —
       well inside KV's value limit, and consumers do a single get. */
    const payload = {
      asOf: p0.date,
      generatedAt: new Date().toISOString(),
      ranked: raws.size,
      legDates: {
        p0: p0.date,
        p63: p63.date,
        p126: byLeg.get(126)?.date ?? null,
        p189: byLeg.get(189)?.date ?? null,
        p252: byLeg.get(252)?.date ?? null,
      },
      ratings,
      sortedRaws: sorted,
    };

    await kv.set(RS_KEY, payload);

    // Distribution check. A healthy percentile map is close to uniform by
    // construction — if these buckets are lopsided, the ranking is broken
    // rather than the market being unusual.
    const vals = Object.values(ratings);
    const bucket = (lo: number, hi: number) => vals.filter(v => v >= lo && v <= hi).length;

    return NextResponse.json({
      success: true,
      asOf: p0.date,
      elapsedMs: Date.now() - started,
      ranked: raws.size,
      legDates: payload.legDates,
      rejected: {
        belowPrice,
        belowVolume,
        noQuarter,
      },
      distribution: {
        '1-20': bucket(1, 20),
        '21-40': bucket(21, 40),
        '41-60': bucket(41, 60),
        '61-80': bucket(61, 80),
        '81-99': bucket(81, 99),
      },
      sample: {
        above90: vals.filter(v => v >= 90).length,
        above80: vals.filter(v => v >= 80).length,
        above70: vals.filter(v => v >= 70).length,
      },
    });
  } catch (error: any) {
    console.error('RS_RUN_ERROR:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
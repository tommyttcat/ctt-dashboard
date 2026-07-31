import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { choppiness, CHOP_PERIOD_DEFAULT } from '@/lib/indicators/chop';

/* CHOP regime route — v1.1
   ------------------------------------------------------------------
   Serves the Choppiness Index for the two benchmarks the dashboard
   already reasons about, on TWO timeframes.

       CHOP = 100 × log10( Σ TR(n) / (maxHigh(n) − minLow(n)) ) / log10(n)

   The ratio is distance travelled over ground covered. A tape that
   moves 8% in total to end 8% higher has a low ratio and a low score:
   it trended. A tape that moves 8% in total and ends flat has a high
   ratio and a high score: it churned.

   v1.1: + INTRADAY (14 × 15-minute bars ≈ 3.5 hours).

   WHY A SECOND TIMEFRAME AND NOT AN EMA. The strip's claim is that
   chop is DIRECTIONALLY AGNOSTIC — it says whether a range resolves,
   not which way. Adding a direction measure to that track would put
   two incompatible readings on one axis. A second CHOP reading is
   the same measurement at a different resolution, so both markers
   share units and the DISTANCE BETWEEN THEM is itself meaningful:

       daily choppy + intraday trending   range starting to break
       daily trending + intraday choppy   trend intact, today digests
       both choppy                        stand down
       both trending                      press it

   The second row is the one that matters. A 14-day window cannot see
   a session that has just started going somewhere; by the time the
   daily reading moves, the break is three days old. First live daily
   reading shifted 0.25 points day-over-day — that is the velocity
   problem the intraday leg solves.

   FOURTEEN 15-MINUTE BARS IS DELIBERATE. It matches the daily period
   so the two numbers are computed identically and can share a scale.
   At 3.5 hours it also covers roughly half a session, which means it
   turns over meaningfully within a day without being pure noise.
   ------------------------------------------------------------------ */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CHOP_PERIOD = CHOP_PERIOD_DEFAULT;
const CACHE_KEY = 'chop_regime_v2';

/* SPLIT CACHE TTLs. The daily leg is a daily-bar metric — recomputing it
   every five minutes would burn Polygon calls to return the same number.
   The intraday leg is the entire point of v1.1 and is worthless stale, so
   it gets a short one. One KV key, two timestamps; the handler recomputes
   only the leg that has expired. */
const CACHE_TTL_DAILY = 900;
const CACHE_TTL_INTRADAY = 240;

// Calendar days back for the daily leg. 14 trading bars plus one for the
// first true range, plus one more for the shifted previous window, plus
// holiday slack.
const LOOKBACK_DAYS = 40;

/* Calendar days back for 15-minute bars. Three is enough for 14 bars even
   across a weekend, and keeps the response small — a full week of 15m
   aggregates on two symbols is several hundred rows for no benefit. */
const LOOKBACK_INTRADAY_DAYS = 3;

// QQQ carries more weight than SPY because the setups this dashboard
// surfaces are momentum and growth names — they track the Nasdaq's
// regime far more closely. SPY catches the case where QQQ alone is
// distorted by two or three mega-caps.
const WEIGHT_QQQ = 0.6;
const WEIGHT_SPY = 0.4;

interface Bar {
  h: number;
  l: number;
  c: number;
  t: number;
}

const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function fetchBars(
  symbol: string,
  apiKey: string,
  opts: { multiplier: number; timespan: 'day' | 'minute'; lookbackDays: number; limit: number }
): Promise<Bar[]> {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - opts.lookbackDays);

  const url =
    `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/${opts.multiplier}/${opts.timespan}/${ymd(from)}/${ymd(to)}` +
    `?adjusted=true&sort=asc&limit=${opts.limit}&apiKey=${apiKey}`;

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Polygon ${symbol} ${opts.multiplier}${opts.timespan} returned ${res.status}`);

  const data = await res.json();
  if (!data || !Array.isArray(data.results)) return [];

  return data.results
    .filter((b: any) => b && typeof b.h === 'number' && typeof b.l === 'number' && typeof b.c === 'number')
    .map((b: any) => ({ h: b.h, l: b.l, c: b.c, t: b.t }));
}

const fetchDailyBars = (symbol: string, apiKey: string) =>
  fetchBars(symbol, apiKey, { multiplier: 1, timespan: 'day', lookbackDays: LOOKBACK_DAYS, limit: 120 });

/* 15-minute bars. Polygon returns extended-hours bars on this endpoint and
   they are NOT filtered out here, deliberately: a pre-market range that
   price then respects all session is part of the structure, and dropping it
   would make the first two hours of the reading depend on bars that no
   longer exist by mid-morning. The cost is that a thin overnight session can
   inflate the range term; the alternative — a reading whose window silently
   changes shape at 09:30 — is worse. */
const fetchIntradayBars = (symbol: string, apiKey: string) =>
  fetchBars(symbol, apiKey, { multiplier: 15, timespan: 'minute', lookbackDays: LOOKBACK_INTRADAY_DAYS, limit: 400 });

const zoneOf = (v: number): 'trend' | 'mixed' | 'chop' =>
  v <= 38.2 ? 'trend' : v >= 61.8 ? 'chop' : 'mixed';

// Weighted blend that degrades to whichever benchmark is available rather
// than dropping to null when one feed is short.
const blend = (a: number | null, b: number | null): number | null => {
  if (a != null && b != null) return a * WEIGHT_QQQ + b * WEIGHT_SPY;
  return a ?? b ?? null;
};

interface DailyLeg {
  qqq: number | null;
  qqqPrev: number | null;
  spy: number | null;
  spyPrev: number | null;
  blended: number | null;
  blendedPrev: number | null;
  barsUsed: { qqq: number; spy: number };
  computedAt: string;
}

interface IntradayLeg {
  qqq: number | null;
  spy: number | null;
  blended: number | null;
  barsUsed: { qqq: number; spy: number };
  lastBarAt: string | null;
  computedAt: string;
}

async function computeDailyLeg(apiKey: string): Promise<DailyLeg> {
  const [qqqBars, spyBars] = await Promise.all([
    fetchDailyBars('QQQ', apiKey).catch(() => [] as Bar[]),
    fetchDailyBars('SPY', apiKey).catch(() => [] as Bar[]),
  ]);

  // The previous reading uses the same window shifted back one bar, so
  // `prev` is genuinely yesterday's CHOP rather than a stale copy of today's.
  const qqq = choppiness(qqqBars, CHOP_PERIOD);
  const qqqPrev = choppiness(qqqBars.slice(0, -1), CHOP_PERIOD);
  const spy = choppiness(spyBars, CHOP_PERIOD);
  const spyPrev = choppiness(spyBars.slice(0, -1), CHOP_PERIOD);

  return {
    qqq,
    qqqPrev,
    spy,
    spyPrev,
    blended: blend(qqq, spy),
    blendedPrev: blend(qqqPrev, spyPrev),
    barsUsed: { qqq: qqqBars.length, spy: spyBars.length },
    computedAt: new Date().toISOString(),
  };
}

async function computeIntradayLeg(apiKey: string): Promise<IntradayLeg> {
  const [qqqBars, spyBars] = await Promise.all([
    fetchIntradayBars('QQQ', apiKey).catch(() => [] as Bar[]),
    fetchIntradayBars('SPY', apiKey).catch(() => [] as Bar[]),
  ]);

  const qqq = choppiness(qqqBars, CHOP_PERIOD);
  const spy = choppiness(spyBars, CHOP_PERIOD);

  /* The timestamp of the newest bar, not the time this ran. On a weekend or
     after hours those differ by days, and the component needs to know the
     reading describes Friday afternoon rather than right now — otherwise a
     stale intraday marker sitting next to a current daily one implies a
     divergence that is really just the clock. */
  const newest = Math.max(
    qqqBars.length ? qqqBars[qqqBars.length - 1].t : 0,
    spyBars.length ? spyBars[spyBars.length - 1].t : 0
  );

  return {
    qqq,
    spy,
    blended: blend(qqq, spy),
    barsUsed: { qqq: qqqBars.length, spy: spyBars.length },
    lastBarAt: newest > 0 ? new Date(newest).toISOString() : null,
    computedAt: new Date().toISOString(),
  };
}

const ageSeconds = (iso: string | null | undefined): number => {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 1000;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const refresh = searchParams.get('refresh') === 'true';

  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: 'POLYGON_API_KEY is not configured' },
      { status: 500 }
    );
  }

  let cached: any = null;
  if (!refresh) {
    try {
      cached = await kv.get(CACHE_KEY);
    } catch {
      // KV unavailable is not fatal — fall through and compute both legs.
    }
  }

  try {
    /* Each leg is refreshed on its own clock. On a typical poll only the
       intraday leg has expired, so this costs two Polygon calls rather than
       four — the daily numbers are reused from cache. */
    const dailyStale = refresh || ageSeconds(cached?.daily?.computedAt) > CACHE_TTL_DAILY;
    const intradayStale = refresh || ageSeconds(cached?.intraday?.computedAt) > CACHE_TTL_INTRADAY;

    const [daily, intraday] = await Promise.all([
      dailyStale ? computeDailyLeg(apiKey) : Promise.resolve(cached.daily as DailyLeg),
      intradayStale ? computeIntradayLeg(apiKey) : Promise.resolve(cached.intraday as IntradayLeg),
    ]);

    if (daily.blended == null && intraday.blended == null) {
      return NextResponse.json(
        { success: false, error: 'Insufficient bar data on either timeframe' },
        { status: 502 }
      );
    }

    const payload = {
      success: true,
      period: CHOP_PERIOD,

      /* FLAT DAILY FIELDS ARE THE v1.0 SHAPE, KEPT DELIBERATELY. Scorecard
         reads `blended` / `blendedPrev` / `qqq` / `spy` directly, and the
         per-ticker scanners are unaffected either way. Emitting both shapes
         means the component can adopt the intraday leg on its own schedule
         instead of the two having to deploy together. */
      qqq: daily.qqq,
      qqqPrev: daily.qqqPrev,
      spy: daily.spy,
      spyPrev: daily.spyPrev,
      blended: daily.blended,
      blendedPrev: daily.blendedPrev,
      zone: daily.blended != null ? zoneOf(daily.blended) : 'unknown',
      barsUsed: daily.barsUsed,

      daily,
      intraday: {
        ...intraday,
        zone: intraday.blended != null ? zoneOf(intraday.blended) : 'unknown',
        /* 14 bars × 15 minutes. Stated on the wire so the component does not
           have to hardcode it in a tooltip and drift if the period changes. */
        windowMinutes: CHOP_PERIOD * 15,
      },

      /* The gap, computed once here rather than in every consumer.
         POSITIVE MEANS INTRADAY IS CLEANER than the daily backdrop — the
         session is trending inside a range that has not been. That is the
         reading worth acting on, and the sign convention is chosen so the
         interesting direction is the positive one. */
      spread:
        daily.blended != null && intraday.blended != null
          ? +(daily.blended - intraday.blended).toFixed(1)
          : null,

      updatedAt: new Date().toISOString(),
      cached: !dailyStale && !intradayStale,
      legsRecomputed: {
        daily: dailyStale,
        intraday: intradayStale,
      },
    };

    try {
      // TTL is the longer of the two so the daily leg survives to be reused;
      // per-leg staleness is decided by computedAt above, not by expiry.
      await kv.set(CACHE_KEY, payload, { ex: CACHE_TTL_DAILY });
    } catch {
      // Cache write failure just means the next request recomputes.
    }

    return NextResponse.json(payload);
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'CHOP computation failed' },
      { status: 500 }
    );
  }
}
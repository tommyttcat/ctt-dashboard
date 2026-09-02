import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';
import { choppiness, CHOP_PERIOD_DEFAULT } from '@/lib/indicators/chop';

/* CHOP regime route — v1.2
   ------------------------------------------------------------------
       CHOP = 100 × log10( Σ TR(n) / (maxHigh(n) − minLow(n)) ) / log10(n)

   Distance travelled over ground covered. A tape that moves 8% in
   total to end 8% higher has a low ratio and a low score: it trended.
   One that moves 8% and ends flat has a high ratio and a high score:
   it churned.

   v1.1: + INTRADAY leg (14 × 15-minute bars ≈ 3.5 hours).
   v1.2: closed bars only; TTL matched to the bar period; feed delay
         stated on the wire.

   WHY A SECOND TIMEFRAME AND NOT AN EMA. The strip's claim is that
   chop is DIRECTIONALLY AGNOSTIC — it says whether a range resolves,
   not which way. Adding a direction measure to that track would put
   two incompatible readings on one axis. A second CHOP reading is the
   same measurement at a different resolution, so both markers share
   units and the DISTANCE BETWEEN THEM is itself meaningful:

       daily choppy + intraday trending   range starting to break
       daily trending + intraday choppy   trend intact, today digests
       both choppy                        stand down
       both trending                      press it

   The second row is the point. A 14-day window cannot see a session
   that has just started going somewhere; by the time the daily reading
   moves, the break is days old. The first live daily reading shifted
   0.25 points day-over-day — that is the velocity problem this solves.

   ------------------------------------------------------------------
   THE FEED IS 15-MINUTE DELAYED, and on a 15-minute bar series that
   is almost exactly one bar period. Three things follow.

   1. THE NEWEST VISIBLE BAR IS ALREADY CLOSED, most of the time. The
      partial-bar problem that would normally plague an intraday
      indicator is mostly solved by the delay itself.

   2. IT IS ONLY MOSTLY SOLVED, so the last bar is dropped anyway.
      The delay boundary is approximate and a forming bar can slip
      through near the edge; a partial bar's high and low keep widening
      until it closes, which makes the range term twitch for reasons
      that are not structure. Fetching PERIOD+2 and discarding the
      newest costs one extra bar and removes the failure mode
      entirely. See dropForming().

   3. POLLING FASTER THAN THE BAR PERIOD GAINS NOTHING. New data
      arrives once per 15 minutes. The plan allows unlimited calls so
      the extra requests are free, but they return an identical
      reading — and a number that refreshes without changing invites
      the belief that it was checked and confirmed. TTL is the bar
      period for that reason, not for cost.

   The honest description of the intraday marker is "the last ~3.5
   hours, as of roughly 15 minutes ago". Still vastly more current
   than a 14-day window, and the divergence read works regardless:
   a range starting to break shows up here hours before the daily
   reading notices, delay included.
   ------------------------------------------------------------------ */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CHOP_PERIOD = CHOP_PERIOD_DEFAULT;
const CACHE_KEY = 'chop_regime_v2';

const INTRADAY_BAR_MINUTES = 15;
const HOURLY_BAR_MINUTES = 60;

/* Feed delay, in minutes. Declared rather than inferred because the
   component needs it to label the marker, and because if the plan ever
   changes to realtime this is the one line that has to move. */
const FEED_DELAY_MINUTES = 15;

/* Daily leg: a daily-bar metric, so this is generous. Intraday leg: one bar
   period — never more than a single bar behind what the feed can offer, and
   no refresh that returns the same number twice. */
const CACHE_TTL_DAILY = 900;
const CACHE_TTL_INTRADAY = INTRADAY_BAR_MINUTES * 60;
const CACHE_TTL_HOURLY = HOURLY_BAR_MINUTES * 60;

// Calendar days back for the daily leg. 14 trading bars plus one for the
// first true range, plus one more for the shifted previous window, plus
// holiday slack.
const LOOKBACK_DAYS = 40;

// Three days covers 14 fifteen-minute bars even across a weekend.
const LOOKBACK_INTRADAY_DAYS = 3;

// 14 sixty-minute bars = ~2 trading days. 10 calendar days handles weekends.
const LOOKBACK_HOURLY_DAYS = 10;

// QQQ carries more weight than SPY because the setups this dashboard
// surfaces are momentum and growth names — they track the Nasdaq's regime
// far more closely. SPY catches the case where QQQ alone is distorted by
// two or three mega-caps.
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
  opts: { multiplier: number; timespan: 'day' | 'minute'; lookbackDays: number; limit: number; paginate?: boolean }
): Promise<Bar[]> {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - opts.lookbackDays);

  const firstUrl =
    `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/${opts.multiplier}/${opts.timespan}/${ymd(from)}/${ymd(to)}` +
    `?adjusted=true&sort=asc&limit=${opts.limit}&apiKey=${apiKey}`;

  const all: Bar[] = [];
  const maxPages = opts.paginate ? 5 : 1;
  let nextUrl: string | null = firstUrl;

  for (let page = 0; page < maxPages && nextUrl; page++) {
    const res = await fetch(nextUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Polygon ${symbol} ${opts.multiplier}${opts.timespan} returned ${res.status}`);

    const data: any = await res.json();
    if (data && Array.isArray(data.results)) {
      for (const b of data.results) {
        if (b && typeof b.h === 'number' && typeof b.l === 'number' && typeof b.c === 'number') {
          all.push({ h: b.h, l: b.l, c: b.c, t: b.t });
        }
      }
    }

    nextUrl = opts.paginate && data?.next_url
      ? `${data.next_url}&apiKey=${apiKey}`
      : null;
  }

  return all;
}

const fetchDailyBars = (symbol: string, apiKey: string) =>
  fetchBars(symbol, apiKey, { multiplier: 1, timespan: 'day', lookbackDays: LOOKBACK_DAYS, limit: 120 });

/* 15-minute bars. Extended-hours bars are NOT filtered out, deliberately: a
   pre-market range that price then respects all session is part of the
   structure, and dropping it would make the first two hours of the reading
   depend on bars that no longer exist by mid-morning. The cost is that a thin
   overnight session can inflate the range term; the alternative — a window
   that silently changes shape at 09:30 — is worse. */
const fetchIntradayBars = (symbol: string, apiKey: string) =>
  fetchBars(symbol, apiKey, { multiplier: 15, timespan: 'minute', lookbackDays: LOOKBACK_INTRADAY_DAYS, limit: 400 });

async function fetchHourlyBars(symbol: string, apiKey: string): Promise<Bar[]> {
  const raw = await fetchBars(symbol, apiKey, {
    multiplier: 15,
    timespan: 'minute',
    lookbackDays: LOOKBACK_HOURLY_DAYS,
    limit: 500,
    paginate: true,
  });
  const byHour = new Map<number, Bar[]>();
  for (const b of raw) {
    const hourKey = Math.floor(b.t / 3_600_000) * 3_600_000;
    let bucket = byHour.get(hourKey);
    if (!bucket) { bucket = []; byHour.set(hourKey, bucket); }
    bucket.push(b);
  }
  return Array.from(byHour.entries())
    .sort(([a], [b]) => a - b)
    .map(([t, bars]) => ({
      t,
      h: Math.max(...bars.map(b => b.h)),
      l: Math.min(...bars.map(b => b.l)),
      c: bars[bars.length - 1].c,
    }));
}

/* Drop the newest bar if its period has not elapsed.

   Polygon stamps a bar with its OPENING time, so the 10:30 bar covers
   10:30-10:45 and is complete only once 10:45 has passed. With a 15-minute
   delayed feed the newest visible bar is usually closed already — but "usually"
   is not a guarantee near the delay boundary, and a partial bar's high and low
   keep widening, which moves the range term without any change in structure.

   Cheap to be certain: fetch two spare bars, drop one when in doubt. */
function dropForming(bars: Bar[], barMinutes: number): Bar[] {
  if (bars.length === 0) return bars;
  const last = bars[bars.length - 1];
  const closesAt = last.t + barMinutes * 60 * 1000;
  return Date.now() < closesAt ? bars.slice(0, -1) : bars;
}

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
  droppedForming: boolean;
  lastBarAt: string | null;
  computedAt: string;
}

async function computeDailyLeg(apiKey: string): Promise<DailyLeg> {
  const [qqqBars, spyBars] = await Promise.all([
    fetchDailyBars('QQQ', apiKey).catch(() => [] as Bar[]),
    fetchDailyBars('SPY', apiKey).catch(() => [] as Bar[]),
  ]);

  // The previous reading uses the same window shifted back one bar, so `prev`
  // is genuinely yesterday's CHOP rather than a stale copy of today's.
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
  const [rawQqq, rawSpy] = await Promise.all([
    fetchIntradayBars('QQQ', apiKey).catch(() => [] as Bar[]),
    fetchIntradayBars('SPY', apiKey).catch(() => [] as Bar[]),
  ]);

  const qqqBars = dropForming(rawQqq, INTRADAY_BAR_MINUTES);
  const spyBars = dropForming(rawSpy, INTRADAY_BAR_MINUTES);
  const droppedForming = qqqBars.length < rawQqq.length || spyBars.length < rawSpy.length;

  const qqq = choppiness(qqqBars, CHOP_PERIOD);
  const spy = choppiness(spyBars, CHOP_PERIOD);

  /* Timestamp of the newest CLOSED bar, not the time this ran. On a weekend
     or after hours those differ by days, and the component needs to know the
     reading describes Friday afternoon rather than right now — otherwise a
     stale intraday marker beside a current daily one implies a divergence
     that is really just the clock. */
  const newest = Math.max(
    qqqBars.length ? qqqBars[qqqBars.length - 1].t : 0,
    spyBars.length ? spyBars[spyBars.length - 1].t : 0
  );

  return {
    qqq,
    spy,
    blended: blend(qqq, spy),
    barsUsed: { qqq: qqqBars.length, spy: spyBars.length },
    droppedForming,
    lastBarAt: newest > 0 ? new Date(newest).toISOString() : null,
    computedAt: new Date().toISOString(),
  };
}

async function computeHourlyLeg(apiKey: string): Promise<IntradayLeg> {
  const [rawQqq, rawSpy] = await Promise.all([
    fetchHourlyBars('QQQ', apiKey).catch(() => [] as Bar[]),
    fetchHourlyBars('SPY', apiKey).catch(() => [] as Bar[]),
  ]);

  const qqqBars = dropForming(rawQqq, HOURLY_BAR_MINUTES);
  const spyBars = dropForming(rawSpy, HOURLY_BAR_MINUTES);
  const droppedForming = qqqBars.length < rawQqq.length || spyBars.length < rawSpy.length;

  const qqq = choppiness(qqqBars, CHOP_PERIOD);
  const spy = choppiness(spyBars, CHOP_PERIOD);

  const newest = Math.max(
    qqqBars.length ? qqqBars[qqqBars.length - 1].t : 0,
    spyBars.length ? spyBars[spyBars.length - 1].t : 0
  );

  return {
    qqq,
    spy,
    blended: blend(qqq, spy),
    barsUsed: { qqq: qqqBars.length, spy: spyBars.length },
    droppedForming,
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

  /* ?refresh=true recomputes both legs on purpose — never pin that at the edge. */
  const headers = refresh ? noCacheHeaders() : cacheHeaders(CACHE.NARRATIVE);

  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: 'POLYGON_API_KEY is not configured' },
      { status: 500, headers: noCacheHeaders() }
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
    /* Each leg refreshes on its own clock. Both TTLs are set by how fast the
       underlying data can actually change, not by call cost — the plan allows
       unlimited calls, but a refresh that returns an identical number invites
       the belief that it was checked and confirmed. */
    const dailyStale = refresh || ageSeconds(cached?.daily?.computedAt) > CACHE_TTL_DAILY;
    const intradayStale = refresh || ageSeconds(cached?.intraday?.computedAt) > CACHE_TTL_INTRADAY;
    const hourlyStale = refresh || ageSeconds(cached?.hourly?.computedAt) > CACHE_TTL_HOURLY;

    const [daily, intraday, hourly] = await Promise.all([
      dailyStale ? computeDailyLeg(apiKey) : Promise.resolve(cached.daily as DailyLeg),
      intradayStale ? computeIntradayLeg(apiKey) : Promise.resolve(cached.intraday as IntradayLeg),
      hourlyStale ? computeHourlyLeg(apiKey) : Promise.resolve(cached.hourly as IntradayLeg),
    ]);

    if (daily.blended == null && intraday.blended == null) {
      return NextResponse.json(
        { success: false, error: 'Insufficient bar data on either timeframe' },
        { status: 502, headers: noCacheHeaders() }
      );
    }

    const payload = {
      success: true,
      period: CHOP_PERIOD,

      /* FLAT DAILY FIELDS ARE THE v1.0 SHAPE, KEPT DELIBERATELY. Scorecard
         reads `blended` / `blendedPrev` / `qqq` / `spy` directly. Emitting
         both shapes means the component adopts the intraday leg on its own
         schedule instead of the two having to deploy together. */
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
        windowMinutes: CHOP_PERIOD * INTRADAY_BAR_MINUTES,
        barMinutes: INTRADAY_BAR_MINUTES,
        /* Stated so the component can label the marker honestly rather than
           implying the intraday reading is live. */
        feedDelayMinutes: FEED_DELAY_MINUTES,
      },

      hourly: {
        ...hourly,
        zone: hourly.blended != null ? zoneOf(hourly.blended) : 'unknown',
        windowMinutes: CHOP_PERIOD * HOURLY_BAR_MINUTES,
        barMinutes: HOURLY_BAR_MINUTES,
        feedDelayMinutes: FEED_DELAY_MINUTES,
      },

      spread:
        hourly.blended != null && intraday.blended != null
          ? +(hourly.blended - intraday.blended).toFixed(1)
          : daily.blended != null && intraday.blended != null
            ? +(daily.blended - intraday.blended).toFixed(1)
            : null,

      updatedAt: new Date().toISOString(),
      cached: !dailyStale && !intradayStale && !hourlyStale,
      legsRecomputed: {
        daily: dailyStale,
        intraday: intradayStale,
        hourly: hourlyStale,
      },
    };

    try {
      // TTL is the longer of the two so the daily leg survives to be reused;
      // per-leg staleness is decided by computedAt above, not by expiry.
      await kv.set(CACHE_KEY, payload, { ex: CACHE_TTL_DAILY });
    } catch {
      // Cache write failure just means the next request recomputes.
    }

    return NextResponse.json(payload, { headers });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'CHOP computation failed' },
      { status: 500, headers: noCacheHeaders() }
    );
  }
}
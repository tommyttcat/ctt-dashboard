import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

/* CHOP regime route — v1.0
   ------------------------------------------------------------------
   Serves the Choppiness Index for the two benchmarks the dashboard
   already reasons about. Nothing else on the board answers "will a
   breakout follow through today" — every other gauge is directional,
   and direction is not the question a chop reading answers.

       CHOP = 100 × log10( Σ TR(n) / (maxHigh(n) − minLow(n)) ) / log10(n)

   The ratio is distance travelled over ground covered. A tape that
   moves 8% in total to end 8% higher has a low ratio and a low score:
   it trended. A tape that moves 8% in total and ends flat has a high
   ratio and a high score: it churned. log10 normalises the result to
   roughly 0-100 regardless of n.

   THIS ROUTE RETURNS RAW CHOP ONLY. The breadth and high/low modifiers
   are applied in MacroScorecard, deliberately — that component already
   holds live breadth in state, and duplicating the read here would
   mean two places computing one number from two different snapshots.
   The route owns the part that needs bars; the client owns the part
   that needs breadth.

   PREVIOUS BAR IS COMPUTED, NOT CACHED. The A/D strip derives its
   arrow by comparing consecutive polls, which works because A/D moves
   intraday. CHOP is a daily-bar metric behind a 15-minute cache, so a
   poll-to-poll comparison would read flat essentially always and the
   arrow would be decoration. Computing the window shifted back one bar
   gives a real day-over-day delta instead.
   ------------------------------------------------------------------ */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CHOP_PERIOD = 14;
const CACHE_KEY = 'chop_regime_v1';
const CACHE_TTL_SECONDS = 900;

// Calendar days back to request. 14 trading bars plus one for the
// first true range, plus one more for the shifted previous window,
// plus holiday slack. 40 calendar days clears it in every month.
const LOOKBACK_DAYS = 40;

// QQQ carries more weight than SPY because the setups this dashboard
// surfaces are momentum and growth names — they track the Nasdaq's
// regime far more closely than the S&P's. SPY is included to catch the
// case where QQQ alone is distorted by two or three mega-caps.
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

async function fetchDailyBars(symbol: string, apiKey: string): Promise<Bar[]> {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - LOOKBACK_DAYS);

  const url =
    `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/day/${ymd(from)}/${ymd(to)}` +
    `?adjusted=true&sort=asc&limit=120&apiKey=${apiKey}`;

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Polygon ${symbol} returned ${res.status}`);

  const data = await res.json();
  if (!data || !Array.isArray(data.results)) return [];

  return data.results
    .filter((b: any) => b && typeof b.h === 'number' && typeof b.l === 'number' && typeof b.c === 'number')
    .map((b: any) => ({ h: b.h, l: b.l, c: b.c, t: b.t }));
}

/* Choppiness over the last `period` bars of the supplied slice.
   Needs period+1 bars: the extra one supplies the prior close for the
   first true range. Returns null rather than a number when the window
   is short or degenerate — a fabricated reading here would propagate
   into a regime call, which is worse than an empty strip. */
function choppiness(bars: Bar[], period: number): number | null {
  if (bars.length < period + 1) return null;

  const window = bars.slice(-period);
  const prior = bars[bars.length - period - 1];

  let trSum = 0;
  for (let i = 0; i < window.length; i++) {
    const bar = window[i];
    const prevClose = i === 0 ? prior.c : window[i - 1].c;
    const tr = Math.max(
      bar.h - bar.l,
      Math.abs(bar.h - prevClose),
      Math.abs(bar.l - prevClose)
    );
    trSum += tr;
  }

  const maxHigh = Math.max(...window.map(b => b.h));
  const minLow = Math.min(...window.map(b => b.l));
  const range = maxHigh - minLow;

  // A zero range means every bar printed the same high and the same low.
  // Not a real market condition on a liquid ETF, but the division would
  // produce Infinity and the log would produce a nonsense score.
  if (range <= 0 || trSum <= 0) return null;

  const raw = (100 * Math.log10(trSum / range)) / Math.log10(period);

  // The formula can drift a point or two outside 0-100 on extreme inputs.
  return Math.max(0, Math.min(100, raw));
}

const zoneOf = (v: number): 'trend' | 'mixed' | 'chop' =>
  v <= 38.2 ? 'trend' : v >= 61.8 ? 'chop' : 'mixed';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const refresh = searchParams.get('refresh') === 'true';

  if (!refresh) {
    try {
      const cached = await kv.get(CACHE_KEY);
      if (cached) return NextResponse.json({ ...(cached as object), cached: true });
    } catch {
      // KV unavailable is not fatal — fall through and compute fresh.
    }
  }

  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: 'POLYGON_API_KEY is not configured' },
      { status: 500 }
    );
  }

  try {
    const [qqqBars, spyBars] = await Promise.all([
      fetchDailyBars('QQQ', apiKey).catch(() => [] as Bar[]),
      fetchDailyBars('SPY', apiKey).catch(() => [] as Bar[]),
    ]);

    // The previous reading uses the same window shifted back one bar,
    // so `prev` is genuinely yesterday's CHOP rather than a stale copy
    // of today's.
    const qqq = choppiness(qqqBars, CHOP_PERIOD);
    const qqqPrev = choppiness(qqqBars.slice(0, -1), CHOP_PERIOD);
    const spy = choppiness(spyBars, CHOP_PERIOD);
    const spyPrev = choppiness(spyBars.slice(0, -1), CHOP_PERIOD);

    if (qqq == null && spy == null) {
      return NextResponse.json(
        { success: false, error: 'Insufficient bar data for either benchmark' },
        { status: 502 }
      );
    }

    // Weighted blend that degrades to whichever benchmark is available
    // rather than dropping to null when one feed is short.
    const blend = (a: number | null, b: number | null): number | null => {
      if (a != null && b != null) return a * WEIGHT_QQQ + b * WEIGHT_SPY;
      return a ?? b ?? null;
    };

    const blended = blend(qqq, spy);
    const blendedPrev = blend(qqqPrev, spyPrev);

    const payload = {
      success: true,
      period: CHOP_PERIOD,
      qqq,
      qqqPrev,
      spy,
      spyPrev,
      blended,
      blendedPrev,
      zone: blended != null ? zoneOf(blended) : 'unknown',
      barsUsed: { qqq: qqqBars.length, spy: spyBars.length },
      updatedAt: new Date().toISOString(),
      cached: false,
    };

    try {
      await kv.set(CACHE_KEY, payload, { ex: CACHE_TTL_SECONDS });
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

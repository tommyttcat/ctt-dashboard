// lib/leaders.ts — Liquid Leaders: the ~1,000 most traded stocks, and which are leading.
//
// Asked for 30 Sep 2026 from a screenshot of another dashboard, built on
// Polygon only (the owner's call): history on this plan goes back 5 years, so
// "all-time high" here is a 5-YEAR high, and prices are 15 minutes delayed.
//
//   Universe   NASDAQ + NYSE common stock, close >= $10, 20-day average dollar
//              volume >= $100M. Rebuilt nightly (/api/leaders/nightly).
//   RS high    price / SPY at or above its highest close-to-close ratio of the
//              last 5 years — the stock is outrunning the market more than ever.
//   Price high price at or above its highest close of the last 5 years.
//   Gainers    today's biggest % moves in the universe.
//   Volume     today's volume against the stock's OWN usual volume at the same
//              time of day (its 20-session average, by half hour) — "tracking".
//
// A view of what is leading, not a tested buy signal. Pure functions here; the
// routes do the fetching.

export const LEADERS_STATE_KEY = 'leaders_state_v1';
export const LEADERS_LIVE_KEY = 'leaders_live_v1';
export const LEADERS_MIN_PRICE = 10;
export const LEADERS_MIN_DVOL = 100e6;
export const BUCKETS = 13;              // 9:30-16:00 in half hours
const OPEN = 9 * 60 + 30;

export interface LeaderHist {
  n?: string;          // company name
  maxClose: number;    // highest close, last 5 years through `date`
  maxRs: number;       // highest close / SPY close ratio, same window
  adv: number;         // 20-session average share volume
  prof: number[];      // average cumulative share volume at the end of each half hour (BUCKETS)
}
export interface LeadersState { date: string; builtAt: string; names: Record<string, LeaderHist> }

// vol: today's shares so far. rs: the site's RS Rating (1-99, lib/indicators/rs), null when unrated.
export interface LeaderRow { t: string; n?: string; price: number; chg: number; track: number | null; raw: number | null; vol?: number; rs?: number | null }
export interface LeadersLive {
  asOf: number;
  clockEt: number;              // the minute the (delayed) data describes, ET minutes after midnight
  spy: { price: number; chg: number } | null;
  qqq: { price: number; chg: number } | null;
  universe: number;
  rsHigh: LeaderRow[];
  priceHigh: LeaderRow[];
  gainers: LeaderRow[];
  volume: LeaderRow[];
  counts: { rsHigh: number; priceHigh: number; heavy: number };
}

/** Expected cumulative volume by `etMin` from a half-hour profile (linear within a bucket). */
export function expectedCum(prof: number[], etMin: number): number | null {
  if (!prof?.length) return null;
  const t = Math.min(Math.max(etMin, OPEN), OPEN + BUCKETS * 30);
  const k = Math.min(BUCKETS - 1, Math.floor((t - OPEN) / 30));
  const prev = k > 0 ? prof[k - 1] : 0;
  const f = (t - OPEN - k * 30) / 30;
  const v = prev + f * (prof[k] - prev);
  return v > 0 ? v : null;
}

/** Today's volume against usual at the same time, as % over (+91 = 1.91x usual). */
export function trackingPct(cumVol: number, prof: number[], etMin: number): number | null {
  const e = expectedCum(prof, etMin);
  return e && cumVol > 0 ? (cumVol / e - 1) * 100 : null;
}

/** Average cumulative volume by half hour from many sessions of half-hour bars. */
export function profileOf(sessions: number[][]): number[] {
  const use = sessions.filter(s => s.length === BUCKETS);
  if (!use.length) return [];
  const out = new Array(BUCKETS).fill(0);
  for (const s of use) { let c = 0; s.forEach((v, k) => { c += v; out[k] += c; }); }
  return out.map(v => v / use.length);
}

export interface Quote { t: string; price: number; prevClose: number; vol: number }

/** The four lists from one snapshot. `clockEt` is the minute the data describes. */
export function buildLive(state: LeadersState, quotes: Quote[], spyPrice: number, clockEt: number, asOf: number, idx: Pick<LeadersLive, 'spy' | 'qqq'>, rsOf?: (t: string) => number | null): LeadersLive {
  const rows: (LeaderRow & { isRs: boolean; isHi: boolean })[] = [];
  for (const q of quotes) {
    const h = state.names[q.t];
    if (!h || !(q.price > 0) || !(q.prevClose > 0)) continue;
    const chg = (q.price / q.prevClose - 1) * 100;
    const track = trackingPct(q.vol, h.prof, clockEt);
    const raw = h.adv > 0 && q.vol > 0 ? (q.vol / h.adv - 1) * 100 : null;
    rows.push({
      t: q.t, n: h.n, price: q.price, chg: +chg.toFixed(2),
      track: track == null ? null : Math.round(track), raw: raw == null ? null : Math.round(raw),
      vol: q.vol, rs: rsOf ? rsOf(q.t) : null,
      isRs: spyPrice > 0 && q.price / spyPrice >= h.maxRs,
      isHi: q.price >= h.maxClose,
    });
  }
  const strip = ({ isRs: _r, isHi: _h, ...r }: LeaderRow & { isRs: boolean; isHi: boolean }): LeaderRow => r;
  const byChg = (a: LeaderRow, b: LeaderRow) => b.chg - a.chg;
  const rsHigh = rows.filter(r => r.isRs).sort(byChg);
  const priceHigh = rows.filter(r => r.isHi).sort(byChg);
  return {
    asOf, clockEt, ...idx, universe: rows.length,
    rsHigh: rsHigh.map(strip),
    priceHigh: priceHigh.map(strip),
    gainers: [...rows].sort(byChg).slice(0, 50).map(strip),
    volume: rows.filter(r => r.track != null).sort((a, b) => (b.track ?? 0) - (a.track ?? 0)).slice(0, 100).map(strip),
    counts: { rsHigh: rsHigh.length, priceHigh: priceHigh.length, heavy: rows.filter(r => (r.track ?? -100) >= 100).length },
  };
}

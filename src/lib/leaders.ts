import { tightnessOf } from './scans/tightness';
import { computeCnfScore } from './indicators/confluence';
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
  /* Average PRE-MARKET share volume (4:00-9:30 ET), 27 Oct 2026. The live day volume includes
     extended-hours trades (Polygon daily volume runs 4-8% above the regular-session sum) while
     `prof` is regular-session only, so a gapper's pre-market shares read as heavy buying at 9:45. */
  pre?: number;
  /* Swing-checklist inputs at the last close (12 Oct 2026), from 70 sessions of whole-market
     bars: [EMA10, EMA21, EMA21 a session earlier, EMA50, ADR %, tight5, volDry, lowerHigh]. The
     live update compares the live price with these, so every row gets the universal colour.
     lowerHigh added 15 Oct 2026; older state carries seven entries and reads it as unchecked. */
  chk?: [number, number, number, number, number | null, number | null, number | null, (number | null)?];
  /* Highest high of the last 5 sessions through `date` (15 Oct 2026) — the Oversold Bounce
     card's reference: oversold = trading 1.5 ADRs or more under it. */
  wkHi?: number;
  /* Key levels under the last close (16 Oct 2026, keyLevelsOf), nearest first. */
  lv?: number[];
  /* Weinstein stage at the last close ('2A'): not stored — the live job attaches it from the
     System nightly's map (lib/stageBreadth STAGE_MAP_KEY) before buildLive. */
  stg?: string;
  /* A leveraged bull ETF (15 Oct 2026): carried for the Oversold Bounce card only — kept out of
     the Liquid Leaders lists and universe count, and given no 5-year highs or volume profile. */
  etf?: boolean;
}
export interface LeadersState { date: string; builtAt: string; names: Record<string, LeaderHist> }

// vol: today's shares so far. rs: the site's RS Rating (1-99, lib/indicators/rs), null when unrated.
export interface LeaderRow {
  t: string; n?: string; price: number; chg: number; track: number | null; raw: number | null; vol?: number; rs?: number | null;
  /* swing checklist fields (lib/scans/checklist), live price against last night's EMAs */
  rsRating?: number | null; ema50?: number; distToEma21?: number; distToEma10?: number; ema21Rising?: boolean; adrPct?: number | null; tight5?: number | null; volDry?: number | null; lowerHigh?: number | null;
  /* 16 Oct 2026: CNF on the shared scorer and last night's stage, for every row — the scans' values
     only covered names a scan carried (0 of 40 oversold, 1 of 100 heavy-volume that day). */
  cnf?: number | null; stg?: string | null;
}
/* Gainers and Volume, quality first (12 Oct 2026): a gainer needs RS 70+ (FICO +10.9% on RS 2
   was a bounce in a broken stock); heavy volume must be on an UP day with RS 50+ (heavy
   selling is not leadership). Unrated names are left out of both. */
export const GAINER_MIN_RS = 70;
export const VOLUME_MIN_RS = 50;
/* Oversold Bounce (15 Oct 2026), modelled on Monis (x.com/mmonis): a liquid name with an ADR of
   6-15% that has traded down to 1.5 ADRs under its 5-session high. Rows are sorted by how far
   they have come off today's low — his "TopD". His entry (16 Oct, from his charts) is a dip
   under a key level and back above it, so each row carries its key levels and a live status
   (keyLevelsOf / levelStatusOf). Untested: the owner dropped the market-washout gate and the
   daily-bar backtest on 16 Oct ("stocks enter oversold when the market is good"). */
export const OVERSOLD = { minAdr: 6, maxAdr: 15, adrs: 1.5, max: 40 } as const;
/* Leveraged BULL ETFs by fund name (15 Oct 2026): "Bull 3X", "2X Long", "UltraPro", "Leveraged".
   Inverse funds (Bear, Short, Inverse) are left out — they go "oversold" when the market rips,
   which is a bet against the bounce this card is for. */
export const isLeveragedBull = (name: string): boolean =>
  /\b[23](?:\.\d)?x\b|\bultra|\bbull\b|leveraged/i.test(name) && !/\bbear\b|\bshort\b|inverse|ultrashort|-[123]x/i.test(name);
export interface OversoldRow extends LeaderRow {
  adr: number;      // 20-day ADR, %
  level: number;    // 5-session high less 1.5 ADR
  wkHi: number;     // the 5-session high
  lo: number;       // today's low
  offLow: number;   // % above today's low (TopD sort)
  etf?: boolean;    // a leveraged bull ETF
  deep: number;     // how far today's low got under the 5-session high, in ADRs
  key?: number | null;          // the key level the status is about
  lvs?: number[];               // all key levels, for the pop-up chart
  status?: LevelStatus;
  score?: number;               // OSB score 0-100 (osbScoreOf), the list's order
  sc?: [number, number, number, number | null];  // its parts: level, off low, stretch, volume (null: no volume profile)
}
/* Key levels (16 Oct 2026, from Monis's SOXL entry chart: a horizontal level, the dip under it
   circled). Swing points of the last 60 sessions — a low, or a high price has since cleared,
   with 3 bars either side — that sit under the last close, nearest first, merged when within
   1% of each other. Up to 3. */
export function keyLevelsOf(bars: { h: number; l: number; c: number }[], k = 3, look = 60, max = 3): number[] {
  const n = bars.length;
  if (n < 2 * k + 5) return [];
  const close = bars[n - 1].c;
  const pts: number[] = [];
  for (let i = Math.max(k, n - look); i < n - k; i++) {
    let lo = true, hi = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (bars[j].l <= bars[i].l) lo = false;
      if (bars[j].h >= bars[i].h) hi = false;
    }
    if (lo && bars[i].l < close) pts.push(bars[i].l);
    if (hi && bars[i].h < close) pts.push(bars[i].h);
  }
  pts.sort((a, b) => b - a);
  const out: number[] = [];
  for (const p of pts) {
    if (out.length && Math.abs(out[out.length - 1] - p) / p < 0.01) continue;
    out.push(+p.toFixed(2));
    if (out.length >= max) break;
  }
  return out;
}
/* RECLAIMED — today's low went under a key level and the price is back above it (his entry).
   TESTING — the price is within a quarter ADR of a level. LOST — under the nearest level.
   HOLDING — above the levels, not near one. */
export type LevelStatus = 'reclaimed' | 'testing' | 'holding' | 'lost' | null;
export function levelStatusOf(levels: number[] | undefined, price: number, lo: number, adrPct: number): { status: LevelStatus; key: number | null } {
  if (!levels?.length || !(price > 0) || !(lo > 0)) return { status: null, key: null };
  const back = levels.filter(L => lo < L && price > L);
  if (back.length) return { status: 'reclaimed', key: Math.max(...back) };
  const band = price * (adrPct / 100) * 0.25;
  const near = levels.find(L => Math.abs(price - L) <= band);
  if (near != null) return { status: 'testing', key: near };
  if (price < levels[0]) return { status: 'lost', key: Math.min(...levels.filter(L => L > price)) };
  return { status: 'holding', key: levels[0] };
}
/* OSB score (30 Oct 2026, owner asked for a ranking; leadership left out at the owner's call — Monis trades
   beaten-down names and leveraged ETFs too). UNTESTED. Out of 100:
   LEVEL 40 — reclaimed 40, testing 23, holding 17, lost or no level 0.
   OFF LOW 30 — the bounce off today's low in ADRs; one full ADR earns it all.
   STRETCH 18 — today's low under the 5-day high in ADRs; 1.5 (the gate) earns 0, 3+ earns it all.
   VOLUME 12 — today's pace against usual; 1x or less earns 0, 2x+ earns it all. Leveraged ETFs carry
   no volume profile, so theirs is scored out of the other 88 and scaled up. */
export const OSB_LEVEL_PTS: Record<string, number> = { reclaimed: 40, testing: 23, holding: 17, lost: 0 };
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export function osbScoreOf(r: Pick<OversoldRow, 'status' | 'offLow' | 'adr' | 'deep' | 'track'>): { score: number; sc: [number, number, number, number | null] } {
  const lvl = OSB_LEVEL_PTS[r.status ?? ''] ?? 0;
  const ol = Math.round(30 * clamp01(r.adr > 0 ? r.offLow / r.adr : 0));
  const str = Math.round(18 * clamp01((r.deep - OVERSOLD.adrs) / 1.5));
  const vol = r.track == null ? null : Math.round(12 * clamp01(r.track / 100));   // track +100 = 2x usual
  const raw = lvl + ol + str + (vol ?? 0);
  return { score: Math.round(vol == null ? (raw * 100) / 88 : raw), sc: [lvl, ol, str, vol] };
}
/** The oversold-bounce row for one name, or null when it does not qualify. */
export function oversoldOf(h: LeaderHist, q: Quote, base: LeaderRow): OversoldRow | null {
  const adr = h.chk?.[4];
  if (adr == null || !(adr >= OVERSOLD.minAdr && adr <= OVERSOLD.maxAdr)) return null;
  if (!(h.wkHi && h.wkHi > 0) || !(q.lo && q.lo > 0) || !(q.price > 0)) return null;
  const level = h.wkHi * (1 - (OVERSOLD.adrs * adr) / 100);
  if (q.lo > level) return null;
  const ks = levelStatusOf(h.lv, q.price, q.lo, adr);
  return {
    ...base, adr, level: +level.toFixed(2), wkHi: h.wkHi, lo: q.lo, key: ks.key, status: ks.status, ...(h.lv?.length ? { lvs: h.lv } : {}),
    offLow: +((q.price / q.lo - 1) * 100).toFixed(2),
    deep: +(((h.wkHi - q.lo) / h.wkHi) * 100 / adr).toFixed(2),
  };
}

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
  oversold?: OversoldRow[];      // absent on payloads written before 15 Oct 2026
  counts: { rsHigh: number; priceHigh: number; heavy: number; oversold?: number };
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
export function trackingPct(cumVol: number, prof: number[], etMin: number, pre = 0): number | null {
  const reg = expectedCum(prof, etMin);
  const e = reg ? reg + (pre > 0 ? pre : 0) : null;   // the live volume includes pre-market shares
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

export interface Quote { t: string; price: number; prevClose: number; vol: number; lo?: number; o?: number; hi?: number; vw?: number }

/* CNF for a live row (16 Oct 2026), on the scorer every scan uses (lib/indicators/confluence).
   Like the DVol scan, the context it has no data for is NEUTRAL — no news, streak, dots, plan or
   sector heat — so it is a slightly conservative read of the same scale, not a second scale. */
export function liveCnf(h: LeaderHist, q: Quote, track: number | null, spyChg: number | null): number | null {
  if (!(q.price > 0) || !(q.prevClose > 0)) return null;
  const adr = h.chk?.[4] ?? null;
  const chg = (q.price / q.prevClose - 1) * 100;
  const e10 = h.chk?.[0], e21 = h.chk?.[1];
  const range = q.hi != null && q.lo != null && q.hi > 0 && q.lo > 0 ? q.hi - q.lo : null;
  const stageNum = h.stg ? parseInt(h.stg, 10) || null : null;
  return computeCnfScore(
    track == null ? null : Math.max(0, 1 + track / 100),
    q.o != null && q.o > 0 ? (q.o / q.prevClose - 1) * 100 : null,
    range != null && adr && adr > 0 ? ((range / q.price) * 100) / adr : null,
    spyChg != null ? chg - spyChg : null,
    {
      catalystTier: 'none', hasEarnings: false, scanStreak: 1, rme: null,
      vwapStatus: q.vw && q.vw > 0 ? (q.price >= q.vw ? 'above' : 'below') : 'neutral',
      tradeType: 'DAY', setupName: null, breadthSignal: '', spyAbove21: null, inHotSector: false,
      stageNum, goldenCross: null, pctOffHigh: null, dotKind: null, dotBarsSince: null, isBearInstrument: false,
      aboveEma10: e10 && e10 > 0 ? q.price > e10 : null,
      planTradeable: false, planResistanceR: null, planClear: false, planCollapsed: false,
      distToEma21: e21 && e21 > 0 ? (q.price / e21 - 1) * 100 : null,
      atrPct: adr, adrPct: adr,
      closeStrength: range && range > 0 && q.lo != null ? (q.price - q.lo) / range : null,
    },
  ).score;
}

/** The four lists from one snapshot. `clockEt` is the minute the data describes. */
/** The checklist fields for a live row: live price against last night's EMAs. */
export function checkFields(h: LeaderHist, price: number, rs: number | null): Partial<LeaderRow> {
  if (!h.chk || !(price > 0)) return {};
  const [e10, e21, e21p, e50, adr, t5, vd, lh] = h.chk;
  if (!(e10 > 0 && e21 > 0 && e50 > 0)) return {};
  return {
    rsRating: rs, ema50: e50, ema21Rising: e21 > e21p,
    distToEma21: +((price / e21 - 1) * 100).toFixed(2), distToEma10: +((price / e10 - 1) * 100).toFixed(2),
    adrPct: adr, tight5: t5, volDry: vd, lowerHigh: lh ?? null,
  };
}

/** EMA10/21/50, ADR and tightness at the last bar, from whole-market bars oldest first. */
export function chkOf(bars: { h: number; l: number; c: number; v: number }[]): LeaderHist['chk'] | undefined {
  const n = bars.length; if (n < 55) return undefined;
  const ema = (k: number, upto: number) => { let e = bars[0].c; for (let i = 1; i <= upto; i++) e = bars[i].c * (2 / (k + 1)) + e * (1 - 2 / (k + 1)); return e; };
  const r = (x: number) => +x.toFixed(4);
  const last20 = bars.slice(-20).filter(b => b.l > 0 && b.h > 0);
  const adr = last20.length >= 15 ? +((last20.reduce((a, b) => a + b.h / b.l - 1, 0) / last20.length) * 100).toFixed(2) : null;
  const t = tightnessOf(bars.map(b => ({ ...b })));
  return [r(ema(10, n - 1)), r(ema(21, n - 1)), r(ema(21, n - 2)), r(ema(50, n - 1)), adr, t.tight5, t.volDry, t.lowerHigh];
}

export function buildLive(state: LeadersState, quotes: Quote[], spyPrice: number, clockEt: number, asOf: number, idx: Pick<LeadersLive, 'spy' | 'qqq'>, rsOf?: (t: string) => number | null): LeadersLive {
  const rows: (LeaderRow & { isRs: boolean; isHi: boolean })[] = [];
  const oversold: OversoldRow[] = [];
  for (const q of quotes) {
    const h = state.names[q.t];
    if (!h || !(q.price > 0) || !(q.prevClose > 0)) continue;
    const chg = (q.price / q.prevClose - 1) * 100;
    if (h.etf) {
      const os = oversoldOf(h, q, { t: q.t, n: h.n, price: q.price, chg: +chg.toFixed(2), track: null, raw: null, vol: q.vol, rs: rsOf ? rsOf(q.t) : null, cnf: liveCnf(h, q, null, idx.spy?.chg ?? null), stg: null });
      if (os) oversold.push({ ...os, etf: true });
      continue;
    }
    const track = trackingPct(q.vol, h.prof, clockEt, h.pre ?? 0);
    const raw = h.adv > 0 && q.vol > 0 ? (q.vol / h.adv - 1) * 100 : null;
    rows.push({
      t: q.t, n: h.n, price: q.price, chg: +chg.toFixed(2),
      track: track == null ? null : Math.round(track), raw: raw == null ? null : Math.round(raw),
      vol: q.vol, rs: rsOf ? rsOf(q.t) : null,
      ...checkFields(h, q.price, rsOf ? rsOf(q.t) : null),
      cnf: liveCnf(h, q, track, idx.spy?.chg ?? null), stg: h.stg ?? null,
      isRs: spyPrice > 0 && q.price / spyPrice >= h.maxRs,
      isHi: q.price >= h.maxClose,
    });
    const { isRs: _r0, isHi: _h0, ...base } = rows[rows.length - 1];
    const os = oversoldOf(h, q, base);
    if (os) oversold.push(os);
  }
  for (const r of oversold) Object.assign(r, osbScoreOf(r));
  oversold.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.offLow - a.offLow);
  const strip = ({ isRs: _r, isHi: _h, ...r }: LeaderRow & { isRs: boolean; isHi: boolean }): LeaderRow => r;
  const byChg = (a: LeaderRow, b: LeaderRow) => b.chg - a.chg;
  const rsHigh = rows.filter(r => r.isRs).sort(byChg);
  const priceHigh = rows.filter(r => r.isHi).sort(byChg);
  return {
    asOf, clockEt, ...idx, universe: rows.length,
    rsHigh: rsHigh.map(strip),
    priceHigh: priceHigh.map(strip),
    gainers: rows.filter(r => (r.rs ?? 0) >= GAINER_MIN_RS).sort(byChg).slice(0, 50).map(strip),
    volume: rows.filter(r => r.track != null && r.chg > 0 && (r.rs ?? 0) >= VOLUME_MIN_RS).sort((a, b) => (b.track ?? 0) - (a.track ?? 0)).slice(0, 100).map(strip),
    oversold: oversold.slice(0, OVERSOLD.max),
    counts: { rsHigh: rsHigh.length, priceHigh: priceHigh.length, heavy: rows.filter(r => (r.track ?? -100) >= 100).length, oversold: oversold.length },
  };
}

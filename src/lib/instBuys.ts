// lib/instBuys.ts — "Institutional Buys": what big money is buying and
// selling today, by net options flow (11 Nov 2026).
//
// WHO GETS ON THE CARD — the owner's quality rules, on Unusual Whales flow
// alerts (an alert is a cluster of trades on one contract that hit together):
//   a call OR a put bought with DTE < 45, 10%+ out of the money, cluster
//   premium over $250K, 80%+ of it paid at the ask, single-leg.
// Every rule is re-checked here on the alert's own numbers: the API's
// is_multi_leg=false filter is undocumented, so has_multileg is checked too.
//
// WHERE IT GOES — net flow on that name today, from every big one-sided
// single-leg alert ($250K+, 80%+ at the ask or at the bid, any expiry/strike):
//   bullish $ = calls bought at the ask + puts sold at the bid
//   bearish $ = puts bought at the ask + calls sold at the bid
//   net = bullish − bearish.  Net > 0 → BUYING column, net < 0 → SELLING.
// SCORE (the card's CNF column, 0-100) — how strong the one-way bet is:
//   size, 0-50:      |net| on a log scale, 0 at $250K, 50 at $10M or more
//   one-sided, 0-50: 0 when the name's big flow is 50/50, 50 when all one way
// Top 5 each side by score. Colour: STRONG when one side is 75%+ of the
// name's big flow (green buying / red selling), MIXED (yellow) otherwise.
// The score's shape and the 75% line are judgement calls. Not tested.
// Selling at the bid is often profit-taking or covered writing, not a bet —
// the tooltip splits bought from sold so that is visible.
//
// Nothing here says WHO traded. "Institutional" means size paid at the ask.
//
// ADDED 12 Nov 2026 (owner picked these four):
//   TREND   — building / fading: net flow in the last 60 minutes against the
//             name's net for the day. BUILDING = $250K+ more of the same in
//             the last hour; FADING = $250K+ the other way. Judgement call.
//   TIDE    — whole-market net call vs net put premium today (Unusual Whales
//             market tide, cumulative 5-minute ticks). One more call a build.
//   DAYS    — sessions in a row this name has been on the same side's list,
//             from the 16:20 ET daily snapshot (lib/instBuysHist).
//   HELD    — yesterday's biggest bought contract per name, checked against
//             the next day's open interest (lib/instBuysHist checkHeld).

import { kv } from '@vercel/kv';
import { uwGetMany } from './uw';
import { RS_KEY } from './indicators/rs';
import { LEADERS_STATE_KEY, type LeadersState } from './leaders';
import { getMarketDay, isTradingDay, previousTradingDay, etDateString } from './marketCalendar';
import { etParts } from './etCron';
import { INST_HIST_KEY, type InstHist, type InstHistDay } from './instBuysHist';

export type FlowDir = 'buy' | 'sell';
export type FlowTier = 'green' | 'yellow' | 'red';
export type FlowAlert = {
  side: 'call' | 'put'; at: 'ask' | 'bid'; strike: number; expiry: string; dte: number; otmPct: number;
  premium: number; trades: number; sweep: boolean; time: string;
  /** OCC contract symbol and contracts traded — for the next-day open-interest check */
  sym: string; size: number;
};
export type FlowTrend = 'building' | 'fading' | 'steady';
export type MarketTide = { calls: number; puts: number; at: string; series: number[] };
export type HeldCheck = {
  ticker: string; dir: FlowDir; sym: string; side: 'call' | 'put'; strike: number; expiry: string;
  size: number; premium: number; oiBefore: number | null; oiAfter: number | null;
  status: 'held' | 'not held' | 'pending';
};
export type InstBuyRow = {
  ticker: string; dir: FlowDir; tier: FlowTier; sector: string | null; under: number;
  net: number; bullPrem: number; bearPrem: number;
  /** 0-100 strength of the one-way bet (size + one-sidedness) — the card's CNF */
  score: number;
  callsBought: number; putsSold: number; putsBought: number; callsSold: number;
  earnings: string | null;
  /** last night's RS rating and stage, and the name's usual volume by half hour (for RVOL) — null when not covered */
  rs: number | null; stg: string | null; prof: number[] | null; pre: number;
  /** the six biggest alerts on this name (for the tooltip) */
  alerts: FlowAlert[];
  /** net flow in the last 60 minutes, and what that says about the day's net */
  net1h: number; trend: FlowTrend;
  /** sessions in a row on this side's list, today included (1 = new today) */
  days: number;
};
export type InstBuysPayload = {
  ok: boolean; asOf: number; session: string; since: string;
  buy: InstBuyRow[]; sell: InstBuyRow[]; error?: string;
  /** whole-market net premium today; null when the lookup failed */
  tide?: MarketTide | null;
  /** the last saved session's bets and whether they were held (added by the route) */
  prev?: { date: string; buy: HeldCheck[]; sell: HeldCheck[] } | null;
};

const MIN_PREM = 250_000;
const MIN_SIDE = 0.8;
const MIN_OTM = 0.10;
const MAX_DTE = 44;
const STRONG_SHARE = 0.75;
const TOP = 5;
const SIZE_FLOOR = 250_000, SIZE_FULL = 10_000_000;

/** 0-100: half for the size of the net flow (log scale), half for how one-sided it is. */
export function flowScore(bull: number, bear: number): number {
  const net = Math.abs(bull - bear), total = bull + bear;
  if (!(total > 0) || net <= 0) return 0;
  const size = net <= SIZE_FLOOR ? 0 : Math.min(1, Math.log(net / SIZE_FLOOR) / Math.log(SIZE_FULL / SIZE_FLOOR));
  const oneSided = (Math.max(bull, bear) / total - 0.5) / 0.5;
  return Math.round(50 * size + 50 * oneSided);
}

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const T = (r: any) => String(r?.ticker ?? '').toUpperCase();

/** The session the card reports: today from 9:30 ET on a trading day, else the last one. */
export function flowSession(now = new Date()): { date: string; openUtc: string } {
  const today = etDateString(now);
  const { hour, minute } = etParts(now);
  const open = isTradingDay(today) && (hour * 60 + minute) >= 9 * 60 + 30;
  const date = open ? today : previousTradingDay(today);
  // 9:30 New York in UTC: 13:30 during EDT, 14:30 during EST.
  const edt = new Date(`${date}T13:30:00Z`);
  const openUtc = etParts(edt).hour === 9 ? edt.toISOString() : new Date(`${date}T14:30:00Z`).toISOString();
  return { date, openUtc };
}

const toAlert = (r: any, date: string, at: 'ask' | 'bid'): FlowAlert => {
  const under = n(r.underlying_price), k = n(r.strike);
  const side = r.type === 'put' ? 'put' : 'call';
  return {
    side, at, strike: k, expiry: String(r.expiry), dte: daysBetween(date, String(r.expiry)),
    otmPct: under > 0 ? (side === 'call' ? (k - under) / under : (under - k) / under) : 0,
    premium: n(r.total_premium), trades: n(r.trade_count), sweep: !!r.has_sweep, time: String(r.created_at ?? ''),
    sym: String(r.option_chain ?? ''), size: n(r.total_size),
  };
};
const sideShare = (r: any, at: 'ask' | 'bid') => {
  const p = n(r.total_premium);
  return p ? n(at === 'ask' ? r.total_ask_side_prem : r.total_bid_side_prem) / p : 0;
};

/* Last night's RS ratings and the Liquid Leaders volume profiles, so a name no scan carries
   still gets RS, stage and RVOL. One KV read (MGET of two keys, measured 11 Nov: 125 KB +
   311 KB); the route holds the slimmed result 3 hours in the server data cache. */
export type NightlyRefs = {
  rs: Record<string, number>; stg: Record<string, string>; vol: Record<string, { prof: number[]; pre: number }>;
  /** the daily 16:20 ET snapshots, oldest first (lib/instBuysHist) — same MGET, no extra read */
  hist: InstHistDay[];
};
export async function loadNightlyRefs(): Promise<NightlyRefs> {
  const [rsP, st, hist] = await kv.mget<[{ ratings?: Record<string, number> } | null, LeadersState | null, InstHist | null]>(RS_KEY, LEADERS_STATE_KEY, INST_HIST_KEY);
  const stg: NightlyRefs['stg'] = {}, vol: NightlyRefs['vol'] = {};
  for (const [t, h] of Object.entries(st?.names ?? {})) {
    if (h.stg) stg[t] = h.stg;
    if (h.prof?.length) vol[t] = { prof: h.prof.map(v => Math.round(v)), pre: Math.round(h.pre ?? 0) };
  }
  return { rs: rsP?.ratings ?? {}, stg, vol, hist: hist?.days ?? [] };
}

export async function buildInstBuys(now = new Date(), refs: NightlyRefs | null = null): Promise<InstBuysPayload> {
  const { date, openUtc } = flowSession(now);
  const base: InstBuysPayload = { ok: false, asOf: now.getTime(), session: date, since: openUtc, buy: [], sell: [] };
  if (!getMarketDay(date).isTradingDay) return { ...base, ok: true };

  /* 1. Who qualifies: calls or puts bought under the owner's rules. */
  const since = encodeURIComponent(openUtc);
  const strict = `is_otm=true&min_diff=${MIN_OTM}&max_dte=${MAX_DTE}&min_premium=${MIN_PREM}&min_ask_perc=${MIN_SIDE}&is_multi_leg=false&newer_than=${since}&limit=500`;
  const [callsRaw, putsRaw, tideRaw] = await uwGetMany<{ data: any[] }>([
    `/api/option-trades/flow-alerts?is_put=false&${strict}`,
    `/api/option-trades/flow-alerts?is_call=false&${strict}`,
    `/api/market/market-tide?date=${date}`,
  ]);
  if (!callsRaw || !putsRaw) throw new Error('flow alerts lookup failed');
  const tide = toTide(tideRaw);
  const qualifies = (r: any, side: 'call' | 'put') => {
    if (r.type !== side || r.has_multileg) return false;
    const a = toAlert(r, date, 'ask');
    return a.dte >= 0 && a.dte <= MAX_DTE && a.otmPct >= MIN_OTM && a.premium > MIN_PREM && sideShare(r, 'ask') >= MIN_SIDE;
  };
  const tickers = [...new Set([
    ...(callsRaw.data ?? []).filter(r => qualifies(r, 'call')).map(T),
    ...(putsRaw.data ?? []).filter(r => qualifies(r, 'put')).map(T),
  ])].sort();
  if (!tickers.length) return { ...base, ok: true, tide };

  /* 2. All big one-sided single-leg flow on those names, four lookups. */
  const list = encodeURIComponent(tickers.join(','));
  const q = (x: string) => `/api/option-trades/flow-alerts?ticker_symbol=${list}&${x}&min_premium=${MIN_PREM}&newer_than=${since}&limit=500`;
  const [callAsk, putAsk, callBid, putBid] = await uwGetMany<{ data: any[] }>([
    q(`is_put=false&min_ask_perc=${MIN_SIDE}`), q(`is_call=false&min_ask_perc=${MIN_SIDE}`),
    q(`is_put=false&min_bid_perc=${MIN_SIDE}`), q(`is_call=false&min_bid_perc=${MIN_SIDE}`),
  ]);
  if (!callAsk || !putAsk || !callBid || !putBid) throw new Error('flow lookup failed');
  const pick = (raw: { data: any[] }, t: string, side: 'call' | 'put', at: 'ask' | 'bid') =>
    (raw.data ?? []).filter(r => r.type === side && T(r) === t && !r.has_multileg && sideShare(r, at) >= MIN_SIDE)
      .map(r => toAlert(r, date, at));
  const firstRow = (t: string) =>
    [callsRaw, putsRaw, callAsk, putAsk].flatMap(x => x.data ?? []).find(r => T(r) === t);

  const rows: InstBuyRow[] = tickers.map(t => {
    const cB = pick(callAsk, t, 'call', 'ask'), pS = pick(putBid, t, 'put', 'bid');
    const pB = pick(putAsk, t, 'put', 'ask'), cS = pick(callBid, t, 'call', 'bid');
    const s = (xs: FlowAlert[]) => xs.reduce((a, x) => a + x.premium, 0);
    const bull = s(cB) + s(pS), bear = s(pB) + s(cS), net = bull - bear;
    const dir: FlowDir = net >= 0 ? 'buy' : 'sell';
    const share = bull + bear > 0 ? Math.max(bull, bear) / (bull + bear) : 0;
    const r0 = firstRow(t);
    /* Last hour: up to now, or to the close when the card is showing a finished session. */
    const end = Math.min(now.getTime(), Date.parse(openUtc) + 390 * 60_000);
    const inHour = (xs: FlowAlert[]) => xs.filter(a => Date.parse(a.time) > end - 3_600_000).reduce((a, x) => a + x.premium, 0);
    const net1h = inHour(cB) + inHour(pS) - inHour(pB) - inHour(cS);
    /* In the first hour the "last hour" is the whole day, so there is nothing to compare: steady until 10:30 ET. */
    const trend: FlowTrend = end - Date.parse(openUtc) < 3_600_000 || Math.abs(net1h) < MIN_PREM ? 'steady'
      : Math.sign(net1h) === Math.sign(net) ? 'building' : 'fading';
    return {
      ticker: t, dir, tier: (share >= STRONG_SHARE ? (dir === 'buy' ? 'green' : 'red') : 'yellow') as FlowTier,
      sector: r0?.sector ?? null, under: n(r0?.underlying_price),
      net, bullPrem: bull, bearPrem: bear, score: flowScore(bull, bear),
      callsBought: s(cB), putsSold: s(pS), putsBought: s(pB), callsSold: s(cS),
      earnings: r0?.next_earnings_date ?? null,
      rs: refs?.rs[t] ?? null, stg: refs?.stg[t] ?? null, prof: refs?.vol[t]?.prof ?? null, pre: refs?.vol[t]?.pre ?? 0,
      alerts: [...cB, ...pS, ...pB, ...cS].sort((a, b) => b.premium - a.premium).slice(0, 6),
      net1h, trend, days: 1,
    };
  }).filter(r => r.net !== 0);

  const byScore = (a: InstBuyRow, b: InstBuyRow) => b.score - a.score || Math.abs(b.net) - Math.abs(a.net);
  const buy = rows.filter(r => r.dir === 'buy').sort(byScore).slice(0, TOP);
  const sell = rows.filter(r => r.dir === 'sell').sort(byScore).slice(0, TOP);
  /* Sessions in a row on the same side's list, counting back through the saved snapshots. */
  const past = (refs?.hist ?? []).filter(d => d.date < date).sort((a, b) => b.date.localeCompare(a.date));
  for (const r of [...buy, ...sell]) {
    let k = 0;
    while (k < past.length && past[k][r.dir].some(x => x.t === r.ticker)) k++;
    r.days = 1 + k;
  }
  return { ...base, ok: true, buy, sell, tide };
}

/* Market tide rows are cumulative 5-minute ticks: net call premium (calls bought − sold) and
   net put premium (puts bought − sold). The last tick is the day so far. */
function toTide(raw: { data: any[] } | null): MarketTide | null {
  const rows = (raw?.data ?? []).filter(r => r && r.timestamp);
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  return {
    calls: n(last.net_call_premium), puts: n(last.net_put_premium), at: String(last.timestamp),
    series: rows.map(r => Math.round(n(r.net_call_premium) - n(r.net_put_premium))),
  };
}

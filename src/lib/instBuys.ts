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
// Top 5 each by the size of the net. Colour: STRONG when one side is 75%+ of
// the name's big flow (green buying / red selling), MIXED (yellow) otherwise.
// The 75% line is a judgement call. Not tested.
// Selling at the bid is often profit-taking or covered writing, not a bet —
// the tooltip splits bought from sold so that is visible.
//
// Nothing here says WHO traded. "Institutional" means size paid at the ask.

import { uwGetMany } from './uw';
import { getMarketDay, isTradingDay, previousTradingDay, etDateString } from './marketCalendar';
import { etParts } from './etCron';

export type FlowDir = 'buy' | 'sell';
export type FlowTier = 'green' | 'yellow' | 'red';
export type FlowAlert = {
  side: 'call' | 'put'; at: 'ask' | 'bid'; strike: number; expiry: string; dte: number; otmPct: number;
  premium: number; trades: number; sweep: boolean; time: string;
};
export type InstBuyRow = {
  ticker: string; dir: FlowDir; tier: FlowTier; sector: string | null; under: number;
  net: number; bullPrem: number; bearPrem: number;
  callsBought: number; putsSold: number; putsBought: number; callsSold: number;
  earnings: string | null;
  /** the six biggest alerts on this name (for the tooltip) */
  alerts: FlowAlert[];
};
export type InstBuysPayload = {
  ok: boolean; asOf: number; session: string; since: string;
  buy: InstBuyRow[]; sell: InstBuyRow[]; error?: string;
};

const MIN_PREM = 250_000;
const MIN_SIDE = 0.8;
const MIN_OTM = 0.10;
const MAX_DTE = 44;
const STRONG_SHARE = 0.75;
const TOP = 5;

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
  };
};
const sideShare = (r: any, at: 'ask' | 'bid') => {
  const p = n(r.total_premium);
  return p ? n(at === 'ask' ? r.total_ask_side_prem : r.total_bid_side_prem) / p : 0;
};

export async function buildInstBuys(now = new Date()): Promise<InstBuysPayload> {
  const { date, openUtc } = flowSession(now);
  const base: InstBuysPayload = { ok: false, asOf: now.getTime(), session: date, since: openUtc, buy: [], sell: [] };
  if (!getMarketDay(date).isTradingDay) return { ...base, ok: true };

  /* 1. Who qualifies: calls or puts bought under the owner's rules. */
  const since = encodeURIComponent(openUtc);
  const strict = `is_otm=true&min_diff=${MIN_OTM}&max_dte=${MAX_DTE}&min_premium=${MIN_PREM}&min_ask_perc=${MIN_SIDE}&is_multi_leg=false&newer_than=${since}&limit=500`;
  const [callsRaw, putsRaw] = await uwGetMany<{ data: any[] }>([
    `/api/option-trades/flow-alerts?is_put=false&${strict}`,
    `/api/option-trades/flow-alerts?is_call=false&${strict}`,
  ]);
  if (!callsRaw || !putsRaw) throw new Error('flow alerts lookup failed');
  const qualifies = (r: any, side: 'call' | 'put') => {
    if (r.type !== side || r.has_multileg) return false;
    const a = toAlert(r, date, 'ask');
    return a.dte >= 0 && a.dte <= MAX_DTE && a.otmPct >= MIN_OTM && a.premium > MIN_PREM && sideShare(r, 'ask') >= MIN_SIDE;
  };
  const tickers = [...new Set([
    ...(callsRaw.data ?? []).filter(r => qualifies(r, 'call')).map(T),
    ...(putsRaw.data ?? []).filter(r => qualifies(r, 'put')).map(T),
  ])].sort();
  if (!tickers.length) return { ...base, ok: true };

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
    return {
      ticker: t, dir, tier: (share >= STRONG_SHARE ? (dir === 'buy' ? 'green' : 'red') : 'yellow') as FlowTier,
      sector: r0?.sector ?? null, under: n(r0?.underlying_price),
      net, bullPrem: bull, bearPrem: bear,
      callsBought: s(cB), putsSold: s(pS), putsBought: s(pB), callsSold: s(cS),
      earnings: r0?.next_earnings_date ?? null,
      alerts: [...cB, ...pS, ...pB, ...cS].sort((a, b) => b.premium - a.premium).slice(0, 6),
    };
  }).filter(r => r.net !== 0);

  const buy = rows.filter(r => r.dir === 'buy').sort((a, b) => b.net - a.net).slice(0, TOP);
  const sell = rows.filter(r => r.dir === 'sell').sort((a, b) => a.net - b.net).slice(0, TOP);
  return { ...base, ok: true, buy, sell };
}

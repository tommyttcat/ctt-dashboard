// lib/instBuys.ts — "Institutional Buys": today's large one-sided option bets,
// bullish (calls) and bearish (puts), each rated by the options flow against
// it on the same name (11 Nov 2026).
//
// THE OWNER'S RULES, applied to Unusual Whales flow alerts (an alert is a
// cluster of trades on one contract that hit together):
//   DTE < 45 · 10%+ out of the money · cluster premium over $250K · at least
//   80% of that premium paid at the ask · single-leg.
//   BULLISH = calls bought.  BEARISH = puts bought (the mirror rule).
// Every rule is re-checked here on the alert's own numbers: the API's
// is_multi_leg=false filter is undocumented, so has_multileg is checked too.
//
// THE RATING comes from the opposite flow on the same name today ($250K+,
// 80%+ on one side, any expiry or strike):
//   against a bullish name = puts bought at the ask + calls sold at the bid
//   against a bearish name = calls bought at the ask + puts sold at the bid
//   OUT     — opposite premium larger than the bet's, or the name's whole day
//             50%+ the other way (Unusual Whales' bullish/bearish split).
//   STRONG  — no opposite alerts, or the bet 3x+ the opposite (green on the
//             bullish side, red on the bearish side).
//   MIXED   — kept, but real opposite flow is there (yellow).
// Thresholds are the owner's rules plus a judgement call on 3x. Not tested.
// Selling at the bid is often profit-taking or covered writing, not a bet —
// the tooltip says which kind of opposing flow it was.
//
// Nothing here says WHO traded. "Institutional" means size paid at the ask.

import { uwGet, uwGetMany } from './uw';
import { getMarketDay, isTradingDay, previousTradingDay, etDateString } from './marketCalendar';
import { etParts } from './etCron';

export type FlowDir = 'bull' | 'bear';
export type FlowTier = 'green' | 'yellow' | 'red';
export type FlowAlert = {
  side: 'call' | 'put'; strike: number; expiry: string; dte: number; otmPct: number;
  premium: number; atAskPct: number; atBidPct: number; trades: number; sweep: boolean; at: string;
};
export type InstBuyRow = {
  ticker: string; dir: FlowDir; tier: FlowTier; sector: string | null; under: number;
  /** premium of the qualifying bets (calls bought / puts bought) */
  betPrem: number;
  /** opposing premium, split into bought-against and sold-against */
  vsPrem: number; vsBoughtPrem: number; vsSoldPrem: number;
  dayBullPrem: number | null; dayBearPrem: number | null;
  earnings: string | null; bets: FlowAlert[]; vs: FlowAlert[];
};
export type InstBuysPayload = {
  ok: boolean; asOf: number; session: string; since: string;
  bull: InstBuyRow[]; bear: InstBuyRow[];
  out: { ticker: string; dir: FlowDir; why: string }[]; error?: string;
};

const MIN_PREM = 250_000;
const MIN_SIDE = 0.8;
const MIN_OTM = 0.10;
const MAX_DTE = 44;
/** Names per side that get the whole-day check (one call each) — the card shows 5. */
const CHECK_PER_SIDE = 6;

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const fmt = (x: number) => `$${x >= 1e6 ? (x / 1e6).toFixed(1) + 'M' : Math.round(x / 1e3) + 'K'}`;

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

const toAlert = (r: any, date: string): FlowAlert => {
  const prem = n(r.total_premium), under = n(r.underlying_price), k = n(r.strike);
  const side = r.type === 'put' ? 'put' : 'call';
  return {
    side, strike: k, expiry: String(r.expiry), dte: daysBetween(date, String(r.expiry)),
    otmPct: under > 0 ? (side === 'call' ? (k - under) / under : (under - k) / under) : 0,
    premium: prem, atAskPct: prem ? n(r.total_ask_side_prem) / prem : 0, atBidPct: prem ? n(r.total_bid_side_prem) / prem : 0,
    trades: n(r.trade_count), sweep: !!r.has_sweep, at: String(r.created_at ?? ''),
  };
};
const T = (r: any) => String(r?.ticker ?? '').toUpperCase();
const sum = (xs: FlowAlert[]) => xs.reduce((s, a) => s + a.premium, 0);

export async function buildInstBuys(now = new Date()): Promise<InstBuysPayload> {
  const { date, openUtc } = flowSession(now);
  const base: InstBuysPayload = { ok: false, asOf: now.getTime(), session: date, since: openUtc, bull: [], bear: [], out: [] };
  if (!getMarketDay(date).isTradingDay) return { ...base, ok: true };

  const since = encodeURIComponent(openUtc);
  const strict = `is_otm=true&min_diff=${MIN_OTM}&max_dte=${MAX_DTE}&min_premium=${MIN_PREM}&min_ask_perc=${MIN_SIDE}&is_multi_leg=false&newer_than=${since}&limit=500`;
  const [callsRaw, putsRaw] = await uwGetMany<{ data: any[] }>([
    `/api/option-trades/flow-alerts?is_put=false&${strict}`,
    `/api/option-trades/flow-alerts?is_call=false&${strict}`,
  ]);
  if (!callsRaw || !putsRaw) throw new Error('flow alerts lookup failed');

  const qualifies = (r: any, side: 'call' | 'put') => {
    if (r.type !== side || r.has_multileg) return false;
    const a = toAlert(r, date);
    return a.dte >= 0 && a.dte <= MAX_DTE && a.otmPct >= MIN_OTM && a.premium > MIN_PREM && a.atAskPct >= MIN_SIDE;
  };
  const betsBy = (rows: any[], side: 'call' | 'put') => {
    const m = new Map<string, any[]>();
    for (const r of rows) if (qualifies(r, side)) m.set(T(r), [...(m.get(T(r)) ?? []), r]);
    return m;
  };
  const bullBets = betsBy(callsRaw.data ?? [], 'call');
  const bearBets = betsBy(putsRaw.data ?? [], 'put');
  const tickers = [...new Set([...bullBets.keys(), ...bearBets.keys()])].sort();
  if (!tickers.length) return { ...base, ok: true };

  /* The four opposing-flow lookups, once each for every name on either side. */
  const list = encodeURIComponent(tickers.join(','));
  const opp = (q: string) => `/api/option-trades/flow-alerts?ticker_symbol=${list}&${q}&min_premium=${MIN_PREM}&newer_than=${since}&limit=500`;
  const [callAsk, putAsk, callBid, putBid] = await uwGetMany<{ data: any[] }>([
    opp(`is_put=false&min_ask_perc=${MIN_SIDE}`), opp(`is_call=false&min_ask_perc=${MIN_SIDE}`),
    opp(`is_put=false&min_bid_perc=${MIN_SIDE}`), opp(`is_call=false&min_bid_perc=${MIN_SIDE}`),
  ]);
  if (!callAsk || !putAsk || !callBid || !putBid) throw new Error('opposing flow lookup failed');
  const pick = (raw: { data: any[] }, t: string, side: 'call' | 'put', at: 'ask' | 'bid') =>
    (raw.data ?? []).filter(r => r.type === side && T(r) === t).map(r => toAlert(r, date))
      .filter(a => (at === 'ask' ? a.atAskPct : a.atBidPct) >= MIN_SIDE);

  type Cand = { t: string; dir: FlowDir; raw: any[]; bets: FlowAlert[]; bought: FlowAlert[]; sold: FlowAlert[] };
  const cands = (dir: FlowDir): Cand[] => [...(dir === 'bull' ? bullBets : bearBets)].map(([t, raw]) => ({
    t, dir, raw,
    bets: raw.map(r => toAlert(r, date)).sort((a, b) => b.premium - a.premium),
    bought: dir === 'bull' ? pick(putAsk, t, 'put', 'ask') : pick(callAsk, t, 'call', 'ask'),
    sold: dir === 'bull' ? pick(callBid, t, 'call', 'bid') : pick(putBid, t, 'put', 'bid'),
  }));

  const out: InstBuysPayload['out'] = [];
  /* Alert-level verdict first (no extra calls); the survivors with the most
     premium get the whole-day check, one options-volume call each. */
  const survivors = (dir: FlowDir) => cands(dir).filter(c => {
    const bet = sum(c.bets), vs = sum(c.bought) + sum(c.sold);
    if (vs > bet) {
      const what = c.bought.length ? `${fmt(sum(c.bought))} ${dir === 'bull' ? 'puts' : 'calls'} bought` : `${dir === 'bull' ? 'calls' : 'puts'} sold`;
      out.push({ ticker: c.t, dir, why: `${fmt(vs)} ${dir === 'bull' ? 'bearish' : 'bullish'} vs ${fmt(bet)} ${dir === 'bull' ? 'bullish' : 'bearish'} (${what})` });
      return false;
    }
    return true;
  }).sort((a, b) => sum(b.bets) - sum(a.bets)).slice(0, CHECK_PER_SIDE);
  const bullC = survivors('bull'), bearC = survivors('bear');
  const volT = [...new Set([...bullC, ...bearC].map(c => c.t))];
  const vols = await uwGetMany<any>(volT.map(t => `/api/stock/${t}/options-volume`));
  const day = new Map(volT.map((t, i) => { const d = vols[i]?.data; return [t, Array.isArray(d) ? d[0] : d]; }));

  const rate = (c: Cand): InstBuyRow | null => {
    const d = day.get(c.t);
    const dBull = d ? n(d.bullish_premium) : null, dBear = d ? n(d.bearish_premium) : null;
    const against = c.dir === 'bull' ? dBear : dBull;
    const total = dBull != null && dBear != null ? dBull + dBear : 0;
    if (against != null && total > 0 && against / total >= 0.5) {
      out.push({ ticker: c.t, dir: c.dir, why: `whole day ${Math.round((against / total) * 100)}% ${c.dir === 'bull' ? 'bearish' : 'bullish'} premium` });
      return null;
    }
    const bet = sum(c.bets), vsBought = sum(c.bought), vsSold = sum(c.sold), vs = vsBought + vsSold;
    const strong = vs === 0 || bet >= 3 * vs;
    return {
      ticker: c.t, dir: c.dir, tier: strong ? (c.dir === 'bull' ? 'green' : 'red') : 'yellow',
      sector: c.raw[0]?.sector ?? null, under: n(c.raw[0]?.underlying_price),
      betPrem: bet, vsPrem: vs, vsBoughtPrem: vsBought, vsSoldPrem: vsSold,
      dayBullPrem: dBull, dayBearPrem: dBear, earnings: c.raw[0]?.next_earnings_date ?? null,
      bets: c.bets, vs: [...c.bought, ...c.sold].sort((a, b) => b.premium - a.premium),
    };
  };
  const order = (a: InstBuyRow, b: InstBuyRow) => (a.tier === b.tier ? b.betPrem - a.betPrem : a.tier === 'yellow' ? 1 : -1);
  const bull = bullC.map(rate).filter((r): r is InstBuyRow => !!r).sort(order).slice(0, 5);
  const bear = bearC.map(rate).filter((r): r is InstBuyRow => !!r).sort(order).slice(0, 5);
  out.sort((a, b) => (a.dir === b.dir ? a.ticker.localeCompare(b.ticker) : a.dir === 'bull' ? -1 : 1));
  return { ...base, ok: true, bull, bear, out };
}

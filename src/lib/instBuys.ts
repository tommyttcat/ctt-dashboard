// lib/instBuys.ts — "Institutional Buys": today's large bullish option bets,
// rated by the options flow on the same name (11 Nov 2026).
//
// THE OWNER'S RULES, applied to Unusual Whales flow alerts (an alert is a
// cluster of trades on one contract that hit together):
//   calls only (bullish) · DTE < 45 · 10%+ out of the money · cluster premium
//   over $250K · at least 80% of that premium paid at the ask · single-leg.
// Every rule is re-checked here on the alert's own numbers: the API's
// is_multi_leg=false filter is undocumented, so has_multileg is checked too.
//
// THE RATING comes from the bearish flow on the same name today:
//   bearish alerts = puts bought (80%+ at the ask) or calls sold (80%+ at the
//   bid), $250K+, any expiry or strike.
//   OUT    — bearish alert premium is larger than the bullish, or the name's
//            whole-day premium is 50%+ bearish (Unusual Whales' own split).
//            Listed under the card, not as rows — the owner's prompt removes them.
//   GREEN  — no bearish alerts, or bullish premium 3x+ the bearish.
//   YELLOW — kept, but real bearish flow is there.
// Thresholds are the owner's rules plus a judgement call on 3x. Not tested.
// Calls sold at the bid are often profit-taking or covered calls, not bets
// against the stock — the tooltip shows which kind of bearish flow it was.
//
// Nothing here says WHO traded. "Institutional" means size paid at the ask.

import { uwGet, uwGetMany } from './uw';
import { getMarketDay, isTradingDay, previousTradingDay, etDateString } from './marketCalendar';
import { etParts } from './etCron';

export type FlowTier = 'green' | 'yellow';
export type FlowAlert = {
  side: 'call' | 'put'; strike: number; expiry: string; dte: number; otmPct: number;
  premium: number; atAskPct: number; atBidPct: number; trades: number; sweep: boolean; at: string;
};
export type InstBuyRow = {
  ticker: string; tier: FlowTier; sector: string | null; under: number;
  bullPrem: number; bearPrem: number; putBuyPrem: number; callSellPrem: number;
  dayBullPrem: number | null; dayBearPrem: number | null; dayBearPct: number | null;
  earnings: string | null; bull: FlowAlert[]; bear: FlowAlert[];
};
export type InstBuysPayload = {
  ok: boolean; asOf: number; session: string; since: string;
  rows: InstBuyRow[]; out: { ticker: string; why: string }[]; error?: string;
};

const MIN_PREM = 250_000;
const MIN_SIDE = 0.8;
const MIN_OTM = 0.10;
const MAX_DTE = 44;

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

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

export async function buildInstBuys(now = new Date()): Promise<InstBuysPayload> {
  const { date, openUtc } = flowSession(now);
  const base: InstBuysPayload = { ok: false, asOf: now.getTime(), session: date, since: openUtc, rows: [], out: [] };
  if (!getMarketDay(date).isTradingDay) return { ...base, ok: true };

  const since = encodeURIComponent(openUtc);
  const bullRaw = await uwGet<{ data: any[] }>(
    `/api/option-trades/flow-alerts?is_put=false&is_otm=true&min_diff=${MIN_OTM}&max_dte=${MAX_DTE}` +
    `&min_premium=${MIN_PREM}&min_ask_perc=${MIN_SIDE}&is_multi_leg=false&newer_than=${since}&limit=500`,
  );
  const bullRows = (bullRaw?.data ?? []).filter(r => {
    if (r.type !== 'call' || r.has_multileg) return false;
    const a = toAlert(r, date);
    return a.dte >= 0 && a.dte <= MAX_DTE && a.otmPct >= MIN_OTM && a.premium > MIN_PREM && a.atAskPct >= MIN_SIDE;
  });
  const tickers = [...new Set(bullRows.map(r => String(r.ticker).toUpperCase()))].sort();
  if (!tickers.length) return { ...base, ok: true };

  const list = encodeURIComponent(tickers.join(','));
  const [putBuys, callSells, ...vols] = await uwGetMany<any>([
    `/api/option-trades/flow-alerts?ticker_symbol=${list}&is_call=false&min_ask_perc=${MIN_SIDE}&min_premium=${MIN_PREM}&newer_than=${since}&limit=500`,
    `/api/option-trades/flow-alerts?ticker_symbol=${list}&is_put=false&min_bid_perc=${MIN_SIDE}&min_premium=${MIN_PREM}&newer_than=${since}&limit=500`,
    ...tickers.map(t => `/api/stock/${t}/options-volume`),
  ]);
  if (!putBuys || !callSells) throw new Error('bearish flow lookup failed');

  const bearOf = (t: string) => [
    ...(putBuys.data ?? []).filter((r: any) => r.type === 'put' && String(r.ticker).toUpperCase() === t)
      .map((r: any) => toAlert(r, date)).filter((a: FlowAlert) => a.atAskPct >= MIN_SIDE),
    ...(callSells.data ?? []).filter((r: any) => r.type === 'call' && String(r.ticker).toUpperCase() === t)
      .map((r: any) => toAlert(r, date)).filter((a: FlowAlert) => a.atBidPct >= MIN_SIDE),
  ];

  const rows: InstBuyRow[] = [];
  const out: { ticker: string; why: string }[] = [];
  tickers.forEach((t, i) => {
    const mine = bullRows.filter(r => String(r.ticker).toUpperCase() === t);
    const bull = mine.map(r => toAlert(r, date)).sort((a, b) => b.premium - a.premium);
    const bear = bearOf(t).sort((a, b) => b.premium - a.premium);
    const bullPrem = bull.reduce((s, a) => s + a.premium, 0);
    const putBuyPrem = bear.filter(a => a.side === 'put').reduce((s, a) => s + a.premium, 0);
    const callSellPrem = bear.filter(a => a.side === 'call').reduce((s, a) => s + a.premium, 0);
    const bearPrem = putBuyPrem + callSellPrem;
    const v = vols[i]?.data; const day = Array.isArray(v) ? v[0] : v;
    const dayBull = day ? n(day.bullish_premium) : null, dayBear = day ? n(day.bearish_premium) : null;
    const dayBearPct = dayBull != null && dayBear != null && dayBull + dayBear > 0 ? dayBear / (dayBull + dayBear) : null;

    const fmt = (x: number) => `$${x >= 1e6 ? (x / 1e6).toFixed(1) + 'M' : Math.round(x / 1e3) + 'K'}`;
    if (bearPrem > bullPrem) {
      out.push({ ticker: t, why: `${fmt(bearPrem)} bearish vs ${fmt(bullPrem)} bullish${putBuyPrem ? ` (${fmt(putBuyPrem)} puts bought)` : ' (calls sold)'}` });
      return;
    }
    if (dayBearPct != null && dayBearPct >= 0.5) {
      out.push({ ticker: t, why: `whole day ${(dayBearPct * 100).toFixed(0)}% bearish premium` });
      return;
    }
    rows.push({
      ticker: t, tier: bearPrem === 0 || bullPrem >= 3 * bearPrem ? 'green' : 'yellow',
      sector: mine[0]?.sector ?? null, under: n(mine[0]?.underlying_price),
      bullPrem, bearPrem, putBuyPrem, callSellPrem,
      dayBullPrem: dayBull, dayBearPrem: dayBear, dayBearPct,
      earnings: mine[0]?.next_earnings_date ?? null, bull, bear,
    });
  });
  rows.sort((a, b) => (a.tier === b.tier ? b.bullPrem - a.bullPrem : a.tier === 'green' ? -1 : 1));
  return { ...base, ok: true, rows, out };
}

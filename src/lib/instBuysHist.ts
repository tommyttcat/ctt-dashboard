// lib/instBuysHist.ts — the Institutional Buys card's memory (12 Nov 2026).
//
// SNAPSHOT — /api/inst-buys/save runs once a session day at 16:20 ET and keeps
// the day's Buying and Selling lists, with each name's biggest BOUGHT contract
// (calls for the Buying side, puts for the Selling side). Last 10 sessions, one
// KV key, one write a day. Two things read it:
//   - DAYS (lib/instBuys): sessions in a row a name has been on the same side.
//   - HELD (checkHeld below): did yesterday's bet stay open? Open interest is
//     counted overnight, so the next day's starting open interest on that
//     contract shows it. HELD = open interest rose by at least half the
//     contracts bought; NOT HELD = it didn't (the buyer may have closed, or
//     the trade closed someone else's position). PENDING = no next-day open
//     interest yet. The 50% line is a judgement call. Not tested.
//
// Unusual Whales data, individual licence: owner-only, never published.

import { uwGetMany } from './uw';
import type { FlowDir, HeldCheck, InstBuysPayload, InstBuyRow } from './instBuys';

export const INST_HIST_KEY = 'inst_buys_hist_v1';
export const INST_HIST_DAYS = 10;

export type InstHistBet = { sym: string; side: 'call' | 'put'; strike: number; expiry: string; size: number; premium: number };
export type InstHistRow = { t: string; net: number; bet: InstHistBet | null };
export type InstHistDay = { date: string; savedAt: number; buy: InstHistRow[]; sell: InstHistRow[] };
export type InstHist = { days: InstHistDay[] };

/** The biggest contract BOUGHT in the row's direction: a call for buying, a put for selling. */
function biggestBet(r: InstBuyRow): InstHistBet | null {
  const side = r.dir === 'buy' ? 'call' : 'put';
  const a = r.alerts.filter(x => x.at === 'ask' && x.side === side && x.sym && x.size > 0)
    .sort((x, y) => y.premium - x.premium)[0];
  return a ? { sym: a.sym, side, strike: a.strike, expiry: a.expiry, size: a.size, premium: a.premium } : null;
}

export function toHistDay(p: InstBuysPayload): InstHistDay {
  const rows = (xs: InstBuyRow[]) => xs.map(r => ({ t: r.ticker, net: Math.round(r.net), bet: biggestBet(r) }));
  return { date: p.session, savedAt: Date.now(), buy: rows(p.buy), sell: rows(p.sell) };
}

/** Adds or replaces the day, keeps the last INST_HIST_DAYS, oldest first. */
export function mergeHist(h: InstHist | null, day: InstHistDay): InstHist {
  const days = (h?.days ?? []).filter(d => d.date !== day.date);
  days.push(day);
  days.sort((a, b) => a.date.localeCompare(b.date));
  return { days: days.slice(-INST_HIST_DAYS) };
}

/**
 * Yesterday's bets against the next day's open interest. One small Unusual Whales call per
 * contract (/api/option-contract/{sym}/historic?limit=5, ~2.3 KB measured 12 Nov), at most 10.
 */
export async function checkHeld(day: InstHistDay): Promise<{ date: string; buy: HeldCheck[]; sell: HeldCheck[] }> {
  const items: { dir: FlowDir; r: InstHistRow }[] = [
    ...day.buy.map(r => ({ dir: 'buy' as const, r })),
    ...day.sell.map(r => ({ dir: 'sell' as const, r })),
  ].filter(x => x.r.bet);
  const raw = await uwGetMany<{ chains?: any[] }>(items.map(x => `/api/option-contract/${encodeURIComponent(x.r.bet!.sym)}/historic?limit=5`));
  const out: HeldCheck[] = items.map(({ dir, r }, i) => {
    const bet = r.bet!;
    const chains = (raw[i]?.chains ?? []).filter(c => c?.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const on = chains.find(c => c.date === day.date);
    const next = chains.find(c => c.date > day.date);
    const oiBefore = on ? Number(on.open_interest) : null;
    const oiAfter = next ? Number(next.open_interest) : null;
    const status: HeldCheck['status'] = oiBefore == null || oiAfter == null || !Number.isFinite(oiBefore) || !Number.isFinite(oiAfter)
      ? 'pending'
      : oiAfter - oiBefore >= 0.5 * bet.size ? 'held' : 'not held';
    return { ticker: r.t, dir, sym: bet.sym, side: bet.side, strike: bet.strike, expiry: bet.expiry, size: bet.size, premium: bet.premium, oiBefore, oiAfter, status };
  });
  return { date: day.date, buy: out.filter(x => x.dir === 'buy'), sell: out.filter(x => x.dir === 'sell') };
}

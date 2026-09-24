// lib/scans/triggerProximity.ts — which setups are about to trigger.
//
// WHY THIS IS A LIB AND NOT A FEW LINES IN THE CARD
// -------------------------------------------------
// The one rule here that can be silently wrong is the DIRECTION. Breakout
// plans (Daily Setups, Stocks in Play, Swing, VCP) want price to RISE through
// the trigger, so a row already above it has fired. EP9M is the mirror — its
// plan is a pullback to the EP-day midpoint, so it wants price to FALL to the
// trigger, and a row already below it has passed. Get that backwards and the
// card confidently lists every EP9M name as "0.5% away" in the wrong
// direction, which reads like a buy-stop and is not one. scripts/plan.test.mts
// pins both directions.
//
// Nothing is measured or predicted here. The trigger and the stop are the
// scan's own, already on its table; this file does arithmetic on the distance
// and drops the rows that are through their level.

import { numOrNull, priceOf, livePlanOf, PULLBACK_SOURCES, PLAN_MAX_REACH_ADR } from '@/lib/summary/rowFormat';

export type TrigRow = {
  s: any;
  ticker: string;
  price: number;
  trigger: number;
  stop: number;
  /** What the level is, in the scan's own words ("day high", "EP mid", "pivot"). */
  label: string;
  /** True when the plan waits for price to come DOWN to the level. */
  pullback: boolean;
  /** Distance from price to the level, always positive. */
  awayPct: number;
  /** Price is already through the level (above a breakout, below a dip). */
  through: boolean;
};

export function trigRowOf(s: any, opts?: { keepThrough?: boolean }): TrigRow | null {
  const ticker = s?.ticker ?? s?.symbol;
  const price = priceOf(s);
  if (!ticker || price == null || price <= 0) return null;

  /* VCP is the one scan that carries its levels at the top level instead of
     inside a plan object; everything else goes through livePlanOf, the same
     gate the scan tables use (tradeable, not collapsed, not overextended). */
  const plan = livePlanOf(s);
  const isVcp = s._source === 'vcp';
  const trigger = numOrNull(plan?.trigger ?? (isVcp ? s.trigger : null));
  const stop = numOrNull(plan?.stop ?? (isVcp ? s.stop : null));
  if (trigger == null || stop == null || trigger <= 0) return null;

  const pullback = PULLBACK_SOURCES.has(String(s._source ?? ''));
  // Through the level already: that is a position or a miss, not a watch —
  // unless the caller is listing a fixed set of names and wants all of them.
  const through = pullback ? trigger >= price : trigger <= price;
  if (through && !opts?.keepThrough) return null;

  return {
    s, ticker, price, trigger, stop, pullback, through,
    label: plan?.triggerLabel ?? (isVcp ? 'pivot' : 'level'),
    awayPct: (Math.abs(trigger - price) / price) * 100,
  };
}

export function trigRows(pool: any[], limit = 8): TrigRow[] {
  const out: TrigRow[] = [];
  for (const s of pool) {
    const r = trigRowOf(s);
    if (r) out.push(r);
  }
  return out.sort((a, b) => a.awayPct - b.awayPct).slice(0, limit);
}

/** Buy and stop for a FIXED list — the recommended names on the Setups
 *  Summary card. Every name with a live plan is kept, including ones already
 *  through their level, so the list matches the card above it. */
export function planRowsFor(names: any[]): TrigRow[] {
  const out: TrigRow[] = [];
  for (const s of names) {
    const r = trigRowOf(s, { keepThrough: true });
    if (r) out.push(r);
  }
  return out;
}

/* ---- One-word status -----------------------------------------------------
   So the Buy & stop box reads at a glance:
     WAIT  not at the buy level yet (shown with the distance)
     HIT   at or through the buy level, still close to it
     MISS  a breakout that ran past the level by more than a normal day's
           move (1 ADR — PLAN_MAX_REACH_ADR, the same limit the Trade Plan
           card uses for "reachable"). Buying now is chasing.
     OUT   price is at or below the stop — the idea failed.
   A pullback (EP9M) cannot be MISSED: further down is toward the stop, so
   it is HIT until it is OUT. */
export type PlanStatus = 'wait' | 'hit' | 'miss' | 'out';

export function planStatusOf(r: TrigRow): PlanStatus {
  if (r.price <= r.stop) return 'out';
  if (!r.through) return 'wait';
  if (r.pullback) return 'hit';
  const adr = numOrNull(r.s?.adrPct);
  const pastPct = ((r.price - r.trigger) / r.trigger) * 100;
  if (adr != null && adr > 0 && pastPct > adr * PLAN_MAX_REACH_ADR) return 'miss';
  return 'hit';
}

/** Actionable first: HIT, then WAIT (nearest first), then MISS, then OUT. */
export const PLAN_STATUS_ORDER: Record<PlanStatus, number> = { hit: 0, wait: 1, miss: 2, out: 3 };

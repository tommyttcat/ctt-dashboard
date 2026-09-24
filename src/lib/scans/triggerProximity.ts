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

import { numOrNull, priceOf, livePlanOf, PULLBACK_SOURCES } from '@/lib/summary/rowFormat';

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
};

export function trigRowOf(s: any): TrigRow | null {
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
  // Through the level already: that is a position or a miss, not a watch.
  if (pullback ? trigger >= price : trigger <= price) return null;

  return {
    s, ticker, price, trigger, stop, pullback,
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

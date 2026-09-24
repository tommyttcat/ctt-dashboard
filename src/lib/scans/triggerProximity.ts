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
  /** The scan flagged the name as too far above its 21 EMA for a sensible stop. */
  extended: boolean;
};

export function trigRowOf(s: any, opts?: { keepThrough?: boolean; keepExtended?: boolean }): TrigRow | null {
  const ticker = s?.ticker ?? s?.symbol;
  const price = priceOf(s);
  if (!ticker || price == null || price <= 0) return null;

  /* VCP is the one scan that carries its levels at the top level instead of
     inside a plan object; everything else goes through livePlanOf, the same
     gate the scan tables use (tradeable, not collapsed, not overextended). */
  /* keepExtended lets an overextended plan through (still tradeable, not
     collapsed) so a fixed list can show its levels flagged EXT rather than
     silently dropping the name. */
  const raw = s?.plan;
  const plan = opts?.keepExtended
    ? (raw && typeof raw === 'object' && raw.tradeable === true && raw.collapsed !== true ? raw : null)
    : livePlanOf(s);
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
    extended: plan?.overextended === true,
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
    const r = trigRowOf(s, { keepThrough: true, keepExtended: true });
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
     EXT   the scan says it is too far above its 21 EMA to place a sensible
           stop; levels are shown for reference, not to act on.
     OUT   price is at or below the stop — the idea failed.
   A pullback (EP9M) cannot be MISSED: further down is toward the stop, so
   it is HIT until it is OUT. */
export type PlanStatus = 'wait' | 'hit' | 'miss' | 'ext' | 'out';

export function planStatusOf(r: TrigRow): PlanStatus {
  if (r.price <= r.stop) return 'out';
  if (r.extended) return 'ext';
  if (!r.through) return 'wait';
  if (r.pullback) return 'hit';
  const adr = numOrNull(r.s?.adrPct);
  const pastPct = ((r.price - r.trigger) / r.trigger) * 100;
  if (adr != null && adr > 0 && pastPct > adr * PLAN_MAX_REACH_ADR) return 'miss';
  return 'hit';
}

/** Actionable first: HIT, WAIT (nearest first), EXT, MISS, then OUT. */
export const PLAN_STATUS_ORDER: Record<PlanStatus, number> = { hit: 0, wait: 1, ext: 2, miss: 3, out: 4 };

/** Colour and hover text per status — the dashboard Buy & stop box and the
 *  scan tables' STATUS column read the same table, so a name never shows two
 *  colours for one state. */
export const PLAN_STATUS_META: Record<PlanStatus, { cls: string; tip: string }> = {
  wait: { cls: 'text-slate-300', tip: 'Not at the buy level yet — this far away' },
  hit: { cls: 'text-emerald-400', tip: 'At the buy level' },
  miss: { cls: 'text-amber-400', tip: "Ran past the buy level by more than a normal day's move — buying now is chasing" },
  ext: { cls: 'text-orange-400', tip: 'Too far above its 21-day average to place a sensible stop — levels are for reference, do not chase' },
  out: { cls: 'text-rose-400', tip: 'Below the stop — the idea failed' },
};

export interface PlanStatusView { status: PlanStatus; text: string; cls: string; tip: string; sort: number }

/** One scan-table row → its STATUS cell. `source` fills `_source` for rows
 *  that do not carry it, because the pullback rule (EP9M) and VCP's top-level
 *  levels both key off it. Every live plan is kept, through or extended, so
 *  the column never silently drops a name the table is showing.
 *
 *  `sort` is negated so a table's first (descending) click lists HIT first,
 *  then the nearest waits, then EXT, MISS and OUT. */
export function planStatusView(s: any, source?: string): PlanStatusView | null {
  const row = source && s && s._source == null ? { ...s, _source: source } : s;
  const r = trigRowOf(row, { keepThrough: true, keepExtended: true });
  if (!r) return null;
  const st = planStatusOf(r);
  const meta = PLAN_STATUS_META[st];
  const away = r.awayPct < 10 ? r.awayPct.toFixed(1) : r.awayPct.toFixed(0);
  return {
    status: st,
    // Bare "1.2%" as in the Buy & stop box: "1.2% away" is wider than the
    // column on a phone. The hover spells it out.
    text: st === 'wait' ? `${away}%` : st.toUpperCase(),
    cls: meta.cls,
    tip: `${r.pullback ? 'Buy on a dip to' : 'Buy above'} ${r.trigger.toFixed(2)} · Stop ${r.stop.toFixed(2)}\n${st === 'wait' ? `${away}% away` : st.toUpperCase()} — ${meta.tip}`,
    sort: -(PLAN_STATUS_ORDER[st] * 1000 + r.awayPct),
  };
}

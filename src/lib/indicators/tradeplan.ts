// src/lib/indicators/tradeplan.ts — v1.3
//
// Trigger / stop / target / R-multiple, computed from fields the scanner
// already emits. No pivot extraction, no trendline fitting.
//
// THE STOP RULE: wider of 1.25x ADR or 2.5%.
//
//   ADR rather than ATR because ADR has no gap component. It measures the
//   intraday room a typical session offers, which is what a stop actually
//   has to survive. ATR includes overnight gaps and inflates the stop on
//   gappy names in a way that does not reflect intraday noise.
//
//   1.25x because a stop inside one average day's range gets taken out by
//   ordinary movement. Past ~1.5x the position size collapses.
//
//   The 2.5% floor catches low-ADR names where 1.25x would put the stop
//   inside the spread.
//
// THE TARGET: fixed 2R. Deliberately NOT level-based — a column reading
// 1.4R on one row and 4.2R on the next cannot be compared across rows.
//
// ---------------------------------------------------------------------------
// v1.1 — THE CLEAR-RUNWAY BUG
//
// v1.0 awarded its runway bonus to the worst names on the board: NBIZ at
// -53% and IREZ at -54% both came back "2R clear of overhead" and scored
// 88-A and 83-A. The logic found no level within 2R and called it open air.
// On a collapsed chart nothing IS within 2R — every average is far above.
//
// Fixed with a band: clear runway requires the nearest level to sit beyond
// the 2R target but within MAX_HEALTHY_RESISTANCE_R.
//
// ---------------------------------------------------------------------------
// v1.2 — NULL DEREFERENCE INTRODUCED BY v1.1
//
// v1.1 created a state v1.0 could not reach: clear === false WITH
// resistanceR === null, on short-history rows where no EMA resolves. Three
// call sites did `resistanceR!.toFixed(1)`, the assertion did nothing at
// runtime, and the whole scan route died. All formatting now goes through
// fx() and the non-null assertion operator is gone from this file.
//
// ---------------------------------------------------------------------------
// v1.3 — THE COLLAPSE CEILING FIRED ON A HEALTHY NAME
//
// v1.2 shipped and AVGO came back `collapsed: true`, capped at 44-C, scoring
// 22. AVGO was up 4.2%, sitting ABOVE its 10, 21 and 50 EMAs, tagged Trend
// Hold. Nothing about it was collapsed.
//
// The cause: its only overhead level was the prior swing high at 495, which
// sat 6.03R above the trigger. Past the 4R ceiling, so the code called it a
// broken chart.
//
// The ceiling was written to catch one specific shape — price has fallen so
// far that its own moving averages are miles overhead — and it cannot
// distinguish that from the opposite shape, where price has CLEARED all its
// averages and the next resistance is simply a long way up. Both produce
// "nearest overhead is very far above the trigger."
//
// The discriminator is position relative to the 21 EMA. A name trading above
// its 21 has not fallen away from its averages; it is above them. Distant
// resistance on such a name is runway, which is what the +8 exists for.
//
// So collapse now requires BOTH a far-off nearest level AND price under the
// 21 EMA. AVGO returns to clear/+8; NBIZ, IREZ and the rest are unaffected
// because they are all far below their 21s.
// ---------------------------------------------------------------------------

export type SetupFamily = 'reversal' | 'coil' | 'first-touch' | 'breakout' | 'generic';

export interface TradePlanInput {
  price: number | null | undefined;
  adrPct?: number | null;
  atrPct?: number | null;
  ema10?: number | null;
  ema21?: number | null;
  ema50?: number | null;
  dayHigh?: number | null;
  rangeHigh?: number | null;
  priorSwingHigh?: number | null;
  aboveEma10?: boolean | null;
  aboveEma21?: boolean | null;
  setupName?: string | null;
  changePct?: number | null;
}

export interface TradePlan {
  family: SetupFamily;
  trigger: number | null;
  triggerLabel: string;
  stop: number | null;
  stopPct: number | null;
  target: number | null;
  rMultiple: number;
  resistanceR: number | null;
  resistanceLabel: string | null;
  clear: boolean;
  collapsed: boolean;
  tradeable: boolean;
  note: string;
}

const STOP_ADR_MULT = 1.25;
const STOP_PCT_FLOOR = 2.5;
const TARGET_R = 2;

// Beyond this, a far-off nearest level MIGHT mean the chart is broken — but
// only when price is also under its 21 EMA. See the v1.3 note.
const MAX_HEALTHY_RESISTANCE_R = 4;

// A name down more than this today is not a long setup regardless of levels.
const COLLAPSE_CHANGE_PCT = -15;

const num = (v: any): number | null => {
  if (v == null || isNaN(Number(v))) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Every formatted number in this file goes through here. The v1.2 bug was a
// direct .toFixed() on a value that a new code path made nullable, so the
// formatting is centralised where the guard cannot be forgotten.
const fx = (v: number | null | undefined, places: number): string =>
  v == null || !Number.isFinite(v) ? '—' : v.toFixed(places);

export const familyOf = (setupName: string | null | undefined): SetupFamily => {
  const s = (setupName || '').toLowerCase();
  if (!s) return 'generic';
  if (s.includes('reversal') || s.includes('blue dot')) return 'reversal';
  if (s.includes('sqz building') || s.includes('vcp')) return 'coil';
  if (s.includes('ema pb') || s.includes('inside day')) return 'first-touch';
  if (s.includes('gap & go') || s.includes('r2g') || s.includes('sqz fired') ||
      s.includes('episodic') || s.includes('glb')) return 'breakout';
  return 'generic';
};

export function computeTradePlan(i: TradePlanInput): TradePlan {
  const empty = (note: string): TradePlan => ({
    family: familyOf(i.setupName),
    trigger: null, triggerLabel: '—',
    stop: null, stopPct: null, target: null,
    rMultiple: TARGET_R,
    resistanceR: null, resistanceLabel: null,
    clear: false, collapsed: false, tradeable: false, note,
  });

  const price = num(i.price);
  if (price == null || price <= 0) return empty('no price');

  const family = familyOf(i.setupName);

  const ema10 = num(i.ema10);
  const ema21 = num(i.ema21);
  const ema50 = num(i.ema50);
  const dayHigh = num(i.dayHigh);
  const rangeHigh = num(i.rangeHigh);
  const priorSwingHigh = num(i.priorSwingHigh);
  const changePct = num(i.changePct);

  // Position relative to the 21 EMA. Prefer the caller's boolean, fall back
  // to comparing price against the level. Null when neither resolves — and
  // null must NOT be treated as "below", or short-history rows would start
  // getting flagged as collapsed for missing data.
  const isBelow21: boolean | null =
    i.aboveEma21 === true ? false :
    i.aboveEma21 === false ? true :
    ema21 != null ? price < ema21 :
    null;

  // --- HARD REJECT: today's collapse -------------------------------------
  // A name down 15%+ on the session has no long plan worth computing. The
  // level geometry will happily produce one — trigger at the day high, stop
  // an ADR below, nothing overhead for miles — and every part of that is
  // technically true and practically useless.
  if (changePct != null && changePct <= COLLAPSE_CHANGE_PCT) {
    return {
      ...empty(`down ${fx(Math.abs(changePct), 1)}% today — no long plan`),
      family,
      collapsed: true,
    };
  }

  // --- TRIGGER ------------------------------------------------------------
  // A reversal's trigger is the line it has not taken yet. If price is under
  // both, the 10 is the first test; if it has reclaimed the 10, the 21 is
  // next. Using today's high instead would ignore the structure entirely.
  let trigger: number | null = null;
  let triggerLabel = '—';

  if (family === 'reversal') {
    if (i.aboveEma10 !== true && ema10 != null) {
      trigger = ema10; triggerLabel = '10 EMA';
    } else if (ema21 != null) {
      trigger = ema21; triggerLabel = '21 EMA';
    } else if (dayHigh != null) {
      trigger = dayHigh; triggerLabel = 'day high';
    }
  } else if (family === 'coil') {
    if (rangeHigh != null) { trigger = rangeHigh; triggerLabel = 'range high'; }
    else if (dayHigh != null) { trigger = dayHigh; triggerLabel = 'day high'; }
  } else {
    if (dayHigh != null) { trigger = dayHigh; triggerLabel = 'day high'; }
  }

  let triggerIsPrice = false;
  if (trigger == null) {
    trigger = price;
    triggerLabel = 'last';
    triggerIsPrice = true;
  }

  // Bound to a local const so nothing downstream has to reason about whether
  // the nullable `trigger` was assigned. The v1.2 class of bug starts with
  // "this cannot be null here" reasoning that later stops holding.
  const triggerPrice: number = trigger;

  // A trigger already far below price is not a trigger, it is history. The
  // entry has passed and chasing it is a different trade.
  if (triggerPrice < price * 0.97 && !triggerIsPrice) {
    return {
      ...empty('trigger already passed'),
      family, trigger: triggerPrice, triggerLabel,
    };
  }

  // --- STOP ---------------------------------------------------------------
  const adrPct = num(i.adrPct);
  const atrPct = num(i.atrPct);
  // ADR preferred. ATR is the fallback only because a row missing ADR is
  // usually a short-history name, and some stop beats none.
  const rangeBasis = adrPct ?? atrPct;
  if (rangeBasis == null || rangeBasis <= 0) {
    return { ...empty('no ADR/ATR to size a stop'), family, trigger: triggerPrice, triggerLabel };
  }

  const stopPct = Math.max(rangeBasis * STOP_ADR_MULT, STOP_PCT_FLOOR);
  const stop = triggerPrice * (1 - stopPct / 100);
  const riskPerShare = triggerPrice - stop;
  if (riskPerShare <= 0) {
    return { ...empty('stop resolved above trigger'), family, trigger: triggerPrice, triggerLabel };
  }

  const target = triggerPrice + riskPerShare * TARGET_R;

  // --- RESISTANCE ---------------------------------------------------------
  const overhead: { level: number; label: string }[] = [];
  const pushIfAbove = (lvl: number | null, label: string) => {
    if (lvl != null && lvl > triggerPrice * 1.001) overhead.push({ level: lvl, label });
  };
  pushIfAbove(ema10, '10 EMA');
  pushIfAbove(ema21, '21 EMA');
  pushIfAbove(ema50, '50 EMA');
  pushIfAbove(rangeHigh, 'range high');
  pushIfAbove(priorSwingHigh, 'prior high');

  overhead.sort((a, b) => a.level - b.level);
  const nearest = overhead.length > 0 ? overhead[0] : null;

  const resistanceR: number | null =
    nearest ? (nearest.level - triggerPrice) / riskPerShare : null;
  const resistanceLabel: string | null = nearest ? nearest.label : null;

  // --- CLEAR vs COLLAPSED -------------------------------------------------
  // Clear runway means the nearest level is far enough away that 2R is
  // reachable AND the chart is still intact.
  //
  // TWO distinct states produce resistanceR === null:
  //   - levels existed, price is above all of them  -> blue sky, clear
  //   - no levels resolved at all (short history)   -> unknown, NOT clear
  //
  // And v1.3's distinction: a far-off nearest level means opposite things
  // depending on which side of the 21 EMA price sits. Below it, price has
  // fallen away from its averages. Above it, price has cleared them and the
  // distance is runway. AVGO was the case that proved this — above all three
  // EMAs with its prior high 6R up, and v1.2 called it broken.
  const hadAnyLevel = ema10 != null || ema21 != null || ema50 != null;

  let clear: boolean;
  let collapsed = false;

  if (resistanceR == null) {
    clear = hadAnyLevel;
    collapsed = false;
  } else if (resistanceR > MAX_HEALTHY_RESISTANCE_R && isBelow21 === true) {
    // The genuine collapse shape: levels exist, the nearest is absurdly far
    // above, AND price is under its 21. Price has fallen off its averages.
    clear = false;
    collapsed = true;
  } else if (resistanceR > MAX_HEALTHY_RESISTANCE_R) {
    // Same geometry, opposite meaning — price is at or above the 21 and the
    // next level is a long way up. That is runway, not damage.
    clear = true;
    collapsed = false;
  } else {
    clear = resistanceR >= TARGET_R;
    collapsed = false;
  }

  // --- NOTE ---------------------------------------------------------------
  // Ordered so that every branch reading resistanceR has already established
  // it is non-null.
  let note: string;
  if (triggerIsPrice) {
    note = 'no level resolved — trigger is last price';
  } else if (collapsed && resistanceR != null) {
    note = `nearest level (${resistanceLabel}) is ${fx(resistanceR, 1)}R away and price is under its 21 EMA — fallen off its own averages, not clear runway`;
  } else if (resistanceR == null) {
    note = hadAnyLevel
      ? 'no overhead level — price is above every average'
      : 'no moving averages resolved — runway unknown';
  } else if (clear && resistanceR > MAX_HEALTHY_RESISTANCE_R) {
    note = `above the 21 EMA with nothing until ${resistanceLabel} at ${fx(resistanceR, 1)}R — open runway`;
  } else if (clear) {
    note = `${fx(TARGET_R, 1)}R clear, ${resistanceLabel} at ${fx(resistanceR, 1)}R`;
  } else {
    note = `${resistanceLabel} sits at ${fx(resistanceR, 1)}R — needs the level to break`;
  }

  return {
    family,
    trigger: triggerPrice,
    triggerLabel,
    stop,
    stopPct,
    target,
    rMultiple: TARGET_R,
    resistanceR,
    resistanceLabel,
    clear,
    collapsed,
    tradeable: true,
    note,
  };
}

// One-line summary for a table cell.
export const tradePlanShort = (p: TradePlan): string => {
  if (!p.tradeable) return p.collapsed ? 'collapsed' : '—';
  if (p.collapsed) return 'broken';
  if (p.clear) return `${fx(p.rMultiple, 1)}R clear`;
  if (p.resistanceR == null) return '—';
  return `${fx(p.resistanceR, 1)}R`;
};

// Multi-line detail for a title attribute.
export const tradePlanTooltip = (p: TradePlan): string => {
  if (!p.tradeable) return `No plan — ${p.note}.`;
  const lines: string[] = [];
  lines.push(`Trigger  ${fx(p.trigger, 2)}  (${p.triggerLabel})`);
  lines.push(`Stop     ${fx(p.stop, 2)}  (-${fx(p.stopPct, 1)}%)`);
  lines.push(`Target   ${fx(p.target, 2)}  (${fx(p.rMultiple, 1)}R)`);
  lines.push('');
  if (p.resistanceR != null) {
    lines.push(`Nearest overhead: ${p.resistanceLabel} at ${fx(p.resistanceR, 1)}R`);
  } else {
    lines.push('No overhead level between trigger and target.');
  }
  lines.push('');
  lines.push(p.note);
  lines.push('');
  lines.push('Stop is the wider of 1.25x ADR or 2.5%. Target is fixed 2R.');
  lines.push(`Resistance beyond ${MAX_HEALTHY_RESISTANCE_R}R reads as a broken chart only when price is under its 21 EMA.`);
  return lines.join('\n');
};
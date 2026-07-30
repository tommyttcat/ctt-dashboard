// src/lib/indicators/tradeplan.ts — v1.4
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
// ---------------------------------------------------------------------------
// v1.2 — NULL DEREFERENCE INTRODUCED BY v1.1
//
// v1.1 created a state v1.0 could not reach: clear === false WITH
// resistanceR === null. Three call sites did `resistanceR!.toFixed(1)`, the
// assertion did nothing at runtime, and the whole scan route died. All
// formatting now goes through fx(); the non-null assertion operator is gone.
//
// ---------------------------------------------------------------------------
// v1.3 — THE COLLAPSE CEILING FIRED ON A HEALTHY NAME
//
// AVGO came back collapsed and capped at 44-C while up 4.2% and sitting
// above its 10, 21 and 50 EMAs. Its only overhead was a prior high 6R up,
// which tripped the 4R ceiling. Collapse now also requires price to be under
// the 21 EMA — below it, distant resistance means price fell away from its
// averages; above it, price cleared them and the distance is runway.
//
// ---------------------------------------------------------------------------
// v1.4 — THE SAME BUG, MIRRORED: PARABOLIC NAMES SCORED AS CLEAR RUNWAY
//
// v1.3 fixed the healthy-name false positive and immediately exposed its
// opposite. PN closed 198% above its 21 EMA and scored 84-A. DFNS closed
// 262% above and scored 66-B. Both collected the full runway bonus on the
// note "no overhead level — price is above every average."
//
// Which is true, and useless. There is no resistance overhead because the
// stock has gone vertical and left every reference behind. The measurement
// that means "clear path to the target" on a normal chart means "nothing
// left to mark the way down" on a parabolic one.
//
// This is structurally identical to the v1.3 bug — one geometric fact,
// "nearest overhead is far away or absent," carrying opposite meaning
// depending on context. v1.3 keyed on being under the 21. v1.4 keys on being
// absurdly far ABOVE it.
//
// The threshold reuses the scanner's own extension rule: more than three
// ATRs above the 21 EMA. That is already the line at which the scanner says
// a stop cannot be sensibly placed, so it is the same judgment applied to
// the same question rather than a new number invented for this file.
//
// An overextended name returns clear:false with resistanceR untouched. In
// the route that lands on `planResistanceR == null -> runway 0` — no bonus,
// no penalty. Neutral is right: the runway is genuinely unknown, and the
// extension component already scores the extension itself.
//
// NOTE ON WHAT THIS DOES NOT FIX: PN will still grade near 76-A after this
// change. The remaining points come from RVOL 30 + gap 20 + range expansion
// 20 against an extension penalty that bottoms out at -12. A name 198% above
// its anchor arguably should not clear 70 on any input, but that is the
// extension cap's problem, not the runway term's.
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
  // v1.4: price is so far above its 21 EMA that the absence of overhead
  // resistance is altitude, not runway.
  overextended: boolean;
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

// Extension ceiling, in ATRs above the 21 EMA. Same rule the scanner uses
// for its own `extended` flag — reused deliberately rather than reinvented.
const MAX_ATRS_ABOVE_21 = 3;
// Fallback when ATR is missing. Blunt, but a name 25% above its 21 EMA is
// extended on any reasonable reading.
const MAX_PCT_ABOVE_21_NO_ATR = 25;

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
  if (s.includes('sqz building') || s.includes('vcp') || s.includes('coil')) return 'coil';
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
    clear: false, collapsed: false, overextended: false,
    tradeable: false, note,
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
  const atrPct = num(i.atrPct);

  // --- POSITION RELATIVE TO THE 21 EMA ------------------------------------
  // One computation feeding two opposite tests. Below the 21, distant
  // resistance means collapse (v1.3). Far above it, distant resistance means
  // parabolic (v1.4). Between those, it means runway.
  const extPctFrom21: number | null =
    ema21 != null && ema21 > 0 ? ((price - ema21) / ema21) * 100 : null;

  const isBelow21: boolean | null =
    i.aboveEma21 === true ? false :
    i.aboveEma21 === false ? true :
    extPctFrom21 != null ? extPctFrom21 < 0 :
    null;

  // Null when we cannot tell — a missing 21 EMA is not evidence of
  // extension, and treating it as such would penalise short-history rows.
  const overextended: boolean =
    extPctFrom21 == null ? false :
    atrPct != null && atrPct > 0
      ? extPctFrom21 > MAX_ATRS_ABOVE_21 * atrPct
      : extPctFrom21 > MAX_PCT_ABOVE_21_NO_ATR;

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

  // A trigger already far below price is not a trigger, it is history.
  if (triggerPrice < price * 0.97 && !triggerIsPrice) {
    return {
      ...empty('trigger already passed'),
      family, trigger: triggerPrice, triggerLabel, overextended,
    };
  }

  // --- STOP ---------------------------------------------------------------
  const adrPct = num(i.adrPct);
  // ADR preferred. ATR is the fallback only because a row missing ADR is
  // usually a short-history name, and some stop beats none.
  const rangeBasis = adrPct ?? atrPct;
  if (rangeBasis == null || rangeBasis <= 0) {
    return {
      ...empty('no ADR/ATR to size a stop'),
      family, trigger: triggerPrice, triggerLabel, overextended,
    };
  }

  const stopPct = Math.max(rangeBasis * STOP_ADR_MULT, STOP_PCT_FLOOR);
  const stop = triggerPrice * (1 - stopPct / 100);
  const riskPerShare = triggerPrice - stop;
  if (riskPerShare <= 0) {
    return {
      ...empty('stop resolved above trigger'),
      family, trigger: triggerPrice, triggerLabel, overextended,
    };
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

  // --- CLEAR vs COLLAPSED vs OVEREXTENDED ---------------------------------
  // Three ways to read the same geometry, ordered by which claim is
  // strongest. Overextension is checked FIRST because it can coexist with
  // "no overhead at all" — PN had no level above it precisely because it had
  // run 198% past its anchor, and the old ordering paid that a bonus.
  const hadAnyLevel = ema10 != null || ema21 != null || ema50 != null;

  let clear: boolean;
  let collapsed = false;

  if (overextended) {
    // Nothing overhead, but only because price left every reference behind.
    // Not clear, not collapsed — unknown, which scores as neutral upstream.
    clear = false;
    collapsed = false;
  } else if (resistanceR == null) {
    clear = hadAnyLevel;
    collapsed = false;
  } else if (resistanceR > MAX_HEALTHY_RESISTANCE_R && isBelow21 === true) {
    clear = false;
    collapsed = true;
  } else if (resistanceR > MAX_HEALTHY_RESISTANCE_R) {
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
  } else if (overextended) {
    note = `${fx(extPctFrom21, 0)}% above the 21 EMA — nothing overhead because price has left its averages behind, not because the path is clear`;
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
    overextended,
    tradeable: true,
    note,
  };
}

// One-line summary for a table cell.
export const tradePlanShort = (p: TradePlan): string => {
  if (!p.tradeable) return p.collapsed ? 'collapsed' : '—';
  if (p.collapsed) return 'broken';
  if (p.overextended) return 'extended';
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
  lines.push(`More than ${MAX_ATRS_ABOVE_21} ATRs above the 21 EMA reads as extended — absent resistance is altitude, not runway.`);
  return lines.join('\n');
};
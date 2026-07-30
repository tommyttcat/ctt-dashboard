// src/lib/indicators/tradeplan.ts — v1.0
//
// Trigger / stop / target / R-multiple, computed from fields the scanner
// already emits. No pivot extraction, no trendline fitting — this ships
// against the current payload.
//
// WHY THIS EXISTS: the dashboard had five ways to rank a name (CNF, RDY,
// posture, dots, ceilings) and no way to say where you get in, where you're
// wrong, and what the trade pays if it works. That gap is why a name like
// INTC could show a B grade on a 13% day while being untradeable — the stop
// was 11% away and nothing on the row said so.
//
// THE STOP RULE: wider of 1.25× ADR or 2.5%.
//
//   ADR rather than ATR because ADR has no gap component. It measures the
//   intraday room a typical session offers, which is what a stop actually
//   has to survive. ATR includes overnight gaps and inflates the stop on
//   gappy names in a way that does not reflect intraday noise.
//
//   1.25× because a stop inside one average day's range gets taken out by
//   ordinary movement. Past ~1.5× the position size collapses and the trade
//   stops being worth taking.
//
//   The 2.5% floor catches low-ADR names where 1.25× would put the stop
//   inside the spread.
//
// THE TARGET: fixed 2R.
//
//   Deliberately NOT level-based. The next EMA up or the prior swing high
//   are real levels, but they are not consistently reachable, and a column
//   that reads 1.4R on one row and 4.2R on the next cannot be compared
//   across rows. A fixed 2R turns the column into one question: can this
//   name travel two stop-widths before something stops it?
//
//   Which makes the ACTUAL output the resistance check — whether 2R is
//   clear, or whether a level sits inside it.

export type SetupFamily = 'reversal' | 'coil' | 'first-touch' | 'breakout' | 'generic';

export interface TradePlanInput {
  price: number | null | undefined;
  adrPct?: number | null;
  atrPct?: number | null;
  // Levels. Any that resolve are used for the trigger and the resistance
  // scan; missing ones are skipped rather than estimated.
  ema10?: number | null;
  ema21?: number | null;
  ema50?: number | null;
  dayHigh?: number | null;
  rangeHigh?: number | null;      // 10-day range high, consolidation rows
  priorSwingHigh?: number | null; // if the caller has one
  aboveEma10?: boolean | null;
  aboveEma21?: boolean | null;
  setupName?: string | null;
}

export interface TradePlan {
  family: SetupFamily;
  trigger: number | null;
  triggerLabel: string;
  stop: number | null;
  stopPct: number | null;        // distance from trigger, as % of trigger
  target: number | null;         // 2R above trigger
  rMultiple: number;             // fixed at 2 when a plan resolves
  // The number that actually filters: how far the nearest overhead level
  // sits, expressed in R. Null when nothing is overhead (clear runway).
  resistanceR: number | null;
  resistanceLabel: string | null;
  clear: boolean;                // is 2R reachable before resistance
  tradeable: boolean;            // did a full plan resolve
  note: string;
}

const STOP_ADR_MULT = 1.25;
const STOP_PCT_FLOOR = 2.5;
const TARGET_R = 2;

const num = (v: any): number | null => {
  if (v == null || isNaN(Number(v))) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

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
    clear: false, tradeable: false, note,
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

  // --- TRIGGER ------------------------------------------------------------
  // A reversal's trigger is the line it has not taken yet. If price is under
  // both, the 10 is the first test; if it has reclaimed the 10, the 21 is
  // next. Using today's high instead would ignore the structure entirely,
  // which is the mistake that made every reversal look the same.
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

  // Last resort: price itself. Flagged in the note so it is never mistaken
  // for a level someone chose.
  let triggerIsPrice = false;
  if (trigger == null) {
    trigger = price;
    triggerLabel = 'last';
    triggerIsPrice = true;
  }

  // A trigger already far below price is not a trigger, it is history. The
  // entry has passed and chasing it is a different trade than the one this
  // plan describes.
  if (trigger < price * 0.97 && !triggerIsPrice) {
    return {
      ...empty('trigger already passed'),
      family, trigger, triggerLabel,
    };
  }

  // --- STOP ---------------------------------------------------------------
  const adrPct = num(i.adrPct);
  const atrPct = num(i.atrPct);
  // ADR preferred. ATR is the fallback only because a row missing ADR is
  // usually a short-history name, and some stop beats none.
  const rangeBasis = adrPct ?? atrPct;
  if (rangeBasis == null || rangeBasis <= 0) {
    return { ...empty('no ADR/ATR to size a stop'), family, trigger, triggerLabel };
  }

  const stopPct = Math.max(rangeBasis * STOP_ADR_MULT, STOP_PCT_FLOOR);
  const stop = trigger * (1 - stopPct / 100);
  const riskPerShare = trigger - stop;
  if (riskPerShare <= 0) {
    return { ...empty('stop resolved above trigger'), family, trigger, triggerLabel };
  }

  const target = trigger + riskPerShare * TARGET_R;

  // --- RESISTANCE ---------------------------------------------------------
  // Everything overhead between the trigger and the 2R target. The nearest
  // one is what the trade has to get through, and its distance in R is the
  // number that decides whether 2R is realistic.
  const overhead: { level: number; label: string }[] = [];
  const pushIfAbove = (lvl: number | null, label: string) => {
    if (lvl != null && lvl > trigger! * 1.001) overhead.push({ level: lvl, label });
  };
  pushIfAbove(ema10, '10 EMA');
  pushIfAbove(ema21, '21 EMA');
  pushIfAbove(ema50, '50 EMA');
  pushIfAbove(rangeHigh, 'range high');
  pushIfAbove(priorSwingHigh, 'prior high');

  overhead.sort((a, b) => a.level - b.level);
  const nearest = overhead.length > 0 ? overhead[0] : null;

  let resistanceR: number | null = null;
  let resistanceLabel: string | null = null;
  if (nearest) {
    resistanceR = (nearest.level - trigger) / riskPerShare;
    resistanceLabel = nearest.label;
  }

  const clear = resistanceR == null || resistanceR >= TARGET_R;

  let note: string;
  if (triggerIsPrice) {
    note = 'no level resolved — trigger is last price';
  } else if (clear) {
    note = `${TARGET_R}R clear of overhead`;
  } else {
    note = `${resistanceLabel} sits at ${resistanceR!.toFixed(1)}R — needs the level to break`;
  }

  return {
    family,
    trigger,
    triggerLabel,
    stop,
    stopPct,
    target,
    rMultiple: TARGET_R,
    resistanceR,
    resistanceLabel,
    clear,
    tradeable: true,
    note,
  };
}

// One-line summary for a table cell.
export const tradePlanShort = (p: TradePlan): string => {
  if (!p.tradeable) return '—';
  if (p.clear) return `${p.rMultiple.toFixed(1)}R clear`;
  return `${p.resistanceR!.toFixed(1)}R`;
};

// Multi-line detail for a title attribute.
export const tradePlanTooltip = (p: TradePlan): string => {
  if (!p.tradeable) return `No plan — ${p.note}.`;
  const lines: string[] = [];
  lines.push(`Trigger  ${p.trigger!.toFixed(2)}  (${p.triggerLabel})`);
  lines.push(`Stop     ${p.stop!.toFixed(2)}  (−${p.stopPct!.toFixed(1)}%)`);
  lines.push(`Target   ${p.target!.toFixed(2)}  (${p.rMultiple.toFixed(1)}R)`);
  lines.push('');
  if (p.resistanceR != null) {
    lines.push(`Nearest overhead: ${p.resistanceLabel} at ${p.resistanceR.toFixed(1)}R`);
  } else {
    lines.push('No overhead level between trigger and target.');
  }
  lines.push('');
  lines.push(p.note);
  lines.push('');
  lines.push('Stop is the wider of 1.25× ADR or 2.5%. Target is fixed 2R.');
  return lines.join('\n');
};
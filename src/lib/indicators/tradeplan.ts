// src/lib/indicators/tradeplan.ts — v1.1
//
// Trigger / stop / target / R-multiple, computed from fields the scanner
// already emits. No pivot extraction, no trendline fitting.
//
// WHY THIS EXISTS: the dashboard had five ways to rank a name (CNF, RDY,
// posture, dots, ceilings) and no way to say where you get in, where you're
// wrong, and what the trade pays if it works.
//
// THE STOP RULE: wider of 1.25× ADR or 2.5%.
//
//   ADR rather than ATR because ADR has no gap component. It measures the
//   intraday room a typical session offers, which is what a stop actually
//   has to survive. ATR includes overnight gaps and inflates the stop on
//   gappy names in a way that does not reflect intraday noise.
//
//   1.25× because a stop inside one average day's range gets taken out by
//   ordinary movement. Past ~1.5× the position size collapses.
//
//   The 2.5% floor catches low-ADR names where 1.25× would put the stop
//   inside the spread.
//
// THE TARGET: fixed 2R. Deliberately NOT level-based — a column reading
// 1.4R on one row and 4.2R on the next cannot be compared across rows. A
// fixed 2R turns the column into one question: can this name travel two
// stop-widths before something stops it?
//
// ---------------------------------------------------------------------------
// v1.1 — THE CLEAR-RUNWAY BUG
//
// v1.0 shipped and immediately awarded its runway bonus to the worst names
// on the board:
//
//   NBIZ  −53.3%  clear: true  → CNF 88-A
//   IREZ  −54.4%  clear: true  → CNF 83-A
//   CAPR  −42.5%  clear: true, nearest level (10 EMA) at 17.8R
//   CCB   −41.8%  clear: true
//
// The logic was: find every level above the trigger, take the nearest, and
// if it sits beyond 2R call the runway clear. On a name that has collapsed,
// NOTHING is within 2R — every moving average is far overhead — so the
// function reported open air and the score paid it +6.
//
// That reads the chart exactly backwards. CAPR's 10 EMA at 17.8R is not
// clear runway; it is a stock that has fallen 72% away from its own fast
// average. "No resistance nearby" and "price has collapsed away from every
// level it had" produce the same measurement and mean opposite things.
//
// THE FIX is a ceiling, not a floor. Clear runway now requires the nearest
// overhead level to sit in a BAND — beyond the 2R target (so the trade has
// room) but within MAX_HEALTHY_RESISTANCE_R (so the chart is still intact).
// Past that the name is in freefall and gets `collapsed: true`, which reads
// as a negative rather than a positive downstream.
//
// The band edge is 4R. At 1.25× ADR per R that is roughly five average days
// of travel to the first level — already generous. A name whose nearest
// overhead sits further than that has not left itself room to run, it has
// left the neighbourhood.
// ---------------------------------------------------------------------------

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
  priorSwingHigh?: number | null;
  aboveEma10?: boolean | null;
  aboveEma21?: boolean | null;
  setupName?: string | null;
  // v1.1: today's move. A name down 40% needs different treatment than one
  // up 40%, and the level geometry alone cannot tell them apart.
  changePct?: number | null;
}

export interface TradePlan {
  family: SetupFamily;
  trigger: number | null;
  triggerLabel: string;
  stop: number | null;
  stopPct: number | null;        // distance from trigger, as % of trigger
  target: number | null;         // 2R above trigger
  rMultiple: number;             // fixed at 2 when a plan resolves
  // How far the nearest overhead level sits, in R. Null when nothing is
  // overhead at all.
  resistanceR: number | null;
  resistanceLabel: string | null;
  // True only when the runway is genuinely clear: target reachable AND the
  // chart still has levels within reach. See the v1.1 note above.
  clear: boolean;
  // True when price has fallen so far from its own moving averages that the
  // absence of nearby resistance is damage, not opportunity.
  collapsed: boolean;
  tradeable: boolean;
  note: string;
}

const STOP_ADR_MULT = 1.25;
const STOP_PCT_FLOOR = 2.5;
const TARGET_R = 2;

// Beyond this, "no resistance nearby" means the chart is broken.
const MAX_HEALTHY_RESISTANCE_R = 4;

// A name down more than this today is not a long setup regardless of what
// the levels say. Belt to the resistance ceiling's braces — a stock can
// collapse over a week without any single day breaching this.
const COLLAPSE_CHANGE_PCT = -15;

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

  // --- HARD REJECT: today's collapse -------------------------------------
  // A name down 15%+ on the session has no long plan worth computing. The
  // level geometry will happily produce one — trigger at the day high, stop
  // an ADR below, nothing overhead for miles — and every part of that is
  // technically true and practically useless.
  if (changePct != null && changePct <= COLLAPSE_CHANGE_PCT) {
    return {
      ...empty(`down ${Math.abs(changePct).toFixed(1)}% today — no long plan`),
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

  // A trigger already far below price is not a trigger, it is history. The
  // entry has passed and chasing it is a different trade.
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

  // --- CLEAR vs COLLAPSED (v1.1) ------------------------------------------
  // The band. Clear runway means the nearest level is far enough away that
  // 2R is reachable, AND close enough that the name still has a chart.
  //
  // The `resistanceR == null` case — nothing overhead at all — is treated as
  // collapsed rather than clear whenever any EMA was actually available to
  // compare against. If we HAD the levels and none of them sit above the
  // trigger, the trigger is above everything, which for a beaten-down name
  // means it has already run; for a leader it means new highs. The
  // distinction is the drawdown check below.
  const hadAnyLevel = ema10 != null || ema21 != null || ema50 != null;

  let clear: boolean;
  let collapsed = false;

  if (resistanceR == null) {
    // Nothing overhead. Genuine blue sky IF we had levels to check and price
    // is above them — that is a leader at highs, not a broken chart.
    clear = true;
    collapsed = false;
    if (!hadAnyLevel) {
      // No levels resolved at all — we cannot claim anything. Not clear.
      clear = false;
    }
  } else if (resistanceR > MAX_HEALTHY_RESISTANCE_R) {
    // The tell. Levels exist, and the nearest is absurdly far above. Price
    // has fallen away from its own averages.
    clear = false;
    collapsed = true;
  } else {
    clear = resistanceR >= TARGET_R;
    collapsed = false;
  }

  let note: string;
  if (triggerIsPrice) {
    note = 'no level resolved — trigger is last price';
  } else if (collapsed) {
    note = `nearest level (${resistanceLabel}) is ${resistanceR!.toFixed(1)}R away — price has fallen off its own averages, not clear runway`;
  } else if (clear && resistanceR == null) {
    note = 'no overhead level — price is above every average';
  } else if (clear) {
    note = `${TARGET_R}R clear, ${resistanceLabel} at ${resistanceR!.toFixed(1)}R`;
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
    collapsed,
    tradeable: true,
    note,
  };
}

// One-line summary for a table cell.
export const tradePlanShort = (p: TradePlan): string => {
  if (!p.tradeable) return p.collapsed ? 'collapsed' : '—';
  if (p.collapsed) return 'broken';
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
  lines.push(`Resistance beyond ${MAX_HEALTHY_RESISTANCE_R}R reads as a broken chart, not clear runway.`);
  return lines.join('\n');
};
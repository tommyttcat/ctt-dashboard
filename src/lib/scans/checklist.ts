// lib/scans/checklist.ts — the site's colours as a trader's checklist (12 Oct 2026).
//
// The owner trades two ways: DAY trades, and SWINGS of 3-5 days that let runners run. The
// colours are those two checklists, read off fields the scan rows already carry — no model,
// no extra data. GREEN = go, YELLOW = look, RED = stay away. Every colour comes with the list
// of checks it passed (✔), failed (✖) or could not check on that row (–).
//
// These are rules traders use, not a tested edge: every mechanical test of entries on our
// data lost to holding QQQ (scripts/backtest/*). The red rules each scan already had were
// measured and still win.
//
// SWING (every card except the intraday ones):
//   GREEN  uptrend (above a rising 21 EMA and the 50) · within 1 ADR of the 10 or 21 EMA
//          · RS 70+ · QQQ above its 200-day
//   RED    below the 50 (or Stage 3/4) · more than 3 ADRs above the 21 EMA · earnings within
//          3 days · QQQ below its 200-day
//   YELLOW anything else (stretched 1-3 ADRs, RS 50-69, 21 EMA flat or falling)
// DAY (Stocks in Play, EP9M, Early Movers):
//   GREEN  up today · volume pace 2x+ usual (RVOL scaled to the share of the session gone) · price in the top half of today's range · above the
//          open · ADR 4%+ · $20M+ traded
//   RED    down today · volume under 1.5x · below the open
//   YELLOW in play but fading (bottom half of the range) or volume 1.5-2x, or a thin range

import type { EdgeTier } from './edge';

export type Mode = 'swing' | 'day';
export type Check = { label: string; ok: boolean | null };
export type Checked = { tier: EdgeTier; checks: Check[]; reds: string[] };

/* QQQ above its 200-day — set on the client from /api/exposure/latest (lib/modelScores);
   null on the server or before it loads, and then the market line reads "not checked". */
let marketUp: boolean | null = null;
const marketListeners = new Set<() => void>();
export const setMarketUp = (v: boolean | null) => { marketUp = v; marketListeners.forEach(f => f()); };
export const marketIsUp = () => marketUp;
export const onMarket = (f: () => void) => { marketListeners.add(f); return () => { marketListeners.delete(f); }; };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
type Row = Record<string, unknown>;

function adrOf(r: Row): number | null { return num(r.adrPct) ?? num(r.atrPct); }
function stageOf(r: Row): string { return String(r.stage ?? '').replace(/^Stage\s*/i, '').trim(); }

/** Days from today (ET date) to the row's next earnings date; null when unknown. */
export function daysToEarnings(r: Row, today: string = new Date().toISOString().slice(0, 10)): number | null {
  const d = typeof r.earningsDate === 'string' ? r.earningsDate.slice(0, 10) : null;
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return Math.round((Date.parse(d) - Date.parse(today)) / 864e5);
}

export function swingCheck(r: Row | null | undefined, ruleRed = false, today?: string): Checked | null {
  if (!r) return null;
  const price = num(r.price), e50 = num(r.ema50), rising = typeof r.ema21Rising === 'boolean' ? r.ema21Rising : null;
  const stage = stageOf(r), adr = adrOf(r), d21 = num(r.distToEma21), d10 = num(r.distToEma10);
  const rs = num(r.rsRating) ?? num(r.rs);

  let uptrend: boolean | null = null;
  if (rising != null && price != null && e50 != null) uptrend = rising && price > e50;
  else if (stage) uptrend = stage.startsWith('2');
  if (uptrend && stage && !stage.startsWith('2')) uptrend = false;   // a known Stage 1/3/4 is not an uptrend
  const below50 = price != null && e50 != null ? price < e50 : stage ? /^[34]/.test(stage) : false;
  const stretch = d21 != null && adr != null && adr > 0 ? d21 / adr : null;
  const near = stretch != null ? Math.min(Math.abs(d21 as number), d10 != null ? Math.abs(d10) : Infinity) / (adr as number) <= 1 : null;
  const dte = daysToEarnings(r, today);
  const mkt = marketUp;

  const checks: Check[] = [
    { label: 'Uptrend (rising 21 EMA, above the 50)', ok: uptrend },
    { label: stretch != null ? `Near the 10/21 EMA (${stretch >= 0 ? '+' : ''}${stretch.toFixed(1)} ADR from the 21)` : 'Near the 10/21 EMA', ok: near },
    { label: rs != null ? `RS 70+ (${Math.round(rs)})` : 'RS 70+', ok: rs != null ? rs >= 70 : null },
    { label: 'QQQ above its 200-day', ok: mkt },
  ];
  const reds: string[] = [];
  if (ruleRed) reds.push("this scan's own red rule");
  if (below50) reds.push('below the 50-day');
  if (stretch != null && stretch > 3) reds.push(`${stretch.toFixed(1)} ADRs above the 21 EMA — blow-off`);
  if (dte != null && dte >= 0 && dte <= 3) reds.push(`earnings in ${dte} day${dte === 1 ? '' : 's'}`);
  if (mkt === false) reds.push('QQQ below its 200-day');

  const tier: EdgeTier = reds.length ? 'red'
    : uptrend === true && near === true && rs != null && rs >= 70 && mkt !== false ? 'green'   // 'not checked' never makes green
    : 'yellow';
  return { tier, checks, reds };
}

/** Minutes since midnight on a New York clock. */
export function etMinuteNow(d: Date = new Date()): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).map(x => [x.type, x.value]));
  return (Number(p.hour) % 24) * 60 + Number(p.minute);
}
/* A scan row's RVOL is volume so far against a whole average day, so at 11:00 even a hot name
   reads 0.5x. During the session it is scaled to the share of the day gone (the pace), with a
   15-minute floor; before the open and after the close it is left as it is. Early Movers rows
   already carry a pace. */
export function paceOf(rvol: number | null, etMin: number, alreadyPace = false): number | null {
  if (rvol == null || alreadyPace || etMin < 570 || etMin >= 960) return rvol;
  return rvol / (Math.max(15, etMin - 570) / 390);
}

/* The scans' own red rules were measured on 20-session holds (a wide range, $5-10), so the
   day checklist ignores them — a +100% gapper on a 60% ADR is exactly what it is for. */
export function dayCheck(r: Row | null | undefined, _ruleRed = false, etMin: number = etMinuteNow()): Checked | null {
  if (!r) return null;
  const price = num(r.price), chg = num(r.changePct), adr = adrOf(r), open = num(r.open);
  const rvol = paceOf(num(r.rvol), etMin, r._early === true);
  const dvol = num(r.dVol) ?? num(r.dvol) ?? (num(r.avgDollarVolM) != null ? (num(r.avgDollarVolM) as number) * 1e6 : null);
  let cs = num(r.closeStrength);
  if (cs == null) { const hi = num(r.dayHigh), lo = num(r.dayLow); if (price != null && hi != null && lo != null && hi > lo) cs = (price - lo) / (hi - lo); }
  const aboveOpen = price != null && open != null ? price > open : null;

  const checks: Check[] = [
    { label: chg != null ? `Up today (${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%)` : 'Up today', ok: chg != null ? chg > 0 : null },
    { label: rvol != null ? `Volume pace 2x+ usual (${rvol.toFixed(1)}x)` : 'Volume pace 2x+ usual', ok: rvol != null ? rvol >= 2 : null },
    { label: cs != null ? `Holding — top half of today's range (${Math.round(cs * 100)}%)` : "Holding — top half of today's range", ok: cs != null ? cs >= 0.5 : null },
    { label: 'Above the open', ok: aboveOpen },
    { label: adr != null ? `Moves enough — ADR 4%+ (${adr.toFixed(1)}%)` : 'Moves enough — ADR 4%+', ok: adr != null ? adr >= 4 : null },
    { label: '$20M+ traded', ok: dvol != null ? dvol >= 20e6 : null },
  ];
  const reds: string[] = [];
  if (chg != null && chg < 0) reds.push('down today');
  if (rvol != null && rvol < 1.5) reds.push('volume pace under 1.5x usual');
  if (aboveOpen === false) reds.push('below the open');

  const passes = (i: number) => checks[i].ok !== false;
  const tier: EdgeTier = reds.length ? 'red'
    : checks[0].ok === true && checks[1].ok === true && passes(2) && passes(3) && passes(4) && passes(5) ? 'green'
    : 'yellow';
  return { tier, checks, reds };
}

export function check(mode: Mode, r: Row | null | undefined, ruleRed = false): Checked | null {
  return mode === 'day' ? dayCheck(r, ruleRed) : swingCheck(r, ruleRed);
}

const WORD: Record<EdgeTier, string> = { green: 'GO', yellow: 'LOOK', red: 'STAY AWAY' };

/** One line for a tooltip: the verdict, then ✔ / ✖ / – per check, then why it is red. */
export function checkTip(mode: Mode, c: Checked | null): string {
  if (!c) return '';
  const head = `${WORD[c.tier]} (${mode === 'day' ? 'day-trade' : 'swing'} checklist)`;
  const lines = c.checks.map(k => `${k.ok === true ? '✔' : k.ok === false ? '✖' : '–'} ${k.label}`);
  const red = c.reds.length ? [`Red because: ${c.reds.join('; ')}`] : [];
  return [head, ...red, ...lines].join('\n');
}

/** What each colour means, per checklist — the filter pills' help text. */
export const CHECKLIST_TIP: Record<Mode, Record<EdgeTier, string>> = {
  swing: {
    green: 'GO (swing, 3-5 days, let runners run): Stage 2 uptrend — above a rising 21 EMA and the 50 — within 1 ADR of the 10 or 21 EMA (not chasing), RS 70+, and QQQ above its 200-day. Every check must pass; a row that cannot be checked for stretch stays yellow. A checklist traders use, not a tested edge. Hover a row for its ✔ / ✖.',
    yellow: 'LOOK (swing): in an uptrend but stretched 1-3 ADRs above the 21 EMA, RS 50-69, or the 21 EMA not rising. Wait for a pullback toward the 10/21.',
    red: "STAY AWAY (swing): below the 50-day, more than 3 ADRs above the 21 EMA (blow-off), earnings within 3 days, QQQ below its 200-day — or this scan's own red rule.",
  },
  day: {
    green: 'GO (day trade): up today on 2x+ usual volume, holding the top half of today\'s range and above the open, ADR 4%+ and $20M+ traded. A checklist traders use, not a tested edge. Hover a row for its ✔ / ✖.',
    yellow: 'LOOK (day trade): in play but fading into the bottom half of the range, volume only 1.5-2x, or the range is thin.',
    red: 'STAY AWAY (day trade): down today, below the open, or volume running under 1.5x its usual pace. (The scans\' 20-day red rules do not apply to day trades.)',
  },
};

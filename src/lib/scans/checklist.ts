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
// SWING (every card; tightened 15 Oct 2026 after TWLO went green closing under its 10 and 21):
//   GREEN  every core check PASSED, none merely unchecked: uptrend (above a rising 21 EMA and
//          the 50) · 10 EMA above the 21 · holding the 21 and within 1 ADR of the 10 or 21 ·
//          RS 70+ · volume drying up. Also, when known: within 25% of the 52-week high, no
//          lower high (a bounce that failed under the recent peak), no heavy-volume selling today, industry group top third, QQQ above its 200-day
//   RED    below the 50 (or Stage 3/4) · under the 21 with the 10 below it or the 21 falling ·
//          RS under 50 · more than 3 ADRs above the 21 EMA · earnings within 3 days · QQQ
//          below its 200-day
//   YELLOW anything else: in an uptrend with one thing off, or not enough data to say
// DAY (Stocks in Play, Daily Setups, EP9M, Top Movers, Early Movers — 26 Oct 2026: back on the
// day cards; the swing checklist painted every in-play name red on a bounce day):
//   GREEN  up today · volume pace 1.5x+ usual (RVOL scaled to the share of the session gone AT
//          THE DATA'S TIME — rvolPace from the scan) · top half of today's range · above the open
//          · ADR 4%+ · $20M+ traded. Catalyst and "neglected before today" are shown, not required.
//   RED    down today · below the open · volume pace under 1x
//   YELLOW in play but fading, volume 1-1.5x, or a thin range

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

/* Upcoming earnings dates by ticker (/api/earnings/upcoming) and industry-group terciles
   (0 = top third of 2-digit SIC groups by 3-month return; /api/system/scores `group`). Both
   set on the client; on the server, rows carry their own earningsDate and groups read null. */
let earnings: Record<string, string> | null = null;
let groups: Record<string, number> | null = null;
export const setEarnings = (m: Record<string, string> | null) => { earnings = m; marketListeners.forEach(f => f()); };
export const setGroups = (m: Record<string, number> | null) => { groups = m; marketListeners.forEach(f => f()); };
export const earningsLoaded = () => earnings != null;
const tickerOf = (r: Row): string => String(r.ticker ?? r.symbol ?? r.t ?? '').toUpperCase();
/** 0 = top third of industry groups, 1 middle, 2 bottom; null = not classified. */
export const groupOf = (r: Row): number | null => { const g = groups?.[tickerOf(r)]; return typeof g === 'number' ? g : null; };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
type Row = Record<string, unknown>;

function adrOf(r: Row): number | null { return num(r.adrPct) ?? num(r.atrPct); }
function stageOf(r: Row): string { return String(r.stage ?? '').replace(/^Stage\s*/i, '').trim(); }

/** Days from today (ET date) to the row's next earnings date; null when unknown. */
export function daysToEarnings(r: Row, today: string = new Date().toISOString().slice(0, 10)): number | null {
  const own = typeof r.earningsDate === 'string' ? r.earningsDate : null;
  const d = (own ?? earnings?.[tickerOf(r)] ?? null)?.slice(0, 10) ?? null;
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return Math.round((Date.parse(d) - Date.parse(today)) / 864e5);
}

export function swingCheck(r: Row | null | undefined, ruleRed = false, today?: string, etMin: number = etMinuteNow()): Checked | null {
  if (!r) return null;
  const price = num(r.price), e50 = num(r.ema50), rising = typeof r.ema21Rising === 'boolean' ? r.ema21Rising : null;
  const stage = stageOf(r), adr = adrOf(r), d21 = num(r.distToEma21), d10 = num(r.distToEma10);
  const rs = num(r.rsRating) ?? num(r.rs);

  /* Uptrend needs the EMAs themselves (15 Oct 2026). A stage label alone used to pass it, so
     rows missing the 50 and the 21's slope could go green on one distance. */
  let uptrend: boolean | null = null;
  if (rising != null && price != null && e50 != null) uptrend = rising && price > e50;
  if (uptrend && stage && !stage.startsWith('2')) uptrend = false;   // a known Stage 1/3/4 is not an uptrend
  if (uptrend == null && stage && !stage.startsWith('2')) uptrend = false;
  const below50 = price != null && e50 != null ? price < e50 : stage ? /^[34]/.test(stage) : false;
  const stretch = d21 != null && adr != null && adr > 0 ? d21 / adr : null;
  /* Holding the 21 (15 Oct 2026): "near" used to be distance either side, so a stock that had
     just closed BELOW its 10 and 21 (TWLO) read the same as one bouncing off them. Now price
     must be at or above the 21; a dip under the 10 while the 21 holds is still a pullback. */
  const above21 = d21 != null ? d21 >= 0 : null;
  const near = stretch == null ? null
    : above21 === false ? false
    : Math.min(d21 as number, d10 != null ? Math.abs(d10) : Infinity) / (adr as number) <= 1;
  /* 10 EMA over the 21: the short-term trend still pointing up. Read from the EMAs or
     backed out of the two distances (same price). */
  const e10 = num(r.ema10) ?? (price != null && d10 != null ? price / (1 + d10 / 100) : null);
  const e21 = num(r.ema21) ?? (price != null && d21 != null ? price / (1 + d21 / 100) : null);
  const tenOver21 = e10 != null && e21 != null ? e10 >= e21 : null;
  /* Leaders trade near their highs; 25% off the 52-week high is the usual line. Scans sign
     this field differently, hence the abs. */
  const offRaw = num(r.pctOffHigh) ?? num(r.pctBelow52wHigh);
  const offHigh = offRaw != null ? Math.abs(offRaw) : null;
  /* Selling today: down on 1.5x+ the usual volume pace — distribution, not a quiet pullback. */
  const chg = num(r.changePct);
  const pace = paceOf(num(r.rvol), etMin);
  const heavySelling = chg != null && pace != null ? chg < 0 && pace >= 1.5 : null;
  /* Lower high (lib/scans/tightness lowerHighOf): the row carries the failed bounce high, or 0
     for none. Tested against the row's own (live) price, so getting back above it today clears
     it. */
  const lhAt = num(r.lowerHigh);
  const lowerHigh = lhAt == null ? null : lhAt > 0 && price != null ? price < lhAt : false;
  const dte = daysToEarnings(r, today);
  const mkt = marketUp;
  const grp = groupOf(r);
  /* Volume drying up: the last 3 sessions at 0.8x the 20-day average or less (fields from the
     scan's own bars). Tightness (the 5-day range in ADRs) is shown but NOT required since
     12 Oct 2026: the 10/21 backtest found tight coils (under 2.5x ATR) LOST money and wider
     coils pressed at their highs won (lib/scans/edge CONSOLIDATION_TIP), so requiring it
     blocked the names the evidence favours. */
  const t5 = num(r.tight5), vd = num(r.volDry);
  const tight = vd == null ? null : vd <= 0.8;

  const checks: Check[] = [
    { label: 'Uptrend (rising 21 EMA, above the 50)', ok: uptrend },
    { label: '10 EMA above the 21 (short-term trend up)', ok: tenOver21 },
    { label: stretch != null ? `Holding the 21 EMA, within 1 ADR of the 10/21 (${stretch >= 0 ? '+' : ''}${stretch.toFixed(1)} ADR from the 21)` : 'Holding the 21 EMA, within 1 ADR of the 10/21', ok: near },
    { label: rs != null ? `RS 70+ (${Math.round(rs)})` : 'RS 70+', ok: rs != null ? rs >= 70 : null },
    { label: offHigh != null ? `Within 25% of the 52-week high (${offHigh.toFixed(0)}% off)` : 'Within 25% of the 52-week high', ok: offHigh != null ? offHigh <= 25 : null },
    { label: lowerHigh ? `No lower high (last bounce failed at ${lhAt}, under the recent peak)` : 'No lower high (last bounce got back to the peak)', ok: lowerHigh == null ? null : !lowerHigh },
    { label: chg != null && pace != null ? `No heavy selling today (${chg >= 0 ? '+' : ''}${chg.toFixed(1)}% on ${pace.toFixed(1)}x volume pace)` : 'No heavy selling today', ok: heavySelling == null ? null : !heavySelling },
    { label: 'QQQ above its 200-day', ok: mkt },
    { label: 'Industry group in the top third (3-month)', ok: grp == null ? null : grp === 0 },
    { label: vd != null ? `Volume drying up (last 3 days ${vd.toFixed(1)}x usual)` : 'Volume drying up', ok: tight },
    { label: t5 != null ? `5-day range ${t5.toFixed(1)} ADR (info only — tightness is not required)` : '5-day range (info only)', ok: null },
    { label: dte != null && dte >= 0 ? `No earnings within 3 days (${dte}d)` : 'No earnings within 3 days', ok: dte == null ? (earnings ? true : null) : !(dte >= 0 && dte <= 3) },
  ];
  const reds: string[] = [];
  if (ruleRed) reds.push("this scan's own red rule");
  if (below50) reds.push('below the 50-day');
  /* Lost the 21 with the short-term trend turned (15 Oct 2026): under the 21 and either the
     10 has crossed below it or the 21 itself is falling. Not a pullback any more. */
  if (above21 === false && (tenOver21 === false || rising === false)) reds.push('below the 21 EMA with the 10 under it or the 21 falling — short-term downtrend');
  if (rs != null && rs < 50) reds.push(`RS ${Math.round(rs)} — lagging the market`);
  if (stretch != null && stretch > 3) reds.push(`${stretch.toFixed(1)} ADRs above the 21 EMA — blow-off`);
  if (dte != null && dte >= 0 && dte <= 3) reds.push(`earnings in ${dte} day${dte === 1 ? '' : 's'}`);
  if (mkt === false) reds.push('QQQ below its 200-day');

  /* Green needs the core checks actually PASSED (15 Oct 2026) — trend, 10 over 21, holding
     the 21, RS, volume drying up. A check that could not be run used to count as a pass, so
     rows missing half their fields went green. Distance from the high and today's selling
     block green when known; a row that does not carry them is not held back by them. */
  const core = uptrend === true && tenOver21 === true && near === true && rs != null && rs >= 70 && tight === true;
  const clear = (offHigh == null || offHigh <= 25) && heavySelling !== true && lowerHigh !== true && mkt !== false && grp !== 1 && grp !== 2;
  const tier: EdgeTier = reds.length ? 'red' : core && clear ? 'green' : 'yellow';
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
  /* rvolPace: the scan's own pace at its data's minute (26 Oct 2026). Scaling the raw RVOL by the
     page's clock under-read every row by the scan's age plus the feed's 15-minute delay. */
  const rvol = num(r.rvolPace) ?? paceOf(num(r.rvol), etMin, r._early === true);
  const dvol = num(r.dVol) ?? num(r.dvol) ?? (num(r.avgDollarVolM) != null ? (num(r.avgDollarVolM) as number) * 1e6 : null);
  let cs = num(r.closeStrength);
  if (cs == null) { const hi = num(r.dayHigh), lo = num(r.dayLow); if (price != null && hi != null && lo != null && hi > lo) cs = (price - lo) / (hi - lo); }
  const aboveOpen = price != null && open != null ? price > open : null;
  /* A real catalyst: a specific news tag (not 'Technical Momentum' / 'News') or news the
     scan judged to have caused the move. Rows with no news fields at all read "not checked". */
  const tag = typeof r.catalyst === 'string' ? r.catalyst.replace(/\s*\(Delayed\)\s*$/i, '').trim().toLowerCase() : '';
  const generic = !tag || tag.startsWith('technical') || tag === 'news' || tag === 'recent news';
  const newsKnown = 'catalyst' in r || 'newsCausal' in r || 'headline' in r;
  const catalyst = (!generic || r.newsCausal === true) ? true : newsKnown ? false : null;
  /* Neglected before today (lib/scans/neglect): hadn't run (3-mo <= +15%, 6-mo <= +30%) and
     was quiet (60-day range under 60%). Rows from scans that do not compute it read "–". */
  const neglected = typeof r.neglected === 'boolean' ? r.neglected : null;
  const p3 = num(r.preRun3m), p6 = num(r.preRun6m);

  const checks: Check[] = [
    { label: chg != null ? `Up today (${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%)` : 'Up today', ok: chg != null ? chg > 0 : null },
    { label: rvol != null ? `Volume pace 1.5x+ usual (${rvol.toFixed(1)}x)` : 'Volume pace 1.5x+ usual', ok: rvol != null ? rvol >= 1.5 : null },
    { label: cs != null ? `Holding — top half of today's range (${Math.round(cs * 100)}%)` : "Holding — top half of today's range", ok: cs != null ? cs >= 0.5 : null },
    { label: 'Above the open', ok: aboveOpen },
    { label: adr != null ? `Moves enough — ADR 4%+ (${adr.toFixed(1)}%)` : 'Moves enough — ADR 4%+', ok: adr != null ? adr >= 4 : null },
    { label: '$20M+ traded', ok: dvol != null ? dvol >= 20e6 : null },
    { label: catalyst ? `Catalyst — ${typeof r.catalyst === 'string' && !generic ? r.catalyst : 'news behind the move'} (info)` : 'Catalyst (real news behind the move) (info — not required)', ok: catalyst },
    { label: p3 != null ? `Neglected before today (3-mo ${p3 >= 0 ? '+' : ''}${p3}%, 6-mo ${p6 != null && p6 >= 0 ? '+' : ''}${p6 ?? '–'}%) (info)` : 'Neglected before today (info — not required)', ok: neglected },
  ];
  const reds: string[] = [];
  if (chg != null && chg < 0) reds.push('down today');
  if (rvol != null && rvol < 1) reds.push('volume pace under 1x usual');
  if (aboveOpen === false) reds.push('below the open');

  const passes = (i: number) => checks[i].ok !== false;
  const tier: EdgeTier = reds.length ? 'red'
    : checks[0].ok === true && checks[1].ok === true && passes(2) && passes(3) && passes(4) && passes(5) ? 'green'   // 6, 7: info only
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
    green: 'GO (swing, 3-5 days, let runners run): uptrend — above a rising 21 EMA and the 50 — with the 10 EMA above the 21, price holding the 21 and within 1 ADR of the 10 or 21 (a pullback, not a chase, not a breakdown), RS 70+, volume drying up, within 25% of the 52-week high, no lower high (the last bounce did not fail under the recent peak), no heavy selling today, industry group in the top third, QQQ above its 200-day, no earnings within 3 days. Every core check must actually pass — a row missing the data stays yellow. A checklist traders use, not a tested edge. Hover a row for its ✔ / ✖.',
    yellow: 'LOOK (swing): in an uptrend but something is off — stretched 1-3 ADRs above the 21 EMA, dipped under the 21 while the 10 still leads, RS 50-69, more than 25% off the high, a lower high under the recent peak, volume still heavy, a lagging industry group — or not enough data to check. Wait for it to set up.',
    red: "STAY AWAY (swing): below the 50-day, under the 21 with the 10 below it or the 21 falling (short-term downtrend), RS under 50, more than 3 ADRs above the 21 EMA (blow-off), earnings within 3 days, QQQ below its 200-day — or this scan's own red rule.",
  },
  day: {
    green: 'GO (day trade): up today on 1.5x+ its usual volume pace for this time of day, holding the top half of today\'s range and above the open, ADR 4%+ and $20M+ traded. News and whether it had run before today are shown in the hover but not required. A checklist traders use, not a tested edge. Hover a row for its ✔ / ✖.',
    yellow: 'LOOK (day trade): in play but fading into the bottom half of the range, volume pace only 1-1.5x, or a thin range.',
    red: 'STAY AWAY (day trade): down today, below the open, or volume running under its usual pace. (The scans\' 20-day red rules do not apply to day trades.)',
  },
};

/* lib/summary/rowFormat.ts — how a scan row becomes a line of text.
 *
 * Extracted verbatim from MarketSummary on 11 Sep 2026. Nothing here changed:
 * the file had grown past 4,400 lines and this half of it is pure data
 * handling — no React, no JSX, no state — so it reads better on its own and
 * can be tested without rendering anything.
 *
 * Two rules keep it that way:
 *   - nothing in here may import React or emit markup. The moment it does,
 *     the split stops being worth having.
 *   - the accessors are deliberately forgiving about field names (`change` or
 *     `changePct`, `vol` or `volume`), because the scans were written at
 *     different times and the dashboard reads all of them.
 */

import { newsStarCount } from '@/lib/newsStars';

/* Words that look like tickers in prose and are not. */
export const TICKER_STOPWORDS = new Set([
  'RVOL', 'CNF', 'SMB', 'DAY', 'SWING', 'BD', 'REV', 'EP', 'BB', 'SQZ',
  'GLB', 'VCP', 'PB', 'GO', 'GC', 'EMA', 'SMA', 'MACD', 'ATR', 'ADR', 'RS', 'R2G',
  'RTR', 'TR', 'ST', 'TG', 'TRIG', 'STOP', 'TGT', 'RISK', 'COIL', 'EXT',
  'ETF', 'ETFS', 'STAGE', 'A', 'I', 'AND', 'THE', 'IS', 'ARE',
  'IN', 'OF', 'BY', 'VS', 'ON', 'TO', 'UP', 'AT', 'OR', 'IT', 'AI',
  'US', 'USA', 'FDA', 'SEC', 'IPO', 'CEO', 'EPS', 'FY', 'Q',
  'EST', 'PM', 'AM',
  'EV', 'ET', 'FOMC', 'CPI', 'PPI', 'GDP', 'NFP', 'PCE', 'ISM', 'FED', 'MOM', 'YOY', 'U6',
  'FIRST', 'TOUCH', 'BELOW', 'CROSS', 'PRE', 'RED', 'DOT', 'BLUE',
]);

export type PostureBucket = 'first-touch' | 'stacked' | 'pre-cross' | 'extended' | 'below-21';

export const KEEP_UPPER = new Set(['ETF', 'ETFS', 'QQQ', 'SPY', 'IWM', 'DIA', 'IT', 'AI', 'EV', 'REIT', 'REITS', 'IPO', 'SPAC', 'US', 'USA']);

export const titleCase = (input: string): string =>
  input
    .split(/(\s+|—|–|-|&|\/)/)
    .map(part => {
      const trimmed = part.trim();
      if (!trimmed || /^(\s+|—|–|-|&|\/)$/.test(part)) return part;
      const upper = trimmed.toUpperCase();
      if (KEEP_UPPER.has(upper)) return upper;
      return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
    })
    .join('');

export const num = (v: any): number => {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
};

export const numOrNull = (v: any): number | null => {
  if (v == null || v === '' || v === '—' || v === '-') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
};

export const scoreOf = (s: any): number => num(s?.conviction ?? s?.cnfScore ?? s?.smbScore ?? s?.score);
export const chgOf = (s: any): number => num(s?.change ?? s?.changePct);

/* The scanner and EP9M ship `ticker`; the swing and consolidation scans ship
   `symbol`. Both feed the Trade Plan pool, so identity has to come from one
   accessor rather than from whichever field a given route happened to use. */
export const tickerOf = (s: any): string | null => {
  const t = s?.ticker ?? s?.symbol;
  return t ? String(t) : null;
};

/* Price levels drop the cents above $100 — at $886 the pennies are noise, at
   $4.18 they are the whole trade. Same rule the tables use, so a level read
   here matches the level read there. */
export const fmtLevel = (v: any): string => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(2);
};

/* ---- Two-column bodies ---------------------------------------------------
   The renderer splits a section body on ||| and treats parts[0] and parts[1]
   as the two columns. ANYTHING APPENDED TO parts[1] RENDERS INSIDE THE SECOND
   COLUMN — which is how footers ended up hanging under the right-hand list
   while the left column stopped several rows earlier.

   Trailing prose therefore has to arrive as its OWN part. Every section that
   builds columns goes through this, so a footer is always full-width and the
   columns are always the same shape. */
export const twoCol = (left: string, right: string, footer: string[] = []): string =>
  footer.length ? `${left}|||${right}|||${footer.join('\n')}` : `${left}|||${right}`;

/* ---- RVOL, guarded ----
   A row showed RVOL 678.33 on the board. That is not participation, it is a
   near-zero denominator: avgVol on a recently-listed name with a handful of
   daily bars. The scanner guards avgVol > 0, which is true at 500 shares.

   Two floors. An absolute one on avgVol, because a name normally trading
   under 25k shares cannot produce a tradeable RVOL regardless of today. And
   a sanity ceiling on the ratio — a genuine 40x day exists, a 600x day does
   not, and past that the denominator is the story. Null means every consumer
   treats it as "no reading" rather than as a very large one.

   NULL IS PRINTED, NOT SKIPPED. A row with a missing reading has to keep
   the slot and show a dash. */

export const rvolOf = (s: any): number | null => {
  const raw = s?.rvol;
  if (raw == null || isNaN(Number(raw))) return null;
  const v = Number(raw);
  if (v <= 0) return null;
  return v;
};

export const fmtRvol = (s: any): string => {
  const rv = rvolOf(s);
  return rv != null ? `RVOL ${rv < 1 ? rv.toFixed(1) : Math.round(rv)}` : 'RVOL —';
};

export const stageOf = (s: any): string => (s?.stage ? String(s.stage).replace(/Stage\s*/i, '') : '');

export const fmtVolStr = (s: any): string => {
  const v = Number(s?.volume ?? s?.vol) || 0;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return '—';
};

export const fmtDVolStr = (s: any): string => {
  const dv = dVolOf(s);
  if (dv >= 1e9) return `$${(dv / 1e9).toFixed(1)}B`;
  if (dv >= 1e6) return `$${(dv / 1e6).toFixed(0)}M`;
  if (dv > 0) return `$${(dv / 1e3).toFixed(0)}K`;
  return '—';
};

export const stdCols = (s: any): string => {
  const cnf = scoreOf(s);
  const chg = chgOf(s);
  const rs = s?.rsRating != null ? Number(s.rsRating) : null;
  return [
    `CNF ${cnf}`,
    `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`,
    fmtRvol(s),
    `VOL ${fmtVolStr(s)}`,
    fmtDVolStr(s),
    `Stage ${stageOf(s) || '—'}`,
    ...(rs != null && isFinite(rs) ? [`RS ${rs.toFixed(0)}`] : []),
    newsEndToken(s),
  ].join(' ');
};

export type ParsedStdRow = {
  ticker: string;
  newsUrl: string | null;
  newsTip: string | null;
  newsCount: number;
  cnf: number;
  chg: number;
  rvol: number | null;
  vol: string;
  dvol: string;
  stage: string;
  rs: number | null;
  setup: string | null;
  blueDot: boolean;
  extraStr: string;
  price: number | null;
};

export const parseStdLine = (line: string): ParsedStdRow | null => {
  const t = line.trim();
  const tm = t.match(/^([A-Z]{1,5})\s/);
  if (!tm) return null;
  const ticker = tm[1];
  if (TICKER_STOPWORDS.has(ticker)) return null;
  const cm = t.match(/(?:CNF|SCR) (\d+)/);
  if (!cm) return null;
  const cnf = Number(cm[1]);
  const chgM = t.match(/([+-]\d+(?:\.\d+)?)%/);
  const chg = chgM ? Number(chgM[1]) : 0;
  const rM = t.match(/RVOL (\d+(?:\.\d+)?|—)/);
  const rvol = rM && rM[1] !== '—' ? Number(rM[1]) : null;
  const vM = t.match(/VOL (\d+(?:\.\d+)?[MK]|—)/);
  const vol = vM ? vM[1] : '—';
  const dM = t.match(/(\$\d+(?:\.\d+)?[BMK])/);
  const dvol = dM ? dM[1] : '—';
  const sM = t.match(/Stage (\S+)/);
  let stage = sM ? sM[1] : '—';
  if (stage === '-') stage = '—';
  const nM = t.match(/\[(★+)≡([^≡]*)≡\]\(([^)]+)\)/) || t.match(/\[\*≡([^≡]*)≡\]\(([^)]+)\)/);
  let newsUrl: string | null = null;
  let newsTip: string | null = null;
  let newsCount = 0;
  if (nM && nM[0].startsWith('[★')) {
    newsCount = nM[1].length;
    newsTip = nM[2] || null;
    newsUrl = nM[3] || null;
  } else if (nM) {
    newsCount = 1;
    newsTip = nM[1] || null;
    newsUrl = nM[2] || null;
  } else if (/\bN0\b/.test(t)) {
    newsCount = 0;
  }
  const rsM = t.match(/\bRS (\d+)\b/);
  const rs = rsM ? Number(rsM[1]) : null;
  const stageIdx = t.search(/Stage \S+/);
  let extraStr = '';
  if (stageIdx >= 0) {
    extraStr = t.slice(stageIdx).replace(/^Stage \S+/, '').replace(/\bRS \d+\b/, '').trim();
  }
  extraStr = extraStr.replace(/\bN0\b/, '').replace(/\[★+≡[^≡]*≡\]\([^)]+\)/, '').replace(/\[\*≡[^≡]*≡\]\([^)]+\)/, '').trim();
  const setupRx = /\b(20 EMA PB|Episodic Pivot|Gap & Go|Gap and Go|Trend Hold|BB SQZ|REV)\b/;
  const setupM = extraStr.match(setupRx);
  const setup = setupM ? setupM[1] : null;
  if (setup) extraStr = extraStr.replace(setupRx, '').trim();
  const blueDot = extraStr.includes('●');
  if (blueDot) extraStr = extraStr.replace(/●/g, '').trim();
  return { ticker, newsUrl, newsTip, newsCount, cnf, chg, rvol, vol, dvol, stage, rs, setup, blueDot, extraStr, price: null };
};

/* ---- ● and REV are MUTUALLY EXCLUSIVE, and here is why -------------------
   detectPattern() in /api/scanner/run short-circuits:

       if (dotKind === 'blue') return { name: 'Blue Dot Rev', ... }

   So a blue dot ALWAYS becomes the "Blue Dot Rev" setup name. The setup and
   the indicator are the same fact arriving twice, and showing both said one
   thing in two glyphs.

   What is NOT redundant is the OTHER reversal. v6.13 added a plain
   "Reversal" pattern — up today, under the 21, either reclaiming the 10 or
   washed out on stochastics — and that one fires WITHOUT a dot. So:

       ●    the oversold reset fired; this is a Blue Dot reversal
       REV  reversal by structure, no dot behind it

   One mark per row, and the mark tells you which kind. */
export const BLUE_DOT_GLYPH = '●';

export const setupOf = (s: any): string | null => {
  const n = s?.setupName;
  if (!n || n === '-' || n === '—') return null;
  const str = String(n);
  if (str.includes('BB SQZ')) return 'BB SQZ';
  if (str === 'Blue Dot Rev') return 'Blue Dot Rev';
  if (str === 'Episodic Pivot') return 'EP';
  return str;
};

export const hasRealCatalyst = (s: any): boolean =>
  !!s?.catalyst && !String(s.catalyst).toLowerCase().startsWith('technical momentum');

export const catalystTextOf = (s: any): string | null =>
  hasRealCatalyst(s) ? String(s.catalyst).replace(/\.$/, '') : null;

/* One word, for a row. classifyWiim emits tags like "FDA / Data",
   "Legal / Risk", "Sector Move", and appends "(Delayed)" on stale news —
   all too wide for a column. First word carries the meaning: FDA, Legal,
   Sector, Earnings, M&A. */
export const catalystTagOf = (s: any): string | null => {
  const c = catalystTextOf(s);
  if (!c) return null;
  const first = c.replace(/\s*\(delayed\)\s*/i, '').trim().split(/[\s/]+/)[0];
  return first || null;
};

export const dotOf = (s: any): 'blue' | 'red' | null => {
  const k = s?.dotKind;
  if (k === 'blue' || k === 'red') return k;
  // The swing and consolidation scans predate the dots indicator and ship a
  // `blueDot` boolean instead.
  if (s?.blueDot === true) return 'blue';
  return null;
};

export const setupRowLabel = (s: any): string | null => {
  const n = s?.setupName;
  const str = n && n !== '-' && n !== '—' ? String(n) : '';

  // Dot-backed reversal — from the setup name or straight from the indicator,
  // since the swing and consolidation scans ship `blueDot` without renaming
  // the setup.
  if (/blue dot|bd rev/i.test(str) || dotOf(s) === 'blue') return BLUE_DOT_GLYPH;
  // Structural reversal with no dot behind it.
  if (/reversal/i.test(str)) return 'REV';

  if (!str) return null;
  if (str.includes('BB SQZ')) return 'BB SQZ';
  if (str === 'Episodic Pivot') return 'EP';
  return str;
};

export const catalystLinked = (s: any): string => {
  const cat = catalystTextOf(s);
  if (!cat) return '';
  const url = s?.catalystUrl || null;
  return url ? `[${cat}](${url})` : cat;
};

export const dVolOf = (s: any): number => {
  const d = Number(s?.dVol);
  if (!isNaN(d) && d > 0) return d;
  const p = Number(s?.price) || 0;
  const v = Number(s?.volume ?? s?.vol) || 0;
  return p * v;
};

/* Detects ETF-style sector strings: "ETF", "TICKER - ETF", or ETF_TARGET_MAP
   values like "QQQ - Nasdaq", "SOXX - Semi's -3X". Leveraged/sector products,
   not industries — they belong in ETF Flow, not Sector Concentration, and never in
   the 10/21 thesis. */
export const priceOf = (s: any): number | null => numOrNull(s?.price ?? s?.last ?? s?.close);

export const fmtPrc = (p: number | null | undefined): string => {
  if (p == null || p === 0) return '';
  if (p >= 1000) return p.toFixed(0);
  return p.toFixed(2);
};
export const ema10Of = (s: any): number | null => numOrNull(s?.ema10 ?? s?.ema10d ?? s?.tenEma ?? s?.ma10 ?? s?.sma10);
export const ema21Of = (s: any): number | null => numOrNull(s?.ema21 ?? s?.ema21d ?? s?.twentyOneEma ?? s?.ma21 ?? s?.sma21);

export const pctFrom21 = (s: any): number | null => {
  const direct = numOrNull(s?.pctFrom21 ?? s?.dist21 ?? s?.pct21 ?? s?.ema21Dist ?? s?.distFrom21 ?? s?.distToEma21);
  if (direct != null) return direct;
  const p = priceOf(s);
  const e21 = ema21Of(s);
  if (p != null && e21 != null && e21 > 0) return ((p - e21) / e21) * 100;
  const t = String(s?.thesis || s?.readout || '');
  const m = t.match(/(\d+(?:\.\d+)?)%\s+(above|below)[^.]*?21\s*EMA/i);
  if (m) return parseFloat(m[1]) * (m[2].toLowerCase() === 'below' ? -1 : 1);
  return null;
};

export const pctFrom10 = (s: any): number | null => {
  const direct = numOrNull(s?.pctFrom10 ?? s?.dist10 ?? s?.pct10 ?? s?.ema10Dist ?? s?.distFrom10 ?? s?.distToEma10);
  if (direct != null) return direct;
  const p = priceOf(s);
  const e10 = ema10Of(s);
  if (p != null && e10 != null && e10 > 0) return ((p - e10) / e10) * 100;
  const t = String(s?.thesis || s?.readout || '');
  const m = t.match(/(\d+(?:\.\d+)?)%\s+(above|below)[^.]*?10\s*EMA/i);
  if (m) return parseFloat(m[1]) * (m[2].toLowerCase() === 'below' ? -1 : 1);
  return null;
};

export const slope21Of = (s: any): 'rising' | 'flat' | 'falling' | null => {
  if (s?.ema21Rising === true) return 'rising';
  if (s?.ema21Rising === false) return 'falling';
  const raw = s?.ema21Slope ?? s?.slope21 ?? s?.ema21Trend ?? s?.trend21;
  if (typeof raw === 'number' && !isNaN(raw)) return raw > 0.05 ? 'rising' : raw < -0.05 ? 'falling' : 'flat';
  const txt = (typeof raw === 'string' ? raw : String(s?.thesis || s?.readout || '')).toLowerCase();
  if (/declining|falling|rolling over|down-?slop/.test(txt)) return 'falling';
  if (/rising|up-?slop|advancing|uptrend/.test(txt)) return 'rising';
  if (/\bflat\b/.test(txt)) return 'flat';
  return null;
};

export const stackedOf = (s: any): boolean | null => {
  const e10 = ema10Of(s);
  const e21 = ema21Of(s);
  if (e10 != null && e21 != null) return e10 > e21;
  const d10 = pctFrom10(s);
  const d21 = pctFrom21(s);
  if (d10 != null && d21 != null) return d21 > d10;
  return null;
};

export const isExtendedOf = (s: any): boolean => {
  const d21 = pctFrom21(s);
  const atrPct = numOrNull(s?.atrPct);
  if (d21 == null) return false;
  // Same rule the scanner uses: more than three ATRs above the anchor leaves
  // no stop to place. Flat 12% fallback when ATR is missing.
  if (atrPct != null && atrPct > 0) return d21 > 3 * atrPct;
  return d21 > 12;
};

/* ---- THE single source of structural truth ------------------------------
   This exists because the 10/21 section and the watchlist used to compute
   structure independently and disagreed in public. CRWV, INTC, and BHC each
   appeared in "No touch" AND in "What To Watch" in the same render:
   build1021Para bucketed on EMA position while blendedScore ranked on
   CNF + RVOL + catalyst and knew nothing about position at all.

   Worse, the asymmetry pushed exactly the wrong names up — a +5 bonus for
   the pullback zone and no penalty whatsoever for sitting below a declining
   21. A name 9% under its anchor could out-rank one at its anchor on tape
   noise alone.

   Every consumer now reads posture() and nothing else. */
export const POSTURE_META: Record<PostureBucket, { label: string; short: string; tone: 'good' | 'warn' | 'bad'; scoreAdj: number; tip: string }> = {
  'first-touch': { label: 'first touch', short: 'FIRST TOUCH', tone: 'good', scoreAdj: 8, tip: 'Price pulled back under the 10 EMA but is holding above the 21 EMA — the defined-stop pullback entry.' },
  'stacked': { label: 'stacked', short: 'STACKED', tone: 'good', scoreAdj: 4, tip: 'Price is above both the 10 and 21 EMA with EMAs stacked in order — trend is intact and orderly.' },
  'pre-cross': { label: 'pre-cross', short: 'PRE-CROSS', tone: 'warn', scoreAdj: 2, tip: 'Price is below the 21 EMA but the 10 and 21 are converging — a potential trend change, not confirmed yet.' },
  'extended': { label: 'too extended', short: 'EXTENDED', tone: 'bad', scoreAdj: -10, tip: 'Price is too far above its moving averages — chasing here has poor risk/reward, wait for a pullback.' },
  'below-21': { label: 'below 21', short: 'BELOW 21', tone: 'bad', scoreAdj: -12, tip: 'Price is below the 21 EMA — the trend is down or broken, not a buy-the-dip setup.' },
};

export const posture = (s: any): PostureBucket | null => {
  const d21 = pctFrom21(s);
  if (d21 == null) return null;

  // Extension checked FIRST — a name can be well above both EMAs and still be
  // untouchable. That was the original bug here: everything above the 21 went
  // in the buy bucket, then the closing line contradicted it.
  if (isExtendedOf(s)) return 'extended';

  const d10 = pctFrom10(s);

  if (d21 > 0) {
    // Under the 10 but holding the 21 — the Dr. Wish first touch, the only
    // bucket where the stop is both defined and close.
    if (d10 != null && d10 <= 0) return 'first-touch';
    return 'stacked';
  }

  if (stackedOf(s) === false && d10 != null &&
      Math.abs(d10 - d21) <= 1.5 && d21 > -3) {
    return 'pre-cross';
  }

  return 'below-21';
};

export const postureScoreAdj = (s: any): number => {
  const b = posture(s);
  return b ? POSTURE_META[b].scoreAdj : 0;
};

export const fmtDollar = (v: number): string => {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${Math.round(v / 1e3)}K`;
};

/* Every list row in this file is space-separated. Interpuncts were doing the
   job the fixed column widths now do, and on a phone they cost a character
   of width per field on rows that were already wrapping. */
export const fmtLeader = (s: any): string => {
  const su = setupRowLabel(s);
  return `${s.ticker} ${stdCols(s)}${su ? ` ${su}` : ''}`;
};

/* ---- TRADE PLAN ---------------------------------------------------------
   The one section that answers "what can I actually do tomorrow".

   Every other section ranks names on what they have already done — change,
   volume, relative strength, sector heat. All of it backward-looking. The
   scan routes now emit a trigger, a stop, a 2R target and a distance to the
   nearest overhead level on every row, and none of that reached this
   component until now.

   THE ROW IS SIX FIELDS: change, CNF, R, TR, ST, TG. The renderer gives each
   a fixed minimum width, so the badges line up as columns down both lists
   rather than drifting with the width of the change figure — +12.05% is three
   characters wider than -0.15%, enough to stagger every badge after it.

   TWO GATES, both necessary, neither sufficient alone.

   REACH — how far the trigger sits above price, measured in average daily
   ranges. This number exists nowhere else on the dashboard and it is the
   one that separates a setup from a watch item. MU's trigger sat 0.6% above
   price on a 7.4% ADR: 0.08 of an average day, so it can fire on the open.
   SNDK's sat 5.4% above price with a 14% stop: reachable, but not tomorrow.
   The R badge cannot tell those apart because R measures the space ABOVE
   the trigger, not the distance TO it. One ADR is the natural ceiling —
   beyond that, price has to do something out of character to reach entry.

   RTR — room to resistance, in stop-widths. Below 1R the first average
   overhead arrives before you have covered the distance you are risking,
   which is a trade that has to be right twice.

   The intersection is the point. Sorting by RTR alone surfaces JPM and MA:
   clear runway, CNF 26, nothing happening. Sorting by CNF alone surfaces
   the semis at 0.2R with the 21 EMA directly overhead. Both columns are
   shown because both questions are real, but both are drawn from the same
   already-gated pool, so neither can promote a name that is not actionable.

   COLLAPSED AND OVEREXTENDED ROWS ARE EXCLUDED OUTRIGHT rather than ranked
   last. A name that has fallen off its own averages has no entry, and a
   name that has run three ATRs past its anchor has no stop — appearing in a
   section titled Trade Plan would be a category error, not a low ranking. */
export const PLAN_MAX_REACH_ADR = 1.0;
export const PLAN_MIN_RTR = 1.0;
// `clear` with no resistance level at all is the best case, not a missing
// value — it needs a high sentinel so it sorts to the top rather than out.
export const RTR_CLEAR_SENTINEL = 99;

export const livePlanOf = (s: any): any | null => {
  const p = s?.plan;
  if (!p || typeof p !== 'object') return null;
  if (p.tradeable !== true) return null;
  if (p.collapsed === true || p.overextended === true) return null;
  return p;
};

export const reachInAdr = (s: any): number | null => {
  const p = livePlanOf(s);
  const price = priceOf(s);
  const adr = numOrNull(s?.adrPct);
  if (!p || p.trigger == null || price == null || price <= 0) return null;
  if (adr == null || adr <= 0) return null;
  const distPct = ((Number(p.trigger) - price) / price) * 100;
  // Trigger at or below price means it is live now, not negative distance.
  return distPct <= 0 ? 0 : distPct / adr;
};

export const rtrValue = (s: any): number => {
  const p = livePlanOf(s);
  if (!p) return -1;
  if (p.resistanceR != null) return Number(p.resistanceR);
  if (p.clear === true) return RTR_CLEAR_SENTINEL;
  return -1;
};

export const rtrLabel = (s: any): string => {
  const p = livePlanOf(s);
  if (!p) return '—';
  if (p.resistanceR != null) return `${Number(p.resistanceR).toFixed(1)}R`;
  if (p.clear === true) return '2R+';
  return '—';
};

export const isSettingUp = (s: any): boolean => {
  if (!livePlanOf(s)) return false;
  const reach = reachInAdr(s);
  if (reach == null || reach > PLAN_MAX_REACH_ADR) return false;
  return rtrValue(s) >= PLAN_MIN_RTR;
};

/* ---- News marker --------------------------------------------------------
   Emits the token that becomes a clickable asterisk, or the empty-slot
   sentinel when a row has no catalyst.

   THE SENTINEL IS NOT OPTIONAL. Rows sit in a fixed-column layout, and a
   marker that only appears on some of them would shift every column to its
   right on exactly those rows — the same class of bug v2.4 fixed on the
   ticker chip, reintroduced one slot over.

   Metadata rides inside the link label between ≡ delimiters. That is a
   little grubby, but the renderer receives a plain string and has no other
   channel; the alternative is a module-level URL-to-metadata map, which
   means shared mutable state between the builders and the renderer for the
   sake of a tooltip.

   NEWLINES ARE STRIPPED from the tooltip because rows are split on \n
   downstream — a headline containing one would break the row into two and
   the second half would render as garbage. */
export const NEWS_MARK_EMPTY = '∅';

export const newsMark = (_s: any): string => '';

export const newsEndToken = (s: any): string => {
  const n = newsStarCount(s);
  if (n === 0) return 'N0';
  const url = s?.catalystUrl;
  const title = s?.thesis;
  const meta = [s?.catalyst, s?.newsPublisher, s?.newsAge]
    .filter(Boolean)
    .join(' · ');
  const tip = `${meta ? `${meta} — ` : ''}${title || ''}`
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\]≡]/g, '')
    .slice(0, 240);
  const stars = '★'.repeat(n);
  return `[${stars}≡${tip}≡](${url || '#'})`;
};

export const fmtPlanRow = (s: any): string => {
  const p = livePlanOf(s);
  if (!p) return `${tickerOf(s)} —`;

  const chg = chgOf(s);
  const bits: string[] = [`${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`];

  const cnf = scoreOf(s);
  if (cnf) bits.push(`CNF ${cnf}`);

  bits.push(rtrLabel(s));
  bits.push(`TR ${fmtLevel(p.trigger)}`);
  bits.push(`ST ${fmtLevel(p.stop)}`);
  bits.push(`TG ${fmtLevel(p.target)}`);

  return `${tickerOf(s)} ${bits.join(' ')}`;
};

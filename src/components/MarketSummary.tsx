'use client';

/* MarketSummary.tsx — v2.5
   v2.5: + a clickable NEWS ASTERISK on every scanner row.

   The cards are an overview. If a name has a catalyst, the row should say
   SO and nothing more — the headline itself belongs on the scanner table
   where there is width for it. An asterisk is the whole message: something
   was published, click to read it, otherwise carry on.

   PLACED AFTER THE TICKER, NOT AT THE END OF THE ROW. Trailing would have
   been simpler and needed no placeholder, but the Daily Setups and EP9M
   rows end in variable-width fields — a setup name, a catalyst tag — so the
   marker would have landed at a different x on every line. Next to the name
   it reads as part of the name ("AAPL*"), which is also what a footnote
   marker conventionally means.

   That placement costs a placeholder: rows WITHOUT news have to occupy the
   same slot or every column after them shifts. Hence the ∅ sentinel, which
   renders as an empty fixed-width span. It is a rare enough character that
   it cannot collide with a ticker, a headline or a number.

   THE TOOLTIP CARRIES PROVENANCE. Scanner v6.20 put publisher and age on
   every row for a reason — an aggregated feed mixes GlobeNewswire 8-Ks with
   Motley Fool opinion, and once the source is stripped the two look
   identical. Hovering the asterisk shows category, publisher, age and the
   headline, which is enough to decide whether to click.

   v2.4: the ticker chip gets a FIXED width inside aligned rows.
   v2.4: the ticker chip gets a FIXED width inside aligned rows.

   v2.3 gave RS and the leg count their own slots and the rows still drifted,
   because the thing every other column was aligning against was itself
   moving. The chip carried a MIN-width: RUSHA at five characters overflowed
   it, EG at two stopped at it, and every column after started at a different
   x on each row.

   The chip keeps its min-width in prose, where a five-character ticker
   mid-sentence should take the room it needs and a fixed box would leave
   gaps inside a paragraph. Rows get a fixed 56px, which fits the five-
   character ceiling that [A-Z]{1,5} imposes.

   v2.3: VCP rows given the same column alignment as Trade Plan.

   Adding 'VCP Thesis' to ALIGNED_SECTIONS in v2.2 turned the rows nowrap and
   put them in a scroll wrapper, but two of their tokens had no width slot,
   so the columns still drifted:

     RS   rendered at natural width. Fine mid-sentence in a watch card;
          in a row, "RS 88" and "RS 100" differ by a character and every
          column after them shifts.
     T3   was not a recognised token at all and fell through as plain text,
          landing wherever the preceding column left it.

   Both now have fixed slots. The leg count also became a badge rather than
   text, because it is a categorical read rather than a magnitude — three or
   four legs is the sweet spot, two is thin, five or more means the base has
   stalled into a range — and colouring it says that without a legend.

   v2.2: two changes.

   (a) RS switched from rsVsSpy (a SPREAD versus SPY) to the market-wide RS
       RATING (a PERCENTILE), matching the five tables.

       The watch-card prose said "RS +18 vs SPY", which stated a magnitude
       without a reference: eighteen points of outperformance is top-decile
       in a weak tape and unremarkable in a strong one, and the sentence
       could not tell you which. It now reads "RS 88", meaning stronger than
       88% of the liquid market.

       The threshold for MENTIONING it moved with the unit. The old rule
       printed RS whenever the spread cleared +10, which on a momentum
       watchlist was nearly every row and therefore said nothing. The new
       rule prints it at 80+, which is Minervini's "worth noticing" line and
       leaves the mention meaning something.

   (b) + VCP THESIS section, placed before EP9M.

       Its position is deliberate. Read top to bottom the briefing runs from
       what is happening RIGHT NOW to what is setting up LATER — Trade Plan,
       Top Movers and SIPs are today's tape; 10/21 is this week's structure.
       A VCP base is weeks of accumulation resolving at some future pivot,
       which puts it at the far end of that scale. EP9M follows because a
       volume event with no headline is a research task rather than a trade,
       and Industry Heat / ETF Flow / Money Flow close as context rather than
       candidates.

   v2.1 — MOBILE WIDTHS.
   Mobile layout pass. Aligned rows were clipping on a phone: six fixed-width
   fields plus card padding totalled ~440px against a ~380px viewport, so TG
   fell off the right edge with no way to reach it.

   Three layers, because any one alone still fails on an outlier:
     - every aligned width is now responsive, mobile-first
     - card and section padding shrink below md
     - aligned rows sit in an overflow-x-auto wrapper, so a 4-digit price
       scrolls instead of vanishing

   The scroll wrapper is per-ROW, not per-column-block, deliberately: rows are
   independently readable, and a shared scroll container would drag every row
   sideways to read one. */

import React, { useState, useEffect } from 'react';

/* ActionableEvent and the actionableEvents field are retained because
   /api/market-summary returns them and the fetch assigns them. The SECTION
   that rendered them is gone: the Benzinga high-impact feed is dominated by
   litigation solicitations, and the filter was losing an arms race against
   firms not on the list — ClaimsFiler, Brodsky & Smith, and Johnson all
   walked through a regex that caught Rosen and Pomerantz. Four of eight rows
   on a typical morning were shareholder-alert blasts.

   The scanner's own isSpamNews() in /api/scanner/run is separate and stays —
   that one prevents these headlines from becoming a ticker's catalyst, which
   is where they would actually distort a score. */
interface ActionableEvent {
  time: string;
  event: string;
  impact: 'High' | 'Medium' | 'Low';
}

interface UpdateBlock {
  phase: string;
  timestamp: string;
  paragraphs: string[];
  takeawayLabel: string;
  takeaway: string;
  colorTheme: 'cyan' | 'emerald' | 'indigo' | 'amber' | 'rose';
}

interface SummaryData {
  morning: UpdateBlock | null;
  midday: UpdateBlock | null;
  closing: UpdateBlock | null;
  actionableEvents?: ActionableEvent[];
}

type PostureBucket = 'first-touch' | 'stacked' | 'pre-cross' | 'extended' | 'below-21';

interface WatchItem {
  symbol: string;
  score?: number | string;
  reason: string;
  catalyst?: string | null;
  catalystUrl?: string | null;
  posture?: PostureBucket | null;
  dotKind?: 'blue' | 'red' | null;
}

interface TopCatalyst {
  ticker: string;
  headline: string;
  url: string | null;
  brief?: string | null;
}

interface MacroInsights {
  theme: string;
  briefing: string;
  watching: WatchItem[];
  topCatalyst?: TopCatalyst | null;
  topCatalysts?: TopCatalyst[];
}

interface EconEvent {
  event: string;
  date: string;
  country: string;
  currency: string;
  actual: number | null;
  previous: number | null;
  estimate: number | null;
  impact: 'High' | 'Medium' | 'Low';
}

interface EarningsEvent {
  symbol: string;
  date: string;
  name: string;
  epsEstimated?: number | null;
  revenueEstimated?: number | null;
  epsActual?: number | null;
  epsSurprisePct?: number | null;
  importance?: number;
}

type MarketSession = 'Pre-Market' | 'Open' | 'Post-Market' | 'Closed';
type BlockKey = 'morning' | 'midday' | 'closing';
type Direction = 'up' | 'down' | 'neutral';

const getEstDateInfo = () =>
  new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));

const getCurrentEstDecimal = () => {
  const est = getEstDateInfo();
  return est.getHours() + est.getMinutes() / 60;
};

const isWeekendNow = () => {
  const day = getEstDateInfo().getDay();
  return day === 0 || day === 6;
};

const getMarketSession = (): MarketSession => {
  const est = getEstDateInfo();
  const day = est.getDay();
  const t = est.getHours() + est.getMinutes() / 60;
  if (day === 0 || day === 6) return 'Closed';
  if (t >= 4 && t < 9.5) return 'Pre-Market';
  if (t >= 9.5 && t < 16) return 'Open';
  if (t >= 16 && t < 20) return 'Post-Market';
  return 'Closed';
};

/* ---- Session-block staleness ----
   A block written for the 8:30 window is describing a tape that has moved on
   by 11 AM. Blocks are marked, never hidden and never dimmed into
   illegibility — an earlier pass used opacity-50 over text-slate-500, which
   compounded into unreadable. The signal is color, not contrast. */
const BLOCK_WINDOWS: Record<BlockKey, { opens: number; supersededAt: number; nextLabel: string }> = {
  morning: { opens: 4.0, supersededAt: 11.5, nextLabel: 'midday' },
  midday: { opens: 11.5, supersededAt: 15.5, nextLabel: 'closing' },
  closing: { opens: 15.5, supersededAt: 24, nextLabel: '' },
};

const isBlockStale = (key: BlockKey, weekend: boolean): boolean => {
  if (weekend) return false;
  return getCurrentEstDecimal() >= BLOCK_WINDOWS[key].supersededAt;
};

/* ---- Directional accent ----
   Accent tracks the direction of the tape the block describes, read out of
   the block's own prose — colorTheme on the payload is effectively a constant
   and was decorating rather than informing. Index NAME followed by a signed
   percentage, so a mega-cap gapping in the same sentence is not counted.
   Inside ±0.25% the move is noise and colorTheme stands. */
const INDEX_MOVE_RX = /\b(S&P|Nasdaq|Dow|Russell|SPX|NDX)\b[^.]{0,40}?([+-]\d+(?:\.\d+)?)%/gi;
const DIRECTION_NEUTRAL_BAND = 0.25;

const deriveDirection = (block: UpdateBlock): Direction | null => {
  const text = (block.paragraphs || []).join(' ');
  if (!text) return null;
  const moves: number[] = [];
  INDEX_MOVE_RX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INDEX_MOVE_RX.exec(text)) !== null) {
    const v = parseFloat(m[2]);
    if (!Number.isNaN(v)) moves.push(v);
  }
  if (moves.length === 0) return null;
  const avg = moves.reduce((a, b) => a + b, 0) / moves.length;
  if (Math.abs(avg) < DIRECTION_NEUTRAL_BAND) return 'neutral';
  return avg > 0 ? 'up' : 'down';
};

const formatTime = (date: Date) =>
  date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'America/New_York',
  });

const KEEP_UPPER = new Set(['ETF', 'ETFS', 'QQQ', 'SPY', 'IWM', 'DIA', 'IT', 'AI', 'EV', 'REIT', 'REITS', 'IPO', 'SPAC', 'US', 'USA']);

const titleCase = (input: string): string =>
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

const num = (v: any): number => {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
};

const numOrNull = (v: any): number | null => {
  if (v == null || v === '' || v === '—' || v === '-') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
};

const scoreOf = (s: any): number => num(s?.conviction ?? s?.cnfScore ?? s?.smbScore ?? s?.score);
const chgOf = (s: any): number => num(s?.change ?? s?.changePct);

/* The scanner and EP9M ship `ticker`; the swing and consolidation scans ship
   `symbol`. Both feed the Trade Plan pool, so identity has to come from one
   accessor rather than from whichever field a given route happened to use. */
const tickerOf = (s: any): string | null => {
  const t = s?.ticker ?? s?.symbol;
  return t ? String(t) : null;
};

/* Price levels drop the cents above $100 — at $886 the pennies are noise, at
   $4.18 they are the whole trade. Same rule the tables use, so a level read
   here matches the level read there. */
const fmtLevel = (v: any): string => {
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
const twoCol = (left: string, right: string, footer: string[] = []): string =>
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

   NULL IS PRINTED, NOT SKIPPED. FCUV came through the EP9M scan with the
   guard tripped, and because the old formatter dropped the field entirely
   the row rendered one column short — every value after it shifted left and
   lined up under the wrong heading. A row with a missing reading has to keep
   the slot and show a dash. */
const MIN_AVG_VOL_FOR_RVOL = 25_000;
const MAX_PLAUSIBLE_RVOL = 40;

const rvolOf = (s: any): number | null => {
  const raw = s?.rvol;
  if (raw == null || isNaN(Number(raw))) return null;
  const v = Number(raw);
  if (v <= 0) return null;
  const avg = numOrNull(s?.avgVol);
  if (avg != null && avg < MIN_AVG_VOL_FOR_RVOL) return null;
  if (v > MAX_PLAUSIBLE_RVOL) return null;
  return v;
};

const fmtRvol = (s: any): string => {
  const rv = rvolOf(s);
  return rv != null ? `RVOL ${rv.toFixed(2)}` : 'RVOL —';
};

const stageOf = (s: any): string => (s?.stage ? String(s.stage).replace(/Stage\s*/i, '') : '');

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
const BLUE_DOT_GLYPH = '●';

const setupOf = (s: any): string | null => {
  const n = s?.setupName;
  if (!n || n === '-' || n === '—') return null;
  const str = String(n);
  if (str.includes('BB SQZ')) return 'BB SQZ';
  if (str === 'Blue Dot Rev') return 'Blue Dot Rev';
  if (str === 'Episodic Pivot') return 'EP';
  return str;
};

const hasRealCatalyst = (s: any): boolean =>
  !!s?.catalyst && !String(s.catalyst).toLowerCase().startsWith('technical momentum');

const catalystTextOf = (s: any): string | null =>
  hasRealCatalyst(s) ? String(s.catalyst).replace(/\.$/, '') : null;

/* One word, for a row. classifyWiim emits tags like "FDA / Data",
   "Legal / Risk", "Sector Move", and appends "(Delayed)" on stale news —
   all too wide for a column. First word carries the meaning: FDA, Legal,
   Sector, Earnings, M&A. */
const catalystTagOf = (s: any): string | null => {
  const c = catalystTextOf(s);
  if (!c) return null;
  const first = c.replace(/\s*\(delayed\)\s*/i, '').trim().split(/[\s/]+/)[0];
  return first || null;
};

const dotOf = (s: any): 'blue' | 'red' | null => {
  const k = s?.dotKind;
  if (k === 'blue' || k === 'red') return k;
  // The swing and consolidation scans predate the dots indicator and ship a
  // `blueDot` boolean instead.
  if (s?.blueDot === true) return 'blue';
  return null;
};

const setupRowLabel = (s: any): string | null => {
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

const catalystLinked = (s: any): string => {
  const cat = catalystTextOf(s);
  if (!cat) return '';
  const url = s?.catalystUrl || null;
  return url ? `[${cat}](${url})` : cat;
};

const dVolOf = (s: any): number => {
  const d = Number(s?.dVol);
  if (!isNaN(d) && d > 0) return d;
  const p = Number(s?.price) || 0;
  const v = Number(s?.volume ?? s?.vol) || 0;
  return p * v;
};

/* Detects ETF-style sector strings: "ETF", "TICKER - ETF", or ETF_TARGET_MAP
   values like "QQQ - Nasdaq", "SOXX - Semi's -3X". Leveraged/sector products,
   not industries — they belong in ETF Flow, not Industry Heat, and never in
   the 10/21 thesis. */
const isEtfSector = (sec: string | null | undefined): boolean => {
  if (!sec || sec === '—') return false;
  const s = String(sec);
  if (s === 'ETF' || s.includes('- ETF')) return true;
  if (/^[A-Z]{2,5}\s*-\s/.test(s)) return true;
  return false;
};

const priceOf = (s: any): number | null => numOrNull(s?.price ?? s?.last ?? s?.close);
const ema10Of = (s: any): number | null => numOrNull(s?.ema10 ?? s?.ema10d ?? s?.tenEma ?? s?.ma10 ?? s?.sma10);
const ema21Of = (s: any): number | null => numOrNull(s?.ema21 ?? s?.ema21d ?? s?.twentyOneEma ?? s?.ma21 ?? s?.sma21);

const pctFrom21 = (s: any): number | null => {
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

const pctFrom10 = (s: any): number | null => {
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

const slope21Of = (s: any): 'rising' | 'flat' | 'falling' | null => {
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

const stackedOf = (s: any): boolean | null => {
  const e10 = ema10Of(s);
  const e21 = ema21Of(s);
  if (e10 != null && e21 != null) return e10 > e21;
  const d10 = pctFrom10(s);
  const d21 = pctFrom21(s);
  if (d10 != null && d21 != null) return d21 > d10;
  return null;
};

const isExtendedOf = (s: any): boolean => {
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
const POSTURE_META: Record<PostureBucket, { label: string; short: string; tone: 'good' | 'warn' | 'bad'; scoreAdj: number }> = {
  'first-touch': { label: 'first touch', short: 'FIRST TOUCH', tone: 'good', scoreAdj: 8 },
  'stacked': { label: 'stacked', short: 'STACKED', tone: 'good', scoreAdj: 4 },
  'pre-cross': { label: 'pre-cross', short: 'PRE-CROSS', tone: 'warn', scoreAdj: 2 },
  'extended': { label: 'too extended', short: 'EXTENDED', tone: 'bad', scoreAdj: -10 },
  'below-21': { label: 'below 21', short: 'BELOW 21', tone: 'bad', scoreAdj: -12 },
};

const posture = (s: any): PostureBucket | null => {
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

const postureScoreAdj = (s: any): number => {
  const b = posture(s);
  return b ? POSTURE_META[b].scoreAdj : 0;
};

const fmtDollar = (v: number): string => {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${Math.round(v / 1e3)}K`;
};

/* Every list row in this file is space-separated. Interpuncts were doing the
   job the fixed column widths now do, and on a phone they cost a character
   of width per field on rows that were already wrapping. */
const fmtLeader = (s: any): string => {
  const chg = `${chgOf(s) >= 0 ? '+' : ''}${chgOf(s).toFixed(2)}%`;
  const bits: string[] = [chg, fmtRvol(s)];
  const su = setupRowLabel(s);
  if (su) bits.push(su);
  return `${s.ticker} ${bits.join(' ')}`;
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
const PLAN_MAX_REACH_ADR = 1.0;
const PLAN_MIN_RTR = 1.0;
// `clear` with no resistance level at all is the best case, not a missing
// value — it needs a high sentinel so it sorts to the top rather than out.
const RTR_CLEAR_SENTINEL = 99;

const livePlanOf = (s: any): any | null => {
  const p = s?.plan;
  if (!p || typeof p !== 'object') return null;
  if (p.tradeable !== true) return null;
  if (p.collapsed === true || p.overextended === true) return null;
  return p;
};

const reachInAdr = (s: any): number | null => {
  const p = livePlanOf(s);
  const price = priceOf(s);
  const adr = numOrNull(s?.adrPct);
  if (!p || p.trigger == null || price == null || price <= 0) return null;
  if (adr == null || adr <= 0) return null;
  const distPct = ((Number(p.trigger) - price) / price) * 100;
  // Trigger at or below price means it is live now, not negative distance.
  return distPct <= 0 ? 0 : distPct / adr;
};

const rtrValue = (s: any): number => {
  const p = livePlanOf(s);
  if (!p) return -1;
  if (p.resistanceR != null) return Number(p.resistanceR);
  if (p.clear === true) return RTR_CLEAR_SENTINEL;
  return -1;
};

const rtrLabel = (s: any): string => {
  const p = livePlanOf(s);
  if (!p) return '—';
  if (p.resistanceR != null) return `${Number(p.resistanceR).toFixed(1)}R`;
  if (p.clear === true) return '2R+';
  return '—';
};

const isSettingUp = (s: any): boolean => {
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
const NEWS_MARK_EMPTY = '∅';

const newsMark = (s: any): string => {
  const url = s?.catalystUrl;
  const title = s?.thesis;
  if (!url || !title) return NEWS_MARK_EMPTY;

  const meta = [s?.catalyst, s?.newsPublisher, s?.newsAge]
    .filter(Boolean)
    .join(' · ');

  const tip = `${meta ? `${meta} — ` : ''}${title}`
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\]≡]/g, '')
    .slice(0, 240);

  return `[*≡${tip}≡](${url})`;
};

const fmtPlanRow = (s: any): string => {
  const p = livePlanOf(s);
  if (!p) return `${tickerOf(s)} ${newsMark(s)} —`;

  const chg = chgOf(s);
  const bits: string[] = [`${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`];

  const cnf = scoreOf(s);
  if (cnf) bits.push(`CNF ${cnf}`);

  bits.push(rtrLabel(s));
  bits.push(`TR ${fmtLevel(p.trigger)}`);
  bits.push(`ST ${fmtLevel(p.stop)}`);
  bits.push(`TG ${fmtLevel(p.target)}`);

  return `${tickerOf(s)} ${newsMark(s)} ${bits.join(' ')}`;
};

const buildTradePlanPara = (pool: any[]): string => {
  const seen = new Set<string>();
  const deduped = pool.filter(s => {
    const t = tickerOf(s);
    if (!t || seen.has(t)) return false;
    seen.add(t);
    return true;
  });

  const planned = deduped.filter(s => livePlanOf(s));
  const ready = deduped.filter(isSettingUp);

  // The empty state is a DIAGNOSTIC, not an apology. "No setups" tells you
  // nothing; the breakdown tells you whether the tape is offering entries
  // without reward, reward without proximity, or neither — and whether the
  // scan has even run since the plan fields were added.
  if (ready.length === 0) {
    if (deduped.length === 0) return '';
    if (planned.length === 0) {
      return 'Trade Plan: No row in the current scans carries a tradeable plan. Either the scans have not run since the plan fields were added, or every name is collapsed or too extended to size a stop.';
    }
    const nearTrigger = planned.filter(s => {
      const r = reachInAdr(s);
      return r != null && r <= PLAN_MAX_REACH_ADR;
    }).length;
    const roomy = planned.filter(s => rtrValue(s) >= PLAN_MIN_RTR).length;
    return `Trade Plan: ${planned.length} name${planned.length === 1 ? '' : 's'} carry a live plan. ${nearTrigger} sit within one ADR of the trigger; ${roomy} have at least a stop-width of room before the first level overhead. None has both — every entry on offer is either out of reach or into resistance.`;
  }

  const byCnf = ready.slice().sort((a, b) => scoreOf(b) - scoreOf(a)).slice(0, 5);
  const byRtr = ready.slice().sort((a, b) => rtrValue(b) - rtrValue(a)).slice(0, 5);

  const cnfCol = `Best tape — ranked by CNF:\n${byCnf.map(fmtPlanRow).join('\n')}`;
  const rtrCol = `Most room — ranked by RTR:\n${byRtr.map(fmtPlanRow).join('\n')}`;

  const footer: string[] = [];

  const cnfSet = new Set(byCnf.map(tickerOf));
  const both = byRtr.filter(s => cnfSet.has(tickerOf(s))).map(tickerOf).filter(Boolean) as string[];
  if (both.length) {
    footer.push(`${both.join(', ')} rank${both.length === 1 ? 's' : ''} in both columns — scoring well with room to be paid.`);
  } else {
    footer.push('No name ranks in both columns today — the best-scoring setups and the roomiest ones are different names.');
  }

  const reds = ready.filter(s => dotOf(s) === 'red').map(tickerOf).filter(Boolean) as string[];
  if (reds.length) {
    footer.push(`${reds.join(', ')} carr${reds.length === 1 ? 'ies' : 'y'} an active red dot — a defined entry does not cancel an overbought reversal.`);
  }

  return `Trade Plan: ${twoCol(cnfCol, rtrCol, footer)}`;
};

/* ---- Key Events — the only forward-looking macro section ----------------
   Every other section is REACTIVE. A 2:00 PM rate decision produces nothing
   at 8:30 AM, so a session frozen ahead of one looks — to every other
   section — like weak breadth with no leadership.

   Econ is TODAY ONLY: what can still move the tape while you hold. Earnings
   run today + tomorrow, because an after-close print is tomorrow's gap and
   you size for it today. */
const parseEtDateTime = (s: string): { dayKey: string; minutes: number | null } => {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return { dayKey: '', minutes: null };
  const dayKey = `${m[1]}-${m[2]}-${m[3]}`;
  if (m[4] == null) return { dayKey, minutes: null };
  return { dayKey, minutes: parseInt(m[4], 10) * 60 + parseInt(m[5], 10) };
};

const etDayKey = (offsetDays = 0): string => {
  const d = getEstDateInfo();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const fmtClock = (minutes: number | null): string => {
  if (minutes == null) return '';
  const h24 = Math.floor(minutes / 60);
  const mm = minutes % 60;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${ampm}`;
};

const fmtEconNum = (v: number | null | undefined): string => {
  if (v == null) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
};

const buildKeyEventsPara = (econ: EconEvent[], earnings: EarningsEvent[]): string => {
  const today = etDayKey(0);
  const tomorrow = etDayKey(1);
  const now = getEstDateInfo();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const econRows = econ
    .map(e => {
      const { dayKey, minutes } = parseEtDateTime(e.date);
      return { ...e, dayKey, minutes };
    })
    .filter(e => e.dayKey === today && e.impact !== 'Low')
    .sort((a, b) => (a.minutes ?? 0) - (b.minutes ?? 0));

  const earnRows = earnings
    .filter(e => {
      const { dayKey } = parseEtDateTime(e.date);
      return (dayKey === today || dayKey === tomorrow) && (e.importance ?? 0) >= 10;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));

  if (econRows.length === 0 && earnRows.length === 0) return '';

  const isPending = (e: any) => e.minutes != null && e.minutes > nowMinutes && e.actual == null;

  const fmtEcon = (e: any): string => {
    const t = fmtClock(e.minutes);
    const marker = isPending(e) ? '▸ ' : '';
    const bits: string[] = [];
    if (e.actual != null) bits.push(`act ${fmtEconNum(e.actual)}`);
    if (e.estimate != null) bits.push(`est ${fmtEconNum(e.estimate)}`);
    if (e.previous != null) bits.push(`prev ${fmtEconNum(e.previous)}`);
    return `${marker}${t ? `${t} ` : ''}${e.event}${bits.length ? `  ${bits.join('  ')}` : ''}`;
  };

  const pending = econRows.filter(isPending);
  const released = econRows.filter(e => !isPending(e));

  let econCol = '';
  if (econRows.length) {
    const econLines = [...pending.map(fmtEcon), ...released.map(fmtEcon)];
    econCol = `${pending.length ? `Economic — ${pending.length} still ahead:` : 'Economic — all printed:'}\n${econLines.join('\n')}`;
  } else {
    econCol = 'Economic:\nNothing scheduled today.';
  }

  const fmtEps = (v: number | null | undefined): string => {
    if (v == null) return '—';
    return v.toFixed(2);
  };

  const fmtRev = (v: number | null | undefined): string => {
    if (v == null) return '';
    if (v >= 1e9) return ` · rev ${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return ` · rev ${(v / 1e6).toFixed(0)}M`;
    return '';
  };

  const fmtEarnPending = (e: EarningsEvent): string =>
    `▸ ${e.symbol} — est ${fmtEps(e.epsEstimated)} EPS${fmtRev(e.revenueEstimated)}`;

  const fmtEarnReported = (e: EarningsEvent): string => {
    const beat = e.epsEstimated != null && e.epsActual != null && e.epsActual >= e.epsEstimated;
    const pct = e.epsSurprisePct != null ? ` (${e.epsSurprisePct > 0 ? '+' : ''}${e.epsSurprisePct.toFixed(1)}%)` : '';
    return `${e.symbol} — ${beat ? 'BEAT' : 'MISS'} ${fmtEps(e.epsActual)} vs ${fmtEps(e.epsEstimated)}${pct}`;
  };

  const todayEarn = earnRows.filter(e => parseEtDateTime(e.date).dayKey === today);
  const tmrwEarn = earnRows.filter(e => parseEtDateTime(e.date).dayKey === tomorrow);
  const todayPending = todayEarn.filter(e => e.epsActual == null);
  const todayReported = todayEarn.filter(e => e.epsActual != null);
  const tmrwPending = tmrwEarn.filter(e => e.epsActual == null);

  const todayCol: string[] = [];
  if (todayPending.length) {
    todayCol.push(`Today — ${todayPending.length} pending:`);
    todayCol.push(...todayPending.map(fmtEarnPending));
  }
  if (todayReported.length) {
    todayCol.push(todayPending.length ? 'Reported:' : 'Today — all reported:');
    todayCol.push(...todayReported.map(fmtEarnReported));
  }
  if (!todayCol.length) todayCol.push('Today:\nNo mega-cap prints.');

  const tmrwCol: string[] = [];
  if (tmrwPending.length) {
    tmrwCol.push(`Tomorrow — ${tmrwPending.length} pending:`);
    tmrwCol.push(...tmrwPending.map(fmtEarnPending));
  }
  if (!tmrwCol.length) tmrwCol.push('Tomorrow:\nNo mega-cap prints.');

  const footer: string[] = [];
  if (pending.filter(e => e.impact === 'High').length) {
    footer.push('Setups are on a clock until this prints — breakouts into a scheduled release carry event risk the scan cannot price.');
  }

  const earnCols = footer.length
    ? `${todayCol.join('\n')}|||${tmrwCol.join('\n')}|||${footer.join('\n')}`
    : `${todayCol.join('\n')}|||${tmrwCol.join('\n')}`;

  return `Key Events: ${econCol}^^^${earnCols}`;
};

const buildCatalystBrief = (s: any): string => {
  const bits: string[] = [];
  const chg = chgOf(s);
  const rv = rvolOf(s);
  const su = setupOf(s);
  const st = stageOf(s);
  const d21 = pctFrom21(s);
  const cnf = scoreOf(s);
  const dot = dotOf(s);

  bits.push(`${chg >= 0 ? 'Up' : 'Down'} ${Math.abs(chg).toFixed(2)}%${rv != null ? ` on RVOL ${rv.toFixed(2)}` : ''}`);
  if (rv != null && rv >= 2) bits.push('heavy participation is validating the headline');
  else if (rv != null && rv >= 1.5) bits.push('volume is confirming');
  else if (rv != null && rv < 1) bits.push('headline pop without volume — fade risk');
  if (dot === 'red') bits.push('RED DOT active — reversal against a long');
  // "Stage" is still emitted so the renderer has an unambiguous token to
  // match on — it strips the word and prints only the coloured number.
  if (su) bits.push(`${su}${st ? ` in Stage ${st}` : ''}`);
  if (d21 != null) bits.push(`${d21 >= 0 ? '+' : ''}${d21.toFixed(1)}% vs the 21 EMA`);
  if (cnf) bits.push(`CNF ${cnf}`);

  // If the name has a live plan, the levels belong in the brief — a catalyst
  // without an entry and an exit is a story, not a trade.
  const p = livePlanOf(s);
  if (p?.trigger != null) {
    bits.push(`TR ${fmtLevel(p.trigger)}`);
    if (p.stop != null) bits.push(`ST ${fmtLevel(p.stop)}`);
    bits.push(`${rtrLabel(s)} to the first level overhead`);
  }
  return bits.join(' · ') + '.';
};

const buildWatchReason = (s: any): string => {
  const parts: string[] = [];
  const su = setupOf(s);
  const st = stageOf(s);
  const rv = rvolOf(s);
  const dot = dotOf(s);

  let lead = su || 'Momentum move';
  if (st) lead += ` in Stage ${st}`;
  if (rv != null) lead += ` with RVOL ${rv.toFixed(2)}`;
  parts.push(lead);

  // Dot leads the qualifiers — a red dot is the single most important thing
  // to know about a name being considered long, and it should not be buried
  // behind volume commentary. The blue dot is already in the setup name, so
  // it is not repeated here.
  if (dot === 'red') {
    const since = numOrNull(s?.dotBarsSince);
    parts.push(`RED DOT${since === 0 ? ' today' : since != null ? ` ${since} bars ago` : ''} — overbought reversal, grade capped`);
  }

  if (rv != null) {
    if (rv >= 2) parts.push('heavy participation confirms the move');
    else if (rv >= 1.5) parts.push('solid volume backing');
    else if (rv < 1) parts.push('price without volume — fade risk');
  }

  const d21 = pctFrom21(s);
  const slope = slope21Of(s);
  const b = posture(s);

  // Posture phrasing comes from the shared bucket, so this sentence can never
  // describe a name differently than the 10/21 section does.
  if (d21 != null && b) {
    if (b === 'first-touch') parts.push(`first touch — +${d21.toFixed(1)}% over the 21, back under the 10`);
    else if (b === 'stacked') parts.push(`stacked +${d21.toFixed(1)}% over a${slope === 'rising' ? ' rising' : slope === 'falling' ? ' declining' : ''} 21 EMA`);
    else if (b === 'pre-cross') parts.push(`pre-cross — ${d21.toFixed(1)}% vs the 21, lines converging`);
    else if (b === 'extended') parts.push(`+${d21.toFixed(1)}% over the 21 — too extended to place a stop`);
    else parts.push(`${d21.toFixed(1)}% under the 21 EMA — structure needs repair first`);
  }

  // The card keeps reach where the Trade Plan row drops it: the row is a
  // ranked list already filtered on reach, but a watch card can hold a name
  // whose trigger is nowhere near, and saying so is the whole point.
  const p = livePlanOf(s);
  if (p?.trigger != null) {
    const reach = reachInAdr(s);
    const reachTxt = reach == null ? '' :
      reach <= 0.05 ? ', live now' :
      reach <= PLAN_MAX_REACH_ADR ? `, ${reach.toFixed(1)}x ADR away` :
      `, ${reach.toFixed(1)}x ADR away — not reachable in a normal session`;
    const stopTxt = p.stop != null ? ` ST ${fmtLevel(p.stop)}` : '';
    parts.push(`TR ${fmtLevel(p.trigger)}${reachTxt},${stopTxt} with ${rtrLabel(s)} of room`);
  } else if (s?.plan?.collapsed === true) {
    parts.push('no long plan — price has collapsed away from its averages');
  } else if (s?.plan?.overextended === true) {
    parts.push('no usable plan — too far past the 21 EMA to size a stop');
  }

  if (s?.stochK != null && !isNaN(Number(s.stochK))) {
    const k = Number(s.stochK);
    if (k <= 25) parts.push(`stoch ${k.toFixed(0)} (oversold reset)`);
  }
  /* 80 rather than the old +10 spread. The previous threshold fired on
     nearly every momentum name, and a qualifier that appears on every row
     conveys nothing. 80 is Minervini's "worth noticing" line, so the mention
     is now information rather than decoration. */
  if (s?.rsRating != null && !isNaN(Number(s.rsRating)) && Number(s.rsRating) >= 80) {
    parts.push(`RS ${Number(s.rsRating).toFixed(0)}`);
  }

  const tt = s?.tradeType ? String(s.tradeType).toLowerCase() : null;
  if (tt?.startsWith('day')) parts.push('classified DAY — intraday only');
  else if (tt?.startsWith('swing')) parts.push('classified SWING — multi-day hold viable');

  return parts.join('; ') + '.';
};

const ep9mUnprec = (s: any): boolean => s?.unprecedented === true;

/* ---- Blended idea score ----
   CNF is the base. RVOL and a real catalyst add weight so a volume-confirmed
   name with news outranks a quiet high-CNF name.

   The posture term is SYMMETRIC — it used to be a lone +5 for the pullback
   zone with no downside, which is how names under a declining 21 ended up
   topping the watchlist while the section above called them untouchable.

   The dot term mirrors the scanner's own ceiling logic: a live red dot is a
   contradiction on a long idea, not a nuance. */
const blendedScore = (s: any): number => {
  let v = scoreOf(s);
  const rv = rvolOf(s);
  if (rv != null) {
    if (rv >= 2) v += 12;
    else if (rv >= 1.5) v += 7;
    else if (rv < 1) v -= 6;
  }
  if (hasRealCatalyst(s)) v += 8;
  if (ep9mUnprec(s)) v += 6;
  v += postureScoreAdj(s);

  const dot = dotOf(s);
  const since = numOrNull(s?.dotBarsSince) ?? 0;
  if (dot === 'blue') v += since === 0 ? 8 : 5;
  else if (dot === 'red') v -= since === 0 ? 15 : 9;

  return v;
};

/* ---- 10/21 Thesis ------------------------------------------------------
   Restructured from "at the anchor vs no touch" into SWING/REVERSAL vs DAY,
   ranked by the same blendedScore that drives the watchlist, each row
   carrying its posture tag. */
const isDayName = (s: any): boolean =>
  String(s?.tradeType || '').toLowerCase().startsWith('day');

const build1021Para = (pool: any[]): string => {
  const seenTickers = new Set<string>();
  const rows = pool
    .filter(s => {
      if (!s?.ticker || isEtfSector(s.sector)) return false;
      if (seenTickers.has(s.ticker)) return false;
      seenTickers.add(s.ticker);
      return true;
    })
    .map(s => ({
      ticker: s.ticker,
      d21: pctFrom21(s),
      d10: pctFrom10(s),
      bucket: posture(s),
      dot: dotOf(s),
      day: isDayName(s),
      score: blendedScore(s),
      /* Carried through the projection so newsMark can read them. Without
         these four the 10/21 rows would be the only section with no
         asterisk slot, and their columns would sit a few pixels off every
         other table's. */
      catalystUrl: s.catalystUrl ?? null,
      thesis: s.thesis ?? null,
      catalyst: s.catalyst ?? null,
      newsPublisher: s.newsPublisher ?? null,
      newsAge: s.newsAge ?? null,
    }))
    .filter(r => r.d21 != null && r.bucket != null);

  if (rows.length < 2) return '';

  /* Both distances are emitted as bare signed percentages so the renderer
     can give them the same fixed width, and the EMA they refer to follows as
     a plain "21" / "10". */
  const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
  const fmtRow = (r: any): string => {
    const bits = [`${pct(r.d21 as number)} 21`];
    if (r.d10 != null) bits.push(`${pct(r.d10 as number)} 10`);
    bits.push(POSTURE_META[r.bucket as PostureBucket].label);
    if (r.dot === 'red') bits.push('RED DOT');
    return `${r.ticker} ${newsMark(r)} ${bits.join(' ')}`;
  };

  const byScore = (a: any, b: any) => b.score - a.score;
  const swing = rows.filter(r => !r.day).sort(byScore).slice(0, 6);
  const day = rows.filter(r => r.day).sort(byScore).slice(0, 6);

  const swingCol = swing.length
    ? `Swing / reversal — ${swing.length}:\n${swing.map(fmtRow).join('\n')}`
    : 'Swing / reversal:\nNothing multi-day on the board.';
  const dayCol = day.length
    ? `Day — ${day.length}:\n${day.map(fmtRow).join('\n')}`
    : 'Day:\nNo intraday-only names classified.';

  const footer: string[] = [];

  const anchored = rows.filter(r => r.bucket === 'first-touch');
  const stacked = rows.filter(r => r.bucket === 'stacked');
  const broken = rows.filter(r => r.bucket === 'below-21');
  const reds = rows.filter(r => r.dot === 'red');
  const hasAnyD10 = rows.some(r => r.d10 != null);

  if (anchored.length) {
    footer.push(`${anchored.length} name${anchored.length === 1 ? ' sits' : 's sit'} at a first touch — under the 10, still over the 21. That is where the stop is defined and close.`);
  } else if (!hasAnyD10) {
    footer.push('No 10 EMA distance in the current scan payload — first-touch pullbacks cannot be identified until the scanner runs again.');
  } else if (stacked.length) {
    footer.push(`No first touches. ${stacked.length} name${stacked.length === 1 ? ' is' : 's are'} stacked over the 21 but none has pulled back to the 10 — trend intact, entry not offered.`);
  } else if (broken.length) {
    footer.push(`${broken.length} of ${rows.length} names sit below their 21 EMA. Nothing here is at an anchor — these rank on tape action, not structure.`);
  } else {
    footer.push('No equity in the scan is at a usable anchor.');
  }

  if (reds.length) {
    footer.push(`${reds.length} carrying an active red dot — grade-capped on the long side regardless of tape.`);
  }

  return `10/21 Thesis: ${twoCol(swingCol, dayCol, footer)}`;
};

const ep9mVs60dOf = (s: any): number | null => numOrNull(s?.volVs60dMax);
const ep9mSilent = (s: any): boolean => !hasRealCatalyst(s);

const buildMoversPara = (movers: any): string => {
  const gainers: any[] = Array.isArray(movers?.['Gainers']) ? movers['Gainers'] : [];
  const losers: any[] = Array.isArray(movers?.['Losers']) ? movers['Losers'] : [];
  if (gainers.length === 0 && losers.length === 0) return '';

  const fmtMover = (s: any): string =>
    `${s.ticker} ${newsMark(s)} ${chgOf(s) >= 0 ? '+' : ''}${chgOf(s).toFixed(2)}% ${fmtRvol(s)}`;

  const topG = gainers.slice().sort((a, b) => chgOf(b) - chgOf(a)).slice(0, 4);
  const topL = losers.slice().sort((a, b) => chgOf(a) - chgOf(b)).slice(0, 3);

  if (topG.length) {
    const confirmed = topG.filter(s => (rvolOf(s) ?? 0) >= 1.5);
    const footer = [
      confirmed.length
        ? `Volume-confirmed: ${confirmed.map(s => s.ticker).join(', ')}.`
        : 'No RVOL over 1.5 — moves are thin, fade candidates.',
    ];
    if (topL.length) {
      return `Top Movers: ${twoCol(
        `Leading the tape:\n${topG.map(fmtMover).join('\n')}`,
        `Heaviest red:\n${topL.map(fmtMover).join('\n')}`,
        footer
      )}`;
    }
    return `Top Movers: Leading the tape:\n${topG.map(fmtMover).join('\n')}\n${footer.join('\n')}`;
  }
  if (topL.length) {
    return `Top Movers: Heaviest red:\n${topL.map(fmtMover).join('\n')}\nWeakness leaders for short setups or names to avoid on the long side.`;
  }
  return '';
};

/* ---- VCP -----------------------------------------------------------------
   Volatility Contraction Pattern bases, split by whether the entry is still
   available.

   THE SPLIT IS THE POINT, and it is not the same as the scan's own `status`
   field. That reports 'breaking-out' whenever price is above the pivot with
   NO BOUND ON HOW FAR — a name that cleared its pivot three weeks ago and
   ran 18% still reports as breaking out, and on the first live scan five of
   nine names were in that state. A summary listing those alongside genuine
   setups would be half history.

   So the same derivation the VCP table uses is applied here: distance to the
   pivot decides. Within 3% either side is live; further below is still
   building; further above has gone.

   EXTENDED NAMES ARE EXCLUDED ENTIRELY rather than shown in a third column.
   The briefing exists to answer "what can I do", and a base whose entry
   passed cannot be acted on — its only remaining use is as a lesson, and a
   lesson does not belong in a list of candidates. The footer states how many
   were dropped so the omission is visible rather than silent. */
const VCP_FRESH_PCT = 3;

const vcpStatusOf = (c: any): 'ready' | 'watch' | 'extended' | null => {
  const p = numOrNull(c?.pctToPivot);
  if (p == null) return null;
  // pctToPivot is (pivot - price) / price: positive means price is BELOW the
  // pivot with that far to travel, negative means it is already through.
  if (p > VCP_FRESH_PCT) return 'watch';
  if (p >= -VCP_FRESH_PCT) return 'ready';
  return 'extended';
};

const buildVcpPara = (vcp: any[]): string => {
  const rows = (Array.isArray(vcp) ? vcp : []).filter(c => c?.symbol);
  if (rows.length === 0) return '';

  const fmtVcp = (c: any): string => {
    const bits: string[] = [];
    const rs = numOrNull(c?.rsRating);
    if (rs != null) bits.push(`RS ${rs.toFixed(0)}`);

    /* The contraction count as T3 / T4 rather than the full depth sequence.
       The sequence is the signature and belongs on the table where it has a
       column; inline it would be three bare numbers the tokeniser cannot
       colour and the eye cannot align. */
    const legs = numOrNull(c?.contractionCount);
    if (legs != null) bits.push(`T${legs.toFixed(0)}`);

    if (c?.trigger != null) bits.push(`TR ${fmtLevel(c.trigger)}`);
    if (c?.stop != null) bits.push(`ST ${fmtLevel(c.stop)}`);

    return `${c.symbol} ${newsMark(c)} ${bits.join(' ')}`;
  };

  const byScore = (a: any, b: any) => num(b?.score) - num(a?.score);

  const ready = rows.filter(c => vcpStatusOf(c) === 'ready').sort(byScore);
  const watch = rows.filter(c => vcpStatusOf(c) === 'watch').sort(byScore);
  const extended = rows.filter(c => vcpStatusOf(c) === 'extended').length;

  const footer: string[] = [];

  if (ready.length === 0 && watch.length === 0) {
    if (extended > 0) {
      return `VCP Thesis: ${extended} base${extended === 1 ? '' : 's'} on the board but every one has already cleared its pivot and run. The patterns were real; the entries have gone.`;
    }
    return '';
  }

  if (ready.length) {
    footer.push(`${ready.length} base${ready.length === 1 ? ' is' : 's are'} within ${VCP_FRESH_PCT}% of the pivot — the trigger is the high of the final contraction and the stop is its low, which is why a VCP carries a tighter stop than an ATR rule would give you.`);
  } else {
    footer.push('Nothing is at a pivot yet. These are bases still contracting — the list to watch, not to trade.');
  }

  if (extended > 0) {
    footer.push(`${extended} more cleared and ran, excluded here.`);
  }

  const strong = rows.filter(c => num(c?.rsRating) >= 90).map(c => c.symbol);
  if (strong.length) {
    footer.push(`${strong.slice(0, 4).join(', ')} rank in the top decile of the market on relative strength.`);
  }

  const readyCol = ready.length
    ? `At the pivot — ${ready.length}:\n${ready.slice(0, 5).map(fmtVcp).join('\n')}`
    : 'At the pivot:\nNothing within reach yet.';
  const watchCol = watch.length
    ? `Still basing — ${watch.length}:\n${watch.slice(0, 5).map(fmtVcp).join('\n')}`
    : 'Still basing:\nNo bases in the building stage.';

  return `VCP Thesis: ${twoCol(readyCol, watchCol, footer)}`;
};

/* ---- EP9M ---------------------------------------------------------------
   Four fields: ticker, change, RVOL, catalyst.

   THE TWO RATIOS ARE GONE. Rows read "0.29x 60d 67.17x float", which are
   volume-vs-60-day-high and float turnover — both real EP9M measures and
   both unreadable without the definition in front of you. What made them
   worse than useless is that the COLUMN ALREADY SAYS IT: a name in the
   Unprecedented column beat its own 60-day record by definition.

   vs-60d still RANKS the Unprecedented column. Ranking without display is
   normal here — reach does the same in Trade Plan. */
const buildEp9mPara = (ep9m: any[]): string => {
  const rows = ep9m.filter(s => s?.ticker);
  if (rows.length < 1) return '';

  const fmtEp = (s: any): string => {
    const chg = chgOf(s);
    const bits: string[] = [`${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`, fmtRvol(s)];
    const tag = catalystTagOf(s);
    if (tag) bits.push(tag);
    return `${s.ticker} ${newsMark(s)} ${bits.join(' ')}`;
  };

  const unprec = rows.filter(ep9mUnprec).sort((a, b) => (ep9mVs60dOf(b) ?? 0) - (ep9mVs60dOf(a) ?? 0));
  const silent = rows.filter(ep9mSilent).sort((a, b) => (rvolOf(b) ?? 0) - (rvolOf(a) ?? 0));
  const news = rows.filter(hasRealCatalyst).sort((a, b) => scoreOf(b) - scoreOf(a));

  const footer: string[] = [];
  if (news.length) footer.push(`With a catalyst already out: ${news.slice(0, 4).map(s => s.ticker).join(', ')}.`);

  if (unprec.length && silent.length) {
    return `EP9M Thesis: ${twoCol(
      `Unprecedented (beat 60d vol high):\n${unprec.slice(0, 5).map(fmtEp).join('\n')}`,
      `Silent (no headline yet):\n${silent.slice(0, 5).map(fmtEp).join('\n')}`,
      footer
    )}`;
  }
  if (unprec.length) {
    return `EP9M Thesis: Unprecedented volume (today beats their own 60-day record):\n${unprec.slice(0, 5).map(fmtEp).join('\n')}${footer.length ? `\n${footer.join('\n')}` : ''}`;
  }
  if (silent.length) {
    return `EP9M Thesis: Silent — heavy volume, no headline yet:\n${silent.slice(0, 5).map(fmtEp).join('\n')}${footer.length ? `\n${footer.join('\n')}` : ''}`;
  }
  return `EP9M Thesis: ${rows.length} name${rows.length !== 1 ? 's' : ''} trading abnormal size:\n${rows.slice(0, 6).map(fmtEp).join('\n')}`;
};

const buildLocalInsights = (
  scan: any,
  ep9mList: any[] = [],
  econList: EconEvent[] = [],
  earningsList: EarningsEvent[] = [],
  swingList: any[] = [],
  consolList: any[] = [],
  vcpList: any[] = [],
  liveChgMap: Record<string, [number, number]> | null = null,
): MacroInsights | null => {
  const sips: any[] = Array.isArray(scan?.stocksInPlay) ? scan.stocksInPlay : [];
  const daily: any[] = Array.isArray(scan?.dailySetups) ? scan.dailySetups : [];
  const ep9m: any[] = Array.isArray(ep9mList) ? ep9mList.filter(s => s?.ticker) : [];
  const movers = scan?.topMovers || {};
  if (sips.length === 0 && daily.length === 0 && ep9m.length === 0) return null;

  const pool = [...sips, ...daily, ...ep9m].filter(s => s?.ticker);

  /* The Trade Plan pool is DELIBERATELY WIDER than `pool`. Swing pullbacks
     and 10/21 coils carry plans and belong in a ranking of what is enterable
     tomorrow — but they do not belong in the momentum watchlist, the 10/21
     thesis, or the theme. A coil is by definition a name that has not moved,
     and dropping those into a list ranked on RVOL and change would quietly
     change what every other section means. */
  const planPool = [
    ...sips, ...daily, ...ep9m,
    ...(Array.isArray(swingList) ? swingList : []),
    ...(Array.isArray(consolList) ? consolList : []),
  ]
    .map(s => {
      const t = tickerOf(s);
      const live = t && liveChgMap ? liveChgMap[t] : undefined;
      return {
        ...s,
        ticker: t,
        ...(live ? { changePct: live[0], price: live[1] } : {}),
      };
    })
    .filter(s => s.ticker);

  const seen = new Set<string>();
  const ranked = pool
    .slice()
    .sort((a, b) => blendedScore(b) - blendedScore(a))
    .filter(s => {
      if (seen.has(s.ticker)) return false;
      seen.add(s.ticker);
      return true;
    })
    .slice(0, 6);

  const watching: WatchItem[] = ranked.map(s => ({
    symbol: s.ticker,
    score: scoreOf(s) || undefined,
    reason: buildWatchReason(s),
    catalyst: catalystTextOf(s),
    catalystUrl: s?.catalystUrl || null,
    posture: posture(s),
    dotKind: dotOf(s),
  }));

  const withNews = pool
    .filter(hasRealCatalyst)
    .slice()
    .sort((a, b) => scoreOf(b) - scoreOf(a))
    .filter((s, i, arr) => arr.findIndex(x => x.ticker === s.ticker) === i);
  const topCatalyst: TopCatalyst | null = withNews.length
    ? {
        ticker: withNews[0].ticker,
        headline: String(withNews[0].catalyst || withNews[0].thesis).replace(/\.$/, ''),
        url: withNews[0].catalystUrl || null,
        brief: buildCatalystBrief(withNews[0]),
      }
    : null;
  const topCatalysts: TopCatalyst[] = withNews.slice(0, 3).map(s => ({
    ticker: s.ticker,
    headline: String(s.catalyst || s.thesis).replace(/\.$/, ''),
    url: s.catalystUrl || null,
    brief: buildCatalystBrief(s),
  }));

  const stockLists = [
    ...sips, ...daily, ...ep9m,
    ...(movers['Gainers'] || []), ...(movers['Losers'] || []), ...(movers['Mega Caps'] || []),
  ];
  const flowSeen = new Set<string>();
  const flowNames = stockLists.filter(s => {
    if (!s?.ticker || flowSeen.has(s.ticker)) return false;
    flowSeen.add(s.ticker);
    return true;
  });

  const sectorCounts: Record<string, number> = {};
  ranked.forEach(s => {
    const sec = s?.sector && s.sector !== '—' && !isEtfSector(s.sector) ? String(s.sector) : null;
    if (sec) sectorCounts[sec] = (sectorCounts[sec] || 0) + 1;
  });
  const topSectors = Object.entries(sectorCounts).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([sec]) => sec);
  const aCount = ranked.filter(s => scoreOf(s) >= 70).length;
  const theme = titleCase(
    `${topSectors.length ? topSectors.join(' & ') : 'Broad Market'} In Focus — ${aCount > 0 ? `${aCount} A-Grade Setup${aCount > 1 ? 's' : ''}` : 'Momentum Watch'}`
  );

  const sipsSorted = sips.slice().sort((a, b) => (rvolOf(b) ?? 0) - (rvolOf(a) ?? 0));
  const leaders = sipsSorted.filter(s => (rvolOf(s) ?? 0) >= 1.5).slice(0, 3);
  const faders = sips.filter(s => { const r = rvolOf(s); return r != null && r < 1; });
  const newsItems = sips.filter(hasRealCatalyst).slice(0, 4);

  const fmtNewsRow = (s: any): string => {
    const tag = catalystTagOf(s);
    return `${s.ticker} ${newsMark(s)} ${chgOf(s) >= 0 ? '+' : ''}${chgOf(s).toFixed(2)}% ${fmtRvol(s)}${tag ? ` ${tag}` : ''}`;
  };
  const fmtFaderRow = (s: any): string =>
    `${s.ticker} ${newsMark(s)} ${chgOf(s) >= 0 ? '+' : ''}${chgOf(s).toFixed(2)}% ${fmtRvol(s)}`;

  const leadersCol = leaders.length ? `Volume-confirmed:\n${leaders.map(fmtLeader).join('\n')}` : '';
  const newsCol = newsItems.length ? `News-driven:\n${newsItems.map(fmtNewsRow).join('\n')}` : '';
  const fadersCol = faders.length ? `Sub-1.0 RVOL (faders):\n${faders.slice(0, 5).map(fmtFaderRow).join('\n')}` : '';

  const leftCol = leadersCol || newsCol;
  const rightCol = leadersCol ? (fadersCol || newsCol) : fadersCol;

  let sipsPara = '';
  if (leftCol && rightCol && leftCol !== rightCol) {
    const footer = (leadersCol && newsCol && fadersCol) ? [newsCol] : [];
    sipsPara = `SIPs Thesis: ${twoCol(leftCol, rightCol, footer)}`;
  } else if (leftCol || rightCol) {
    sipsPara = `SIPs Thesis: ${leftCol || rightCol}`;
  } else if (sips.length) {
    sipsPara = 'SIPs Thesis: No volume-confirmed leaders yet.';
  }

  /* CNF ahead of the setup name so the badge aligns down the column —
     "20 EMA PB" is six characters wider than "●" and was knocking the badge
     out of line on every other row. Variable-width fields go last. */
  const fmtDaily = (s: any): string => {
    const chg = `${chgOf(s) >= 0 ? '+' : ''}${chgOf(s).toFixed(2)}%`;
    const bits: string[] = [chg, `CNF ${scoreOf(s)}`, fmtRvol(s)];

    const su = setupRowLabel(s);
    if (su) bits.push(su);
    if (dotOf(s) === 'red') bits.push('RED DOT');

    return `${s.ticker} ${newsMark(s)} ${bits.join(' ')}`;
  };

  const swingNames = daily.filter(s => !isDayName(s)).sort((a, b) => blendedScore(b) - blendedScore(a)).slice(0, 6);
  const dayNames = daily.filter(isDayName).sort((a, b) => blendedScore(b) - blendedScore(a)).slice(0, 6);

  let dailyPara = '';
  if (swingNames.length || dayNames.length) {
    const swingCol = swingNames.length ? `SWING (multi-day hold):\n${swingNames.map(fmtDaily).join('\n')}` : '';
    const dayCol = dayNames.length ? `DAY (intraday only):\n${dayNames.map(fmtDaily).join('\n')}` : '';
    dailyPara = swingCol && dayCol
      ? `Daily Setups Thesis: ${twoCol(swingCol, dayCol)}`
      : `Daily Setups Thesis: ${swingCol || dayCol}`;
  }

  const ema1021Para = build1021Para(pool);
  const tradePlanPara = buildTradePlanPara(planPool);

  const heatAgg: Record<string, { sum: number; count: number }> = {};
  flowNames.forEach(s => {
    const sec = s?.sector && s.sector !== '—' && s.sector !== 'Other' && !isEtfSector(s.sector) ? String(s.sector) : null;
    if (!sec) return;
    if (!heatAgg[sec]) heatAgg[sec] = { sum: 0, count: 0 };
    heatAgg[sec].sum += chgOf(s);
    heatAgg[sec].count += 1;
  });
  const heat = Object.entries(heatAgg)
    .map(([sector, v]) => ({ sector, avgChg: v.sum / v.count, count: v.count }))
    .sort((a, b) => b.avgChg - a.avgChg);

  let heatPara = '';
  if (heat.length >= 2) {
    const fmtHeat = (h: { sector: string; avgChg: number; count: number }) =>
      `${h.avgChg >= 0 ? '+' : ''}${h.avgChg.toFixed(1)}% ${h.sector} (${h.count})`;
    const hot = heat.filter(h => h.avgChg > 0).slice(0, 4);
    const cold = heat.filter(h => h.avgChg < 0).slice(-4).reverse();
    if (hot.length && cold.length) {
      const footer = [hot[0].avgChg - cold[0].avgChg >= 8
        ? 'Wide dispersion between groups — a stock-picker\'s tape, stay in the leaders.'
        : 'Group dispersion is narrow — moves are market-driven more than industry-driven.'];
      heatPara = `Industry Heat: ${twoCol(
        `Strongest:\n${hot.map(fmtHeat).join('\n')}`,
        `Weakest:\n${cold.map(fmtHeat).join('\n')}`,
        footer
      )}`;
    } else if (hot.length) {
      heatPara = `Industry Heat: All tracked groups lean green:\n${hot.map(fmtHeat).join('\n')}\nBroad industry participation.`;
    } else if (cold.length) {
      heatPara = `Industry Heat: All tracked groups lean red:\n${cold.map(fmtHeat).join('\n')}\nNo industry shelter today.`;
    }
  }

  const etfAll = [...(movers['ETF Gainers'] || []), ...(movers['ETF Losers'] || [])];
  const etfSeen = new Set<string>();
  const etfs = etfAll
    .filter(e => {
      if (!e?.ticker || etfSeen.has(e.ticker)) return false;
      etfSeen.add(e.ticker);
      return true;
    })
    .map(e => ({ ticker: e.ticker, dVol: dVolOf(e), chg: chgOf(e) }))
    .filter(e => e.dVol > 0)
    .sort((a, b) => b.dVol - a.dVol);

  let etfPara = '';
  if (etfs.length) {
    const fmtE = (e: { ticker: string; dVol: number; chg: number }) =>
      `${e.ticker} ${e.chg >= 0 ? '+' : ''}${e.chg.toFixed(2)}% ${fmtDollar(e.dVol)}`;
    const upD = etfs.filter(e => e.chg > 0).reduce((a, e) => a + e.dVol, 0);
    const totD = etfs.reduce((a, e) => a + e.dVol, 0);
    const upShare = totD > 0 ? Math.round((upD / totD) * 100) : 0;
    const etfLines: string[] = [`Heaviest dollar volume:\n${etfs.slice(0, 4).map(fmtE).join('\n')}`];
    etfLines.push(upShare >= 60
      ? `${upShare}% of ETF dollars are on the advancing side — money is chasing strength.`
      : upShare <= 40
        ? `Only ${upShare}% of ETF dollars are on the advancing side — flows favor the short/defensive vehicles.`
        : `ETF dollars are split ${upShare}/${100 - upShare} between advancing and declining vehicles — no clean directional bet.`);
    etfPara = `ETF Flow: ${etfLines.join('\n')}`;
  }

  let moneyPara = '';
  const totalD = flowNames.reduce((a, s) => a + dVolOf(s), 0);
  if (totalD > 0) {
    const advD = flowNames.filter(s => chgOf(s) > 0).reduce((a, s) => a + dVolOf(s), 0);
    const advShare = Math.round((advD / totalD) * 100);
    const magnets = flowNames
      .slice()
      .sort((a, b) => dVolOf(b) - dVolOf(a))
      .slice(0, 3)
      .map(s => `${s.ticker} ${chgOf(s) >= 0 ? '+' : ''}${chgOf(s).toFixed(2)}% ${fmtDollar(dVolOf(s))}`);

    const inflowAgg: Record<string, number> = {};
    flowNames.filter(s => chgOf(s) > 0).forEach(s => {
      const sec = s?.sector && s.sector !== '—' && s.sector !== 'Other' && !isEtfSector(s.sector) ? String(s.sector) : null;
      if (sec) inflowAgg[sec] = (inflowAgg[sec] || 0) + dVolOf(s);
    });
    const topInflows = Object.entries(inflowAgg).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([sec]) => sec);

    const moneyLines: string[] = [
      `${fmtDollar(totalD)} in tracked dollar volume, ${advShare}% riding the advancing side` +
      (advShare >= 60 ? ' — buyers are paying up.' : advShare <= 40 ? ' — sellers control the tape\'s dollars.' : ' — a two-sided fight.'),
    ];
    if (magnets.length) moneyLines.push(`Dollar magnets:\n${magnets.join('\n')}`);
    if (topInflows.length) moneyLines.push(`Inflows concentrate in ${topInflows.join(' & ')}.`);
    moneyPara = `Money Flow: ${moneyLines.join('\n')}`;
  }

  const keyEventsPara = buildKeyEventsPara(econList, earningsList);
  const moversPara = buildMoversPara(movers);
  const vcpPara = buildVcpPara(vcpList);
  const ep9mPara = buildEp9mPara(ep9m);

  const sipsFinal = sipsPara || (sips.length === 0 && (daily.length || ep9m.length) ? 'SIPs Thesis: No stocks in play in the current scan.' : '');
  const dailyFinal = dailyPara || (daily.length === 0 && (sips.length || ep9m.length) ? 'Daily Setups Thesis: No daily setups on the board right now.' : '');
  const ep9mFinal = ep9mPara || (ep9m.length === 0 && (sips.length || daily.length) ? 'EP9M Thesis: No names trading abnormal 9M+ size yet — this fills in as session volume builds.' : '');

  /* Order runs from what is happening RIGHT NOW to what sets up LATER.
     Trade Plan, Top Movers and SIPs are today's tape; 10/21 is this week's
     structure; VCP is weeks of accumulation resolving at a future pivot.
     EP9M follows because a volume event with no headline is a research task
     rather than a trade, and the three flow sections close as context. */
  const orderedParas = [
    tradePlanPara, moversPara, sipsFinal, dailyFinal, ema1021Para,
    vcpPara, ep9mFinal,
    heatPara, etfPara, moneyPara, keyEventsPara,
  ];

  return {
    theme,
    briefing: orderedParas.filter(Boolean).join('\n\n'),
    watching,
    topCatalyst,
    topCatalysts,
  };
};

/* TR, ST, TG, REV and the rest are label words, not tickers. Without them
   here the renderer chips them like symbols and SectionCopyButton copies
   them into a TradingView watchlist. ST and TR are real tickers (Sensata,
   Tootsie Roll) — an acceptable trade, since neither has appeared on this
   board and the level pattern matches first anyway. */
const TICKER_STOPWORDS = new Set([
  'RVOL', 'CNF', 'SMB', 'DAY', 'SWING', 'BD', 'REV', 'EP', 'BB', 'SQZ',
  'GLB', 'VCP', 'PB', 'GO', 'GC', 'EMA', 'SMA', 'MACD', 'ATR', 'ADR', 'RS', 'R2G',
  'RTR', 'TR', 'ST', 'TG', 'TRIG', 'STOP', 'TGT', 'RISK', 'COIL', 'EXT',
  'ETF', 'ETFS', 'STAGE', 'A', 'I', 'AND', 'THE', 'IS', 'ARE',
  'IN', 'OF', 'BY', 'VS', 'ON', 'TO', 'UP', 'AT', 'OR', 'IT', 'AI',
  'US', 'USA', 'FDA', 'SEC', 'IPO', 'CEO', 'EPS', 'FY', 'Q',
  'EST', 'PM', 'AM',
  'ET', 'FOMC', 'CPI', 'PPI', 'GDP', 'NFP', 'PCE', 'ISM', 'FED', 'MOM', 'YOY', 'U6',
  'FIRST', 'TOUCH', 'BELOW', 'CROSS', 'PRE', 'RED', 'DOT', 'BLUE',
]);

/* The one-word catalyst tags classifyWiim can produce. Matched explicitly so
   they render as tags rather than as prose — and so "FDA" does not get chipped
   as a ticker. */
const CATALYST_TAGS = 'Earnings|FDA|Analyst|M&A|Offering|Contract|Guidance|Legal|Volatility|Sector';

/* ---- TYPE SCALE ---------------------------------------------------------
   Stepped down roughly 8% from the previous pass, which buys about one extra
   field per line before a row wraps on a phone.

       row text     13 → 12px
       valNum       12 → 11px
       badges       10 →  9px, padding px-1.5 → px-1
       ticker chip  10 →  9px, min-w 48 → 44px
       tiny labels   9 →  8px  (TR/ST/TG)
       RVOL label   10 →  9px
       blurbs       11 → 10px
       footers      12 → 11px

   12px is roughly the floor for this. Below it the tabular figures start
   losing the distinction between 6, 8 and 0 at a glance, which for a column
   of price levels is the whole point of having them.

   v2.1 — MOBILE WIDTHS. The fixed widths below are the mobile values; each
   carries an md: variant that restores the desktop figure. A Trade Plan row
   at the old widths measured ~440px against a ~380px viewport and TG fell
   off the edge. Mobile drops ~55px across the six fields, mobile padding
   returns another ~40px, and the scroll wrapper covers whatever a 4-digit
   price does to the rest. */
/* THE CHIP HAS TWO WIDTHS, and that distinction is the whole reason rows
   were still drifting after v2.3 gave every other token a slot.

   In PROSE the chip must size to its content — a min-width keeps single
   letters from looking cramped, but a five-character ticker mid-sentence has
   to be allowed to take the room it needs, and padding it to a fixed box
   would leave visible gaps inside a paragraph.

   In an ALIGNED ROW that same min-width is the bug. RUSHA is five characters
   and overflows the 44px minimum; EG is two and stops at it. Every column
   after the chip then starts at a different x on each row, which is exactly
   what the fixed slots on RS, the leg badge and the price levels were meant
   to prevent — they were all aligning correctly to a starting point that
   itself moved.

   56px fits five characters at 9px bold with tracking-wider plus padding and
   border, with a little slack. Tickers here are matched by [A-Z]{1,5} so
   five is the ceiling and nothing can overflow it. */
const TICKER_CHIP_BASE = "inline-block align-baseline text-[9px] font-bold text-slate-300 bg-slate-500/10 px-1 md:px-1.5 py-[1px] rounded border border-white/10 tracking-wider mx-0.5 text-center";
const tickerChipCls = `${TICKER_CHIP_BASE} min-w-[38px] md:min-w-[44px]`;
const tickerChipAlignedCls = `${TICKER_CHIP_BASE} w-[48px] md:w-[56px]`;
const valNum = "text-[11px] tabular-nums";
const rowText = "text-[12px]";

/* Aligned rows scroll rather than clip. The scrollbar is suppressed because
   on a touch device it is an overlay that never appears, and on desktop
   these rows fit and never scroll — a visible track would be pure noise. */
const scrollRowCls = "overflow-x-auto -mx-0.5 px-0.5";
const scrollRowStyle: React.CSSProperties = { scrollbarWidth: 'none', msOverflowStyle: 'none' };

const rvolColor = (v: number) => (v >= 2 ? 'text-amber-400' : v >= 1.5 ? 'text-emerald-400' : 'text-slate-400');
const stageColor = (st: string) => {
  if (st.includes('1')) return 'text-slate-400';
  if (st.includes('2')) return 'text-emerald-400';
  if (st.includes('3')) return 'text-amber-400';
  if (st.includes('4')) return 'text-rose-400';
  return 'text-slate-400';
};
const stochColor = (k: number) => (k <= 20 ? 'text-purple-400' : k <= 30 ? 'text-emerald-400' : 'text-slate-400');
/* Percentile thresholds, matching @/lib/indicators/rs. Not imported from
   there because this file colours inline prose tokens rather than table
   cells and takes a bare number, but the ladder is identical on purpose. */
const rsColor = (rs: number) => (rs >= 90 ? 'text-purple-400' : rs >= 80 ? 'text-emerald-400' : rs >= 70 ? 'text-slate-300' : 'text-rose-400');
const reachColor = (v: number) => (v <= 0.5 ? 'text-emerald-400' : v <= 1 ? 'text-slate-300' : 'text-amber-400');

const rtrBadgeCls = (v: number): string => {
  if (v >= 2) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
  if (v >= 1) return 'bg-slate-500/10 text-slate-300 border-white/10';
  if (v >= 0.5) return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
  return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
};

const cnfBadgeCls = (v: number): string => {
  if (v >= 70) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
  if (v >= 50) return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
  return 'bg-zinc-800/50 text-zinc-400 border-zinc-700/50';
};

const postureChipCls = (tone: 'good' | 'warn' | 'bad'): string => {
  if (tone === 'good') return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
  if (tone === 'warn') return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
  return 'text-rose-400 bg-rose-500/10 border-rose-500/20';
};

/* Sections whose bodies contain rows. The per-LINE test below decides which
   lines inside them actually get column widths — a section can hold both
   rows and prose, and Money Flow does exactly that. */
const ALIGNED_SECTIONS = new Set([
  'Trade Plan', 'Top Movers', 'SIPs Thesis', 'Daily Setups Thesis',
  '10/21 Thesis', 'VCP Thesis', 'EP9M Thesis', 'Industry Heat', 'ETF Flow', 'Money Flow',
]);

/* A ROW starts with a ticker (all-caps, 1-5 chars, then a space) or with a
   signed percentage (Industry Heat has no ticker). Prose never does, so
   "$57.7B in tracked dollar volume..." keeps its natural spacing while the
   dollar magnets below it get aligned columns. */
const isRowLine = (line: string): boolean => {
  const t = line.trim();
  return /^[A-Z]{1,5}\s/.test(t) || /^[+-]\d/.test(t);
};

const renderBriefingText = (text: string, align = false): React.ReactNode[] => {
  const rx = new RegExp(
    `(▸|●|∅|REV|RED DOT|BLUE DOT|\\[[^\\]]+\\]\\([^)]+\\)|\\d{1,2}:\\d{2} (?:AM|PM)` +
    `|RVOL (?:\\d+(?:\\.\\d+)?|—)|CNF \\d+|Stage \\d[ABC]?|stoch \\d+(?:\\.\\d+)?` +
    `|RS \\d{1,2}\\b|\\bT[2-9]\\b|(?:TR|ST|TG) \\d+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?x ADR` +
    `|\\d+(?:\\.\\d+)?R\\+?|\\b(?:${CATALYST_TAGS})\\b|10\\/21|S&P|Nasdaq|Dow|Bitcoin` +
    `|\\$\\d+(?:\\.\\d+)?[BMK]|[+-]\\d+(?:\\.\\d+)?%|\\b[A-Z]{1,5}\\b)`,
    'g'
  );
  const parts = text.split(rx);

  const chgW = align ? 'inline-block min-w-[46px] md:min-w-[54px] text-right' : '';
  const cnfW = align ? 'min-w-[22px] md:min-w-[26px] text-center' : '';
  const rtrW = align ? 'min-w-[32px] md:min-w-[38px] text-center' : '';
  const rvolW = align ? 'inline-block min-w-[28px] md:min-w-[30px] text-right' : '';
  const lvlValW = align ? 'inline-block min-w-[30px] md:min-w-[36px] text-right' : '';
  const dvolW = align ? 'inline-block min-w-[42px] md:min-w-[48px] text-right ml-1' : '';

  /* v2.3 — VCP row slots.

     RS previously rendered at its natural width, which was fine while it
     only appeared mid-sentence in a watch card. In an aligned row it drifts:
     "RS 88" and "RS 100" differ by a character and every column after them
     shifts. Two digits is the real ceiling (the rating is 1-99) so the slot
     is sized for that and right-aligned like every other numeric.

     The leg count had no token at all and fell through as plain text, so
     T3 and T4 sat wherever the preceding column left them. */
  const rsValW = align ? 'inline-block min-w-[18px] md:min-w-[20px] text-right' : '';
  const legW = align ? 'min-w-[20px] md:min-w-[24px] text-center' : '';

  /* The news marker and its empty twin share one width, which is the entire
     reason the sentinel exists — see the v2.5 header. */
  const newsW = align ? 'inline-block w-[10px] md:w-[12px] text-center' : 'inline-block';

  return parts.map((part, i) => {
    if (!part) return null;
    if (part === '▸') return <span key={i} className="text-rose-400 font-bold">▸</span>;
    if (part === BLUE_DOT_GLYPH) {
      return (
        <span key={i} title="Blue Dot reversal — oversold stochastic reset fired on the daily" className="text-sky-400 text-[12px] align-baseline">
          {BLUE_DOT_GLYPH}
        </span>
      );
    }
    if (part === 'REV') {
      return (
        <span key={i} title="Reversal by structure — up today, under the 21, no blue dot behind it" className="text-sky-400 font-bold tracking-wide text-[10px]">
          REV
        </span>
      );
    }
    if (part === 'RED DOT') return <span key={i} className="text-rose-400 font-bold tracking-wide text-[10px]">RED DOT</span>;
    if (part === 'BLUE DOT') return <span key={i} className="text-cyan-400 font-bold tracking-wide text-[11px]">BLUE DOT</span>;

    /* Empty news slot. Renders nothing but occupies the marker's width, so
       rows with and without a catalyst align. */
    if (part === '∅') {
      return <span key={i} className={newsW} aria-hidden="true" />;
    }

    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      /* The news asterisk, distinguished from an ordinary inline link by its
         label. Amber rather than the link slate because it is a STATUS on
         the row — this name has a catalyst — and only incidentally a link;
         reading it should not require noticing it is clickable. */
      const newsTip = linkMatch[1].match(/^\*≡(.*)≡$/);
      if (newsTip) {
        return (
          <a
            key={i}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            title={newsTip[1]}
            onClick={(e) => e.stopPropagation()}
            className={`${newsW} text-amber-400/90 hover:text-amber-300 font-bold text-[11px] leading-none align-baseline cursor-pointer transition-colors`}
          >
            *
          </a>
        );
      }
      return <a key={i} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-cyan-300 hover:underline transition-colors">{linkMatch[1]}</a>;
    }
    if (/^\d{1,2}:\d{2} (?:AM|PM)$/.test(part)) {
      return <span key={i} className={`${valNum} text-amber-400 font-bold`}>{part}</span>;
    }

    let m = part.match(/^RVOL (\d+(?:\.\d+)?|—)$/);
    if (m) {
      const isDash = m[1] === '—';
      const v = isDash ? 0 : parseFloat(m[1]);
      return (
        <span key={i} className={align ? 'ml-1 md:ml-1.5' : ''}>
          <span className="text-slate-500 text-[9px]">RVOL</span>{' '}
          <span className={`${valNum} ${isDash ? 'text-slate-600' : rvolColor(v)} ${rvolW}`}>{m[1]}</span>
        </span>
      );
    }
    m = part.match(/^CNF (\d+)$/);
    if (m) {
      const v = parseInt(m[1], 10);
      return (
        <span
          key={i}
          className={`inline-block align-baseline text-[9px] font-bold tabular-nums px-1 py-[1px] rounded border mx-0.5 ${cnfW} ${cnfBadgeCls(v)}`}
        >
          {m[1]}
        </span>
      );
    }
    // The word "Stage" is emitted upstream purely so this match is
    // unambiguous — a bare "2" cannot be distinguished from any other number
    // in the stream. The word is stripped here; only the coloured code prints.
    m = part.match(/^Stage (\d[ABC]?)$/);
    if (m) return <span key={i} className={`${valNum} font-bold ${stageColor(m[1])}`}>{m[1]}</span>;
    m = part.match(/^stoch (\d+(?:\.\d+)?)$/);
    if (m) {
      const v = parseFloat(m[1]);
      return <span key={i}>stoch <span className={`${valNum} ${stochColor(v)}`}>{m[1]}</span></span>;
    }
    m = part.match(/^RS (\d{1,2})$/);
    if (m) {
      const v = parseInt(m[1], 10);
      return (
        <span key={i} className={align ? 'ml-1 md:ml-1.5' : ''}>
          <span className="text-slate-500 text-[9px]">RS</span>{' '}
          <span className={`${valNum} ${rsColor(v)} ${rsValW}`}>{m[1]}</span>
        </span>
      );
    }

    /* Contraction count, T2 through T9. Rendered as a badge rather than
       text because it is a categorical read, not a magnitude: three or four
       legs is the sweet spot, two is thin, five or more means the base has
       stalled into a range. Colouring it says that without a legend.

       T1 is deliberately excluded from the pattern — a single contraction is
       not a VCP, so the token should never appear and matching it would
       imply otherwise. */
    m = part.match(/^T([2-9])$/);
    if (m) {
      const n = parseInt(m[1], 10);
      const cls = (n === 3 || n === 4)
        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
        : n === 2
          ? 'bg-slate-500/10 text-slate-300 border-white/10'
          : 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      return (
        <span
          key={i}
          title={`${n} contractions in the base — three or four is the sweet spot: enough repetitions to prove supply is thinning, not so many that the base has stalled into a range.`}
          className={`inline-block align-baseline text-[9px] font-bold tabular-nums px-1 py-[1px] rounded border mx-0.5 cursor-help ${legW} ${cls}`}
        >
          {part}
        </span>
      );
    }
    // The three order levels, set tight — label and value are one unit, so
    // no space between them. Stop red, target green, trigger neutral.
    m = part.match(/^(TR|ST|TG) (\d+(?:\.\d+)?)$/);
    if (m) {
      const tone = m[1] === 'ST' ? 'text-rose-400' : m[1] === 'TG' ? 'text-emerald-400' : 'text-slate-200';
      return (
        <span key={i} className={align ? 'inline-block ml-1 md:ml-2' : ''}>
          <span className="text-slate-500 text-[8px] tracking-tight">{m[1]}</span>
          <span className={`${valNum} ${tone} ${lvlValW}`}>{m[2]}</span>
        </span>
      );
    }
    m = part.match(/^(\d+(?:\.\d+)?)x ADR$/);
    if (m) {
      const v = parseFloat(m[1]);
      return <span key={i}><span className={`${valNum} ${reachColor(v)}`}>{m[1]}×</span> <span className="text-slate-500 text-[9px]">ADR</span></span>;
    }
    m = part.match(/^(\d+(?:\.\d+)?)R(\+?)$/);
    if (m) {
      const v = parseFloat(m[1]);
      return (
        <span
          key={i}
          className={`inline-block align-baseline text-[9px] font-bold tabular-nums px-1 py-[1px] rounded border mx-0.5 ${rtrW} ${rtrBadgeCls(v)}`}
        >
          {part}
        </span>
      );
    }
    if (new RegExp(`^(?:${CATALYST_TAGS})$`).test(part)) {
      return (
        <span key={i} className={`text-[9px] font-bold tracking-wider uppercase text-amber-400/80 ${align ? 'ml-1' : ''}`}>
          {part}
        </span>
      );
    }
    if (part === '10/21') return <span key={i} className={`${valNum} text-violet-400 font-bold`}>10/21</span>;
    if (part === 'S&P' || part === 'Nasdaq' || part === 'Dow' || part === 'Bitcoin') {
      const indexMap: Record<string, string> = { 'S&P': 'SPY', 'Nasdaq': 'QQQ', 'Dow': 'DIA', 'Bitcoin': 'BTCUSD' };
      return <a key={i} href={`https://www.tradingview.com/chart/?symbol=${indexMap[part]}`} target="_blank" rel="noopener noreferrer" className={`${align ? tickerChipAlignedCls : tickerChipCls} hover:bg-slate-500/20 hover:text-slate-100 transition-colors`}>{part}</a>;
    }
    if (/^\$\d+(?:\.\d+)?[BMK]$/.test(part)) return <span key={i} className={`${valNum} text-slate-200 ${dvolW}`}>{part}</span>;
    if (/^[+]\d+(?:\.\d+)?%$/.test(part)) return <span key={i} className={`${valNum} text-emerald-400 ${chgW}`}>{part}</span>;
    if (/^-\d+(?:\.\d+)?%$/.test(part)) return <span key={i} className={`${valNum} text-rose-400 ${chgW}`}>{part}</span>;
    if (part === 'DAY') return <span key={i} className="text-amber-400">DAY</span>;
    if (part === 'SWING') return <span key={i} className="text-cyan-400">SWING</span>;
    if (/^[A-Z]{2,5}$/.test(part) && !TICKER_STOPWORDS.has(part)) {
      return <a key={i} href={`https://www.tradingview.com/chart/?symbol=${part}`} target="_blank" rel="noopener noreferrer" className={`${align ? tickerChipAlignedCls : tickerChipCls} hover:bg-slate-500/20 hover:text-slate-100 transition-colors`}>{part}</a>;
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
};

/* One renderer for every body line, so the two-column branch and the
   single-column branch cannot drift apart. An aligned row gets the nowrap
   treatment inside a scroll wrapper; prose gets neither and wraps normally. */
const renderBodyLine = (line: string, li: number, aligned: boolean): React.ReactNode => {
  if (aligned) {
    return (
      <div key={li} className={scrollRowCls} style={scrollRowStyle}>
        <p className={`${rowText} text-slate-300 leading-relaxed font-medium whitespace-nowrap`}>
          {renderBriefingText(line, true)}
        </p>
      </div>
    );
  }
  return (
    <p key={li} className={`${rowText} text-slate-300 leading-relaxed font-medium`}>
      {renderBriefingText(line, false)}
    </p>
  );
};

const BRIEFING_SECTIONS: { label: string; color: string; blurb: string }[] = [
  { label: 'Trade Plan', color: 'teal', blurb: 'Names with a defined entry that can realistically fire next session — trigger within one average daily range of price, and at least one stop-width of room before the first level overhead. TR is the alert, ST the exit, TG a fixed 2R. The R badge is room-to-resistance in stop-widths, coloured as on the tables. Collapsed and over-extended names are excluded, not ranked last.' },
  { label: 'Top Movers', color: 'emerald', blurb: 'Biggest moves right now. Volume-confirmed names are tradeable; thin gaps are fade candidates.' },
  { label: 'SIPs Thesis', color: 'cyan', blurb: 'Stocks in play — who has real volume behind the move, who has news, and who is grinding on air.' },
  { label: 'Daily Setups Thesis', color: 'emerald', blurb: 'Structured setups from the daily scan. SWING holds for days; DAY is intraday momentum only. ● is a Blue Dot reversal — the oversold stochastic reset fired; REV is a reversal by structure with no dot behind it.' },
  { label: '10/21 Thesis', color: 'violet', blurb: 'Top-ranked names split by holding period. The two percentages are distance from the 21 and the 10 EMA, followed by the posture read. Leveraged and inverse ETFs excluded. A name tagged BELOW 21, EXTENDED, or RED DOT ranks on tape action — it is not at an entry.' },
  { label: 'VCP Thesis', color: 'teal', blurb: 'Volatility Contraction Patterns — bases of successively shallower pullbacks on lighter volume, which is supply being absorbed. TR is the pivot (the high of the final contraction) and ST its low, so the stop is the pattern\'s own invalidation rather than a volatility rule. T3 means three contractions; three or four is the sweet spot. Names that already cleared the pivot and ran are excluded, not ranked last.' },
  { label: 'EP9M Thesis', color: 'rose', blurb: 'Abnormal 9M+ share volume — institutional footprints. Left column beat its own 60-day volume record; right column has no headline out yet, which is the case worth researching.' },
  { label: 'Industry Heat', color: 'amber', blurb: 'Sector rotation — where money is flowing in and where it is leaving. Wide dispersion = stock-picker tape.' },
  { label: 'ETF Flow', color: 'indigo', blurb: 'Heaviest ETF dollar volume and the advancing/declining split — shows where leveraged money is betting.' },
  { label: 'Money Flow', color: 'rose', blurb: 'Total tracked dollar volume across the scanned universe — who is buying, where dollars concentrate, and the advancing share.' },
  { label: 'Key Events', color: 'amber', blurb: 'Today\'s releases and mega-cap prints. ▸ marks what has not happened yet. The only forward-looking macro section.' },
  { label: 'Sector Flow', color: 'indigo', blurb: '' },
  { label: 'Macro Snapshot', color: 'cyan', blurb: 'Broad market regime and key index levels — where the tape sits relative to its moving averages and what that means for positioning.' },
  { label: 'Keys', color: 'amber', blurb: 'Critical levels and thresholds to watch this session.' },
  { label: 'News', color: 'rose', blurb: 'Headline-driven names with catalysts already out.' },
  { label: 'Caution', color: 'rose', blurb: 'Risk flags and names to avoid or handle with reduced size.' },
];

const sectionStyles = (color: string) => {
  switch (color) {
    case 'teal': return { border: 'border-teal-500', badge: 'text-teal-400 bg-teal-500/10 border-teal-500/20', bg: 'bg-teal-500/[0.05]' };
    case 'cyan': return { border: 'border-cyan-500', badge: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20', bg: 'bg-cyan-500/[0.04]' };
    case 'emerald': return { border: 'border-emerald-500', badge: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', bg: 'bg-emerald-500/[0.04]' };
    case 'amber': return { border: 'border-amber-500', badge: 'text-amber-400 bg-amber-500/10 border-amber-500/20', bg: 'bg-amber-500/[0.04]' };
    case 'rose': return { border: 'border-rose-500', badge: 'text-rose-400 bg-rose-500/10 border-rose-500/20', bg: 'bg-rose-500/[0.04]' };
    case 'violet': return { border: 'border-violet-500', badge: 'text-violet-400 bg-violet-500/10 border-violet-500/20', bg: 'bg-violet-500/[0.04]' };
    case 'indigo': default: return { border: 'border-indigo-500', badge: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20', bg: 'bg-indigo-500/[0.04]' };
  }
};

const splitBriefingSection = (para: string): { label: string | null; color: string; blurb: string; body: string } => {
  for (const sec of BRIEFING_SECTIONS) {
    if (para.startsWith(`${sec.label}:`)) {
      return { label: sec.label, color: sec.color, blurb: sec.blurb, body: para.slice(sec.label.length + 1).trim() };
    }
  }
  return { label: null, color: 'indigo', blurb: '', body: para };
};

function SectionCopyButton({ tickers }: { tickers: string[] }) {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = tickers.join(',');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch {}
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button
      onClick={handleCopy}
      title={`Copy ${tickers.length} ticker${tickers.length !== 1 ? 's' : ''}: ${tickers.join(', ')}`}
      className={`text-[8px] font-bold tracking-wider uppercase px-2 py-0.5 rounded border transition-all duration-200 ${
        copied
          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
          : 'bg-[#161c2a] text-slate-500 border-white/5 hover:text-slate-300 hover:bg-white/[0.04]'
      }`}
    >
      {copied ? `✓ ${tickers.length}` : `Copy ${tickers.length}`}
    </button>
  );
}

export default function MarketSummary() {
  const [data, setData] = useState<SummaryData | null>(null);
  const [macroInsights, setMacroInsights] = useState<MacroInsights | null>(null);
  const [status, setStatus] = useState<'Loading' | 'Synced' | 'Error'>('Loading');
  const [session, setSession] = useState<MarketSession>('Closed');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  /* Collapse state is keyed by section LABEL, not index. Sections appear and
     disappear between scans — EP9M is empty before volume builds, Key Events
     is empty on a quiet calendar — and an index-keyed set would silently
     collapse whichever section slid into that slot. */
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  const toggleSection = (key: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const isWeekend = isWeekendNow();

  useEffect(() => {
    let isMounted = true;
    if (!data && !macroInsights) setStatus('Loading');

    const fetchMarketData = async () => {
      if (isMounted) setSession(getMarketSession());

      try {
        const narrativeRes = await fetch('/api/market-summary', { cache: 'no-store' });
        if (!narrativeRes.ok) {
          if (narrativeRes.status === 404 && isMounted) {
            setData({ morning: null, midday: null, closing: null, actionableEvents: [] });
          } else {
            throw new Error(`Narrative API returned status: ${narrativeRes.status}`);
          }
        } else {
          const payload: SummaryData = await narrativeRes.json();
          if (isMounted) {
            const estTime = getCurrentEstDecimal();
            setData({
              morning: (estTime >= BLOCK_WINDOWS.morning.opens || isWeekend) ? (payload.morning || null) : null,
              midday: (estTime >= BLOCK_WINDOWS.midday.opens || isWeekend) ? (payload.midday || null) : null,
              closing: (estTime >= BLOCK_WINDOWS.closing.opens || isWeekend) ? (payload.closing || null) : null,
              actionableEvents: payload.actionableEvents || [],
            });
          }
        }
      } catch (error) {
        console.error('Narrative Sync Error:', error);
      }

      try {
        const [scannerRes, ep9mRes, econRes, earningsRes, swingRes, consolRes, vcpRes] = await Promise.all([
          fetch('/api/scanner/latest', { cache: 'no-store' }),
          fetch(`/api/ep9m/latest?t=${Date.now()}`, { cache: 'no-store' }).catch(() => null),
          fetch('/api/econ', { cache: 'no-store' }).catch(() => null),
          fetch('/api/earnings', { cache: 'no-store' }).catch(() => null),
          fetch(`/api/swing-candidates/latest?t=${Date.now()}`, { cache: 'no-store' }).catch(() => null),
          fetch(`/api/consolidation/latest?t=${Date.now()}`, { cache: 'no-store' }).catch(() => null),
          fetch(`/api/vcp/latest?t=${Date.now()}`, { cache: 'no-store' }).catch(() => null),
        ]);
        if (!scannerRes.ok) throw new Error(`Scanner API returned status: ${scannerRes.status}`);

        const scannerData = await scannerRes.json();

        let ep9mList: any[] = [];
        try {
          if (ep9mRes && ep9mRes.ok) {
            const ep9mData = await ep9mRes.json();
            if (ep9mData && Array.isArray(ep9mData.candidates)) ep9mList = ep9mData.candidates;
          }
        } catch { /* ep9m is optional */ }

        let econList: EconEvent[] = [];
        try {
          if (econRes && econRes.ok) {
            const d = await econRes.json();
            if (Array.isArray(d)) econList = d;
          }
        } catch { /* econ is optional */ }

        let earningsList: EarningsEvent[] = [];
        try {
          if (earningsRes && earningsRes.ok) {
            const d = await earningsRes.json();
            const raw: any[] = Array.isArray(d) ? d : (d && Array.isArray(d.events) ? d.events : []);
            earningsList = raw.map((e: any) => {
              const cap = e.mktCap ?? 0;
              const imp = cap >= 100e9 ? 10 : cap >= 20e9 ? 7 : cap >= 5e9 ? 5 : 2;
              return { ...e, importance: imp };
            });
          }
        } catch { /* earnings is optional */ }

        let swingList: any[] = [];
        try {
          if (swingRes && swingRes.ok) {
            const d = await swingRes.json();
            if (d && Array.isArray(d.candidates)) swingList = d.candidates;
          }
        } catch { /* swing is optional */ }

        let consolList: any[] = [];
        try {
          if (consolRes && consolRes.ok) {
            const d = await consolRes.json();
            if (d && Array.isArray(d.candidates)) consolList = d.candidates;
          }
        } catch { /* consolidation is optional */ }

        /* VCP is optional in the strongest sense: the scan runs once daily
           and legitimately returns nothing when the market has no bases,
           which on a trending or falling tape is the normal result rather
           than a fault. An empty list produces no section at all. */
        let vcpList: any[] = [];
        try {
          if (vcpRes && vcpRes.ok) {
            const d = await vcpRes.json();
            if (d && Array.isArray(d.candidates)) vcpList = d.candidates;
          }
        } catch { /* vcp is optional */ }

        if (isMounted) {
          const local = buildLocalInsights(scannerData, ep9mList, econList, earningsList, swingList, consolList, vcpList, scannerData?.liveChgMap ?? null);
          if (local) setMacroInsights(local);
          else if (scannerData.macroInsights) setMacroInsights(scannerData.macroInsights);
        }
      } catch (error) {
        console.error('Scanner Macro Sync Error:', error);
      }

      if (isMounted) {
        setStatus('Synced');
        setLastUpdated(new Date());
      }
    };

    fetchMarketData();
    const interval = setInterval(fetchMarketData, 60000);
    return () => { isMounted = false; clearInterval(interval); };
  }, [isWeekend]);

  const getThemeStyles = (theme: string) => {
    switch (theme) {
      case 'cyan': return { bg: 'bg-cyan-500/5', text: 'text-cyan-400', boxBg: 'bg-cyan-500/10', boxBorder: 'border-cyan-500', boxText: 'text-cyan-100/90' };
      case 'emerald': return { bg: 'bg-emerald-500/5', text: 'text-emerald-400', boxBg: 'bg-emerald-500/10', boxBorder: 'border-emerald-500', boxText: 'text-emerald-100/90' };
      case 'rose': return { bg: 'bg-rose-500/5', text: 'text-rose-400', boxBg: 'bg-rose-500/10', boxBorder: 'border-rose-500', boxText: 'text-rose-100/90' };
      case 'amber': return { bg: 'bg-amber-500/5', text: 'text-amber-400', boxBg: 'bg-amber-500/10', boxBorder: 'border-amber-500', boxText: 'text-amber-100/90' };
      case 'indigo': default: return { bg: 'bg-indigo-500/5', text: 'text-indigo-400', boxBg: 'bg-indigo-500/10', boxBorder: 'border-indigo-500', boxText: 'text-indigo-100/90' };
    }
  };

  const getSessionTextColor = () => {
    if (session === 'Pre-Market') return 'text-amber-500';
    if (session === 'Open') return 'text-[#00e676]';
    if (session === 'Post-Market') return 'text-indigo-400';
    return 'text-slate-500';
  };

  const formatBriefing = (text: string) => {
    if (!text) return '';
    return text
      .replace(/(Trade Plan:)/gi, '\n\n$1')
      .replace(/(Top Movers:)/gi, '\n\n$1')
      .replace(/(SIPs Thesis:)/gi, '\n\n$1')
      .replace(/(Daily Setups Thesis:)/gi, '\n\n$1')
      .replace(/(10\/21 Thesis:)/gi, '\n\n$1')
      .replace(/(VCP Thesis:)/gi, '\n\n$1')
      .replace(/(EP9M Thesis:)/gi, '\n\n$1')
      .replace(/(Industry Heat:)/gi, '\n\n$1')
      .replace(/(ETF Flow:)/gi, '\n\n$1')
      .replace(/(Money Flow:)/gi, '\n\n$1')
      .replace(/(Key Events:)/gi, '\n\n$1')
      .replace(/(Sector Flow:)/gi, '\n\n$1')
      .replace(/(Macro Snapshot:)/gi, '\n\n$1')
      .replace(/(Keys:)/gi, '\n\n$1')
      .replace(/(News:)/gi, '\n\n$1')
      .replace(/(Caution:)/gi, '\n\n$1');
  };

  const renderSingleUpdateBlock = (block: UpdateBlock | null, key: BlockKey) => {
    if (!block) return null;
    const stale = isBlockStale(key, isWeekend);
    const direction = stale ? null : deriveDirection(block);
    const themeKey =
      direction === 'up' ? 'emerald' :
      direction === 'down' ? 'rose' :
      block.colorTheme;
    const styles = getThemeStyles(themeKey);
    const nextLabel = BLOCK_WINDOWS[key].nextLabel;

    return (
      <div className="bg-[#161c2a]/60 border border-white/5 rounded-xl p-3 sm:p-5 md:p-6 mt-3">
        <div className="flex items-center gap-2 sm:gap-3 mb-4 flex-wrap">
          <div className={`w-2 h-2 rounded-full border border-current ${stale ? 'bg-slate-500/10 text-slate-500' : `${styles.bg} ${styles.text}`}`}></div>
          <h4 className={`text-[10px] font-bold tracking-widest uppercase ${stale ? 'text-slate-400' : styles.text}`}>
            {block.phase}
          </h4>
          <span className="text-[8px] text-slate-500 font-medium tracking-wider px-2 py-0.5 bg-black/20 border border-white/5 rounded">
            {block.timestamp}
          </span>
          {stale && (
            <span className="text-[8px] font-bold tracking-widest uppercase text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded">
              Superseded
            </span>
          )}
        </div>

        <div className="space-y-3 mb-5">
          {block.paragraphs.map((p, idx) => (
            <p key={idx} className={`${rowText} text-slate-400 leading-relaxed border-l-[2px] border-slate-500/30 pl-2.5 md:pl-3.5`}>
              {renderBriefingText(p)}
            </p>
          ))}
        </div>

        <div className={`border-l-[4px] p-3 md:p-4 rounded-r-xl transition-colors duration-300 ${stale ? 'bg-slate-500/[0.07] border-slate-500' : `${styles.boxBg} ${styles.boxBorder}`}`}>
          <p className={`${rowText} leading-relaxed ${stale ? 'text-slate-300' : styles.boxText}`}>
            {block.takeaway}
          </p>
        </div>

        {stale && (
          <p className="text-[10px] text-amber-400/90 font-medium mt-3 leading-snug">
            Written for the {block.phase.toLowerCase()} window — the tape has moved past this read.
            {nextLabel ? ` Treat it as history until the ${nextLabel} update posts.` : ''}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="bg-[#101623] border border-white/10 rounded-2xl p-3 sm:p-6 md:p-8 relative overflow-hidden shadow-2xl w-full">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-500 via-emerald-500 to-indigo-500 opacity-40"></div>

      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 relative z-10 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-6 md:mb-8 border-b border-white/5 pb-4' : ''}`}
      >
        <div className="flex items-center gap-3">
          <span className="text-[10px] sm:text-xs md:text-sm font-bold border px-2.5 sm:px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 transition-colors text-[#7c8bfa] bg-[#161c2a]/40 border-white/5 group-hover:bg-white/[0.02]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
            LIVE SESSION NARRATIVE
          </span>
        </div>

        <div className="flex flex-row sm:flex-col items-center gap-2 sm:gap-1.5">
          <div className="flex items-center justify-center border border-white/5 bg-[#161c2a]/40 px-3 sm:px-4 py-1.5 rounded-[10px] min-w-[100px] sm:min-w-[120px]">
            <span className={`text-[10px] font-bold tracking-widest uppercase ${status === 'Loading' ? 'text-amber-500' : status === 'Error' ? 'text-rose-400' : getSessionTextColor()}`}>
              {status === 'Synced' ? session : status}
            </span>
          </div>
          {lastUpdated && (
            <span className="text-[10px] text-slate-400/80 font-medium px-1 tracking-wide whitespace-nowrap">
              Updated: {formatTime(lastUpdated)} EST
            </span>
          )}
        </div>
      </div>

      {isExpanded && (
        <>
          {macroInsights && (
            <div className="mb-6 md:mb-8 bg-[#161c2a]/60 border border-cyan-500/20 rounded-xl p-3 sm:p-5 md:p-6 relative overflow-hidden shadow-[0_0_15px_rgba(34,211,238,0.03)]">
              <div className="absolute right-0 top-0 w-64 h-64 bg-cyan-500/10 blur-3xl rounded-full -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>

              <div className="flex items-center gap-2 sm:gap-3 mb-3 relative z-10 flex-wrap">
                <span className="text-[9px] font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-2 sm:px-3 py-1 rounded tracking-widest uppercase flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
                  MARKET BRIEFING
                </span>
                <span className="text-[13px] sm:text-sm md:text-base font-black text-white tracking-wide">{macroInsights.theme}</span>
              </div>

              {(() => {
                const cats = (macroInsights.topCatalysts && macroInsights.topCatalysts.length)
                  ? macroInsights.topCatalysts
                  : (macroInsights.topCatalyst ? [macroInsights.topCatalyst] : []);
                if (!cats.length) return null;
                return (
                  <div className="mb-5 md:mb-6 relative z-10 flex flex-col gap-2">
                    {cats.map((cat, ci) => (
                      <div key={ci} className="border-l-[3px] border-amber-500 bg-amber-500/[0.04] rounded-r-xl px-2.5 md:px-4 py-3">
                        <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap">
                          <span className="text-[8px] font-bold tracking-widest uppercase text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded shrink-0">{ci === 0 ? 'TOP CATALYST' : 'CATALYST'}</span>
                          <a href={`https://www.tradingview.com/chart/?symbol=${cat.ticker}`} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20 tracking-wider shrink-0 hover:bg-cyan-500/20 hover:text-cyan-200 transition-colors">{cat.ticker}</a>
                          {cat.url ? (
                            <a href={cat.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-slate-300 font-medium hover:text-cyan-300 transition-colors hover:underline">
                              {cat.headline}
                            </a>
                          ) : (
                            <span className="text-[11px] text-slate-300 font-medium">{cat.headline}</span>
                          )}
                        </div>
                        {cat.brief && (
                          <p className="text-[11px] text-slate-400 font-medium leading-relaxed mt-2">
                            {renderBriefingText(cat.brief)}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}

              <div className="relative z-10 flex flex-col gap-6 md:gap-8">
                {(() => {
                  const paras = formatBriefing(macroInsights.briefing).split('\n\n').filter(Boolean);
                  const sections = paras.map((p, i) => {
                    const parsed = splitBriefingSection(p.trim());
                    return { ...parsed, key: parsed.label || `sec-${i}` };
                  });
                  const collapsibleKeys = sections.filter(s => s.label).map(s => s.key);
                  const everyCollapsed =
                    collapsibleKeys.length > 0 && collapsibleKeys.every(k => collapsedSections.has(k));

                  return (
                    <div>
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <h3 className="text-[8px] font-bold tracking-widest uppercase text-slate-500">Narrative Breakdown</h3>
                        {collapsibleKeys.length > 1 && (
                          <button
                            onClick={() => setCollapsedSections(everyCollapsed ? new Set() : new Set(collapsibleKeys))}
                            className="text-[8px] font-bold tracking-wider uppercase px-2 py-0.5 rounded border bg-[#161c2a] text-slate-500 border-white/5 hover:text-slate-300 hover:bg-white/[0.04] transition-all duration-200"
                          >
                            {everyCollapsed ? 'Expand all' : 'Collapse all'}
                          </button>
                        )}
                      </div>
                      <div className="flex flex-col gap-3">
                        {sections.map((sec, idx) => {
                          const { label, color, blurb, body, key } = sec;
                          const st = sectionStyles(color);
                          const bodyTickers = Array.from(new Set(
                            (body.match(/\b[A-Z]{2,5}\b/g) || []).filter(t => !TICKER_STOPWORDS.has(t))
                          ));
                          const isOpen = !label || !collapsedSections.has(key);
                          const sectionAligns = !!label && ALIGNED_SECTIONS.has(label);

                          return (
                            <div key={idx} className={`border-l-[3px] rounded-r-xl px-2.5 md:px-4 py-3 ${st.border} ${st.bg}`}>
                              {label && (
                                <div className={isOpen ? 'mb-2' : ''}>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <button
                                      onClick={() => toggleSection(key)}
                                      title={isOpen ? 'Collapse this section' : 'Expand this section'}
                                      className="flex items-center gap-2 group/sec"
                                    >
                                      <span className={`text-[8px] text-slate-500 group-hover/sec:text-slate-300 transition-all duration-200 ${isOpen ? 'rotate-90' : ''}`}>▸</span>
                                      <span className={`inline-block text-[8px] font-bold tracking-widest uppercase px-2 py-0.5 rounded border ${st.badge}`}>
                                        {label}
                                      </span>
                                    </button>
                                    {isOpen && bodyTickers.length > 0 && <SectionCopyButton tickers={bodyTickers} />}
                                    {!isOpen && bodyTickers.length > 0 && (
                                      <span className="text-[9px] text-slate-600 font-medium">
                                        {bodyTickers.length} name{bodyTickers.length === 1 ? '' : 's'}
                                      </span>
                                    )}
                                  </div>
                                  {isOpen && blurb && <p className="text-[10px] text-slate-500 font-medium mt-1.5 leading-snug">{blurb}</p>}
                                </div>
                              )}
                              {isOpen && (
                                body.includes('|||') ? (
                                  (() => {
                                    let topBlock = '';
                                    let colBody = body;
                                    if (body.includes('^^^')) {
                                      const [above, below] = body.split('^^^');
                                      topBlock = above.trim();
                                      colBody = below.trim();
                                    }
                                    const parts = colBody.split('|||');
                                    const afterCols = parts.length > 2 ? parts.slice(2).join('\n') : '';
                                    return (
                                      <>
                                        {topBlock && (
                                          <div className="space-y-1.5 mb-4 pb-3 border-b border-white/5">
                                            {topBlock.split('\n').filter(Boolean).map((line, li) => {
                                              const tLines = line.trim().split('\n').filter(Boolean);
                                              const isHead = tLines.length === 1 && line.trim().endsWith(':');
                                              if (isHead) return <p key={li} className="text-[9px] font-bold tracking-wider uppercase text-slate-500 pb-0.5">{line.replace(/:$/, '')}</p>;
                                              return renderBodyLine(line, li, sectionAligns && isRowLine(line));
                                            })}
                                          </div>
                                        )}
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
                                          {parts.slice(0, 2).map((col, ci) => {
                                            const colLines = col.trim().split('\n').filter(Boolean);
                                            const [heading, ...rows] = colLines;
                                            const isHeading = heading && heading.trim().endsWith(':');
                                            const render = (line: string, li: number) =>
                                              renderBodyLine(line, li, sectionAligns && isRowLine(line));
                                            return (
                                              <div key={ci} className="space-y-1.5">
                                                {isHeading ? (
                                                  <>
                                                    <p className="text-[9px] font-bold tracking-wider uppercase text-slate-500 pb-0.5 border-b border-white/5">
                                                      {heading.replace(/:$/, '')}
                                                    </p>
                                                    {rows.map(render)}
                                                  </>
                                                ) : (
                                                  colLines.map(render)
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                        {afterCols && (
                                          <div className="space-y-1.5 mt-4 pt-3 border-t border-white/5">
                                            {afterCols.trim().split('\n').filter(Boolean).map((line, li) => (
                                              <p key={li} className="text-[11px] text-slate-400 leading-relaxed font-medium">
                                                {renderBriefingText(line)}
                                              </p>
                                            ))}
                                          </div>
                                        )}
                                      </>
                                    );
                                  })()
                                ) : (
                                  <div className="space-y-2">
                                    {body.split('\n').filter(Boolean).map((line, li) =>
                                      renderBodyLine(line, li, sectionAligns && isRowLine(line))
                                    )}
                                  </div>
                                )
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                <div className="border-t border-white/5 pt-5 md:pt-6">
                  <h3 className="text-[8px] font-bold tracking-widest uppercase text-slate-500 mb-3">What To Watch &amp; Why</h3>
                  <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {macroInsights.watching?.map((item, idx) => {
                      const symbol = typeof item === 'string' ? item : item.symbol;
                      const reason = typeof item === 'string' ? 'Momentum continuation and algorithmic confluence.' : item.reason;
                      const catalyst = typeof item === 'string' ? null : item.catalyst;
                      const catalystUrl = typeof item === 'string' ? null : item.catalystUrl;
                      const pb = typeof item === 'string' ? null : (item.posture || null);
                      const pMeta = pb ? POSTURE_META[pb] : null;
                      const dk = typeof item === 'string' ? null : (item.dotKind || null);

                      let parsedScore: number | undefined = undefined;
                      if (typeof item === 'object' && item.score !== undefined && item.score !== null) {
                        const n = Number(item.score.toString().replace(/\D/g, ''));
                        if (!isNaN(n)) parsedScore = n;
                      }

                      return (
                        <li key={idx} className={`flex flex-col gap-2 bg-[#161c2a]/60 p-3 md:p-3.5 rounded-xl border transition-colors ${
                          dk === 'red' ? 'border-rose-500/25 hover:border-rose-500/40' : 'border-white/5 hover:border-cyan-500/20'
                        }`}>
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <a href={`https://www.tradingview.com/chart/?symbol=${symbol}`} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20 tracking-wider hover:bg-cyan-500/20 hover:text-cyan-200 transition-colors">
                              {symbol}
                            </a>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {dk === 'red' && (
                                <span className="text-[8px] font-bold px-1 py-0.5 rounded border tracking-wider uppercase text-rose-400 bg-rose-500/10 border-rose-500/20">
                                  RD
                                </span>
                              )}
                              {dk === 'blue' && (
                                <span className="text-sky-400 text-[12px] leading-none" title="Blue Dot reversal">
                                  {BLUE_DOT_GLYPH}
                                </span>
                              )}
                              {pMeta && (
                                <span className={`text-[8px] font-bold px-1 py-0.5 rounded border tracking-wider uppercase whitespace-nowrap ${postureChipCls(pMeta.tone)}`}>
                                  {pMeta.short}
                                </span>
                              )}
                              {parsedScore !== undefined && (
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border tracking-wide ${cnfBadgeCls(parsedScore)}`}>
                                  {parsedScore}
                                </span>
                              )}
                            </div>
                          </div>
                          {(() => {
                            const clauses = (reason || '').split(';').map((c) => c.trim()).filter(Boolean);
                            if (clauses.length <= 1) {
                              return (
                                <p className={`${rowText} text-slate-300 font-medium leading-relaxed`}>
                                  {renderBriefingText(reason)}
                                </p>
                              );
                            }
                            return (
                              <div className="flex flex-col gap-1">
                                <p className={`${rowText} text-slate-300 font-medium leading-relaxed`}>
                                  {renderBriefingText(clauses[0])}
                                </p>
                                {clauses.slice(1).map((c, ci) => (
                                  <p key={ci} className="text-[11px] text-slate-400 font-medium leading-relaxed">
                                    {renderBriefingText(c)}
                                  </p>
                                ))}
                              </div>
                            );
                          })()}

                          {catalyst && (
                            <div className="flex items-start gap-2 pt-2 mt-0.5 border-t border-white/5">
                              <span className="text-[8px] font-bold tracking-widest uppercase text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded shrink-0 mt-[1px]">NEWS</span>
                              {catalystUrl ? (
                                <a href={catalystUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-slate-400 font-medium leading-relaxed hover:text-cyan-300 hover:underline transition-colors">
                                  {catalyst}
                                </a>
                              ) : (
                                <span className="text-[11px] text-slate-400 font-medium leading-relaxed">{catalyst}</span>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            </div>
          )}

          <div className="border-t border-white/5 pt-5 md:pt-6 mt-4">
            <span className="inline-flex text-[10px] sm:text-xs md:text-sm font-bold border px-2.5 sm:px-4 py-1.5 rounded-lg tracking-widest uppercase items-center gap-2 text-[#7c8bfa] bg-[#161c2a]/40 border-white/5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
              LIVE SESSION UPDATES
            </span>
            {status === 'Loading' && !data ? (
              <div className="animate-pulse bg-[#161c2a]/40 border border-white/5 rounded-xl p-3 sm:p-5 md:p-6 mt-3">
                <div className="h-3 bg-white/5 rounded w-1/4 mb-4"></div>
                <div className="h-3 bg-white/5 rounded w-full mb-2"></div>
                <div className="h-3 bg-white/5 rounded w-11/12 mb-6"></div>
                <div className="h-12 bg-white/5 border-l-[4px] border-white/10 rounded-r-xl w-full"></div>
              </div>
            ) : (
              <div className="animate-in fade-in duration-500 flex flex-col gap-2">
                {data?.morning && renderSingleUpdateBlock(data.morning, 'morning')}
                {data?.midday && renderSingleUpdateBlock(data.midday, 'midday')}
                {data?.closing && renderSingleUpdateBlock(data.closing, 'closing')}

                {!data?.morning && !data?.midday && !data?.closing && (
                  <div className="text-center py-8 text-slate-500 text-sm font-medium border border-dashed border-white/10 rounded-xl mt-3">
                    Awaiting pre-market data ingestion...
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
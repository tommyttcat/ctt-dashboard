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
       and Sector Concentration / ETF Flow / Money Flow close as context rather than
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

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { cachedJson, fetchScannerLatest } from '@/lib/scannerLatest';
import { isTradingDay } from '@/lib/marketCalendar';
import TickerChartHover, { ActiveChartProvider, WatchlistBtn } from './TickerChartHover';
import { WatchlistToggle } from './WatchlistPanel';
import { hrsEdgeGrade } from '@/lib/scans/hrs';
import { edgeTier as edgeOf, EDGE_TINT, EDGE_FILTER_TIP, type EdgeTier } from '@/lib/scans/edge';
import { newsStarCount } from '@/lib/newsStars';
import { rsColor, rsBadge } from '@/lib/indicators/rs';
import { toCanonicalSector, isEtfSector, industryHeat, displaySector } from '@/lib/sectors';
import { stageColor, stageBadge } from '@/lib/indicators/stage';
import { rvolColor, stochColor } from '@/lib/indicators/columnColors';
import { getMarketSession } from '@/lib/indicators/marketScorecard';
/* The row formatters and scan-field accessors moved to lib/summary/rowFormat
   on 11 Sep 2026 — same code, no longer inside a 4,400-line component. */
import {
  BLUE_DOT_GLYPH,
  PLAN_MAX_REACH_ADR,
  POSTURE_META,
  catalystTagOf,
  catalystTextOf,
  chgOf,
  dVolOf,
  dotOf,
  fmtDollar,
  fmtLeader,
  fmtLevel,
  fmtPrc,
  fmtVolStr,
  hasRealCatalyst,
  livePlanOf,
  num,
  numOrNull,
  parseStdLine,
  pctFrom10,
  pctFrom21,
  posture,
  postureScoreAdj,
  priceOf,
  reachInAdr,
  rtrLabel,
  rvolOf,
  scoreOf,
  setupOf,
  setupRowLabel,
  slope21Of,
  stageOf,
  stdCols,
  tickerOf,
  titleCase,
  twoCol,
  TICKER_STOPWORDS,
} from '@/lib/summary/rowFormat';
import type { ParsedStdRow, PostureBucket } from '@/lib/summary/rowFormat';
/* The paragraph builders and the data shapes they produce moved to
   lib/summary/insights on 11 Sep 2026 — same code, outside the component. */
import {
  buildLocalInsights,
  etDayKey,
  getEstDateInfo,
  isDayName,
  parseEtDateTime,
} from '@/lib/summary/insights';
import type { EarningsEvent, EconEvent, MacroInsights } from '@/lib/summary/insights';



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







type MarketSession = 'Pre-Market' | 'Open' | 'Post-Market' | 'Closed';
type BlockKey = 'morning' | 'midday' | 'closing';

const getCurrentEstDecimal = () => {
  const est = getEstDateInfo();
  return est.getHours() + est.getMinutes() / 60;
};

/* Non-session day: weekend or market holiday. Used to test weekends only,
   which showed live session blocks on a day with no session. */
const isWeekendNow = () => !isTradingDay();

const BLOCK_WINDOWS: Record<BlockKey, { opens: number; supersededAt: number; nextLabel: string }> = {
  morning: { opens: 4.0, supersededAt: 11.5, nextLabel: 'midday' },
  midday: { opens: 11.5, supersededAt: 15.5, nextLabel: 'closing' },
  closing: { opens: 15.5, supersededAt: 24, nextLabel: '' },
};

const formatTime = (date: Date) =>
  date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'America/New_York',
  });

/* TR, ST, TG, REV and the rest are label words, not tickers. Without them
   here the renderer chips them like symbols and SectionCopyButton copies
   them into a TradingView watchlist. ST and TR are real tickers (Sensata,
   Tootsie Roll) — an acceptable trade, since neither has appeared on this
   board and the level pattern matches first anyway. */

/* The one-word catalyst tags classifyWiim can produce. Matched explicitly so
   they render as tags rather than as prose — and so "FDA" does not get chipped
   as a ticker. */
const CATALYST_TAGS = 'Earnings|FDA|Analyst|M&A|Offering|Contract|Guidance|Legal|Volatility|Sector';
const CATALYST_TAGS_SET = new Set(CATALYST_TAGS.split('|'));

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
const TICKER_CHIP_BASE = "inline-block align-baseline text-[7px] font-bold text-slate-300 bg-slate-500/10 px-1 py-[1px] rounded border border-white/10 tracking-wider mx-0.5 text-center";
const TICKER_CHIP_RED = "inline-block align-baseline text-[7px] font-bold text-rose-200 bg-rose-950 px-1 py-[1px] rounded border border-rose-500/20 tracking-wider mx-0.5 text-center";
const TICKER_CHIP_A = "inline-block align-baseline text-[7px] font-bold text-emerald-300 bg-emerald-500/10 px-1 py-[1px] rounded border border-emerald-400/30 tracking-wider mx-0.5 text-center";
const TICKER_CHIP_B = "inline-block align-baseline text-[7px] font-bold text-amber-300 bg-amber-500/10 px-1 py-[1px] rounded border border-amber-400/30 tracking-wider mx-0.5 text-center";

/* The grade used to occupy its own 14px column to the left of the ticker. It
   is a property of the ticker, so it now colours the chip itself and that
   column is gone — every row starts 14px further left.

   Red still wins over any grade: an avoid or an active red dot is a warning,
   and a good grade must not paint over it. */
const gradeChipCls = (grade: 'A' | 'B' | null | undefined, isAvoid: boolean): string =>
  isAvoid ? TICKER_CHIP_RED
    : grade === 'A' ? TICKER_CHIP_A
    : grade === 'B' ? TICKER_CHIP_B
    : TICKER_CHIP_BASE;
const tickerChipCls = `${TICKER_CHIP_BASE} min-w-[24px] md:min-w-[28px]`;
const tickerChipAlignedCls = `${TICKER_CHIP_BASE} w-[30px] md:w-[34px]`;

const PROSE_CHIP_BASE = "inline-block align-baseline text-[7px] font-bold text-slate-300 bg-slate-500/10 px-1 py-[1px] rounded border border-white/10 tracking-wider mx-0.5 text-center min-w-[28px]";
const PROSE_CHIP_RED = "inline-block align-baseline text-[7px] font-bold text-rose-200 bg-rose-950 px-1 py-[1px] rounded border border-rose-500/20 tracking-wider mx-0.5 text-center min-w-[28px]";
const PROSE_CHIP_A = "inline-block align-baseline text-[7px] font-bold text-emerald-300 bg-emerald-500/10 px-1 py-[1px] rounded border border-emerald-400/30 tracking-wider mx-0.5 text-center min-w-[28px]";
const PROSE_CHIP_B = "inline-block align-baseline text-[7px] font-bold text-amber-300 bg-amber-500/10 px-1 py-[1px] rounded border border-amber-400/30 tracking-wider mx-0.5 text-center min-w-[28px]";
const proseChipCls = (grade: 'A' | 'B' | null | undefined, isAvoid: boolean): string =>
  isAvoid ? PROSE_CHIP_RED : grade === 'A' ? PROSE_CHIP_A : grade === 'B' ? PROSE_CHIP_B : PROSE_CHIP_BASE;
const valNum = "text-[9px] tabular-nums";
const rowText = "text-[12px]";

/* Aligned rows scroll rather than clip. The scrollbar is suppressed because
   on a touch device it is an overlay that never appears, and on desktop
   these rows fit and never scroll — a visible track would be pure noise. */
/* `overflow-y-hidden` is load-bearing, not decoration. CSS promotes the other
   axis from `visible` to `auto` as soon as one axis scrolls, so `overflow-x-auto`
   alone quietly made every row a *vertical* scroller as well. The chips carry
   18px of touch padding on mobile, which pushes the row's content taller than
   its box — so a swipe scrolled those few pixels inside the row instead of
   scrolling the page: the line slid up and nothing else moved. Pinning the y
   axis keeps the horizontal scroll and hands vertical swipes back to the page. */
const scrollRowCls = "overflow-x-auto overflow-y-hidden -mx-0.5 px-0.5";
const scrollRowStyle: React.CSSProperties = { scrollbarWidth: 'none', msOverflowStyle: 'none' };

/* Percentile thresholds, matching @/lib/indicators/rs. Not imported from
   there because this file colours inline prose tokens rather than table
   cells and takes a bare number, but the ladder is identical on purpose. */
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
/* The only two sections that share a row. They are adjacent in the section
   order and both read as short context blocks, so pairing them costs no
   reordering and saves a full section's height. */
/* Which sections share a row, in pairs that are meant to be read across:
   the sector bars beside Sector Concentration (the same groups drawn and listed),
   then ETF Flow beside Money Flow (the two halves of where the dollars went).

   PAIRING IS POSITIONAL — a paired section drops its `lg:col-span-2` and the
   grid fills in order, so partners must be ADJACENT in orderedParas. Moving
   one without the other silently re-pairs it with whatever lands next. */
const PAIRED_SECTIONS = new Set(['Sector Performance', 'Sector Concentration', 'ETF Flow', 'Money Flow']);

const ALIGNED_SECTIONS = new Set([
  'Top Movers', 'SIPs Thesis', '$Vol Summary',
  'Daily Setups Thesis', 'Reversal Swing Thesis',
  '10/21 Thesis', 'VCP Thesis', 'EP9M Thesis', '100-Bagger Thesis', 'Setups Summary', 'Sector Concentration', 'ETF Flow', 'Money Flow',
  'Key Events',
]);

/* A ROW starts with a ticker (all-caps, 1-5 chars, then a space) or with a
   signed percentage (Sector Concentration has no ticker). Prose never does, so
   "$57.7B in tracked dollar volume..." keeps its natural spacing while the
   dollar magnets below it get aligned columns. */
const isRowLine = (line: string): boolean => {
  const t = line.trim();
  return /^[A-Z]{1,5}\s/.test(t) || /^[+-]\d/.test(t) || /^[▸∅]?\s*\d{1,2}:\d{2}\s/.test(t);
};

const SETUP_BADGES: Record<string, { label: string; cls: string }> = {
  'Gap & Go': { label: 'GNG', cls: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
  'Gap and Go': { label: 'GNG', cls: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
  'Trend Hold': { label: 'TH', cls: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20' },
  '20 EMA PB': { label: 'PB', cls: 'text-violet-400 bg-violet-500/10 border-violet-500/20' },
  'BB SQZ': { label: 'SQZ', cls: 'text-rose-400 bg-rose-500/10 border-rose-500/20' },
  'Episodic Pivot': { label: 'EP', cls: 'text-rose-400 bg-rose-500/10 border-rose-500/20' },
};

const renderBriefingText = (text: string, align = false, gradeMap?: Record<string, 'A' | 'B'>, dotMap?: Record<string, 'blue' | 'red'>, postureMap?: Record<string, PostureBucket>, avoidSet?: Set<string>): React.ReactNode[] => {
  const rx = new RegExp(
    `(▸|●|∅|N0|Gap & Go|Gap and Go|Trend Hold|20 EMA PB|Episodic Pivot|BB SQZ` +
    `|REV|RED DOT|BLUE DOT|\\[[^\\]]+\\]\\([^)]+\\)|\\d{1,2}:\\d{2} (?:AM|PM)` +
    `|(?:act|est|prev) (?:-?\\d+(?:\\.\\d+)?[BMK]?|—)` +
    `|RVOL (?:\\d+(?:\\.\\d+)?|—)|VOL (?:\\d+(?:\\.\\d+)?[MK]|—)|CNF \\d+|Stage \\d[ABC]?|stoch \\d+(?:\\.\\d+)?` +
    `|RS \\d{1,2}\\b|\\bT[2-9]\\b|(?:TR|ST|TG) \\d+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?x ADR` +
    `|\\d+(?:\\.\\d+)?R\\+?|\\b(?:${CATALYST_TAGS})\\b|10\\/21|S&P|Nasdaq|Dow|Bitcoin` +
    `|\\$\\d+(?:\\.\\d+)?[BMK]|[+-]\\d+(?:\\.\\d+)?%|\\b[A-Z]{1,5}\\b)`,
    'g'
  );
  const parts = text.split(rx);

  const chgW = align ? 'inline-block min-w-[38px] md:min-w-[44px] text-right' : '';
  const cnfW = align ? 'min-w-[18px] md:min-w-[20px] text-center' : '';
  const rtrW = align ? 'min-w-[24px] md:min-w-[28px] text-center' : '';
  const rvolW = align ? 'inline-block min-w-[22px] md:min-w-[26px] text-right' : '';
  const volW = align ? 'inline-block min-w-[28px] md:min-w-[34px] text-right ml-1' : '';
  const lvlValW = align ? 'inline-block min-w-[24px] md:min-w-[28px] text-right' : '';
  const dvolW = align ? 'inline-block min-w-[34px] md:min-w-[40px] text-right ml-1' : '';

  /* v2.3 — VCP row slots.

     RS previously rendered at its natural width, which was fine while it
     only appeared mid-sentence in a watch card. In an aligned row it drifts:
     "RS 88" and "RS 100" differ by a character and every column after them
     shifts. Two digits is the real ceiling (the rating is 1-99) so the slot
     is sized for that and right-aligned like every other numeric.

     The leg count had no token at all and fell through as plain text, so
     T3 and T4 sat wherever the preceding column left them. */
  const rsValW = align ? 'inline-block min-w-[16px] md:min-w-[18px] text-right' : '';
  const legW = align ? 'min-w-[18px] md:min-w-[20px] text-center' : '';

  const newsW = align ? 'inline-block w-[10px] md:w-[12px] text-center' : 'inline-block';
  const newsEndW = align ? 'inline-block min-w-[14px] md:min-w-[16px] text-center' : 'inline-block';

  let hasBlueDot = false;
  const rendered = parts.map((part, i) => {
    if (!part) return null;
    if (part === '▸') return <span key={i} className={`text-rose-400 font-bold ${align ? 'inline-block w-[10px] text-center' : ''}`}>▸</span>;
    if (part === BLUE_DOT_GLYPH) {
      if (dotMap) return null;
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
    if (part === 'BLUE DOT') return <span key={i} className="text-cyan-400 font-bold tracking-wide text-[10px]">BLUE DOT</span>;

    if (part === '∅') {
      return <span key={i} className={newsW} aria-hidden="true" />;
    }

    if (part === 'N0') {
      return <span key={i} className={newsEndW}></span>;
    }

    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const starTip = linkMatch[1].match(/^(★+)≡(.*)≡$/);
      if (starTip) {
        const count = starTip[1].length;
        const cls = count >= 2 ? 'text-amber-400' : 'text-slate-500';
        return (
          <a
            key={i}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            title={starTip[2]}
            onClick={(e) => e.stopPropagation()}
            className={`${newsEndW} ${cls} hover:brightness-125 font-bold text-[7px] leading-none cursor-pointer transition-all`}
          >
            {starTip[1]}
          </a>
        );
      }
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
            className={`${newsEndW} text-amber-400/90 hover:text-amber-300 font-bold text-[7px] leading-none cursor-pointer transition-colors`}
          >
            ★
          </a>
        );
      }
      return <a key={i} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-cyan-300 hover:underline transition-colors">{linkMatch[1]}</a>;
    }
    if (/^\d{1,2}:\d{2} (?:AM|PM)$/.test(part)) {
      return <span key={i} className={`${valNum} text-amber-400 font-bold ${align ? 'inline-block min-w-[58px] md:min-w-[64px]' : ''}`}>{part}</span>;
    }

    let m = part.match(/^RVOL (\d+(?:\.\d+)?|—)$/);
    if (m) {
      const isDash = m[1] === '—';
      const v = isDash ? 0 : parseFloat(m[1]);
      return (
        <span key={i} className={align ? 'ml-1 md:ml-1.5' : ''}>
          <span className="text-slate-500 text-[7px]">RVOL</span>{' '}
          <span className={`${valNum} ${isDash ? 'text-slate-600' : rvolColor(v)} ${rvolW}`}>{isDash ? '—' : `${v < 1 ? v.toFixed(1) : Math.round(v)}x`}</span>
        </span>
      );
    }
    m = part.match(/^VOL (\d+(?:\.\d+)?[MK]|—)$/);
    if (m) {
      const isDash = m[1] === '—';
      return <span key={i} className={`${valNum} ${isDash ? 'text-slate-600' : 'text-slate-400'} ${volW}`}>{m[1]}</span>;
    }
    m = part.match(/^(act|est|prev) (-?\S+)$/);
    if (m) {
      return (
        <span key={i} className={align ? 'inline-block ml-1.5' : ''}>
          <span className="text-slate-500 text-[7px] tracking-tight">{m[1]}</span>{' '}
          <span className={`${valNum} text-slate-200 ${align ? 'inline-block min-w-[28px] md:min-w-[32px] text-right' : ''}`}>{m[2]}</span>
        </span>
      );
    }
    m = part.match(/^CNF (\d+)$/);
    if (m) {
      const v = parseInt(m[1], 10);
      return (
        <span
          key={i}
          className={`inline-block align-baseline text-[7px] font-bold tabular-nums px-1 py-[1px] rounded border mx-0.5 ${cnfW} ${cnfBadgeCls(v)}`}
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
          <span className="text-slate-500 text-[7px]">RS</span>{' '}
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
          className={`inline-block align-baseline text-[7px] font-bold tabular-nums px-1 py-[1px] rounded border mx-0.5 cursor-help ${legW} ${cls}`}
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
          <span className="text-slate-500 text-[7px] tracking-tight">{m[1]}</span>
          <span className={`${valNum} ${tone} ${lvlValW}`}>{m[2]}</span>
        </span>
      );
    }
    m = part.match(/^(\d+(?:\.\d+)?)x ADR$/);
    if (m) {
      const v = parseFloat(m[1]);
      return <span key={i}><span className={`${valNum} ${reachColor(v)}`}>{m[1]}×</span> <span className="text-slate-500 text-[7px]">ADR</span></span>;
    }
    m = part.match(/^(\d+(?:\.\d+)?)R(\+?)$/);
    if (m) {
      const v = parseFloat(m[1]);
      return (
        <span
          key={i}
          className={`inline-block align-baseline text-[7px] font-bold tabular-nums px-1 py-[1px] rounded border mx-0.5 ${rtrW} ${rtrBadgeCls(v)}`}
        >
          {part}
        </span>
      );
    }
    if (new RegExp(`^(?:${CATALYST_TAGS})$`).test(part)) {
      return (
        <span key={i} className={`hidden md:inline text-[7px] font-bold tracking-wider uppercase text-amber-400/80 ${align ? 'ml-1' : ''}`}>
          {part}
        </span>
      );
    }
    if (part === 'EP') return <span key={i} className="hidden md:inline-block align-baseline text-[7px] font-bold tracking-wider uppercase px-1 py-[1px] rounded border mx-0.5 text-rose-400 bg-rose-500/10 border-rose-500/20">EP</span>;
    if (part === 'R2G') return <span key={i} className="hidden md:inline-block align-baseline text-[7px] font-bold tracking-wider uppercase px-1 py-[1px] rounded border mx-0.5 text-emerald-400 bg-emerald-500/10 border-emerald-500/20">R2G</span>;
    if (part === 'PB') return <span key={i} className="hidden md:inline-block align-baseline text-[7px] font-bold tracking-wider uppercase px-1 py-[1px] rounded border mx-0.5 text-violet-400 bg-violet-500/10 border-violet-500/20">PB</span>;
    if (part === '10/21') return <span key={i} className={`${valNum} text-violet-400 font-bold`}>10/21</span>;
    if (part === 'S&P' || part === 'Nasdaq' || part === 'Dow' || part === 'Bitcoin') {
      return <span key={i} className={align ? tickerChipAlignedCls : PROSE_CHIP_BASE}>{part}</span>;
    }
    if (/^\$\d+(?:\.\d+)?[BMK]$/.test(part)) return <span key={i} className={`${valNum} text-slate-200 ${dvolW}`}>{part}</span>;
    if (/^[+]\d+(?:\.\d+)?%$/.test(part)) return <span key={i} className={`${valNum} text-emerald-400 ${chgW}`}>{part}</span>;
    if (/^-\d+(?:\.\d+)?%$/.test(part)) return <span key={i} className={`${valNum} text-rose-400 ${chgW}`}>{part}</span>;
    if (part === 'DAY') return <span key={i} className="text-amber-400">DAY</span>;
    if (part === 'SWING') return <span key={i} className="text-cyan-400">SWING</span>;
    const setupBadge = SETUP_BADGES[part];
    if (setupBadge) {
      return <span key={i} className={`hidden md:inline-block align-baseline text-[7px] font-bold tracking-wider uppercase px-1 py-[1px] rounded border mx-0.5 ${setupBadge.cls}`}>{setupBadge.label}</span>;
    }
    if (/^[A-Z]{2,5}$/.test(part) && !TICKER_STOPWORDS.has(part)) {
      const grade = gradeMap?.[part];
      const pb = postureMap?.[part];
      const pMeta = pb ? POSTURE_META[pb] : null;
      const isAvoid = avoidSet?.has(part) || dotMap?.[part] === 'red';
      if (dotMap?.[part] === 'blue') hasBlueDot = true;
      /* Grade colours the chip here too, so the letter and its 10px slot are
         gone — the same rule as the aligned rows. */
      const chipCls = align ? `${gradeChipCls(grade, isAvoid)} w-[38px] md:w-[44px]` : proseChipCls(grade, isAvoid);
      return (
        <React.Fragment key={i}>
          <TickerChartHover symbol={part}><span className={chipCls}>{part}</span></TickerChartHover>
          {pMeta && <span title={`${pMeta.short} — ${pMeta.tip}`} className={`inline-block w-[6px] h-[6px] rounded-full align-middle ml-0.5 cursor-help ${pMeta.tone === 'good' ? 'bg-emerald-400' : pMeta.tone === 'warn' ? 'bg-amber-400' : 'bg-rose-400'}`} />}
        </React.Fragment>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
  if (hasBlueDot) rendered.push(<span key="dot-end" className="text-sky-400 text-[10px] align-baseline ml-1" title="Blue Dot reversal — oversold stochastic reset fired on the daily">{BLUE_DOT_GLYPH}</span>);
  return rendered;
};

const EXTRA_TOKEN_RX = new RegExp(
  `(${BLUE_DOT_GLYPH}|RED DOT|REV|BB SQZ|Gap & Go|Gap and Go|Trend Hold|20 EMA PB|Episodic Pivot|` +
  `RS \\d+|TR \\d+(?:\\.\\d+)?|ST \\d+(?:\\.\\d+)?|EP:\\d+|` +
  `${CATALYST_TAGS}|\\S+)`,
  'g'
);

const renderStdRow = (p: ParsedStdRow, idx: number, gradeMap?: Record<string, 'A' | 'B'>, dotMap?: Record<string, 'blue' | 'red'>, postureMap?: Record<string, PostureBucket>, avoidSet?: Set<string>, chartHover?: boolean, priceMap?: Record<string, number>, rsMap?: Record<string, number>, stageMap?: Record<string, string>, skipWatchlistBtn?: boolean, edgeMap?: Record<string, EdgeTier>): React.ReactNode => {
  const mapGrade = gradeMap?.[p.ticker] ?? null;
  const cnfGrade: 'A' | 'B' | null = p.cnf >= 70 ? 'A' : p.cnf >= 50 ? 'B' : null;
  const grade = cnfGrade === 'A' ? 'A' : mapGrade ?? cnfGrade;
  const dot = dotMap?.[p.ticker] ?? null;
  const isAvoid = avoidSet?.has(p.ticker) ?? false;
  const pb = postureMap?.[p.ticker] ?? null;
  const pMeta = pb ? POSTURE_META[pb] : null;
  if (p.rs == null && rsMap?.[p.ticker] != null) p = { ...p, rs: rsMap[p.ticker] };
  if ((!p.stage || p.stage === '—') && stageMap?.[p.ticker]) p = { ...p, stage: stageMap[p.ticker] };
  const rv = p.rvol;
  const isDash = p.vol === '—';
  const dIsDash = p.dvol === '—';
  const chipBase = gradeChipCls(grade, isAvoid || dot === 'red');

  const extraEls: React.ReactNode[] = [];
  /* T# is a COLUMN, not a trailing extra — it belongs beside the other
     per-row numbers rather than after the news star. TR and ST are gone from
     this summary entirely; the levels live in the plan tooltip. */
  let tNum: string | null = null;
  if (p.extraStr) {
    const tokens = p.extraStr.match(EXTRA_TOKEN_RX) || [];
    tokens.forEach((ex, ei) => {
      if (ex === BLUE_DOT_GLYPH || SETUP_BADGES[ex] || ex === 'REV') {
        // handled as dedicated columns, skip
      } else if (ex === 'RED DOT') {
        extraEls.push(<span key={`ex${ei}`} className="text-rose-400 text-[10px] align-baseline ml-0.5" title="Active red dot — grade-capped on the long side">{BLUE_DOT_GLYPH}</span>);
      } else if (/^T[2-9]$/.test(ex)) {
        tNum = ex;
      } else if (/^EP:\d+$/.test(ex)) {
        const rptN = Number(ex.split(':')[1]);
        extraEls.push(<span key={`ex${ei}`} className={`hidden md:inline relative group/rpt text-[7px] font-bold ml-1 px-1 py-[1px] rounded border cursor-help ${rptN >= 3 ? 'text-fuchsia-400 border-fuchsia-500/20 bg-fuchsia-500/10' : 'text-purple-400 border-purple-500/20 bg-purple-500/10'}`}>EP{rptN}<span className="absolute bottom-full left-0 mb-2 w-72 px-3.5 py-2.5 rounded-lg bg-[#1a2035] border border-white/10 shadow-2xl text-[10px] leading-[1.6] text-slate-300 font-normal whitespace-normal opacity-0 pointer-events-none group-hover/rpt:opacity-100 transition-opacity z-[9999]">{rptN} episodic pivots in the past 90 days</span></span>);
      } else if (/^TR \d/.test(ex) || /^ST \d/.test(ex)) {
        // removed from the summary — trigger and stop live in the plan tooltip
      } else if (CATALYST_TAGS_SET.has(ex)) {
        /* Catalyst tags are not rendered on the summary row: the star is the
           news marker and its tooltip already carries the tag, publisher, age
           and headline. The tag beside it was the same fact twice. */
      } else if (ex && ex !== '∅') {
        extraEls.push(<span key={`ex${ei}`} className="hidden md:inline text-[7px] text-slate-500 ml-1">{ex}</span>);
      }
    });
  }

  const edge = edgeMap?.[p.ticker] ?? null;

  return (
    <div key={idx} className={`flex items-center ${edge ? `${EDGE_TINT[edge]} rounded-sm` : ''}`}
      title={edge ? `${edge.toUpperCase()} — ${EDGE_FILTER_TIP[edge]}` : undefined}>
      {!skipWatchlistBtn && <span className="hidden md:inline-flex shrink-0" style={{ width: 0, overflow: 'visible', position: 'relative' }}><span style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)' }}><WatchlistBtn symbol={p.ticker} /></span></span>}
      <div className={`${scrollRowCls} flex-1 min-w-0`} style={scrollRowStyle}>
      <div className="flex items-center whitespace-nowrap py-[1px]">
        <TickerChartHover symbol={p.ticker}><span className={`${chipBase} w-[38px] md:w-[44px]`}>{p.ticker}</span></TickerChartHover>
        <span className="inline-block w-[12px] text-center leading-none shrink-0" />
        <span className="inline-block w-[8px] text-center shrink-0">
          {p.blueDot && <span className="inline-block w-1.5 h-1.5 rounded-full bg-sky-400 shadow-[0_0_5px_rgba(56,189,248,0.6)]" title="Blue Dot reversal — oversold stochastic reset fired on the daily" />}
        </span>
        <span className="inline-block w-[8px] text-center shrink-0">
          {pMeta ? <span title={`${pMeta.short} — ${pMeta.tip}`} className={`inline-block w-[6px] h-[6px] rounded-full cursor-help ${pMeta.tone === 'good' ? 'bg-emerald-400' : pMeta.tone === 'warn' ? 'bg-amber-400' : 'bg-rose-400'}`} /> : null}
        </span>
        <span className={`inline-block align-baseline text-[7px] font-bold tabular-nums rounded border ml-2 md:ml-1 w-[20px] md:w-[22px] leading-[14px] text-center ${cnfBadgeCls(p.cnf)}`}>{p.cnf}</span>
        <span className={`text-[9px] tabular-nums font-semibold inline-block w-[46px] md:w-[52px] text-right ml-1 ${p.chg >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{p.chg >= 0 ? '+' : ''}{p.chg.toFixed(2)}%</span>
        <span className="text-[9px] tabular-nums inline-block w-[36px] md:w-[42px] text-right text-slate-300 ml-2 md:ml-1">{fmtPrc(p.price ?? priceMap?.[p.ticker])}</span>
        <span className={`text-[9px] tabular-nums font-semibold inline-block w-[36px] md:w-[40px] text-right ml-2 md:ml-1 ${rv == null ? 'text-transparent' : rv >= 2 ? 'text-emerald-400' : rv >= 1.5 ? 'text-white' : 'text-slate-400'}`}>{rv != null ? `${rv < 1 ? rv.toFixed(1) : Math.round(rv)}x` : ''}</span>
        <span className={`text-[9px] tabular-nums inline-block w-[30px] md:w-[36px] text-right ml-2 md:ml-1 ${isDash ? 'text-transparent' : 'text-slate-400'}`}>{isDash ? '' : p.vol}</span>
        <span className={`text-[9px] tabular-nums inline-block w-[36px] md:w-[40px] text-right ml-2 md:ml-1 ${dIsDash ? 'text-transparent' : 'text-slate-300'}`}>{dIsDash ? '' : p.dvol}</span>
        {tNum && <span className="text-[9px] tabular-nums font-semibold text-slate-300 inline-block w-[20px] md:w-[24px] text-center ml-2 md:ml-1">{tNum}</span>}
        <span className="inline-block w-[22px] md:w-[24px] text-center ml-2 md:ml-1">{p.rs != null ? <span className={`inline-block w-[20px] md:w-[22px] leading-[14px] rounded border text-[7px] font-bold tabular-nums text-center ${rsBadge(p.rs)}`}>{p.rs}</span> : <span className="inline-block w-[20px] md:w-[22px] leading-[14px] rounded border text-[7px] font-bold tabular-nums text-center text-slate-600 border-slate-700/40 bg-slate-800/30">-</span>}</span>
        <span className="inline-block w-[22px] md:w-[24px] text-center ml-2 md:ml-1">{p.stage && p.stage !== '—' ? <span className={`inline-block w-[20px] md:w-[22px] leading-[14px] rounded border text-[7px] font-bold tabular-nums text-center ${stageBadge(p.stage)}`}>{p.stage}</span> : <span className="inline-block w-[20px] md:w-[22px] leading-[14px] rounded border text-[7px] font-bold tabular-nums text-center text-slate-600 border-slate-700/40 bg-slate-800/30">-</span>}</span>
        {p.newsCount >= 1 && p.newsUrl ? (
          <a href={p.newsUrl} target="_blank" rel="noopener noreferrer" title={p.newsTip || ''} onClick={(e) => e.stopPropagation()}
            className={`inline-block w-[14px] md:w-[16px] text-center ${p.newsCount >= 2 ? 'text-amber-400' : 'text-slate-500'} hover:brightness-125 font-bold text-[7px] leading-none cursor-pointer transition-all ml-2 md:ml-1`}>{'★'.repeat(p.newsCount)}</a>
        ) : (
          <span className="inline-block w-[14px] md:w-[16px] ml-2 md:ml-1"></span>
        )}
        {/* setup badges (REV, etc.) removed — N is the last column */}
        {extraEls}
      </div>
      </div>
    </div>
  );
};

type ParsedEventRow = {
  marker: string;
  time: string;
  event: string;
  act: string | null;
  est: string | null;
  prev: string | null;
};

const parseEventLine = (line: string): ParsedEventRow | null => {
  const t = line.trim();
  const m = t.match(/^([▸∅])\s+(?:(\d{1,2}:\d{2}\s(?:AM|PM))\s+)?(.+)$/);
  if (!m) return null;
  const marker = m[1];
  const time = m[2] || '';
  let rest = m[3];
  let act: string | null = null;
  let est: string | null = null;
  let prev: string | null = null;
  const prevM = rest.match(/\s+prev\s+(\S+)$/);
  if (prevM) { prev = prevM[1]; rest = rest.slice(0, prevM.index); }
  const estM = rest.match(/\s+est\s+(\S+)$/);
  if (estM) { est = estM[1]; rest = rest.slice(0, estM.index); }
  const actM = rest.match(/\s+act\s+(\S+)$/);
  if (actM) { act = actM[1]; rest = rest.slice(0, actM.index); }
  return { marker, time, event: rest.trim(), act, est, prev };
};

const renderEventRow = (p: ParsedEventRow, idx: number): React.ReactNode => {
  const pending = p.marker === '▸';
  return (
    <div key={idx} className={scrollRowCls} style={scrollRowStyle}>
      <div className="flex items-center whitespace-nowrap py-[1px]">
        <span className={`inline-block w-[10px] text-[10px] ${pending ? 'text-amber-400' : 'text-slate-600'}`}>{p.marker}</span>
        <span className="inline-block w-[62px] md:w-[68px] text-[9px] tabular-nums font-semibold text-slate-400 ml-1">{p.time}</span>
        <span className={`inline-block w-[180px] md:w-[240px] text-[9px] font-medium truncate ${pending ? 'text-slate-200' : 'text-slate-400'}`}>{p.event}</span>
        <span className={`inline-block w-[52px] md:w-[60px] text-[9px] tabular-nums font-semibold text-right ml-3 ${p.act ? 'text-emerald-400' : 'text-slate-600'}`}>{p.act || '—'}</span>
        <span className={`inline-block w-[52px] md:w-[60px] text-[9px] tabular-nums font-semibold text-right ml-1 ${p.est ? 'text-slate-300' : 'text-slate-600'}`}>{p.est || '—'}</span>
        <span className={`inline-block w-[52px] md:w-[60px] text-[9px] tabular-nums font-semibold text-right ml-1 ${p.prev ? 'text-slate-500' : 'text-slate-600'}`}>{p.prev || '—'}</span>
      </div>
    </div>
  );
};

type ParsedEarningsRow = {
  pending: boolean;
  ticker: string;
  beat: boolean | null;
  epsActual: string | null;
  epsEst: string | null;
  surprise: string;
  rev: string;
};

const parseEarningsLine = (line: string): ParsedEarningsRow | null => {
  const t = line.trim();
  const pending = t.startsWith('▸');
  const rest = pending ? t.slice(1).trim() : t;
  const m = rest.match(/^([A-Z]{1,5})\s+—\s+(.+)$/);
  if (!m) return null;
  const ticker = m[1];
  const info = m[2];
  const beatM = info.match(/^(BEAT|MISS)\s+(\S+)\s+vs\s+(\S+)(.*)$/);
  if (beatM) {
    const rest2 = beatM[4].trim();
    const revM = rest2.match(/·\s*(rev\s+\S+)/);
    const rev = revM ? revM[1] : '';
    const surprise = rest2.replace(/\s*·\s*rev\s+\S+/, '').trim();
    return { pending, ticker, beat: beatM[1] === 'BEAT', epsActual: beatM[2], epsEst: beatM[3], surprise, rev };
  }
  const estM = info.match(/^est\s+(\S+)\s+EPS(.*)$/);
  if (estM) {
    const rev = estM[2].replace(/^\s*·?\s*/, '').trim();
    return { pending, ticker, beat: null, epsActual: null, epsEst: estM[1], surprise: '', rev };
  }
  return null;
};

const renderEarningsRow = (p: ParsedEarningsRow, idx: number): React.ReactNode => {
  return (
    <div key={idx} className={scrollRowCls} style={scrollRowStyle}>
      <div className="flex items-center whitespace-nowrap py-[1px] min-w-[344px]">
        <span className={`inline-block w-[10px] text-[10px] ${p.pending ? 'text-amber-400' : 'text-transparent'}`}>{p.pending ? '▸' : ''}</span>
        <span className="inline-block w-[56px] md:w-[64px]">
          <TickerChartHover symbol={p.ticker}><span className={`${TICKER_CHIP_BASE} w-[38px] md:w-[44px]`}>{p.ticker}</span></TickerChartHover>
        </span>
        <span className="inline-block w-[44px] text-center">
          {p.beat != null && (
            <span className={`inline-block text-[7px] font-bold tracking-wider uppercase px-1 py-[1px] rounded border ${p.beat ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-rose-400 bg-rose-500/10 border-rose-500/20'}`}>{p.beat ? 'Beat' : 'Miss'}</span>
          )}
        </span>
        <span className={`inline-block w-[52px] text-right text-[9px] tabular-nums font-semibold ${p.beat != null ? 'text-slate-200' : 'text-slate-300'}`}>
          {p.beat != null ? p.epsActual : (p.epsEst || '—')}
        </span>
        <span className={`inline-block w-[46px] text-right text-[9px] tabular-nums font-semibold ${p.beat != null ? 'text-slate-400' : 'text-slate-600'}`}>
          {p.beat != null ? (p.epsEst || '—') : 'est'}
        </span>
        <span className={`inline-block w-[54px] text-right text-[9px] tabular-nums font-medium ${p.beat ? 'text-emerald-400/70' : 'text-rose-400/70'}`}>
          {p.beat != null ? p.surprise : ''}
        </span>
        <span className="inline-block w-[68px] text-right text-[9px] text-slate-500">
          {p.rev || ''}
        </span>
      </div>
    </div>
  );
};

const renderBodyLine = (line: string, li: number, aligned: boolean, gradeMap?: Record<string, 'A' | 'B'>, dotMap?: Record<string, 'blue' | 'red'>, postureMap?: Record<string, PostureBucket>, avoidSet?: Set<string>, priceMap?: Record<string, number>, rsMap?: Record<string, number>, stageMap?: Record<string, string>, edgeMap?: Record<string, EdgeTier>): React.ReactNode => {
  if (aligned) {
    const parsed = parseStdLine(line);
    if (parsed) return renderStdRow(parsed, li, gradeMap, dotMap, postureMap, avoidSet, true, priceMap, rsMap, stageMap, false, edgeMap);
    const evParsed = parseEventLine(line);
    if (evParsed) return renderEventRow(evParsed, li);
    const earnParsed = parseEarningsLine(line);
    if (earnParsed) return renderEarningsRow(earnParsed, li);
    return (
      <div key={li} className={scrollRowCls} style={scrollRowStyle}>
        <p className="text-[9px] text-slate-400 leading-relaxed font-medium whitespace-nowrap">
          {renderBriefingText(line, false, gradeMap, dotMap, postureMap, avoidSet)}
        </p>
      </div>
    );
  }
  return (
    <p key={li} className="text-[9px] text-slate-400 leading-relaxed font-medium">
      {renderBriefingText(line, false, gradeMap, dotMap, postureMap, avoidSet)}
    </p>
  );
};

/* The glyph key for every ticker row: grade letters, the 10/21 posture dots,
   the setup badges, TRAP, the blue dot and the news stars.

   RENDERED PER CARD rather than once at the top of the briefing. It began as a
   single strip above the whole panel, which is fine while you are reading top
   to bottom and useless the moment you collapse eight sections and look only
   at 10/21 — the key had scrolled away from the only rows still on screen.
   Each card carrying its own means the legend is always adjacent to the marks
   it explains. */
/* NO SETUP BADGES (GNG / TH / PB / SQZ / EP) — they are getting a dedicated
   filter card of their own, and a key for marks that live somewhere else is
   just clutter here. TRAP and the blue dot stay: those are warnings on the
   rows this strip sits above, not setup names. */
type SortKey = 'cnf' | 'chg' | 'rvol' | 'vol' | 'dvol' | 'stg' | 'rs' | 'alpha' | 'win' | 'high52' | 'hrs';
type SortDir = 'asc' | 'desc';

type ScanFilterKey = 'A' | 'B' | 'CNF' | 'RS' | '2A' | 'stacked' | 'first-touch' | 'pre-cross' | 'extended' | 'below-21' | 'trap' | 'bluedot' | 'news' | null;

const ALL_SCAN_KEYS = ['A','B','CNF','RS','2A','stacked','first-touch','pre-cross','extended','below-21','trap','bluedot','news'];
const SCAN_FILTER_KEY = 'ctt-scan-filter';
const loadSavedFilter = (): ScanFilterKey => {
  if (typeof window === 'undefined') return 'CNF';
  const v = localStorage.getItem(SCAN_FILTER_KEY);
  if (v && ALL_SCAN_KEYS.includes(v)) return v as ScanFilterKey;
  return 'CNF';
};

type ScanFilterCtx = {
  gradeMap?: Record<string, 'A' | 'B'>;
  postureMap?: Record<string, PostureBucket>;
  avoidSet?: Set<string>;
  dotMap?: Record<string, 'blue' | 'red'>;
};

const passesScanFilter = (key: ScanFilterKey, row: { cnf: number; rs: number | null; stage: string; ticker: string; newsCount: number }, ctx: ScanFilterCtx) => {
  if (!key) return true;
  const t = row.ticker;
  const g = ctx.gradeMap?.[t];
  switch (key) {
    case 'A': return g === 'A' || (g == null && row.cnf >= 70);
    case 'B': return g === 'B' || (g == null && row.cnf >= 50 && row.cnf < 70);
    case 'CNF': return row.cnf >= 50;
    case 'RS': return row.rs != null && row.rs >= 80;
    case '2A': return row.stage === '2A';
    case 'stacked': case 'first-touch': case 'pre-cross': case 'extended': case 'below-21':
      return ctx.postureMap?.[t] === key;
    case 'trap': return ctx.avoidSet?.has(t) || ctx.dotMap?.[t] === 'red';
    case 'bluedot': return ctx.dotMap?.[t] === 'blue';
    case 'news': return row.newsCount > 0;
  }
};

const passesPoolFilter = (key: ScanFilterKey, item: any) => {
  if (!key) return true;
  switch (key) {
    case 'A': return item.grade === 'A' || scoreOf(item) >= 70;
    case 'B': return item.grade === 'B' || (scoreOf(item) >= 50 && scoreOf(item) < 70);
    case 'CNF': return scoreOf(item) >= 50;
    case 'RS': { const r = num(item.rsRating); return r >= 80; }
    case '2A': return String(item.stage ?? '').trim() === '2A';
    case 'stacked': case 'first-touch': case 'pre-cross': case 'extended': case 'below-21':
      return (item.posture || null) === key;
    case 'trap': return item.dotKind === 'red';
    case 'bluedot': return item.dotKind === 'blue';
    case 'news': return !!(item.catalystUrl || (item.catalyst && item.catalyst !== 'Technical Momentum'));
  }
};

/* ---- Setups Summary — the one-stop-shop card ----------------------------
   Every filter pill is single-select. Click one to isolate that group, click
   it again to go back to ALL. Two rows of pills: setup patterns (from the
   scanner's setupName) and scan sources (tagged by buildLocalInsights). */
const renderSetupRow = (
  s: any, i: number,
  gradeMap?: Record<string, 'A' | 'B'>, dotMap?: Record<string, 'blue' | 'red'>,
  postureMap?: Record<string, PostureBucket>, avoidSet?: Set<string>,
  rsMap?: Record<string, number>, stageMap?: Record<string, string>,
) => {
  const line = `${s.ticker} ${stdCols(s)}`;
  const parsed = parseStdLine(line);
  if (!parsed) return null;
  parsed.price = priceOf(s);
  const overlap = s._cnfOverlap ?? 0;
  const streak = s._scanStreak ?? 0;
  const sources: string[] = s._cnfSources ?? [];
  const cnfTip = sources.map(k => CNF_SOURCE_LABELS[k] ?? k.toUpperCase()).join(' · ');
  const rpt = s._repeatPivot;
  const mbf = s._mbFund;
  const tipParts: string[] = [];
  if (overlap >= 2) tipParts.push(`${overlap} scanners: ${cnfTip}`);
  if (rpt) tipParts.push(`EP${rpt.count} — ${rpt.count} episodic pivots in 90d: ${rpt.events.map((e: any) => `${e.date} $${e.price?.toFixed(2) ?? '—'}`).join(', ')}`);
  const tip = tipParts.join('\n');
  const hasIndicator = overlap >= 2 || !!rpt;
  const indicatorLabel = overlap >= 2 ? overlap + '×' : rpt ? `EP${rpt.count}` : '';
  const indicatorColor = overlap >= 2 ? 'text-indigo-400/80' : rpt ? 'text-fuchsia-400/80' : 'text-slate-500';
  const mbGradeCls = mbf ? (mbf.grade === 'A' ? 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10' : mbf.grade === 'B' ? 'text-sky-400 border-sky-500/20 bg-sky-500/10' : mbf.grade === 'C' ? 'text-amber-400 border-amber-500/20 bg-amber-500/10' : 'text-slate-400 border-slate-500/20 bg-slate-500/10') : '';
  const edge = edgeOf(s);

  return (
    <div key={`ss-${s.ticker}-${i}`} className={`flex items-center gap-0 ${edge ? `${EDGE_TINT[edge]} rounded-sm` : ''}`}
      title={edge ? `${edge.toUpperCase()} — ${EDGE_FILTER_TIP[edge]}` : undefined}>
      <span className="hidden md:inline-flex shrink-0" style={{ width: 0, overflow: 'visible', position: 'relative' }}><span style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)' }}><WatchlistBtn symbol={s.ticker} /></span></span>
      <div className="w-[28px] shrink-0 flex items-center justify-end pr-1.5 gap-0.5">
        {hasIndicator && (
          <span className="relative group/cnf cursor-default">
            <span className={`text-[8px] font-bold ${indicatorColor}`}>
              {indicatorLabel}
            </span>
            <span className="absolute bottom-full left-0 mb-2 w-72 px-3.5 py-2.5 rounded-lg bg-[#1a2035] border border-white/10 shadow-2xl text-[10px] leading-[1.6] text-slate-300 font-normal whitespace-normal opacity-0 pointer-events-none group-hover/cnf:opacity-100 transition-opacity z-[9999]">
              {tipParts.map((t, ti) => <span key={ti} className="block">{t}</span>)}
            </span>
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">{renderStdRow(parsed, i, gradeMap, dotMap, postureMap, avoidSet, true, undefined, rsMap, stageMap, true)}</div>
    </div>
  );
};

type SetupFilter = { key: string; label: string; cls: string; match: (s: any) => boolean };

const SETUP_PATTERN_FILTERS: SetupFilter[] = [
  { key: 'gng',  label: 'GNG', cls: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    match: s => { const su = setupOf(s); return su === 'Gap & Go' || su === 'Gap and Go'; } },
  { key: 'th',   label: 'TH',  cls: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
    match: s => setupOf(s) === 'Trend Hold' },
  { key: 'pb',   label: 'PB',  cls: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
    match: s => setupOf(s) === '20 EMA PB' },
  { key: 'sqz',  label: 'SQZ', cls: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
    match: s => setupOf(s) === 'BB SQZ' },
  { key: 'stk',  label: 'STK', cls: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
    match: s => (s._scanStreak ?? 0) >= 3 },
  { key: 'fnd',  label: 'FND', cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    match: s => !!s._mbFund },
  { key: 'cnf',  label: 'CNF', cls: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
    match: s => (s._cnfOverlap ?? 0) >= 2 },
  { key: 'top',  label: 'TOP', cls: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
    match: s => !!s._isTop },
];

const SETUP_SOURCE_FILTERS: SetupFilter[] = [
  /* SIP has its own pill. Its names were always in the pool, but they were
     only reachable through DAY or SWING depending on how the row looked,
     so there was no way to ask the card "what is in play right now?" —
     which is the question the Stocks in Play scan exists to answer. SWING
     no longer claims them, so the two pills do not overlap. */
  { key: 'sip',   label: 'SIP',   cls: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
    match: s => s._source === 'sip' },
  { key: 'day',   label: 'DAY',   cls: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    match: s => isDayName(s) },
  { key: 'swing', label: 'SWING', cls: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
    match: s => s._source === 'swing' || (!isDayName(s) && s._source === 'daily') },
  { key: 'vcp',   label: 'VCP',   cls: 'text-teal-400 bg-teal-500/10 border-teal-500/20',
    match: s => s._source === 'vcp' },
  { key: 'ep9',   label: 'EP9',   cls: 'text-fuchsia-400 bg-fuchsia-500/10 border-fuchsia-500/20',
    match: s => s._source === 'ep9m' || setupOf(s) === 'EP' },
  { key: '1021',  label: '10/21', cls: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
    match: s => posture(s) != null && posture(s) !== 'below-21' && posture(s) !== 'extended' },
  { key: 'mb',    label: '100',   cls: 'text-fuchsia-400 bg-fuchsia-500/10 border-fuchsia-500/20',
    match: s => s._source === 'mb' },
];

const ALL_SETUP_FILTERS = [...SETUP_PATTERN_FILTERS, ...SETUP_SOURCE_FILTERS];

const SetupSummary = ({ pool, gradeMap, dotMap, postureMap, avoidSet, scanFilter: sf, rsMap, stageMap, topSet, onVisibleChange }: {
  pool: any[];
  gradeMap?: Record<string, 'A' | 'B'>;
  dotMap?: Record<string, 'blue' | 'red'>;
  postureMap?: Record<string, PostureBucket>;
  avoidSet?: Set<string>;
  scanFilter?: ScanFilterKey;
  rsMap?: Record<string, number>;
  stageMap?: Record<string, string>;
  topSet?: Set<string>;
  onVisibleChange?: (tickers: string[]) => void;
}) => {
  const taggedPool = React.useMemo(() => {
    if (!topSet?.size) return pool;
    return pool.map(s => topSet.has(s.ticker) ? { ...s, _isTop: true } : s);
  }, [pool, topSet]);

  const [activeKey, setActiveKey] = React.useState<string | null>('cnf');
  const [sortKey, setSortKey] = React.useState<SortKey>('cnf');
  const [sortDir, setSortDir] = React.useState<SortDir>('desc');

  const handleSort = (k: SortKey) => {
    if (sortKey === k) {
      if (sortDir === 'desc') setSortDir('asc');
      else { setSortKey('cnf'); setSortDir('desc'); }
    } else {
      setSortKey(k); setSortDir('desc');
    }
  };

  const toggle = (key: string) => {
    setActiveKey(prev => prev === key ? null : key);
  };

  /* Green by default: the card is the shortlist, so it opens on the names
     that cleared both losing filters and closed strong. The pills switch to
     yellow, red, or all with one click. */
  const [edgeKey, setEdgeKey] = React.useState<EdgeTier | null>('green');

  const filtered = React.useMemo(() => {
    const activeFilter = activeKey ? ALL_SETUP_FILTERS.find(f => f.key === activeKey) : null;
    let base = activeFilter ? taggedPool.filter(activeFilter.match) : taggedPool;
    if (sf) {
      base = base.filter(item => passesPoolFilter(sf, item));
    }
    if (edgeKey) base = base.filter(item => edgeOf(item) === edgeKey);
    const cmp = (a: any, b: any) => {
      let av = 0, bv = 0;
      switch (sortKey) {
        case 'cnf': av = scoreOf(a); bv = scoreOf(b); break;
        case 'chg': av = chgOf(a); bv = chgOf(b); break;
        case 'rvol': av = rvolOf(a) ?? 0; bv = rvolOf(b) ?? 0; break;
        case 'vol': av = num(a.vol); bv = num(b.vol); break;
        case 'dvol': av = dVolOf(a); bv = dVolOf(b); break;
        case 'rs': av = num(a.rsRating); bv = num(b.rsRating); break;
        case 'stg': av = num(a.stage); bv = num(b.stage); break;
      }
      return sortDir === 'desc' ? bv - av : av - bv;
    };
    return [...base].sort(cmp).slice(0, 20);
  }, [taggedPool, activeKey, edgeKey, sortKey, sortDir, sf]);

  const tickers = filtered.map(s => s.ticker).filter(Boolean);

  /* Copy should copy what the reader can see. The card's own filters (colour,
     setup, source) live in here, so the header — which owns the Copy and TXT
     buttons — has to be told what survived them. */
  const visibleKey = tickers.join(',');
  React.useEffect(() => {
    onVisibleChange?.(visibleKey ? visibleKey.split(',') : []);
  }, [visibleKey, onVisibleChange]);

  if (taggedPool.length === 0) return null;

  /* Colour quick-filter. Same single-select behaviour as the other pills:
     click to isolate, click again for all. Counts come from the same pool the
     rows do, so an empty state is visible before it is clicked. */
  const EDGE_FILTERS: { key: EdgeTier; label: string; cls: string }[] = [
    { key: 'green', label: 'GREEN', cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
    { key: 'yellow', label: 'YELLOW', cls: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
    { key: 'red', label: 'RED', cls: 'text-rose-400 bg-rose-500/10 border-rose-500/20' },
  ];

  const edgePills = () =>
    EDGE_FILTERS.map(f => {
      const count = taggedPool.filter(item => edgeOf(item) === f.key).length;
      if (count === 0) return null;
      const on = edgeKey === f.key;
      return (
        <button
          key={f.key}
          onClick={() => setEdgeKey(edgeKey === f.key ? null : f.key)}
          title={`${f.label} rows — ${EDGE_FILTER_TIP[f.key]}`}
          className={`text-[9px] font-bold tracking-wider uppercase px-1.5 py-[2px] rounded border transition-all duration-150 ${
            on ? f.cls : edgeKey == null ? f.cls : 'text-slate-600 bg-transparent border-white/5'
          }`}
        >
          {f.label} {count}
        </button>
      );
    });

  const pills = (filters: SetupFilter[]) =>
    filters.map(f => {
      const on = activeKey === f.key;
      const count = taggedPool.filter(f.match).length;
      // A pill with nothing behind it is noise: hide it rather than grey it.
      if (count === 0) return null;
      return (
        <button
          key={f.key}
          onClick={() => toggle(f.key)}
          className={`text-[9px] font-bold tracking-wider uppercase px-1.5 py-[2px] rounded border transition-all duration-150 ${
            on ? f.cls : activeKey == null ? f.cls : 'text-slate-600 bg-transparent border-white/5'
          }`}
        >
          {f.label} {count}
        </button>
      );
    });

  return (
    <div>
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        {pills(SETUP_SOURCE_FILTERS)}
        {pills(SETUP_PATTERN_FILTERS)}
        {edgePills()}
      </div>
      {filtered.length === 0 ? (
        <p className="text-[10px] text-slate-500 font-medium">No names match the active filter.</p>
      ) : (
        <>
          {(() => {
            const useTwoCols = filtered.length > 5;
            const mid = useTwoCols ? Math.ceil(filtered.length / 2) : filtered.length;
            const left = filtered.slice(0, mid);
            const right = useTwoCols ? filtered.slice(mid) : [];
            return (
              <div className={useTwoCols ? 'grid grid-cols-1 md:grid-cols-2 gap-x-6' : ''}>
                <div className="space-y-0">
                  <div className="flex items-center gap-0">
                    <div className="w-[28px] shrink-0" />
                    <div className="flex-1 min-w-0"><SortableHeader sortKey={sortKey} sortDir={sortDir} onSort={handleSort} /></div>
                  </div>
                  {left.map((s, i) => renderSetupRow(s, i, gradeMap, dotMap, postureMap, avoidSet, rsMap, stageMap))}
                </div>
                {right.length > 0 && (
                  <div className="space-y-0">
                    <div className="hidden md:flex items-center gap-0">
                      <div className="w-[28px] shrink-0" />
                      <div className="flex-1 min-w-0"><SortableHeader sortKey={sortKey} sortDir={sortDir} onSort={handleSort} /></div>
                    </div>
                    {right.map((s, i) => renderSetupRow(s, 100 + i, gradeMap, dotMap, postureMap, avoidSet, rsMap, stageMap))}
                  </div>
                )}
              </div>
            );
          })()}
          <p className="text-[10px] text-slate-500 font-medium mt-2">
            {filtered.length} name{filtered.length !== 1 ? 's' : ''}{activeKey ? ` — ${ALL_SETUP_FILTERS.find(f => f.key === activeKey)?.label ?? activeKey}` : ' — all scans'}.
          </p>
          {/* Legend for the row tint. The three states come from the 5-year
              scanner backtest and only use traits that held in both halves —
              the tooltip carries the numbers so the line stays one row. */}
          <p className="relative group/edge text-[10px] text-slate-500 font-medium mt-1 cursor-help inline-flex items-center gap-2">
            <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-emerald-500/30" />green</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-amber-400/30" />yellow</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-rose-500/30" />red</span>
            <span className="absolute bottom-full left-0 mb-2 w-72 px-3.5 py-2.5 rounded-lg bg-[#1a2035] border border-white/10 shadow-2xl text-[10px] leading-[1.6] text-slate-300 font-normal whitespace-normal opacity-0 pointer-events-none group-hover/edge:opacity-100 transition-opacity z-[9999]">
              This card shows only the green rows: names that closed in the top 10% of the day&apos;s range (+0.26R) AND avoided the two filters that lost money in both halves of the 5-year backtest — ADR above 9% (−0.27R) and price $5–10 (−0.15R). The individual scan cards still show everything, tinted green/yellow/red.
            </span>
          </p>
        </>
      )}
    </div>
  );
};

const SetupSummaryHelp = () => {
  const [open, setOpen] = React.useState(false);
  const [pinned, setPinned] = React.useState(false);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);

  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const scheduleClose = () => { if (pinned) return; cancelClose(); closeTimer.current = setTimeout(() => setOpen(false), 220); };

  React.useEffect(() => {
    if (!pinned) return;
    const onDown = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) { setPinned(false); setOpen(false); } };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPinned(false); setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [pinned]);

  React.useEffect(() => () => cancelClose(), []);

  const togglePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pinned) { setPinned(false); setOpen(false); } else { setPinned(true); setOpen(true); }
  };

  const gates = [
    { label: 'Sources', value: 'DAY · SIP · DVOL · SWING · VCP · EP9 · 100B' },
    { label: 'Overlap (×)', value: 'Tickers in 2+ scanners simultaneously' },
    { label: 'Streak (#)', value: 'Consecutive 15-min scans a ticker has appeared' },
    { label: 'CNF', value: 'Confluence score from the primary scanner' },
    { label: 'STK filter', value: 'Shows tickers with 3+ consecutive scan appearances' },
    { label: 'CNF filter', value: 'Shows tickers appearing in 2+ scanners' },
  ];

  return (
    <div ref={wrapRef} className="relative inline-block" onMouseEnter={() => { cancelClose(); setOpen(true); }} onMouseLeave={scheduleClose} onClick={(e) => e.stopPropagation()}>
      <button onClick={togglePin} title={pinned ? 'Unpin' : 'Card guide — click to pin'} aria-label="Card guide"
        className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center transition-colors ${
          pinned || open ? 'bg-violet-500/30 text-violet-300 ring-1 ring-violet-400/40' : 'bg-white/5 text-slate-500 hover:bg-white/10 hover:text-slate-300'
        }`}
      >?</button>
      {open && (
        <div onMouseEnter={cancelClose} onMouseLeave={scheduleClose}
          className="absolute top-full mt-2 right-0 z-[70] w-[280px] rounded-xl border border-white/10 p-4 shadow-2xl shadow-black/60"
          style={{ backgroundColor: '#10141f' }}
        >
          <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-slate-100">Setups Summary</div>
          <div className="text-[9px] text-slate-500 mt-0.5 mb-3">All scans pooled into one ranked view.</div>
          <div className="space-y-1.5">
            {gates.map(g => (
              <div key={g.label} className="flex items-start justify-between gap-3">
                <span className="text-[8px] font-bold tracking-wide uppercase text-slate-400 whitespace-nowrap shrink-0">{g.label}</span>
                <span className="text-[9px] font-medium text-slate-300 text-right">{g.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const CNF_SOURCE_LABELS: Record<string, string> = {
  daily: 'DAY', sip: 'SIP', dvol: '$VOL', swing: 'SWG',
  coil: 'COIL', vcp: 'VCP', hrs: 'HRS', ep9m: 'EP9', multi: '100',
};

const KeyEventsPanel = ({ econ, earnings }: { econ: EconEvent[]; earnings: EarningsEvent[] }) => {
  const today = etDayKey(0);
  const tomorrow = etDayKey(1);
  const now = getEstDateInfo();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const econRows = econ
    .map(e => { const { dayKey, minutes } = parseEtDateTime(e.date); return { ...e, dayKey, minutes }; })
    .filter(e => e.dayKey === today && e.impact !== 'Low')
    .sort((a, b) => (a.minutes ?? 0) - (b.minutes ?? 0));

  const fmtTime = (min: number | null) => {
    if (min == null) return '';
    const h = Math.floor(min / 60) % 12 || 12;
    return `${h}:${String(min % 60).padStart(2, '0')} ${min >= 720 ? 'PM' : 'AM'}`;
  };
  const fmtNum = (v: any) => {
    if (v == null) return '—';
    const n = Number(v);
    if (isNaN(n)) return String(v);
    const a = Math.abs(n);
    if (a >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (a >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
    return String(n);
  };
  const fmtRev = (v: number | null | undefined) => {
    if (v == null) return '';
    if (v >= 1e9) return `rev ${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return `rev ${(v / 1e6).toFixed(0)}M`;
    return '';
  };

  const bigEarn = earnings.filter(e => {
    const dk = String(e.date || '').slice(0, 10);
    return (dk === today || dk === tomorrow) && (e.importance ?? 0) >= 7;
  }).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const todayE = bigEarn.filter(e => String(e.date).slice(0, 10) === today);
  const tmrwE = bigEarn.filter(e => String(e.date).slice(0, 10) === tomorrow);
  const aheadCount = econRows.filter(e => (e.minutes ?? 0) > nowMin).length;

  const econHdr = econRows.length
    ? `Economic — ${aheadCount ? `${aheadCount} still ahead` : 'all printed'}`
    : 'Economic';

  const earnCol = (label: string, list: typeof bigEarn) => {
    const pending = list.filter(e => e.epsActual == null);
    const reported = list.filter(e => e.epsActual != null);
    const hdr = pending.length ? `${label} — ${pending.length} pending` : reported.length ? `${label} — all reported` : label;
    return (
      <div>
        <p className="text-[9px] font-bold tracking-wider uppercase text-slate-500 mb-1">{hdr}</p>
        <div className="border-b border-white/5 mb-1 flex items-center gap-0 py-[2px]">
          <span className="w-[10px]" />
          <span className="w-[56px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-center">Ticker</span>
          <span className="w-[44px]" />
          <span className="w-[52px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-right">EPS</span>
          <span className="w-[46px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-right">EST</span>
          <span className="w-[54px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-right">SURP</span>
          <span className="w-[68px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-right">REV</span>
        </div>
        {list.length === 0 && <p className="text-[9px] text-slate-600 mt-1">No large-cap prints.</p>}
        {list.map((e, i) => {
          const beat = e.epsActual != null && e.epsEstimated != null ? e.epsActual >= e.epsEstimated : null;
          const surp = e.epsSurprisePct != null ? `${e.epsSurprisePct > 0 ? '+' : ''}${e.epsSurprisePct.toFixed(1)}%` : '';
          return (
            <div key={i} className="flex items-center py-[1px]">
              <span className={`w-[10px] text-[9px] ${e.epsActual == null ? 'text-amber-400' : 'text-transparent'}`}>{e.epsActual == null ? '▸' : ''}</span>
              <span className="w-[56px]">
                <TickerChartHover symbol={e.symbol}><span className={`${TICKER_CHIP_BASE} w-[38px] md:w-[44px]`}>{e.symbol}</span></TickerChartHover>
              </span>
              <span className="w-[44px] text-center">
                {beat != null && (
                  <span className={`inline-block text-[7px] font-bold tracking-wider uppercase px-1 py-[1px] rounded border ${beat ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-rose-400 bg-rose-500/10 border-rose-500/20'}`}>{beat ? 'Beat' : 'Miss'}</span>
                )}
              </span>
              <span className={`w-[52px] text-right text-[9px] tabular-nums font-semibold ${beat != null ? 'text-slate-200' : 'text-slate-300'}`}>
                {beat != null ? e.epsActual?.toFixed(2) : (e.epsEstimated?.toFixed(2) ?? '—')}
              </span>
              <span className={`w-[46px] text-right text-[9px] tabular-nums ${beat != null ? 'text-slate-400' : 'text-slate-600'}`}>
                {beat != null ? (e.epsEstimated?.toFixed(2) ?? '—') : 'est'}
              </span>
              <span className={`w-[54px] text-right text-[9px] tabular-nums font-medium ${beat === true ? 'text-emerald-400/70' : beat === false ? 'text-rose-400/70' : ''}`}>
                {beat != null ? surp : ''}
              </span>
              <span className="w-[68px] text-right text-[9px] text-slate-500">{fmtRev(e.revenueEstimated)}</span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-y-5">
      <div className="pr-4">
        <p className="text-[9px] font-bold tracking-wider uppercase text-slate-500 mb-1">{econHdr}</p>
        {econRows.length === 0 ? (
          <p className="text-[9px] text-slate-600 mt-1">Nothing scheduled today.</p>
        ) : (
          <>
            <div className="border-b border-white/5 mb-1 flex items-center gap-0 py-[2px]">
              <span className="w-[10px]" />
              <span className="w-[62px] text-[7px] font-bold tracking-widest uppercase text-slate-600">TIME</span>
              <span className="flex-1 text-[7px] font-bold tracking-widest uppercase text-slate-600">EVENT</span>
              <span className="w-[52px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-right">ACT</span>
              <span className="w-[52px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-right ml-1">EST</span>
              <span className="w-[52px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-right ml-1">PREV</span>
            </div>
            {econRows.map((e, i) => {
              const pending = (e.minutes ?? 0) > nowMin && e.actual == null;
              return (
                <div key={i} className="flex items-center py-[1px]">
                  <span className={`w-[10px] text-[9px] ${pending ? 'text-amber-400' : 'text-transparent'}`}>{pending ? '▸' : ''}</span>
                  <span className="w-[62px] text-[9px] text-slate-500 tabular-nums">{fmtTime(e.minutes)}</span>
                  <span className="flex-1 text-[9px] text-slate-300 truncate">{e.event}</span>
                  <span className={`w-[52px] text-right text-[9px] tabular-nums font-semibold ${e.actual != null ? 'text-emerald-400' : 'text-slate-600'}`}>{e.actual != null ? fmtNum(e.actual) : '—'}</span>
                  <span className="w-[52px] text-right text-[9px] tabular-nums text-slate-400 ml-1">{e.estimate != null ? fmtNum(e.estimate) : '—'}</span>
                  <span className="w-[52px] text-right text-[9px] tabular-nums text-slate-600 ml-1">{e.previous != null ? fmtNum(e.previous) : '—'}</span>
                </div>
              );
            })}
          </>
        )}
      </div>
      <div className="hidden md:block w-px bg-white/10 self-stretch" />
      <div className="space-y-4 pl-4">
        {earnCol(todayE.length ? 'Today' : 'Today', todayE)}
        {earnCol('Tomorrow', tmrwE)}
      </div>
    </div>
  );
};

/* Horizontal bars growing from a centre line, matching the briefing page's
   SectorSection. Green right, red left, the leader and the laggard brightest,
   and the spread called out — the spread is the number that says whether this
   is a stock-picker's tape or a market-driven one. */
const SectorBars = ({ body, heat }: { body: string; heat?: { sector: string; avgChg: number; count: number }[] }) => {
  let items: { name: string; pct: number }[];
  if (heat && heat.length >= 2) {
    items = heat.map(h => ({ name: h.sector, pct: h.avgChg }));
  } else {
    items = [];
    const re = /([A-Za-z][A-Za-z\s&'-]*?)\s*\(?([+-]\d+(?:\.\d+)?)%\)?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      items.push({ name: m[1].trim().replace(/^[,\s]+/, ''), pct: parseFloat(m[2]) });
    }
  }
  if (items.length < 2) return null;

  const maxAbs = Math.max(...items.map(s => Math.abs(s.pct)), 0.01);
  const spread = items[0].pct - items[items.length - 1].pct;

  return (
    <div>
      <div className="flex items-center justify-end pb-0.5 pt-1">
        <span className="text-[9px] text-slate-600 tabular-nums">Spread {spread.toFixed(2)}%</span>
      </div>
      <div className="overflow-hidden px-1.5 py-1.5">
        {items.map((s, i) => {
          const w = (Math.abs(s.pct) / maxAbs) * 42;
          const pos = s.pct >= 0;
          const first = i === 0;
          const last = i === items.length - 1;
          return (
            <div key={i} className="flex items-center px-1.5 py-[2px]">
              <span className={`text-[9px] w-[130px] md:w-[150px] text-right shrink-0 pr-2.5 truncate ${
                first ? 'text-emerald-300/90 font-medium' : last ? 'text-rose-300/90 font-medium' : 'text-slate-400'
              }`}>{s.name}</span>
              <div className="flex-1 h-[16px] relative">
                <div className="absolute left-1/2 top-[2px] bottom-[2px] w-px bg-slate-700/40" />
                <div
                  className={`absolute top-[2px] bottom-[2px] ${pos ? 'left-1/2 rounded-r-[3px]' : 'right-1/2 rounded-l-[3px]'}`}
                  style={{
                    width: `${w}%`,
                    background: pos
                      ? `linear-gradient(90deg, rgba(16,185,129,${first ? 0.3 : 0.2}) 0%, rgba(16,185,129,${first ? 0.85 : 0.55}) 100%)`
                      : `linear-gradient(270deg, rgba(244,63,94,${last ? 0.3 : 0.2}) 0%, rgba(244,63,94,${last ? 0.85 : 0.55}) 100%)`,
                  }}
                />
              </div>
              <span className={`text-[9px] font-semibold tabular-nums w-[46px] text-right shrink-0 pl-1.5 ${pos ? 'text-emerald-400' : 'text-rose-400'}`}>
                {pos ? '+' : ''}{s.pct.toFixed(2)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const ScanLegend = ({ activeFilter, onFilterChange }: { activeFilter?: ScanFilterKey; onFilterChange?: (k: ScanFilterKey) => void }) => {
  const cur = activeFilter ?? null;
  const toggle = (k: ScanFilterKey) => onFilterChange?.(cur === k ? null : k);
  const base = 'text-[7px] font-bold tracking-wider uppercase px-1 py-[1px] rounded border transition-all duration-150 cursor-pointer';
  const off = 'text-slate-500 bg-white/[0.03] border-white/[0.08] hover:text-slate-300 hover:border-white/15 hover:bg-white/[0.06]';
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1.5">
      <button onClick={() => toggle('A')} title="Grade A — CNF 70+" className={`${base} ${cur === 'A' ? 'text-emerald-300 bg-emerald-500/20 border-emerald-400/40' : 'text-emerald-400/70 bg-emerald-500/[0.08] border-emerald-500/15 hover:bg-emerald-500/15 hover:border-emerald-400/30'}`}>A</button>
      <button onClick={() => toggle('B')} title="Grade B — CNF 50–69" className={`${base} ${cur === 'B' ? 'text-amber-300 bg-amber-500/20 border-amber-400/40' : 'text-amber-400/70 bg-amber-500/[0.08] border-amber-500/15 hover:bg-amber-500/15 hover:border-amber-400/30'}`}>B</button>
      <button onClick={() => toggle('CNF')} title="CNF 50+ (all graded)" className={`${base} ${cur === 'CNF' ? 'text-slate-200 bg-white/15 border-white/25' : off}`}>CNF</button>
      <button onClick={() => toggle('RS')} title="RS 80+ (green + fuchsia)" className={`${base} ${cur === 'RS' ? 'text-purple-300 bg-purple-500/20 border-purple-400/40' : 'text-purple-400/70 bg-purple-500/[0.08] border-purple-500/15 hover:bg-purple-500/15 hover:border-purple-400/30'}`}>RS</button>
      <button onClick={() => toggle('2A')} title="Stage 2A — advancing base" className={`${base} ${cur === '2A' ? 'text-slate-200 bg-white/15 border-white/25' : off}`}>2A</button>
      <span className="w-px h-3 bg-white/10" />
      <button onClick={() => toggle('stacked')} title="Above both EMAs, trend intact" className={`${base} flex items-center gap-1 ${cur === 'stacked' ? 'text-emerald-300 bg-emerald-500/20 border-emerald-400/40' : off}`}>
        <span className="inline-block w-[5px] h-[5px] rounded-full bg-emerald-400" />STACKED
      </button>
      <button onClick={() => toggle('first-touch')} title="Pulled back to 10 EMA, holding above 21" className={`${base} flex items-center gap-1 ${cur === 'first-touch' ? 'text-emerald-300 bg-emerald-500/20 border-emerald-400/40' : off}`}>
        <span className="inline-block w-[5px] h-[5px] rounded-full bg-emerald-400" />1ST TOUCH
      </button>
      <button onClick={() => toggle('pre-cross')} title="10 and 21 converging — potential trend change" className={`${base} flex items-center gap-1 ${cur === 'pre-cross' ? 'text-amber-300 bg-amber-500/20 border-amber-400/40' : off}`}>
        <span className="inline-block w-[5px] h-[5px] rounded-full bg-amber-400" />PRE-CROSS
      </button>
      <button onClick={() => toggle('extended')} title="Too far above MAs, poor risk/reward" className={`${base} flex items-center gap-1 ${cur === 'extended' ? 'text-rose-300 bg-rose-500/20 border-rose-400/40' : off}`}>
        <span className="inline-block w-[5px] h-[5px] rounded-full bg-rose-400" />EXT
      </button>
      <button onClick={() => toggle('below-21')} title="Below 21 EMA — trend down or broken" className={`${base} flex items-center gap-1 ${cur === 'below-21' ? 'text-rose-300 bg-rose-500/20 border-rose-400/40' : off}`}>
        <span className="inline-block w-[5px] h-[5px] rounded-full bg-rose-400" />BELOW
      </button>
      {cur && (
        <button onClick={() => onFilterChange?.(null)} className={`${base} text-rose-400 bg-rose-500/10 border-rose-500/20 hover:bg-rose-500/20`}>CLEAR</button>
      )}
      <span className="w-px h-3 bg-white/10" />
      <button onClick={() => toggle('trap')} title="Avoid list — names flagged as traps" className={`${base} ${cur === 'trap' ? 'text-rose-200 bg-rose-500/20 border-rose-400/40' : 'text-rose-300/60 bg-rose-950/50 border-rose-500/10 hover:text-rose-200 hover:border-rose-400/30'}`}>TRAP</button>
      <button onClick={() => toggle('bluedot')} title="Structural reversal — up today but still under 21 EMA" className={`${base} inline-flex items-center gap-1 ${cur === 'bluedot' ? 'text-blue-300 bg-blue-500/20 border-blue-400/40' : 'text-slate-500 bg-white/[0.03] border-white/[0.08] hover:text-blue-300 hover:border-blue-400/30'}`}><span className="inline-block w-[6px] h-[6px] rounded-full bg-blue-500 shrink-0" />BLUE DOT</button>
      <button onClick={() => toggle('news')} title="Has a news headline or material catalyst today" className={`${base} ${cur === 'news' ? 'text-amber-300 bg-amber-500/20 border-amber-400/40' : 'text-amber-400/60 bg-amber-500/[0.06] border-amber-500/10 hover:text-amber-300 hover:border-amber-400/30'}`}>★ NEWS</button>
    </div>
  );
};

const BRIEFING_SECTIONS: { label: string; color: string; blurb: string }[] = [
  /* Market Regime lives on the /analyst briefing page only — removed from the
     dashboard to avoid duplicating a dense prose block that reads better in
     its own space. The avoid-set still comes from the analyst brief. */
  { label: 'Setups Summary', color: 'violet', blurb: 'All scans pooled — filter by source or setup pattern. One stop shop.' },
  { label: 'Top Movers', color: 'emerald', blurb: 'Biggest moves now. Volume-confirmed is tradeable; a thin gap is a fade.' },
  { label: 'SIPs Thesis', color: 'cyan', blurb: 'Stocks in play — who has real volume behind the move, and who is on air.' },
  { label: '$Vol Summary', color: 'teal', blurb: 'Top 20 by dollar volume — where the money actually is today.' },
  { label: 'Daily Setups Thesis', color: 'cyan', blurb: 'Day trades vs multi-day swing holds from the daily scanner — sorted by blended score.' },
  { label: 'Reversal Swing Thesis', color: 'amber', blurb: 'Swing candidates split by reversals (reclaims, blue dots) vs pullback entries.' },
  { label: '10/21 Thesis', color: 'violet', blurb: 'Top names by holding period. Percentages are distance from the 21 and 10 EMA.' },
  { label: 'VCP Thesis', color: 'teal', blurb: 'Bases of shallower pullbacks on lighter volume — supply drying up.' },
  { label: 'EP9M Thesis', color: 'rose', blurb: 'Abnormal 9M+ volume. Left = unprecedented or catalyst-driven; right = no headline yet.' },
  { label: '100-Bagger Thesis', color: 'fuchsia', blurb: 'Compounders passing revenue growth and ROIC gates. A = 70+, B = 50+.' },
  { label: 'Sector Performance', color: 'amber', blurb: 'Average move per group, best to worst.' },
  { label: 'Sector Concentration', color: 'amber', blurb: 'Where scanner setups are clustering by sector.' },
  { label: 'ETF Flow', color: 'indigo', blurb: 'Heaviest ETF dollar volume and the advancing share.' },
  { label: 'Money Flow', color: 'rose', blurb: 'Tracked dollar volume — who is buying and where it concentrates.' },
  { label: 'Key Events', color: 'amber', blurb: 'Today\'s releases and large-cap prints. ▸ marks what has not happened yet.' },
  { label: 'Sector Flow', color: 'indigo', blurb: '' },
];

const sectionStyles = (color: string) => {
  switch (color) {
    case 'teal': return { border: 'border-teal-500', badge: 'text-teal-400 bg-teal-500/10 border-teal-500/20', bg: 'bg-teal-500/[0.05]' };
    case 'cyan': return { border: 'border-cyan-500', badge: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20', bg: 'bg-cyan-500/[0.04]' };
    case 'emerald': return { border: 'border-emerald-500', badge: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', bg: 'bg-emerald-500/[0.04]' };
    case 'amber': return { border: 'border-amber-500', badge: 'text-amber-400 bg-amber-500/10 border-amber-500/20', bg: 'bg-amber-500/[0.04]' };
    case 'rose': return { border: 'border-rose-500', badge: 'text-rose-400 bg-rose-500/10 border-rose-500/20', bg: 'bg-rose-500/[0.04]' };
    case 'violet': return { border: 'border-violet-500', badge: 'text-violet-400 bg-violet-500/10 border-violet-500/20', bg: 'bg-violet-500/[0.04]' };
    case 'fuchsia': return { border: 'border-fuchsia-500', badge: 'text-fuchsia-400 bg-fuchsia-500/10 border-fuchsia-500/20', bg: 'bg-fuchsia-500/[0.04]' };
    case 'indigo': default: return { border: 'border-indigo-500', badge: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20', bg: 'bg-indigo-500/[0.04]' };
  }
};

const STD_HEADERS = ['', 'TICKER', '', 'CNF', 'CHG%', 'PRC', '', 'RVOL', 'VOL', '$VOL', 'RS', 'STG', 'N'];
const SECTION_HEADERS: Record<string, string[]> = {
  'Top Movers': STD_HEADERS,
  'SIPs Thesis': STD_HEADERS,
  '$Vol Summary': STD_HEADERS,
  'Daily Setups Thesis': STD_HEADERS,
  'Reversal Swing Thesis': STD_HEADERS,
  'Setups Summary': STD_HEADERS,
  '10/21 Thesis': STD_HEADERS,
  'EP9M Thesis': STD_HEADERS,
  '100-Bagger Thesis': STD_HEADERS,
  'VCP Thesis': STD_HEADERS,
  'ETF Flow': STD_HEADERS,
  'Money Flow': STD_HEADERS,
};

const formatBriefingText = (text: string) => {
  if (!text) return '';
  return text
    .replace(/(Top Movers:)/gi, '\n\n$1')
    .replace(/(SIPs Thesis:)/gi, '\n\n$1')
    .replace(/(\$Vol Summary:)/gi, '\n\n$1')
    .replace(/(Setups Summary:)/gi, '\n\n$1')
    .replace(/(Daily Setups Thesis:)/gi, '\n\n$1')
    .replace(/(Reversal Swing Thesis:)/gi, '\n\n$1')
    .replace(/(10\/21 Thesis:)/gi, '\n\n$1')
    .replace(/(VCP Thesis:)/gi, '\n\n$1')
    .replace(/(EP9M Thesis:)/gi, '\n\n$1')
    .replace(/(100-Bagger Thesis:)/gi, '\n\n$1')
    .replace(/(Sector Concentration:)/gi, '\n\n$1')
    .replace(/(ETF Flow:)/gi, '\n\n$1')
    .replace(/(Money Flow:)/gi, '\n\n$1')
    .replace(/(Key Events:)/gi, '\n\n$1')
    .replace(/(Sector Performance:)/gi, '\n\n$1')
    .replace(/(Sector Flow:)/gi, '\n\n$1');
};

const splitBriefingSection = (para: string): { label: string | null; color: string; blurb: string; body: string } => {
  for (const sec of BRIEFING_SECTIONS) {
    if (para.startsWith(`${sec.label}:`)) {
      let body = para.slice(sec.label.length + 1).trim();
      let blurb = sec.blurb;
      if (sec.label === '100-Bagger Thesis') {
        const lines = body.split('\n');
        const firstLine = lines[0] || '';
        if (/^\d+A\s*\//.test(firstLine)) {
          blurb = `${blurb}\n${firstLine}`;
          body = lines.slice(1).join('\n').trim();
        }
      }
      return { label: sec.label, color: sec.color, blurb, body };
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
      className={`text-[7px] font-bold tracking-wider uppercase px-1.5 py-[1px] rounded border transition-all duration-200 ${
        copied
          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
          : 'bg-[#161c2a] text-slate-500 border-white/5 hover:text-slate-300 hover:bg-white/[0.04]'
      }`}
    >
      {copied ? `✓ ${tickers.length}` : `Copy ${tickers.length}`}
    </button>
  );
}

function SectionTxtButton({ tickers }: { tickers: string[] }) {
  const [done, setDone] = React.useState(false);
  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!tickers.length) return;
    const blob = new Blob([tickers.join(',')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'watchlist.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setDone(true);
    setTimeout(() => setDone(false), 1800);
  };
  return (
    <button
      onClick={handleDownload}
      title={`Download ${tickers.length} ticker${tickers.length !== 1 ? 's' : ''} as .txt for TradingView import`}
      className={`text-[7px] font-bold tracking-wider uppercase px-1.5 py-[1px] rounded border transition-all duration-200 ${
        done
          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
          : 'bg-[#161c2a] text-slate-500 border-white/5 hover:text-slate-300 hover:bg-white/[0.04]'
      }`}
    >
      {done ? '✓ TXT' : 'TXT'}
    </button>
  );
}

type SectionSort = { key: SortKey; dir: SortDir };

function sortParsedRows(rows: ParsedStdRow[], key: SortKey, dir: SortDir): ParsedStdRow[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    let av: number, bv: number;
    switch (key) {
      case 'cnf': av = a.cnf; bv = b.cnf; break;
      case 'chg': av = a.chg; bv = b.chg; break;
      case 'rvol': av = a.rvol ?? 0; bv = b.rvol ?? 0; break;
      case 'vol': { const pv = (s: string) => { if (s === '—') return 0; const n = parseFloat(s); return s.endsWith('M') ? n * 1e6 : s.endsWith('K') ? n * 1e3 : n; }; av = pv(a.vol); bv = pv(b.vol); break; }
      case 'dvol': { const pd = (s: string) => { if (s === '—') return 0; const n = parseFloat(s.replace('$', '')); return s.endsWith('B') ? n * 1e9 : s.endsWith('M') ? n * 1e6 : s.endsWith('K') ? n * 1e3 : n; }; av = pd(a.dvol); bv = pd(b.dvol); break; }
      case 'stg': av = parseFloat(a.stage) || 0; bv = parseFloat(b.stage) || 0; break;
      case 'rs': av = a.rs ?? 0; bv = b.rs ?? 0; break;
      default: av = 0; bv = 0; break;
    }
    const primary = dir === 'desc' ? bv - av : av - bv;
    if (primary !== 0 || key === 'rs') return primary;
    return (b.rs ?? 0) - (a.rs ?? 0);
  });
  return sorted;
}

function SortableHeader({ sortKey, sortDir, onSort, isVcp }: { sortKey: SortKey | null; sortDir: SortDir; onSort: (k: SortKey) => void; isVcp?: boolean }) {
  const hCls = 'cursor-pointer hover:text-slate-400 transition-colors select-none';
  const arrow = (k: SortKey) => sortKey === k ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '';
  return (
    <div className={scrollRowCls} style={scrollRowStyle}>
      <div className="flex items-center whitespace-nowrap py-[2px] border-b border-white/5 mb-0.5">
        <span className="inline-block w-[38px] md:w-[44px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-center">TICKER</span>
        <span className="inline-block w-[12px]" />
        <span className="inline-block w-[8px]" />
        <span className="inline-block w-[8px]" />
        <span className={`inline-block w-[20px] md:w-[22px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-center ml-2 md:ml-1 ${hCls}`} onClick={() => onSort('cnf')}>CNF{arrow('cnf')}</span>
        <span className={`inline-block w-[46px] md:w-[52px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-right ml-1 ${hCls}`} onClick={() => onSort('chg')}>CHG%{arrow('chg')}</span>
        <span className="inline-block w-[36px] md:w-[42px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-right ml-2 md:ml-1">PRC</span>
        <span className={`inline-block w-[36px] md:w-[40px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-right ml-2 md:ml-1 ${hCls}`} onClick={() => onSort('rvol')}>RVOL{arrow('rvol')}</span>
        <span className={`inline-block w-[30px] md:w-[36px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-right ml-2 md:ml-1 ${hCls}`} onClick={() => onSort('vol')}>VOL{arrow('vol')}</span>
        <span className={`inline-block w-[36px] md:w-[40px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-right ml-2 md:ml-1 ${hCls}`} onClick={() => onSort('dvol')}>$VOL{arrow('dvol')}</span>
        {isVcp && <span className="inline-block w-[20px] md:w-[24px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-center ml-2 md:ml-1">T#</span>}
        <span className={`inline-block w-[22px] md:w-[24px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-center ml-2 md:ml-1 ${hCls}`} onClick={() => onSort('rs')}>RS{arrow('rs')}</span>
        <span className={`inline-block w-[22px] md:w-[24px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-center ml-2 md:ml-1 ${hCls}`} onClick={() => onSort('stg')}>STG{arrow('stg')}</span>
        <span className="inline-block w-[14px] md:w-[16px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-center ml-2 md:ml-1">N</span>
      </div>
    </div>
  );
}

function HrsSortableHeader({ sortKey, sortDir, onSort }: { sortKey: SortKey | null; sortDir: SortDir; onSort: (k: SortKey) => void }) {
  const hCls = 'cursor-pointer hover:text-slate-400 transition-colors select-none';
  const arrow = (k: SortKey) => sortKey === k ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '';
  return (
    <div className="flex items-center whitespace-nowrap py-[1px] text-[7px] font-bold tracking-wider uppercase text-slate-600">
      <span className="w-[38px] md:w-[44px] text-center">TICKER</span>
      <span className={`inline-block w-[28px] md:w-[30px] text-center ml-0.5 ${hCls}`} onClick={() => onSort('hrs')}>HRS{arrow('hrs')}</span>
      <span className={`inline-block w-[46px] md:w-[52px] text-right ml-0.5 ${hCls}`} onClick={() => onSort('chg')}>CHG%{arrow('chg')}</span>
      <span className={`inline-block w-[32px] md:w-[36px] text-right ml-0.5 ${hCls}`} onClick={() => onSort('vol')}>VOL{arrow('vol')}</span>
      <span className={`inline-block w-[36px] md:w-[40px] text-right ml-0.5 ${hCls}`} onClick={() => onSort('dvol')}>$VOL{arrow('dvol')}</span>
      <span className={`inline-block w-[30px] md:w-[34px] text-right ml-0.5 ${hCls}`} onClick={() => onSort('rvol')}>RVOL{arrow('rvol')}</span>
      <span className={`inline-block w-[36px] md:w-[42px] text-right ml-0.5 ${hCls}`} onClick={() => onSort('alpha')}>ALPHA{arrow('alpha')}</span>
      <span className={`inline-block w-[30px] md:w-[34px] text-right ml-0.5 ${hCls}`} onClick={() => onSort('win')}>WIN%{arrow('win')}</span>
      <span className={`inline-block w-[36px] md:w-[40px] text-right ml-0.5 ${hCls}`} onClick={() => onSort('high52')}>52WK{arrow('high52')}</span>
      <span className={`inline-block w-[22px] md:w-[24px] text-center ml-0.5 ${hCls}`} onClick={() => onSort('stg')}>STG{arrow('stg')}</span>
      <span className="w-0" />
    </div>
  );
}

interface HrsRow {
  symbol: string;
  score: number;
  grade: string;
  changePct: number;
  price: number;
  rsRating: number | null;
  cnfScore: number | null;
  cnfGrade: string | null;
  alphaOnWeakDays: number;
  weakDayOutperformPct: number;
  pctBelow52wHigh: number;
  vol: number;
  dVol: number;
  avgVol: number;
  mktCap: number | null;
  stage: string;
  sector: string;
  catalyst: string | null;
  catalystUrl: string | null;
  newsCausal: boolean | null;
}

export default function MarketSummary() {
  const [data, setData] = useState<SummaryData | null>(null);
  const [macroInsights, setMacroInsights] = useState<MacroInsights | null>(null);
  const [hrsTop, setHrsTop] = useState<HrsRow[]>([]);
  const [status, setStatus] = useState<'Loading' | 'Synced' | 'Error'>('Loading');
  const [session, setSession] = useState<MarketSession>('Closed');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [sectionSorts, setSectionSorts] = useState<Record<string, SectionSort>>({});
  const handleSectionSort = useCallback((sectionLabel: string, key: SortKey) => {
    setSectionSorts(prev => {
      const cur = prev[sectionLabel];
      if (cur?.key === key) {
        if (cur.dir === 'desc') return { ...prev, [sectionLabel]: { key, dir: 'asc' } };
        const next = { ...prev }; delete next[sectionLabel]; return next;
      }
      return { ...prev, [sectionLabel]: { key, dir: 'desc' } };
    });
  }, []);
  /* Collapse state is keyed by section LABEL, not index. Sections appear and
     disappear between scans — EP9M is empty before volume builds, Key Events
     is empty on a quiet calendar — and an index-keyed set would silently
     collapse whichever section slid into that slot. */
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() =>
    new Set([
      ...BRIEFING_SECTIONS.map(s => s.label).filter(l => l !== 'Setups Summary'),
      'hrsTop', 'topSetups',
    ])
  );
  const [scanFilter, setScanFilter] = useState<ScanFilterKey>(null);
  const [moverView, setMoverView] = useState<'stocks' | 'etf'>('stocks');
  /* What the Setups Summary is actually displaying after its own filters, so
     Copy and TXT hand over the visible rows rather than the whole pool. */
  const [setupVisible, setSetupVisible] = useState<string[]>([]);
  const onSetupVisible = React.useCallback((t: string[]) => setSetupVisible(t), []);
  const macroRef = useRef<MacroInsights | null>(null);
  macroRef.current = macroInsights;
  const handleScanFilter = useCallback((k: ScanFilterKey) => {
    setScanFilter(k);
    if (typeof window !== 'undefined') {
      if (k) localStorage.setItem(SCAN_FILTER_KEY, k);
      else localStorage.removeItem(SCAN_FILTER_KEY);
    }
    const mi = macroRef.current;
    if (!mi?.briefing) return;
    if (!k) {
      setCollapsedSections(new Set([
        ...BRIEFING_SECTIONS.map(s => s.label).filter(l => l !== 'Setups Summary'),
        'hrsTop', 'topSetups',
      ]));
      return;
    }
    const collapsed = new Set<string>();
    const ctx: ScanFilterCtx = { gradeMap: mi.gradeMap, postureMap: mi.postureMap, avoidSet: mi.avoidSet, dotMap: mi.dotMap };
    const paras = formatBriefingText(mi.briefing).split('\n\n').filter(Boolean);
    for (const p of paras) {
      const sec = splitBriefingSection(p.trim());
      if (!sec.label) continue;
      if (!SECTION_HEADERS[sec.label]) { collapsed.add(sec.label); continue; }
      if (sec.label === 'Setups Summary') {
        if (!(mi.setupPool ?? []).some((item: any) => passesPoolFilter(k, item))) collapsed.add(sec.label);
      } else {
        const lines = sec.body.replace(/\|\|\|/g, '\n').split('\n').filter(Boolean);
        if (!lines.some(l => { const pr = parseStdLine(l); return pr && passesScanFilter(k, pr, ctx); })) collapsed.add(sec.label);
      }
    }
    if (!(mi.watching ?? []).some((item: any) => passesPoolFilter(k, item))) collapsed.add('topSetups');
    collapsed.add('hrsTop');
    setCollapsedSections(collapsed);
  }, []);
  const SECTION_PAIRS: Record<string, string> = {
    'Sector Performance': 'Sector Concentration',
    'Sector Concentration': 'Sector Performance',
    'ETF Flow': 'Money Flow',
    'Money Flow': 'ETF Flow',
  };
  const toggleSection = (key: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      const keys = [key, SECTION_PAIRS[key]].filter(Boolean) as string[];
      const opening = next.has(key);
      for (const k of keys) {
        if (opening) next.delete(k);
        else next.add(k);
      }
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
        /* Sourced from the individual routes rather than /api/claude/snapshot.
           That aggregator fans out server-side to 13 internal routes on every
           call (~37 KV reads, a 467 KB response) and was on its own 60s timer,
           which made this one poller ~58% of the entire site's KV load.

           Nothing is lost by dropping it: six of the nine slices below are
           already being fetched by sibling components on this same page, so
           cachedJson serves them from the in-tab cache for free, and the other
           three are edge-cached. It is also strictly more correct — the
           aggregator compacts arrays to `limit` rows and appends a
           `{_truncated: …}` sentinel object, so anything past row 50 never
           reached buildLocalInsights and that sentinel was being counted as a
           candidate.

           /api/claude/snapshot itself stays — it exists for external analyst
           (Claude) pulls, which is what it was built for. It just is not a UI
           feed. */
        const [
          narrative,
          scannerData,
          ep9mRes,
          econRes,
          earningsRes,
          swingRes,
          consolRes,
          vcpRes,
          mbRes,
          dvolRes,
          hrsRes,
        ] = await Promise.all([
          cachedJson('/api/market-summary').catch(() => null),
          fetchScannerLatest().catch(() => null),
          cachedJson('/api/ep9m/latest').catch(() => null),
          cachedJson('/api/econ').catch(() => null),
          cachedJson('/api/earnings').catch(() => null),
          cachedJson('/api/swing-candidates/latest').catch(() => null),
          cachedJson('/api/consolidation/latest').catch(() => null),
          cachedJson('/api/vcp/latest').catch(() => null),
          cachedJson('/api/multibagger/latest').catch(() => null),
          cachedJson('/api/dvol/latest').catch(() => null),
          cachedJson('/api/hrs/latest').catch(() => null),
        ]);

        if (isMounted && narrative) {
          const estTime = getCurrentEstDecimal();
          setData({
            morning: (estTime >= BLOCK_WINDOWS.morning.opens || isWeekend) ? (narrative.morning || null) : null,
            midday: (estTime >= BLOCK_WINDOWS.midday.opens || isWeekend) ? (narrative.midday || null) : null,
            closing: (estTime >= BLOCK_WINDOWS.closing.opens || isWeekend) ? (narrative.closing || null) : null,
            actionableEvents: narrative.actionableEvents || [],
          });
        } else if (isMounted) {
          setData({ morning: null, midday: null, closing: null, actionableEvents: [] });
        }

        /* The scanner payload is the one hard dependency — everything else
           degrades to an empty list. Same failure mode as before, just against
           the real route instead of the aggregator's copy of it. */
        if (!scannerData) throw new Error('No scanner data available');

        const ep9mList: any[] = ep9mRes?.candidates ?? [];
        const ep9mRepeatPivots: Record<string, { count: number; events: { date: string; price: number; vol: number; rvol: number; score: number }[] }> = ep9mRes?.repeatPivots ?? {};
        const econList: EconEvent[] = Array.isArray(econRes) ? econRes : [];

        let earningsList: EarningsEvent[] = [];
        if (earningsRes) {
          const raw: any[] = Array.isArray(earningsRes) ? earningsRes : (earningsRes?.events ?? []);
          earningsList = raw.map((e: any) => {
            const cap = e.mktCap ?? 0;
            const imp = cap >= 100e9 ? 10 : cap >= 20e9 ? 7 : cap >= 5e9 ? 5 : 2;
            return { ...e, importance: imp };
          });
        }

        const swingList: any[] = swingRes?.candidates ?? [];
        const consolList: any[] = consolRes?.candidates ?? [];
        const vcpList: any[] = vcpRes?.candidates ?? [];
        const mbList: any[] = mbRes?.candidates ?? [];
        const dvolList: any[] = Array.isArray(dvolRes?.rows) ? dvolRes.rows : [];

        if (isMounted && hrsRes?.success) {
          const hrsCandidates: HrsRow[] = (hrsRes.candidates ?? [])
            .filter((c: any) => (c.rsRating ?? 0) >= 85)
            .filter((c: any) => /^(Stage\s*)?[12]/i.test(c.stage || ''))
            .filter((c: any) => (c.dVol ?? 0) >= 10_000_000)
            .sort((a: any, b: any) => b.score - a.score)
            .slice(0, 10)
            .map((c: any) => ({
              symbol: c.symbol,
              score: c.score,
              grade: c.grade,
              changePct: c.changePct,
              price: c.price ?? 0,
              rsRating: c.rsRating,
              cnfScore: c.cnfScore ?? null,
              cnfGrade: c.cnfGrade ?? null,
              alphaOnWeakDays: c.alphaOnWeakDays,
              weakDayOutperformPct: c.weakDayOutperformPct,
              pctBelow52wHigh: c.pctBelow52wHigh,
              vol: c.vol ?? 0,
              dVol: c.dVol ?? 0,
              avgVol: c.avgVol ?? 0,
              mktCap: c.mktCap ?? null,
              stage: c.stage,
              sector: c.sector ?? '',
              catalyst: c.catalyst,
              catalystUrl: c.catalystUrl,
              newsCausal: c.newsCausal,
            }));
          setHrsTop(hrsCandidates);
        }

        if (isMounted) {
          const local = buildLocalInsights(scannerData, ep9mList, econList, earningsList, swingList, consolList, vcpList, mbList, dvolList, ep9mRepeatPivots);
          if (local) setMacroInsights(local);
          else if (scannerData.macroInsights) setMacroInsights(scannerData.macroInsights);

          /* The AI analyst brief feeds this page two ways: the avoid set marks
             tickers across every rendered row, and the regime read becomes the
             leading section of the briefing. Both are optional — the analyst
             only runs 4 AM – 8 PM ET, and everything here degrades to the
             locally-built briefing when it hasn't. */
          try {
            /* Shared with AnalystBrief's own poller — see lib/scannerLatest. */
            const brief = await cachedJson('/api/analyst/brief').catch(() => null);
            if (brief) {

              const avoidSection = brief?.sections?.find((s: any) => s.section === 'Top Avoid');
              const avoidTickers = avoidSection?.stocks?.length
                ? new Set<string>(avoidSection.stocks.map((s: any) => s.ticker))
                : null;

              if (avoidTickers) {
                setMacroInsights(prev => {
                  if (!prev) return prev;
                  return { ...prev, avoidSet: avoidTickers };
                });
              }
            }
          } catch { /* analyst brief optional */ }
        }
      } catch (error) {
        console.error('Snapshot Sync Error:', error);
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


  const getSessionTextColor = () => {
    if (session === 'Pre-Market') return 'text-amber-500';
    if (session === 'Open') return 'text-[#00e676]';
    if (session === 'Post-Market') return 'text-indigo-400';
    return 'text-slate-500';
  };

  const formatBriefing = formatBriefingText;



  return (
    <div className="bg-[#101623] border-0 md:border md:border-white/10 md:rounded-2xl p-2 sm:p-6 md:p-8 relative overflow-x-auto md:shadow-2xl w-full" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' } as React.CSSProperties}>
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
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center border border-white/5 bg-[#161c2a]/40 px-3 sm:px-4 py-1.5 rounded-[10px] min-w-[100px] sm:min-w-[120px]">
              <span className={`text-[10px] font-bold tracking-widest uppercase ${status === 'Loading' ? 'text-amber-500' : status === 'Error' ? 'text-rose-400' : getSessionTextColor()}`}>
                {status === 'Synced' ? session : status}
              </span>
            </div>
            <span onClick={(e) => e.stopPropagation()}><WatchlistToggle /></span>
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
            <div className="mb-6 md:mb-8 bg-[#161c2a]/60 border border-cyan-500/20 rounded-xl p-1 sm:p-5 md:p-6 relative overflow-hidden shadow-[0_0_15px_rgba(34,211,238,0.03)]">
              <div className="hidden md:block absolute right-0 top-0 w-64 h-64 bg-cyan-500/10 blur-3xl rounded-full -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>

              <div className="flex flex-col gap-2 mb-3 relative z-10">
                <div className="flex items-center gap-2 sm:gap-3">
                  <span className="text-[9px] font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-2 sm:px-3 py-1 rounded tracking-widest uppercase flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
                    MARKET BRIEFING
                  </span>
                </div>
              </div>


              <div className="relative z-10 flex flex-col gap-6 md:gap-8">
                {(() => {
                  const paras = formatBriefing(macroInsights.briefing).split('\n\n').filter(Boolean);
                  const sections = paras.map((p, i) => {
                    const parsed = splitBriefingSection(p.trim());
                    return { ...parsed, key: parsed.label || `sec-${i}` };
                  });
                  const collapsibleKeys = [
                    ...sections.filter(s => s.label).map(s => s.key),
                    ...(hrsTop.length > 0 ? ['hrsTop'] : []),
                    ...(macroInsights.watching?.length ? ['topSetups'] : []),
                  ];
                  const everyCollapsed =
                    collapsibleKeys.length > 0 && collapsibleKeys.every(k => collapsedSections.has(k));

                  return (
                    <div>
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <h3 className="text-[8px] font-bold tracking-widest uppercase text-slate-500">Narrative Breakdown</h3>
                        {collapsibleKeys.length > 1 && (
                          <button
                            onClick={() => setCollapsedSections(everyCollapsed ? new Set() : new Set(collapsibleKeys.filter(k => k !== 'Setups Summary')))}
                            className="text-[7px] font-bold tracking-wider uppercase px-1.5 py-[1px] rounded border bg-[#161c2a] text-slate-500 border-white/5 hover:text-slate-300 hover:bg-white/[0.04] transition-all duration-200"
                          >
                            {everyCollapsed ? 'Expand all' : 'Collapse all'}
                          </button>
                        )}
                      </div>
                      <div className="mb-3 px-1">
                        <ScanLegend activeFilter={scanFilter} onFilterChange={handleScanFilter} />
                      </div>
                      {/* A grid rather than a column so ETF Flow and Money Flow can pair
                          up. Every other section spans both tracks, so the stack reads
                          exactly as before — only those two share a row, and only once
                          there is width for it. */}
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        {sections.map((sec, idx) => {
                          const { label, color, blurb, body: rawBody, key } = sec;
                          const body = label === 'Top Movers' && moverView === 'etf' && macroInsights?.etfMoversPara
                            ? macroInsights.etfMoversPara : rawBody;
                          const st = sectionStyles(color);
                          const bodyTickers = label === 'Setups Summary'
                            // What the card is showing, not the pool behind it.
                            ? setupVisible
                            : (() => {
                                const lines = body.replace(/\|\|\|/g, '\n').split('\n').filter(Boolean);
                                const parsed = lines.map(l => parseStdLine(l)).filter(Boolean);
                                /* Copy what is on screen. When a scan filter is
                                   active the rows are filtered at render with
                                   this same predicate, so the button has to use
                                   it too — otherwise it offers ten tickers over
                                   a three-row table. */
                                const visible = scanFilter
                                  ? parsed.filter(p => passesScanFilter(scanFilter, p!, {
                                      gradeMap: macroInsights?.gradeMap,
                                      postureMap: macroInsights?.postureMap,
                                      avoidSet: macroInsights?.avoidSet,
                                      dotMap: macroInsights?.dotMap,
                                    }))
                                  : parsed;
                                if (visible.length > 0) return Array.from(new Set(visible.map(p => p!.ticker)));
                                return Array.from(new Set(
                                  (body.match(/\b[A-Z]{2,5}\b/g) || []).filter(t => !TICKER_STOPWORDS.has(t))
                                ));
                              })();
                          const sectionAligns = !!label && ALIGNED_SECTIONS.has(label);
                          const filterEmpty = scanFilter && !!label && !!SECTION_HEADERS[label] && (() => {
                            if (label === 'Setups Summary') {
                              return !(macroInsights?.setupPool ?? []).some((item: any) => passesPoolFilter(scanFilter, item));
                            }
                            const ctx: ScanFilterCtx = { gradeMap: macroInsights?.gradeMap, postureMap: macroInsights?.postureMap, avoidSet: macroInsights?.avoidSet, dotMap: macroInsights?.dotMap };
                            const allLines = body.replace(/\|\|\|/g, '\n').split('\n').filter(Boolean);
                            return !allLines.some(l => { const p = parseStdLine(l); return p && passesScanFilter(scanFilter, p, ctx); });
                          })();
                          const isOpen = !label || !collapsedSections.has(key);

                          /* The key sits in the GAP ABOVE the card rather than
                             inside it — same information, none of the card's
                             vertical budget, and it reads as a rule between
                             sections instead of a header on each one.

                             Only where the ticker-row grid is (SECTION_HEADERS
                             is the test: Market Regime names tickers in prose
                             but has no glyphs), and only once for a paired row
                             — ETF Flow leads that pair, so Money Flow does not
                             emit a second strip beside it. */
                          const renderHrsBefore = label === '100-Bagger Thesis' && hrsTop.length > 0;
                          const renderWatchAfter = label === '100-Bagger Thesis';
                          const hrsSort = sectionSorts['HRS'] ?? null;
                          const hrsSorted = hrsSort ? [...hrsTop].sort((a, b) => {
                            let av = 0, bv = 0;
                            switch (hrsSort.key) {
                              case 'hrs': av = a.score; bv = b.score; break;
                              case 'chg': av = a.changePct; bv = b.changePct; break;
                              case 'alpha': av = a.alphaOnWeakDays; bv = b.alphaOnWeakDays; break;
                              case 'win': av = a.weakDayOutperformPct; bv = b.weakDayOutperformPct; break;
                              case 'high52': av = a.pctBelow52wHigh; bv = b.pctBelow52wHigh; break;
                              case 'rs': av = Number(a.rsRating) || 0; bv = Number(b.rsRating) || 0; break;
                              case 'vol': av = a.vol; bv = b.vol; break;
                              case 'dvol': av = a.dVol; bv = b.dVol; break;
                              case 'rvol': av = a.avgVol ? a.vol / a.avgVol : 0; bv = b.avgVol ? b.vol / b.avgVol : 0; break;
                              case 'stg': av = parseFloat(a.stage.replace(/[^0-9.]/g, '')) || 0; bv = parseFloat(b.stage.replace(/[^0-9.]/g, '')) || 0; break;
                            }
                            return hrsSort.dir === 'desc' ? bv - av : av - bv;
                          }) : hrsTop;
                          const hrsLeft = hrsSorted.slice(0, 5);
                          const hrsRight = hrsSorted.slice(5, 10);
                          const hrsIsOpen = !collapsedSections.has('hrsTop');
                          const hrsRowEl = (h: HrsRow) => {
                            /* The HRS scan's own grade is saturated — 99.8% of rows graded A across the
                               5-year backtest — so the chip carries the edge grade instead. */
                            const hrsGrade: 'A' | 'B' | null = hrsEdgeGrade({ rsRating: h.rsRating, price: h.price });
                            const nc = newsStarCount({ catalyst: h.catalyst, catalystUrl: h.catalystUrl, newsCausal: h.newsCausal });
                            const rvol = h.avgVol ? h.vol / h.avgVol : 0;
                            const fmtV = (v: number) => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : '—';
                            const fmtDV = (v: number) => v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : v > 0 ? `$${(v / 1e3).toFixed(0)}K` : '—';
                            /* NO edge tint here, deliberately. The tint's rules
                               were measured on the momentum tables (Stocks in
                               Play / Daily Setups) and do not transfer: $5-10
                               names averaged -0.15R there but +0.15R on Hidden
                               RS, which selects for quiet strength rather than
                               big movers. Tinting these rows with the momentum
                               rule would mark the best bucket as the worst.
                               Restore only with HRS-specific thresholds. */
                            return (
                              <div key={h.symbol} className="flex items-center whitespace-nowrap py-[1px]">
                                <span className="hidden md:inline-flex shrink-0" style={{ width: 0, overflow: 'visible', position: 'relative' }}><span style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)' }}><WatchlistBtn symbol={h.symbol} /></span></span>
                                <TickerChartHover symbol={h.symbol}><span className={`${gradeChipCls(hrsGrade, false)} w-[38px] md:w-[44px]`}>{h.symbol}</span></TickerChartHover>
                                <span className={`inline-block align-baseline text-[7px] font-bold tabular-nums rounded border ml-0.5 w-[28px] md:w-[30px] leading-[14px] text-center ${h.score >= 70 ? 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10' : h.score >= 50 ? 'text-amber-400 border-amber-500/20 bg-amber-500/10' : 'text-slate-400 border-white/5 bg-white/[0.03]'}`}>{h.score}</span>
                                <span className={`text-[9px] tabular-nums font-semibold inline-block w-[46px] md:w-[52px] text-right ml-0.5 ${h.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{h.changePct >= 0 ? '+' : ''}{h.changePct.toFixed(2)}%</span>
                                <span className="text-[9px] tabular-nums inline-block w-[32px] md:w-[36px] text-right ml-0.5 text-slate-400">{fmtV(h.vol)}</span>
                                <span className="text-[9px] tabular-nums inline-block w-[36px] md:w-[40px] text-right ml-0.5 text-slate-400">{fmtDV(h.dVol)}</span>
                                <span className={`text-[9px] tabular-nums inline-block w-[30px] md:w-[34px] text-right ml-0.5 ${rvol >= 2 ? 'text-emerald-400' : rvol >= 1.2 ? 'text-cyan-400' : 'text-slate-400'}`}>{rvol < 1 ? rvol.toFixed(1) : Math.round(rvol)}x</span>
                                <span className={`text-[9px] tabular-nums inline-block w-[36px] md:w-[42px] text-right ml-0.5 ${h.alphaOnWeakDays > 5 ? 'text-emerald-400' : h.alphaOnWeakDays > 2 ? 'text-cyan-400' : 'text-slate-300'}`}>+{h.alphaOnWeakDays.toFixed(1)}</span>
                                <span className={`text-[9px] tabular-nums inline-block w-[30px] md:w-[34px] text-right ml-0.5 ${h.weakDayOutperformPct >= 80 ? 'text-emerald-400' : h.weakDayOutperformPct >= 60 ? 'text-cyan-400' : 'text-slate-400'}`}>{h.weakDayOutperformPct}%</span>
                                <span className={`text-[9px] tabular-nums inline-block w-[36px] md:w-[40px] text-right ml-0.5 ${h.pctBelow52wHigh <= 3 ? 'text-emerald-400' : h.pctBelow52wHigh <= 8 ? 'text-cyan-400' : 'text-slate-400'}`}>{h.pctBelow52wHigh <= 0.5 ? 'ATH' : `-${h.pctBelow52wHigh.toFixed(1)}%`}</span>
                                <span className="inline-block w-[22px] md:w-[24px] text-center ml-0.5">{h.stage ? <span className={`inline-block w-[20px] md:w-[22px] leading-[14px] rounded border text-[7px] font-bold tabular-nums text-center ${stageBadge(h.stage)}`}>{stageOf({ stage: h.stage })}</span> : <span className="text-slate-600">-</span>}</span>
                                <span className="w-0" />
                              </div>
                            );
                          };

                          return (
                            <React.Fragment key={idx}>
                            {renderHrsBefore && (
                              <div className="lg:col-span-2 rounded-xl px-2.5 md:px-4 py-3 bg-indigo-500/[0.04]">
                                <div className="flex items-center gap-3 mb-2 cursor-pointer select-none" onClick={() => toggleSection('hrsTop')} title={hrsIsOpen ? 'Collapse' : 'Expand'}>
                                  <div className="inline-flex items-center gap-1.5">
                                    <span className={`text-[9px] transition-transform duration-200 ${hrsIsOpen ? 'rotate-90' : ''} text-slate-500`}>&#9654;</span>
                                    <span className="inline-block text-[7px] font-bold tracking-widest uppercase px-1.5 py-[1px] rounded border text-indigo-400 bg-indigo-500/10 border-indigo-500/20">Hidden Relative Strength</span>
                                  </div>
                                  {hrsIsOpen && <span onClick={e => e.stopPropagation()}><SectionCopyButton tickers={hrsTop.map(h => h.symbol)} /></span>}
                                  {hrsIsOpen && <span onClick={e => e.stopPropagation()}><SectionTxtButton tickers={hrsTop.map(h => h.symbol)} /></span>}
                                  {!hrsIsOpen && <span className="text-[8px] text-slate-600 font-medium">{hrsTop.map(h => h.symbol).join(' · ')}</span>}
                                </div>
                                {hrsIsOpen && (
                                  <>
                                    <p className="text-[8px] text-slate-500 font-medium mb-2 leading-snug">
                                      Top {hrsTop.length} by hidden RS score — RS 85+, Stage 1–2. Holding up while QQQ sells off.
                                    </p>
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-0">
                                      <div className="flex flex-col gap-0.5">
                                        <HrsSortableHeader sortKey={hrsSort?.key ?? null} sortDir={hrsSort?.dir ?? 'desc'} onSort={(k) => handleSectionSort('HRS', k)} />
                                        {hrsLeft.map(hrsRowEl)}
                                      </div>
                                      {hrsRight.length > 0 && (
                                        <div className="flex flex-col gap-0.5">
                                          <div className="hidden lg:flex">
                                            <HrsSortableHeader sortKey={hrsSort?.key ?? null} sortDir={hrsSort?.dir ?? 'desc'} onSort={(k) => handleSectionSort('HRS', k)} />
                                          </div>
                                          {hrsRight.map(hrsRowEl)}
                                        </div>
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                            <div className={`rounded-xl px-2.5 md:px-4 py-3 ${st.bg} ${label && PAIRED_SECTIONS.has(label) ? '' : 'lg:col-span-2'} ${label === 'Sector Concentration' ? 'flex flex-col' : ''}`}>
                              {label && (
                                <div className={isOpen ? 'mb-2' : ''}>
                                  <div
                                    className="flex items-center gap-2 flex-wrap cursor-pointer select-none"
                                    onClick={() => toggleSection(key)}
                                    title={isOpen ? 'Collapse this section' : 'Expand this section'}
                                  >
                                    <div className="flex items-center gap-1.5">
                                      <span className={`text-[9px] transition-transform duration-200 ${isOpen ? 'rotate-90' : ''} text-slate-500`}>&#9654;</span>
                                      <span className={`inline-block text-[7px] font-bold tracking-widest uppercase px-1.5 py-[1px] rounded border ${st.badge}`}>
                                        {label}
                                      </span>
                                    </div>
                                    {isOpen && bodyTickers.length > 0 && label !== 'Key Events' && label !== 'Market Regime' && <SectionCopyButton tickers={bodyTickers} />}
                                    {isOpen && bodyTickers.length > 0 && label !== 'Key Events' && label !== 'Market Regime' && <SectionTxtButton tickers={bodyTickers} />}
                                    {isOpen && label === 'Setups Summary' && <SetupSummaryHelp />}
                                    {isOpen && label === 'Top Movers' && (
                                      <div className="flex items-center gap-1 ml-1">
                                        <button
                                          onClick={(e) => { e.stopPropagation(); setMoverView('stocks'); }}
                                          className={`text-[7px] font-bold tracking-wider uppercase px-1.5 py-[1px] rounded border transition-all duration-200 ${
                                            moverView === 'stocks'
                                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                              : 'bg-[#161c2a] text-slate-500 border-white/5 hover:text-slate-300 hover:bg-white/[0.04]'
                                          }`}
                                        >Stocks</button>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); setMoverView('etf'); }}
                                          className={`text-[7px] font-bold tracking-wider uppercase px-1.5 py-[1px] rounded border transition-all duration-200 ${
                                            moverView === 'etf'
                                              ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
                                              : 'bg-[#161c2a] text-slate-500 border-white/5 hover:text-slate-300 hover:bg-white/[0.04]'
                                          }`}
                                        >ETF</button>
                                      </div>
                                    )}
                                    {!isOpen && bodyTickers.length > 0 && (
                                      <span className="text-[8px] text-slate-600 font-medium">
                                        {bodyTickers.slice(0, 10).join(' · ')}{bodyTickers.length > 10 ? ` +${bodyTickers.length - 10}` : ''}
                                      </span>
                                    )}
                                  </div>
                                  {isOpen && blurb && <p className="text-[8px] text-slate-500 font-medium mt-1.5 leading-snug">{blurb.split('\n').map((line, i, arr) => <React.Fragment key={i}>{line}{i < arr.length - 1 && <br/>}</React.Fragment>)}</p>}
                                </div>
                              )}
                              {/* Header for single-column aligned sections is now rendered inside the body block below */}
                              {/* Sector Concentration's rows start a hair higher than the
                                  bars beside it, because SectorBars puts its first
                                  bar inside a padded panel. This nudges the rows
                                  down so "+43.0% Financials" lines up with the
                                  "Financials" bar across the gap. Paired sections
                                  are read ACROSS, so the rows have to agree. */}
                              {isOpen && label === 'Setups Summary' ? (
                                <SetupSummary
                                  pool={macroInsights?.setupPool ?? []}
                                  gradeMap={macroInsights?.gradeMap}
                                  dotMap={macroInsights?.dotMap}
                                  postureMap={macroInsights?.postureMap}
                                  scanFilter={scanFilter}
                                  avoidSet={macroInsights?.avoidSet}
                                  rsMap={macroInsights?.rsMap}
                                  stageMap={macroInsights?.stageMap}
                                  topSet={macroInsights?.watching?.length ? new Set(macroInsights.watching.map((w: any) => w.symbol)) : undefined}
                                  onVisibleChange={onSetupVisible}
                                />
                              ) : isOpen && label === 'Sector Performance' ? (
                                <SectorBars body={body} heat={macroInsights?.sectorHeat} />
                              ) : isOpen && label === 'Sector Concentration' ? (
                                (() => {
                                  const pool = macroInsights?.setupPool ?? [];
                                  const sectorMap: Record<string, { count: number; totalChg: number }> = {};
                                  pool.forEach((s: any) => {
                                    const sec = s.sector && s.sector !== '—' && !isEtfSector(s.sector) ? displaySector(s.sector) : null;
                                    if (!sec || sec === '—' || sec.toLowerCase() === 'other') return;
                                    if (!sectorMap[sec]) sectorMap[sec] = { count: 0, totalChg: 0 };
                                    sectorMap[sec].count += 1;
                                    sectorMap[sec].totalChg += Number(s.changePct ?? s.chg ?? 0);
                                  });
                                  const sectors = Object.entries(sectorMap)
                                    .map(([sector, d]) => ({ sector, count: d.count, avgChg: d.totalChg / d.count }))
                                    .sort((a, b) => b.count - a.count);
                                  const maxCount = sectors[0]?.count ?? 1;
                                  if (sectors.length === 0) return <p className="text-[10px] text-slate-500">No sector data.</p>;
                                  return (
                                    <div className="flex-1 flex flex-col justify-center gap-[3px]">
                                      {sectors.slice(0, 10).map((h, i) => (
                                        <div key={i} className="flex items-center gap-2 py-[1px] text-[9px] tabular-nums">
                                          <span className="text-slate-300 font-medium w-[72px] truncate shrink-0">{h.sector}</span>
                                          <div className="flex-1 h-[6px] rounded-full bg-white/5 overflow-hidden">
                                            <div
                                              className={`h-full rounded-full ${h.avgChg >= 0 ? 'bg-emerald-500/50' : 'bg-rose-500/50'}`}
                                              style={{ width: `${(h.count / maxCount) * 100}%` }}
                                            />
                                          </div>
                                          <span className="text-slate-400 font-bold w-[16px] text-right shrink-0">{h.count}</span>
                                          <span className={`font-semibold w-[42px] text-right shrink-0 ${h.avgChg >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {h.avgChg >= 0 ? '+' : ''}{h.avgChg.toFixed(1)}%
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  );
                                })()
                              ) : isOpen && label === 'Key Events' && macroInsights?.econEvents && macroInsights?.earningsEvents ? (
                                <KeyEventsPanel econ={macroInsights.econEvents} earnings={macroInsights.earningsEvents} />
                              ) : isOpen && (
                                body.includes('|||') ? (
                                  (() => {
                                    let topBlock = '';
                                    let colBody = body;
                                    const isKeyEv = label === 'Key Events';
                                    if (body.includes('^^^')) {
                                      const [above, below] = body.split('^^^');
                                      topBlock = above.trim();
                                      colBody = below.trim();
                                    }
                                    const parts = colBody.split('|||');
                                    const afterCols = parts.length > 2 ? parts.slice(2).join('\n') : '';

                                    if (isKeyEv && topBlock) {
                                      const renderEconBlock = () => {
                                        const tbLines = topBlock.split('\n').filter(Boolean);
                                        let headerInserted = false;
                                        return tbLines.map((line, li) => {
                                          const isHead = line.trim().endsWith(':');
                                          if (isHead) {
                                            headerInserted = false;
                                            return <p key={li} className="text-[9px] font-bold tracking-wider uppercase text-slate-500 pb-0.5">{line.replace(/:$/, '')}</p>;
                                          }
                                          const els: React.ReactNode[] = [];
                                          if (!headerInserted) {
                                            headerInserted = true;
                                            els.push(
                                              <div key={`eh-${li}`} className={scrollRowCls} style={scrollRowStyle}>
                                                <div className="flex items-center whitespace-nowrap py-[2px] border-b border-white/5 mb-0.5">
                                                  <span className="inline-block w-[10px]" />
                                                  <span className="inline-block w-[62px] md:w-[68px] text-[7px] font-bold tracking-widest uppercase text-slate-600 ml-1">TIME</span>
                                                  <span className="inline-block w-[180px] md:w-[240px] text-[7px] font-bold tracking-widest uppercase text-slate-600">EVENT</span>
                                                  <span className="inline-block w-[52px] md:w-[60px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-right ml-3">ACT</span>
                                                  <span className="inline-block w-[52px] md:w-[60px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-right ml-1">EST</span>
                                                  <span className="inline-block w-[52px] md:w-[60px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-right ml-1">PREV</span>
                                                </div>
                                              </div>
                                            );
                                          }
                                          els.push(renderBodyLine(line, li, sectionAligns && isRowLine(line), macroInsights?.gradeMap, macroInsights?.dotMap, macroInsights?.postureMap, macroInsights?.avoidSet, macroInsights?.priceMap, macroInsights?.rsMap, macroInsights?.stageMap, macroInsights?.edgeMap));
                                          return els;
                                        });
                                      };
                                      const renderEarnBlock = () => {
                                        return parts.slice(0, 2).map((col, ci) => {
                                          const colLines = col.trim().split('\n').filter(Boolean);
                                          const [heading, ...rows] = colLines;
                                          const isHeading = heading && heading.trim().endsWith(':');
                                          const render = (line: string, li: number) =>
                                            renderBodyLine(line, li, true, macroInsights?.gradeMap, macroInsights?.dotMap, macroInsights?.postureMap, macroInsights?.avoidSet, macroInsights?.priceMap, macroInsights?.rsMap, macroInsights?.stageMap, macroInsights?.edgeMap);
                                          const earnHeader = (
                                            <div className={scrollRowCls} style={scrollRowStyle}>
                                              <div className="flex items-center whitespace-nowrap py-[2px] border-b border-white/5 mb-0.5 min-w-[344px]">
                                                <span className="inline-block w-[10px]" />
                                                <span className="inline-block w-[56px] md:w-[64px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-center">TICKER</span>
                                                <span className="inline-block w-[44px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-center" />
                                                <span className="inline-block w-[52px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-right">EPS</span>
                                                <span className="inline-block w-[46px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-right">EST</span>
                                                <span className="inline-block w-[54px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-right">SURP</span>
                                                <span className="inline-block w-[68px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-right">REV</span>
                                              </div>
                                            </div>
                                          );
                                          const renderWithSub = (lines: string[]) => {
                                            const groups: { heading: string | null; rows: string[] }[] = [];
                                            let cur: { heading: string | null; rows: string[] } = { heading: null, rows: [] };
                                            lines.forEach(l => {
                                              if (l.trim().endsWith(':')) {
                                                if (cur.rows.length > 0 || cur.heading) groups.push(cur);
                                                cur = { heading: l.trim().replace(/:$/, ''), rows: [] };
                                              } else { cur.rows.push(l); }
                                            });
                                            if (cur.rows.length > 0 || cur.heading) groups.push(cur);
                                            return groups.map((g, gi) => (
                                              <React.Fragment key={gi}>
                                                {g.heading && <p className="text-[9px] font-bold tracking-wider uppercase text-slate-500 pb-0.5 pt-1">{g.heading}</p>}
                                                {g.rows.length > 0 && earnHeader}
                                                {g.rows.map(render)}
                                              </React.Fragment>
                                            ));
                                          };
                                          return (
                                            <div key={ci} className="space-y-1.5">
                                              {isHeading ? renderWithSub(rows) : (
                                                <>{earnHeader}{colLines.map(render)}</>
                                              )}
                                            </div>
                                          );
                                        });
                                      };
                                      return (
                                        <>
                                          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-y-5">
                                            <div className="space-y-1.5 overflow-x-auto pr-4">
                                              {renderEconBlock()}
                                            </div>
                                            <div className="hidden md:block w-px bg-white/10 self-stretch" />
                                            <div className="space-y-4 pl-4">
                                              {renderEarnBlock()}
                                            </div>
                                          </div>
                                          {afterCols && (() => {
                                            const acLines = afterCols.trim().split('\n').filter(Boolean);
                                            return (
                                              <div className="space-y-1.5 mt-4 pt-3 border-t border-white/5">
                                                {acLines.map((line, li) =>
                                                  renderBodyLine(line, li, false, macroInsights?.gradeMap, macroInsights?.dotMap, macroInsights?.postureMap, macroInsights?.avoidSet, macroInsights?.priceMap, macroInsights?.rsMap, macroInsights?.stageMap, macroInsights?.edgeMap)
                                                )}
                                              </div>
                                            );
                                          })()}
                                        </>
                                      );
                                    }

                                    return (
                                      <>
                                        {topBlock && (
                                          <div className="space-y-1.5 mb-4 pb-3 border-b border-white/5">
                                            {(() => {
                                              const tbLines = topBlock.split('\n').filter(Boolean);
                                              let headerInserted = false;
                                              return tbLines.map((line, li) => {
                                                const isHead = line.trim().endsWith(':');
                                                if (isHead) {
                                                  headerInserted = false;
                                                  return <p key={li} className="text-[9px] font-bold tracking-wider uppercase text-slate-500 pb-0.5">{line.replace(/:$/, '')}</p>;
                                                }
                                                const els: React.ReactNode[] = [];
                                                els.push(renderBodyLine(line, li, sectionAligns && isRowLine(line), macroInsights?.gradeMap, macroInsights?.dotMap, macroInsights?.postureMap, macroInsights?.avoidSet, macroInsights?.priceMap, macroInsights?.rsMap, macroInsights?.stageMap, macroInsights?.edgeMap));
                                                return els;
                                              });
                                            })()}
                                          </div>
                                        )}
                                        {/* Merged two-column: collect all stock rows, sort together, split evenly */}
                                        {sectionAligns && label === 'SIPs Thesis' ? (() => {
                                          const allStockLines: string[] = [];
                                          parts.slice(0, 2).forEach(col => {
                                            col.trim().split('\n').filter(Boolean).forEach(l => {
                                              if (!l.trim().endsWith(':')) allStockLines.push(l);
                                            });
                                          });
                                          const secSortKey = label;
                                          const secSort = sectionSorts[secSortKey] ?? { key: 'cnf' as SortKey, dir: 'desc' as SortDir };
                                          const parsed = allStockLines.map((l, i) => ({ line: l, idx: i, p: parseStdLine(l) })).filter(x => x.p);
                                          const ctx = { gradeMap: macroInsights?.gradeMap, postureMap: macroInsights?.postureMap, avoidSet: macroInsights?.avoidSet, dotMap: macroInsights?.dotMap };
                                          const filtered = parsed.filter(x => passesScanFilter(scanFilter, x.p!, ctx));
                                          const sorted = sortParsedRows(filtered.map(x => x.p!), secSort.key, secSort.dir);
                                          const sortedLines = sorted.map(sr => filtered.find(x => x.p === sr)!.line);
                                          const leftLines = sortedLines.slice(0, Math.ceil(sortedLines.length / 2));
                                          const rightLines = sortedLines.slice(Math.ceil(sortedLines.length / 2));
                                          const render = (line: string, li: number) =>
                                            renderBodyLine(line, li, true, macroInsights?.gradeMap, macroInsights?.dotMap, macroInsights?.postureMap, macroInsights?.avoidSet, macroInsights?.priceMap, macroInsights?.rsMap, macroInsights?.stageMap, macroInsights?.edgeMap);
                                          const hdr = <SortableHeader sortKey={secSort.key} sortDir={secSort.dir} onSort={(k) => handleSectionSort(secSortKey, k)} />;
                                          return (
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
                                              <div className="space-y-0">{hdr}{leftLines.map((l, i) => render(l, i))}</div>
                                              <div className="space-y-0">{hdr}{rightLines.map((l, i) => render(l, 500 + i))}</div>
                                            </div>
                                          );
                                        })() : (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
                                          {parts.slice(0, 2).map((col, ci) => {
                                            const colLines = col.trim().split('\n').filter(Boolean);
                                            const [heading, ...rows] = colLines;
                                            const isHeading = heading && heading.trim().endsWith(':');
                                            const render = (line: string, li: number) =>
                                              renderBodyLine(line, li, sectionAligns && isRowLine(line), macroInsights?.gradeMap, macroInsights?.dotMap, macroInsights?.postureMap, macroInsights?.avoidSet, macroInsights?.priceMap, macroInsights?.rsMap, macroInsights?.stageMap, macroInsights?.edgeMap);
                                            const isVcp = label === 'VCP Thesis';
                                            const isKeyEv = label === 'Key Events';
                                            const colSortKey = `${label}-${ci}`;
                                            const colSort = sectionSorts[colSortKey] ?? null;
                                            const defaultSortKey: SortKey = label === 'Top Movers' ? 'chg' : 'cnf';
                                            const inlineHeader = isKeyEv ? (
                                              <div className={scrollRowCls} style={scrollRowStyle}>
                                                <div className="flex items-center whitespace-nowrap py-[2px] border-b border-white/5 mb-0.5 min-w-[344px]">
                                                  <span className="inline-block w-[10px]" />
                                                  <span className="inline-block w-[56px] md:w-[64px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-center">TICKER</span>
                                                  <span className="inline-block w-[44px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-center" />
                                                  <span className="inline-block w-[52px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-right">EPS</span>
                                                  <span className="inline-block w-[46px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-right">EST</span>
                                                  <span className="inline-block w-[54px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-right">SURP</span>
                                                  <span className="inline-block w-[68px] text-[7px] font-bold tracking-widest uppercase text-slate-600 text-right">REV</span>
                                                </div>
                                              </div>
                                            ) : sectionAligns && SECTION_HEADERS[label!] ? (
                                              <SortableHeader sortKey={colSort?.key ?? defaultSortKey} sortDir={colSort?.dir ?? 'desc'} onSort={(k) => handleSectionSort(colSortKey, k)} isVcp={isVcp} />
                                            ) : null;
                                            const sortedRender = (lines: string[]) => {
                                              if (!sectionAligns) return lines.map(render);
                                              const defaultDir: SortDir = label === 'Top Movers' && ci === 1 ? 'asc' : 'desc';
                                              const activeSort = colSort ?? { key: defaultSortKey, dir: defaultDir };
                                              const stockLines: string[] = [];
                                              const stockParsed: ParsedStdRow[] = [];
                                              const nonStockRendered: React.ReactNode[] = [];
                                              lines.forEach((l, i) => {
                                                const p = parseStdLine(l);
                                                if (p) { stockLines.push(l); stockParsed.push(p); }
                                                else nonStockRendered.push(render(l, i));
                                              });
                                              const filt = stockParsed.map((p, i) => ({ p, i })).filter(({ p }) => passesScanFilter(scanFilter, p, { gradeMap: macroInsights?.gradeMap, postureMap: macroInsights?.postureMap, avoidSet: macroInsights?.avoidSet, dotMap: macroInsights?.dotMap }));
                                              const sortedFiltered = sortParsedRows(filt.map(ff => ff.p), activeSort.key, activeSort.dir)
                                                .map(sr => filt[filt.map(ff => ff.p).indexOf(sr)].i);
                                              return [...nonStockRendered, ...sortedFiltered.map((idx, i) => render(stockLines[idx], 1000 + i))];
                                            };
                                            const renderWithSubHeadings = (lines: string[]) => {
                                              const groups: { heading: string | null; rows: string[] }[] = [];
                                              let cur: { heading: string | null; rows: string[] } = { heading: null, rows: [] };
                                              lines.forEach(l => {
                                                if (l.trim().endsWith(':')) {
                                                  if (cur.rows.length > 0 || cur.heading) groups.push(cur);
                                                  cur = { heading: l.trim().replace(/:$/, ''), rows: [] };
                                                } else {
                                                  cur.rows.push(l);
                                                }
                                              });
                                              if (cur.rows.length > 0 || cur.heading) groups.push(cur);
                                              return groups.map((g, gi) => (
                                                <React.Fragment key={gi}>
                                                  {g.heading && <p className="text-[9px] font-bold tracking-wider uppercase text-slate-500 pb-0.5 pt-1">{g.heading}</p>}
                                                  {g.rows.length > 0 && inlineHeader}
                                                  {sortedRender(g.rows)}
                                                </React.Fragment>
                                              ));
                                            };
                                            return (
                                              <div key={ci} className="space-y-1.5">
                                                {isHeading ? (<>
                                                  <p className="text-[9px] font-bold tracking-wider uppercase text-slate-500 pb-0.5">{heading.replace(/:$/, '')}</p>
                                                  {renderWithSubHeadings(rows)}
                                                </>) : (
                                                  <>
                                                    {inlineHeader}
                                                    {sortedRender(colLines)}
                                                  </>
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                        )}
                                        {afterCols && (() => {
                                          const acLines = afterCols.trim().split('\n').filter(Boolean);
                                          const acRender = (line: string, li: number) =>
                                            renderBodyLine(line, li, sectionAligns && isRowLine(line), macroInsights?.gradeMap, macroInsights?.dotMap, macroInsights?.postureMap, macroInsights?.avoidSet, macroInsights?.priceMap, macroInsights?.rsMap, macroInsights?.stageMap, macroInsights?.edgeMap);
                                          const acHeader = sectionAligns && SECTION_HEADERS[label!] ? <SortableHeader sortKey={null} sortDir={'desc'} onSort={() => {}} isVcp={label === 'VCP Thesis'} /> : null;
                                          const acGroups: { heading: string | null; rows: string[] }[] = [];
                                          let acCur: { heading: string | null; rows: string[] } = { heading: null, rows: [] };
                                          acLines.forEach(l => {
                                            if (l.trim().endsWith(':')) {
                                              if (acCur.rows.length > 0 || acCur.heading) acGroups.push(acCur);
                                              acCur = { heading: l.trim().replace(/:$/, ''), rows: [] };
                                            } else { acCur.rows.push(l); }
                                          });
                                          if (acCur.rows.length > 0 || acCur.heading) acGroups.push(acCur);
                                          return (
                                            <div className="space-y-1.5 mt-4 pt-3 border-t border-white/5">
                                              {acGroups.map((g, gi) => (
                                                <React.Fragment key={gi}>
                                                  {g.heading && <p className="text-[9px] font-bold tracking-wider uppercase text-slate-500 pb-0.5 pt-1">{g.heading}</p>}
                                                  {/* A header above a SINGLE row is more header
                                                      than data — on a phone VCP and EP9M split
                                                      into one-row groups and the column strip
                                                      repeated above every name. Two or more
                                                      rows still get one, because that is where
                                                      a column key earns its line. */}
                                                  {g.rows.filter(isRowLine).length > 1 && acHeader}
                                                  {g.rows.map(acRender)}
                                                </React.Fragment>
                                              ))}
                                            </div>
                                          );
                                        })()}
                                      </>
                                    );
                                  })()
                                ) : (
                                  (() => {
                                    const sk = `${label}-single`;
                                    const ss = sectionSorts[sk] ?? null;
                                    const bodyLines = body.split('\n').filter(Boolean);
                                    const renderLine = (line: string, li: number) =>
                                      renderBodyLine(line, li, sectionAligns && isRowLine(line), macroInsights?.gradeMap, macroInsights?.dotMap, macroInsights?.postureMap, macroInsights?.avoidSet, macroInsights?.priceMap, macroInsights?.rsMap, macroInsights?.stageMap, macroInsights?.edgeMap);
                                    if (!sectionAligns) {
                                      return <div className="space-y-2">{bodyLines.map(renderLine)}</div>;
                                    }
                                    const activeSort = ss ?? { key: 'cnf' as SortKey, dir: 'desc' as SortDir };
                                    const stockLines: string[] = [];
                                    const stockParsed: ParsedStdRow[] = [];
                                    const nonStock: React.ReactNode[] = [];
                                    bodyLines.forEach((l, i) => {
                                      const p = parseStdLine(l);
                                      if (p) { stockLines.push(l); stockParsed.push(p); }
                                      else nonStock.push(renderLine(l, i));
                                    });
                                    const filt = stockParsed.map((p, i) => ({ p, i })).filter(({ p }) => passesScanFilter(scanFilter, p, { gradeMap: macroInsights?.gradeMap, postureMap: macroInsights?.postureMap, avoidSet: macroInsights?.avoidSet, dotMap: macroInsights?.dotMap }));
                                    const sortedFiltered = sortParsedRows(filt.map(ff => ff.p), activeSort.key, activeSort.dir).map(sr => filt[filt.map(ff => ff.p).indexOf(sr)].i);
                                    const hasHeader = !!label && !!SECTION_HEADERS[label];
                                    const useTwoCols = sortedFiltered.length > 5;
                                    const mid = useTwoCols ? Math.ceil(sortedFiltered.length / 2) : sortedFiltered.length;
                                    const leftIdxs = sortedFiltered.slice(0, mid);
                                    const rightIdxs = useTwoCols ? sortedFiltered.slice(mid) : [];
                                    const hdrEl = hasHeader ? <SortableHeader sortKey={ss?.key ?? 'cnf'} sortDir={ss?.dir ?? 'desc'} onSort={(k) => handleSectionSort(sk, k)} isVcp={label === 'VCP Thesis'} /> : null;
                                    return (
                                      <div className="space-y-1.5">
                                        {nonStock.length > 0 && <div className="space-y-1 mb-1">{nonStock}</div>}
                                        {useTwoCols ? (
                                          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
                                            <div>{hdrEl}{leftIdxs.map((idx, i) => renderLine(stockLines[idx], 1000 + i))}</div>
                                            <div><div className="hidden md:block">{hdrEl}</div>{rightIdxs.map((idx, i) => renderLine(stockLines[idx], 2000 + i))}</div>
                                          </div>
                                        ) : (
                                          <>{hdrEl}{leftIdxs.map((idx, i) => renderLine(stockLines[idx], 1000 + i))}</>
                                        )}
                                      </div>
                                    );
                                  })()
                                )
                              )}
                            </div>
                            {renderWatchAfter && macroInsights.watching?.length > 0 && (
                              <div className="lg:col-span-2 rounded-xl px-2.5 md:px-4 py-3 bg-cyan-500/[0.04]">
                                <div className="flex items-center gap-3 mb-2 cursor-pointer select-none" onClick={() => toggleSection('topSetups')} title={collapsedSections.has('topSetups') ? 'Expand' : 'Collapse'}>
                                  <div className="inline-flex items-center gap-1.5">
                                    <span className={`text-[9px] transition-transform duration-200 ${collapsedSections.has('topSetups') ? '' : 'rotate-90'} text-slate-500`}>&#9654;</span>
                                    <span className="inline-block text-[7px] font-bold tracking-widest uppercase px-1.5 py-[1px] rounded border text-cyan-400 bg-cyan-500/10 border-cyan-500/20">Top Setups</span>
                                  </div>
                                  {!collapsedSections.has('topSetups') && <span onClick={e => e.stopPropagation()}><SectionCopyButton tickers={macroInsights.watching.map(w => w.symbol)} /></span>}
                                  {!collapsedSections.has('topSetups') && <span onClick={e => e.stopPropagation()}><SectionTxtButton tickers={macroInsights.watching.map(w => w.symbol)} /></span>}
                                  {collapsedSections.has('topSetups') && macroInsights.watching.length > 0 && (
                                    <span className="text-[8px] text-slate-600 font-medium">{macroInsights.watching.map(w => w.symbol).join(' · ')}</span>
                                  )}
                                </div>
                                {!collapsedSections.has('topSetups') && (() => {
                                  const ws = sectionSorts['Top Setups'];
                                  const sortedItems = ws ? [...macroInsights.watching].sort((a, b) => {
                                    let av = 0, bv = 0;
                                    switch (ws.key) {
                                      case 'cnf': av = Number(a.score) || 0; bv = Number(b.score) || 0; break;
                                      case 'chg': av = a.chg ?? 0; bv = b.chg ?? 0; break;
                                      case 'rvol': av = Number(a.rvol) || 0; bv = Number(b.rvol) || 0; break;
                                      case 'vol': av = a.vol ?? 0; bv = b.vol ?? 0; break;
                                      case 'dvol': av = a.dVol ?? 0; bv = b.dVol ?? 0; break;
                                      case 'rs': av = Number(a.rsRating) || 0; bv = Number(b.rsRating) || 0; break;
                                    }
                                    return ws.dir === 'desc' ? bv - av : av - bv;
                                  }) : macroInsights.watching;
                                  const filtered = sortedItems.filter((item: any) => passesPoolFilter(scanFilter, item));
                                  const leftItems = filtered.slice(0, Math.ceil(filtered.length / 2));
                                  const rightItems = filtered.slice(Math.ceil(filtered.length / 2));
                                  const hdr = <SortableHeader sortKey={ws?.key ?? null} sortDir={ws?.dir ?? 'desc'} onSort={(k) => handleSectionSort('Top Setups', k)} />;
                                  const renderItem = (item: any, idx: number) => {
                                    const _s = typeof item === 'object' ? item : { symbol: item as never, chg: 0, rvol: null, vol: 0, dVol: 0, stage: '', grade: null, score: undefined, dotKind: null, posture: null, rsRating: null, price: null as number | null, catalyst: null as string | null, catalystUrl: null as string | null, newsCausal: null as boolean | null };
                                    const s = { ..._s, rsRating: _s.rsRating ?? macroInsights.rsMap?.[_s.symbol] ?? null, stage: _s.stage || macroInsights.stageMap?.[_s.symbol] || '' };
                                    const pb: PostureBucket | null = s.posture || null;
                                    const pMeta = pb ? POSTURE_META[pb] : null;
                                    const rv = s.rvol != null ? Number(s.rvol) : null;
                                    const v = s.vol ?? 0;
                                    const dv = s.dVol ?? 0;
                                    const fmtV = v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : '';
                                    const fmtDv = dv >= 1e9 ? '$' + (dv / 1e9).toFixed(1) + 'B' : dv >= 1e6 ? '$' + (dv / 1e6).toFixed(0) + 'M' : dv > 0 ? '$' + (dv / 1e3).toFixed(0) + 'K' : '';
                                    const isAvoid = macroInsights.avoidSet?.has(s.symbol) || s.dotKind === 'red';
                                    const isBlueDot = s.dotKind === 'blue';
                                    /* Same edge tint as the scan cards, from the
                                       shared per-ticker map so every card agrees. */
                                    const edge = macroInsights.edgeMap?.[s.symbol] ?? null;
                                    return (
                                      <div key={idx} className={`flex items-center whitespace-nowrap py-[1px] ${edge ? `${EDGE_TINT[edge]} rounded-sm` : ''}`}
                                        title={edge ? `${edge.toUpperCase()} — ${EDGE_FILTER_TIP[edge]}` : undefined}>
                                        <span className="hidden md:inline-flex shrink-0" style={{ width: 0, overflow: 'visible', position: 'relative' }}><span style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)' }}><WatchlistBtn symbol={s.symbol} /></span></span>
                                        <TickerChartHover symbol={s.symbol}><span className={`${gradeChipCls(s.grade, isAvoid)} w-[38px] md:w-[44px]`}>{s.symbol}</span></TickerChartHover>
                                        <span className="inline-block w-[12px] text-center leading-none shrink-0" />
                                        <span className="inline-block w-[8px] text-center shrink-0">
                                          {isBlueDot && <span className="inline-block w-1.5 h-1.5 rounded-full bg-sky-400 shadow-[0_0_5px_rgba(56,189,248,0.6)]" />}
                                        </span>
                                        <span className="inline-block w-[8px] text-center shrink-0">
                                          {pMeta ? <span title={`${pMeta.short} — ${pMeta.tip}`} className={`inline-block w-[6px] h-[6px] rounded-full cursor-help ${pMeta.tone === 'good' ? 'bg-emerald-400' : pMeta.tone === 'warn' ? 'bg-amber-400' : 'bg-rose-400'}`} /> : null}
                                        </span>
                                        <span className={`inline-block align-baseline text-[7px] font-bold tabular-nums rounded border ml-1 w-[20px] md:w-[22px] leading-[14px] text-center ${s.score != null && !isNaN(Number(s.score)) ? cnfBadgeCls(Number(s.score)) : 'text-slate-600 border-slate-700/40 bg-slate-800/30'}`}>{s.score != null && !isNaN(Number(s.score)) ? Number(s.score) : '-'}</span>
                                        <span className={`text-[10px] tabular-nums font-semibold inline-block w-[46px] md:w-[52px] text-right ${(s.chg ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{(s.chg ?? 0) >= 0 ? '+' : ''}{(s.chg ?? 0).toFixed(2)}%</span>
                                        <span className="text-[10px] tabular-nums inline-block w-[36px] md:w-[42px] text-right text-slate-300 ml-1">{fmtPrc(s.price)}</span>
                                        <span className={`text-[10px] tabular-nums font-semibold inline-block w-[36px] md:w-[40px] text-right ml-1 ${rv == null ? 'text-transparent' : rv >= 2 ? 'text-emerald-400' : rv >= 1.5 ? 'text-white' : 'text-slate-400'}`}>{rv != null ? `${rv < 1 ? rv.toFixed(1) : Math.round(rv)}x` : ''}</span>
                                        <span className={`text-[10px] tabular-nums inline-block w-[30px] md:w-[36px] text-right ml-1 ${fmtV ? 'text-slate-400' : 'text-transparent'}`}>{fmtV}</span>
                                        <span className={`text-[10px] tabular-nums inline-block w-[36px] md:w-[40px] text-right ml-1 ${fmtDv ? 'text-slate-300' : 'text-transparent'}`}>{fmtDv}</span>
                                        <span className="inline-block w-[22px] md:w-[24px] text-center ml-1">{s.rsRating != null ? <span className={`inline-block w-[20px] md:w-[22px] leading-[14px] rounded border text-[7px] font-bold tabular-nums text-center ${rsBadge(Number(s.rsRating))}`}>{Number(s.rsRating)}</span> : <span className="inline-block w-[20px] md:w-[22px] leading-[14px] rounded border text-[7px] font-bold tabular-nums text-center text-slate-600 border-slate-700/40 bg-slate-800/30">-</span>}</span>
                                        <span className="inline-block w-[22px] md:w-[24px] text-center ml-1">{s.stage ? <span className={`inline-block w-[20px] md:w-[22px] leading-[14px] rounded border text-[7px] font-bold tabular-nums text-center ${stageBadge(s.stage)}`}>{s.stage}</span> : <span className="inline-block w-[20px] md:w-[22px] leading-[14px] rounded border text-[7px] font-bold tabular-nums text-center text-slate-600 border-slate-700/40 bg-slate-800/30">-</span>}</span>
                                        {(() => {
                                          const nc = newsStarCount({ catalyst: s.catalyst, catalystUrl: s.catalystUrl, newsCausal: (s as any).newsCausal });
                                          if (nc >= 1 && s.catalystUrl) return <a href={s.catalystUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className={`inline-block w-[14px] md:w-[16px] text-center ${nc >= 2 ? 'text-amber-400' : 'text-slate-500'} hover:brightness-125 font-bold text-[7px] leading-none cursor-pointer transition-all ml-1`} title={s.catalyst || ''}>{'★'.repeat(nc)}</a>;
                                          return <span className="inline-block w-[14px] md:w-[16px] ml-1"></span>;
                                        })()}
                                      </div>
                                    );
                                  };
                                  return (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
                                      <div className="flex flex-col gap-0.5">{hdr}{leftItems.map(renderItem)}</div>
                                      {rightItems.length > 0 && <div className="flex flex-col gap-0.5"><div className="hidden md:flex">{hdr}</div>{rightItems.map((item, i) => renderItem(item, 500 + i))}</div>}
                                    </div>
                                  );
                                })()}
                              </div>
                            )}
                            </React.Fragment>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

              </div>
            </div>
          )}

        </>
      )}
    </div>
  );
}
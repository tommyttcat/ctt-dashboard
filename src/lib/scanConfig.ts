// lib/scanConfig.ts
//
// Every threshold each scan enforces, in one place.
//
// These used to live as local constants inside their route files, which meant
// the numbers doing the filtering and the numbers documented to you were two
// separate things that could silently diverge. Now the routes import from here
// and ship the same object in their KV payload, so the on-screen key renders
// what the scan ACTUALLY used rather than what someone typed into a comment.
//
// Each gate carries display metadata alongside its value: a short label, a
// formatted string, and one line explaining why the gate exists at all. The
// "why" is the part that's hard to reconstruct six months later.

export interface ScanGate {
  /** Short column-style label, e.g. "ADR". */
  label: string;
  /** Human-formatted threshold, e.g. "\u2265 3%". */
  value: string;
  /** One line on why this gate exists. */
  why: string;
}

export interface ScanConfigMeta {
  /** Table name as it appears in the UI. */
  title: string;
  /** One-paragraph description of what the scan is looking for. */
  premise: string;
  /** The gates, in the order they should render. */
  gates: ScanGate[];
  /** How many rows the table shows after filtering. */
  shows: string;
}

const pct = (n: number) => `${n}%`;
const usd = (n: number) => {
  if (n >= 1e9) return `$${n / 1e9}B`;
  if (n >= 1e6) return `$${n / 1e6}M`;
  if (n >= 1e3) return `$${n / 1e3}K`;
  return `$${n}`;
};
const shares = (n: number) => {
  if (n >= 1e6) return `${n / 1e6}M`;
  if (n >= 1e3) return `${n / 1e3}K`;
  return String(n);
};

/* ==========================================================================
   STOCKS IN PLAY + DAILY SETUPS
   ========================================================================== */
export const SCANNER = {
  minVolume: 500_000,
  minAvgVol: 2_000_000,
  minMarketCap: 10_000_000,
  minChange: 4.0,
  minPrice: 1.00,
  minDollarVol: 5_000_000,
  minAdrPct: 3.0,
  minAtr: 1.00,
  finalSize: 10,
} as const;

export const SCANNER_SIP_META: ScanConfigMeta = {
  title: 'Stocks in Play',
  premise:
    'Names moving hard on real volume today, trading above VWAP. This is the intraday list \u2014 what the tape is actually paying attention to right now.',
  gates: [
    { label: 'Change', value: `\u2265 +${SCANNER.minChange}%`, why: 'Below this it is noise, not a move.' },
    { label: 'VWAP', value: 'Price above', why: 'Longs below VWAP are fighting the day\'s average buyer.' },
    { label: 'Volume', value: `\u2265 ${shares(SCANNER.minVolume)}`, why: 'Absolute floor \u2014 thin names cannot be traded out of.' },
    { label: '$ Volume', value: `\u2265 ${usd(SCANNER.minDollarVol)}`, why: 'Kills low-priced spikes that show big share counts but no real money.' },
    { label: 'Avg volume', value: `\u2265 ${shares(SCANNER.minAvgVol)} (20d)`, why: 'The name has to be normally liquid, not a one-day wonder.' },
    { label: 'ADR', value: `\u2265 ${pct(SCANNER.minAdrPct)}`, why: 'Anti-chop. A name that cannot travel 3% on a typical day has no room to pay you.' },
    { label: 'ATR', value: `\u2265 ${usd(SCANNER.minAtr)}`, why: 'Enough absolute range to place a stop that is not inside the spread.' },
    { label: 'Market cap', value: `\u2265 ${usd(SCANNER.minMarketCap)}`, why: 'Excludes shells and sub-scale listings.' },
  ],
  shows: `Top ${SCANNER.finalSize} by volume`,
};

export const SCANNER_DAILY_META: ScanConfigMeta = {
  title: 'Daily Setups',
  premise:
    'The same universe as Stocks in Play, ranked by dollar volume rather than share volume and without the VWAP requirement. Broader net, more swing-oriented.',
  gates: [
    { label: 'Change', value: `\u2265 +${SCANNER.minChange}%`, why: 'Below this it is noise, not a move.' },
    { label: 'Volume', value: `\u2265 ${shares(SCANNER.minVolume)}`, why: 'Absolute floor \u2014 thin names cannot be traded out of.' },
    { label: '$ Volume', value: `\u2265 ${usd(SCANNER.minDollarVol)}`, why: 'Kills low-priced spikes that show big share counts but no real money.' },
    { label: 'ADR', value: `\u2265 ${pct(SCANNER.minAdrPct)}`, why: 'Anti-chop. A name that cannot travel 3% on a typical day has no room to pay you.' },
    { label: 'Market cap', value: `\u2265 ${usd(SCANNER.minMarketCap)}`, why: 'Excludes shells and sub-scale listings.' },
  ],
  shows: `Top ${SCANNER.finalSize} by dollar volume`,
};

/* ==========================================================================
   REVERSAL / SWING
   ========================================================================== */
export const SWING = {
  minPrice: 10,
  maxPrice: 2000,
  minAvgDollarVol: 50_000_000,
  minAtrPct: 1.5,
  maxAtrPct: 6.0,
  minPctOffHigh: 2,
  maxPctOffHigh: 20,
  maxDistToEma21: 4,
  maxStochK: 35,
  /* rsLookback is gone. It set the window for the SPY benchmark return that
     produced rsVsSpy; swing route v1.9 replaced that with the shared RS
     Rating, whose lookback is fixed by the IBD formula (four quarters, most
     recent double-weighted) inside /api/rs/run. Leaving a 63 here would
     imply this scan still chooses a window it no longer controls. */
  earningsBlackoutDays: 7,
  universeSize: 120,
} as const;

export const SWING_META: ScanConfigMeta = {
  title: 'Reversal / Swing',
  premise:
    'Leaders pulling back into their 21 EMA with the stochastic oversold \u2014 the Dr. Wish blue-dot entry. Every name here already ranks in the stronger half of the market on relative strength; the scan is looking for the rest.',
  gates: [
    { label: 'Price', value: `${usd(SWING.minPrice)} \u2013 ${usd(SWING.maxPrice)}`, why: 'Excludes penny names and the handful of four-figure listings.' },
    { label: 'Avg $ volume', value: `\u2265 ${usd(SWING.minAvgDollarVol)} (20d)`, why: 'Institutional liquidity \u2014 you need size on both sides.' },
    { label: 'RS Rating', value: '\u2265 50', why: 'Hard gate, and 35 of the 100 score points. A percentile against the whole liquid market rather than a spread versus SPY \u2014 50 is the median, chosen to preserve the strictness of the old "beat SPY by any margin" test rather than to adopt Minervini\'s 70. Raising it would make this a leadership scan instead of a pullback scan.' },
    { label: 'Trend', value: 'Above 50 & 200 SMA', why: 'Pullbacks only work inside an uptrend.' },
    { label: 'ATR', value: `${pct(SWING.minAtrPct)} \u2013 ${pct(SWING.maxAtrPct)}`, why: 'Enough movement to pay, not so much the stop is unmanageable.' },
    { label: 'Off highs', value: `${pct(SWING.minPctOffHigh)} \u2013 ${pct(SWING.maxPctOffHigh)}`, why: 'A real pullback, not an extended name and not broken structure.' },
    { label: 'Dist to 21 EMA', value: `within \u00b1${pct(SWING.maxDistToEma21)}`, why: 'Price has to be AT the anchor for the entry to have a stop.' },
    { label: 'Stoch %K', value: `\u2264 ${SWING.maxStochK}`, why: 'Oversold on the 10/4 smoothed stochastic \u2014 the blue-dot condition.' },
    { label: 'Earnings', value: `Excluded within ${SWING.earningsBlackoutDays}d`, why: 'A pullback entry into an earnings print is a coin flip, not a setup.' },
  ],
  shows: `Ranked by score, from the top ${SWING.universeSize} names by dollar volume`,
};

/* ==========================================================================
   10/21 CONSOLIDATION
   ========================================================================== */
export const CONSOL = {
  minDollarVol: 10_000_000,
  minMarketCap: 10_000_000,
  minAdrPct: 3.0,
  maxDistToEma10: 5,
  maxAboveEma21: 5,
  maxBelowEma21: 1.5,
  maxRange10: 14,
  maxCoilRatio: 4.0,
  tightCoilRatio: 2.5,
  maxDayChange: 3,
  maxPctOffHigh: 15,
  finalSize: 40,
} as const;

export const CONSOL_META: ScanConfigMeta = {
  title: '10/21 Consolidation',
  premise:
    'Names coiling tightly on rising 10/21 EMAs inside a confirmed uptrend \u2014 the trend-hold entry BEFORE the breakout rather than after it. Tightness is judged in multiples of the stock\'s own ATR, so a high-volatility name is not punished for its normal wiggle.',
  gates: [
    { label: 'Avg $ volume', value: `\u2265 ${usd(CONSOL.minDollarVol)} (20d)`, why: 'Lower than the swing floor \u2014 coiling names are quieter by definition.' },
    { label: 'Market cap', value: `\u2265 ${usd(CONSOL.minMarketCap)}`, why: 'Excludes shells and sub-scale listings.' },
    { label: 'ADR', value: `\u2265 ${pct(CONSOL.minAdrPct)}`, why: 'Anti-chop. A 1.5% ADR name can look beautifully coiled while simply being dead.' },
    { label: 'Trend', value: 'Above 50 & 200, 50 > 200', why: 'Consolidation only counts inside an established uptrend.' },
    { label: '21 EMA', value: 'Rising', why: 'A flat or falling anchor is a base, not a continuation setup.' },
    { label: 'Dist to 10 EMA', value: `within \u00b1${pct(CONSOL.maxDistToEma10)}`, why: 'Price hugging the fast average is what "riding the 10/21" means.' },
    { label: 'Dist to 21 EMA', value: `-${pct(CONSOL.maxBelowEma21)} to +${pct(CONSOL.maxAboveEma21)}`, why: 'Small undercuts tolerated; no breakdowns and nothing extended.' },
    { label: '10-day range', value: `\u2264 ${pct(CONSOL.maxRange10)}`, why: 'Absolute ceiling on how wide the coil can be.' },
    { label: 'Coil ratio', value: `\u2264 ${CONSOL.maxCoilRatio}\u00d7 ATR`, why: 'The primary gate. A stock drifts ~3-4\u00d7 ATR over ten sessions; tighter is a genuine coil.' },
    { label: 'Today', value: `within \u00b1${pct(CONSOL.maxDayChange)}`, why: 'Quiet tape today \u2014 an event bar is not consolidation.' },
    { label: 'Off highs', value: `\u2264 ${pct(CONSOL.maxPctOffHigh)}`, why: 'Basing below the highs, not repairing real damage.' },
    { label: 'RS Rating', value: '\u2265 50', why: 'Same gate as the swing scan, and 30 of the score. It matters more here than it looks: a base is a stock going nowhere by construction, so tightness, days in base and volume drying cannot tell a leader pausing from a laggard drifting \u2014 they look identical. Relative strength is the only thing that separates them.' },
  ],
  shows: `Top ${CONSOL.finalSize} by score \u00b7 "Coiled" = \u2264 ${CONSOL.tightCoilRatio}\u00d7 ATR`,
};

/* ==========================================================================
   EP 9 MILLION
   ========================================================================== */
export const EP9M = {
  minVolume: 9_000_000,
  minPrice: 3.00,
  maxPrice: 2000,
  minRvol: 3.0,
  minDollarVol: 20_000_000,
  minMarketCap: 10_000_000,
  volProfileDays: 60,
  shortlistSize: 40,
  finalSize: 25,
  registryDays: 90,
} as const;

export const EP9M_META: ScanConfigMeta = {
  title: 'EP 9 Million',
  premise:
    'Fewer than ~2% of US listings trade 9M+ shares in a session. When a stock that normally trades 800K suddenly does 12M, institutions are accumulating and the news has not been priced yet. The volume IS the signal \u2014 you research the catalyst after the scan flags it. Deliberately does NOT gate on % change: a non-gapping stock quietly trading 10x its normal volume is the highest-value case this scan exists to find.',
  gates: [
    { label: 'Volume', value: `\u2265 ${shares(EP9M.minVolume)} shares`, why: 'The namesake threshold. Absolute, not time-weighted, so names appear progressively through the session.' },
    { label: 'RVOL', value: `\u2265 ${EP9M.minRvol}\u00d7`, why: 'THE gate. Without it the scan returns mega caps every day \u2014 NVDA trades 9M before 10am.' },
    { label: 'Price', value: `${usd(EP9M.minPrice)} \u2013 ${usd(EP9M.maxPrice)}`, why: 'Below $3 the volume is noise.' },
    { label: '$ Volume', value: `\u2265 ${usd(EP9M.minDollarVol)}`, why: 'It has to be actually tradeable.' },
    { label: 'Market cap', value: `\u2265 ${usd(EP9M.minMarketCap)}`, why: 'Excludes shells and sub-scale listings.' },
    { label: 'Type', value: 'Common stock only', why: 'ETFs are excluded \u2014 there is no company to re-rate.' },
    { label: 'History', value: `${EP9M.volProfileDays}d volume profile`, why: 'Needed to judge whether today is abnormal FOR THIS NAME.' },
  ],
  shows: `Top ${EP9M.finalSize} by score, from the ${EP9M.shortlistSize} most abnormal \u00b7 registry keeps ${EP9M.registryDays}d`,
};

/* ==========================================================================
   VCP  \u2014  Volatility Contraction Pattern
   ========================================================================== */
export const VCP = {
  minPrice: 10,
  maxPrice: 10_000,
  minAvgVolume: 200_000,
  minDollarVol: 5_000_000,

  /* RS floor. 70 is Minervini's stated minimum; he prefers 80+ and is most
     interested above 90. Gating at 70 rather than 80 is deliberate \u2014 the
     score penalises 70-79 heavily, so those names appear at the BOTTOM of the
     table rather than vanishing, and you can see how thin the top of the list
     is on a given day. A hard 80 gate would hide that distinction: an empty
     table and a table full of marginal bases would look identical. */
  minRsRating: 70,

  windowTradingDays: 90,
  shortlistCap: 150,
  finalSize: 40,
};

export const VCP_META: ScanConfigMeta = {
  title: 'VCP',
  premise:
    'Minervini\'s Volatility Contraction Pattern. A stock that has already advanced builds a base of successively SHALLOWER pullbacks on successively LIGHTER volume \u2014 25%, then 12%, then 6% is the textbook shape \u2014 then breaks out through the high of the final contraction. The contractions are supply being absorbed: each pullback finds buyers sooner than the last because there is less stock left to sell.\n\nThis is the only table here that surfaces a setup BEFORE it triggers. Every other scan gates on something that already happened \u2014 +4% today, 9M shares today, a dot that has fired. A base is worth watching for the two to six weeks while it forms, so the STATUS column matters more than the score: a perfect pattern whose pivot is already behind you is a history lesson, not a trade.',
  gates: [
    { label: 'RS Rating', value: `\u2265 ${VCP.minRsRating}`, why: 'A percentile against the whole liquid market, not a spread versus SPY. A flawless base in a laggard is still a laggard \u2014 Minervini treats this as a hard gate rather than a nicety.' },
    { label: 'Contractions', value: '2 \u2013 6, each shallower', why: 'The pattern itself. Checked pairwise with 15% tolerance: a base going 20/8/14 has WIDENED again and fails, even though its last leg beats its first.' },
    { label: 'Final leg', value: '\u2264 15% deep', why: 'Above this the base has not finished \u2014 the stock is still correcting rather than coiling.' },
    { label: 'First leg', value: '\u2264 40% deep', why: 'Deeper than this is a correction, not a base.' },
    { label: 'Prior advance', value: '\u2265 25%', why: 'Without a run into the base there is no supply overhang to absorb, and the "base" is just a quiet stock going sideways.' },
    { label: 'Trend Template', value: 'Scored, not gated', why: 'Minervini\'s seven structural criteria. Shown as n/7 rather than enforced, because a name failing one is worth seeing and knowing which.' },
    { label: 'Price', value: `${usd(VCP.minPrice)} \u2013 ${usd(VCP.maxPrice)}`, why: 'The pattern depends on institutional accumulation, and institutions do not accumulate low-priced stock.' },
    { label: 'Volume', value: `\u2265 ${shares(VCP.minAvgVolume)} avg`, why: 'Same reason. They cannot accumulate what does not trade.' },
    { label: '$ Volume', value: `\u2265 ${usd(VCP.minDollarVol)}`, why: 'It has to be fillable when the pivot gives way.' },
    { label: 'History', value: `${VCP.windowTradingDays}d window \u00b7 200d confirm`, why: 'The base window finds contractions market-wide; the Trend Template needs 200 bars and runs only on survivors.' },
  ],
  shows: `Top ${VCP.finalSize} by pattern score, from a shortlist of ${VCP.shortlistCap}`,
};

/* ==========================================================================
   TOP MOVERS
   ========================================================================== */
export const TOPMOVERS_META: ScanConfigMeta = {
  title: 'Top Movers',
  premise:
    'The raw tape, split into buckets. Mega caps track the generals; Gainers and Losers are everything else; ETF tabs cover the leveraged and sector products. Less filtered than the setup tables \u2014 this is what moved, not what is worth trading.',
  gates: [
    { label: 'Price', value: `\u2265 ${usd(SCANNER.minPrice)}`, why: 'Bare minimum to exclude sub-dollar noise.' },
    { label: 'Volume', value: `\u2265 ${shares(SCANNER.minVolume)}`, why: 'Something has to have traded.' },
    { label: 'Gainers', value: `\u2265 +${SCANNER.minChange}%`, why: 'The Losers tab has no floor \u2014 the worst performers are the point.' },
    { label: 'Market cap', value: `\u2265 ${usd(SCANNER.minMarketCap)}`, why: 'Excludes shells.' },
  ],
  shows: 'Top 10 per tab',
};

/* ==========================================================================
   Filter semantics
   ========================================================================== */
export interface FilterNote {
  label: string;
  note: string;
}

export const FILTER_NOTES: FilterNote[] = [
  { label: 'VCP STATUS', note: 'Derived from distance to the pivot, NOT from the scan\'s own status field \u2014 that reports "breaking out" whenever price is above the pivot with no bound on how far, so a name that cleared three weeks ago and ran 18% still counts. Watch is more than 3% below; Ready is within 3% below; Fresh is within 3% above. Beyond that the entry has gone.' },
  { label: 'VCP RS 80 / 90', note: '"And above." The scan already floors at 70, Minervini\'s stated minimum \u2014 these tighten to his preferred and his most-interested levels.' },
  { label: 'VCP TT Perfect', note: 'All seven computable Trend Template criteria. The eighth is the RS Rating, which has its own filter.' },
  { label: 'VCP LEGS 3\u20134', note: 'Enough repetitions to prove supply is thinning, not so many that the base has stalled into a range. Two qualifies but is thin; five or more is scored down.' },
  { label: 'CNF A / B', note: 'A floor, not an exact grade. Picking B shows B and A. Unset shows everything, which is effectively "C and above".' },
  { label: 'STAGE 2', note: 'Matches any Stage 2 sub-stage \u2014 2A, 2B and 2C. Filtering to 2A alone would hide names whose trend is intact but weakening.' },
  { label: 'ADR 5% / 10%', note: '"And above." The scan already floors at 3%, so these tighten rather than replace it.' },
  { label: '$VOL 20M / 50M / 100M', note: '"And above", measured on 20-day AVERAGE dollar volume \u2014 not today\'s, which is light by design on a consolidating name.' },
  { label: 'RVOL 5\u00d7 / 10\u00d7', note: '"And above." The EP9M scan already floors at 3\u00d7.' },
  { label: '10/21', note: '">10" means above the 10 EMA. "Both" requires above both averages.' },
  { label: 'VWAP', note: 'Above or below the session volume-weighted average price. Not applicable outside market hours.' },
  { label: 'Any active pill', note: 'Click it again to clear back to All.' },
];

/* ==========================================================================
   Column glossary
   ========================================================================== */
export interface ColumnNote {
  what: string;
  colour?: string;
}

export const COLUMN_NOTES: Record<string, ColumnNote> = {
  CNF: {
    what: 'Confluence score, 0-100. The unified read \u2014 volume, gap, range expansion, relative strength, extension, catalyst quality, scan persistence, market regime and sector heat, all deterministic. Hover the badge for the point-by-point breakdown.',
    colour: 'Green \u2265 70 (A) \u00b7 amber \u2265 50 (B) \u00b7 grey below (C).',
  },
  EP: {
    what: 'EP9M score, 0-100. Volume abnormality carries half the weight because it IS the setup; the rest is float turnover, catalyst quality, close strength, money flow and days to cover. Hover for the breakdown.',
    colour: 'Green \u2265 70 (A) \u00b7 amber \u2265 50 (B) \u00b7 grey below (C).',
  },
  PRICE: {
    what: 'Last trade. The dot beside it is VWAP position.',
    colour: 'Green dot = above VWAP \u00b7 red = below.',
  },
  'CHG%': { what: 'Percent change on the session.', colour: 'Green up, red down.' },
  '10/21': {
    what: 'Price versus the 10 and 21 EMAs.',
    colour: 'Green dot = above that average \u00b7 red = below \u00b7 grey = insufficient history.',
  },
  VOL: { what: 'Shares traded today.' },
  '$VOL': { what: 'Dollars traded today \u2014 volume \u00d7 VWAP. Catches the low-priced names that look busy in share terms but move no real money.' },
  RVOL: {
    what: 'Relative volume \u2014 today versus this stock\'s own 20-day average. Says volume showed up; says nothing about which side got filled.',
    colour: 'Amber \u2265 2\u00d7 \u00b7 green \u2265 1.5\u00d7 \u00b7 grey below.',
  },
  FLOAT: {
    what: 'Shares available to trade. Small floats move further on the same demand.',
    colour: 'Purple \u2264 20M \u00b7 green \u2264 50M \u00b7 grey above.',
  },
  ADR: {
    what: 'Average Daily Range, 20-day, Minervini definition (mean of high/low, minus one). Unlike ATR it has no gap component, so it measures the intraday room a typical session actually offers. The anti-chop metric.',
    colour: 'Purple \u2265 10% \u00b7 green \u2265 5% \u00b7 grey \u2265 3%.',
  },
  MF: {
    what: 'Money Flow, 21-day, Chaikin-style. Where each bar closed within its own range, volume-weighted. RVOL says volume showed up; MF says which side got filled. The arrow is the 5-day direction.',
    colour: 'Purple \u2265 70 \u00b7 green \u2265 60 \u00b7 lime \u2265 50 \u00b7 amber \u2265 40 \u00b7 orange \u2265 30 \u00b7 red below. Above 50 is accumulation.',
  },
  RS: {
    what: 'Minervini / IBD Relative Strength Rating \u2014 a PERCENTILE against every liquid US stock, not a spread versus SPY. 88 means stronger than 88% of the market.\n\nTrailing-year performance with the most recent quarter double-weighted, then ranked against everything above $5 and 100K average shares. The percentile is the point: +18 versus SPY might be top-decile in a weak tape and unremarkable in a strong one, and a spread cannot tell you which. Minervini gates at 70 and prefers 80-90+.\n\nComputed on CLOSING prices by a single daily job, so it does not move intraday \u2014 a stock up 8% today still shows yesterday\'s rating. IBD\'s works the same way.\n\nOn the Reversal/Swing and 10/21 tables it is a GATE as well as a column: names below 50 never appear.',
    colour: 'Purple \u2265 90 \u00b7 green \u2265 80 \u00b7 grey \u2265 70 \u00b7 red below.',
  },
  STOCH: {
    what: 'Smoothed stochastic %K (10, 4) \u2014 the Dr. Wish setting. Low is oversold.',
    colour: 'Purple \u2264 20 \u00b7 green \u2264 30 \u00b7 grey above.',
  },
  DTC: {
    what: 'Days to cover \u2014 short interest divided by average daily volume. How many sessions of normal trade it would take shorts to exit. More useful than raw short percent because it scales the position against the liquidity to unwind it.',
    colour: 'Purple \u2265 5 \u00b7 green \u2265 3 \u00b7 grey \u2265 1.5.',
  },
  TURN: {
    what: 'Float turnover \u2014 what share of the tradeable float changed hands today. Above 1.0\u00d7 the entire float traded: every holder sold and someone else bought, in one session. That is a genuine change in ownership, not a busy day.',
    colour: 'Fuchsia \u2265 1.0\u00d7 \u00b7 purple \u2265 0.5\u00d7 \u00b7 green \u2265 0.25\u00d7 \u00b7 lime \u2265 0.10\u00d7.',
  },
  COIL: {
    what: 'The 10-day high-low range, with its width in multiples of the stock\'s own daily ATR beneath. The ratio is what matters \u2014 it lets an 8% ATR name and a 1.5% ATR name be judged on the same scale.',
    colour: 'Purple \u2264 2.0\u00d7 \u00b7 green \u2264 2.5\u00d7 \u00b7 amber \u2264 4.0\u00d7 \u00b7 grey above.',
  },
  MCAP: { what: 'Market capitalisation.' },
  STAGE: {
    what: 'Weinstein stage with sub-stage. 2A is a strong advance above the 30 SMA; 2B has slipped off the 30 but holds the 50; 2C is below the 50 \u2014 still Stage 2 on paper, but sagging. 2C is the one worth catching: it looks healthy in a scan while the stock quietly rolls over.',
    colour: 'Green 2A/2B \u00b7 amber 2C and Stage 3 \u00b7 red Stage 4 \u00b7 grey Stage 1.',
  },
  SECTOR: { what: 'Sector or, for leveraged ETFs, the underlying and its sector.' },
  STATE: {
    what: 'RMV and RME as one read. RMV is how WIDE price is moving versus its own last 15 bars (0 = tightest, 100 = widest). RME is how FAR it sits from its 21 EMA versus a year of its own extension (-100 to +100). They cannot be averaged \u2014 a stock can be tight-and-extended or wild-and-anchored \u2014 so the pair reads as a quadrant. COILED: tight, at the anchor. DRIFT: tight but stretched, the one that hides. WASHED: quiet and far below. IMPULSE: expanding and extended. FLUSH: wide and far below. CHOP: violent, going nowhere.',
  },
  CLS: {
    what: 'Where price settled inside the day\'s range. A stock that traded 12M shares and closed on its low moved that volume from buyers to sellers.',
    colour: 'Green closed strong (top 15%) \u00b7 red closed weak (bottom 25%).',
  },
  STR: {
    what: 'Structure. GC = 50 SMA above 200 SMA. 21\u2191 = the 21 EMA is rising.',
    colour: 'Green true \u00b7 red false.',
  },
  STAT: {
    what: 'Readiness. "Ready" means stochastic \u2264 25 and price within 2.5% of the 21 EMA \u2014 the trigger could fire imminently. On 10/21 this reads Coiled / Setting Up instead.',
  },
};
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
  /** Human-formatted threshold, e.g. "≥ 3%". */
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
   STOCKS IN PLAY + DAILY SETUPS — app/api/scanner/run/route.ts
   Both lists come from the same scan with the same gates; they differ only
   in how candidates are ranked (SIPs by volume and above-VWAP, Daily by
   dollar volume).
   ========================================================================== */
export const SCANNER = {
  minVolume: 500_000,
  minAvgVol: 2_000_000,
  minMarketCap: 20_000_000,
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
    'Names moving hard on real volume today, trading above VWAP. This is the intraday list — what the tape is actually paying attention to right now.',
  gates: [
    { label: 'Change', value: `≥ +${SCANNER.minChange}%`, why: 'Below this it is noise, not a move.' },
    { label: 'VWAP', value: 'Price above', why: 'Longs below VWAP are fighting the day\'s average buyer.' },
    { label: 'Volume', value: `≥ ${shares(SCANNER.minVolume)}`, why: 'Absolute floor — thin names cannot be traded out of.' },
    { label: '$ Volume', value: `≥ ${usd(SCANNER.minDollarVol)}`, why: 'Kills low-priced spikes that show big share counts but no real money.' },
    { label: 'Avg volume', value: `≥ ${shares(SCANNER.minAvgVol)} (20d)`, why: 'The name has to be normally liquid, not a one-day wonder.' },
    { label: 'ADR', value: `≥ ${pct(SCANNER.minAdrPct)}`, why: 'Anti-chop. A name that cannot travel 3% on a typical day has no room to pay you.' },
    { label: 'ATR', value: `≥ ${usd(SCANNER.minAtr)}`, why: 'Enough absolute range to place a stop that is not inside the spread.' },
    { label: 'Market cap', value: `≥ ${usd(SCANNER.minMarketCap)}`, why: 'Excludes shells and sub-scale listings.' },
  ],
  shows: `Top ${SCANNER.finalSize} by volume`,
};

export const SCANNER_DAILY_META: ScanConfigMeta = {
  title: 'Daily Setups',
  premise:
    'The same universe as Stocks in Play, ranked by dollar volume rather than share volume and without the VWAP requirement. Broader net, more swing-oriented.',
  gates: [
    { label: 'Change', value: `≥ +${SCANNER.minChange}%`, why: 'Below this it is noise, not a move.' },
    { label: 'Volume', value: `≥ ${shares(SCANNER.minVolume)}`, why: 'Absolute floor — thin names cannot be traded out of.' },
    { label: '$ Volume', value: `≥ ${usd(SCANNER.minDollarVol)}`, why: 'Kills low-priced spikes that show big share counts but no real money.' },
    { label: 'ADR', value: `≥ ${pct(SCANNER.minAdrPct)}`, why: 'Anti-chop. A name that cannot travel 3% on a typical day has no room to pay you.' },
    { label: 'Market cap', value: `≥ ${usd(SCANNER.minMarketCap)}`, why: 'Excludes shells and sub-scale listings.' },
  ],
  shows: `Top ${SCANNER.finalSize} by dollar volume`,
};

/* ==========================================================================
   REVERSAL / SWING — app/api/swing-candidates/run/route.ts (analyze)
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
  rsLookback: 63,
  earningsBlackoutDays: 7,
  universeSize: 120,
} as const;

export const SWING_META: ScanConfigMeta = {
  title: 'Reversal / Swing',
  premise:
    'Leaders pulling back into their 21 EMA with the stochastic oversold — the Dr. Wish blue-dot entry. Every name here is already outperforming SPY; the scan is looking for the rest.',
  gates: [
    { label: 'Price', value: `${usd(SWING.minPrice)} – ${usd(SWING.maxPrice)}`, why: 'Excludes penny names and the handful of four-figure listings.' },
    { label: 'Avg $ volume', value: `≥ ${usd(SWING.minAvgDollarVol)} (20d)`, why: 'Institutional liquidity — you need size on both sides.' },
    { label: 'RS vs SPY', value: '> 0', why: 'Hard gate. A name that cannot beat the index over three months is not a leader.' },
    { label: 'Trend', value: 'Above 50 & 200 SMA', why: 'Pullbacks only work inside an uptrend.' },
    { label: 'ATR', value: `${pct(SWING.minAtrPct)} – ${pct(SWING.maxAtrPct)}`, why: 'Enough movement to pay, not so much the stop is unmanageable.' },
    { label: 'Off highs', value: `${pct(SWING.minPctOffHigh)} – ${pct(SWING.maxPctOffHigh)}`, why: 'A real pullback, not an extended name and not broken structure.' },
    { label: 'Dist to 21 EMA', value: `within ±${pct(SWING.maxDistToEma21)}`, why: 'Price has to be AT the anchor for the entry to have a stop.' },
    { label: 'Stoch %K', value: `≤ ${SWING.maxStochK}`, why: 'Oversold on the 10/4 smoothed stochastic — the blue-dot condition.' },
    { label: 'Earnings', value: `Excluded within ${SWING.earningsBlackoutDays}d`, why: 'A pullback entry into an earnings print is a coin flip, not a setup.' },
  ],
  shows: `Ranked by score, from the top ${SWING.universeSize} names by dollar volume`,
};

/* ==========================================================================
   10/21 CONSOLIDATION — app/api/swing-candidates/run/route.ts
   (analyzeConsolidation + CONSOL_CONFIG)
   ========================================================================== */
export const CONSOL = {
  minDollarVol: 10_000_000,
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
    'Names coiling tightly on rising 10/21 EMAs inside a confirmed uptrend — the trend-hold entry BEFORE the breakout rather than after it. Tightness is judged in multiples of the stock\'s own ATR, so a high-volatility name is not punished for its normal wiggle.',
  gates: [
    { label: 'Avg $ volume', value: `≥ ${usd(CONSOL.minDollarVol)} (20d)`, why: 'Lower than the swing floor — coiling names are quieter by definition.' },
    { label: 'ADR', value: `≥ ${pct(CONSOL.minAdrPct)}`, why: 'Anti-chop. A 1.5% ADR name can look beautifully coiled while simply being dead.' },
    { label: 'Trend', value: 'Above 50 & 200, 50 > 200', why: 'Consolidation only counts inside an established uptrend.' },
    { label: '21 EMA', value: 'Rising', why: 'A flat or falling anchor is a base, not a continuation setup.' },
    { label: 'Dist to 10 EMA', value: `within ±${pct(CONSOL.maxDistToEma10)}`, why: 'Price hugging the fast average is what "riding the 10/21" means.' },
    { label: 'Dist to 21 EMA', value: `-${pct(CONSOL.maxBelowEma21)} to +${pct(CONSOL.maxAboveEma21)}`, why: 'Small undercuts tolerated; no breakdowns and nothing extended.' },
    { label: '10-day range', value: `≤ ${pct(CONSOL.maxRange10)}`, why: 'Absolute ceiling on how wide the coil can be.' },
    { label: 'Coil ratio', value: `≤ ${CONSOL.maxCoilRatio}× ATR`, why: 'The primary gate. A stock drifts ~3-4× ATR over ten sessions; tighter is a genuine coil.' },
    { label: 'Today', value: `within ±${pct(CONSOL.maxDayChange)}`, why: 'Quiet tape today — an event bar is not consolidation.' },
    { label: 'Off highs', value: `≤ ${pct(CONSOL.maxPctOffHigh)}`, why: 'Basing below the highs, not repairing real damage.' },
    { label: 'RS vs SPY', value: '> 0', why: 'Same leadership requirement as the swing scan.' },
  ],
  shows: `Top ${CONSOL.finalSize} by score · "Coiled" = ≤ ${CONSOL.tightCoilRatio}× ATR`,
};

/* ==========================================================================
   EP 9 MILLION — app/api/ep9m/run/route.ts
   ========================================================================== */
export const EP9M = {
  minVolume: 9_000_000,
  minPrice: 3.00,
  maxPrice: 2000,
  minRvol: 3.0,
  minDollarVol: 20_000_000,
  volProfileDays: 60,
  shortlistSize: 40,
  finalSize: 25,
  registryDays: 90,
} as const;

export const EP9M_META: ScanConfigMeta = {
  title: 'EP 9 Million',
  premise:
    'Fewer than ~2% of US listings trade 9M+ shares in a session. When a stock that normally trades 800K suddenly does 12M, institutions are accumulating and the news has not been priced yet. The volume IS the signal — you research the catalyst after the scan flags it. Deliberately does NOT gate on % change: a non-gapping stock quietly trading 10x its normal volume is the highest-value case this scan exists to find.',
  gates: [
    { label: 'Volume', value: `≥ ${shares(EP9M.minVolume)} shares`, why: 'The namesake threshold. Absolute, not time-weighted, so names appear progressively through the session.' },
    { label: 'RVOL', value: `≥ ${EP9M.minRvol}×`, why: 'THE gate. Without it the scan returns mega caps every day — NVDA trades 9M before 10am.' },
    { label: 'Price', value: `${usd(EP9M.minPrice)} – ${usd(EP9M.maxPrice)}`, why: 'Below $3 the volume is noise.' },
    { label: '$ Volume', value: `≥ ${usd(EP9M.minDollarVol)}`, why: 'It has to be actually tradeable.' },
    { label: 'Type', value: 'Common stock only', why: 'ETFs are excluded — there is no company to re-rate.' },
    { label: 'History', value: `${EP9M.volProfileDays}d volume profile`, why: 'Needed to judge whether today is abnormal FOR THIS NAME.' },
  ],
  shows: `Top ${EP9M.finalSize} by score, from the ${EP9M.shortlistSize} most abnormal · registry keeps ${EP9M.registryDays}d`,
};

/* ==========================================================================
   TOP MOVERS — app/api/scanner/run/route.ts (the mover buckets)
   ========================================================================== */
export const TOPMOVERS_META: ScanConfigMeta = {
  title: 'Top Movers',
  premise:
    'The raw tape, split into buckets. Mega caps track the generals; Gainers and Losers are everything else; ETF tabs cover the leveraged and sector products. Less filtered than the setup tables — this is what moved, not what is worth trading.',
  gates: [
    { label: 'Price', value: `≥ ${usd(SCANNER.minPrice)}`, why: 'Bare minimum to exclude sub-dollar noise.' },
    { label: 'Volume', value: `≥ ${shares(SCANNER.minVolume)}`, why: 'Something has to have traded.' },
    { label: 'Gainers', value: `≥ +${SCANNER.minChange}%`, why: 'The Losers tab has no floor — the worst performers are the point.' },
    { label: 'Market cap', value: `≥ ${usd(SCANNER.minMarketCap)}`, why: 'Excludes shells.' },
  ],
  shows: 'Top 10 per tab',
};

/* ==========================================================================
   Filter semantics — how the on-page pills behave. These trip people up far
   more often than the thresholds do, because a filter that silently means
   something other than what it says looks like a bug.
   ========================================================================== */
export interface FilterNote {
  label: string;
  note: string;
}

export const FILTER_NOTES: FilterNote[] = [
  { label: 'CNF A / B', note: 'A floor, not an exact grade. Picking B shows B and A. Unset shows everything, which is effectively "C and above".' },
  { label: 'STAGE 2', note: 'Matches any Stage 2 sub-stage — 2A, 2B and 2C. Filtering to 2A alone would hide names whose trend is intact but weakening.' },
  { label: 'ADR 5% / 10%', note: '"And above." The scan already floors at 3%, so these tighten rather than replace it.' },
  { label: '$VOL 20M / 50M / 100M', note: '"And above", measured on 20-day AVERAGE dollar volume — not today\'s, which is light by design on a consolidating name.' },
  { label: 'RVOL 5× / 10×', note: '"And above." The EP9M scan already floors at 3×.' },
  { label: '10/21', note: '">10" means above the 10 EMA. "Both" requires above both averages.' },
  { label: 'VWAP', note: 'Above or below the session volume-weighted average price. Not applicable outside market hours.' },
  { label: 'Any active pill', note: 'Click it again to clear back to All.' },
];

/* ==========================================================================
   Column glossary — what each metric means and how to read its colour.
   Keyed by the column label as it appears in the header.
   ========================================================================== */
export interface ColumnNote {
  what: string;
  colour?: string;
}

export const COLUMN_NOTES: Record<string, ColumnNote> = {
  CNF: {
    what: 'Confluence score, 0-100. The unified read — volume, gap, range expansion, relative strength, extension, catalyst quality, scan persistence, market regime and sector heat, all deterministic. Hover the badge for the point-by-point breakdown.',
    colour: 'Green ≥ 70 (A) · amber ≥ 50 (B) · grey below (C).',
  },
  EP: {
    what: 'EP9M score, 0-100. Volume abnormality carries half the weight because it IS the setup; the rest is float turnover, catalyst quality, close strength, money flow and days to cover. Hover for the breakdown.',
    colour: 'Green ≥ 70 (A) · amber ≥ 50 (B) · grey below (C).',
  },
  PRICE: {
    what: 'Last trade. The dot beside it is VWAP position.',
    colour: 'Green dot = above VWAP · red = below.',
  },
  'CHG%': { what: 'Percent change on the session.', colour: 'Green up, red down.' },
  '10/21': {
    what: 'Price versus the 10 and 21 EMAs.',
    colour: 'Green dot = above that average · red = below · grey = insufficient history.',
  },
  VOL: { what: 'Shares traded today.' },
  '$VOL': { what: 'Dollars traded today — volume × VWAP. Catches the low-priced names that look busy in share terms but move no real money.' },
  RVOL: {
    what: 'Relative volume — today versus this stock\'s own 20-day average. Says volume showed up; says nothing about which side got filled.',
    colour: 'Amber ≥ 2× · green ≥ 1.5× · grey below.',
  },
  FLOAT: {
    what: 'Shares available to trade. Small floats move further on the same demand.',
    colour: 'Purple ≤ 20M · green ≤ 50M · grey above.',
  },
  ADR: {
    what: 'Average Daily Range, 20-day, Minervini definition (mean of high/low, minus one). Unlike ATR it has no gap component, so it measures the intraday room a typical session actually offers. The anti-chop metric.',
    colour: 'Purple ≥ 10% · green ≥ 5% · grey ≥ 3%.',
  },
  MF: {
    what: 'Money Flow, 21-day, Chaikin-style. Where each bar closed within its own range, volume-weighted. RVOL says volume showed up; MF says which side got filled. The arrow is the 5-day direction.',
    colour: 'Purple ≥ 70 · green ≥ 60 · lime ≥ 50 · amber ≥ 40 · orange ≥ 30 · red below. Above 50 is accumulation.',
  },
  RS: {
    what: 'Relative strength versus SPY over three months (63 sessions), in percentage points. +12% means it beat the index by 12 points. Compacts to "1k%" past a thousand.',
    colour: 'Purple ≥ +20 · green ≥ +10 · grey 0 to +10 · red negative.',
  },
  STOCH: {
    what: 'Smoothed stochastic %K (10, 4) — the Dr. Wish setting. Low is oversold.',
    colour: 'Purple ≤ 20 · green ≤ 30 · grey above.',
  },
  DTC: {
    what: 'Days to cover — short interest divided by average daily volume. How many sessions of normal trade it would take shorts to exit. More useful than raw short percent because it scales the position against the liquidity to unwind it.',
    colour: 'Purple ≥ 5 · green ≥ 3 · grey ≥ 1.5.',
  },
  TURN: {
    what: 'Float turnover — what share of the tradeable float changed hands today. Above 1.0× the entire float traded: every holder sold and someone else bought, in one session. That is a genuine change in ownership, not a busy day.',
    colour: 'Fuchsia ≥ 1.0× · purple ≥ 0.5× · green ≥ 0.25× · lime ≥ 0.10×.',
  },
  COIL: {
    what: 'The 10-day high-low range, with its width in multiples of the stock\'s own daily ATR beneath. The ratio is what matters — it lets an 8% ATR name and a 1.5% ATR name be judged on the same scale.',
    colour: 'Purple ≤ 2.0× · green ≤ 2.5× · amber ≤ 4.0× · grey above.',
  },
  MCAP: { what: 'Market capitalisation.' },
  STAGE: {
    what: 'Weinstein stage with sub-stage. 2A is a strong advance above the 30 SMA; 2B has slipped off the 30 but holds the 50; 2C is below the 50 — still Stage 2 on paper, but sagging. 2C is the one worth catching: it looks healthy in a scan while the stock quietly rolls over.',
    colour: 'Green 2A/2B · amber 2C and Stage 3 · red Stage 4 · grey Stage 1.',
  },
  SECTOR: { what: 'Sector or, for leveraged ETFs, the underlying and its sector.' },
  STATE: {
    what: 'RMV and RME as one read. RMV is how WIDE price is moving versus its own last 15 bars (0 = tightest, 100 = widest). RME is how FAR it sits from its 21 EMA versus a year of its own extension (-100 to +100). They cannot be averaged — a stock can be tight-and-extended or wild-and-anchored — so the pair reads as a quadrant. COILED: tight, at the anchor. DRIFT: tight but stretched, the one that hides. WASHED: quiet and far below. IMPULSE: expanding and extended. FLUSH: wide and far below. CHOP: violent, going nowhere.',
  },
  CLS: {
    what: 'Where price settled inside the day\'s range. A stock that traded 12M shares and closed on its low moved that volume from buyers to sellers.',
    colour: 'Green closed strong (top 15%) · red closed weak (bottom 25%).',
  },
  STR: {
    what: 'Structure. GC = 50 SMA above 200 SMA. 21↑ = the 21 EMA is rising.',
    colour: 'Green true · red false.',
  },
  STAT: {
    what: 'Readiness. "Ready" means stochastic ≤ 25 and price within 2.5% of the 21 EMA — the trigger could fire imminently. On 10/21 this reads Coiled / Setting Up instead.',
  },
};
// lib/scans/stats.ts — what each scan actually did, in one place.
//
// The exits file says what to do after the trigger; this says what the whole
// table has been worth. Same 5-year replay (Sep 2022 - Sep 2026, EP9M from
// Dec 2021), same simulator, and in every case the numbers describe the ENTRY
// THE CARD SHIPS — not the best entry found, and not a variant the reader
// cannot take. Costs are not modelled, and R is per trade, not compounded.
//
// Measured 11 Sep 2026 from CTT/backtest-data/replay/*_outcomes.jsonl.
//
//   scan            n        2R      best exit        +50% runs   2R win rate
//   scanner     11,551   +0.04   hold 20  +0.15           13.0%        35%
//   swing        2,814   +0.02   hold 20  +0.30            9.8%        35%
//   vcp          5,587   +0.07   the 2R itself            3.2%        44%
//   consol      11,580   -0.09   nothing worked            4.1%        32%
//   ep9m         6,874   +0.02   trail 10 +0.05           14.4%        35%
//   hrs         27,786   +0.06   trail 10 +0.05            7.4%        43%
//
// "+50% runs" is homeRunHeld: reached +50% or +10R BEFORE the stop, so it was
// actually holdable. The path rate — the stock got there whether or not you
// were still in — is roughly double on the momentum tables, which is the gap
// between what a chart looks like afterwards and what the trade paid.

export type StatScan = 'scanner' | 'swing' | 'vcp' | 'consolidation' | 'ep9m' | 'hrs' | 'multibagger';

export interface ScanStat {
  /** One line, for a footer under the table. */
  headline: string;
  /** The full detail, for the hover. */
  detail: string;
}

export const SCAN_STATS: Record<StatScan, ScanStat> = {
  scanner: {
    headline: '5-year test: +0.15R per trade held 20 sessions, 13% ran +50%, 35% hit a 2R target.',
    detail:
      'Stocks in Play + Daily Setups, 11,551 next-open entries Sep 2022 - Sep 2026.\n' +
      'Fixed 2R +0.04R · trail 21 EMA +0.14R · hold 20 sessions +0.15R.\n' +
      '13.0% reached +50% before the stop; 28.8% got there at some point whether or not you were still in.\n' +
      '35% of trades closed positive on the 2R version. Costs not modelled.',
  },
  swing: {
    headline: '5-year test: +0.30R per trade held 20 sessions — the best exit measured on any table here.',
    detail:
      'Swing Candidates, 2,814 next-open entries Sep 2022 - Sep 2026.\n' +
      'Fixed 2R +0.02R · trail 21 EMA +0.16R · hold 20 sessions +0.30R.\n' +
      '9.8% reached +50% before the stop (27.3% at some point). 35% closed positive on the 2R version.\n' +
      'The Stage 1 rows are the only bucket that lost (-0.19R) — see the row shading.',
  },
  vcp: {
    headline: '5-year test: +0.07R per trade taking the 2R, and the 2R is the right exit here. Only 3% ran +50%.',
    detail:
      'VCP, 5,587 pivot entries Sep 2022 - Sep 2026.\n' +
      'Fixed 2R +0.07R · trail 21 EMA -0.03R · hold 20 sessions +0.01R — the one table where the target wins.\n' +
      '3.2% reached +50% before the stop, and every one of those came from the wider bases (green rows: 10.7%; red: zero in five years).\n' +
      '44% of trades closed positive. The scan also swung with the tape — negative through 2022-24, positive since — so treat the average as regime-dependent.',
  },
  consolidation: {
    headline: '5-year test: -0.09R per trade. No exit produced an edge — this is a watchlist, not a trade signal.',
    detail:
      '10/21 coils, 11,580 pivot entries Sep 2022 - Sep 2026.\n' +
      'Fixed 2R -0.09R · trail 21 EMA -0.07R · hold 20 sessions -0.06R. Nothing tested was positive.\n' +
      '4.1% reached +50% before the stop; 32% of trades closed positive.\n' +
      'One bucket did pay: a coil 3x+ ATR with the stochastic above 75 (+0.13R, ~7% of rows) — the green shading.',
  },
  ep9m: {
    headline: '5-year test: +0.02R per trade on the pullback entry, 14% ran +50%. Thin on average, fat in the tail.',
    detail:
      'EP9M, 6,874 pullback entries (EP-day midpoint, stop at that day\'s low) Dec 2021 - Sep 2026.\n' +
      'Fixed 2R +0.02R · trail 10 EMA +0.05R · trail 21 EMA +0.03R · hold 20 sessions -0.00R.\n' +
      'The retired day-high entry, for comparison: -0.13R and -0.19R.\n' +
      '14.4% reached +50% before the stop — the highest of any table here, and where the return lives. 35% closed positive.',
  },
  hrs: {
    headline: '5-year test: +0.06R per trade, 7% ran +50%. Reads as a watchlist of quiet leaders.',
    detail:
      'Hidden Relative Strength, 27,786 next-open entries Sep 2022 - Sep 2026.\n' +
      'Fixed 2R +0.06R · trail 10 EMA +0.05R · trail 21 EMA +0.03R — flat whichever way you exit.\n' +
      '7.4% reached +50% before the stop; 43% of trades closed positive.\n' +
      'The $5-15 band is the one that separated (+0.14R, 10% ran +50%) — the green shading.',
  },
  multibagger: {
    headline: '5-year test: measured in months, not R — 17.8% of the green rows doubled inside a year against a 5.8% base rate.',
    detail:
      '100-Bagger, 1,425 picks across 57 month ends, scored as excess return over the SAME month\'s universe median.\n' +
      'Revenue growth 10-25% with a cap under $3B: +13.0% excess at 12 months, 62% beat the median, 17.8% doubled in 12 months and 28.9% in 24.\n' +
      'Revenue growth 50%+: -12.4% excess, and only 3.6% doubled — below the 5.8% universe base rate.\n' +
      'This screen is a holding period, not a trade: there is no stop in the measurement.',
  },
};

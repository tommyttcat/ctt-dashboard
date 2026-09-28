// lib/scans/stats.ts — what each scan actually did, in one place.
//
// The exits file says what to do after the trigger; this says what the whole
// table has been worth. Same 5-year replay (Sep 2022 - Sep 2026, EP9M from
// Dec 2021), same simulator, and in every case the numbers describe the ENTRY
// THE CARD SHIPS — not the best entry found, and not a variant the reader
// cannot take. Costs are not modelled, and R is per trade, not compounded.
//
// Measured 11 Sep 2026 from CTT/backtest-data/replay/*_outcomes.jsonl.
// trackPct / trackWin (28 Sep 2026): the open1 entry (next open, as the Track
// page buys) on the fixedTarget exit, as % of the entry price — the reader
// asked for results in percent, not R. In % several scans that read positive
// in R are flat or negative: R flatters tight-stop trades.
//
//   (11 Sep 2026, in R — superseded 28 Sep 2026 by the % table below)
//   scan            n        2R      best exit        +50% runs   2R win rate
//   scanner     11,551   +0.04   hold 20  +0.15           13.0%        35%
//   swing        2,814   +0.02   hold 20  +0.30            9.8%        35%
//   vcp          5,587   +0.07   the 2R itself            3.2%        44%
//   consol      11,580   -0.09   nothing worked            4.1%        32%
//   ep9m         6,874   +0.02   trail 10 +0.05           14.4%        35%
//   hrs         27,786   +0.06   trail 10 +0.05            7.4%        43%
//
// IN PERCENT (28 Sep 2026 — the reader asked for %, and it changes the story:
// R flatters tight-stop trades). Same trades, % of the entry price, from the
// replay outcomes' own `pct` (backtest-data/replay/evidence_pct.json); 10/21
// coils re-simulated and U&R from mau-r.ts rerun with % added:
//   scan        target   trail21   hold20    best
//   scanner      -0.08     -0.25    -0.01    none — flat
//   swing        +0.05     +0.29    +0.44    hold 20
//   vcp          +1.21     +0.03    +0.48    the target
//   coil         -0.06     +0.04     0.00    none (U&R hold 20 +0.22)
//   ep9m pb      -0.63     -1.35    -1.81    none — every exit lost
//   hrs          +0.68     +0.09    +0.37    target, but all since mid-2025
// The headline and detail strings quote these. `bt` keeps the original R
// figures for reference; the Track page reads bt.trackPct.
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
  /** The same figures as numbers, so the live record can be shown beside them. */
  bt: {
    n: number; fixedAvgR: number | null; hold20AvgR: number | null; hrRate: number | null; winRate: number | null;
    /** The Track page's own method — every pick bought at the next open, stop or 2x-the-stop target —
     *  as % of the entry price per trade, and % of trades that made money (28 Sep 2026). */
    trackPct: number | null; trackWin: number | null;
  };
}

export const SCAN_STATS: Record<StatScan, ScanStat> = {
  scanner: {
    headline: '5-year test, bought at the next open: flat — −0.08% a trade on the fixed target, −0.01% held 20 sessions. The entry that tested positive is the next day\'s breakout (Best Setups).',
    detail:
      'Stocks in Play + Daily Setups, 11,471 next-open entries Sep 2022 - Sep 2026, in % of the entry price.\n' +
      'Fixed target (twice the stop distance) −0.08% · trail 21 EMA −0.25% · hold 20 sessions −0.01% — flat whichever way you exit.\n' +
      'By period (Sep 2022 - mid 2025 / since): held 20 sessions −0.65% / +1.39%.\n' +
      '13.0% reached +50% before the stop; 35% of trades closed positive on the fixed target.\n' +
      'The one entry that tested clearly positive is the next day\'s break of the 9:30-10:00 high on volume (the Best Setups card): 41% winners, +3.9% a trade. Costs not modelled.',
    bt: { n: 11551, fixedAvgR: 0.04, hold20AvgR: 0.15, hrRate: 13.0, winRate: 35, trackPct: -0.08, trackWin: 35 }
  },
  swing: {
    headline: '5-year test: +0.44% a trade held 20 sessions — the best exit measured on any table here; +0.29% trailing the 21 EMA.',
    detail:
      'Swing Candidates, 2,814 next-open entries Sep 2022 - Sep 2026, in % of the entry price.\n' +
      'Fixed target +0.05% · trail 21 EMA +0.29% · hold 20 sessions +0.44%.\n' +
      'By period (Sep 2022 - mid 2025 / since): held 20 sessions +0.35% / +0.67%; trailing the 21 EMA +0.43% / −0.06%.\n' +
      '9.8% reached +50% before the stop. The Stage 1 rows were the bucket that lost (−0.48% held 20 sessions) — see the row shading.',
    bt: { n: 2814, fixedAvgR: 0.02, hold20AvgR: 0.30, hrRate: 9.8, winRate: 35, trackPct: 0.05, trackWin: 35 }
  },
  vcp: {
    headline: '5-year test: +1.21% a trade taking the fixed target — the right exit here. Only 3% ran +50%.',
    detail:
      'VCP, 5,573 pivot entries Sep 2022 - Sep 2026, in % of the entry price.\n' +
      'Fixed target +1.21% · trail 21 EMA +0.03% · hold 20 sessions +0.48% — the one table where the target wins.\n' +
      'By period the target made +0.12% then +2.86%: it swung with the tape, so treat the average as regime-dependent.\n' +
      '3.2% reached +50% before the stop, all from the wider bases (green rows: 10.7%; red: zero in five years). 44% of trades closed positive.',
    bt: { n: 5587, fixedAvgR: 0.07, hold20AvgR: 0.01, hrRate: 3.2, winRate: 44, trackPct: 1.62, trackWin: 45 }
  },
  consolidation: {
    /* Rewritten 27 Sep 2026 when the card stopped buying the range-high break
       and started buying at the averages, and added undercut & rally. Numbers
       from scripts/backtest/stop-tests.ts (coil, next open, card stop) and
       mau-r.ts (U&R inside this scan's own filters). */
    headline: '5-year test: coils bought at their averages were flat (0.00% a trade held 20 sessions); undercut & rally +0.22%, +0.81% since mid-2025. Both beat the old breakout plan (−0.42%).',
    detail:
      '10/21 now buys at the price, not on a break of the 10-day high (which sat 3-7% above it). Figures in % of the entry price.\n' +
      'Coils, 4,532 next-open entries Sep 2022 - Sep 2026: hold 20 sessions 0.00%, trail 21 EMA +0.04%, fixed target −0.06%.\n' +
      '  by period (Sep 2022 - mid 2025 / since): hold 20 −0.13% / +0.26%, trail 21 −0.15% / +0.45%.\n' +
      'Undercut & rally (U&R), 14,757 signals in this scan\'s filters: hold 20 −0.23% / +0.81%, trail 21 −0.27% / +0.64%.\n' +
      'The old breakout plan: hold 20 −0.42% (−0.68% / +0.13%). Treat 10/21 as a watchlist that has paid lately, not a proven signal.',
    bt: { n: 4471, fixedAvgR: -0.09, hold20AvgR: -0.03, hrRate: 7.7, winRate: 31, trackPct: -0.08, trackWin: 31 }
  },
  ep9m: {
    headline: '5-year test: the pullback entry lost on every exit — −0.63% a trade on the fixed target. 14% ran +50%; the return lives in that tail, not the average.',
    detail:
      'EP9M, 6,874 pullback entries (EP-day midpoint, stop at that day\'s low) Dec 2021 - Sep 2026, in % of the entry price.\n' +
      'Fixed target −0.63% · trail 10 EMA −0.98% · trail 21 EMA −1.35% · hold 20 sessions −1.81%.\n' +
      'By period the fixed target lost −0.89% then −0.05%. The retired day-high entry was worse: −2.33% on the target, −3.96% trailing the 21 EMA.\n' +
      '14.4% reached +50% before the stop — the highest of any table here. 35% of trades closed positive.',
    bt: { n: 6874, fixedAvgR: 0.02, hold20AvgR: -0.00, hrRate: 14.4, winRate: 35, trackPct: -0.48, trackWin: 34 }
  },
  hrs: {
    headline: '5-year test: +0.68% a trade on the fixed target, all of it since mid-2025 (−0.57% before, +3.76% since). Reads as a watchlist of quiet leaders.',
    detail:
      'Hidden Relative Strength, 27,553 next-open entries Sep 2022 - Sep 2026, in % of the entry price.\n' +
      'Fixed target +0.68% · trail 10 EMA +0.40% · trail 21 EMA +0.09% · hold 20 sessions +0.37%.\n' +
      'By period the fixed target made −0.57% then +3.76% — a regime effect, not a steady edge.\n' +
      '7.4% reached +50% before the stop; 43% of trades closed positive. The $5-15 band did best (+1.84% on the fixed target, again mostly since mid-2025) — the green shading.',
    bt: { n: 27786, fixedAvgR: 0.06, hold20AvgR: 0.05, hrRate: 7.4, winRate: 43, trackPct: 0.68, trackWin: 43 }
  },
  multibagger: {
    headline: '5-year test, measured over months: 17.8% of the green rows doubled inside a year against a 5.8% base rate.',
    detail:
      '100-Bagger, 1,425 picks across 57 month ends, scored as excess return over the SAME month\'s universe median.\n' +
      'Revenue growth 10-25% with a cap under $3B: +13.0% excess at 12 months, 62% beat the median, 17.8% doubled in 12 months and 28.9% in 24.\n' +
      'Revenue growth 50%+: -12.4% excess, and only 3.6% doubled — below the 5.8% universe base rate.\n' +
      'This screen is a holding period, not a trade: there is no stop in the measurement.',
    bt: { n: 1425, fixedAvgR: null, hold20AvgR: null, hrRate: null, winRate: null, trackPct: null, trackWin: null }
  },
};

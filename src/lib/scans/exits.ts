// lib/scans/exits.ts — what to do AFTER the trigger, measured per scan.
//
// Every table shows the same plan shape: trigger, stop, fixed 2R target. The
// 5-year replays say that shape is right on some tables and wrong on others,
// so the guidance is per scan rather than one house rule. All figures are
// average R per trade over Sep 2022 - Sep 2026, entries and exits defined in
// scripts/backtest/simulate.ts, and every claim below held in both halves of
// the period unless it says otherwise. Costs are not modelled.
//
//   scanner (SIP + Daily)   target +0.04  trail21 +0.14  hold20 +0.15
//   swing                   target +0.03  trail21 +0.16  hold20 +0.30
//   vcp                     target +0.12  trail21 -0.01  hold20 +0.02
//   consolidation (10/21)   target -0.10  trail21 -0.08  (nothing worked)
//   ep9m (day-high entry)   target -0.13  trail21 -0.19  <- retired 11 Sep 2026
//   ep9m (pullback entry)   target +0.02  trail10 +0.05  <- what the card ships
//   hrs                     target +0.06  trail10 +0.05  (flat either way)
//
// The pattern: on momentum tables the target caps the winners that pay for
// everything else, and on base-breakout tables it does not — a VCP that works
// tends to reach 2R quickly and give it back, so taking the 2R is correct.

export type ScanKey = 'scanner' | 'swing' | 'vcp' | 'consolidation' | 'ep9m' | 'hrs';

export const EXIT_GUIDANCE: Record<ScanKey, string> = {
  scanner:
    'Exit: trailing beats the target here. Over 5 years the fixed 2R averaged +0.04R per trade while trailing the 21 EMA averaged +0.14R and simply holding 20 sessions +0.15R — the target keeps cutting the runs that pay for the losers.',
  swing:
    'Exit: hold it. The fixed 2R averaged +0.03R per trade over 5 years, trailing the 21 EMA +0.16R, and holding 20 sessions +0.30R — the best exit measured on any table here.',
  vcp:
    'Exit: take the 2R. This is the one table where the fixed target wins — +0.12R per trade against -0.01R trailing the 21 EMA. A base breakout that works tends to reach 2R fast and hand it back.',
  consolidation:
    'Exit: no exit produced an edge on this table (2R -0.10R, trail 21 EMA -0.08R). The coil is worth watching; the breakout trade has not paid over 5 years.',
  ep9m:
    'Exit: trail the 10 EMA, and keep the size small. This table now triggers on the pullback to the EP-day midpoint rather than the break of its high, because the high was the losing half of the trade (-0.13R with a 2R target, -0.19R trailing the 21 EMA). On the pullback entry, over 6,874 fills: trailing the 10 EMA +0.05R, the 2R target +0.02R, trailing the 21 EMA +0.03R, holding 20 sessions -0.00R. Positive in both halves but thin — the edge here is the 14% that run +50%, not the average.',
  hrs:
    'Exit: flat either way (2R +0.06R, trail 10 EMA +0.05R). This table reads as a watchlist of quiet leaders rather than a trade signal.',
};

/* Which exit the card should PRESENT as the plan, from the table above. The
   text in EXIT_GUIDANCE explains it; this is the same decision in a form the
   plan renderer can act on, so the two cannot drift.

     trail   the fixed target is the worst exit measured — trail instead
     target  the fixed target is the best exit measured — take it
     none    nothing tested was positive on this table */
export const EXIT_STYLE: Record<ScanKey, 'trail' | 'target' | 'none'> = {
  scanner: 'trail',        // 2R +0.04R vs trail 21 EMA +0.14R, hold 20 +0.15R
  swing: 'trail',          // 2R +0.02R vs trail 21 EMA +0.16R, hold 20 +0.30R
  vcp: 'target',           // 2R +0.12R vs trail 21 EMA -0.01R — the one table where it wins
  consolidation: 'none',   // nothing tested was positive
  ep9m: 'trail',           // 2R +0.02R vs trail 10 EMA +0.05R
  hrs: 'none',             // flat either way
};

/** The plan footnote for a table: how the levels are built, then what the backtest says to do with them. */
export const planFootnote = (scan: ScanKey, levelsNote = 'Stop is the wider of 1.25× ADR or 2.5%. Target is a fixed 2R.'): string =>
  `${levelsNote}\n\n${EXIT_GUIDANCE[scan]}`;

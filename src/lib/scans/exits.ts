// lib/scans/exits.ts — what to do AFTER the trigger, measured per scan.
//
// Every table shows the same plan shape: trigger, stop, fixed 2R target. The
// 5-year replays say that shape is right on some tables and wrong on others,
// so the guidance is per scan rather than one house rule. The guidance text
// quotes % of the entry price per trade (28 Sep 2026; see lib/scans/stats.ts
// for the % table). The R table below is the original 11 Sep measurement,
// kept for reference. Sep 2022 - Sep 2026, entries and exits defined in
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
    'Exit: no exit produced an edge. In % of the entry price over 5 years, the fixed target averaged −0.08% a trade, trailing the 21 EMA −0.25% and holding 20 sessions −0.01%. The entry that tested positive is the next day\'s volume breakout above the 9:30–10:00 high (the Best Setups card), not these rows.',
  swing:
    'Exit: hold it, or trail the 21 EMA. Held 20 sessions the trades averaged +0.44% over 5 years, trailing the 21 EMA +0.29% and the fixed target +0.05% — holding is the best exit measured on any table here.',
  vcp:
    'Exit: take the target (twice the stop distance). This is the one table where the fixed target wins — +1.21% a trade against +0.03% trailing the 21 EMA. A base breakout that works tends to reach the target fast and hand it back.',
  consolidation:
    'Exit: no exit produced an edge over the full 5 years — bought at the averages, coils were flat (hold 20 sessions 0.00%, trail 21 EMA +0.04%, fixed target −0.06%). Since mid-2025 trailing the 21 EMA has paid (+0.45% coils, +0.64% undercut & rally); skip the fixed target.',
  ep9m:
    'Exit: no exit produced an edge — every exit lost money. On the pullback entry, over 6,874 fills: the fixed target −0.63% a trade, trailing the 10 EMA −0.98%, the 21 EMA −1.35%, holding 20 sessions −1.81%. The day-high entry it replaced was worse (−2.33% on the target). The only edge here is the 14% that run +50%; keep the size small.',
  hrs:
    'Exit: no exit held up in both periods — the fixed target made +0.68% a trade, all of it since mid-2025 (−0.57% before). This table reads as a watchlist of quiet leaders rather than a trade signal.',
};

/* Which exit the card should PRESENT as the plan, from the table above. The
   text in EXIT_GUIDANCE explains it; this is the same decision in a form the
   plan renderer can act on, so the two cannot drift. Re-decided in % on
   28 Sep 2026 (in R, scanner and EP9M read as "trail"; in % no exit made money).
     trail   the fixed target is the worst exit measured — trail or hold instead
     target  the fixed target is the best exit measured — take it
     none    no exit made money in both periods on this table */
export const EXIT_STYLE: Record<ScanKey, 'trail' | 'target' | 'none'> = {
  scanner: 'none',         // target -0.08% · trail 21 -0.25% · hold 20 -0.01%
  swing: 'trail',          // target +0.05% · trail 21 +0.29% · hold 20 +0.44%
  vcp: 'target',           // target +1.21% · trail 21 +0.03% — the one table where it wins
  consolidation: 'none',   // coils flat: hold 20 0.00%, trail 21 +0.04%
  ep9m: 'none',            // every exit lost: target -0.63% … hold 20 -1.81%
  hrs: 'none',             // target +0.68%, all since mid-2025
};

/** The plan footnote for a table: how the levels are built, then what the backtest says to do with them. */
export const planFootnote = (scan: ScanKey, levelsNote = 'Stop is the wider of 1.25× ADR or 2.5%. Target is twice the stop distance above the entry.'): string =>
  `${levelsNote}\n\n${EXIT_GUIDANCE[scan]}`;

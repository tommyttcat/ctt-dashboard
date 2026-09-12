// lib/scans/edge.ts — the row tint, in one place.
//
// Three states from the 5-year backtest of the momentum tables (Stocks in Play
// + Daily Setups, Sep 2022 - Sep 2026, 12,992 rows, next-open entry trailing
// the 21 EMA). Only traits that held in BOTH halves of the period are used:
//
//   red     ADR above 9% (-0.27R) or price $5-10 (-0.15R). Both lost money in
//           the first two-thirds AND the last third.
//   green   clears those and closed in the top 10% of the day's range
//           (+0.26R — the strongest consistent trait on these tables).
//   yellow  clears them but closed lower in the range.
//
// Null when ADR or the day's range is missing: no tint beats a guessed one.
//
// SCOPE WARNING. These thresholds are the MOMENTUM tables' and do not
// generalise. On Hidden Relative Strength the $5-15 band was the BEST bucket
// (+0.14R) where $5-10 is the worst here. Every other scan therefore gets its
// own function further down this file, measured on its own replay and on the
// entry that card actually ships. Measure a scan before painting its rows.
//
// One function per scan, all returning the same three states so one filter
// component can drive every card:
//   edgeTier          Stocks in Play + Daily Setups (and the Confluence
//                     report, which is built from them)
//   ep9mTier          EP9M, on the pullback entry it ships since 11 Sep 2026
//   vcpTier           VCP
//   swingTier         Swing Candidates
//   consolidationTier 10/21
//   multibaggerTier   100-Bagger
//   hrsTier           Hidden Relative Strength

export type EdgeTier = 'green' | 'yellow' | 'red';

export interface EdgeInput {
  adrPct?: number | null;
  price?: number | null;
  /** Where the close sat in the day's range, 0 = low, 1 = high. */
  closeStrength?: number | null;
  /** Supplied instead of closeStrength when the row carries raw levels. */
  dayHigh?: number | null;
  dayLow?: number | null;
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export function edgeTier(row: EdgeInput | null | undefined): EdgeTier | null {
  if (!row) return null;
  const adr = num(row.adrPct);
  const price = num(row.price);
  if (adr == null || price == null) return null;
  if (adr > 9) return 'red';
  if (price >= 5 && price < 10) return 'red';

  let cs = num(row.closeStrength);
  if (cs == null) {
    const hi = num(row.dayHigh);
    const lo = num(row.dayLow);
    if (hi != null && lo != null && hi > lo) cs = (price - lo) / (hi - lo);
  }
  if (cs == null) return 'yellow';
  return cs >= 0.9 ? 'green' : 'yellow';
}

export const EDGE_TINT: Record<EdgeTier, string> = {
  green: 'bg-emerald-500/[0.11]',
  yellow: 'bg-amber-400/[0.08]',
  red: 'bg-rose-500/[0.11]',
};

export const EDGE_FILTER_TIP: Record<EdgeTier, string> = {
  green: "cleared both losing filters and closed in the top 10% of the day's range (+0.26R in the 5-year test)",
  yellow: 'cleared the filters but closed lower in the range',
  red: 'ADR above 9% (-0.27R) or price $5-10 (-0.15R) — both lost in every half of the test',
};

/* ---- 100-Bagger tint -----------------------------------------------------
   Its own rules, because the momentum traits above mean nothing to a
   multi-year screen. From the 5-year replay (1,425 picks across 57 month
   ends, measured as excess over the SAME month's universe median):

     revenue growth 50%+        -12.4% excess at 12mo, 28% beat rate, and only
                                3.6% doubled inside a year — BELOW the 5.8%
                                universe base rate. Triple-digit growth is
                                usually a one-off comp, and it is priced.
     growth 10-25% & cap <$3B   +13.0% excess (IS +8.4 / OOS +76.4), 62% beat,
                                17.8% doubled in 12mo and 28.9% in 24mo,
                                against 5.8% / 12.5% for the universe.

   So the letter the screen is named for actually works — but only in the
   boring growth band, and only at the small end. */
export function multibaggerTier(row: { revGrowthPct?: number | null; marketCap?: number | null } | null | undefined): EdgeTier | null {
  if (!row) return null;
  const g = num(row.revGrowthPct);
  const cap = num(row.marketCap);
  if (g == null) return null;
  if (g >= 50) return 'red';
  if (g >= 10 && g < 25 && cap != null && cap < 3e9) return 'green';
  return 'yellow';
}

export const MULTIBAGGER_TIP: Record<EdgeTier, string> = {
  green: 'revenue growth 10-25% and cap under $3B — +13% excess over its universe, 18% doubled within a year (base rate 5.8%)',
  yellow: 'passes the screen but outside the band that outperformed',
  red: 'revenue growth 50%+ — -12% excess, only 3.6% doubled within a year, below the universe base rate',
};

/* ---- Swing Candidates tint -----------------------------------------------
   Its own rules again, and one of them inverts the momentum rule: on this
   scan a WEAK close is better, because the setup is a pullback into support
   rather than a breakout (close in the bottom quarter: +0.36R against +0.08R
   for a close in the top 10%). So close strength is left out entirely here.

   From the 5-year replay (3,224 rows, Sep 2022 - Sep 2026, next-open entry
   trailing the 21 EMA), both halves agreeing:

     RS 95+                  +0.94R (IS +0.95 / OOS +0.89), 16.3% ran +50%
     Money Flow 65+          +0.53R (IS +0.59 / OOS +0.32), 13.8%
     either, not Stage 1     +0.58R (IS +0.61 / OOS +0.49), 13.9%
     neither                 +0.09R
     Stage 1                 -0.19R (IS -0.18 / OOS -0.24), 5.5%

   A swing setup in a Stage 1 base is a name with nothing behind it yet; the
   scan's own structure gates let those through and they are the only bucket
   that loses. */
export function swingTier(row: { rsRating?: number | null; mf?: number | null; stage?: string | null } | null | undefined): EdgeTier | null {
  if (!row) return null;
  const stage = (row.stage || '').trim();
  if (stage.startsWith('Stage 1')) return 'red';
  const rs = num(row.rsRating);
  const mf = num(row.mf);
  if (rs == null && mf == null) return null;
  if ((rs != null && rs >= 95) || (mf != null && mf >= 65)) return 'green';
  return 'yellow';
}

export const SWING_TIP: Record<EdgeTier, string> = {
  green: 'RS 95+ or Money Flow 65+ — +0.58R per trade in the 5-year test, 14% ran +50%',
  yellow: 'passes the scan but neither strength marker — +0.09R',
  red: 'Stage 1 base — the only bucket that lost (-0.19R, both halves), 5.5% ran +50%',
};

/* ---- 10/21 Consolidation tint --------------------------------------------
   Same lesson as VCP, and the same inversion: the scan's premise is tightness
   and tightness is what lost. Over 7,472 distinct coils (Sep 2022 - Sep 2026,
   pivot entry, 2R target), both halves agreeing:

     whole table                    -0.10R   <- as shipped before 11 Sep 2026
     coil 2-3x ATR (the tight end)  -0.15R
     coil 3x+ ATR                   +0.07R
     coil 3x+ AND stochastic 75+    +0.13R   (n=361, breaks out 89% of the time)
     off-high 11-15%                -0.26R

   Green is that last row and nothing else — roughly 7% of the table. Red is
   the tight-coil majority and the names repairing from more than 11% off
   their high, which is where the losses concentrated. */
export function consolidationTier(row: { coilRatio?: number | null; stochK?: number | null; pctOffHigh?: number | null } | null | undefined): EdgeTier | null {
  if (!row) return null;
  const coil = num(row.coilRatio);
  const stoch = num(row.stochK);
  const off = num(row.pctOffHigh);
  if (coil == null) return null;
  if (off != null && off > 11) return 'red';
  if (coil < 2.5) return 'red';
  if (coil >= 3 && stoch != null && stoch >= 75) return 'green';
  return 'yellow';
}

export const CONSOLIDATION_TIP: Record<EdgeTier, string> = {
  green: 'coil 3x+ ATR with the stochastic above 75 — price pressed against the top of its range. +0.13R in both halves, breaks out 89% of the time.',
  yellow: 'inside the coil range but not pressed against its high — around breakeven at best',
  red: 'tight coil (under 2.5x ATR) or more than 11% off the high — the buckets that lost (-0.15R and -0.26R)',
};

/* ---- EP9M tint -----------------------------------------------------------
   Measured on the entry the card actually ships since 11 Sep 2026 — the
   pullback to the EP-day midpoint, trailing the 21 EMA — over 10,559 filled
   flags, Sep 2022 - Sep 2026. The old day-high entry is not what these
   numbers describe, and the tint would be different if it were.

   The traits that lost in BOTH halves, and they are the same names three ways
   over (a tiny float trading many times over in a wide range):

       ADR above 9%            -0.18R   (IS -0.24 / OOS -0.10)
       float turnover 1x+      -0.29R   (IS -0.39 / OOS -0.17)
       market cap under $300M  -0.18R   (IS -0.26 / OOS -0.10)

   What paid, in both halves:

       money flow 65+          +0.16R   (IS +0.19 / OOS +0.13)
       price $50+              +0.26R   (IS +0.27 / OOS +0.25)

   The composite below, on the same 10,559 fills:

       green  n=2,873  +0.22R  (IS +0.28 / OOS +0.14)   9.0% ran +50%
       yellow n=3,639  +0.07R  (IS +0.05 / OOS +0.10)   9.2%
       red    n=4,047  -0.14R  (IS -0.18 / OOS -0.09)  19.1%

   Read the last column before dismissing red: it has by far the HIGHEST rate
   of +50% runs and the worst average. That is the whole character of this
   scan — the lottery-ticket bucket. Red does not mean "will not move", it
   means "pays for the ticket less often than it costs". */
export function ep9mTier(row: {
  adrPct?: number | null; floatTurnover?: number | null; mktCap?: number | null;
  mf?: number | null; price?: number | null;
} | null | undefined): EdgeTier | null {
  if (!row) return null;
  const adr = num(row.adrPct);
  const price = num(row.price);
  if (adr == null || price == null) return null;
  const ft = num(row.floatTurnover);
  const cap = num(row.mktCap);
  if (adr > 9) return 'red';
  if (ft != null && ft >= 1) return 'red';
  if (cap != null && cap < 3e8) return 'red';
  const mf = num(row.mf);
  if ((mf != null && mf >= 65) || price >= 50) return 'green';
  return 'yellow';
}

export const EP9M_TIP: Record<EdgeTier, string> = {
  green: 'clears the three losing traits and has money flow 65+ or a $50+ price — +0.22R per trade on the pullback entry, both halves agreeing',
  yellow: 'clears them but neither strength marker — +0.07R',
  red: 'ADR above 9%, float turnover 1x+, or cap under $300M — -0.14R. These also run +50% most often (19%): the lottery bucket, so size it like one.',
};

/* ---- VCP tint ------------------------------------------------------------
   5,587 pivot entries, Sep 2022 - Sep 2026. Read this one carefully, because
   the honest finding is not the one a fixed-target table wants.

   The whole scan swung with the tape — the first two-thirds averaged -0.04R
   and the last third +0.21R — so ABSOLUTE numbers per bucket say more about
   which half they fell in than about the trait. What is stable across both
   halves is the TAIL: which bases are capable of a +50% run at all.

       atr 5%+, final contraction 10%+ ....  green
       green   n=1,292  10.7% ran +50%  (IS 6.2% / OOS 13.4%)  trail21 +0.13
       yellow  n=2,494   1.7%           (IS 0.6% / OOS 2.7%)   trail21 -0.04
       red     n=1,801   0.0%           (IS 0.0% / OOS 0.0%)   trail21 -0.14

   Zero home runs in five years is the red bucket's whole story: a base too
   quiet to travel with a stop too tight to survive noise cannot produce the
   move the pattern is drawn for. Note green's fixed-2R average was NEGATIVE
   in the weak first half (-0.25R) while its trailing average was flat — the
   edge lives in the tail, which is an argument for trailing, not for the
   target. Tightness, the thing the pattern is named for, is what loses. */
export function vcpTier(row: { atrPct?: number | null; stopPct?: number | null; finalDepthPct?: number | null } | null | undefined): EdgeTier | null {
  if (!row) return null;
  const atr = num(row.atrPct);
  if (atr == null) return null;
  const stop = num(row.stopPct);
  const depth = num(row.finalDepthPct);
  const d = depth == null ? null : Math.abs(depth);
  if (atr < 2.5 || (stop != null && stop < 5)) return 'red';
  if (atr >= 3.5 && d != null && d >= 10) return 'green';
  return 'yellow';
}

export const VCP_TIP: Record<EdgeTier, string> = {
  green: 'ATR 3.5%+ with a final contraction of 10%+ — the only bucket that produces big runs (10.7% ran +50%, and it held at 6% and 13% across both halves)',
  yellow: 'passes the pattern but without the room to travel — 1.7% ran +50%',
  red: 'ATR under 2.5% or a stop under 5% — ZERO +50% runs in five years and the worst trailing outcome (-0.14R). Too quiet to pay for its own spread.',
};

/* ---- Hidden Relative Strength tint ---------------------------------------
   This card was deliberately untinted until 11 Sep 2026 because the momentum
   rules do not apply to it. They still do not — these are its own, from its
   own replay (27,786 fills, open entry trailing the 10 EMA):

       price $5-15   +0.14R, 10.0% ran +50%   (IS +0.10 / OOS +0.21)
       everything else +0.01R, 6.3%           (IS -0.00 / OOS +0.04)

   Exactly the band that LOSES on the momentum tables (-0.15R there). Hidden
   strength and hidden weakness live in the same price band, which is why the
   rules are kept apart. There is no red here: nothing on this scan lost
   consistently, which is also why it reads as a watchlist rather than a
   trade signal. */
export function hrsTier(row: { price?: number | null } | null | undefined): EdgeTier | null {
  if (!row) return null;
  const px = num(row.price);
  if (px == null) return null;
  return px >= 5 && px <= 15 ? 'green' : 'yellow';
}

export const HRS_TIP: Record<EdgeTier, string> = {
  green: 'price $5-15 — the band that paid on this scan (+0.14R, 10% ran +50%, in both halves). The same band loses on the momentum tables.',
  yellow: 'outside that band — +0.01R, essentially flat',
  red: 'unused on this scan: no bucket lost consistently',
};

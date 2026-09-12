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
// (+0.15R) where $5-10 is the worst here, which is why that card is
// deliberately untinted. Measure a scan before painting its rows.

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

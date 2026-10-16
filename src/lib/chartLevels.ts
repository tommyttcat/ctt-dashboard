// lib/chartLevels.ts — key levels for the ticker pop-up chart, set by whichever card knows them.
//
// 16 Oct 2026: the Oversold Bounce card's key levels go on the chart instead of a column (the
// owner: a column skews the card and does not fit a phone). The pop-up is rendered once at the
// top of the page, outside every card, so a React context inside a card cannot reach it; this
// module-level map can. Kept out of components/analyst/MiniChart so importing it does not pull
// the lazily loaded chart library into the dashboard bundle.

export interface ChartLevel { price: number; type: 'S' | 'R' }
export const chartLevelsGlobal = new Map<string, ChartLevel[]>();

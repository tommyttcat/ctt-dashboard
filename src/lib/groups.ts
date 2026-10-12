// lib/groups.ts — industry-group strength for the swing checklist (12 Oct 2026).
//
// Groups are 2-digit SIC codes (lib/data/sic2.json, from Polygon's ticker details as stored
// for the backtests; a name listed since then is unclassified). Each night the System job
// passes every scored name's 3-month return; a group with 5+ names gets the average, groups
// are ranked, and each name gets its group's tercile: 0 = top third, 1 = middle, 2 = bottom.

import SIC2 from './data/sic2.json';

const sic2 = SIC2 as Record<string, string>;
export const MIN_GROUP = 5;

export function groupTerciles(names: { t: string; r63: number }[]): Record<string, 0 | 1 | 2> {
  const by = new Map<string, { t: string; r63: number }[]>();
  for (const n of names) { const g = sic2[n.t]; if (!g || !Number.isFinite(n.r63)) continue; (by.get(g) ?? by.set(g, []).get(g)!).push(n); }
  const ranked = [...by.entries()].filter(([, xs]) => xs.length >= MIN_GROUP)
    .map(([g, xs]) => ({ g, avg: xs.reduce((a, x) => a + x.r63, 0) / xs.length, xs }))
    .sort((a, b) => b.avg - a.avg);
  const out: Record<string, 0 | 1 | 2> = {};
  ranked.forEach((grp, i) => { const tier = (i < ranked.length / 3 ? 0 : i < (2 * ranked.length) / 3 ? 1 : 2) as 0 | 1 | 2; for (const x of grp.xs) out[x.t] = tier; });
  return out;
}

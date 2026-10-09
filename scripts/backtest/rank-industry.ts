// scripts/backtest/rank-industry.ts — industry momentum: pick the industries first?
//
//   npx tsx scripts/backtest/download-sic.ts   (once: reference/sic.json)
//   npx tsx scripts/backtest/rank-industry.ts
//
// Moskowitz & Grinblatt (1999): much of stock momentum is industry momentum —
// strong industries keep leading. And CTT's own momentum list clusters (the
// Aug 2026 list was mostly biotech), so capping names per industry is the
// other natural question.
//
// RULES — fixed 9 Oct 2026, before the first run. Engine and universe:
// rank-engine.ts. Industry = the first 2 digits of Polygon's SIC code (the
// SIC "major group"), taken as of the last month-end the name was liquid.
// Names without a SIC code have no industry.
//   Industry score at t: mean 12-1 momentum of its members in the universe,
//     industries with at least 5 members only.
//   I1  top 5 industries; within each, the top 10 names by 12-1 momentum.
//   I2  12-1 momentum top 50, at most 5 names from any one industry (names
//       without a SIC code are uncapped).
//   PASS: as rank-pead.ts — staggered beats SPY over the whole period and in
//     both halves, beats MOM12_1 top 50 staggered over the whole period, and
//     beats SPY on at least 15 of 20 rebalance days.

import fs from 'node:fs';
import path from 'node:path';
import { DATA } from './cache';
import { syms, pool, staggered, spyNav, report, offsets, momTop50 } from './rank-engine';

const sic: Record<string, { sic: string | null; desc: string | null }> = JSON.parse(fs.readFileSync(path.join(DATA, 'reference', 'sic.json'), 'utf8'));
const ind = (id: number): string | null => { const s = sic[syms[id]]?.sic; return s && s.length >= 2 ? s.slice(0, 2) : null; };

const i1 = (t: number) => {
  const groups = new Map<string, { id: number; mom: number }[]>();
  for (const p of pool(t)) { const g = ind(p.id); if (!g) continue; (groups.get(g) ?? groups.set(g, []).get(g)!).push(p); }
  const ranked = [...groups.entries()].filter(([, m]) => m.length >= 5)
    .map(([g, m]) => ({ g, score: m.reduce((a, x) => a + x.mom, 0) / m.length, m }))
    .sort((a, b) => b.score - a.score).slice(0, 5);
  return ranked.flatMap(r => r.m.slice().sort((a, b) => b.mom - a.mom).slice(0, 10).map(x => x.id));
};
const i2 = (t: number) => {
  const per = new Map<string, number>(); const out: number[] = [];
  for (const p of pool(t)) {
    const g = ind(p.id);
    if (g) { const n = per.get(g) ?? 0; if (n >= 5) continue; per.set(g, n + 1); }
    out.push(p.id);
    if (out.length === 50) break;
  }
  return out;
};

const covered = Object.values(sic).filter(v => v.sic).length;
console.log(`SIC codes: ${covered} of ${Object.keys(sic).length} universe names`);
const spy = report('SPY', spyNav); console.log(spy.line);
const mom = report('MOM12_1 top50 (staggered)', staggered(momTop50)); console.log(mom.line);
for (const [name, pick] of [['I1 top-5 industries x10', i1], ['I2 momentum, <=5/industry', i2]] as const) {
  const r = report(`${name}`, staggered(pick));
  const off = offsets(pick);
  const pass = r.tot > spy.tot && r.h1 > spy.h1 && r.h2 > spy.h2 && r.tot > mom.tot && Number(off.match(/on (\d+)\/20/)![1]) >= 15;
  console.log(`${r.line}\n    ${off}  → ${pass ? 'PASS' : 'fail'}`);
}

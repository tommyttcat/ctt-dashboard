// scripts/backtest/rank-pead-check.ts — is P2's gain the earnings signal, or just its smaller universe?
// Written AFTER rank-pead.ts ran (diagnostic, not a pass/fail test): plain
// MOM12_1 top 50 restricted to the same SUE-eligible names.
import { sessions, syms, pool, staggered, report, offsets } from './rank-engine';
import { sue } from './rank-pead';
const cache = new Map<number, number[]>();
const momInSueUniverse = (t: number) => {
  if (!cache.has(t)) cache.set(t, pool(t).filter(p => sue(syms[p.id], sessions[t]) != null).slice(0, 50).map(p => p.id));
  return cache.get(t)!;
};
console.log(report('MOM top50, SUE universe', staggered(momInSueUniverse)).line);
console.log('    ' + offsets(momInSueUniverse));

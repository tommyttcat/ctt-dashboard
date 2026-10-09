// scripts/backtest/exposure-equivalence.ts — does lib/exposure run index-overlay.ts O4?
//   npx tsx scripts/backtest/exposure-equivalence.ts
// Replays the bar cache through lib/exposure (breadth + stepExposure) and
// compares breadth readings, washout days and the O4 result with the test.
import { listSessions, readDay } from './cache';
import { breadth, stepExposure, type ExposureState } from '@/lib/exposure';
const sessions = listSessions(); const N = sessions.length;
const days: Map<string, number>[] = []; const qqq: number[] = []; const spy: number[] = [];
const hist = new Map<string, number[]>(); const bt: (number | null)[] = [];
for (const d of sessions) {
  const m = new Map<string, number>(); let above = 0, total = 0;
  for (const r of readDay('adj', d)) {
    m.set(r[0], r[4]); if (r[0] === 'QQQ') qqq.push(r[4]); if (r[0] === 'SPY') spy.push(r[4]);
    const c = r[4]; if (!(c > 0)) continue;
    let h = hist.get(r[0]); if (!h) { h = []; hist.set(r[0], h); } h.push(c); if (h.length > 41) h.shift(); if (h.length < 41) continue;
    let s = 0; for (let i = 1; i < 41; i++) s += h[i]; total++; if (c > s / 40) above++;
  }
  days.push(m); bt.push(total >= 100 ? (100 * above) / total : null);
}
let maxDiff = 0, sideFlips = 0, both = 0;
const START = 200;
let st: ExposureState | null = null;
for (let d = START; d < N; d++) {
  const b = breadth(days.slice(Math.max(0, d - (Number(process.argv[2]) || 100) + 1), d + 1)).value;
  if (b != null && bt[d] != null) { maxDiff = Math.max(maxDiff, Math.abs(b - (bt[d] as number))); if ((b <= 20) !== ((bt[d] as number) <= 20)) sideFlips++; if (b <= 20) both++; }
  st = stepExposure(st, sessions[d], qqq.slice(0, d + 1), sessions.slice(0, d + 1), b, spy[d]);
}
console.log(`breadth: max gap vs test ${maxDiff.toFixed(2)} pts; days on opposite sides of 20%: ${sideFlips}; lib washout-days ${both}`);
const r = st!.record;
console.log(`lib O4 ${sessions[START]} → ${sessions[N - 1]}: ${((r.nav - 1) * 100).toFixed(1)}% (test: +196.7%); QQQ ${((r.daily.at(-1)![2] - 1) * 100).toFixed(1)}% (test +156.3%)`);

/* scripts/momentum.test.mts — Momentum Leaders ranking (lib/momentum). */
import { rankMomentum, suspectJump, rvolOf, rulesShortlist } from '../src/lib/momentum.ts';
import { eq, near, ok, done } from './testkit.mts';

const day = (rows: Record<string, [number, number]>) => new Map(Object.entries(rows).map(([t, [c, v]]) => [t, { c, v }]));
const names = new Map([['UP', 'Up Inc'], ['DOWN', 'Down Inc'], ['THIN', 'Thin Inc'], ['CHEAP', 'Cheap Inc'], ['NEW', 'New Inc']]);
const today = { UP: [50, 1e6], DOWN: [20, 2e6], THIN: [50, 1e4], CHEAP: [4, 1e8], NEW: [30, 1e6] } as Record<string, [number, number]>;
const recent = Array.from({ length: 20 }, () => day(today));
const d21 = day({ UP: [45, 1], DOWN: [22, 1], THIN: [10, 1], CHEAP: [1, 1], NEW: [10, 1] });
const d252 = day({ UP: [15, 1], DOWN: [40, 1], THIN: [5, 1], CHEAP: [0.5, 1] });   // NEW has no 252-day bar
const { universe, rows } = rankMomentum(names, recent, d21, d252);
eq('universe: liquid, $5+, a year of history', universe, 2);
eq('ranked by 12-1 momentum, strongest first', rows.map(r => r.t).join(','), 'UP,DOWN');
near('12-1 return skips the last month', rows[0].mom, (45 / 15 - 1) * 100);
near('1M is the last 21 sessions', rows[0].r1m, (50 / 45 - 1) * 100);
ok('thin names excluded', !rows.some(r => r.t === 'THIN'));
ok('sub-$5 names excluded', !rows.some(r => r.t === 'CHEAP'));
ok('names without a year of history excluded', !rows.some(r => r.t === 'NEW'));
eq('company name carried', rows[0].n, 'Up Inc');
// ticker-reuse guard: a 2.5x+ or 60%+ one-day jump is flagged for the reference check
eq('no jump in a normal series', suspectJump([10, 10.5, 11, 12]), -1);
eq('a 3x overnight jump is flagged at its index', suspectJump([10, 10, 30, 31]), 2);
eq('a 70% overnight drop is flagged', suspectJump([10, 3, 3]), 1);
eq('a 2x move is not flagged', suspectJump([10, 20]), -1);
// RVOL: today vs the 20 sessions before it
eq('rvol needs 21 sessions', rvolOf(new Array(20).fill(100)), null);
eq('rvol = today / prior 20-session average', rvolOf([...new Array(20).fill(100), 250]), 2.5);
eq('rvol ignores older sessions', rvolOf([9999, ...new Array(20).fill(100), 100]), 1);
// rules shortlist: highest 12M first, no Stage 3/4, no red rows
const sl = [
  { t: 'TOP', mom: 900, r1m: 0, price: 10, dvol: 1, stage: 'Stage 3B' },
  { t: 'A', mom: 300, r1m: 0, price: 10, dvol: 1, stage: 'Stage 2A' },
  { t: 'B', mom: 250, r1m: 0, price: 10, dvol: 1, stage: 'Stage 2C' },
  { t: 'RED', mom: 280, r1m: 0, price: 10, dvol: 1, stage: 'Stage 2A' },
  { t: 'C', mom: 200, r1m: 0, price: 10, dvol: 1, stage: null },
  { t: 'D', mom: 100, r1m: 0, price: 10, dvol: 1, stage: 'Stage 4' },
];
eq('shortlist skips stage 3/4 and red, highest 12M first', rulesShortlist(sl, new Set(['RED']), 5).map(r => r.t).join(','), 'A,B,C');
eq('shortlist caps at n', rulesShortlist(sl, new Set(), 2).map(r => r.t).join(','), 'A,RED');
done('momentum leaders');

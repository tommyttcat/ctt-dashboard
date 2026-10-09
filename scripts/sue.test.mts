/* scripts/sue.test.mts — the earnings surprise and the combined ranking (lib/sue, lib/momentum). */
import { sueAt, fromFmp, sueFresh } from '../src/lib/sue.ts';
import { rankCombined, type MomentumRow } from '../src/lib/momentum.ts';
import { eq, near, ok, done } from './testkit.mts';

// Q1-Q3 for 2022-2025; EPS rises 0.1/yr, then a jump in 2025 Q3.
const q = [];
for (const fy of [2022, 2023, 2024, 2025]) for (const [i, fp] of ['Q1', 'Q2', 'Q3'].entries()) {
  q.push({ fy, fp, filed: `${fy}-0${3 * i + 4}-15`.replace('-010-', '-10-'), eps: 1 + 0.1 * (fy - 2022) + 0.01 * i });
}
q[q.length - 1].eps = 3;                                      // 2025 Q3 big beat
q.push({ fy: 2025, fp: 'Q4', filed: '2026-02-15', eps: 99 });  // Q4 must be ignored
const r = sueAt(q, '2025-11-01');
eq('anchored to the latest Q1-Q3 filing', r.filed, '2025-10-15');
ok('a big year-on-year jump is a big SUE', (r.sue ?? 0) > 10);
eq('nothing filed yet', sueAt(q, '2021-01-01').sue, null);
eq('not enough history', sueAt(q, '2023-08-01').sue, null);
ok('Q4 rows are ignored', sueAt(q, '2026-03-01').filed === '2025-10-15');
ok('fresh within 92 days', sueFresh({ s: 1, f: '2025-10-15', a: '2025-11-01' }, '2026-01-14'));
ok('stale after 92 days', !sueFresh({ s: 1, f: '2025-10-15', a: '2025-11-01' }, '2026-01-20'));
eq('FMP rows map, Q4 kept for sueAt to drop', fromFmp([{ fiscalYear: '2026', period: 'Q2', filingDate: '2026-07-30', eps: 1.54 }, { fiscalYear: '2025', period: 'FY', filingDate: '2026-02-01', eps: 5 }]).length, 1);

const row = (t: string, mom: number): MomentumRow => ({ t, mom, r1m: 0, price: 10, dvol: 1e8 });
const all = [row('A', 90), row('B', 80), row('C', 70), row('D', 60)];      // momentum order
const sue = { A: { s: 0.5, f: '2026-09-01', a: '2026-09-02' }, B: { s: 3, f: '2026-09-01', a: '2026-09-02' }, C: { s: 2, f: '2026-09-01', a: '2026-09-02' }, D: { s: 9, f: '2025-01-01', a: '2025-01-02' } };
const out = rankCombined(all, sue, '2026-10-01');
eq('stale scores are not eligible', out.some(x => x.t === 'D'), false);
eq('ranked on SUE rank + momentum rank, momentum breaks ties', out.map(x => x.t).join(','), 'B,A,C');
near('the score rides along', out[0].sue as number, 3);
done('earnings surprise + combined ranking');

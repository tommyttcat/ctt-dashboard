/* scripts/momentumPaper.test.mts — the hidden forward record's bookkeeping (lib/momentum). */
import { newPaper, stepPaper, PAPER_COST } from '../src/lib/momentum.ts';
import { eq, near, ok, done } from './testkit.mts';

const bars = (m: Record<string, [number, number]>) => new Map(Object.entries(m).map(([t, [o, c]]) => [t, { o, c }]));
const p = newPaper('2026-10-01');
// day 1 is the 1st session: sleeve k=1 picks, nothing held yet
stepPaper(p, '2026-10-01', 1, bars({ A: [10, 10], B: [20, 20], SPY: [500, 500] }), ['A', 'B']);
eq('k=1 sleeve has a pending list', p.sleeves[0].pending?.join(','), 'A,B');
eq('no SPY entry before any fill', p.spyEntry, null);
// day 2: fills at the open, marks at the close
stepPaper(p, '2026-10-02', 2, bars({ A: [11, 12.1], B: [20, 22], SPY: [510, 520] }), ['A', 'B']);
eq('filled two names', p.sleeves[0].hold.length, 2);
near('entry at the open', p.sleeves[0].hold[0].entry, 11);
near('cost on full turnover', p.sleeves[0].base, 1 - 2 * PAPER_COST);
near('marked to the close', p.sleeves[0].nav, (1 - 2 * PAPER_COST) * (1 + (12.1 / 11 - 1 + 22 / 20 - 1) / 2));
near('SPY bought at the first fill open', p.spyEntry!, 510);
ok('other sleeves still cash', p.sleeves.slice(1).every(s => s.nav === 1));
// same date twice is a no-op
const before = JSON.stringify(p);
stepPaper(p, '2026-10-02', 2, bars({ A: [1, 1], B: [1, 1], SPY: [1, 1] }), []);
eq('idempotent per date', JSON.stringify(p), before);
// a missing bar keeps the last price
stepPaper(p, '2026-10-05', 3, bars({ B: [22, 23], SPY: [520, 521] }), ['A', 'B']);
near('missing name holds its last close', p.sleeves[0].hold[0].last, 12.1);
done('momentum paper record');

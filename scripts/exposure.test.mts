/* scripts/exposure.test.mts — the Market exposure rule (lib/exposure).
 * exposure-equivalence.ts proves it reproduces index-overlay.ts O4 on the
 * bar cache (+196.7%); these pin the state machine on synthetic data. */
import { breadth, stepExposure, type ExposureState } from '../src/lib/exposure.ts';
import { eq, near, ok, done } from './testkit.mts';

const up = Array.from({ length: 220 }, (_, i) => 100 + i);          // rising QQQ
const dates = up.map((_, i) => `d${String(i).padStart(3, '0')}`);
let s: ExposureState | null = null;
s = stepExposure(s, dates[219], up, dates, 50, 400);
eq('above the 200-day: in', s.mode, 'in');
eq('in = 100%', s.exposure, 1);
const down = [...up.slice(0, 219), 150];                              // closes under its 200-day
const t = stepExposure(null, 'x', down, dates, 50, 400);
eq('below the 200-day: out', t.mode, 'out');
eq('out = cash', t.exposure, 0);
// washout → 10 boosted sessions, no extension inside the window
let w: ExposureState = stepExposure(null, 'w0', up, dates, 15, 400);
eq('washout close: boost next session', w.mode, 'boost');
eq('day 1 of 10', w.boostDay, 1);
for (let k = 1; k <= 9; k++) w = stepExposure(w, `w${k}`, up, dates, k === 5 ? 10 : 50, 400);
eq('still boosted on day 10, not extended by a washout inside the window', w.boostDay, 10);
w = stepExposure(w, 'w10', up, dates, 15, 400);
eq('a washout ON the 10th session is ignored (as the test)', w.mode, 'in');
w = stepExposure(w, 'w11', up, dates, 15, 400);
eq('the next one starts a new window', w.boostDay, 1);
// the forward record: yesterday's exposure earns today's move
const r1 = stepExposure(null, 'a', [...up.slice(0, 219), 300], dates, 50, 400);
const r2 = stepExposure(r1, 'b', [...up.slice(0, 219), 300, 330], [...dates, 'b'], 50, 404);
near('100% in: record follows QQQ', r2.record.nav, 1.1, 1e-4);
ok('idempotent per date', stepExposure(r2, 'b', [], [], null, 0) === r2);
// breadth: each name's last 41 closes, skipping days it did not trade
const day = (m: Record<string, number>) => new Map(Object.entries(m));
const days = Array.from({ length: 45 }, (_, i) => day({ ...Object.fromEntries(Array.from({ length: 120 }, (_, j) => [`S${j}`, 10])), A: 10, ...(i % 2 ? {} : { THIN: 10 }) }));
days[44] = day({ ...Object.fromEntries(Array.from({ length: 120 }, (_, j) => [`S${j}`, j < 30 ? 11 : 9])), A: 11, THIN: 11 });
const b = breadth(days);
eq('a name trading every other day lacks 41 closes in 45 days', b.total, 121);
near('30 of 120 + A above', b.value!, 100 * 31 / 121, 1e-9);
done('market exposure');

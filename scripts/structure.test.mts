/* scripts/structure.test.mts — Chart Structure (lib/structure). */
import { readStructure, type Bar } from '../src/lib/structure.ts';
import { eq, ok, done } from './testkit.mts';

const mk = (closes: number[], w = 0.01): Bar[] => closes.map(c => ({ h: c * (1 + w), l: c * (1 - w), c }));
// a steady uptrend with a 10-session wave: channel-up
const up = Array.from({ length: 260 }, (_, i) => 100 * Math.exp(0.004 * i) * (1 + 0.03 * Math.sin(i / 10 * Math.PI)));
const r1 = readStructure(mk(up));
ok('wavy uptrend is a channel or uptrend', r1.shape === 'channel-up' || r1.shape === 'uptrend');
ok('slope is positive', (r1.slopeMo ?? 0) > 3);
eq('wavy uptrend reads as a channel', r1.shape, 'channel-up');
// flat range oscillating 95-105
const flat = Array.from({ length: 260 }, (_, i) => 100 + 5 * Math.sin(i / 6 * Math.PI));
const r2 = readStructure(mk(flat));
eq('a sideways oscillation is a range', r2.shape, 'range');
// breakout from that range today
const bo = mk(flat); bo[bo.length - 1] = { h: 112, l: 106, c: 111 };
eq('closing above the range high is a breakout', readStructure(bo).breakout, true);
// steady decline
const down = Array.from({ length: 260 }, (_, i) => 200 * Math.exp(-0.004 * i));
eq('a steady decline is a downtrend', readStructure(mk(down, 0.002)).shape, 'downtrend');
eq('too few bars: nothing', readStructure(mk(up.slice(0, 100))).shape, null);
// bounce: range, today's low tags the range low and closes in the upper half
const bn = mk(flat); const lo = Math.min(...bn.slice(-61, -1).map(b => b.l)); bn[bn.length - 1] = { h: lo * 1.04, l: lo * 1.001, c: lo * 1.035 };
eq('a range name tagging its low and closing up is a bounce', readStructure(bn).bounce, true);
done('chart structure');

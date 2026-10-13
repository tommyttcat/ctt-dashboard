/* scripts/netHighsLows.test.mts — net new highs − lows (lib/netHighsLows). */
import { netHLAt, mergeHistory, emaSeries } from '../src/lib/netHighsLows.ts';
import { eq, ok, done } from './testkit.mts';

const n = 300;
const rising = Array.from({ length: n }, (_, i) => 10 + i * 0.1);
const falling = Array.from({ length: n }, (_, i) => 50 - i * 0.1);
const flat = Array.from({ length: n }, () => 20);
const mk = (c: number[]) => ({ h: c.map(x => x * 1.01), l: c.map(x => x * 0.99), c });
const a = mk(rising), b = mk(falling), f = mk(flat);
const r = netHLAt([a.h, b.h, f.h], [a.l, b.l, f.l], [a.c, b.c, f.c], n - 1);
eq('the riser is a new high', r.h, 1);
eq('the faller is a new low', r.l, 1);
eq('net', r.net, 0);
eq('under $3 is skipped', netHLAt([b.h.map(x => x / 20)], [b.l.map(x => x / 20)], [b.c.map(x => x / 20)], n - 1).l, 0);
eq('too little history counts nothing', netHLAt([a.h], [a.l], [a.c], 100).h, 0);
const m = mergeHistory([{ d: '2026-10-01', h: 1, l: 2, net: -1 }], [{ d: '2026-10-01', h: 5, l: 1, net: 4 }, { d: '2026-09-30', h: 0, l: 0, net: 0 }]);
eq('merge: one per date, sorted, newest wins', m.map(p => `${p.d}:${p.net}`).join(), '2026-09-30:0,2026-10-01:4');
ok('ema converges', Math.abs(emaSeries([1, 1, 1, 10, 10, 10, 10, 10, 10, 10, 10, 10], 3).at(-1)! - 10) < 0.1);
done('net highs lows');

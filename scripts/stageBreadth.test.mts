/* scripts/stageBreadth.test.mts — S2 breadth (lib/stageBreadth). */
import { stage2At } from '../src/lib/stageBreadth.ts';
import { eq, ok, done } from './testkit.mts';

const n = 262;
const up = new Float64Array(n).map((_, i) => 50 + i * 0.3);          // steady uptrend → Stage 2
const down = new Float64Array(n).map((_, i) => 150 - i * 0.3);       // steady decline → Stage 4
const short = new Float64Array(n).fill(NaN).map((_, i) => (i > 100 ? 50 + i * 0.1 : NaN)); // < 210 bars
const r = stage2At([up, up, down, short], n - 1);
eq('names with 210+ bars counted', r.n, 3);
eq('two of three in Stage 2', r.pct, 66.7);
ok('the decline is not Stage 2', r.counts['4'] + r.counts['3'] >= 1);
eq('nothing countable early on', stage2At([up], 100).n, 0);
done('stage breadth');

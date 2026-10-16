/* scripts/stageBreadth.test.mts — S2 breadth (lib/stageBreadth). */
import { stage2At, stageMapAt } from '../src/lib/stageBreadth.ts';
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
{
  // 260 rising closes -> a Stage 2 reading for the ticker; too few bars -> left out.
  const up = new Float64Array(260).map((_, j) => 50 + j * 0.3);
  const short = new Float64Array(260).fill(NaN); for (let j = 200; j < 260; j++) short[j] = 80;
  const m = stageMapAt([up, short], ['UP', 'NEW'], 259);
  ok('stage map: a steady riser is Stage 2', /^2/.test(m.UP ?? ''));
  ok('stage map: under 210 bars is left out', !('NEW' in m));
}
done('stage breadth');

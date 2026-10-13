/* scripts/retest821.test.mts — the 8/21 RETEST tag (lib/scans/retest821). */
import { retest821Of } from '../src/lib/scans/retest821.ts';
import { eq, ok, done } from './testkit.mts';

// 60 bars drifting down to 90, 20 bars rising to 104 (cross, break of the ~100 base high), then
// 3 bars pulling back to ~100.5 and a bounce: the diagram's shape.
const closes = [
  ...Array.from({ length: 60 }, (_, i) => 100 - i * (10 / 59)),
  ...Array.from({ length: 20 }, (_, i) => 90 + (i + 1) * 0.7),
  103, 101.5, 100.6, 101.8,
];
const bars = closes.map((c, i) => ({ c, h: c * 1.008, l: i >= 81 && i <= 82 ? c * 0.992 : c * 0.993 }));
const r = retest821Of(bars);
ok('the diagram shape is tagged', r != null);
if (r) {
  ok('level is the pre-cross high', r.level > 99 && r.level < 101);
  eq('the bounce above yesterday\'s high is confirmed', r.confirmed, true);
}
const straight = Array.from({ length: 100 }, (_, i) => ({ c: 50 + i, h: 50.5 + i, l: 49.5 + i }));
eq('a straight run never retests', retest821Of(straight), null);
eq('too short', retest821Of(bars.slice(0, 50)), null);
done('8/21 retest');

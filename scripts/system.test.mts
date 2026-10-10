/* scripts/system.test.mts — the System card (lib/system). */
import { rankFeatures, scoreRow, isLate, liveRecord, FEATS } from '../src/lib/system.ts';
import { eq, ok, done } from './testkit.mts';

const F = FEATS.length;
const row = (k: number) => Array.from({ length: F }, (_, f) => (f >= 27 ? NaN : k + f * 0));
const X = rankFeatures([row(1), row(2), row(3)]);
eq('ranks span -0.5..0.5', [X[0], X[F], X[2 * F]].join(','), '-0.5,0,0.5');
eq('sector features stay 0 (as trained)', X[27], 0);
ok('scores are finite', Number.isFinite(scoreRow(X, 0)) && Number.isFinite(scoreRow(X, 2)));
eq('a +5% day is late', isLate(0.05, 1), true);
eq('a 2.5x range is late', isLate(0.01, 2.5), true);
eq('a quiet day is not', isLate(0.01, 1.2), false);
const rec = liveRecord([{ d: 'a', on: 1, qqq: 100, picks: [], listRet: null }, { d: 'b', on: 1, qqq: 101, picks: [], listRet: 0.02 }, { d: 'c', on: 0, qqq: 99, picks: [], listRet: -0.01 }]);
const step = (r: number) => 1 + 2 * r - 0.0095 / 252 - 0.04 / 252;
ok('core is 2x QQQ while on (both days on)', Math.abs(rec.core - (step(0.01) * step(99 / 101 - 1) - 1)) < 1e-9);
ok('list compounds its daily returns', Math.abs(rec.list - (1.02 * 0.99 - 1)) < 1e-9);
eq('qqq return over the record', +rec.qqq.toFixed(4), -0.01);
done('system card');

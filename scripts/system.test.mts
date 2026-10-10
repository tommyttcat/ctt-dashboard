/* scripts/system.test.mts — the System card (lib/system). */
import { rankFeatures, scoreRow, isLate, liveRecord, FEATS, stepColours, bandOf } from '../src/lib/system.ts';
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
// colour scorecard
eq('bands: 0.7 green, 0.3 yellow, below red', [bandOf(0.7), bandOf(0.5), bandOf(0.29)].join(','), '0,1,2');
const c0 = stepColours(undefined, 'd0', { G: 100, Y: 50, R: 20 }, { G: 0.9, Y: 0.5, R: 0.1 });
eq('first night only records bands', c0.daily.length, 0);
const c1 = stepColours(c0, 'd1', { G: 110, Y: 50, R: 18 }, { G: 0.9, Y: 0.5, R: 0.1 });
eq('next night marks each group to the close', c1.daily[0].slice(1).map(x => +(x as number).toFixed(3)).join(','), '0.1,0,-0.1');
eq('nav compounds', c1.nav.map(x => +x.toFixed(3)).join(','), '1.1,1,0.9');
done('system card');

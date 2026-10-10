/* scripts/fit.test.mts — OK / LATE (lib/scans/fit). */
import { fitScore, isLate, FIT_LATE_BELOW } from '../src/lib/scans/fit.ts';
import { eq, ok, done } from './testkit.mts';

const calm = { changePct: 4, atrExpansion: 0.8, closeStrength: 0.95, rsVsMkt: 4, chop14: 55, dVol: 2e9, vwapStatus: 'above', aboveSma50: false };
const hot = { changePct: 25, atrExpansion: 3, closeStrength: 0.4, rsVsMkt: 24, chop14: 25, dVol: 1e8, vwapStatus: 'below', aboveSma50: true };
eq('a calm, strong-closing name scores 100', fitScore(calm), 100);
eq('a name that ran hard today scores 0', fitScore(hot), 0);
eq('calm is OK', isLate(fitScore(calm)), false);
eq('hot is LATE', isLate(fitScore(hot)), true);
eq('too few fields: no score', fitScore({ changePct: 3, dVol: 1e9 }), null);
eq('no score, no label', isLate(null), null);
ok('the cut is the training median', FIT_LATE_BELOW > 50 && FIT_LATE_BELOW < 55);
eq('missing fields score 0, as in the test', fitScore({ changePct: 4, atrExpansion: 0.8, closeStrength: 0.95, rsVsMkt: 4 }), (16 / 32) * 100);
done('fit OK / LATE');

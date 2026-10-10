/* scripts/edgeModel.test.mts — model colours with the red override (lib/scans/edge + lib/modelScores). */
import { edgeTier, swingTier, blendModelMap, modelBand } from '../src/lib/scans/edge.ts';
import { setModelScores } from '../src/lib/modelScores.ts';
import { eq, done } from './testkit.mts';

eq('no scores: the old rule stands', edgeTier({ ticker: 'AAA', adrPct: 3, price: 50, closeStrength: 0.95 } as any), 'green');
setModelScores({ AAA: 0.9, BBB: 0.5, CCC: 0.1, WILD: 0.95 });
eq('model top third turns a weak-close row green', edgeTier({ ticker: 'AAA', adrPct: 3, price: 50, closeStrength: 0.2 } as any), 'green');
eq('model middle third is yellow', edgeTier({ ticker: 'BBB', adrPct: 3, price: 50, closeStrength: 0.95 } as any), 'yellow');
eq('model bottom third is red', edgeTier({ ticker: 'CCC', adrPct: 3, price: 50, closeStrength: 0.95 } as any), 'red');
eq('the scan red rule wins over a top score', edgeTier({ ticker: 'WILD', adrPct: 12, price: 50, closeStrength: 0.95 } as any), 'red');
eq('unscored names keep the rule', edgeTier({ ticker: 'ZZZ', adrPct: 3, price: 50, closeStrength: 0.95 } as any), 'green');
eq('swing rows use symbol', swingTier({ symbol: 'CCC', rsRating: 99, mf: 70, stage: 'Stage 2A' } as any), 'red');
eq('bands', [modelBand(0.7), modelBand(0.5), modelBand(0.2)].join(','), 'green,yellow,red');
const m = blendModelMap({ AAA: 'red', ZZZ: 'yellow' }, { AAA: 0.9, BBB: 0.8 });
eq('map: red override, model, rule fallback', [m.AAA, m.BBB, m.ZZZ].join(','), 'red,green,yellow');
setModelScores(null);
done('model colours');

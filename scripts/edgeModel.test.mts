/* scripts/edgeModel.test.mts — model colours (lib/scans/edge), switched by MODEL_COLOURS. */
import { edgeTier, swingTier, blendModelMap, modelBand, MODEL_COLOURS } from '../src/lib/scans/edge.ts';
import { setModelScores } from '../src/lib/modelScoreStore.ts';
import { eq, done } from './testkit.mts';

eq('no scores: the old rule stands', edgeTier({ ticker: 'AAA', adrPct: 3, price: 50, closeStrength: 0.95 } as any), 'green');
setModelScores({ AAA: 0.9, BBB: 0.5, CCC: 0.1, WILD: 0.95 });
if (MODEL_COLOURS) {
  eq('model top third turns a weak-close row green', edgeTier({ ticker: 'AAA', adrPct: 3, price: 50, closeStrength: 0.2 } as any), 'green');
  eq('model bottom third is red', edgeTier({ ticker: 'CCC', adrPct: 3, price: 50, closeStrength: 0.95 } as any), 'red');
  eq('the scan red rule wins over a top score', edgeTier({ ticker: 'WILD', adrPct: 12, price: 50, closeStrength: 0.95 } as any), 'red');
  eq('swing rows use symbol', swingTier({ symbol: 'CCC', rsRating: 99, mf: 70, stage: 'Stage 2A' } as any), 'red');
} else {
  eq('colours off: scores do not change a row', edgeTier({ ticker: 'CCC', adrPct: 3, price: 50, closeStrength: 0.95 } as any), 'green');
  eq('colours off: summary map is the rule map', JSON.stringify(blendModelMap({ AAA: 'yellow' }, { AAA: 0.9, BBB: 0.8 })), '{"AAA":"yellow"}');
}
eq('bands', [modelBand(0.7), modelBand(0.5), modelBand(0.2)].join(','), 'green,yellow,red');
setModelScores(null);
done('model colours');

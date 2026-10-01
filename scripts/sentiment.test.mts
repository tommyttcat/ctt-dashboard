/* scripts/sentiment.test.mts — Social Sentiment logic (lib/sentiment). */

import { pickUniverse, postLean, bullShare, buildRows } from '../src/lib/sentiment.ts';
import { eq, ok, done } from './testkit.mts';

const st = [{ t: 'NKE', rank: 1 }, { t: 'MU', rank: 6 }, { t: 'SPY', rank: 2 }, { t: 'XRP-USD', rank: 3 }];
const reddit = [{ t: 'MU', rank: 1, mentions: 1228, prev: 566 }, { t: 'QQQ', rank: 4, mentions: 121, prev: 76 }, { t: 'GOOG', rank: 5, mentions: 111, prev: 48 }];
const u = pickUniverse(st, reddit);
eq('on both lists ranks first', u[0], 'MU');
ok('index funds are left out', !u.includes('SPY') && !u.includes('QQQ'));
ok('non-ticker symbols are left out', !u.includes('XRP-USD'));
eq('capped', pickUniverse(st, reddit, 2).length, 2);

eq('bullish words', postLean('Loaded calls, breakout coming 🚀'), 'bull');
eq('bearish words', postLean('Selling here, puts into the miss'), 'bear');
eq('no words, no lean', postLean('$NKE earnings tonight'), null);

eq('bull share', bullShare(16, 4), 80);
eq('too few tagged', bullShare(2, 1), null);

const rows = buildRows(['MU', 'GOOG'], new Map([['MU', { t: 'MU', rank: 6, summary: 'why' }]]),
  new Map([['MU', { bull: 16, bear: 1, msgs: 30 }]]), new Map(reddit.map(r => [r.t, r])),
  new Map([['MU', { posts: 12, bull: 6, bear: 1 }]]), new Map([['MU', { price: 1095, chg: 3, vol: 40e6 }]]),
  new Map([['MU', { rvol: 1.4, rs: 97 }]]));
eq('volume carried', rows[0].vol, 40e6);
eq('RVOL and RS carried', `${rows[0].rvol}/${rows[0].rs}`, '1.4/97');
eq('StockTwits tags carried', rows[0].st?.bull, 16);
eq('summary carried', rows[0].st?.summary, 'why');
eq('Reddit-only name has no StockTwits block', rows[1].st, null);
eq('missing price is null', rows[1].price, null);

done('social sentiment');

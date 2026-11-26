/* scripts/pctDirection.test.mts — brief prose % colour direction (lib/summary/pctDirection, 25 Nov 2026). */
import { pctDirection } from '../src/lib/summary/pctDirection.ts';
import { eq, done } from './testkit.mts';

const d = (pre: string, n: string) => pctDirection(n, pre, '');
eq('down before it is red', d('Technology about $3.0 billion down ', '0.8'), -1);
eq('carries the clause direction', d('The losers were company-specific: VRTX down 7.1% on the FDA delay and NUVB ', '7.0'), -1);
eq('up before it is green', d('with DE up ', '4.4'), 1);
eq('rose is green', d('AAPL at $18.2 billion, which rose ', '0.4'), 1);
eq('range keeps the direction', d('rose 4.6% to ', '7.9'), 1);
eq('a level is neutral', d("so yields fell from Monday's ", '4.92'), null);
eq('no direction word is neutral', d('Breadth is ', '52'), null);
eq('last sentence only', d('Stocks fell hard. Then META up ', '3.4'), 1);
eq('a sign wins', d('down ', '+2.1'), 1);
eq('a minus wins', d('up ', '-2.1'), -1);
done('pct direction');

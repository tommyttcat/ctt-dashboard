/* scripts/briefLevel.test.mts — a brief level is not necessarily a number.
 *
 * The brief for 14 Sep 2026 stored `trigger` and `stop` as strings. A
 * `!= null` guard passes a string, `.toFixed` then throws, and because
 * /briefs/[date] is statically generated that throw failed `next build` —
 * blocking every deploy from 14 to 20 Sep and serving a 500 on the page.
 *
 * Both renderers of that shape now read levels through here.
 */

import { levelNum, levelText } from '../src/lib/briefLevel.ts';
import { eq, ok, done } from './testkit.mts';

// the shape that caused the outage
eq('a numeric string reads as a number', levelNum('266.10'), 266.1);
eq('a numeric string formats', levelText('266.10'), '266.10');
ok('a string does not survive as a string', typeof levelNum('266.10') === 'number');

// ordinary values are untouched
eq('a number passes through', levelNum(254.9), 254.9);
eq('a number formats to two places', levelText(254.9), '254.90');
eq('one decimal place on request', levelText(2.5, 1), '2.5');

// the absent and the unreadable are the same answer: show nothing
eq('null', levelNum(null), null);
eq('undefined', levelNum(undefined), null);
eq('empty string', levelNum(''), null);
eq('prose', levelNum('n/a'), null);
eq('NaN', levelNum(NaN), null);
eq('Infinity is not a price', levelNum(Infinity), null);
eq('an object', levelNum({}), null);
eq('null renders an em dash', levelText(null), '—');
eq('prose renders an em dash', levelText('n/a'), '—');
eq('zero renders an em dash, not 0.00', levelText(0), '—');

/* The guard that was not enough, stated as a test so the next reader sees
   why `!= null` is not the fix. */
ok('a string passes the guard that used to be there', ('266.10' as unknown) != null);
ok('and would have thrown', typeof ('266.10' as unknown as number).toFixed !== 'function');

done('brief levels');

/* scripts/webullBase.test.mts — the day-change base for Webull snapshots (lib/webull dayBase). */
import { dayBase } from '../src/lib/webull.ts';
import { eq, done } from './testkit.mts';

// Real pre-market snapshots, 27 Oct 2026 ~9:05 AM ET (price = the pre-market print).
const cart = { price: 60.85, preClose: 56.44, open: 54.31, change: 4.44 };
const spy = { price: 767.397, preClose: 759.97, open: 762.25, change: 5.4 };
const clro = { price: 6, preClose: 3.25, open: 4.33, change: 1.72 };
eq('pre-market: CART base = yesterday\'s close 60.88', dayBase(cart, true), 60.88);
eq('pre-market: SPY base = yesterday\'s close 765.37', dayBase(spy, true), 765.37);
eq('pre-market: CLRO base = yesterday\'s close 4.97', dayBase(clro, true), 4.97);
eq('pre-market: CART at 60.84 reads -0.07%, not +7.80%', +((60.84 / dayBase(cart, true) - 1) * 100).toFixed(2), -0.07);
eq('regular hours: pre_close', dayBase({ price: 61.5, preClose: 60.88, open: 61, change: 0.62 }, false), 60.88);
eq('pre-market without a change field: pre_close', dayBase({ price: 61.5, preClose: 60.88, open: 61 }, true), 60.88);
eq('no pre_close: falls back to the open', dayBase({ price: 61.5, preClose: 0, open: 61 }, false), 61);
done('webull day base');

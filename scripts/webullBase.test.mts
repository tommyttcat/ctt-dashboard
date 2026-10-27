/* scripts/webullBase.test.mts — the day-change base for Webull snapshots (lib/webull dayBase). */
import { dayBase } from '../src/lib/webull.ts';
import { eq, done } from './testkit.mts';

// 27 Oct 2026, 9:01 AM: Webull's pre-market snapshot of CART still described Monday's session.
const cart = { price: 60.88, preClose: 56.44, open: 61 };
eq('pre-market: the base is yesterday\'s close (snapshot price), not pre_close', dayBase(cart, true), 60.88);
eq('pre-market: CART reads -0.07%, not +7.80%', +((60.84 / dayBase(cart, true) - 1) * 100).toFixed(2), -0.07);
eq('regular hours: pre_close', dayBase({ price: 61.5, preClose: 60.88, open: 61 }, false), 60.88);
eq('no pre_close: falls back to the open', dayBase({ price: 61.5, preClose: 0, open: 61 }, false), 61);
eq('pre-market with no price: pre_close', dayBase({ price: 0, preClose: 60.88 }, true), 60.88);
done('webull day base');

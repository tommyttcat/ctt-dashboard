/* scripts/webullBase.test.mts — the day-change base for Webull snapshots (lib/webull dayBase). */
import { dayBase } from '../src/lib/webull.ts';
import { eq, done } from './testkit.mts';

// 27 Oct 2026, 9:01 AM ET (13:01 UTC).
const NOW = Date.parse('2026-10-27T13:01:00Z');
const YDAY_CLOSE = Date.parse('2026-10-26T20:00:00Z'), TODAY_PRE = Date.parse('2026-10-27T12:55:00Z');
// CART: price = yesterday's close, pre_close = Friday's, last regular trade yesterday.
const cart = { price: 60.88, preClose: 56.44, open: 61, lastTradeTime: YDAY_CLOSE, extPrice: 60.84 };
eq('stock pre-market: base is yesterday\'s close (price), not pre_close', dayBase(cart, true, NOW), 60.88);
eq('stock pre-market: CART reads -0.07%, not +7.80%', +((60.84 / dayBase(cart, true, NOW) - 1) * 100).toFixed(2), -0.07);
// SPY: price already the pre-market print, pre_close = yesterday's close, last trade today.
const spy = { price: 767.25, preClose: 765.37, open: 0, lastTradeTime: TODAY_PRE, extPrice: 767.25 };
eq('ETF pre-market: base stays pre_close when price is already today\'s print', dayBase(spy, true, NOW), 765.37);
eq('seconds timestamps work too', dayBase({ ...cart, lastTradeTime: YDAY_CLOSE / 1000 }, true, NOW), 60.88);
eq('no timestamp: price != extended print -> price is yesterday\'s close', dayBase({ ...cart, lastTradeTime: null }, true, NOW), 60.88);
eq('no timestamp: price == extended print -> pre_close', dayBase({ ...spy, lastTradeTime: null }, true, NOW), 765.37);
eq('regular hours: pre_close', dayBase({ price: 61.5, preClose: 60.88, open: 61 }, false), 60.88);
eq('no pre_close: falls back to the open', dayBase({ price: 61.5, preClose: 0, open: 61 }, false), 61);
done('webull day base');

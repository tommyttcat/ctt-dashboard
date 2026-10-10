/* scripts/tradeLog.test.mts — the owner's trade log (lib/tradeLog). */
import { cleanTrade, scoreTrades, summarize, type Trade, type Bars } from '../src/lib/tradeLog.ts';
import { eq, ok, done } from './testkit.mts';

const today = '2026-10-16';
const good = cleanTrade({ t: 'nvda', src: 'EP9M', buyDate: '2026-10-12', buy: '100', shares: '10', sellDate: '2026-10-14', sell: '110' }, today) as Trade;
ok('a full trade is accepted', typeof good === 'object');
eq('ticker is upper-cased', good.t, 'NVDA');
eq('blank sell = open', (cleanTrade({ t: 'AMD', buyDate: '2026-10-12', buy: 50, sell: '', sellDate: '' }, today) as Trade).sell, null);
eq('a sell price without a date is refused', cleanTrade({ t: 'AMD', buyDate: '2026-10-12', buy: 50, sell: 55 }, today), 'a sell needs both a date and a price');
eq('a sell before the buy is refused', cleanTrade({ t: 'AMD', buyDate: '2026-10-12', buy: 50, sellDate: '2026-10-09', sell: 55 }, today), 'sell date looks wrong');
eq('a future buy is refused', cleanTrade({ t: 'AMD', buyDate: '2026-10-20', buy: 50 }, today), 'buy date looks wrong');
eq('zero price is refused', cleanTrade({ t: 'AMD', buyDate: '2026-10-12', buy: 0 }, today), 'buy price must be above 0');
eq('no source = Other', (cleanTrade({ t: 'AMD', buyDate: '2026-10-12', buy: 50 }, today) as Trade).src, 'Other');

// QQQ: open 500 on the 12th, close 505 on the 14th, close 510 on the 16th.
const bars: Bars = { '2026-10-12': [500, 502], '2026-10-13': [502, 503], '2026-10-14': [503, 505], '2026-10-15': [505, 508], '2026-10-16': [508, 510] };
const open = cleanTrade({ t: 'AMD', src: 'SIP', buyDate: '2026-10-13', buy: 200 }, today) as Trade;
const loser = cleanTrade({ t: 'BE', src: 'SIP', buyDate: '2026-10-12', buy: 50, shares: 100, sellDate: '2026-10-16', sell: 45 }, today) as Trade;
const rows = scoreTrades([good, open, loser], bars, { AMD: 210 }, today);
eq('closed trade %', rows[0].pct!.toFixed(2), '10.00');
eq('QQQ open of buy date to close of sell date', rows[0].qqqPct!.toFixed(2), '1.00');
eq('vs QQQ', rows[0].vsQqq!.toFixed(2), '9.00');
eq('$ result with shares', rows[0].dollars, 100);
eq('same $ in QQQ', rows[0].qqqDollars!.toFixed(2), '10.00');
eq('open trade marked to the last close', rows[1].pct!.toFixed(2), '5.00');
eq('open trade QQQ runs to today', rows[1].qqqPct!.toFixed(2), (100 * (510 / 502 - 1)).toFixed(2));
eq('days held', rows[0].days, 2);
const s = summarize(rows);
eq('closed count excludes open', s.closed.n, 2);
eq('wins', s.closed.wins, 1);
eq('avg %', s.closed.avgPct!.toFixed(2), '0.00');
eq('beat QQQ', s.closed.beatQqq, 1);
eq('$ total', s.closed.dollars, 100 - 500);
eq('by source', Object.keys(s.bySrc).join(','), 'EP9M,SIP');
eq('open aggregate', s.open.n, 1);
eq('no last price = no %', scoreTrades([open], bars, {}, today)[0].pct, null);
done('tradeLog');

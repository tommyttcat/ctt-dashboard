/* scripts/track.test.mts — the R arithmetic behind the live record.
 *
 * This is the maths every number on the Track Record page is built from, and
 * it has already produced one wrong answer in anger: before the risk floor
 * existed, a stop sitting inside the spread turned an ordinary trade into
 * +1090R and made a whole scan look like a discovery. The floor is what stops
 * that, so it is the first thing tested here.
 */

import {
  rMultiple, homeRunLevel, targetFor, statusOf, openR,
  MIN_RISK_PCT, TARGET_R, HR_PCT, HR_R, HOLD_SESSIONS, RETURN_HOLD, RETURN_SCANS,
  type OpenPosition,
} from '../src/lib/track.ts';
import { eq, near, ok, done } from './testkit.mts';

// ---- rMultiple -------------------------------------------------------------
near('a clean 2R', rMultiple(100, 90, 120), 2);
near('a full stop is -1R', rMultiple(100, 90, 90), -1);
near('flat is 0R', rMultiple(100, 90, 100), 0);
near('half a stop', rMultiple(100, 90, 95), -0.5);

/* The floor. A stop 0.1% below the fill is inside the spread on most names;
   without the floor a 1% move would read as +10R. MIN_RISK_PCT forces the
   risk to at least that fraction of the fill, so the same move reads sanely. */
near('risk floor applies', rMultiple(100, 99.9, 101), 2);
eq('floor is half a percent', MIN_RISK_PCT, 0.5);
near('floored risk = 0.5% of fill', rMultiple(100, 99.9, 100.5), 1);
near('a wider stop is not floored', rMultiple(100, 95, 110), 2);
eq('no fill, no answer', rMultiple(0, 0, 10), null);

// ---- levels ----------------------------------------------------------------
near('target is fill + 2R', targetFor(100, 90), 120);
eq('target uses TARGET_R', TARGET_R, 2);
near('target respects the floor', targetFor(100, 99.9), 101);
near('home run is the nearer of +50% and +10R', homeRunLevel(100, 90), 150);
near('...and +10R when risk is small', homeRunLevel(100, 99), 110);
eq('home run thresholds', `${HR_PCT}/${HR_R}`, '0.5/10');

// ---- status ----------------------------------------------------------------
const pos = (o: Partial<OpenPosition>): OpenPosition => ({
  scan: 'sip', t: 'TEST', d: '2026-09-11', score: null, tier: null,
  fill: 100, stop: 90, target: 120, n: 3, peak: 110, hr: false, stopped: false,
  exitFixed: null, exitHold20: null, ...o,
} as OpenPosition);

eq('unfilled is pending', statusOf(pos({ fill: null })), 'pending');
eq('filled and alive is running', statusOf(pos({})), 'running');
eq('stopped beats everything', statusOf(pos({ stopped: true, exitFixed: 2 })), 'stopped');
eq('a positive bracket is target', statusOf(pos({ exitFixed: 2 })), 'target');
eq('past the window is closed', statusOf(pos({ n: HOLD_SESSIONS })), 'closed');

/* RETURN-mode scans run for a year. Closing them at 60 sessions would retire
   a 100-Bagger pick three quarters early and put a meaningless number in the
   settled column. */
ok('multibagger is a return scan', RETURN_SCANS.has('multibagger'));
eq('return window is a year', RETURN_HOLD, 252);
eq('return scan still running at 60', statusOf(pos({ scan: 'multibagger', n: HOLD_SESSIONS })), 'running');
eq('return scan closes at 252', statusOf(pos({ scan: 'multibagger', n: RETURN_HOLD })), 'closed');

// ---- open R ----------------------------------------------------------------
near('unrealised R at the last close', openR(pos({ last: 110 })), 1);
eq('no last close, no R', openR(pos({ last: null })), null);
eq('no fill, no R', openR(pos({ fill: null, last: 110 })), null);

done('track arithmetic');

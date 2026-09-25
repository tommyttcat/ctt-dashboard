/* scripts/trackPlan.test.mts — the record kept the way the picks are presented.
 *
 * Every rule here is a sentence the site says to readers ("buy above X",
 * "don't chase", "out below Y"), so each one is pinned: if the record and the
 * words ever disagree, the record is the thing that is wrong.
 */

import {
  newPlanPosition, stepPlan, foldPlan, markFilled, isResolved, weekOf, PLAN_VALID_SESSIONS,
  type PlanPosition, type PlanResults,
} from '../src/lib/trackPlan.ts';
import { HOLD_SESSIONS } from '../src/lib/track.ts';
import { eq, near, done } from './testkit.mts';

const plan = (o: Record<string, unknown> = {}) => ({ tradeable: true, collapsed: false, overextended: false, trigger: 100, stop: 95, ...o });
const row = (o: Record<string, unknown> = {}) => ({ ticker: 'ABC', price: 98, adrPct: 4, plan: plan(), ...o });
const bar = (o: number, h: number, l: number, c: number) => ({ o, h, l, c });
const pos = (o: Record<string, unknown> = {}, scan = 'daily') => newPlanPosition(scan, row(o), '2026-09-24', 'green') as PlanPosition;

// ---- what gets recorded -----------------------------------------------------
eq('a waiting pick is recorded', pos()?.state, 'watching');
eq('it keeps the plan levels', `${pos().buy}/${pos().stop}`, '100/95');
eq('EXT is not recorded (the site says do not chase)', newPlanPosition('daily', row({ plan: plan({ overextended: true }) }), 'd', null), null);
eq('MISS is not recorded', newPlanPosition('daily', row({ price: 106 }), 'd', null), null);
eq('OUT is not recorded', newPlanPosition('daily', row({ price: 94 }), 'd', null), null);
eq('a collapsed plan is not recorded', newPlanPosition('daily', row({ plan: plan({ collapsed: true }) }), 'd', null), null);
eq('a table without levels is not recorded', newPlanPosition('hrs', row(), 'd', null), null);
eq('EP9M is a dip plan', newPlanPosition('ep9m', row({ price: 103 }), 'd', null)?.dip, true);
eq('VCP reads its top-level levels', newPlanPosition('vcp', { symbol: 'V', price: 97, trigger: 100, stop: 94, atrPct: 3 }, 'd', null)?.buy, 100);
eq('VCP falls back to ATR for the chase line', newPlanPosition('vcp', { symbol: 'V', price: 97, trigger: 100, stop: 94, atrPct: 3 }, 'd', null)?.adr, 3);

// ---- the fill -----------------------------------------------------------------
{
  const p = pos();
  eq('below the level: still watching', stepPlan(p, bar(98, 99.5, 97, 99), 'd1'), false);
  eq('state', p.state, 'watching');
  eq('trades through the level: filled', stepPlan(p, bar(99, 101, 98.5, 100.8), 'd2'), true);
  eq('filled at the level, not the high', p.fill, 100);
  eq('fill date', p.fillDate, 'd2');
}
{
  const p = pos();
  stepPlan(p, bar(101.5, 103, 101, 102), 'd1');
  eq('opens through the level, within a day: fills at the open', p.fill, 101.5);
}
{
  const p = pos();
  stepPlan(p, bar(105, 106, 104.5, 105), 'd1');
  eq('opens more than a normal day past the level: missed, not bought', p.state, 'missed');
  eq('a miss has no R', p.r, null);
}
{
  const p = pos();
  stepPlan(p, bar(97, 97.5, 94.5, 95), 'd1');
  eq('stop before the level: failed', p.state, 'failed');
}
{
  const p = pos();
  for (let i = 0; i < PLAN_VALID_SESSIONS; i++) stepPlan(p, bar(97, 98, 96, 97), `d${i}`);
  eq('never reaches the level in the window: expired', p.state, 'expired');
}
{
  const p = pos({ price: 103, plan: plan({ trigger: 100, stop: 95 }) }, 'ep9m');
  stepPlan(p, bar(102, 102.5, 99, 101), 'd1');
  eq('dip plan fills on the way down, at the level', p.fill, 100);
  const q = pos({ price: 103 }, 'ep9m');
  stepPlan(q, bar(98, 99, 97, 98.5), 'd1');
  eq('dip plan that opens below the level fills at the open', q.fill, 98);
  const g = pos({ price: 103 }, 'ep9m');
  stepPlan(g, bar(94, 96, 93, 95), 'd1');
  eq('dip plan that opens through the stop: failed', g.state, 'failed');
}

// ---- the exit -----------------------------------------------------------------
{
  const p = pos();
  stepPlan(p, bar(99, 101, 98.5, 100.5), 'd1');     // fill 100, stop 95, target 110
  stepPlan(p, bar(101, 111, 100, 109), 'd2');
  eq('2R reached: target', p.state, 'target');
  near('target is +2R', p.r, 2);
}
{
  const p = pos();
  stepPlan(p, bar(99, 101, 98.5, 100.5), 'd1');
  stepPlan(p, bar(96, 97, 94, 95), 'd2');
  eq('stop reached: stopped', p.state, 'stopped');
  near('a stop is -1R', p.r, -1);
}
{
  const p = pos();
  stepPlan(p, bar(99, 101, 98.5, 100.5), 'd1');
  stepPlan(p, bar(92, 93, 90, 91), 'd2');
  near('a gap through the stop exits at the open, worse than -1R', p.r, -1.6);
}
{
  const p = pos();
  stepPlan(p, bar(99, 101, 94, 96), 'd1');
  eq('fill and stop in one bar counts as stopped', p.state, 'stopped');
}
{
  const p = pos();
  stepPlan(p, bar(99, 101, 98.5, 100.5), 'd1');
  for (let i = 0; i < HOLD_SESSIONS; i++) stepPlan(p, bar(102, 103, 101, 102), `h${i}`);
  eq('neither in the window: closes at the close', p.state, 'timeout');
  near('scored on that close', p.r, 0.4);
}

// ---- the running record ----------------------------------------------------------
{
  const res: PlanResults = { startedOn: 'd', byScan: {}, recent: [] };
  const win = pos(); stepPlan(win, bar(99, 101, 98.5, 100.5), 'd1'); stepPlan(win, bar(101, 111, 100, 109), 'd2');
  const loss = pos(); stepPlan(loss, bar(99, 101, 98.5, 100.5), 'd1'); stepPlan(loss, bar(96, 97, 94, 95), 'd2');
  const miss = pos(); stepPlan(miss, bar(105, 106, 104.5, 105), 'd1');
  for (const p of [win, loss, miss]) { eq(`${p.state} is resolved`, isResolved(p), true); foldPlan(res, p); }
  const r = res.byScan.daily;
  eq('two closed trades', r.closed, 2);
  eq('one winner', r.wins, 1);
  near('sum of R is exact', r.sumR, 1);
  eq('the miss is counted apart, not as a trade', r.missed, 1);
  eq('recent lists trades only, newest first', res.recent.map(p => p.state).join(','), 'stopped,target');
}

// ---- weeks ---------------------------------------------------------------------
eq('weekOf: a Thursday belongs to its Monday', weekOf('2026-09-24'), '2026-09-21');
eq('weekOf: a Monday is its own week', weekOf('2026-09-21'), '2026-09-21');
eq('weekOf: a Sunday belongs to the Monday before', weekOf('2026-09-27'), '2026-09-21');
{
  const res: PlanResults = { startedOn: 'd', byScan: {}, recent: [] };
  const a = pos(); stepPlan(a, bar(99, 101, 98.5, 100.5), '2026-09-24'); markFilled(res, a);
  stepPlan(a, bar(101, 111, 100, 109), '2026-09-28'); foldPlan(res, a);
  const m = pos(); stepPlan(m, bar(105, 106, 104.5, 105), '2026-09-25'); foldPlan(res, m);
  eq('fill counts in the week it filled', res.byWeek?.['2026-09-21']?.reached, 1);
  eq('a miss counts in the week it resolved', res.byWeek?.['2026-09-21']?.missed, 1);
  eq('the close counts in the week it closed', res.byWeek?.['2026-09-28']?.closed, 1);
  near('with its R', res.byWeek?.['2026-09-28']?.sumR, 2);
}

done('track plan');

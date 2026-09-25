/* scripts/alerts.test.mts — watchlist alerts fire on the move into HIT or OUT,
 * once per kind per day, never on the first (seeding) check, and only to the
 * people watching that name. */

import { statusesFor, computeAlerts, normaliseIndex, type AlertState } from '../src/lib/alerts.ts';
import { eq, done } from './testkit.mts';

const plan = (o: Record<string, unknown> = {}) => ({ tradeable: true, collapsed: false, overextended: false, trigger: 100, stop: 95, ...o });
const rows = (price: number, extra: Record<string, unknown> = {}) => ({
  stocks_in_play_v6: [{ ticker: 'ABC', price, adrPct: 4, plan: plan(), ...extra }],
  ep9m_v1: [{ ticker: 'DIP', price: 99, adrPct: 4, plan: plan({ trigger: 100, stop: 90 }) }],
  vcp_v1: [{ symbol: 'VVV', price: 97, trigger: 100, stop: 94, atrPct: 3 }],
});
const want = new Set(['ABC', 'DIP', 'VVV', 'NOPE']);
const index = { 'a@x.com': ['ABC', 'VVV'], 'b@x.com': ['DIP'], 'c@x.com': ['NOPE'] };

// ---- statuses -------------------------------------------------------------------
{
  const s = statusesFor(rows(98), want);
  eq('breakout below its level is waiting', s.get('ABC')?.status, 'wait');
  eq('EP9M below its dip level is HIT', s.get('DIP')?.status, 'hit');
  eq('VCP reads top-level levels', s.get('VVV')?.buy, 100);
  eq('a name on no scan has no status', s.has('NOPE'), false);
  eq('the scan label rides along', s.get('ABC')?.scan, 'Stocks in Play');
}

// ---- firing -----------------------------------------------------------------------
{
  const first = computeAlerts(index, statusesFor(rows(100.5), want), {}, '2026-09-25');
  eq('first ever check only records', Object.keys(first.byEmail).length, 0);
  eq('…but remembers the status', first.state.ABC.status, 'hit');

  let state: AlertState = computeAlerts(index, statusesFor(rows(98), want), { seeded: { status: 'x' } }, '2026-09-25').state;
  const hit = computeAlerts(index, statusesFor(rows(100.5), want), state, '2026-09-25');
  eq('moving into HIT alerts the watcher', hit.byEmail['a@x.com']?.map(a => `${a.ticker}:${a.kind}`).join(','), 'ABC:hit');
  eq('someone not watching it gets nothing for it', hit.byEmail['c@x.com'], undefined);
  state = hit.state;

  const again = computeAlerts(index, statusesFor(rows(100.6), want), state, '2026-09-25');
  eq('staying at HIT does not alert again', again.byEmail['a@x.com'], undefined);

  const back = computeAlerts(index, statusesFor(rows(98), want), again.state, '2026-09-25');
  const reHit = computeAlerts(index, statusesFor(rows(100.5), want), back.state, '2026-09-25');
  eq('HIT, back, HIT again the same day: no second alert', reHit.byEmail['a@x.com'], undefined);

  const nextDay = computeAlerts(index, statusesFor(rows(98), want), reHit.state, '2026-09-26');
  const hitTomorrow = computeAlerts(index, statusesFor(rows(100.5), want), nextDay.state, '2026-09-26');
  eq('a new day can alert HIT again', hitTomorrow.byEmail['a@x.com']?.[0]?.kind, 'hit');

  const out = computeAlerts(index, statusesFor(rows(94), want), hitTomorrow.state, '2026-09-26');
  eq('falling below the stop alerts OUT', out.byEmail['a@x.com']?.[0]?.kind, 'out');
}

// ---- index normalisation ---------------------------------------------------------------
eq('JSON-string values are parsed', normaliseIndex({ 'a@x.com': '["abc","def"]' })['a@x.com'].join(','), 'ABC,DEF');
eq('array values pass through', normaliseIndex({ 'a@x.com': ['xyz'] })['a@x.com'].join(','), 'XYZ');
eq('junk becomes an empty list, not a throw', normaliseIndex({ 'a@x.com': '{oops' })['a@x.com'].length, 0);

done('alerts');

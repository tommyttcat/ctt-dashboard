// scripts/backtest/score-ep9m.ts — what each replayed EP9M flag did next.
//
// Run from trade-dash after replay-ep9m.ts:  npx tsx scripts/backtest/score-ep9m.ts
// Reads  CTT/backtest-data/replay/ep9m_v1_registry.jsonl + the bar cache
// Writes CTT/backtest-data/replay/ep9m_v1_outcomes.jsonl
//
// RULES — fixed on 11 Sep 2026 BEFORE any outcome was looked at. Changing them
// after seeing results is how a backtest gets fitted to its own answer.
//
//   Entry     The plan trigger must trade within ENTRY_WINDOW sessions after
//             the flag. Fill = trigger, or the open if it gaps above. Never
//             triggered = no_trade, kept in the population.
//   Stop      The plan stop. Gap through it exits at the open, not the stop.
//   Ambiguity Daily bars cannot order a same-day stop and target. Any session
//             that touches both counts as the stop — including the entry day,
//             where the low may have come before the fill.
//   Home run  +50% OR +10R from the fill within HOLD sessions.
//               homeRunHeld = reached BEFORE the stop (tradeable)
//               homeRunPath = reached at all (the stock ran; you may be out)
//   Exits     fixedTarget  plan target vs stop, else close of day HOLD
//             trail10      stop until the first close below the 10 EMA (from day 2)
//             trail21      same on the 21 EMA
//             hold20       stop, else close of day 20
//   Costs     none — commissions and slippage are not modelled.
//   Maturity  flags without a full ENTRY_WINDOW + HOLD of future bars are
//             written as `maturing` and excluded from statistics.

import fs from 'node:fs';
import path from 'node:path';
import { DATA, loadAdjusted } from './cache';
import { ema } from '@/lib/indicators/marketMath';

const ENTRY_WINDOW = 5;
const HOLD = 60;
const HR_PCT = 0.5;
const HR_R = 10;

const REPLAY = path.join(DATA, 'replay');

type Exit = { r: number; pct: number; days: number; how: string };

function main() {
  const t0 = Date.now();
  const cache = loadAdjusted();
  const { sessions, idOf, O, H, L, C } = cache;
  const N = sessions.length;
  const lines = fs.readFileSync(path.join(REPLAY, 'ep9m_v1_registry.jsonl'), 'utf8').trim().split('\n');
  const out = fs.createWriteStream(path.join(REPLAY, 'ep9m_v1_outcomes.jsonl'));
  const tally: Record<string, number> = {};
  const bump = (k: string) => { tally[k] = (tally[k] || 0) + 1; };

  for (const line of lines) {
    const e = JSON.parse(line);
    const s: number = e.sIdx;
    const id = idOf.get(e.ticker);
    const base: Record<string, unknown> = { date: e.date, ticker: e.ticker, inFinal: e.inFinal };
    const trigger: number | null = e.plan?.trigger ?? null;
    const stop: number | null = e.plan?.stop ?? null;
    const target: number | null = e.plan?.target ?? null;

    if (id === undefined) { out.write(JSON.stringify({ ...base, status: 'no_data' }) + '\n'); bump('no_data'); continue; }
    if (s + ENTRY_WINDOW + HOLD > N - 1) {
      out.write(JSON.stringify({ ...base, status: 'maturing' }) + '\n'); bump('maturing'); continue;
    }

    /* Plan-free forward path from the next session's open. Every flag gets
       it — including change-gated names, whose plans collapse on a red day —
       so the change gate itself can be judged like for like. */
    const fwd = (() => {
      const o1 = O[id][s + 1];
      if (!(o1 > 0)) return null;
      let hi = -Infinity, lo = Infinity;
      const retAt: Record<string, number | null> = { ret5: null, ret20: null, ret60: null };
      let k = 0;
      for (let j = s + 1; j <= s + HOLD; j++) {
        if (Number.isNaN(C[id][j])) continue;
        k++;
        hi = Math.max(hi, H[id][j]); lo = Math.min(lo, L[id][j]);
        if (k === 5) retAt.ret5 = +((C[id][j] / o1 - 1) * 100).toFixed(2);
        if (k === 20) retAt.ret20 = +((C[id][j] / o1 - 1) * 100).toFixed(2);
        if (k === HOLD) retAt.ret60 = +((C[id][j] / o1 - 1) * 100).toFixed(2);
      }
      return { ...retAt, run60: +((hi / o1 - 1) * 100).toFixed(2), dd60: +((lo / o1 - 1) * 100).toFixed(2) };
    })();
    base.fwd = fwd;

    if (trigger == null || stop == null || !(trigger > stop)) {
      out.write(JSON.stringify({ ...base, status: 'no_plan' }) + '\n'); bump('no_plan'); continue;
    }

    // Entry.
    let ei = -1, fill = 0;
    for (let j = s + 1; j <= s + ENTRY_WINDOW; j++) {
      if (Number.isNaN(C[id][j])) continue;
      if (H[id][j] >= trigger) { ei = j; fill = Math.max(trigger, O[id][j]); break; }
    }
    if (ei < 0) { out.write(JSON.stringify({ ...base, status: 'no_trade' }) + '\n'); bump('no_trade'); continue; }

    const risk = fill - stop;
    const hrLevel = Math.min(fill * (1 + HR_PCT), fill + HR_R * risk);
    const last = Math.min(N - 1, ei + HOLD - 1);

    // Closes before the entry, for the trailing EMAs.
    const hist: number[] = [];
    for (let j = Math.max(0, s - 300); j < ei; j++) if (!Number.isNaN(C[id][j])) hist.push(C[id][j]);

    let peak = fill, stopHitDay = -1, hrHeld = false, hrPath = false;
    const exits: Record<string, Exit | null> = { fixedTarget: null, trail10: null, trail21: null, hold20: null };
    const stopExit = (j: number): number => Math.min(stop, O[id][j]); // gap through the stop fills at the open
    const mk = (px: number, day: number, how: string): Exit => ({ r: +((px - fill) / risk).toFixed(3), pct: +((px / fill - 1) * 100).toFixed(2), days: day, how });

    let day = 0, lastClose = fill;
    for (let j = ei; j <= last; j++) {
      if (Number.isNaN(C[id][j])) continue;        // halted / not traded
      day++;
      const lo = L[id][j], hi = H[id][j], cl = C[id][j];
      const stopToday = lo <= stop;
      const openAt = j === ei ? fill : O[id][j];
      hist.push(cl);
      lastClose = cl;

      if (hi > peak) peak = hi;
      if (hi >= hrLevel) hrPath = true;

      // Home run held: first passage against the stop, stop wins a tie.
      if (stopHitDay < 0 && !hrHeld) {
        if (stopToday) stopHitDay = day;
        else if (hi >= hrLevel) hrHeld = true;
      }

      // Fixed target.
      if (!exits.fixedTarget) {
        if (stopToday) exits.fixedTarget = mk(j === ei ? stop : stopExit(j), day, 'stop');
        else if (target != null && hi >= target) exits.fixedTarget = mk(Math.max(target, openAt), day, 'target');
      }
      // Trailing EMAs — the stop protects until the first close under the average.
      for (const [key, len] of [['trail10', 10], ['trail21', 21]] as const) {
        if (exits[key]) continue;
        if (stopToday) { exits[key] = mk(j === ei ? stop : stopExit(j), day, 'stop'); continue; }
        const e2 = ema(hist, len);
        if (day >= 2 && e2 != null && cl < e2) exits[key] = mk(cl, day, 'ema');
      }
      // 20-session hold.
      if (!exits.hold20) {
        if (stopToday) exits.hold20 = mk(j === ei ? stop : stopExit(j), day, 'stop');
        else if (day >= 20) exits.hold20 = mk(cl, day, 'time');
      }
    }
    for (const k of Object.keys(exits)) if (!exits[k]) exits[k] = mk(lastClose, day, 'time');

    const peakPct = +((peak / fill - 1) * 100).toFixed(2);
    out.write(JSON.stringify({
      ...base, status: 'traded', entryDelay: ei - s, gapFill: fill > trigger,
      fill: +fill.toFixed(4), stop, target, riskPct: +((risk / fill) * 100).toFixed(2),
      peakPct, peakR: +((peak - fill) / risk).toFixed(2),
      homeRunHeld: hrHeld, homeRunPath: hrPath, stoppedDay: stopHitDay > 0 ? stopHitDay : null,
      exits,
    }) + '\n');
    bump('traded');
  }
  out.end();
  console.log(`scored ${lines.length} flags in ${((Date.now() - t0) / 1000).toFixed(0)}s:`, JSON.stringify(tally));
}

main();

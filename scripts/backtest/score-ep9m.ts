// scripts/backtest/score-ep9m.ts — what each replayed EP9M flag did next.
//
// Run from trade-dash after replay-ep9m.ts:  npx tsx scripts/backtest/score-ep9m.ts [v1|v2]
// Reads  CTT/backtest-data/replay/ep9m_<v>_registry.jsonl + the bar cache
// Writes CTT/backtest-data/replay/ep9m_<v>_outcomes.jsonl
//
// RULES — the `plan` entry and every exit were fixed on 11 Sep 2026 BEFORE any
// outcome was looked at; the `open1` and `pullback` entries were fixed later
// that day, after v1 results but BEFORE any v2 result existed. Changing rules
// after seeing results is how a backtest gets fitted to its own answer.
//
//   Entries (each simulated independently on every flag)
//     plan      The plan trigger must trade within ENTRY_WINDOW sessions after
//               the flag. Fill = trigger, or the open if it gaps above.
//               Stop and target = the plan's.
//     open1     Buy the open of the first session after the flag. Stop = the
//               EP day's low; target = fill + 2R. No trade if the open is at or
//               below that low.
//     pullback  Sessions 2..PULLBACK_WINDOW after the flag: buy the first
//               touch of the EP day's midpoint (open if it gaps below the mid
//               but stays above the low). Stop = EP-day low; target = 2R. A
//               close below the EP low before any fill cancels the setup.
//     Never filled = no_trade, kept in the population.
//   Stop        Gap through it exits at the open, not the stop.
//   Ambiguity   Daily bars cannot order a same-day stop and target. Any session
//               that touches both counts as the stop — including the entry day.
//   Home run    +50% OR +10R from the fill within HOLD sessions.
//                 homeRunHeld = reached BEFORE the stop (tradeable)
//                 homeRunPath = reached at all (the stock ran; you may be out)
//   Exits       fixedTarget  target vs stop, else close of day HOLD
//               trail10      stop until the first close below the 10 EMA (from day 2)
//               trail21      same on the 21 EMA
//               hold20       stop, else close of day 20
//   Costs       none — commissions and slippage are not modelled (see simulate.ts).
//   Maturity    flags without PULLBACK_WINDOW + HOLD sessions of future bars are
//               `maturing` and excluded from statistics.

import fs from 'node:fs';
import path from 'node:path';
import { DATA, loadAdjusted } from './cache';
import { simulate, forwardPath, HOLD } from './simulate';

const VERSION = process.argv[2] === 'v2' ? 'v2' : 'v1';
const ENTRY_WINDOW = 5;
const PULLBACK_WINDOW = 10;
const ALT_TARGET_R = 2;

const REPLAY = path.join(DATA, 'replay');

function main() {
  const t0 = Date.now();
  const cache = loadAdjusted();
  const { sessions, idOf, O, H, L, C } = cache;
  const N = sessions.length;
  const lines = fs.readFileSync(path.join(REPLAY, `ep9m_${VERSION}_registry.jsonl`), 'utf8').trim().split('\n');
  const out = fs.createWriteStream(path.join(REPLAY, `ep9m_${VERSION}_outcomes.jsonl`));
  const tally: Record<string, number> = {};
  const bump = (k: string) => { tally[k] = (tally[k] || 0) + 1; };

  for (const line of lines) {
    const e = JSON.parse(line);
    const s: number = e.sIdx;
    const id = idOf.get(e.ticker);
    const base: Record<string, unknown> = { date: e.date, ticker: e.ticker, inFinal: e.inFinal };

    if (id === undefined) { out.write(JSON.stringify({ ...base, status: 'no_data' }) + '\n'); bump('no_data'); continue; }
    if (s + PULLBACK_WINDOW + HOLD > N - 1) { out.write(JSON.stringify({ ...base, status: 'maturing' }) + '\n'); bump('maturing'); continue; }

    /* Plan-free forward path from the next session's open — every flag gets
       it, including change-gated names whose plans collapse on a red day. */
    base.fwd = forwardPath(cache, id, s);

    const entries: Record<string, Record<string, unknown>> = {};

    // plan — the dashboard's own trade plan.
    const trigger: number | null = e.plan?.trigger ?? null;
    const pStop: number | null = e.plan?.stop ?? null;
    if (trigger == null || pStop == null || !(trigger > pStop)) entries.plan = { status: 'no_plan' };
    else {
      let ei = -1, fill = 0;
      for (let j = s + 1; j <= s + ENTRY_WINDOW; j++) {
        if (Number.isNaN(C[id][j])) continue;
        if (H[id][j] >= trigger) { ei = j; fill = Math.max(trigger, O[id][j]); break; }
      }
      entries.plan = ei < 0 ? { status: 'no_trade' } : simulate(cache, id, s, ei, fill, pStop, e.plan?.target ?? null);
    }

    // open1 — next session's open, stop at the EP-day low.
    const epLow = L[id][s], epHigh = H[id][s];
    {
      let ei = -1;
      for (let j = s + 1; j <= s + ENTRY_WINDOW; j++) if (!Number.isNaN(C[id][j])) { ei = j; break; }
      const fill = ei >= 0 ? O[id][ei] : NaN;
      entries.open1 = !(fill > epLow) ? { status: 'no_trade' }
        : simulate(cache, id, s, ei, fill, epLow, fill + ALT_TARGET_R * (fill - epLow));
    }

    // pullback — first touch of the EP-day midpoint in sessions 2..10.
    {
      const mid = (epHigh + epLow) / 2;
      let ei = -1, fill = 0, seen = 0;
      for (let j = s + 1; j <= s + PULLBACK_WINDOW && j < N; j++) {
        if (Number.isNaN(C[id][j])) continue;
        seen++;
        if (seen >= 2 && L[id][j] <= mid && O[id][j] > epLow) { ei = j; fill = Math.min(mid, O[id][j]); break; }
        if (C[id][j] < epLow) break;   // setup failed before any fill
      }
      entries.pullback = ei < 0 || !(fill > epLow) ? { status: 'no_trade' }
        : simulate(cache, id, s, ei, fill, epLow, fill + ALT_TARGET_R * (fill - epLow));
    }

    for (const [k, v] of Object.entries(entries)) bump(`${k}:${v.status}`);
    out.write(JSON.stringify({ ...base, status: 'scored', entries }) + '\n');
  }
  out.end();
  console.log(`scored ${lines.length} ${VERSION} flags in ${((Date.now() - t0) / 1000).toFixed(0)}s:`, JSON.stringify(tally));
}

main();

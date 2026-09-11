// scripts/backtest/score-scanner.ts — what each SIP / Daily Setup row did next.
//
// Run from trade-dash after replay-scanner.ts:  npx tsx scripts/backtest/score-scanner.ts
// Writes CTT/backtest-data/replay/scanner_outcomes.jsonl
//
// RULES — fixed 11 Sep 2026 BEFORE any scanner outcome was read.
//   Entries
//     plan       The row's own trade plan (trigger, stop, target) when the
//                planner marked it tradeable; trigger must trade within
//                ENTRY_WINDOW sessions. Fill = trigger, or the open if it gaps
//                above.
//     highBreak  Break of the SIGNAL DAY's high within ENTRY_WINDOW sessions,
//                stop under the signal day's low, target 2R. The generic
//                momentum-continuation trade.
//     open1      Buy the next session's open, same stop and 2R target — the
//                "act immediately" comparison.
//   Everything else (gap fills, same-day ambiguity, four exits, +50%/10R home
//   run) is shared in simulate.ts. Costs are not modelled.

import fs from 'node:fs';
import path from 'node:path';
import { DATA, loadAdjusted } from './cache';
import { simulate, forwardPath, HOLD } from './simulate';

const ENTRY_WINDOW = 5;
const ALT_TARGET_R = 2;
const REPLAY = path.join(DATA, 'replay');

function main() {
  const t0 = Date.now();
  const cache = loadAdjusted();
  const { sessions, idOf, O, H, L, C } = cache;
  const N = sessions.length;
  const lines = fs.readFileSync(path.join(REPLAY, 'scanner_registry.jsonl'), 'utf8').trim().split('\n');
  const out = fs.createWriteStream(path.join(REPLAY, 'scanner_outcomes.jsonl'));
  const tally: Record<string, number> = {};
  const bump = (k: string) => { tally[k] = (tally[k] || 0) + 1; };

  for (const line of lines) {
    const e = JSON.parse(line);
    const s: number = e.sIdx;
    const id = idOf.get(e.ticker);
    const base: Record<string, unknown> = { date: e.date, ticker: e.ticker, inSip: e.inSip, inDaily: e.inDaily, setupName: e.setupName };

    if (id === undefined) { out.write(JSON.stringify({ ...base, status: 'no_data' }) + '\n'); bump('no_data'); continue; }
    if (s + ENTRY_WINDOW + HOLD > N - 1) { out.write(JSON.stringify({ ...base, status: 'maturing' }) + '\n'); bump('maturing'); continue; }

    base.fwd = forwardPath(cache, id, s);
    const entries: Record<string, Record<string, unknown>> = {};
    const dayHigh = H[id][s], dayLow = L[id][s];

    // plan — what the dashboard tells the member to do.
    const trigger: number | null = e.plan?.tradeable ? (e.plan.trigger ?? null) : null;
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

    // highBreak — signal-day high, stop under the signal-day low.
    if (!(dayHigh > dayLow)) entries.highBreak = { status: 'no_levels' };
    else {
      let ei = -1, fill = 0;
      for (let j = s + 1; j <= s + ENTRY_WINDOW; j++) {
        if (Number.isNaN(C[id][j])) continue;
        if (H[id][j] >= dayHigh) { ei = j; fill = Math.max(dayHigh, O[id][j]); break; }
      }
      entries.highBreak = ei < 0 ? { status: 'no_trade' }
        : simulate(cache, id, s, ei, fill, dayLow, fill + ALT_TARGET_R * (fill - dayLow));
    }

    // open1 — next open.
    {
      let ei = -1;
      for (let j = s + 1; j <= s + ENTRY_WINDOW; j++) if (!Number.isNaN(C[id][j])) { ei = j; break; }
      const fill = ei >= 0 ? O[id][ei] : NaN;
      entries.open1 = !(fill > dayLow) ? { status: 'no_trade' }
        : simulate(cache, id, s, ei, fill, dayLow, fill + ALT_TARGET_R * (fill - dayLow));
    }

    for (const [k, v] of Object.entries(entries)) bump(`${k}:${v.status}`);
    out.write(JSON.stringify({ ...base, status: 'scored', entries }) + '\n');
  }
  out.end();
  console.log(`scored ${lines.length} scanner rows in ${((Date.now() - t0) / 1000).toFixed(0)}s:`, JSON.stringify(tally));
}

main();

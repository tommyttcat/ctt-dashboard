// scripts/backtest/score-swing.ts — what each swing candidate did next.
//
// Run from trade-dash after replay-swing.ts:  npx tsx scripts/backtest/score-swing.ts
// Writes CTT/backtest-data/replay/swing_outcomes.jsonl
//
// RULES — fixed 11 Sep 2026 BEFORE any HRS outcome was read.
//   Entries
//     open1      Buy the next session's open. Stop = the plan's stop when the
//                planner marked the row tradeable, else the signal day's low.
//                Target = fill + 2R.
//     highBreak  Break of the signal day's high within ENTRY_WINDOW sessions,
//                same stop and 2R target.
//   Everything else (gaps, same-day ambiguity, the four exits, +50%/10R home
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
  const { sessions, idOf, O, H, C } = cache;
  const N = sessions.length;
  const lines = fs.readFileSync(path.join(REPLAY, 'swing_registry.jsonl'), 'utf8').trim().split('\n');
  const out = fs.createWriteStream(path.join(REPLAY, 'swing_outcomes.jsonl'));
  const tally: Record<string, number> = {};
  const bump = (k: string) => { tally[k] = (tally[k] || 0) + 1; };

  for (const line of lines) {
    const e = JSON.parse(line);
    const s: number = e.sIdx;
    const id = idOf.get(e.ticker);
    const base: Record<string, unknown> = { date: e.date, ticker: e.ticker, score: e.score, grade: e.grade };
    if (id === undefined) { out.write(JSON.stringify({ ...base, status: 'no_data' }) + '\n'); bump('no_data'); continue; }
    if (s + ENTRY_WINDOW + HOLD > N - 1) { out.write(JSON.stringify({ ...base, status: 'maturing' }) + '\n'); bump('maturing'); continue; }

    base.fwd = forwardPath(cache, id, s);
    const stop: number | null = (e.plan?.tradeable ? e.plan?.stop : null) ?? e.dayLow ?? null;
    const entries: Record<string, Record<string, unknown>> = {};

    if (stop == null) { entries.open1 = { status: 'no_levels' }; entries.highBreak = { status: 'no_levels' }; }
    else {
      let oi = -1;
      for (let j = s + 1; j <= s + ENTRY_WINDOW; j++) if (!Number.isNaN(C[id][j])) { oi = j; break; }
      const oFill = oi >= 0 ? O[id][oi] : NaN;
      entries.open1 = !(oFill > stop) ? { status: 'no_trade' }
        : simulate(cache, id, s, oi, oFill, stop, oFill + ALT_TARGET_R * (oFill - stop));

      let ei = -1, fill = 0;
      for (let j = s + 1; j <= s + ENTRY_WINDOW; j++) {
        if (Number.isNaN(C[id][j])) continue;
        if (H[id][j] >= e.dayHigh) { ei = j; fill = Math.max(e.dayHigh, O[id][j]); break; }
      }
      entries.highBreak = ei < 0 || !(fill > stop) ? { status: 'no_trade' }
        : simulate(cache, id, s, ei, fill, stop, fill + ALT_TARGET_R * (fill - stop));
    }

    for (const [k, v] of Object.entries(entries)) bump(`${k}:${v.status}`);
    out.write(JSON.stringify({ ...base, status: 'scored', entries }) + '\n');
  }
  out.end();
  console.log(`scored ${lines.length} swing rows in ${((Date.now() - t0) / 1000).toFixed(0)}s:`, JSON.stringify(tally));
}

main();

// scripts/backtest/score-consolidation.ts — what each replayed VCP base did next.
//
// Run from trade-dash after replay-consolidation.ts:  npx tsx scripts/backtest/score-consolidation.ts
// Reads  CTT/backtest-data/replay/consol_registry.jsonl + the bar cache
// Writes CTT/backtest-data/replay/consol_outcomes.jsonl
//
// RULES — fixed 11 Sep 2026 BEFORE any VCP outcome was looked at.
//
//   Entries
//     pivot   The scan's own trade plan: the coil's range high must trade
//             within ENTRY_WINDOW sessions of the flag. Fill = trigger, or the
//             open if it gaps above; stop and target are the plan's.
//             A coil is flagged daily while it holds, so this is measured from
//             each flag; statistics use first appearances (isNewBase).
//     open1   Buy the open of the next session with the same stop and a 2R
//             target — the "don't wait for the breakout" comparison.
//   Everything else (stops, gaps, same-day ambiguity, the four exits and the
//   +50%/10R home-run test) is shared with every other scan in simulate.ts.
//   Costs are not modelled.

import fs from 'node:fs';
import path from 'node:path';
import { DATA, loadAdjusted } from './cache';
import { simulate, forwardPath, HOLD } from './simulate';

const ENTRY_WINDOW = 20;      // bases take weeks; a breakout can be a month out
const ALT_TARGET_R = 2;
const REPLAY = path.join(DATA, 'replay');

function main() {
  const t0 = Date.now();
  const cache = loadAdjusted();
  const { sessions, idOf, O, H, C } = cache;
  const N = sessions.length;
  const lines = fs.readFileSync(path.join(REPLAY, 'consol_registry.jsonl'), 'utf8').trim().split('\n');
  const out = fs.createWriteStream(path.join(REPLAY, 'consol_outcomes.jsonl'));
  const tally: Record<string, number> = {};
  const bump = (k: string) => { tally[k] = (tally[k] || 0) + 1; };

  for (const line of lines) {
    const e = JSON.parse(line);
    const s: number = e.sIdx;
    const id = idOf.get(e.ticker);
    const base: Record<string, unknown> = { date: e.date, ticker: e.ticker, baseId: e.baseId, isNewBase: e.isNewBase };

    if (id === undefined) { out.write(JSON.stringify({ ...base, status: 'no_data' }) + '\n'); bump('no_data'); continue; }
    if (s + ENTRY_WINDOW + HOLD > N - 1) { out.write(JSON.stringify({ ...base, status: 'maturing' }) + '\n'); bump('maturing'); continue; }

    base.fwd = forwardPath(cache, id, s);
    const entries: Record<string, Record<string, unknown>> = {};
    const trigger: number | null = e.plan?.trigger ?? null;
    const stop: number | null = e.plan?.stop ?? null;

    if (trigger == null || stop == null || !(trigger > stop)) {
      entries.pivot = { status: 'no_levels' };
      entries.open1 = { status: 'no_levels' };
    } else {
      let ei = -1, fill = 0;
      for (let j = s + 1; j <= s + ENTRY_WINDOW; j++) {
        if (Number.isNaN(C[id][j])) continue;
        if (H[id][j] >= trigger) { ei = j; fill = Math.max(trigger, O[id][j]); break; }
      }
      entries.pivot = ei < 0 ? { status: 'no_trade' } : simulate(cache, id, s, ei, fill, stop, e.plan?.target ?? null);

      let oi = -1;
      for (let j = s + 1; j <= s + 3; j++) if (!Number.isNaN(C[id][j])) { oi = j; break; }
      const oFill = oi >= 0 ? O[id][oi] : NaN;
      entries.open1 = !(oFill > stop) ? { status: 'no_trade' }
        : simulate(cache, id, s, oi, oFill, stop, oFill + ALT_TARGET_R * (oFill - stop));
    }

    for (const [k, v] of Object.entries(entries)) bump(`${k}:${v.status}`);
    out.write(JSON.stringify({ ...base, status: 'scored', entries }) + '\n');
  }
  out.end();
  console.log(`scored ${lines.length} consolidation rows in ${((Date.now() - t0) / 1000).toFixed(0)}s:`, JSON.stringify(tally));
}

main();

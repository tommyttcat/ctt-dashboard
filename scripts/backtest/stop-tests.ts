// scripts/backtest/stop-tests.ts — are the EP9M and 10/21 stops in the right place?
//
// Run from trade-dash:  npx tsx scripts/backtest/stop-tests.ts
// Local bars only, no network, no KV.
//
// Measured live 27 Sep 2026: EP9M stops sit a median 18% under the price
// (up to 80% — the low of a day the stock ran 5x), 10/21 stops 1.6% (half a
// normal day's range). One is meaningless to a reader, the other is noise.
//
// RULES — fixed 27 Sep 2026 BEFORE running.
//   EP9M   the card's entry: first touch of the EP-day midpoint in sessions
//          2-10 (fill = min(mid, open)), EP flags on the final list from
//          26 Sep 2022. Stops compared:
//            CARD    the EP-day low (today)
//            CAP15   the higher of the EP-day low and fill - 1.5 x ADR%
//            CAP10   the higher of the EP-day low and fill - 1.0 x ADR%
//   10/21  coils (new bases) from 26 Sep 2022, bought at the next open (the
//          new at-the-averages entry). Stops compared:
//            CARD    the card's plan stop (today)
//            FLOOR   the lower of the card stop and fill - 1.0 x ADR%
//   Exits: hold 20 and trail 21 (shared simulate.ts). Split at 2025-05-16.
//   PASS: the new stop's per-trade avg R beats CARD in BOTH halves on BOTH
//   hold-20 and trail-21.

import fs from 'node:fs';
import path from 'node:path';
import { DATA, loadAdjusted } from './cache';
import { simulate } from './simulate';

const START = '2022-09-26';
const CUT = '2025-05-16';
const REPLAY = path.join(DATA, 'replay');
const read = (f: string) => fs.readFileSync(path.join(REPLAY, f), 'utf8').trim().split('\n').map(l => JSON.parse(l));

function main() {
  const c = loadAdjusted();
  const { sessions, idOf, O, H, L, C } = c;
  const N = sessions.length;
  type Acc = Record<string, { h20: number[][]; t21: number[][]; stopPct: number[] }>;
  const acc: Acc = {};
  const add = (key: string, half: 0 | 1, tr: any) => {
    const a = (acc[key] ||= { h20: [[], []], t21: [[], []], stopPct: [] });
    a.h20[half].push(tr.exits.hold20.r); a.t21[half].push(tr.exits.trail21.r); a.stopPct.push(tr.riskPct);
  };

  // ---- EP9M
  for (const e of read('ep9m_v2_registry.jsonl')) {
    if (!e.inFinal || e.date < START) continue;
    const id = idOf.get(e.ticker); if (id === undefined) continue;
    const s = e.sIdx; if (s + 70 >= N) continue;
    const epLow = L[id][s], mid = (H[id][s] + epLow) / 2;
    let ei = -1, fill = 0, seen = 0;
    for (let j = s + 1; j <= s + 10 && j < N; j++) {
      if (Number.isNaN(C[id][j])) continue;
      seen++;
      if (seen >= 2 && L[id][j] <= mid && O[id][j] > epLow) { ei = j; fill = Math.min(mid, O[id][j]); break; }
      if (C[id][j] < epLow) break;
    }
    if (ei < 0 || !(fill > epLow) || !(e.adrPct > 0)) continue;
    const half = e.date < CUT ? 0 : 1;
    const target = (st: number) => fill + 2 * (fill - st);
    add('EP9M CARD  (EP-day low)', half, simulate(c, id, s, ei, fill, epLow, target(epLow)));
    for (const [k, m] of [['CAP15', 1.5], ['CAP10', 1.0]] as const) {
      const st = Math.max(epLow, fill * (1 - (m * e.adrPct) / 100));
      add(`EP9M ${k} (max(low, fill-${m}xADR))`, half, simulate(c, id, s, ei, fill, st, target(st)));
    }
  }

  // ---- 10/21 coils bought at the next open
  for (const e of read('consol_registry.jsonl')) {
    if (!e.isNewBase || e.date < START) continue;
    const id = idOf.get(e.ticker); if (id === undefined) continue;
    const s = e.sIdx; if (s + 70 >= N) continue;
    const stop = e.plan?.stop; if (!(stop > 0) || !(e.adrPct > 0)) continue;
    let ei = -1; for (let j = s + 1; j <= s + 5 && j < N; j++) if (!Number.isNaN(C[id][j])) { ei = j; break; }
    const fill = ei >= 0 ? O[id][ei] : NaN;
    if (!(fill > stop)) continue;
    const half = e.date < CUT ? 0 : 1;
    add('10/21 CARD  (plan stop)', half, simulate(c, id, s, ei, fill, stop, fill + 2 * (fill - stop)));
    const fl = Math.min(stop, fill * (1 - e.adrPct / 100));
    add('10/21 FLOOR (min(stop, fill-1xADR))', half, simulate(c, id, s, ei, fill, fl, fill + 2 * (fill - fl)));
  }

  const m = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  const f = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(3);
  for (const [k, a] of Object.entries(acc)) {
    console.log(`${k.padEnd(40)} n ${a.h20[0].length} / ${a.h20[1].length} · stop ${med(a.stopPct).toFixed(1)}% median · hold20 ${f(m(a.h20[0]))} / ${f(m(a.h20[1]))} · trail21 ${f(m(a.t21[0]))} / ${f(m(a.t21[1]))}`);
  }
  const verdict = (newK: string, cardK: string) => {
    const n = acc[newK], b = acc[cardK];
    const ok = [0, 1].every(h => m(n.h20[h]) > m(b.h20[h]) && m(n.t21[h]) > m(b.t21[h]));
    console.log(`${newK} vs ${cardK}: ${ok ? 'PASS' : 'fail'}`);
  };
  verdict('EP9M CAP15 (max(low, fill-1.5xADR))', 'EP9M CARD  (EP-day low)');
  verdict('EP9M CAP10 (max(low, fill-1xADR))', 'EP9M CARD  (EP-day low)');
  verdict('10/21 FLOOR (min(stop, fill-1xADR))', '10/21 CARD  (plan stop)');
}

main();

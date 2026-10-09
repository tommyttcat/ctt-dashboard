// scripts/backtest/epn-equivalence.ts — does lib/epNeglect.ts run the tested rules?
//
//   npx tsx scripts/backtest/epn-equivalence.ts
//
// The forward paper record (/api/track/epn) uses lib/epNeglect; the 5-year
// test used scripts/backtest/ep-neglect.ts. This replays every gap day in
// the bar cache through the library and checks (1) it flags exactly the
// backtest's signals, and (2) every backtest trade that closed inside the
// data gets the same fill, stop and return from the library.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DATA, loadAdjusted } from './cache';
import { etMin, type Trade } from './qullamaggie';
import { epnDaily, epnEntry, epnEntryDay, epnStep, type DayBar, type EpnPosition, type Minute } from '@/lib/epNeglect';

const REPLAY = path.join(DATA, 'replay');
const c = loadAdjusted();
const { sessions, syms, O, H, L, C, V } = c;
const N = sessions.length;
const bar = (id: number, j: number): DayBar => ({ o: O[id][j], h: H[id][j], l: L[id][j], c: C[id][j], v: V[id][j] });

// (1) the signal set
const want = new Set(fs.readFileSync(path.join(REPLAY, 'epn_signals.jsonl'), 'utf8').trim().split('\n').map(l => { const s = JSON.parse(l); return `${s.ticker}|${s.date}`; }));
const got = new Set<string>();
for (let id = 0; id < syms.length; id++) {
  for (let g = 201; g < N; g++) {
    const o = O[id][g];
    if (!(o >= 5) || !(o >= 1.10 * C[id][g - 1])) continue;
    let gapInHist = false;
    for (let j = g - 200; j < g; j++) if (Number.isNaN(C[id][j])) { gapInHist = true; break; }
    if (gapInHist) continue;
    const hist: DayBar[] = [];
    for (let j = g - 200; j < g; j++) hist.push(bar(id, j));
    if (epnDaily(hist, o).ok) got.add(`${syms[id]}|${sessions[g]}`);
  }
}
const missing = [...want].filter(k => !got.has(k)), extra = [...got].filter(k => !want.has(k));
console.log(`signals: backtest ${want.size}, library ${got.size}, missing ${missing.length}, extra ${extra.length}`, missing.slice(0, 5), extra.slice(0, 5));

// (2) the trades
const trades: Trade[] = fs.readFileSync(path.join(REPLAY, 'epn_trades.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
let same = 0, diff = 0, skipped = 0;
for (const t of trades) {
  const id = c.idOf.get(t.ticker)!;
  const g = t.ei;
  const lastExit = Math.max(...t.exits.map(x => x[0]));
  if (lastExit >= N - 1) { skipped++; continue; }                     // still open at the data's end
  const hist: DayBar[] = [];
  for (let j = g - 200; j < g; j++) hist.push(bar(id, j));
  const chk = epnDaily(hist, O[id][g]);
  const f = path.join(DATA, 'minute', 'epn', t.date.slice(0, 4), `${t.ticker}_${t.date}.json.gz`);
  const mins: Minute[] = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString());
  const e = epnEntry(mins, etMin, chk.adv, chk.atr);
  if (!e.ok) { diff++; console.log('no entry', t.ticker, t.date, e.why); continue; }
  const pos: EpnPosition = {
    t: t.ticker, d: t.date, gap: chk.gap, fill: e.fill, stop: e.stop, stop0: e.stop, day: 1, left: 1,
    closes: [...hist.slice(-8).map(b => b.c), C[id][g]], exits: [], ret: null,
  };
  epnEntryDay(pos, mins, e.k);
  for (let s = g + 1; pos.left > 0 && s < N; s++) {
    if (Number.isNaN(C[id][s])) continue;
    epnStep(pos, bar(id, s), sessions[s]);
  }
  if (pos.left > 0) { skipped++; continue; }                         // still open in the library too (data ends)
  const ok = pos.ret != null && Math.abs(pos.ret - t.ret) < 1e-6 && Math.abs(pos.fill - t.fill) < 1e-9 && Math.abs(pos.stop0 - t.stop) < 1e-9;
  if (ok) same++; else { diff++; if (diff <= 5) console.log('DIFF', t.ticker, t.date, { lib: pos.ret, bt: t.ret, fill: [pos.fill, t.fill], stop: [pos.stop0, t.stop] }); }
}
console.log(`trades: ${same} identical, ${diff} different, ${skipped} skipped (open at the data's end)`);
if (missing.length || extra.length || diff) process.exitCode = 1;

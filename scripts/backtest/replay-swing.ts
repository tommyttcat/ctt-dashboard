// scripts/backtest/replay-swing.ts — Swing Candidates replay.
//
// Run from trade-dash:  npx tsx scripts/backtest/replay-swing.ts
// Writes CTT/backtest-data/replay/swing_{registry,sessions}.jsonl + meta.json
//
// Exact, through the same code production runs (lib/scans/consolidation's
// `analyze`, shared with app/api/swing-candidates/run):
//   - universe: symbol shape, $2-2000 on the PRIOR session's close, prior
//     session dollar volume >= SWING.minAvgDollarVol, ranked by that dollar
//     volume, top SWING.universeSize
//   - analyze() on 210+ sessions of history including the scan date: every
//     gate it applies (ATR band, off-high band, distance to the 21 EMA,
//     stochastic, trend structure, RS floor) and its score
//   - final list = what analyze returns, ranked by score
//
// Approximations:
//   - EOD only; the live scan reads the snapshot's intraday price.
//   - No earnings blackout (the live scan drops names reporting within
//     SWING.earningsBlackoutDays; that calendar cannot be rebuilt per date).
//   - Market-cap gate skipped and short interest is display-only here.
//   - RS rebuilt per session (see rs.ts).

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { APP, DATA, readDay, loadAdjusted } from './cache';
import { loadReference, refAt, isTradeableType } from './reference';
import { makeRsFor } from './rs';

import { SWING } from '@/lib/scanConfig';
import { analyze, type Bar, type SnapInfo } from '@/lib/scans/consolidation';
import type { RsLookup } from '@/lib/indicators/rs';
import { sma } from '@/lib/indicators/marketMath';

const OUT = path.join(DATA, 'replay');
const HISTORY = 260;

function main() {
  const t0 = Date.now();
  const cache = loadAdjusted();
  const { sessions, idOf, syms, H, L, C, V, barsOf } = cache;
  const N = sessions.length;
  console.log(`${N} sessions ${sessions[0]} → ${sessions[N - 1]}; ${syms.length} tickers in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  const ref = loadReference();
  const rsFor = makeRsFor(cache);
  const spy = idOf.get('SPY');

  fs.mkdirSync(OUT, { recursive: true });
  const regOut = fs.createWriteStream(path.join(OUT, 'swing_registry.jsonl'));
  const sesOut = fs.createWriteStream(path.join(OUT, 'swing_sessions.jsonl'));
  let rows = 0;

  const start = Math.max(HISTORY, 252);
  for (let s = start; s < N; s++) {
    const date = sessions[s];

    // Universe on the PRIOR session's close and dollar volume, as live.
    const ranked: { sym: string; dv: number }[] = [];
    for (const [T] of readDay('unadj', date)) {
      if (!/^[A-Z]{1,5}$/.test(T)) continue;
      const id = idOf.get(T);
      if (id === undefined || Number.isNaN(C[id][s]) || Number.isNaN(C[id][s - 1])) continue;
      const pc = C[id][s - 1], pv = V[id][s - 1];
      if (!(pc > 0) || !(pv > 0)) continue;
      if (pc < SWING.minPrice || pc > SWING.maxPrice) continue;
      const dv = pc * pv;
      if (dv < SWING.minAvgDollarVol) continue;
      ranked.push({ sym: T, dv });
    }
    ranked.sort((a, b) => b.dv - a.dv);
    const universe = ranked.slice(0, SWING.universeSize);

    const rs = rsFor(s - 1);
    const rsLookup = {
      available: true, asOf: sessions[s - 1], ageDays: 1, ranked: rs.sortedRaws.length,
      sortedRaws: rs.sortedRaws, reason: null,
      get: (sym: string) => rs.ratings.get(sym) ?? null,
    } as unknown as RsLookup;

    let typeDropped = 0, shortHistory = 0;
    const candidates: Record<string, unknown>[] = [];
    for (const { sym } of universe) {
      const rec = refAt(ref, sym, date);
      if (!isTradeableType(rec?.type)) { typeDropped++; continue; }
      const id = idOf.get(sym)!;
      const bars: Bar[] = barsOf(id, s - HISTORY, s);
      if (bars.length < 210) { shortHistory++; continue; }
      let prev = 0;
      for (let j = s - 1; j >= Math.max(0, s - 5); j--) if (!Number.isNaN(C[id][j])) { prev = C[id][j]; break; }
      const snap: SnapInfo = {
        vwap: null, livePrice: C[id][s], vol: V[id][s],
        changePct: prev > 0 ? ((C[id][s] - prev) / prev) * 100 : 0,
      };
      const row = analyze(sym, bars, rsLookup, {}, { results: [] }, snap);
      if (row) candidates.push({
        ...row, date, sIdx: s, ticker: sym, name: rec?.name ?? row.name,
        dayHigh: +H[id][s].toFixed(4), dayLow: +L[id][s].toFixed(4),
      });
    }

    candidates.sort((a, b) => (b.score as number) - (a.score as number));

    let regime: Record<string, unknown> = {};
    if (spy !== undefined) {
      const sc = barsOf(spy, s - 260, s).map(b => b.c);
      const px = sc[sc.length - 1], s50 = sma(sc, 50), s200 = sma(sc, 200);
      regime = {
        spyAbove50: s50 != null ? px > s50 : null,
        spyAbove200: s200 != null ? px > s200 : null,
      };
    }

    for (const row of candidates) { regOut.write(JSON.stringify({ ...row, ...regime }) + '\n'); rows++; }
    sesOut.write(JSON.stringify({
      date, universe: universe.length, typeDropped, shortHistory,
      candidates: candidates.length, rsUniverse: rs.sortedRaws.length, ...regime,
    }) + '\n');

    if ((s - start) % 100 === 0) {
      console.log(`${date}  candidates=${candidates.length} universe=${universe.length}  rows=${rows}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
  }

  regOut.end(); sesOut.end();
  let commit = 'unknown';
  try { commit = execSync('git rev-parse --short HEAD', { cwd: APP }).toString().trim(); } catch { /* not fatal */ }
  fs.writeFileSync(path.join(OUT, 'swing_meta.json'), JSON.stringify({
    scan: 'swing candidates', commit, generatedAt: new Date().toISOString(),
    firstScan: sessions[start], lastScan: sessions[N - 1], sessionsScanned: N - start, rows, gates: SWING,
    approximations: ['EOD only', 'no earnings blackout', 'no market-cap gate', 'reference-list type check'],
  }, null, 2));
  console.log(`DONE ${N - start} sessions, ${rows} rows in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main();

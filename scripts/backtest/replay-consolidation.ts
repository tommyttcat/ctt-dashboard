// scripts/backtest/replay-consolidation.ts — 10/21 Consolidation replay.
//
// Run from trade-dash:  npx tsx scripts/backtest/replay-consolidation.ts
// Writes CTT/backtest-data/replay/consol_{registry,sessions}.jsonl + meta.json
//
// Exact, through the same code production runs (lib/scans/consolidation):
//   - shortlistConsolidation over 45 sessions of market-wide bars, ending the
//     day BEFORE the scan (the live getGroupedSeries walks calendar days
//     back from yesterday), capped at GROUPED.shortlistSize
//   - analyzeConsolidation on ~210+ sessions of history INCLUDING the scan
//     date: every gate (dollar volume, ADR, above and stacked 50/200, rising
//     21 EMA, distance to the 10 and 21, 10-day range, coil ratio, quiet day,
//     off-high, RS floor) and the tightness/proximity/RS/trend score
//   - final list = top CONSOL.finalSize by score
//
// Approximations:
//   - EOD only; the live scan runs intraday off the snapshot's last price.
//   - No earnings blackout: the live scan drops names reporting within days,
//     and that calendar cannot be rebuilt per past date from this plan's data.
//     Rows carry no earnings flag, so read the results as "the base as it
//     looked", not "the base you could have traded around earnings".
//   - Market-cap gate skipped (needs point-in-time reference data per name-day)
//     and short interest is display-only on this table anyway.
//   - RS rebuilt per session (see rs.ts).
//
// A base is flagged every session it stays valid, so rows carry baseId and
// isNewBase — the analysis counts first appearances.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { APP, DATA, readDay, loadAdjusted } from './cache';
import { loadReference, refAt, isTradeableType } from './reference';
import { makeRsFor } from './rs';

import { CONSOL } from '@/lib/scanConfig';
import {
  GROUPED, shortlistConsolidation, analyzeConsolidation,
  type Bar, type LiteBar, type SnapInfo,
} from '@/lib/scans/consolidation';
import type { RsLookup } from '@/lib/indicators/rs';
import { sma } from '@/lib/indicators/marketMath';

const OUT = path.join(DATA, 'replay');
const HISTORY = 260;                 // analyzeConsolidation needs 210+ bars
const BASE_GAP_SESSIONS = 10;
const BASE_PIVOT_TOL = 0.01;

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
  const regOut = fs.createWriteStream(path.join(OUT, 'consol_registry.jsonl'));
  const sesOut = fs.createWriteStream(path.join(OUT, 'consol_sessions.jsonl'));
  const lastSeen = new Map<string, { sIdx: number; trigger: number; baseId: string }>();
  let baseSeq = 0, rows = 0, newBases = 0;

  const start = Math.max(HISTORY, 252);
  for (let s = start; s < N; s++) {
    const date = sessions[s];

    // Market-wide prefilter window: the 45 sessions ending the day before.
    const series = new Map<string, LiteBar[]>();
    for (const [T] of readDay('unadj', date)) {
      const id = idOf.get(T);
      if (id === undefined || Number.isNaN(C[id][s])) continue;
      const arr: LiteBar[] = [];
      for (let j = s - GROUPED.days; j <= s - 1; j++) {
        if (Number.isNaN(C[id][j])) continue;
        arr.push({ c: C[id][j], h: H[id][j], l: L[id][j], v: V[id][j] });
      }
      if (arr.length >= 28) series.set(T, arr);
    }
    const shortlist = shortlistConsolidation(series);
    const rs = rsFor(s - 1);
    const rsLookup = {
      available: true, asOf: sessions[s - 1], ageDays: 1, ranked: rs.sortedRaws.length,
      sortedRaws: rs.sortedRaws, reason: null,
      get: (sym: string) => rs.ratings.get(sym) ?? null,
    } as unknown as RsLookup;

    let typeDropped = 0, shortHistory = 0;
    const candidates: Record<string, unknown>[] = [];
    for (const sym of shortlist) {
      const rec = refAt(ref, sym, date);
      if (!isTradeableType(rec?.type)) { typeDropped++; continue; }
      const id = idOf.get(sym)!;
      const bars: Bar[] = barsOf(id, s - HISTORY, s);
      if (bars.length < 210) { shortHistory++; continue; }
      const snap: SnapInfo = {
        vwap: null, livePrice: C[id][s], vol: V[id][s],
        changePct: (() => {
          let prev = 0;
          for (let j = s - 1; j >= Math.max(0, s - 5); j--) if (!Number.isNaN(C[id][j])) { prev = C[id][j]; break; }
          return prev > 0 ? ((C[id][s] - prev) / prev) * 100 : 0;
        })(),
      };
      const row = analyzeConsolidation(sym, bars, rsLookup, {}, { results: [] }, snap);
      if (row) candidates.push({ ...row, date, sIdx: s, name: rec?.name ?? row.name });
    }

    candidates.sort((a, b) => (b.score as number) - (a.score as number));
    const finalList = candidates.slice(0, CONSOL.finalSize);

    let regime: Record<string, unknown> = {};
    if (spy !== undefined) {
      const sc = barsOf(spy, s - 260, s).map(b => b.c);
      const px = sc[sc.length - 1], s50 = sma(sc, 50), s200 = sma(sc, 200), s50p = sma(sc.slice(0, -10), 50);
      regime = {
        spyAbove50: s50 != null ? px > s50 : null,
        spyAbove200: s200 != null ? px > s200 : null,
        spy50Rising: s50 != null && s50p != null ? s50 > s50p : null,
      };
    }

    let sessionNew = 0;
    for (const row of finalList) {
      const sym = row.symbol as string;
      const trig = ((row.plan as { trigger?: number | null })?.trigger) ?? 0;
      const prev = lastSeen.get(sym);
      const same = prev && s - prev.sIdx <= BASE_GAP_SESSIONS && prev.trigger > 0
        && Math.abs(trig / prev.trigger - 1) <= BASE_PIVOT_TOL;
      const baseId = same ? prev!.baseId : `${sym}-${date}-${++baseSeq}`;
      if (!same) { sessionNew++; newBases++; }
      lastSeen.set(sym, { sIdx: s, trigger: trig, baseId });
      regOut.write(JSON.stringify({ ...row, ...regime, ticker: sym, baseId, isNewBase: !same }) + '\n');
      rows++;
    }

    sesOut.write(JSON.stringify({
      date, prefilterUniverse: series.size, shortlisted: shortlist.length,
      typeDropped, shortHistory, passed: candidates.length, final: finalList.length,
      newBases: sessionNew, rsUniverse: rs.sortedRaws.length, ...regime,
    }) + '\n');

    if ((s - start) % 100 === 0) {
      console.log(`${date}  final=${finalList.length} new=${sessionNew} shortlist=${shortlist.length}  rows=${rows}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
  }

  regOut.end(); sesOut.end();
  let commit = 'unknown';
  try { commit = execSync('git rev-parse --short HEAD', { cwd: APP }).toString().trim(); } catch { /* not fatal */ }
  fs.writeFileSync(path.join(OUT, 'consol_meta.json'), JSON.stringify({
    scan: '10/21 consolidation', commit, generatedAt: new Date().toISOString(),
    firstScan: sessions[start], lastScan: sessions[N - 1], sessionsScanned: N - start,
    rows, newBases, gates: CONSOL, grouped: GROUPED,
    approximations: ['EOD only', 'no earnings blackout', 'no market-cap gate', 'reference-list type check'],
  }, null, 2));
  console.log(`DONE ${N - start} sessions, ${rows} rows, ${newBases} distinct bases in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main();

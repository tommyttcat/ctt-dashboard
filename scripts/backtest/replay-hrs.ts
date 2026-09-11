// scripts/backtest/replay-hrs.ts — Hidden Relative Strength replay.
//
// Run from trade-dash:  npx tsx scripts/backtest/replay-hrs.ts
// Writes CTT/backtest-data/replay/hrs_{registry,sessions}.jsonl + meta.json
//
// Exact, through the same code production runs (lib/scans/hrs):
//   - regime from QQQ's last 30 sessions: weak days are QQQ closes below
//     HRS.weakDayThreshold, and severity comes from its 5/10-day returns
//   - prefilter: $5 floor, 200k shares and $10M average dollar volume, 10 SMA
//     above 20 SMA with both rising, and the name must have outperformed QQQ
//     on at least HRS.minWeakDayOutperformPct of those weak days; top 150 by
//     total weak-day alpha
//   - confirm: RS floor, within HRS.maxPctBelow52wHigh of the 52-week high,
//     then scoreHrs; final list = top HRS.finalSize by score
//
// Approximations:
//   - EOD only (the live scan reads the snapshot's intraday price).
//   - vixLevel is null: this plan has no VIX history. It is carried on the
//     regime object for display and never gates anything, so nothing changes.
//   - Company name/sector come from the cached reference list, not per-date
//     ticker details; neither is scored.
//   - RS rebuilt per session (see rs.ts).

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { APP, DATA, readDay, loadAdjusted } from './cache';
import { loadReference, refAt, isTradeableType } from './reference';
import { makeRsFor } from './rs';

import { HRS } from '@/lib/scanConfig';
import {
  EXCLUDED_ETFS, detectRegime, prefilter, scoreHrs,
  type Bar, type SnapInfo,
} from '@/lib/scans/hrs';
import { computeStage } from '@/lib/indicators/stage';

const OUT = path.join(DATA, 'replay');
const WINDOW = HRS.recentTradingDays;     // 30
const YEAR_BARS = 252;

function main() {
  const t0 = Date.now();
  const cache = loadAdjusted();
  const { sessions, tMs, idOf, syms, H, L, C, V, barsOf } = cache;
  const N = sessions.length;
  console.log(`${N} sessions ${sessions[0]} → ${sessions[N - 1]}; ${syms.length} tickers in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  const ref = loadReference();
  const rsFor = makeRsFor(cache);
  const qqq = idOf.get('QQQ');
  if (qqq === undefined) throw new Error('QQQ missing from the cache');

  fs.mkdirSync(OUT, { recursive: true });
  const regOut = fs.createWriteStream(path.join(OUT, 'hrs_registry.jsonl'));
  const sesOut = fs.createWriteStream(path.join(OUT, 'hrs_sessions.jsonl'));
  let rows = 0;

  const start = Math.max(YEAR_BARS, 252);
  for (let s = start; s < N; s++) {
    const date = sessions[s];

    // Stage 1-2 — universe and the 30-session window, ending ON the scan date.
    const snapMap = new Map<string, SnapInfo>();
    const seriesMap = new Map<string, Bar[]>();
    for (const [T, , , , c] of readDay('unadj', date)) {
      if (c < HRS.minPrice || EXCLUDED_ETFS.has(T) || !/^[A-Z]{1,5}$/.test(T)) continue;
      const id = idOf.get(T);
      if (id === undefined || Number.isNaN(C[id][s])) continue;
      const bars: Bar[] = [];
      for (let j = s - WINDOW; j <= s; j++) {
        if (Number.isNaN(C[id][j])) continue;
        bars.push({ t: tMs[j], o: NaN, h: H[id][j], l: L[id][j], c: C[id][j], v: V[id][j] });
      }
      if (bars.length < 20) continue;
      let prev = 0;
      for (let j = s - 1; j >= Math.max(0, s - 5); j--) if (!Number.isNaN(C[id][j])) { prev = C[id][j]; break; }
      snapMap.set(T, {
        price: C[id][s], vol: V[id][s],
        changePct: prev > 0 ? ((C[id][s] - prev) / prev) * 100 : 0,
      } as unknown as SnapInfo);
      seriesMap.set(T, bars);
    }

    const qqqBars: Bar[] = [];
    for (let j = s - WINDOW; j <= s; j++) {
      if (Number.isNaN(C[qqq][j])) continue;
      qqqBars.push({ t: tMs[j], o: NaN, h: H[qqq][j], l: L[qqq][j], c: C[qqq][j], v: V[qqq][j] });
    }
    const regime = detectRegime(qqqBars, null);

    const pre = prefilter(snapMap, seriesMap, regime, new Map(), []);
    const rs = rsFor(s - 1);

    // Stage 4 — confirm: RS floor, 52-week high proximity, score.
    let typeDropped = 0, rsRejects = 0, highRejects = 0;
    const confirmed: Record<string, unknown>[] = [];
    for (const c of pre) {
      const rec = refAt(ref, c.symbol, date);
      if (!isTradeableType(rec?.type)) { typeDropped++; continue; }
      const rsRating = rs.ratings.get(c.symbol) ?? null;
      if (rsRating != null && rsRating < HRS.minRsRating) { rsRejects++; continue; }

      const id = idOf.get(c.symbol)!;
      const yearBars = barsOf(id, s - YEAR_BARS, s);
      let high52w = 0;
      for (const b of yearBars) if (b.h > high52w) high52w = b.h;
      const price = snapMap.get(c.symbol)!.price;
      if (high52w <= 0) high52w = Math.max(...c.bars.map(b => b.h));
      const pctBelow52wHigh = high52w > 0 ? ((high52w - price) / high52w) * 100 : 0;
      if (pctBelow52wHigh > HRS.maxPctBelow52wHigh) { highRejects++; continue; }

      const breakdown = scoreHrs(c, pctBelow52wHigh, rsRating);
      const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
      const r2 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : +v.toFixed(4));

      confirmed.push({
        date, sIdx: s, ticker: c.symbol, name: rec?.name ?? c.symbol,
        score: +score.toFixed(0), grade: score >= 70 ? 'A' : score >= 50 ? 'B' : 'C', breakdown,
        price: r2(price), vol: V[id][s], dVol: Math.round(price * V[id][s]), avgVol: Math.round(c.avgVol),
        alphaOnWeakDays: c.alphaOnWeakDays, weakDayOutperformPct: c.weakDayOutperformPct,
        avgDailyAlpha: c.avgDailyAlpha, weakDaysMeasured: c.weakDayDetail.length,
        sma10Slope: c.sma10Slope, sma20Slope: c.sma20Slope,
        high52w: r2(high52w), pctBelow52wHigh: r2(pctBelow52wHigh),
        rsRating, stage: computeStage(yearBars.map(b => ({ c: b.c })), { order: 'asc', price }),
        dayHigh: r2(H[id][s]), dayLow: r2(L[id][s]),
        low10: r2(Math.min(...c.bars.slice(-10).map(b => b.l))),
        regimeSeverity: regime.severity, regimeActive: regime.active,
        qqqReturn5d: r2(regime.qqqReturn5d), weakDaysInWindow: regime.weakDays.length,
      });
    }

    confirmed.sort((a, b) => (b.score as number) - (a.score as number));
    const finalList = confirmed.slice(0, HRS.finalSize);
    for (const row of finalList) { regOut.write(JSON.stringify(row) + '\n'); rows++; }

    sesOut.write(JSON.stringify({
      date, universe: snapMap.size, prefiltered: pre.length, typeDropped, rsRejects, highRejects,
      confirmed: confirmed.length, final: finalList.length,
      regimeSeverity: regime.severity, weakDays: regime.weakDays.length, rsUniverse: rs.sortedRaws.length,
    }) + '\n');

    if ((s - start) % 100 === 0) {
      console.log(`${date}  final=${finalList.length} pre=${pre.length} regime=${regime.severity}  rows=${rows}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
  }

  regOut.end(); sesOut.end();
  let commit = 'unknown';
  try { commit = execSync('git rev-parse --short HEAD', { cwd: APP }).toString().trim(); } catch { /* not fatal */ }
  fs.writeFileSync(path.join(OUT, 'hrs_meta.json'), JSON.stringify({
    scan: 'hidden relative strength', commit, generatedAt: new Date().toISOString(),
    firstScan: sessions[start], lastScan: sessions[N - 1], sessionsScanned: N - start, rows, gates: HRS,
    approximations: ['EOD only', 'vixLevel null (display-only field)', 'reference-list name/type'],
  }, null, 2));
  console.log(`DONE ${N - start} sessions, ${rows} rows in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main();

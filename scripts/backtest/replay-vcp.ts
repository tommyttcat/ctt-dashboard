// scripts/backtest/replay-vcp.ts — VCP historical replay.
//
// Run from trade-dash:  npx tsx scripts/backtest/replay-vcp.ts
// Reads  CTT/backtest-data/grouped/{adj,unadj} + reference/tickers.json.gz
// Writes CTT/backtest-data/replay/vcp_registry.jsonl, vcp_sessions.jsonl, vcp_meta.json
//
// Local only: no network, no KV, no Vercel.
//
// WHY VCP REPLAYS CLEANLY. scoreVcp takes the contraction shape, the RS Rating
// and the Trend Template — no news, no float, no short interest. Everything it
// needs is in the daily bars plus the RS map, both of which are rebuilt here,
// so this is a full-fidelity replay rather than an approximation.
//
// Exact, via the same code production runs (lib/scans/vcp + lib/indicators/vcp):
//   - universe gate (symbol shape, fund list, $2–$10,000) on the AS-TRADED close
//   - liquidity floors: 20-bar average volume (converted back to as-traded
//     shares, since the cache is adjusted for later splits) and $-volume
//   - RS gate at VCP.minRsRating, from the RS map rebuilt for that session
//   - prefilter on the 90-session window ENDING THE DAY BEFORE the scan — the
//     live fetchRecentWindow walks calendar days 90→1, so the scan date is
//     never in its window
//   - confirmation on ~500 calendar days of bars INCLUDING the scan date,
//     needing 200+ bars, then analyzeVcp / evaluateTrendTemplate / scoreVcp
//   - shortlist by RS desc capped at VCP.shortlistCap, final list top
//     VCP.finalSize by score
//
// Approximations:
//   - EOD only: the live scan runs intraday and uses the snapshot's last price;
//     this is the post-close equivalent.
//   - Common-stock check from the cached reference list (latest known type)
//     rather than point-in-time ticker details.
//   - RS anchors session-exact (see rs.ts).
//   - News, sector and fundamentals are display-only on this table and are not
//     replayed; they do not enter scoreVcp.
//
// BASE IDENTITY. A base is flagged on every session it stays valid, so one
// setup can appear 20 days running. Each row carries a baseId and isNewBase:
// consecutive flags of the same ticker within BASE_GAP_SESSIONS whose pivot is
// within BASE_PIVOT_TOL are the SAME base. Statistics should use first
// appearances; counting every row would weight long-lived bases 20x.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { APP, DATA, readDay, loadAdjusted } from './cache';
import { loadReference, refAt, isTradeableType } from './reference';
import { makeRsFor } from './rs';

import { VCP as VCP_GATES } from '@/lib/scanConfig';
import {
  passesVcpUniverseGate, avgVolume20, passesVcpLiquidity, prefilterVcp, buildLevels,
} from '@/lib/scans/vcp';
import { analyzeVcp, evaluateTrendTemplate, scoreVcp, type VcpBar } from '@/lib/indicators/vcp';
import { computeMoneyFlow, moneyFlowTrend } from '@/lib/indicators/moneyflow';
import { computeStage } from '@/lib/indicators/stage';
import { sma } from '@/lib/indicators/marketMath';

const OUT = path.join(DATA, 'replay');
const DAY_MS = 86_400_000;
const WINDOW = VCP_GATES.windowTradingDays;      // 90
const CONFIRM_CALENDAR_DAYS = 500;
const MIN_CONFIRM_BARS = 200;
const BASE_GAP_SESSIONS = 10;
const BASE_PIVOT_TOL = 0.01;

function main() {
  const t0 = Date.now();
  const cache = loadAdjusted();
  const { sessions, tMs, idOf, syms, O, H, L, C, V, barsOf } = cache;
  const N = sessions.length;
  console.log(`${N} sessions ${sessions[0]} → ${sessions[N - 1]}; ${syms.length} tickers in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  const ref = loadReference();
  const rsFor = makeRsFor(cache);
  const spy = idOf.get('SPY');

  fs.mkdirSync(OUT, { recursive: true });
  const regOut = fs.createWriteStream(path.join(OUT, 'vcp_registry.jsonl'));
  const sesOut = fs.createWriteStream(path.join(OUT, 'vcp_sessions.jsonl'));

  // Base identity, carried across sessions.
  const lastSeen = new Map<string, { sIdx: number; pivot: number; baseId: string }>();
  let baseSeq = 0;
  let totalRows = 0, totalNewBases = 0;

  const start = Math.max(WINDOW + 1, 252);   // RS needs a year; the window needs 90 sessions
  for (let s = start; s < N; s++) {
    const date = sessions[s];
    const dMs = tMs[s];

    // Stage 1 — universe on the as-traded print.
    const snap = new Map<string, { price: number; vol: number; prevClose: number; changePct: number; splitFactor: number }>();
    const asTraded = new Map<string, { c: number; v: number }>();
    for (const [T, , , , c, v] of readDay('unadj', date)) {
      if (!passesVcpUniverseGate(T, c)) continue;
      const id = idOf.get(T);
      if (id === undefined || Number.isNaN(C[id][s])) continue;
      let prevClose = 0;
      for (let j = s - 1; j >= Math.max(0, s - 5); j--) if (!Number.isNaN(C[id][j])) { prevClose = C[id][j]; break; }
      const price = C[id][s];
      snap.set(T, {
        price, vol: V[id][s], prevClose,
        changePct: prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0,
        splitFactor: V[id][s] > 0 ? v / V[id][s] : 1,      // adjusted → as-traded shares
      });
      asTraded.set(T, { c, v });
    }

    const rs = rsFor(s - 1);
    let liquidityRejects = 0, rsRejects = 0, structureRejects = 0;
    const prefiltered: { sym: string; rs: number }[] = [];

    // Stages 2–4 — 90-session window ending the day before, then the prefilter.
    snap.forEach((sn, sym) => {
      const id = idOf.get(sym)!;
      const win: VcpBar[] = [];
      for (let j = s - WINDOW; j <= s - 1; j++) {
        if (Number.isNaN(C[id][j])) continue;
        win.push({ t: tMs[j], o: O[id][j], h: H[id][j], l: L[id][j], c: C[id][j], v: V[id][j] });
      }
      const avgVolAsTraded = avgVolume20(win) * sn.splitFactor;
      if (!passesVcpLiquidity(avgVolAsTraded, asTraded.get(sym)!.c)) { liquidityRejects++; return; }
      const r = rs.ratings.get(sym);
      if (r == null || r < VCP_GATES.minRsRating) { rsRejects++; return; }
      if (!prefilterVcp(win)) { structureRejects++; return; }
      prefiltered.push({ sym, rs: r });
    });

    prefiltered.sort((a, b) => b.rs - a.rs);
    const shortlist = prefiltered.slice(0, VCP_GATES.shortlistCap);

    // Stage 5 — confirmation on deep history including the scan date.
    const firstIdx = (() => { let j = s; while (j > 0 && tMs[j - 1] >= dMs - CONFIRM_CALENDAR_DAYS * DAY_MS) j--; return j; })();
    let typeDropped = 0, shortHistory = 0, invalidPattern = 0;
    const confirmed: Record<string, unknown>[] = [];

    for (const { sym, rs: rsRating } of shortlist) {
      const rec = refAt(ref, sym, date);
      if (!isTradeableType(rec?.type)) { typeDropped++; continue; }
      const id = idOf.get(sym)!;
      const bars = barsOf(id, firstIdx, s);
      if (bars.length < MIN_CONFIRM_BARS) { shortHistory++; continue; }

      const vcp = analyzeVcp(bars, { lookback: WINDOW });
      if (!vcp.valid) { invalidPattern++; continue; }

      const template = evaluateTrendTemplate(bars);
      const scored = scoreVcp({ vcp, rsRating, template });
      const levels = buildLevels(vcp);
      const sn = snap.get(sym)!;
      const at = asTraded.get(sym)!;
      const avgVol = avgVolume20(bars);
      const closes = bars.map(b => b.c);
      const r2 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : +v.toFixed(4));

      confirmed.push({
        date, sIdx: s, ticker: sym, name: rec?.name ?? null,
        score: scored.score, grade: scored.grade, breakdown: scored.breakdown,
        rsRating,
        price: r2(sn.price), priceAsTraded: at.c, volAsTraded: at.v,
        dVol: Math.round(at.c * at.v), avgVol: Math.round(avgVol * sn.splitFactor),
        rvol: avgVol > 0 ? +(sn.vol / avgVol).toFixed(2) : null,
        changePct: r2(sn.changePct),
        contractionCount: vcp.contractionCount, depths: vcp.depths.map(d => +d.toFixed(1)),
        firstDepthPct: r2(vcp.firstDepthPct), finalDepthPct: r2(vcp.finalDepthPct),
        pivot: r2(vcp.pivot), pctToPivot: r2(vcp.pctToPivot), baseLengthBars: vcp.baseLengthBars,
        baseHigh: r2(vcp.baseHigh), baseLow: r2(vcp.baseLow), priorMovePct: r2(vcp.priorMovePct),
        volumeDryingRatio: r2(vcp.volumeDryingRatio), finalLegVolumeRatio: r2(vcp.finalLegVolumeRatio),
        status: vcp.status, atrPct: r2(vcp.atrPct),
        templatePassed: template?.passed ?? null, templateTotal: template?.total ?? null,
        pctAbove52wLow: r2(template?.pctAbove52wLow), pctBelow52wHigh: r2(template?.pctBelow52wHigh),
        stage: computeStage(closes, { price: sn.price }),
        mf: computeMoneyFlow(bars, { length: 21 }), mfTrend: moneyFlowTrend(bars, { length: 21, lookback: 5 }),
        trigger: r2(levels.trigger), stop: r2(levels.stop), stopPct: r2(levels.stopPct), target: r2(levels.target),
      });
    }

    confirmed.sort((a, b) => (b.score as number) - (a.score as number));
    const finalList = confirmed.slice(0, VCP_GATES.finalSize);

    // Market regime at the scan date — slice context only.
    let regime: Record<string, unknown> = {};
    if (spy !== undefined) {
      const sc = barsOf(spy, s - 260, s).map(b => b.c);
      const px = sc[sc.length - 1], s50 = sma(sc, 50), s200 = sma(sc, 200), s50prev = sma(sc.slice(0, -10), 50);
      regime = {
        spyAbove50: s50 != null ? px > s50 : null,
        spyAbove200: s200 != null ? px > s200 : null,
        spy50Rising: s50 != null && s50prev != null ? s50 > s50prev : null,
        spyRet20: sc.length > 21 ? +(((px / sc[sc.length - 21]) - 1) * 100).toFixed(2) : null,
      };
    }

    let newBases = 0;
    for (const row of finalList) {
      const sym = row.ticker as string;
      const pivot = (row.pivot as number) ?? 0;
      const prev = lastSeen.get(sym);
      const same = prev && s - prev.sIdx <= BASE_GAP_SESSIONS && prev.pivot > 0
        && Math.abs(pivot / prev.pivot - 1) <= BASE_PIVOT_TOL;
      const baseId = same ? prev!.baseId : `${sym}-${date}-${++baseSeq}`;
      if (!same) { newBases++; totalNewBases++; }
      lastSeen.set(sym, { sIdx: s, pivot, baseId });
      regOut.write(JSON.stringify({ ...row, ...regime, baseId, isNewBase: !same }) + '\n');
      totalRows++;
    }

    sesOut.write(JSON.stringify({
      date, universe: snap.size, liquidityRejects, rsRejects, structureRejects,
      prefiltered: prefiltered.length, shortlisted: shortlist.length,
      typeDropped, shortHistory, invalidPattern, confirmed: confirmed.length,
      final: finalList.length, newBases, rsUniverse: rs.sortedRaws.length, ...regime,
    }) + '\n');

    if ((s - start) % 100 === 0) {
      console.log(`${date}  final=${finalList.length} newBases=${newBases} shortlist=${shortlist.length}  rows=${totalRows}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
  }

  regOut.end(); sesOut.end();
  let commit = 'unknown';
  try { commit = execSync('git rev-parse --short HEAD', { cwd: APP }).toString().trim(); } catch { /* not fatal */ }
  fs.writeFileSync(path.join(OUT, 'vcp_meta.json'), JSON.stringify({
    scan: 'vcp', commit, generatedAt: new Date().toISOString(),
    firstScan: sessions[start], lastScan: sessions[N - 1], sessionsScanned: N - start,
    rows: totalRows, newBases: totalNewBases, gates: VCP_GATES,
    baseIdentity: { gapSessions: BASE_GAP_SESSIONS, pivotTolerance: BASE_PIVOT_TOL },
  }, null, 2));
  console.log(`DONE ${N - start} sessions, ${totalRows} rows, ${totalNewBases} distinct bases in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main();

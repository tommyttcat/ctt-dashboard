// scripts/backtest/replay-scanner.ts — Stocks in Play / Daily Setups replay.
//
// Run from trade-dash:  npx tsx scripts/backtest/replay-scanner.ts
// Writes CTT/backtest-data/replay/scanner_{registry,sessions}.jsonl + meta.json
//
// One pass produces BOTH tables and the setup name on every row, so the
// question "do Reversals work better than Gap & Gos" is a slice rather than a
// separate backtest.
//
// Exact, via lib/scans/scanner (the same code production runs):
//   - universe: symbol shape, $2 floor, 500k share floor
//   - SIP candidates: |change| >= 4% AND close at/above the session VWAP,
//     ranked by share volume, top 40 → final gates → top 10
//   - Daily candidates: change >= +4%, ranked by dollar volume, top 30 →
//     looser final gates (no ATR or average-volume floor) → top 10
//   - setup naming (Gap & Go, R2G, GLB, VCP, Reversal, …) with bars DESCENDING
//     and the same EMA/squeeze/stage logic
//   - avgVol(20), ATR(14) and ADR(20) computed the route's way, on as-traded
//     share counts (the cache is split-adjusted, so volumes are converted back)
//
// Approximations, each deliberate:
//   - EOD only. The live scan runs every 15 minutes and ranks on the snapshot's
//     intraday price, volume and VWAP; this is the post-close equivalent, and
//     the session VWAP comes from the cached bar's vw field.
//   - The $10M market-cap gate is skipped: it needs point-in-time reference
//     data per name-day, and the $5M dollar-volume and $2 price floors already
//     exclude nearly everything it would.
//   - No CNF score. computeCnfScore needs live context (catalyst tier, earnings
//     calendar, breadth signal, hot sector, scan streaks) that cannot be
//     rebuilt honestly for a past date, and a CNF computed with those inputs
//     defaulted would be a different score wearing the same name.
//   - Common-stock check from the cached reference list.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { APP, DATA, readDay, loadAdjusted } from './cache';
import { loadReference, refAt, isTradeableType } from './reference';
import { makeRsFor } from './rs';

import { SCANNER } from '@/lib/scanConfig';
import {
  passesScannerUniverse, isSipCandidate, isDailyCandidate,
  passesSipFinal, passesDailyFinal, detectPattern, type ScannerBar,
} from '@/lib/scans/scanner';
import { computeDotDetail } from '@/lib/indicators/dots';
import { computeMoneyFlow } from '@/lib/indicators/moneyflow';
import { choppiness, CHOP_PERIOD_DEFAULT } from '@/lib/indicators/chop';
import { computeTradePlan } from '@/lib/indicators/tradeplan';
import { sma, ema } from '@/lib/indicators/marketMath';

const OUT = path.join(DATA, 'replay');
const HISTORY_BARS = 220;          // the route fetches 350 calendar days; naming needs 80+
const SIP_CANDIDATE_CAP = 40;
const DAILY_CANDIDATE_CAP = 30;

function main() {
  const t0 = Date.now();
  const cache = loadAdjusted();
  const { sessions, idOf, syms, O, H, L, C, V, VW, barsOf } = cache;
  const N = sessions.length;
  console.log(`${N} sessions ${sessions[0]} → ${sessions[N - 1]}; ${syms.length} tickers in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  const ref = loadReference();
  const rsFor = makeRsFor(cache);
  const spy = idOf.get('SPY');

  fs.mkdirSync(OUT, { recursive: true });
  const regOut = fs.createWriteStream(path.join(OUT, 'scanner_registry.jsonl'));
  const sesOut = fs.createWriteStream(path.join(OUT, 'scanner_sessions.jsonl'));
  let rows = 0;

  const start = 252;
  for (let s = start; s < N; s++) {
    const date = sessions[s];

    // Universe on the as-traded print; SIP needs the session VWAP.
    type Cand = { sym: string; price: number; vol: number; vwap: number; chg: number; open: number; splitFactor: number; asC: number; asV: number };
    const cands: Cand[] = [];
    for (const [T, , , , c, v] of readDay('unadj', date)) {
      if (!passesScannerUniverse(T, c, v)) continue;
      const id = idOf.get(T);
      if (id === undefined || Number.isNaN(C[id][s])) continue;
      let prevClose = 0;
      for (let j = s - 1; j >= Math.max(0, s - 5); j--) if (!Number.isNaN(C[id][j])) { prevClose = C[id][j]; break; }
      if (!(prevClose > 0)) continue;
      const price = C[id][s];
      cands.push({
        sym: T, price, vol: V[id][s],
        vwap: Number.isNaN(VW[id][s]) ? price : VW[id][s],
        chg: ((price - prevClose) / prevClose) * 100,
        open: O[id][s],
        splitFactor: V[id][s] > 0 ? v / V[id][s] : 1,
        asC: c, asV: v,
      });
    }

    const sipCandidates = cands.filter(t => isSipCandidate(t.chg, t.price, t.vwap))
      .sort((a, b) => b.vol - a.vol).slice(0, SIP_CANDIDATE_CAP);
    const dailyCandidates = cands.filter(t => isDailyCandidate(t.chg))
      .sort((a, b) => (b.price * b.vol) - (a.price * a.vol)).slice(0, DAILY_CANDIDATE_CAP);

    const rs = rsFor(s - 1);
    const wanted = new Map<string, Cand>();
    for (const t of [...sipCandidates, ...dailyCandidates]) wanted.set(t.sym, t);

    // Enrichment — the route's own avgVol / ATR / ADR arithmetic, on as-traded shares.
    const enriched = new Map<string, Record<string, unknown>>();
    for (const [sym, t] of wanted) {
      const rec = refAt(ref, sym, date);
      if (!isTradeableType(rec?.type)) continue;
      const id = idOf.get(sym)!;
      const asc = barsOf(id, s - HISTORY_BARS, s);
      if (asc.length < 80) continue;
      const desc: ScannerBar[] = [...asc].reverse();

      let sumVol = 0, barCount = 0, sumTR = 0, trCount = 0;
      desc.slice(0, 20).forEach((bar, index) => {
        if (bar.v) { sumVol += bar.v; barCount++; }
        if (index < 14 && desc[index + 1]) {
          const prevClose = desc[index + 1].c;
          sumTR += Math.max(bar.h - bar.l, Math.abs(bar.h - prevClose), Math.abs(bar.l - prevClose));
          trCount++;
        }
      });
      const avgVol = (barCount > 0 ? sumVol / barCount : 0) * t.splitFactor;   // as-traded shares
      const atr = trCount > 0 ? sumTR / trCount : 0;

      let adrPct: number | null = null;
      if (desc.length >= 20) {
        let ratioSum = 0, ratioCount = 0;
        for (let i = 0; i < 20; i++) {
          const b = desc[i];
          if (b && b.h > 0 && b.l > 0) { ratioSum += b.h / b.l; ratioCount++; }
        }
        if (ratioCount > 0) adrPct = ((ratioSum / ratioCount) - 1) * 100;
      }

      const rvol = avgVol > 0 ? t.asV / avgVol : null;
      const dot = computeDotDetail(desc, { order: 'desc' });
      const pattern = detectPattern(desc, t.price, t.open, t.vwap, rvol, dot.kind, dot.stochK);
      const closes = asc.map(b => b.c);
      const e10 = ema(closes, 10), e21 = ema(closes, 21), e50 = ema(closes, 50);
      const s50 = sma(closes, 50), s200 = sma(closes, 200);
      const gapPct = ((t.open - (asc[asc.length - 2]?.c ?? t.open)) / (asc[asc.length - 2]?.c ?? t.open)) * 100;
      const plan = computeTradePlan({
        price: t.price, adrPct, atrPct: t.price > 0 ? (atr / t.price) * 100 : null, changePct: t.chg,
        ema10: e10, ema21: e21, ema50: e50, dayHigh: H[id][s], priorSwingHigh: null,
        aboveEma10: e10 != null ? t.price >= e10 : null,
        aboveEma21: e21 != null ? t.price >= e21 : null,
        setupName: pattern.name,
      });
      const r2 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : +v.toFixed(4));

      enriched.set(sym, {
        date, sIdx: s, ticker: sym, name: rec?.name ?? null,
        price: r2(t.price), priceAsTraded: t.asC, vol: t.asV, dVol: Math.round(t.asC * t.asV),
        avgVol: Math.round(avgVol), rvol: r2(rvol), changePct: r2(t.chg), gapPct: r2(gapPct),
        atr: r2(atr), atrPct: r2(t.price > 0 ? (atr / t.price) * 100 : null), adrPct: r2(adrPct),
        vwapStatus: t.price >= t.vwap ? 'above' : 'below',
        closeStrength: H[id][s] > L[id][s] ? r2((t.price - L[id][s]) / (H[id][s] - L[id][s])) : null,
        setupName: pattern.name, stage: pattern.stage, stageNum: pattern.stageNum,
        dotKind: dot.kind, stochK: r2(dot.stochK),
        rsRating: rs.ratings.get(sym) ?? null,
        mf: computeMoneyFlow(asc, { length: 21 }),
        chop14: r2(choppiness(asc, CHOP_PERIOD_DEFAULT)),
        aboveSma50: s50 != null ? t.price > s50 : null,
        aboveSma200: s200 != null ? t.price > s200 : null,
        dayHigh: r2(H[id][s]), dayLow: r2(L[id][s]),
        plan: { tradeable: plan.tradeable, trigger: r2(plan.trigger), stop: r2(plan.stop), target: r2(plan.target), stopPct: r2(plan.stopPct), overextended: plan.overextended ?? null, clear: plan.clear ?? null },
      });
    }

    const gates = (r: Record<string, unknown>) => ({
      vol: r.vol as number, dVol: r.dVol as number, changePct: r.changePct as number,
      atr: r.atr as number, avgVol: r.avgVol as number, adrPct: r.adrPct as number | null,
    });
    const finalSip = sipCandidates.map(t => enriched.get(t.sym)).filter(r => r !== undefined && passesSipFinal(gates(r))).slice(0, SCANNER.finalSize);
    const finalDaily = dailyCandidates.map(t => enriched.get(t.sym)).filter(r => r !== undefined && passesDailyFinal(gates(r))).slice(0, SCANNER.finalSize);

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

    const sipSet = new Set(finalSip.map(r => r!.ticker as string));
    for (const r of [...finalSip, ...finalDaily.filter(d => !sipSet.has(d!.ticker as string))]) {
      const inSip = sipSet.has(r!.ticker as string);
      const inDaily = finalDaily.some(d => d!.ticker === r!.ticker);
      regOut.write(JSON.stringify({ ...r, ...regime, inSip, inDaily }) + '\n');
      rows++;
    }

    sesOut.write(JSON.stringify({
      date, universe: cands.length, sipCandidates: sipCandidates.length, dailyCandidates: dailyCandidates.length,
      enriched: enriched.size, finalSip: finalSip.length, finalDaily: finalDaily.length, ...regime,
    }) + '\n');

    if ((s - start) % 100 === 0) {
      console.log(`${date}  sip=${finalSip.length} daily=${finalDaily.length} rows=${rows}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
  }

  regOut.end(); sesOut.end();
  let commit = 'unknown';
  try { commit = execSync('git rev-parse --short HEAD', { cwd: APP }).toString().trim(); } catch { /* not fatal */ }
  fs.writeFileSync(path.join(OUT, 'scanner_meta.json'), JSON.stringify({
    scan: 'scanner (SIP + Daily)', commit, generatedAt: new Date().toISOString(),
    firstScan: sessions[start], lastScan: sessions[N - 1], sessionsScanned: N - start, rows, gates: SCANNER,
    approximations: ['EOD only (live is intraday)', 'no market-cap gate', 'no CNF score', 'reference-list type check'],
  }, null, 2));
  console.log(`DONE ${N - start} sessions, ${rows} rows in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main();

// scripts/backtest/cnf-rebuild.ts — rebuild the CNF score on held-out data.
//
//   npx tsx scripts/backtest/cnf-rebuild.ts
//
// CNF v6.19 was re-weighted and judged on the same five years, and live it
// does not rank (125 SIP/Daily picks: 75+ -3.1%, 45-59 -4.6%). This rebuilds
// it the honest way: choose and weight on one period, judge once on another.
//
// RULES — fixed 9 Oct 2026, before the first run.
//   Rows: replay/scanner_registry.jsonl (SIP + Daily rows, the momentum
//     tables), scored rows only. Outcome: the 20-session return from the
//     signal close (fwd.ret20) minus QQQ's over the same 20 sessions
//     ("excess"); secondary: run60 >= 20% ("ran").
//   TRAIN = signal dates before 2024-09-30. TEST = from 2024-09-30. TEST is
//     read exactly once, after the score below is frozen.
//   Candidate components (stock traits only — market timing is the Exposure
//     strip's job): rvol, changePct, gapPct, adrPct, atrPct, atrExpansion,
//     closeStrength, rsRating, rsVsMkt, mf, chop14, stageNum, stochK, rme,
//     scanStreak, dVol, price, vwap above (1/0), aboveSma50 (1/0),
//     aboveSma200 (1/0).
//   Step 1 (TRAIN only): quintiles by TRAIN cut points; a component is KEPT
//     if its best-minus-worst end quintile spread is >= 1.0 point of excess
//     AND the five quintile means rank-correlate with the quintile order at
//     |rho| >= 0.7 (a steady slope, not one lucky bucket). Flags: kept if
//     the 1-vs-0 gap is >= 1.0 point.
//   Step 2: score = sum over kept components of 0-4 quintile points
//     (oriented so 4 = the better end; flags 0/4), scaled to 0-100. Grade
//     cut points from TRAIN scores: A = top 20%, B = next 30%, C = the rest.
//   Step 3 (TEST, once): PASS if A > B > C on mean excess AND A - C >= 1.5
//     points. The current CNF grade (cnfGrade A/B/C in the registry) is
//     measured on the same TEST rows for comparison.

import fs from 'node:fs';
import path from 'node:path';
import { DATA, loadAdjusted } from './cache';

const REPLAY = path.join(DATA, 'replay');
const SPLIT = '2024-09-30';
const cache = loadAdjusted();
const sIdx = new Map(cache.sessions.map((d, i) => [d, i]));
const qId = cache.idOf.get('QQQ')!;
const reg = fs.readFileSync(path.join(REPLAY, 'scanner_registry.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const out = fs.readFileSync(path.join(REPLAY, 'scanner_outcomes.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const outKey = new Map(out.map(o => [`${o.date}|${o.ticker}`, o]));

type Row = { date: string; train: boolean; ex: number; ran: boolean; f: Record<string, number>; oldGrade: string };
const CONT = ['rvol', 'changePct', 'gapPct', 'adrPct', 'atrPct', 'atrExpansion', 'closeStrength', 'rsRating', 'rsVsMkt', 'mf', 'chop14', 'stageNum', 'stochK', 'rme', 'scanStreak', 'dVol', 'price'];
const FLAGS = ['vwapAbove', 'aboveSma50', 'aboveSma200'];
const rows: Row[] = [];
for (const r of reg) {
  const o = outKey.get(`${r.date}|${r.ticker}`);
  if (!o || o.status !== 'scored' || o.fwd?.ret20 == null) continue;
  const i = sIdx.get(r.date);
  if (i == null || i + 20 >= cache.sessions.length) continue;
  const q = cache.C[qId][i + 20] / cache.C[qId][i] - 1;
  const f: Record<string, number> = {};
  for (const k of CONT) f[k] = typeof r[k] === 'number' && Number.isFinite(r[k]) ? r[k] : NaN;
  f.vwapAbove = r.vwapStatus === 'above' ? 1 : 0;
  f.aboveSma50 = r.aboveSma50 ? 1 : 0;
  f.aboveSma200 = r.aboveSma200 ? 1 : 0;
  rows.push({ date: r.date, train: r.date < SPLIT, ex: o.fwd.ret20 / 100 - q, ran: (o.fwd.run60 ?? 0) >= 20, f, oldGrade: r.cnfGrade ?? 'C' });
}
const train = rows.filter(r => r.train), test = rows.filter(r => !r.train);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`;
console.log(`rows: train ${train.length} (${train[0]?.date} →), test ${test.length} (→ ${test.at(-1)?.date}); split ${SPLIT}`);
console.log(`all rows 20-day excess vs QQQ: train ${pct(mean(train.map(r => r.ex)))}, test ${pct(mean(test.map(r => r.ex)))}\n`);

// ---- Step 1 (TRAIN) ---------------------------------------------------------
const spearman5 = (m: number[]) => { const rk = m.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]).map(x => x[1]); const r = new Array(5); rk.forEach((qi, pos) => (r[qi] = pos)); let d2 = 0; for (let i = 0; i < 5; i++) d2 += (r[i] - i) ** 2; return 1 - (6 * d2) / (5 * 24); };
type Comp = { k: string; cuts?: number[]; dir: 1 | -1; flag?: boolean };
const kept: Comp[] = [];
console.log('STEP 1 — train only (quintile means of 20-day excess, low → high)');
for (const k of CONT) {
  const v = train.map(r => r.f[k]).filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length < 500) { console.log(`  ${k.padEnd(14)} too few values (${v.length})`); continue; }
  const cuts = [0.2, 0.4, 0.6, 0.8].map(p => v[Math.floor(p * v.length)]);
  const qOf = (x: number) => cuts.filter(c => x >= c).length;
  const b: number[][] = [[], [], [], [], []];
  for (const r of train) if (Number.isFinite(r.f[k])) b[qOf(r.f[k])].push(r.ex);
  const m = b.map(mean);
  const rho = spearman5(m);
  const spread = m[4] - m[0];
  const keep = Math.abs(spread) >= 0.01 && Math.abs(rho) >= 0.7;
  if (keep) kept.push({ k, cuts, dir: spread > 0 ? 1 : -1 });
  console.log(`  ${k.padEnd(14)} ${m.map(pct).join(' ')}  spread ${pct(spread)} rho ${rho.toFixed(2)}${keep ? '  → KEEP' : ''}`);
}
for (const k of FLAGS) {
  const on = train.filter(r => r.f[k] === 1).map(r => r.ex), off = train.filter(r => r.f[k] === 0).map(r => r.ex);
  const gap = mean(on) - mean(off);
  const keep = Math.abs(gap) >= 0.01 && on.length >= 200 && off.length >= 200;
  if (keep) kept.push({ k, dir: gap > 0 ? 1 : -1, flag: true });
  console.log(`  ${k.padEnd(14)} yes ${pct(mean(on))} (n ${on.length}) no ${pct(mean(off))} (n ${off.length})  gap ${pct(gap)}${keep ? '  → KEEP' : ''}`);
}
console.log(`\nkept: ${kept.map(c => `${c.k} (${c.dir > 0 ? 'higher' : 'lower'} better)`).join(', ') || 'none'}`);
if (!kept.length) { console.log('No component passes on TRAIN — nothing to build. TEST not read.'); process.exit(0); }

// ---- Step 2 -----------------------------------------------------------------
const score = (r: Row) => {
  let s = 0, n = 0;
  for (const c of kept) {
    const x = r.f[c.k];
    if (!Number.isFinite(x)) continue;
    n++;
    if (c.flag) s += (c.dir > 0 ? x : 1 - x) * 4;
    else { const qv = c.cuts!.filter(cut => x >= cut).length; s += c.dir > 0 ? qv : 4 - qv; }
  }
  return n ? (s / (4 * kept.length)) * 100 : NaN;
};
const trS = train.map(score).filter(Number.isFinite).sort((a, b) => a - b);
const cutA = trS[Math.floor(0.8 * trS.length)], cutB = trS[Math.floor(0.5 * trS.length)];
const gradeOf = (s: number) => (s >= cutA ? 'A' : s >= cutB ? 'B' : 'C');
console.log(`\nSTEP 2 — score frozen: grade A >= ${cutA.toFixed(1)}, B >= ${cutB.toFixed(1)}`);

// ---- Step 3 (TEST, once) ----------------------------------------------------
const report = (label: string, set: Row[], g: (r: Row) => string) => {
  const by: Record<string, Row[]> = { A: [], B: [], C: [] };
  for (const r of set) { const x = g(r); if (by[x]) by[x].push(r); }
  const m = Object.fromEntries(Object.entries(by).map(([k, v]) => [k, mean(v.map(r => r.ex))]));
  console.log(`  ${label.padEnd(26)} ${['A', 'B', 'C'].map(k => `${k} ${pct(m[k]).padStart(7)} ran ${(100 * mean(by[k].map(r => +r.ran))).toFixed(0).padStart(2)}% n ${String(by[k].length).padStart(4)}`).join(' | ')}`);
  return m;
};
console.log('\nTRAIN (for reference — fitted here):');
report('new score', train, r => gradeOf(score(r)));
report('current CNF grade', train, r => r.oldGrade);
console.log('\nSTEP 3 — TEST (Sep 2024 →, untouched until now):');
const mNew = report('new score', test, r => gradeOf(score(r)));
report('current CNF grade', test, r => r.oldGrade);
const pass = mNew.A > mNew.B && mNew.B > mNew.C && mNew.A - mNew.C >= 0.015;
console.log(`\n→ ${pass ? 'PASS' : 'fail'} (A > B > C and A − C >= 1.5 points on TEST)`);
for (const c of kept) {
  const hiSide = test.filter(r => Number.isFinite(r.f[c.k]) && (c.flag ? r.f[c.k] === (c.dir > 0 ? 1 : 0) : (c.cuts!.filter(cut => r.f[c.k] >= cut).length === (c.dir > 0 ? 4 : 0))));
  const loSide = test.filter(r => Number.isFinite(r.f[c.k]) && (c.flag ? r.f[c.k] === (c.dir > 0 ? 0 : 1) : (c.cuts!.filter(cut => r.f[c.k] >= cut).length === (c.dir > 0 ? 0 : 4))));
  console.log(`  test check ${c.k.padEnd(14)} better end ${pct(mean(hiSide.map(r => r.ex)))} (n ${hiSide.length}) vs worse end ${pct(mean(loSide.map(r => r.ex)))} (n ${loSide.length})`);
}

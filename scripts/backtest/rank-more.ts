// scripts/backtest/rank-more.ts — more ways to beat SPY (batch 3).
//
//   npx tsx scripts/backtest/rank-more.ts
//
// RULES — fixed 9 Oct 2026, before the first run. Engine: rank-engine.ts
// (universe, next-open fills, 0.1%/side, daily marks, staggered sleeves on
// sessions 1/6/11/16, every-rebalance-day check, split 2024-09-30).
// The bar to beat is now P2 = momentum + earnings surprise (rank-pead.ts,
// +165% Oct 2022 - Sep 2026), rebuilt here with lib/sue (99.95% identical).
//   A  Sector rotation: the 11 SPDR sector ETFs (XLB XLC XLE XLF XLI XLK XLP
//      XLRE XLU XLV XLY), top 3 by 12-1 momentum, equal weight.
//   B  Blend: 50% SPY + 50% P2 (staggered), back to 50/50 at each month-end
//      close.
//   C  Intermediate momentum (Novy-Marx 2012): top 50 by the return from 252
//      to 126 sessions ago.
//   D  Leaders on a pullback: of P2's top 100, the 50 with the weakest
//      latest month (t-21 → t).
//   E  Profitability + momentum: operating income / total assets from the
//      latest ANNUAL report filed on or before t and within 15 months
//      (Polygon financials, point in time by filing date); top 50 by
//      profitability rank + momentum rank among names that have it.
//   PASS (return): staggered beats SPY over the whole period and both halves,
//     beats P2 over the whole period, and beats SPY on >= 15 of 20 days.
//   PASS (risk, for A and B, which aim at steadier rather than bigger):
//     return >= SPY over the whole period AND return per unit of worst drop
//     (CAGR / max drawdown) above SPY's in both halves.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DATA } from './cache';
import { c, sessions, syms, C, N, S0, pool, staggered, spyNav, report, offsets, SPLIT } from './rank-engine';
import { sueAt, sueFresh, type Qtr } from '@/lib/sue';

// ---- P2 (momentum + earnings) ----
const qCache = new Map<string, Qtr[] | null>();
const quarters = (sym: string) => {
  if (!qCache.has(sym)) {
    const f = path.join(DATA, 'fundamentals', 'quarterly', `${sym}.json.gz`);
    let q: Qtr[] | null = null;
    if (fs.existsSync(f)) { try { q = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString()).q ?? null; } catch { q = null; } }
    qCache.set(sym, q);
  }
  return qCache.get(sym)!;
};
const p2Cache = new Map<number, number[]>();
function p2Ranked(t: number): number[] {
  if (p2Cache.has(t)) return p2Cache.get(t)!;
  const d = sessions[t];
  const e = pool(t).map(p => { const q = quarters(syms[p.id]); if (!q) return null; const r = sueAt(q, d); return sueFresh({ s: r.sue, f: r.filed, a: d }, d) ? { ...p, sue: r.sue as number } : null; })
    .filter((x): x is { id: number; mom: number; sue: number } => x != null);
  const rs = new Map(e.slice().sort((a, b) => b.sue - a.sue).map((x, i) => [x.id, i]));
  const rm = new Map(e.map((x, i) => [x.id, i]));
  const out = e.slice().sort((a, b) => (rs.get(a.id)! + rm.get(a.id)!) - (rs.get(b.id)! + rm.get(b.id)!)).map(x => x.id);
  p2Cache.set(t, out);
  return out;
}
const p2 = (t: number) => p2Ranked(t).slice(0, 50);

// ---- A ----
const SECTORS = ['XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLRE', 'XLU', 'XLV', 'XLY'].map(s => c.idOf.get(s)).filter((x): x is number => x != null);
const sectorTop3 = (t: number) => SECTORS.filter(id => C[id][t - 252] > 0 && C[id][t - 21] > 0)
  .sort((a, b) => C[b][t - 21] / C[b][t - 252] - C[a][t - 21] / C[a][t - 252]).slice(0, 3);

// ---- C ----
const interm = (t: number) => pool(t).slice().sort((a, b) => C[b.id][t - 126] / C[b.id][t - 252] - C[a.id][t - 126] / C[a.id][t - 252]).slice(0, 50).map(x => x.id);

// ---- D ----
const pullback = (t: number) => p2Ranked(t).slice(0, 100).sort((a, b) => C[a][t] / C[a][t - 21] - C[b][t] / C[b][t - 21]).slice(0, 50);

// ---- E ----
type Fin = { filing_date?: string; fiscal_period?: string; financials?: { income_statement?: Record<string, { value: number }>; balance_sheet?: Record<string, { value: number }> } };
const finCache = new Map<string, Fin[] | null>();
function profitability(sym: string, date: string): number | null {
  if (!finCache.has(sym)) {
    const f = path.join(DATA, 'fundamentals', 'financials', `${sym}.json.gz`);
    let j: Fin[] | null = null;
    if (fs.existsSync(f)) { try { j = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString()); } catch { j = null; } }
    finCache.set(sym, Array.isArray(j) ? j : null);
  }
  const rows = finCache.get(sym);
  if (!rows) return null;
  const known = rows.filter(r => r.filing_date && r.filing_date <= date && r.fiscal_period === 'FY').sort((a, b) => (a.filing_date! < b.filing_date! ? 1 : -1));
  const r = known[0];
  if (!r || (Date.parse(date) - Date.parse(r.filing_date!)) / 864e5 > 456) return null;
  const oi = r.financials?.income_statement?.operating_income_loss?.value, as = r.financials?.balance_sheet?.assets?.value;
  return typeof oi === 'number' && typeof as === 'number' && as > 0 ? oi / as : null;
}
const profMom = (t: number) => {
  const d = sessions[t];
  const e = pool(t).map(p => ({ ...p, prof: profitability(syms[p.id], d) })).filter(x => x.prof != null) as { id: number; mom: number; prof: number }[];
  const rp = new Map(e.slice().sort((a, b) => b.prof - a.prof).map((x, i) => [x.id, i]));
  const rm = new Map(e.map((x, i) => [x.id, i]));
  return e.slice().sort((a, b) => (rp.get(a.id)! + rm.get(a.id)!) - (rp.get(b.id)! + rm.get(b.id)!)).slice(0, 50).map(x => x.id);
};

// ---- B: 50/50 SPY + P2, rebalanced at month-ends ----
function blend(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(N).fill(1);
  const ends = new Set(sessions.map((d, i) => i).filter(i => i + 1 < N && sessions[i].slice(0, 7) !== sessions[i + 1].slice(0, 7)));
  let v = 1, ia = S0 - 1, ib = S0 - 1;
  for (let d = S0; d < N; d++) {
    out[d] = v * (0.5 * a[d] / a[ia] + 0.5 * b[d] / b[ib]);
    if (ends.has(d)) { v = out[d]; ia = d; ib = d; }
  }
  for (let d = 0; d < S0; d++) out[d] = 1;
  return out;
}

const iSplit = sessions.findIndex(d => d > SPLIT);
function riskHalves(nav: Float64Array) {
  const seg = (a: number, b: number) => {
    let pk = 0, dd = 0; for (let d = a; d <= b; d++) { pk = Math.max(pk, nav[d]); dd = Math.max(dd, 1 - nav[d] / pk); }
    const tot = nav[b] / nav[a] - 1, cagr = (1 + tot) ** (252 / (b - a)) - 1;
    return dd > 0 ? cagr / dd : Infinity;
  };
  return [seg(S0, iSplit), seg(iSplit, N - 1)];
}

const spy = report('SPY', spyNav); console.log(spy.line);
const p2Nav = staggered(p2);
const base = report('P2 momentum+earnings', p2Nav); console.log(base.line);
const spyRisk = riskHalves(spyNav);
console.log(`   SPY CAGR/DD by half: ${spyRisk.map(x => x.toFixed(2)).join(' / ')}`);
const tests: [string, Float64Array, ((t: number) => number[]) | null, boolean][] = [
  ['A sector ETFs top3', staggered(sectorTop3), sectorTop3, true],
  ['B 50% SPY + 50% P2', blend(spyNav, p2Nav), null, true],
  ['C intermediate mom', staggered(interm), interm, false],
  ['D P2 leaders pullback', staggered(pullback), pullback, false],
  ['E profitability+mom', staggered(profMom), profMom, false],
];
for (const [name, nav, pick, riskTest] of tests) {
  const r = report(name, nav);
  const off = pick ? offsets(pick) : '(blend: no rebalance-day test)';
  const days = pick ? Number(off.match(/on (\d+)\/20/)![1]) : 20;
  const passRet = r.tot > spy.tot && r.h1 > spy.h1 && r.h2 > spy.h2 && r.tot > base.tot && days >= 15;
  const rh = riskHalves(nav);
  const passRisk = riskTest && r.tot >= spy.tot && rh[0] > spyRisk[0] && rh[1] > spyRisk[1];
  console.log(`${r.line}\n    ${off} | CAGR/DD by half ${rh.map(x => x.toFixed(2)).join(' / ')}  → return ${passRet ? 'PASS' : 'fail'}${riskTest ? `, risk ${passRisk ? 'PASS' : 'fail'}` : ''}`);
}
const cov = [0, 12, 24, 36].map(i => { const t = [...new Set(sessions.map((_, j) => j))].filter(j => j >= 253 && j + 1 < N && sessions[j].slice(0, 7) !== sessions[j + 1].slice(0, 7))[i]; return t == null ? '' : `${sessions[t]}: profitability ${pool(t).filter(p => profitability(syms[p.id], sessions[t]) != null).length}/${pool(t).length}`; });
console.log('E coverage ' + cov.join(' · '));

// scripts/backtest/rank-risk-check.ts — is "beating SPY" just taking more risk?
// Written after rank-more.ts (a diagnostic, not a pass/fail test). Compares
// the best ranking (P2: momentum + earnings) with ways to take the SAME risk
// without picking stocks: QQQ, and SPY levered 1.25x / 1.5x (rebalanced
// daily, 5%/yr borrowing cost on the borrowed part). Same dates as the engine.
import { c, sessions, C, O, N, S0, report, spyNav, staggered, pool, syms } from './rank-engine';
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
import { DATA } from './cache';
import { sueAt, sueFresh, type Qtr } from '@/lib/sue';
const nav = (id: number) => { const n = new Float64Array(N).fill(1); for (let d = S0; d < N; d++) n[d] = C[id][d] / O[id][S0]; return n; };
const lev = (base: Float64Array, L: number) => { const n = new Float64Array(N).fill(1); for (let d = S0; d < N; d++) { const r = d === S0 ? base[d] - 1 : base[d] / base[d - 1] - 1; n[d] = (d === S0 ? 1 : n[d - 1]) * (1 + L * r - (L - 1) * 0.05 / 252); } return n; };
const qc = new Map<string, Qtr[] | null>();
const qs = (s: string) => { if (!qc.has(s)) { const f = path.join(DATA, 'fundamentals', 'quarterly', `${s}.json.gz`); qc.set(s, fs.existsSync(f) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString()).q : null); } return qc.get(s)!; };
const p2 = (t: number) => {
  const d = sessions[t];
  const e = pool(t).map(p => { const q = qs(syms[p.id]); if (!q) return null; const r = sueAt(q, d); return sueFresh({ s: r.sue, f: r.filed, a: d }, d) ? { ...p, sue: r.sue as number } : null; }).filter((x): x is { id: number; mom: number; sue: number } => !!x);
  const rs = new Map(e.slice().sort((a, b) => b.sue - a.sue).map((x, i) => [x.id, i])); const rm = new Map(e.map((x, i) => [x.id, i]));
  return e.slice().sort((a, b) => (rs.get(a.id)! + rm.get(a.id)!) - (rs.get(b.id)! + rm.get(b.id)!)).slice(0, 50).map(x => x.id);
};
const vol = (n: Float64Array) => { const r: number[] = []; for (let d = S0 + 1; d < N; d++) r.push(n[d] / n[d - 1] - 1); const m = r.reduce((a, b) => a + b, 0) / r.length; return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / r.length * 252); };
const rows: [string, Float64Array][] = [
  ['SPY', spyNav], ['SPY x1.25', lev(spyNav, 1.25)], ['SPY x1.5', lev(spyNav, 1.5)],
  ['QQQ', nav(c.idOf.get('QQQ')!)], ['P2 momentum+earnings', staggered(p2)],
];
for (const [n, v] of rows) console.log(`${report(n, v).line} | volatility ${(vol(v) * 100).toFixed(1)}%`);

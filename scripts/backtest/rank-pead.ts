// scripts/backtest/rank-pead.ts — post-earnings drift: do earnings surprises keep paying?
//
//   npx tsx scripts/backtest/rank-pead.ts
//
// Post-earnings-announcement drift (Ball & Brown 1968; Bernard & Thomas
// 1989): stocks with a big positive earnings surprise keep drifting up for
// weeks to months. With no analyst estimates in our data, the surprise is the
// standard estimate-free measure, SUE: this quarter's EPS minus the same
// quarter a year earlier, divided by the spread of those year-on-year changes
// in the quarters before it.
//
// RULES — fixed 9 Oct 2026, before the first run. Engine and universe:
// rank-engine.ts (same as the momentum tests). Point in time by FILING date
// (backtest-data/fundamentals/quarterly): at a rebalance on date t, only
// quarters filed on or before t exist.
//   SUE   the latest quarter L filed within the last 92 days of t:
//         d(L) = EPS(L) - EPS(same fiscal quarter, prior year); SUE =
//         d(L) / stdev(d) over up to 8 earlier quarters with a year-earlier
//         match (at least 4, stdev > 0). Missing EPS or too little history:
//         no SUE, not eligible.
//   P1    top 50 by SUE.
//   P2    top 50 by the average of the SUE rank and the 12-1 momentum rank
//         (both among SUE-eligible names) — earnings and price momentum
//         together.
//   Benchmarks: SPY; MOM12_1 top 50 (the current best, rank-refine V1).
//   PASS: staggered version beats SPY over the whole period and in BOTH
//     halves, AND beats MOM12_1 top 50 staggered over the whole period (it
//     has to add something to be worth adding), AND beats SPY on at least
//     15 of the 20 rebalance days.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { DATA } from './cache';
import { sessions, syms, pool, staggered, spyNav, report, offsets, momTop50, pct } from './rank-engine';

type Q = { fy: number; fp: string; filed: string; eps: number | null };
const fundCache = new Map<string, Q[] | null>();
function quarters(sym: string): Q[] | null {
  if (fundCache.has(sym)) return fundCache.get(sym)!;
  const f = path.join(DATA, 'fundamentals', 'quarterly', `${sym}.json.gz`);
  let q: Q[] | null = null;
  if (fs.existsSync(f)) { try { q = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString()).q ?? null; } catch { q = null; } }
  fundCache.set(sym, q);
  return q;
}

export function sue(sym: string, date: string): number | null {
  const q = quarters(sym);
  if (!q) return null;
  const known = q.filter(x => x.filed <= date && x.eps != null).sort((a, b) => (a.filed < b.filed ? 1 : -1));
  if (!known.length) return null;
  if ((Date.parse(date) - Date.parse(known[0].filed)) / 86400000 > 92) return null;
  const diff = (x: Q) => { const p = known.find(y => y.fy === x.fy - 1 && y.fp === x.fp); return p ? (x.eps as number) - (p.eps as number) : null; };
  const dL = diff(known[0]);
  if (dL == null) return null;
  const hist: number[] = [];
  for (const x of known.slice(1)) { const d = diff(x); if (d != null) hist.push(d); if (hist.length === 8) break; }
  if (hist.length < 4) return null;
  const m = hist.reduce((a, b) => a + b, 0) / hist.length;
  const sd = Math.sqrt(hist.reduce((a, b) => a + (b - m) ** 2, 0) / (hist.length - 1));
  return sd > 0 ? dL / sd : null;
}

const sueCache = new Map<number, { id: number; sue: number; mom: number }[]>();
function eligible(t: number) {
  if (sueCache.has(t)) return sueCache.get(t)!;
  const out = pool(t).map(p => ({ ...p, sue: sue(syms[p.id], sessions[t]) })).filter(x => x.sue != null) as { id: number; sue: number; mom: number }[];
  sueCache.set(t, out);
  return out;
}
const p1 = (t: number) => eligible(t).slice().sort((a, b) => b.sue - a.sue).slice(0, 50).map(x => x.id);
export const p2 = (t: number) => {
  const e = eligible(t);
  const rs = new Map(e.slice().sort((a, b) => b.sue - a.sue).map((x, i) => [x.id, i]));
  const rm = new Map(e.slice().sort((a, b) => b.mom - a.mom).map((x, i) => [x.id, i]));
  return e.slice().sort((a, b) => (rs.get(a.id)! + rm.get(a.id)!) - (rs.get(b.id)! + rm.get(b.id)!)).slice(0, 50).map(x => x.id);
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
function main() {
const ends = [...new Set(sessions.map((_, i) => i))].filter(i => i >= 253 && i + 1 < sessions.length && sessions[i].slice(0, 7) !== sessions[i + 1].slice(0, 7));
const cov = ends.map(t => [eligible(t).length, pool(t).length]);
console.log(`SUE coverage: median ${cov.map(x => x[0]).sort((a, b) => a - b)[cov.length >> 1]} eligible of ${cov.map(x => x[1]).sort((a, b) => a - b)[cov.length >> 1]} universe names`);

const spy = report('SPY', spyNav); console.log(spy.line);
const mom = report('MOM12_1 top50 (staggered)', staggered(momTop50)); console.log(mom.line);
for (const [name, pick] of [['P1 SUE top50', p1], ['P2 SUE+momentum top50', p2]] as const) {
  const r = report(`${name} (staggered)`, staggered(pick));
  const off = offsets(pick);
  const pass = r.tot > spy.tot && r.h1 > spy.h1 && r.h2 > spy.h2 && r.tot > mom.tot && Number(off.match(/on (\d+)\/20/)![1]) >= 15;
  console.log(`${r.line}\n    ${off}  → ${pass ? 'PASS' : 'fail'}`);
}
console.log(`(MOM12_1 top50 for reference: ${offsets(momTop50)})`);
void pct;
}

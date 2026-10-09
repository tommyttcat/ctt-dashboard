// scripts/backtest/rank-refine.ts — can 12-1 momentum be made steadier?
//
//   npx tsx scripts/backtest/rank-refine.ts
//
// rank-hold / rank-offsets (9 Oct 2026): MOM12_1 top 50 beat SPY on all 20
// rebalance days (median +51% over Sep 2022 - Sep 2026) but trailed SPY in
// the first half (+48% vs +55%) and fell harder (-24% monthly vs -8%).
//
// RULES — fixed 9 Oct 2026, before the first run. Universe and MOM12_1 are
// rank-hold.ts's exactly; fills at the next open; 0.1% a side on turnover;
// marked to market DAILY (closes; a name that stops trading holds its last
// close until the next rebalance sells it).
//   V0  baseline: MOM12_1 top 50, rebalanced at month-end.
//   V1  staggered: four sleeves of 25%, each MOM12_1 top 50 rebalanced
//       monthly on the 1st, 6th, 11th and 16th session of the month; sleeves
//       never rebalance against each other (removes rebalance-day luck).
//   V2  volatility-scaled (Barroso & Santa-Clara 2015, the published fix for
//       momentum crashes): at each rebalance, exposure = min(1, 20% / the
//       strategy's own annualised volatility over the prior 126 sessions);
//       the rest sits in cash at 0%. Month-end, top 50.
//   V3  V1 + V2: each staggered sleeve vol-scaled on its own history.
//   V4  momentum + growth: the top 50 by MOM12_1 among names whose latest
//       quarter filed on or before the rebalance date (and within 120 days)
//       shows revenue up >= 25% on the same quarter a year earlier (Magna53's
//       sales bar). Names without fundamentals are excluded. Fewer than 10
//       qualifiers: filled to 10 from the plain momentum ranking.
//       Month-end.
//   Benchmark: SPY bought at the same first open and held.
//   PASS: beats SPY over the whole period AND in BOTH halves (split
//     2024-09-30, as in rank-hold), on daily marks. Reported alongside:
//     worst daily peak-to-trough, and return per unit of that drawdown.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DATA, loadAdjusted } from './cache';
import { loadReference, refAt } from './reference';

const c = loadAdjusted();
const ref = loadReference();
const { sessions, syms, O, H, C, V } = c;
const N = sessions.length;
const spyId = c.idOf.get('SPY')!;
const COST = 0.001;
const SPLIT = '2024-09-30';

const typeOk = new Map<string, boolean>();
const isStock = (sym: string, date: string) => {
  const k = `${sym}|${date.slice(0, 4)}`;
  if (!typeOk.has(k)) { const t = (refAt(ref, sym, date)?.type || '').toUpperCase(); typeOk.set(k, t === 'CS' || t === 'ADRC'); }
  return typeOk.get(k)!;
};

type P = { id: number; mom: number };
const poolCache = new Map<number, P[]>();
function pool(t: number): P[] {
  if (poolCache.has(t)) return poolCache.get(t)!;
  const out: P[] = [];
  for (let id = 0; id < syms.length; id++) {
    const cl = C[id][t];
    if (!(cl >= 5)) continue;
    let dv = 0, ok = true;
    for (let j = t - 19; j <= t; j++) dv += C[id][j] * V[id][j];
    if (!(dv / 20 >= 20e6)) continue;
    for (let j = t - 252; j <= t; j++) if (Number.isNaN(C[id][j])) { ok = false; break; }
    if (!ok || !isStock(syms[id], sessions[t])) continue;
    out.push({ id, mom: C[id][t - 21] / C[id][t - 252] - 1 });
  }
  out.sort((a, b) => b.mom - a.mom);
  poolCache.set(t, out);
  return out;
}

// ---- fundamentals (point in time by filing date) ----
type Q = { fy: number; fp: string; filed: string; rev: number | null };
const fundCache = new Map<string, Q[] | null>();
function quarters(sym: string): Q[] | null {
  if (fundCache.has(sym)) return fundCache.get(sym)!;
  const f = path.join(DATA, 'fundamentals', 'quarterly', `${sym}.json.gz`);
  let q: Q[] | null = null;
  if (fs.existsSync(f)) { try { q = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString()).q ?? null; } catch { q = null; } }
  fundCache.set(sym, q);
  return q;
}
function revGrowth(sym: string, date: string): number | null {
  const q = quarters(sym);
  if (!q) return null;
  const known = q.filter(x => x.filed <= date && x.rev != null).sort((a, b) => (a.filed < b.filed ? 1 : -1));
  const last = known[0];
  if (!last) return null;
  if ((Date.parse(date) - Date.parse(last.filed)) / 86400000 > 120) return null;
  const prior = known.find(x => x.fy === last.fy - 1 && x.fp === last.fp);
  if (!prior || !(prior.rev! > 0)) return null;
  return last.rev! / prior.rev! - 1;
}

// ---- schedules ----
function sched(kind: 'end' | number): number[] {
  const out: number[] = [];
  if (kind === 'end') { for (let s = 0; s < N - 1; s++) if (sessions[s].slice(0, 7) !== sessions[s + 1].slice(0, 7)) out.push(s); }
  else { let cnt = 0; for (let s = 1; s < N; s++) { if (sessions[s].slice(0, 7) !== sessions[s - 1].slice(0, 7)) cnt = 0; cnt++; if (cnt === kind) out.push(s); } }
  return out.filter(s => s >= 253 && s + 1 < N);
}

/** Daily NAV of one sleeve (starts at 1 on its first fill; 1 before it). */
function sleeve(reb: number[], pick: (t: number) => number[], volTarget: number | null): Float64Array {
  const nav = new Float64Array(N).fill(1);
  const raw = new Float64Array(N).fill(1);            // unscaled, for the vol estimate
  let prev = new Set<number>();
  let v = 1, vr = 1;
  for (let i = 0; i < reb.length; i++) {
    const a = reb[i] + 1, b = i + 1 < reb.length ? reb[i + 1] + 1 : N;
    if (a >= N) break;
    const ids = pick(reb[i]);
    let e = 1;
    if (volTarget != null) {
      const rets: number[] = [];
      for (let d = Math.max(1, a - 126); d < a; d++) if (raw[d - 1] > 0) rets.push(raw[d] / raw[d - 1] - 1);
      if (rets.length >= 63) {
        const m = rets.reduce((x, y) => x + y, 0) / rets.length;
        const sd = Math.sqrt(rets.reduce((x, y) => x + (y - m) ** 2, 0) / rets.length) * Math.sqrt(252);
        e = sd > 0 ? Math.min(1, volTarget / sd) : 1;
      }
    }
    const turn = ids.length ? ids.filter(x => !prev.has(x)).length / ids.length : 0;
    v *= 1 - 2 * COST * turn * e;
    vr *= 1 - 2 * COST * turn;
    const last = new Map<number, number>();
    for (let d = a; d < b; d++) {
      let sum = 0;
      for (const id of ids) {
        const px = !Number.isNaN(C[id][d]) ? C[id][d] : (last.get(id) ?? O[id][a]);
        last.set(id, px);
        sum += O[id][a] > 0 ? px / O[id][a] - 1 : 0;
      }
      const r = ids.length ? sum / ids.length : 0;
      nav[d] = v * (1 + e * r);
      raw[d] = vr * (1 + r);
    }
    // realise at the next rebalance open (or hold the last mark at the end)
    if (b < N) {
      let sum = 0;
      for (const id of ids) {
        const px = O[id][b] > 0 ? O[id][b] : (last.get(id) ?? O[id][a]);
        sum += O[id][a] > 0 ? px / O[id][a] - 1 : 0;
      }
      const r = ids.length ? sum / ids.length : 0;
      v *= 1 + e * r; vr *= 1 + r;
    }
    prev = new Set(ids);
  }
  // before the first fill
  const first = reb.length ? reb[0] + 1 : N;
  for (let d = 0; d < first; d++) { nav[d] = 1; raw[d] = 1; }
  return nav;
}

const top50 = (t: number) => pool(t).slice(0, 50).map(x => x.id);
const growth50 = (t: number) => {
  const date = sessions[t];
  const ok = pool(t).filter(x => { const g = revGrowth(syms[x.id], date); return g != null && g >= 0.25; }).slice(0, 50).map(x => x.id);
  if (ok.length >= 10) return ok;
  const fill = pool(t).map(x => x.id).filter(id => !ok.includes(id));
  return [...ok, ...fill.slice(0, 10 - ok.length)];
};

const ends = sched('end');
const S0 = ends[0] + 1;                                   // common start: first month-end fill
const stag = [1, 6, 11, 16].map(k => sched(k).filter(s => s + 1 >= S0));
const combine = (navs: Float64Array[]) => { const out = new Float64Array(N); for (let d = 0; d < N; d++) out[d] = navs.reduce((a, n) => a + n[d], 0) / navs.length; return out; };

const variants: [string, Float64Array][] = [
  ['V0 month-end top50', sleeve(ends, top50, null)],
  ['V1 staggered x4', combine(stag.map(r => sleeve(r, top50, null)))],
  ['V2 vol-scaled', sleeve(ends, top50, 0.20)],
  ['V3 staggered+vol', combine(stag.map(r => sleeve(r, top50, 0.20)))],
  ['V4 mom+rev growth', sleeve(ends, growth50, null)],
];
const spy = new Float64Array(N); for (let d = 0; d < N; d++) spy[d] = d < S0 ? 1 : C[spyId][d] / O[spyId][S0];

const iSplit = sessions.findIndex(d => d > SPLIT);
const last = N - 1;
const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
function report(name: string, nav: Float64Array) {
  const base = nav[S0 - 1] > 0 ? nav[S0 - 1] : 1;
  const tot = nav[last] / base - 1, h1 = nav[iSplit] / base - 1, h2 = nav[last] / nav[iSplit] - 1;
  let pk = 0, dd = 0, at = '';
  for (let d = S0; d <= last; d++) { pk = Math.max(pk, nav[d]); if (1 - nav[d] / pk > dd) { dd = 1 - nav[d] / pk; at = sessions[d]; } }
  const years = (last - S0) / 252, cagr = (1 + tot) ** (1 / years) - 1;
  const yr: string[] = [];
  for (const y of ['2022', '2023', '2024', '2025', '2026']) {
    const ds = sessions.map((s, i) => [s, i] as const).filter(([s, i]) => s.startsWith(y) && i >= S0);
    if (!ds.length) continue;
    const a = Math.max(S0 - 1, ds[0][1] - 1), b = ds[ds.length - 1][1];
    yr.push(`${y} ${pct(nav[b] / nav[a] - 1)}`);
  }
  return { line: `${name.padEnd(20)} total ${pct(tot).padStart(7)} CAGR ${pct(cagr).padStart(6)} | 1st ${pct(h1).padStart(7)} 2nd ${pct(h2).padStart(7)} | worst drop ${pct(-dd).padStart(6)} (${at}) | CAGR/DD ${(cagr / dd).toFixed(2)} | ${yr.join(' ')}`, tot, h1, h2 };
}
console.log(`period ${sessions[S0]} → ${sessions[last]}, split ${SPLIT}`);
const s = report('SPY', spy);
console.log(s.line);
for (const [name, nav] of variants) {
  const r = report(name, nav);
  console.log(r.line + `  → ${r.tot > s.tot && r.h1 > s.h1 && r.h2 > s.h2 ? 'PASS' : 'fail'}`);
}
const cov = ends.map(t => pool(t).slice(0, 100).filter(x => revGrowth(syms[x.id], sessions[t]) != null).length);
console.log(`V4 coverage: of each month's top-100 momentum names, median ${cov.sort((a, b) => a - b)[cov.length >> 1]} have usable fundamentals`);

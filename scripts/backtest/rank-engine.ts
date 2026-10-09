// scripts/backtest/rank-engine.ts — the shared machinery for monthly rank-and-hold tests.
//
// Lifted from rank-refine.ts / rank-offsets.ts (rules fixed 9 Oct 2026) so
// every later ranking (earnings drift, industry momentum) is measured the
// same way: universe = CS/ADRC, close >= $5, 20-session $20M+, 253 bars
// present; fills at the next open; 0.1% a side on turnover; daily marks;
// staggered sleeves on sessions 1/6/11/16; every-rebalance-day check 1..20;
// split at 2024-09-30.

import { loadAdjusted } from './cache';
import { loadReference, refAt } from './reference';

export const c = loadAdjusted();
const ref = loadReference();
export const { sessions, syms, O, H, C, V } = c;
export const N = sessions.length;
export const spyId = c.idOf.get('SPY')!;
export const COST = 0.001;
export const SPLIT = '2024-09-30';

const typeOk = new Map<string, boolean>();
const isStock = (sym: string, date: string) => {
  const k = `${sym}|${date.slice(0, 4)}`;
  if (!typeOk.has(k)) { const t = (refAt(ref, sym, date)?.type || '').toUpperCase(); typeOk.set(k, t === 'CS' || t === 'ADRC'); }
  return typeOk.get(k)!;
};

export type P = { id: number; mom: number };
const poolCache = new Map<number, P[]>();
/** The universe at close t, strongest 12-1 momentum first. */
export function pool(t: number): P[] {
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

export function sched(kind: 'end' | number): number[] {
  const out: number[] = [];
  if (kind === 'end') { for (let s = 0; s < N - 1; s++) if (sessions[s].slice(0, 7) !== sessions[s + 1].slice(0, 7)) out.push(s); }
  else { let cnt = 0; for (let s = 1; s < N; s++) { if (sessions[s].slice(0, 7) !== sessions[s - 1].slice(0, 7)) cnt = 0; cnt++; if (cnt === kind) out.push(s); } }
  return out.filter(s => s >= 253 && s + 1 < N);
}

/** Daily NAV of one sleeve (1 before its first fill). */
export function sleeve(reb: number[], pick: (t: number) => number[]): Float64Array {
  const nav = new Float64Array(N).fill(1);
  let prev = new Set<number>();
  let v = 1;
  for (let i = 0; i < reb.length; i++) {
    const a = reb[i] + 1, b = i + 1 < reb.length ? reb[i + 1] + 1 : N;
    if (a >= N) break;
    const ids = pick(reb[i]);
    const turn = ids.length ? ids.filter(x => !prev.has(x)).length / ids.length : 0;
    v *= 1 - 2 * COST * turn;
    const last = new Map<number, number>();
    for (let d = a; d < b; d++) {
      let sum = 0;
      for (const id of ids) {
        const px = !Number.isNaN(C[id][d]) ? C[id][d] : (last.get(id) ?? O[id][a]);
        last.set(id, px);
        sum += O[id][a] > 0 ? px / O[id][a] - 1 : 0;
      }
      nav[d] = v * (1 + (ids.length ? sum / ids.length : 0));
    }
    if (b < N) {
      let sum = 0;
      for (const id of ids) {
        const px = O[id][b] > 0 ? O[id][b] : (last.get(id) ?? O[id][a]);
        sum += O[id][a] > 0 ? px / O[id][a] - 1 : 0;
      }
      v *= 1 + (ids.length ? sum / ids.length : 0);
    }
    prev = new Set(ids);
  }
  return nav;
}

export const combine = (navs: Float64Array[]) => { const out = new Float64Array(N); for (let d = 0; d < N; d++) out[d] = navs.reduce((a, n) => a + n[d], 0) / navs.length; return out; };
export const S0 = sched('end')[0] + 1;
export const staggered = (pick: (t: number) => number[]) => combine([1, 6, 11, 16].map(k => sleeve(sched(k).filter(s => s + 1 >= S0), pick)));
export const spyNav = (() => { const n = new Float64Array(N); for (let d = 0; d < N; d++) n[d] = d < S0 ? 1 : C[spyId][d] / O[spyId][S0]; return n; })();

export const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const iSplit = sessions.findIndex(d => d > SPLIT);
export function report(name: string, nav: Float64Array) {
  const last = N - 1, base = nav[S0 - 1] > 0 ? nav[S0 - 1] : 1;
  const tot = nav[last] / base - 1, h1 = nav[iSplit] / base - 1, h2 = nav[last] / nav[iSplit] - 1;
  let pk = 0, dd = 0;
  for (let d = S0; d <= last; d++) { pk = Math.max(pk, nav[d]); dd = Math.max(dd, 1 - nav[d] / pk); }
  const cagr = (1 + tot) ** (252 / (last - S0)) - 1;
  return { tot, h1, h2, dd, line: `${name.padEnd(24)} total ${pct(tot).padStart(7)} | 1st ${pct(h1).padStart(7)} 2nd ${pct(h2).padStart(7)} | worst drop ${pct(-dd).padStart(6)} | CAGR/DD ${(cagr / dd).toFixed(2)}` };
}

/** Monthly open-to-open returns for rebalance days 1..20: how many beat SPY. */
export function offsets(pick: (t: number) => number[]) {
  const hold = (id: number, a: number, b: number) => {
    const buy = O[id][a]; if (!(buy > 0)) return 0;
    if (O[id][b] > 0) return O[id][b] / buy - 1;
    let s = b; while (s > a && Number.isNaN(C[id][s])) s--; return C[id][s] / buy - 1;
  };
  const grow = (rs: number[]) => rs.reduce((g, r) => g * (1 + r), 1) - 1;
  const run = (reb: number[], f: (t: number) => number[]) => {
    const rets: number[] = []; let prev = new Set<number>();
    for (let i = 0; i < reb.length; i++) {
      const a = reb[i] + 1, b = i + 1 < reb.length ? reb[i + 1] + 1 : N - 1; if (a >= b) break;
      const ids = f(reb[i]);
      const tv = ids.length ? ids.filter(x => !prev.has(x)).length / ids.length : 0;
      rets.push(ids.reduce((s, id) => s + hold(id, a, b), 0) / Math.max(1, ids.length) - 2 * COST * tv);
      prev = new Set(ids);
    }
    return rets;
  };
  let beat = 0; const ex: number[] = [];
  for (let k = 1; k <= 20; k++) {
    const reb = sched(k);
    const r = grow(run(reb, pick)), s = grow(run(reb, () => [spyId]));
    if (r > s) beat++;
    ex.push(r - s);
  }
  ex.sort((a, b) => a - b);
  return `beats SPY on ${beat}/20 rebalance days; median excess ${pct(ex[10])} (range ${pct(ex[0])} to ${pct(ex[19])})`;
}

/** The current best: MOM12_1 top 50. */
export const momTop50 = (t: number) => pool(t).slice(0, 50).map(x => x.id);

// scripts/backtest/rank-offsets.ts — timing luck: every rebalance day of the month.
//
//   npx tsx scripts/backtest/rank-offsets.ts
//
// rank-robust.ts showed TREND top 20 at +190% rebalancing at month-end but
// +68% rebalancing on the 10th session. The honest read is the spread over
// EVERY possible rebalance day, not any one of them. For sessions 1..20 of
// each month: TREND top 20 / top 50 and MOM12_1 top 50 (rank-hold.ts rules
// otherwise), against SPY over the same windows. Written after seeing the
// two results; it reports all offsets and picks none.
import { loadAdjusted } from './cache';
import { loadReference, refAt } from './reference';

const c = loadAdjusted();
const ref = loadReference();
const { sessions, syms, O, H, C, V } = c;
const N = sessions.length;
const spyId = c.idOf.get('SPY')!;
const COST = 0.001;
const typeOk = new Map<string, boolean>();
const isStock = (sym: string, date: string) => {
  const k = `${sym}|${date.slice(0, 4)}`;
  if (!typeOk.has(k)) { const t = (refAt(ref, sym, date)?.type || '').toUpperCase(); typeOk.set(k, t === 'CS' || t === 'ADRC'); }
  return typeOk.get(k)!;
};
type P = { id: number; mom: number; trend: boolean };
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
    let hi = 0; for (let j = t - 251; j <= t; j++) hi = Math.max(hi, H[id][j]);
    let s200 = 0; for (let j = t - 199; j <= t; j++) s200 += C[id][j]; s200 /= 200;
    out.push({ id, mom: C[id][t - 21] / C[id][t - 252] - 1, trend: cl > s200 && cl >= 0.85 * hi });
  }
  poolCache.set(t, out);
  return out;
}
const hold = (id: number, a: number, b: number) => {
  const buy = O[id][a]; if (!(buy > 0)) return 0;
  if (O[id][b] > 0) return O[id][b] / buy - 1;
  let s = b; while (s > a && Number.isNaN(C[id][s])) s--; return C[id][s] / buy - 1;
};
const grow = (rs: number[]) => rs.reduce((g, r) => g * (1 + r), 1) - 1;
const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%`;
function sched(k: number) {
  const out: number[] = []; let cnt = 0;
  for (let s = 1; s < N; s++) { if (sessions[s].slice(0, 7) !== sessions[s - 1].slice(0, 7)) cnt = 0; cnt++; if (cnt === k) out.push(s); }
  return out.filter(s => s >= 253 && s + 1 < N);
}
function run(reb: number[], pick: (p: P[]) => number[]) {
  const rets: number[] = []; let prev = new Set<number>();
  for (let i = 0; i < reb.length; i++) {
    const a = reb[i] + 1, b = i + 1 < reb.length ? reb[i + 1] + 1 : N - 1; if (a >= b) break;
    const ids = pick(pool(reb[i]));
    const t = ids.length ? ids.filter(x => !prev.has(x)).length / ids.length : 0;
    rets.push(ids.reduce((s, id) => s + hold(id, a, b), 0) / Math.max(1, ids.length) - 2 * COST * t);
    prev = new Set(ids);
  }
  return rets;
}
const strategies: [string, (p: P[]) => number[]][] = [
  ['TREND top20', p => p.filter(x => x.trend).sort((a, b) => b.mom - a.mom).slice(0, 20).map(x => x.id)],
  ['TREND top50', p => p.filter(x => x.trend).sort((a, b) => b.mom - a.mom).slice(0, 50).map(x => x.id)],
  ['MOM12_1 top50', p => p.slice().sort((a, b) => b.mom - a.mom).slice(0, 50).map(x => x.id)],
];
const rows: Record<string, { tot: number; h1: number; h2: number; spy: number; s1: number; s2: number }[]> = {};
for (let k = 1; k <= 20; k++) {
  const reb = sched(k);
  const spy = run(reb, () => [spyId]); const h = spy.length >> 1;
  const line: string[] = [`day ${String(k).padStart(2)}  SPY ${pct(grow(spy)).padStart(5)}`];
  for (const [name, f] of strategies) {
    const r = run(reb, f);
    (rows[name] ||= []).push({ tot: grow(r), h1: grow(r.slice(0, h)), h2: grow(r.slice(h)), spy: grow(spy), s1: grow(spy.slice(0, h)), s2: grow(spy.slice(h)) });
    line.push(`${name} ${pct(grow(r)).padStart(5)}`);
  }
  console.log(line.join(' | '));
}
for (const [name, rs] of Object.entries(rows)) {
  const tots = rs.map(r => r.tot - r.spy).sort((a, b) => a - b);
  const bothHalves = rs.filter(r => r.h1 > r.s1 && r.h2 > r.s2).length;
  const beatTot = rs.filter(r => r.tot > r.spy).length;
  console.log(`${name.padEnd(14)} beats SPY overall on ${beatTot}/20 rebalance days, in BOTH halves on ${bothHalves}/20; median excess over SPY ${pct(tots[10])} (range ${pct(tots[0])} to ${pct(tots[19])})`);
}

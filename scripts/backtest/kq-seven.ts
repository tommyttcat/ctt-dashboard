// scripts/backtest/kq-seven.ts — "7 things Qullamaggie's big breakout winners had in common"
// (shared 11 Oct 2026). Traits 1-3 were near-identical for his winners and his stop-outs; the
// post says 4-7 separate them. Setup, entries and outcomes are copied verbatim from kq-db.ts.
//
//   LONG=1 NODE_OPTIONS=--max-old-space-size=12288 npx tsx scripts/backtest/kq-seven.ts
//
// RULES — fixed 11 Oct 2026, before the first run. At the prior close t (6 at the entry open):
//   4 STEADY: the run-up = lowest low in the 126 sessions before the 60-day high → that high;
//     less than 55% of it came in its final fifth (by sessions).
//   5 QUIET: close(t) / close(t-20) - 1 < 2 x ADR.
//   6 NO GAP: entry-day open < close(t) x (1 + 0.5 ADR).
//   7 MARKET CALM: QQQ up less than 5% over 20 sessions.
//   Outcome = kq-db.ts T10 (buy the entry-day close, out at the first close below the 10-day
//     SMA, max 60 sessions), excess vs QQQ same window after 0.2%.
//   (A) HIS trades: all four vs not all four — T10 excess higher with all four, in BOTH halves
//       (before 2019 / from 2019).
//   (B) EVERY KQ SETUP signal 2016-2026: with all four, T10 excess > 0 AND above the unfiltered
//       setup's, in BOTH halves (2016-20, 2021-26); and a $100k 20-slot (5%) account beats QQQ
//       held in both halves.
//   PASS = (B). (A) is reported: his trades are hand-picked and mostly 2019-21.

import fs from 'node:fs';
import path from 'node:path';
import { DATA, loadAdjusted, listSessions, readDay } from './cache';
import { loadReference, refAt } from './reference';

type E = { sym: string; date: string; type: string };
const raw: E[] = JSON.parse(fs.readFileSync(path.join(DATA, 'kq_db', 'entries.json'), 'utf8'));
const c = loadAdjusted();
const ref = loadReference();
const { sessions, syms, O, H, L, C, V } = c;
const N = sessions.length;
const sIdx = new Map(sessions.map((d, i) => [d, i]));
const qId = c.idOf.get('QQQ')!;
const RC: Float32Array[] = syms.map(() => new Float32Array(N).fill(NaN));
{ if (listSessions().length !== N) throw new Error('session mismatch');
  for (let s = 0; s < N; s++) for (const r of readDay('unadj', sessions[s])) { const id = c.idOf.get(r[0]); if (id != null) RC[id][s] = r[4]; } }
const typeOk = new Map<string, boolean>();
const isStock = (sym: string, date: string) => { const k = `${sym}|${date.slice(0, 4)}`; if (!typeOk.has(k)) { const t = (refAt(ref, sym, date)?.type || '').toUpperCase(); typeOk.set(k, t === 'CS' || t === 'ADRC'); } return typeOk.get(k)!; };
const COST = 0.002;
const sma = (id: number, t: number, n: number) => { let s = 0; for (let j = t - n + 1; j <= t; j++) s += C[id][j]; return s / n; };
const full = (id: number, t: number, n: number) => { for (let j = t - n; j <= t; j++) if (Number.isNaN(C[id][j])) return false; return true; };
const liquid = (id: number, t: number) => { if (!(RC[id][t] >= 2) || !full(id, t, 260)) return false; let dv = 0; for (let j = t - 19; j <= t; j++) dv += C[id][j] * V[id][j]; return dv / 20 >= 20e6 && isStock(syms[id], sessions[t]); };
const adr = (id: number, t: number) => { let s = 0; for (let j = t - 19; j <= t; j++) s += H[id][j] / L[id][j] - 1; return s / 20; };
const qS = (t: number, n: number) => sma(qId, t, n);

// --- his entries, deduped ---
const byName = new Map<string, number[]>();
let dropped = { notStock: 0, noBars: 0, dup: 0, early: 0 };
const mine: { id: number; e: number; type: string }[] = [];
for (const x of raw.sort((a, b) => (a.date < b.date ? -1 : 1))) {
  const id = c.idOf.get(x.sym); const e = sIdx.get(x.date);
  if (id == null || e == null || Number.isNaN(C[id][e])) { dropped.noBars++; continue; }
  if (e < 261 || !full(id, e - 1, 260)) { dropped.early++; continue; }
  if (!isStock(x.sym, x.date)) { dropped.notStock++; continue; }
  const prev = byName.get(x.sym) ?? [];
  if (prev.some(p => e - p <= 5 && e >= p)) { dropped.dup++; continue; }
  prev.push(e); byName.set(x.sym, prev);
  mine.push({ id, e, type: x.type });
}
console.log(`his markers ${raw.length} → usable stock entries ${mine.length}; dropped`, dropped);

// --- per-day return percentiles among ALL (prior close) ---
const pctl = new Map<string, number>();     // `${id}|${t}|k` -> percentile
const dayCache = new Map<number, { id: number; r: number[] }[]>();
const dayPool = (t: number) => {
  if (dayCache.has(t)) return dayCache.get(t)!;
  const out: { id: number; r: number[] }[] = [];
  for (let id = 0; id < syms.length; id++) if (liquid(id, t)) out.push({ id, r: [21, 63, 126].map(k => C[id][t] / C[id][t - k] - 1) });
  dayCache.set(t, out);
  for (let k = 0; k < 3; k++) { const s = out.map(o => o.r[k]).sort((a, b) => a - b); for (const o of out) { let lo = 0, hi = s.length; while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] < o.r[k]) lo = m + 1; else hi = m; } pctl.set(`${o.id}|${t}|${k}`, lo / s.length); } }
  return out;
};

type Row = { id: number; e: number; f: Record<string, number>; t10: number; h20: number; setup: boolean; seven: boolean[]; x: number; ret: number };
const traits = (id: number, e: number): Row | null => {
  const t = e - 1; if (e + 1 >= N) return null;
  dayPool(t);
  const a = adr(id, t);
  let hi60 = -Infinity, hiAt = t; for (let j = t - 59; j <= t; j++) if (H[id][j] >= hi60) { hi60 = H[id][j]; hiAt = j; }
  let lo = Infinity; for (let j = hiAt; j <= t; j++) lo = Math.min(lo, L[id][j]);
  let h3 = -Infinity, l3 = Infinity; for (let j = t - 2; j <= t; j++) { h3 = Math.max(h3, H[id][j]); l3 = Math.min(l3, L[id][j]); }
  let vs = 0, dv = 0; for (let j = t - 19; j <= t; j++) { vs += V[id][j]; dv += C[id][j] * V[id][j]; }
  const p = (k: number) => pctl.get(`${id}|${t}|${k}`) ?? NaN;
  const f: Record<string, number> = {
    p1m: p(0), p3m: p(1), p6m: p(2), adr: a * 100, offHigh60: (1 - C[id][t] / hi60) * 100, sinceHigh: t - hiAt, depth: (1 - lo / hi60) * 100,
    tight3: (h3 / l3 - 1) / a, vs10: (C[id][t] / sma(id, t, 10) - 1) * 100, vs20: (C[id][t] / sma(id, t, 20) - 1) * 100, vs50: (C[id][t] / sma(id, t, 50) - 1) * 100,
    dvolM: dv / 20 / 1e6, gap: (O[id][e] / C[id][t] - 1) * 100, dayChg: (C[id][e] / C[id][t] - 1) * 100, rvol: V[id][e] / (vs / 20),
    qqq200: C[qId][t] > qS(t, 200) ? 1 : 0, qqq1020: qS(t, 10) > qS(t, 20) ? 1 : 0,
  };
  // KQ setup at t (qullamaggie.ts U1-U2, T1, B1-B5) + break of the 3-day high on e
  const s10 = sma(id, t, 10), s20 = sma(id, t, 20), s50 = sma(id, t, 50);
  const setup = RC[id][t] >= 5 && f.dvolM >= 20 && a >= 0.05 && Math.max(f.p1m, f.p3m, f.p6m) >= 0.93
    && C[id][t] > s50 && s10 > sma(id, t - 5, 10) && s20 > sma(id, t - 5, 20) && s50 > sma(id, t - 5, 50)
    && f.sinceHigh >= 3 && f.sinceHigh <= 40 && f.depth <= 30 && (h3 - l3) / C[id][t] <= 1.5 * a
    && Math.min(...[0, 1, 2, 3, 4].map(i => L[id][t - i])) > Math.min(...[5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(i => L[id][t - i]))
    && C[id][t] >= s20 && C[id][t] <= s10 * (1 + a) && H[id][e] > h3;
  // outcomes from the entry day's close
  const fill = C[id][e];
  const qr = (k: number) => C[qId][k] / C[qId][e] - 1;
  let h20 = NaN, t10 = NaN;
  if (e + 20 < N) { let k = e + 20; while (k > e && Number.isNaN(C[id][k])) k--; h20 = C[id][k] / fill - 1 - COST - qr(e + 20); }
  let x = -1, ret = NaN;
  for (let k = e + 1; k < N && k <= e + 60; k++) { if (Number.isNaN(C[id][k])) continue; if (C[id][k] < sma(id, k, 10) || k === e + 60) { t10 = C[id][k] / fill - 1 - COST - qr(k); x = k; ret = C[id][k] / fill - 1 - COST; break; } }
  if (Number.isNaN(t10)) return null;
  // the post's traits 4-7, at the prior close t (6 uses the entry day's open)
  let loMv = Infinity, loAt = hiAt; for (let j = Math.max(0, hiAt - 126); j <= hiAt; j++) if (L[id][j] < loMv) { loMv = L[id][j]; loAt = j; }
  const D = hiAt - loAt, f5 = Math.max(hiAt - Math.ceil(D / 5), loAt);
  const steady = D >= 5 && hi60 > loMv && (hi60 - C[id][f5]) / (hi60 - loMv) < 0.55;
  const quiet = C[id][t] / C[id][t - 20] - 1 < 2 * a;
  const noGap = O[id][e] < C[id][t] * (1 + 0.5 * a);
  const mktCalm = C[qId][t] / C[qId][t - 20] - 1 < 0.05;
  return { id, e, f, t10, h20, setup, seven: [steady, quiet, noGap, mktCalm], x, ret };
};


const his: Row[] = mine.map(m => traits(m.id, m.e)).filter((r): r is Row => !!r);
const START = sIdx.get(sessions.find(d => d >= '2016-01-01')!)!, MID = sIdx.get(sessions.find(d => d >= '2021-01-01')!)!;
const setupRows: Row[] = [];
for (let e = START; e < N - 1; e++) {
  for (const o of dayPool(e - 1)) {
    if (Number.isNaN(C[o.id][e])) continue;
    const pre = Math.max(pctl.get(`${o.id}|${e - 1}|0`) ?? 0, pctl.get(`${o.id}|${e - 1}|1`) ?? 0, pctl.get(`${o.id}|${e - 1}|2`) ?? 0) >= 0.93;
    if (!pre) continue;
    const r = traits(o.id, e); if (r?.setup) setupRows.push(r);
  }
  if (dayCache.size > 400) for (const k of [...dayCache.keys()].slice(0, 200)) dayCache.delete(k);
}
const pct = (x: number) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%` : '—');
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
const all4 = (r: Row) => r.seven.every(Boolean);
const NAMES = ['4 steady', '5 quiet', '6 no gap', '7 market calm'];
const line = (lab: string, rs: Row[]) => `${lab.padEnd(26)} n ${String(rs.length).padStart(5)} | T10 vs QQQ ${pct(mean(rs.map(r => r.t10))).padStart(7)} | win ${(100 * mean(rs.map(r => +(r.ret > 0)))).toFixed(0).padStart(2)}% | +20%+ ${(100 * mean(rs.map(r => +(r.ret >= 0.2)))).toFixed(1)}%`;

console.log(`\n(A) HIS TRADES (n ${his.length}) — share with each trait: ${NAMES.map((n, i) => `${n} ${(100 * mean(his.map(r => +r.seven[i]))).toFixed(0)}%`).join(', ')}`);
const SPLIT = sIdx.get(sessions.find(d => d >= '2019-01-01')!)!;
let aOk = true;
for (const [h, rs] of [['before 2019', his.filter(r => r.e < SPLIT)], ['from 2019', his.filter(r => r.e >= SPLIT)]] as const) {
  const y = rs.filter(all4), n = rs.filter(r => !all4(r));
  if (!(mean(y.map(r => r.t10)) > mean(n.map(r => r.t10)))) aOk = false;
  console.log(` ${h}:\n   ${line('all four', y)}\n   ${line('not all four', n)}`);
  for (const [i, nm] of NAMES.entries()) console.log(`   ${line(`  ${nm}: yes`, rs.filter(r => r.seven[i]))}  vs no ${pct(mean(rs.filter(r => !r.seven[i]).map(r => r.t10)))}`);
}
console.log(` → (A) ${aOk ? 'all four helped in both halves' : 'did not help in both halves'}`);

function account(ts: Row[], from: number, to: number) {
  let cash = 1e5; const pos: { r: Row; sh: number }[] = []; let eq = 1e5, peak = 1e5, dd = 0;
  const byDay = new Map<number, Row[]>(); for (const r of ts) if (r.e >= from && r.e <= to) (byDay.get(r.e) ?? byDay.set(r.e, []).get(r.e)!).push(r);
  const last = (id: number, s: number) => { let k = s; while (k > 0 && Number.isNaN(C[id][k])) k--; return C[id][k]; };
  for (let s = from; s <= to; s++) {
    for (let i = pos.length - 1; i >= 0; i--) if (pos[i].r.x <= s) { cash += pos[i].sh * C[pos[i].r.id][pos[i].r.x] * 0.999; pos.splice(i, 1); }
    const equity = cash + pos.reduce((a, p) => a + p.sh * last(p.r.id, s), 0);
    for (const r of (byDay.get(s) ?? []).sort((a, b) => b.f.rvol - a.f.rvol)) { if (pos.length >= 20 || pos.some(p => p.r.id === r.id)) continue; const amt = Math.min(cash, equity / 20); if (amt < 0.02 * equity) continue; pos.push({ r, sh: amt / (C[r.id][r.e] * 1.001) }); cash -= amt; }
    eq = cash + pos.reduce((a, p) => a + p.sh * last(p.r.id, s), 0); peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak);
  }
  return { ret: eq / 1e5 - 1, dd };
}
console.log(`\n(B) EVERY KQ SETUP SIGNAL 2016-2026 (n ${setupRows.length})`);
let bOk = true;
const k$ = (r: number) => `$${(100 * (1 + r)).toFixed(0)}k`;
for (const [h, a, b] of [['2016-20', START, MID - 1], ['2021-26', MID, N - 1]] as const) {
  const rs = setupRows.filter(r => r.e >= a && r.e <= b), y = rs.filter(all4);
  const accY = account(y, a, b), accA = account(rs, a, b), qq = C[qId][b] / C[qId][a] - 1;
  if (!(mean(y.map(r => r.t10)) > 0 && mean(y.map(r => r.t10)) > mean(rs.map(r => r.t10)) && accY.ret > qq)) bOk = false;
  console.log(` ${h}:\n   ${line('all setups', rs)} | account ${k$(accA.ret)} (dd -${(100 * accA.dd).toFixed(0)}%)\n   ${line('with all four', y)} | account ${k$(accY.ret)} (dd -${(100 * accY.dd).toFixed(0)}%) | QQQ held ${k$(qq)}`);
  for (const [i, nm] of NAMES.entries()) console.log(`   ${line(`  ${nm} only`, rs.filter(r => r.seven[i]))}`);
}
console.log(` → (B) ${bOk ? 'PASS' : 'fail'}`);

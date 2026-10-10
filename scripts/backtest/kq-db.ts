// scripts/backtest/kq-db.ts — what did Qullamaggie actually pick, and how did it do?
//
//   LONG=1 NODE_OPTIONS=--max-old-space-size=8192 npx tsx scripts/backtest/kq-db.ts
//
// Input: backtest-data/kq_db/entries.json — his entry DATES (no prices) read off
// the TradingView indicator "QULLAMAGGIE Trades Database 2014-2022" (trend-wolf;
// compiled from streams, tweets and community logs; may contain errors; a
// public log may over-represent trades he chose to show).
//
// RULES — fixed 10 Oct 2026, before any of his entries was analysed.
//   Entries kept: CS / ADRC (reference) with bars in the cache on the entry
//     day and 260 sessions before it (so 2015 entries mostly drop out). Several
//     markers on one name within 5 sessions count once (the first).
//   Comparison groups, on the same dates:
//     ALL   every liquid stock-day: CS/ADRC, real close >= $2, 20-session $
//           volume >= $20M (long-history.ts's universe)
//     SETUP the KQ setup rules (qullamaggie.ts U1-U2, T1, B1-B5) judged at the
//           prior close, with a break of the 3-day high on the entry day
//   Traits at the PRIOR close (what he could see): 1/3/6-month return
//     percentile within ALL, ADR%, % off the 60-day high, sessions since it,
//     3-day range / ADR, close vs SMA10/20/50, 20-day $ volume; on the entry
//     day: gap %, day change %, volume / 20-day average. Market: QQQ above its
//     200-day, QQQ 10 > 20 SMA.
//   Outcomes (entry price unknown): buy at the entry day's CLOSE (conservative
//     for breakouts bought intraday). T10 = first close below SMA10 (max 60
//     sessions); H20 = 20th session's close. Excess = minus QQQ same window,
//     minus 0.2% costs.
//   Halves: entries before 2019-01-01 vs from 2019-01-01.
//   PASS (his picking beats the mechanical rules): his T10 excess exceeds
//     SETUP's by 1.0+ point AND is above 0, in BOTH halves.
//   Coverage printed: share of his entries that SETUP flagged that day.

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

type Row = { id: number; e: number; f: Record<string, number>; t10: number; h20: number; setup: boolean };
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
  for (let k = e + 1; k < N && k <= e + 60; k++) { if (Number.isNaN(C[id][k])) continue; if (C[id][k] < sma(id, k, 10) || k === e + 60) { t10 = C[id][k] / fill - 1 - COST - qr(k); break; } }
  if (Number.isNaN(t10)) return null;
  return { id, e, f, t10, h20, setup };
};

const his: Row[] = mine.map(m => traits(m.id, m.e)).filter((r): r is Row => !!r);
// SETUP signals on every session in his date range, and a 2% sample of ALL for trait baselines
const lo = Math.min(...his.map(r => r.e)), hi = Math.max(...his.map(r => r.e));
const setupRows: Row[] = [], allRows: Row[] = [];
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (let e = lo; e <= hi; e++) {
  for (const o of dayPool(e - 1)) {
    if (Number.isNaN(C[o.id][e])) continue;
    const take = rnd() < 0.02;
    // cheap pre-filter for SETUP: top-7% gainer and ADR >= 5%
    const pre = Math.max(pctl.get(`${o.id}|${e - 1}|0`) ?? 0, pctl.get(`${o.id}|${e - 1}|1`) ?? 0, pctl.get(`${o.id}|${e - 1}|2`) ?? 0) >= 0.93;
    if (!take && !pre) continue;
    const r = traits(o.id, e); if (!r) continue;
    if (take) allRows.push(r);
    if (r.setup) setupRows.push(r);
  }
}
const SPLIT = sIdx.get(sessions.find(d => d >= '2019-01-01')!)!;
const pct = (x: number) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%` : '—');
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
const med = (xs: number[]) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };
const halves = (rs: Row[]) => [rs.filter(r => r.e < SPLIT), rs.filter(r => r.e >= SPLIT)];
console.log(`\nOUTCOMES (bought at the entry day's close; excess vs QQQ after costs)  halves: before / from 2019`);
for (const [name, rs] of [['HIS entries', his], ['KQ SETUP signals', setupRows], ['ALL liquid (2% sample)', allRows]] as const) {
  const [a, b] = halves(rs);
  console.log(`  ${name.padEnd(24)} T10 ${pct(mean(a.map(r => r.t10))).padStart(7)} / ${pct(mean(b.map(r => r.t10))).padStart(7)}  H20 ${pct(mean(a.map(r => r.h20))).padStart(7)} / ${pct(mean(b.map(r => r.h20))).padStart(7)}  win ${(100 * mean(rs.map(r => +(r.t10 > 0)))).toFixed(0)}%  +20%+ ${(100 * mean(rs.map(r => +(r.t10 >= 0.2)))).toFixed(1)}%  n ${a.length} / ${b.length}`);
}
const [ha, hb] = halves(his), [sa, sb] = halves(setupRows);
const pass = [[ha, sa], [hb, sb]].every(([h, s]) => mean(h.map(r => r.t10)) - mean(s.map(r => r.t10)) >= 0.01 && mean(h.map(r => r.t10)) > 0);
console.log(`  → his picking vs the KQ rules: ${pass ? 'PASS' : 'fail'}`);
console.log(`\nCOVERAGE: ${(100 * mean(his.map(r => +r.setup))).toFixed(1)}% of his entries were KQ SETUP signals that day (n ${his.length})`);
console.log(`\nTRAITS (median): his | KQ setup | all liquid`);
for (const k of Object.keys(his[0].f)) console.log(`  ${k.padEnd(10)} ${med(his.map(r => r.f[k])).toFixed(2).padStart(9)} | ${med(setupRows.map(r => r.f[k])).toFixed(2).padStart(9)} | ${med(allRows.map(r => r.f[k])).toFixed(2).padStart(9)}`);
console.log(`\nBY YEAR (his T10 excess, n):`);
for (const y of [...new Set(his.map(r => sessions[r.e].slice(0, 4)))].sort()) { const rs = his.filter(r => sessions[r.e].startsWith(y)); const ss = setupRows.filter(r => sessions[r.e].startsWith(y)); console.log(`  ${y} his ${pct(mean(rs.map(r => r.t10))).padStart(7)} n ${String(rs.length).padStart(4)} | setup ${pct(mean(ss.map(r => r.t10))).padStart(7)} n ${ss.length}`); }

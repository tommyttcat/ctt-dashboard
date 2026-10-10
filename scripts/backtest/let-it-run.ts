// scripts/backtest/let-it-run.ts — does "let the winners run" rescue our own signals? 2016-2026.
//
//   LONG=1 NODE_OPTIONS=--max-old-space-size=12288 npx tsx scripts/backtest/let-it-run.ts
//
// q-profile.ts (B): on Qullamaggie's own picks, a let-it-run exit averaged
// +11% a trade against +2.5% for a 10-day trail — the best 10% of trades made
// all the profit. Every earlier test on OUR signals used short exits.
// Uses the long cache after the 10 Oct jump-filter fix (NVAX / AMC restored).
//
// RULES — fixed 10 Oct 2026, before the first run.
//   Universe: CS/ADRC, real close >= $2, 20-session $ volume >= $20M, 260 sessions.
//   SIGNALS (judged at close t, bought at the next open):
//     S1 MOMENTUM ENTRANTS: at each month end, names newly in the 12-1 top 50.
//     S2 BREAKOUTS: close above the prior 20 sessions' highest close, volume
//        >= 1.5x its 20-session average, close > SMA50; QQQ above its 200-day.
//     S3 RANDOM: 1 in 200 universe stock-days (a baseline with the same exits).
//   EXITS:
//     RUN  stop 15% below the fill until a close 20%+ above it; then out at the
//          first close below SMA20; max 250 sessions.
//     H20  close of the 20th session.
//     T10  first close below SMA10 from session 2; max 60 sessions.
//   PORTFOLIO: $100k, up to 20 positions of 5% of equity at entry, no margin;
//     same-day signals taken highest 12-1 momentum first; a name already held
//     is skipped. Marked to market daily. 0.1% a side.
//   Halves 2016-2020 / 2021-2026. QQQ held as the benchmark.
//   PASS: for S1 or S2, the RUN portfolio beats QQQ in BOTH halves AND RUN's
//     average trade excess (vs QQQ, same window) beats H20's in both halves.

import { loadAdjusted, listSessions, readDay } from './cache';
import { loadReference, refAt } from './reference';

const c = loadAdjusted();
const ref = loadReference();
const { sessions, syms, O, H, L, C, V } = c;
const N = sessions.length;
const qId = c.idOf.get('QQQ')!;
const RC: Float32Array[] = syms.map(() => new Float32Array(N).fill(NaN));
{ if (listSessions().length !== N) throw new Error('session mismatch');
  for (let s = 0; s < N; s++) for (const r of readDay('unadj', sessions[s])) { const id = c.idOf.get(r[0]); if (id != null) RC[id][s] = r[4]; } }
const typeOk = new Map<string, boolean>();
const isStock = (sym: string, date: string) => { const k = `${sym}|${date.slice(0, 4)}`; if (!typeOk.has(k)) { const t = (refAt(ref, sym, date)?.type || '').toUpperCase(); typeOk.set(k, t === 'CS' || t === 'ADRC'); } return typeOk.get(k)!; };
const COST = 0.001;
const idx = (d: string) => { const i = sessions.findIndex(x => x >= d); return i < 0 ? N : i; };
const START = idx('2016-01-01'), MID = idx('2021-01-01');
const qS200 = (t: number) => { let s = 0; for (let j = t - 199; j <= t; j++) s += C[qId][j]; return s / 200; };
const sma = (id: number, t: number, n: number) => { let s = 0; for (let j = t - n + 1; j <= t; j++) s += C[id][j]; return s / n; };
const inUni = (id: number, t: number) => {
  if (!(RC[id][t] >= 2) || Number.isNaN(C[id][t - 260])) return false;
  let dv = 0; for (let j = t - 19; j <= t; j++) { if (Number.isNaN(C[id][j])) return false; dv += C[id][j] * V[id][j]; }
  return dv / 20 >= 20e6 && isStock(syms[id], sessions[t]);
};
const mom = (id: number, t: number) => C[id][t - 21] / C[id][t - 252] - 1;

type Sig = { id: number; t: number; m: number };
const S1: Sig[] = [], S2: Sig[] = [], S3: Sig[] = [];
let prevTop = new Set<number>();
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (let t = START - 25; t < N - 1; t++) {
  const monthEnd = sessions[t].slice(0, 7) !== sessions[t + 1].slice(0, 7);
  const pool: Sig[] = [];
  const q200 = C[qId][t] > qS200(t);
  for (let id = 0; id < syms.length; id++) {
    if (Number.isNaN(C[id][t]) || Number.isNaN(O[id][t + 1])) continue;
    const brkPre = (() => { if (!q200) return false; let mx = -Infinity, vs = 0; for (let j = t - 20; j < t; j++) { mx = Math.max(mx, C[id][j]); vs += V[id][j]; } return C[id][t] > mx && V[id][t] >= 1.5 * vs / 20; })();
    const rand = rnd() < 0.005;
    if (!monthEnd && !brkPre && !rand) continue;
    if (!inUni(id, t)) continue;
    const m = mom(id, t);
    if (monthEnd) pool.push({ id, t, m });
    if (t >= START && brkPre && C[id][t] > sma(id, t, 50)) S2.push({ id, t, m });
    if (t >= START && rand) S3.push({ id, t, m });
  }
  if (monthEnd) {
    pool.sort((a, b) => b.m - a.m);
    const top = new Set(pool.slice(0, 50).map(p => p.id));
    if (t >= START) for (const p of pool.slice(0, 50)) if (!prevTop.has(p.id)) S1.push(p);
    prevTop = top;
  }
}
type Exit = 'RUN' | 'H20' | 'T10';
const exitOf = (id: number, e: number, how: Exit): [number, number] | null => {
  const fill = O[id][e]; if (!(fill > 0)) return null;
  let armed = false;
  for (let k = e; k < N; k++) {
    if (Number.isNaN(C[id][k])) continue;
    const day = k - e + 1;
    if (how === 'H20') { if (day >= 20) return [k, C[id][k]]; continue; }
    if (how === 'T10') { if (day >= 2 && (C[id][k] < sma(id, k, 10) || day >= 60)) return [k, C[id][k]]; continue; }
    if (!armed && L[id][k] <= fill * 0.85) return [k, Math.min(fill * 0.85, k > e ? O[id][k] : fill * 0.85)];
    if (!armed && C[id][k] >= fill * 1.2) armed = true;
    if (armed && C[id][k] < sma(id, k, 20)) return [k, C[id][k]];
    if (day >= 250) return [k, C[id][k]];
  }
  let k = N - 1; while (k > e && Number.isNaN(C[id][k])) k--; return [k, C[id][k]];
};
type Tr = { id: number; e: number; x: number; px: number; ret: number; ex: number; m: number };
const trades = (sigs: Sig[], how: Exit): Tr[] => sigs.map(s => { const e = s.t + 1; const r = exitOf(s.id, e, how); if (!r) return null; const ret = r[1] / O[s.id][e] - 1 - 2 * COST; return { id: s.id, e, x: r[0], px: r[1], ret, ex: ret - (C[qId][r[0]] / O[qId][e] - 1), m: s.m }; }).filter((x): x is Tr => !!x);
function portfolio(ts: Tr[], from: number, to: number) {
  let cash = 1e5; const pos: { t: Tr; sh: number }[] = [];
  const byDay = new Map<number, Tr[]>(); for (const t of ts) if (t.e >= from && t.e <= to) (byDay.get(t.e) ?? byDay.set(t.e, []).get(t.e)!).push(t);
  const last = (id: number, s: number) => { let k = s; while (k > 0 && Number.isNaN(C[id][k])) k--; return C[id][k]; };
  let peak = 1e5, dd = 0, eq = 1e5;
  for (let s = from; s <= to; s++) {
    for (let i = pos.length - 1; i >= 0; i--) if (pos[i].t.x === s || (pos[i].t.x < s)) { cash += pos[i].sh * pos[i].t.px * (1 - COST); pos.splice(i, 1); }
    const equity = cash + pos.reduce((a, p) => a + p.sh * last(p.t.id, s - 1), 0);
    for (const t of (byDay.get(s) ?? []).sort((a, b) => b.m - a.m)) {
      if (pos.length >= 20 || pos.some(p => p.t.id === t.id)) continue;
      const amt = Math.min(cash, 0.05 * equity); if (amt < 0.02 * equity) continue;
      pos.push({ t, sh: amt / (O[t.id][s] * (1 + COST)) }); cash -= amt;
      if (t.x === s) { cash += pos[pos.length - 1].sh * t.px * (1 - COST); pos.pop(); }
    }
    eq = cash + pos.reduce((a, p) => a + p.sh * last(p.t.id, s), 0); peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak);
  }
  return { ret: eq / 1e5 - 1, dd };
}
const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
const med = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); return s[s.length >> 1]; };
const HALVES: [string, number, number][] = [['2016-20', START, MID - 1], ['2021-26', MID, N - 1]];
const qq = (a: number, b: number) => C[qId][b] / O[qId][a] - 1;
console.log(`QQQ held: 2016-20 ${pct(qq(START, MID - 1))} | 2021-26 ${pct(qq(MID, N - 1))}`);
for (const [name, sigs] of [['S1 momentum entrants', S1], ['S2 breakouts', S2], ['S3 random (baseline)', S3]] as const) {
  console.log(`\n${name}: ${sigs.length} signals`);
  const res: Record<string, { ex: number[]; acc: { ret: number; dd: number }[] }> = {};
  for (const how of ['RUN', 'H20', 'T10'] as Exit[]) {
    const ts = trades(sigs, how);
    const parts = HALVES.map(([, a, b]) => ts.filter(t => t.e >= a && t.e <= b));
    const acc = HALVES.map(([, a, b]) => portfolio(ts, a, b));
    res[how] = { ex: parts.map(p => mean(p.map(t => t.ex))), acc };
    console.log(`  ${how}  per trade: avg ${pct(mean(ts.map(t => t.ret))).padStart(7)} median ${pct(med(ts.map(t => t.ret))).padStart(7)} doubled ${String(ts.filter(t => t.ret >= 1).length).padStart(4)} | excess vs QQQ ${pct(res[how].ex[0])} / ${pct(res[how].ex[1])} | portfolio ${pct(acc[0].ret)} (dd ${pct(-acc[0].dd)}) / ${pct(acc[1].ret)} (dd ${pct(-acc[1].dd)})`);
  }
  if (name !== 'S3 random (baseline)') {
    const pass = HALVES.every(([, a, b], i) => res.RUN.acc[i].ret > qq(a, b) && res.RUN.ex[i] > res.H20.ex[i]);
    console.log(`  → ${pass ? 'PASS' : 'fail'}`);
  }
}

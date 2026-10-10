// scripts/backtest/macro-readings.ts — do the scorecard's breadth, VIX and big-movers readings
// tell you WHEN to be in? Tested (a) as a QQQ on/off switch, (b) as a switch on the
// explosive-breakout trades (generation copied verbatim from explosive-breakout.ts).
//
//   LONG=1 NODE_OPTIONS=--max-old-space-size=12288 npx tsx scripts/backtest/macro-readings.ts
//
// RULES — fixed 10 Oct 2026, before the first run. Readings use data to the close of t only.
//   BREADTH: % of CS/ADRC names (real close >= $2, 20-session $ vol >= $20M) closing above
//     their 50-day SMA. Good = >= 60% (the scorecard's green). Control: > 40% (not red).
//   VIX: ^VIX close (FMP, backtest-data/vix.json). Good = < 18 (green). Control: < 25.
//   BIG MOVERS: 5-session sum of CS/ADRC up 4%+ vs down 4%+ (real close >= $3, volume >= 100k).
//     Good = up >= down. Control: up >= 2x down.
//   ALL THREE good.
//   (a) QQQ: hold QQQ close t → close t+1 when good at t, else cash (0%); 0.05% per switch.
//       Reference: QQQ held; QQQ above its 200-day (the exposure rule's base).
//       PASS: beats QQQ held in BOTH halves (2016-20, 2021-26).
//   (b) BREAKOUTS: take an A trade only when good at its breakout session; account as in
//       progressive-exposure.ts. PASS: account and random-order median beat QQQ held, both halves.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, loadAdjusted, listSessions, readDay } from './cache';
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
const idx = (d: string) => { const i = sessions.findIndex(x => x >= d); return i < 0 ? N : i; };
const START = idx('2016-01-01'), MID = idx('2021-01-01');
const q200 = (t: number) => { let s = 0; for (let j = t - 199; j <= t; j++) s += C[qId][j]; return C[qId][t] > s / 200; };
type Tr = { id: number; e: number; x: number; px: number; fill: number; ret: number; ex: number; gated: boolean; vm: number; kind: 'A' | 'B' };
const trades: Tr[] = [];
for (let id = 0; id < syms.length; id++) {
  const cl = C[id];
  const ema21 = new Float64Array(N).fill(NaN); { let e = NaN; for (let j = 0; j < N; j++) { if (Number.isNaN(cl[j])) { e = NaN; continue; } e = Number.isNaN(e) ? cl[j] : cl[j] * (2 / 22) + e * (20 / 22); ema21[j] = e; } }
  const busy = { A: -1, B: -1 };
  for (let t = Math.max(START, 300); t < N - 2; t++) {
    if (Number.isNaN(cl[t]) || !(RC[id][t] >= 2)) continue;
    let hi = -Infinity, lo = Infinity, ok = true;
    for (let j = t - 40; j < t; j++) { if (Number.isNaN(cl[j])) { ok = false; break; } hi = Math.max(hi, H[id][j]); lo = Math.min(lo, L[id][j]); }
    if (!ok || hi / lo - 1 > 0.25) continue;
    let pre = -Infinity; for (let j = t - 60; j < t - 40; j++) pre = Math.max(pre, H[id][j]);
    if (!(pre <= hi)) continue;
    if (!(cl[t] > hi)) continue;
    let atr = 0; for (let j = t - 14; j < t; j++) atr += Math.max(H[id][j], cl[j - 1]) - Math.min(L[id][j], cl[j - 1]); atr /= 14;
    if (!(H[id][t] - L[id][t] >= 1.5 * atr)) continue;
    let v50 = 0; for (let j = t - 50; j < t; j++) v50 += V[id][j]; v50 /= 50;
    const vm = V[id][t] / v50; if (!(vm >= 2)) continue;
    if (!((cl[t] - L[id][t]) / (H[id][t] - L[id][t]) >= 0.75)) continue;
    let dv = 0; for (let j = t - 19; j <= t; j++) dv += cl[j] * V[id][j]; if (!(dv / 20 >= 20e6)) continue;
    if (!isStock(syms[id], sessions[t])) continue;
    const pivot = hi, gated = q200(t);
    const run = (e: number, fill: number, kind: 'A' | 'B') => {
      if (e <= busy[kind]) return;
      let armed = false, x = -1, px = NaN;
      for (let k = e + 1; k < N && k <= e + 120; k++) {
        if (Number.isNaN(cl[k])) continue;
        if (!armed && cl[k] < pivot) { x = k; px = cl[k]; break; }
        if (cl[k] >= fill * 1.2) armed = true;
        if (armed && cl[k] < ema21[k]) { x = k; px = cl[k]; break; }
        if (k === e + 120) { x = k; px = cl[k]; break; }
      }
      if (x < 0) { let k = N - 1; while (k > e && Number.isNaN(cl[k])) k--; x = k; px = cl[k]; }
      const ret = px / fill - 1 - 0.002;
      trades.push({ id, e, x, px, fill, ret, ex: ret - (C[qId][x] / C[qId][e] - 1), gated, vm, kind });
      busy[kind] = x;
    };
    run(t, cl[t], 'A');
    for (let k = t + 1; k <= t + 3 && k < N - 1; k++) if (cl[k] > cl[t]) { run(k, cl[k], 'B'); break; }
  }
}


const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const A = trades.filter(t => t.kind === 'A');
// ---- readings per session
const vixMap = new Map<string, number>((JSON.parse(readFileSync(join(DATA, 'vix.json'), 'utf8')) as { date: string; price: number }[]).map(r => [r.date, r.price]));
const VIX = new Float64Array(N).fill(NaN); { let lastV = NaN; for (let t = 0; t < N; t++) { const v = vixMap.get(sessions[t]); if (v != null) lastV = v; VIX[t] = lastV; } }
const above = new Float64Array(N), tot = new Float64Array(N), up4 = new Float64Array(N), dn4 = new Float64Array(N);
for (let id = 0; id < syms.length; id++) {
  const cl = C[id]; let s = 0, cnt = 0, dv = 0, dvn = 0;
  for (let t = 1; t < N; t++) {
    if (Number.isNaN(cl[t])) { s = 0; cnt = 0; dv = 0; dvn = 0; continue; }
    s += cl[t]; cnt++; if (cnt > 50) { s -= cl[t - 50]; cnt = 50; }
    dv += cl[t] * V[id][t]; dvn++; if (dvn > 20) { dv -= cl[t - 20] * V[id][t - 20]; dvn = 20; }
    if (t < START - 260) continue;
    const real = RC[id][t];
    if (!Number.isNaN(cl[t - 1]) && real >= 3 && V[id][t] >= 1e5) { const r = cl[t] / cl[t - 1] - 1; if ((r >= 0.04 || r <= -0.04) && isStock(syms[id], sessions[t])) { if (r >= 0.04) up4[t]++; else dn4[t]++; } }
    if (cnt === 50 && dvn === 20 && real >= 2 && dv / 20 >= 20e6 && isStock(syms[id], sessions[t])) { tot[t]++; if (cl[t] > s / 50) above[t]++; }
  }
}
const br = (t: number) => 100 * above[t] / tot[t];
const mv = (t: number) => { let u = 0, d = 0; for (let j = t - 4; j <= t; j++) { u += up4[j]; d += dn4[j]; } return [u, d]; };
const RULES: [string, (t: number) => boolean, boolean][] = [
  ['BREADTH >= 60% above 50-day', t => br(t) >= 60, true],
  ['breadth > 40% (control)', t => br(t) > 40, false],
  ['VIX < 18', t => VIX[t] < 18, true],
  ['VIX < 25 (control)', t => VIX[t] < 25, false],
  ['BIG MOVERS 5-day up >= down', t => { const [u, d] = mv(t); return u >= d; }, true],
  ['big movers up >= 2x down (control)', t => { const [u, d] = mv(t); return u >= 2 * d; }, false],
  ['ALL THREE good', t => br(t) >= 60 && VIX[t] < 18 && (() => { const [u, d] = mv(t); return u >= d; })(), true],
  ['ref: QQQ above 200-day', q200, false],
];
const HALF: [string, number, number][] = [['2016-20', START, MID - 1], ['2021-26', MID, N - 1]];
const qq = (a: number, b: number) => C[qId][b] / C[qId][a] - 1;
const k$ = (r: number) => `$${(100 * (1 + r)).toFixed(0)}k`;
console.log(`readings check — ${sessions[START]}: breadth ${br(START).toFixed(0)}%, VIX ${VIX[START]}, movers ${mv(START)} | ${sessions[N - 1]}: breadth ${br(N - 1).toFixed(0)}%, VIX ${VIX[N - 1]}, movers ${mv(N - 1)}`);
console.log(`\n(a) QQQ ON/OFF — QQQ held: 2016-20 ${k$(qq(START, MID - 1))}, 2021-26 ${k$(qq(MID, N - 1))}`);
function qqqSwitch(f: (t: number) => boolean, a: number, b: number) {
  let eq = 1, peak = 1, dd = 0, on = 0, prev = false; const fwd: number[][] = [[], []];
  for (let t = a; t < b; t++) { const g = f(t); if (g !== prev) eq *= 0.9995; prev = g; if (g) { eq *= C[qId][t + 1] / C[qId][t]; on++; } peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak);
    if (t + 20 <= b) fwd[g ? 0 : 1].push(C[qId][t + 20] / C[qId][t] - 1); }
  const m = (xs: number[]) => xs.reduce((x, y) => x + y, 0) / Math.max(1, xs.length);
  return { ret: eq - 1, dd, on: on / (b - a), fGood: m(fwd[0]), fBad: m(fwd[1]) };
}
const qqDD = (a: number, b: number) => { let p = 0, d = 0; for (let t = a; t <= b; t++) { p = Math.max(p, C[qId][t]); d = Math.max(d, 1 - C[qId][t] / p); } return d; };
console.log(`  QQQ held max drop: 2016-20 -${(100 * qqDD(START, MID - 1)).toFixed(0)}%, 2021-26 -${(100 * qqDD(MID, N - 1)).toFixed(0)}%`);
const passA: string[] = [];
for (const [lab, f, graded] of RULES) {
  const parts = HALF.map(([h, a, b]) => ({ h, r: qqqSwitch(f, a, b), q: qq(a, b) }));
  if (graded && parts.every(p => p.r.ret > p.q)) passA.push(lab);
  console.log(` ${lab}`);
  for (const p of parts) console.log(`   ${p.h}: ${k$(p.r.ret)} (max drop -${(100 * p.r.dd).toFixed(0)}%) | in QQQ ${(100 * p.r.on).toFixed(0)}% of days | QQQ next 20 days: good ${pct(p.r.fGood)} vs not ${pct(p.r.fBad)}`);
}
console.log(` → (a) ${passA.length ? 'PASS: ' + passA.join('; ') : 'fail'}`);

function account(ts: Tr[], from: number, to: number, seed?: number) {
  let rnd = seed ?? 1; const rand = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
  let cash = 1e5; const pos: { t: Tr; sh: number }[] = []; let eq = 1e5, peak = 1e5, dd = 0, taken = 0, sum = 0;
  const byDay = new Map<number, Tr[]>(); for (const t of ts) if (t.e >= from && t.e <= to) (byDay.get(t.e) ?? byDay.set(t.e, []).get(t.e)!).push(t);
  const last = (id: number, s: number) => { let k = s; while (k > 0 && Number.isNaN(C[id][k])) k--; return C[id][k]; };
  for (let s = from; s <= to; s++) {
    for (let i = pos.length - 1; i >= 0; i--) if (pos[i].t.x <= s) { cash += pos[i].sh * pos[i].t.px * 0.999; pos.splice(i, 1); }
    const equity = cash + pos.reduce((a, p) => a + p.sh * last(p.t.id, s), 0);
    const today = byDay.get(s) ?? [];
    const order = seed == null ? today.slice().sort((a, b) => b.vm - a.vm) : today.map(x => [rand(), x] as const).sort((a, b) => a[0] - b[0]).map(x => x[1]);
    for (const t of order) { if (pos.length >= 20 || pos.some(p => p.t.id === t.id)) continue; const amt = Math.min(cash, equity / 20); if (amt < 0.02 * equity) continue; pos.push({ t, sh: amt / (t.fill * 1.001) }); cash -= amt; taken++; sum += t.ret; }
    eq = cash + pos.reduce((a, p) => a + p.sh * last(p.t.id, s), 0); peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak);
  }
  return { ret: eq / 1e5 - 1, dd, taken, avg: sum / Math.max(1, taken) };
}
console.log(`\n(b) BREAKOUTS only on good days`);
const passB: string[] = [];
for (const [lab, f, graded] of [['always on', (_: number) => true, false] as [string, (t: number) => boolean, boolean], ...RULES]) {
  const ts = A.filter(t => f(t.e));
  const parts = HALF.map(([h, a, b]) => { const r = account(ts, a, b); const rs = Array.from({ length: 50 }, (_, i) => account(ts, a, b, 11 + i).ret).sort((x, y) => x - y); return { h, r, rmed: rs[25], q: qq(a, b) }; });
  if (graded && parts.every(p => p.r.ret > p.q && p.rmed > p.q)) passB.push(lab);
  console.log(` ${lab}: ` + parts.map(p => `${p.h} ${k$(p.r.ret)} (dd -${(100 * p.r.dd).toFixed(0)}%, ${p.r.taken} trades, avg ${pct(p.r.avg)}, random ${k$(p.rmed)})`).join(' | '));
}
console.log(` → (b) ${passB.length ? 'PASS: ' + passB.join('; ') : 'fail'}`);

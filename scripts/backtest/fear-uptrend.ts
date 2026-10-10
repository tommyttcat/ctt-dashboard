// scripts/backtest/fear-uptrend.ts — "buy fear inside an uptrend" added to the live exposure
// rule (lib/exposure.ts). Prompted by macro-readings.ts: green readings preceded WORSE QQQ
// returns; high VIX / weak breadth preceded better ones.
//
//   LONG=1 NODE_OPTIONS=--max-old-space-size=12288 npx tsx scripts/backtest/fear-uptrend.ts
//
// RULES — fixed 10 Oct 2026, before the first run. 2016-2026, decided at the close for the
// next session.
//   BASE = the live rule: 150% QQQ for the 10 sessions after a washout (whole-market share
//     above its own 40-day average, today included, <= 20%; a washout inside an active
//     window does not extend it); else 100% while QQQ > its 200-day SMA; else cash.
//     Cash earns 4%/yr, borrowing costs 5%/yr; 0.2% x |change in exposure| per switch.
//   FEAR BOOST (added on top): when QQQ > 200-day AND ^VIX closes >= 25, 150% for the next
//     10 sessions (same non-extending window mechanics, its own window).
//   Controls: VIX >= 20 in uptrend; scanner-universe breadth (CS/ADRC, $2, $20M, above
//     50-day) <= 40% in uptrend; VIX >= 25 with no uptrend check.
//   Episodes = fear windows opened. Also: QQQ's 10-session return after each window opens.
//   PASS: BASE + boost beats BASE in BOTH halves (2016-20, 2021-26), with >= 5 episodes in
//     each half.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, loadAdjusted, listSessions, readDay } from './cache';
import { loadReference, refAt } from './reference';

const c = loadAdjusted();
const ref = loadReference();
const { sessions, syms, C, V } = c;
const N = sessions.length;
const qId = c.idOf.get('QQQ')!;
const RC: Float32Array[] = syms.map(() => new Float32Array(N).fill(NaN));
{ if (listSessions().length !== N) throw new Error('session mismatch');
  for (let s = 0; s < N; s++) for (const r of readDay('unadj', sessions[s])) { const id = c.idOf.get(r[0]); if (id != null) RC[id][s] = r[4]; } }
const typeOk = new Map<string, boolean>();
const isStock = (sym: string, date: string) => { const k = `${sym}|${date.slice(0, 4)}`; if (!typeOk.has(k)) { const t = (refAt(ref, sym, date)?.type || '').toUpperCase(); typeOk.set(k, t === 'CS' || t === 'ADRC'); } return typeOk.get(k)!; };
const idx = (d: string) => { const i = sessions.findIndex(x => x >= d); return i < 0 ? N : i; };
const START = idx('2016-01-01'), MID = idx('2021-01-01');
const vixMap = new Map<string, number>((JSON.parse(readFileSync(join(DATA, 'vix.json'), 'utf8')) as { date: string; price: number }[]).map(r => [r.date, r.price]));
const VIX = new Float64Array(N).fill(NaN); { let l = NaN; for (let t = 0; t < N; t++) { const v = vixMap.get(sessions[t]); if (v != null) l = v; VIX[t] = l; } }
// whole-market 40-day breadth (lib/exposure breadth(): last 41 traded closes, avg of latest 40 incl. today)
const a40 = new Float64Array(N), t40 = new Float64Array(N), a50 = new Float64Array(N), t50 = new Float64Array(N);
for (let id = 0; id < syms.length; id++) {
  const cl = C[id]; const buf: number[] = []; let s50 = 0, n50 = 0, dv = 0, dvn = 0;
  for (let t = 0; t < N; t++) {
    const x = cl[t];
    if (Number.isNaN(x)) { s50 = 0; n50 = 0; dv = 0; dvn = 0; continue; }
    buf.push(x); if (buf.length > 41) buf.shift();
    s50 += x; n50++; if (n50 > 50) { s50 -= cl[t - 50]; n50 = 50; }
    dv += x * V[id][t]; dvn++; if (dvn > 20) { dv -= cl[t - 20] * V[id][t - 20]; dvn = 20; }
    if (t < START - 260) continue;
    if (buf.length === 41) { let s = 0; for (let k = 1; k <= 40; k++) s += buf[k]; t40[t]++; if (x > s / 40) a40[t]++; }
    if (n50 === 50 && dvn === 20 && RC[id][t] >= 2 && dv / 20 >= 20e6 && isStock(syms[id], sessions[t])) { t50[t]++; if (x > s50 / 50) a50[t]++; }
  }
}
const sma200 = (t: number) => { let s = 0; for (let j = t - 199; j <= t; j++) s += C[qId][j]; return s / 200; };
const up = (t: number) => C[qId][t] > sma200(t);
const washoutAt = (t: number) => t40[t] >= 100 && 100 * a40[t] / t40[t] <= 20;
function run(fear: ((t: number) => boolean) | null, a: number, b: number) {
  let nav = 1, peak = 1, dd = 0, exp = 0, wSince = 99, fSince = 99, episodes = 0; const after: number[] = [];
  for (let t = a; t <= b; t++) {
    if (t > a) { const r = C[qId][t] / C[qId][t - 1] - 1; const fin = exp > 1 ? -(exp - 1) * 0.05 / 252 : (1 - exp) * 0.04 / 252; nav *= 1 + exp * r + fin; }
    wSince++; fSince++;
    if (washoutAt(t) && wSince > 10) wSince = 0;
    if (fear && fear(t) && fSince > 10) { fSince = 0; episodes++; if (t + 10 <= b) after.push(C[qId][t + 10] / C[qId][t] - 1); }
    const boosted = wSince < 10 || fSince < 10;
    const next = boosted ? 1.5 : up(t) ? 1 : 0;
    nav *= 1 - 0.002 * Math.abs(next - exp); exp = next;
    peak = Math.max(peak, nav); dd = Math.max(dd, 1 - nav / peak);
  }
  return { ret: nav - 1, dd, episodes, after: after.length ? after.reduce((x, y) => x + y, 0) / after.length : NaN };
}
const HALF: [string, number, number][] = [['2016-20', START, MID - 1], ['2021-26', MID, N - 1]];
const qq = (a: number, b: number) => C[qId][b] / C[qId][a] - 1;
const k$ = (r: number) => `$${(100 * (1 + r)).toFixed(0)}k`;
const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const base = HALF.map(([, a, b]) => run(null, a, b));
console.log(`QQQ held: ${HALF.map(([h, a, b]) => `${h} ${k$(qq(a, b))}`).join(', ')}`);
console.log(`BASE (live rule): ${HALF.map(([h], i) => `${h} ${k$(base[i].ret)} (max drop -${(100 * base[i].dd).toFixed(0)}%)`).join(' | ')}`);
let pass = false;
for (const [lab, f, graded] of [
  ['PRIMARY: + VIX >= 25 in uptrend', (t: number) => up(t) && VIX[t] >= 25, true],
  ['+ VIX >= 20 in uptrend', (t: number) => up(t) && VIX[t] >= 20, false],
  ['+ breadth <= 40% above 50-day in uptrend', (t: number) => up(t) && 100 * a50[t] / t50[t] <= 40, false],
  ['+ VIX >= 25, no uptrend check', (t: number) => VIX[t] >= 25, false],
] as const) {
  const parts = HALF.map(([h, a, b], i) => ({ h, r: run(f, a, b), base: base[i] }));
  if (graded) pass = parts.every(p => p.r.ret > p.base.ret && p.r.episodes >= 5);
  console.log(`\n${lab}${graded ? '' : ' (control)'}`);
  for (const p of parts) console.log(`  ${p.h}: ${k$(p.r.ret)} vs base ${k$(p.base.ret)} (max drop -${(100 * p.r.dd).toFixed(0)}%) | fear episodes ${p.r.episodes}, QQQ next 10 sessions avg ${pct(p.r.after)}`);
}
console.log(`\n→ ${pass ? 'PASS' : 'fail'}`);

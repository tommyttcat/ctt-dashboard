// scripts/backtest/progressive-exposure.ts — explosive-breakout.ts's trades, taken ONLY while
// breakouts are working (progressive exposure). Trade generation below is copied verbatim
// from explosive-breakout.ts; the switch and the account are new.
//
// RULES — fixed 10 Oct 2026, before the first run.
//   Shadow log: every A trade (breakout-close entry), whether the account takes it or not.
//   PRIMARY switch: a trade entered at session e is taken only if the last 20 shadow trades
//     CLOSED before e (exit session < e) average > 0 after costs.
//   Controls: last 50; QQQ close above its 21-day EMA (KQ's rule); both PRIMARY and QQQ;
//     PRIMARY with 10 slots of 10%.
//   Account: $100k, 20 slots of 5% of equity (controls as noted), same-day order by volume
//     multiple; 50 random orders for the luck check. Idle cash earns nothing.
//   PASS: account AND random-order median beat QQQ held, in BOTH halves (2016-20, 2021-26).
//
// ---- original header follows ----
// scripts/backtest/explosive-breakout.ts — "explosive breakout from a proper base; price doesn't
// return to the breakout point; strong follow-through" (shared 10 Oct 2026), 2016-2026.
//
//   LONG=1 NODE_OPTIONS=--max-old-space-size=12288 npx tsx scripts/backtest/explosive-breakout.ts
//
// The shared post is hindsight (four winners). The testable part: observation 2 is an EXIT
// rule — a close back below the breakout point = failed breakout — and observation 3 an
// entry filter (follow-through). Every earlier breakout test used a low-of-day stop.
//
// RULES — fixed 10 Oct 2026, before the first run.
//   Universe: CS/ADRC, real close >= $2, 20-session $ volume >= $20M, 260 sessions.
//   BASE: the 40 sessions before t (t-40..t-1) span <= 25% high to low, and the 20 before
//     that do not make a higher high than the base (a base, not a pullback in a run).
//     PIVOT = the base's highest high.
//   EXPLOSIVE BREAKOUT on day t: close > pivot; day range >= 1.5x ATR(14); volume >= 2x
//     its 50-session average; close in the top 25% of the day's range.
//   ENTRY A: the breakout day's close. ENTRY B (follow-through): the first close within
//     t+1..t+3 above t's close; bought at that close; none = no trade.
//   EXIT: a close below the pivot (out at that close); once a close is 20%+ above the
//     entry, out at the first close below the 21-day EMA; max 120 sessions. 0.2% costs.
//   One trade per name at a time. Gate variant: QQQ above its 200-day at t.
//   Excess = trade return minus QQQ over the same window.
//   PORTFOLIO: $100k, 20 slots of 5% equity, same-day signals by volume multiple.
//   PASS: average excess > 0 in BOTH halves (2016-20, 2021-26) AND the portfolio beats
//     QQQ in both halves, for A or B (gated or not).

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

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
const A = trades.filter(t => t.kind === 'A');
const byExit = A.slice().sort((a, b) => a.x - b.x);
const qEma = new Float64Array(N).fill(NaN); { let e = NaN; for (let j = 0; j < N; j++) { e = Number.isNaN(e) ? C[qId][j] : C[qId][j] * (2 / 22) + e * (20 / 22); qEma[j] = e; } }
/** For each trade: average of the last k shadow trades closed before its entry. */
function heat(k: number) {
  const m = new Map<Tr, number>(); const sorted = A.slice().sort((a, b) => a.e - b.e); let p = 0; const ring: number[] = [];
  for (const t of sorted) { while (p < byExit.length && byExit[p].x < t.e) { ring.push(byExit[p].ret); if (ring.length > k) ring.shift(); p++; } m.set(t, ring.length === k ? ring.reduce((a, b) => a + b, 0) / k : NaN); }
  return m;
}
const h20 = heat(20), h50 = heat(50);
function account(ts: Tr[], from: number, to: number, slots: number, seed?: number) {
  let rnd = seed ?? 1; const rand = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
  let cash = 1e5; const pos: { t: Tr; sh: number }[] = []; let eq = 1e5, peak = 1e5, dd = 0, taken = 0, wins = 0, sum = 0;
  const byDay = new Map<number, Tr[]>(); for (const t of ts) if (t.e >= from && t.e <= to) (byDay.get(t.e) ?? byDay.set(t.e, []).get(t.e)!).push(t);
  const last = (id: number, s: number) => { let k = s; while (k > 0 && Number.isNaN(C[id][k])) k--; return C[id][k]; };
  let inMkt = 0;
  for (let s = from; s <= to; s++) {
    for (let i = pos.length - 1; i >= 0; i--) if (pos[i].t.x <= s) { cash += pos[i].sh * pos[i].t.px * 0.999; pos.splice(i, 1); }
    const equity = cash + pos.reduce((a, p) => a + p.sh * last(p.t.id, s), 0);
    const today = byDay.get(s) ?? [];
    const order = seed == null ? today.slice().sort((a, b) => b.vm - a.vm) : today.map(x => [rand(), x] as const).sort((a, b) => a[0] - b[0]).map(x => x[1]);
    for (const t of order) { if (pos.length >= slots || pos.some(p => p.t.id === t.id)) continue; const amt = Math.min(cash, equity / slots); if (amt < 0.4 * equity / slots) continue; pos.push({ t, sh: amt / (t.fill * 1.001) }); cash -= amt; taken++; sum += t.ret; if (t.ret > 0) wins++; }
    if (pos.length) inMkt++;
    eq = cash + pos.reduce((a, p) => a + p.sh * last(p.t.id, s), 0); peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak);
  }
  return { ret: eq / 1e5 - 1, dd, taken, win: wins / Math.max(1, taken), avg: sum / Math.max(1, taken), inMkt: inMkt / (to - from + 1) };
}
const HALF: [string, number, number][] = [['2016-20', START, MID - 1], ['2021-26', MID, N - 1]];
const qq = (a: number, b: number) => C[qId][b] / C[qId][a] - 1;
const k$ = (r: number) => `$${(100 * (1 + r)).toFixed(0)}k`;
console.log(`shadow trades ${A.length} | QQQ held: 2016-20 ${k$(qq(START, MID - 1))}, 2021-26 ${k$(qq(MID, N - 1))}`);
const qUp = (t: Tr) => C[qId][t.e] > qEma[t.e];
let pass = false;
for (const [lab, f, slots, graded] of [
  ['always on (old test)', (_: Tr) => true, 20, false],
  ['PRIMARY: last 20 breakouts net positive', (t: Tr) => h20.get(t)! > 0, 20, true],
  ['last 50 net positive', (t: Tr) => h50.get(t)! > 0, 20, false],
  ['QQQ above 21-day EMA', qUp, 20, false],
  ['last 20 positive AND QQQ > 21 EMA', (t: Tr) => h20.get(t)! > 0 && qUp(t), 20, false],
  ['PRIMARY, 10 slots of 10%', (t: Tr) => h20.get(t)! > 0, 10, false],
] as const) {
  const ts = A.filter(f);
  const parts = HALF.map(([h, a, b]) => { const r = account(ts, a, b, slots); const rs = Array.from({ length: 50 }, (_, i) => account(ts, a, b, slots, 11 + i).ret).sort((x, y) => x - y); return { h, r, rmed: rs[25], q: qq(a, b) }; });
  if (graded) pass = parts.every(p => p.r.ret > p.q && p.rmed > p.q);
  console.log(`\n${lab}${graded ? '' : ' (control)'}`);
  for (const p of parts) console.log(`  ${p.h}: ${k$(p.r.ret)} (dd -${(100 * p.r.dd).toFixed(0)}%) | random median ${k$(p.rmed)} | taken ${p.r.taken}, win ${(100 * p.r.win).toFixed(0)}%, avg ${pct(p.r.avg)} | invested ${(100 * p.r.inMkt).toFixed(0)}% of days`);
}
console.log(`\n→ ${pass ? 'PASS' : 'fail'}`);

/* CHOP FOLLOW-UP — added 10 Oct 2026 after the run above failed, rules fixed before its run.
   Market chop = mean of QQQ's and SPY's 14-day Choppiness Index at the breakout session
   (100*log10(sum TR14 / (hi14 - lo14)) / log10(14); lib/indicators/chopMarket's daily leg).
   PRIMARY: take a trade only when chop < 50 (the dashboard's VERY SENSITIVE chop line).
   Controls: < 38.2 (trending), < 61.8 (skip only clear chop), < 50 AND last-20 positive.
   PASS: as above. */
const spyId = c.idOf.get('SPY')!;
const ci = (id: number, t: number) => { let tr = 0, hi = -Infinity, lo = Infinity; for (let j = t - 13; j <= t; j++) { tr += Math.max(H[id][j], C[id][j - 1]) - Math.min(L[id][j], C[id][j - 1]); hi = Math.max(hi, H[id][j]); lo = Math.min(lo, L[id][j]); } return 100 * Math.log10(tr / (hi - lo)) / Math.log10(14); };
const chop = (t: Tr) => (ci(qId, t.e) + ci(spyId, t.e)) / 2;
{ const days = HALF.map(([h, a, b]) => { let n = 0, lt = 0; for (let t = a; t <= b; t++) { n++; if ((ci(qId, t) + ci(spyId, t)) / 2 < 50) lt++; } return `${h} ${(100 * lt / n).toFixed(0)}%`; }); console.log(`\nCHOP FOLLOW-UP — share of days with chop < 50: ${days.join(', ')}`); }
let passC = false;
for (const [lab, f, graded] of [
  ['PRIMARY: chop < 50', (t: Tr) => chop(t) < 50, true],
  ['chop < 38.2 (trending)', (t: Tr) => chop(t) < 38.2, false],
  ['chop < 61.8', (t: Tr) => chop(t) < 61.8, false],
  ['chop < 50 AND last 20 positive', (t: Tr) => chop(t) < 50 && h20.get(t)! > 0, false],
] as const) {
  const ts = A.filter(f);
  const parts = HALF.map(([h, a, b]) => { const r = account(ts, a, b, 20); const rs = Array.from({ length: 50 }, (_, i) => account(ts, a, b, 20, 11 + i).ret).sort((x, y) => x - y); return { h, r, rmed: rs[25], q: qq(a, b) }; });
  if (graded) passC = parts.every(p => p.r.ret > p.q && p.rmed > p.q);
  console.log(`\n${lab}${graded ? '' : ' (control)'}`);
  for (const p of parts) console.log(`  ${p.h}: ${k$(p.r.ret)} (dd -${(100 * p.r.dd).toFixed(0)}%) | random median ${k$(p.rmed)} | taken ${p.r.taken}, win ${(100 * p.r.win).toFixed(0)}%, avg ${pct(p.r.avg)} | invested ${(100 * p.r.inMkt).toFixed(0)}% of days`);
}
console.log(`\n→ chop follow-up ${passC ? 'PASS' : 'fail'}`);

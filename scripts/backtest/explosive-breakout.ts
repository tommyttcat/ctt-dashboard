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
function portfolio(ts: Tr[], from: number, to: number) {
  let cash = 1e5; const pos: { t: Tr; sh: number }[] = []; let peak = 1e5, dd = 0, eq = 1e5;
  const byDay = new Map<number, Tr[]>(); for (const t of ts) if (t.e >= from && t.e <= to) (byDay.get(t.e) ?? byDay.set(t.e, []).get(t.e)!).push(t);
  const last = (id: number, s: number) => { let k = s; while (k > 0 && Number.isNaN(C[id][k])) k--; return C[id][k]; };
  for (let s = from; s <= to; s++) {
    for (let i = pos.length - 1; i >= 0; i--) if (pos[i].t.x <= s) { cash += pos[i].sh * pos[i].t.px * 0.999; pos.splice(i, 1); }
    const equity = cash + pos.reduce((a, p) => a + p.sh * last(p.t.id, s), 0);
    for (const t of (byDay.get(s) ?? []).sort((a, b) => b.vm - a.vm)) { if (pos.length >= 20 || pos.some(p => p.t.id === t.id)) continue; const amt = Math.min(cash, 0.05 * equity); if (amt < 0.02 * equity) continue; pos.push({ t, sh: amt / (t.fill * 1.001) }); cash -= amt; }
    eq = cash + pos.reduce((a, p) => a + p.sh * last(p.t.id, s), 0); peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak);
  }
  return { ret: eq / 1e5 - 1, dd };
}
const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
const med = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); return s[s.length >> 1]; };
const HALF: [string, number, number][] = [['2016-20', START, MID - 1], ['2021-26', MID, N - 1]];
const qq = (a: number, b: number) => C[qId][b] / C[qId][a] - 1;
console.log(`QQQ: 2016-20 ${pct(qq(START, MID - 1))} | 2021-26 ${pct(qq(MID, N - 1))}`);
let anyPass = false;
for (const kind of ['A', 'B'] as const) for (const gate of [false, true]) {
  const ts = trades.filter(t => t.kind === kind && (!gate || t.gated));
  const parts = HALF.map(([, a, b]) => { const h = ts.filter(t => t.e >= a && t.e <= b); return { n: h.length, avg: mean(h.map(t => t.ret)), ex: mean(h.map(t => t.ex)), win: mean(h.map(t => +(t.ret > 0))), big: h.filter(t => t.ret >= 0.5).length, med: med(h.map(t => t.ret)), acc: portfolio(ts, a, b) }; });
  const pass = parts.every((p, i) => p.ex > 0 && p.acc.ret > qq(HALF[i][1], HALF[i][2]));
  if (pass) anyPass = true;
  console.log(`\n${kind === 'A' ? 'A buy the breakout close' : 'B buy follow-through'}${gate ? ' (QQQ above 200-day)' : ''}`);
  for (const [i, p] of parts.entries()) console.log(`  ${HALF[i][0]}: n ${p.n} avg ${pct(p.avg)} median ${pct(p.med)} win ${(100 * p.win).toFixed(0)}% +50%+ ${p.big} | vs QQQ ${pct(p.ex)} | portfolio ${pct(p.acc.ret)} (dd ${pct(-p.acc.dd)})`);
  console.log(`  → ${pass ? 'PASS' : 'fail'}`);
}
console.log(`\nfailed breakouts (closed back below the breakout point): ${(100 * mean(trades.filter(t => t.kind === 'A').map(t => +(t.px < t.fill && t.x - t.e <= 20)))).toFixed(0)}% of A trades within 20 sessions`);
console.log(anyPass ? 'OVERALL: at least one variant PASSES' : 'OVERALL: fail');

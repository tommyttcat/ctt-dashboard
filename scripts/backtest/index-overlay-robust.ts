// scripts/backtest/index-overlay-robust.ts — how fragile is index-overlay.ts O4?
// Written AFTER seeing O4 pass (+197% vs QQQ +156%); it only varies the
// pre-registered numbers to see whether the result is a knife-edge, and
// checks how much one episode carries. Not a pass/fail test.
import { listSessions, readDay } from './cache';
const sessions = listSessions(); const N = sessions.length;
const q: { o: number; c: number }[] = []; const hist = new Map<string, number[]>(); const breadth: (number | null)[] = [];
for (const d of sessions) {
  let above = 0, total = 0;
  for (const r of readDay('adj', d)) {
    if (r[0] === 'QQQ') q.push({ o: r[1], c: r[4] });
    const c = r[4]; if (!(c > 0)) continue;
    let h = hist.get(r[0]); if (!h) { h = []; hist.set(r[0], h); }
    h.push(c); if (h.length > 41) h.shift(); if (h.length < 41) continue;
    let s = 0; for (let i = 1; i < 41; i++) s += h[i]; total++; if (c > s / 40) above++;
  }
  breadth.push(total >= 100 ? (100 * above) / total : null);
}
const START = 250, CASH = 0.04 / 252, BORROW = 0.05 / 252;
const sma = (d: number, n: number) => { let s = 0; for (let j = d - n + 1; j <= d; j++) s += q[j].c; return s / n; };
function run(th: number, hold: number, trend: number, nextOpen: boolean, skipEp: number | null = null) {
  const boost = new Array<boolean>(N).fill(false); let until = -1, ep = 0; const epStart: number[] = [];
  for (let d = START; d < N - 1; d++) { if (d <= until) continue; if (breadth[d] != null && (breadth[d] as number) <= th) { if (ep !== skipEp) { const s0 = d + (nextOpen ? 2 : 1); for (let k = s0; k <= Math.min(N - 1, d + hold + (nextOpen ? 1 : 0)); k++) boost[k] = true; } epStart.push(d); ep++; until = d + hold; } }
  let nav = 1, pk = 1, dd = 0;
  for (let d = START + 1; d < N; d++) {
    const e = boost[d] ? 1.5 : q[d - 1].c > sma(d - 1, trend) ? 1 : 0;
    const r = q[d].c / q[d - 1].c - 1;
    nav *= 1 + e * r + (e > 1 ? -(e - 1) * BORROW : (1 - e) * CASH);
    pk = Math.max(pk, nav); dd = Math.max(dd, 1 - nav / pk);
  }
  return { tot: nav - 1, dd, ep, epStart };
}
const qqq = q[N - 1].c / q[START].c - 1;
const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%`;
console.log(`QQQ held ${sessions[START]} → end: ${pct(qqq)}`);
for (const th of [15, 20, 25]) for (const hold of [5, 10, 20]) for (const trend of [150, 200, 250]) {
  const r = run(th, hold, trend, false);
  if (hold === 10 || trend === 200) console.log(`panic<=${th}% hold ${String(hold).padStart(2)} trend ${trend}: ${pct(r.tot).padStart(6)} DD ${pct(-r.dd)} episodes ${r.ep}`);
}
const base = run(20, 10, 200, false);
console.log(`act at the NEXT OPEN instead of the close: ${pct(run(20, 10, 200, true).tot)} (vs ${pct(base.tot)})`);
console.log(`trend rule alone (no panic boost): ${pct(run(-1, 10, 200, false).tot)}`);
const without = base.epStart.map((d, i) => ({ d: sessions[d], tot: run(20, 10, 200, false, i).tot }));
without.sort((a, b) => a.tot - b.tot);
console.log(`dropping one episode at a time: worst case ${pct(without[0].tot)} (without ${without[0].d}), best ${pct(without[without.length - 1].tot)}; episodes: ${base.epStart.map(d => sessions[d]).join(' ')}`);

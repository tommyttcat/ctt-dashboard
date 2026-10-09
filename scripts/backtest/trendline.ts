// scripts/backtest/trendline.ts — buying the rising trendline (the NBIS chart idea).
//
//   npx tsx scripts/backtest/trendline.ts
//
// The chart that prompted it: higher lows that keep touching a rising line
// (NBIS, Jul - Oct 2026), and an AI write-up calling the touch a long with a
// stop just below. Daily bars only — the order-flow / gamma parts of that
// write-up have no history to test.
//
// RULES — fixed 9 Oct 2026, before the first run. Universe each day: CS/ADRC,
// close >= $5, 20-session average dollar volume >= $20M (rank-engine's).
//   Swing low: a bar whose low is the lowest of the 3 bars either side,
//     confirmed 3 sessions later (so never used before it is known).
//   The line at day t: P2 = the latest confirmed swing low; P1 = the lowest
//     swing low between 120 sessions ago and 10 sessions before P2, with
//     low(P2) > low(P1). The line runs through both lows.
//   Valid only if (a) at least 3 swing lows from P1 to P2 sit within half an
//     ADR of the line, and (b) no close from P1 to t is more than half an ADR
//     below it. ADR = mean(high/low - 1) over 20 sessions.
//   Trigger at t: the low comes within half an ADR above the line (or below
//     it) and the close is on or above the line.
//   Entry: next session's open. Skipped if that open is already at or below
//     the stop.
//   Stop: half an ADR below the line, moving up with it each day; out at the
//     stop (or the open if it gaps through). Otherwise out at the close of
//     the 20th session. One position per name at a time. 0.1% a side.
//   Benchmark: QQQ over the same open-to-exit window (the risk-matched bar
//     since rank-risk-check.ts), and SPY.
//   PASS: average trade beats QQQ over the same windows, after costs, in BOTH
//     halves (split at the median trade date), AND the $100k account
//     (0.5% risk, qullamaggie.ts's account) beats QQQ held over the period
//     in both halves, AND the random-order median does too.

import { loadAdjusted } from './cache';
import { loadReference, refAt } from './reference';
import { account, stats, pct, type Trade } from './qullamaggie';

const c = loadAdjusted();
const ref = loadReference();
const { sessions, syms, O, H, L, C, V } = c;
const N = sessions.length;
const qqqId = c.idOf.get('QQQ')!, spyId = c.idOf.get('SPY')!;
const COST = 0.001;

const typeOk = new Map<string, boolean>();
const isStock = (sym: string, date: string) => {
  const k = `${sym}|${date.slice(0, 4)}`;
  if (!typeOk.has(k)) { const t = (refAt(ref, sym, date)?.type || '').toUpperCase(); typeOk.set(k, t === 'CS' || t === 'ADRC'); }
  return typeOk.get(k)!;
};

type T = Trade & { qqqRet: number; spyRet: number; touches: number; adr: number };
const trades: T[] = [];
let setups = 0;
for (let id = 0; id < syms.length; id++) {
  const pivots: number[] = [];          // confirmed swing-low indices
  let busyUntil = -1;
  for (let t = 130; t < N - 1; t++) {
    // confirm the swing low at t-3
    const j = t - 3;
    if (!Number.isNaN(L[id][j])) {
      // every neighbour's low must be higher
      let low = true;
      for (let k = j - 3; k <= j + 3; k++) { if (k === j) continue; if (Number.isNaN(L[id][k]) || !(L[id][k] > L[id][j])) { low = false; break; } }
      if (low) pivots.push(j);
    }
    if (t <= busyUntil) continue;
    const cl = C[id][t];
    if (!(cl >= 5) || Number.isNaN(O[id][t + 1])) continue;
    let dv = 0, adr = 0, ok = true;
    for (let k = t - 19; k <= t; k++) { if (Number.isNaN(C[id][k])) { ok = false; break; } dv += C[id][k] * V[id][k]; adr += H[id][k] / L[id][k] - 1; }
    if (!ok || !(dv / 20 >= 20e6)) continue;
    adr /= 20;
    if (!pivots.length) continue;
    const p2 = pivots[pivots.length - 1];
    let p1 = -1;
    for (const p of pivots) if (p >= t - 120 && p <= p2 - 10 && (p1 < 0 || L[id][p] < L[id][p1])) p1 = p;
    if (p1 < 0 || !(L[id][p2] > L[id][p1])) continue;
    const slope = (L[id][p2] - L[id][p1]) / (p2 - p1);
    const line = (k: number) => L[id][p1] + slope * (k - p1);
    let touches = 0;
    for (const p of pivots) if (p >= p1 && p <= p2 && Math.abs(L[id][p] - line(p)) <= 0.5 * adr * line(p)) touches++;
    if (touches < 3) continue;
    let respected = true;
    for (let k = p1; k <= t; k++) if (!Number.isNaN(C[id][k]) && C[id][k] < line(k) * (1 - 0.5 * adr)) { respected = false; break; }
    if (!respected) continue;
    if (!(L[id][t] <= line(t) * (1 + 0.5 * adr) && cl >= line(t))) continue;
    if (!isStock(syms[id], sessions[t])) continue;
    setups++;
    // trade
    const e = t + 1, fill = O[id][e];
    const stopAt = (k: number) => line(k) * (1 - 0.5 * adr);
    if (!(fill > stopAt(e))) continue;
    let exit: [number, number] | null = null;
    for (let k = e, n = 1; k < N; k++) {
      if (Number.isNaN(C[id][k])) continue;
      const st = stopAt(k);
      if (k > e && O[id][k] <= st) { exit = [k, O[id][k]]; break; }
      if (L[id][k] <= st) { exit = [k, st]; break; }
      if (n === 20) { exit = [k, C[id][k]]; break; }
      n++;
    }
    if (!exit) { let k = N - 1; while (Number.isNaN(C[id][k])) k--; exit = [k, C[id][k]]; }
    const ret = exit[1] / fill - 1 - 2 * COST;
    const qqqRet = C[qqqId][exit[0]] / O[qqqId][e] - 1, spyRet = C[spyId][exit[0]] / O[spyId][e] - 1;
    trades.push({ ticker: syms[id], date: sessions[e], ei: e, mkt: true, r63: touches, fill, stop: stopAt(e), exits: [[exit[0], 1, exit[1]]], ret, qqqRet, spyRet, touches, adr });
    busyUntil = exit[0];
  }
}

trades.sort((a, b) => a.ei - b.ei);
const mid = trades[trades.length >> 1].ei;
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const line = (name: string, ts: T[]) => `${name.padEnd(10)} ${stats(ts)} | QQQ same windows ${pct(avg(ts.map(t => t.qqqRet)))} | excess vs QQQ ${pct(avg(ts.map(t => t.ret - t.qqqRet)))} | SPY ${pct(avg(ts.map(t => t.spyRet)))}`;
console.log(`setups ${setups} → trades ${trades.length}, ${trades[0]?.date} → ${trades.at(-1)?.date}`);
console.log(line('all', trades));
console.log(line('1st half', trades.filter(t => t.ei < mid)));
console.log(line('2nd half', trades.filter(t => t.ei >= mid)));
for (const [lo, hi] of [[0, 0.03], [0.03, 0.05], [0.05, 0.09], [0.09, 1]]) console.log(line(`ADR ${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)}%`, trades.filter(t => t.adr >= lo && t.adr < hi)));
for (const n of [3, 4, 5]) console.log(line(`touches ${n}${n === 5 ? '+' : ''}`, trades.filter(t => (n === 5 ? t.touches >= 5 : t.touches === n))));

const qqqHold = (a: number, b: number) => C[qqqId][b] / O[qqqId][a] - 1;
const first = trades[0].ei, last = N - 1;
for (const [label, a, b] of [['whole', first, last], ['1st half', first, mid - 1], ['2nd half', mid, last]] as const) {
  const acct = account(c, trades, a, b);
  const sh = Array.from({ length: 200 }, (_, i) => account(c, trades, a, b, i + 7).final).sort((x, y) => x - y);
  console.log(`account ${label.padEnd(8)} ${sessions[a]}→${sessions[b]}: ${pct(acct.final / 1e5 - 1)} (maxDD ${(acct.maxDD * 100).toFixed(1)}%) | random-order median ${pct(sh[100] / 1e5 - 1)} | QQQ held ${pct(qqqHold(a, b))}`);
}

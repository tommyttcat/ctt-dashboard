// scripts/backtest/rank-entries.ts — entries and sell-half exits on the ranked list (daily bars).
//
//   npx tsx scripts/backtest/rank-entries.ts
//
// The ranked list (P2, rank-pead.ts) only matched QQQ held a month at a time.
// This asks whether swing-trading it — a real entry, a stop, selling half on
// a gain and trailing the rest — beats the index. Part 1 of 2; part 2 uses
// minute bars (opening-range and VWAP entries, low-of-day stops).
//
// RULES — fixed 9 Oct 2026, before the first run.
//   Candidates: the P2 top 50 at close t, only when QQQ closed above its
//     200-day average at t. One position per name at a time. Entry on t+1.
//   ATR = 14-session mean true range through t. SMA10 = 10-session close average.
//   E0 next open: buy at the open of t+1.
//   E1 pullback: close(t) > SMA10(t) and SMA10(t) > SMA10(t-5); buy limit at
//      SMA10(t) — fills if low(t+1) <= it, at min(open, SMA10).
//   E2 breakout: buy stop at high(t) — fills if high(t+1) > it, at
//      max(open, high(t)); skipped if that fill is more than 1 ATR over close(t).
//   Stop: fill - 1 ATR. On the entry day only a CLOSE below the stop counts
//     (daily bars cannot order the fill and the low); after that, out at the
//     open if it gaps through, else at the stop.
//   X0 no partial: all out at the first close below SMA10 (from day 2).
//   X1 half after 3 days: at the 3rd session's close, if above the fill, sell
//      half; stop to breakeven; rest out at the first close below SMA10.
//   X2 half at +2 ATR: limit at fill + 2 ATR (open if it gaps over); stop to
//      breakeven; rest out at the first close below SMA10 (from day 2).
//   Max hold 120 sessions. 0.1% a side.
//   Account: $100k, qullamaggie.ts's (0.5% of equity at risk per trade, 25%
//     max per position, no margin), same-day entries in list-rank order;
//     200 random orders as a luck check.
//   PASS: the account beats BOTH QQQ held and QQQ-above-200-day (O3, cash 4%)
//     in BOTH halves (split 2024-09-30), AND its random-order median beats
//     QQQ held in both halves, AND the average trade beats QQQ over the same
//     window in both halves.

import { sessions, N, O, H, C, c, S0, SPLIT } from './rank-engine';
import { p2 } from './rank-pead';
import { account, stats, type Trade } from './qullamaggie';

const L = c.L;
const COST = 0.001;
const qId = c.idOf.get('QQQ')!;
const sma = (id: number, t: number, n: number) => { let s = 0; for (let j = t - n + 1; j <= t; j++) s += C[id][j]; return s / n; };
const atr = (id: number, t: number) => { let s = 0; for (let k = t - 13; k <= t; k++) s += Math.max(H[id][k], C[id][k - 1]) - Math.min(L[id][k], C[id][k - 1]); return s / 14; };
const above200 = (t: number) => C[qId][t] > sma(qId, t, 200);

type Entry = 'E0' | 'E1' | 'E2';
type Exit = 'X0' | 'X1' | 'X2';
type T = Trade & { qqq: number };

function simulate(id: number, t: number, fill: number, a: number, x: Exit): T | null {
  const e = t + 1;
  let stop = fill - a;
  if (!(stop > 0)) return null;
  const exits: [number, number, number][] = [];
  let left = 1;
  if (C[id][e] < stop) { exits.push([e, 1, C[id][e]]); left = 0; }
  const target = fill + 2 * a;
  for (let s = e + 1; left > 0 && s < N; s++) {
    if (Number.isNaN(C[id][s])) continue;
    const day = s - e + 1;
    if (O[id][s] <= stop) { exits.push([s, left, O[id][s]]); left = 0; break; }
    if (L[id][s] <= stop) { exits.push([s, left, stop]); left = 0; break; }
    if (x === 'X2' && left === 1 && H[id][s] >= target) { exits.push([s, 0.5, Math.max(O[id][s], target)]); left = 0.5; stop = Math.max(stop, fill); }
    if (x === 'X1' && left === 1 && day === 3 && C[id][s] > fill) { exits.push([s, 0.5, C[id][s]]); left = 0.5; stop = Math.max(stop, fill); }
    if (left > 0 && C[id][s] < sma(id, s, 10)) { exits.push([s, left, C[id][s]]); left = 0; break; }
    if (day >= 120) { exits.push([s, left, C[id][s]]); left = 0; break; }
  }
  if (left > 0) { let s = N - 1; while (s > e && Number.isNaN(C[id][s])) s--; exits.push([s, left, C[id][s]]); }
  const ret = exits.reduce((m, [, f, p]) => m + f * (p / fill - 1), 0) - 2 * COST;
  const last = exits.reduce((m, q) => Math.max(m, q[0]), 0);
  return { ticker: c.syms[id], date: sessions[e], ei: e, mkt: true, r63: 0, fill, stop: fill - a, exits, ret, qqq: C[qId][last] / O[qId][e] - 1 };
}

function run(en: Entry, x: Exit): T[] {
  const trades: T[] = [];
  const busy = new Map<number, number>();
  for (let t = S0 - 1; t + 1 < N; t++) {
    if (!above200(t)) continue;
    const list = p2(t);
    list.forEach((id, rank) => {
      if ((busy.get(id) ?? -1) >= t + 1) return;
      const o = O[id][t + 1];
      if (!(o > 0) || Number.isNaN(H[id][t + 1])) return;
      const a = atr(id, t);
      if (!(a > 0)) return;
      let fill = NaN;
      if (en === 'E0') fill = o;
      else if (en === 'E1') {
        const m = sma(id, t, 10);
        if (C[id][t] > m && m > sma(id, t - 5, 10) && L[id][t + 1] <= m) fill = Math.min(o, m);
      } else {
        if (H[id][t + 1] > H[id][t]) { fill = Math.max(o, H[id][t]); if (fill > C[id][t] + a) fill = NaN; }
      }
      if (!(fill > 0)) return;
      const tr = simulate(id, t, fill, a, x);
      if (!tr) return;
      tr.r63 = -rank;
      trades.push(tr);
      busy.set(id, tr.exits.reduce((m, q) => Math.max(m, q[0]), 0));
    });
  }
  return trades.sort((p, q) => p.ei - q.ei);
}

const pct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
const iSplit = sessions.findIndex(d => d > SPLIT);
const halves: [string, number, number][] = [['1st', S0, iSplit - 1], ['2nd', iSplit, N - 1]];
const qqqHeld = (a: number, b: number) => C[qId][b] / O[qId][a] - 1;
const o3 = (a: number, b: number) => { let v = 1; for (let d = a + 1; d <= b; d++) v *= above200(d - 1) ? C[qId][d] / C[qId][d - 1] : 1 + 0.04 / 252; return v * (above200(a - 1) ? C[qId][a] / O[qId][a] : 1) - 1; };
console.log(`window ${sessions[S0]} → ${sessions[N - 1]}, split ${SPLIT}`);
for (const [h, a, b] of halves) console.log(`  ${h} half: QQQ held ${pct(qqqHeld(a, b))}, QQQ above 200-day ${pct(o3(a, b))}`);
for (const en of ['E0', 'E1', 'E2'] as Entry[]) for (const x of ['X0', 'X1', 'X2'] as Exit[]) {
  const ts = run(en, x);
  const parts = halves.map(([h, a, b]) => {
    const inH = ts.filter(t => t.ei >= a && t.ei <= b);
    const acct = account(c, inH, a, b);
    const shuf = Array.from({ length: 200 }, (_, i) => account(c, inH, a, b, i + 7).final).sort((p, q) => p - q)[100];
    const ex = inH.reduce((m, t) => m + t.ret - t.qqq, 0) / Math.max(1, inH.length);
    return { h, acct: acct.final / 1e5 - 1, dd: acct.maxDD, shuf: shuf / 1e5 - 1, ex, q: qqqHeld(a, b), o: o3(a, b), n: inH.length };
  });
  const pass = parts.every(p => p.acct > p.q && p.acct > p.o && p.shuf > p.q && p.ex > 0);
  console.log(`\n${en} ${x}  ${stats(ts)}`);
  for (const p of parts) console.log(`  ${p.h}: account ${pct(p.acct)} (worst drop ${pct(-p.dd)}, random-order median ${pct(p.shuf)}) | avg trade vs QQQ same window ${pct(p.ex)} | n ${p.n}`);
  console.log(`  → ${pass ? 'PASS' : 'fail'}`);
}

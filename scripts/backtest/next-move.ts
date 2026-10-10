// scripts/backtest/next-move.ts — which Momentum Leaders move next?
//
//   npx tsx scripts/backtest/next-move.ts
//
// Inside the ranked list (P2 top 50, rank-pead.ts — what the card shows),
// does anything we track separate the names that run over the next month
// from the ones that stall?
//
// RULES — fixed 9 Oct 2026, before the first run.
//   Sample: every 5th session from the first ranked month; every list name at
//     that close. Outcome: close t to close t+20, minus QQQ over the same
//     window, minus 0.2% costs ("excess"); and whether the name closed 20%+
//     above close t at any point in those 20 sessions ("ran").
//   Traits at close t (daily bars only):
//     coil      10-day high-low range / ATR(14)            (low = tight)
//     ext21     (close - EMA21) / close, in ADR(20) units   (low = near the line)
//     offHigh   close / 252-day high - 1                    (high = at highs)
//     rvol      today's volume / prior 20-day average
//     dryup     5-day average volume / 50-day average       (low = quiet)
//     closeStr  (close - low) / (high - low)
//     rsi       RSI(14)
//     r1m       21-session return
//     mom       12-1 momentum
//     sue       earnings surprise (rank-pead.ts sue())
//     stage2    close > SMA50 > SMA150 > SMA200, SMA200 rising over 20 sessions (1/0)
//     ur        undercut & rally today: low under the prior 10-day low within
//               the last 3 sessions, today's close the first back above it (1/0)
//   Each continuous trait is split into thirds WITHIN each day's list; the
//   flags compare 1 vs 0.
//   PASS: the top-third-minus-bottom-third (or flag-minus-rest) excess has the
//     same sign in BOTH halves (split 2024-09-30), is at least 1.0 point in
//     each, AND the better side beats QQQ in each half. "ran" rates are
//     printed alongside. Observations overlap (20-day windows, 5-day steps),
//     so treat counts as roughly a quarter of their face value.

import { sessions, N, O, H, C, V, c, S0, SPLIT, pool } from './rank-engine';
import { p2, sue } from './rank-pead';

void O;
const L = c.L;
const qId = c.idOf.get('QQQ')!;
const FWD = 20, STEP = 5, COST = 0.002;
const iSplit = sessions.findIndex(d => d > SPLIT);

const sma = (id: number, t: number, n: number) => { let s = 0; for (let j = t - n + 1; j <= t; j++) s += C[id][j]; return s / n; };
const emaAt = (id: number, t: number, n: number) => { const k = 2 / (n + 1); let e = sma(id, t - 60, n); for (let j = t - 59; j <= t; j++) e = C[id][j] * k + e * (1 - k); return e; };
const atr = (id: number, t: number) => { let s = 0; for (let k = t - 13; k <= t; k++) s += Math.max(H[id][k], C[id][k - 1]) - Math.min(L[id][k], C[id][k - 1]); return s / 14; };
const adr = (id: number, t: number) => { let s = 0; for (let k = t - 19; k <= t; k++) s += H[id][k] / L[id][k] - 1; return s / 20; };
const avgV = (id: number, a: number, b: number) => { let s = 0; for (let k = a; k <= b; k++) s += V[id][k]; return s / (b - a + 1); };
const rsi = (id: number, t: number) => { let g = 0, l = 0; for (let k = t - 13; k <= t; k++) { const d = C[id][k] - C[id][k - 1]; if (d > 0) g += d; else l -= d; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); };
const lowest = (id: number, a: number, b: number) => { let m = Infinity; for (let k = a; k <= b; k++) m = Math.min(m, L[id][k]); return m; };

type Obs = { day: number; half: 0 | 1; ex: number; ran: boolean; f: Record<string, number> };
const obs: Obs[] = [];
const momOf = new Map<number, number>();
for (let t = S0 - 1; t + FWD < N; t += STEP) {
  momOf.clear();
  for (const p of pool(t)) momOf.set(p.id, p.mom);
  const q = C[qId][t + FWD] / C[qId][t] - 1;
  for (const id of p2(t)) {
    let ok = true;
    for (let k = t - 260; k <= t; k++) if (Number.isNaN(C[id][k])) { ok = false; break; }
    if (!ok) continue;
    let end = t + FWD; while (end > t && Number.isNaN(C[id][end])) end--;
    if (end === t) continue;
    const cl = C[id][t];
    let mx = 0; for (let k = t + 1; k <= end; k++) if (!Number.isNaN(C[id][k])) mx = Math.max(mx, C[id][k]);
    let hi10 = -Infinity, hi252 = -Infinity;
    for (let k = t - 9; k <= t; k++) hi10 = Math.max(hi10, H[id][k]);
    for (let k = t - 251; k <= t; k++) hi252 = Math.max(hi252, H[id][k]);
    const a = atr(id, t), d = adr(id, t);
    const s50 = sma(id, t, 50), s150 = sma(id, t, 150), s200 = sma(id, t, 200), s200p = sma(id, t - 20, 200);
    // undercut & rally of the prior 10-day low
    let ur = 0;
    for (let u = t; u >= t - 3 && !ur; u--) {
      const lvl = lowest(id, u - 10, u - 1);
      if (!(C[id][u - 1] > lvl && L[id][u] < lvl && L[id][u] >= lvl * (1 - 2 * d))) continue;
      let first = -1; for (let k = u; k <= t; k++) { if (C[id][k] > lowest(id, u - 10, u - 1)) { first = k; break; } }
      if (first === t) ur = 1;
    }
    const hl = H[id][t] - L[id][t];
    const su = sue(c.syms[id], sessions[t]);
    obs.push({
      day: t,
      half: t < iSplit ? 0 : 1,
      ex: C[id][end] / cl - 1 - COST - q,
      ran: mx >= cl * 1.2,
      f: {
        coil: a > 0 ? (hi10 - lowest(id, t - 9, t)) / a : NaN,
        ext21: d > 0 ? (cl - emaAt(id, t, 21)) / cl / d : NaN,
        offHigh: cl / hi252 - 1,
        rvol: V[id][t] / avgV(id, t - 20, t - 1),
        dryup: avgV(id, t - 4, t) / avgV(id, t - 49, t),
        closeStr: hl > 0 ? (cl - L[id][t]) / hl : NaN,
        rsi: rsi(id, t),
        r1m: cl / C[id][t - 21] - 1,
        mom: momOf.get(id) ?? NaN,
        sue: su ?? NaN,
        stage2: cl > s50 && s50 > s150 && s150 > s200 && s200 > s200p ? 1 : 0,
        ur,
      },
    });
  }
}

const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`;
const mean = (xs: number[]) => xs.reduce((m, v) => m + v, 0) / Math.max(1, xs.length);
console.log(`observations ${obs.length}; split ${SPLIT}; 20-session excess vs QQQ; "ran" = closed 20%+ above within 20 sessions`);
console.log(`all list names: 1st ${pct(mean(obs.filter(o => o.half === 0).map(o => o.ex)))} ran ${(100 * mean(obs.filter(o => o.half === 0).map(o => +o.ran))).toFixed(1)}% | 2nd ${pct(mean(obs.filter(o => o.half === 1).map(o => o.ex)))} ran ${(100 * mean(obs.filter(o => o.half === 1).map(o => +o.ran))).toFixed(1)}%\n`);

// Thirds within each sample day's list.
const days = new Map<number, Obs[]>();
for (const o of obs) (days.get(o.day) ?? days.set(o.day, []).get(o.day)!).push(o);
const CONT = ['coil', 'ext21', 'offHigh', 'rvol', 'dryup', 'closeStr', 'rsi', 'r1m', 'mom', 'sue'];
const FLAGS = ['stage2', 'ur'];
const passed: string[] = [];
const line = (label: string, g: Obs[][]) => g.map((xs, h) => `${h ? '2nd' : '1st'} ${pct(mean(xs.map(o => o.ex))).padStart(7)} ran ${(100 * mean(xs.map(o => +o.ran))).toFixed(1).padStart(4)}% n ${String(xs.length).padStart(4)}`).join(' | ') + `  ${label}`;
for (const k of CONT) {
  const lo: Obs[][] = [[], []], hi: Obs[][] = [[], []];
  for (const xs of days.values()) {
    const v = xs.filter(o => Number.isFinite(o.f[k])).sort((a, b) => a.f[k] - b.f[k]);
    if (v.length < 9) continue;
    const n3 = Math.floor(v.length / 3);
    for (const o of v.slice(0, n3)) lo[o.half].push(o);
    for (const o of v.slice(-n3)) hi[o.half].push(o);
  }
  const sp = [0, 1].map(h => mean(hi[h].map(o => o.ex)) - mean(lo[h].map(o => o.ex)));
  const good = sp[0] > 0 ? hi : lo;
  const pass = Math.sign(sp[0]) === Math.sign(sp[1]) && Math.abs(sp[0]) >= 0.01 && Math.abs(sp[1]) >= 0.01 && mean(good[0].map(o => o.ex)) > 0 && mean(good[1].map(o => o.ex)) > 0;
  if (pass) passed.push(`${k} ${sp[0] > 0 ? 'high' : 'low'}`);
  console.log(`${k.padEnd(9)} top-minus-bottom third: 1st ${pct(sp[0])} 2nd ${pct(sp[1])}  → ${pass ? 'PASS' : 'fail'}`);
  console.log(`   bottom third: ${line('', lo)}`);
  console.log(`   top third:    ${line('', hi)}`);
}
for (const k of FLAGS) {
  const on: Obs[][] = [[], []], off: Obs[][] = [[], []];
  for (const o of obs) (o.f[k] ? on : off)[o.half].push(o);
  const sp = [0, 1].map(h => mean(on[h].map(o => o.ex)) - mean(off[h].map(o => o.ex)));
  const good = sp[0] > 0 ? on : off;
  const pass = Math.sign(sp[0]) === Math.sign(sp[1]) && Math.abs(sp[0]) >= 0.01 && Math.abs(sp[1]) >= 0.01 && mean(good[0].map(o => o.ex)) > 0 && mean(good[1].map(o => o.ex)) > 0;
  if (pass) passed.push(`${k} ${sp[0] > 0 ? 'yes' : 'no'}`);
  console.log(`${k.padEnd(9)} flag-minus-rest: 1st ${pct(sp[0])} 2nd ${pct(sp[1])}  → ${pass ? 'PASS' : 'fail'}`);
  console.log(`   flag:  ${line('', on)}`);
  console.log(`   rest:  ${line('', off)}`);
}
console.log(`\npassed: ${passed.length ? passed.join(', ') : 'none'}`);

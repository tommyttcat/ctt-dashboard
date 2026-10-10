// scripts/backtest/next-move-channels.ts — trend lines, channels and trend quality inside the ranked list.
//
//   npx tsx scripts/backtest/next-move-channels.ts
//
// Same sample, outcome, thirds and PASS bar as next-move.ts; only the traits
// change. Asked 9 Oct 2026: "have you looked at trend lines and channels?"
//
// RULES — fixed 9 Oct 2026, before the first run. Traits at close t:
//   chan50    where the close sits in its 50-session linear-regression channel:
//             (close - fitted value today) / stdev of the residuals
//             (negative = lower half of the channel, positive = upper half)
//   chan100   the same over 100 sessions
//   r2_126    R-squared of a straight line through 126 sessions of log closes
//             (1 = a perfectly straight trend, 0 = no trend)
//   slope126  that line's slope, % per session
//   fip       "frog in the pan" information discreteness over 252 sessions:
//             sign(return) x (% down days - % up days); LOW = the gain came
//             smoothly, many small up days (Da, Gurun & Warachka 2014)
//   touch     support-line touches: from next-move's universe, the number of
//             10-day swing lows in the last 126 sessions within 1 ADR of the
//             126-session regression line's lower channel (fitted - 1 stdev)
//   PASS exactly as next-move.ts: top-minus-bottom third same sign in both
//   halves (split 2024-09-30), at least 1.0 point each, and the better side
//   beats QQQ in each half.

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

const logReg = (id: number, t: number, n: number) => {
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { const y = Math.log(C[id][t - n + 1 + i]); sx += i; sy += y; sxx += i * i; sxy += i * y; }
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - b * sx) / n;
  let ssr = 0, sst = 0; const my = sy / n;
  for (let i = 0; i < n; i++) { const y = Math.log(C[id][t - n + 1 + i]); ssr += (y - (a + b * i)) ** 2; sst += (y - my) ** 2; }
  return { a, b, sd: Math.sqrt(ssr / (n - 2)), r2: sst > 0 ? 1 - ssr / sst : 0 };
};
function channelTraits(id: number, t: number, d: number): Record<string, number> {
  const pos = (n: number) => { const r = logReg(id, t, n); return r.sd > 0 ? (Math.log(C[id][t]) - (r.a + r.b * (n - 1))) / r.sd : NaN; };
  const r126 = logReg(id, t, 126);
  let up = 0, dn = 0;
  for (let k = t - 251; k <= t; k++) { const x = C[id][k] / C[id][k - 1] - 1; if (x > 0) up++; else if (x < 0) dn++; }
  const ret = C[id][t] / C[id][t - 252] - 1;
  let touch = 0;
  for (let k = t - 120; k <= t - 5; k++) {
    let low = true; for (let j = k - 5; j <= k + 5; j++) if (j !== k && !(L[id][j] > L[id][k])) { low = false; break; }
    if (!low) continue;
    const i = k - (t - 125);
    const lower = Math.exp(r126.a + r126.b * i - r126.sd);
    if (Math.abs(L[id][k] / lower - 1) <= d) touch++;
  }
  return {
    chan50: pos(50), chan100: pos(100), r2_126: r126.r2, slope126: (Math.exp(r126.b) - 1) * 100,
    fip: Math.sign(ret) * (dn - up) / 252, touch,
  };
}

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
      f: channelTraits(id, t, d),
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
const CONT = ['chan50', 'chan100', 'r2_126', 'slope126', 'fip', 'touch'];
const FLAGS: string[] = [];
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

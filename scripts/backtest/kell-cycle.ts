// scripts/backtest/kell-cycle.ts — Oliver Kell's "Cycle of Price Action" entries (shared 11 Oct
// 2026): the Wedge Pop and the EMA Crossback, 2016-2026.
//
//   LONG=1 NODE_OPTIONS=--max-old-space-size=12288 npx tsx scripts/backtest/kell-cycle.ts
//
// RULES — fixed 11 Oct 2026, before the first run. EMAs: 10 and 20 on daily adjusted closes.
//   Universe: CS/ADRC, real close >= $2, 20-session $ volume >= $20M.
//   WEDGE POP at t: (a) 10+ of closes t-15..t-1 below the 20 EMA and EMA10 < EMA20 at t-1;
//     (b) high-low span of t-10..t-1 <= 3 x ADR(20) x close(t-1); (c) close(t) > both EMAs and
//     > highest high of t-5..t-1; (d) volume(t) >= 1.5 x its 50-session average; (e) close in
//     the top 30% of the day's range.
//   EMA CROSSBACK at t: a Wedge Pop at p in t-15..t-3; EMA10 > EMA20 at t; low(t) <= EMA10(t) x
//     1.005; close(t) >= EMA20(t); the first such day since p.
//   TRADE: buy at close(t); stop = low(t) (from t+1: a low at/through it exits at min(open,
//     stop)); else out at the first close below the 20 EMA; max 120 sessions; 0.2% round trip.
//     One position per name per kind.
//   ACCOUNT: $100k, 20 slots of 5% of equity, same-day order by volume multiple; 50 random
//     orders. Control (reported): only when QQQ > its 200-day.
//   PASS (each entry separately): account AND random-order median beat QQQ held, and average
//     trade minus QQQ > 0, in BOTH halves (2016-20, 2021-26).

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
const emaOf = (cl: Float32Array, n: number) => { const out = new Float64Array(N).fill(NaN); let e = NaN; const k = 2 / (n + 1); for (let j = 0; j < N; j++) { if (Number.isNaN(cl[j])) { e = NaN; continue; } e = Number.isNaN(e) ? cl[j] : cl[j] * k + e * (1 - k); out[j] = e; } return out; };

type Tr = { id: number; e: number; x: number; px: number; fill: number; ret: number; ex: number; vm: number; kind: 'POP' | 'XBACK'; gated: boolean };
const trades: Tr[] = [];
for (let id = 0; id < syms.length; id++) {
  const cl = C[id]; const e10 = emaOf(cl, 10), e20 = emaOf(cl, 20);
  const busy = { POP: -1, XBACK: -1 }; let lastPop = -999, xbackUsed = -1;
  const ok = (t: number, n: number) => { for (let j = t - n; j <= t; j++) if (Number.isNaN(cl[j])) return false; return true; };
  const trade = (t: number, kind: 'POP' | 'XBACK', vm: number) => {
    if (t <= busy[kind] || t >= N - 1) return;
    const fill = cl[t], stop = L[id][t]; let x = -1, px = NaN;
    for (let k = t + 1; k < N && k <= t + 120; k++) {
      if (Number.isNaN(cl[k])) continue;
      if (L[id][k] <= stop) { x = k; px = Math.min(O[id][k], stop); break; }
      if (cl[k] < e20[k] || k === t + 120) { x = k; px = cl[k]; break; }
    }
    if (x < 0) { let k = N - 1; while (Number.isNaN(cl[k])) k--; x = k; px = cl[k]; }
    const ret = px / fill - 1 - 0.002;
    trades.push({ id, e: t, x, px, fill, ret, ex: ret - (C[qId][x] / C[qId][t] - 1), vm, kind, gated: q200(t) });
    busy[kind] = x;
  };
  for (let t = Math.max(START - 20, 260); t < N - 1; t++) {
    if (!ok(t, 60) || !(RC[id][t] >= 2)) continue;
    let dv = 0; for (let j = t - 19; j <= t; j++) dv += cl[j] * V[id][j]; if (!(dv / 20 >= 20e6)) continue;
    // WEDGE POP
    let below = 0; for (let j = t - 15; j <= t - 1; j++) if (cl[j] < e20[j]) below++;
    let adr = 0; for (let j = t - 20; j <= t - 1; j++) adr += H[id][j] / L[id][j] - 1; adr /= 20;
    let hi10 = -Infinity, lo10 = Infinity; for (let j = t - 10; j <= t - 1; j++) { hi10 = Math.max(hi10, H[id][j]); lo10 = Math.min(lo10, L[id][j]); }
    let hi5 = -Infinity; for (let j = t - 5; j <= t - 1; j++) hi5 = Math.max(hi5, H[id][j]);
    let v50 = 0; for (let j = t - 50; j <= t - 1; j++) v50 += V[id][j]; v50 /= 50;
    const vm = V[id][t] / v50, rng = H[id][t] - L[id][t];
    const pop = below >= 10 && e10[t - 1] < e20[t - 1] && hi10 - lo10 <= 3 * adr * cl[t - 1]
      && cl[t] > e10[t] && cl[t] > e20[t] && cl[t] > hi5 && vm >= 1.5 && rng > 0 && (cl[t] - L[id][t]) / rng >= 0.7;
    if (pop && isStock(syms[id], sessions[t])) { lastPop = t; if (t >= START) trade(t, 'POP', vm); continue; }
    // EMA CROSSBACK
    if (t - lastPop >= 3 && t - lastPop <= 15 && xbackUsed !== lastPop && e10[t] > e20[t] && L[id][t] <= e10[t] * 1.005 && cl[t] >= e20[t]) {
      xbackUsed = lastPop; if (t >= START) trade(t, 'XBACK', vm);
    }
  }
}
function account(ts: Tr[], from: number, to: number, seed?: number) {
  let rnd = seed ?? 1; const rand = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
  let cash = 1e5; const pos: { t: Tr; sh: number }[] = []; let eq = 1e5, peak = 1e5, dd = 0;
  const byDay = new Map<number, Tr[]>(); for (const t of ts) if (t.e >= from && t.e <= to) (byDay.get(t.e) ?? byDay.set(t.e, []).get(t.e)!).push(t);
  const last = (id: number, s: number) => { let k = s; while (k > 0 && Number.isNaN(C[id][k])) k--; return C[id][k]; };
  for (let s = from; s <= to; s++) {
    for (let i = pos.length - 1; i >= 0; i--) if (pos[i].t.x <= s) { cash += pos[i].sh * pos[i].t.px * 0.999; pos.splice(i, 1); }
    const equity = cash + pos.reduce((a, p) => a + p.sh * last(p.t.id, s), 0);
    const today = byDay.get(s) ?? [];
    const order = seed == null ? today.slice().sort((a, b) => b.vm - a.vm) : today.map(x => [rand(), x] as const).sort((a, b) => a[0] - b[0]).map(x => x[1]);
    for (const t of order) { if (pos.length >= 20 || pos.some(p => p.t.id === t.id)) continue; const amt = Math.min(cash, equity / 20); if (amt < 0.02 * equity) continue; pos.push({ t, sh: amt / (t.fill * 1.001) }); cash -= amt; }
    eq = cash + pos.reduce((a, p) => a + p.sh * last(p.t.id, s), 0); peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak);
  }
  return { ret: eq / 1e5 - 1, dd };
}
const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
const k$ = (r: number) => `$${(100 * (1 + r)).toFixed(0)}k`;
const HALF: [string, number, number][] = [['2016-20', START, MID - 1], ['2021-26', MID, N - 1]];
const qq = (a: number, b: number) => C[qId][b] / C[qId][a] - 1;
console.log(`QQQ held: ${HALF.map(([h, a, b]) => `${h} ${k$(qq(a, b))}`).join(', ')}`);
const verdicts: string[] = [];
for (const kind of ['POP', 'XBACK'] as const) for (const gate of [false, true]) {
  const ts = trades.filter(t => t.kind === kind && (!gate || t.gated));
  let pass = true;
  console.log(`\n${kind === 'POP' ? 'WEDGE POP' : 'EMA CROSSBACK'}${gate ? ' (QQQ > 200-day, control)' : ''}`);
  for (const [h, a, b] of HALF) {
    const hs = ts.filter(t => t.e >= a && t.e <= b), acc = account(ts, a, b);
    const rmed = Array.from({ length: 50 }, (_, i) => account(ts, a, b, 11 + i).ret).sort((x, y) => x - y)[25];
    if (!(acc.ret > qq(a, b) && rmed > qq(a, b) && mean(hs.map(t => t.ex)) > 0)) pass = false;
    console.log(`  ${h}: n ${hs.length} | avg ${pct(mean(hs.map(t => t.ret)))} | win ${(100 * mean(hs.map(t => +(t.ret > 0)))).toFixed(0)}% | +50%+ ${hs.filter(t => t.ret >= 0.5).length} | vs QQQ ${pct(mean(hs.map(t => t.ex)))} | ${k$(acc.ret)} (dd -${(100 * acc.dd).toFixed(0)}%) random ${k$(rmed)} | held ${mean(hs.map(t => t.x - t.e)).toFixed(0)} days`);
  }
  if (!gate) verdicts.push(`${kind} ${pass ? 'PASS' : 'fail'}`);
}
console.log(`\n→ ${verdicts.join(', ')}`);

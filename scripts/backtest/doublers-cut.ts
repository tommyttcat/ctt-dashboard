// scripts/backtest/doublers-cut.ts — the doubler pile (ten-week-line.ts part 1: doubles again
// 2-3x the base rate, but halves 3x as often) traded with "cut losers fast, let winners run".
//
//   LONG=1 NODE_OPTIONS=--max-old-space-size=12288 npx tsx scripts/backtest/doublers-cut.ts
//
// RULES — fixed 10 Oct 2026, before the first run. 2016-2026.
//   Pile at each week's last session t: CS/ADRC, real close >= $2, 20-session $ volume >= $20M,
//     close / close 252 sessions ago >= 2.
//   Entry: next session's open. Order when slots are short: highest 12-month return first.
//   PRIMARY exit: stop 8% under the entry (low touches it → out at min(open, stop)); once a
//     close is 20%+ above entry, out at the first close below the 50-day SMA (10-week line);
//     max 252 sessions. 0.2% round trip.
//   Account: $100k, 20 slots of 5% of equity, one position per name, re-entry allowed after
//     an exit. Idle cash earns nothing.
//   Controls (reported, not graded): stop 5 / 10 / 15 / none; QQQ-above-200-day gate.
//   PASS: the account beats QQQ held in BOTH halves (2016-20, 2021-26), AND the median of 50
//     random entry orders does too.

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
const dow = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay();
const weekEnd = (t: number) => t + 1 < N && dow(sessions[t + 1]) <= dow(sessions[t]);
const q200 = (t: number) => { let s = 0; for (let j = t - 199; j <= t; j++) s += C[qId][j]; return C[qId][t] > s / 200; };

type Sig = { id: number; t: number; r12: number; gated: boolean };
const sigs: Sig[] = [];
const sma50: Float64Array[] = [];
for (let id = 0; id < syms.length; id++) {
  const cl = C[id]; const sma = new Float64Array(N).fill(NaN);
  { let s = 0, cnt = 0; for (let j = 0; j < N; j++) { if (Number.isNaN(cl[j])) { s = 0; cnt = 0; continue; } s += cl[j]; cnt++; if (cnt > 50) { s -= cl[j - 50]; cnt = 50; } if (cnt === 50) sma[j] = s / 50; } }
  sma50[id] = sma;
  for (let t = START; t < N - 1; t++) {
    if (!weekEnd(t) || Number.isNaN(cl[t]) || Number.isNaN(cl[t - 252]) || !(RC[id][t] >= 2) || Number.isNaN(O[id][t + 1])) continue;
    const r12 = cl[t] / cl[t - 252] - 1; if (!(r12 >= 1)) continue;
    let dv = 0, ok = true; for (let j = t - 19; j <= t; j++) { if (Number.isNaN(cl[j])) { ok = false; break; } dv += cl[j] * V[id][j]; }
    if (!ok || !(dv / 20 >= 20e6) || !isStock(syms[id], sessions[t])) continue;
    sigs.push({ id, t, r12, gated: q200(t) });
  }
}
/** Exit for an entry at session e (open) with stop fraction s (null = none). */
function exitOf(id: number, e: number, stop: number | null): [number, number] {
  const fill = O[id][e], st = stop == null ? -Infinity : fill * (1 - stop), cl = C[id], sma = sma50[id];
  let armed = false;
  for (let k = e; k < N && k <= e + 252; k++) {
    if (Number.isNaN(cl[k])) continue;
    if (L[id][k] <= st) return [k, Math.min(k === e ? fill : O[id][k], st)];
    if (cl[k] >= fill * 1.2) armed = true;
    if (armed && cl[k] < sma[k]) return [k, cl[k]];
    if (k === e + 252) return [k, cl[k]];
  }
  let k = N - 1; while (Number.isNaN(cl[k])) k--; return [k, cl[k]];
}
function account(stop: number | null, gate: boolean, from: number, to: number, seed?: number) {
  let rnd = seed ?? 1; const rand = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
  const byDay = new Map<number, Sig[]>(); for (const s of sigs) if (s.t >= from && s.t < to && (!gate || s.gated)) (byDay.get(s.t) ?? byDay.set(s.t, []).get(s.t)!).push(s);
  let cash = 1e5, eq = 1e5, peak = 1e5, dd = 0, n = 0, wins = 0, big = 0, sumRet = 0;
  const pos: { id: number; sh: number; x: number; px: number; fill: number }[] = [];
  const last = (id: number, s: number) => { let k = s; while (k > 0 && Number.isNaN(C[id][k])) k--; return C[id][k]; };
  for (let s = from; s <= to; s++) {
    for (let i = pos.length - 1; i >= 0; i--) if (pos[i].x <= s) { const p = pos[i]; cash += p.sh * p.px * 0.999; const r = p.px / p.fill - 1 - 0.002; n++; sumRet += r; if (r > 0) wins++; if (r >= 1) big++; pos.splice(i, 1); }
    const today = byDay.get(s - 1);
    if (today && s <= to) {
      const order = seed == null ? today.slice().sort((a, b) => b.r12 - a.r12) : today.map(x => [rand(), x] as const).sort((a, b) => a[0] - b[0]).map(x => x[1]);
      const equity = cash + pos.reduce((a, p) => a + p.sh * last(p.id, s - 1), 0);
      for (const sg of order) {
        if (pos.length >= 20) break; if (pos.some(p => p.id === sg.id)) continue;
        const amt = Math.min(cash, 0.05 * equity); if (amt < 0.02 * equity) break;
        const fill = O[sg.id][s]; const [x, px] = exitOf(sg.id, s, stop);
        if (x === s) { cash -= amt; cash += (amt / (fill * 1.001)) * px * 0.999; const r = px / fill - 1 - 0.002; n++; sumRet += r; if (r > 0) wins++; continue; }
        pos.push({ id: sg.id, sh: amt / (fill * 1.001), x, px, fill }); cash -= amt;
      }
    }
    eq = cash + pos.reduce((a, p) => a + p.sh * last(p.id, s), 0); peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak);
  }
  return { ret: eq / 1e5 - 1, dd, n, win: wins / Math.max(1, n), avg: sumRet / Math.max(1, n), big };
}
const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%`;
const HALF: [string, number, number][] = [['2016-20', START, MID - 1], ['2021-26', MID, N - 1]];
const qq = (a: number, b: number) => C[qId][b] / C[qId][a] - 1;
console.log(`pile signals ${sigs.length} | QQQ held: $100k → 2016-20 $${(100 * (1 + qq(START, MID - 1))).toFixed(0)}k, 2021-26 $${(100 * (1 + qq(MID, N - 1))).toFixed(0)}k`);
let pass = false;
for (const [lab, stop, gate, graded] of [
  ['PRIMARY stop 8%', 0.08, false, true], ['stop 5%', 0.05, false, false], ['stop 10%', 0.10, false, false],
  ['stop 15%', 0.15, false, false], ['no stop', null, false, false], ['stop 8% + QQQ>200d', 0.08, true, false],
] as const) {
  const parts = HALF.map(([h, a, b]) => { const r = account(stop, gate, a, b); const rs = Array.from({ length: 50 }, (_, i) => account(stop, gate, a, b, 11 + i).ret).sort((x, y) => x - y); return { h, r, rmed: rs[25], q: qq(a, b) }; });
  const ok = parts.every(p => p.r.ret > p.q && p.rmed > p.q); if (graded) pass = ok;
  console.log(`\n${lab}${graded ? '' : ' (control)'}`);
  for (const p of parts) console.log(`  ${p.h}: $100k → $${(100 * (1 + p.r.ret)).toFixed(0)}k (dd -${(100 * p.r.dd).toFixed(0)}%) | random-order median $${(100 * (1 + p.rmed)).toFixed(0)}k | trades ${p.r.n}, win ${(100 * p.r.win).toFixed(0)}%, avg ${pct(p.r.avg)}, +100%+ ${p.r.big}`);
}
console.log(`\n→ ${pass ? 'PASS' : 'fail'}`);

// scripts/backtest/rules8.ts — the user's 8 swing rules as a system, 2016-2026 (daily).
//
//   LONG=1 NODE_OPTIONS=--max-old-space-size=8192 npx tsx scripts/backtest/rules8.ts
//
// The rules (shared 10 Oct 2026): 1 prior move 40%+ on strong volume; 2 tight
// base, pullback under 20%; 3 find on the daily, enter on the 15-min opening
// range break; 4 start at 25%, add in steps; 5 book some at the first 12-15%;
// 6 trail a moving average; 7 index veto below its 10 and 20; 8 sell when 40%+
// extended above the base.
//
// RULES — fixed 10 Oct 2026, before the first run. Daily bars (no minute history
// before 2021, so rule 3 is approximated — see ENTRY).
//   Universe: CS/ADRC, real close >= $2, 20-session $ volume >= $20M.
//   R1 PRIOR MOVE at the base start h: within the 60 sessions before h, the
//      highest high (= the base high, at h) is 40%+ above the lowest low before
//      it, and average volume from that low to h is >= 1.25x the 50-session
//      average volume before that low.
//   R2 BASE: h is 5..40 sessions before today; the lowest low since h is within
//      20% of the base high; today's close is still within 20% of it.
//      (h = the highest high of the last 60 sessions, if it is at least 5
//      sessions old.)
//   R7 VETO: no NEW entry when QQQ's prior close was below both its SMA10 and SMA20.
//   ENTRY (rule-3 proxy): buy stop at the highest high of the 5 sessions before
//      the entry day, inside the base; fills if the entry day's high exceeds it,
//      at max(trigger, open). Stop = the prior day's low (stands in for the
//      opening-range low). Skipped if the fill is more than 1 ATR above the
//      prior close or the stop is more than 1.5 ATR below the fill.
//   R4 SIZE: a full position = 20% of equity at the first entry. Buy 25% of it at
//      entry; add 25% at +3%, +6%, +9% above the fill (if touched, at that price
//      or the open if it gaps over), never after the first trim.
//   R5 BOOK: at +12% above the fill, sell a third of what is held.
//   R6 TRAIL: from session 2, all out at the first close below the SMA (10, or 20
//      in variant B). The initial stop stays under everything until then.
//   R8 40% LINE: all out at +40% above the base high (limit; open if gapped over).
//   Max 120 sessions. 0.1% a side. One position per name. Account: $100k, no
//   margin, equity marked daily; same-day signals in order of the prior move size.
//   Halves: 2016-2020, 2021-2026.
//   PASS: account beats QQQ held in BOTH halves, AND the average trade (return on
//     the money it used) is above 0 in both halves.

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
const COST = 0.001;
const smaQ = (t: number, n: number) => { let s = 0; for (let j = t - n + 1; j <= t; j++) s += C[qId][j]; return s / n; };
const veto = (t: number) => C[qId][t] < smaQ(t, 10) && C[qId][t] < smaQ(t, 20);

type Leg = [number, number, number];          // [session, fraction of a full position (+buy / -sell, of FULL), price]
type Trade = { id: number; e: number; legs: Leg[]; key: number; ret: number; q: number; last: number };

function simulate(maN: number): Trade[] {
  const out: Trade[] = [];
  for (let id = 0; id < syms.length; id++) {
    const cl = C[id];
    const sma = (t: number, n: number) => { let s = 0; for (let j = t - n + 1; j <= t; j++) s += cl[j]; return s / n; };
    let busy = -1;
    for (let e = 320; e < N - 1; e++) {
      if (e <= busy) continue;
      const t = e - 1;
      if (Number.isNaN(cl[t]) || Number.isNaN(O[id][e]) || !(RC[id][t] >= 2)) continue;
      let ok = true; for (let j = t - 260; j <= t; j++) if (Number.isNaN(cl[j])) { ok = false; break; }
      if (!ok) continue;
      let dv = 0; for (let j = t - 19; j <= t; j++) dv += cl[j] * V[id][j];
      if (!(dv / 20 >= 20e6)) continue;
      // R2: base high h
      let h = t, hiv = -Infinity; for (let j = t - 59; j <= t; j++) if (H[id][j] >= hiv) { hiv = H[id][j]; h = j; }
      if (t - h < 5 || t - h > 40) continue;
      let lo = Infinity; for (let j = h; j <= t; j++) lo = Math.min(lo, L[id][j]);
      if (lo < hiv * 0.8 || cl[t] < hiv * 0.8) continue;
      // R1: prior move into h
      let low = Infinity, lowAt = h; for (let j = h - 60; j < h; j++) if (L[id][j] < low) { low = L[id][j]; lowAt = j; }
      if (!(hiv >= low * 1.4)) continue;
      let vRun = 0; for (let j = lowAt; j <= h; j++) vRun += V[id][j]; vRun /= (h - lowAt + 1);
      let vPre = 0; for (let j = lowAt - 50; j < lowAt; j++) vPre += V[id][j]; vPre /= 50;
      if (!(vRun >= 1.25 * vPre)) continue;
      if (veto(t)) continue;
      if (!isStock(syms[id], sessions[t])) continue;
      // ENTRY
      let trig = -Infinity; for (let j = t - 4; j <= t; j++) trig = Math.max(trig, H[id][j]);
      if (!(H[id][e] > trig)) continue;
      const fill = Math.max(trig, O[id][e]);
      let atr = 0; for (let j = t - 13; j <= t; j++) atr += Math.max(H[id][j], cl[j - 1]) - Math.min(L[id][j], cl[j - 1]); atr /= 14;
      const stop0 = L[id][t];
      if (fill - cl[t] > atr || fill - stop0 > 1.5 * atr || !(fill > stop0)) continue;
      const legs: Leg[] = [[e, 0.25, fill]];
      let held = 0.25, trimmed = false, stop = stop0, exitDay = -1;
      const addAt = [1.03, 1.06, 1.09].map(x => fill * x); let adds = 0;
      const line40 = hiv * 1.4, book = fill * 1.12;
      // entry day: adds can trigger the same day only above the fill (use the high); no stop check on day 1 except a close below the stop
      for (let s = e; s < N && held > 1e-9; s++) {
        if (Number.isNaN(cl[s])) continue;
        const day = s - e + 1;
        if (s > e && O[id][s] <= stop) { legs.push([s, -held, O[id][s]]); held = 0; exitDay = s; break; }
        if (s > e && L[id][s] <= stop) { legs.push([s, -held, stop]); held = 0; exitDay = s; break; }
        while (!trimmed && adds < 3 && H[id][s] >= addAt[adds]) { const px = s > e ? Math.max(addAt[adds], O[id][s]) : addAt[adds]; legs.push([s, 0.25, px]); held += 0.25; adds++; }
        if (H[id][s] >= line40) { legs.push([s, -held, Math.max(line40, s > e ? O[id][s] : line40)]); held = 0; exitDay = s; break; }
        if (!trimmed && H[id][s] >= book) { const q = held / 3; legs.push([s, -q, Math.max(book, s > e ? O[id][s] : book)]); held -= q; trimmed = true; }
        if (s === e && cl[s] < stop) { legs.push([s, -held, cl[s]]); held = 0; exitDay = s; break; }
        if (day >= 2 && cl[s] < sma(s, maN)) { legs.push([s, -held, cl[s]]); held = 0; exitDay = s; break; }
        if (day >= 120) { legs.push([s, -held, cl[s]]); held = 0; exitDay = s; break; }
      }
      if (held > 1e-9) { let s = N - 1; while (Number.isNaN(cl[s])) s--; legs.push([s, -held, cl[s]]); exitDay = s; }
      const bought = legs.filter(l => l[1] > 0).reduce((a, l) => a + l[1] * l[2] * (1 + COST), 0);
      const sold = legs.filter(l => l[1] < 0).reduce((a, l) => a - l[1] * l[2] * (1 - COST), 0);
      // returns per unit of FULL notional at the first fill: shares bought = fraction / fill-at-first... use money: invested = sum(frac * px) relative to fill
      const units = legs.filter(l => l[1] > 0).reduce((a, l) => a + l[1], 0);
      const ret = (sold - bought) / (units * fill);
      out.push({ id, e, legs, key: hiv / low, ret, q: C[qId][exitDay] / O[qId][e] - 1, last: exitDay });
      busy = exitDay;
    }
  }
  return out.sort((a, b) => a.e - b.e);
}

function account(trades: Trade[], from: number, to: number) {
  let cash = 1e5; const pos: { t: Trade; sh: number; full: number; li: number }[] = [];
  let peak = 1e5, dd = 0, eq = 1e5;
  const byDay = new Map<number, Trade[]>(); for (const t of trades) if (t.e >= from && t.e <= to) (byDay.get(t.e) ?? byDay.set(t.e, []).get(t.e)!).push(t);
  const mark = (s: number) => cash + pos.reduce((a, p) => { let k = s; while (k > 0 && Number.isNaN(C[p.t.id][k])) k--; return a + p.sh * C[p.t.id][k]; }, 0);
  for (let s = from; s <= to; s++) {
    for (const t of (byDay.get(s) ?? []).sort((a, b) => b.key - a.key)) { const full = 0.2 * mark(s - 1); if (full / 4 > cash) continue; pos.push({ t, sh: 0, full, li: 0 }); }
    for (const p of pos) {
      while (p.li < p.t.legs.length && p.t.legs[p.li][0] === s) {
        const [, f, px] = p.t.legs[p.li]; p.li++;
        if (f > 0) { const amt = Math.min(cash, f * p.full); const sh = amt / (px * (1 + COST)); p.sh += sh; cash -= amt; }
        else { const frac = Math.min(1, -f / Math.max(1e-9, p.t.legs.slice(0, p.li - 1).reduce((a, l) => a + l[1], 0))); const sh = p.sh * frac; p.sh -= sh; cash += sh * px * (1 - COST); }
      }
    }
    for (let i = pos.length - 1; i >= 0; i--) if (pos[i].li >= pos[i].t.legs.length) { cash += pos[i].sh * C[pos[i].t.id][s] * 0; pos.splice(i, 1); }
    eq = mark(s); peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak);
  }
  return { ret: eq / 1e5 - 1, dd };
}

const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
const idx = (d: string) => { const i = sessions.findIndex(x => x >= d); return i < 0 ? N : i; };
const H1: [number, number] = [idx('2016-01-01'), idx('2021-01-01') - 1], H2: [number, number] = [idx('2021-01-01'), N - 1];
const qqq = (a: number, b: number) => C[qId][b] / O[qId][a] - 1;
for (const [name, maN] of [['A trail SMA10', 10], ['B trail SMA20', 20]] as const) {
  const ts = simulate(maN);
  console.log(`\n${name}: ${ts.length} trades`);
  console.log(`  year   n    avg/trade  win%  avg win  avg loss  hit +40% line  account | QQQ`);
  for (const y of [...new Set(ts.map(t => sessions[t.e].slice(0, 4)))].sort()) {
    const a = idx(`${y}-01-01`), b = Math.min(N, idx(`${+y + 1}-01-01`)) - 1; if (a < H1[0]) continue;
    const yt = ts.filter(t => t.e >= a && t.e <= b); const w = yt.filter(t => t.ret > 0), l = yt.filter(t => t.ret <= 0);
    const acc = account(ts, a, b);
    const hit40 = yt.filter(t => t.legs.some(g => g[1] < 0 && g[2] >= (t.legs[0][2] * 1.3))).length;
    console.log(`  ${y} ${String(yt.length).padStart(4)}  ${pct(mean(yt.map(t => t.ret))).padStart(7)}  ${(100 * w.length / Math.max(1, yt.length)).toFixed(0).padStart(4)}%  ${pct(mean(w.map(t => t.ret))).padStart(7)}  ${pct(mean(l.map(t => t.ret))).padStart(7)}  ${String(hit40).padStart(5)}        ${pct(acc.ret).padStart(7)} dd ${pct(-acc.dd)} | ${pct(qqq(a, b))}`);
  }
  const res = [H1, H2].map(([a, b]) => ({ acc: account(ts, a, b), avg: mean(ts.filter(t => t.e >= a && t.e <= b).map(t => t.ret)), q: qqq(a, b) }));
  console.log(`  halves: 2016-20 account ${pct(res[0].acc.ret)} (dd ${pct(-res[0].acc.dd)}) avg ${pct(res[0].avg)} vs QQQ ${pct(res[0].q)} | 2021-26 account ${pct(res[1].acc.ret)} (dd ${pct(-res[1].acc.dd)}) avg ${pct(res[1].avg)} vs QQQ ${pct(res[1].q)}`);
  console.log(`  → ${res.every(r => r.acc.ret > r.q && r.avg > 0) ? 'PASS' : 'fail'}`);
}

// scripts/backtest/regime-select.ts — do breakouts work when breakouts are working? And only the best ones?
//
//   npx tsx scripts/backtest/regime-select.ts
//
// Two things breakout traders do that every earlier test left out:
//   (1) a breakout follow-through switch — trade only when recent breakouts
//       across the market are actually following through, and
//   (2) selectivity — take only the best few, not every signal.
//
// RULES — fixed 9 Oct 2026, before the first run.
//   Universe: CS/ADRC, close >= $5, 20-session $ volume >= $20M, 260+ sessions.
//   Breakout on day t: close above the highest close of the prior 20 sessions,
//     volume >= 1.5x its prior 20-session average, close above SMA50.
//   Trade: buy the next open. Two exits, no hard stop (tight stops failed in
//     every earlier test): H20 = close of the 20th session; T10 = the first
//     close below SMA10 (max 60 sessions). Outcome = return minus QQQ over the
//     same window, minus 0.2% costs ("excess").
//   (1) FOLLOW-THROUGH: FT(t) = the share of breakouts signalled in sessions
//     t-25..t-6 whose close 5 sessions later was 3%+ above the signal close
//     (all known by t). ON when FT(t) is at or above its own median over the
//     prior 250 sessions; OFF otherwise. Also printed: the QQQ-above-200-day gate.
//   (2) SELECTIVE: among ON-day breakouts each day, rank by the sum of two
//     ranks that held up earlier — 12-1 momentum (higher better) and
//     smoothness (frog-in-the-pan, lower better) — and keep the top 10%
//     (at least 1 a day).
//   PASS (1): ON-day breakouts beat OFF-day breakouts by 1.0+ point (H20
//     excess) in BOTH halves (split 2024-09-30) AND ON-day excess > 0 in both.
//   PASS (2): selective beats all ON-day breakouts by 1.0+ point (H20 excess)
//     in both halves AND selective excess > 0 in both.
//   T10 is printed alongside; the verdicts use H20.

import { loadAdjusted } from './cache';
import { loadReference, refAt } from './reference';

const c = loadAdjusted();
const ref = loadReference();
const { sessions, syms, O, H, L, C, V } = c;
const N = sessions.length;
const qId = c.idOf.get('QQQ')!;
const iSplit = sessions.findIndex(d => d > '2024-09-30');
const COST = 0.002;
void H; void L;
const typeOk = new Map<string, boolean>();
const isStock = (sym: string, date: string) => {
  const k = `${sym}|${date.slice(0, 4)}`;
  if (!typeOk.has(k)) { const t = (refAt(ref, sym, date)?.type || '').toUpperCase(); typeOk.set(k, t === 'CS' || t === 'ADRC'); }
  return typeOk.get(k)!;
};
const qSma = (t: number) => { let s = 0; for (let j = t - 199; j <= t; j++) s += C[qId][j]; return s / 200; };

type B = { id: number; t: number; ft5: boolean | null; h20: number | null; t10: number | null; mom: number; fip: number };
const bk: B[] = [];
for (let id = 0; id < syms.length; id++) {
  const cl = C[id];
  for (let t = 260; t + 1 < N; t++) {
    if (!(cl[t] >= 5) || Number.isNaN(O[id][t + 1])) continue;
    let ok = true, mx = -Infinity, vs = 0, dv = 0, s50 = 0;
    for (let j = t - 252; j <= t; j++) if (Number.isNaN(cl[j])) { ok = false; break; }
    if (!ok) continue;
    for (let j = t - 20; j < t; j++) { mx = Math.max(mx, cl[j]); vs += V[id][j]; }
    if (!(cl[t] > mx)) continue;
    if (!(V[id][t] >= 1.5 * vs / 20)) continue;
    for (let j = t - 19; j <= t; j++) dv += cl[j] * V[id][j];
    if (!(dv / 20 >= 20e6)) continue;
    for (let j = t - 49; j <= t; j++) s50 += cl[j];
    if (!(cl[t] > s50 / 50)) continue;
    if (!isStock(syms[id], sessions[t])) continue;
    const e = t + 1, fill = O[id][e];
    const qRet = (k: number) => C[qId][k] / O[qId][e] - 1;
    let h20: number | null = null, t10: number | null = null;
    if (e + 19 < N) { let k = e + 19; while (k > e && Number.isNaN(cl[k])) k--; h20 = cl[k] / fill - 1 - COST - qRet(e + 19); }
    for (let k = e; k < N && k <= e + 59; k++) {
      if (Number.isNaN(cl[k]) || k < e + 1) continue;
      let s10 = 0, n10 = 0; for (let j = k - 9; j <= k; j++) if (!Number.isNaN(cl[j])) { s10 += cl[j]; n10++; }
      if (cl[k] < s10 / n10 || k === e + 59) { t10 = cl[k] / fill - 1 - COST - qRet(k); break; }
    }
    const ft5 = t + 5 < N && !Number.isNaN(cl[t + 5]) ? cl[t + 5] >= cl[t] * 1.03 : null;
    let up = 0, dn = 0; for (let j = t - 251; j <= t; j++) { const r = cl[j] / cl[j - 1] - 1; if (r > 0) up++; else if (r < 0) dn++; }
    const ret = cl[t] / cl[t - 252] - 1;
    bk.push({ id, t, ft5, h20, t10, mom: cl[t - 21] / cl[t - 252] - 1, fip: Math.sign(ret) * (dn - up) / 252 });
  }
}
// FT(t) and its trailing median
const byT = new Map<number, B[]>();
for (const b of bk) (byT.get(b.t) ?? byT.set(b.t, []).get(b.t)!).push(b);
const FT = new Float64Array(N).fill(NaN);
for (let t = 290; t < N; t++) {
  let n = 0, y = 0;
  for (let s = t - 25; s <= t - 6; s++) for (const b of byT.get(s) ?? []) if (b.ft5 != null) { n++; if (b.ft5) y++; }
  if (n >= 20) FT[t] = y / n;
}
const ON = new Array<boolean | null>(N).fill(null);
for (let t = 540; t < N; t++) {
  if (Number.isNaN(FT[t])) continue;
  const w: number[] = []; for (let s = t - 250; s < t; s++) if (!Number.isNaN(FT[s])) w.push(FT[s]);
  if (w.length < 100) continue;
  w.sort((a, b) => a - b);
  ON[t] = FT[t] >= w[w.length >> 1];
}
const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const stat = (xs: B[]) => [0, 1].map(h => { const s = xs.filter(b => (b.t < iSplit ? 0 : 1) === h); return { h20: mean(s.filter(b => b.h20 != null).map(b => b.h20!)), t10: mean(s.filter(b => b.t10 != null).map(b => b.t10!)), n: s.length }; });
const line = (name: string, xs: B[]) => { const st = stat(xs); console.log(`  ${name.padEnd(34)} ${st.map((s, h) => `${h ? '2nd' : '1st'} H20 ${pct(s.h20).padStart(7)} T10 ${pct(s.t10).padStart(7)} n ${String(s.n).padStart(6)}`).join(' | ')}`); return st; };

const usable = bk.filter(b => ON[b.t] != null);
console.log(`breakouts ${bk.length}; with a switch reading ${usable.length} (${sessions[540]} →); split 2024-09-30. Excess vs QQQ after costs.`);
const onS = usable.filter(b => ON[b.t]), offS = usable.filter(b => !ON[b.t]);
line('all breakouts', usable);
const a = line('switch ON', onS);
const b = line('switch OFF', offS);
line('QQQ above 200-day', usable.filter(x => C[qId][x.t] > qSma(x.t)));
line('ON and QQQ above 200-day', onS.filter(x => C[qId][x.t] > qSma(x.t)));
const pass1 = [0, 1].every(h => a[h].h20 - b[h].h20 >= 0.01 && a[h].h20 > 0);
console.log(`  → (1) follow-through switch: ${pass1 ? 'PASS' : 'fail'} (ON − OFF H20: ${pct(a[0].h20 - b[0].h20)} / ${pct(a[1].h20 - b[1].h20)})`);

// (2) selective within ON days
const sel: B[] = [];
const onByT = new Map<number, B[]>();
for (const x of onS) (onByT.get(x.t) ?? onByT.set(x.t, []).get(x.t)!).push(x);
for (const xs of onByT.values()) {
  const rm = new Map(xs.slice().sort((p, q) => q.mom - p.mom).map((x, i) => [x, i]));
  const rf = new Map(xs.slice().sort((p, q) => p.fip - q.fip).map((x, i) => [x, i]));
  const ranked = xs.slice().sort((p, q) => (rm.get(p)! + rf.get(p)!) - (rm.get(q)! + rf.get(q)!));
  sel.push(...ranked.slice(0, Math.max(1, Math.round(xs.length * 0.1))));
}
const s2 = line('selective top 10% (ON days)', sel);
const pass2 = [0, 1].every(h => s2[h].h20 - a[h].h20 >= 0.01 && s2[h].h20 > 0);
console.log(`  → (2) selectivity: ${pass2 ? 'PASS' : 'fail'} (selective − all ON H20: ${pct(s2[0].h20 - a[0].h20)} / ${pct(s2[1].h20 - a[1].h20)})`);

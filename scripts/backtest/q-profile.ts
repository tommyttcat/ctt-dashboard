// scripts/backtest/q-profile.ts — (A) a screen built from Qullamaggie's picks, tested after his log ends;
// (B) his own picks with a let-it-run exit.
//
//   LONG=1 NODE_OPTIONS=--max-old-space-size=12288 npx tsx scripts/backtest/q-profile.ts
//
// kq-db.ts showed his entries looked nothing like our KQ rules (3% overlap):
// far more liquid, deeper and older pullbacks, near the 20-day, not extended,
// entered on quiet days. His log ends in 2022, so Sep 2022 - Sep 2026 is data
// the profile never saw.
//
// RULES — fixed 10 Oct 2026, before the first run.
//   (A) Q-PROFILE, judged at the close of day t, bought at that close:
//     CS/ADRC; real close >= $2; 20-session $ volume >= $100M;
//     6-month return percentile among liquid names ($20M+) >= 0.80, 1-month
//     percentile 0.40..0.90; off the 60-session high by 8-25%, the high 8-30
//     sessions ago; close vs SMA20 -2%..+8%; close vs SMA50 0..+20%;
//     day change -1%..+4% and gap (open vs prior close) < 2%;
//     QQQ above its 200-day. One signal per name per 20 sessions.
//     Window: 2022-09-01 .. end (out of sample). Halves split 2024-07-01.
//     Outcome H20 = 20-session close, minus QQQ, minus 0.2%. Baseline = every
//     liquid stock-day's H20 (sampled 1 in 10) in the same window.
//     PASS: H20 excess > 0 AND >= baseline + 1.0 point in BOTH halves.
//     Also printed: the profile on 2019-2022 (in sample — it was fitted there).
//   (B) HIS PICKS (kq-db.ts usable stock entries, 2019-2022), bought at the
//     entry day's close. RUN exit: stop 15% below the fill until the close is
//     20%+ above it; from then, out at the first close below SMA20; max 250
//     sessions. Compared with H20 and T10 (kq-db.ts). No pass bar: this shows
//     how much the exit matters for the same picks.

import fs from 'node:fs';
import path from 'node:path';
import { DATA, loadAdjusted, listSessions, readDay } from './cache';
import { loadReference, refAt } from './reference';

const c = loadAdjusted();
const ref = loadReference();
const { sessions, syms, O, H, L, C, V } = c;
const N = sessions.length;
const qId = c.idOf.get('QQQ')!;
const sIdx = new Map(sessions.map((d, i) => [d, i]));
const RC: Float32Array[] = syms.map(() => new Float32Array(N).fill(NaN));
{ if (listSessions().length !== N) throw new Error('session mismatch');
  for (let s = 0; s < N; s++) for (const r of readDay('unadj', sessions[s])) { const id = c.idOf.get(r[0]); if (id != null) RC[id][s] = r[4]; } }
const typeOk = new Map<string, boolean>();
const isStock = (sym: string, date: string) => { const k = `${sym}|${date.slice(0, 4)}`; if (!typeOk.has(k)) { const t = (refAt(ref, sym, date)?.type || '').toUpperCase(); typeOk.set(k, t === 'CS' || t === 'ADRC'); } return typeOk.get(k)!; };
const COST = 0.002;
const idx = (d: string) => { const i = sessions.findIndex(x => x >= d); return i < 0 ? N : i; };
const qS200 = (t: number) => { let s = 0; for (let j = t - 199; j <= t; j++) s += C[qId][j]; return s / 200; };
const sma = (id: number, t: number, n: number) => { let s = 0; for (let j = t - n + 1; j <= t; j++) s += C[id][j]; return s / n; };
const full = (id: number, t: number, n: number) => { for (let j = t - n; j <= t; j++) if (Number.isNaN(C[id][j])) return false; return true; };
const dvol = (id: number, t: number) => { let s = 0; for (let j = t - 19; j <= t; j++) s += C[id][j] * V[id][j]; return s / 20; };
const h20 = (id: number, t: number) => { if (t + 20 >= N) return NaN; let k = t + 20; while (k > t && Number.isNaN(C[id][k])) k--; return C[id][k] / C[id][t] - 1 - COST - (C[qId][t + 20] / C[qId][t] - 1); };

// percentiles of 1m and 6m return among liquid names, per day (computed lazily)
const pc = new Map<number, Map<number, [number, number]>>();
const pctOf = (t: number) => {
  if (pc.has(t)) return pc.get(t)!;
  const pool: { id: number; r1: number; r6: number }[] = [];
  for (let id = 0; id < syms.length; id++) { if (!(RC[id][t] >= 2) || !full(id, t, 130)) continue; if (!(dvol(id, t) >= 20e6)) continue; pool.push({ id, r1: C[id][t] / C[id][t - 21] - 1, r6: C[id][t] / C[id][t - 126] - 1 }); }
  const rank = (k: 'r1' | 'r6') => { const s = pool.map(p => p[k]).sort((a, b) => a - b); return (x: number) => { let lo = 0, hi = s.length; while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] < x) lo = m + 1; else hi = m; } return lo / s.length; }; };
  const r1 = rank('r1'), r6 = rank('r6');
  const m = new Map<number, [number, number]>(); for (const p of pool) m.set(p.id, [r1(p.r1), r6(p.r6)]);
  pc.set(t, m); return m;
};

function profile(from: number, to: number) {
  const sig: { t: number; x: number }[] = []; const base: { t: number; x: number }[] = [];
  const last = new Map<number, number>();
  for (let t = from; t <= to && t + 20 < N; t++) {
    if (!(C[qId][t] > qS200(t))) continue;
    const pm = pctOf(t);
    for (const [id, [p1, p6]] of pm) {
      if (t % 10 === id % 10) base.push({ t, x: h20(id, t) });
      if (!(dvol(id, t) >= 100e6) || !(p6 >= 0.8) || !(p1 >= 0.4 && p1 <= 0.9)) continue;
      let hi = -Infinity, hAt = t; for (let j = t - 59; j <= t; j++) if (H[id][j] >= hi) { hi = H[id][j]; hAt = j; }
      const off = 1 - C[id][t] / hi; if (off < 0.08 || off > 0.25 || t - hAt < 8 || t - hAt > 30) continue;
      const v20 = C[id][t] / sma(id, t, 20) - 1, v50 = C[id][t] / sma(id, t, 50) - 1;
      if (v20 < -0.02 || v20 > 0.08 || v50 < 0 || v50 > 0.2) continue;
      const chg = C[id][t] / C[id][t - 1] - 1, gap = O[id][t] / C[id][t - 1] - 1;
      if (chg < -0.01 || chg > 0.04 || !(gap < 0.02)) continue;
      if ((last.get(id) ?? -99) > t - 20) continue;
      if (!isStock(syms[id], sessions[t])) continue;
      last.set(id, t); sig.push({ t, x: h20(id, t) });
    }
  }
  return { sig: sig.filter(s => Number.isFinite(s.x)), base: base.filter(s => Number.isFinite(s.x)) };
}
const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`;
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;

console.log('(A) Q-PROFILE — 20-session excess vs QQQ, bought at the signal close');
const ins = profile(idx('2019-01-01'), idx('2022-09-01') - 1);
console.log(`  in sample 2019 - Aug 2022:  profile ${pct(mean(ins.sig.map(s => s.x)))} n ${ins.sig.length} | baseline ${pct(mean(ins.base.map(s => s.x)))}`);
const oos = profile(idx('2022-09-01'), N - 1), split = idx('2024-07-01');
const hv = [oos.sig.filter(s => s.t < split), oos.sig.filter(s => s.t >= split)], hb = [oos.base.filter(s => s.t < split), oos.base.filter(s => s.t >= split)];
const m = hv.map(x => mean(x.map(s => s.x))), b = hb.map(x => mean(x.map(s => s.x)));
console.log(`  OUT OF SAMPLE Sep 2022 - Jun 2024: profile ${pct(m[0])} n ${hv[0].length} | baseline ${pct(b[0])}`);
console.log(`  OUT OF SAMPLE Jul 2024 - Sep 2026: profile ${pct(m[1])} n ${hv[1].length} | baseline ${pct(b[1])}`);
console.log(`  beat QQQ: ${(100 * mean(oos.sig.map(s => +(s.x > 0)))).toFixed(0)}% of signals`);
console.log(`  → ${m.every((x, i) => x > 0 && x - b[i] >= 0.01) ? 'PASS' : 'fail'}`);

// (B) his picks, exits compared
const raw: { sym: string; date: string }[] = JSON.parse(fs.readFileSync(path.join(DATA, 'kq_db', 'entries.json'), 'utf8'));
const seen = new Map<string, number[]>();
const res: { run: number; h: number; t10: number; days: number; sym: string; d: string }[] = [];
for (const x of raw.sort((a, b) => (a.date < b.date ? -1 : 1))) {
  const id = c.idOf.get(x.sym), e = sIdx.get(x.date);
  if (id == null || e == null || Number.isNaN(C[id][e]) || x.date < '2019-01-01' || !isStock(x.sym, x.date) || !full(id, e - 1, 60)) continue;
  const p = seen.get(x.sym) ?? []; if (p.some(q => e - q <= 5 && e >= q)) continue; p.push(e); seen.set(x.sym, p);
  const fill = C[id][e]; let armed = false, out = NaN, outK = e;
  for (let k = e + 1; k < N && k <= e + 250; k++) {
    if (Number.isNaN(C[id][k])) continue;
    if (!armed && L[id][k] <= fill * 0.85) { out = Math.min(fill * 0.85, O[id][k]); outK = k; break; }
    if (!armed && C[id][k] >= fill * 1.2) armed = true;
    if (armed && C[id][k] < sma(id, k, 20)) { out = C[id][k]; outK = k; break; }
    if (k === e + 250 || k === N - 1) { out = C[id][k]; outK = k; break; }
  }
  if (!Number.isFinite(out)) continue;
  let t10 = NaN; for (let k = e + 1; k < N && k <= e + 60; k++) { if (Number.isNaN(C[id][k])) continue; if (C[id][k] < sma(id, k, 10) || k === e + 60) { t10 = C[id][k] / fill - 1 - COST; break; } }
  res.push({ run: out / fill - 1 - COST, h: h20(id, e) + (C[qId][Math.min(N - 1, e + 20)] / C[qId][e] - 1), t10, days: outK - e, sym: x.sym, d: x.date });
}
const ok = res.filter(r => Number.isFinite(r.t10) && Number.isFinite(r.h));
const show = (nm: string, xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); console.log(`  ${nm.padEnd(30)} avg ${pct(mean(xs)).padStart(8)}  median ${pct(s[s.length >> 1]).padStart(7)}  win ${(100 * mean(xs.map(v => +(v > 0)))).toFixed(0)}%  +100%+ ${xs.filter(v => v >= 1).length}  worst ${pct(s[0])}`); };
console.log(`\n(B) HIS PICKS 2019-2022, ${ok.length} stock entries, bought at the entry-day close (raw % return, not vs QQQ)`);
show('hold 20 sessions', ok.map(r => r.h));
show('trail SMA10 (kq-db.ts T10)', ok.map(r => r.t10));
show('RUN: 15% stop, SMA20 after +20%', ok.map(r => r.run));
console.log(`  RUN holding days: median ${ok.map(r => r.days).sort((a, b) => a - b)[ok.length >> 1]}`);
console.log('  biggest RUN trades:', ok.slice().sort((a, b) => b.run - a.run).slice(0, 10).map(r => `${r.sym} ${r.d} ${pct(r.run)} in ${r.days}d`).join(' | '));
const all = ok.map(r => r.run).sort((a, b) => b - a), tot = all.reduce((a, b) => a + b, 0);
console.log(`  share of total RUN profit from the best 10% of trades: ${(100 * all.slice(0, Math.round(all.length / 10)).reduce((a, b) => a + b, 0) / tot).toFixed(0)}%`);

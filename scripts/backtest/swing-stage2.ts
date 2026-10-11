// scripts/backtest/swing-stage2.ts — does the Stage 2 universe from a shared post ("within
// 10-20% of the 52-week high, up 30%+ in 3 months, above a rising 50/21") raise the Swing
// scan's win rate? Swing already gates 2-20% off the 52-week high and above the 50/200 SMA,
// so the missing filter is the 3-month run.
//
//   npx tsx scripts/backtest/swing-stage2.ts
//
// RULES — fixed 11 Oct 2026, before the first run. Input: the production-exact Swing replay
// (backtest-data/replay/swing_registry.jsonl + swing_outcomes.jsonl, 2022-09 → 2026-09).
//   FILTER: close(signal day) / close(63 sessions earlier) - 1 >= 30% (adjusted closes).
//   Win rate: entries.open1 (next open) with exits.trail21 (close below the 21 EMA), pct > 0.
//   Excess: fwd.ret20 minus QQQ's 20-session return from the signal day's close.
//   Halves: before / from 2025-07-01 (the replay's own IS/OOS split).
//   PASS: filtered beats the unfiltered rest on BOTH win rate and average excess, in BOTH halves.
//   Reported: + 21 EMA rising (the post's third filter); whether filtered beats QQQ (> 0).

import fs from 'node:fs';
import path from 'node:path';
import { DATA, loadAdjusted } from './cache';

const c = loadAdjusted();
const sIdx = new Map(c.sessions.map((d, i) => [d, i]));
const qId = c.idOf.get('QQQ')!;
const reg = fs.readFileSync(path.join(DATA, 'replay', 'swing_registry.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const out = fs.readFileSync(path.join(DATA, 'replay', 'swing_outcomes.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
if (reg.length !== out.length) throw new Error('registry/outcomes length mismatch');
type R = { date: string; t: string; r3m: number; ema21Rising: boolean; win: number | null; ex: number | null };
const rows: R[] = [];
let skipped = 0;
for (let i = 0; i < reg.length; i++) {
  const g = reg[i], o = out[i];
  if (g.symbol !== o.ticker) throw new Error(`row ${i}: ${g.symbol} vs ${o.ticker}`);
  const t = sIdx.get(o.date), id = c.idOf.get(o.ticker);
  if (t == null || id == null || t < 63 || Number.isNaN(c.C[id][t]) || Number.isNaN(c.C[id][t - 63])) { skipped++; continue; }
  const r3m = c.C[id][t] / c.C[id][t - 63] - 1;
  const tr = o.entries?.open1?.status === 'traded' ? o.entries.open1.exits?.trail21?.pct : null;
  const r20 = o.fwd?.ret20;
  const ex = r20 != null && t + 20 < c.sessions.length ? r20 / 100 - (c.C[qId][t + 20] / c.C[qId][t] - 1) : null;
  rows.push({ date: o.date, t: o.ticker, r3m, ema21Rising: !!g.ema21Rising, win: tr == null ? null : +(tr > 0), ex });
}
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
const stat = (rs: R[]) => { const w = rs.filter(r => r.win != null), e = rs.filter(r => r.ex != null); return { n: rs.length, win: mean(w.map(r => r.win as number)), ex: mean(e.map(r => r.ex as number)) }; };
const fmt = (s: { n: number; win: number; ex: number }) => `n ${String(s.n).padStart(4)} | win ${(100 * s.win).toFixed(1)}% | 20-day vs QQQ ${s.ex >= 0 ? '+' : ''}${(100 * s.ex).toFixed(2)}%`;
console.log(`signals ${rows.length} (skipped ${skipped}); up 30%+ in 3 months: ${(100 * mean(rows.map(r => +(r.r3m >= 0.3)))).toFixed(0)}%`);
let pass = true;
for (const [h, f] of [['2022-09 → 2025-06', (r: R) => r.date < '2025-07-01'], ['2025-07 → 2026-09', (r: R) => r.date >= '2025-07-01']] as const) {
  const rs = rows.filter(f), y = rs.filter(r => r.r3m >= 0.3), n = rs.filter(r => r.r3m < 0.3), y2 = y.filter(r => r.ema21Rising);
  const sy = stat(y), sn = stat(n);
  if (!(sy.win > sn.win && sy.ex > sn.ex)) pass = false;
  console.log(`\n${h}\n  all Swing           ${fmt(stat(rs))}\n  up 30%+ in 3 months ${fmt(sy)}\n  the rest            ${fmt(sn)}\n  30%+ and 21 EMA up  ${fmt(stat(y2))}`);
}
console.log(`\n→ ${pass ? 'PASS' : 'fail'}`);

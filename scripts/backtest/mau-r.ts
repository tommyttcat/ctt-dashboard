// scripts/backtest/mau-r.ts — Moving Average Undercut & Rally (MAU&R).
//
// Run from trade-dash:  npx tsx scripts/backtest/mau-r.ts
// Local bars only (backtest-data/grouped), no network, no KV.
//
// The user's 10/21 setup is a consolidation OR an undercut-and-rally: price
// drops under a key average or prior low (the shakeout), then reclaims it
// within a few bars. The live 10/21 scan cannot see the second — it rejects
// anything more than 1.5% under the 21 EMA — and its plan buys the break of
// the 10-day range high instead of the reclaim. This replays the pattern
// across the whole market.
//
// RULES — fixed 27 Sep 2026 BEFORE running.
//   Universe (on the reclaim day): price >= $5, 20-day avg dollar volume >=
//     $10M, 20-day ADR >= 3%, SMA50 > SMA200 and close > SMA200.
//   Support, three kinds, reported separately and pooled:
//     E21  the 21-day EMA        S50  the 50-day SMA
//     L10  the prior 10-day low (lowest low of the 10 sessions before the undercut)
//   Undercut (day u): close[u-1] above the support, low[u] below it, and not
//     more than 2 x ADR% below it (deeper is a breakdown, not a shakeout).
//   Reclaim (day t): the first close back above the support, u <= t <= u+3.
//   Entry: the open of t+1 (must be above the stop). Stop: the lowest low
//     from u to t (simulate.ts floors it at 0.5% of the fill).
//   One signal per ticker per support within 10 sessions.
//   Exits (shared simulate.ts): hold 20, trail 21 EMA, trail 10, 2R target.
//   Window: signals 26 Sep 2022 onward; split at 2025-05-16 as every test.
//   PASS: pooled per-trade avg R >= +0.10 in BOTH halves on hold-20 or on
//     trail-21, AND above today's 10/21 plan (pivot entry, same exit) in both
//     halves. A pass goes on to the 10-slot account test.

import fs from 'node:fs';
import path from 'node:path';
import { DATA, loadAdjusted } from './cache';
import { simulate, HOLD } from './simulate';
import { makeRsFor } from './rs';

const START = '2022-09-26';
const CUT = '2025-05-16';
const REPLAY = path.join(DATA, 'replay');

type Kind = 'E21' | 'S50' | 'L10';
type Sig = { kind: Kind; ticker: string; date: string; t: number; r: Record<string, number>; p?: Record<string, number>; half: 0 | 1; scanOk: boolean };
/* SECOND RUN, fixed 27 Sep 2026 before running (after the whole-market run):
   the same signals restricted to what the 10/21 scan itself admits on the
   reclaim day — RS rating >= 50 (point in time), close within 15% of the
   252-day high, 21 EMA rising vs 3 sessions earlier, close >= SMA50. Same
   pass bar. */

function main() {
  const t0 = Date.now();
  const c = loadAdjusted();
  const { sessions, syms, O, H, L, C, V } = c;
  const N = sessions.length;
  const s0 = sessions.findIndex(d => d >= START);
  const sigs: Sig[] = [];

  for (let id = 0; id < syms.length; id++) {
    // Dense series of the sessions this ticker traded, mapped back to session index.
    const idx: number[] = [];
    for (let j = 0; j < N; j++) if (!Number.isNaN(C[id][j])) idx.push(j);
    if (idx.length < 260) continue;
    const cl = idx.map(j => C[id][j]), hi = idx.map(j => H[id][j]), lo = idx.map(j => L[id][j]);
    const op = idx.map(j => O[id][j]), vo = idx.map(j => V[id][j]);
    const n = cl.length;
    // Rolling indicators.
    const ema21 = new Array<number>(n).fill(NaN), sma50 = new Array<number>(n).fill(NaN), sma200 = new Array<number>(n).fill(NaN);
    const adr = new Array<number>(n).fill(NaN), dvol = new Array<number>(n).fill(NaN);
    let e = NaN; const k = 2 / 22;
    let s50 = 0, s200 = 0, sAdr = 0, sDv = 0;
    for (let i = 0; i < n; i++) {
      e = i === 0 ? cl[0] : cl[i] * k + e * (1 - k); if (i >= 20) ema21[i] = e;
      s50 += cl[i]; if (i >= 50) s50 -= cl[i - 50]; if (i >= 49) sma50[i] = s50 / 50;
      s200 += cl[i]; if (i >= 200) s200 -= cl[i - 200]; if (i >= 199) sma200[i] = s200 / 200;
      const rng = cl[i] > 0 ? ((hi[i] - lo[i]) / cl[i]) * 100 : 0;
      sAdr += rng; if (i >= 20) sAdr -= cl[i - 20] > 0 ? ((hi[i - 20] - lo[i - 20]) / cl[i - 20]) * 100 : 0; if (i >= 19) adr[i] = sAdr / 20;
      sDv += cl[i] * vo[i]; if (i >= 20) sDv -= cl[i - 20] * vo[i - 20]; if (i >= 19) dvol[i] = sDv / 20;
    }
    const support = (kind: Kind, i: number): number => {
      if (kind === 'E21') return ema21[i];
      if (kind === 'S50') return sma50[i];
      let m = Infinity; for (let q = i - 10; q < i; q++) if (q >= 0) m = Math.min(m, lo[q]); return m;
    };
    for (const kind of ['E21', 'S50', 'L10'] as Kind[]) {
      let lastSig = -999;
      for (let u = 201; u < n - 2; u++) {
        if (idx[u] < s0 - 5) continue;
        const Su = support(kind, u), Sp = support(kind, u - 1);
        if (!(Su > 0) || !(Sp > 0) || !(cl[u - 1] > Sp) || !(lo[u] < Su)) continue;
        if (lo[u] < Su * (1 - (2 * adr[u]) / 100)) continue;                 // breakdown, not a shakeout
        let t = -1;
        for (let q = u; q <= Math.min(u + 3, n - 2); q++) { if (cl[q] > support(kind, q)) { t = q; break; } }
        if (t < 0 || t - lastSig < 10) continue;
        if (!(cl[t] >= 5 && dvol[t] >= 10e6 && adr[t] >= 3 && sma50[t] > sma200[t] && cl[t] > sma200[t])) continue;
        const date = sessions[idx[t]];
        if (date < START) continue;
        let stop = Infinity; for (let q = u; q <= t; q++) stop = Math.min(stop, lo[q]);
        const ei = idx[t + 1], fill = op[t + 1];
        if (!(fill > stop) || idx[t] + HOLD >= N) continue;
        const tr: any = simulate(c, id, idx[t], ei, fill, stop, fill + 2 * (fill - stop));
        let hi252 = 0; for (let q = Math.max(0, t - 251); q <= t; q++) hi252 = Math.max(hi252, hi[q]);
        const scanShape = cl[t] >= hi252 * 0.85 && ema21[t] > ema21[t - 3] && cl[t] >= sma50[t];
        lastSig = t;
        sigs.push({ kind, ticker: syms[id], date, t: idx[t], half: date < CUT ? 0 : 1,
          r: { hold20: tr.exits.hold20.r, trail21: tr.exits.trail21.r, trail10: tr.exits.trail10.r, target2R: tr.exits.fixedTarget.r },
          // % of the fill, same trades (added 28 Sep 2026 for the evidence text; rules unchanged).
          p: { hold20: tr.exits.hold20.pct, trail21: tr.exits.trail21.pct, trail10: tr.exits.trail10.pct, target2R: tr.exits.fixedTarget.pct }, scanOk: scanShape });
      }
    }
  }

  const rsFor = makeRsFor(c);
  const rsCache = new Map<number, Map<string, number>>();
  for (const sg of sigs) {
    if (!sg.scanOk) continue;
    if (!rsCache.has(sg.t)) rsCache.set(sg.t, rsFor(sg.t).ratings);
    const rs = rsCache.get(sg.t)!.get(sg.ticker);
    sg.scanOk = rs != null && rs >= 50;
  }

  // Today's 10/21 plan on the same split, same simulator: the pivot (range-high) entry.
  const base: Record<string, number[][]> = { hold20: [[], []], trail21: [[], []] };
  for (const line of fs.readFileSync(path.join(REPLAY, 'consol_outcomes.jsonl'), 'utf8').trim().split('\n')) {
    const o = JSON.parse(line);
    const e = o.entries?.pivot;
    if (!o.isNewBase || o.date < START || !e || e.status !== 'traded') continue;
    const h = o.date < CUT ? 0 : 1;
    base.hold20[h].push(e.exits.hold20.r); base.trail21[h].push(e.exits.trail21.r);
  }
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const f = (v: number) => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(3) : '—');
  console.log(`MAU&R signals since ${START}: ${sigs.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  console.log(`today's 10/21 plan (pivot): hold20 ${f(mean(base.hold20[0]))} / ${f(mean(base.hold20[1]))} · trail21 ${f(mean(base.trail21[0]))} / ${f(mean(base.trail21[1]))} (n ${base.hold20[0].length} / ${base.hold20[1].length})`);
  for (const run of ['WHOLE MARKET', "10/21 SCAN'S OWN FILTERS"] as const) {
  console.log(`\n=== ${run} ===`);
  const src = run === 'WHOLE MARKET' ? sigs : sigs.filter(s => s.scanOk);
  for (const kind of ['E21', 'S50', 'L10', 'ALL'] as const) {
    const pool = kind === 'ALL' ? src : src.filter(s => s.kind === kind);
    const by = (h: 0 | 1, ex: string) => mean(pool.filter(s => s.half === h).map(s => s.r[ex]));
    const win = (100 * pool.filter(s => s.r.hold20 > 0).length / (pool.length || 1)).toFixed(0);
    const line = ['hold20', 'trail21', 'trail10', 'target2R'].map(ex => `${ex} ${f(by(0, ex))} / ${f(by(1, ex))}`).join(' · ');
    let verdict = '';
    if (kind === 'ALL') {
      const ok = (ex: 'hold20' | 'trail21') => [0, 1].every(h => by(h as 0 | 1, ex) >= 0.10 && by(h as 0 | 1, ex) > mean(base[ex][h]));
      verdict = ok('hold20') || ok('trail21') ? `PASS (${ok('hold20') ? 'hold20' : ''}${ok('hold20') && ok('trail21') ? ' + ' : ''}${ok('trail21') ? 'trail21' : ''})` : 'fail';
    }
    console.log(`${kind.padEnd(4)} n ${String(pool.length).padStart(5)} (${pool.filter(s => s.half === 0).length} / ${pool.filter(s => s.half === 1).length}) win ${win}% | ${line} ${verdict}`);
  }
  }
  fs.writeFileSync(path.join(REPLAY, 'maur_signals.jsonl'), sigs.map(s => JSON.stringify(s)).join('\n'));
}

main();

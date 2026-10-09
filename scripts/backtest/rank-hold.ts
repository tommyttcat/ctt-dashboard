// scripts/backtest/rank-hold.ts — which stocks are best to BE IN?
//
//   npx tsx scripts/backtest/rank-hold.ts
//
// Every earlier test was about timing an entry (breakouts, gaps, buy levels)
// and every one failed live or in replay. This asks the other question: rank
// all liquid common stocks once a month, hold the top group for the month,
// repeat. The rankings are the ones with decades of outside evidence.
//
// RULES — fixed 9 Oct 2026, before the first run.
//   Universe at each month-end close t: Polygon type CS or ADRC (known — no
//     ETFs, so leveraged funds cannot top a momentum list), close >= $5,
//     20-session average dollar volume >= $20M, every bar of the last 253
//     sessions present.
//   Rankings (higher = better), one portfolio each:
//     MOM12_1   return t-252 → t-21 (12-month momentum skipping the last month)
//     MOM6      return t-126 → t
//     HIGH52    close / 252-session high
//     TREND     MOM12_1, only among names above their 200-day average and
//               within 15% of the 52-week high
//     LOWVOL    lowest 63-session standard deviation of daily returns
//     RS        0.4·r63 + 0.2·r126 + 0.2·r189 + 0.2·r252 (IBD-style blend)
//   Portfolio: top N equal weight, bought at the next session's open, held
//     to the open after the next month-end. A name that stops trading is
//     sold at its last close. Cost 0.1% per side on the weight traded.
//   Benchmarks over the same open-to-open months: SPY, and EW = every
//     universe name equal-weighted (separates picking from a small-cap tilt).
//   PASS (pre-registered): at N=20, beats BOTH SPY and EW in BOTH halves
//     (split at the middle rebalance), AND beats both over the whole period
//     at N=10 and N=50 as well. Six rankings were tried, so one passing by
//     chance is plausible: treat a single marginal pass with suspicion.
//   Variant reported, not judged: MOM12_1 in cash whenever SPY closes the
//     month below its 200-day average.

import { loadAdjusted } from './cache';
import { loadReference, refAt } from './reference';

const c = loadAdjusted();
const ref = loadReference();
const { sessions, syms, O, H, C, V } = c;
const N = sessions.length;
const COST = 0.001;
const spyId = c.idOf.get('SPY')!;

// month-end session indices
const ends: number[] = [];
for (let s = 0; s < N - 1; s++) if (sessions[s].slice(0, 7) !== sessions[s + 1].slice(0, 7)) ends.push(s);
const rebal = ends.filter(s => s >= 253 && s + 1 < N);

const typeOk = new Map<string, boolean>();
function isStock(sym: string, date: string) {
  const k = `${sym}|${date.slice(0, 4)}`;
  if (!typeOk.has(k)) { const r = refAt(ref, sym, date); const t = (r?.type || '').toUpperCase(); typeOk.set(k, t === 'CS' || t === 'ADRC'); }
  return typeOk.get(k)!;
}

type Score = { id: number; MOM12_1: number; MOM6: number; HIGH52: number; TREND: number; LOWVOL: number; RS: number };
function universe(t: number): Score[] {
  const out: Score[] = [];
  for (let id = 0; id < syms.length; id++) {
    const cl = C[id][t];
    if (!(cl >= 5)) continue;
    let dv = 0, ok = true;
    for (let j = t - 19; j <= t; j++) dv += C[id][j] * V[id][j];
    if (!(dv / 20 >= 20e6)) continue;
    for (let j = t - 252; j <= t; j++) if (Number.isNaN(C[id][j])) { ok = false; break; }
    if (!ok || !isStock(syms[id], sessions[t])) continue;
    let hi = 0; for (let j = t - 251; j <= t; j++) hi = Math.max(hi, H[id][j]);
    let s200 = 0; for (let j = t - 199; j <= t; j++) s200 += C[id][j]; s200 /= 200;
    const rets: number[] = []; for (let j = t - 62; j <= t; j++) rets.push(C[id][j] / C[id][j - 1] - 1);
    const m = rets.reduce((a, b) => a + b, 0) / rets.length;
    const sd = Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / rets.length);
    const r = (k: number) => cl / C[id][t - k] - 1;
    const mom = C[id][t - 21] / C[id][t - 252] - 1;
    out.push({
      id, MOM12_1: mom, MOM6: r(126), HIGH52: cl / hi,
      TREND: cl > s200 && cl >= 0.85 * hi ? mom : -Infinity,
      LOWVOL: -sd, RS: 0.4 * r(63) + 0.2 * r(126) + 0.2 * r(189) + 0.2 * r(252),
    });
  }
  return out;
}

/** Open-to-open return of one name from session a to session b (exit at last close if it stops). */
function hold(id: number, a: number, b: number): number {
  const buy = O[id][a];
  if (!(buy > 0)) return 0;
  if (O[id][b] > 0) return O[id][b] / buy - 1;
  let s = b; while (s > a && Number.isNaN(C[id][s])) s--;
  return C[id][s] / buy - 1;
}

type Key = Exclude<keyof Score, 'id'>;
const KEYS: Key[] = ['MOM12_1', 'MOM6', 'HIGH52', 'TREND', 'LOWVOL', 'RS'];
const uniCache = rebal.map(t => universe(t));
console.log(`rebalances ${rebal.length}: ${sessions[rebal[0]]} → ${sessions[rebal[rebal.length - 1]]}; median universe ${uniCache.map(u => u.length).sort((a, b) => a - b)[uniCache.length >> 1]} names`);

function series(pick: (u: Score[], i: number) => number[] | null): number[] {
  const out: number[] = [];
  let prev = new Set<number>();
  for (let i = 0; i < rebal.length; i++) {
    const a = rebal[i] + 1;
    const b = i + 1 < rebal.length ? rebal[i + 1] + 1 : N - 1;
    if (a >= b) break;
    const ids = pick(uniCache[i], i);
    if (ids == null) { out.push(-(prev.size ? COST : 0)); prev = new Set(); continue; }  // cash
    const turnover = ids.length ? ids.filter(x => !prev.has(x)).length / ids.length : 0;
    const r = ids.reduce((s, id) => s + hold(id, a, b), 0) / Math.max(1, ids.length);
    out.push(r - 2 * COST * turnover);
    prev = new Set(ids);
  }
  return out;
}
const top = (k: Key, n: number) => (u: Score[]) => u.filter(x => Number.isFinite(x[k])).sort((x, y) => y[k] - x[k]).slice(0, n).map(x => x.id);
const spySeries = series(() => [spyId]).map((r, i) => r + 2 * COST * (i === 0 ? 1 : 0)); // SPY: no turnover cost after month 1
const ewSeries = series(u => u.map(x => x.id));

const grow = (rs: number[]) => rs.reduce((g, r) => g * (1 + r), 1) - 1;
const dd = (rs: number[]) => { let v = 1, pk = 1, m = 0; for (const r of rs) { v *= 1 + r; pk = Math.max(pk, v); m = Math.max(m, 1 - v / pk); } return m; };
const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const months = spySeries.length, half = months >> 1;
const years = months / 12;
console.log(`months ${months}, split at ${sessions[rebal[half]]}`);
const line = (name: string, rs: number[]) => {
  const h1 = grow(rs.slice(0, half)), h2 = grow(rs.slice(half)), all = grow(rs);
  return `${name.padEnd(16)} total ${pct(all).padStart(8)}  CAGR ${pct((1 + all) ** (1 / years) - 1).padStart(7)}  maxDD(monthly) ${pct(-dd(rs)).padStart(7)}  1st half ${pct(h1).padStart(8)}  2nd half ${pct(h2).padStart(8)}`;
};
console.log(line('SPY', spySeries));
console.log(line('EW universe', ewSeries));
const verdict: string[] = [];
for (const k of KEYS) {
  console.log(`\n== ${k}`);
  const s20 = series(top(k, 20));
  for (const n of [10, 20, 50]) console.log(line(`  top ${n}`, n === 20 ? s20 : series(top(k, n))));
  const beat = (rs: number[], b: number[], a = 0, z = rs.length) => grow(rs.slice(a, z)) > grow(b.slice(a, z));
  const s10 = series(top(k, 10)), s50 = series(top(k, 50));
  const pass = beat(s20, spySeries, 0, half) && beat(s20, ewSeries, 0, half) && beat(s20, spySeries, half) && beat(s20, ewSeries, half)
    && beat(s10, spySeries) && beat(s10, ewSeries) && beat(s50, spySeries) && beat(s50, ewSeries);
  verdict.push(`${k}: ${pass ? 'PASS' : 'fail'}`);
}
// Variant: MOM12_1 in cash when SPY < 200-day at the month-end.
const spyAbove = rebal.map(t => { let s = 0; for (let j = t - 199; j <= t; j++) s += C[spyId][j]; return C[spyId][t] > s / 200; });
console.log('\n== variant (not judged): MOM12_1 top 20, cash when SPY < 200-day');
console.log(line('  top 20 + filter', series((u, i) => (spyAbove[i] ? top('MOM12_1', 20)(u) : null))));
console.log('\nVERDICT ' + verdict.join(' · '));

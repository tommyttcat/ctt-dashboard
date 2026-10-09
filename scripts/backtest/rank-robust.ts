// scripts/backtest/rank-robust.ts — is rank-hold's TREND result real?
//
//   npx tsx scripts/backtest/rank-robust.ts
//
// rank-hold.ts (rules fixed 9 Oct 2026) found TREND top 20 at +190% vs SPY
// +112% over Sep 2022 - Sep 2026, both halves ahead, but top 10 lost in the
// second half, so it failed the pre-registered bar. Six rankings were tried,
// so one strong result can be luck. These checks were written AFTER seeing
// that result, and none of them can be tuned toward it — they only try to
// break it:
//   A. Rebalance on a different day: the 10th session of each month instead
//      of month-end (a result that depends on the calendar day is noise).
//   B. Does the RANKING matter, or only the eligibility filter? 1,000 random
//      draws of 20 names from the same TREND-eligible pool each month; where
//      does the ranked top 20 sit in that distribution?
//   C. Costs at 0.25% a side instead of 0.1%.
//   D. Year by year against SPY; worst peak-to-trough on DAILY marks.
//   E. Concentration: how many names a month, and turnover.
// Same TREND definition and universe as rank-hold.ts, copied verbatim.

import { loadAdjusted } from './cache';
import { loadReference, refAt } from './reference';

const c = loadAdjusted();
const ref = loadReference();
const { sessions, syms, O, H, C, V } = c;
const N = sessions.length;
const spyId = c.idOf.get('SPY')!;

const typeOk = new Map<string, boolean>();
function isStock(sym: string, date: string) {
  const k = `${sym}|${date.slice(0, 4)}`;
  if (!typeOk.has(k)) { const r = refAt(ref, sym, date); const t = (r?.type || '').toUpperCase(); typeOk.set(k, t === 'CS' || t === 'ADRC'); }
  return typeOk.get(k)!;
}

/** TREND-eligible names at close t with their 12-1 momentum. */
function trendPool(t: number): { id: number; mom: number }[] {
  const out: { id: number; mom: number }[] = [];
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
    if (!(cl > s200 && cl >= 0.85 * hi)) continue;
    out.push({ id, mom: C[id][t - 21] / C[id][t - 252] - 1 });
  }
  return out;
}

function hold(id: number, a: number, b: number): number {
  const buy = O[id][a];
  if (!(buy > 0)) return 0;
  if (O[id][b] > 0) return O[id][b] / buy - 1;
  let s = b; while (s > a && Number.isNaN(C[id][s])) s--;
  return C[id][s] / buy - 1;
}

function schedule(kind: 'end' | 'tenth'): number[] {
  const out: number[] = [];
  if (kind === 'end') { for (let s = 0; s < N - 1; s++) if (sessions[s].slice(0, 7) !== sessions[s + 1].slice(0, 7)) out.push(s); }
  else { let cnt = 0; for (let s = 1; s < N; s++) { if (sessions[s].slice(0, 7) !== sessions[s - 1].slice(0, 7)) cnt = 0; cnt++; if (cnt === 10) out.push(s); } }
  return out.filter(s => s >= 253 && s + 1 < N);
}

function run(reb: number[], pick: (pool: { id: number; mom: number }[], i: number) => number[], cost: number) {
  const rets: number[] = [];
  const held: number[][] = [];
  let prev = new Set<number>(), turn = 0;
  for (let i = 0; i < reb.length; i++) {
    const a = reb[i] + 1, b = i + 1 < reb.length ? reb[i + 1] + 1 : N - 1;
    if (a >= b) break;
    const ids = pick(pools.get(reb[i])!, i);
    const t = ids.length ? ids.filter(x => !prev.has(x)).length / ids.length : 0;
    turn += t;
    rets.push(ids.reduce((s, id) => s + hold(id, a, b), 0) / Math.max(1, ids.length) - 2 * cost * t);
    held.push(ids);
    prev = new Set(ids);
  }
  return { rets, held, turnover: turn / Math.max(1, rets.length) };
}

const grow = (rs: number[]) => rs.reduce((g, r) => g * (1 + r), 1) - 1;
const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const top20 = (pool: { id: number; mom: number }[]) => pool.slice().sort((x, y) => y.mom - x.mom).slice(0, 20).map(x => x.id);

const pools = new Map<number, { id: number; mom: number }[]>();
const ends = schedule('end'), tenth = schedule('tenth');
for (const t of [...ends, ...tenth]) if (!pools.has(t)) pools.set(t, trendPool(t));
const spyRun = (reb: number[]) => run(reb, () => [spyId], 0).rets;

// A
for (const [name, reb] of [['month-end', ends], ['10th session', tenth]] as const) {
  const r = run(reb, top20, 0.001).rets, s = spyRun(reb), h = r.length >> 1;
  console.log(`A ${name.padEnd(12)} TREND top20 ${pct(grow(r))} (1st ${pct(grow(r.slice(0, h)))}, 2nd ${pct(grow(r.slice(h)))}) | SPY ${pct(grow(s))} (1st ${pct(grow(s.slice(0, h)))}, 2nd ${pct(grow(s.slice(h)))})`);
}

// B
{
  let seed = 12345;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const ranked = grow(run(ends, top20, 0.001).rets);
  const sims: number[] = [];
  for (let k = 0; k < 1000; k++) {
    sims.push(grow(run(ends, pool => {
      const a = pool.slice();
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a.slice(0, 20).map(x => x.id);
    }, 0.001).rets));
  }
  sims.sort((x, y) => x - y);
  const beat = sims.filter(x => x < ranked).length / sims.length;
  console.log(`B random 20 from the same eligible pool: median ${pct(sims[500])}, 5th-95th ${pct(sims[50])} to ${pct(sims[950])}; ranked top 20 ${pct(ranked)} beats ${(beat * 100).toFixed(1)}% of random draws; pool median size ${[...pools.values()].map(p => p.length).sort((a, b) => a - b)[pools.size >> 1]}`);
}

// C
console.log(`C costs 0.25%/side: TREND top20 ${pct(grow(run(ends, top20, 0.0025).rets))}`);

// D + E
{
  const { rets, held, turnover } = run(ends, top20, 0.001);
  const s = spyRun(ends);
  const byYear = new Map<string, [number[], number[]]>();
  ends.slice(0, rets.length).forEach((t, i) => { const y = sessions[t + 1].slice(0, 4); const e = byYear.get(y) ?? [[], []]; e[0].push(rets[i]); e[1].push(s[i]); byYear.set(y, e); });
  for (const [y, [a, b]] of byYear) console.log(`D ${y}: TREND ${pct(grow(a))} vs SPY ${pct(grow(b))} (${a.length} months)`);
  // daily marks
  let v = 1, pk = 1, mdd = 0, worstAt = '';
  for (let i = 0; i < rets.length; i++) {
    const a = ends[i] + 1, b = i + 1 < ends.length ? ends[i + 1] + 1 : N - 1;
    const base = v;
    for (let d = a; d < b; d++) {
      const r = held[i].reduce((sum, id) => { const px = Number.isNaN(C[id][d]) ? NaN : C[id][d] / O[id][a] - 1; return sum + (Number.isNaN(px) ? 0 : px); }, 0) / Math.max(1, held[i].length);
      const val = base * (1 + r); pk = Math.max(pk, val);
      if (1 - val / pk > mdd) { mdd = 1 - val / pk; worstAt = sessions[d]; }
    }
    v = base * (1 + rets[i]);
  }
  console.log(`D worst drop on daily marks: ${pct(-mdd)} (deepest ${worstAt})`);
  const counts = new Map<number, number>(); held.flat().forEach(id => counts.set(id, (counts.get(id) ?? 0) + 1));
  const most = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id, n]) => `${syms[id]}×${n}`);
  console.log(`E monthly turnover ${(turnover * 100).toFixed(0)}% of names; most-held: ${most.join(' ')}`);
  const lastPool = pools.get(ends[ends.length - 1])!;
  console.log(`E latest list (${sessions[ends[ends.length - 1]]} close): ${top20(lastPool).map(id => syms[id]).join(' ')}`);
}

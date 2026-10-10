// scripts/backtest/rank-intraday.ts — intraday entries on the ranked list (part 2 of rank-entries.ts).
//
//   npx tsx scripts/backtest/rank-intraday.ts
//
// Minute bars for every possible entry day (rank-minute-download.ts): the P2
// top 50 at close t, QQQ above its 200-day at t, bars for session t+1.
//
// RULES — fixed 9 Oct 2026, before the first run. Regular hours only.
//   ATR = 14-session mean true range through t.
//   I1 opening-range breakout: OR = the 9:30-9:34 high. Buy the first minute
//      from 9:35 whose high exceeds it, at max(OR high, that minute's open).
//   I2 VWAP reclaim: from 10:00, after at least one minute closing below the
//      session VWAP, the first minute closing back above it; buy at the next
//      minute's open.
//   Both: stop = the session low up to and including the fill minute (floored
//     0.5% under the fill). Skipped if the fill is more than 1 ATR above
//     close(t) (a chase) or the stop is more than 1 ATR below the fill.
//     Entry day: only minutes after the fill can stop it (at the stop, or the
//     minute's open if it gaps through). One position per name at a time.
//   Exits from day 2, daily bars (rank-entries.ts's): X0 all out at the first
//     close below SMA10; X1 half at the 3rd session's close if above the fill,
//     stop to breakeven, rest on SMA10; X2 half at fill + 2 ATR, stop to
//     breakeven, rest on SMA10. Max 120 sessions. 0.1% a side.
//   Account and PASS exactly as rank-entries.ts: the $100k account (0.5% at
//     risk, 25% max per position) beats QQQ held AND QQQ-above-200-day in
//     both halves (split 2024-09-30), its random-order median beats QQQ held
//     in both halves, and the average trade beats QQQ over the same window in
//     both halves.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DATA } from './cache';
import { sessions, N, O, H, C, c, S0, SPLIT } from './rank-engine';
import { account, stats, etMin, type Trade, type M } from './qullamaggie';

const L = c.L;
const COST = 0.001;
const qId = c.idOf.get('QQQ')!;
const DIR = path.join(DATA, 'minute', 'rank');
const jobs: { sym: string; date: string }[] = JSON.parse(fs.readFileSync(path.join(DIR, 'jobs.json'), 'utf8'));
const sIdx = new Map(sessions.map((d, i) => [d, i]));
const sma = (id: number, t: number, n: number) => { let s = 0; for (let j = t - n + 1; j <= t; j++) s += C[id][j]; return s / n; };
const atr = (id: number, t: number) => { let s = 0; for (let k = t - 13; k <= t; k++) s += Math.max(H[id][k], C[id][k - 1]) - Math.min(L[id][k], C[id][k - 1]); return s / 14; };
const above200 = (t: number) => C[qId][t] > sma(qId, t, 200);
/* ET minute-of-day is computed once per file: the first bar through Intl,
   the rest by offset (no DST change inside a session). Stored in slot 0. */
const readMin = (sym: string, date: string): M[] | null => {
  const f = path.join(DIR, date.slice(0, 4), `${sym}_${date}.json.gz`);
  if (!fs.existsSync(f)) return null;
  try {
    const rows: M[] = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString());
    if (!rows.length) return rows;
    const t0 = rows[0][0], m0 = etMin(t0);
    return rows.map(r => [m0 + Math.round((r[0] - t0) / 60000), r[1], r[2], r[3], r[4], r[5]] as M);
  } catch { return null; }
};
const entryCache = new Map<string, { k: number; fill: number } | null>();

type Entry = 'I1' | 'I2';
type Exit = 'X0' | 'X1' | 'X2';
type T = Trade & { qqq: number };

/** Fill minute index and price for an entry rule, or null. */
function entryOf(en: Entry, mins: M[]): { k: number; fill: number } | null {
  if (en === 'I1') {
    let orh = -Infinity, k0 = -1;
    for (let j = 0; j < mins.length; j++) { if (mins[j][0] < 575) orh = Math.max(orh, mins[j][2]); else { k0 = j; break; } }
    if (k0 < 0 || orh === -Infinity) return null;
    for (let j = k0; j < mins.length; j++) if (mins[j][2] > orh) return { k: j, fill: Math.max(orh, mins[j][1]) };
    return null;
  }
  let pv = 0, vv = 0, below = false;
  for (let j = 0; j < mins.length - 1; j++) {
    const [, , h, l, cl, v] = mins[j];
    pv += ((h + l + cl) / 3) * v; vv += v;
    if (vv <= 0 || mins[j][0] < 600) continue;
    const vwap = pv / vv;
    if (cl < vwap) below = true;
    else if (below && cl > vwap) return { k: j + 1, fill: mins[j + 1][1] };
  }
  return null;
}

function simulate(id: number, t: number, mins: M[], en: Entry, x: Exit): T | null {
  const e = t + 1;
  const ck = `${en}|${id}|${e}`;
  if (!entryCache.has(ck)) entryCache.set(ck, entryOf(en, mins));
  const got = entryCache.get(ck)!;
  if (!got) return null;
  const { k, fill } = got;
  const a = atr(id, t);
  if (!(a > 0) || fill - C[id][t] > a) return null;
  let lod = Infinity; for (let j = 0; j <= k; j++) lod = Math.min(lod, mins[j][3]);
  let stop = Math.min(lod, fill * 0.995);
  if (fill - stop > a) return null;
  const stop0 = stop;
  const exits: [number, number, number][] = [];
  let left = 1;
  for (let j = k + 1; j < mins.length; j++) if (mins[j][3] <= stop) { exits.push([e, 1, Math.min(stop, mins[j][1])]); left = 0; break; }
  const target = fill + 2 * a;
  for (let s = e + 1; left > 0 && s < N; s++) {
    if (Number.isNaN(C[id][s])) continue;
    const day = s - e + 1;
    if (O[id][s] <= stop) { exits.push([s, left, O[id][s]]); left = 0; break; }
    if (L[id][s] <= stop) { exits.push([s, left, stop]); left = 0; break; }
    if (x === 'X2' && left === 1 && H[id][s] >= target) { exits.push([s, 0.5, Math.max(O[id][s], target)]); left = 0.5; stop = Math.max(stop, fill); }
    if (x === 'X1' && left === 1 && day === 3 && C[id][s] > fill) { exits.push([s, 0.5, C[id][s]]); left = 0.5; stop = Math.max(stop, fill); }
    if (left > 0 && C[id][s] < sma(id, s, 10)) { exits.push([s, left, C[id][s]]); left = 0; break; }
    if (day >= 120) { exits.push([s, left, C[id][s]]); left = 0; break; }
  }
  if (left > 0) { let s = N - 1; while (s > e && Number.isNaN(C[id][s])) s--; exits.push([s, left, C[id][s]]); }
  const ret = exits.reduce((m, [, f, p]) => m + f * (p / fill - 1), 0) - 2 * COST;
  const last = exits.reduce((m, q) => Math.max(m, q[0]), 0);
  return { ticker: c.syms[id], date: sessions[e], ei: e, mkt: true, r63: 0, fill, stop: stop0, exits, ret, qqq: C[qId][last] / O[qId][e] - 1 };
}

// jobs are grouped by entry day in list-rank order
const byDay = new Map<number, string[]>();
for (const j of jobs) { const e = sIdx.get(j.date); if (e == null) continue; (byDay.get(e) ?? byDay.set(e, []).get(e)!).push(j.sym); }
let missing = 0;
const minCache = new Map<string, M[] | null>();
const getMin = (sym: string, date: string) => { const k = `${sym}|${date}`; if (!minCache.has(k)) { const m = readMin(sym, date); if (!m) missing++; minCache.set(k, m); } return minCache.get(k)!; };

function run(en: Entry, x: Exit): T[] {
  const trades: T[] = [];
  const busy = new Map<number, number>();
  for (const [e, syms] of [...byDay].sort((p, q) => p[0] - q[0])) {
    const t = e - 1;
    if (!above200(t)) continue;
    syms.forEach((sym, rank) => {
      const id = c.idOf.get(sym);
      if (id == null || (busy.get(id) ?? -1) >= e) return;
      const mins = getMin(sym, sessions[e]);
      if (!mins || mins.length < 30) return;
      const tr = simulate(id, t, mins, en, x);
      if (!tr) return;
      tr.r63 = -rank;
      trades.push(tr);
      busy.set(id, tr.exits.reduce((m, q) => Math.max(m, q[0]), 0));
    });
  }
  return trades.sort((p, q) => p.ei - q.ei);
}

const pct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
const iSplit = sessions.findIndex(d => d > SPLIT);
const halves: [string, number, number][] = [['1st', S0, iSplit - 1], ['2nd', iSplit, N - 1]];
const qqqHeld = (a: number, b: number) => C[qId][b] / O[qId][a] - 1;
const o3 = (a: number, b: number) => { let v = 1; for (let d = a + 1; d <= b; d++) v *= above200(d - 1) ? C[qId][d] / C[qId][d - 1] : 1 + 0.04 / 252; return v * (above200(a - 1) ? C[qId][a] / O[qId][a] : 1) - 1; };
console.log(`window ${sessions[S0]} → ${sessions[N - 1]}, split ${SPLIT}; entry days ${byDay.size}`);
for (const [h, a, b] of halves) console.log(`  ${h} half: QQQ held ${pct(qqqHeld(a, b))}, QQQ above 200-day ${pct(o3(a, b))}`);
for (const en of ['I1', 'I2'] as Entry[]) for (const x of ['X0', 'X1', 'X2'] as Exit[]) {
  const ts = run(en, x);
  const parts = halves.map(([h, a, b]) => {
    const inH = ts.filter(t => t.ei >= a && t.ei <= b);
    const acct = account(c, inH, a, b);
    const shuf = Array.from({ length: 200 }, (_, i) => account(c, inH, a, b, i + 7).final).sort((p, q) => p - q)[100];
    const ex = inH.reduce((m, t) => m + t.ret - t.qqq, 0) / Math.max(1, inH.length);
    return { h, acct: acct.final / 1e5 - 1, dd: acct.maxDD, shuf: shuf / 1e5 - 1, ex, q: qqqHeld(a, b), o: o3(a, b), n: inH.length };
  });
  const pass = parts.every(p => p.acct > p.q && p.acct > p.o && p.shuf > p.q && p.ex > 0);
  console.log(`\n${en} ${x}  ${stats(ts)}`);
  for (const p of parts) console.log(`  ${p.h}: account ${pct(p.acct)} (worst drop ${pct(-p.dd)}, random-order median ${pct(p.shuf)}) | avg trade vs QQQ same window ${pct(p.ex)} | n ${p.n}`);
  console.log(`  → ${pass ? 'PASS' : 'fail'}`);
}
console.log(`\nminute files missing: ${missing}`);

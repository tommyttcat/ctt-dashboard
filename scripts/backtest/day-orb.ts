// scripts/backtest/day-orb.ts — the published "stocks in play" 5-minute opening-range day trade.
//
//   NODE_OPTIONS=--max-old-space-size=8192 npx tsx scripts/backtest/day-orb.ts
//
// Zarattini, Barbon & Aziz, "A Profitable Day Trading Strategy for the U.S.
// Equity Market" (2024): trade only the ~20 stocks with the most unusual
// opening volume, in the direction of the first 5-minute candle, stop at 10%
// of ATR, out at the close. Reported 2016-2023: far ahead of SPY.
//
// RULES — fixed 10 Oct 2026, before the first run. Uses only minute bars
// already on disk (backtest-data/minute: rank/, kq/, and the scanner-name
// year folders) — so the "in play" pick is made from the ~60 names a day we
// have bars for, not every US stock as in the paper.
//   Eligible (prior close): price >= $5, 14-session average volume >= 1M
//     shares, ATR(14) >= $0.50. CS/ADRC only.
//   IN PLAY: RV5 = volume of the first 5 minutes (9:30-9:34) / 14-session
//     average daily volume. Each day: top 20 of the pool by RV5, RV5 >= 0.10.
//   DIRECTION: first 5-minute candle close > open → long only; < → short only.
//   ENTRY: long = stop order at the 5-minute high (from 9:35), fill at
//     max(level, that minute's open); short mirror at the low.
//   STOP: 10% of ATR(14) from the fill. If a minute both fills and touches the
//     stop, the stop is assumed hit. EXIT: 15:59 close if not stopped.
//   SIZE: risk 1% of equity per trade (stop distance), total notional capped
//     at 4x equity (scaled down pro rata). Costs 0.02% a side.
//   Account compounds daily. Halves split 2024-09-30.
//   PASS: account beats QQQ held in BOTH halves AND average R > 0 in both.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DATA, loadAdjusted } from './cache';
import { loadReference, refAt } from './reference';

const c = loadAdjusted();
const ref = loadReference();
const { sessions, C, H, L, V } = c;
const N = sessions.length;
const sIdx = new Map(sessions.map((d, i) => [d, i]));
const qId = c.idOf.get('QQQ')!;
const MIN = path.join(DATA, 'minute');
type M = [number, number, number, number, number, number];
const read = (f: string): M[] => { try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString()); } catch { return []; } };
const etFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const et = (ms: number) => { const p = Object.fromEntries(etFmt.formatToParts(new Date(ms)).map(x => [x.type, x.value])); return { d: `${p.year}-${p.month}-${p.day}`, m: (+p.hour % 24) * 60 + +p.minute }; };

// index: date -> [{ sym, file }]
const byDate = new Map<string, { sym: string; file: string }[]>();
const add = (d: string, sym: string, file: string) => { (byDate.get(d) ?? byDate.set(d, []).get(d)!).push({ sym, file }); };
for (const sub of ['rank', 'kq']) for (const y of fs.readdirSync(path.join(MIN, sub)).filter(x => /^\d{4}$/.test(x))) for (const f of fs.readdirSync(path.join(MIN, sub, y))) { const m = f.match(/^(.+)_(\d{4}-\d{2}-\d{2})\.json\.gz$/); if (m) add(m[2], m[1], path.join(MIN, sub, y, f)); }
for (const y of fs.readdirSync(MIN).filter(x => /^\d{4}$/.test(x))) for (const f of fs.readdirSync(path.join(MIN, y))) {
  const m = f.match(/^(.+)_(\d{4}-\d{2}-\d{2})\.json\.gz$/); if (!m) continue;
  const i = sIdx.get(m[2]); if (i == null) continue;
  for (let k = 1; k <= 5 && i + k < N; k++) add(sessions[i + k], m[1], path.join(MIN, y, f));
}
const dates = [...byDate.keys()].filter(d => sIdx.has(d)).sort();
console.log(`dates with minute bars: ${dates.length} (${dates[0]} → ${dates[dates.length - 1]}), avg pool ${(dates.reduce((a, d) => a + new Set(byDate.get(d)!.map(x => x.sym)).size, 0) / dates.length).toFixed(0)} names`);

type Tr = { d: string; side: 1 | -1; R: number; notionalPerRisk: number; ret: number };
const trades: Tr[] = [];
const COST = 0.0002;
for (const d of dates) {
  const s = sIdx.get(d)!; const t = s - 1;
  const seen = new Set<string>(); const cand: { sym: string; bars: M[]; rv5: number; atr: number }[] = [];
  for (const { sym, file } of byDate.get(d)!) {
    if (seen.has(sym)) continue;
    const id = c.idOf.get(sym); if (id == null || t < 20 || !(C[id][t] >= 5)) continue;
    let adv = 0, atr = 0, ok = true;
    for (let j = t - 13; j <= t; j++) { if (Number.isNaN(C[id][j]) || Number.isNaN(C[id][j - 1])) { ok = false; break; } adv += V[id][j]; atr += Math.max(H[id][j], C[id][j - 1]) - Math.min(L[id][j], C[id][j - 1]); }
    if (!ok) continue; adv /= 14; atr /= 14;
    if (adv < 1e6 || atr < 0.5) continue;
    const ty = (refAt(ref, sym, d)?.type || '').toUpperCase(); if (ty !== 'CS' && ty !== 'ADRC') continue;
    const all = read(file); const bars = all.filter(b => { const e = et(b[0]); return e.d === d && e.m >= 570 && e.m < 960; });
    if (bars.length < 300) continue;
    seen.add(sym);
    const first5 = bars.filter(b => et(b[0]).m < 575);
    const v5 = first5.reduce((a, b) => a + b[5], 0);
    cand.push({ sym, bars, rv5: v5 / adv, atr });
  }
  const pick = cand.filter(x => x.rv5 >= 0.10).sort((a, b) => b.rv5 - a.rv5).slice(0, 20);
  for (const p of pick) {
    const first5 = p.bars.filter(b => et(b[0]).m < 575); if (first5.length < 3) continue;
    const o5 = first5[0][1], c5 = first5[first5.length - 1][4], h5 = Math.max(...first5.map(b => b[2])), l5 = Math.min(...first5.map(b => b[3]));
    if (c5 === o5) continue;
    const side: 1 | -1 = c5 > o5 ? 1 : -1, level = side > 0 ? h5 : l5, risk = 0.1 * p.atr;
    const rest = p.bars.filter(b => et(b[0]).m >= 575);
    let fill = NaN, k0 = -1;
    for (let k = 0; k < rest.length; k++) { const b = rest[k]; if (side > 0 ? b[2] > level : b[3] < level) { fill = side > 0 ? Math.max(level, b[1]) : Math.min(level, b[1]); k0 = k; break; } }
    if (k0 < 0) continue;
    const stop = fill - side * risk; let exit = NaN;
    for (let k = k0; k < rest.length; k++) { const b = rest[k]; if (side > 0 ? b[3] <= stop : b[2] >= stop) { exit = k === k0 ? stop : (side > 0 ? Math.min(stop, b[1]) : Math.max(stop, b[1])); break; } }
    if (Number.isNaN(exit)) exit = rest[rest.length - 1][4];
    const ret = side * (exit / fill - 1) - 2 * COST;
    trades.push({ d, side, R: ret / (risk / fill), notionalPerRisk: fill / risk, ret });
  }
}
// account: per day, each trade sized to risk 1% of equity; notional capped at 4x
const days = [...new Set(trades.map(t => t.d))].sort();
const iSplit = '2024-09-30';
const run = (from: string, to: string, sideF?: 1 | -1) => {
  let eq = 1, peak = 1, dd = 0;
  for (const d of days) { if (d < from || d > to) continue; const ts = trades.filter(t => t.d === d && (!sideF || t.side === sideF)); if (!ts.length) continue;
    let notional = ts.reduce((a, t) => a + 0.01 * t.notionalPerRisk, 0); const scale = notional > 4 ? 4 / notional : 1;
    eq *= 1 + ts.reduce((a, t) => a + 0.01 * t.notionalPerRisk * scale * t.ret, 0); peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak); }
  return { ret: eq - 1, dd };
};
const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
const qq = (a: string, b: string) => { const i = sIdx.get(sessions.find(x => x >= a)!)!, j = sIdx.get([...sessions].reverse().find(x => x <= b)!)!; return C[qId][j] / C[qId][i - 1] - 1; };
const first = days[0], last = days[days.length - 1];
const halves: [string, string][] = [[first, iSplit], ['2024-10-01', last]];
console.log(`trades ${trades.length} on ${days.length} days; long ${trades.filter(t => t.side > 0).length}, short ${trades.filter(t => t.side < 0).length}`);
for (const [nm, f] of [['both sides', undefined], ['long only', 1], ['short only', -1]] as const) {
  const ts = trades.filter(t => !f || t.side === f);
  const parts = halves.map(([a, b]) => ({ R: mean(ts.filter(t => t.d >= a && t.d <= b).map(t => t.R)), win: mean(ts.filter(t => t.d >= a && t.d <= b).map(t => +(t.R > 0))), acc: run(a, b, f as any), q: qq(a, b), n: ts.filter(t => t.d >= a && t.d <= b).length }));
  console.log(`  ${nm.padEnd(11)} ${parts.map((p, i) => `${i ? '2nd' : '1st'}: avg ${p.R.toFixed(3)}R win ${(100 * p.win).toFixed(0)}% n ${p.n} account ${pct(p.acc.ret)} (dd ${pct(-p.acc.dd)}) vs QQQ ${pct(p.q)}`).join(' | ')}`);
  if (!f) console.log(`  → ${parts.every(p => p.acc.ret > p.q && p.R > 0) ? 'PASS' : 'fail'}`);
}

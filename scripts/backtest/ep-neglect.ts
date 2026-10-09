// scripts/backtest/ep-neglect.ts — the neglected episodic pivot.
//
// Run from trade-dash:
//   npx tsx scripts/backtest/ep-neglect.ts signals    → replay/epn_signals.jsonl
//   npx tsx scripts/backtest/ep-neglect.ts download   (minute bars, gap days only)
//   npx tsx scripts/backtest/ep-neglect.ts run        → replay/epn_trades.jsonl + report
//
// Sources: KQ's EP rules (owner's "EP Setup Selection" notes), Zarattini &
// Stamatoudis 2024 ("The Power of Price Action Reading": their trader's
// selection — gap after a neglect period, out of a multi-week range, early in
// the cycle, never the day after another gap — was the part that added
// edge), and Stockbee's "neglect" (EP_family). CTT's own EP9M test found the
// OPPOSITE kind of name (already up big, +40% days, 20%+ gaps) to be a
// lottery ticket; this tests whether the quiet ones are different.
//
// RULES — fixed 9 Oct 2026, before the first run. Numbers the sources give
// are used as given; the rest are INFERRED and fixed here.
//   Gap day g (known at the open; everything else from bars before g):
//     G1  open >= 1.10 x prior close (KQ: gap up 10%+).
//     G2  open >= $5; 20-session average dollar volume before g >= $2M
//         (INFERRED proxy for the notes' $50M+ market cap — neglected names
//         trade thin until the news).
//     G3  not the day after another gap: prior open < 1.06 x the close before
//         it (paper).
//   Neglect, from the 200 sessions before g (all bars present):
//     N1  not already run: 63-session return <= +15% and 126-session return
//         <= +30% (KQ: "best if the stock has not rallied over the past 3-6
//         months") (INFERRED thresholds).
//     N2  a quiet base: the 60-session high-low range <= 60% of its low
//         (INFERRED).
//     N3  out of the base: open > highest high of the prior 60 sessions
//         (KQ: gap above resistance, coming out of a base; paper: breaks a
//         multi-week range).
//     N4  above every average: open > SMA50, SMA100 and SMA200 of the prior
//         closes (KQ: gap above all the MAs, not into a falling 100/200).
//   Entry on g, 1-minute bars, regular hours (KQ: ORH, stop LOD; paper: Pos OR):
//     E1  the first 5 minutes close above their open (paper's "positive
//         opening range").
//     E2  volume: the first 5 minutes trade >= 15% of the 20-session average
//         daily volume (KQ: ideally the whole day's average in the first
//         15-30 minutes; 15% in 5 minutes is that pace) (INFERRED).
//     Fill: first minute from 9:35 whose high > the 5-minute range high;
//     fill = max(range high, that minute's open). Stop = low of day up to and
//     including the fill minute. Skip if fill - stop > 1.5 x ATR14 (KQ: max
//     1-1.5x ADR/ATR). Stop never closer than 0.5% below the fill.
//   Management and costs: identical to qullamaggie.ts (half at the close of
//     session 3, rest to breakeven, rest out on a close below SMA10 from
//     session 3, stop first, 120-session cap, 0.1% a side).
//   Market filter: EP_family calls EPs "mostly market monitor independent",
//     so the MAIN result is WITHOUT the QQQ filter; WITH it is reported second.
//   Account, luck check and PASS: identical to qullamaggie.ts (same-day ties
//     taken largest gap first).

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DATA, loadAdjusted, type BarCache } from './cache';
import {
  polygonKey, prefix, mean, qqqFilter, isRth, etMin, stats, account, spy, pct,
  type M, type Trade,
} from './qullamaggie';

const REPLAY = path.join(DATA, 'replay');
const MIN_DIR = path.join(DATA, 'minute', 'epn');
const SIG_FILE = path.join(REPLAY, 'epn_signals.jsonl');
const LOOK = 200;
const COST = 0.001;

type Sig = { ticker: string; g: number; date: string; gap: number; prevClose: number; atr: number; adv: number; mkt: boolean };

function buildSignals() {
  const c = loadAdjusted();
  const { sessions, syms, O, H, L, C, V } = c;
  const N = sessions.length;
  const mkt = qqqFilter(c);
  const out: Sig[] = [];
  for (let id = 0; id < syms.length; id++) {
    const pc = prefix(C[id], x => x);
    const dv = prefix(C[id], (x, j) => x * V[id][j]);
    const vol = prefix(V[id], x => x);
    for (let g = LOOK + 1; g < N; g++) {
      const o = O[id][g], p = C[id][g - 1];
      if (!(o >= 5) || !(o >= 1.10 * p)) continue;                                // G1 G2
      if (pc.nan[g] - pc.nan[g - LOOK] > 0) continue;                              // 200 bars present
      if (!(mean(dv, g - 20, g - 1) >= 2e6)) continue;                             // G2
      if (!(O[id][g - 1] < 1.06 * C[id][g - 2])) continue;                         // G3
      if (!(p / C[id][g - 64] - 1 <= 0.15 && p / C[id][g - 127] - 1 <= 0.30)) continue; // N1
      let hi = -Infinity, lo = Infinity;
      for (let j = g - 60; j <= g - 1; j++) { hi = Math.max(hi, H[id][j]); lo = Math.min(lo, L[id][j]); }
      if ((hi - lo) / lo > 0.60) continue;                                         // N2
      if (!(o > hi)) continue;                                                     // N3
      if (!(o > mean(pc, g - 50, g - 1) && o > mean(pc, g - 100, g - 1) && o > mean(pc, g - 200, g - 1))) continue; // N4
      let atr = 0;
      for (let j = g - 14; j <= g - 1; j++) atr += Math.max(H[id][j] - L[id][j], Math.abs(H[id][j] - C[id][j - 1]), Math.abs(L[id][j] - C[id][j - 1]));
      out.push({ ticker: syms[id], g, date: sessions[g], gap: o / p - 1, prevClose: p, atr: atr / 14, adv: mean(vol, g - 20, g - 1), mkt: mkt[g - 1] });
    }
  }
  out.sort((a, b) => a.g - b.g || b.gap - a.gap);
  fs.writeFileSync(SIG_FILE, out.map(x => JSON.stringify(x)).join('\n') + '\n');
  console.log(`signals: ${out.length} neglected 10%+ gaps (${out.filter(x => x.mkt).length} with the QQQ filter on), ${sessions[LOOK + 1]} → ${sessions[N - 1]}`);
}

const fileOf = (g: Sig) => path.join(MIN_DIR, g.date.slice(0, 4), `${g.ticker}_${g.date}.json.gz`);
const readSigs = (): Sig[] => fs.readFileSync(SIG_FILE, 'utf8').trim().split('\n').map(l => JSON.parse(l));

async function download() {
  const key = polygonKey();
  const queue = readSigs().filter(g => !fs.existsSync(fileOf(g)));
  console.log(`minute bars to fetch: ${queue.length}`);
  let done = 0, failed = 0;
  const t0 = Date.now();
  /* Six workers pausing 700ms: under ~9 calls/s, because the live app shares this key. */
  const worker = async () => {
    for (let g = queue.shift(); g; g = queue.shift()) {
      const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(g.ticker)}/range/1/minute/${g.date}/${g.date}?adjusted=true&sort=asc&limit=50000&apiKey=${key}`;
      let rows: M[] | null = null;
      for (let a = 0; a < 3 && rows == null; a++) {
        const res = await fetch(url).catch(() => null);
        if (res?.ok) {
          const j = await res.json().catch(() => null);
          rows = (j?.results ?? []).map((r: { t: number; o: number; h: number; l: number; c: number; v: number }) => [r.t, r.o, r.h, r.l, r.c, r.v] as M);
        } else await new Promise(r => setTimeout(r, 1500 * (a + 1)));
      }
      if (rows == null) { failed++; continue; }
      fs.mkdirSync(path.dirname(fileOf(g)), { recursive: true });
      fs.writeFileSync(fileOf(g), zlib.gzipSync(JSON.stringify(rows.filter(r => isRth(r[0])))));
      if (++done % 250 === 0) console.log(`${done} (${failed} failed) ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      await new Promise(r => setTimeout(r, 700));
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  console.log(`download done: ${done} fetched, ${failed} failed`);
}

function simulate(c: BarCache, g: Sig, mins: M[]): Trade | 'noOR' | 'negOR' | 'thin' | 'nofill' | 'widestop' {
  const id = c.idOf.get(g.ticker)!;
  const { O, L, C } = c;
  const or = mins.filter(m => etMin(m[0]) < 575);
  if (or.length === 0) return 'noOR';
  if (!(or[or.length - 1][4] > or[0][1])) return 'negOR';                     // E1
  if (or.reduce((a, m) => a + m[5], 0) < 0.15 * g.adv) return 'thin';         // E2
  const orH = Math.max(...or.map(m => m[2]));
  const k = mins.findIndex(m => etMin(m[0]) >= 575 && m[2] > orH);
  if (k < 0) return 'nofill';
  const fill = Math.max(orH, mins[k][1]);
  let lod = Infinity;
  for (let j = 0; j <= k; j++) lod = Math.min(lod, mins[j][3]);
  if (fill - lod > 1.5 * g.atr) return 'widestop';
  let stop = Math.min(lod, fill * 0.995);
  const e = g.g;
  const exits: [number, number, number][] = [];
  let left = 1;
  for (let j = k + 1; j < mins.length; j++) {
    if (mins[j][3] <= stop) { exits.push([e, 1, Math.min(stop, mins[j][1])]); left = 0; break; }
  }
  const sma10 = (s: number) => { let t = 0; for (let j = s - 9; j <= s; j++) t += C[id][j]; return t / 10; };
  for (let s = e + 1; left > 0 && s < c.sessions.length; s++) {
    if (Number.isNaN(C[id][s])) continue;
    const day = s - e + 1;
    if (O[id][s] <= stop) { exits.push([s, left, O[id][s]]); left = 0; break; }
    if (L[id][s] <= stop) { exits.push([s, left, stop]); left = 0; break; }
    if (day === 3) { exits.push([s, 0.5, C[id][s]]); left = 0.5; stop = Math.max(stop, fill); }
    if (day >= 3 && left > 0 && C[id][s] < sma10(s)) { exits.push([s, left, C[id][s]]); left = 0; break; }
    if (day >= 120) { exits.push([s, left, C[id][s]]); left = 0; break; }
  }
  if (left > 0) exits.push([c.sessions.length - 1, left, C[id][c.sessions.length - 1]]);
  const ret = exits.reduce((a, [, f, p]) => a + f * (p / fill - 1), 0) - 2 * COST;
  return { ticker: g.ticker, date: g.date, ei: e, mkt: g.mkt, r63: g.gap, fill, stop: Math.min(lod, fill * 0.995), exits, ret };
}

function run() {
  const c = loadAdjusted();
  const sigs = readSigs();
  const tally: Record<string, number> = {};
  const trades: Trade[] = [];
  for (const g of sigs) {
    const f = fileOf(g);
    const mins: M[] = fs.existsSync(f) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString()) : [];
    if (!mins.length) { tally.nominute = (tally.nominute ?? 0) + 1; continue; }
    const t = simulate(c, g, mins);
    if (typeof t === 'string') { tally[t] = (tally[t] ?? 0) + 1; continue; }
    trades.push(t);
  }
  fs.writeFileSync(path.join(REPLAY, 'epn_trades.jsonl'), trades.map(t => JSON.stringify(t)).join('\n') + '\n');
  console.log(`signals ${sigs.length} → trades ${trades.length}; skipped`, tally);
  if (!trades.length) return;
  const dates = trades.map(t => t.ei).sort((a, b) => a - b);
  const mid = dates[Math.floor(dates.length / 2)];
  const first = dates[0], last = c.sessions.length - 1;
  for (const [name, ts] of [['WITHOUT filter (main)', trades], ['WITH QQQ filter', trades.filter(t => t.mkt)]] as const) {
    console.log(`\n== ${name}`);
    console.log(` all       ${stats(ts)}`);
    console.log(` 1st half  ${stats(ts.filter(t => t.ei < mid))}`);
    console.log(` 2nd half  ${stats(ts.filter(t => t.ei >= mid))}`);
    for (const y of ['2022', '2023', '2024', '2025', '2026']) console.log(`   ${y}    ${stats(ts.filter(t => t.date.startsWith(y)))}`);
    for (const [label, a, b] of [['whole', first, last], ['1st half', first, mid - 1], ['2nd half', mid, last]] as const) {
      const acct = account(c, ts, a, b);
      const sp = spy(c, a, b);
      const shuffles = Array.from({ length: 200 }, (_, i) => account(c, ts, a, b, i + 7).final).sort((x, y) => x - y);
      console.log(`   account ${label.padEnd(8)} ${c.sessions[a]}→${c.sessions[b]}: ${pct(acct.final / 1e5 - 1)} (maxDD ${(acct.maxDD * 100).toFixed(1)}%) | random-order median ${pct(shuffles[100] / 1e5 - 1)} | SPY ${pct(sp.ret)} (maxDD ${(sp.maxDD * 100).toFixed(1)}%)`);
    }
  }
}

const mode = process.argv[2];
if (mode === 'signals') buildSignals();
else if (mode === 'download') download().catch(e => { console.error(e); process.exit(1); });
else if (mode === 'run') run();
else console.log('usage: ep-neglect.ts signals | download | run');

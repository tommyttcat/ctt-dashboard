// scripts/backtest/qullamaggie.ts — does the Qullamaggie breakout work here?
//
// Run from trade-dash:
//   npx tsx scripts/backtest/qullamaggie.ts signals    → replay/kq_signals.jsonl
//   npx tsx scripts/backtest/qullamaggie.ts download   (minute bars, trigger days only)
//   npx tsx scripts/backtest/qullamaggie.ts run        → replay/kq_trades.jsonl + report
//
// Source: KH's notes on Qullamaggie's breakout ("KQ by KH.pdf") and the
// owner's EDGE 2024 notes. Every number the notes give is used as given;
// every number they leave open is fixed below, marked INFERRED, BEFORE any
// result was seen (9 Oct 2026). Nothing here may be changed after a result
// without saying so in this header.
//
// RULES — fixed 9 Oct 2026, before the first run.
//   Setup, judged at the close of session s (no look-ahead):
//     U1  price >= $5, 20-day average dollar volume >= $20M (notes: $10-20M+),
//         ADR% >= 5 (notes: 5-6% minimum). ADR% = mean(high/low - 1) over 20
//         sessions, as a percent (INFERRED formula/window).
//     U2  a top gainer: 1-, 3- or 6-month return (21/63/126 sessions) at or
//         above the 93rd percentile that day among U1-liquid names (price >=
//         $5, $20M+) (notes: "top 2-10%" / "top 7%").
//     T1  close > SMA50, and SMA10, SMA20, SMA50 each above their own value
//         5 sessions earlier (notes: 10/20/50 rising, rarely below the 50).
//     B1  the 60-session high was 3 to 40 sessions ago (pulled back / went
//         sideways after the move; base no longer than ~8 weeks) (INFERRED).
//     B2  depth: lowest low since that high is within 30% of it (INFERRED).
//     B3  tight: the last 3 sessions' high-low range / close <= 1.5 x ADR
//         (notes: "2-4 tight candles") (INFERRED threshold).
//     B4  higher lows: lowest low of the last 5 sessions > lowest low of the
//         10 sessions before them (notes: higher lows) (INFERRED windows).
//     B5  on its averages, not extended: close >= SMA20 and close <= SMA10 x
//         (1 + ADR) (notes: surfing the 10/20; don't chase) (INFERRED).
//     Every bar of the last 130 sessions present (excludes IPOs < 6 months).
//   Trigger level TR = highest high of the last 3 sessions (the tight range).
//   Entry, session s+1, 1-minute bars, regular hours:
//     first minute whose high > TR; fill = max(TR, that minute's open).
//     Skip if fill - prior close > ATR14 (notes: up more than 1 ATR, don't
//     chase). Stop = low of day up to and including the fill minute (notes:
//     LOD). Skip if fill - stop > ATR14 (notes: stop no more than 1 ATR).
//     Stop never closer than 0.5% below the fill.
//     The entry-day stop counts only on minutes AFTER the fill.
//   Management (notes: sell 1/3-1/2 after 3-5 days, stop to breakeven, trail
//   the rest on a close below the 10-day):
//     sessions 2+ on daily bars: open <= stop exits at the open, else low <=
//     stop exits at the stop. Close of session 3 (entry day = 1): sell half,
//     stop on the rest to the fill (breakeven). From session 3 on, the rest
//     exits at the close of the first session that closes below SMA10.
//     Hard cap 120 sessions.
//   Costs 0.1% per side.
//   Market filter (notes: 10 above 20 and rising, else cash): QQQ SMA10 >
//     SMA20 and SMA10 above its value 5 sessions earlier, at the setup close.
//     Reported WITH (the method as taught) and WITHOUT.
//   Account: $100k, 0.5% of equity risked per trade (notes/EDGE: 0.2-1%),
//     position <= 25% of equity (notes), gross exposure <= 100%, same-day
//     signals taken strongest 3-month return first; random-order median of
//     200 shuffles as the luck check. Marked to market daily. vs SPY buy and
//     hold over the same sessions.
//   PASS (pre-registered): average trade > 0 after costs in BOTH halves of the
//     period (split at the median trade date), AND the account beats SPY in
//     both halves, AND the random-order median beats SPY.
//   Not testable here: earnings-date exclusion, sector/theme judgement, the
//     "anticipation" entries, re-buying after a stop-out.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DATA, loadAdjusted, type BarCache } from './cache';

const REPLAY = path.join(DATA, 'replay');
const MIN_DIR = path.join(DATA, 'minute', 'kq');
const SIG_FILE = path.join(REPLAY, 'kq_signals.jsonl');
const LOOK = 130;
const COST = 0.001;

export function polygonKey(): string {
  const txt = fs.readFileSync(path.resolve(DATA, '../.env.backtest'), 'utf8');
  const m = txt.match(/^POLYGON_API_KEY=(.+)$/m);
  if (!m) throw new Error('POLYGON_API_KEY missing from CTT/.env.backtest');
  return m[1].trim().replace(/^["']|["']$/g, '');
}

type Sig = {
  ticker: string; date: string; s: number; trigDate: string;
  TR: number; atr: number; adr: number; prevClose: number; r63: number; mkt: boolean;
};

// ---- per-ticker rolling helpers -------------------------------------------
export function prefix(a: Float32Array, f: (x: number, j: number) => number): { sum: Float64Array; nan: Int32Array } {
  const n = a.length, sum = new Float64Array(n + 1), nan = new Int32Array(n + 1);
  for (let j = 0; j < n; j++) {
    const v = f(a[j], j);
    sum[j + 1] = sum[j] + (Number.isNaN(v) ? 0 : v);
    nan[j + 1] = nan[j] + (Number.isNaN(v) ? 1 : 0);
  }
  return { sum, nan };
}
export const mean = (p: { sum: Float64Array; nan: Int32Array }, from: number, to: number) =>
  p.nan[to + 1] - p.nan[from] > 0 ? NaN : (p.sum[to + 1] - p.sum[from]) / (to - from + 1);

export function qqqFilter(c: BarCache): boolean[] {
  const id = c.idOf.get('QQQ');
  if (id === undefined) throw new Error('QQQ missing from cache');
  const p = prefix(c.C[id], x => x);
  return c.sessions.map((_, s) => {
    if (s < 25) return false;
    const s10 = mean(p, s - 9, s), s20 = mean(p, s - 19, s), s10b = mean(p, s - 14, s - 5);
    return s10 > s20 && s10 > s10b;
  });
}

// ---- signals -----------------------------------------------------------------
function buildSignals() {
  const c = loadAdjusted();
  const { sessions, syms, O, H, L, C, V } = c;
  const N = sessions.length;
  const mkt = qqqFilter(c);

  /* Pass 1: the 93rd-percentile 1/3/6-month return among liquid names, per day. */
  const rets: number[][][] = Array.from({ length: N }, () => [[], [], []]);
  const pre = syms.map((_, id) => ({
    c: prefix(C[id], x => x),
    dv: prefix(C[id], (x, j) => x * V[id][j]),
    adr: prefix(H[id], (x, j) => x / L[id][j] - 1),
  }));
  for (let id = 0; id < syms.length; id++) {
    for (let s = LOOK; s < N - 1; s++) {
      const cl = C[id][s];
      if (!(cl >= 5)) continue;
      const dv = mean(pre[id].dv, s - 19, s);
      if (!(dv >= 20e6)) continue;
      [21, 63, 126].forEach((k, i) => { const r = cl / C[id][s - k] - 1; if (Number.isFinite(r)) rets[s][i].push(r); });
    }
  }
  const p93 = rets.map(day => day.map(arr => {
    if (arr.length < 50) return Infinity;
    const a = arr.slice().sort((x, y) => x - y);
    return a[Math.floor(0.93 * (a.length - 1))];
  }));

  /* Pass 2: the full setup. */
  const out: Sig[] = [];
  for (let id = 0; id < syms.length; id++) {
    const P = pre[id];
    for (let s = LOOK; s < N - 1; s++) {
      const cl = C[id][s];
      if (!(cl >= 5)) continue;
      if (P.c.nan[s + 1] - P.c.nan[s - LOOK + 1] > 0) continue;             // every bar present
      if (Number.isNaN(O[id][s + 1])) continue;                             // trades on trigger day
      const dv = mean(P.dv, s - 19, s);
      if (!(dv >= 20e6)) continue;                                           // U1 liquidity
      const adr = mean(P.adr, s - 19, s);
      if (!(adr >= 0.05)) continue;                                          // U1 ADR
      const r = [21, 63, 126].map(k => cl / C[id][s - k] - 1);
      if (!(r[0] >= p93[s][0] || r[1] >= p93[s][1] || r[2] >= p93[s][2])) continue; // U2
      const sma = (n: number, at: number) => mean(P.c, at - n + 1, at);
      const s10 = sma(10, s), s20 = sma(20, s), s50 = sma(50, s);
      if (!(cl > s50 && s10 > sma(10, s - 5) && s20 > sma(20, s - 5) && s50 > sma(50, s - 5))) continue; // T1
      let hi = -Infinity, hiAt = -1;
      for (let j = s - 59; j <= s; j++) if (H[id][j] >= hi) { hi = H[id][j]; hiAt = j; }
      const d = s - hiAt;
      if (d < 3 || d > 40) continue;                                         // B1
      let lowSince = Infinity;
      for (let j = hiAt + 1; j <= s; j++) lowSince = Math.min(lowSince, L[id][j]);
      if ((hi - lowSince) / hi > 0.30) continue;                             // B2
      const h3 = Math.max(H[id][s], H[id][s - 1], H[id][s - 2]);
      const l3 = Math.min(L[id][s], L[id][s - 1], L[id][s - 2]);
      if ((h3 - l3) / cl > 1.5 * adr) continue;                              // B3
      let l5 = Infinity, l10 = Infinity;
      for (let j = s - 4; j <= s; j++) l5 = Math.min(l5, L[id][j]);
      for (let j = s - 14; j <= s - 5; j++) l10 = Math.min(l10, L[id][j]);
      if (!(l5 > l10)) continue;                                             // B4
      if (!(cl >= s20 && cl <= s10 * (1 + adr))) continue;                   // B5
      let atr = 0;
      for (let j = s - 13; j <= s; j++) atr += Math.max(H[id][j] - L[id][j], Math.abs(H[id][j] - C[id][j - 1]), Math.abs(L[id][j] - C[id][j - 1]));
      atr /= 14;
      if (!(H[id][s + 1] > h3)) continue;                                    // triggered at all (daily check; minute bars decide the fill)
      out.push({ ticker: syms[id], date: sessions[s], s, trigDate: sessions[s + 1], TR: h3, atr, adr, prevClose: cl, r63: r[1], mkt: mkt[s] });
    }
  }
  out.sort((a, b) => a.s - b.s || b.r63 - a.r63);
  fs.writeFileSync(SIG_FILE, out.map(x => JSON.stringify(x)).join('\n') + '\n');
  const withMkt = out.filter(x => x.mkt).length;
  console.log(`signals: ${out.length} triggered setups (${withMkt} with the QQQ filter on), ${sessions[LOOK]} → ${sessions[N - 2]}`);
}

// ---- minute bars (trigger day only) ----------------------------------------------
export type M = [number, number, number, number, number, number];
const fileOf = (g: Sig) => path.join(MIN_DIR, g.trigDate.slice(0, 4), `${g.ticker}_${g.trigDate}.json.gz`);
const etFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' });
export const etMin = (ms: number) => { const p = Object.fromEntries(etFmt.formatToParts(new Date(ms)).map(x => [x.type, x.value])); return (+p.hour % 24) * 60 + +p.minute; };
export const isRth = (ms: number) => { const m = etMin(ms); return m >= 570 && m < 960; };
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
      const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(g.ticker)}/range/1/minute/${g.trigDate}/${g.trigDate}?adjusted=true&sort=asc&limit=50000&apiKey=${key}`;
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

// ---- trades ------------------------------------------------------------------------
export type Trade = {
  /** r63 doubles as the same-day ranking key (EP test: the gap size). */
  ticker: string; date: string; ei: number; mkt: boolean; r63: number;
  fill: number; stop: number;
  /** [session index, fraction of the position sold, price] */
  exits: [number, number, number][];
  ret: number;   // whole-trade return after costs, fraction
};

function simulate(c: BarCache, g: Sig, mins: M[]): Trade | 'nofill' | 'chase' | 'widestop' {
  const id = c.idOf.get(g.ticker)!;
  const { O, H, L, C } = c;
  const e = g.s + 1;
  let k = mins.findIndex(m => m[2] > g.TR);
  if (k < 0) return 'nofill';
  const fill = Math.max(g.TR, mins[k][1]);
  if (fill - g.prevClose > g.atr) return 'chase';
  let lod = Infinity;
  for (let j = 0; j <= k; j++) lod = Math.min(lod, mins[j][3]);
  if (fill - lod > g.atr) return 'widestop';
  let stop = Math.min(lod, fill * 0.995);
  const exits: [number, number, number][] = [];
  let left = 1;

  // Entry day: only minutes after the fill can stop it.
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
  if (left > 0) exits.push([c.sessions.length - 1, left, C[id][c.sessions.length - 1]]); // still open at the data's end
  const ret = exits.reduce((a, [, f, p]) => a + f * (p / fill - 1), 0) - 2 * COST;
  return { ticker: g.ticker, date: g.trigDate, ei: e, mkt: g.mkt, r63: g.r63, fill, stop: Math.min(lod, fill * 0.995), exits, ret };
}

export const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`;
export function stats(ts: Trade[]) {
  if (!ts.length) return 'n=0';
  const r = ts.map(t => t.ret), w = r.filter(x => x > 0), l = r.filter(x => x <= 0);
  const avg = r.reduce((a, b) => a + b, 0) / r.length;
  const med = r.slice().sort((a, b) => a - b)[Math.floor(r.length / 2)];
  const aw = w.length ? w.reduce((a, b) => a + b, 0) / w.length : 0, al = l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0;
  const big = r.filter(x => x >= 0.2).length;
  return `n=${r.length} avg ${pct(avg)} med ${pct(med)} win ${(100 * w.length / r.length).toFixed(0)}% avgW ${pct(aw)} avgL ${pct(al)} +20%+: ${big}`;
}

/** Daily mark-to-market account. order: 'rank' or a seeded shuffle of same-day signals. */
export function account(c: BarCache, trades: Trade[], from: number, to: number, seed?: number) {
  let rnd = seed ?? 1;
  const rand = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
  const byDay = new Map<number, Trade[]>();
  for (const t of trades) if (t.ei >= from && t.ei <= to) (byDay.get(t.ei) ?? byDay.set(t.ei, []).get(t.ei)!).push(t);
  let cash = 100000;
  type Pos = { t: Trade; sh: number; id: number };
  let open: Pos[] = [];
  let peak = 100000, maxDD = 0, eq = 100000;
  const curve: number[] = [];
  for (let s = from; s <= to; s++) {
    // exits scheduled today (partials and finals)
    for (const p of open) for (const [es, f, px] of p.t.exits) if (es === s) cash += p.sh * f * px * (1 - COST);
    open = open.filter(p => p.t.exits.reduce((m, x) => Math.max(m, x[0]), 0) > s);
    // entries today
    let todays = byDay.get(s) ?? [];
    todays = seed == null ? todays.slice().sort((a, b) => b.r63 - a.r63) : todays.map(t => [rand(), t] as const).sort((a, b) => a[0] - b[0]).map(x => x[1]);
    const mark = () => cash + open.reduce((a, p) => {
      const sold = p.t.exits.filter(x => x[0] <= s).reduce((m, x) => m + x[1], 0);
      const px = c.C[p.id][s]; return a + p.sh * (1 - sold) * (Number.isNaN(px) ? p.t.fill : px);
    }, 0);
    for (const t of todays) {
      const equity = mark();
      const risk = 0.005 * equity, per = t.fill - t.stop;
      let sh = risk / per;
      sh = Math.min(sh, (0.25 * equity) / t.fill);
      const cost = sh * t.fill * (1 + COST);
      if (cost > cash || sh <= 0) continue;            // no margin: gross exposure <= 100%
      cash -= cost;
      const p = { t, sh, id: c.idOf.get(t.ticker)! };
      open.push(p);
      // same-day exits (stopped on the entry day)
      for (const [es, f, px] of t.exits) if (es === s) cash += sh * f * px * (1 - COST);
      if (t.exits.reduce((m, x) => Math.max(m, x[0]), 0) <= s) open = open.filter(q => q !== p);
    }
    eq = mark();
    peak = Math.max(peak, eq); maxDD = Math.max(maxDD, 1 - eq / peak);
    curve.push(eq);
  }
  return { final: eq, maxDD, curve };
}

export function spy(c: BarCache, from: number, to: number) {
  const id = c.idOf.get('SPY')!;
  let peak = 0, dd = 0;
  for (let s = from; s <= to; s++) { const x = c.C[id][s]; peak = Math.max(peak, x); dd = Math.max(dd, 1 - x / peak); }
  return { ret: c.C[id][to] / c.C[id][from] - 1, maxDD: dd };
}

function run() {
  const c = loadAdjusted();
  const sigs = readSigs();
  const tally: Record<string, number> = {};
  const trades: Trade[] = [];
  for (const g of sigs) {
    const f = fileOf(g);
    if (!fs.existsSync(f)) { tally.nominute = (tally.nominute ?? 0) + 1; continue; }
    const mins: M[] = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString());
    if (!mins.length) { tally.nominute = (tally.nominute ?? 0) + 1; continue; }
    const t = simulate(c, g, mins);
    if (typeof t === 'string') { tally[t] = (tally[t] ?? 0) + 1; continue; }
    trades.push(t);
  }
  fs.writeFileSync(path.join(REPLAY, 'kq_trades.jsonl'), trades.map(t => JSON.stringify(t)).join('\n') + '\n');
  console.log(`signals ${sigs.length} → trades ${trades.length}; skipped`, tally);

  const dates = trades.map(t => t.ei).sort((a, b) => a - b);
  const mid = dates[Math.floor(dates.length / 2)];
  const first = c.sessions.findIndex(d => d >= trades.reduce((m, t) => (t.date < m ? t.date : m), '9999'));
  const last = c.sessions.length - 1;
  for (const [name, ts] of [['WITH QQQ filter (as taught)', trades.filter(t => t.mkt)], ['WITHOUT filter', trades]] as const) {
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

/* Dispatch only when run directly, so ep-neglect.ts can import the helpers. */
const mode = process.argv[1]?.endsWith('qullamaggie.ts') ? process.argv[2] : '__import__';
if (mode === '__import__') { /* imported */ }
else if (mode === 'signals') buildSignals();
else if (mode === 'download') download().catch(e => { console.error(e); process.exit(1); });
else if (mode === 'run') run();
else console.log('usage: qullamaggie.ts signals | download | run');

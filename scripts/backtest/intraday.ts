// scripts/backtest/intraday.ts — do intraday entries fix the weak part?
//
// Run from trade-dash:
//   npx tsx scripts/backtest/intraday.ts download   (resumable, ~8/s, shared key)
//   npx tsx scripts/backtest/intraday.ts entries    → replay/intraday_entries.jsonl
// then: npx tsx scripts/backtest/portfolio.ts intraday
//
// Every test so far said the same thing: the scans find movers, and the
// next-open entry gets shaken out before the run. Daily bars cannot test a
// better entry, because they cannot say whether the stop came before or after
// a fill. Minute bars can.
//
// RULES — fixed 25 Sep 2026 BEFORE any minute bar was downloaded.
//   Signals   green Stocks in Play / Daily rows (edgeTier) and green Swing rows
//             (swingTier), 26 Sep 2022 onward — the Model Book's next-open
//             universe. EP9M keeps its dip entry and is not re-tested here.
//   Levels    H / L = the signal day's high and low. Card stop as the Model
//             Book: plan stop when tradeable, else L.
//   Session   regular hours only, 9:30-16:00 ET. Opening range = 9:30-9:59.
//   Entries
//     E0  next open (the Model Book today) — the baseline, recomputed here
//     E1  ORB: session 1 only. First minute from 10:00 whose high clears the
//         opening-range high; fill = max(OR high, that minute's open).
//         Stop = card stop.
//     E2  ORB + volume: E1, and cumulative volume at that minute at least
//         1.5x the average daily volume pro rata (elapsed minutes / 390).
//     E3  signal-day high: first minute in sessions 1-5 whose high reaches H;
//         fill = max(H, that minute's open). Stop = card stop.
//     E4  classic ORB: E1's fill with the stop at the opening-range low
//         (never closer than 0.5% of the fill).
//     No fill if the fill is at or below the stop.
//   Entry day the stop counts only if a minute AFTER the fill reaches it —
//             the one thing daily bars could not tell us. Every later session
//             uses the daily bars and the usual rules (gap through = open).
//   Exit      the stop, or the close of the 20th session held (the Model Book).
//   Pass      an entry is better only if, inside the same 10-slot account,
//             it beats SPY in BOTH halves AND its random-order median beats
//             SPY — the bar every earlier idea failed.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DATA, loadAdjusted } from './cache';
import { edgeTier, swingTier } from '@/lib/scans/edge';
import { orbTrigger } from '@/lib/orb';

const REPLAY = path.join(DATA, 'replay');
const MIN_DIR = path.join(DATA, 'minute');
const START = '2022-09-26';
const WINDOW = 5;
const MIN_RISK_PCT = 0.5;

// Key from CTT/.env.backtest only — never the app's env files (they carry production KV).
function polygonKey(): string {
  const txt = fs.readFileSync(path.resolve(DATA, '../.env.backtest'), 'utf8');
  const m = txt.match(/^POLYGON_API_KEY=(.+)$/m);
  if (!m) throw new Error('POLYGON_API_KEY missing from CTT/.env.backtest');
  return m[1].trim().replace(/^["']|["']$/g, '');
}

type Sig = {
  scan: 'scanner' | 'swing'; ticker: string; date: string; s: number;
  H: number; L: number; cardStop: number; avgVol: number | null; rs: number;
};

const read = (f: string) => fs.readFileSync(path.join(REPLAY, f), 'utf8').trim().split('\n').map(l => JSON.parse(l));

function signals(): Sig[] {
  const out: Sig[] = [];
  for (const e of read('scanner_registry.jsonl')) {
    if (e.date < START || edgeTier(e) !== 'green') continue;
    const stop = e.plan?.tradeable && e.plan.stop != null ? e.plan.stop : e.dayLow;
    out.push({ scan: 'scanner', ticker: e.ticker, date: e.date, s: e.sIdx, H: e.dayHigh, L: e.dayLow, cardStop: stop, avgVol: e.avgVol ?? null, rs: e.rsRating ?? -1 });
  }
  for (const e of read('swing_registry.jsonl')) {
    if (e.date < START || swingTier(e) !== 'green') continue;
    const stop = (e.plan?.tradeable ? e.plan?.stop : null) ?? e.dayLow;
    const avgVol = typeof e.avgDollarVolM === 'number' && e.price > 0 ? (e.avgDollarVolM * 1e6) / e.price : null;
    out.push({ scan: 'swing', ticker: e.ticker, date: e.date, s: e.sIdx, H: e.dayHigh, L: e.dayLow, cardStop: stop, avgVol, rs: e.rsRating ?? -1 });
  }
  return out;
}

// ---- download ------------------------------------------------------------
// One call per signal: sessions s+1..s+5 of 1-minute bars, regular hours kept.
type M = [number, number, number, number, number, number]; // t o h l c v
const fileOf = (g: Sig) => path.join(MIN_DIR, g.date.slice(0, 4), `${g.ticker}_${g.date}.json.gz`);

async function download() {
  const key = polygonKey();
  const cache = loadAdjusted();
  const sigs = signals();
  fs.mkdirSync(MIN_DIR, { recursive: true });
  let done = 0, skipped = 0, failed = 0;
  const t0 = Date.now();
  /* Six workers, each pausing 700ms after a call: under ~9 calls/s in total,
     because the live scanners share this key. */
  const queue = [...sigs];
  const worker = async () => { for (let g = queue.shift(); g; g = queue.shift()) await one(g); };
  const one = async (g: Sig) => {
    const f = fileOf(g);
    if (fs.existsSync(f)) { skipped++; return; }
    const from = cache.sessions[g.s + 1], to = cache.sessions[Math.min(cache.sessions.length - 1, g.s + WINDOW)];
    if (!from) return;
    const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(g.ticker)}/range/1/minute/${from}/${to}?adjusted=true&sort=asc&limit=50000&apiKey=${key}`;
    let rows: M[] | null = null;
    for (let attempt = 0; attempt < 3 && rows == null; attempt++) {
      const res = await fetch(url).catch(() => null);
      if (res?.ok) {
        const j = await res.json().catch(() => null);
        rows = (j?.results ?? []).map((r: { t: number; o: number; h: number; l: number; c: number; v: number }) => [r.t, r.o, r.h, r.l, r.c, r.v] as M);
      } else await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
    if (rows == null) { failed++; return; }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, zlib.gzipSync(JSON.stringify(rows.filter(r => isRth(r[0])))));
    done++;
    if (done % 250 === 0) console.log(`${done + skipped}/${sigs.length} (${failed} failed) ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    await new Promise(r => setTimeout(r, 700));
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  console.log(`download done: ${done} new, ${skipped} cached, ${failed} failed of ${sigs.length}`);
}

// ---- time helpers (ET) -------------------------------------------------------
const etParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
function et(ms: number): { day: string; min: number } {
  const p = Object.fromEntries(etParts.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, min: (+p.hour % 24) * 60 + +p.minute };
}
const OPEN = 9 * 60 + 30, CLOSE = 16 * 60;
function isRth(ms: number) { const { min } = et(ms); return min >= OPEN && min < CLOSE; }

// ---- entries -----------------------------------------------------------------
export type Entry = { ei: number; fill: number; stop: number; postFillLow: number } | null;

function entries() {
  const cache = loadAdjusted();
  const { sessions, idOf, O } = cache;
  const out = fs.createWriteStream(path.join(REPLAY, 'intraday_entries.jsonl'));
  const tally: Record<string, number> = {};
  let missing = 0;

  for (const g of signals()) {
    const id = idOf.get(g.ticker);
    const f = fileOf(g);
    if (id === undefined || !fs.existsSync(f)) { missing++; continue; }
    const mins: M[] = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString());
    // Group by session index.
    const bySess = new Map<number, M[]>();
    for (const m of mins) {
      const si = sessions.indexOf(et(m[0]).day, g.s + 1);
      if (si < 0 || si > g.s + WINDOW) continue;
      (bySess.get(si) ?? bySess.set(si, []).get(si)!).push(m);
    }
    const s1 = g.s + 1;
    const lowAfter = (arr: M[], k: number) => arr.slice(k).reduce((a, m) => Math.min(a, m[3]), Infinity);
    const floor = (fill: number, stop: number) => (fill - stop < fill * MIN_RISK_PCT / 100 ? fill * (1 - MIN_RISK_PCT / 100) : stop);
    const mk = (ei: number, fill: number, stop: number, arr: M[], k: number): Entry =>
      fill > stop ? { ei, fill, stop: floor(fill, stop), postFillLow: lowAfter(arr, k) } : null;

    const res: Record<string, Entry> = {};
    const day1 = bySess.get(s1) ?? [];

    // E0 next open (daily open, the Model Book's fill).
    res.E0 = O[id][s1] > 0 ? mk(s1, O[id][s1], g.cardStop, day1, 0) : null;

    // Opening range on session 1.
    const or = day1.filter(m => et(m[0]).min < OPEN + 30);
    const orH = or.length ? Math.max(...or.map(m => m[2])) : NaN;
    const orL = or.length ? Math.min(...or.map(m => m[3])) : NaN;
    let e1: Entry = null, e2: Entry = null, e4: Entry = null;
    if (or.length) {
      let cum = or.reduce((a, m) => a + m[5], 0);
      for (let k = 0; k < day1.length; k++) {
        const m = day1[k], tm = et(m[0]).min;
        if (tm < OPEN + 30) continue;
        cum += m[5];
        if (m[2] > orH) {
          const fill = Math.max(orH, m[1]);
          if (!e1) { e1 = mk(s1, fill, g.cardStop, day1, k); e4 = mk(s1, fill, orL, day1, k); }
          const pace = g.avgVol != null ? g.avgVol * ((tm - OPEN + 1) / 390) : null;
          if (pace != null && cum >= 1.5 * pace) { e2 = mk(s1, fill, g.cardStop, day1, k); break; }
          if (pace == null) break;
        }
      }
    }
    res.E1 = e1; res.E2 = e2; res.E4 = e4;

    // E2 again through lib/orb — the function the live Model Book v2 trades.
    // Must equal E2 on every signal; the entries run checks it.
    const o = g.avgVol != null ? orbTrigger(day1, g.avgVol) : null;
    res.E2L = o && o.fill > g.cardStop ? { ei: s1, fill: o.fill, stop: floor(o.fill, g.cardStop), postFillLow: o.postFillLow } : null;

    /* Sensitivity (added after E2 passed, to test it — not new candidates):
       the same rule with the opening range at 15/30/60 minutes and the
       volume bar at 1.0/1.25/1.5/2.0/3.0x. A real edge survives its
       neighbours; a fluke lives on one setting. */
    for (const orMin of [15, 30, 60]) {
      const orB = day1.filter(m => et(m[0]).min < OPEN + orMin);
      if (!orB.length) continue;
      const hi = Math.max(...orB.map(m => m[2]));
      for (const mult of [1.0, 1.25, 1.5, 2.0, 3.0]) {
        const name = `S_or${orMin}_v${mult}`;
        res[name] = null;
        if (g.avgVol == null) continue;
        let cum = orB.reduce((a, m) => a + m[5], 0);
        for (let k = 0; k < day1.length; k++) {
          const m = day1[k], tm = et(m[0]).min;
          if (tm < OPEN + orMin) continue;
          cum += m[5];
          if (m[2] > hi && cum >= mult * g.avgVol * ((tm - OPEN + 1) / 390)) { res[name] = mk(s1, Math.max(hi, m[1]), g.cardStop, day1, k); break; }
        }
      }
    }

    // E3 signal-day high, sessions 1-5.
    res.E3 = null;
    for (let si = s1; si <= g.s + WINDOW && !res.E3; si++) {
      const arr = bySess.get(si) ?? [];
      for (let k = 0; k < arr.length; k++) {
        if (arr[k][2] >= g.H) { res.E3 = mk(si, Math.max(g.H, arr[k][1]), g.cardStop, arr, k); break; }
      }
    }

    for (const [k, v] of Object.entries(res)) tally[`${k}:${v ? 'fill' : 'none'}`] = (tally[`${k}:${v ? 'fill' : 'none'}`] || 0) + 1;
    out.write(JSON.stringify({ scan: g.scan, ticker: g.ticker, date: g.date, s: g.s, rs: g.rs, entries: res }) + '\n');
  }
  out.end();
  console.log('entries written; missing minute files:', missing, JSON.stringify(tally));
}

const mode = process.argv[2];
if (mode === 'download') download();
else if (mode === 'entries') entries();
else console.log('usage: intraday.ts download | entries');

// scripts/backtest/winners.ts — what did the big winners look like BEFORE they ran?
//
// Run from trade-dash:  npx tsx scripts/backtest/winners.ts
// Local data only (backtest-data), no network, no KV.
//
// Every earlier test tuned entries, exits, stops and filters around the scans'
// existing picks, and all of them came out near SPY once luck was removed.
// This one goes after selection itself, the O'Neil way: find every stock that
// doubled, describe it on the day BEFORE the move with what was knowable then,
// and ask which traits separate it from the thousands of look-alikes that went
// nowhere. "History repeats" is the hypothesis, so the test is whether a trait
// learned on the first two-thirds of the period shows up again in the last
// third, which it never saw.
//
// RULES — fixed 27 Sep 2026 BEFORE running.
//   Samples   every 5th session from 2022-09-26 to the last session with 60
//             sessions after it. One row per stock per sample date.
//   Universe  common stock (reference type CS), close >= $3, 20-day average
//             dollar volume >= $2M, at least 60 sessions of history.
//   Winner    the highest close in the next 60 sessions is at least 2x the
//             sample-day close (doubled within about three months). fwd60 =
//             return to the last close in that window (delistings included:
//             their last close is the outcome).
//   Features  all as of the sample-day close:
//     rs        percentile of 0.4*r63 + 0.2*(r126 + r189 + r252) in the day's
//               universe (the site's weighting; missing legs re-weighted)
//     r21 r63 r126, offHigh (% under the 252-day high), aboveLow (% over the
//     252-day low), trend (count of close>50d, 50d>200d, close>200d), adr20,
//     dvol (20-day $ volume), price, rvol (volume / 50-day average), udv
//     (50-day up-day volume / down-day volume), tight (10-day range in ADRs),
//     age (sessions since listing; old listings = 9999), ep20 (largest 1-day
//     gain in 20 sessions on 2x+ volume), mcap (close x latest year-end shares),
//     revYoY, revAccel, epsYoY (latest quarter FILED by that day vs the same
//     quarter a year earlier), shortPct (short interest settled 10+ days
//     earlier / shares), sectorR63 (mean r63 of the stock's SIC group, 5+ names).
//   Split     train = sample dates in the first two-thirds, test = the rest.
//   Stage 1   deciles set on train; per decile the winner rate, lift over the
//             half's base rate, and mean / median fwd60, in both halves. A
//             feature REPEATS when its best train decile (n >= 500) has lift
//             >= 2.0 in train and >= 1.5 in test.
//   Stage 2   selected on TRAIN only: every feature whose best train decile
//             has lift >= 2.0. Score = how many of those deciles a row sits in.
//             Scored on TEST: winner rate and fwd60 per score level, and the
//             top 20 rows per sample date by score (RS breaks ties).
//   PASS      on TEST, the top-20-a-week list has a winner rate >= 3x the base
//             rate AND a mean AND median fwd60 above the universe's. Then it
//             goes to the account test; until then it is a description.
//   RESULT    fail (27 Sep 2026): the doubling traits repeat but pick lottery
//             tickets — top 20 a week, test: 15% doubled, fwd60 -8.6% / -23%.
//
// EXCESS MODE (npx tsx scripts/backtest/winners.ts excess) — RULES fixed
// 27 Sep 2026 BEFORE running, AFTER the raw decile fwd60 of the run above
// (both halves) had been seen. That contaminates this test somewhat; the
// same-week measure below has not been computed before, and anything that
// passes still has to prove itself in the live forward record.
//   Measure   each row against the other stocks the SAME week: x = fwd60
//             minus that date's universe median fwd60, and rk = the row's
//             fwd60 percentile within that date (50 = the typical stock).
//             Market timing drops out; only selection is left.
//   Features  the 21 above, plus young (listed within the last 252 sessions,
//             for listings that began after the data starts).
//   Stage A   deciles set on train. A decile SELECTS when, in train, mean rk
//             >= 55 and mean x > 0 and median x > 0. It HOLDS when the same
//             decile in test has mean rk >= 53, mean x > 0 and median x > 0.
//   Stage B   score = number of train-selected deciles a row sits in (chosen
//             on train only); top 20 per sample date by score, RS breaks ties.
//   PASS      on TEST, and in each chronological half of TEST: the top 20 a
//             week have mean x > 0, median x > 0 and mean rk >= 55.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DATA, loadAdjusted } from './cache';

const START = '2022-09-26';
const STEP = 5;
const FWD = 60;
const MIN_PRICE = 3;
const MIN_DVOL = 2e6;
const MIN_HIST = 60;
const WIN_MULT = 2;

const gz = (p: string) => JSON.parse(zlib.gunzipSync(fs.readFileSync(p)).toString());
const exists = (p: string) => fs.existsSync(p);

type Row = { d: number; t: string; half: 0 | 1; win: boolean; fwd: number; f: Record<string, number> };

function main() {
  const t0 = Date.now();
  const c = loadAdjusted();
  const { sessions, syms, H, L, C, V } = c;
  const N = sessions.length;
  const s0 = sessions.findIndex(d => d >= START);
  const sampleIdx: number[] = [];
  for (let s = s0; s + FWD < N; s += STEP) sampleIdx.push(s);
  const cutS = sampleIdx[Math.floor(sampleIdx.length * 2 / 3)];
  const isSample = new Set(sampleIdx);

  // Reference: common stock only.
  const ref = gz(path.join(DATA, 'reference', 'tickers.json.gz'));
  const cs = new Set<string>((ref.rows as [string, string][]).filter(r => r[1] === 'CS').map(r => r[0]));

  const rows: Row[] = [];
  const dataStart = 5; // a first bar after this session index is a genuine new listing
  for (let id = 0; id < syms.length; id++) {
    const T = syms[id];
    if (!cs.has(T)) continue;
    const idx: number[] = [];
    for (let j = 0; j < N; j++) if (!Number.isNaN(C[id][j]) && C[id][j] > 0) idx.push(j);
    if (idx.length < MIN_HIST + 1) continue;
    const n = idx.length;
    const cl = idx.map(j => C[id][j]), hi = idx.map(j => H[id][j]), lo = idx.map(j => L[id][j]), vo = idx.map(j => V[id][j]);

    const newListing = idx[0] > dataStart;

    // Fundamentals, short interest, shares, sector — loaded lazily per ticker.
    const qf = path.join(DATA, 'fundamentals', 'quarterly', `${T}.json.gz`);
    const quarters: { end: string; filed: string; rev: number | null; eps: number | null }[] = exists(qf) ? (gz(qf).q ?? []) : [];
    const sf = path.join(DATA, 'fundamentals', 'shares', `${T}.json.gz`);
    const shares: [string, number, string | null][] = exists(sf)
      ? Object.entries(gz(sf) as Record<string, { share_class_shares_outstanding?: number; weighted_shares_outstanding?: number; sic_description?: string }>)
          .map(([d, v]) => [d, v.share_class_shares_outstanding ?? v.weighted_shares_outstanding ?? NaN, v.sic_description ?? null] as [string, number, string | null])
          .filter(x => x[1] > 0).sort((a, b) => a[0].localeCompare(b[0]))
      : [];
    const shf = path.join(DATA, 'lookups', 'shorts', `${T}.json.gz`);
    const shorts: [string, number][] = exists(shf) ? gz(shf) : [];

    for (let i = MIN_HIST; i < n; i++) {
      const s = idx[i];
      if (!isSample.has(s)) continue;
      const price = cl[i];
      let dv = 0; for (let k = i - 19; k <= i; k++) dv += cl[k] * vo[k]; dv /= 20;
      if (price < MIN_PRICE || dv < MIN_DVOL) continue;

      // Label.
      let mx = 0, lastC = NaN;
      for (let j = s + 1; j <= s + FWD && j < N; j++) { const x = C[id][j]; if (!Number.isNaN(x) && x > 0) { mx = Math.max(mx, x); lastC = x; } }
      if (Number.isNaN(lastC)) continue;

      const ret = (k: number) => (i - k >= 0 ? price / cl[i - k] - 1 : NaN);
      const w = Math.min(252, i + 1);
      let hh = -Infinity, ll = Infinity; for (let k = i - w + 1; k <= i; k++) { hh = Math.max(hh, hi[k]); ll = Math.min(ll, lo[k]); }
      const sma = (m: number) => { if (i + 1 < m) return NaN; let a = 0; for (let k = i - m + 1; k <= i; k++) a += cl[k]; return a / m; };
      const s50 = sma(50), s200 = sma(200);
      let adr = 0; for (let k = i - 19; k <= i; k++) adr += (hi[k] - lo[k]) / cl[k]; adr = (adr / 20) * 100;
      let av50 = 0, up = 0, dn = 0; for (let k = i - 49; k <= i; k++) { av50 += vo[k]; if (k > 0 && cl[k] > cl[k - 1]) up += vo[k]; else if (k > 0) dn += vo[k]; } av50 /= 50;
      let h10 = -Infinity, l10 = Infinity; for (let k = i - 9; k <= i; k++) { h10 = Math.max(h10, hi[k]); l10 = Math.min(l10, lo[k]); }
      let ep = 0; for (let k = Math.max(1, i - 19); k <= i; k++) { if (vo[k] >= 2 * av50) ep = Math.max(ep, cl[k] / cl[k - 1] - 1); }

      const date = sessions[s];
      const f: Record<string, number> = {
        r21: ret(21), r63: ret(63), r126: ret(126),
        _r189: ret(189), _r252: ret(252),
        offHigh: (hh - price) / hh * 100,
        aboveLow: (price / ll - 1) * 100,
        trend: (price > s50 ? 1 : 0) + (s50 > s200 ? 1 : 0) + (price > s200 ? 1 : 0),
        adr20: adr,
        dvol: Math.log10(dv),
        price: Math.log10(price),
        rvol: av50 > 0 ? vo[i] / av50 : NaN,
        udv: dn > 0 ? up / dn : NaN,
        tight: adr > 0 ? ((h10 - l10) / price * 100) / adr : NaN,
        age: newListing ? i : 9999,
        ep20: ep * 100,
        young: newListing && i < 252 ? 1 : 0,
      };
      // Shares, market cap, sector — the latest year-end snapshot on or before the date.
      let sh: [string, number, string | null] | undefined;
      for (const x of shares) if (x[0] <= date) sh = x;
      f.mcap = sh ? Math.log10(price * sh[1]) : NaN;
      (f as Record<string, unknown>)._sic = sh?.[2] ?? (shares[0]?.[2] ?? null);
      // Fundamentals filed by the date.
      const known = quarters.filter(q => q.filed && q.filed <= date && q.end).sort((a, b) => b.end.localeCompare(a.end));
      const yoy = (q: typeof known[number] | undefined, key: 'rev' | 'eps') => {
        if (!q || q[key] == null) return NaN;
        const e = Date.parse(q.end);
        const prev = known.find(p => Math.abs(Date.parse(p.end) - (e - 365 * 864e5)) < 25 * 864e5);
        if (!prev || prev[key] == null) return NaN;
        if (key === 'rev') return prev.rev! > 0 ? (q.rev! / prev.rev! - 1) * 100 : NaN;
        return Math.abs(prev.eps!) >= 0.01 ? ((q.eps! - prev.eps!) / Math.abs(prev.eps!)) * 100 : NaN;
      };
      f.revYoY = yoy(known[0], 'rev');
      f.revAccel = f.revYoY - yoy(known[1], 'rev');
      f.epsYoY = yoy(known[0], 'eps');
      // Short interest settled at least 10 days before the date.
      const cutoff = new Date(Date.parse(date) - 10 * 864e5).toISOString().slice(0, 10);
      let si = NaN; for (const [d, v] of shorts) { if (d <= cutoff) si = v; else break; }
      f.shortPct = sh && si > 0 ? (si / sh[1]) * 100 : NaN;

      rows.push({ d: s, t: T, half: s < cutS ? 0 : 1, win: mx >= WIN_MULT * price, fwd: (lastC / price - 1) * 100, f });
    }
  }


  // RS percentile and sector r63, per sample date.
  const byDate = new Map<number, Row[]>();
  for (const r of rows) (byDate.get(r.d) ?? byDate.set(r.d, []).get(r.d)!).push(r);
  for (const list of byDate.values()) {
    const raw = list.map(r => {
      const legs: [number, number][] = [[0.4, r.f.r63], [0.2, r.f.r126], [0.2, r.f._r189], [0.2, r.f._r252]];
      const ok = legs.filter(l => Number.isFinite(l[1]));
      const wsum = ok.reduce((a, l) => a + l[0], 0);
      return wsum > 0 ? ok.reduce((a, l) => a + l[0] * l[1], 0) / wsum : NaN;
    });
    const sorted = raw.filter(Number.isFinite).sort((a, b) => a - b);
    list.forEach((r, k) => {
      const v = raw[k];
      if (!Number.isFinite(v)) { r.f.rs = NaN; return; }
      let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
      r.f.rs = (100 * lo) / Math.max(1, sorted.length - 1);
    });
    const sec = new Map<string, number[]>();
    for (const r of list) { const k = (r.f as Record<string, unknown>)._sic as string | null; if (k && Number.isFinite(r.f.r63)) (sec.get(k) ?? sec.set(k, []).get(k)!).push(r.f.r63); }
    for (const r of list) {
      const k = (r.f as Record<string, unknown>)._sic as string | null;
      const g = k ? sec.get(k) : undefined;
      r.f.sectorR63 = g && g.length >= 5 ? (g.reduce((a, b) => a + b, 0) / g.length) * 100 : NaN;
    }
  }
  for (const r of rows) for (const k of ['r21', 'r63', 'r126']) r.f[k] *= 100;
  if (process.argv[2] === 'excess') { excess(rows); return; }

  const FEATURES = ['rs', 'r21', 'r63', 'r126', 'offHigh', 'aboveLow', 'trend', 'adr20', 'dvol', 'price', 'rvol', 'udv', 'tight', 'age', 'ep20', 'mcap', 'revYoY', 'revAccel', 'epsYoY', 'shortPct', 'sectorR63'];
  const train = rows.filter(r => r.half === 0), test = rows.filter(r => r.half === 1);
  const rate = (a: Row[]) => (a.length ? a.filter(r => r.win).length / a.length : NaN);
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const median = (a: number[]) => { if (!a.length) return NaN; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  const base = [rate(train), rate(test)];
  const uni = [0, 1].map(h => { const a = (h ? test : train).map(r => r.fwd); return { mean: mean(a), median: median(a) }; });
  const f1 = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');
  console.log(`rows ${rows.length} (train ${train.length} / test ${test.length}) · winners ${train.filter(r => r.win).length} / ${test.filter(r => r.win).length} · base rate ${(100 * base[0]).toFixed(2)}% / ${(100 * base[1]).toFixed(2)}% · universe fwd60 mean ${f1(uni[0].mean)}% / ${f1(uni[1].mean)}%, median ${f1(uni[0].median)}% / ${f1(uni[1].median)}% · ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  // ---- Stage 1
  type Bucket = { lo: number; hi: number; label: string };
  const bucketsOf = (k: string): Bucket[] => {
    const vals = train.map(r => r.f[k]).filter(Number.isFinite).sort((a, b) => a - b);
    const edges = [...new Set(Array.from({ length: 9 }, (_, q) => vals[Math.floor(((q + 1) / 10) * (vals.length - 1))]))];
    const b: Bucket[] = [];
    let prev = -Infinity;
    for (const e of [...edges, Infinity]) { if (e > prev) b.push({ lo: prev, hi: e, label: `${f1(prev)}..${f1(e)}` }); prev = e; }
    return b;
  };
  const inB = (v: number, b: Bucket) => Number.isFinite(v) && v > b.lo && v <= b.hi;
  const selected: { k: string; b: Bucket }[] = [];
  const summary: Record<string, unknown> = {};
  for (const k of FEATURES) {
    const bs = bucketsOf(k);
    const stat = (a: Row[], h: number) => ({ n: a.length, lift: rate(a) / base[h], mean: mean(a.map(r => r.fwd)), med: median(a.map(r => r.fwd)) });
    const lines = bs.map(b => ({ b, tr: stat(train.filter(r => inB(r.f[k], b)), 0), te: stat(test.filter(r => inB(r.f[k], b)), 1) }));
    const na = { tr: stat(train.filter(r => !Number.isFinite(r.f[k])), 0), te: stat(test.filter(r => !Number.isFinite(r.f[k])), 1) };
    const best = lines.filter(x => x.tr.n >= 500).sort((a, b) => b.tr.lift - a.tr.lift)[0];
    const repeats = !!best && best.tr.lift >= 2 && best.te.lift >= 1.5;
    if (best && best.tr.lift >= 2) selected.push({ k, b: best.b });
    summary[k] = { best: best && { range: best.b.label, train: best.tr, test: best.te }, repeats };
    console.log(`\n${k}${repeats ? '  ← REPEATS' : ''}   (NA: n ${na.tr.n}/${na.te.n} lift ${f1(na.tr.lift, 2)}/${f1(na.te.lift, 2)})`);
    for (const x of lines) {
      console.log(`  ${x.b.label.padEnd(18)} train n ${String(x.tr.n).padStart(6)} lift ${f1(x.tr.lift, 2).padStart(5)} fwd ${f1(x.tr.mean).padStart(6)}/${f1(x.tr.med).padStart(6)}  |  test n ${String(x.te.n).padStart(6)} lift ${f1(x.te.lift, 2).padStart(5)} fwd ${f1(x.te.mean).padStart(6)}/${f1(x.te.med).padStart(6)}${x === best ? '  *' : ''}`);
    }
  }

  // ---- Stage 2
  console.log(`\n=== STAGE 2 — ${selected.length} conditions chosen on train: ${selected.map(s => `${s.k} ${s.b.label}`).join(' · ')}`);
  const score = (r: Row) => selected.reduce((a, s) => a + (inB(r.f[s.k], s.b) ? 1 : 0), 0);
  for (const h of [0, 1] as const) {
    const set = h ? test : train;
    const by = new Map<number, Row[]>();
    for (const r of set) { const sc = score(r); (by.get(sc) ?? by.set(sc, []).get(sc)!).push(r); }
    console.log(`${h ? 'TEST' : 'train'}:`);
    for (const sc of [...by.keys()].sort((a, b) => a - b)) {
      const a = by.get(sc)!;
      console.log(`  score ${sc}: n ${String(a.length).padStart(6)} winners ${(100 * rate(a)).toFixed(2)}% lift ${f1(rate(a) / base[h], 2)} fwd mean ${f1(mean(a.map(r => r.fwd)))}% median ${f1(median(a.map(r => r.fwd)))}%`);
    }
  }
  const top: Row[] = [];
  const topPer = (set: Row[]) => {
    const out: Row[] = [];
    const bd = new Map<number, Row[]>();
    for (const r of set) (bd.get(r.d) ?? bd.set(r.d, []).get(r.d)!).push(r);
    for (const list of bd.values()) out.push(...[...list].sort((a, b) => score(b) - score(a) || (b.f.rs || 0) - (a.f.rs || 0)).slice(0, 20));
    return out;
  };
  const res: Record<string, unknown> = {};
  for (const h of [0, 1] as const) {
    const t = topPer(h ? test : train);
    if (h) top.push(...t);
    const wr = rate(t), m = mean(t.map(r => r.fwd)), md = median(t.map(r => r.fwd));
    res[h ? 'test' : 'train'] = { n: t.length, winRate: wr, lift: wr / base[h], mean: m, median: md };
    console.log(`top 20 a week, ${h ? 'TEST' : 'train'}: n ${t.length} winners ${(100 * wr).toFixed(2)}% (lift ${f1(wr / base[h], 2)}) fwd60 mean ${f1(m)}% median ${f1(md)}% vs universe ${f1(uni[h].mean)}% / ${f1(uni[h].median)}%`);
  }
  const tt = res.test as { lift: number; mean: number; median: number };
  const pass = tt.lift >= 3 && tt.mean > uni[1].mean && tt.median > uni[1].median;
  console.log(`\nVERDICT: ${pass ? 'PASS — goes to the account test' : 'fail'}`);
  fs.writeFileSync(path.join(DATA, 'replay', 'winners_study.json'), JSON.stringify({ base, uni, summary, selected: selected.map(s => ({ k: s.k, range: s.b.label })), top20: res, pass }, null, 1));
}


/* ---- Excess mode: each stock against the others the same week ---------- */
type XRow = Row & { x: number; rk: number };
function excess(rows0: Row[]) {
  const rows = rows0 as XRow[];
  const byDate = new Map<number, XRow[]>();
  for (const r of rows) (byDate.get(r.d) ?? byDate.set(r.d, []).get(r.d)!).push(r);
  for (const list of byDate.values()) {
    const sorted = list.map(r => r.fwd).sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    for (const r of list) {
      r.x = r.fwd - med;
      let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < r.fwd) lo = m + 1; else hi = m; }
      r.rk = (100 * lo) / Math.max(1, sorted.length - 1);
    }
  }
  const FEATURES = ['rs', 'r21', 'r63', 'r126', 'offHigh', 'aboveLow', 'trend', 'adr20', 'dvol', 'price', 'rvol', 'udv', 'tight', 'young', 'ep20', 'mcap', 'revYoY', 'revAccel', 'epsYoY', 'shortPct', 'sectorR63'];
  const train = rows.filter(r => r.half === 0), test = rows.filter(r => r.half === 1);
  const testDates = [...new Set(test.map(r => r.d))].sort((a, b) => a - b);
  const midTest = testDates[Math.floor(testDates.length / 2)];
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const median = (a: number[]) => { if (!a.length) return NaN; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  const st = (a: XRow[]) => ({ n: a.length, mx: mean(a.map(r => r.x)), mdx: median(a.map(r => r.x)), rk: mean(a.map(r => r.rk)) });
  const f1 = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');
  const fmt = (z: ReturnType<typeof st>) => `n ${String(z.n).padStart(6)} x ${f1(z.mx).padStart(6)}/${f1(z.mdx).padStart(6)} rk ${f1(z.rk).padStart(5)}`;
  type B = { lo: number; hi: number; label: string };
  const bucketsOf = (k: string): B[] => {
    const vals = train.map(r => r.f[k]).filter(Number.isFinite).sort((a, b) => a - b);
    const edges = [...new Set(Array.from({ length: 9 }, (_, q) => vals[Math.floor(((q + 1) / 10) * (vals.length - 1))]))];
    const b: B[] = []; let prev = -Infinity;
    for (const e of [...edges, Infinity]) { if (e > prev) b.push({ lo: prev, hi: e, label: `${f1(prev)}..${f1(e)}` }); prev = e; }
    return b;
  };
  const inB = (v: number, b: B) => Number.isFinite(v) && v > b.lo && v <= b.hi;
  const selected: { k: string; b: B }[] = [];
  const holds: string[] = [];
  console.log(`\n=== EXCESS MODE — same-week comparison. x = fwd60 minus that week's median (mean/median), rk = percentile within the week (50 = typical)`);
  for (const k of FEATURES) {
    console.log(`\n${k}`);
    for (const b of bucketsOf(k)) {
      const tr = st(train.filter(r => inB(r.f[k], b))), te = st(test.filter(r => inB(r.f[k], b)));
      const sel = tr.n >= 500 && tr.rk >= 55 && tr.mx > 0 && tr.mdx > 0;
      const hold = sel && te.rk >= 53 && te.mx > 0 && te.mdx > 0;
      if (sel) selected.push({ k, b });
      if (hold) holds.push(`${k} ${b.label}`);
      console.log(`  ${b.label.padEnd(18)} train ${fmt(tr)}  |  test ${fmt(te)}${sel ? (hold ? '  HOLDS' : '  selected, fails test') : ''}`);
    }
  }
  console.log(`\nselected on train: ${selected.length} · hold in test: ${holds.length ? holds.join(' · ') : 'none'}`);
  const score = (r: XRow) => selected.reduce((a, s) => a + (inB(r.f[s.k], s.b) ? 1 : 0), 0);
  const top = (set: XRow[]) => {
    const bd = new Map<number, XRow[]>();
    for (const r of set) (bd.get(r.d) ?? bd.set(r.d, []).get(r.d)!).push(r);
    const out: XRow[] = [];
    for (const list of bd.values()) out.push(...[...list].sort((a, b) => score(b) - score(a) || (b.f.rs || 0) - (a.f.rs || 0)).slice(0, 20));
    return out;
  };
  const tTr = st(top(train)), tTe = st(top(test));
  const tA = st(top(test.filter(r => r.d < midTest))), tB = st(top(test.filter(r => r.d >= midTest)));
  console.log(`top 20 a week — train ${fmt(tTr)}\n                 TEST  ${fmt(tTe)}\n     test, 1st half  ${fmt(tA)}\n     test, 2nd half  ${fmt(tB)}`);
  for (const sc of [...new Set(test.map(score))].sort((a, b) => a - b)) console.log(`  test score ${sc}: ${fmt(st(test.filter(r => score(r) === sc)))}`);
  const ok = (z: ReturnType<typeof st>) => z.mx > 0 && z.mdx > 0 && z.rk >= 55;
  const pass = ok(tTe) && ok(tA) && ok(tB);
  console.log(`\nVERDICT (excess): ${pass ? 'PASS — goes to the account test and the live record' : 'fail'}`);
  fs.writeFileSync(path.join(DATA, 'replay', 'winners_excess.json'), JSON.stringify({ selected: selected.map(s => `${s.k} ${s.b.label}`), holds, top20: { train: tTr, test: tTe, testA: tA, testB: tB }, pass }, null, 1));
}

main();

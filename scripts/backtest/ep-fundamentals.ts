// scripts/backtest/ep-fundamentals.ts — do Stockbee's fundamental tags pick
// better EP9M trades?
//
// Run from trade-dash:
//   npx tsx scripts/backtest/ep-fundamentals.ts download   (resumable, ~8/s)
//   npx tsx scripts/backtest/ep-fundamentals.ts analyze
// Data: CTT/backtest-data/fundamentals/quarterly/TICKER.json.gz. Polygon only,
// key from CTT/.env.backtest. No KV, no Vercel.
//
// RULES — fixed 27 Sep 2026 BEFORE any tag was computed or any result read.
//   Signals   EP9M final-list flags, 26 Sep 2022 onward (the Model Book's
//             window), bought on the card's entry: the pullback to the EP-day
//             midpoint, stop at the EP-day low. Outcomes from
//             replay/ep9m_v2_outcomes.jsonl (hold 20 = the Model Book's exit;
//             trail 10 = the card's).
//   Point in time  a quarter counts only if its filing_date is BEFORE the flag
//             date. Filings lag the earnings release by weeks, so on an
//             earnings-day EP the new quarter is usually not yet counted: the
//             tag is conservative (never look-ahead), and says so.
//   Quarters  keyed by (fiscal_year, fiscal_period). Polygon often omits Q4
//             from the quarterly list; Q4 = the annual (FY) figure minus
//             Q1+Q2+Q3 of the same fiscal year, filed with the FY report.
//             Year-over-year = the same fiscal period one fiscal year earlier.
//             Q0 = the latest counted quarter; it must have ended within 200
//             days of the flag, else no tag (stale data).
//   Tags (Stockbee's thresholds, from the user's Pine screener)
//     99S   sales YoY (Q0) >= 99%, trailing-4Q sales >= $25M, price >= $10,
//           avg volume >= 100K
//     39S   sales YoY (Q0) >= 39% AND average of Q0 and Q1 sales YoY >= 39%,
//           trailing-4Q sales >= $25M, price >= $10, avg volume >= 100K
//     39E   EPS YoY (Q0) >= 39% AND EPS YoY (Q1) >= 39% (abs of the base,
//           base not 0), sales YoY (Q0) >= 20% AND its 2Q average >= 20%,
//           trailing-4Q sales >= $25M, price >= $10, avg volume >= 200K
//     ANY   any of the three
//   (Stockbee's Growth/Turnaround tag also needs listing age < 10 years;
//    listing dates are not in this data, so it is not tested.)
//   Groups    tagged / not tagged (fundamentals present) / no data.
//   PASS      a tag is useful only if its trades beat the not-tagged group
//             by at least +0.10R on hold-20 in BOTH halves (split 2025-05-16,
//             as the portfolio tests), with at least 50 tagged fills in each.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DATA } from './cache';
import { ep9mTier } from '@/lib/scans/edge';

const REPLAY = path.join(DATA, 'replay');
const QDIR = path.join(DATA, 'fundamentals', 'quarterly');
const START = '2022-09-26';
const CUT = '2025-05-16';

function polygonKey(): string {
  const m = fs.readFileSync(path.resolve(DATA, '../.env.backtest'), 'utf8').match(/^POLYGON_API_KEY=(.+)$/m);
  if (!m) throw new Error('POLYGON_API_KEY missing from CTT/.env.backtest');
  return m[1].trim().replace(/^["']|["']$/g, '');
}
const read = (f: string) => fs.readFileSync(path.join(REPLAY, f), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const flags = () => read('ep9m_v2_registry.jsonl').filter((r: any) => r.inFinal && r.date >= START);

type Q = { fy: number; fp: string; end: string; filed: string; rev: number | null; eps: number | null };

async function getAll(url: string, key: string): Promise<any[]> {
  const out: any[] = [];
  let next: string | null = `${url}&apiKey=${key}`;
  for (let page = 0; next && page < 5; page++) {
    let j: any = null;
    for (let a = 0; a < 3 && !j; a++) {
      const res = await fetch(next).catch(() => null);
      if (res?.ok) j = await res.json().catch(() => null);
      else await new Promise(r => setTimeout(r, 1200 * (a + 1)));
    }
    if (!j) throw new Error('fetch failed');
    out.push(...(j.results ?? []));
    next = j.next_url ? `${j.next_url}&apiKey=${key}` : null;
  }
  return out;
}

async function download() {
  const key = polygonKey();
  fs.mkdirSync(QDIR, { recursive: true });
  const tickers = [...new Set(flags().map((r: any) => r.ticker as string))].sort();
  let done = 0, skipped = 0, failed = 0;
  const queue = [...tickers];
  const t0 = Date.now();
  const worker = async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      const f = path.join(QDIR, `${t}.json.gz`);
      if (fs.existsSync(f)) { skipped++; continue; }
      try {
        const base = `https://api.polygon.io/vX/reference/financials?ticker=${encodeURIComponent(t)}&order=desc&sort=filing_date&limit=100`;
        const [q, a] = [await getAll(`${base}&timeframe=quarterly`, key), await getAll(`${base}&timeframe=annual`, key)];
        const slim = (x: any) => ({
          fy: Number(x.fiscal_year), fp: String(x.fiscal_period), end: x.end_date, filed: x.filing_date,
          rev: x.financials?.income_statement?.revenues?.value ?? null,
          eps: x.financials?.income_statement?.basic_earnings_per_share?.value ?? x.financials?.income_statement?.diluted_earnings_per_share?.value ?? null,
        });
        fs.writeFileSync(f, zlib.gzipSync(JSON.stringify({ q: q.map(slim), a: a.map(slim) })));
        done++;
      } catch { failed++; }
      if ((done + failed) % 250 === 0) console.log(`${done + skipped + failed}/${tickers.length} (${failed} failed) ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      await new Promise(r => setTimeout(r, 700));
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  console.log(`download done: ${done} new, ${skipped} cached, ${failed} failed of ${tickers.length}`);
}

/** Quarters with Q4 filled from the annual report where Polygon omits it. */
function quarters(t: string): Q[] | null {
  const f = path.join(QDIR, `${t}.json.gz`);
  if (!fs.existsSync(f)) return null;
  const { q, a } = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString()) as { q: Q[]; a: Q[] };
  const byKey = new Map<string, Q>();
  for (const x of q) if (/^Q[1-4]$/.test(x.fp) && x.fy) byKey.set(`${x.fy}${x.fp}`, { ...x });
  /* Polygon's own Q4 rows come with NO filing_date (Q4 is reported in the
     annual 10-K). They became public with the FY report, so they take its
     filing date; without one they could never count (found 27 Sep on AAPL,
     before any result was read). */
  const fyFiled = new Map<number, string>();
  for (const y of a) if (y.fy && y.filed) fyFiled.set(y.fy, y.filed);
  for (const x of byKey.values()) if (x.fp === 'Q4' && !x.filed && fyFiled.has(x.fy)) x.filed = fyFiled.get(x.fy)!;
  for (const y of a) {
    if (!y.fy || byKey.has(`${y.fy}Q4`)) continue;
    const q123 = ['Q1', 'Q2', 'Q3'].map(p => byKey.get(`${y.fy}${p}`));
    if (q123.some(v => !v)) continue;
    const sub = (k: 'rev' | 'eps') => (y[k] != null && q123.every(v => v![k] != null) ? (y[k] as number) - q123.reduce((s, v) => s + (v![k] as number), 0) : null);
    byKey.set(`${y.fy}Q4`, { fy: y.fy, fp: 'Q4', end: y.end, filed: y.filed, rev: sub('rev'), eps: sub('eps') });
  }
  return [...byKey.values()].sort((x, y) => (x.fy - y.fy) || x.fp.localeCompare(y.fp));
}

const prevQ = (x: { fy: number; fp: string }) => { const n = +x.fp[1]; return n === 1 ? { fy: x.fy - 1, fp: 'Q4' } : { fy: x.fy, fp: `Q${n - 1}` }; };
const yoy = (cur: number | null, base: number | null, absBase = false) =>
  cur == null || base == null || base === 0 || (!absBase && base < 0) ? null : ((cur - base) / (absBase ? Math.abs(base) : base)) * 100;

type Tags = { has: boolean; s99: boolean; s39: boolean; e39: boolean };
function tagsFor(qs: Q[], date: string, price: number, avgVol: number): Tags {
  const avail = qs.filter(x => x.filed && x.filed < date);
  const get = (fy: number, fp: string) => avail.find(x => x.fy === fy && x.fp === fp) ?? null;
  const q0 = avail.length ? avail.reduce((m, x) => (x.end > m.end ? x : m)) : null;
  const none: Tags = { has: false, s99: false, s39: false, e39: false };
  if (!q0 || (Date.parse(date) - Date.parse(q0.end)) / 86400000 > 200) return none;
  const p1 = prevQ(q0), q1 = get(p1.fy, p1.fp);
  const p2 = q1 ? prevQ(q1) : null, q2 = p2 ? get(p2.fy, p2.fp) : null;
  const p3 = q2 ? prevQ(q2) : null, q3 = p3 ? get(p3.fy, p3.fp) : null;
  const y0 = get(q0.fy - 1, q0.fp), y1 = q1 ? get(q1.fy - 1, q1.fp) : null;
  const ttm = [q0, q1, q2, q3].every(x => x && x.rev != null) ? [q0, q1, q2, q3].reduce((s, x) => s + (x!.rev as number), 0) / 1e6 : null;
  const s0 = yoy(q0.rev, y0?.rev ?? null), s1 = q1 ? yoy(q1.rev, y1?.rev ?? null) : null;
  const e0 = yoy(q0.eps, y0?.eps ?? null, true), e1 = q1 ? yoy(q1.eps, y1?.eps ?? null, true) : null;
  if (s0 == null || ttm == null) return none;
  const base = ttm >= 25 && price >= 10;
  const avg2 = s1 != null ? (s0 + s1) / 2 : null;
  return {
    has: true,
    s99: base && avgVol >= 100_000 && s0 >= 99,
    s39: base && avgVol >= 100_000 && s0 >= 39 && avg2 != null && avg2 >= 39,
    e39: base && avgVol >= 200_000 && e0 != null && e1 != null && e0 >= 39 && e1 >= 39 && s0 >= 20 && avg2 != null && avg2 >= 20,
  };
}

function analyze() {
  const outcomes = new Map<string, any>();
  for (const o of read('ep9m_v2_outcomes.jsonl')) outcomes.set(`${o.ticker}|${o.date}`, o);
  const qcache = new Map<string, Q[] | null>();
  type Row = { half: 0 | 1; green: boolean; tags: Tags; h20: number; t10: number; hr: boolean };
  const rows: Row[] = [];
  let noOutcome = 0;
  for (const r of flags()) {
    const o = outcomes.get(`${r.ticker}|${r.date}`);
    const e = o?.entries?.pullback;
    if (!e || e.status !== 'traded') { noOutcome++; continue; }
    if (!qcache.has(r.ticker)) qcache.set(r.ticker, quarters(r.ticker));
    const qs = qcache.get(r.ticker);
    const tags = qs ? tagsFor(qs, r.date, r.price, r.avgVol ?? 0) : { has: false, s99: false, s39: false, e39: false };
    rows.push({ half: r.date < CUT ? 0 : 1, green: ep9mTier(r) === 'green', tags, h20: e.exits.hold20.r, t10: e.exits.trail10.r, hr: !!e.homeRunHeld });
  }
  const summ = (a: Row[]) => a.length === 0 ? '—' : `n ${String(a.length).padStart(4)} · hold20 ${(a.reduce((s, x) => s + x.h20, 0) / a.length).toFixed(3)}R · trail10 ${(a.reduce((s, x) => s + x.t10, 0) / a.length).toFixed(3)}R · win ${(100 * a.filter(x => x.h20 > 0).length / a.length).toFixed(0)}% · +50% runs ${(100 * a.filter(x => x.hr).length / a.length).toFixed(1)}%`;
  const avgH = (a: Row[]) => (a.length ? a.reduce((s, x) => s + x.h20, 0) / a.length : NaN);
  console.log(`EP9M final flags since ${START}: ${rows.length} filled on the pullback (${noOutcome} never filled/scored) · fundamentals present on ${rows.filter(x => x.tags.has).length}`);
  for (const scope of ['all', 'green'] as const) {
    const pool = scope === 'green' ? rows.filter(x => x.green) : rows;
    console.log(`\n=== ${scope === 'green' ? 'GREEN rows only (the Model Book universe)' : 'ALL EP9M fills'} ===`);
    console.log(`no data      ${summ(pool.filter(x => !x.tags.has))}`);
    for (const [name, pick] of [['99S', (t: Tags) => t.s99], ['39S', (t: Tags) => t.s39], ['39E', (t: Tags) => t.e39], ['ANY', (t: Tags) => t.s99 || t.s39 || t.e39]] as const) {
      const tagged = pool.filter(x => x.tags.has && pick(x.tags));
      const not = pool.filter(x => x.tags.has && !pick(x.tags));
      const halves = [0, 1].map(h => ({ t: tagged.filter(x => x.half === h), n: not.filter(x => x.half === h) }));
      const diff = halves.map(h => avgH(h.t) - avgH(h.n));
      const pass = halves.every(h => h.t.length >= 50) && diff.every(d => d >= 0.10);
      console.log(`${name.padEnd(4)} tagged ${summ(tagged)}`);
      console.log(`     not    ${summ(not)}`);
      console.log(`     halves tagged-minus-not hold20: ${diff.map(d => (Number.isFinite(d) ? (d >= 0 ? '+' : '') + d.toFixed(3) : '—')).join(' / ')}R (tagged n ${halves.map(h => h.t.length).join(' / ')}) ${scope === 'all' ? (pass ? 'PASS' : 'fail') : ''}`);
    }
  }
}

/* NO-FINANCIALS rule, fixed 27 Sep 2026 BEFORE running (the idea came from
   the tag results above, so this is in-sample: the halves test stability,
   the live record is the real test).
     skip an EP9M flag when no quarterly report WITH revenue was filed before
     the flag date for a period ending within 200 days of it.
   PASS (all): per trade, skipped trades average >= 0.10R worse than kept on
   hold-20 in BOTH halves (n >= 50 skipped per half), on all fills AND on green
   rows; and in the account (portfolio.ts nofin) the Model Book with the rule
   beats the Model Book in both halves AND lifts its random-order median.
   Writes replay/ep9m_fin_flags.json (ticker|date -> has recent financials). */
function hasRecentFin(qs: Q[] | null, date: string): boolean {
  if (!qs) return false;
  return qs.some(x => x.filed && x.filed < date && x.rev != null && (Date.parse(date) - Date.parse(x.end)) / 86400000 <= 200);
}
function nofin() {
  const outcomes = new Map<string, any>();
  for (const o of read('ep9m_v2_outcomes.jsonl')) outcomes.set(`${o.ticker}|${o.date}`, o);
  const qcache = new Map<string, Q[] | null>();
  const map: Record<string, boolean> = {};
  type Row = { half: 0 | 1; green: boolean; fin: boolean; h20: number; t10: number; hr: boolean };
  const rows: Row[] = [];
  for (const r of flags()) {
    if (!qcache.has(r.ticker)) qcache.set(r.ticker, quarters(r.ticker));
    const fin = hasRecentFin(qcache.get(r.ticker) ?? null, r.date);
    map[`${r.ticker}|${r.date}`] = fin;
    const e = outcomes.get(`${r.ticker}|${r.date}`)?.entries?.pullback;
    if (!e || e.status !== 'traded') continue;
    rows.push({ half: r.date < CUT ? 0 : 1, green: ep9mTier(r) === 'green', fin, h20: e.exits.hold20.r, t10: e.exits.trail10.r, hr: !!e.homeRunHeld });
  }
  fs.writeFileSync(path.join(REPLAY, 'ep9m_fin_flags.json'), JSON.stringify(map));
  const avg = (a: Row[], k: 'h20' | 't10') => (a.length ? a.reduce((x, y) => x + y[k], 0) / a.length : NaN);
  const line = (a: Row[]) => `n ${String(a.length).padStart(4)} · hold20 ${avg(a, 'h20').toFixed(3)}R · trail10 ${avg(a, 't10').toFixed(3)}R · win ${(100 * a.filter(x => x.h20 > 0).length / (a.length || 1)).toFixed(0)}% · +50% ${(100 * a.filter(x => x.hr).length / (a.length || 1)).toFixed(1)}%`;
  let pass = true;
  for (const scope of ['all', 'green'] as const) {
    const pool = scope === 'green' ? rows.filter(x => x.green) : rows;
    console.log(`\n=== ${scope} fills ===`);
    console.log(`kept (has financials)    ${line(pool.filter(x => x.fin))}`);
    console.log(`skipped (no financials)  ${line(pool.filter(x => !x.fin))}`);
    const h = [0, 1].map(k => ({ keep: pool.filter(x => x.half === k && x.fin), skip: pool.filter(x => x.half === k && !x.fin) }));
    const gap = h.map(x => avg(x.keep, 'h20') - avg(x.skip, 'h20'));
    const ok = h.every(x => x.skip.length >= 50) && gap.every(g => g >= 0.10);
    pass = pass && ok;
    console.log(`kept-minus-skipped hold20 by half: ${gap.map(g => (g >= 0 ? '+' : '') + g.toFixed(3)).join(' / ')}R (skipped n ${h.map(x => x.skip.length).join(' / ')}) ${ok ? 'ok' : 'FAIL'}`);
  }
  console.log(`\nper-trade part: ${pass ? 'PASS' : 'FAIL'} — account part: run portfolio.ts nofin`);
}

const mode = process.argv[2];
if (mode === 'download') download();
else if (mode === 'analyze') analyze();
else if (mode === 'nofin') nofin();
else if (mode === 'check') {
  // Spot-check: npx tsx ... check TICKER DATE [PRICE] [AVGVOL]
  const qs = quarters(process.argv[3]);
  console.log(qs ? tagsFor(qs, process.argv[4], Number(process.argv[5] ?? 100), Number(process.argv[6] ?? 1e7)) : 'no data');
}
else console.log('usage: ep-fundamentals.ts download | analyze');

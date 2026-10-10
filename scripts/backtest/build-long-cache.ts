// scripts/backtest/build-long-cache.ts — turn the FMP 2015-2021 download into cache day files.
//
//   npx tsx scripts/backtest/build-long-cache.ts      (after download-fmp-history.mjs)
//
// Writes backtest-data/grouped_fmp/{adj,unadj}/YYYY/DATE.json.gz in the same
// shape as the Polygon grouped files, for every session BEFORE the first
// Polygon session. cache.ts reads them only when LONG=1, so every earlier
// script reproduces exactly.
//
//   adj    FMP's split-adjusted bars, scaled per ticker to agree with Polygon
//          on the overlap (Polygon's first session .. 2021-12-31): the median
//          close ratio. A ticker whose ratio is unstable over the overlap
//          (spread > 2%) is dropped from the long history — likely a reused
//          symbol or a bad series.
//   unadj  the price actually traded: adj x (product of later splits),
//          volume / that product — so price floors use real prices.
//   Benchmarks SPY, QQQ, IWM, DIA are fetched here (they are not CS/ADRC).

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DATA, listSessions, readDay } from './cache';

const FMP = path.join(DATA, 'fmp');
const OUT = path.join(DATA, 'grouped_fmp');
const env = fs.readFileSync(path.resolve(DATA, '../.env.backtest'), 'utf8');
const KEY = (env.match(/^FMP_API_KEY=(.+)$/m) || [])[1]?.trim();
const BENCH = ['SPY', 'QQQ', 'IWM', 'DIA'];

type D = [string, number, number, number, number, number];
const gz = (f: string) => JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString());

async function main() {
  for (const b of BENCH) {
    const f = path.join(FMP, 'daily', `${b}.json.gz`);
    if (fs.existsSync(f)) continue;
    const res = await fetch(`https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${b}&from=2015-01-01&to=2021-12-31&apikey=${KEY}`);
    const body: any[] = await res.json();
    fs.writeFileSync(f, zlib.gzipSync(JSON.stringify(body.map(x => [x.date, x.open, x.high, x.low, x.close, x.volume]).sort((p, q) => (p[0] < q[0] ? -1 : 1)))));
    fs.writeFileSync(path.join(FMP, 'splits', `${b}.json.gz`), zlib.gzipSync('[]'));
  }
  const poly = listSessions();
  const first = poly[0];
  const overlap = poly.filter(d => d <= '2021-12-31');
  // Polygon closes on the overlap, per ticker
  const polyClose = new Map<string, Map<string, number>>();
  for (const d of overlap) for (const r of readDay('adj', d)) { let m = polyClose.get(r[0]); if (!m) polyClose.set(r[0], (m = new Map())); m.set(d, r[4]); }

  const files = fs.readdirSync(path.join(FMP, 'daily')).filter(f => f.endsWith('.json.gz'));
  const scale = new Map<string, number>();
  const tally = { tickers: files.length, empty: 0, jumpDropped: 0, noOverlap: 0, unstable: 0, scaled: 0, kept: 0, badBars: 0 };
  // Pass 1: per-ticker scale against Polygon
  for (const f of files) {
    const t = f.replace(/\.json\.gz$/, '').replace(/_/g, '/');
    const rows: D[] = gz(path.join(FMP, 'daily', f));
    if (!rows.length) { tally.empty++; continue; }
    /* Data cleaning (9 Oct 2026, set before any long result was trusted):
       ~5% of FMP's old series carry broken split adjustments (GOEV, EMITF
       "rising" 10^12x overnight). A ticker with any one-day close move of 4x
       or more either way is dropped from the long history entirely. This also
       drops a few genuine one-day 4x moves (a small bias against lottery
       tickets, stated). */
    let jump = false;
    for (let i = 1; i < rows.length; i++) { const a = rows[i - 1][4], b = rows[i][4]; if (a > 0 && b > 0 && (b / a >= 4 || a / b >= 4)) { jump = true; break; } }
    if (jump) { tally.jumpDropped++; continue; }
    const pc = polyClose.get(t);
    const ratios: number[] = [];
    if (pc) for (const r of rows) { const p = pc.get(r[0]); if (p && r[4] > 0) ratios.push(p / r[4]); }
    if (!ratios.length) {
      // Delisted before Polygon's window (or never in it): nothing to stitch to; keep as is.
      if (rows[rows.length - 1][0] >= first) { tally.noOverlap++; continue; }
      scale.set(t, 1); tally.kept++; continue;
    }
    ratios.sort((a, b) => a - b);
    const med = ratios[ratios.length >> 1];
    if (ratios[ratios.length - 1] / ratios[0] > 1.02) { tally.unstable++; continue; }
    if (Math.abs(med - 1) > 0.005) tally.scaled++;
    scale.set(t, med); tally.kept++;
  }
  console.log('stitch:', tally);

  // Pass 2: year by year, write day files for dates before `first`
  const years = ['2015', '2016', '2017', '2018', '2019', '2020', '2021'];
  let days = 0;
  for (const y of years) {
    const adj = new Map<string, any[]>(), unadj = new Map<string, any[]>();
    for (const [t, k] of scale) {
      const f = path.join(FMP, 'daily', `${t.replace(/\//g, '_')}.json.gz`);
      const rows: D[] = gz(f);
      const splits: [string, number, number][] = fs.existsSync(path.join(FMP, 'splits', `${t.replace(/\//g, '_')}.json.gz`)) ? gz(path.join(FMP, 'splits', `${t.replace(/\//g, '_')}.json.gz`)) : [];
      for (const r of rows) {
        const d = r[0];
        if (d.slice(0, 4) !== y || d >= first) continue;
        if (!(r[1] > 0 && r[2] > 0 && r[3] > 0 && r[4] > 0) || r[2] < r[3] || r[2] / r[3] > 3 || r[4] > r[2] * 1.01 || r[4] < r[3] * 0.99) { tally.badBars++; continue; }
        let F = 1; for (const [sd, num, den] of splits) if (sd > d && num > 0 && den > 0) F *= num / den;
        const o = r[1] * k, h = r[2] * k, l = r[3] * k, c = r[4] * k, v = r[5] / k;
        (adj.get(d) ?? adj.set(d, []).get(d)!).push([t, o, h, l, c, v, null]);
        (unadj.get(d) ?? unadj.set(d, []).get(d)!).push([t, o * F, h * F, l * F, c * F, v / F, null]);
      }
    }
    for (const [kind, m] of [['adj', adj], ['unadj', unadj]] as const) {
      fs.mkdirSync(path.join(OUT, kind, y), { recursive: true });
      for (const [d, rows] of m) fs.writeFileSync(path.join(OUT, kind, y, `${d}.json.gz`), zlib.gzipSync(JSON.stringify({ date: d, adjusted: kind === 'adj', fields: ['T', 'o', 'h', 'l', 'c', 'v', 'vw'], source: 'fmp', rows })));
    }
    days += adj.size;
    console.log(`${y}: ${adj.size} sessions, ${[...adj.values()].reduce((a, r) => a + r.length, 0)} bars`);
  }
  console.log(`done: ${days} sessions before ${first}; bad bars dropped ${tally.badBars}`);
}
main().catch(e => { console.error(e); process.exit(1); });

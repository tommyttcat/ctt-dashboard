// scripts/backtest/download-fmp-history.mjs — daily bars 2015-2021 from FMP, to extend the cache backwards.
//
// The Polygon cache starts Sep 2021 (the plan's 5-year limit), which misses
// the 2019-2021 run when breakout methods earned their reputations. This pulls
// FMP's split-adjusted daily OHLCV for 2015-01-01 .. 2021-12-31 (three months
// of overlap with Polygon, for a stitching check) and each name's split
// history (so the real traded price can be rebuilt for price filters).
//
// Universe: every CS / ADRC ticker in backtest-data/reference/tickers.json.gz
// alive at any point since 2015-01-01 — including 5,000+ delisted names, so
// the old years are not survivor-only. Polygon "BRK.B" is FMP "BRK-B".
//
// Output: backtest-data/fmp/daily/TICKER.json.gz  [[date, o, h, l, c, v], ...] oldest first
//         backtest-data/fmp/splits/TICKER.json.gz [[date, numerator, denominator], ...]
// Resumable at file granularity; an empty history is written as [] so it is
// not refetched. Gzip transfer (~60 KB a name, ~0.7 GB total). Key from
// CTT/.env.backtest (FMP_API_KEY). ~250 calls a minute.
//
// Usage: node scripts/backtest/download-fmp-history.mjs

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, '../../../backtest-data');
const OUT = path.join(DATA, 'fmp');
const env = fs.readFileSync(path.resolve(DATA, '../.env.backtest'), 'utf8');
const KEY = (env.match(/^FMP_API_KEY=(.+)$/m) || [])[1]?.trim();
if (!KEY) throw new Error('FMP_API_KEY missing from CTT/.env.backtest');
const FROM = '2015-01-01', TO = '2021-12-31';

const ref = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DATA, 'reference', 'tickers.json.gz'))).toString());
const tickers = [...new Set(ref.rows
  .filter(r => ['CS', 'ADRC'].includes((r[1] || '').toUpperCase()) && (!r[4] || String(r[4]).slice(0, 10) >= FROM))
  .map(r => r[0]))].sort();
for (const d of ['daily', 'splits']) fs.mkdirSync(path.join(OUT, d), { recursive: true });
const file = (kind, t) => path.join(OUT, kind, `${t.replace(/\//g, '_')}.json.gz`);
const jobs = [];
for (const t of tickers) { if (!fs.existsSync(file('daily', t))) jobs.push(['daily', t]); if (!fs.existsSync(file('splits', t))) jobs.push(['splits', t]); }
console.log(`tickers ${tickers.length}; jobs ${jobs.length}`);

const fmpSym = t => t.replace(/\./g, '-');
const url = (kind, t) => kind === 'daily'
  ? `https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${encodeURIComponent(fmpSym(t))}&from=${FROM}&to=${TO}&apikey=${KEY}`
  : `https://financialmodelingprep.com/stable/splits?symbol=${encodeURIComponent(fmpSym(t))}&apikey=${KEY}`;

let done = 0, failed = 0, empty = 0;
const t0 = Date.now();
const GAP_MS = 240;            // one call every 240 ms across all workers ≈ 250 / min
let next = Date.now();
const slot = async () => { const now = Date.now(); const at = Math.max(now, next); next = at + GAP_MS; if (at > now) await new Promise(r => setTimeout(r, at - now)); };
async function worker() {
  for (let j = jobs.shift(); j; j = jobs.shift()) {
    const [kind, t] = j;
    let body = null;
    for (let a = 0; a < 4 && body == null; a++) {
      await slot();
      const res = await fetch(url(kind, t), { headers: { 'Accept-Encoding': 'gzip' } }).catch(() => null);
      if (res?.ok) body = await res.json().catch(() => null);
      else if (res && res.status === 429) await new Promise(r => setTimeout(r, 15000));
      else await new Promise(r => setTimeout(r, 2000 * (a + 1)));
    }
    if (body == null || !Array.isArray(body)) { failed++; continue; }
    const rows = kind === 'daily'
      ? body.map(b => [b.date, b.open, b.high, b.low, b.close, b.volume]).sort((x, y) => (x[0] < y[0] ? -1 : 1))
      : body.map(b => [b.date, b.numerator, b.denominator]);
    if (!rows.length) empty++;
    fs.writeFileSync(file(kind, t), zlib.gzipSync(JSON.stringify(rows)));
    if (++done % 1000 === 0) console.log(`${done} done (${empty} empty, ${failed} failed) ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
console.log(`download done: ${done} written (${empty} empty), ${failed} failed, ${((Date.now() - t0) / 60000).toFixed(1)} min`);

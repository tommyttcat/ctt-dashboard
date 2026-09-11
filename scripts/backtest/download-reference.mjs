// scripts/backtest/download-reference.mjs
//
// Caches Polygon's ticker reference list — active AND delisted — for the EP9M
// backtest. The live scan drops anything whose ticker `type` is known and is
// not CS/ADRC (funds, warrants, ETNs that slip past the ETF list); replaying
// that needs the type of names that no longer trade, which is why inactive
// tickers are fetched too. Also supplies the company name the EP-type theme
// matcher reads.
//
// Local only — reads CTT/.env.backtest (Polygon key, no KV credentials).
// Output: CTT/backtest-data/reference/tickers.json.gz
//
// Usage: node scripts/backtest/download-reference.mjs

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '../..');
const OUT = path.resolve(APP, '../backtest-data/reference/tickers.json.gz');

function readKey() {
  const file = path.resolve(APP, '../.env.backtest');
  const line = fs.readFileSync(file, 'utf8').split('\n').find(l => l.startsWith('POLYGON_API_KEY='));
  const key = line?.slice('POLYGON_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
  if (!key || key === 'PASTE_KEY_HERE') throw new Error(`No POLYGON_API_KEY in ${file}`);
  return key;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(url) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = await fetch(url).catch(() => null);
    if (res?.status === 200) return res.json();
    await sleep((res?.status === 429 ? 15000 : 3000) * attempt);
  }
  throw new Error(`gave up on ${url.split('?')[0]}`);
}

async function main() {
  const key = readKey();
  const rows = [];
  for (const active of [true, false]) {
    let url = `https://api.polygon.io/v3/reference/tickers?market=stocks&active=${active}&limit=1000&order=asc&sort=ticker`;
    let pages = 0;
    while (url) {
      const data = await getJson(`${url}${url.includes('?') ? '&' : '?'}apiKey=${key}`);
      for (const t of data.results || []) {
        rows.push([t.ticker, t.type || null, !!t.active, t.name || null, t.delisted_utc || null]);
      }
      pages++;
      // next_url carries its own cursor but not the key — it is appended above.
      url = data.next_url || null;
      await sleep(250);
    }
    console.log(`active=${active}: ${pages} pages, running total ${rows.length}`);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, zlib.gzipSync(JSON.stringify({
    fetchedAt: new Date().toISOString(),
    fields: ['ticker', 'type', 'active', 'name', 'delisted_utc'],
    rows,
  })));
  const types = rows.reduce((m, r) => (m[r[1]] = (m[r[1]] || 0) + 1, m), {});
  console.log(`DONE ${rows.length} tickers → ${OUT}`);
  console.log('types:', JSON.stringify(types));
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });

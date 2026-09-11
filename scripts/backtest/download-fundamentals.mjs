// scripts/backtest/download-fundamentals.mjs — inputs for the 100-Bagger replay.
//
// The screen is fundamentals-driven and slow-moving, so the replay runs on
// MONTH-END sessions rather than daily. For each month end it needs the same
// two things the live route fetches:
//   details    /v3/reference/tickers/{t}?date=D   → type + share count, so
//              market cap = shares × that day's price, as the route computes it.
//              Share counts move slowly, so one snapshot per calendar year per
//              ticker is enough; the replay uses the latest one at or before
//              the scan date. Cheap where a daily fetch would be ~100k calls.
//   financials /vX/reference/financials?timeframe=annual … → every annual
//              filing, WITH its filing_date, fetched once per ticker. The
//              replay then uses only filings already public on the scan date,
//              which is what stops the screen from seeing the future.
//
// Output: CTT/backtest-data/fundamentals/universe.json.gz    (month-end universes)
//         CTT/backtest-data/fundamentals/financials/TICKER.json.gz
//         CTT/backtest-data/fundamentals/shares/TICKER.json.gz
// Resumable at file granularity. Local only; reads CTT/.env.backtest.
//
// Usage: node scripts/backtest/download-fundamentals.mjs

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '../..');
const DATA = path.resolve(APP, '../backtest-data');
const OUT = path.join(DATA, 'fundamentals');
const BASE = 'https://api.polygon.io';
const MIN_GAP_MS = 125;          // ≈ 8 req/s, shared with the live scanners
const CONCURRENCY = 6;

// Mirrors MULTIBAGGER in lib/scanConfig + the route's universe construction.
const MIN_PRICE = 2, MAX_PRICE = 500, MIN_VOL = 50_000;
const SKIP_TOP = 100, UNIVERSE_SIZE = 1500;

function readKey() {
  const file = path.resolve(APP, '../.env.backtest');
  const line = fs.readFileSync(file, 'utf8').split('\n').find(l => l.startsWith('POLYGON_API_KEY='));
  const key = line?.slice('POLYGON_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
  if (!key || key === 'PASTE_KEY_HERE') throw new Error(`No POLYGON_API_KEY in ${file}`);
  return key;
}
const KEY = readKey();
const sleep = ms => new Promise(r => setTimeout(r, ms));

let nextSlot = 0;
async function slot() {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + MIN_GAP_MS;
  if (at > now) await sleep(at - now);
}
let calls = 0;
async function get(url) {
  const full = `${BASE}${url}${url.includes('?') ? '&' : '?'}apiKey=${KEY}`;
  for (let attempt = 1; attempt <= 6; attempt++) {
    await slot();
    calls++;
    const res = await fetch(full).catch(() => null);
    if (res?.status === 200) return res.json();
    if (res?.status === 404) return null;
    await sleep((res?.status === 429 ? 15000 : 3000) * attempt);
  }
  throw new Error(`gave up: ${url.split('?')[0]}`);
}
async function pool(items, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < items.length) { const item = items[i++]; await fn(item); }
  }));
}
const writeGz = (file, obj) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, zlib.gzipSync(JSON.stringify(obj)));
  fs.renameSync(`${file}.tmp`, file);
};

/** Month-end sessions, and the route's universe on each, straight from the cache. */
function buildUniverse() {
  const root = path.join(DATA, 'grouped', 'unadj');
  const sessions = [];
  for (const year of fs.readdirSync(root).sort()) {
    for (const f of fs.readdirSync(path.join(root, year)).sort()) {
      if (f.endsWith('.json.gz') && fs.statSync(path.join(root, year, f)).size >= 1000) sessions.push(f.slice(0, 10));
    }
  }
  const monthEnds = sessions.filter((d, i) => i === sessions.length - 1 || sessions[i + 1].slice(0, 7) !== d.slice(0, 7));
  const universes = {};
  for (const date of monthEnds) {
    const rows = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, date.slice(0, 4), `${date}.json.gz`))).toString()).rows;
    const cands = [];
    for (const [T, , , , c, v] of rows) {
      if (!/^[A-Z]{1,5}$/.test(T)) continue;
      if (c < MIN_PRICE || c > MAX_PRICE) continue;
      if (v < MIN_VOL) continue;
      cands.push([T, c * v]);
    }
    cands.sort((a, b) => b[1] - a[1]);
    universes[date] = cands.slice(SKIP_TOP, SKIP_TOP + UNIVERSE_SIZE).map(x => x[0]);
  }
  return { monthEnds, universes };
}

async function main() {
  const started = Date.now();
  const { monthEnds, universes } = buildUniverse();
  const tickers = [...new Set(Object.values(universes).flat())].sort();
  writeGz(path.join(OUT, 'universe.json.gz'), { monthEnds, universes, builtAt: new Date().toISOString() });
  console.log(`${monthEnds.length} month ends, ${tickers.length} distinct tickers`);

  // One share-count snapshot per calendar year (plus the latest month end).
  const asOf = [...new Set(monthEnds.filter(d => d.endsWith('-12-31') || d.slice(5, 7) === '12' || d === monthEnds[monthEnds.length - 1])
    .map(d => d))].sort();
  const yearDates = [];
  for (const y of [...new Set(monthEnds.map(d => d.slice(0, 4)))]) {
    const inYear = monthEnds.filter(d => d.startsWith(y));
    yearDates.push(inYear[inYear.length - 1]);          // last month end of each year
  }
  const shareDates = [...new Set([...yearDates, ...asOf])].sort();
  console.log(`share snapshots on: ${shareDates.join(', ')}`);

  let done = 0;
  await pool(tickers, async t => {
    const fFile = path.join(OUT, 'financials', `${t}.json.gz`);
    if (!fs.existsSync(fFile)) {
      const d = await get(`/vX/reference/financials?ticker=${encodeURIComponent(t)}&timeframe=annual&order=desc&limit=12&sort=period_of_report_date`);
      writeGz(fFile, (d?.results || []).map(r => ({
        filing_date: r.filing_date ?? null, period_of_report_date: r.period_of_report_date ?? null,
        fiscal_year: r.fiscal_year ?? null, fiscal_period: r.fiscal_period ?? null, financials: r.financials ?? null,
      })));
    }
    const sFile = path.join(OUT, 'shares', `${t}.json.gz`);
    if (!fs.existsSync(sFile)) {
      const out = {};
      for (const date of shareDates) {
        const d = await get(`/v3/reference/tickers/${encodeURIComponent(t)}?date=${date}`);
        const r = d?.results;
        if (r) out[date] = {
          type: r.type ?? null,
          weighted_shares_outstanding: r.weighted_shares_outstanding ?? null,
          share_class_shares_outstanding: r.share_class_shares_outstanding ?? null,
          market_cap: r.market_cap ?? null, name: r.name ?? null, sic_description: r.sic_description ?? null,
        };
      }
      writeGz(sFile, out);
    }
    if (++done % 250 === 0) console.log(`${done}/${tickers.length} tickers  calls=${calls}  ${((Date.now() - started) / 60000).toFixed(1)}min`);
  });

  console.log(`DONE ${tickers.length} tickers, calls=${calls} in ${((Date.now() - started) / 60000).toFixed(1)}min`);
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });

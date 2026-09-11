// scripts/backtest/download-lookups.mjs — point-in-time inputs for EP9M v2.
//
// For every name the replay shortlisted (replay/ep9m_shortlist.jsonl), fetch
// what the live route would have seen ON THAT DATE:
//   details  /v3/reference/tickers/{t}?date=D   → type, market cap, share count, name, SIC
//   news     /v2/reference/news?ticker=t&published_utc.lte=D T21:00Z (20 newest, as live)
//   shorts   /stocks/v1/short-interest?ticker=t  — full history once per ticker;
//            the replay picks the latest settlement that was already public on D.
//
// Output: CTT/backtest-data/lookups/bydate/YYYY/DATE.json.gz  ({ticker: {details, news}})
//         CTT/backtest-data/lookups/shorts/TICKER.json.gz     ([[settlement_date, short_interest], …])
// Resumable at file granularity. Local only; reads CTT/.env.backtest (Polygon
// key, no KV credentials). Throttled globally — the live scanners share the key.
//
// Usage: node scripts/backtest/download-lookups.mjs

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '../..');
const DATA = path.resolve(APP, '../backtest-data');
const OUT = path.join(DATA, 'lookups');
const BASE = 'https://api.polygon.io';
const MIN_GAP_MS = 125;      // ≈ 8 requests/second across all workers
const CONCURRENCY = 6;
const NEWS_CLOCK_UTC = 'T21:00:00Z';
const NEWS_FIELDS = ['title', 'description', 'article_url', 'published_utc', 'tickers', 'keywords', 'publisher', 'insights'];

function readKey() {
  const file = path.resolve(APP, '../.env.backtest');
  const line = fs.readFileSync(file, 'utf8').split('\n').find(l => l.startsWith('POLYGON_API_KEY='));
  const key = line?.slice('POLYGON_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
  if (!key || key === 'PASTE_KEY_HERE') throw new Error(`No POLYGON_API_KEY in ${file}`);
  return key;
}
const KEY = readKey();
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Global throttle: each request start waits for its slot.
let nextSlot = 0;
async function slot() {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + MIN_GAP_MS;
  if (at > now) await sleep(at - now);
}

let calls = 0;
async function get(pathOrUrl) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${BASE}${pathOrUrl}`;
  const full = `${url}${url.includes('?') ? '&' : '?'}apiKey=${KEY}`;
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
  fs.renameSync(`${file}.tmp`, file);   // atomic, so a killed run never leaves a half file
};

async function main() {
  const started = Date.now();
  const shortlist = fs.readFileSync(path.join(DATA, 'replay', 'ep9m_shortlist.jsonl'), 'utf8')
    .trim().split('\n').map(l => JSON.parse(l)).filter(d => d.tickers.length);
  const tickers = [...new Set(shortlist.flatMap(d => d.tickers))].sort();
  console.log(`${shortlist.length} sessions, ${shortlist.reduce((n, d) => n + d.tickers.length, 0)} name-days, ${tickers.length} tickers`);

  // Pass 1 — short-interest history, once per ticker.
  let done = 0;
  await pool(tickers, async t => {
    const file = path.join(OUT, 'shorts', `${t}.json.gz`);
    if (fs.existsSync(file)) { done++; return; }
    const rows = [];
    let url = `/stocks/v1/short-interest?ticker=${encodeURIComponent(t)}&sort=settlement_date.asc&limit=1000`;
    while (url) {
      const d = await get(url);
      for (const r of d?.results || []) if (r.settlement_date && r.short_interest != null) rows.push([r.settlement_date, r.short_interest]);
      url = d?.next_url || null;
    }
    writeGz(file, rows);
    if (++done % 500 === 0) console.log(`shorts ${done}/${tickers.length}  calls=${calls}  ${((Date.now() - started) / 60000).toFixed(1)}min`);
  });
  console.log(`shorts done (${tickers.length})  calls=${calls}`);

  // Pass 2 — details + news per shortlisted name-day, one file per session.
  let dates = 0;
  for (const { date, tickers: names } of shortlist) {
    const file = path.join(OUT, 'bydate', date.slice(0, 4), `${date}.json.gz`);
    if (fs.existsSync(file)) { dates++; continue; }
    const out = {};
    await pool(names, async t => {
      const [det, news] = await Promise.all([
        get(`/v3/reference/tickers/${encodeURIComponent(t)}?date=${date}`),
        get(`/v2/reference/news?ticker=${encodeURIComponent(t)}&published_utc.lte=${date}${NEWS_CLOCK_UTC}&limit=20&order=desc&sort=published_utc`),
      ]);
      const r = det?.results;
      out[t] = {
        details: r ? {
          type: r.type ?? null, market_cap: r.market_cap ?? null,
          share_class_shares_outstanding: r.share_class_shares_outstanding ?? null,
          name: r.name ?? null, sic_description: r.sic_description ?? null,
        } : null,
        news: (news?.results || []).map(n => Object.fromEntries(NEWS_FIELDS.filter(k => n[k] != null).map(k => [k, n[k]]))),
      };
    });
    writeGz(file, out);
    if (++dates % 50 === 0 || dates === shortlist.length) {
      console.log(`${date}  ${dates}/${shortlist.length} sessions  calls=${calls}  ${((Date.now() - started) / 60000).toFixed(1)}min`);
    }
  }
  console.log(`DONE calls=${calls} in ${((Date.now() - started) / 60000).toFixed(1)}min`);
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });

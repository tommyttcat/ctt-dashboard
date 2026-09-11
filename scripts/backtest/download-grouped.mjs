// scripts/backtest/download-grouped.mjs
//
// Caches Polygon grouped-daily bars (every US stock, one call per session) to
// disk for the EP9M backtest. Runs locally only — no Vercel, no KV.
//
// Two passes per session, because the scan and the outcome need different
// numbers:
//   unadj — as traded that day. The 9M-share, $2 and $-volume gates must see
//           what a trader saw; split-adjusted history turns a later 1:10
//           reverse split into 1/10th of the volume and silently drops it.
//   adj   — split-adjusted. Indicators and forward returns span splits, so
//           they need one consistent price series.
//
// KEY HANDLING: reads ONLY CTT/.env.backtest (one level above trade-dash, so
// `vercel --prod` never uploads it). That file holds the Polygon key and
// nothing else — deliberately no KV credentials, so nothing run from here can
// reach production KV. The key is never logged.
//
// Resumable: a session already on disk is skipped. Holidays are written as an
// empty marker so they are not re-requested. Throttled to stay well clear of
// the live scanners, which share this key.
//
// Usage: node scripts/backtest/download-grouped.mjs [from YYYY-MM-DD] [to YYYY-MM-DD]

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '../..');
const OUT = path.resolve(APP, '../backtest-data/grouped');

const FROM = process.argv[2] || '2021-09-14'; // Starter plan's 5-year boundary, measured 11 Sep 2026
const TO = process.argv[3] || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const GAP_MS = 250;
// Only what the scan and scoring read. Dropping `t` (identical on every row)
// and `n` keeps the cache small — the disk had 17 GB free when this was written.
const FIELDS = ['T', 'o', 'h', 'l', 'c', 'v', 'vw'];

function readKey() {
  const file = path.resolve(APP, '../.env.backtest');
  const line = fs.readFileSync(file, 'utf8').split('\n').find(l => l.startsWith('POLYGON_API_KEY='));
  const key = line?.slice('POLYGON_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
  if (!key || key === 'PASTE_KEY_HERE') throw new Error(`No POLYGON_API_KEY in ${file}`);
  return key;
}

function weekdays(from, to) {
  const out = [];
  for (let d = new Date(`${from}T12:00:00Z`); d <= new Date(`${to}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchDay(key, date, adjusted) {
  const url = `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=${adjusted}&apiKey=${key}`;
  for (let attempt = 1; attempt <= 6; attempt++) {
    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      await sleep(2000 * attempt);
      continue;
    }
    if (res.status === 200) return res.json();
    if (res.status === 403) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`403 on ${date}: ${body.message || 'forbidden'}`);
    }
    // 429 and 5xx: back off hard — the live scanners share this key.
    await sleep((res.status === 429 ? 15000 : 3000) * attempt);
  }
  throw new Error(`gave up on ${date} adjusted=${adjusted}`);
}

async function main() {
  const key = readKey();
  const dates = weekdays(FROM, TO);
  const started = Date.now();
  let fetched = 0, skipped = 0, holidays = 0, bytes = 0;

  console.log(`grouped-daily cache: ${dates.length} weekdays ${FROM} → ${TO}, 2 passes, out=${OUT}`);

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    for (const [dir, adjusted] of [['unadj', false], ['adj', true]]) {
      const file = path.join(OUT, dir, date.slice(0, 4), `${date}.json.gz`);
      if (fs.existsSync(file)) { skipped++; continue; }

      const data = await fetchDay(key, date, adjusted);
      const rows = (data.results || []).map(r => FIELDS.map(f => r[f] ?? null));
      if (rows.length === 0) holidays++;

      const gz = zlib.gzipSync(JSON.stringify({ date, adjusted, fields: FIELDS, rows }));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, gz);
      bytes += gz.length;
      fetched++;
      await sleep(GAP_MS);
    }
    if ((i + 1) % 25 === 0 || i === dates.length - 1) {
      const mins = ((Date.now() - started) / 60000).toFixed(1);
      console.log(`${date}  ${i + 1}/${dates.length}  fetched=${fetched} skipped=${skipped} holidays=${holidays / 2} disk=${(bytes / 1e6).toFixed(0)}MB  ${mins}min`);
    }
  }
  console.log(`DONE fetched=${fetched} skipped=${skipped} holiday-sessions=${holidays / 2} new-disk=${(bytes / 1e6).toFixed(0)}MB`);
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });

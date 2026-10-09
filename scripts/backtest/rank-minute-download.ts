// scripts/backtest/rank-minute-download.ts — 1-minute bars for the ranked list's possible entry days.
//
//   npx tsx scripts/backtest/rank-minute-download.ts          (resumable)
//
// For every close t from the first ranked month on: the P2 list (momentum +
// earnings top 50, rank-pead.ts) as known at close t, on days when QQQ closed
// above its 200-day average at t (the exposure rule says "in" for t+1). The
// bars are for session t+1 — the day an entry would happen. Regular hours
// only, split-adjusted. Written to backtest-data/minute/rank/YYYY/SYM_DATE.json.gz.
// Six workers pausing 700ms (under ~9 calls/s) because the live app shares the key.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DATA } from './cache';
import { sessions, N, C, c, S0 } from './rank-engine';
import { p2 } from './rank-pead';
import { polygonKey, isRth, type M } from './qullamaggie';

const DIR = path.join(DATA, 'minute', 'rank');
const qId = c.idOf.get('QQQ')!;
const above200 = (t: number) => { let s = 0; for (let j = t - 199; j <= t; j++) s += C[qId][j]; return C[qId][t] > s / 200; };
const fileOf = (sym: string, date: string) => path.join(DIR, date.slice(0, 4), `${sym}_${date}.json.gz`);

const jobs: { sym: string; date: string }[] = [];
for (let t = S0 - 1; t + 1 < N; t++) {
  if (!above200(t)) continue;
  const d = sessions[t + 1];
  for (const id of p2(t)) jobs.push({ sym: c.syms[id], date: d });
}
fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(path.join(DIR, 'jobs.json'), JSON.stringify(jobs));
const queue = jobs.filter(j => !fs.existsSync(fileOf(j.sym, j.date)));
console.log(`entry days ${jobs.length}, to fetch ${queue.length}`);

const key = polygonKey();
let done = 0, failed = 0;
const t0 = Date.now();
const worker = async () => {
  for (let g = queue.shift(); g; g = queue.shift()) {
    const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(g.sym)}/range/1/minute/${g.date}/${g.date}?adjusted=true&sort=asc&limit=50000&apiKey=${key}`;
    let rows: M[] | null = null;
    for (let a = 0; a < 3 && rows == null; a++) {
      const res = await fetch(url).catch(() => null);
      if (res?.ok) {
        const j = await res.json().catch(() => null);
        rows = (j?.results ?? []).map((r: { t: number; o: number; h: number; l: number; c: number; v: number }) => [r.t, r.o, r.h, r.l, r.c, r.v] as M);
      } else await new Promise(r => setTimeout(r, 1500 * (a + 1)));
    }
    if (rows == null) { failed++; continue; }
    fs.mkdirSync(path.dirname(fileOf(g.sym, g.date)), { recursive: true });
    fs.writeFileSync(fileOf(g.sym, g.date), zlib.gzipSync(JSON.stringify(rows.filter(r => isRth(r[0])))));
    if (++done % 1000 === 0) console.log(`${done} (${failed} failed) ${((Date.now() - t0) / 60000).toFixed(1)} min`);
    await new Promise(r => setTimeout(r, 700));
  }
};
Promise.all(Array.from({ length: 6 }, worker)).then(() => console.log(`download done: ${done} fetched, ${failed} failed`));

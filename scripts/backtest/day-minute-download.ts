// scripts/backtest/day-minute-download.ts — 1-minute bars for the Day colour model (12 Oct 2026).
//
//   LONG=1 NODE_OPTIONS=--max-old-space-size=12288 npx tsx scripts/backtest/day-minute-download.ts   (resumable)
//
// UNIVERSE (fixed before any outcome is seen): for each session d from 2021-11-01 (the plan's
// minute-data limit) to the cache's last, names "in play at the open": CS/ADRC, real close
// (d-1) >= $3, 20-session $ volume to d-1 >= $20M, gap = open(d) / close(d-1) - 1 >= 2%;
// the 30 biggest gaps. Regular-hours 1-minute bars of session d, split-adjusted, written to
// backtest-data/minute/day/YYYY/SYM_DATE.json.gz. Six workers pausing 700ms (the live app
// shares the key).

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DATA, loadAdjusted, listSessions, readDay } from './cache';
import { loadReference, refAt } from './reference';
import { polygonKey, isRth, type M } from './qullamaggie';

const c = loadAdjusted();
const ref = loadReference();
const { sessions, syms, O, C, V } = c;
const N = sessions.length;
const RC: Float32Array[] = syms.map(() => new Float32Array(N).fill(NaN));
{ if (listSessions().length !== N) throw new Error('session mismatch');
  for (let s = 0; s < N; s++) for (const r of readDay('unadj', sessions[s])) { const id = c.idOf.get(r[0]); if (id != null) RC[id][s] = r[4]; } }
const typeOk = new Map<string, boolean>();
const isStock = (sym: string, date: string) => { const k = `${sym}|${date.slice(0, 4)}`; if (!typeOk.has(k)) { const t = (refAt(ref, sym, date)?.type || '').toUpperCase(); typeOk.set(k, t === 'CS' || t === 'ADRC'); } return typeOk.get(k)!; };
const DIR = path.join(DATA, 'minute', 'day');
const fileOf = (sym: string, date: string) => path.join(DIR, date.slice(0, 4), `${sym}_${date}.json.gz`);

const jobs: { sym: string; date: string; gap: number }[] = [];
const d0 = sessions.findIndex(d => d >= '2021-11-01');
for (let d = d0; d < N; d++) {
  const day: { sym: string; date: string; gap: number }[] = [];
  for (let id = 0; id < syms.length; id++) {
    const p = C[id][d - 1], o = O[id][d];
    if (!(RC[id][d - 1] >= 3) || !(o > 0) || !(p > 0)) continue;
    const gap = o / p - 1; if (gap < 0.02) continue;
    let dv = 0, ok = true; for (let j = d - 20; j <= d - 1; j++) { if (Number.isNaN(C[id][j])) { ok = false; break; } dv += C[id][j] * V[id][j]; }
    if (!ok || dv / 20 < 20e6 || !isStock(syms[id], sessions[d])) continue;
    day.push({ sym: syms[id], date: sessions[d], gap });
  }
  jobs.push(...day.sort((a, b) => b.gap - a.gap).slice(0, 30));
}
fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(path.join(DIR, 'jobs.json'), JSON.stringify(jobs));
const queue = jobs.filter(j => !fs.existsSync(fileOf(j.sym, j.date)));
console.log(`in-play name-days ${jobs.length} over ${N - d0} sessions, to fetch ${queue.length}`);
const key = polygonKey();
let done = 0, failed = 0; const t0 = Date.now();
const worker = async () => {
  for (let g = queue.shift(); g; g = queue.shift()) {
    const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(g.sym)}/range/1/minute/${g.date}/${g.date}?adjusted=true&sort=asc&limit=50000&apiKey=${key}`;
    let rows: M[] | null = null;
    for (let a = 0; a < 3 && rows == null; a++) {
      const res = await fetch(url).catch(() => null);
      if (res?.ok) { const j = await res.json().catch(() => null); rows = (j?.results ?? []).map((r: { t: number; o: number; h: number; l: number; c: number; v: number }) => [r.t, r.o, r.h, r.l, r.c, r.v] as M); }
      else await new Promise(r => setTimeout(r, 1500 * (a + 1)));
    }
    if (rows == null) { failed++; continue; }
    fs.mkdirSync(path.dirname(fileOf(g.sym, g.date)), { recursive: true });
    fs.writeFileSync(fileOf(g.sym, g.date), zlib.gzipSync(JSON.stringify(rows.filter(r => isRth(r[0])))));
    if (++done % 1000 === 0) console.log(`${done} (${failed} failed) ${((Date.now() - t0) / 60000).toFixed(1)} min`);
    await new Promise(r => setTimeout(r, 700));
  }
};
Promise.all(Array.from({ length: 6 }, worker)).then(() => console.log(`download done: ${done} fetched, ${failed} failed`));

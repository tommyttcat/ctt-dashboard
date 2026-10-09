// scripts/backtest/download-sic.ts — industry (SIC) codes for the liquid universe.
//
//   npx tsx scripts/backtest/download-sic.ts   (resumable)
//
// For industry momentum (rank-industry.ts). Every common stock / ADR that was
// ever in rank-hold.ts's universe at a month-end ($5+, $20M+/day) gets
// Polygon's ticker details as of the last month-end it qualified, so a
// delisted or renamed name is classified as it was then. → reference/sic.json
import fs from 'node:fs';
import path from 'node:path';
import { DATA, loadAdjusted } from './cache';
import { loadReference, refAt } from './reference';
import { polygonKey } from './qullamaggie';

const OUT = path.join(DATA, 'reference', 'sic.json');
const c = loadAdjusted();
const ref = loadReference();
const { sessions, syms, C, V } = c;
const N = sessions.length;
const lastSeen = new Map<string, string>();
for (let t = 21; t < N - 1; t++) {
  if (sessions[t].slice(0, 7) === sessions[t + 1].slice(0, 7)) continue;   // month-ends only
  for (let id = 0; id < syms.length; id++) {
    if (!(C[id][t] >= 5)) continue;
    let dv = 0; for (let j = t - 19; j <= t; j++) dv += C[id][j] * V[id][j];
    if (!(dv / 20 >= 20e6)) continue;
    const ty = (refAt(ref, syms[id], sessions[t])?.type || '').toUpperCase();
    if (ty !== 'CS' && ty !== 'ADRC') continue;
    lastSeen.set(syms[id], sessions[t]);
  }
}
const have: Record<string, { sic: string | null; desc: string | null }> = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const queue = [...lastSeen.entries()].filter(([t]) => !(t in have));
console.log(`universe ${lastSeen.size}, to fetch ${queue.length}`);
const key = polygonKey();
let done = 0;
const save = () => fs.writeFileSync(OUT, JSON.stringify(have));
const worker = async () => {
  for (let x = queue.shift(); x; x = queue.shift()) {
    const [t, d] = x;
    const res = await fetch(`https://api.polygon.io/v3/reference/tickers/${encodeURIComponent(t)}?date=${d}&apiKey=${key}`).catch(() => null);
    const j = res?.ok ? await res.json().catch(() => null) : null;
    have[t] = { sic: j?.results?.sic_code ?? null, desc: j?.results?.sic_description ?? null };
    if (++done % 200 === 0) { save(); console.log(done); }
    await new Promise(r => setTimeout(r, 700));
  }
};
Promise.all(Array.from({ length: 6 }, worker)).then(() => {
  save();
  console.log(`done: ${Object.values(have).filter(v => v.sic).length} of ${Object.keys(have).length} with a SIC code`);
});

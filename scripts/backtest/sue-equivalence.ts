// scripts/backtest/sue-equivalence.ts — does lib/sue.ts compute the tested SUE?
//   npx tsx scripts/backtest/sue-equivalence.ts
// Compares lib/sue (live) with rank-pead.ts's sue() (tested) for every
// ticker with cached fundamentals at every month-end. (Importing rank-pead
// re-runs its report first; that is expected.)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DATA } from './cache';
import { sessions } from './rank-engine';
import { sue } from './rank-pead';
import { sueAt, sueFresh, type Qtr } from '@/lib/sue';
const dir = path.join(DATA, 'fundamentals', 'quarterly');
const ends = sessions.filter((d, i) => i + 1 < sessions.length && d.slice(0, 7) !== sessions[i + 1].slice(0, 7) && d >= '2022-09-01');
let same = 0, diff = 0;
for (const f of fs.readdirSync(dir)) {
  const sym = f.replace('.json.gz', '');
  const q: Qtr[] = (JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString()).q ?? []).map((x: Qtr) => ({ fy: x.fy, fp: x.fp, filed: x.filed, eps: x.eps }));
  for (const d of ends) {
    const want = sue(sym, d);
    const r = sueAt(q, d);
    const got = sueFresh({ s: r.sue, f: r.filed, a: d }, d) ? r.sue : null;
    if ((want == null && got == null) || (want != null && got != null && Math.abs(want - got) < 1e-9)) same++;
    else { diff++; if (diff <= 5) console.log('DIFF', sym, d, want, got); }
  }
}
console.log(`SUE equivalence: ${same} identical, ${diff} different`);
if (diff) process.exitCode = 1;

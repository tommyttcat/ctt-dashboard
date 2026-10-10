// scripts/backtest/other-ways-1.ts — two non-stock-picking edges, 2016-2026 (QQQ only).
//
//   LONG=1 NODE_OPTIONS=--max-old-space-size=8192 npx tsx scripts/backtest/other-ways-1.ts
//
// RULES — fixed 10 Oct 2026, before the first run.
//   A LEVERAGED TREND: synthetic 3x QQQ = 3 x QQQ's daily close-to-close return
//     - 0.95%/yr fund fee - 2 x 4%/yr borrowing on the extra exposure.
//     A0 3x always. A1 3x while QQQ closed above its 200-day (decided at the
//     prior close), else cash at 3%/yr; 0.1% per switch. A2 A1 but 1x QQQ
//     instead of cash below the 200-day.
//   B OVERNIGHT: B1 hold QQQ close -> next open only; B2 open -> close only;
//     0.02% a side for B1/B2 (one round trip a day). B0 = QQQ held.
//   Benchmark QQQ held. Halves 2016-2020 / 2021-2026.
//   PASS (each A1/A2/B1): total above QQQ AND CAGR / worst drop above QQQ's,
//     BOTH halves.

import { loadAdjusted } from './cache';
const c = loadAdjusted();
const { sessions, O, C } = c;
const N = sessions.length;
const q = c.idOf.get('QQQ')!;
const idx = (d: string) => { const i = sessions.findIndex(x => x >= d); return i < 0 ? N : i; };
const S = idx('2016-01-01'), MID = idx('2021-01-01');
const s200 = (t: number) => { let s = 0; for (let j = t - 199; j <= t; j++) s += C[q][j]; return s / 200; };
const r = (d: number) => C[q][d] / C[q][d - 1] - 1;
const lev3 = (d: number) => 3 * r(d) - 0.0095 / 252 - 2 * 0.04 / 252;
const series: Record<string, Float64Array> = {};
const mk = (f: (d: number) => number) => { const v = new Float64Array(N).fill(1); for (let d = S; d < N; d++) v[d] = v[d - 1] * (1 + f(d)); return v; };
let pe = 0;
series['QQQ held'] = mk(r);
series['A0 3x always'] = mk(lev3);
pe = 1; series['A1 3x above 200-day, else cash'] = mk(d => { const on = C[q][d - 1] > s200(d - 1); const e = on ? 1 : 0; const sw = Math.abs(e - pe) * 0.001; pe = e; return (on ? lev3(d) : 0.03 / 252) - sw; });
pe = 1; series['A2 3x above 200-day, else 1x'] = mk(d => { const on = C[q][d - 1] > s200(d - 1); const e = on ? 1 : 0; const sw = Math.abs(e - pe) * 0.001; pe = e; return (on ? lev3(d) : r(d)) - sw; });
series['B1 overnight only'] = mk(d => O[q][d] / C[q][d - 1] - 1 - 0.0004);
series['B2 intraday only'] = mk(d => C[q][d] / O[q][d] - 1 - 0.0004);
const seg = (v: Float64Array, a: number, b: number) => { let pk = 0, dd = 0; for (let d = a; d <= b; d++) { pk = Math.max(pk, v[d]); dd = Math.max(dd, 1 - v[d] / pk); } const tot = v[b] / v[a - 1] - 1; const cagr = (1 + tot) ** (252 / (b - a + 1)) - 1; return { tot, dd, cagr, r: cagr / dd }; };
const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%`;
const names = Object.keys(series);
console.log(`year   ${names.map(n => n.split(' ')[0].padStart(7)).join('')}`);
for (const y of [...new Set(sessions.slice(S).map(d => d.slice(0, 4)))]) { const a = idx(`${y}-01-01`), b = Math.min(N, idx(`${+y + 1}-01-01`)) - 1; console.log(`${y}   ${names.map(n => pct(series[n][b] / series[n][a - 1] - 1).padStart(7)).join('')}`); }
const H = [[S, MID - 1], [MID, N - 1]];
const qh = H.map(([a, b]) => seg(series['QQQ held'], a, b));
for (const n of names) { const h = H.map(([a, b]) => seg(series[n], a, b)); const test = /^(A1|A2|B1)/.test(n); const pass = test && h.every((x, i) => x.tot > qh[i].tot && x.r > qh[i].r);
  console.log(`${n.padEnd(32)} 2016-20 ${pct(h[0].tot).padStart(7)} CAGR ${pct(h[0].cagr).padStart(5)} drop ${pct(-h[0].dd).padStart(5)} | 2021-26 ${pct(h[1].tot).padStart(7)} CAGR ${pct(h[1].cagr).padStart(5)} drop ${pct(-h[1].dd).padStart(5)}${test ? (pass ? '  → PASS' : '  → fail') : ''}`); }

// scripts/backtest/index-overlay.ts — beat SPY by managing index exposure, not picking.
//
//   npx tsx scripts/backtest/index-overlay.ts
//
// rank-risk-check.ts showed the best stock ranking only matched QQQ. This
// asks whether timing EXPOSURE to the index does better than holding it.
//
// RULES — fixed 9 Oct 2026, before the first run. Local bars only. Signals at
// a close act AT that close (a market-on-close order), so exposure applies to
// close-to-close returns from the next session on. Cash earns 4% a year; borrowed exposure
// costs 5% a year. Whole cache (Sep 2021 - Sep 2026) after a 200-session
// warm-up; split at the middle session.
//   Panic signal (panic.ts P2, the one that passed thinly on 28 Sep): the
//     share of stocks above their 40-day average is 20% or lower, rebuilt
//     exactly as panic.ts does. One episode per 10-session window (a signal
//     inside an active window does not extend it).
//   B0  SPY held.            B1  QQQ held.
//   O1  QQQ held, 150% QQQ for the 10 sessions after a panic signal.
//   O2  SPY held, 150% SPY for the 10 sessions after a panic signal.
//   O3  QQQ when it closed above its 200-day average, else cash.
//   O4  O3, but 150% QQQ for the 10 sessions after a panic signal, whatever
//       the trend says.
//   PASS (QQQ variants O1/O3/O4): total return above QQQ's AND return per
//     unit of worst drop (CAGR / max drawdown) above QQQ's in BOTH halves.
//     (O2 against SPY on the same terms.) Few panic episodes = little
//     evidence even on a pass; the count is printed.

import { listSessions, readDay } from './cache';

const sessions = listSessions();
const N = sessions.length;
const px: Record<'SPY' | 'QQQ', { o: number; c: number }[]> = { SPY: [], QQQ: [] };
const hist = new Map<string, number[]>();
const breadth: (number | null)[] = [];
for (const d of sessions) {
  let above = 0, total = 0;
  for (const r of readDay('adj', d)) {
    if (r[0] === 'SPY' || r[0] === 'QQQ') px[r[0] as 'SPY' | 'QQQ'].push({ o: r[1], c: r[4] });
    const c = r[4]; if (!(c > 0)) continue;
    let h = hist.get(r[0]); if (!h) { h = []; hist.set(r[0], h); }
    h.push(c); if (h.length > 41) h.shift();
    if (h.length < 41) continue;
    let s = 0; for (let i = 1; i < 41; i++) s += h[i];
    total++; if (c > s / 40) above++;
  }
  breadth.push(total >= 100 ? (100 * above) / total : null);
}
if (px.SPY.length !== N || px.QQQ.length !== N) throw new Error('SPY/QQQ missing on some sessions');

const START = 200;
const MID = START + Math.floor((N - 1 - START) / 2);
const CASH = 0.04 / 252, BORROW = 0.05 / 252;

// panic windows: exposure boost on sessions d+1 .. d+10 after a signal at close d
const boost = new Array<boolean>(N).fill(false);
let episodes = 0, until = -1;
for (let d = START; d < N - 1; d++) {
  if (d <= until) continue;
  if (breadth[d] != null && (breadth[d] as number) <= 20) {
    episodes++; until = d + 10;
    for (let k = d + 1; k <= Math.min(N - 1, d + 10); k++) boost[k] = true;
  }
}
const sma200 = (sym: 'SPY' | 'QQQ', d: number) => { let s = 0; for (let j = d - 199; j <= d; j++) s += px[sym][j].c; return s / 200; };

/** Daily NAV for an exposure rule. Exposure for session d is decided at close d-1 and applied open-to-close on d plus overnight into d+1 via close-to-close returns; the first day enters at the open. */
function run(sym: 'SPY' | 'QQQ', exposure: (d: number) => number): Float64Array {
  const nav = new Float64Array(N).fill(1);
  for (let d = START + 1; d < N; d++) {
    const e = exposure(d);
    const r = d === START + 1 ? px[sym][d].c / px[sym][d].o - 1 : px[sym][d].c / px[sym][d - 1].c - 1;
    const fin = e > 1 ? -(e - 1) * BORROW : (1 - e) * CASH;
    nav[d] = nav[d - 1] * (1 + e * r + fin);
  }
  return nav;
}
const trendOn = (d: number) => px.QQQ[d - 1].c > sma200('QQQ', d - 1);
const strategies: [string, Float64Array, 'SPY' | 'QQQ' | null][] = [
  ['B0 SPY', run('SPY', () => 1), null],
  ['B1 QQQ', run('QQQ', () => 1), null],
  ['O1 QQQ + panic 150%', run('QQQ', d => (boost[d] ? 1.5 : 1)), 'QQQ'],
  ['O2 SPY + panic 150%', run('SPY', d => (boost[d] ? 1.5 : 1)), 'SPY'],
  ['O3 QQQ above 200-day', run('QQQ', d => (trendOn(d) ? 1 : 0)), 'QQQ'],
  ['O4 O3 + panic 150%', run('QQQ', d => (boost[d] ? 1.5 : trendOn(d) ? 1 : 0)), 'QQQ'],
];

const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
function seg(nav: Float64Array, a: number, b: number) {
  let pk = 0, dd = 0; for (let d = a; d <= b; d++) { pk = Math.max(pk, nav[d]); dd = Math.max(dd, 1 - nav[d] / pk); }
  const tot = nav[b] / nav[a] - 1, cagr = (1 + tot) ** (252 / (b - a)) - 1;
  return { tot, dd, ratio: dd > 0 ? cagr / dd : Infinity };
}
console.log(`window ${sessions[START]} → ${sessions[N - 1]}, split ${sessions[MID]}; panic episodes ${episodes}`);
const ref: Record<string, { all: ReturnType<typeof seg>; h1: ReturnType<typeof seg>; h2: ReturnType<typeof seg> }> = {};
for (const [name, nav, vs] of strategies) {
  const all = seg(nav, START, N - 1), h1 = seg(nav, START, MID), h2 = seg(nav, MID, N - 1);
  if (!vs) ref[name.includes('QQQ') ? 'QQQ' : 'SPY'] = { all, h1, h2 };
  let verdict = '';
  if (vs) {
    const b = ref[vs];
    verdict = all.tot > b.all.tot && h1.ratio > b.h1.ratio && h2.ratio > b.h2.ratio ? '  → PASS' : '  → fail';
  }
  console.log(`${name.padEnd(22)} total ${pct(all.tot).padStart(8)} worst drop ${pct(-all.dd).padStart(7)} CAGR/DD ${all.ratio.toFixed(2)} | 1st ${pct(h1.tot).padStart(7)} (${h1.ratio.toFixed(2)}) 2nd ${pct(h2.tot).padStart(7)} (${h2.ratio.toFixed(2)})${verdict}`);
}

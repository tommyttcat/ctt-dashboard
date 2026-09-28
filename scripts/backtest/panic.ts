// scripts/backtest/panic.ts — does buying the panic pay?
//
// Run from trade-dash:  npx tsx scripts/backtest/panic.ts
// Local bars only (backtest-data/grouped), no network, no KV.
//
// 28 Sep 2026: futures down hard, the reader: "stock market is fucked. make me
// money." The classic volatility trade for someone without options or shorts
// is to buy the index when everyone else is dumping it. This tests whether
// that paid in our five years, before anyone relies on it.
//
// RULES — fixed 28 Sep 2026 BEFORE running.
//   Signals, judged at the close of day d, bought at the NEXT open:
//     P1  big down day      SPY closes 2% or more below the prior close
//     P2  washed out        the share of stocks above their 40-day average
//                           (the dashboard's reading, rebuilt as
//                           analyze-t2108.ts does) is 20% or lower
//     P3  three-day flush   SPY is down 4% or more over the last 3 sessions
//   Instruments: SPY (primary) and QQQ.
//   Hold: 5, 10 and 20 sessions, exit at that session's close; 10 is primary.
//   No overlap: after a signal, the next one counts only once the previous
//   hold has ended, so one sell-off is one episode, not ten.
//   Baseline: the same instrument's return over EVERY 10-session window from
//   a next-open entry in the same period (what any random day paid).
//   Split: Sep 2021 - 15 May 2025 / 16 May 2025 on, as every test.
//   PASS (per signal, SPY, 10 sessions): average return above the baseline's
//   in BOTH periods, win rate above the baseline's overall, and at least 10
//   episodes. Few episodes means little evidence even on a pass — say so.

import { listSessions, readDay } from './cache';

const CUT = '2025-05-16';
const HOLDS = [5, 10, 20];

function main() {
  const sessions = listSessions();
  const N = sessions.length;
  const px: Record<'SPY' | 'QQQ', { o: number; c: number }[]> = { SPY: [], QQQ: [] };
  const hist = new Map<string, number[]>();
  const t2108: (number | null)[] = [];
  for (const d of sessions) {
    let above = 0, total = 0;
    const rows = readDay('adj', d);
    for (const r of rows) {
      if (r[0] === 'SPY' || r[0] === 'QQQ') px[r[0] as 'SPY' | 'QQQ'].push({ o: r[1], c: r[4] });
      const c = r[4]; if (!(c > 0)) continue;
      let h = hist.get(r[0]); if (!h) { h = []; hist.set(r[0], h); }
      h.push(c); if (h.length > 41) h.shift();
      if (h.length < 41) continue;
      let s = 0; for (let i = 1; i < 41; i++) s += h[i];
      total++; if (c > s / 40) above++;
    }
    t2108.push(total >= 100 ? (100 * above) / total : null);
  }
  if (px.SPY.length !== N || px.QQQ.length !== N) throw new Error('SPY/QQQ missing on some sessions');

  const spy = px.SPY;
  const sig: Record<string, (d: number) => boolean> = {
    'P1 big down day (SPY -2%)': d => d >= 1 && spy[d].c / spy[d - 1].c - 1 <= -0.02,
    'P2 washed out (<=20% above 40-day)': d => t2108[d] != null && (t2108[d] as number) <= 20,
    'P3 three-day flush (SPY -4% in 3)': d => d >= 3 && spy[d].c / spy[d - 3].c - 1 <= -0.04,
  };
  const ret = (T: 'SPY' | 'QQQ', d: number, hold: number) =>
    d + hold < N ? (px[T][d + hold].c / px[T][d + 1].o - 1) * 100 : null;
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const f = (v: number) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '—');
  const half = (d: number) => (sessions[d] < CUT ? 0 : 1);

  // Baseline: every day's next-open entry, 10 sessions.
  for (const T of ['SPY', 'QQQ'] as const) {
    const all = [0, 1].map(h => [] as number[]);
    for (let d = 41; d < N; d++) { const r = ret(T, d, 10); if (r != null) all[half(d)].push(r); }
    const w = [...all[0], ...all[1]];
    console.log(`${T} baseline, any day, 10 sessions: ${f(mean(all[0]))} / ${f(mean(all[1]))} (periods), win ${(100 * w.filter(x => x > 0).length / w.length).toFixed(0)}%`);
  }

  for (const [name, test] of Object.entries(sig)) {
    console.log(`\n${name}`);
    for (const T of ['SPY', 'QQQ'] as const) {
      for (const hold of HOLDS) {
        const eps: { d: number; r: number }[] = [];
        let busyUntil = -1;
        for (let d = 41; d < N - 1; d++) {
          if (d <= busyUntil || !test(d)) continue;
          const r = ret(T, d, hold); if (r == null) continue;
          eps.push({ d, r }); busyUntil = d + hold;
        }
        const byH = [0, 1].map(h => eps.filter(e => half(e.d) === h).map(e => e.r));
        const rs = eps.map(e => e.r);
        const win = rs.length ? (100 * rs.filter(x => x > 0).length) / rs.length : NaN;
        const worst = rs.length ? Math.min(...rs) : NaN;
        const base = [0, 1].map(h => { const a: number[] = []; for (let d = 41; d < N; d++) if (half(d) === h) { const r = ret(T, d, hold); if (r != null) a.push(r); } return mean(a); });
        const baseWin = (() => { const a: number[] = []; for (let d = 41; d < N; d++) { const r = ret(T, d, hold); if (r != null) a.push(r); } return (100 * a.filter(x => x > 0).length) / a.length; })();
        const pass = T === 'SPY' && hold === 10 && eps.length >= 10 && mean(byH[0]) > base[0] && mean(byH[1]) > base[1] && win > baseWin;
        console.log(`  ${T} hold ${String(hold).padStart(2)}: ${String(eps.length).padStart(3)} episodes (${byH[0].length} / ${byH[1].length})  avg ${f(mean(rs))}  periods ${f(mean(byH[0]))} / ${f(mean(byH[1]))}  vs any day ${f(base[0])} / ${f(base[1])}  win ${win.toFixed(0)}% (any day ${baseWin.toFixed(0)}%)  worst ${f(worst)}${T === 'SPY' && hold === 10 ? (pass ? '  PASS' : '  fail') : ''}`);
        if (T === 'SPY' && hold === 10) console.log(`     dates: ${eps.map(e => `${sessions[e.d]} ${f(e.r)}`).join(' · ')}`);
      }
    }
  }
}

main();

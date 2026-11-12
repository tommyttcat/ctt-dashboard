// lib/earningsMoves.ts — the move options price in for an upcoming earnings report, and how
// past reports compared (Unusual Whales). 12 Nov 2026, owner asked for it after looking at an
// earnings-volatility scanner: not a trade signal, a "how big could this be" check before
// holding a swing through a report.
//
// Sources (measured 12 Nov):
//   /api/earnings/premarket?date=&limit=500 and /afterhours?date=&limit=500 — every reporter
//     that session with expected_move_perc (null when it has no listed options). 14-72 KB;
//     131 after-hours reporters on 12 Nov, 71 with a priced move. limit=500 returns all in one page.
//   /api/earnings/{ticker} — every past report: expected_move_perc and post_earnings_move_1d.
//     ~75 KB, ~120 rows. Spot check 12 Nov, last 8 reports each: CSCO 4/8, NVDA 3/8, AMAT 5/8
//     moved more than priced — about a coin flip, so this says SIZE, not direction or edge.
// Weakness: the priced move for a report several days out spans ordinary days too, so it
// reads high (NVDA 5 days out: ±8.3% vs ±5-6% on its past report days).
// Licence: individual use — shown only behind the login, never published.

import { uwGet, uwGetMany } from './uw';

export type EarnMove = { d: string; time: 'pre' | 'post'; pct: number };
export type EarnHist = { n: number; beat: number; max: number };

const n = (v: unknown): number => { const x = typeof v === 'number' ? v : parseFloat(String(v ?? '')); return Number.isFinite(x) ? x : NaN; };

/** Every reporter with a priced move on these dates, by ticker (2 calls per date). */
export async function reportersOn(dates: string[]): Promise<Record<string, EarnMove>> {
  const paths = dates.flatMap(d => [`/api/earnings/premarket?date=${d}&limit=500`, `/api/earnings/afterhours?date=${d}&limit=500`]);
  const res = await uwGetMany<{ data: any[] }>(paths);
  if (res.every(r => r == null)) throw new Error('earnings lists unavailable');
  const out: Record<string, EarnMove> = {};
  for (const r of res) for (const x of r?.data ?? []) {
    const t = String(x?.symbol ?? '').toUpperCase(), pct = n(x?.expected_move_perc), d = String(x?.report_date ?? '').slice(0, 10);
    if (!t || !(pct > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const move: EarnMove = { d, time: x.report_time === 'premarket' ? 'pre' : 'post', pct: Math.round(pct * 1000) / 1000 };
    if (!out[t] || d < out[t].d) out[t] = move;
  }
  return out;
}

/** The last 8 completed reports: how many moved more than priced, and the biggest next-day move. */
export async function historyFor(ticker: string): Promise<EarnHist | null> {
  const raw = await uwGet<{ data: any[] }>(`/api/earnings/${encodeURIComponent(ticker)}`);
  const past = (raw?.data ?? [])
    .map(x => ({ d: String(x?.report_date ?? ''), em: n(x?.expected_move_perc), mv: n(x?.post_earnings_move_1d) }))
    .filter(x => x.em > 0 && Number.isFinite(x.mv))
    .sort((a, b) => b.d.localeCompare(a.d)).slice(0, 8);
  if (!past.length) return null;
  const max = past.reduce((m, x) => (Math.abs(x.mv) > Math.abs(m) ? x.mv : m), 0);
  return { n: past.length, beat: past.filter(x => Math.abs(x.mv) > x.em).length, max: Math.round(max * 1000) / 1000 };
}

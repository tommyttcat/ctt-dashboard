// lib/scans/neglect.ts — "neglected before today" for the day checklist (12 Oct 2026).
//
// The neglect half of the episodic-pivot rules (lib/epNeglect N1 + N2, the one gap setup with
// a positive tested result: +0.93% a trade, 86 trades, Jul 2022 - Sep 2026 — too few to rule
// out luck). Judged on the bars BEFORE today:
//   N1 hadn't run: close <= 15% above 63 sessions earlier and <= 30% above 126 sessions earlier
//   N2 was quiet:  the last 60 sessions' high-to-low range under 60%
// Bars oldest first; a bar dated `today` (ET) is today's and is skipped.

export type NBar = { t: number; h: number; l: number; c: number };

const etDate = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

export function neglectOf(bars: NBar[], today: string = etDate(Date.now())): { neglected: boolean | null; preRun3m: number | null; preRun6m: number | null; range60: number | null } {
  const none = { neglected: null, preRun3m: null, preRun6m: null, range60: null };
  let k = bars.length - 1;
  if (k >= 0 && etDate(bars[k].t) === today) k--;
  if (k < 126) return none;
  const p = bars[k].c, c63 = bars[k - 63].c, c126 = bars[k - 126].c;
  if (!(p > 0 && c63 > 0 && c126 > 0)) return none;
  let hi = -Infinity, lo = Infinity;
  for (let j = k - 59; j <= k; j++) { hi = Math.max(hi, bars[j].h); lo = Math.min(lo, bars[j].l); }
  const preRun3m = +((p / c63 - 1) * 100).toFixed(1), preRun6m = +((p / c126 - 1) * 100).toFixed(1);
  const range60 = lo > 0 ? +(((hi - lo) / lo) * 100).toFixed(1) : null;
  return { neglected: preRun3m <= 15 && preRun6m <= 30 && range60 != null && range60 < 60, preRun3m, preRun6m, range60 };
}

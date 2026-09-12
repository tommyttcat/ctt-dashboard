'use client';

/* components/TrackRecord.tsx — the live record, member-facing.
 *
 * The backtests answered "did these scans work over the last five years".
 * This page answers the question that keeps answering itself: what have they
 * picked since, and what happened to it. Every row here was recorded by the
 * nightly tick BEFORE the outcome was known — nothing on this page is
 * selected after the fact, and nothing is excluded for looking bad.
 *
 * It is deliberately unflattering in three ways:
 *   - the backtest figure sits beside the live one, so a scan that is
 *     underperforming its own test is visible rather than buried.
 *   - the sample size is shown on every row. Early on it is far too small to
 *     mean anything, and the page says so rather than implying otherwise.
 *   - 10/21 is on the page even though its five-year number is negative.
 *
 * Data: /api/track/latest — aggregates only, ~1.2 KB, cached at the edge for
 * ten minutes (stale-while-revalidate an hour), so this page costs about one
 * KV read per ten minutes no matter how many people open it.
 */

import React, { useEffect, useState } from 'react';
import { ThemeToggle } from './ThemeProvider';
import DashNav from './DashNav';
import { SCAN_STATS, type StatScan } from '@/lib/scans/stats';

interface ScanRecord {
  picks: number;
  entered: number;
  settled: number;
  hrRate: number | null;
  fixedAvgR: number | null;
  hold20AvgR: number | null;
  winRate: number | null;
  byTier: Record<string, { n: number; avgR: number | null; hr: number | null }>;
}

interface Payload {
  success: boolean;
  results: Record<string, ScanRecord>;
  meta: { lastBarDate?: string; tickedAt?: string; startedAt?: string } | null;
  openCount: number;
  openByScan: Record<string, number>;
}

/** Display order, the label the reader sees, and which backtest it compares to. */
const ROWS: { scan: string; label: string; stat: StatScan }[] = [
  { scan: 'sip', label: 'Stocks in Play', stat: 'scanner' },
  { scan: 'daily', label: 'Daily Setups', stat: 'scanner' },
  { scan: 'ep9m', label: 'EP9M', stat: 'ep9m' },
  { scan: 'swing', label: 'Swing Candidates', stat: 'swing' },
  { scan: 'vcp', label: 'VCP', stat: 'vcp' },
  { scan: 'consolidation', label: '10/21 Coils', stat: 'consolidation' },
  { scan: 'hrs', label: 'Hidden RS', stat: 'hrs' },
  { scan: 'multibagger', label: '100-Bagger', stat: 'multibagger' },
];

const TIER_CLS: Record<string, string> = {
  green: 'text-emerald-400',
  yellow: 'text-amber-400',
  red: 'text-rose-400',
};

const fmtR = (v: number | null | undefined) =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}R`;
const fmtPct = (v: number | null | undefined) =>
  v == null ? '—' : `${v.toFixed(1)}%`;

const rCls = (v: number | null | undefined) =>
  v == null ? 'text-slate-500' : v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-slate-300';

const TH = 'text-[9px] font-bold tracking-widest uppercase text-slate-500 px-2 py-2 text-right';
const TD = 'text-[10px] px-2 py-2 text-right tabular-nums';

export default function TrackRecord() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/track/latest')
      .then(r => r.json())
      .then(j => {
        if (!alive) return;
        if (j?.success) setData(j);
        else setError('Track record unavailable.');
      })
      .catch(() => { if (alive) setError('Track record unavailable.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const results = data?.results ?? {};
  const openByScan = data?.openByScan ?? {};
  const totalPicks = Object.values(results).reduce((n, r) => n + (r?.picks ?? 0), 0);
  const totalSettled = Object.values(results).reduce((n, r) => n + (r?.settled ?? 0), 0);

  return (
    <div className="min-h-screen bg-[#0b0f1a] text-slate-300 px-3 md:px-6 py-4 max-w-[1100px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <a href="/dashboard" className="flex items-center gap-3 min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="CTT" className="w-8 h-8 md:w-10 md:h-10 opacity-80" />
          <div>
            <h1 className="text-lg md:text-xl font-bold text-slate-100 tracking-tight">Track Record</h1>
            <p className="text-[10px] text-slate-500 tracking-widest uppercase">Live picks, scored as they mature</p>
          </div>
        </a>
        <div className="flex items-center gap-2 shrink-0">
          <ThemeToggle />
          <DashNav />
        </div>
      </div>

      {/* What this is */}
      <div className="mb-4 px-3 md:px-5 py-3 bg-slate-900/50 border border-white/[0.06] rounded-lg">
        <p className="text-[10px] text-slate-400 leading-relaxed">
          Every name each scan publishes is recorded the evening it appears, before anything is known about
          what it does next. Entry is the <strong className="text-slate-200">next session&apos;s open</strong>;
          the stop is the row&apos;s own plan stop, or that day&apos;s low when it has none; a trade settles at
          the 2R target, the stop, or the close of the 20th session — whichever comes first. Nothing is added
          later, nothing is removed for looking bad, and the five-year backtest figure sits beside the live one
          so you can see which scans are keeping up with their own test.
        </p>
        <p className="text-[10px] text-slate-500 leading-relaxed mt-2">
          Costs are not modelled. Early samples are far too small to conclude anything from — a scan needs
          hundreds of settled trades before its average means much, and the backtest column is there as the
          reminder of what that looks like.
        </p>
      </div>

      {/* Totals */}
      <div className="mb-4 flex flex-wrap gap-4 px-3 md:px-5 py-2.5 bg-slate-900/40 border border-white/[0.04] rounded-lg text-[10px]">
        <span><span className="text-slate-500">Picks recorded</span> <span className="text-slate-200 font-semibold tabular-nums">{totalPicks.toLocaleString()}</span></span>
        <span><span className="text-slate-500">Open now</span> <span className="text-slate-200 font-semibold tabular-nums">{(data?.openCount ?? 0).toLocaleString()}</span></span>
        <span><span className="text-slate-500">Settled</span> <span className="text-slate-200 font-semibold tabular-nums">{totalSettled.toLocaleString()}</span></span>
        {data?.meta?.lastBarDate && (
          <span><span className="text-slate-500">Through</span> <span className="text-slate-200 font-semibold">{data.meta.lastBarDate}</span></span>
        )}
      </div>

      {loading ? (
        <div className="py-16 text-center text-[10px] text-slate-500 tracking-widest uppercase animate-pulse">Loading track record…</div>
      ) : error ? (
        <div className="py-12 text-center text-[11px] text-rose-400">{error}</div>
      ) : totalPicks === 0 ? (
        <div className="py-12 text-center text-[11px] text-slate-500">
          Tracking starts with the next evening tick — nothing has been recorded yet.
        </div>
      ) : (
        <div className="overflow-x-auto custom-scrollbar border border-white/[0.06] rounded-lg bg-slate-900/40">
          <table className="w-full min-w-[820px] border-collapse">
            <thead>
              <tr className="border-b border-white/5">
                <th className={`${TH} !text-left`}>Scan</th>
                <th className={TH} title="Names published by this scan and recorded before the outcome was known">Picks</th>
                <th className={TH} title="Still open — inside the 20-session window and not yet stopped">Open</th>
                <th className={TH} title="Reached the target, the stop, or the 20th session">Settled</th>
                <th className={TH} title="Share of settled trades that closed positive">Win</th>
                <th className={TH} title="Average R on the 2R-or-stop bracket">Avg R</th>
                <th className={TH} title="Average R holding to the close of the 20th session">Hold 20</th>
                <th className={TH} title="Reached +50% or +10R before the stop">+50%</th>
                <th className={TH} title="The same measure over the 5-year backtest, for comparison">5-yr test</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(({ scan, label, stat }) => {
                const r = results[scan];
                const bt = SCAN_STATS[stat].bt;
                const tiers = Object.entries(r?.byTier ?? {}).filter(([, v]) => v.n > 0);
                return (
                  <React.Fragment key={scan}>
                    <tr className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                      <td className="text-[10px] px-2 py-2 text-left font-semibold text-slate-200 whitespace-nowrap">{label}</td>
                      <td className={`${TD} text-slate-300`}>{r?.picks ?? 0}</td>
                      <td className={`${TD} text-slate-400`}>{openByScan[scan] ?? 0}</td>
                      <td className={`${TD} text-slate-400`}>{r?.settled ?? 0}</td>
                      <td className={`${TD} text-slate-300`}>{fmtPct(r?.winRate)}</td>
                      <td className={`${TD} font-semibold ${rCls(r?.fixedAvgR)}`}>{fmtR(r?.fixedAvgR)}</td>
                      <td className={`${TD} font-semibold ${rCls(r?.hold20AvgR)}`}>{fmtR(r?.hold20AvgR)}</td>
                      <td className={`${TD} text-slate-300`}>{fmtPct(r?.hrRate)}</td>
                      <td className={`${TD} text-slate-500`} title={SCAN_STATS[stat].detail}>
                        {bt.fixedAvgR == null ? 'n/a' : `${fmtR(bt.fixedAvgR)} · ${fmtPct(bt.hrRate)}`}
                        <span className="block text-[9px] text-slate-600">n={bt.n.toLocaleString()}</span>
                      </td>
                    </tr>
                    {tiers.length > 0 && (
                      <tr className="border-b border-white/[0.04] bg-white/[0.01]">
                        <td colSpan={9} className="px-2 py-1.5">
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500">
                            <span className="text-slate-600 font-bold tracking-widest uppercase">By shading</span>
                            {tiers.map(([tier, v]) => (
                              <span key={tier}>
                                <span className={TIER_CLS[tier] ?? 'text-slate-400'}>{tier}</span>{' '}
                                <span className="text-slate-400 tabular-nums">n={v.n}</span>{' '}
                                <span className={`tabular-nums ${rCls(v.avgR)}`}>{fmtR(v.avgR)}</span>{' '}
                                <span className="text-slate-500 tabular-nums">{fmtPct(v.hr)} ran +50%</span>
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-[10px] text-slate-600 leading-relaxed">
        The live record uses the same simulator as the backtest (next-open entry, first-passage on daily bars,
        a minimum risk floor so a stop inside the spread cannot manufacture an R-multiple). The one difference:
        the trailing-EMA exits are not tracked live, because they need a running EMA per position. The 2R
        bracket and the 20-session hold bracket the trailing result on every table tested.
      </p>
    </div>
  );
}

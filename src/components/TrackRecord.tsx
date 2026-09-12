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
 * KV read per ten minutes no matter how many people open it. Clicking a scan
 * fetches /api/track/detail?scan=… once and keeps it; that route is cached on
 * the same profile and keyed by scan name, so the drill-down is flat in users
 * too. Nothing polls.
 */

import React, { useEffect, useState } from 'react';
import { ThemeToggle } from './ThemeProvider';
import DashNav from './DashNav';
import TickerChartHover from './TickerChartHover';
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

interface Position {
  t: string; d: string; tier: string | null; score: number | null;
  fill: number | null; stop: number | null; target: number | null; last: number | null;
  n: number; hr: boolean; status: 'pending' | 'running' | 'target' | 'stopped' | 'closed';
  peakPct: number | null; openR: number | null;
  exitFixed: number | null; exitHold20: number | null;
}

interface Detail {
  success: boolean;
  scan: string;
  holdSessions: number;
  openCount: number;
  closedCount: number;
  open: Position[];
  closed: Position[];
  truncated: boolean;
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

const STATUS_META: Record<Position['status'], { label: string; cls: string; tip: string }> = {
  pending: { label: 'Pending', cls: 'text-slate-400 bg-white/[0.04] border-white/10', tip: 'Picked after the close — fills at the next session\'s open.' },
  running: { label: 'Running', cls: 'text-sky-400 bg-sky-500/10 border-sky-500/20', tip: 'Filled, not stopped, target not reached yet.' },
  target: { label: 'Target', cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', tip: 'Reached the 2R target before the stop. Still followed to the end of the window for the +50% test.' },
  stopped: { label: 'Stopped', cls: 'text-rose-400 bg-rose-500/10 border-rose-500/20', tip: 'Traded through the stop. The R shown is what the bracket realised.' },
  closed: { label: 'Closed', cls: 'text-slate-300 bg-white/[0.04] border-white/10', tip: 'Ran the full window without hitting either bracket — marked at the close.' },
};

const fmtNum = (v: number | null | undefined, dp = 2) => (v == null ? '—' : v.toFixed(dp));

/* ---- the drill-down table ------------------------------------------------
   Open positions first, because that is what a reader can still act on, then
   the closed ones newest first. Both carry the same columns so the eye does
   not have to re-learn the row halfway down.

   "Open R" on a live position is marked at the last close and is unrealised;
   the R columns on a closed one are what the bracket actually realised. They
   are kept in separate columns for that reason rather than blended into one
   number that means two different things. */
function PositionTable({ detail }: { detail: Detail }) {
  const rows: { p: Position; live: boolean }[] = [
    ...detail.open.map(p => ({ p, live: true })),
    ...detail.closed.map(p => ({ p, live: false })),
  ];

  return (
    <div className="overflow-x-auto custom-scrollbar">
      <div className="text-[10px] text-slate-500 mb-2">
        {detail.openCount} open · {detail.closedCount} closed
        {detail.truncated ? ' · showing the 150 most recent of each' : ''}
        {' · '}a position is followed for {detail.holdSessions} sessions after it fills, so a trade that
        hits its target or its stop still shows here until that window is up.
      </div>
      <table className="w-full min-w-[760px] border-collapse">
        <thead>
          <tr className="border-b border-white/5">
            <th className={`${TH} !text-left`}>Ticker</th>
            <th className={`${TH} !text-left`}>Picked</th>
            <th className={TH} title="The row shading at the time of the pick">Shade</th>
            <th className={TH} title="Next session's open">Fill</th>
            <th className={TH}>Stop</th>
            <th className={TH} title="Fill + 2R">Target</th>
            <th className={TH} title="Sessions since the fill">Held</th>
            <th className={TH} title="Best print since the fill, in percent">Peak</th>
            <th className={TH} title="Marked at the last close — unrealised">Open R</th>
            <th className={TH} title="Realised R on the 2R-or-stop bracket">2R</th>
            <th className={TH} title="Realised R at the close of the 20th session">Hold 20</th>
            <th className={TH}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ p, live }) => {
            const st = STATUS_META[p.status];
            return (
              <tr key={`${p.t}-${p.d}`} className={`border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors ${live ? '' : 'opacity-80'}`}>
                <td className="text-[10px] px-2 py-1.5 text-left font-semibold text-slate-200 whitespace-nowrap">
                  <TickerChartHover symbol={p.t}><span>{p.t}</span></TickerChartHover>
                  {p.hr && <span className="ml-1.5 text-[9px] font-bold text-emerald-400" title="Ran +50% (or +10R) before the stop">+50%</span>}
                </td>
                <td className="text-[10px] px-2 py-1.5 text-left text-slate-500 whitespace-nowrap tabular-nums">{p.d}</td>
                <td className={`${TD} ${p.tier ? TIER_CLS[p.tier] ?? 'text-slate-500' : 'text-slate-600'}`}>{p.tier ?? '—'}</td>
                <td className={`${TD} text-slate-300`}>{fmtNum(p.fill)}</td>
                <td className={`${TD} text-slate-400`}>{fmtNum(p.stop)}</td>
                <td className={`${TD} text-slate-400`}>{fmtNum(p.target)}</td>
                <td className={`${TD} text-slate-500`}>{p.fill == null ? '—' : p.n}</td>
                <td className={`${TD} ${(p.peakPct ?? 0) > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>{p.peakPct == null ? '—' : `${p.peakPct >= 0 ? '+' : ''}${p.peakPct.toFixed(1)}%`}</td>
                <td className={`${TD} ${rCls(p.openR)}`}>{live ? fmtR(p.openR) : '—'}</td>
                <td className={`${TD} font-semibold ${rCls(p.exitFixed)}`}>{fmtR(p.exitFixed)}</td>
                <td className={`${TD} ${rCls(p.exitHold20)}`}>{fmtR(p.exitHold20)}</td>
                <td className="px-2 py-1.5 text-right">
                  <span className={`text-[9px] font-bold tracking-wider uppercase px-1.5 py-[2px] rounded border ${st.cls}`} title={st.tip}>{st.label}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function TrackRecord() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* Drill-down. One scan open at a time, fetched the first time it is opened
     and kept after that — the detail route is edge-cached, so reopening a row
     costs nothing, and closing one should not throw the rows away. */
  const [openScan, setOpenScan] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, Detail>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);

  const toggleScan = React.useCallback((scan: string) => {
    setOpenScan(prev => (prev === scan ? null : scan));
    if (details[scan] || detailLoading === scan) return;
    setDetailLoading(scan);
    fetch(`/api/track/detail?scan=${encodeURIComponent(scan)}`)
      .then(r => r.json())
      .then(j => { if (j?.success) setDetails(d => ({ ...d, [scan]: j })); })
      .catch(() => {})
      .finally(() => setDetailLoading(cur => (cur === scan ? null : cur)));
  }, [details, detailLoading]);

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
        <p className="text-[10px] text-slate-500 leading-relaxed mt-2">
          <strong className="text-slate-300">Click any scan</strong> to see the individual picks behind its
          numbers — every ticker, when it was picked, where it filled, where the stop was, and what it has
          done since.
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
                const isOpen = openScan === scan;
                const detail = details[scan];
                return (
                  <React.Fragment key={scan}>
                    <tr
                      className={`border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors cursor-pointer ${isOpen ? 'bg-white/[0.03]' : ''}`}
                      onClick={() => toggleScan(scan)}
                      title={isOpen ? 'Hide the individual picks' : 'Show the individual picks behind these numbers'}
                    >
                      <td className="text-[10px] px-2 py-2 text-left font-semibold text-slate-200 whitespace-nowrap">
                        <span className={`inline-block mr-1.5 text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}>▸</span>
                        {label}
                      </td>
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
                    {isOpen && (
                      <tr className="border-b border-white/[0.06] bg-[#0d1220]">
                        <td colSpan={9} className="px-2 py-3">
                          {detailLoading === scan && !detail ? (
                            <div className="py-4 text-center text-[10px] text-slate-500 tracking-widest uppercase animate-pulse">Loading picks…</div>
                          ) : !detail ? (
                            <div className="py-4 text-center text-[10px] text-slate-500">Detail unavailable.</div>
                          ) : detail.open.length === 0 && detail.closed.length === 0 ? (
                            <div className="py-4 text-center text-[10px] text-slate-500">No picks recorded for this scan yet.</div>
                          ) : (
                            <PositionTable detail={detail} />
                          )}
                        </td>
                      </tr>
                    )}
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

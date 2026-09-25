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
import TickerChartHover, { ActiveChartProvider } from './TickerChartHover';
import { WatchlistProvider } from './WatchlistContext';
import { SCAN_STATS, type StatScan } from '@/lib/scans/stats';
import {
  EDGE_TINT, EDGE_FILTER_TIP, EP9M_TIP, VCP_TIP, SWING_TIP, CONSOLIDATION_TIP,
  MULTIBAGGER_TIP, HRS_TIP, type EdgeTier,
} from '@/lib/scans/edge';
import { MB, SWITCH_AFTER_TRADES, type ModelBook } from '@/lib/modelBook';
import { ORB_MINUTES, ORB_VOL_MULT } from '@/lib/orb';

interface Interim {
  n: number;
  fixedAvgR: number | null;
  hold20AvgR: number | null;
  winRate: number | null;
  hrRate: number | null;
  retAvgPct?: number | null;
  doubleRate?: number | null;
}

interface ScanRecord {
  picks: number;
  entered: number;
  settled: number;
  hrRate: number | null;
  fixedAvgR: number | null;
  hold20AvgR: number | null;
  winRate: number | null;
  byTier: Record<string, { n: number; avgR: number | null; hr: number | null }>;
  retAvgPct?: number | null;
  doubleRate?: number | null;
  interim?: Interim | null;
}

interface Position {
  /* Present only in the cross-scan book, where a row is meaningless without
     it. The per-scan drill-down already knows its own scan. */
  scan?: string;
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

/* The record kept the way the picks are presented — lib/trackPlan. */
interface PlanScanRecord {
  picked: number; filled: number; missed: number; failed: number; expired: number;
  closed: number; wins: number; sumR: number; watching: number; open: number;
}
interface PlanPos {
  scan: string; t: string; d: string; tier: string | null;
  buy: number; stop: number; dip: boolean;
  state: 'watching' | 'filled' | 'target' | 'stopped' | 'timeout' | 'missed' | 'failed' | 'expired';
  fill: number | null; fillDate: string | null; r: number | null; closedOn: string | null;
}
interface PlanPayload { startedOn: string; byScan: Record<string, PlanScanRecord>; recent: PlanPos[]; updatedAt?: string }

interface Payload {
  success: boolean;
  plan?: PlanPayload | null;
  book?: ModelBook | null;
  bookV2?: ModelBook | null;
  results: Record<string, ScanRecord>;
  meta: { lastBarDate?: string; tickedAt?: string; startedAt?: string } | null;
  openCount: number;
  openByScan: Record<string, number>;
}

/** Display order, the label the reader sees, and which backtest it compares to. */
/* `mode` is the measuring stick, not a display preference. 100-Bagger was
   validated as 12-month excess return with no stop anywhere in it, so an R
   column on that row would be a number that looks like the others and means
   something else. It reports in percent and says so. */
const ROWS: { scan: string; label: string; stat: StatScan; mode: 'r' | 'return' }[] = [
  { scan: 'sip', label: 'Stocks in Play', stat: 'scanner', mode: 'r' },
  { scan: 'daily', label: 'Daily Setups', stat: 'scanner', mode: 'r' },
  { scan: 'ep9m', label: 'EP9M', stat: 'ep9m', mode: 'r' },
  { scan: 'swing', label: 'Swing Candidates', stat: 'swing', mode: 'r' },
  { scan: 'vcp', label: 'VCP', stat: 'vcp', mode: 'r' },
  { scan: 'consolidation', label: '10/21 Coils', stat: 'consolidation', mode: 'r' },
  { scan: 'hrs', label: 'Hidden RS', stat: 'hrs', mode: 'r' },
  { scan: 'multibagger', label: '100-Bagger', stat: 'multibagger', mode: 'return' },
];

/* scan key -> the name a reader knows it by, for the cross-scan book. */
const SCAN_LABEL: Record<string, string> = Object.fromEntries(ROWS.map(r => [r.scan, r.label]));

const TIER_CLS: Record<string, string> = {
  green: 'text-emerald-400',
  yellow: 'text-amber-400',
  red: 'text-rose-400',
};

const fmtR = (v: number | null | undefined) =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}R`;
const fmtPct = (v: number | null | undefined) =>
  v == null ? '—' : `${v.toFixed(1)}%`;

/* R as dollars: the reader should not need to know what R is. An R is the
   amount risked on the trade (entry minus stop), so +0.26R is "+$26 for
   every $100 risked". Same number, plain words. */
const fmtUsd = (r: number | null | undefined) => {
  if (r == null) return '—';
  const d = Math.round(r * 100);
  return `${d > 0 ? '+' : d < 0 ? '−' : ''}$${Math.abs(d)}`;
};

const rCls = (v: number | null | undefined) =>
  v == null ? 'text-slate-500' : v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-slate-300';

const TH = 'text-[9px] font-bold tracking-widest uppercase text-slate-500 px-2 py-2 text-right';
const TD = 'text-[10px] px-2 py-2 text-right tabular-nums';
const TH_SCAN = `${TH} cursor-pointer hover:text-slate-300 transition-colors select-none`;
/* The columns that step aside on a phone. Written out in full rather than
   built by concatenation so Tailwind's scanner can see it. */
const HIDE = 'hidden md:table-cell';

type ScanSortKey = 'default' | 'label' | 'trades' | 'win' | 'avgR' | 'bt';

const STATUS_META: Record<Position['status'], { label: string; cls: string; tip: string }> = {
  pending: { label: 'Pending', cls: 'text-slate-400 bg-white/[0.04] border-white/10', tip: 'Picked after the close — fills at the next session\'s open.' },
  running: { label: 'Running', cls: 'text-sky-400 bg-sky-500/10 border-sky-500/20', tip: 'Filled, not stopped, target not reached yet.' },
  target: { label: 'Target', cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', tip: 'Reached the 2R target before the stop. Still followed to the end of the window for the +50% test.' },
  stopped: { label: 'Stopped', cls: 'text-rose-400 bg-rose-500/10 border-rose-500/20', tip: 'Traded through the stop. The R shown is what the bracket realised.' },
  closed: { label: 'Closed', cls: 'text-slate-300 bg-white/[0.04] border-white/10', tip: 'Ran the full window without hitting either bracket — marked at the close.' },
};

const fmtNum = (v: number | null | undefined, dp = 2) => (v == null ? '—' : v.toFixed(dp));

/* ---- the drill-down table ------------------------------------------------
   The rows carry the same shading as the scan cards, so the colour a pick was
   given at the time is visible on the record of what it then did — which is
   the only way to check the claim the colour makes. Every column sorts; the
   default is open positions first, newest pick first, because that is what a
   reader can still act on.

   "Open R" on a live position is marked at the last close and is unrealised;
   the R columns on a closed one are what the bracket actually realised. They
   are kept apart for that reason rather than blended into one number that
   means two different things. */

const TIER_TIPS: Record<string, Record<string, string>> = {
  sip: EDGE_FILTER_TIP, daily: EDGE_FILTER_TIP, ep9m: EP9M_TIP, vcp: VCP_TIP,
  swing: SWING_TIP, consolidation: CONSOLIDATION_TIP, hrs: HRS_TIP, multibagger: MULTIBAGGER_TIP,
};

type PosSortKey = 'default' | 'ticker' | 'd' | 'fill' | 'stop' | 'target' | 'n' | 'peakPct' | 'openR' | 'exitFixed' | 'exitHold20' | 'status';

const STATUS_ORDER: Record<Position['status'], number> = { target: 5, running: 4, pending: 3, closed: 2, stopped: 1 };

function PositionTable({ detail, showScan = false }: { detail: Detail; showScan?: boolean }) {
  const [sortKey, setSortKey] = useState<PosSortKey>('default');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const toggleSort = (k: PosSortKey) => {
    if (sortKey === k) {
      // desc -> asc -> back to the default view, the same three-state cycle the
      // scan tables use.
      if (sortDir === 'desc') setSortDir('asc');
      else { setSortKey('default'); setSortDir('desc'); }
    } else {
      setSortKey(k); setSortDir('desc');
    }
  };

  const arrow = (k: PosSortKey) => (sortKey === k ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '');

  const rows = React.useMemo(() => {
    const all: { p: Position; live: boolean }[] = [
      ...detail.open.map(p => ({ p, live: true })),
      ...detail.closed.map(p => ({ p, live: false })),
    ];
    if (sortKey === 'default') {
      return all.sort((a, b) =>
        (a.live === b.live ? 0 : a.live ? -1 : 1) || (a.p.d < b.p.d ? 1 : a.p.d > b.p.d ? -1 : 0));
    }
    const num = (p: Position): number | null => {
      switch (sortKey) {
        case 'fill': return p.fill;
        case 'stop': return p.stop;
        case 'target': return p.target;
        case 'n': return p.fill == null ? null : p.n;
        case 'peakPct': return p.peakPct;
        case 'openR': return p.openR;
        case 'exitFixed': return p.exitFixed;
        case 'exitHold20': return p.exitHold20;
        case 'status': return STATUS_ORDER[p.status];
        default: return null;
      }
    };
    const dir = sortDir === 'desc' ? -1 : 1;
    return all.sort((a, b) => {
      if (sortKey === 'ticker') return dir * (a.p.t < b.p.t ? -1 : a.p.t > b.p.t ? 1 : 0);
      if (sortKey === 'd') return dir * (a.p.d < b.p.d ? -1 : a.p.d > b.p.d ? 1 : 0);
      const av = num(a.p), bv = num(b.p);
      // A row with no value sorts to the bottom whichever way the column runs —
      // an empty cell is missing information, not a small number.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return dir * (av - bv);
    });
  }, [detail, sortKey, sortDir]);

  const tips = TIER_TIPS[detail.scan] ?? EDGE_FILTER_TIP;
  const TH_SORT = `${TH} cursor-pointer hover:text-slate-300 transition-colors select-none`;

  return (
    /* No scroller below md — with eight columns hidden the table already
       fits, and an overflow-x-auto box on iOS swallows a horizontal swipe
       even when it has nowhere to scroll. That is what "the tables slide"
       was. The scroller returns at md, where the min-width does too. */
    <div className="md:overflow-x-auto md:overflow-y-hidden custom-scrollbar">
      <div className="text-[10px] text-slate-500 mb-2">
        {detail.openCount} open · {detail.closedCount} closed
        {detail.truncated ? ' · showing the 150 most recent of each' : ''}
        {' · '}a position is followed for {detail.holdSessions} sessions after it fills, so a trade that
        hits its target or its stop still shows here until that window is up. Row colour is the shading the
        pick carried on the day it was made.
      </div>
      {/* Twelve columns is a desktop table. On a phone it was 720px of
          sideways scrolling to read four numbers, so the eight that answer
          "how did this trade go in detail" drop out below md and the four that
          answer "what is this and where does it stand" remain. The min-width
          goes with them — with nothing forcing the table wide, the scroller
          never engages and the page stops moving. */}
      <table className="w-full md:min-w-[720px] border-collapse">
        <thead>
          <tr className="border-b border-white/5">
            <th className={`${TH_SORT} !text-left`} onClick={() => toggleSort('ticker')}>Ticker{arrow('ticker')}</th>
            {showScan && <th className={`${TH} !text-left ${HIDE}`}>Scan</th>}
            <th className={`${TH_SORT} !text-left`} onClick={() => toggleSort('d')}>Picked{arrow('d')}</th>
            <th className={`${TH_SORT} ${HIDE}`} onClick={() => toggleSort('fill')} title="Next session's open">Fill{arrow('fill')}</th>
            <th className={`${TH_SORT} ${HIDE}`} onClick={() => toggleSort('stop')}>Stop{arrow('stop')}</th>
            <th className={`${TH_SORT} ${HIDE}`} onClick={() => toggleSort('target')} title="Fill + 2R">Target{arrow('target')}</th>
            <th className={`${TH_SORT} ${HIDE}`} onClick={() => toggleSort('n')} title="Sessions since the fill">Held{arrow('n')}</th>
            <th className={`${TH_SORT} ${HIDE}`} onClick={() => toggleSort('peakPct')} title="Best print since the fill, in percent">Peak{arrow('peakPct')}</th>
            <th className={TH_SORT} onClick={() => toggleSort('openR')} title="Marked at the last close — unrealised">Open R{arrow('openR')}</th>
            <th className={`${TH_SORT} ${HIDE}`} onClick={() => toggleSort('exitFixed')} title="Realised R on the 2R-or-stop bracket">2R{arrow('exitFixed')}</th>
            <th className={TH_SORT} onClick={() => toggleSort('status')}>Status{arrow('status')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ p, live }) => {
            const st = STATUS_META[p.status];
            const tint = p.tier ? EDGE_TINT[p.tier as EdgeTier] ?? '' : '';
            return (
              <tr
                key={`${p.t}-${p.d}`}
                className={`border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors ${tint} ${live ? '' : 'opacity-80'}`}
                title={p.tier ? `${p.tier.toUpperCase()} at pick time — ${tips[p.tier] ?? ''}` : undefined}
              >
                <td className="text-[10px] px-2 py-1.5 text-left font-semibold text-slate-200 whitespace-nowrap">
                  <TickerChartHover symbol={p.t}>
                    <span className="border-b border-dotted border-white/25 hover:border-white/60 hover:text-white transition-colors" title={`${p.t} — hover for the chart`}>{p.t}</span>
                  </TickerChartHover>
                  {p.hr && <span className="ml-1.5 text-[9px] font-bold text-emerald-400" title="Ran +50% (or +10R) before the stop">+50%</span>}
                </td>
                {showScan && (
                  <td className={`text-[10px] px-2 py-1.5 text-left text-slate-400 whitespace-nowrap ${HIDE}`}>
                    {SCAN_LABEL[p.scan ?? ''] ?? p.scan ?? '—'}
                  </td>
                )}
                <td className="text-[10px] px-2 py-1.5 text-left text-slate-500 whitespace-nowrap tabular-nums">{p.d}</td>
                <td className={`${TD} text-slate-300 ${HIDE}`}>{fmtNum(p.fill)}</td>
                <td className={`${TD} text-slate-400 ${HIDE}`}>{fmtNum(p.stop)}</td>
                <td className={`${TD} text-slate-400 ${HIDE}`}>{fmtNum(p.target)}</td>
                <td className={`${TD} text-slate-500 ${HIDE}`}>{p.fill == null ? '—' : p.n}</td>
                <td className={`${TD} ${HIDE} ${(p.peakPct ?? 0) > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>{p.peakPct == null ? '—' : `${p.peakPct >= 0 ? '+' : ''}${p.peakPct.toFixed(1)}%`}</td>
                <td className={`${TD} ${rCls(p.openR)}`}>{live ? fmtR(p.openR) : '—'}</td>
                <td className={`${TD} font-semibold ${HIDE} ${rCls(p.exitFixed)}`}>{fmtR(p.exitFixed)}</td>
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

/* ---- Followed the levels ---------------------------------------------------
   The record a reader can hold the site to. Every table says "buy above X,
   stop Y, don't chase" — so this counts a pick only when it actually traded
   its buy level, scores it on the same stop and 2R target, and reports the
   picks that never gave an entry separately instead of hiding them. The
   next-open record below stays because it is what the 5-year test measured. */

const PLAN_ROWS = ROWS.filter(r => ['sip', 'daily', 'ep9m', 'swing', 'vcp', 'consolidation'].includes(r.scan));

const PLAN_STATE: Record<PlanPos['state'], { label: string; cls: string; tip: string }> = {
  target: { label: 'Hit target', cls: 'text-emerald-400', tip: 'Reached its buy level, then twice its risk before the stop.' },
  stopped: { label: 'Stopped', cls: 'text-rose-400', tip: 'Reached its buy level, then its stop.' },
  timeout: { label: '60 days', cls: 'text-slate-300', tip: 'Reached its buy level, then neither target nor stop in 60 sessions — scored on that close.' },
  missed: { label: 'Gapped past', cls: 'text-slate-500', tip: 'Opened more than a normal day past its buy level. The site says don\'t chase, so it was not bought.' },
  failed: { label: 'Stop first', cls: 'text-slate-500', tip: 'Fell to its stop before it ever reached its buy level. Never bought.' },
  expired: { label: 'Never reached', cls: 'text-slate-500', tip: 'Did not trade its buy level within 10 sessions. Never bought.' },
  watching: { label: 'Waiting', cls: 'text-slate-400', tip: 'Not at its buy level yet.' },
  filled: { label: 'Open', cls: 'text-sky-400', tip: 'Bought at its buy level; neither target nor stop yet.' },
};

/* ---- Model Book (lib/modelBook) -------------------------------------------
   One paper account run by fixed rules. Everything else on this page scores
   picks one at a time; this is what an account would actually have held. */
const BOOK_SCAN_LABEL: Record<string, string> = { sip: 'Stocks in Play', daily: 'Daily Setups', swing: 'Swing', ep9m: 'EP9M' };
const money = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
const pctCls = (v: number | null) => (v == null ? 'text-slate-500' : v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-slate-300');
const fmtSigned = (v: number | null, dp = 1) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(dp)}%`);

/* Both books on one line each, plus SPY — the comparison the switch rule reads. */
function BookVersus({ v1, v2 }: { v1: ModelBook | null | undefined; v2: ModelBook | null | undefined }) {
  const row = (label: string, b: ModelBook | null | undefined) => {
    const t = b?.totals;
    const ret = b ? (b.equity / MB.equity0 - 1) * 100 : null;
    return (
      <tr key={label} className="border-b border-white/[0.04]">
        <td className="text-[10px] py-2 text-left font-semibold text-slate-200 whitespace-nowrap">{label}</td>
        <td className={`${TD} font-semibold ${pctCls(ret)}`}>{b ? fmtSigned(ret) : '—'}</td>
        <td className={`${TD} text-slate-300`}>{b ? `${b.maxDdPct.toFixed(1)}%` : '—'}</td>
        <td className={`${TD} text-slate-300`}>{t ? <>{t.wins} <span className="text-slate-600">of {t.trades}</span></> : '—'}</td>
        <td className={`${TD} font-semibold ${rCls(t && t.trades ? t.sumR / t.trades : null)}`}>{fmtUsd(t && t.trades ? t.sumR / t.trades : null)}</td>
      </tr>
    );
  };
  const ref = v1 ?? v2;
  const spyRet = ref?.spy0 && ref.spyLast ? (ref.spyLast / ref.spy0 - 1) * 100 : null;
  return (
    <div className="mb-3 border border-white/[0.08] rounded-lg bg-slate-900/40 overflow-hidden">
      <div className="px-3 md:px-5 pt-3 pb-1.5">
        <h2 className="text-[11px] font-bold tracking-widest uppercase text-sky-400">Model Books, head to head</h2>
        <p className="text-[11px] text-slate-300 leading-relaxed mt-1">
          Two $100,000 paper accounts, identical except for how they buy. Once both have {SWITCH_AFTER_TRADES} finished trades,
          the breakout book becomes the main one only if it beats both the open book and SPY, with a worst drop no more than
          5 points deeper. The rule was set before either started.
        </p>
      </div>
      <div className="px-3 md:px-5 pb-2">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-white/5">
              <th className={`${TH} !text-left !px-0`}>Book</th>
              <th className={TH}>Since start</th>
              <th className={TH}>Worst drop</th>
              <th className={TH}>Winners</th>
              <th className={TH}>Per $100</th>
            </tr>
          </thead>
          <tbody>
            {row('Buy at the open', v1)}
            {row('Volume breakout', v2)}
            <tr className="border-b border-white/[0.04]">
              <td className="text-[10px] py-2 text-left font-semibold text-slate-400 whitespace-nowrap">SPY</td>
              <td className={`${TD} font-semibold ${pctCls(spyRet)}`}>{fmtSigned(spyRet)}</td>
              <td className={`${TD} text-slate-600`}>—</td>
              <td className={`${TD} text-slate-600`}>—</td>
              <td className={`${TD} text-slate-600`}>—</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BookSection({ book, v2 = false }: { book: ModelBook | null | undefined; v2?: boolean }) {
  const ret = book ? (book.equity / MB.equity0 - 1) * 100 : null;
  const spyRet = book?.spy0 && book.spyLast ? (book.spyLast / book.spy0 - 1) * 100 : null;
  const t = book?.totals;
  const perHundred = t && t.trades ? t.sumR / t.trades : null;
  const free = book ? Math.max(0, MB.maxPos - book.open.length) : 0;
  const buys = book ? [...book.candidates].sort((a, b) => b.rs - a.rs) : [];
  const atOpen = buys.filter(c => c.kind === 'open' || c.kind === 'orb');
  const dips = buys.filter(c => c.kind === 'dip');

  return (
    <div className={`mb-6 border rounded-lg bg-slate-900/40 overflow-hidden ${v2 ? 'border-violet-500/25' : 'border-sky-500/25'}`}>
      <div className="px-3 md:px-5 pt-3 pb-2.5">
        <h2 className={`text-[11px] font-bold tracking-widest uppercase ${v2 ? 'text-violet-400' : 'text-sky-400'}`}>
          {v2 ? 'Model Book v2 · volume breakout' : 'Model Book · buy at the open'}
        </h2>
        {v2 ? (
          <p className="text-[11px] text-slate-300 leading-relaxed mt-1">
            The same account and rules with <strong className="text-slate-100">one change: how it buys</strong>. A Stocks in Play,
            Daily or Swing pick is bought the next session only if it breaks the high of the first {ORB_MINUTES} minutes while
            volume runs at least {ORB_VOL_MULT}× its normal pace. No breakout that session, no trade. EP9M keeps its dip entry.
            Judged each evening from that session&apos;s minute bars.
          </p>
        ) : (
          <p className="text-[11px] text-slate-300 leading-relaxed mt-1">
            One <strong className="text-slate-100">$100,000 paper account</strong>{' '}trading the scans by fixed rules: green rows
            only, strongest RS first, at most 10 positions, 0.5% of the account at risk on each, the card&apos;s stop, and sold at
            the close of the 20th session. Every buy and sell is recorded the evening it happens, against simply owning SPY.
          </p>
        )}
        {!book ? (
          <p className="text-[11px] text-amber-400/80 leading-relaxed mt-1.5">
            Starts with tonight&apos;s close. The first buys happen at the next morning&apos;s open.
          </p>
        ) : (t?.trades ?? 0) < 30 ? (
          <p className="text-[11px] text-amber-400/80 leading-relaxed mt-1.5">
            Started {book.startedOn}. {t?.trades ? `${t.trades} trade${t.trades === 1 ? '' : 's'} finished` : 'No trade has finished yet'} — far too few to judge.
            A system like this wins about one trade in three and makes most of its money on a handful of big runs.
          </p>
        ) : null}
      </div>

      {book && (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 md:px-5 pb-2.5 text-[10px]">
            <span><span className="text-slate-500">Account</span> <span className="text-slate-200 font-semibold tabular-nums">{money(book.equity)}</span></span>
            <span><span className="text-slate-500">Since start</span> <span className={`font-semibold tabular-nums ${pctCls(ret)}`}>{fmtSigned(ret)}</span></span>
            <span><span className="text-slate-500">SPY</span> <span className={`font-semibold tabular-nums ${pctCls(spyRet)}`}>{fmtSigned(spyRet)}</span></span>
            <span><span className="text-slate-500">Worst drop</span> <span className="text-slate-200 font-semibold tabular-nums">{book.maxDdPct.toFixed(1)}%</span></span>
            <span><span className="text-slate-500">Winners</span> <span className="text-slate-200 font-semibold tabular-nums">{t!.wins} of {t!.trades}</span></span>
            <span><span className="text-slate-500">Per $100 risked</span> <span className={`font-semibold tabular-nums ${rCls(perHundred)}`}>{fmtUsd(perHundred)}</span></span>
            <span><span className="text-slate-500">Open</span> <span className="text-slate-200 font-semibold tabular-nums">{book.open.length} of {MB.maxPos}</span></span>
            {v2 && (
              <span><span className="text-slate-500">Data gaps</span> <span className={`font-semibold tabular-nums ${(book.dataGaps ?? 0) > 0 ? 'text-amber-400' : 'text-slate-200'}`}>{book.dataGaps ?? 0}</span></span>
            )}
          </div>

          {buys.length > 0 && (
            <div className="px-3 md:px-5 py-2.5 border-t border-white/[0.06]">
              <div className="text-[10px] font-bold tracking-widest uppercase text-slate-500 mb-1.5">
                Next session&apos;s buys <span className="normal-case tracking-normal font-normal text-slate-600">· {free} slot{free === 1 ? '' : 's'} free, strongest RS first, the rest waitlisted</span>
              </div>
              <div className="flex flex-col">
                {[...atOpen, ...dips].map((c, i) => {
                  const inSlot = c.kind !== 'dip' && i < free;
                  return (
                    <div key={`${c.t}-${c.d}`} className="flex items-center gap-2 py-1 border-b border-white/[0.03] text-[10px] whitespace-nowrap">
                      <span className="w-12 font-semibold text-slate-200 shrink-0">
                        <TickerChartHover symbol={c.t}><span className="border-b border-dotted border-white/25">{c.t}</span></TickerChartHover>
                      </span>
                      <span className="text-slate-500 w-24 truncate shrink-0 hidden sm:inline">{BOOK_SCAN_LABEL[c.scan] ?? c.scan}</span>
                      <span className="text-slate-400 tabular-nums truncate">
                        {/* Phones get the short form so the stop is never the part that gets cut. */}
                        {c.kind === 'dip' ? `Dip to ${c.buy!.toFixed(2)}` : c.kind === 'orb'
                          ? <><span className="sm:hidden">{ORB_MINUTES}-min breakout</span><span className="hidden sm:inline">Above {ORB_MINUTES}-min high on {ORB_VOL_MULT}× vol</span></>
                          : 'At the open'} · Stop {c.stop.toFixed(2)}
                      </span>
                      <span className="text-slate-500 tabular-nums hidden sm:inline">RS {c.rs >= 0 ? c.rs : '—'}</span>
                      <span className={`ml-auto font-semibold ${c.kind === 'dip' ? 'text-slate-400' : inSlot ? 'text-sky-400' : 'text-slate-500'}`}>
                        {c.kind === 'dip' ? 'If it dips' : !inSlot ? 'Waitlist' : c.kind === 'orb' ? 'If it breaks out' : 'Buy'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="px-3 md:px-5 py-2.5 border-t border-white/[0.06]">
            <div className="text-[10px] font-bold tracking-widest uppercase text-slate-500 mb-1.5">Holding</div>
            {book.open.length === 0 ? (
              <p className="text-[10px] text-slate-500">Nothing open.</p>
            ) : (
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className={`${TH} !text-left !px-0`}>Ticker</th>
                    <th className={`${TH} ${HIDE}`}>Bought</th>
                    <th className={TH}>Entry</th>
                    <th className={TH}>Stop</th>
                    <th className={TH}>Last</th>
                    <th className={TH}>P&amp;L</th>
                    <th className={`${TH} ${HIDE}`}>Size</th>
                    <th className={TH}>Day</th>
                  </tr>
                </thead>
                <tbody>
                  {[...book.open].sort((a, b) => a.entryDate.localeCompare(b.entryDate)).map(h => {
                    const pl = (h.last / h.fill - 1) * 100;
                    return (
                      <tr key={`${h.t}-${h.entryDate}`} className="border-b border-white/[0.04]">
                        <td className="text-[10px] py-2 text-left font-semibold text-slate-200 whitespace-nowrap">
                          <TickerChartHover symbol={h.t}><span className="border-b border-dotted border-white/25">{h.t}</span></TickerChartHover>
                        </td>
                        <td className={`${TD} text-slate-400 ${HIDE}`}>{h.entryDate}</td>
                        <td className={`${TD} text-slate-300`}>{h.fill.toFixed(2)}</td>
                        <td className={`${TD} text-slate-400`}>{h.stop.toFixed(2)}</td>
                        <td className={`${TD} text-slate-300`}>{h.last.toFixed(2)}</td>
                        <td className={`${TD} font-semibold ${pctCls(pl)}`}>{fmtSigned(pl)}</td>
                        <td className={`${TD} text-slate-400 ${HIDE}`}>{((h.sh * h.last / book.equity) * 100).toFixed(0)}%</td>
                        <td className={`${TD} text-slate-400`}>{h.n} of {MB.hold}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {book.closed.length > 0 && (
            <div className="px-3 md:px-5 py-2.5 border-t border-white/[0.06]">
              <div className="text-[10px] font-bold tracking-widest uppercase text-slate-500 mb-1.5">Sold</div>
              <div className="flex flex-col">
                {book.closed.map(x => (
                  <div key={`${x.t}-${x.entryDate}-${x.exitDate}`} className="flex items-center gap-2 py-1 border-b border-white/[0.03] text-[10px] whitespace-nowrap">
                    <span className="w-12 font-semibold text-slate-200 shrink-0">
                      <TickerChartHover symbol={x.t}><span className="border-b border-dotted border-white/25">{x.t}</span></TickerChartHover>
                    </span>
                    <span className="text-slate-500 w-24 truncate shrink-0 hidden sm:inline">{BOOK_SCAN_LABEL[x.scan] ?? x.scan}</span>
                    <span className="text-slate-400 tabular-nums truncate">{x.fill.toFixed(2)} → {x.exit.toFixed(2)} · {x.how === 'stop' ? 'stopped' : 'day 20'}<span className="hidden sm:inline"> {x.exitDate}</span></span>
                    <span className={`ml-auto tabular-nums font-semibold ${x.pnl > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{x.pnl > 0 ? '+' : '−'}{money(Math.abs(x.pnl))}</span>
                    <span className={`w-10 text-right tabular-nums font-semibold ${rCls(x.r)}`}>{fmtUsd(x.r)}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 mt-1.5">Newest first. The right-hand $ is the result for every $100 risked.</p>
            </div>
          )}
        </>
      )}

      {v2 ? (
        <p className="px-3 md:px-5 py-2.5 border-t border-white/[0.06] text-[10px] text-slate-500 leading-relaxed">
          In the 5-year hypothetical backtest (Sep 2022 – Sep 2026, 0.1% slippage each side) this entry won 41% of trades against
          30% for buying the open, and the account turned $100,000 into about $321,000 against $210,000 for SPY. With the
          day&apos;s picks taken in random order the typical result was about $211,000 — only just ahead of SPY. At 0.25%
          slippage each side that typical result fell to about $159,000, below SPY: how cheaply you are filled matters as much as the signal.
          Data gaps are breakouts that could not be checked, never counted as &ldquo;no breakout&rdquo;. Paper trades, not advice.
        </p>
      ) : (
        <p className="px-3 md:px-5 py-2.5 border-t border-white/[0.06] text-[10px] text-slate-500 leading-relaxed">
          In a 5-year hypothetical backtest (Sep 2022 – Sep 2026, 0.1% slippage each side) these rules turned $100,000 into about
          $372,000 against $210,000 for SPY — but the rules were chosen after seeing that test, five trades made 60% of the gain,
          and with the day&apos;s picks taken in random order the typical result was about $195,000, below SPY. At 0.25% slippage
          each side that typical result fell to about $148,000. This live record is the real test. Paper trades, not advice.
        </p>
      )}
    </div>
  );
}

function PlanSection({ plan }: { plan: PlanPayload | null | undefined }) {
  const rows = PLAN_ROWS.map(r => ({ ...r, rec: plan?.byScan?.[r.scan] }));
  const tot = rows.reduce((a, { rec }) => {
    if (!rec) return a;
    a.picked += rec.picked; a.filled += rec.filled; a.closed += rec.closed; a.wins += rec.wins; a.sumR += rec.sumR;
    a.notBought += rec.missed + rec.failed + rec.expired; a.open += rec.open; a.watching += rec.watching;
    return a;
  }, { picked: 0, filled: 0, closed: 0, wins: 0, sumR: 0, notBought: 0, open: 0, watching: 0 });
  const recent = plan?.recent ?? [];

  return (
    <div className="mb-6 border border-emerald-500/20 rounded-lg bg-slate-900/40 overflow-hidden">
      <div className="px-3 md:px-5 pt-3 pb-2.5">
        <h2 className="text-[11px] font-bold tracking-widest uppercase text-emerald-400">Followed the levels</h2>
        <p className="text-[11px] text-slate-300 leading-relaxed mt-1">
          Every pick the site showed with a <strong className="text-slate-100">buy level and a stop</strong>, counted only
          if it actually reached the buy level — the way the tables tell you to trade it. Then held to the stop or twice
          the risk. Picks that gapped past the level, hit the stop first, or never got there are not trades, and are
          counted separately so nothing is hidden.
        </p>
        {!plan ? (
          <p className="text-[11px] text-amber-400/80 leading-relaxed mt-1.5">
            Starts with tonight&apos;s close. The first results show up as picks reach their buy levels — usually within days.
          </p>
        ) : tot.closed < 20 ? (
          <p className="text-[11px] text-amber-400/80 leading-relaxed mt-1.5">
            Started {plan.startedOn}. {tot.closed === 0 ? 'No trade has finished yet' : `Only ${tot.closed} finished so far`} — far too few to judge.
          </p>
        ) : null}
      </div>

      {plan && (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 md:px-5 pb-2.5 text-[10px]">
            <span><span className="text-slate-500">Reached buy level</span> <span className="text-slate-200 font-semibold tabular-nums">{tot.filled} of {tot.picked}</span></span>
            <span><span className="text-slate-500">Winners</span> <span className="text-slate-200 font-semibold tabular-nums">{tot.wins} of {tot.closed}</span></span>
            <span><span className="text-slate-500">Per $100 risked</span> <span className={`font-semibold tabular-nums ${rCls(tot.closed ? tot.sumR / tot.closed : null)}`}>{tot.closed ? fmtUsd(tot.sumR / tot.closed) : '—'}</span></span>
            <span><span className="text-slate-500">Open now</span> <span className="text-slate-200 font-semibold tabular-nums">{tot.open}</span></span>
            <span><span className="text-slate-500">Waiting for the level</span> <span className="text-slate-200 font-semibold tabular-nums">{tot.watching}</span></span>
          </div>

          <table className="w-full border-collapse border-t border-white/[0.06]">
            <thead>
              <tr className="border-b border-white/5">
                <th className={`${TH} !text-left`}>Scan</th>
                <th className={TH} title="Picks that traded their buy level, of all picks shown with one">Reached</th>
                <th className={TH} title="Finished trades that made money">Winners</th>
                <th className={TH} title="Average result per finished trade, for every $100 between buy level and stop">Per $100</th>
                <th className={`${TH} ${HIDE}`} title="Gapped past (don't chase) · stop first · never reached">Not bought</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ scan, label, rec }) => {
                const avg = rec && rec.closed ? rec.sumR / rec.closed : null;
                return (
                  <tr key={scan} className="border-b border-white/[0.04]">
                    <td className="text-[10px] px-2 py-2 text-left font-semibold text-slate-200 whitespace-nowrap">{label}</td>
                    <td className={`${TD} text-slate-300`}>{rec ? <>{rec.filled} <span className="text-slate-600">of {rec.picked}</span></> : '—'}</td>
                    <td className={`${TD} text-slate-300`}>{rec && rec.closed ? <>{rec.wins} <span className="text-slate-600">of {rec.closed}</span></> : '—'}</td>
                    <td className={`${TD} font-semibold ${rCls(avg)}`}>{fmtUsd(avg)}</td>
                    <td className={`${TD} text-slate-500 ${HIDE}`} title={rec ? `${rec.missed} gapped past · ${rec.failed} stop first · ${rec.expired} never reached` : undefined}>
                      {rec ? rec.missed + rec.failed + rec.expired : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {recent.length > 0 && (
            <div className="px-3 md:px-5 py-2.5 border-t border-white/[0.06]">
              <div className="text-[10px] font-bold tracking-widest uppercase text-slate-500 mb-1.5">Latest</div>
              <div className="flex flex-col">
                {recent.slice(0, 15).map(p => {
                  const st = PLAN_STATE[p.state];
                  const traded = p.r != null;
                  return (
                    <div key={`${p.scan}-${p.t}-${p.d}`} className="flex items-center gap-2 py-1 border-b border-white/[0.03] text-[10px] whitespace-nowrap">
                      <span className="w-12 font-semibold text-slate-200 shrink-0">
                        <TickerChartHover symbol={p.t}><span className="border-b border-dotted border-white/25">{p.t}</span></TickerChartHover>
                      </span>
                      <span className="text-slate-500 w-24 truncate shrink-0 hidden sm:inline">{SCAN_LABEL[p.scan] ?? p.scan}</span>
                      <span className="text-slate-400 tabular-nums truncate">{p.dip ? 'Dip' : 'Buy'} {p.buy.toFixed(2)} · Stop {p.stop.toFixed(2)}</span>
                      <span className={`ml-auto font-semibold ${st.cls}`} title={st.tip}>{st.label}</span>
                      <span className={`w-10 text-right tabular-nums font-semibold ${traded ? rCls(p.r) : 'text-slate-600'}`}>{traded ? fmtUsd(p.r) : '—'}</span>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-slate-500 mt-1.5">Finished trades, newest first. $ is the result for every $100 risked.</p>
            </div>
          )}
        </>
      )}
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

  /* The cross-scan book. The per-scan drill-down answers "how did THIS scan
     do"; this answers "what is open right now", which used to mean expanding
     all eight rows and holding the answer in your head. Fetched on first
     open, so the page costs nothing extra for a reader who never asks. */
  const [liveOpen, setLiveOpen] = useState(false);
  const [live, setLive] = useState<Detail | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveStatus, setLiveStatus] = useState<'all' | Position['status']>('all');

  const toggleLive = React.useCallback(() => {
    setLiveOpen(prev => !prev);
    if (live || liveLoading) return;
    setLiveLoading(true);
    fetch('/api/track/detail?scan=all')
      .then(r => r.json())
      .then(j => { if (j?.success) setLive(j); })
      .catch(() => {})
      .finally(() => setLiveLoading(false));
  }, [live, liveLoading]);

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

  /* The scan table sorts too. Default is the reading order in ROWS — the
     tables as they appear on the dashboard — and any column click sorts,
     desc then asc then back to that default. */
  const [scanSort, setScanSort] = useState<ScanSortKey>('default');
  const [scanDir, setScanDir] = useState<'asc' | 'desc'>('desc');
  const toggleScanSort = (k: ScanSortKey) => {
    if (scanSort === k) {
      if (scanDir === 'desc') setScanDir('asc');
      else { setScanSort('default'); setScanDir('desc'); }
    } else { setScanSort(k); setScanDir('desc'); }
  };
  const scanArrow = (k: ScanSortKey) => (scanSort === k ? (scanDir === 'desc' ? ' ▼' : ' ▲') : '');

  const results = data?.results ?? {};
  const totalPicks = Object.values(results).reduce((n, r) => n + (r?.picks ?? 0), 0);
  const totalSettled = Object.values(results).reduce((n, r) => n + (r?.settled ?? 0), 0);

  const orderedRows = React.useMemo(() => {
    if (scanSort === 'default') return ROWS;
    const val = (scan: string, stat: StatScan): number | null => {
      const r = results[scan];
      switch (scanSort) {
        case 'trades': return (r?.settled ?? 0) > 0 ? r!.settled : (r?.interim?.n ?? 0);
        case 'win': return ((r?.settled ?? 0) > 0 ? r?.winRate : r?.interim?.winRate) ?? null;
        case 'avgR': return ((r?.settled ?? 0) > 0 ? r?.fixedAvgR : r?.interim?.fixedAvgR) ?? null;
        case 'bt': return SCAN_STATS[stat].bt.fixedAvgR;
        default: return null;
      }
    };
    const dir = scanDir === 'desc' ? -1 : 1;
    return [...ROWS].sort((a, b) => {
      if (scanSort === 'label') return dir * (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
      const av = val(a.scan, a.stat), bv = val(b.scan, b.stat);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return dir * (av - bv);
    });
  }, [results, scanSort, scanDir]);

  return (
    /* The chart preview needs both providers: ActiveChartProvider owns the
       popup and the single "which ticker is open" state, WatchlistProvider
       backs the star inside it. Without them TickerChartHover renders its
       children and nothing happens on hover. */
    <WatchlistProvider>
    <ActiveChartProvider>
    {/* overflow-HIDDEN, both axes, exactly as the dashboard's card does it —
       and the distinction is the whole bug. `overflow-x: hidden` with
       `overflow-y: visible` is not a thing CSS allows: the spec computes the
       visible axis to `auto`, so the element quietly becomes a scroll
       container, and on iOS a scroll container is something a finger can
       drag. Hiding one axis to stop the sliding is what created it.

       Clipping both axes costs nothing here: the box has no fixed height, so
       it grows with its content and nothing is cut off vertically. It is the
       dashboard's structure, which has never had this problem. */}
    <div className="min-h-screen overflow-hidden bg-[#0b0f1a] text-slate-300 px-3 md:px-6 py-4 max-w-[1100px] mx-auto">
      {/* Header — stacks on a phone. Left unstacked with a `shrink-0` nav, the
          links cannot wrap or shrink and the page itself scrolls sideways. */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <a href="/dashboard" className="flex items-center gap-3 min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="CTT" className="w-8 h-8 md:w-10 md:h-10 opacity-80" />
          <div>
            <h1 className="text-lg md:text-xl font-bold text-slate-100 tracking-tight">Track Record</h1>
            <p className="text-[10px] text-slate-500 tracking-widest uppercase">Live picks, scored as they mature</p>
          </div>
        </a>
        <div className="flex items-center gap-2 flex-wrap">
          <ThemeToggle />
        </div>
        {/* The links get their own centred row on a phone: they are the
            width of the screen, so sharing a line with the brand and the
            controls is what pushed the theme toggle onto a line of its own.
            From md up `order-none` puts them back inline. */}
        <div className="w-full flex justify-center order-last md:w-auto md:order-none">
          <DashNav />
        </div>
      </div>

      {!loading && !error && <BookVersus v1={data?.book} v2={data?.bookV2} />}
      {!loading && !error && <BookSection book={data?.book} />}
      {!loading && !error && <BookSection book={data?.bookV2} v2 />}
      {!loading && !error && <PlanSection plan={data?.plan} />}

      {/* The second record: every pick at the next open. What the 5-year test
          measured, so it is the one the 5-yr column compares against. */}
      <h2 className="text-[11px] font-bold tracking-widest uppercase text-slate-400 mb-2 px-1">Every pick, bought at the next open</h2>
      <div className="mb-4 px-3 md:px-5 py-3 bg-slate-900/50 border border-white/[0.06] rounded-lg">
        <p className="text-[11px] text-slate-300 leading-relaxed">
          The mechanical version: every stock each scan picked, <strong className="text-slate-100">bought at the next morning&apos;s open</strong>{' '}
          whether or not it reached its level, with the scan&apos;s own stop and twice the risk as the target. It is how the
          5-year test was run, so the two compare. Nothing picked after the fact, nothing removed.
        </p>
        {totalSettled === 0 && totalPicks > 0 && (
          <p className="text-[11px] text-amber-400/80 leading-relaxed mt-1.5">
            Early days — tracking began 11 Sep, so these are the trades finished so far. Too few to judge; the numbers firm up around December.
          </p>
        )}
        <p className="text-[10px] text-slate-500 leading-relaxed mt-1.5">
          Click a scan to see its picks.
        </p>
      </div>
      {/* Totals */}
      <div className="mb-4 flex flex-wrap gap-4 px-3 md:px-5 py-2.5 bg-slate-900/40 border border-white/[0.04] rounded-lg text-[10px]">
        <span><span className="text-slate-500">Picks recorded</span> <span className="text-slate-200 font-semibold tabular-nums">{totalPicks.toLocaleString()}</span></span>
        {data?.meta?.lastBarDate && (
          <span><span className="text-slate-500">Through</span> <span className="text-slate-200 font-semibold">{data.meta.lastBarDate}</span></span>
        )}
      </div>

      {/* ---- The live book ------------------------------------------------
           What is open right now, every scan in one list. The scan table
           below answers a different question — how each scan has done — and
           reaching this from it meant opening all eight rows. */}
      <div className="mb-4 border border-white/[0.06] rounded-lg bg-slate-900/40 overflow-hidden">
        <button
          onClick={toggleLive}
          className="w-full flex items-center justify-between gap-3 px-3 md:px-5 py-2.5 text-left hover:bg-white/[0.02] transition-colors"
        >
          <span className="text-[11px] font-bold tracking-widest uppercase text-slate-300">
            <span className="inline-block w-3">{liveOpen ? '▾' : '▸'}</span> Open right now
            <span className="ml-2 text-slate-500 font-medium tabular-nums normal-case tracking-normal">
              {(data?.openCount ?? 0).toLocaleString()} positions across {Object.keys(data?.openByScan ?? {}).length} scans
            </span>
          </span>
          <span className="text-[10px] text-slate-500 whitespace-nowrap">{liveOpen ? 'hide' : 'show'}</span>
        </button>

        {liveOpen && (
          <div className="px-3 md:px-5 pb-3 border-t border-white/[0.06]">
            {liveLoading && !live ? (
              <div className="py-8 text-center text-[10px] text-slate-500 tracking-widest uppercase animate-pulse">Loading the book…</div>
            ) : !live ? (
              <div className="py-8 text-center text-[11px] text-rose-400">Could not load the open positions.</div>
            ) : (
              <>
                <div className="text-[10px] text-slate-500 py-2.5">
                  Every position that has not finished its window, newest pick first. Marked at the
                  {data?.meta?.lastBarDate ? ` ${data.meta.lastBarDate} ` : ' last '}
                  close — these are not intraday prices. <strong className="text-slate-400">Running</strong> and
                  <strong className="text-slate-400"> pending</strong> are the ones still live; a position that already
                  hit its target or its stop stays here until its window is up.
                </div>
                {/* Status chips: the book mixes still-live trades with decided
                    ones, and "what is live" usually means the first two. */}
                <div className="flex flex-wrap items-center gap-1.5 pb-2.5">
                  {(['all', 'running', 'pending', 'target', 'stopped'] as const).map(k => {
                    const n = k === 'all' ? live.open.length : live.open.filter(p => p.status === k).length;
                    const on = liveStatus === k;
                    return (
                      <button
                        key={k}
                        onClick={() => setLiveStatus(k)}
                        className={`px-2.5 py-1 rounded text-[10px] font-bold tracking-wide uppercase border transition-colors ${
                          on ? 'bg-[#1e293b] text-indigo-400 border-indigo-500/30' : 'text-slate-500 border-white/5 hover:text-slate-300'
                        }`}
                      >
                        {k === 'all' ? 'All' : STATUS_META[k]?.label ?? k} <span className="tabular-nums">{n}</span>
                      </button>
                    );
                  })}
                </div>
                <PositionTable
                  showScan
                  detail={{
                    ...live,
                    open: liveStatus === 'all' ? live.open : live.open.filter(p => p.status === liveStatus),
                    closed: [],
                  }}
                />
              </>
            )}
          </div>
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
        <div className="md:overflow-x-auto md:overflow-y-hidden custom-scrollbar border border-white/[0.06] rounded-lg bg-slate-900/40">
          {/* Same treatment as the positions table: the four columns that say
              what a scan is and whether it works stay on a phone, the five
              that qualify them wait for a wider screen. */}
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-white/5">
                <th className={`${TH_SCAN} !text-left`} onClick={() => toggleScanSort('label')}>Scan{scanArrow('label')}</th>
                <th className={TH_SCAN} onClick={() => toggleScanSort('trades')} title="Trades finished so far, of all the stocks this scan picked">Trades{scanArrow('trades')}</th>
                <th className={TH_SCAN} onClick={() => toggleScanSort('win')} title="Share of finished trades that made money">Winners{scanArrow('win')}</th>
                <th className={TH_SCAN} onClick={() => toggleScanSort('avgR')} title="Average result per trade, for every $100 risked (the gap between entry and stop)">Per $100 risked{scanArrow('avgR')}</th>
                <th className={`${TH_SCAN} ${HIDE}`} onClick={() => toggleScanSort('bt')} title="The same measure over the 5-year backtest, for comparison">5-yr test{scanArrow('bt')}</th>
              </tr>
            </thead>
            <tbody>
              {orderedRows.map(({ scan, label, stat, mode }) => {
                const r = results[scan];
                const bt = SCAN_STATS[stat].bt;
                const tiers = Object.entries(r?.byTier ?? {}).filter(([, v]) => v.n > 0);
                const isOpen = openScan === scan;
                const detail = details[scan];
                const isReturn = mode === 'return';
                const interim = r?.interim ?? null;
                /* Settled numbers when they exist; before December none do, so
                   the trades already finished (target or stop hit) stand in. */
                const useSettled = (r?.settled ?? 0) > 0;
                const src: Interim | ScanRecord | null = useSettled ? (r ?? null) : interim;
                const done = useSettled ? (r?.settled ?? 0) : (interim?.n ?? 0);
                const winRate = src?.winRate ?? null;
                const avgR = src?.fixedAvgR ?? null;
                const retAvgPct = src?.retAvgPct ?? null;
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
                      <td className={`${TD} text-slate-300`} title={`${done} finished of ${r?.picks ?? 0} picked`}>
                        {done} <span className="text-slate-600">of {r?.picks ?? 0}</span>
                      </td>
                      {isReturn ? (
                        <>
                          <td className={`${TD} text-slate-600`} title="This scan holds for 12 months with no stop, so there is no win/loss yet">—</td>
                          <td className={`${TD} font-semibold ${rCls(retAvgPct)}`} title="Average return since the pick. This scan is a 12-month hold with no stop, so it is measured in percent, not per $100 risked">
                            {retAvgPct == null ? '—' : `${retAvgPct >= 0 ? '+' : ''}${retAvgPct.toFixed(1)}%`}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className={`${TD} text-slate-300`}>{fmtPct(winRate)}</td>
                          <td className={`${TD} font-semibold ${rCls(avgR)}`}>{fmtUsd(avgR)}</td>
                        </>
                      )}
                      <td className={`${TD} text-slate-500 ${HIDE}`} title={SCAN_STATS[stat].detail}>
                        {bt.fixedAvgR == null ? '—' : fmtUsd(bt.fixedAvgR)}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-white/[0.06] bg-[#0d1220]">
                        <td colSpan={5} className="px-2 py-3">
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
                        <td colSpan={5} className="px-2 py-1.5">
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500">
                            <span className="text-slate-600 font-bold tracking-widest uppercase">By colour</span>
                            {tiers.map(([tier, v]) => (
                              <span key={tier}>
                                <span className={TIER_CLS[tier] ?? 'text-slate-400'}>{tier}</span>{' '}
                                <span className="text-slate-400 tabular-nums">{v.n} trades</span>{' '}
                                <span className={`tabular-nums ${rCls(v.avgR)}`}>{isReturn ? `${(v.avgR ?? 0).toFixed(1)}%` : fmtUsd(v.avgR)}</span>
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

      {!loading && !error && totalPicks > 0 && (
        <p className="mt-2 text-[10px] text-slate-500 leading-relaxed">
          Per $100 risked: the average result for every $100 between entry and stop — +$26 means a trade risking
          $100 made $26 on average. Trading costs are not included.
        </p>
      )}
    </div>
    </ActiveChartProvider>
    </WatchlistProvider>
  );
}

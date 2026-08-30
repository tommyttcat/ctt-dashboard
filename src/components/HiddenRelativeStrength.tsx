'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { cachedJson } from '@/lib/scannerLatest';
import { useMarketData } from './MarketDataContext';
import { HRS } from '@/lib/scanConfig';
import { rsBadge } from '@/lib/indicators/rs';
import { stageShort, stageBadge } from '@/lib/indicators/stage';
import { tickerChipForScore, tickerTitle, scoreCellCls } from '@/lib/indicators/columnColors';
import { displaySector } from '@/lib/sectors';
import { NewsStars, type CatalystRow } from '@/lib/catalyst';
import TickerChartHover, { WatchlistBtn } from './TickerChartHover';
import { WatchlistToggle } from './WatchlistPanel';

const SCORE_LABELS: Record<string, string> = {
  alpha: 'Weak-day alpha & consistency',
  proximity: '52-week high proximity',
  smaStack: 'SMA stack quality',
  rs: 'RS Rating',
};

const COL_TIPS: Record<string, string> = {
  HRS: 'Hidden Relative Strength score (0–100). Composite of weak-day alpha (40pts), 52-week proximity (25pts), SMA stack quality (20pts), and RS Rating (15pts). Higher = stronger institutional accumulation signal.',
  Alpha: 'Cumulative alpha on weak QQQ days. Sum of (stock return − QQQ return) on every day QQQ dropped ≥ 0.3%. A stock that stays flat while QQQ drops 1% scores +1.0 per day.',
  'Win%': 'Weak-day outperform rate. % of weak QQQ days where the stock beat QQQ. 80%+ means it almost never sells off with the market.',
  '52wk': 'Distance below 52-week high. ATH = at the high. Stocks near highs with hidden RS are the strongest — institutions are holding through the dip.',
};

const formatTime = (ts: number | Date) => {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
};

const fmtNum = (n: number | null | undefined) => {
  if (n == null || n === 0 || isNaN(n)) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toLocaleString();
};

const emaDot = (state: boolean | null | undefined) => {
  if (state == null) return 'bg-slate-600';
  return state ? 'bg-emerald-400' : 'bg-rose-500';
};

const cnfBadge = (score: number) => {
  if (score >= 70) return 'text-amber-300 border-amber-500/30 bg-amber-500/10';
  if (score >= 50) return 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10';
  return 'text-slate-400 border-white/5 bg-white/[0.03]';
};

interface HrsCandidate {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  changePct: number;
  vol: number;
  dVol: number;
  avgVol: number;
  mktCap: number | null;
  score: number;
  grade: string;
  scoreBreakdown: Record<string, number>;
  alphaOnWeakDays: number;
  weakDayOutperformPct: number;
  avgDailyAlpha: number;
  high52w: number;
  pctBelow52wHigh: number;
  sma10: number;
  sma20: number;
  sma10Slope: number;
  sma20Slope: number;
  rsRating: number | null;
  stage: string;
  cnfScore: number | null;
  cnfGrade: string | null;
  catalyst: string | null;
  catalystUrl: string | null;
  newsPublisher: string | null;
  newsAge: string | null;
  newsCausal: boolean | null;
  newsSentiment: string | null;
  thesis: string | null;
  weakDayDetail: { date: string; qqq: number; stock: number; alpha: number }[];
}

interface MarketRegime {
  active: boolean;
  qqqReturn5d: number;
  qqqReturn10d: number;
  downDays5: number;
  downDays10: number;
  weakDays: { date: string; qqqChange: number }[];
  severity: 'severe' | 'moderate' | 'mild' | 'inactive';
  vixLevel: number | null;
}

type SortKey = 'score' | 'rs' | 'cnf' | 'changePct' | 'price' | 'alpha' | 'winPct' | 'proximity' | 'vol' | 'dvol' | 'rvol' | 'mcap';
type SortDir = 'asc' | 'desc';
type GradeFilter = 'All' | 'A' | 'B';

const SEVERITY_META: Record<string, { label: string; color: string; border: string }> = {
  severe:   { label: 'SEVERE',   color: 'text-rose-400',   border: 'border-rose-500/30 bg-rose-500/10' },
  moderate: { label: 'MODERATE', color: 'text-amber-400',  border: 'border-amber-500/30 bg-amber-500/10' },
  mild:     { label: 'MILD',     color: 'text-yellow-400', border: 'border-yellow-500/30 bg-yellow-500/10' },
  inactive: { label: 'INACTIVE', color: 'text-slate-500',  border: 'border-white/5 bg-slate-500/10' },
};

function toCatalystRow(row: HrsCandidate): CatalystRow {
  return {
    catalyst: row.catalyst,
    catalystUrl: row.catalystUrl,
    newsPublisher: row.newsPublisher,
    newsAge: row.newsAge,
    newsCausal: row.newsCausal,
    newsSentiment: row.newsSentiment,
    thesis: row.thesis,
  };
}

export default function HiddenRelativeStrength() {
  const { session } = useMarketData();

  const [candidates, setCandidates] = useState<HrsCandidate[]>([]);
  const [regime, setRegime] = useState<MarketRegime | null>(null);
  const [lastScanTime, setLastScanTime] = useState<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [gradeFilter, setGradeFilter] = useState<GradeFilter>('All');
  const [copied, setCopied] = useState(false);
  const [txtDone, setTxtDone] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const data = await cachedJson('/api/hrs/latest');
        if (!mounted) return;
        if (data.success) {
          setCandidates(data.candidates ?? []);
          setRegime(data.regime ?? null);
          setLastScanTime(data.lastScanTime ?? null);
        }
      } catch { /* noop */ }
    };
    load();
    const iv = setInterval(load, 60_000);
    return () => { mounted = false; clearInterval(iv); };
  }, []);

  const sorted = useMemo(() => {
    let rows = [...candidates]
      .filter(r => (r.rsRating ?? 0) >= 85)
      .filter(r => /^(Stage\s*)?[12]/i.test(r.stage || ''))
      .filter(r => (r.dVol ?? 0) >= 10_000_000);
    if (gradeFilter !== 'All') {
      rows = rows.filter(r => gradeFilter === 'A' ? r.grade === 'A' : r.grade === 'A' || r.grade === 'B');
    }
    rows.sort((a, b) => {
      let av = 0, bv = 0;
      switch (sortKey) {
        case 'score':     av = a.score; bv = b.score; break;
        case 'rs':        av = a.rsRating ?? 0; bv = b.rsRating ?? 0; break;
        case 'cnf':       av = a.cnfScore ?? 0; bv = b.cnfScore ?? 0; break;
        case 'changePct': av = a.changePct; bv = b.changePct; break;
        case 'price':     av = a.price; bv = b.price; break;
        case 'alpha':     av = a.alphaOnWeakDays; bv = b.alphaOnWeakDays; break;
        case 'winPct':    av = a.weakDayOutperformPct; bv = b.weakDayOutperformPct; break;
        case 'proximity': av = -a.pctBelow52wHigh; bv = -b.pctBelow52wHigh; break;
        case 'vol':       av = a.vol; bv = b.vol; break;
        case 'dvol':      av = a.dVol; bv = b.dVol; break;
        case 'rvol':      av = a.avgVol ? a.vol / a.avgVol : 0; bv = b.avgVol ? b.vol / b.avgVol : 0; break;
        case 'mcap':      av = a.mktCap ?? 0; bv = b.mktCap ?? 0; break;
      }
      return sortDir === 'desc' ? bv - av : av - bv;
    });
    return rows;
  }, [candidates, sortKey, sortDir, gradeFilter]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const sortArrow = (key: SortKey) => sortKey === key ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '';

  const handleCopyTickers = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const tickers = sorted.map(r => r.symbol).join(',');
    if (!tickers) return;
    try {
      await navigator.clipboard.writeText(tickers);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = tickers;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch {}
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownloadTxt = (e: React.MouseEvent) => {
    e.stopPropagation();
    const t = sorted.map(r => r.symbol);
    if (!t.length) return;
    const blob = new Blob([t.join(',')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'hrs-watchlist.txt';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setTxtDone(true);
    setTimeout(() => setTxtDone(false), 1800);
  };

  const displaySession = ['Pre-Market', 'Open', 'Post-Market', 'Closed'].includes(session) ? session : 'Closed';
  const getSessionTextColor = () => {
    if (displaySession === 'Pre-Market') return 'text-amber-500';
    if (displaySession === 'Open') return 'text-[#00e676]';
    if (displaySession === 'Post-Market') return 'text-indigo-400';
    return 'text-slate-500';
  };

  const sev = regime ? SEVERITY_META[regime.severity] ?? SEVERITY_META.inactive : SEVERITY_META.inactive;

  const thBase = 'px-0.5 py-2.5 text-[10px] text-slate-500 font-bold tracking-wide leading-tight cursor-pointer hover:text-slate-300 transition-colors text-center';
  const tdBase = 'px-0.5 pt-2.5 pb-1.5 text-center';
  const thStage = "px-0.5 pl-1.5 py-2.5 text-[10px] text-slate-500 font-bold tracking-wide leading-tight cursor-pointer hover:text-slate-300 transition-colors text-left";
  const tdStage = "px-0.5 pl-1.5 pt-2.5 pb-1.5 text-left";
  const thSector = "px-0.5 pl-1.5 py-2.5 text-[10px] text-slate-500 font-bold tracking-wide leading-tight cursor-pointer hover:text-slate-300 transition-colors text-left";
  const tdSector = "px-0.5 pl-1.5 pt-2.5 pb-1.5 text-left";
  const COL_SPAN = 15;

  return (
    <div className="bg-[#101623] border-0 md:border md:border-white/5 md:rounded-2xl p-2 md:p-5 relative overflow-visible md:shadow-xl w-full max-w-[1280px] mx-auto">
      {/* Header — collapsible */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex justify-between items-center relative z-30 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-5 border-b border-white/5 pb-4' : ''}`}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs md:text-sm font-bold text-[#7c8bfa] bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 group-hover:bg-white/[0.02] transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]" />
            HIDDEN RELATIVE STRENGTH
          </span>

          {regime && regime.active && (
            <span className="hidden md:inline text-[10px] text-slate-500 font-medium tracking-wide">
              QQQ 5d: <span className={regime.qqqReturn5d < 0 ? 'text-rose-400' : 'text-emerald-400'}>{regime.qqqReturn5d >= 0 ? '+' : ''}{regime.qqqReturn5d.toFixed(1)}%</span>
              {' · '}{regime.downDays5}/5 down
              {regime.vixLevel != null && <>{' · '}VIX {regime.vixLevel.toFixed(1)}</>}
            </span>
          )}

          {sorted.length > 0 && (
            <button
              onClick={handleCopyTickers}
              title={`Copy ${sorted.length} tickers for TradingView`}
              className={`text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded border transition-all duration-200 ${
                copied
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-[#161c2a] text-slate-400 border-white/5 hover:text-slate-200 hover:bg-white/[0.04]'
              }`}
            >
              {copied ? `✓ Copied ${sorted.length}` : `Copy ${sorted.length}`}
            </button>
          )}
          {sorted.length > 0 && (
            <button
              onClick={handleDownloadTxt}
              title={`Download ${sorted.length} tickers as .txt for TradingView import`}
              className={`text-[10px] font-bold tracking-wider uppercase px-2 py-1 rounded border transition-all duration-200 ${
                txtDone
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-[#161c2a] text-slate-400 border-white/5 hover:text-slate-200 hover:bg-white/[0.04]'
              }`}
            >
              {txtDone ? '✓ TXT' : 'TXT'}
            </button>
          )}

          <span className="hidden md:block basis-full text-[10px] font-bold tracking-wider uppercase text-slate-500 mt-1">
            {sorted.length} of {candidates.length} · RS 85+ · Stage 1–2 · ${HRS.minPrice}+ · ${fmtNum(HRS.minDollarVol)} avg $vol · 10 SMA {'>'} 20 SMA · within {HRS.maxPctBelow52wHigh}% of 52wk high · {HRS.minWeakDayOutperformPct}%+ weak-day wins
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="flex flex-col items-center gap-1.5 shrink-0">
            <div className="flex items-center justify-center border border-white/5 bg-[#161c2a]/40 px-4 py-1.5 rounded-[10px] min-w-[120px]">
              <span className={`text-[10px] font-bold tracking-widest uppercase ${getSessionTextColor()}`}>{displaySession}</span>
            </div>
            {lastScanTime && (
              <span className="text-[11px] text-slate-400/80 font-medium px-1 tracking-wide whitespace-nowrap">
                Scanned: {formatTime(lastScanTime)} EST
              </span>
            )}
          </div>
          <WatchlistToggle />
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <>
          {/* Summary card — top 10 + regime */}
          <div className="mb-5 px-2">
            {regime && regime.active && (
              <div className="mb-3">
                <div className="flex flex-wrap gap-4 text-[10px] text-slate-400">
                  <span>QQQ 10d: <span className={regime.qqqReturn10d < 0 ? 'text-rose-400' : 'text-emerald-400'}>{regime.qqqReturn10d >= 0 ? '+' : ''}{regime.qqqReturn10d.toFixed(1)}%</span></span>
                  <span>Down days (10d): <span className="text-slate-200">{regime.downDays10}</span></span>
                  <span>Weak days (30d): <span className="text-slate-200">{regime.weakDays.length}</span></span>
                  {regime.vixLevel != null && <span>VIX: <span className={regime.vixLevel > 25 ? 'text-rose-400' : regime.vixLevel > 20 ? 'text-amber-400' : 'text-slate-200'}>{regime.vixLevel.toFixed(1)}</span></span>}
                </div>
                <p className="text-[10px] text-slate-500 mt-1.5 leading-relaxed max-w-2xl">
                  {regime.severity === 'severe' && 'QQQ in a deep selloff — hidden relative strength signal is strongest. Names holding up now are where institutions are building.'}
                  {regime.severity === 'moderate' && 'QQQ under pressure — enough weakness to reveal who is holding. These names are worth watching closely.'}
                  {regime.severity === 'mild' && 'QQQ showing early signs of weakness. Signal is present but early — keep the list, add to it if weakness deepens.'}
                </p>
              </div>
            )}

          </div>

          {/* Filter pills + column key */}
          <div className="flex flex-wrap gap-4 items-center mb-4 px-2">
            <div className="flex items-center gap-3 px-4 py-1 bg-[#161c2a] border border-white/5 rounded-lg shrink-0">
              <span className="text-[11px] font-bold tracking-widest uppercase text-slate-400">Grade</span>
              {(['All', 'A', 'B'] as GradeFilter[]).map(g => (
                <button
                  key={g}
                  onClick={(e) => { e.stopPropagation(); setGradeFilter(gradeFilter === g ? 'All' : g); }}
                  className={`px-3 py-1 rounded-lg text-[11px] font-bold tracking-widest uppercase transition-all duration-300 whitespace-nowrap ${
                    gradeFilter === g
                      ? 'bg-[#1e293b] text-indigo-400 border border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.1)]'
                      : 'text-slate-500 border border-transparent hover:text-slate-300 hover:bg-white/[0.02]'
                  }`}
                >
                  {g === 'All' ? 'ALL' : g + '+'}
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          {sorted.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500">
              {!regime
                ? 'Awaiting first scan — data will appear after the next scheduled run.'
                : regime.severity === 'inactive'
                ? 'Scan inactive — QQQ has been strong. Hidden RS only surfaces during market weakness.'
                : 'No candidates pass all gates in the current window.'}
            </div>
          ) : (
            <div className="relative z-0 overflow-x-auto custom-scrollbar" style={{ scrollbarWidth: 'thin' }}>
              <table className="w-full min-w-[940px] table-fixed border-collapse">
                <thead>
                  <tr className="border-b border-white/5 select-none">
                    <th className={`${thBase} w-[7%] !text-left pl-1`}>TICKER</th>
                    <th className={`${thBase} w-[2%] hidden md:table-cell`} title="News — ★ has an article, ★★ has a causal catalyst">N</th>
                    <th className={`${thBase} w-[4%]`} onClick={() => toggleSort('score')} title={COL_TIPS.HRS}>CNF{sortArrow('score')}</th>
                    <th className={`${thBase} w-[7%]`} onClick={() => toggleSort('rs')}>RS{sortArrow('rs')}</th>
                    <th className={`${thBase} w-[7%]`} onClick={() => toggleSort('changePct')}>CHG%{sortArrow('changePct')}</th>
                    <th className={`${thBase} w-[7%] hidden md:table-cell`} onClick={() => toggleSort('vol')}>VOL{sortArrow('vol')}</th>
                    <th className={`${thBase} w-[7%] hidden md:table-cell`} onClick={() => toggleSort('dvol')} title="Dollar volume (shares × price)">$VOL{sortArrow('dvol')}</th>
                    <th className={`${thBase} w-[7%] hidden md:table-cell`} onClick={() => toggleSort('rvol')}>RVOL{sortArrow('rvol')}</th>
                    <th className={`${thBase} w-[8%] hidden md:table-cell`} onClick={() => toggleSort('alpha')} title={COL_TIPS.Alpha}>ALPHA{sortArrow('alpha')}</th>
                    <th className={`${thBase} w-[7%] hidden md:table-cell`} onClick={() => toggleSort('winPct')} title={COL_TIPS['Win%']}>WIN%{sortArrow('winPct')}</th>
                    <th className={`${thBase} w-[7%] hidden lg:table-cell`} onClick={() => toggleSort('proximity')} title={COL_TIPS['52wk']}>52WK{sortArrow('proximity')}</th>
                    <th className={`${thBase} w-[7%] hidden lg:table-cell`} onClick={() => toggleSort('mcap')}>MCAP{sortArrow('mcap')}</th>
                    <th className={`${thStage} w-[5%] hidden md:table-cell border-l border-white/5`}>STAGE</th>
                    <th className={`${thSector} w-[7%] hidden md:table-cell`}>SECTOR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {sorted.map((row) => {
                    const isRowExpanded = expandedRow === row.symbol;
                    const above10 = row.price >= row.sma10;
                    const above20 = row.price >= row.sma20;
                    const rvol = row.avgVol ? row.vol / row.avgVol : 0;
                    const catalystRow = toCatalystRow(row);
                    const tag = row.catalyst && row.catalyst !== 'Technical Momentum' ? row.catalyst.replace(/ \(Delayed\)$/, '') : null;
                    const headline = row.thesis;
                    return (
                      <React.Fragment key={row.symbol}>
                        {/* Row 1 — data */}
                        <tr
                          className="hover:bg-white/[0.02] cursor-pointer transition-colors group"
                          onClick={() => setExpandedRow(isRowExpanded ? null : row.symbol)}
                        >
                          <td className={tdBase}>
                            <div className="flex items-center justify-start gap-1.5">
                              <WatchlistBtn symbol={row.symbol} />
                              <TickerChartHover symbol={row.symbol}>
                                <span className={tickerChipForScore(row.cnfScore)} title={tickerTitle(row.name, row.symbol, row.cnfScore)}>
                                  {row.symbol}
                                </span>
                              </TickerChartHover>
                            </div>
                          </td>

                          <td className={`${tdBase} hidden md:table-cell`}>
                            <NewsStars row={catalystRow} />
                          </td>

                          <td className={tdBase}>
                            <span
                              className={scoreCellCls(row.score)}
                              title={row.scoreBreakdown ? Object.entries(row.scoreBreakdown).map(([k, v]) => `${SCORE_LABELS[k] ?? k}: ${v}`).join('\n') : undefined}
                            >
                              {row.score}
                            </span>
                          </td>

                          <td className={`${tdBase} whitespace-nowrap`}>
                            {row.rsRating != null ? (
                              <span className={`inline-block px-1 py-[1px] rounded border text-[9px] font-bold tabular-nums cursor-help ${rsBadge(row.rsRating)}`}>
                                {row.rsRating}
                              </span>
                            ) : <span className="text-slate-600">—</span>}
                          </td>

                          <td className={`${tdBase} text-[10px] font-bold whitespace-nowrap tabular-nums ${row.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {row.changePct >= 0 ? '+' : ''}{row.changePct.toFixed(1)}%
                          </td>

                          <td className={`${tdBase} text-[10px] text-slate-400 font-medium whitespace-nowrap tabular-nums hidden md:table-cell`}>
                            {fmtNum(row.vol)}
                          </td>

                          <td className={`${tdBase} text-[10px] text-slate-400 font-medium whitespace-nowrap tabular-nums hidden md:table-cell`}>
                            {fmtNum(row.dVol)}
                          </td>

                          <td className={`${tdBase} text-[10px] font-bold whitespace-nowrap tabular-nums hidden md:table-cell ${rvol >= 2 ? 'text-emerald-400' : rvol >= 1.2 ? 'text-cyan-400' : 'text-slate-400'}`}>
                              {rvol < 1 ? rvol.toFixed(1) : Math.round(rvol)}x
                          </td>

                          <td className={`${tdBase} text-[10px] font-bold whitespace-nowrap tabular-nums hidden md:table-cell ${row.alphaOnWeakDays > 5 ? 'text-emerald-400' : row.alphaOnWeakDays > 2 ? 'text-cyan-400' : 'text-slate-300'}`}>
                              +{row.alphaOnWeakDays.toFixed(1)}
                          </td>

                          <td className={`${tdBase} text-[10px] font-bold whitespace-nowrap tabular-nums hidden md:table-cell ${row.weakDayOutperformPct >= 80 ? 'text-emerald-400' : row.weakDayOutperformPct >= 60 ? 'text-cyan-400' : 'text-slate-400'}`}>
                              {row.weakDayOutperformPct}%
                          </td>

                          <td className={`${tdBase} text-[10px] font-bold whitespace-nowrap tabular-nums hidden lg:table-cell ${row.pctBelow52wHigh <= 3 ? 'text-emerald-400' : row.pctBelow52wHigh <= 8 ? 'text-cyan-400' : 'text-slate-400'}`}>
                              {row.pctBelow52wHigh <= 0.5 ? 'ATH' : `-${row.pctBelow52wHigh.toFixed(1)}%`}
                          </td>

                          <td className={`${tdBase} text-[10px] text-slate-400 font-medium whitespace-nowrap tabular-nums hidden lg:table-cell`}>
                            {fmtNum(row.mktCap)}
                          </td>

                          <td className={`${tdStage} whitespace-nowrap hidden md:table-cell border-l border-white/5`}>
                            <span className={`inline-block px-1 py-[1px] rounded border text-[9px] font-bold tabular-nums tracking-wide cursor-help ${stageBadge(row.stage)}`}>
                              {stageShort(row.stage)}
                            </span>
                          </td>

                          <td className={`${tdSector} hidden md:table-cell`}>
                            <span title={displaySector(row.sector, row.symbol)} className="block truncate text-left text-[8px] font-semibold tracking-wide uppercase text-slate-400">{displaySector(row.sector, row.symbol)}</span>
                          </td>

                        </tr>

                        {/* Row 2 — catalyst sub-row (only when there's news) */}
                        {(headline || tag) && (
                          <tr className="bg-transparent">
                            <td />
                            <td className="hidden md:table-cell" />
                            <td colSpan={COL_SPAN - 2} className="pb-1.5 pt-0.5 pr-3">
                              <p className="text-[10px] leading-relaxed pl-2 pr-3 truncate">
                                {tag && (
                                  <>
                                    <span className="text-[8px] font-bold tracking-[0.12em] uppercase text-amber-400/70">{tag}</span>
                                    {headline ? ' ' : ''}
                                  </>
                                )}
                                {headline && (
                                  row.catalystUrl ? (
                                    <a href={row.catalystUrl} target="_blank" rel="noopener noreferrer" className="text-slate-500 font-normal hover:text-slate-300 hover:underline transition-colors" onClick={e => e.stopPropagation()}>{headline}</a>
                                  ) : (
                                    <span className="text-slate-500 font-normal">{headline}</span>
                                  )
                                )}
                                {(row.newsPublisher || row.newsAge) && (
                                  <span className="text-[8px] text-slate-600 font-medium ml-1.5 whitespace-nowrap">
                                    {[row.newsPublisher, row.newsAge].filter(Boolean).join(' · ')}
                                  </span>
                                )}
                              </p>
                            </td>
                          </tr>
                        )}

                        {/* Expanded detail row */}
                        {isRowExpanded && (
                          <tr className="bg-white/[0.01]">
                            <td colSpan={COL_SPAN} className="px-2 md:px-3 py-2">
                              <div className="flex flex-col gap-1.5">
                                <div className="flex flex-wrap gap-2.5 text-[8px]">
                                  {Object.entries(row.scoreBreakdown).map(([k, v]) => (
                                    <span key={k} className="text-slate-400">
                                      <span className="text-slate-500">{SCORE_LABELS[k] ?? k}:</span>{' '}
                                      <span className="text-slate-200 font-mono font-bold">{v}</span>
                                    </span>
                                  ))}
                                </div>

                                <div className="flex flex-wrap gap-3 text-[8px] text-slate-400">
                                  <span>52wk High: <span className="text-slate-200 font-mono">${row.high52w.toFixed(2)}</span></span>
                                  <span>DVol: <span className="text-slate-200 font-mono">{fmtNum(row.dVol)}</span></span>
                                  <span>Avg Vol: <span className="text-slate-200 font-mono">{fmtNum(row.avgVol)}</span></span>
                                  <span>Mkt Cap: <span className="text-slate-200 font-mono">{fmtNum(row.mktCap)}</span></span>
                                  <span>10 SMA slope: <span className="text-emerald-400 font-mono">+{row.sma10Slope}%</span></span>
                                  <span>20 SMA slope: <span className="text-emerald-400 font-mono">+{row.sma20Slope}%</span></span>
                                </div>

                                {row.weakDayDetail.length > 0 && (
                                  <div>
                                    <div className="text-[8px] text-slate-500 font-semibold tracking-wider uppercase mb-1">
                                      Performance on weak days
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                      {row.weakDayDetail.map((d, i) => (
                                        <div
                                          key={i}
                                          className={`rounded border px-1.5 py-1 text-[8px] ${
                                            d.alpha > 0
                                              ? 'bg-emerald-500/5 border-emerald-500/15 text-emerald-400'
                                              : 'bg-rose-500/5 border-rose-500/15 text-rose-400'
                                          }`}
                                          title={`${d.date}: QQQ ${d.qqq}%, ${row.symbol} ${d.stock >= 0 ? '+' : ''}${d.stock}%`}
                                        >
                                          <div className="text-[7px] text-slate-500">{d.date.slice(5)}</div>
                                          <div className="flex items-center gap-1 mt-0.5">
                                            <span className="text-rose-400/60">Q:{d.qqq}%</span>
                                            <span className={d.stock >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                                              {d.stock >= 0 ? '+' : ''}{d.stock}%
                                            </span>
                                            <span className={`font-bold ${d.alpha > 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                                              {d.alpha > 0 ? '+' : ''}{d.alpha}
                                            </span>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
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
        </>
      )}
    </div>
  );
}

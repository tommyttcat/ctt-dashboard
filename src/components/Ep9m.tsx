'use client';

// Ep9m — 9 Million Episodic Pivot (Pradeep Bonde / Stockbee) — v1.0
//
// Fewer than ~2% of US listings trade 9M+ shares in a session. When a stock
// that normally trades 800k suddenly does 12M, institutions are accumulating
// and the news hasn't been priced yet. The volume IS the signal — you research
// the catalyst after the scan flags it, not before.
//
// Unlike every other table here, this one does NOT gate on % change. A
// non-gapping stock quietly trading 10x its normal volume is the highest-value
// case the scan exists to find.

import React, { useState, useEffect, useMemo } from 'react';
import { useMarketData } from './MarketDataContext';

interface Ep9mCandidate {
  ticker: string;
  name?: string;
  sector?: string;
  price: number;
  score: number;
  grade?: string;
  changePct?: number;
  vol: number;
  dVol?: number;
  avgVol?: number;
  rvol: number;
  volVs60dMax?: number | null;
  unprecedented?: boolean;
  floatTurnover?: number | null;
  daysToCover?: number | null;
  closeStrength?: number | null;
  float?: number | null;
  shortPct?: number | null;
  mktCap?: number | null;
  stage?: string;
  vwapStatus?: 'above' | 'below' | 'neutral';
  atrPct?: number | null;
  adrPct?: number | null;
  rmv?: number | null;
  rme?: number | null;
  aboveEma10?: boolean | null;
  aboveEma21?: boolean | null;
  distToEma21?: number | null;
  ema21Rising?: boolean | null;
  goldenCross?: boolean | null;
  pctOffHigh?: number | null;
  rsVsSpy?: number | null;
  priorTriggers?: number;
  sugarBaby?: boolean;
  catalyst?: string | null;
  catalystUrl?: string | null;
  thesis?: string | null;
  scoreBreakdown?: Record<string, number>;
}

type SortDirection = 'asc' | 'desc';
type EpFilterType = 'All' | 'A' | 'B';
type RvolFilterType = 'All' | '5' | '10';
type CatalystFilterType = 'All' | 'News' | 'Silent';
type VwapFilterType = 'All' | 'above' | 'below';

// EP grade is a floor, not an exact grade: picking B shows B and A.
const EP_BUCKETS: EpFilterType[] = ['A', 'B'];
const EP_MIN_SCORE: Record<'A' | 'B', number> = { A: 70, B: 50 };

// RVOL buckets — the scan already floors at 3x, so these tighten.
const RVOL_BUCKETS: RvolFilterType[] = ['5', '10'];

const formatTime = (timestamp: number | Date) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'America/New_York' });
};

const formatNumber = (num: number | null | undefined) => {
  if (num === null || num === undefined || num === 0 || isNaN(num)) return '—';
  if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return num.toLocaleString();
};

const formatCurrency = (num: number | null | undefined) => {
  if (num === null || num === undefined || num === 0 || isNaN(num)) return '—';
  if (num >= 1e9) return '$' + (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return '$' + (num / 1e6).toFixed(1) + 'M';
  return '$' + num.toLocaleString();
};

const formatStageText = (stage: string | undefined) => {
  if (!stage || stage === '-' || stage === '—') return '—';
  return stage.replace(/Stage\s*/i, '');
};

// Sector strings sometimes arrive ticker-prefixed ("RKLB - AEROSPACE").
// Strip the prefix so one bad row can't widen the column.
const cleanSector = (sector: string | null | undefined, ticker?: string): string => {
  if (!sector || sector === '—' || sector === '-') return '—';
  let s = String(sector).trim();
  if (ticker) {
    const rx = new RegExp(`^${ticker}\\s*[-–—:]\\s*`, 'i');
    s = s.replace(rx, '');
  }
  s = s.replace(/^[A-Z]{1,5}\s*[-–—:]\s*/, '');
  return s.trim() || '—';
};

const isGenericCatalyst = (catalyst: string | null | undefined) => {
  if (!catalyst) return true;
  const c = catalyst.toLowerCase().trim();
  return c.startsWith('technical momentum') || c === 'recent news' || c === 'news' || c === 'technical';
};

const catalystTagOf = (c: Ep9mCandidate): string | null => {
  if (isGenericCatalyst(c.catalyst)) return null;
  return String(c.catalyst).trim().replace(/\.$/, '');
};

const headlineOf = (c: Ep9mCandidate): string | null => {
  if (!c.thesis) return null;
  const s = String(c.thesis).trim();
  return s.length > 0 ? s : null;
};

const hasCatalyst = (c: Ep9mCandidate): boolean => catalystTagOf(c) != null || headlineOf(c) != null;

const adrOf = (c: Ep9mCandidate): number | null =>
  c.adrPct == null || isNaN(Number(c.adrPct)) ? null : Number(c.adrPct);

const rmvOf = (c: Ep9mCandidate): number | null =>
  c.rmv == null || isNaN(Number(c.rmv)) ? null : Number(c.rmv);

// Unprecedented — today's volume exceeds the stock's own 60-day record.
const UnprecedentedMark = () => (
  <span
    title="Unprecedented — today's volume exceeds this stock's own 60-day high"
    className="inline-block w-2 h-2 rounded-full bg-fuchsia-400 shadow-[0_0_6px_rgba(232,121,249,0.7)] align-middle shrink-0"
  />
);

// Sugar Baby — repeat EP9M offender. These make repeatable 40-50% swings.
const SugarBabyMark = () => (
  <span
    title="Sugar Baby — has triggered EP9M multiple times in the last 90 days"
    className="text-[9px] font-bold text-amber-400/90 leading-none align-middle"
  >
    ★
  </span>
);

export default function Ep9m() {
  const { session } = useMarketData();

  const [candidates, setCandidates] = useState<Ep9mCandidate[]>([]);
  const [status, setStatus] = useState<string>('Syncing...');
  const [generatedAt, setGeneratedAt] = useState<number | null>(null);
  const [raw9m, setRaw9m] = useState<number | null>(null);
  const [shortlisted, setShortlisted] = useState<number | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: keyof Ep9mCandidate; direction: SortDirection } | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [epFilter, setEpFilter] = useState<EpFilterType>('All');
  const [rvolFilter, setRvolFilter] = useState<RvolFilterType>('All');
  const [catalystFilter, setCatalystFilter] = useState<CatalystFilterType>('All');
  const [showUnprecedentedOnly, setShowUnprecedentedOnly] = useState<boolean>(false);
  const [showSugarBabyOnly, setShowSugarBabyOnly] = useState<boolean>(false);
  const [marketCapFilter, setMarketCapFilter] = useState<string>('All');
  const [vwapFilter, setVwapFilter] = useState<VwapFilterType>('All');
  const [showFilters, setShowFilters] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    const fetchCandidates = async () => {
      try {
        const res = await fetch(`/api/ep9m/latest?t=${Date.now()}`, { cache: 'no-store' });
        const data = await res.json();

        if (isMounted && data && data.success && Array.isArray(data.candidates)) {
          setCandidates(data.candidates);
          setGeneratedAt(data.lastScanTime ? Number(data.lastScanTime) : null);
          setRaw9m(data.raw9m ?? null);
          setShortlisted(data.shortlisted ?? null);
          setStatus('Live');
        } else if (isMounted && data?.error) {
          setStatus('Feed Error');
        }
      } catch {
        if (isMounted) setStatus('Feed Offline');
      }
    };
    fetchCandidates();
    const interval = setInterval(fetchCandidates, 60000);
    return () => { isMounted = false; clearInterval(interval); };
  }, []);

  const handleSort = (key: keyof Ep9mCandidate) => {
    let direction: SortDirection = 'desc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') direction = 'asc';
    else if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') { setSortConfig(null); return; }
    setSortConfig({ key, direction });
  };

  // Clicking the active option clears back to All (toggle behavior)
  const handleEpFilter = (val: EpFilterType) => setEpFilter(prev => prev === val ? 'All' : val);
  const handleRvolFilter = (val: RvolFilterType) => setRvolFilter(prev => prev === val ? 'All' : val);
  const handleCatalystFilter = (val: CatalystFilterType) => setCatalystFilter(prev => prev === val ? 'All' : val);
  const handleVwapFilter = (val: VwapFilterType) => setVwapFilter(prev => prev === val ? 'All' : val);

  const filteredAndSorted = useMemo(() => {
    let list = [...candidates];

    if (epFilter !== 'All') {
      const minScore = EP_MIN_SCORE[epFilter];
      list = list.filter(c => (c.score ?? -1) >= minScore);
    }
    if (rvolFilter !== 'All') {
      const minRvol = Number(rvolFilter);
      list = list.filter(c => (c.rvol ?? 0) >= minRvol);
    }
    // Silent = volume with no story yet. Often the most valuable state: the
    // institutional footprint is visible before the news is.
    if (catalystFilter !== 'All') {
      list = list.filter(c => catalystFilter === 'News' ? hasCatalyst(c) : !hasCatalyst(c));
    }
    if (showUnprecedentedOnly) list = list.filter(c => c.unprecedented === true);
    if (showSugarBabyOnly) list = list.filter(c => c.sugarBaby === true);
    if (marketCapFilter !== 'All') {
      list = list.filter(c => {
        const mc = c.mktCap;
        if (!mc) return true;
        if (marketCapFilter === 'Large') return mc >= 2e9;
        if (marketCapFilter === 'Small') return mc < 2e9;
        return true;
      });
    }
    if (vwapFilter !== 'All') {
      list = list.filter(c => c.vwapStatus === vwapFilter);
    }

    if (!sortConfig) return list;
    return list.sort((a, b) => {
      const aVal = a[sortConfig.key] as any;
      const bVal = b[sortConfig.key] as any;
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [candidates, sortConfig, epFilter, rvolFilter, catalystFilter, showUnprecedentedOnly, showSugarBabyOnly, marketCapFilter, vwapFilter]);

  const handleCopyTickers = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const tickers = filteredAndSorted.map(c => c.ticker).join(',');
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

  const silentCount = useMemo(() => candidates.filter(c => !hasCatalyst(c)).length, [candidates]);
  const unprecedentedCount = useMemo(() => candidates.filter(c => c.unprecedented).length, [candidates]);

  const getSortIcon = (columnKey: keyof Ep9mCandidate) =>
    sortConfig?.key === columnKey ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓') : '';

  const getScoreBadge = (score: number) => {
    if (score >= 70) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    if (score >= 50) return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    return 'bg-zinc-800/50 text-zinc-400 border-zinc-700/50';
  };
  const getStageColor = (stage: string | undefined) => {
    if (!stage || stage === '-') return 'text-slate-500';
    if (stage.includes('1')) return 'text-slate-400';
    if (stage.includes('2')) return 'text-emerald-400';
    if (stage.includes('3')) return 'text-amber-400';
    if (stage.includes('4')) return 'text-rose-400';
    return 'text-slate-500';
  };
  // RVOL is the headline metric here, so its scale runs hotter than elsewhere:
  // the scan floors at 3x, which would already be the top bucket on other tables.
  const getRvolColor = (rvol: number | null | undefined) => {
    if (!rvol) return 'text-slate-500';
    if (rvol >= 10) return 'text-fuchsia-400';
    if (rvol >= 7) return 'text-purple-400';
    if (rvol >= 5) return 'text-emerald-400';
    return 'text-lime-400';
  };
  // Float turnover — how much of the tradeable float changed hands today.
  // Above 1.0x the entire float traded, which is a genuine regime change.
  const getTurnColor = (t: number | null | undefined) => {
    if (t == null) return 'text-slate-500';
    if (t >= 1.0) return 'text-fuchsia-400';
    if (t >= 0.5) return 'text-purple-400';
    if (t >= 0.25) return 'text-emerald-400';
    if (t >= 0.10) return 'text-lime-400';
    return 'text-slate-400';
  };
  // Days to cover — the "5" in MAGNA 53. Shorts are trapped fuel.
  const getD2cColor = (d: number | null | undefined) => {
    if (d == null) return 'text-slate-500';
    if (d >= 5) return 'text-purple-400';
    if (d >= 3) return 'text-emerald-400';
    if (d >= 1.5) return 'text-slate-300';
    return 'text-slate-500';
  };
  const getAdrColor = (a: number | null) => {
    if (a == null) return 'text-slate-500';
    if (a >= 10) return 'text-purple-400';
    if (a >= 5) return 'text-emerald-400';
    if (a >= 3) return 'text-slate-300';
    return 'text-slate-500';
  };
  // RMV — inverted scale. On an EP9M name a HIGH reading is expected and fine:
  // it confirms the range expanded with the volume. A low RMV alongside 8x
  // volume is the odd one — heavy trade going nowhere, which is distribution.
  const getRmvColor = (r: number | null) => {
    if (r == null) return 'text-slate-500';
    if (r <= 10) return 'text-emerald-400';
    if (r <= 25) return 'text-lime-400';
    if (r <= 45) return 'text-yellow-400';
    if (r <= 65) return 'text-amber-400';
    if (r <= 80) return 'text-orange-400';
    return 'text-rose-400';
  };
  const getRsColor = (rs: number | null | undefined) => {
    if (rs == null) return 'text-slate-500';
    if (rs >= 20) return 'text-purple-400';
    if (rs >= 10) return 'text-emerald-400';
    if (rs >= 0) return 'text-slate-300';
    return 'text-rose-400';
  };
  const getChgColor = (chg: number | null | undefined) => {
    if (chg == null) return 'text-slate-500';
    return chg >= 0 ? 'text-emerald-400' : 'text-rose-400';
  };

  const emaDot = (state: boolean | null | undefined) => {
    if (state === null || state === undefined) return 'bg-slate-600';
    return state ? 'bg-emerald-400' : 'bg-rose-500';
  };
  const structColor = (state: boolean | null | undefined) => {
    if (state === null || state === undefined) return 'text-slate-600';
    return state ? 'text-emerald-400' : 'text-rose-400';
  };

  // Close strength: where in the day's range price settled. A stock that
  // traded 12M shares and closed on its low moved that volume from buyers to
  // sellers — distribution wearing an accumulation costume.
  const closeState = (c: Ep9mCandidate): { label: string; cls: string } => {
    const s = c.closeStrength;
    if (s == null) return { label: '—', cls: 'text-slate-600' };
    if (s >= 0.85) return { label: 'Closed Strong', cls: 'text-emerald-400' };
    if (s >= 0.70) return { label: 'Upper Range', cls: 'text-lime-400' };
    if (s >= 0.50) return { label: 'Mid Range', cls: 'text-slate-400' };
    if (s >= 0.25) return { label: 'Lower Range', cls: 'text-amber-400' };
    return { label: 'Closed Weak', cls: 'text-rose-400' };
  };

  const displaySession = ['Pre-Market', 'Open', 'Post-Market', 'Closed'].includes(session) ? session : 'Closed';
  const getSessionTextColor = () => {
    if (displaySession === 'Pre-Market') return 'text-amber-500';
    if (displaySession === 'Open') return 'text-[#00e676]';
    if (displaySession === 'Post-Market') return 'text-indigo-400';
    return 'text-slate-500';
  };

  const thBase = "px-1 py-2.5 text-[10px] text-slate-500 font-bold tracking-wide leading-tight cursor-pointer hover:text-slate-300 transition-colors text-center";
  const tdBase = "px-1 pt-2.5 pb-1.5 text-center";
  const filterBtnActive = "bg-[#1e293b] text-indigo-400 border border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.1)]";
  const filterBtnIdle = "text-slate-500 border border-transparent hover:text-slate-300 hover:bg-white/[0.02]";
  const pillWrap = "flex items-center gap-3 px-4 py-1 bg-[#161c2a] border border-white/5 rounded-lg shrink-0";
  const pillLabel = "text-[11px] font-bold tracking-widest uppercase text-slate-400";
  const pillBtn = "px-3 py-1 rounded-lg text-[11px] font-bold tracking-widest uppercase transition-all duration-300 whitespace-nowrap";

  const activeFilterCount =
    (epFilter !== 'All' ? 1 : 0) +
    (rvolFilter !== 'All' ? 1 : 0) +
    (catalystFilter !== 'All' ? 1 : 0) +
    (showUnprecedentedOnly ? 1 : 0) +
    (showSugarBabyOnly ? 1 : 0) +
    (marketCapFilter !== 'All' ? 1 : 0) +
    (vwapFilter !== 'All' ? 1 : 0);

  // Funnel note — makes a thin list read as "quiet tape" rather than "broken scan".
  const funnelNote = raw9m != null && shortlisted != null
    ? `${raw9m} names cleared 9M shares · ${shortlisted} were abnormal for themselves`
    : null;

  return (
    <div className="bg-[#101623] border border-white/5 rounded-2xl p-3 md:p-5 relative overflow-hidden shadow-xl w-full max-w-[1280px] mx-auto">
      <div onClick={() => setIsExpanded(!isExpanded)} className={`flex justify-between items-center relative z-10 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-5 border-b border-white/5 pb-4' : ''}`}>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs md:text-sm font-bold text-[#7c8bfa] bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 group-hover:bg-white/[0.02] transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
            EP 9 MILLION
          </span>
          {candidates.length > 0 && (
            <span className="hidden md:flex items-center gap-2">
              <span className="text-[10px] font-bold tracking-wider uppercase text-fuchsia-400 bg-fuchsia-500/10 border border-fuchsia-500/20 px-2 py-0.5 rounded">{unprecedentedCount} Unprecedented</span>
              <span className="text-[10px] font-bold tracking-wider uppercase text-slate-400 bg-white/[0.03] border border-white/5 px-2 py-0.5 rounded">{silentCount} Silent</span>
            </span>
          )}
          {filteredAndSorted.length > 0 && (
            <button
              onClick={handleCopyTickers}
              title={`Copy ${filteredAndSorted.length} ticker${filteredAndSorted.length !== 1 ? 's' : ''} for TradingView`}
              className={`text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded border transition-all duration-200 ${
                copied
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-[#161c2a] text-slate-400 border-white/5 hover:text-slate-200 hover:bg-white/[0.04]'
              }`}
            >
              {copied ? `✓ Copied ${filteredAndSorted.length}` : `Copy ${filteredAndSorted.length}`}
            </button>
          )}
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-center justify-center border border-white/5 bg-[#161c2a]/40 px-4 py-1.5 rounded-[10px] min-w-[120px]">
            <span className={`text-[10px] font-bold tracking-widest uppercase ${getSessionTextColor()}`}>{displaySession}</span>
          </div>
          {generatedAt && (<span className="text-[11px] text-slate-400/80 font-medium px-1 tracking-wide">Scanned: {formatTime(generatedAt)} EST</span>)}
        </div>
      </div>

      {isExpanded && (
        <>
          <div className="flex flex-col gap-3 mb-4 relative z-10" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-center">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`px-4 py-1.5 rounded-lg text-[11px] font-bold tracking-widest uppercase transition-all duration-300 flex items-center gap-2 ${
                  activeFilterCount > 0
                    ? 'bg-[#1e293b] text-indigo-400 border border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.1)]'
                    : 'bg-[#161c2a] text-slate-400 border border-white/5 hover:bg-white/[0.04]'
                }`}
              >
                <span className={`inline-block transition-transform duration-200 ${showFilters ? 'rotate-90' : ''}`}>▸</span>
                Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
              </button>
            </div>
            {showFilters && (
              <div className="flex flex-wrap justify-center items-center gap-3 w-full">
                <div className={pillWrap}>
                  <span className={pillLabel}>EP</span>
                  <div className="flex items-center gap-1">
                    {EP_BUCKETS.map((g) => (
                      <button
                        key={g}
                        onClick={() => handleEpFilter(g)}
                        title={g === 'A' ? 'A only — EP 70 and above' : 'B and above — includes A (EP 50+)'}
                        className={`${pillBtn} ${epFilter === g ? filterBtnActive : filterBtnIdle}`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={pillWrap}>
                  <span className={pillLabel}>RVOL</span>
                  <div className="flex items-center gap-1">
                    {RVOL_BUCKETS.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => handleRvolFilter(opt)}
                        title={`Relative volume of ${opt}x and above — scan floor is 3x`}
                        className={`${pillBtn} ${rvolFilter === opt ? filterBtnActive : filterBtnIdle}`}
                      >
                        {opt}x+
                      </button>
                    ))}
                  </div>
                </div>
                <div className={pillWrap}>
                  <span className={pillLabel}>STORY</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleCatalystFilter('News')}
                      title="Has a news catalyst attached"
                      className={`${pillBtn} ${catalystFilter === 'News' ? filterBtnActive : filterBtnIdle}`}
                    >
                      News
                    </button>
                    <button
                      onClick={() => handleCatalystFilter('Silent')}
                      title="Heavy volume with no headline yet — the footprint before the story"
                      className={`${pillBtn} ${catalystFilter === 'Silent' ? filterBtnActive : filterBtnIdle}`}
                    >
                      Silent
                    </button>
                  </div>
                </div>
                <div className={pillWrap}>
                  <span className={pillLabel}>FLAGS</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setShowUnprecedentedOnly(!showUnprecedentedOnly)}
                      title="Today's volume exceeds this stock's own 60-day record"
                      className={`${pillBtn} ${showUnprecedentedOnly ? filterBtnActive : filterBtnIdle}`}
                    >
                      Unprec
                    </button>
                    <button
                      onClick={() => setShowSugarBabyOnly(!showSugarBabyOnly)}
                      title="Repeat EP9M offender in the last 90 days"
                      className={`${pillBtn} ${showSugarBabyOnly ? filterBtnActive : filterBtnIdle}`}
                    >
                      ★ Repeat
                    </button>
                  </div>
                </div>
                <div className={pillWrap}>
                  <span className={pillLabel}>MKT CAP</span>
                  <div className="flex items-center gap-1">
                    {['All', 'Small', 'Large'].map((cap) => (
                      <button key={cap} onClick={() => setMarketCapFilter(cap)} className={`${pillBtn} ${marketCapFilter === cap ? filterBtnActive : filterBtnIdle}`}>{cap}</button>
                    ))}
                  </div>
                </div>
                <div className={pillWrap}>
                  <span className={pillLabel}>VWAP</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => handleVwapFilter('above')} className={`flex items-center gap-1.5 ${pillBtn} ${vwapFilter === 'above' ? filterBtnActive : filterBtnIdle}`}>
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400"></div>Above
                    </button>
                    <button onClick={() => handleVwapFilter('below')} className={`flex items-center gap-1.5 ${pillBtn} ${vwapFilter === 'below' ? filterBtnActive : filterBtnIdle}`}>
                      <div className="w-1.5 h-1.5 rounded-full bg-rose-500"></div>Below
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="relative z-10 overflow-x-auto custom-scrollbar" style={{ scrollbarWidth: 'thin' }}>
            <table className="w-full min-w-[1120px] table-fixed border-collapse">
              <thead>
                <tr className="border-b border-white/5 select-none">
                  <th className={`${thBase} w-[10%]`} onClick={() => handleSort('ticker')}>TICKER{getSortIcon('ticker')}</th>
                  <th className={`${thBase} w-[4%]`} onClick={() => handleSort('score')}>EP{getSortIcon('score')}</th>
                  <th className={`${thBase} w-[8%]`} onClick={() => handleSort('price')}>PRICE{getSortIcon('price')}</th>
                  <th className={`${thBase} w-[7%]`} onClick={() => handleSort('changePct')}>CHG%{getSortIcon('changePct')}</th>
                  <th className={`${thBase} w-[8%]`} onClick={() => handleSort('vol')}>VOL{getSortIcon('vol')}</th>
                  <th className={`${thBase} w-[6%]`} onClick={() => handleSort('rvol')}>RVOL{getSortIcon('rvol')}</th>
                  <th className={`${thBase} w-[7%]`} onClick={() => handleSort('dVol')}>$VOL{getSortIcon('dVol')}</th>
                  <th className={`${thBase} w-[6%]`} onClick={() => handleSort('floatTurnover')}>TURN{getSortIcon('floatTurnover')}</th>
                  <th className={`${thBase} w-[5%]`} onClick={() => handleSort('daysToCover')}>D2C{getSortIcon('daysToCover')}</th>
                  <th className={`${thBase} w-[5%]`} onClick={() => handleSort('adrPct')}>ADR{getSortIcon('adrPct')}</th>
                  <th className={`${thBase} w-[5%]`} onClick={() => handleSort('rmv')}>RMV{getSortIcon('rmv')}</th>
                  <th className={`${thBase} w-[6%]`} onClick={() => handleSort('rsVsSpy')}>RS/SPY{getSortIcon('rsVsSpy')}</th>
                  <th className={`${thBase} w-[7%]`} onClick={() => handleSort('mktCap')}>MCAP{getSortIcon('mktCap')}</th>
                  <th className={`${thBase} w-[5%] border-l border-white/5`} onClick={() => handleSort('stage')}>STAGE{getSortIcon('stage')}</th>
                  <th className={`${thBase} w-[11%]`} onClick={() => handleSort('sector')}>SECTOR{getSortIcon('sector')}</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-white/5">
                {filteredAndSorted.length === 0 ? (
                  <tr>
                    <td colSpan={15} className="py-12 text-center text-slate-500 text-sm font-medium">
                      {status === 'Live'
                        ? (candidates.length > 0
                            ? 'No names match the current filters.'
                            : 'Nothing trading abnormal size yet — volume builds through the session.')
                        : status === 'Syncing...'
                          ? 'Running scan…'
                          : 'Feed unavailable — awaiting next scheduled scan.'}
                    </td>
                  </tr>
                ) : (
                  filteredAndSorted.map((row) => {
                    const tag = catalystTagOf(row);
                    const headline = headlineOf(row);
                    const sectorText = cleanSector(row.sector, row.ticker);
                    const adr = adrOf(row);
                    const rmv = rmvOf(row);
                    const cs = closeState(row);
                    return (
                      <React.Fragment key={row.ticker}>
                        <tr className="hover:bg-white/[0.02] transition-colors group">
                          <td className={tdBase}>
                            <div className="flex items-center justify-center gap-1.5">
                              <span title={row.name || row.ticker} className="inline-block bg-indigo-500/10 text-[#7c8bfa] text-[11px] font-bold px-1.5 py-0.5 rounded border border-indigo-500/20 cursor-help">{row.ticker}</span>
                              {row.unprecedented && <UnprecedentedMark />}
                              {row.sugarBaby && <SugarBabyMark />}
                            </div>
                          </td>
                          <td className={tdBase}>
                            <span className={`inline-block whitespace-nowrap px-1.5 py-[2px] rounded text-[9px] font-bold border ${getScoreBadge(row.score)}`}>{row.score}</span>
                          </td>
                          <td className={`${tdBase} text-xs text-slate-300 font-medium whitespace-nowrap tabular-nums`}>
                            <div className="flex items-center justify-center gap-1">${row.price.toFixed(2)}{row.vwapStatus && row.vwapStatus !== 'neutral' && (<div className={`w-1.5 h-1.5 rounded-full shrink-0 ${row.vwapStatus === 'above' ? 'bg-emerald-400' : 'bg-rose-500'}`} title={`VWAP: ${row.vwapStatus}`}></div>)}</div>
                          </td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getChgColor(row.changePct)}`}>
                            {row.changePct != null ? `${row.changePct >= 0 ? '+' : ''}${row.changePct.toFixed(2)}%` : '—'}
                          </td>
                          <td
                            className={`${tdBase} whitespace-nowrap tabular-nums`}
                            title={row.avgVol ? `20-day average: ${formatNumber(row.avgVol)}${row.volVs60dMax != null ? ` · ${row.volVs60dMax.toFixed(2)}x its 60-day volume high` : ''}` : undefined}
                          >
                            <div className="text-xs font-bold leading-tight text-slate-200">{formatNumber(row.vol)}</div>
                            {row.avgVol ? (<div className="text-[9px] text-slate-500 font-medium leading-tight">avg {formatNumber(row.avgVol)}</div>) : null}
                          </td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getRvolColor(row.rvol)}`} title="Today's volume vs its own 20-day average">
                            {row.rvol ? `${row.rvol.toFixed(1)}x` : '—'}
                          </td>
                          <td className={`${tdBase} text-xs text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{formatCurrency(row.dVol)}</td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getTurnColor(row.floatTurnover)}`} title="Float turnover — share of the tradeable float that changed hands today. Above 1.0x the entire float traded.">
                            {row.floatTurnover != null ? `${row.floatTurnover.toFixed(2)}x` : '—'}
                          </td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getD2cColor(row.daysToCover)}`} title="Days to cover — short interest divided by average daily volume. Squeeze fuel.">
                            {row.daysToCover != null ? row.daysToCover.toFixed(1) : '—'}
                          </td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getAdrColor(adr)}`} title="20-day average daily range (high/low) — the anti-chop measure">
                            {adr != null ? `${adr.toFixed(1)}%` : '—'}
                          </td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getRmvColor(rmv)}`} title="RMV(15) — 0 = tightest price action of the last 15 bars, 100 = most volatile. High is expected here; low alongside heavy volume means trade going nowhere.">
                            {rmv != null ? rmv.toFixed(0) : '—'}
                          </td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getRsColor(row.rsVsSpy)}`}>
                            {row.rsVsSpy != null ? `${row.rsVsSpy >= 0 ? '+' : ''}${row.rsVsSpy.toFixed(1)}` : '—'}
                          </td>
                          <td className={`${tdBase} text-xs text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{formatNumber(row.mktCap)}</td>
                          <td className={`${tdBase} whitespace-nowrap border-l border-white/5`}>
                            <span className={`text-[11px] font-bold tracking-wide ${getStageColor(row.stage)}`}>{formatStageText(row.stage)}</span>
                          </td>
                          <td className={tdBase}>
                            <span title={sectorText} className="block truncate text-[10px] font-semibold tracking-wide uppercase text-slate-400">{sectorText}</span>
                          </td>
                        </tr>
                        {/* Sub-row: spacer | EP 9M + news catalyst | STR/CLOSE centered */}
                        <tr className="bg-transparent border-t border-white/5">
                          <td className="w-[10%]"></td>
                          <td colSpan={12} className="pb-2.5 pt-1.5 pr-3">
                            <div className="flex items-center text-left">
                              <span className="shrink-0 w-[104px] pr-2 text-[#7c8bfa] font-bold text-[11px] tracking-[0.08em] uppercase leading-tight">EP 9M</span>
                              <p className="flex-1 text-[11px] leading-relaxed whitespace-normal border-l border-white/10 pl-3">
                                {headline || tag ? (
                                  <>
                                    {tag && (
                                      <>
                                        <span className="text-[9px] font-bold tracking-widest uppercase text-amber-400/90">{tag}</span>
                                        {headline ? ' ' : ''}
                                      </>
                                    )}
                                    {headline && (
                                      row.catalystUrl ? (
                                        <a href={row.catalystUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-300/90 font-medium hover:text-[#7c8bfa] hover:underline transition-colors">{headline}</a>
                                      ) : (
                                        <span className="text-indigo-300/90 font-medium">{headline}</span>
                                      )
                                    )}
                                  </>
                                ) : (
                                  <span className="text-slate-600 italic">No headline yet — the volume is the signal. Research the story.</span>
                                )}
                              </p>
                            </div>
                          </td>
                          <td colSpan={2} className="pb-2.5 pt-1.5 align-middle">
                            <div className="flex items-center justify-center gap-2 border-l border-white/10 px-1 py-1">
                              <span className="flex items-center gap-1">
                                <span className="text-[10px] text-slate-500">STR:</span>
                                <span className={`text-[10px] font-semibold ${structColor(row.goldenCross)}`} title="50 SMA > 200 SMA">GC</span>
                                <span className={`text-[10px] font-semibold ${structColor(row.ema21Rising)}`} title="21 EMA rising">21↑</span>
                              </span>
                              <span className="flex items-center gap-1 whitespace-nowrap">
                                <span className="text-[10px] text-slate-500">CLS:</span>
                                <span className={`text-[10px] font-semibold ${cs.cls}`} title="Where in the day's range price settled">{cs.label}</span>
                              </span>
                            </div>
                          </td>
                        </tr>
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {funnelNote && isExpanded && (
        <div className="relative z-10 mt-3 text-center">
          <span className="text-[10px] text-slate-600 font-medium tracking-wide">{funnelNote}</span>
        </div>
      )}
    </div>
  );
}
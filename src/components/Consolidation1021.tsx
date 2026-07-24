'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useMarketData } from './MarketDataContext';

interface ConsolCandidate {
  symbol: string;
  name?: string;
  sector?: string;
  price: number;
  score: number;
  changePct?: number;
  vol?: number;
  dVol?: number;
  rvol?: number | null;
  float?: number | null;
  shortPct?: number | null;
  mktCap?: number | null;
  stage?: string;
  vwapStatus?: 'above' | 'below' | 'neutral';
  atrPct: number;
  adrPct?: number | null;
  pctOffHigh: number;
  distToEma21: number;
  distToEma10?: number;
  aboveEma10?: boolean;
  aboveEma21?: boolean;
  stochK: number;
  rsVsSpy: number;
  avgDollarVolM: number;
  goldenCross: boolean;
  ema21Rising: boolean;
  range10Pct?: number;
  coilRatio?: number | null;
  blueDot?: boolean;
  catalyst?: string | null;
  catalystUrl?: string | null;
  news?: string | null;
  newsUrl?: string | null;
  headline?: string | null;
}

type CnfFilterType = 'All' | 'A' | 'B';
type EmaFilterType = 'All' | '>10' | '>21' | 'Both';
type VwapFilterType = 'All' | 'above' | 'below';
type StatFilterType = 'All' | 'Coiled' | 'Setting Up';
type DVolFilterType = 'All' | '20' | '50' | '100';
type AdrFilterType = 'All' | '5' | '10';

/* ---- Coil thresholds, in multiples of daily ATR ----------------
   Mirrors CONSOL_CONFIG.tightCoilRatio / maxCoilRatio in the scan
   route (app/api/swing-candidates/run/route.ts) — keep these in
   sync if either side is tuned.
   ---------------------------------------------------------------- */
const COIL_TIGHT_RATIO = 2.5;
const COIL_LOOSE_RATIO = 4.0;
const COIL_TIGHT_PCT = 6;
const COIL_LOOSE_PCT = 10;

// CNF is a floor, not an exact grade: picking B shows B and A. Unset shows
// everything, which is effectively "C and above".
const CNF_BUCKETS: CnfFilterType[] = ['A', 'B'];
const CNF_MIN_SCORE: Record<'A' | 'B', number> = { A: 70, B: 50 };

// $VOL buckets in millions of 20-day average dollar volume (scan floor: $10M).
const DVOL_BUCKETS: DVolFilterType[] = ['20', '50', '100'];
// ADR buckets in percent — the scan already floors at 3%, so these tighten.
const ADR_BUCKETS: AdrFilterType[] = ['5', '10'];

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

// Range width normalized by the stock's own daily ATR. Prefers the stored
// value, computes it when both inputs are present, else null.
const coilRatioOf = (c: ConsolCandidate): number | null => {
  if (c.coilRatio != null && !isNaN(Number(c.coilRatio)) && Number(c.coilRatio) > 0) return Number(c.coilRatio);
  const range = Number(c.range10Pct);
  const atr = Number(c.atrPct);
  if (!isNaN(range) && !isNaN(atr) && atr > 0) return range / atr;
  return null;
};

const adrOf = (c: ConsolCandidate): number | null => {
  if (c.adrPct == null || isNaN(Number(c.adrPct))) return null;
  return Number(c.adrPct);
};

// Coiled = inside 2.5x ATR (or 6% raw when ATR is unavailable).
const statOf = (c: ConsolCandidate): StatFilterType | null => {
  const ratio = coilRatioOf(c);
  if (ratio != null) return ratio <= COIL_TIGHT_RATIO ? 'Coiled' : 'Setting Up';
  if (c.range10Pct == null) return null;
  return c.range10Pct <= COIL_TIGHT_PCT ? 'Coiled' : 'Setting Up';
};

const isCoiled = (c: ConsolCandidate) => statOf(c) === 'Coiled';

// Blue Dot marker — oversold stoch reset firing on the daily.
const BlueDot = ({ className = '' }: { className?: string }) => (
  <span
    title="Blue Dot — oversold stoch reset firing on the daily"
    className={`inline-block w-2 h-2 rounded-full bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.7)] align-middle shrink-0 ${className}`}
  />
);

// Sector strings sometimes arrive ticker-prefixed ("RKLB - AEROSPACE") from the
// scanner payload. Strip the prefix so one bad row can't widen the column.
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

// Fallback labels the backend uses when there's no real headline.
const isGenericCatalyst = (catalyst: string | null | undefined) => {
  if (!catalyst) return true;
  const c = catalyst.toLowerCase().trim();
  return c.startsWith('technical momentum') || c === 'recent news' || c === 'news' || c === 'technical';
};

const catalystOf = (c: ConsolCandidate): string | null => {
  const raw = c.catalyst ?? c.news ?? c.headline ?? null;
  if (isGenericCatalyst(raw)) return null;
  return String(raw).trim().replace(/\.$/, '');
};

const catalystUrlOf = (c: ConsolCandidate): string | null => c.catalystUrl ?? c.newsUrl ?? null;

// Plain-English readout for the sub-row, built from the row's own numbers.
const buildReadout = (c: ConsolCandidate) => {
  const ratio = coilRatioOf(c);
  const adr = adrOf(c);
  const range = c.range10Pct != null
    ? `${c.range10Pct.toFixed(1)}% ten-day range${ratio != null ? ` (${ratio.toFixed(1)}x its ${c.atrPct.toFixed(1)}% ATR)` : ''}`
    : 'tight range';
  const d10 = c.distToEma10 != null ? `${c.distToEma10 >= 0 ? '+' : ''}${c.distToEma10.toFixed(1)}% vs 10 EMA` : '';
  const d21 = `${c.distToEma21 >= 0 ? '+' : ''}${c.distToEma21.toFixed(1)}% vs 21 EMA`;
  const structure = c.goldenCross ? '50>200 intact' : '50<200';
  const adrBit = adr != null ? ` ADR ${adr.toFixed(1)}% gives it room to travel once it goes.` : '';
  const posture = isCoiled(c)
    ? 'Watching for a range break on expanding volume'
    : 'Still wide for its own volatility — wants further contraction before it is actionable';
  return `Coiling in a ${range} on the rising 10/21 (${[d10, d21].filter(Boolean).join(', ')}), ${c.pctOffHigh.toFixed(0)}% off highs with RS +${c.rsVsSpy.toFixed(0)} vs SPY, ${structure}.${adrBit} ${posture}.`;
};

const above21 = (c: ConsolCandidate) => c.aboveEma21 ?? c.distToEma21 >= 0;
const above10 = (c: ConsolCandidate) => c.aboveEma10 ?? (c.distToEma10 != null ? c.distToEma10 >= 0 : null);

export default function Consolidation1021() {
  const { session } = useMarketData();

  const [candidates, setCandidates] = useState<ConsolCandidate[]>([]);
  const [status, setStatus] = useState<string>('Syncing...');
  const [generatedAt, setGeneratedAt] = useState<number | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [statFilter, setStatFilter] = useState<StatFilterType>('All');
  const [showStage2AOnly, setShowStage2AOnly] = useState<boolean>(false);
  const [marketCapFilter, setMarketCapFilter] = useState<string>('All');
  const [cnfFilter, setCnfFilter] = useState<CnfFilterType>('All');
  const [emaFilter, setEmaFilter] = useState<EmaFilterType>('All');
  const [dVolFilter, setDVolFilter] = useState<DVolFilterType>('All');
  const [adrFilter, setAdrFilter] = useState<AdrFilterType>('All');
  const [vwapFilter, setVwapFilter] = useState<VwapFilterType>('All');
  const [showFilters, setShowFilters] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    const fetchCandidates = async () => {
      try {
        const res = await fetch(`/api/consolidation/latest?t=${Date.now()}`, { cache: 'no-store' });
        const data = await res.json();

        if (isMounted && data && data.success && Array.isArray(data.candidates)) {
          setCandidates(data.candidates);
          setGeneratedAt(data.lastScanTime ? Number(data.lastScanTime) : Date.now());
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

  // Clicking the active option clears back to All (toggle behavior)
  const handleCnfFilter = (val: CnfFilterType) => setCnfFilter(prev => prev === val ? 'All' : val);
  const handleEmaFilter = (val: EmaFilterType) => setEmaFilter(prev => prev === val ? 'All' : val);
  const handleDVolFilter = (val: DVolFilterType) => setDVolFilter(prev => prev === val ? 'All' : val);
  const handleAdrFilter = (val: AdrFilterType) => setAdrFilter(prev => prev === val ? 'All' : val);
  const handleVwapFilter = (val: VwapFilterType) => setVwapFilter(prev => prev === val ? 'All' : val);
  const handleStatFilter = (val: StatFilterType) => setStatFilter(prev => prev === val ? 'All' : val);

  const filtered = useMemo(() => {
    let list = [...candidates];
    if (statFilter !== 'All') list = list.filter(c => statOf(c) === statFilter);
    if (showStage2AOnly) list = list.filter(c => c.stage && c.stage.includes('2A'));
    if (marketCapFilter !== 'All') {
      list = list.filter(c => {
        const mc = c.mktCap;
        if (!mc) return true;
        if (marketCapFilter === 'Large') return mc >= 2e9;
        if (marketCapFilter === 'Small') return mc < 2e9;
        return true;
      });
    }
    // CNF is "grade and above": B keeps both B and A.
    if (cnfFilter !== 'All') {
      const minScore = CNF_MIN_SCORE[cnfFilter];
      list = list.filter(c => (c.score ?? -1) >= minScore);
    }
    if (emaFilter !== 'All') {
      list = list.filter(c => {
        const a10 = above10(c);
        const a21 = above21(c);
        if (emaFilter === '>10') return a10 === true;
        if (emaFilter === '>21') return a21 === true;
        if (emaFilter === 'Both') return a10 === true && a21 === true;
        return true;
      });
    }
    // $VOL buckets are "and above", measured on 20-day average dollar volume —
    // the same metric the scan gates on, not today's (light-by-design) volume.
    if (dVolFilter !== 'All') {
      const minM = Number(dVolFilter);
      list = list.filter(c => (Number(c.avgDollarVolM) || 0) >= minM);
    }
    // ADR buckets are "and above" on the 20-day average daily range.
    if (adrFilter !== 'All') {
      const minAdr = Number(adrFilter);
      list = list.filter(c => {
        const a = adrOf(c);
        return a != null && a >= minAdr;
      });
    }
    if (vwapFilter !== 'All') {
      list = list.filter(c => c.vwapStatus === vwapFilter);
    }
    return list;
  }, [candidates, statFilter, showStage2AOnly, marketCapFilter, cnfFilter, emaFilter, dVolFilter, adrFilter, vwapFilter]);

  // Copy the visible tickers, comma-separated — TradingView's watchlist
  // import format. Respects whatever filters are active.
  const handleCopyTickers = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const tickers = filtered.map(c => c.symbol).join(',');
    if (!tickers) return;
    try {
      await navigator.clipboard.writeText(tickers);
    } catch {
      // Clipboard API needs a secure context; fall back to a temp textarea.
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

  // Counts for the header chips — computed off the unfiltered set
  const coiledCount = useMemo(() => candidates.filter(c => statOf(c) === 'Coiled').length, [candidates]);
  const settingUpCount = useMemo(() => candidates.filter(c => statOf(c) === 'Setting Up').length, [candidates]);

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
  const getRvolColor = (rvol: number | null | undefined) => {
    if (!rvol) return 'text-slate-500';
    if (rvol >= 2) return 'text-amber-400';
    if (rvol >= 1.5) return 'text-emerald-400';
    return 'text-slate-500';
  };
  // ADR — more daily range means more to capture on the break.
  const getAdrColor = (a: number | null) => {
    if (a == null) return 'text-slate-500';
    if (a >= 10) return 'text-purple-400';
    if (a >= 5) return 'text-emerald-400';
    if (a >= 3) return 'text-slate-300';
    return 'text-slate-500';
  };
  // Coil color keys off the ATR-normalized ratio, not the raw percent.
  const getCoilColor = (c: ConsolCandidate) => {
    const ratio = coilRatioOf(c);
    if (ratio == null) {
      const r = c.range10Pct;
      if (r == null) return 'text-slate-500';
      if (r <= COIL_TIGHT_PCT) return 'text-emerald-400';
      if (r <= COIL_LOOSE_PCT) return 'text-amber-400';
      return 'text-slate-300';
    }
    if (ratio <= 2.0) return 'text-purple-400';
    if (ratio <= COIL_TIGHT_RATIO) return 'text-emerald-400';
    if (ratio <= COIL_LOOSE_RATIO) return 'text-amber-400';
    return 'text-slate-300';
  };
  const getRsColor = (rs: number) => {
    if (rs >= 20) return 'text-purple-400';
    if (rs >= 10) return 'text-emerald-400';
    if (rs >= 0) return 'text-slate-300';
    return 'text-rose-400';
  };
  const getOffHighColor = (p: number) => {
    if (p <= 5) return 'text-emerald-400';
    if (p <= 10) return 'text-slate-300';
    return 'text-slate-400';
  };

  const emaDot = (state: boolean | null | undefined) => {
    if (state === null || state === undefined) return 'bg-slate-600';
    return state ? 'bg-emerald-400' : 'bg-rose-500';
  };
  const structColor = (state: boolean | null | undefined) => {
    if (state === null || state === undefined) return 'text-slate-600';
    return state ? 'text-emerald-400' : 'text-rose-400';
  };

  const displaySession = ['Pre-Market', 'Open', 'Post-Market', 'Closed'].includes(session) ? session : 'Closed';
  const getSessionTextColor = () => {
    if (displaySession === 'Pre-Market') return 'text-amber-500';
    if (displaySession === 'Open') return 'text-[#00e676]';
    if (displaySession === 'Post-Market') return 'text-indigo-400';
    return 'text-slate-500';
  };

  // Shared styles — every column centered, uniform tight padding
  const thBase = "px-1 py-2.5 text-[10px] text-slate-500 font-bold tracking-wide leading-tight text-center";
  const tdBase = "px-1 pt-2.5 pb-1.5 text-center";
  const filterBtnActive = "bg-[#1e293b] text-indigo-400 border border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.1)]";
  const filterBtnIdle = "text-slate-500 border border-transparent hover:text-slate-300 hover:bg-white/[0.02]";
  const pillWrap = "flex items-center gap-3 px-4 py-1 bg-[#161c2a] border border-white/5 rounded-lg shrink-0";
  const pillLabel = "text-[11px] font-bold tracking-widest uppercase text-slate-400";
  const pillBtn = "px-3 py-1 rounded-lg text-[11px] font-bold tracking-widest uppercase transition-all duration-300 whitespace-nowrap";

  const activeFilterCount =
    (showStage2AOnly ? 1 : 0) +
    (statFilter !== 'All' ? 1 : 0) +
    (marketCapFilter !== 'All' ? 1 : 0) +
    (cnfFilter !== 'All' ? 1 : 0) +
    (emaFilter !== 'All' ? 1 : 0) +
    (dVolFilter !== 'All' ? 1 : 0) +
    (adrFilter !== 'All' ? 1 : 0) +
    (vwapFilter !== 'All' ? 1 : 0);

  return (
    <div className="bg-[#101623] border border-white/5 rounded-2xl p-3 md:p-5 relative overflow-hidden shadow-xl w-full max-w-[1280px] mx-auto">
      <div onClick={() => setIsExpanded(!isExpanded)} className={`flex justify-between items-center relative z-10 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-5 border-b border-white/5 pb-4' : ''}`}>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs md:text-sm font-bold text-[#7c8bfa] bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 group-hover:bg-white/[0.02] transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
            10/21 CONSOLIDATION
          </span>
          {candidates.length > 0 && (
            <span className="hidden md:flex items-center gap-2">
              <span className="text-[10px] font-bold tracking-wider uppercase text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">{coiledCount} Coiled</span>
              <span className="text-[10px] font-bold tracking-wider uppercase text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded">{settingUpCount} Setting Up</span>
            </span>
          )}
          {filtered.length > 0 && (
            <button
              onClick={handleCopyTickers}
              title={`Copy ${filtered.length} ticker${filtered.length !== 1 ? 's' : ''} for TradingView`}
              className={`text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded border transition-all duration-200 ${
                copied
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-[#161c2a] text-slate-400 border-white/5 hover:text-slate-200 hover:bg-white/[0.04]'
              }`}
            >
              {copied ? `✓ Copied ${filtered.length}` : `Copy ${filtered.length}`}
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
            {/* Collapsed disclosure — one button, shows active filter count */}
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
            {/* Expanded: one uniform pill strip */}
            {showFilters && (
              <div className="flex flex-wrap justify-center items-center gap-3 w-full">
                <div className={pillWrap}>
                  <span className={pillLabel}>STAGE</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setShowStage2AOnly(!showStage2AOnly)} className={`${pillBtn} ${showStage2AOnly ? filterBtnActive : filterBtnIdle}`}>2A</button>
                  </div>
                </div>
                <div className={pillWrap}>
                  <span className={pillLabel}>STAT</span>
                  <div className="flex items-center gap-1">
                    {(['Coiled', 'Setting Up'] as StatFilterType[]).map((opt) => (
                      <button key={opt} onClick={() => handleStatFilter(opt)} className={`${pillBtn} ${statFilter === opt ? filterBtnActive : filterBtnIdle}`}>
                        {opt}
                      </button>
                    ))}
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
                  <span className={pillLabel}>$VOL</span>
                  <div className="flex items-center gap-1">
                    {DVOL_BUCKETS.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => handleDVolFilter(opt)}
                        title={`20-day average dollar volume of $${opt}M and above`}
                        className={`${pillBtn} ${dVolFilter === opt ? filterBtnActive : filterBtnIdle}`}
                      >
                        {opt}M+
                      </button>
                    ))}
                  </div>
                </div>
                <div className={pillWrap}>
                  <span className={pillLabel}>ADR</span>
                  <div className="flex items-center gap-1">
                    {ADR_BUCKETS.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => handleAdrFilter(opt)}
                        title={`20-day average daily range of ${opt}% and above — scan floor is 3%`}
                        className={`${pillBtn} ${adrFilter === opt ? filterBtnActive : filterBtnIdle}`}
                      >
                        {opt}%+
                      </button>
                    ))}
                  </div>
                </div>
                <div className={pillWrap}>
                  <span className={pillLabel}>CNF</span>
                  <div className="flex items-center gap-1">
                    {CNF_BUCKETS.map((g) => (
                      <button
                        key={g}
                        onClick={() => handleCnfFilter(g)}
                        title={g === 'A' ? 'A only — CNF 70 and above' : 'B and above — includes A (CNF 50+)'}
                        className={`${pillBtn} ${cnfFilter === g ? filterBtnActive : filterBtnIdle}`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={pillWrap}>
                  <span className={pillLabel}>10/21</span>
                  <div className="flex items-center gap-1">
                    {(['>10', '>21', 'Both'] as EmaFilterType[]).map((opt) => (
                      <button key={opt} onClick={() => handleEmaFilter(opt)} className={`${pillBtn} ${emaFilter === opt ? filterBtnActive : filterBtnIdle}`}>
                        {opt}
                      </button>
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
            <table className="w-full min-w-[1060px] table-fixed border-collapse">
              <thead>
                <tr className="border-b border-white/5 select-none">
                  <th className={`${thBase} w-[8%]`}>TICKER</th>
                  <th className={`${thBase} w-[5%]`}>CNF</th>
                  <th className={`${thBase} w-[7%]`}>PRICE</th>
                  <th className={`${thBase} w-[7%]`}>CHG%</th>
                  <th className={`${thBase} w-[7%]`}>10/21</th>
                  <th className={`${thBase} w-[7%]`}>VOL</th>
                  <th className={`${thBase} w-[7%]`}>$VOL</th>
                  <th className={`${thBase} w-[7%]`}>RVOL</th>
                  <th className={`${thBase} w-[7%]`}>COIL</th>
                  <th className={`${thBase} w-[6%]`}>ADR</th>
                  <th className={`${thBase} w-[7%]`}>RS/SPY</th>
                  <th className={`${thBase} w-[7%]`}>%OFF HI</th>
                  <th className={`${thBase} w-[7%]`}>MCAP</th>
                  <th className={`${thBase} w-[4%] border-l border-white/5`}>STAGE</th>
                  <th className={`${thBase} w-[7%]`}>SECTOR</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-white/5">
                {filtered.length === 0 ? (
                  <tr><td colSpan={15} className="py-12 text-center text-slate-500 text-sm font-medium">{status === 'Live' ? (candidates.length > 0 ? 'No names match the current filters.' : 'No names coiling on the 10/21 right now — loose tape.') : status === 'Syncing...' ? 'Running scan…' : 'Feed unavailable — awaiting next scheduled scan.'}</td></tr>
                ) : (
                  filtered.map((row) => {
                    const isPositive = (row.changePct ?? 0) >= 0;
                    const cat = catalystOf(row);
                    const catUrl = catalystUrlOf(row);
                    const st = statOf(row);
                    const ratio = coilRatioOf(row);
                    const adr = adrOf(row);
                    const sectorText = cleanSector(row.sector, row.symbol);
                    return (
                      <React.Fragment key={row.symbol}>
                        <tr className="hover:bg-white/[0.02] transition-colors group">
                          <td className={tdBase}>
                            <div className="flex items-center justify-center gap-1.5">
                              <span title={row.name || row.symbol} className="inline-block bg-indigo-500/10 text-[#7c8bfa] text-[11px] font-bold px-1.5 py-0.5 rounded border border-indigo-500/20 cursor-help">{row.symbol}</span>
                              {row.blueDot && <BlueDot />}
                            </div>
                          </td>
                          <td className={tdBase}>
                            <span className={`inline-block whitespace-nowrap px-1.5 py-[2px] rounded text-[9px] font-bold border ${getScoreBadge(row.score)}`}>{row.score}</span>
                          </td>
                          <td className={`${tdBase} text-xs text-slate-300 font-medium whitespace-nowrap tabular-nums`}>
                            <div className="flex items-center justify-center gap-1">${row.price.toFixed(2)}{row.vwapStatus && row.vwapStatus !== 'neutral' && (<div className={`w-1.5 h-1.5 rounded-full shrink-0 ${row.vwapStatus === 'above' ? 'bg-emerald-400' : 'bg-rose-500'}`} title={`VWAP: ${row.vwapStatus}`}></div>)}</div>
                          </td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>{row.changePct != null ? `${isPositive ? '+' : ''}${row.changePct.toFixed(2)}%` : '—'}</td>
                          <td className={`${tdBase} whitespace-nowrap`}>
                            <div className="flex items-center justify-center gap-1.5">
                              <div className="flex items-center gap-0.5">
                                <span className="text-[9px] font-bold text-slate-500">10</span>
                                <div className={`w-1.5 h-1.5 rounded-full ${emaDot(above10(row))}`} title={`10 EMA: ${above10(row) == null ? 'n/a' : above10(row) ? 'above' : 'below'}`}></div>
                              </div>
                              <div className="flex items-center gap-0.5">
                                <span className="text-[9px] font-bold text-slate-500">21</span>
                                <div className={`w-1.5 h-1.5 rounded-full ${emaDot(above21(row))}`} title={`21 EMA: ${above21(row) ? 'above' : 'below'}`}></div>
                              </div>
                            </div>
                          </td>
                          <td className={`${tdBase} text-xs text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{formatNumber(row.vol)}</td>
                          <td
                            className={`${tdBase} text-xs text-slate-400 font-medium whitespace-nowrap tabular-nums`}
                            title={row.avgDollarVolM ? `Today: ${row.dVol ? formatCurrency(row.dVol) : '—'} · 20-day avg: $${row.avgDollarVolM}M (what the $VOL filter uses)` : undefined}
                          >
                            {row.dVol ? formatCurrency(row.dVol) : (row.avgDollarVolM ? `$${row.avgDollarVolM}M` : '—')}
                          </td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getRvolColor(row.rvol)}`}>{row.rvol ? `${row.rvol.toFixed(1)}x` : '—'}</td>
                          <td className={`${tdBase} whitespace-nowrap tabular-nums`} title={`10-day range${ratio != null ? ` — ${ratio.toFixed(2)}x the ${row.atrPct.toFixed(1)}% daily ATR` : ''}`}>
                            <div className={`text-xs font-bold leading-tight ${getCoilColor(row)}`}>{row.range10Pct != null ? `${row.range10Pct.toFixed(1)}%` : '—'}</div>
                            {ratio != null && (<div className="text-[9px] text-slate-500 font-medium leading-tight">{ratio.toFixed(1)}× ATR</div>)}
                          </td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getAdrColor(adr)}`} title="20-day average daily range (high/low), the anti-chop measure">
                            {adr != null ? `${adr.toFixed(1)}%` : '—'}
                          </td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getRsColor(row.rsVsSpy)}`}>{row.rsVsSpy >= 0 ? '+' : ''}{row.rsVsSpy.toFixed(1)}</td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getOffHighColor(row.pctOffHigh)}`}>{row.pctOffHigh.toFixed(1)}%</td>
                          <td className={`${tdBase} text-xs text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{formatNumber(row.mktCap)}</td>
                          <td className={`${tdBase} whitespace-nowrap border-l border-white/5`}>
                            <span className={`text-[11px] font-bold tracking-wide ${getStageColor(row.stage)}`}>{formatStageText(row.stage)}</span>
                          </td>
                          <td className={tdBase}>
                            <span title={sectorText} className="block truncate text-[10px] font-semibold tracking-wide uppercase text-slate-400">{sectorText}</span>
                          </td>
                        </tr>
                        {/* Sub-row: spacer | 10/21 HOLD + readout + catalyst | STR/STAT centered */}
                        <tr className="bg-transparent border-t border-white/5">
                          <td className="w-[8%]"></td>
                          <td colSpan={11} className="pb-2.5 pt-1.5 pr-3">
                            <div className="flex items-center text-left">
                              <span className="shrink-0 w-[104px] pr-2 text-[#7c8bfa] font-bold text-[11px] tracking-[0.08em] uppercase leading-tight">10/21 HOLD</span>
                              <p className="flex-1 text-[11px] leading-relaxed whitespace-normal border-l border-white/10 pl-3">
                                <span className="text-slate-500">{buildReadout(row)}</span>
                                {cat && (
                                  <>
                                    {' '}
                                    <span className="text-[9px] font-bold tracking-widest uppercase text-amber-400/90">News:</span>
                                    {' '}
                                    {catUrl ? (
                                      <a href={catUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-300/90 font-medium hover:text-[#7c8bfa] hover:underline transition-colors">{cat}</a>
                                    ) : (
                                      <span className="text-indigo-300/90 font-medium">{cat}</span>
                                    )}
                                  </>
                                )}
                              </p>
                            </div>
                          </td>
                          <td colSpan={3} className="pb-2.5 pt-1.5 align-middle">
                            <div className="flex items-center justify-center gap-2 border-l border-white/10 px-1 py-1">
                              <span className="flex items-center gap-1">
                                <span className="text-[10px] text-slate-500">STR:</span>
                                <span className={`text-[10px] font-semibold ${structColor(row.goldenCross)}`} title="50 SMA > 200 SMA">GC</span>
                                <span className={`text-[10px] font-semibold ${structColor(row.ema21Rising)}`} title="21 EMA rising">21↑</span>
                              </span>
                              <span className="flex items-center gap-1 whitespace-nowrap">
                                <span className="text-[10px] text-slate-500">STAT:</span>
                                {st === 'Coiled' ? (
                                  <span className="text-[10px] font-semibold text-emerald-400">Coiled</span>
                                ) : st === 'Setting Up' ? (
                                  <span className="text-[10px] font-semibold text-amber-400">Setting Up</span>
                                ) : (
                                  <span className="text-[10px] font-semibold text-slate-600">—</span>
                                )}
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
    </div>
  );
}
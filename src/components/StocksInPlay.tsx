'use client';

// StocksInPlay — v1.3
// v1.1: + RMV(15) column; CATALYST column removed (news moved to thesis line)
// v1.2: Weinstein sub-stage coloring; + CNF breakdown tooltip
// v1.3: + Money Flow (21). RVOL says volume showed up; MF says which side got
//       filled. A SIP up 6% on 4x volume with MF under 45 was sold into.

import React, { useState, useEffect, useMemo } from 'react';
import { useMarketData } from './MarketDataContext';
import { stageColor, stageShort, stageDescription } from '@/lib/indicators/stage';
import { mfColor, mfLabel, mfArrow } from '@/lib/indicators/moneyflow';

interface StockInPlay {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  vwapStatus: 'above' | 'below' | 'neutral';
  changePct: number;
  vol: number;
  dVol: number;
  rvol: number | null;
  float: number | null;
  shortPct: number | null;
  mktCap: number | null;
  stage: string;
  setupName: string | null;
  catalyst?: string | null;
  catalystUrl?: string | null;
  conviction?: number | null; 
  thesis?: string | null;     
  aboveEma10?: boolean | null;
  aboveEma21?: boolean | null;
  stochK?: number | null;
  rsVsSpy?: number | null;
  distToEma21?: number | null;
  adrPct?: number | null;
  rmv?: number | null;
  mf?: number | null;
  mfTrend?: number;
  rme?: number | null;
  rmeExtPct?: number | null;
  cnfBreakdown?: Record<string, number> | null;
  goldenCross?: boolean | null;
  ema21Rising?: boolean | null;
  status?: string | null;
}

type SortDirection = 'asc' | 'desc';
type CnfFilterType = 'All' | 'A' | 'B';
type EmaFilterType = 'All' | '>10' | '>21' | 'Both';
type VwapFilterType = 'All' | 'above' | 'below';
type AdrFilterType = 'All' | '5' | '10';

// CNF is a floor, not an exact grade: picking B shows B and A. Unset shows
// everything, which is effectively "C and above".
const CNF_BUCKETS: CnfFilterType[] = ['A', 'B'];
const CNF_MIN_SCORE: Record<'A' | 'B', number> = { A: 70, B: 50 };

// ADR buckets in percent — the scan already floors at 3%, so these tighten.
const ADR_BUCKETS: AdrFilterType[] = ['5', '10'];

// Human labels for the CNF breakdown keys the scanner ships.
const CNF_LABELS: Record<string, string> = {
  rvol: 'Relative volume',
  gap: 'Gap',
  rangeExpansion: 'Range expansion',
  relStrength: 'RS vs market',
  catalyst: 'Catalyst',
  earnings: 'Earnings proximity',
  persistence: 'Scan persistence',
  extension: 'Extension (RME)',
  vwap: 'VWAP',
  regime: 'Market regime',
  sector: 'Sector heat',
  moneyFlow: 'Money Flow',
};

const formatTime = (timestamp: number | Date) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'America/New_York' });
};

const formatNumber = (num: number | null) => {
  if (num === null || num === 0 || isNaN(num)) return '—';
  if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return num.toLocaleString();
};

const formatCurrency = (num: number | null) => {
  if (num === null || num === 0 || isNaN(num)) return '—';
  if (num >= 1e9) return '$' + (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return '$' + (num / 1e6).toFixed(1) + 'M';
  return '$' + num.toLocaleString();
};

const formatSetupName = (name: string | null) => {
  if (!name || name === '-' || name === '—') return '—';
  if (name.includes('BB SQZ')) return 'BB SQZ';
  if (name === 'Blue Dot Rev') return 'BD Rev';
  return name;
};

// Blue Dot Reversal renders as the dot itself rather than a text label.
const isBlueDotSetup = (name: string | null | undefined): boolean => {
  if (!name) return false;
  const n = String(name).toLowerCase();
  return n === 'blue dot rev' || n.includes('blue dot') || n.includes('bd rev');
};

const BlueDot = ({ className = '' }: { className?: string }) => (
  <span
    title="Blue Dot Reversal"
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
  // Generic fallback: any leading 1-5 char all-caps token followed by a dash
  s = s.replace(/^[A-Z]{1,5}\s*[-–—:]\s*/, '');
  return s.trim() || '—';
};

// Fallback labels the backend uses when there's no real headline.
const isGenericCatalyst = (catalyst: string | null | undefined) => {
  if (!catalyst) return true;
  const c = catalyst.toLowerCase().trim();
  return c.startsWith('technical momentum') || c === 'recent news' || c === 'news' || c === 'technical';
};

// Catalyst TAG — the classified bucket ("Earnings", "M&A", "Contract").
const catalystTagOf = (row: StockInPlay): string | null => {
  if (isGenericCatalyst(row.catalyst)) return null;
  const cat = String(row.catalyst).trim().replace(/\.$/, '');
  return cat || null;
};

// Catalyst HEADLINE — the actual news sentence. This is the whole thesis line
// now; the backend sends null here when the move has no news behind it.
const headlineOf = (row: StockInPlay): string | null => {
  if (!row.thesis) return null;
  const s = String(row.thesis).trim();
  return s.length > 0 ? s : null;
};

const adrOf = (row: StockInPlay): number | null => {
  if (row.adrPct == null || isNaN(Number(row.adrPct))) return null;
  return Number(row.adrPct);
};

// RMV — where today's volatility sits inside its own 15-bar range.
// 0 = tightest of the window, 100 = most expanded.
const rmvOf = (row: StockInPlay): number | null => {
  if (row.rmv == null || isNaN(Number(row.rmv))) return null;
  return Number(row.rmv);
};

// Money Flow (21) — accumulation vs distribution. RVOL says volume showed up;
// MF says which side got filled.
const mfOf = (row: StockInPlay): number | null => {
  if (row.mf == null || isNaN(Number(row.mf))) return null;
  return Number(row.mf);
};

// RME — where price sits vs this stock's OWN history of extension from the
// 21 EMA. -100..+100. Feeds CNF; surfaced on the badge tooltip.
const rmeOf = (row: StockInPlay): number | null => {
  if (row.rme == null || isNaN(Number(row.rme))) return null;
  return Number(row.rme);
};

const rmeLabel = (rme: number | null): string => {
  if (rme == null) return 'n/a';
  if (rme >= 90) return 'at historical extension high';
  if (rme >= 75) return 'heavily extended';
  if (rme >= 60) return 'extended';
  if (rme >= 25) return 'moderately above anchor';
  if (rme > -25) return 'near anchor';
  if (rme > -60) return 'moderately below anchor';
  if (rme > -85) return 'deeply below anchor';
  return 'at historical extension low';
};

// Full CNF explanation for the badge tooltip. Non-zero components only,
// biggest contributors first, so the reason for a score is one hover away.
const cnfTooltip = (row: StockInPlay): string => {
  const score = row.conviction;
  const lines: string[] = [
    score != null ? `CNF ${score} — ${score >= 70 ? 'A' : score >= 50 ? 'B' : 'C'}` : 'CNF — not scored',
  ];

  const bd = row.cnfBreakdown;
  if (bd && typeof bd === 'object') {
    const entries = Object.entries(bd)
      .filter(([, v]) => typeof v === 'number' && v !== 0)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    if (entries.length > 0) {
      lines.push('');
      for (const [k, v] of entries) {
        const label = CNF_LABELS[k] || k;
        lines.push(`${v > 0 ? '+' : ''}${v}  ${label}`);
      }
    }
  }

  const rme = rmeOf(row);
  if (rme != null) {
    lines.push('');
    lines.push(`RME ${rme > 0 ? '+' : ''}${rme.toFixed(0)} — ${rmeLabel(rme)}`);
    if (row.rmeExtPct != null) {
      lines.push(`(${row.rmeExtPct >= 0 ? '+' : ''}${row.rmeExtPct.toFixed(1)}% from the 21 EMA)`);
    }
  }

  return lines.join('\n');
};

// Status: prefer the backend field; derive from the raw metrics when the KV
// payload predates it (Ready = stoch <= 25 and within 2.5% of the 21 EMA).
const rowStatus = (row: StockInPlay): 'Ready' | 'Forming' | null => {
  if (row.status === 'Ready' || row.status === 'Forming') return row.status;
  if (row.stochK != null && row.distToEma21 != null) {
    return (row.stochK <= 25 && Math.abs(row.distToEma21) <= 2.5) ? 'Ready' : 'Forming';
  }
  return null;
};

export default function StocksInPlay() {
  const { session } = useMarketData(); 
  const [stocks, setStocks] = useState<StockInPlay[]>([]);
  const [status, setStatus] = useState<string>('Syncing DB...');
  const [lastScanTime, setLastScanTime] = useState<number | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: keyof StockInPlay; direction: SortDirection } | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [showStage2Only, setShowStage2Only] = useState<boolean>(false); 
  const [marketCapFilter, setMarketCapFilter] = useState<string>('All'); 
  const [cnfFilter, setCnfFilter] = useState<CnfFilterType>('All');
  const [emaFilter, setEmaFilter] = useState<EmaFilterType>('All');
  const [adrFilter, setAdrFilter] = useState<AdrFilterType>('All');
  const [vwapFilter, setVwapFilter] = useState<VwapFilterType>('All');
  const [showFilters, setShowFilters] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    const fetchDatabaseSnapshot = async () => {
      try {
        const res = await fetch(`/api/scanner/latest?t=${Date.now()}`, { cache: 'no-store' });
        const data = await res.json();
        
        if (isMounted && data.success) {
          const rawList = data.stocksInPlay || [];
          const safeData = rawList.map((item: any) => {
            // Thesis is the news headline verbatim, or nothing. No synthesized
            // sentence from the tag — an invented thesis reads like signal.
            const rawThesis = item.thesis || item.aiThesis || item.analysis || item.reasoning || null;
            return {
              ticker: item.ticker || '—',
              name: item.name || '',
              sector: item.sector && item.sector !== '—' ? item.sector : '—',
              price: Number(item.price) || 0,
              vwapStatus: item.vwapStatus || 'neutral',
              changePct: Number((item.change ?? item.changePct) || 0),
              vol: Number((item.volume ?? item.vol) || 0),
              dVol: Number(item.dVol) || (Number(item.price || 0) * Number((item.volume ?? item.vol) || 0)),
              rvol: item.rvol || null,
              float: item.float || null,
              shortPct: item.shortPct || null,
              mktCap: item.mktCap || null,
              stage: item.stage || '—',
              setupName: item.setupName || null,
              catalyst: item.catalyst || null,
              catalystUrl: item.catalystUrl || null,
              conviction: item.conviction != null ? Number(item.conviction) : ((item.cnfScore ?? item.smbScore ?? item.aiScore ?? item.score) ?? null), 
              thesis: rawThesis,
              aboveEma10: item.aboveEma10 ?? null,
              aboveEma21: item.aboveEma21 ?? null,
              stochK: item.stochK ?? null,
              rsVsSpy: item.rsVsSpy ?? null,
              distToEma21: item.distToEma21 ?? null,
              adrPct: item.adrPct ?? null,
              rmv: item.rmv ?? null,
              mf: item.mf ?? null,
              mfTrend: item.mfTrend ?? 0,
              rme: item.rme ?? null,
              rmeExtPct: item.rmeExtPct ?? null,
              cnfBreakdown: item.cnfBreakdown ?? null,
              goldenCross: item.goldenCross ?? null,
              ema21Rising: item.ema21Rising ?? null,
              status: item.status ?? null,
            };
          });
          setStocks(safeData);
          setLastScanTime(data.lastScanTime || Date.now()); 
          setStatus('Live');
        }
      } catch (error) {
        if (isMounted) setStatus('DB Offline');
      }
    };
    fetchDatabaseSnapshot();
    const interval = setInterval(fetchDatabaseSnapshot, 60000);
    return () => { isMounted = false; clearInterval(interval); };
  }, []);

  const handleSort = (key: keyof StockInPlay) => {
    let direction: SortDirection = 'desc'; 
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') direction = 'asc';
    else if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') { setSortConfig(null); return; }
    setSortConfig({ key, direction });
  };

  // Clicking the active option clears back to All (toggle behavior)
  const handleCnfFilter = (val: CnfFilterType) => setCnfFilter(prev => prev === val ? 'All' : val);
  const handleEmaFilter = (val: EmaFilterType) => setEmaFilter(prev => prev === val ? 'All' : val);
  const handleAdrFilter = (val: AdrFilterType) => setAdrFilter(prev => prev === val ? 'All' : val);
  const handleVwapFilter = (val: VwapFilterType) => setVwapFilter(prev => prev === val ? 'All' : val);

  const filteredAndSortedStocks = useMemo(() => {
    let filtered = stocks.filter(s => s.changePct >= 4.0 && s.vol >= 500000 && s.mktCap !== null && s.mktCap >= 20000000);
    // Stage 2 filter matches any sub-stage — 2A, 2B and 2C are all Stage 2.
    if (showStage2Only) filtered = filtered.filter(s => stageShort(s.stage).startsWith('2'));
    if (marketCapFilter !== 'All') {
      filtered = filtered.filter(s => {
        const mc = s.mktCap;
        if (!mc) return true; 
        if (marketCapFilter === 'Large') return mc >= 2e9;
        if (marketCapFilter === 'Small') return mc < 2e9;
        return true;
      });
    }
    // CNF is "grade and above": B keeps both B and A.
    if (cnfFilter !== 'All') {
      const minScore = CNF_MIN_SCORE[cnfFilter];
      filtered = filtered.filter(s => (s.conviction ?? -1) >= minScore);
    }
    if (emaFilter !== 'All') {
      filtered = filtered.filter(s => {
        if (emaFilter === '>10') return s.aboveEma10 === true;
        if (emaFilter === '>21') return s.aboveEma21 === true;
        if (emaFilter === 'Both') return s.aboveEma10 === true && s.aboveEma21 === true;
        return true;
      });
    }
    // ADR buckets are "and above" on the 20-day average daily range.
    if (adrFilter !== 'All') {
      const minAdr = Number(adrFilter);
      filtered = filtered.filter(s => {
        const a = adrOf(s);
        return a != null && a >= minAdr;
      });
    }
    if (vwapFilter !== 'All') {
      filtered = filtered.filter(s => s.vwapStatus === vwapFilter);
    }
    if (!sortConfig) return filtered;
    return [...filtered].sort((a, b) => {
      const aVal = a[sortConfig.key] as any;
      const bVal = b[sortConfig.key] as any;
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [stocks, sortConfig, showStage2Only, marketCapFilter, cnfFilter, emaFilter, adrFilter, vwapFilter]);

  // Copy the visible tickers, comma-separated — TradingView's watchlist
  // import format. Respects whatever filters are active.
  const handleCopyTickers = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const tickers = filteredAndSortedStocks.map(s => s.ticker).join(',');
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

  const getSortIcon = (columnKey: keyof StockInPlay) => sortConfig?.key === columnKey ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓') : '';

  const getRvolColor = (rvol: number | null) => {
    if (!rvol) return 'text-slate-500';
    if (rvol >= 2) return 'text-amber-400';
    if (rvol >= 1.5) return 'text-emerald-400';
    return 'text-slate-500';
  };
  // ADR — more daily range means more to capture once it moves.
  const getAdrColor = (a: number | null) => {
    if (a == null) return 'text-slate-500';
    if (a >= 10) return 'text-purple-400';
    if (a >= 5) return 'text-emerald-400';
    if (a >= 3) return 'text-slate-300';
    return 'text-slate-500';
  };
  // RMV — inverted scale: low is tight, high is expanded. Note this runs
  // opposite to ADR, and on a gapping SIP name a HIGH reading is expected —
  // it's confirmation the range actually expanded today, not a warning.
  const getRmvColor = (r: number | null) => {
    if (r == null) return 'text-slate-500';
    if (r <= 10) return 'text-emerald-400';
    if (r <= 25) return 'text-lime-400';
    if (r <= 45) return 'text-yellow-400';
    if (r <= 65) return 'text-amber-400';
    if (r <= 80) return 'text-orange-400';
    return 'text-rose-400';
  };
  const getFloatColor = (float: number | null) => {
    if (!float) return 'text-slate-500';
    if (float <= 20000000) return 'text-purple-400'; 
    if (float <= 50000000) return 'text-emerald-400';
    return 'text-slate-300';
  };
  const getShortColor = (short: number | null) => {
    if (!short) return 'text-slate-500';
    if (short >= 20) return 'text-purple-400'; 
    if (short >= 10) return 'text-emerald-400';
    return 'text-slate-300';
  };

  const getStochColor = (k: number | null | undefined) => {
    if (k == null) return 'text-slate-500';
    if (k <= 20) return 'text-purple-400';
    if (k <= 30) return 'text-emerald-400';
    return 'text-slate-400';
  };

  const getRsColor = (rs: number | null | undefined) => {
    if (rs == null) return 'text-slate-500';
    if (rs >= 20) return 'text-purple-400';
    if (rs >= 10) return 'text-emerald-400';
    if (rs >= 0) return 'text-slate-300';
    return 'text-rose-400';
  };

  // CNF-graded score badge: green = A (>=70), amber = B (>=50), gray = C
  const getScoreBadge = (score: number | null | undefined) => {
    if (score == null) return 'bg-white/[0.02] text-slate-600 border-white/5';
    if (score >= 70) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    if (score >= 50) return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    return 'bg-zinc-800/50 text-zinc-400 border-zinc-700/50';
  };

  const emaDot = (state: boolean | null | undefined) => {
    if (state === null || state === undefined) return 'bg-slate-600';
    return state ? 'bg-emerald-400' : 'bg-rose-500';
  };

  // STR data color: emerald = true, rose = false, dim gray = unknown
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
  const thBase = "px-1 py-2.5 text-[10px] text-slate-500 font-bold tracking-wide leading-tight cursor-pointer hover:text-slate-300 transition-colors text-center";
  const tdBase = "px-1 pt-2.5 pb-1.5 text-center";
  const filterBtnActive = "bg-[#1e293b] text-indigo-400 border border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.1)]";
  const filterBtnIdle = "text-slate-500 border border-transparent hover:text-slate-300 hover:bg-white/[0.02]";
  // Filter pills — matched to the Filter: 2 button (same height, font, tracking)
  const pillWrap = "flex items-center gap-3 px-4 py-1 bg-[#161c2a] border border-white/5 rounded-lg shrink-0";
  const pillLabel = "text-[11px] font-bold tracking-widest uppercase text-slate-400";
  const pillBtn = "px-3 py-1 rounded-lg text-[11px] font-bold tracking-widest uppercase transition-all duration-300 whitespace-nowrap";

  const activeFilterCount =
    (showStage2Only ? 1 : 0) +
    (marketCapFilter !== 'All' ? 1 : 0) +
    (cnfFilter !== 'All' ? 1 : 0) +
    (emaFilter !== 'All' ? 1 : 0) +
    (adrFilter !== 'All' ? 1 : 0) +
    (vwapFilter !== 'All' ? 1 : 0);

  return (
    <div className="bg-[#101623] border border-white/5 rounded-2xl p-3 md:p-5 relative overflow-hidden shadow-xl w-full max-w-[1280px] mx-auto">
      <div onClick={() => setIsExpanded(!isExpanded)} className={`flex justify-between items-center relative z-10 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-5 border-b border-white/5 pb-4' : ''}`}>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs md:text-sm font-bold text-[#7c8bfa] bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 group-hover:bg-white/[0.02] transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
            STOCKS IN PLAY
          </span>
          {filteredAndSortedStocks.length > 0 && (
            <button
              onClick={handleCopyTickers}
              title={`Copy ${filteredAndSortedStocks.length} ticker${filteredAndSortedStocks.length !== 1 ? 's' : ''} for TradingView`}
              className={`text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded border transition-all duration-200 ${
                copied
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-[#161c2a] text-slate-400 border-white/5 hover:text-slate-200 hover:bg-white/[0.04]'
              }`}
            >
              {copied ? `✓ Copied ${filteredAndSortedStocks.length}` : `Copy ${filteredAndSortedStocks.length}`}
            </button>
          )}
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-center justify-center border border-white/5 bg-[#161c2a]/40 px-4 py-1.5 rounded-[10px] min-w-[120px]">
            <span className={`text-[10px] font-bold tracking-widest uppercase ${getSessionTextColor()}`}>{displaySession}</span>
          </div>
          {lastScanTime && (<span className="text-[11px] text-slate-400/80 font-medium px-1 tracking-wide">Updated: {formatTime(lastScanTime)} EST</span>)}
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
                    <button
                      onClick={() => setShowStage2Only(!showStage2Only)}
                      title="Stage 2 only — includes 2A, 2B and 2C"
                      className={`${pillBtn} ${showStage2Only ? filterBtnActive : filterBtnIdle}`}
                    >
                      2
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
            <table className="w-full min-w-[1160px] table-fixed border-collapse">
              <thead>
                <tr className="border-b border-white/5 select-none">
                  <th className={`${thBase} w-[7%]`} onClick={() => handleSort('ticker')}>TICKER{getSortIcon('ticker')}</th>
                  <th className={`${thBase} w-[4%]`} onClick={() => handleSort('conviction')}>CNF{getSortIcon('conviction')}</th>
                  <th className={`${thBase} w-[7%]`} onClick={() => handleSort('price')}>PRICE{getSortIcon('price')}</th>
                  <th className={`${thBase} w-[6%]`} onClick={() => handleSort('changePct')}>CHG%{getSortIcon('changePct')}</th>
                  <th className={`${thBase} w-[6%]`}>10/21</th>
                  <th className={`${thBase} w-[6%]`} onClick={() => handleSort('vol')}>VOL{getSortIcon('vol')}</th>
                  <th className={`${thBase} w-[7%]`} onClick={() => handleSort('dVol')}>$VOL{getSortIcon('dVol')}</th>
                  <th className={`${thBase} w-[5%]`} onClick={() => handleSort('rvol')}>RVOL{getSortIcon('rvol')}</th>
                  <th className={`${thBase} w-[5%]`} onClick={() => handleSort('float')}>FLOAT{getSortIcon('float')}</th>
                  <th className={`${thBase} w-[6%]`} onClick={() => handleSort('adrPct')}>ADR{getSortIcon('adrPct')}</th>
                  <th className={`${thBase} w-[5%]`} onClick={() => handleSort('rmv')}>RMV{getSortIcon('rmv')}</th>
                  <th className={`${thBase} w-[4%]`} onClick={() => handleSort('mf')}>MF{getSortIcon('mf')}</th>
                  <th className={`${thBase} w-[6%]`} onClick={() => handleSort('rsVsSpy')}>RS/SPY{getSortIcon('rsVsSpy')}</th>
                  <th className={`${thBase} w-[5%]`} onClick={() => handleSort('stochK')}>STOCH{getSortIcon('stochK')}</th>
                  <th className={`${thBase} w-[5%]`} onClick={() => handleSort('shortPct')}>SHT%{getSortIcon('shortPct')}</th>
                  <th className={`${thBase} w-[6%]`} onClick={() => handleSort('mktCap')}>MCAP{getSortIcon('mktCap')}</th>
                  <th className={`${thBase} w-[5%] border-l border-white/5`} onClick={() => handleSort('stage')}>STAGE{getSortIcon('stage')}</th>
                  <th className={`${thBase} w-[5%]`} onClick={() => handleSort('sector')}>SECTOR{getSortIcon('sector')}</th>
                </tr>
              </thead>
              
              <tbody className="divide-y divide-white/5">
                {filteredAndSortedStocks.length === 0 ? (
                  <tr><td colSpan={18} className="py-12 text-center text-slate-500 text-sm font-medium">{stocks.length > 0 ? 'No names match the current filters.' : 'No tracking instruments currently found matching criteria.'}</td></tr>
                ) : (
                  filteredAndSortedStocks.map((row, i) => {
                    const isPositive = row.changePct >= 0;
                    const st = rowStatus(row);
                    const tag = catalystTagOf(row);
                    const headline = headlineOf(row);
                    const sectorText = cleanSector(row.sector, row.ticker);
                    const bdRev = isBlueDotSetup(row.setupName);
                    const adr = adrOf(row);
                    const rmv = rmvOf(row);
                    const mf = mfOf(row);
                    return (
                      <React.Fragment key={i}>
                        <tr className="hover:bg-white/[0.02] transition-colors group">
                          <td className={tdBase}>
                            <span title={row.name || row.ticker} className="inline-block bg-indigo-500/10 text-[#7c8bfa] text-[11px] font-bold px-1.5 py-0.5 rounded border border-indigo-500/20 cursor-help">{row.ticker}</span>
                          </td>
                          <td className={tdBase}>
                            <span
                              title={cnfTooltip(row)}
                              className={`inline-block whitespace-nowrap px-1.5 py-[2px] rounded text-[9px] font-bold border cursor-help ${getScoreBadge(row.conviction)}`}
                            >
                              {row.conviction != null ? row.conviction : '--'}
                            </span>
                          </td>
                          <td className={`${tdBase} text-xs text-slate-300 font-medium whitespace-nowrap tabular-nums`}>
                            <div className="flex items-center justify-center gap-1">${row.price.toFixed(2)}{row.vwapStatus !== 'neutral' && (<div className={`w-1.5 h-1.5 rounded-full shrink-0 ${row.vwapStatus === 'above' ? 'bg-emerald-400' : 'bg-rose-500'}`} title={`VWAP: ${row.vwapStatus}`}></div>)}</div>
                          </td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>{isPositive ? '+' : ''}{row.changePct.toFixed(2)}%</td>
                          <td className={`${tdBase} whitespace-nowrap`}>
                            <div className="flex items-center justify-center gap-1.5">
                              <div className="flex items-center gap-0.5">
                                <span className="text-[9px] font-bold text-slate-500">10</span>
                                <div className={`w-1.5 h-1.5 rounded-full ${emaDot(row.aboveEma10)}`} title={`10 EMA: ${row.aboveEma10 == null ? 'n/a' : row.aboveEma10 ? 'above' : 'below'}`}></div>
                              </div>
                              <div className="flex items-center gap-0.5">
                                <span className="text-[9px] font-bold text-slate-500">21</span>
                                <div className={`w-1.5 h-1.5 rounded-full ${emaDot(row.aboveEma21)}`} title={`21 EMA: ${row.aboveEma21 == null ? 'n/a' : row.aboveEma21 ? 'above' : 'below'}`}></div>
                              </div>
                            </div>
                          </td>
                          <td className={`${tdBase} text-xs text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{formatNumber(row.vol)}</td>
                          <td className={`${tdBase} text-xs text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{formatCurrency(row.dVol)}</td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getRvolColor(row.rvol)}`}>{row.rvol ? `${row.rvol.toFixed(1)}x` : '—'}</td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getFloatColor(row.float)}`}>{formatNumber(row.float)}</td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getAdrColor(adr)}`} title="20-day average daily range (high/low) — the anti-chop measure">
                            {adr != null ? `${adr.toFixed(1)}%` : '—'}
                          </td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getRmvColor(rmv)}`} title="RMV(15) — 0 = tightest price action of the last 15 bars, 100 = most volatile. Low is coiled.">
                            {rmv != null ? rmv.toFixed(0) : '—'}
                          </td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${mfColor(mf)}`} title={`Money Flow (21) — ${mfLabel(mf)}. Above 50 is accumulation, below is distribution. Arrow shows the 5-day direction.`}>
                            {mf != null ? `${mf.toFixed(0)}${mfArrow(row.mfTrend ?? 0)}` : '—'}
                          </td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getRsColor(row.rsVsSpy)}`}>{row.rsVsSpy != null ? `${row.rsVsSpy >= 0 ? '+' : ''}${row.rsVsSpy.toFixed(1)}` : '—'}</td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getStochColor(row.stochK)}`}>{row.stochK != null ? row.stochK.toFixed(1) : '—'}</td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getShortColor(row.shortPct)}`}>{row.shortPct ? `${row.shortPct.toFixed(1)}%` : '—'}</td>
                          <td className={`${tdBase} text-xs text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{formatNumber(row.mktCap)}</td>
                          <td className={`${tdBase} whitespace-nowrap border-l border-white/5`}>
                            <span
                              title={stageDescription(row.stage)}
                              className={`text-[11px] font-bold tracking-wide cursor-help ${stageColor(row.stage)}`}
                            >
                              {stageShort(row.stage)}
                            </span>
                          </td>
                          <td className={tdBase}>
                            <span title={sectorText} className="block truncate text-[10px] font-semibold tracking-wide uppercase text-slate-400">{sectorText}</span>
                          </td>
                        </tr>
                        {/* Sub-row: spacer | setup label + news catalyst | STR/STAT centered */}
                        <tr className="bg-transparent border-t border-white/5">
                          <td className="w-[7%]"></td>
                          <td colSpan={15} className="pb-2.5 pt-1.5 pr-3">
                            <div className="flex items-center text-left">
                              <span className="shrink-0 w-[104px] pr-2 text-[#7c8bfa] font-bold text-[11px] tracking-[0.08em] uppercase leading-tight">
                                {bdRev ? <BlueDot /> : (formatSetupName(row.setupName) !== '—' ? formatSetupName(row.setupName) : '—')}
                              </span>
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
                                  <span className="text-slate-600 italic">No news catalyst — technical setup only.</span>
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
                                <span className="text-[10px] text-slate-500">STAT:</span>
                                {st === 'Ready' ? (
                                  <span className="text-[10px] font-semibold text-emerald-400">Ready</span>
                                ) : st === 'Forming' ? (
                                  <span className="text-[10px] font-semibold text-amber-400">Forming</span>
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
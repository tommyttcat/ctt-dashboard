'use client';

// Consolidation1021 — v2.0
// Full parity with SIPs v2.8 / Daily v1.9 / Swing v1.6. Shared: STATE chip
// (RMV column removed), DTC (was SHT%), RS via formatRs w/ 1k% compaction,
// MetricsKey ? + tooltips, header z-30 hover fix, SECTOR left-aligned, STAGE
// left 9px, min-w 880, px-0.5, overflow-visible, SIPs column widths, zinc-400
// chips.
// Consol-only kept: ConsolidationCandidate shape + consolidation endpoint,
// COIL column (raw % over N× ATR ratio) — %OFF HI dropped, STR (GC/21↑) and
// STAT (Coiled/Setting Up) sub-row cells, CONSOL_META.

import React, { useState, useEffect, useMemo } from 'react';
import { useMarketData } from './MarketDataContext';
import { stageColor, stageShort, stageDescription } from '@/lib/indicators/stage';
import { mfColor, mfLabel, mfArrow } from '@/lib/indicators/moneyflow';
import { stateOf, stateTooltip, stateLegend } from '@/lib/indicators/state';
import { CONSOL_META, COLUMN_NOTES } from '@/lib/scanConfig';
import MetricsKey from './MetricsKey';

const FALLBACK_NOTES: Record<string, { what: string; colour?: string }> = {
  TICKER: { what: 'Symbol. Hover shows the company name.' },
  CNF: {
    what: 'Confluence score 0–100 — how many independent factors line up: RVOL, gap, range expansion, RS, catalyst quality, persistence, VWAP, regime, sector heat. Hover the badge for the per-row breakdown.',
    colour: 'Green 70+ (A) · amber 50+ (B) · grey below (C).',
  },
  PRICE: {
    what: 'Last price. The dot beside it is VWAP position.',
    colour: 'Green dot above VWAP · red dot below.',
  },
  'CHG%': {
    what: 'Change vs prior close.',
    colour: 'Green up · red down.',
  },
  '10/21': {
    what: 'Price vs the 10 and 21 EMAs — the Dr. Wish trend pair.',
    colour: 'Green dot above that EMA · red below · grey no data.',
  },
  VOL: { what: 'Shares traded today.' },
  '$VOL': { what: 'Dollar volume — price × volume.' },
  RVOL: {
    what: 'Relative volume vs the 20-day average at this time of day.',
    colour: 'Amber 2x+ · green 1.5x+ · grey below.',
  },
  COIL: {
    what: 'Tightness of the last 10 days: raw 10-day range % on top, and below it that range normalized by daily ATR (N× ATR). Lower is tighter. Coiled ≤ 2.5× · Setting Up ≤ 4.0×.',
    colour: 'Purple ≤2.5× (coiled) · green ≤4× (setting up) · grey looser.',
  },
  ADR: {
    what: '20-day average daily range. The anti-chop gate — scan floor is 3%.',
    colour: 'Purple 10%+ · green 5%+ · grey at the floor.',
  },
  MF: {
    what: 'Money Flow (21) — volume-weighted accumulation vs distribution, 0–100. Arrow shows the bar-over-bar trend.',
    colour: 'Green high (accumulation) · red low (distribution).',
  },
  RS: {
    what: 'Relative strength vs SPY over three months, in percentage points.',
    colour: 'Purple +20 · green +10 · grey positive · red negative.',
  },
  STOCH: {
    what: 'Stochastic %K (10). Low readings near a rising 21 EMA are the Blue Dot precondition.',
    colour: 'Purple ≤20 · green ≤30 · grey above.',
  },
  DTC: {
    what: 'Days to cover — sessions of normal volume for shorts to exit. Above 5 is trapped supply that has to buy at some point.',
    colour: 'Purple 5+ · green 3+ · grey below.',
  },
  MCAP: { what: 'Market cap.' },
  STAGE: {
    what: 'Weinstein stage with sub-stage. 2A strong advance · 2B extended · 2C sagging below the 50 SMA. Hover the value for the row-specific read.',
    colour: 'Green healthy Stage 2 · amber sagging · red Stage 4.',
  },
  SECTOR: { what: 'Sector, cleaned of ticker prefixes.' },
};

const colTip = (key: string): string | undefined => {
  const n = COLUMN_NOTES?.[key] ?? FALLBACK_NOTES[key];
  if (!n) return undefined;
  return n.colour ? `${n.what}\n\n${n.colour}` : n.what;
};

interface ConsolidationCandidate {
  symbol: string;
  name?: string;
  sector?: string;
  price: number;
  score: number;
  changePct?: number;
  vol?: number;
  dVol?: number;
  rvol?: number | null;
  daysToCover?: number | null;
  mktCap?: number | null;
  stage?: string;
  vwapStatus?: 'above' | 'below' | 'neutral';
  atrPct?: number;
  adrPct?: number | null;
  range10Pct?: number | null;
  coilRatio?: number | null;
  rmv?: number | null;
  mf?: number | null;
  mfTrend?: number;
  rme?: number | null;
  rmeExtPct?: number | null;
  distToEma21?: number;
  distToEma10?: number;
  aboveEma10?: boolean;
  aboveEma21?: boolean;
  stochK?: number;
  rsVsSpy?: number;
  avgDollarVolM?: number;
  goldenCross?: boolean;
  ema21Rising?: boolean;
  blueDot?: boolean;
  setupName?: string | null;
  catalyst?: string | null;
  catalystUrl?: string | null;
  cnfBreakdown?: Record<string, number> | null;
  thesis?: string | null;
  news?: string | null;
  newsUrl?: string | null;
  headline?: string | null;
}

type SortDirection = 'asc' | 'desc';
type CnfFilterType = 'All' | 'A' | 'B';
type EmaFilterType = 'All' | '>10' | '>21' | 'Both';
type VwapFilterType = 'All' | 'above' | 'below';
type AdrFilterType = 'All' | '5' | '10';
type StatFilterType = 'All' | 'Coiled' | 'Setting Up';
type VolFilterType = 'All' | '20' | '50' | '100';

const CNF_BUCKETS: CnfFilterType[] = ['A', 'B'];
const CNF_MIN_SCORE: Record<'A' | 'B', number> = { A: 70, B: 50 };
const ADR_BUCKETS: AdrFilterType[] = ['5', '10'];
const VOL_BUCKETS: VolFilterType[] = ['20', '50', '100'];

// Coil thresholds — ATR-normalized. Coiled ≤ 2.5×, Setting Up ≤ 4.0×.
const COIL_COILED_MAX = 2.5;
const COIL_SETTING_MAX = 4.0;

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
  coil: 'Coil tightness',
};

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

const formatRs = (rs: number | null | undefined): string => {
  if (rs == null || isNaN(Number(rs))) return '—';
  const v = Number(rs);
  const sign = v >= 0 ? '+' : '-';
  const abs = Math.abs(v);
  if (abs >= 1000) {
    const k = abs / 1000;
    const s = k >= 10
      ? Math.round(k).toString()
      : (Math.round(k * 10) / 10).toString().replace(/\.0$/, '');
    return `${sign}${s}k%`;
  }
  return `${sign}${Math.round(abs)}%`;
};

const statePair = (rmv: number | null, rme: number | null): string => {
  const v = rmv == null ? '—' : String(Math.round(rmv));
  const e = rme == null ? '—' : String(Math.round(rme));
  return `${v}/${e}`;
};

const isBlueDotSetup = (name: string | null | undefined): boolean => {
  if (!name) return false;
  const n = String(name).toLowerCase();
  return n === 'blue dot rev' || n.includes('blue dot') || n.includes('bd rev');
};

const BlueDot = ({ className = '' }: { className?: string }) => (
  <span
    title="Blue Dot — oversold stoch reset firing on the daily"
    className={`inline-block w-1.5 h-1.5 rounded-full bg-sky-400 shadow-[0_0_5px_rgba(56,189,248,0.6)] align-middle shrink-0 ${className}`}
  />
);

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

const catalystTagOf = (c: ConsolidationCandidate): string | null => {
  if (isGenericCatalyst(c.catalyst)) return null;
  return String(c.catalyst).trim().replace(/\.$/, '') || null;
};

const headlineOf = (c: ConsolidationCandidate): string | null => {
  const raw = c.thesis ?? c.news ?? c.headline ?? null;
  if (!raw) return null;
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
};

const catalystUrlOf = (c: ConsolidationCandidate): string | null => c.catalystUrl ?? c.newsUrl ?? null;

const adrOf = (c: ConsolidationCandidate): number | null => {
  if (c.adrPct == null || isNaN(Number(c.adrPct))) return null;
  return Number(c.adrPct);
};

const mfOf = (c: ConsolidationCandidate): number | null => {
  if (c.mf == null || isNaN(Number(c.mf))) return null;
  return Number(c.mf);
};

const rmeOf = (c: ConsolidationCandidate): number | null => {
  if (c.rme == null || isNaN(Number(c.rme))) return null;
  return Number(c.rme);
};

const rmvOf = (c: ConsolidationCandidate): number | null => {
  if (c.rmv == null || isNaN(Number(c.rmv))) return null;
  return Number(c.rmv);
};

const coilRatioOf = (c: ConsolidationCandidate): number | null => {
  if (c.coilRatio == null || isNaN(Number(c.coilRatio))) return null;
  return Number(c.coilRatio);
};

const range10Of = (c: ConsolidationCandidate): number | null => {
  if (c.range10Pct == null || isNaN(Number(c.range10Pct))) return null;
  return Number(c.range10Pct);
};

const coilStat = (c: ConsolidationCandidate): 'Coiled' | 'Setting Up' | null => {
  const r = coilRatioOf(c);
  if (r == null) return null;
  if (r <= COIL_COILED_MAX) return 'Coiled';
  if (r <= COIL_SETTING_MAX) return 'Setting Up';
  return null;
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

const cnfTooltip = (c: ConsolidationCandidate): string => {
  const score = c.score;
  const lines: string[] = [
    score != null ? `CNF ${score} — ${score >= 70 ? 'A' : score >= 50 ? 'B' : 'C'}` : 'CNF — not scored',
  ];

  const bd = c.cnfBreakdown;
  if (bd && typeof bd === 'object') {
    const entries = Object.entries(bd)
      .filter(([, v]) => typeof v === 'number' && v !== 0)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    if (entries.length > 0) {
      lines.push('');
      for (const [k, v] of entries) {
        lines.push(`${v > 0 ? '+' : ''}${v}  ${CNF_LABELS[k] || k}`);
      }
    }
  }

  const rme = rmeOf(c);
  if (rme != null) {
    lines.push('');
    lines.push(`RME ${rme > 0 ? '+' : ''}${rme.toFixed(0)} — ${rmeLabel(rme)}`);
    if (c.rmeExtPct != null) {
      lines.push(`(${c.rmeExtPct >= 0 ? '+' : ''}${c.rmeExtPct.toFixed(1)}% from the 21 EMA)`);
    }
  }

  return lines.join('\n');
};

const above21 = (c: ConsolidationCandidate) => c.aboveEma21 ?? (c.distToEma21 != null ? c.distToEma21 >= 0 : null);
const above10 = (c: ConsolidationCandidate) => c.aboveEma10 ?? (c.distToEma10 != null ? c.distToEma10 >= 0 : null);

export default function Consolidation1021() {
  const { session } = useMarketData();

  const [candidates, setCandidates] = useState<ConsolidationCandidate[]>([]);
  const [status, setStatus] = useState<string>('Syncing...');
  const [generatedAt, setGeneratedAt] = useState<number | null>(null);
  const [scanMeta, setScanMeta] = useState<any>(null);
  const [sortConfig, setSortConfig] = useState<{ key: keyof ConsolidationCandidate; direction: SortDirection } | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [showStage2Only, setShowStage2Only] = useState<boolean>(false);
  const [marketCapFilter, setMarketCapFilter] = useState<string>('All');
  const [cnfFilter, setCnfFilter] = useState<CnfFilterType>('All');
  const [emaFilter, setEmaFilter] = useState<EmaFilterType>('All');
  const [adrFilter, setAdrFilter] = useState<AdrFilterType>('All');
  const [vwapFilter, setVwapFilter] = useState<VwapFilterType>('All');
  const [statFilter, setStatFilter] = useState<StatFilterType>('All');
  const [volFilter, setVolFilter] = useState<VolFilterType>('All');
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
          if (data.scanMeta?.consolidation) setScanMeta(data.scanMeta.consolidation);
          else if (data.scanMeta?.consol) setScanMeta(data.scanMeta.consol);
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

  const handleSort = (key: keyof ConsolidationCandidate) => {
    let direction: SortDirection = 'desc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') direction = 'asc';
    else if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') { setSortConfig(null); return; }
    setSortConfig({ key, direction });
  };

  const handleEmaFilter = (val: EmaFilterType) => setEmaFilter(prev => prev === val ? 'All' : val);
  const handleAdrFilter = (val: AdrFilterType) => setAdrFilter(prev => prev === val ? 'All' : val);
  const handleVwapFilter = (val: VwapFilterType) => setVwapFilter(prev => prev === val ? 'All' : val);
  const handleCnfFilter = (val: CnfFilterType) => setCnfFilter(prev => prev === val ? 'All' : val);
  const handleStatFilter = (val: StatFilterType) => setStatFilter(prev => prev === val ? 'All' : val);
  const handleVolFilter = (val: VolFilterType) => setVolFilter(prev => prev === val ? 'All' : val);

  const filteredAndSorted = useMemo(() => {
    let filtered = [...candidates];
    if (showStage2Only) filtered = filtered.filter(c => stageShort(c.stage).startsWith('2'));
    if (marketCapFilter !== 'All') {
      filtered = filtered.filter(c => {
        const mc = c.mktCap;
        if (!mc) return true;
        if (marketCapFilter === 'Large') return mc >= 2e9;
        if (marketCapFilter === 'Small') return mc < 2e9;
        return true;
      });
    }
    if (cnfFilter !== 'All') {
      const minScore = CNF_MIN_SCORE[cnfFilter];
      filtered = filtered.filter(c => (c.score ?? -1) >= minScore);
    }
    if (emaFilter !== 'All') {
      filtered = filtered.filter(c => {
        const a10 = above10(c);
        const a21 = above21(c);
        if (emaFilter === '>10') return a10 === true;
        if (emaFilter === '>21') return a21 === true;
        if (emaFilter === 'Both') return a10 === true && a21 === true;
        return true;
      });
    }
    if (adrFilter !== 'All') {
      const minAdr = Number(adrFilter);
      filtered = filtered.filter(c => {
        const a = adrOf(c);
        return a != null && a >= minAdr;
      });
    }
    if (vwapFilter !== 'All') {
      filtered = filtered.filter(c => c.vwapStatus === vwapFilter);
    }
    if (statFilter !== 'All') {
      filtered = filtered.filter(c => coilStat(c) === statFilter);
    }
    if (volFilter !== 'All') {
      const minVol = Number(volFilter) * 1e6;
      filtered = filtered.filter(c => (c.dVol ?? (c.avgDollarVolM ? c.avgDollarVolM * 1e6 : 0)) >= minVol);
    }
    if (!sortConfig) return filtered;
    return filtered.sort((a, b) => {
      const aVal = a[sortConfig.key] as any;
      const bVal = b[sortConfig.key] as any;
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [candidates, sortConfig, showStage2Only, marketCapFilter, cnfFilter, emaFilter, adrFilter, vwapFilter, statFilter, volFilter]);

  const handleCopyTickers = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const tickers = filteredAndSorted.map(c => c.symbol).join(',');
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

  const getSortIcon = (columnKey: keyof ConsolidationCandidate) => sortConfig?.key === columnKey ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓') : '';

  const getScoreBadge = (score: number) => {
    if (score >= 70) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    if (score >= 50) return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    return 'bg-zinc-800/50 text-zinc-400 border-zinc-700/50';
  };
  const getRvolColor = (rvol: number | null | undefined) => {
    if (!rvol) return 'text-slate-500';
    if (rvol >= 2) return 'text-amber-400';
    if (rvol >= 1.5) return 'text-emerald-400';
    return 'text-slate-500';
  };
  const getAdrColor = (a: number | null) => {
    if (a == null) return 'text-slate-500';
    if (a >= 10) return 'text-purple-400';
    if (a >= 5) return 'text-emerald-400';
    if (a >= 3) return 'text-slate-300';
    return 'text-slate-500';
  };
  const getDtcColor = (d: number | null | undefined) => {
    if (d == null) return 'text-slate-500';
    if (d >= 5) return 'text-purple-400';
    if (d >= 3) return 'text-emerald-400';
    if (d >= 1.5) return 'text-slate-300';
    return 'text-slate-500';
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
  // COIL colour by ATR ratio — lower is tighter.
  const getCoilColor = (r: number | null) => {
    if (r == null) return 'text-slate-500';
    if (r <= COIL_COILED_MAX) return 'text-purple-400';
    if (r <= COIL_SETTING_MAX) return 'text-emerald-400';
    return 'text-slate-400';
  };
  const structColor = (on: boolean | null | undefined) => on ? 'text-emerald-400' : 'text-slate-600';

  const emaDot = (state: boolean | null | undefined) => {
    if (state === null || state === undefined) return 'bg-slate-600';
    return state ? 'bg-emerald-400' : 'bg-rose-500';
  };

  const displaySession = ['Pre-Market', 'Open', 'Post-Market', 'Closed'].includes(session) ? session : 'Closed';
  const getSessionTextColor = () => {
    if (displaySession === 'Pre-Market') return 'text-amber-500';
    if (displaySession === 'Open') return 'text-[#00e676]';
    if (displaySession === 'Post-Market') return 'text-indigo-400';
    return 'text-slate-500';
  };

  const thBase = "px-0.5 py-2.5 text-[10px] text-slate-500 font-bold tracking-wide leading-tight cursor-pointer hover:text-slate-300 transition-colors text-center";
  const tdBase = "px-0.5 pt-2.5 pb-1.5 text-center";

  const thStage = "px-0.5 pl-1.5 py-2.5 text-[10px] text-slate-500 font-bold tracking-wide leading-tight cursor-pointer hover:text-slate-300 transition-colors text-left";
  const tdStage = "px-0.5 pl-1.5 pt-2.5 pb-1.5 text-left";

  const thSector = "px-0.5 pl-1.5 py-2.5 text-[10px] text-slate-500 font-bold tracking-wide leading-tight cursor-pointer hover:text-slate-300 transition-colors text-left";
  const tdSector = "px-0.5 pl-1.5 pt-2.5 pb-1.5 text-left";

  const filterBtnActive = "bg-[#1e293b] text-indigo-400 border border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.1)]";
  const filterBtnIdle = "text-slate-500 border border-transparent hover:text-slate-300 hover:bg-white/[0.02]";
  const pillWrap = "flex items-center gap-3 px-4 py-1 bg-[#161c2a] border border-white/5 rounded-lg shrink-0";
  const pillLabel = "text-[11px] font-bold tracking-widest uppercase text-slate-400";
  const pillBtn = "px-3 py-1 rounded-lg text-[11px] font-bold tracking-widest uppercase transition-all duration-300 whitespace-nowrap";

  const activeFilterCount =
    (showStage2Only ? 1 : 0) +
    (marketCapFilter !== 'All' ? 1 : 0) +
    (cnfFilter !== 'All' ? 1 : 0) +
    (emaFilter !== 'All' ? 1 : 0) +
    (adrFilter !== 'All' ? 1 : 0) +
    (vwapFilter !== 'All' ? 1 : 0) +
    (statFilter !== 'All' ? 1 : 0) +
    (volFilter !== 'All' ? 1 : 0);

  return (
    <div className="bg-[#101623] border border-white/5 rounded-2xl p-3 md:p-5 relative overflow-visible shadow-xl w-full max-w-[1280px] mx-auto">
      {/* Header raised z-10 → z-30 so the ? panel (z-[70]) paints above the
          FILTERS bar (z-10) instead of losing the sibling z-fight. */}
      <div onClick={() => setIsExpanded(!isExpanded)} className={`flex justify-between items-center relative z-30 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-5 border-b border-white/5 pb-4' : ''}`}>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs md:text-sm font-bold text-[#7c8bfa] bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 group-hover:bg-white/[0.02] transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
            10/21 CONSOLIDATION
          </span>
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
          <span className="relative z-40 inline-flex">
            <MetricsKey meta={CONSOL_META} liveGates={scanMeta?.gates} />
          </span>
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
          {/* FILTERS bar stays z-10 — below the header (z-30) so the ? panel
              covers it cleanly, still above the table. */}
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
                  <span className={pillLabel}>STAT</span>
                  <div className="flex items-center gap-1">
                    {(['Coiled', 'Setting Up'] as StatFilterType[]).map((opt) => (
                      <button key={opt} onClick={() => handleStatFilter(opt)} className={`${pillBtn} ${statFilter === opt ? filterBtnActive : filterBtnIdle}`}>{opt}</button>
                    ))}
                  </div>
                </div>
                <div className={pillWrap}>
                  <span className={pillLabel}>$VOL</span>
                  <div className="flex items-center gap-1">
                    {VOL_BUCKETS.map((opt) => (
                      <button key={opt} onClick={() => handleVolFilter(opt)} title={`Dollar volume of $${opt}M and above`} className={`${pillBtn} ${volFilter === opt ? filterBtnActive : filterBtnIdle}`}>{opt}M+</button>
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

          <div className="relative z-0 overflow-x-auto custom-scrollbar" style={{ scrollbarWidth: 'thin' }}>
            {/* min-w 880; COIL replaces FLOAT, %OFF HI dropped. Widths sum ~91,
                slack pools right — matches the SIPs spacing. */}
            <table className="w-full min-w-[880px] table-fixed border-collapse">
              <thead>
                <tr className="border-b border-white/5 select-none">
                  <th className={`${thBase} w-[7%]`} title={colTip('TICKER')} onClick={() => handleSort('symbol')}>TICKER{getSortIcon('symbol')}</th>
                  <th className={`${thBase} w-[4%]`} title={colTip('CNF')} onClick={() => handleSort('score')}>CNF{getSortIcon('score')}</th>
                  <th className={`${thBase} w-[7%]`} title={colTip('PRICE')} onClick={() => handleSort('price')}>PRICE{getSortIcon('price')}</th>
                  <th className={`${thBase} w-[6%]`} title={colTip('CHG%')} onClick={() => handleSort('changePct')}>CHG%{getSortIcon('changePct')}</th>
                  <th className={`${thBase} w-[6%]`} title={colTip('10/21')}>10/21</th>
                  <th className={`${thBase} w-[6%]`} title={colTip('VOL')} onClick={() => handleSort('vol')}>VOL{getSortIcon('vol')}</th>
                  <th className={`${thBase} w-[7%]`} title={colTip('$VOL')} onClick={() => handleSort('dVol')}>$VOL{getSortIcon('dVol')}</th>
                  <th className={`${thBase} w-[5%]`} title={colTip('RVOL')} onClick={() => handleSort('rvol')}>RVOL{getSortIcon('rvol')}</th>
                  <th className={`${thBase} w-[6%]`} title={colTip('COIL')} onClick={() => handleSort('coilRatio')}>COIL{getSortIcon('coilRatio')}</th>
                  <th className={`${thBase} w-[5%]`} title={colTip('ADR')} onClick={() => handleSort('adrPct')}>ADR{getSortIcon('adrPct')}</th>
                  <th className={`${thBase} w-[4%]`} title={colTip('MF')} onClick={() => handleSort('mf')}>MF{getSortIcon('mf')}</th>
                  <th className={`${thBase} w-[6%]`} title={colTip('RS')} onClick={() => handleSort('rsVsSpy')}>RS{getSortIcon('rsVsSpy')}</th>
                  <th className={`${thBase} w-[6%]`} title={colTip('STOCH')} onClick={() => handleSort('stochK')}>STOCH{getSortIcon('stochK')}</th>
                  <th className={`${thBase} w-[5%]`} title={colTip('DTC')} onClick={() => handleSort('daysToCover')}>DTC{getSortIcon('daysToCover')}</th>
                  <th className={`${thBase} w-[6%]`} title={colTip('MCAP')} onClick={() => handleSort('mktCap')}>MCAP{getSortIcon('mktCap')}</th>
                  <th className={`${thStage} w-[5%] border-l border-white/5`} title={colTip('STAGE')} onClick={() => handleSort('stage')}>STAGE{getSortIcon('stage')}</th>
                  <th className={`${thSector} w-[7%]`} title={colTip('SECTOR')} onClick={() => handleSort('sector')}>SECTOR{getSortIcon('sector')}</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-white/5">
                {filteredAndSorted.length === 0 ? (
                  <tr><td colSpan={17} className="py-12 text-center text-slate-500 text-sm font-medium">{status === 'Live' ? (candidates.length > 0 ? 'No candidates match current filter criteria.' : 'No consolidations in the current scan.') : status === 'Syncing...' ? 'Running scan…' : 'Feed unavailable — awaiting next scheduled scan.'}</td></tr>
                ) : (
                  filteredAndSorted.map((row) => {
                    const isPositive = (row.changePct ?? 0) >= 0;
                    const tag = catalystTagOf(row);
                    const headline = headlineOf(row);
                    const catUrl = catalystUrlOf(row);
                    const sectorText = cleanSector(row.sector, row.symbol);
                    const bdRev = isBlueDotSetup(row.setupName);
                    const adr = adrOf(row);
                    const mf = mfOf(row);
                    const rmv = rmvOf(row);
                    const rme = rmeOf(row);
                    const stateRes = stateOf(rmv, rme);
                    const coilR = coilRatioOf(row);
                    const range10 = range10Of(row);
                    const st = coilStat(row);
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
                            <span
                              title={cnfTooltip(row)}
                              className={`inline-block whitespace-nowrap px-1.5 py-[2px] rounded text-[9px] font-bold border cursor-help ${getScoreBadge(row.score)}`}
                            >
                              {row.score}
                            </span>
                          </td>
                          <td className={`${tdBase} text-xs text-slate-300 font-medium whitespace-nowrap tabular-nums`}>
                            <div className="flex items-center justify-center gap-1">${row.price.toFixed(2)}{row.vwapStatus && row.vwapStatus !== 'neutral' && (<div className={`w-1.5 h-1.5 rounded-full shrink-0 ${row.vwapStatus === 'above' ? 'bg-emerald-400' : 'bg-rose-500'}`} title={`VWAP: ${row.vwapStatus}`}></div>)}</div>
                          </td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>{row.changePct != null ? `${isPositive ? '+' : ''}${row.changePct.toFixed(2)}%` : '—'}</td>
                          <td className={`${tdBase} whitespace-nowrap`}>
                            <div className="flex items-center justify-center gap-1">
                              <div className="flex items-center gap-px">
                                <span className="text-[8px] font-bold text-slate-500">10</span>
                                <div className={`w-1.5 h-1.5 rounded-full ${emaDot(above10(row))}`} title={`10 EMA: ${above10(row) == null ? 'n/a' : above10(row) ? 'above' : 'below'}`}></div>
                              </div>
                              <div className="flex items-center gap-px">
                                <span className="text-[8px] font-bold text-slate-500">21</span>
                                <div className={`w-1.5 h-1.5 rounded-full ${emaDot(above21(row))}`} title={`21 EMA: ${above21(row) == null ? 'n/a' : above21(row) ? 'above' : 'below'}`}></div>
                              </div>
                            </div>
                          </td>
                          <td className={`${tdBase} text-xs text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{formatNumber(row.vol)}</td>
                          <td className={`${tdBase} text-xs text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{row.dVol ? formatCurrency(row.dVol) : (row.avgDollarVolM ? `$${row.avgDollarVolM}M` : '—')}</td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getRvolColor(row.rvol)}`}>{row.rvol ? `${row.rvol.toFixed(1)}x` : '—'}</td>
                          {/* COIL: raw 10d range % on top, N× ATR ratio below */}
                          <td className={`${tdBase} whitespace-nowrap tabular-nums ${getCoilColor(coilR)}`} title={coilR != null ? `10-day range normalized to ${coilR.toFixed(1)}× daily ATR` : undefined}>
                            <div className="flex flex-col leading-tight">
                              <span className="text-xs font-bold">{range10 != null ? `${range10.toFixed(1)}%` : '—'}</span>
                              <span className="text-[8px] font-semibold opacity-80">{coilR != null ? `${coilR.toFixed(1)}× ATR` : ''}</span>
                            </div>
                          </td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getAdrColor(adr)}`}>
                            {adr != null ? `${adr.toFixed(1)}%` : '—'}
                          </td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${mfColor(mf)}`} title={mf != null ? `Money Flow ${mf.toFixed(0)} — ${mfLabel(mf)}` : undefined}>
                            {mf != null ? `${mf.toFixed(0)}${mfArrow(row.mfTrend ?? 0)}` : '—'}
                          </td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getRsColor(row.rsVsSpy)}`} title={row.rsVsSpy != null ? `${row.rsVsSpy >= 0 ? '+' : ''}${row.rsVsSpy.toFixed(1)} percentage points vs SPY over three months` : undefined}>
                            {formatRs(row.rsVsSpy)}
                          </td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getStochColor(row.stochK)}`}>{row.stochK != null ? row.stochK.toFixed(1) : '—'}</td>
                          <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getDtcColor(row.daysToCover)}`}>
                            {row.daysToCover != null ? row.daysToCover.toFixed(1) : '—'}
                          </td>
                          <td className={`${tdBase} text-xs text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{formatNumber(row.mktCap)}</td>
                          <td className={`${tdStage} whitespace-nowrap border-l border-white/5`}>
                            <span
                              title={stageDescription(row.stage)}
                              className={`text-[9px] font-bold tracking-wide cursor-help ${stageColor(row.stage)}`}
                            >
                              {stageShort(row.stage)}
                            </span>
                          </td>
                          <td className={tdSector}>
                            <span title={sectorText} className="block truncate text-left text-[8px] font-semibold tracking-wide uppercase text-slate-400">{sectorText}</span>
                          </td>
                        </tr>
                        {/* Sub-row: setup label | catalyst | RMV/RME, then STATE
                            left under STAGE, STR (GC/21↑) + STAT under SECTOR. */}
                        <tr className="bg-transparent border-t border-white/5">
                          <td className="w-[7%]"></td>
                          <td colSpan={13} className="pb-1.5 pt-1 pr-3">
                            <div className="flex items-center text-left gap-0 min-w-0">
                              <span className="shrink-0 w-[76px] pr-2 text-[#7c8bfa]/90 font-bold text-[9px] tracking-[0.06em] uppercase leading-none truncate">
                                {bdRev ? <BlueDot /> : 'COIL'}
                              </span>
                              <p className="flex-1 min-w-0 text-[10px] leading-relaxed border-l border-white/10 pl-2.5 pr-3 truncate" title={headline || undefined}>
                                {headline || tag ? (
                                  <>
                                    {tag && (
                                      <>
                                        <span className="text-[8px] font-bold tracking-[0.12em] uppercase text-amber-400/70">{tag}</span>
                                        {headline ? ' ' : ''}
                                      </>
                                    )}
                                    {headline && (
                                      catUrl ? (
                                        <a href={catUrl} target="_blank" rel="noopener noreferrer" className="text-slate-500 font-normal hover:text-slate-300 hover:underline transition-colors">{headline}</a>
                                      ) : (
                                        <span className="text-slate-500 font-normal">{headline}</span>
                                      )
                                    )}
                                  </>
                                ) : (
                                  <span className="text-slate-600 italic">No news catalyst — technical setup only.</span>
                                )}
                              </p>
                              <span
                                title={stateTooltip(rmv, rme)}
                                className="shrink-0 flex items-baseline gap-1.5 cursor-help whitespace-nowrap"
                              >
                                <span className="text-[8px] font-bold tracking-[0.1em] uppercase text-slate-600">RMV/RME</span>
                                <span className="text-[9px] font-semibold text-slate-500 tabular-nums">{statePair(rmv, rme)}</span>
                              </span>
                            </div>
                          </td>
                          <td className="pb-1.5 pt-1 pl-1.5 text-left align-middle border-l border-white/5">
                            <span
                              title={stateLegend(rmv, rme)}
                              className={`text-[8px] font-bold cursor-help whitespace-nowrap ${stateRes.color}`}
                            >
                              {stateRes.state === 'UNKNOWN' ? '—' : stateRes.state}
                            </span>
                          </td>
                          <td className="pb-1.5 pt-1 pl-1.5 text-left align-middle">
                            <div className="flex items-center gap-2 whitespace-nowrap">
                              <span className="flex items-center gap-1">
                                <span className={`text-[8px] font-semibold ${structColor(row.goldenCross)}`} title="50 SMA > 200 SMA">GC</span>
                                <span className={`text-[8px] font-semibold ${structColor(row.ema21Rising)}`} title="21 EMA rising">21↑</span>
                              </span>
                              {st === 'Coiled' ? (
                                <span className="text-[8px] font-semibold text-emerald-400">Coiled</span>
                              ) : st === 'Setting Up' ? (
                                <span className="text-[8px] font-semibold text-amber-400">Setting Up</span>
                              ) : null}
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
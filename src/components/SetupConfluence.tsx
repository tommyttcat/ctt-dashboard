'use client';

// SetupConfluence — v2.0
//
// Scanner card that cross-references all scanner results to find stocks
// appearing in multiple scanners simultaneously. Rendered on the scanners
// page alongside the other 10 scanner cards. No new API routes or KV reads.

import React, { useState, useEffect, useMemo } from 'react';
import { cachedJson, fetchScannerLatest } from '@/lib/scannerLatest';
import TickerChartHover, { useFreezeWhileChartOpen } from './TickerChartHover';
import { stageShort, stageDescription, stageBadge } from '@/lib/indicators/stage';
import { mfColor, mfLabel, mfArrow } from '@/lib/indicators/moneyflow';
import { rsBadge } from '@/lib/indicators/rs';
import { displaySector } from '@/lib/sectors';
import { CatalystChip, NewsStars, headlineOf, isGenericCatalyst, catalystUrlOf } from '@/lib/catalyst';
import { formatSetupName } from '@/lib/setupName';
import {
  rvolColor as getRvolColor,
  adrColor as getAdrColor,
  stochColor as getStochColor,
  dtcColor as getDtcColor,
  floatColor as getFloatColor,
  tickerChipForScore,
  tickerTitle,
  scoreCellCls,
  changeColor,
} from '@/lib/indicators/columnColors';

/* ---- Scanner definitions ------------------------------------------------ */

type ScannerKey = 'daily' | 'sip' | 'dvol' | 'swing' | 'coil' | 'vcp' | 'hrs' | 'ep9m' | 'multi';

const SCANNERS: { key: ScannerKey; label: string; short: string; color: string }[] = [
  { key: 'daily', label: 'Daily Setups',   short: 'DAILY', color: 'bg-indigo-500/20 text-indigo-300 border-indigo-400/30' },
  { key: 'sip',   label: 'Stocks in Play', short: 'SIP',   color: 'bg-violet-500/20 text-violet-300 border-violet-400/30' },
  { key: 'dvol',  label: 'Dollar Volume',  short: 'DVOL',  color: 'bg-amber-500/20 text-amber-300 border-amber-400/30' },
  { key: 'swing', label: 'Swing',          short: 'SWING', color: 'bg-teal-500/20 text-teal-300 border-teal-400/30' },
  { key: 'coil',  label: 'Consolidation',  short: 'COIL',  color: 'bg-cyan-500/20 text-cyan-300 border-cyan-400/30' },
  { key: 'vcp',   label: 'VCP',            short: 'VCP',   color: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30' },
  { key: 'hrs',   label: 'Hidden RS',      short: 'HRS',   color: 'bg-rose-500/20 text-rose-300 border-rose-400/30' },
  { key: 'ep9m',  label: 'EP9M',           short: 'EP9M',  color: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-400/30' },
  { key: 'multi', label: '100-Bagger',     short: '100B',  color: 'bg-lime-500/20 text-lime-300 border-lime-400/30' },
];

const SCANNER_MAP = Object.fromEntries(SCANNERS.map(s => [s.key, s]));

/* ---- Unified row type --------------------------------------------------- */

interface ConfluenceRow {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  changePct: number;
  vol: number | null;
  dVol: number | null;
  rvol: number | null;
  float: number | null;
  daysToCover: number | null;
  rsRating: number | null;
  stage: string | null;
  stochK: number | null;
  adrPct: number | null;
  mf: number | null;
  mfTrend: number | undefined;
  mktCap: number | null;
  cnfScore: number | null;
  vwapStatus: string | null;
  aboveEma10: boolean | null;
  aboveEma21: boolean | null;
  setupName: string | null;
  catalyst: string | null;
  catalystUrl: string | null;
  newsPublisher: string | null;
  newsAge: string | null;
  newsSentiment: string | null;
  newsCausal: boolean | null;
  thesis: string | null;
  dotKind: string | null;
  scanStreak: number;
  scanners: ScannerKey[];
  overlap: number;
}

/* ---- Data extraction ---------------------------------------------------- */

function tickerOf(row: any): string {
  return row.ticker ?? row.symbol ?? '';
}

function extractFields(row: any): Omit<ConfluenceRow, 'ticker' | 'scanStreak' | 'scanners' | 'overlap'> {
  return {
    name: row.name ?? '',
    sector: row.sector ?? '',
    price: row.price ?? 0,
    changePct: row.changePct ?? 0,
    vol: row.vol ?? null,
    dVol: row.dVol ?? row.dvol ?? null,
    rvol: row.rvol ?? null,
    float: row.float ?? null,
    daysToCover: row.daysToCover ?? null,
    rsRating: row.rsRating ?? row.rs ?? null,
    stage: row.stage ?? null,
    stochK: row.stochK ?? null,
    adrPct: row.adrPct ?? row.atrPct ?? null,
    mf: row.mf ?? null,
    mfTrend: row.mfTrend,
    mktCap: row.mktCap ?? row.marketCap ?? null,
    cnfScore: row.conviction ?? row.score ?? row.cnfScore ?? null,
    vwapStatus: row.vwapStatus ?? null,
    aboveEma10: row.aboveEma10 ?? null,
    aboveEma21: row.aboveEma21 ?? null,
    setupName: row.setupName ?? null,
    catalyst: row.catalyst ?? null,
    catalystUrl: row.catalystUrl ?? row.newsUrl ?? null,
    newsPublisher: row.newsPublisher ?? null,
    newsAge: row.newsAge ?? null,
    newsSentiment: row.newsSentiment ?? null,
    newsCausal: row.newsCausal ?? null,
    thesis: row.thesis ?? row.news ?? row.headline ?? null,
    dotKind: row.dotKind ?? null,
  };
}

const ENRICHMENT_PRIORITY: ScannerKey[] = ['daily', 'sip', 'swing', 'coil', 'hrs', 'dvol', 'vcp', 'ep9m', 'multi'];

function buildConfluenceRows(scannerData: Map<ScannerKey, any[]>, streakMap: Record<string, number> = {}): ConfluenceRow[] {
  const tickerMap = new Map<string, { scanners: Set<ScannerKey>; dataByScanner: Map<ScannerKey, any> }>();

  for (const [scannerKey, rows] of scannerData) {
    for (const row of rows) {
      const t = tickerOf(row).toUpperCase();
      if (!t) continue;
      let entry = tickerMap.get(t);
      if (!entry) {
        entry = { scanners: new Set(), dataByScanner: new Map() };
        tickerMap.set(t, entry);
      }
      entry.scanners.add(scannerKey);
      entry.dataByScanner.set(scannerKey, row);
    }
  }

  const results: ConfluenceRow[] = [];
  for (const [ticker, entry] of tickerMap) {
    if (entry.scanners.size < 2) continue;

    let bestRow: any = null;
    for (const key of ENRICHMENT_PRIORITY) {
      if (entry.dataByScanner.has(key)) {
        bestRow = entry.dataByScanner.get(key);
        break;
      }
    }
    if (!bestRow) bestRow = entry.dataByScanner.values().next().value;

    const fields = extractFields(bestRow);
    const scanners = Array.from(entry.scanners);

    results.push({ ticker, ...fields, scanStreak: streakMap[ticker] || 0, scanners, overlap: scanners.length });
  }

  results.sort((a, b) => {
    if (b.overlap !== a.overlap) return b.overlap - a.overlap;
    return (b.cnfScore ?? -1) - (a.cnfScore ?? -1);
  });

  return results;
}

/* ---- Formatting --------------------------------------------------------- */

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

const formatTime = (timestamp: number | Date) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'America/New_York' });
};

/* ---- Overlap badge color ------------------------------------------------ */

function overlapBadgeCls(n: number): string {
  const base = 'inline-flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-black border';
  if (n >= 5) return `${base} bg-purple-500/20 text-purple-300 border-purple-400/30`;
  if (n >= 4) return `${base} bg-emerald-500/20 text-emerald-300 border-emerald-400/30`;
  if (n >= 3) return `${base} bg-amber-500/20 text-amber-300 border-amber-400/30`;
  return `${base} bg-slate-500/15 text-slate-400 border-white/10`;
}

/* ---- Streak badge ------------------------------------------------------- */

function streakBadgeCls(n: number): string {
  const base = 'inline-flex items-center justify-center min-w-[20px] h-5 rounded-full text-[9px] font-black border px-1';
  if (n >= 10) return `${base} bg-purple-500/20 text-purple-300 border-purple-400/30`;
  if (n >= 5) return `${base} bg-emerald-500/20 text-emerald-300 border-emerald-400/30`;
  if (n >= 3) return `${base} bg-amber-500/20 text-amber-300 border-amber-400/30`;
  if (n >= 1) return `${base} bg-slate-500/15 text-slate-400 border-white/10`;
  return `${base} bg-transparent text-slate-600 border-transparent`;
}

/* ---- Component ---------------------------------------------------------- */

type SortDirection = 'asc' | 'desc';
type MinOverlapFilter = 2 | 3 | 4;
type MinStreakFilter = 0 | 3 | 5 | 10;

export default function SetupConfluence() {
  const [rows, setRows] = useState<ConfluenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState<number | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: SortDirection } | null>(null);
  const [minOverlap, setMinOverlap] = useState<MinOverlapFilter>(2);
  const [minStreak, setMinStreak] = useState<MinStreakFilter>(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [txtDone, setTxtDone] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const fetchAll = async () => {
      try {
        const [scannerData, dvol, swing, coil, vcp, hrs, ep9m, multi] = await Promise.all([
          fetchScannerLatest(),
          cachedJson('/api/dvol/latest'),
          cachedJson('/api/swing-candidates/latest'),
          cachedJson('/api/consolidation/latest'),
          cachedJson('/api/vcp/latest'),
          cachedJson('/api/hrs/latest'),
          cachedJson('/api/ep9m/latest'),
          cachedJson('/api/multibagger/latest'),
        ]);

        if (!isMounted) return;

        const scannerMap = new Map<ScannerKey, any[]>();
        if (scannerData?.success) {
          if (Array.isArray(scannerData.dailySetups)) scannerMap.set('daily', scannerData.dailySetups);
          if (Array.isArray(scannerData.stocksInPlay)) scannerMap.set('sip', scannerData.stocksInPlay);
        }
        if (dvol?.success && Array.isArray(dvol.rows)) scannerMap.set('dvol', dvol.rows);
        if (swing?.success && Array.isArray(swing.candidates)) scannerMap.set('swing', swing.candidates);
        if (coil?.success && Array.isArray(coil.candidates)) scannerMap.set('coil', coil.candidates);
        if (vcp?.success && Array.isArray(vcp.candidates)) scannerMap.set('vcp', vcp.candidates);
        if (hrs?.success && Array.isArray(hrs.candidates)) scannerMap.set('hrs', hrs.candidates);
        if (ep9m?.success && Array.isArray(ep9m.candidates)) scannerMap.set('ep9m', ep9m.candidates);
        if (multi?.success && Array.isArray(multi.candidates)) scannerMap.set('multi', multi.candidates);

        const streakMap: Record<string, number> = scannerData?.scanStreaks ?? {};
        const built = buildConfluenceRows(scannerMap, streakMap);
        setRows(built);
        setLastFetch(Date.now());
        setLoading(false);
      } catch {
        if (isMounted) setLoading(false);
      }
    };

    fetchAll();
    const interval = setInterval(fetchAll, 60_000);
    return () => { isMounted = false; clearInterval(interval); };
  }, []);

  const handleSort = (key: string) => {
    let direction: SortDirection = 'desc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') direction = 'asc';
    else if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') { setSortConfig(null); return; }
    setSortConfig({ key, direction });
  };

  const filteredAndSorted = useMemo(() => {
    let filtered = rows.filter(r => r.overlap >= minOverlap && r.scanStreak >= minStreak);
    if (!sortConfig) return filtered;
    return [...filtered].sort((a, b) => {
      const aVal = (a as any)[sortConfig.key];
      const bVal = (b as any)[sortConfig.key];
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [rows, sortConfig, minOverlap, minStreak]);

  const frozenRows = useFreezeWhileChartOpen(filteredAndSorted);

  const handleCopyTickers = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const tickers = frozenRows.map(r => r.ticker).join(',');
    if (!tickers) return;
    try { await navigator.clipboard.writeText(tickers); } catch {
      const ta = document.createElement('textarea');
      ta.value = tickers; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch {} document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownloadTxt = (e: React.MouseEvent) => {
    e.stopPropagation();
    const t = frozenRows.map(r => r.ticker);
    if (!t.length) return;
    const blob = new Blob([t.join(',')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'setup-confluence.txt';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setTxtDone(true);
    setTimeout(() => setTxtDone(false), 1800);
  };

  const getSortIcon = (columnKey: string) =>
    sortConfig?.key === columnKey ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓') : '';

  const emaDot = (state: boolean | null | undefined) => {
    if (state === null || state === undefined) return 'bg-slate-600';
    return state ? 'bg-emerald-400' : 'bg-rose-500';
  };

  const thBase = 'px-0.5 py-2.5 text-[10px] text-slate-500 font-bold tracking-wide leading-tight cursor-pointer hover:text-slate-300 transition-colors text-center';
  const tdBase = 'px-0.5 pt-2.5 pb-1.5 text-center';
  const thStage = 'px-0.5 pl-1.5 py-2.5 text-[10px] text-slate-500 font-bold tracking-wide leading-tight cursor-pointer hover:text-slate-300 transition-colors text-left';
  const tdStage = 'px-0.5 pl-1.5 pt-2.5 pb-1.5 text-left';
  const thSector = 'px-0.5 pl-1.5 py-2.5 text-[10px] text-slate-500 font-bold tracking-wide leading-tight cursor-pointer hover:text-slate-300 transition-colors text-left';
  const tdSector = 'px-0.5 pl-1.5 pt-2.5 pb-1.5 text-left';

  const filterBtnActive = 'bg-[#1e293b] text-indigo-400 border border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.1)]';
  const filterBtnIdle = 'text-slate-500 border border-transparent hover:text-slate-300 hover:bg-white/[0.02]';
  const pillBtn = 'px-3 py-1 rounded-lg text-[11px] font-bold tracking-widest uppercase transition-all duration-300 whitespace-nowrap cursor-pointer';

  const overlapCounts = useMemo(() => {
    const c = { two: 0, three: 0, four: 0, fivePlus: 0 };
    for (const r of rows) {
      if (r.overlap >= 5) c.fivePlus++;
      else if (r.overlap >= 4) c.four++;
      else if (r.overlap >= 3) c.three++;
      else if (r.overlap >= 2) c.two++;
    }
    return c;
  }, [rows]);

  return (
    <div className="bg-[#101623] border-0 md:border md:border-white/5 md:rounded-2xl p-2 md:p-5 relative overflow-visible md:shadow-xl w-full max-w-[1280px] mx-auto">
            {/* Card header */}
            <div onClick={() => setIsExpanded(!isExpanded)} className={`flex justify-between items-center relative z-30 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-5 border-b border-white/5 pb-4' : ''}`}>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs md:text-sm font-bold text-[#7c8bfa] bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 group-hover:bg-white/[0.02] transition-colors">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
                  SETUP CONFLUENCE
                </span>

                {rows.length > 0 && (
                  <div className="hidden md:flex items-center gap-1.5">
                    {overlapCounts.fivePlus > 0 && (
                      <span className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded border bg-purple-500/10 text-purple-300 border-purple-400/20">
                        {overlapCounts.fivePlus} in 5+
                      </span>
                    )}
                    {overlapCounts.four > 0 && (
                      <span className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded border bg-emerald-500/10 text-emerald-300 border-emerald-400/20">
                        {overlapCounts.four} in 4
                      </span>
                    )}
                    {overlapCounts.three > 0 && (
                      <span className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded border bg-amber-500/10 text-amber-300 border-amber-400/20">
                        {overlapCounts.three} in 3
                      </span>
                    )}
                    <span className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded border bg-slate-500/10 text-slate-400 border-white/10">
                      {overlapCounts.two} in 2
                    </span>
                  </div>
                )}

                {frozenRows.length > 0 && (
                  <>
                    <button
                      onClick={handleCopyTickers}
                      title={`Copy ${frozenRows.length} tickers`}
                      className={`text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded border transition-all duration-200 ${
                        copied
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : 'bg-[#161c2a] text-slate-400 border-white/5 hover:text-slate-200 hover:bg-white/[0.04]'
                      }`}
                    >
                      {copied ? `✓ Copied ${frozenRows.length}` : `Copy ${frozenRows.length}`}
                    </button>
                    <button
                      onClick={handleDownloadTxt}
                      title="Download tickers as .txt for TradingView import"
                      className={`text-[10px] font-bold tracking-wider uppercase px-2 py-1 rounded border transition-all duration-200 ${
                        txtDone
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : 'bg-[#161c2a] text-slate-400 border-white/5 hover:text-slate-200 hover:bg-white/[0.04]'
                      }`}
                    >
                      {txtDone ? '✓ TXT' : 'TXT'}
                    </button>
                  </>
                )}

                <span className="hidden md:block basis-full text-[10px] font-bold tracking-wider uppercase text-slate-500 mt-1">
                  {frozenRows.length} stocks in {minOverlap}+ scanners{minStreak > 0 ? ` · ${minStreak}+ streak` : ''} &middot; {rows.length} total overlaps
                </span>
              </div>

              <div className="flex flex-col items-center gap-1.5">
                {lastFetch && (
                  <span className="text-[11px] text-slate-400/80 font-medium px-1 tracking-wide">
                    Updated: {formatTime(lastFetch)} ET
                  </span>
                )}
              </div>
            </div>

            {isExpanded && (
              <>
                {/* Filters */}
                <div className="flex justify-center items-center gap-6 mb-4 flex-wrap" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] font-bold tracking-widest uppercase text-slate-400">MIN OVERLAP</span>
                    <div className="flex items-center gap-1">
                      {([2, 3, 4] as MinOverlapFilter[]).map(n => (
                        <button
                          key={n}
                          onClick={() => setMinOverlap(n)}
                          className={`${pillBtn} ${minOverlap === n ? filterBtnActive : filterBtnIdle}`}
                        >
                          {n}+
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] font-bold tracking-widest uppercase text-slate-400">STREAK</span>
                    <div className="flex items-center gap-1">
                      {([0, 3, 5, 10] as MinStreakFilter[]).map(n => (
                        <button
                          key={n}
                          onClick={() => setMinStreak(n)}
                          className={`${pillBtn} ${minStreak === n ? filterBtnActive : filterBtnIdle}`}
                        >
                          {n === 0 ? 'ALL' : `${n}+`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Loading */}
                {loading && (
                  <div className="flex items-center justify-center py-20">
                    <div className="text-slate-500 text-sm font-medium tracking-wide animate-pulse">
                      Cross-referencing scanners...
                    </div>
                  </div>
                )}

                {/* Empty */}
                {!loading && frozenRows.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16 gap-2">
                    <span className="text-slate-500 text-sm font-medium">No stocks found in {minOverlap}+ scanners</span>
                    <span className="text-slate-600 text-xs">
                      {rows.length > 0 ? 'Try lowering the minimum overlap' : 'Scanner data may not be available yet'}
                    </span>
                  </div>
                )}

                {/* Table */}
                {!loading && frozenRows.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full table-fixed border-collapse" style={{ minWidth: 1060 }}>
                      <thead>
                        <tr className="border-b border-white/5">
                          <th className={`${thBase} w-[8%]`} onClick={() => handleSort('ticker')} title="Ticker symbol">TICKER{getSortIcon('ticker')}</th>
                          <th className={`${thBase} w-[3%]`} onClick={() => handleSort('overlap')} title="Scanner overlap count">#</th>
                          <th className={`${thBase} w-[3%]`} onClick={() => handleSort('scanStreak')} title="Consecutive scans appeared">STK{getSortIcon('scanStreak')}</th>
                          <th className={`${thBase} w-[3%]`} title="News quality stars">N</th>
                          <th className={`${thBase} w-[4%]`} onClick={() => handleSort('cnfScore')} title="Confluence score from the primary scanner">CNF{getSortIcon('cnfScore')}</th>
                          <th className={`${thBase} w-[4%]`} onClick={() => handleSort('rsRating')} title="IBD-style RS Rating (percentile)">RS{getSortIcon('rsRating')}</th>
                          <th className={`${thBase} w-[6%]`} onClick={() => handleSort('price')} title="Last price. Dot is VWAP position.">PRICE{getSortIcon('price')}</th>
                          <th className={`${thBase} w-[5%]`} onClick={() => handleSort('changePct')} title="Change vs prior close">CHG%{getSortIcon('changePct')}</th>
                          <th className={`${thBase} w-[4%]`} title="Price vs 10 and 21 EMAs">10/21</th>
                          <th className={`${thBase} w-[5%]`} onClick={() => handleSort('vol')} title="Shares traded today">VOL{getSortIcon('vol')}</th>
                          <th className={`${thBase} w-[5%]`} onClick={() => handleSort('dVol')} title="Dollar volume — price × volume">$VOL{getSortIcon('dVol')}</th>
                          <th className={`${thBase} w-[5%]`} onClick={() => handleSort('rvol')} title="Relative volume vs 20-day average">RVOL{getSortIcon('rvol')}</th>
                          <th className={`${thBase} w-[5%]`} onClick={() => handleSort('float')} title="Shares float">FLOAT{getSortIcon('float')}</th>
                          <th className={`${thBase} w-[5%]`} onClick={() => handleSort('adrPct')} title="20-day Average Daily Range %">ADR{getSortIcon('adrPct')}</th>
                          <th className={`${thBase} w-[4%]`} onClick={() => handleSort('mf')} title="Money Flow (21) — accumulation vs distribution">MF{getSortIcon('mf')}</th>
                          <th className={`${thBase} w-[5%]`} onClick={() => handleSort('stochK')} title="Stochastic %K (10)">STOCH{getSortIcon('stochK')}</th>
                          <th className={`${thBase} w-[4%]`} onClick={() => handleSort('daysToCover')} title="Days to cover — short interest">DTC{getSortIcon('daysToCover')}</th>
                          <th className={`${thBase} w-[5%]`} onClick={() => handleSort('mktCap')} title="Market capitalization">MCAP{getSortIcon('mktCap')}</th>
                          <th className={`${thStage} w-[5%] border-l border-white/5`} onClick={() => handleSort('stage')} title="Weinstein stage">STAGE{getSortIcon('stage')}</th>
                          <th className={`${thSector} w-[8%]`} onClick={() => handleSort('sector')}>SECTOR{getSortIcon('sector')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {frozenRows.map((row) => (
                          <React.Fragment key={row.ticker}>
                            {/* Data row */}
                            <tr className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                              {/* Ticker */}
                              <td className={tdBase}>
                                <div className="flex items-center justify-start gap-1.5">
                                  <TickerChartHover symbol={row.ticker}>
                                    <span
                                      className={tickerChipForScore(row.cnfScore)}
                                      title={tickerTitle(row.name, row.ticker, row.cnfScore)}
                                    >
                                      {row.ticker}
                                    </span>
                                  </TickerChartHover>
                                  <CatalystChip row={row} />
                                  {row.dotKind === 'blue' && <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" title="Blue dot" />}
                                  {row.dotKind === 'red' && <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" title="Red dot" />}
                                </div>
                              </td>

                              {/* Overlap # */}
                              <td className={tdBase}>
                                <span className={overlapBadgeCls(row.overlap)} title={`Appears in ${row.overlap} scanners`}>
                                  {row.overlap}
                                </span>
                              </td>

                              {/* Streak */}
                              <td className={tdBase}>
                                {row.scanStreak > 0 ? (
                                  <span className={streakBadgeCls(row.scanStreak)} title={`${row.scanStreak} consecutive scans`}>
                                    {row.scanStreak}
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-slate-600">—</span>
                                )}
                              </td>

                              {/* N — news stars */}
                              <td className={tdBase}><NewsStars row={row} /></td>

                              {/* CNF Score */}
                              <td className={tdBase}>
                                {row.cnfScore != null ? (
                                  <span className={scoreCellCls(row.cnfScore)}>{Math.round(row.cnfScore)}</span>
                                ) : (
                                  <span className="text-[10px] text-slate-600">—</span>
                                )}
                              </td>

                              {/* RS */}
                              <td className={`${tdBase} whitespace-nowrap`}>
                                <span className={`inline-block px-1 py-[1px] rounded border text-[9px] font-bold tabular-nums ${rsBadge(row.rsRating)}`}>{row.rsRating != null ? Math.round(row.rsRating) : '—'}</span>
                              </td>

                              {/* Price + VWAP dot */}
                              <td className={`${tdBase} text-[11px] font-semibold tabular-nums text-slate-200`}>
                                {row.price >= 100 ? row.price.toFixed(0) : row.price >= 10 ? row.price.toFixed(1) : row.price.toFixed(2)}
                                {row.vwapStatus && (
                                  <span className={`inline-block w-1.5 h-1.5 rounded-full ml-1 align-middle ${
                                    row.vwapStatus === 'above' ? 'bg-emerald-400' : 'bg-rose-500'
                                  }`} title={`${row.vwapStatus === 'above' ? 'Above' : 'Below'} VWAP`} />
                                )}
                              </td>

                              {/* CHG% */}
                              <td className={`${tdBase} text-[11px] font-semibold tabular-nums ${changeColor(row.changePct)}`}>
                                {row.changePct >= 0 ? '+' : ''}{row.changePct.toFixed(1)}%
                              </td>

                              {/* 10/21 EMA dots */}
                              <td className={tdBase}>
                                <div className="flex items-center justify-center gap-1">
                                  <span className="text-[9px] text-slate-600">10</span>
                                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${emaDot(row.aboveEma10)}`} />
                                  <span className="text-[9px] text-slate-600">21</span>
                                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${emaDot(row.aboveEma21)}`} />
                                </div>
                              </td>

                              {/* VOL */}
                              <td className={`${tdBase} text-[11px] text-slate-400 tabular-nums`}>
                                {formatNumber(row.vol)}
                              </td>

                              {/* $VOL */}
                              <td className={`${tdBase} text-[11px] text-slate-400 tabular-nums`}>
                                {formatCurrency(row.dVol)}
                              </td>

                              {/* RVOL */}
                              <td className={`${tdBase} text-[11px] font-semibold tabular-nums ${getRvolColor(row.rvol)}`}>
                                {row.rvol != null ? row.rvol.toFixed(1) + 'x' : '—'}
                              </td>

                              {/* FLOAT */}
                              <td className={`${tdBase} text-[11px] tabular-nums ${getFloatColor(row.float)}`}>
                                {formatNumber(row.float)}
                              </td>

                              {/* ADR */}
                              <td className={`${tdBase} text-[11px] font-semibold tabular-nums ${getAdrColor(row.adrPct)}`}>
                                {row.adrPct != null ? row.adrPct.toFixed(1) + '%' : '—'}
                              </td>

                              {/* MF */}
                              <td className={`${tdBase} text-[11px] font-semibold tabular-nums ${mfColor(row.mf)}`}>
                                {row.mf != null ? (
                                  <span title={mfLabel(row.mf)}>
                                    {Math.round(row.mf)}{mfArrow(row.mfTrend ?? 0)}
                                  </span>
                                ) : '—'}
                              </td>

                              {/* STOCH */}
                              <td className={`${tdBase} text-[11px] font-semibold tabular-nums ${getStochColor(row.stochK)}`}>
                                {row.stochK != null ? Math.round(row.stochK) : '—'}
                              </td>

                              {/* DTC */}
                              <td className={`${tdBase} text-[11px] font-semibold tabular-nums ${getDtcColor(row.daysToCover)}`}>
                                {row.daysToCover != null ? row.daysToCover.toFixed(1) : '—'}
                              </td>

                              {/* MCAP */}
                              <td className={`${tdBase} text-[10px] text-slate-400 tabular-nums`}>
                                {formatCurrency(row.mktCap)}
                              </td>

                              {/* STAGE */}
                              <td className={`${tdStage} whitespace-nowrap border-l border-white/5`}>
                                <span
                                  title={stageDescription(row.stage)}
                                  className={`inline-block px-1 py-[1px] rounded border text-[9px] font-bold tabular-nums tracking-wide ${stageBadge(row.stage)}`}
                                >
                                  {stageShort(row.stage)}
                                </span>
                              </td>

                              {/* SECTOR */}
                              <td className={tdSector}>
                                <span title={displaySector(row.sector, row.ticker)} className="block truncate text-left text-[8px] font-semibold tracking-wide uppercase text-slate-400">{displaySector(row.sector, row.ticker)}</span>
                              </td>
                            </tr>

                            {/* Sub-row */}
                            <tr className="bg-transparent border-t border-white/5">
                              <td />
                              <td colSpan={19} className="pb-1.5 pt-1 pr-3">
                                <div className="flex items-center text-left gap-0 min-w-0">
                                  <span className="shrink-0 w-[78px] px-0.5 text-center text-[#7c8bfa]/90 font-bold text-[9px] tracking-[0.04em] uppercase leading-none whitespace-nowrap">
                                    {formatSetupName(row.setupName)}
                                  </span>
                                  <div className="flex-1 min-w-0 flex items-center gap-1.5 border-l border-white/10 pl-2.5 pr-3">
                                    {row.scanners.map(sk => {
                                      const s = SCANNER_MAP[sk];
                                      return (
                                        <span
                                          key={sk}
                                          className={`inline-block text-[7px] font-bold tracking-wider px-1.5 py-[2px] rounded border ${s.color}`}
                                          title={s.label}
                                        >
                                          {s.short}
                                        </span>
                                      );
                                    })}
                                    {(() => {
                                      const hl = headlineOf(row);
                                      if (!hl) return null;
                                      const url = catalystUrlOf(row);
                                      return url ? (
                                        <a href={url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-slate-500 font-normal hover:text-slate-300 hover:underline transition-colors truncate">{hl}</a>
                                      ) : (
                                        <span className="text-[10px] text-slate-500 font-normal truncate">{hl}</span>
                                      );
                                    })()}
                                    {(row.newsPublisher || row.newsAge) && (
                                      <span className="text-[8px] text-slate-600 font-medium whitespace-nowrap">
                                        {[row.newsPublisher, row.newsAge].filter(Boolean).join(' · ')}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
  );
}

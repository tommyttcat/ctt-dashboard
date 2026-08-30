'use client';

// TopMovers — v1.5
//
// v1.5: the empty state stops lying.
//
//   It read "No tracking instruments currently found matching criteria",
//   which asserts something specific and usually false: that the scan ran
//   against a live session and nothing cleared the bar. On a weekend or
//   before the open there IS no session — every name computes to roughly
//   zero change because last trade and prior close are the same Friday
//   print, so the +4% Gainers gate rejects the entire market. The table
//   looked broken and the message blamed the filters.
//
//   Worse, that state is REACHABLE BY ACCIDENT. Forcing a scan outside
//   market hours writes the degenerate result over a good one: Losers has no
//   change gate so it survives, which is enough to satisfy the route's
//   "did we get real data" check, and Friday's snapshot is gone until the
//   next weekday run.
//
//   The component cannot prevent that — the guard belongs in the route — but
//   it can stop presenting it as a filter outcome. It now distinguishes
//   three cases it already has the information to tell apart: the market is
//   closed, the filters ate everything, or the scan genuinely found nothing.
//
//   The scan-age line matters most on the first. "No movers" on a Sunday is
//   correct and unalarming; "no movers, last scanned Friday 8pm" is the same
//   fact with the reason attached, and stops you debugging a scan that is
//   working exactly as designed.

// TopMovers — v1.4
//
// v1.4: news asterisk beside the ticker, and provenance in the CATALYST cell.
//
//   THE ASTERISK IS PARTLY REDUNDANT HERE and worth it anyway. This table
//   already has a CATALYST column, so unlike the summary cards it is not the
//   only place news is visible. But a column of prose is read, not scanned —
//   picking out which four of twenty rows have a story means moving your eye
//   across the full width and back. A marker beside the name is answerable
//   at a glance, and it keeps the vocabulary identical to the summary cards
//   so an asterisk means one thing everywhere on the dashboard.
//
//   THE CATALYST CELL NOW CARRIES WHAT IT ALWAYS SHOULD HAVE. It showed a
//   bare tag — "Earnings", "Contract" — with the headline nowhere. Scanner
//   v6.20 emits the headline, publisher and age on every row, and the tag
//   alone is the least useful third of that: "Contract" could be a $2M
//   reseller deal or a $200M defence award, and only the headline says
//   which. Hovering now gives publisher, age and the full headline.
//
//   PUBLISHER MATTERS MORE THAN IT LOOKS on an aggregated feed. Polygon
//   mixes GlobeNewswire 8-Ks with Motley Fool opinion, and once you strip
//   the source the two are indistinguishable — which is exactly why the news
//   lib tiers publishers before choosing. Surfacing it here means the
//   filtering is auditable rather than trusted.

import { rsBadge, rsTooltip } from '@/lib/indicators/rs';
import { stageBadge, stageShort, stageDescription } from '@/lib/indicators/stage';
import { fetchScannerLatest } from '@/lib/scannerLatest';
import { CatalystChip, catalystTooltip, isGenericCatalyst, hasNews, NewsStars } from '@/lib/catalyst';

// TopMovers — v1.3
//
// v1.3: RS column switched from rsVsSpy (a SPREAD versus SPY) to the
//       market-wide RS RATING (a PERCENTILE), matching every other table.
//
//   The old column read "+18" and meant eighteen points of three-month
//   outperformance. The new one reads "88" and means stronger than 88% of
//   the liquid market. The spread could not tell you whether +18 was
//   top-decile leadership or the middle of a strong tape; the percentile
//   answers that directly.
//
//   Colour thresholds and the tooltip come from @/lib/indicators/rs so this
//   table cannot describe the same number differently from the others —
//   which was the whole point of consolidating the measure.
// v1.1: RS compaction, DTC, 10/21 dots, Copy button.
// v1.2: + MetricsKey "?" panel showing scan gates from scanConfig.

import React, { useState, useEffect, useMemo } from 'react';
import { useMarketData } from './MarketDataContext';
import { SCANNER } from '@/lib/scanConfig';
import TickerChartHover, { useFreezeWhileChartOpen, WatchlistBtn } from './TickerChartHover';
import { WatchlistToggle } from './WatchlistPanel';
import { rvolColor as getRvolColor, adrColor as getAdrColor, dtcColor as getDtcColor, stochColor as getStochColor, floatColor as getFloatColor, tickerChipForScore, tickerTitle, scoreCellCls } from '@/lib/indicators/columnColors';
import { mfColor, mfLabel, mfArrow } from '@/lib/indicators/moneyflow';
import { displaySector } from '@/lib/sectors';
import { formatSetupName } from '@/lib/setupName';

interface StockData {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  vwapStatus: 'above' | 'below' | 'neutral';
  changePct: number;
  vol: number;
  dVol: number;
  rvol: number | null;
  mktCap: number | null;
  float: number | null;
  shortPct: number | null;
  daysToCover: number | null;
  catalyst: string | null;
  catalystUrl: string | null;
  thesis: string | null;
  newsPublisher: string | null;
  newsAge: string | null;
  newsSentiment: 'positive' | 'negative' | 'neutral' | null;
  newsCausal: boolean | null;
  stage: string;
  setupName: string | null;
  conviction: number | null;
  aboveEma10: boolean | null;
  aboveEma21: boolean | null;
  stochK: number | null;
  rsRating: number | null;
  adrPct: number | null;
  mf: number | null;
  mfTrend: number;
}

type TabType = 'Mega Caps' | 'Gainers' | 'Losers' | 'ETF Gainers' | 'ETF Losers';
type SortDirection = 'asc' | 'desc';
type EmaFilterType = 'All' | '>10' | '>21' | 'Both';
type VwapFilterType = 'All' | 'above' | 'below';
type CnfFilterType = 'All' | 'A' | 'B' | 'C';

interface MovingAverage { label: string; value: number; above: boolean; }
interface Benchmark { symbol: string; price: number; day?: MovingAverage[]; week?: MovingAverage[]; mas?: MovingAverage[]; }

const formatTime = (timestamp: number | Date) => { if (!timestamp) return ''; const date = new Date(timestamp); return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }); };
const formatNumber = (num: number | null) => { if (num === null || num === 0 || isNaN(num)) return '\u2014'; if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B'; if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M'; if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K'; return num.toLocaleString(); };
const formatCurrency = (num: number | null) => { if (num === null || num === 0 || isNaN(num)) return '\u2014'; if (num >= 1e9) return '$' + (num / 1e9).toFixed(1) + 'B'; if (num >= 1e6) return '$' + (num / 1e6).toFixed(1) + 'M'; return '$' + num.toLocaleString(); };

/* A row counts as having news only when there is a HEADLINE, not merely a
   tag. "Earnings" with no article behind it comes from the earnings calendar
   rather than the news feed — real information, but nothing to click, and an
   asterisk that opens nothing is worse than no asterisk. */
/* Mechanics live in @/lib/catalyst so all seven tables render a catalyst
   the same way; only this scan's reading of the news stays local. */
const NEGATIVE_NOTE = 'Reads negative — the tag alone would not have told you that.';

const newsTooltip = (row: StockData): string => catalystTooltip(row, { note: NEGATIVE_NOTE });
const cnfGradeOf = (score: number | null): CnfFilterType | null => { if (score == null) return null; if (score >= 70) return 'A'; if (score >= 50) return 'B'; return 'C'; };

export default function TopMovers() {
  const { session } = useMarketData();
  const [topMoversData, setTopMoversData] = useState<Record<TabType, StockData[]>>({ 'Mega Caps': [], 'Gainers': [], 'Losers': [], 'ETF Gainers': [], 'ETF Losers': [] });
  const [activeTab, setActiveTab] = useState<TabType>('Gainers');
  const [status, setStatus] = useState<string>('Syncing DB...');
  const [lastScanTime, setLastScanTime] = useState<number | null>(null);
  const [benchmark, setBenchmark] = useState<Benchmark | null>(null);
  const [maTimeframe, setMaTimeframe] = useState<'day' | 'week'>('day');
  const [sortConfig, setSortConfig] = useState<{ key: keyof StockData; direction: SortDirection } | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [marketCapFilter, setMarketCapFilter] = useState<string>('All');
  const [emaFilter, setEmaFilter] = useState<EmaFilterType>('All');
  const [vwapFilter, setVwapFilter] = useState<VwapFilterType>('All');
  const [cnfFilter, setCnfFilter] = useState<CnfFilterType>('All');
  const [copied, setCopied] = useState<boolean>(false);
  const [scanMeta, setScanMeta] = useState<any>(null);

  useEffect(() => { setSortConfig(null); }, [activeTab]);

  /* Distinguishes "the filters removed everything" from "there was nothing
     to remove". Both render an empty table and they call for opposite
     responses — clear a filter, or wait for a session. */
  const anyFilterActive =
    marketCapFilter !== 'All' || emaFilter !== 'All' ||
    vwapFilter !== 'All' || cnfFilter !== 'All';

  const rawCount = (topMoversData[activeTab] || []).length;

  /* Age of the snapshot in hours. A weekend gap is the common case and the
     one worth naming. */
  const scanAgeHours = lastScanTime != null
    ? (Date.now() - lastScanTime) / 3_600_000
    : null;

  const emptyStateText = (): string => {
    if (rawCount > 0 && anyFilterActive) {
      return 'Every name in this tab was removed by the active filters. Clear one to see the list.';
    }

    const stale = scanAgeHours != null && scanAgeHours > 12;

    if (session === 'Closed') {
      /* The specific mechanism, because it is not obvious and it looks like
         a bug: with no session, change is measured from the prior close to
         the prior close. */
      return stale
        ? `Market closed — the last scan ran ${Math.round(scanAgeHours!)} hours ago. Outside a live session every name shows roughly zero change, so the movers tabs have nothing to rank.`
        : 'Market closed. Outside a live session every name shows roughly zero change against its prior close, so there are no movers to rank — this is not a filter or a scan problem.';
    }

    if (session === 'Pre-Market') {
      return 'Pre-market. Movers populate once the session opens and volume starts printing against the prior close.';
    }

    if (stale) {
      return `No movers in the current snapshot, which is ${Math.round(scanAgeHours!)} hours old. Worth checking the scan is still running.`;
    }

    return 'No names in this tab from the most recent scan.';
  };

  useEffect(() => {
    let isMounted = true;
    const fetchDatabaseSnapshot = async () => {
      try {
        const data = await fetchScannerLatest();
        if (isMounted && data.success && data.topMovers) {
          const safeData: Record<TabType, StockData[]> = { 'Mega Caps': [], 'Gainers': [], 'Losers': [], 'ETF Gainers': [], 'ETF Losers': [] };
          const categories: TabType[] = ['Mega Caps', 'Gainers', 'Losers', 'ETF Gainers', 'ETF Losers'];
          categories.forEach(category => {
            const rawList = data.topMovers[category] || [];
            safeData[category] = rawList.map((item: any) => ({
              ticker: item.ticker || '\u2014', name: item.name || '', sector: item.sector || '',
              price: Number(item.price) || 0, vwapStatus: item.vwapStatus || 'neutral',
              changePct: Number((item.change ?? item.changePct) || 0),
              vol: Number((item.volume ?? item.vol) || 0),
              dVol: Number(item.dVol) || (Number(item.price || 0) * Number((item.volume ?? item.vol) || 0)),
              rvol: item.rvol || null, mktCap: item.mktCap || null, float: item.float || null,
              shortPct: item.shortPct || null, daysToCover: item.daysToCover ?? null,
              catalyst: item.catalyst || null, catalystUrl: item.catalystUrl || null,
              thesis: item.thesis || null, newsPublisher: item.newsPublisher || null,
              newsAge: item.newsAge || null, newsSentiment: item.newsSentiment || null, newsCausal: item.newsCausal ?? null,
              stage: item.stage || '\u2014', setupName: item.setupName || null,
              conviction: item.conviction != null ? Number(item.conviction) : ((item.cnfScore ?? item.smbScore) ?? null),
              aboveEma10: item.aboveEma10 ?? null, aboveEma21: item.aboveEma21 ?? null,
              stochK: item.stochK ?? null, rsRating: item.rsRating ?? null,
              adrPct: item.adrPct ?? null, mf: item.mf ?? null, mfTrend: item.mfTrend ?? 0,
            }));
          });
          setTopMoversData(safeData);
          setLastScanTime(data.lastScanTime || Date.now());
          if (data.benchmark) setBenchmark(data.benchmark);
          if (data.scanMeta?.topMovers) setScanMeta(data.scanMeta.topMovers);
          setStatus('Live');
        }
      } catch (error) { if (isMounted) setStatus('DB Offline'); }
    };
    fetchDatabaseSnapshot();
    const interval = setInterval(fetchDatabaseSnapshot, 60000);
    return () => { isMounted = false; clearInterval(interval); };
  }, []);

  const handleSort = (key: keyof StockData) => { let direction: SortDirection = 'desc'; if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') direction = 'asc'; else if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') { setSortConfig(null); return; } setSortConfig({ key, direction }); };
  const handleEmaFilter = (val: EmaFilterType) => setEmaFilter(prev => prev === val ? 'All' : val);
  const toggleVwap = (status: 'above' | 'below') => setVwapFilter(prev => prev === status ? 'All' : status);
  const handleCnfFilter = (val: CnfFilterType) => setCnfFilter(prev => prev === val ? 'All' : val);

  const computedMovers = useMemo(() => {
    let currentList = topMoversData[activeTab] || [];
    if (marketCapFilter !== 'All') { currentList = currentList.filter(s => { const mc = s.mktCap; if (!mc) return true; if (marketCapFilter === 'Mega') return mc >= 200e9; if (marketCapFilter === 'Large') return mc >= 10e9 && mc < 200e9; if (marketCapFilter === 'Mid') return mc >= 2e9 && mc < 10e9; if (marketCapFilter === 'Small') return mc >= 300e6 && mc < 2e9; if (marketCapFilter === 'Micro') return mc < 300e6; return true; }); }
    if (emaFilter !== 'All') { currentList = currentList.filter(s => { if (emaFilter === '>10') return s.aboveEma10 === true; if (emaFilter === '>21') return s.aboveEma21 === true; if (emaFilter === 'Both') return s.aboveEma10 === true && s.aboveEma21 === true; return true; }); }
    if (vwapFilter !== 'All') { currentList = currentList.filter(s => s.vwapStatus === vwapFilter); }
    if (cnfFilter !== 'All') { currentList = currentList.filter(s => cnfGradeOf(s.conviction) === cnfFilter); }
    /* Default ordering is CHG%, biggest move first. It used to fall through in
       whatever order the API returned, so the top of a "Top Movers" list was
       not actually the top mover. Losing tabs rank by the largest decline, so
       they sort ascending. */
    if (!sortConfig) {
      const desc = !/Losers/i.test(activeTab);
      return [...currentList]
        .sort((a, b) => {
          const av = a.changePct ?? 0;
          const bv = b.changePct ?? 0;
          return desc ? bv - av : av - bv;
        })
        .slice(0, 10);
    }
    return [...currentList].sort((a, b) => { const aVal = a[sortConfig.key] as any; const bVal = b[sortConfig.key] as any; if (aVal === null || aVal === undefined) return 1; if (bVal === null || bVal === undefined) return -1; if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1; if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1; return 0; }).slice(0, 10);
  }, [topMoversData, activeTab, sortConfig, marketCapFilter, emaFilter, vwapFilter, cnfFilter]);

  /* Held still while a chart is open — see useFreezeWhileChartOpen. */
  const sortedStocks = useFreezeWhileChartOpen(computedMovers);

  const handleCopyTickers = async (e: React.MouseEvent) => { e.stopPropagation(); const tickers = sortedStocks.map(s => s.ticker).join(','); if (!tickers) return; try { await navigator.clipboard.writeText(tickers); } catch { const ta = document.createElement('textarea'); ta.value = tickers; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch {} document.body.removeChild(ta); } setCopied(true); setTimeout(() => setCopied(false), 1800); };

  const [txtDone, setTxtDone] = useState(false);
  const handleDownloadTxt = (e: React.MouseEvent) => {
    e.stopPropagation();
    const t = sortedStocks.map(s => s.ticker);
    if (!t.length) return;
    const blob = new Blob([t.join(',')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'watchlist.txt';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setTxtDone(true);
    setTimeout(() => setTxtDone(false), 1800);
  };

  const getSortIcon = (columnKey: keyof StockData) => sortConfig?.key === columnKey ? (sortConfig.direction === 'asc' ? ' \u2191' : ' \u2193') : '';
  const getSessionTextColor = () => { if (status.includes('Err') || status.includes('Offline')) return 'text-rose-500'; if (status.includes('Syncing')) return 'text-amber-500'; if (session === 'Pre-Market') return 'text-amber-500'; if (session === 'Open') return 'text-[#00e676]'; if (session === 'Post-Market') return 'text-indigo-400'; return 'text-slate-500'; };
  const emaDot = (state: boolean | null) => { if (state === null) return 'bg-slate-600'; return state ? 'bg-emerald-400' : 'bg-rose-500'; };

  const thBase = "px-0.5 py-2.5 text-[10px] text-slate-500 font-bold tracking-wide leading-tight cursor-pointer hover:text-slate-300 transition-colors text-center";
  const tdBase = "px-0.5 pt-2.5 pb-1.5 text-center";
  const filterBtnActive = "bg-[#1e293b] text-indigo-400 border border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.1)]";
  const filterBtnIdle = "text-slate-500 border border-transparent hover:text-slate-300 hover:bg-white/[0.02]";
  const thStage = "px-0.5 pl-1.5 py-2.5 text-[10px] text-slate-500 font-bold tracking-wide leading-tight cursor-pointer hover:text-slate-300 transition-colors text-left";
  const tdStage = "px-0.5 pl-1.5 pt-2.5 pb-1.5 text-left";
  const thSector = "px-0.5 pl-1.5 py-2.5 text-[10px] text-slate-500 font-bold tracking-wide leading-tight cursor-pointer hover:text-slate-300 transition-colors text-left";
  const tdSector = "px-0.5 pl-1.5 pt-2.5 pb-1.5 text-left";
  const pillWrap = "flex items-center gap-3 px-4 py-1 bg-[#161c2a] border border-white/5 rounded-lg shrink-0";
  const pillLabel = "text-[11px] font-bold tracking-widest uppercase text-slate-400";
  const pillBtn = "px-3 py-1 rounded-lg text-[11px] font-bold tracking-widest uppercase transition-all duration-300 whitespace-nowrap";

  return (
    <div className="bg-[#101623] border-0 md:border md:border-white/5 md:rounded-2xl p-2 md:p-5 relative overflow-visible md:shadow-xl w-full max-w-[1280px] mx-auto">
      <div onClick={() => setIsExpanded(!isExpanded)} className={`flex justify-between items-center relative z-30 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-5 border-b border-white/5 pb-4' : ''}`}>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs md:text-sm font-bold text-[#7c8bfa] bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 group-hover:bg-white/[0.02] transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
            TOP MOVERS
          </span>
          {sortedStocks.length > 0 && (
            <button onClick={handleCopyTickers} title={`Copy ${sortedStocks.length} ticker${sortedStocks.length !== 1 ? 's' : ''} from ${activeTab} for TradingView`} className={`text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded border transition-all duration-200 ${copied ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-[#161c2a] text-slate-400 border-white/5 hover:text-slate-200 hover:bg-white/[0.04]'}`}>
              {copied ? `\u2713 Copied ${sortedStocks.length}` : `Copy ${sortedStocks.length}`}
            </button>
          )}
          {sortedStocks.length > 0 && (
            <button
              onClick={handleDownloadTxt}
              title={`Download ${sortedStocks.length} ticker${sortedStocks.length !== 1 ? 's' : ''} as .txt for TradingView import`}
              className={`text-[10px] font-bold tracking-wider uppercase px-2 py-1 rounded border transition-all duration-200 ${
                txtDone
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-[#161c2a] text-slate-400 border-white/5 hover:text-slate-200 hover:bg-white/[0.04]'
              }`}
            >
              {txtDone ? '\u2713 TXT' : 'TXT'}
            </button>
          )}
          <span className="hidden md:block basis-full text-[10px] font-bold tracking-wider uppercase text-slate-500 mt-1">
            Top {sortedStocks.length} of {rawCount} · ${SCANNER.minPrice}+ · {SCANNER.minVolume >= 1e6 ? `${SCANNER.minVolume/1e6}M` : `${SCANNER.minVolume/1e3}K`} vol · +{SCANNER.minChange}%+ · ${SCANNER.minMarketCap >= 1e6 ? `${SCANNER.minMarketCap/1e6}M` : ''} cap
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex flex-col items-center gap-1.5">
            <div className="flex items-center justify-center border border-white/5 bg-[#161c2a]/40 px-4 py-1.5 rounded-[10px] min-w-[120px]">
              <span className={`text-[10px] font-bold tracking-widest uppercase ${getSessionTextColor()}`}>{status === 'Live' ? session : status}</span>
            </div>
            {lastScanTime && (<span className="text-[11px] text-slate-400/80 font-medium px-1 tracking-wide whitespace-nowrap">Scanned: {formatTime(lastScanTime)} EST</span>)}
          </div>
          <WatchlistToggle />
        </div>
      </div>

      {isExpanded && (
        <>
          <div className="flex flex-col gap-3 mb-6 relative z-0 pb-2">
            <div className="flex flex-wrap justify-center items-center gap-3 w-full">
              <div className="flex gap-3 overflow-x-auto custom-scrollbar" style={{ scrollbarWidth: 'none' }}>
                {(['Mega Caps', 'Gainers', 'Losers', 'ETF Gainers', 'ETF Losers'] as TabType[]).map((tab) => {
                  const label = tab === 'Gainers' ? 'Movers Up' : tab === 'Losers' ? 'Movers Down' : tab;
                  const accentCls = activeTab === tab
                    ? tab === 'Gainers' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.1)]'
                    : tab === 'Losers' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30 shadow-[0_0_10px_rgba(244,63,94,0.1)]'
                    : 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.1)]'
                    : 'bg-[#161c2a] text-slate-400 border border-white/5 hover:bg-white/[0.04]';
                  return (
                    <button key={tab} onClick={(e) => { e.stopPropagation(); setActiveTab(tab); }} className={`px-5 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-all duration-300 ${accentCls}`}>
                      {label}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center bg-[#161c2a] border border-white/5 rounded-xl p-0.5" onClick={(e) => e.stopPropagation()}>
                {['All', 'Micro', 'Small', 'Mid', 'Large', 'Mega'].map((cap) => (
                  <button key={cap} onClick={() => setMarketCapFilter(cap)} className={`${pillBtn} ${marketCapFilter === cap ? filterBtnActive : filterBtnIdle}`}>{cap}</button>
                ))}
              </div>
              <div className={pillWrap} onClick={(e) => e.stopPropagation()}>
                <span className={pillLabel}>CNF</span>
                <div className="flex items-center gap-0.5">
                  {(['A', 'B', 'C'] as CnfFilterType[]).map((g) => (
                    <button key={g} onClick={() => handleCnfFilter(g)} className={`${pillBtn} ${cnfFilter === g ? filterBtnActive : filterBtnIdle}`}>{g}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap justify-center items-center gap-3 w-full" onClick={(e) => e.stopPropagation()}>
              <div className={pillWrap}>
                <span className={pillLabel}>10/21</span>
                <div className="flex items-center gap-0.5">
                  {(['>10', '>21', 'Both'] as EmaFilterType[]).map((opt) => (
                    <button key={opt} onClick={() => handleEmaFilter(opt)} className={`${pillBtn} ${emaFilter === opt ? filterBtnActive : filterBtnIdle}`}>{opt}</button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2.5 text-[9px] font-semibold text-slate-500">
                <span onClick={() => toggleVwap('above')} className={`flex items-center gap-1 cursor-pointer hover:text-slate-300 transition-colors ${vwapFilter === 'above' ? 'text-emerald-400' : ''}`} title={vwapFilter === 'above' ? 'Filtering above VWAP — click to show all' : 'Click to filter above VWAP only'}><span className={`w-1.5 h-1.5 rounded-full bg-emerald-400 ${vwapFilter === 'above' ? 'ring-1 ring-white/40' : ''}`}></span>Above VWAP</span>
                <span onClick={() => toggleVwap('below')} className={`flex items-center gap-1 cursor-pointer hover:text-slate-300 transition-colors ${vwapFilter === 'below' ? 'text-rose-400' : ''}`} title={vwapFilter === 'below' ? 'Filtering below VWAP — click to show all' : 'Click to filter below VWAP only'}><span className={`w-1.5 h-1.5 rounded-full bg-rose-500 ${vwapFilter === 'below' ? 'ring-1 ring-white/40' : ''}`}></span>Below</span>
              </div>
            </div>
          </div>
          
          <div className="overflow-x-auto custom-scrollbar" style={{ scrollbarWidth: 'none' }}>
            <table className="w-full min-w-[940px] table-fixed border-collapse">
              <thead>
                <tr className="border-b border-white/5 select-none">
                  <th className={`${thBase} w-[7%] !text-left pl-1`} onClick={() => handleSort('ticker')}>TICKER{getSortIcon('ticker')}</th>
                  <th className={`${thBase} w-[2%]`} title="News — ★ has an article, ★★ has a causal catalyst from a primary source">N</th>
                  <th className={`${thBase} w-[4%]`} onClick={() => handleSort('conviction')}>CNF{getSortIcon('conviction')}</th>
                  <th className={`${thBase} w-[4%]`} onClick={() => handleSort('rsRating')}>RS{getSortIcon('rsRating')}</th>
                  <th className={`${thBase} w-[6%]`} onClick={() => handleSort('price')}>PRICE{getSortIcon('price')}</th>
                  <th className={`${thBase} w-[5%]`} onClick={() => handleSort('changePct')}>CHG%{getSortIcon('changePct')}</th>
                  <th className={`${thBase} w-[5%]`}>10/21</th>
                  <th className={`${thBase} w-[5%]`} onClick={() => handleSort('vol')}>VOL{getSortIcon('vol')}</th>
                  <th className={`${thBase} w-[5%]`} onClick={() => handleSort('dVol')}>$VOL{getSortIcon('dVol')}</th>
                  <th className={`${thBase} w-[5%]`} onClick={() => handleSort('rvol')}>RVOL{getSortIcon('rvol')}</th>
                  <th className={`${thBase} w-[5%]`} onClick={() => handleSort('float')}>FLOAT{getSortIcon('float')}</th>
                  <th className={`${thBase} w-[5%]`} onClick={() => handleSort('adrPct' as any)}>ADR{getSortIcon('adrPct' as any)}</th>
                  <th className={`${thBase} w-[4%]`} onClick={() => handleSort('mf' as any)}>MF{getSortIcon('mf' as any)}</th>
                  <th className={`${thBase} w-[5%]`} onClick={() => handleSort('stochK')}>STOCH{getSortIcon('stochK')}</th>
                  <th className={`${thBase} w-[5%]`} onClick={() => handleSort('daysToCover')}>DTC{getSortIcon('daysToCover')}</th>
                  <th className={`${thBase} w-[5%]`} onClick={() => handleSort('mktCap')}>MCAP{getSortIcon('mktCap')}</th>
                  <th className={`${thStage} w-[5%] border-l border-white/5`} onClick={() => handleSort('stage')}>STAGE{getSortIcon('stage')}</th>
                  <th className={`${thSector} w-[7%]`} onClick={() => handleSort('sector')}>SECTOR{getSortIcon('sector')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {status.includes('Syncing') && topMoversData[activeTab].length === 0 ? (
                  <tr><td colSpan={18} className="py-12 text-center"><div className="w-5 h-5 border-2 border-white/10 border-t-indigo-400 rounded-full animate-spin mx-auto mb-3"></div><span className="text-xs text-slate-500 font-medium">Fetching DB Snapshot...</span></td></tr>
                ) : sortedStocks.length === 0 ? (
                  <tr>
                    <td colSpan={18} className="py-12 px-8 text-center">
                      <span className="block text-slate-500 text-sm font-medium max-w-[560px] mx-auto leading-relaxed">
                        {emptyStateText()}
                      </span>
                    </td>
                  </tr>
                ) : (
                  sortedStocks.map((row, i) => {
                    const isPositive = row.changePct >= 0;
                    return (
                      <tr key={i} className="hover:bg-white/[0.02] transition-colors group">
                        <td className={tdBase}>
                          <div className="flex items-center justify-start gap-1.5">
                            <WatchlistBtn symbol={row.ticker} />
                            <TickerChartHover symbol={row.ticker}><span className={tickerChipForScore(row.conviction)} title={tickerTitle(row.name, row.ticker, row.conviction)}>{row.ticker}</span></TickerChartHover>
                            <CatalystChip row={row} note={NEGATIVE_NOTE} />
                          </div>
                        </td>
                        <td className={tdBase}><NewsStars row={row} /></td>
                        <td className={tdBase}><span className={scoreCellCls(row.conviction)}>{row.conviction != null ? row.conviction : '--'}</span></td>
                        <td className={`${tdBase} whitespace-nowrap`} title={rsTooltip(row.rsRating)}><span className={`inline-block px-1 py-[1px] rounded border text-[9px] font-bold tabular-nums cursor-help ${rsBadge(row.rsRating)}`}>{row.rsRating ?? '—'}</span></td>
                        <td className={`${tdBase} text-[10px] text-slate-300 font-medium whitespace-nowrap tabular-nums`}><div className="flex items-center justify-center gap-1.5">${row.price.toFixed(2)}{row.vwapStatus !== 'neutral' && (<div onClick={(e) => { e.stopPropagation(); toggleVwap(row.vwapStatus as 'above' | 'below'); }} className={`w-1.5 h-1.5 rounded-full shrink-0 cursor-pointer ${row.vwapStatus === 'above' ? 'bg-emerald-400' : 'bg-rose-500'} ${vwapFilter === row.vwapStatus ? 'ring-1 ring-white/40' : ''}`} title={`VWAP: ${row.vwapStatus} — click to filter`}></div>)}</div></td>
                        <td className={`${tdBase} text-[10px] font-bold whitespace-nowrap tabular-nums ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>{isPositive ? '+' : ''}{row.changePct.toFixed(2)}%</td>
                        <td className={`${tdBase} whitespace-nowrap`}><div className="flex items-center justify-center gap-1.5"><div className="flex items-center gap-0.5"><span className="text-[9px] font-bold text-slate-500">10</span><div className={`w-1.5 h-1.5 rounded-full ${emaDot(row.aboveEma10)}`} title={`10 EMA: ${row.aboveEma10 === null ? 'n/a' : row.aboveEma10 ? 'above' : 'below'}`}></div></div><div className="flex items-center gap-0.5"><span className="text-[9px] font-bold text-slate-500">21</span><div className={`w-1.5 h-1.5 rounded-full ${emaDot(row.aboveEma21)}`} title={`21 EMA: ${row.aboveEma21 === null ? 'n/a' : row.aboveEma21 ? 'above' : 'below'}`}></div></div></div></td>
                        <td className={`${tdBase} text-[10px] text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{formatNumber(row.vol)}</td>
                        <td className={`${tdBase} text-[10px] text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{formatCurrency(row.dVol)}</td>
                        <td className={`${tdBase} text-[10px] font-bold whitespace-nowrap tabular-nums ${getRvolColor(row.rvol)}`}>{row.rvol ? `${row.rvol < 1 ? row.rvol.toFixed(1) : Math.round(row.rvol)}x` : '\u2014'}</td>
                        <td className={`${tdBase} text-[10px] font-bold whitespace-nowrap tabular-nums ${getFloatColor(row.float)}`}>{formatNumber(row.float)}</td>
                        <td className={`${tdBase} text-[10px] font-bold whitespace-nowrap tabular-nums ${row.adrPct != null ? getAdrColor(row.adrPct) : 'text-slate-600'}`}>{row.adrPct != null ? `${row.adrPct.toFixed(1)}%` : '\u2014'}</td>
                        <td className={`${tdBase} text-[10px] font-bold whitespace-nowrap tabular-nums ${row.mf != null ? mfColor(row.mf) : 'text-slate-600'}`} title={row.mf != null ? `Money Flow ${row.mf.toFixed(0)} \u2014 ${mfLabel(row.mf)}` : undefined}>{row.mf != null ? `${row.mf.toFixed(0)}${mfArrow(row.mfTrend)}` : '\u2014'}</td>
                        <td className={`${tdBase} text-[10px] font-bold whitespace-nowrap tabular-nums ${getStochColor(row.stochK)}`}>{row.stochK != null ? row.stochK.toFixed(1) : '\u2014'}</td>
                        <td className={`${tdBase} text-[10px] font-bold whitespace-nowrap tabular-nums ${getDtcColor(row.daysToCover)}`} title="Days to cover \u2014 short interest divided by average daily volume.">{row.daysToCover != null ? row.daysToCover.toFixed(1) : '\u2014'}</td>
                        <td className={`${tdBase} text-[10px] text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{formatNumber(row.mktCap)}</td>
                        <td className={`${tdStage} whitespace-nowrap border-l border-white/5`} title={stageDescription(row.stage)}>
                          <span className={`inline-block px-1 py-[1px] rounded border text-[9px] font-bold tabular-nums tracking-wide cursor-help ${stageBadge(row.stage)}`}>{stageShort(row.stage)}</span>
                        </td>
                        <td className={tdSector}><span className="block truncate text-left text-[8px] font-semibold tracking-wide uppercase text-slate-400">{displaySector(row.sector, row.ticker)}</span></td>
                      </tr>
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
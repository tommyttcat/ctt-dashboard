'use client';

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

import { rsColor, rsTooltip } from '@/lib/indicators/rs';

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
import MetricsKey from './MetricsKey';
import { TOPMOVERS_META } from '@/lib/scanConfig';

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
  stage: string;
  setupName: string | null;
  conviction: number | null;
  aboveEma10: boolean | null;
  aboveEma21: boolean | null;
  stochK: number | null;
  rsRating: number | null;
}

type TabType = 'Mega Caps' | 'Gainers' | 'Losers' | 'ETF Gainers' | 'ETF Losers';
type SortDirection = 'asc' | 'desc';
type EmaFilterType = 'All' | '>10' | '>21' | 'Both';
type VwapFilterType = 'All' | 'above' | 'below';
type CnfFilterType = 'All' | 'A' | 'B' | 'C';

interface MovingAverage { label: string; value: number; above: boolean; }
interface Benchmark { symbol: string; price: number; day?: MovingAverage[]; week?: MovingAverage[]; mas?: MovingAverage[]; }

const formatTime = (timestamp: number | Date) => { if (!timestamp) return ''; const date = new Date(timestamp); return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'America/New_York' }); };
const formatNumber = (num: number | null) => { if (num === null || num === 0 || isNaN(num)) return '\u2014'; if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B'; if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M'; if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K'; return num.toLocaleString(); };
const formatCurrency = (num: number | null) => { if (num === null || num === 0 || isNaN(num)) return '\u2014'; if (num >= 1e9) return '$' + (num / 1e9).toFixed(1) + 'B'; if (num >= 1e6) return '$' + (num / 1e6).toFixed(1) + 'M'; return '$' + num.toLocaleString(); };
const formatSetupName = (name: string | null) => { if (!name || name === '-' || name === '\u2014') return null; if (name.includes('BB SQZ')) return 'BB SQZ'; if (name === 'Blue Dot Rev') return 'BD Rev'; return name; };
const isGenericCatalyst = (catalyst: string | null | undefined) => !catalyst || catalyst.toLowerCase().startsWith('technical momentum');

/* A row counts as having news only when there is a HEADLINE, not merely a
   tag. "Earnings" with no article behind it comes from the earnings calendar
   rather than the news feed — real information, but nothing to click, and an
   asterisk that opens nothing is worse than no asterisk. */
const hasNews = (row: MoverRow): boolean => !!(row.thesis && row.catalystUrl);

/* One tooltip, used by the asterisk and the catalyst cell, so the two can
   never describe the same article differently. */
const newsTooltip = (row: MoverRow): string => {
  if (!row.thesis) return '';
  const meta = [row.catalyst, row.newsPublisher, row.newsAge].filter(Boolean).join(' \u00b7 ');
  const lines = [meta, '', row.thesis];
  if (row.newsSentiment === 'negative') {
    lines.push('', 'Reads negative \u2014 the tag alone would not have told you that.');
  }
  return lines.filter((l, i) => l !== '' || i > 0).join('\n');
};
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
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [marketCapFilter, setMarketCapFilter] = useState<string>('All');
  const [emaFilter, setEmaFilter] = useState<EmaFilterType>('All');
  const [vwapFilter, setVwapFilter] = useState<VwapFilterType>('All');
  const [cnfFilter, setCnfFilter] = useState<CnfFilterType>('All');
  const [copied, setCopied] = useState<boolean>(false);
  const [scanMeta, setScanMeta] = useState<any>(null);

  useEffect(() => { setSortConfig(null); }, [activeTab]);

  useEffect(() => {
    let isMounted = true;
    const fetchDatabaseSnapshot = async () => {
      try {
        const res = await fetch(`/api/scanner/latest?t=${Date.now()}`, { cache: 'no-store' });
        const data = await res.json();
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
              newsAge: item.newsAge || null, newsSentiment: item.newsSentiment || null,
              stage: item.stage || '\u2014', setupName: item.setupName || null,
              conviction: item.conviction != null ? Number(item.conviction) : ((item.cnfScore ?? item.smbScore) ?? null),
              aboveEma10: item.aboveEma10 ?? null, aboveEma21: item.aboveEma21 ?? null,
              stochK: item.stochK ?? null, rsRating: item.rsRating ?? null,
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
  const handleVwapFilter = (val: VwapFilterType) => setVwapFilter(prev => prev === val ? 'All' : val);
  const handleCnfFilter = (val: CnfFilterType) => setCnfFilter(prev => prev === val ? 'All' : val);

  const sortedStocks = useMemo(() => {
    let currentList = topMoversData[activeTab] || [];
    if (marketCapFilter !== 'All') { currentList = currentList.filter(s => { const mc = s.mktCap; if (!mc) return true; if (marketCapFilter === 'Mega') return mc >= 200e9; if (marketCapFilter === 'Large') return mc >= 10e9 && mc < 200e9; if (marketCapFilter === 'Mid') return mc >= 2e9 && mc < 10e9; if (marketCapFilter === 'Small') return mc >= 300e6 && mc < 2e9; if (marketCapFilter === 'Micro') return mc < 300e6; return true; }); }
    if (emaFilter !== 'All') { currentList = currentList.filter(s => { if (emaFilter === '>10') return s.aboveEma10 === true; if (emaFilter === '>21') return s.aboveEma21 === true; if (emaFilter === 'Both') return s.aboveEma10 === true && s.aboveEma21 === true; return true; }); }
    if (vwapFilter !== 'All') { currentList = currentList.filter(s => s.vwapStatus === vwapFilter); }
    if (cnfFilter !== 'All') { currentList = currentList.filter(s => cnfGradeOf(s.conviction) === cnfFilter); }
    if (!sortConfig) return currentList.slice(0, 10);
    return [...currentList].sort((a, b) => { const aVal = a[sortConfig.key] as any; const bVal = b[sortConfig.key] as any; if (aVal === null || aVal === undefined) return 1; if (bVal === null || bVal === undefined) return -1; if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1; if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1; return 0; }).slice(0, 10);
  }, [topMoversData, activeTab, sortConfig, marketCapFilter, emaFilter, vwapFilter, cnfFilter]);

  const handleCopyTickers = async (e: React.MouseEvent) => { e.stopPropagation(); const tickers = sortedStocks.map(s => s.ticker).join(','); if (!tickers) return; try { await navigator.clipboard.writeText(tickers); } catch { const ta = document.createElement('textarea'); ta.value = tickers; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch {} document.body.removeChild(ta); } setCopied(true); setTimeout(() => setCopied(false), 1800); };

  const getSortIcon = (columnKey: keyof StockData) => sortConfig?.key === columnKey ? (sortConfig.direction === 'asc' ? ' \u2191' : ' \u2193') : '';
  const getSessionTextColor = () => { if (status.includes('Err') || status.includes('Offline')) return 'text-rose-500'; if (status.includes('Syncing')) return 'text-amber-500'; if (session === 'Pre-Market') return 'text-amber-500'; if (session === 'Open') return 'text-[#00e676]'; if (session === 'Post-Market') return 'text-indigo-400'; return 'text-slate-500'; };
  const getScoreBadge = (score: number | null) => { if (score == null) return 'bg-white/[0.02] text-slate-600 border-white/5'; if (score >= 70) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'; if (score >= 50) return 'bg-amber-500/10 text-amber-400 border-amber-500/20'; return 'bg-zinc-800/50 text-zinc-400 border-zinc-700/50'; };
  const getRvolColor = (rvol: number | null) => { if (!rvol) return 'text-slate-500'; if (rvol >= 2) return 'text-amber-400'; if (rvol >= 1.5) return 'text-emerald-400'; return 'text-slate-500'; };
  const getFloatColor = (float: number | null) => { if (!float) return 'text-slate-500'; if (float <= 20000000) return 'text-purple-400'; if (float <= 50000000) return 'text-emerald-400'; return 'text-slate-300'; };
  const getDtcColor = (d: number | null) => { if (d == null) return 'text-slate-500'; if (d >= 5) return 'text-purple-400'; if (d >= 3) return 'text-emerald-400'; if (d >= 1.5) return 'text-slate-300'; return 'text-slate-500'; };
  const getStochColor = (k: number | null) => { if (k == null) return 'text-slate-500'; if (k <= 20) return 'text-purple-400'; if (k <= 30) return 'text-emerald-400'; return 'text-slate-400'; };
  const emaDot = (state: boolean | null) => { if (state === null) return 'bg-slate-600'; return state ? 'bg-emerald-400' : 'bg-rose-500'; };

  const thBase = "px-3 py-3 text-[10px] text-slate-500 font-bold tracking-wider cursor-pointer hover:text-slate-300 transition-colors text-center";
  const tdBase = "px-3 py-3 text-center";
  const filterBtnActive = "bg-[#1e293b] text-indigo-400 border border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.1)]";
  const filterBtnIdle = "text-slate-500 border border-transparent hover:text-slate-300 hover:bg-white/[0.02]";
  const pillWrap = "flex items-center gap-1.5 px-2 py-0.5 bg-[#161c2a] border border-white/5 rounded-lg shrink-0";
  const pillLabel = "text-[8px] font-bold tracking-widest uppercase text-slate-500";
  const pillBtn = "px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase transition-all duration-300 whitespace-nowrap";

  return (
    <div className="bg-[#101623] border border-white/5 rounded-2xl p-4 md:p-8 relative overflow-visible shadow-xl w-full max-w-[1280px] mx-auto">
      <div onClick={() => setIsExpanded(!isExpanded)} className={`flex justify-between items-center relative z-30 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-6 border-b border-white/5 pb-4' : ''}`}>
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
          <span className="relative z-40 inline-flex">
            <MetricsKey meta={TOPMOVERS_META} liveGates={scanMeta?.gates} />
          </span>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-center justify-center border border-white/5 bg-[#161c2a]/40 px-4 py-1.5 rounded-[10px] min-w-[120px]">
            <span className={`text-[10px] font-bold tracking-widest uppercase ${getSessionTextColor()}`}>{status === 'Live' ? session : status}</span>
          </div>
          {lastScanTime && (<span className="text-[11px] text-slate-400/80 font-medium px-1 tracking-wide">Updated: {formatTime(lastScanTime)} EST</span>)}
        </div>
      </div>

      {isExpanded && (
        <>
          <div className="flex flex-col gap-3 mb-6 relative z-0 pb-2">
            <div className="flex flex-wrap justify-center items-center gap-3 w-full">
              <div className="flex gap-3 overflow-x-auto custom-scrollbar" style={{ scrollbarWidth: 'none' }}>
                {(['Mega Caps', 'Gainers', 'Losers', 'ETF Gainers', 'ETF Losers'] as TabType[]).map((tab) => (
                  <button key={tab} onClick={(e) => { e.stopPropagation(); setActiveTab(tab); }} className={`px-5 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-all duration-300 ${activeTab === tab ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.1)]' : 'bg-[#161c2a] text-slate-400 border border-white/5 hover:bg-white/[0.04]'}`}>
                    {tab}
                  </button>
                ))}
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
              <div className={pillWrap}>
                <span className={pillLabel}>VWAP</span>
                <div className="flex items-center gap-0.5">
                  <button onClick={() => handleVwapFilter('above')} className={`flex items-center gap-1 ${pillBtn} ${vwapFilter === 'above' ? filterBtnActive : filterBtnIdle}`}>
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400"></div>Above
                  </button>
                  <button onClick={() => handleVwapFilter('below')} className={`flex items-center gap-1 ${pillBtn} ${vwapFilter === 'below' ? filterBtnActive : filterBtnIdle}`}>
                    <div className="w-1.5 h-1.5 rounded-full bg-rose-500"></div>Below
                  </button>
                </div>
              </div>
              {benchmark && (() => {
                const activeMas = maTimeframe === 'day' ? (benchmark.day || benchmark.mas || []) : (benchmark.week || []);
                const unit = maTimeframe === 'day' ? 'D' : 'W';
                return (
                  <div className={pillWrap}>
                    <span className="text-[8px] font-bold tracking-widest uppercase text-[#7c8bfa]">{benchmark.symbol}</span>
                    <div className="flex items-center bg-[#0b101a] border border-white/5 rounded-md p-0.5">
                      {(['day', 'week'] as const).map((tf) => (
                        <button key={tf} onClick={() => setMaTimeframe(tf)} className={`px-1.5 py-0.5 rounded text-[8px] font-bold tracking-widest uppercase transition-colors ${maTimeframe === tf ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-500 hover:text-slate-300'}`}>
                          {tf === 'day' ? 'Day' : 'Week'}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {activeMas.map((m, idx) => (
                        <React.Fragment key={m.label}>
                          {idx > 0 && <span className="text-[9px] text-slate-600">|</span>}
                          <div className="flex items-center gap-1" title={`${benchmark.symbol} ${m.label}${unit} SMA: $${m.value.toFixed(2)} \u2014 ${m.above ? 'above' : 'below'}`}>
                            <span className="text-[9px] font-medium text-slate-400">{m.label}</span>
                            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${m.above ? 'bg-emerald-400' : 'bg-rose-500'}`}></div>
                          </div>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
          
          <div className="overflow-x-auto custom-scrollbar" style={{ scrollbarWidth: 'none' }}>
            <table className="w-full min-w-[1250px] table-fixed border-collapse">
              <thead>
                <tr className="border-b border-white/5 select-none">
                  <th className={`${thBase} w-[7%]`} onClick={() => handleSort('ticker')}>TICKER{getSortIcon('ticker')}</th>
                  <th className={`${thBase} w-[5%]`} onClick={() => handleSort('conviction')}>CNF{getSortIcon('conviction')}</th>
                  <th className={`${thBase} w-[7%]`} onClick={() => handleSort('price')}>PRICE{getSortIcon('price')}</th>
                  <th className={`${thBase} w-[6%]`} onClick={() => handleSort('changePct')}>CHG%{getSortIcon('changePct')}</th>
                  <th className={`${thBase} w-[6%]`}>10/21</th>
                  <th className={`${thBase} w-[6%]`} onClick={() => handleSort('vol')}>VOL{getSortIcon('vol')}</th>
                  <th className={`${thBase} w-[6%]`} onClick={() => handleSort('dVol')}>$VOL{getSortIcon('dVol')}</th>
                  <th className={`${thBase} w-[5%]`} onClick={() => handleSort('rvol')}>RVOL{getSortIcon('rvol')}</th>
                  <th className={`${thBase} w-[6%]`} onClick={() => handleSort('float')}>FLOAT{getSortIcon('float')}</th>
                  <th className={`${thBase} w-[6%]`} onClick={() => handleSort('rsRating')}>RS{getSortIcon('rsRating')}</th>
                  <th className={`${thBase} w-[6%]`} onClick={() => handleSort('stochK')}>STOCH{getSortIcon('stochK')}</th>
                  <th className={`${thBase} w-[5%]`} onClick={() => handleSort('daysToCover')}>DTC{getSortIcon('daysToCover')}</th>
                  <th className={`${thBase} w-[6%]`} onClick={() => handleSort('mktCap')}>MCAP{getSortIcon('mktCap')}</th>
                  <th className={`${thBase} w-[9%] border-l border-white/5`} onClick={() => handleSort('sector')}>SECTOR{getSortIcon('sector')}</th>
                  <th className={`${thBase} w-[14%]`} onClick={() => handleSort('catalyst')}>CATALYST{getSortIcon('catalyst')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {status.includes('Syncing') && topMoversData[activeTab].length === 0 ? (
                  <tr><td colSpan={15} className="py-12 text-center"><div className="w-5 h-5 border-2 border-indigo-500/20 border-t-indigo-400 rounded-full animate-spin mx-auto mb-3"></div><span className="text-xs text-slate-500 font-medium">Fetching DB Snapshot...</span></td></tr>
                ) : sortedStocks.length === 0 ? (
                  <tr><td colSpan={15} className="py-12 text-center text-slate-500 text-sm font-medium">No tracking instruments currently found matching criteria.</td></tr>
                ) : (
                  sortedStocks.map((row, i) => {
                    const isPositive = row.changePct >= 0;
                    return (
                      <tr key={i} className="hover:bg-white/[0.02] transition-colors group">
                        <td className={tdBase}>
                          <span className="inline-flex items-center justify-center gap-0.5">
                            <span className="inline-block bg-indigo-500/10 text-[#7c8bfa] text-[11px] font-bold px-2 py-0.5 rounded border border-indigo-500/20 cursor-help" title={row.name || row.ticker}>{row.ticker}</span>
                            {/* Fixed-width slot whether or not there is news, so
                                the CHG% column starts at the same x on every
                                row. An asterisk that only sometimes occupies
                                space would shift the whole table on exactly the
                                rows worth looking at. */}
                            <span className="inline-block w-[10px] text-center leading-none">
                              {hasNews(row) && (
                                <a
                                  href={row.catalystUrl!}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={newsTooltip(row)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-amber-400/90 hover:text-amber-300 font-bold text-[11px] cursor-pointer transition-colors"
                                >
                                  *
                                </a>
                              )}
                            </span>
                          </span>
                        </td>
                        <td className={tdBase}><span className={`inline-block whitespace-nowrap px-1.5 py-[2px] rounded text-[9px] font-bold border ${getScoreBadge(row.conviction)}`}>{row.conviction != null ? row.conviction : '--'}</span></td>
                        <td className={`${tdBase} text-xs text-slate-300 font-medium whitespace-nowrap tabular-nums`}><div className="flex items-center justify-center gap-1.5">${row.price.toFixed(2)}{row.vwapStatus !== 'neutral' && (<div className={`w-1.5 h-1.5 rounded-full shrink-0 ${row.vwapStatus === 'above' ? 'bg-emerald-400' : 'bg-rose-500'}`} title={`VWAP: ${row.vwapStatus}`}></div>)}</div></td>
                        <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>{isPositive ? '+' : ''}{row.changePct.toFixed(2)}%</td>
                        <td className={`${tdBase} whitespace-nowrap`}><div className="flex items-center justify-center gap-1.5"><div className="flex items-center gap-0.5"><span className="text-[9px] font-bold text-slate-500">10</span><div className={`w-1.5 h-1.5 rounded-full ${emaDot(row.aboveEma10)}`} title={`10 EMA: ${row.aboveEma10 === null ? 'n/a' : row.aboveEma10 ? 'above' : 'below'}`}></div></div><div className="flex items-center gap-0.5"><span className="text-[9px] font-bold text-slate-500">21</span><div className={`w-1.5 h-1.5 rounded-full ${emaDot(row.aboveEma21)}`} title={`21 EMA: ${row.aboveEma21 === null ? 'n/a' : row.aboveEma21 ? 'above' : 'below'}`}></div></div></div></td>
                        <td className={`${tdBase} text-xs text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{formatNumber(row.vol)}</td>
                        <td className={`${tdBase} text-xs text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{formatCurrency(row.dVol)}</td>
                        <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getRvolColor(row.rvol)}`}>{row.rvol ? `${row.rvol.toFixed(1)}x` : '\u2014'}</td>
                        <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getFloatColor(row.float)}`}>{formatNumber(row.float)}</td>
                        <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums cursor-help ${rsColor(row.rsRating)}`} title={rsTooltip(row.rsRating)}>{row.rsRating ?? '\u2014'}</td>
                        <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getStochColor(row.stochK)}`}>{row.stochK != null ? row.stochK.toFixed(1) : '\u2014'}</td>
                        <td className={`${tdBase} text-xs font-bold whitespace-nowrap tabular-nums ${getDtcColor(row.daysToCover)}`} title="Days to cover \u2014 short interest divided by average daily volume.">{row.daysToCover != null ? row.daysToCover.toFixed(1) : '\u2014'}</td>
                        <td className={`${tdBase} text-xs text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{formatNumber(row.mktCap)}</td>
                        <td className={`${tdBase} border-l border-white/5`}><span className="block truncate text-[10px] font-semibold tracking-wide uppercase text-slate-400">{row.sector || '\u2014'}</span></td>
                        <td className={`${tdBase} text-[10px] whitespace-normal break-words`}>
                          {!isGenericCatalyst(row.catalyst) ? (
                            <span className="flex flex-col leading-tight" title={newsTooltip(row) || undefined}>
                              {row.catalystUrl ? (
                                <a href={row.catalystUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-300/90 font-medium hover:text-[#7c8bfa] transition-colors hover:underline">{row.catalyst}</a>
                              ) : (
                                <span className="text-indigo-300/90 font-medium">{row.catalyst}</span>
                              )}
                              {/* Publisher and age under the tag. "Contract" is
                                  the same word for a $2M reseller deal and a
                                  $200M defence award; the source and how long
                                  ago it landed are the cheapest available
                                  discriminators, and both fit on one line. */}
                              {(row.newsPublisher || row.newsAge) && (
                                <span className="text-[9px] text-slate-500 font-medium truncate">
                                  {[row.newsPublisher, row.newsAge].filter(Boolean).join(' \u00b7 ')}
                                </span>
                              )}
                            </span>
                          ) : formatSetupName(row.setupName) ? (
                            <span className="text-slate-400 font-medium whitespace-nowrap">{formatSetupName(row.setupName)}</span>
                          ) : (<span className="text-slate-500 font-medium">Technical</span>)}
                        </td>
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
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { fetchScannerLatest } from '@/lib/scannerLatest';
import { useMarketData } from './MarketDataContext';
import { stageBadge, stageShort, stageDescription } from '@/lib/indicators/stage';
import { rsBadge, rsTooltip } from '@/lib/indicators/rs';
import { CatalystChip, NewsStars, catalystTooltip } from '@/lib/catalyst';
import { displaySector } from '@/lib/sectors';
import { mfColor, mfLabel, mfArrow } from '@/lib/indicators/moneyflow';
import TickerChartHover, { useFreezeWhileChartOpen, WatchlistBtn } from './TickerChartHover';
import { WatchlistToggle } from './WatchlistPanel';
import { rvolColor as getRvolColor, adrColor as getAdrColor, tickerChipForScore, tickerTitle, scoreCellCls } from '@/lib/indicators/columnColors';

interface HighBetaRow {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  changePct: number;
  vol: number;
  dVol: number;
  rvol: number | null;
  mktCap: number | null;
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
  rsRating: number | null;
  adrPct: number | null;
  beta: number | null;
  alpha: number | null;
  mf: number | null;
  mfTrend: number;
  aboveEma10: boolean | null;
  aboveEma21: boolean | null;
}

type SortKey = keyof HighBetaRow;
type SortDirection = 'asc' | 'desc';

const formatNumber = (num: number | null) => { if (num === null || num === 0 || isNaN(num)) return '—'; if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B'; if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M'; if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K'; return num.toLocaleString(); };
const formatCurrency = (num: number | null) => { if (num === null || num === 0 || isNaN(num)) return '—'; if (num >= 1e9) return '$' + (num / 1e9).toFixed(1) + 'B'; if (num >= 1e6) return '$' + (num / 1e6).toFixed(1) + 'M'; return '$' + num.toLocaleString(); };
const formatTime = (ts: number | Date) => { if (!ts) return ''; return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }); };

const betaColor = (b: number | null): string => {
  if (b == null) return 'text-slate-600';
  if (b >= 2.5) return 'text-rose-400';
  if (b >= 2.0) return 'text-rose-400/80';
  if (b >= 1.5) return 'text-amber-400';
  return 'text-slate-400';
};

const alphaColor = (a: number | null): string => {
  if (a == null) return 'text-slate-600';
  if (a >= 0.5) return 'text-emerald-400';
  if (a > 0) return 'text-emerald-400/80';
  if (a < -0.5) return 'text-rose-400';
  if (a < 0) return 'text-rose-400/80';
  return 'text-slate-400';
};

const NEGATIVE_NOTE = 'Reads negative — the tag alone would not have told you that.';

export default function HighBeta() {
  const { session } = useMarketData();
  const [rows, setRows] = useState<HighBetaRow[]>([]);
  const [status, setStatus] = useState('Syncing DB...');
  const [lastScanTime, setLastScanTime] = useState<number | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: SortDirection } | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let mounted = true;
    const fetch_ = async () => {
      try {
        const data = await fetchScannerLatest();
        if (mounted && data.success && Array.isArray(data.highBeta)) {
          setRows(data.highBeta.map((item: any) => ({
            ticker: item.ticker || '—',
            name: item.name || '',
            sector: item.sector || '',
            price: Number(item.price) || 0,
            changePct: Number((item.change ?? item.changePct) || 0),
            vol: Number((item.volume ?? item.vol) || 0),
            dVol: Number(item.dVol) || (Number(item.price || 0) * Number((item.volume ?? item.vol) || 0)),
            rvol: item.rvol || null,
            mktCap: item.mktCap || null,
            catalyst: item.catalyst || null,
            catalystUrl: item.catalystUrl || null,
            thesis: item.thesis || null,
            newsPublisher: item.newsPublisher || null,
            newsAge: item.newsAge || null,
            newsSentiment: item.newsSentiment || null,
            newsCausal: item.newsCausal ?? null,
            stage: item.stage || '—',
            setupName: item.setupName || null,
            conviction: item.conviction != null ? Number(item.conviction) : ((item.cnfScore ?? item.smbScore) ?? null),
            rsRating: item.rsRating ?? null,
            adrPct: item.adrPct ?? null,
            beta: item.beta ?? null,
            alpha: item.alpha ?? null,
            mf: item.mf ?? null,
            mfTrend: item.mfTrend ?? 0,
            aboveEma10: item.aboveEma10 ?? null,
            aboveEma21: item.aboveEma21 ?? null,
          })));
          setLastScanTime(data.lastScanTime || Date.now());
          setStatus('Live');
        }
      } catch { if (mounted) setStatus('DB Offline'); }
    };
    fetch_();
    const interval = setInterval(fetch_, 60000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  const computedRows = useMemo(() => {
    if (!sortConfig) return [...rows].sort((a, b) => (b.beta ?? 0) - (a.beta ?? 0));
    return [...rows].sort((a, b) => {
      const av = a[sortConfig.key] as any;
      const bv = b[sortConfig.key] as any;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return sortConfig.direction === 'asc' ? -1 : 1;
      if (av > bv) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [rows, sortConfig]);

  const sortedStocks = useFreezeWhileChartOpen(computedRows);

  const handleSort = (key: SortKey) => {
    if (sortConfig?.key === key && sortConfig.direction === 'desc') setSortConfig({ key, direction: 'asc' });
    else if (sortConfig?.key === key && sortConfig.direction === 'asc') setSortConfig(null);
    else setSortConfig({ key, direction: 'desc' });
  };

  const handleCopyTickers = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const tickers = sortedStocks.map(s => s.ticker).join(',');
    if (!tickers) return;
    try { await navigator.clipboard.writeText(tickers); } catch {
      const ta = document.createElement('textarea'); ta.value = tickers; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch {} document.body.removeChild(ta);
    }
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  };

  const getSortIcon = (key: SortKey) => sortConfig?.key === key ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓') : '';
  const getSessionColor = () => { if (status.includes('Err') || status.includes('Offline')) return 'text-rose-500'; if (status.includes('Syncing')) return 'text-amber-500'; if (session === 'Pre-Market') return 'text-amber-500'; if (session === 'Open') return 'text-[#00e676]'; if (session === 'Post-Market') return 'text-indigo-400'; return 'text-slate-500'; };
  const emaDot = (state: boolean | null) => state === null ? 'bg-slate-600' : state ? 'bg-emerald-400' : 'bg-rose-500';

  const thBase = "px-0.5 py-2.5 text-[10px] text-slate-500 font-bold tracking-wide leading-tight cursor-pointer hover:text-slate-300 transition-colors text-center";
  const tdBase = "px-0.5 pt-2.5 pb-1.5 text-center";
  const thStage = "px-0.5 pl-1.5 py-2.5 text-[10px] text-slate-500 font-bold tracking-wide leading-tight cursor-pointer hover:text-slate-300 transition-colors text-left";
  const tdStage = "px-0.5 pl-1.5 pt-2.5 pb-1.5 text-left";
  const thSector = "px-0.5 pl-1.5 py-2.5 text-[10px] text-slate-500 font-bold tracking-wide leading-tight cursor-pointer hover:text-slate-300 transition-colors text-left";
  const tdSector = "px-0.5 pl-1.5 pt-2.5 pb-1.5 text-left";

  return (
    <div className="bg-[#101623] border-0 md:border md:border-white/5 md:rounded-2xl p-2 md:p-5 relative overflow-visible md:shadow-xl w-full max-w-[1280px] mx-auto">
      <div onClick={() => setIsExpanded(!isExpanded)} className={`flex justify-between items-center relative z-30 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-5 border-b border-white/5 pb-4' : ''}`}>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs md:text-sm font-bold text-rose-400 bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 group-hover:bg-white/[0.02] transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
            HIGH BETA
          </span>
          {sortedStocks.length > 0 && (
            <button onClick={handleCopyTickers} title={`Copy ${sortedStocks.length} tickers`} className={`text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded border transition-all duration-200 ${copied ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-[#161c2a] text-slate-400 border-white/5 hover:text-slate-200 hover:bg-white/[0.04]'}`}>
              {copied ? `✓ Copied ${sortedStocks.length}` : `Copy ${sortedStocks.length}`}
            </button>
          )}
          <span className="hidden md:block basis-full text-[10px] font-bold tracking-wider uppercase text-slate-500 mt-1">
            β ≥ 1.5 · Sorted by beta · {sortedStocks.length} stocks
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex flex-col items-center gap-1.5">
            <div className="flex items-center justify-center border border-white/5 bg-[#161c2a]/40 px-4 py-1.5 rounded-[10px] min-w-[120px]">
              <span className={`text-[10px] font-bold tracking-widest uppercase ${getSessionColor()}`}>{status === 'Live' ? session : status}</span>
            </div>
            {lastScanTime && (<span className="text-[11px] text-slate-400/80 font-medium px-1 tracking-wide whitespace-nowrap">Scanned: {formatTime(lastScanTime)} EST</span>)}
          </div>
          <WatchlistToggle />
        </div>
      </div>

      {isExpanded && (
        <div className="overflow-x-auto custom-scrollbar" style={{ scrollbarWidth: 'none' }}>
          <table className="w-full min-w-[940px] table-fixed border-collapse">
            <thead>
              <tr className="border-b border-white/5 select-none">
                <th className={`${thBase} w-[7%] !text-left pl-1`} onClick={() => handleSort('ticker')}>TICKER{getSortIcon('ticker')}</th>
                <th className={`${thBase} w-[2%]`} title="News">N</th>
                <th className={`${thBase} w-[4%]`} onClick={() => handleSort('conviction')}>CNF{getSortIcon('conviction')}</th>
                <th className={`${thBase} w-[4%]`} onClick={() => handleSort('rsRating')}>RS{getSortIcon('rsRating')}</th>
                <th className={`${thBase} w-[6%]`} onClick={() => handleSort('price')}>PRICE{getSortIcon('price')}</th>
                <th className={`${thBase} w-[5%]`} onClick={() => handleSort('changePct')}>CHG%{getSortIcon('changePct')}</th>
                <th className={`${thBase} w-[5%]`} onClick={() => handleSort('beta')}>BETA{getSortIcon('beta')}</th>
                <th className={`${thBase} w-[5%]`} onClick={() => handleSort('alpha')}>ALPHA{getSortIcon('alpha')}</th>
                <th className={`${thBase} w-[5%]`}>10/21</th>
                <th className={`${thBase} w-[5%]`} onClick={() => handleSort('vol')}>VOL{getSortIcon('vol')}</th>
                <th className={`${thBase} w-[5%]`} onClick={() => handleSort('dVol')}>$VOL{getSortIcon('dVol')}</th>
                <th className={`${thBase} w-[5%]`} onClick={() => handleSort('rvol')}>RVOL{getSortIcon('rvol')}</th>
                <th className={`${thBase} w-[5%]`} onClick={() => handleSort('adrPct')}>ADR{getSortIcon('adrPct')}</th>
                <th className={`${thBase} w-[4%]`} onClick={() => handleSort('mf')}>MF{getSortIcon('mf')}</th>
                <th className={`${thBase} w-[5%]`} onClick={() => handleSort('mktCap')}>MCAP{getSortIcon('mktCap')}</th>
                <th className={`${thStage} w-[5%] border-l border-white/5`} onClick={() => handleSort('stage')}>STAGE{getSortIcon('stage')}</th>
                <th className={`${thSector} w-[7%]`} onClick={() => handleSort('sector')}>SECTOR{getSortIcon('sector')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {status.includes('Syncing') && rows.length === 0 ? (
                <tr><td colSpan={17} className="py-12 text-center"><div className="w-5 h-5 border-2 border-white/10 border-t-rose-400 rounded-full animate-spin mx-auto mb-3"></div><span className="text-xs text-slate-500 font-medium">Fetching DB Snapshot...</span></td></tr>
              ) : sortedStocks.length === 0 ? (
                <tr><td colSpan={17} className="py-12 px-8 text-center"><span className="block text-slate-500 text-sm font-medium max-w-[560px] mx-auto leading-relaxed">No high-beta stocks in the current scan. Beta requires at least 30 paired daily returns with SPY — names with insufficient history are excluded.</span></td></tr>
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
                      <td className={`${tdBase} text-[10px] text-slate-300 font-medium whitespace-nowrap tabular-nums`}>${row.price.toFixed(2)}</td>
                      <td className={`${tdBase} text-[10px] font-bold whitespace-nowrap tabular-nums ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>{isPositive ? '+' : ''}{row.changePct.toFixed(2)}%</td>
                      <td className={`${tdBase} text-[10px] font-bold whitespace-nowrap tabular-nums ${betaColor(row.beta)}`} title={row.beta != null ? `Beta ${row.beta.toFixed(2)} — sensitivity to SPY over 60 trading days` : undefined}>{row.beta != null ? row.beta.toFixed(2) : '—'}</td>
                      <td className={`${tdBase} text-[10px] font-bold whitespace-nowrap tabular-nums ${alphaColor(row.alpha)}`} title={row.alpha != null ? `Alpha ${row.alpha >= 0 ? '+' : ''}${row.alpha.toFixed(2)} — annualized excess return beyond what beta predicts` : undefined}>{row.alpha != null ? `${row.alpha >= 0 ? '+' : ''}${row.alpha.toFixed(2)}` : '—'}</td>
                      <td className={`${tdBase} whitespace-nowrap`}><div className="flex items-center justify-center gap-1.5"><div className="flex items-center gap-0.5"><span className="text-[9px] font-bold text-slate-500">10</span><div className={`w-1.5 h-1.5 rounded-full ${emaDot(row.aboveEma10)}`} title={`10 EMA: ${row.aboveEma10 === null ? 'n/a' : row.aboveEma10 ? 'above' : 'below'}`}></div></div><div className="flex items-center gap-0.5"><span className="text-[9px] font-bold text-slate-500">21</span><div className={`w-1.5 h-1.5 rounded-full ${emaDot(row.aboveEma21)}`} title={`21 EMA: ${row.aboveEma21 === null ? 'n/a' : row.aboveEma21 ? 'above' : 'below'}`}></div></div></div></td>
                      <td className={`${tdBase} text-[10px] text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{formatNumber(row.vol)}</td>
                      <td className={`${tdBase} text-[10px] text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{formatCurrency(row.dVol)}</td>
                      <td className={`${tdBase} text-[10px] font-bold whitespace-nowrap tabular-nums ${getRvolColor(row.rvol)}`}>{row.rvol ? `${row.rvol < 1 ? row.rvol.toFixed(1) : Math.round(row.rvol)}x` : '—'}</td>
                      <td className={`${tdBase} text-[10px] font-bold whitespace-nowrap tabular-nums ${row.adrPct != null ? getAdrColor(row.adrPct) : 'text-slate-600'}`}>{row.adrPct != null ? `${row.adrPct.toFixed(1)}%` : '—'}</td>
                      <td className={`${tdBase} text-[10px] font-bold whitespace-nowrap tabular-nums ${row.mf != null ? mfColor(row.mf) : 'text-slate-600'}`} title={row.mf != null ? `Money Flow ${row.mf.toFixed(0)} — ${mfLabel(row.mf)}` : undefined}>{row.mf != null ? `${row.mf.toFixed(0)}${mfArrow(row.mfTrend)}` : '—'}</td>
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
      )}
    </div>
  );
}

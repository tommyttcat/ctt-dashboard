'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { cachedJson } from '@/lib/scannerLatest';
import TickerChartHover, { useFreezeWhileChartOpen } from './TickerChartHover';
import { CatalystChip } from '@/lib/catalyst';
import { rsBadge } from '@/lib/indicators/rs';
import {
  tickerChipForScore, cnfBadgeCls, stochColor, dtcColor, floatColor, rvolColor,
} from '@/lib/indicators/columnColors';
import { displaySector } from '@/lib/sectors';
import { stageBadge, stageShort, stageDescription } from '@/lib/indicators/stage';
import { useMarketData } from './MarketDataContext';

/* This card's reading of negative news: the move already happened, so a
   bearish headline behind a +4% print is the thing to notice. */
const NEGATIVE_NOTE = 'Reads negative — size came in on bad news, which is distribution rather than accumulation.';

/* Dollar-volume scanner — where the money actually is.
 *
 * Reads /api/dvol/latest, which is built from Polygon's grouped daily endpoint
 * across the WHOLE US market. It used to screen MarketDataContext's snapshot:
 * the 60-70 names other scans had already flagged, which could only ever
 * answer "where is the money among the names we already picked".
 *
 * ONE LIST, in the TopMovers row format. A side-by-side split was tried and
 * dropped: sharing TopMovers' columns means sharing its shape, and two halves
 * of the same table read as two different tables.
 */

/* BANDS, not floors. "$20M" used to mean "$20M and up", which made every pill
   a subset of the one before it — picking 20 could only ever remove names from
   the 10 view, so there was no way to look at the $10-20M cohort on its own.
   Each pill is now a range, except the top one which stays open-ended. */
const DVOL_BANDS = [
  { key: 20, label: '20-50M', min: 20e6, max: 50e6 },
  { key: 50, label: '50-100M', min: 50e6, max: 100e6 },
  { key: 100, label: '100M+', min: 100e6, max: Infinity },
] as const;
type DvolStep = (typeof DVOL_BANDS)[number]['key'];

const CAP_BANDS = {
  Nano: { min: 0, max: 50e6 },
  Micro: { min: 50e6, max: 300e6 },
  Small: { min: 300e6, max: 2e9 },
  Mid: { min: 2e9, max: 10e9 },
  Large: { min: 10e9, max: Infinity },
} as const;
type CapBand = keyof typeof CAP_BANDS;
const CAP_ORDER = Object.keys(CAP_BANDS) as CapBand[];

const SHOWN = 40;

type Row = {
  ticker: string;
  price: number;
  open: number | null;
  high: number | null;
  low: number | null;
  vwap: number | null;
  vol: number;
  dvol: number;
  avgVol: number | null;
  rvol: number | null;
  changePct: number | null;
  rangePos: number | null;
  mktCap: number | null;
  type: string | null;
  adrPct: number | null;
  stage: string | null;
  rsRating: number | null;
  sector: string | null;
  float: number | null;
  daysToCover: number | null;
  stochK: number | null;
  aboveEma10: boolean | null;
  aboveEma21: boolean | null;
  distToEma21: number | null;
  cnfScore: number | null;
  cnfGrade: string | null;
  cnfBreakdown: Record<string, number> | null;
  cnfCeiling: number | null;
  cnfCeilingReason: string | null;
  catalyst: string | null;
  catalystUrl: string | null;
  thesis: string | null;
  newsPublisher: string | null;
  newsAge: string | null;
  newsSentiment: string | null;
  newsCausal: boolean | null;
};

const fmtDvol = (v: number | null): string =>
  v == null ? '—'
  : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B`
  : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M`
  : `$${(v / 1e3).toFixed(0)}K`;

const fmtCap = (v: number | null | undefined): string => {
  if (v == null) return '—';
  if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${(v / 1e3).toFixed(0)}K`;
};

const fmtVol = (v: number | null): string =>
  v == null ? '—' : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(v);

const emaDot = (above: boolean | null | undefined): string =>
  above == null ? 'bg-slate-600' : above ? 'bg-emerald-400' : 'bg-rose-500';

const emaTitle = (r: { aboveEma10: boolean | null; aboveEma21: boolean | null; distToEma21: number | null }): string => {
  const bits = [
    `10 EMA: ${r.aboveEma10 == null ? 'n/a' : r.aboveEma10 ? 'above' : 'below'}`,
    `21 EMA: ${r.aboveEma21 == null ? 'n/a' : r.aboveEma21 ? 'above' : 'below'}`,
  ];
  if (r.distToEma21 != null) bits.push(`${r.distToEma21 >= 0 ? '+' : ''}${r.distToEma21.toFixed(1)}% from the 21`);
  return bits.join(' · ');
};

/* The CNF hover, in the same shape the other tables use: the grade line, then
   the per-term breakdown, then any ceiling that capped it. */
const cnfTooltip = (r: {
  cnfScore: number | null; cnfGrade: string | null;
  cnfBreakdown: Record<string, number> | null;
  cnfCeiling: number | null; cnfCeilingReason: string | null;
}): string => {
  const lines = [`CNF ${r.cnfScore} — ${r.cnfGrade || '—'}`];
  if (r.cnfBreakdown) {
    const parts = Object.entries(r.cnfBreakdown).filter(([, v]) => v !== 0);
    if (parts.length) {
      lines.push('');
      for (const [k, v] of parts) lines.push(`${v > 0 ? '+' : ''}${v}  ${k}`);
    }
  }
  if (r.cnfCeiling != null && r.cnfCeiling < 100) {
    lines.push('');
    lines.push(`Capped at ${r.cnfCeiling}${r.cnfCeilingReason ? ` — ${r.cnfCeilingReason}` : ''}`);
  }
  lines.push('');
  lines.push('Scored without scan-streak, dot, trade-plan or sector-heat input — those terms are neutral on this board.');
  return lines.join('\n');
};

const capBandOf = (mc: number | null | undefined): CapBand | null => {
  if (mc == null || !isFinite(mc)) return null;
  for (const band of CAP_ORDER) {
    const { min, max } = CAP_BANDS[band];
    if (mc >= min && mc < max) return band;
  }
  return null;
};

const ETF_TYPES = new Set(['ETF', 'ETN', 'ETV', 'ETS', 'FUND']);

/* Funds have no market cap by nature. Showing "ETF" rather than an em dash
   distinguishes "this instrument has no cap" from "the lookup failed". */
const bandLabel = (r: { mktCap: number | null; type: string | null }): string => {
  const band = capBandOf(r.mktCap);
  if (band) return band;
  if (r.type && ETF_TYPES.has(r.type)) return 'ETF';
  return '—';
};

/* Every column is sortable, so each one declares how to read its own value
   rather than the sort switching on a string key in one place. `dir` is the
   direction a first click should use — money and size want biggest-first,
   the ticker wants A-Z. */
type SortKey =
  | 'ticker' | 'cnf' | 'price' | 'changePct' | 'ema' | 'vol' | 'dvol' | 'rvol'
  | 'float' | 'rsRating' | 'stoch' | 'dtc' | 'mktCap' | 'stage' | 'sector';

const COLUMNS: {
  key: SortKey;
  label: string;
  align: 'left' | 'right';
  dir: 'asc' | 'desc';
  get: (r: Row) => number | string | null;
  tip: string;
  /* Vertical rule to the LEFT of this column, closing off the numeric block —
     the same divider SIPs puts before STAGE. */
  divider?: boolean;
}[] = [
  { key: 'ticker', label: 'Ticker', align: 'left', dir: 'asc', get: r => r.ticker,
    tip: 'Symbol, tinted by CNF grade. Hover for the chart.' },
  { key: 'cnf', label: 'CNF', align: 'right', dir: 'desc', get: r => r.cnfScore,
    tip: 'Confluence score 0-100, from the same scorer the daily scan grades with — so a stock on both boards carries one CNF, not two. This scan has no scan-streak, dot, trade-plan or sector-heat input, so those terms score neutral and a DVol CNF reads slightly conservative. Hover the number for the breakdown.' },
  { key: 'price', label: 'Price', align: 'right', dir: 'desc', get: r => r.price,
    tip: 'Last close.' },
  { key: 'changePct', label: 'Chg%', align: 'right', dir: 'desc', get: r => r.changePct,
    tip: 'Change vs the prior close. This list only carries names at +4% and above.' },
  { key: 'ema', label: '10/21', align: 'right', dir: 'desc',
    get: r => (r.aboveEma10 ? 2 : 0) + (r.aboveEma21 ? 1 : 0),
    tip: 'Position against the 10 and 21 EMAs. Both green is stacked; above 21 and below 10 is a pullback into the first touch.' },
  { key: 'vol', label: 'Vol', align: 'right', dir: 'desc', get: r => r.vol,
    tip: 'Shares traded. Gated at 5M.' },
  { key: 'dvol', label: '$Vol', align: 'right', dir: 'desc', get: r => r.dvol,
    tip: 'Close x volume — the actual money that changed hands. This is the list\'s ranking metric.' },
  { key: 'rvol', label: 'RVol', align: 'right', dir: 'desc', get: r => r.rvol,
    tip: 'Volume vs this name\'s own 20-day average. Big dollar volume at RVol near 1 is just a big stock trading normally.' },
  { key: 'float', label: 'Float', align: 'right', dir: 'asc', get: r => r.float,
    tip: 'Shares outstanding for the class — the closest figure the reference feed carries. Purple under 20M, green under 50M: a small float moves further on the same dollars.' },
  { key: 'rsRating', label: 'RS', align: 'right', dir: 'desc', get: r => r.rsRating,
    tip: 'Market-wide RS rating, the same percentile the other tables show — looked up from the shared job rather than recomputed here.' },
  { key: 'stoch', label: 'Stoch', align: 'right', dir: 'asc', get: r => r.stochK,
    tip: 'Stochastic %K. Low is room to run, not weakness — purple at or under 20, green at or under 30.' },
  { key: 'dtc', label: 'DTC', align: 'right', dir: 'desc', get: r => r.daysToCover,
    tip: 'Days to cover — short interest divided by average volume. High means a crowded short with fuel behind a move.' },
  { key: 'mktCap', label: 'MCap', align: 'right', dir: 'desc', get: r => r.mktCap,
    tip: 'Market capitalisation. Funds have none by nature and show ETF rather than a dash.' },
  { key: 'stage', label: 'Stage', align: 'left', dir: 'asc', divider: true, get: r => r.stage,
    tip: 'Weinstein stage from 400 days of daily bars. 2A is a strong advance, 4 a decline.' },
  { key: 'sector', label: 'Sector', align: 'left', dir: 'asc', get: r => r.sector,
    tip: 'Thematic sector from the SIC description, named the way the other tables name it.' },
];

const formatTime = (timestamp: number | Date) => {
  const d = typeof timestamp === 'number' ? new Date(timestamp) : timestamp;
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' });
};

export default function DollarVolumeScanner() {
  const { session } = useMarketData();
  const [raw, setRaw] = useState<Row[]>([]);
  const [status, setStatus] = useState<'loading' | 'live' | 'empty' | 'error'>('loading');
  const [minDvol, setMinDvol] = useState<DvolStep>(20);
  const [cap, setCap] = useState<CapBand | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'dvol', dir: 'desc' });
  const [copied, setCopied] = useState(false);
  const [txtDone, setTxtDone] = useState(false);
  const [lastScanTime, setLastScanTime] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const json = await cachedJson('/api/dvol/latest');
      const rows: Row[] = Array.isArray(json?.rows) ? json.rows : [];
      setRaw(rows);
      setLastScanTime(json?.lastScanTime ? Number(json.lastScanTime) : null);
      setStatus(rows.length ? 'live' : 'empty');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ONE band at a time. These were additive, which made "Micro + Small" a
     thing you could ask for but not a thing anyone wanted — the question the
     pills answer is "show me the small-cap cohort", singular. Clicking the
     active band clears it. */
  const selectCap = (band: CapBand) => setCap(prev => (prev === band ? null : band));

  const handleSort = (key: SortKey) => {
    const col = COLUMNS.find(c => c.key === key)!;
    setSort(prev => (prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: col.dir }));
  };

  /* Filter first, then RANK, then sort. Rank has to be assigned on the
     dollar-volume order of the filtered set — if it were assigned after the
     active sort, clicking "Chg%" would renumber the list 1..40 by change and
     the rank column would stop meaning anything. */
  const computed = useMemo(() => {
    const dvolBand = DVOL_BANDS.find(b => b.key === minDvol)!;
    const filtered = raw.filter(r => {
      if (!(r.dvol >= dvolBand.min && r.dvol < dvolBand.max)) return false;
      if (cap == null) return true;
      /* Unknown caps are only excluded once a cap filter is on, so missing
         data never quietly shrinks the unfiltered list. */
      return capBandOf(r.mktCap) === cap;
    });

    const ranked = [...filtered]
      .sort((a, b) => b.dvol - a.dvol)
      .slice(0, SHOWN)
      .map((r, i) => ({ row: r, rank: i + 1 }));

    const col = COLUMNS.find(c => c.key === sort.key)!;
    const mult = sort.dir === 'asc' ? 1 : -1;

    return [...ranked].sort((a, b) => {
      const av = col.get(a.row);
      const bv = col.get(b.row);
      /* Missing values sink to the bottom in BOTH directions — a null RVol is
         absent data, not a low reading, and floating it to the top on an
         ascending sort would read as though it were the smallest. */
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av).localeCompare(String(bv)) * mult;
      }
      return (av - bv) * mult;
    });
  }, [raw, minDvol, cap, sort]);

  const rows = useFreezeWhileChartOpen(computed);

  const pill = (active: boolean) =>
    `px-2.5 py-1 rounded-lg text-[10px] font-bold tracking-widest uppercase whitespace-nowrap transition-all duration-200 border ${
      active
        ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
        : 'bg-[#161c2a] text-slate-400 border-white/5 hover:text-slate-200 hover:bg-white/[0.04]'
    }`;

  const sortIcon = (key: SortKey) =>
    sort.key === key ? <span className="text-indigo-400">{sort.dir === 'asc' ? ' ▲' : ' ▼'}</span> : null;

  const renderRows = (list: { row: Row; rank: number }[]) => (
    <table className="w-full min-w-[900px] border-collapse">
      <thead>
        <tr className="border-b border-white/5">
          {COLUMNS.map(c => (
            <th
              key={c.key}
              title={c.tip}
              onClick={() => handleSort(c.key)}
              className={`px-0.5 py-2.5 text-[10px] font-bold tracking-wide leading-tight uppercase cursor-pointer select-none whitespace-nowrap transition-colors ${
                c.align === 'left' ? 'text-left pl-1' : 'text-right'
              } ${c.divider ? 'border-l border-white/5 pl-1.5' : ''} ${
                sort.key === c.key ? 'text-slate-300' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {c.label}{sortIcon(c.key)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-white/5">
        {list.map(({ row }) => {
          const up = (row.changePct ?? 0) >= 0;
          return (
            <React.Fragment key={row.ticker}>
            <tr className="hover:bg-white/[0.02] transition-colors group">
              {/* The catalyst chip keeps its place beside the ticker rather
                  than taking a column of its own — the requested column set
                  has no N, but a headline behind the move is the whole reason
                  some of these names are on the board. */}
              <td className="px-0.5 pt-2.5 pb-1.5 pl-1 text-left whitespace-nowrap">
                <TickerChartHover symbol={row.ticker}>
                  <span className={tickerChipForScore(row.cnfScore)}>{row.ticker}</span>
                </TickerChartHover>
                <CatalystChip row={row} note={NEGATIVE_NOTE} />
              </td>
              <td className="px-0.5 pt-2.5 pb-1.5 text-right">
                {row.cnfScore == null ? <span className="text-slate-600 text-[11px]">—</span> : (
                  <span
                    title={cnfTooltip(row)}
                    className={`inline-block px-1 py-[1px] rounded border text-[7px] font-bold tabular-nums cursor-help ${cnfBadgeCls(row.cnfScore)}`}
                  >
                    {row.cnfScore}
                  </span>
                )}
              </td>
              <td className="px-0.5 pt-2.5 pb-1.5 text-xs text-slate-300 font-medium whitespace-nowrap tabular-nums">
                <div className="flex items-center justify-end gap-1">${row.price.toFixed(2)}{row.vwap != null && row.vwap > 0 && (
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${row.price >= row.vwap ? 'bg-emerald-400' : 'bg-rose-500'}`} title={`VWAP: ${row.price >= row.vwap ? 'above' : 'below'}`} />
                )}</div>
              </td>
              <td className={`px-0.5 pt-2.5 pb-1.5 text-right text-xs font-bold tabular-nums ${row.changePct == null ? 'text-slate-600' : up ? 'text-emerald-400' : 'text-rose-400'}`}>
                {row.changePct == null ? '—' : `${up ? '+' : ''}${row.changePct.toFixed(2)}%`}
              </td>
              <td className="px-0.5 pt-2.5 pb-1.5 whitespace-nowrap">
                <div className="flex items-center justify-end gap-1" title={emaTitle(row)}>
                  <span className="text-[8px] font-bold text-slate-500">10</span>
                  <span className={`w-1.5 h-1.5 rounded-full ${emaDot(row.aboveEma10)}`} />
                  <span className="text-[8px] font-bold text-slate-500">21</span>
                  <span className={`w-1.5 h-1.5 rounded-full ${emaDot(row.aboveEma21)}`} />
                </div>
              </td>
              <td className="px-0.5 pt-2.5 pb-1.5 text-right text-xs text-slate-400 font-medium tabular-nums">{fmtVol(row.vol)}</td>
              <td className="px-0.5 pt-2.5 pb-1.5 text-right text-xs text-slate-400 font-medium tabular-nums">{fmtDvol(row.dvol)}</td>
              <td className={`px-0.5 pt-2.5 pb-1.5 text-right text-xs font-bold tabular-nums ${rvolColor(row.rvol)}`}>
                {row.rvol != null ? `${row.rvol.toFixed(1)}x` : '—'}
              </td>
              <td className={`px-0.5 pt-2.5 pb-1.5 text-right text-xs font-bold tabular-nums ${floatColor(row.float)}`}>
                {fmtVol(row.float)}
              </td>
              <td className="px-0.5 pt-2.5 pb-1.5 text-right">
                <span className={`inline-block px-1 py-[1px] rounded border text-[7px] font-bold tabular-nums ${rsBadge(row.rsRating)}`}>{row.rsRating ?? '—'}</span>
              </td>
              <td className={`px-0.5 pt-2.5 pb-1.5 text-right text-xs font-bold tabular-nums ${stochColor(row.stochK)}`}>
                {row.stochK != null ? row.stochK.toFixed(1) : '—'}
              </td>
              <td className={`px-0.5 pt-2.5 pb-1.5 text-right text-xs font-bold tabular-nums ${dtcColor(row.daysToCover)}`}>
                {row.daysToCover != null ? row.daysToCover.toFixed(1) : '—'}
              </td>
              <td className="px-0.5 pt-2.5 pb-1.5 text-right text-xs text-slate-400 font-medium tabular-nums">
                {row.mktCap != null ? fmtCap(row.mktCap) : bandLabel(row)}
              </td>
              <td className="px-0.5 pt-2.5 pb-1.5 pl-1.5 border-l border-white/5 text-left whitespace-nowrap" title={stageDescription(row.stage)}>
                <span className={`inline-block px-1 py-[1px] rounded border text-[7px] font-bold tabular-nums tracking-wide cursor-help ${stageBadge(row.stage)}`}>{stageShort(row.stage)}</span>
              </td>
              <td className="px-0.5 pt-2.5 pb-1.5 pl-1.5 text-left text-[11px] text-slate-400 whitespace-nowrap max-w-[120px] truncate" title={row.sector || undefined}>
                {displaySector(row.sector, row.ticker)}
              </td>
            </tr>
            {/* Sub-row, same shape as the scan tables: an empty cell under
                TICKER so it starts at CNF, then the catalyst. This scan
                computes no setup name, so the left slot carries the em dash
                the other tables use when a row has none. */}
            <tr className="bg-transparent border-t border-white/5">
              <td />
              <td colSpan={14} className="pb-1.5 pt-0 pr-3">
                {/* NO 78px name slot here, unlike the scan tables. Those
                    reserve it for the setup name; this scan computes none, so
                    the slot was pure indent and it pushed the catalyst out to
                    the 10/21 column instead of starting it at CNF. The rule
                    now sits on the column boundary itself. */}
                <div className="flex items-center text-left gap-0 min-w-0">
                  <p className="flex-1 min-w-0 text-[10px] leading-relaxed border-l border-white/10 pl-2.5 pr-3 truncate" title={row.thesis || undefined}>
                    {row.thesis || row.catalyst ? (
                      <>
                        {row.catalyst && (
                          <span className="text-[8px] font-bold tracking-[0.12em] uppercase text-amber-400/70">{row.catalyst} </span>
                        )}
                        {row.thesis && (
                          row.catalystUrl ? (
                            <a href={row.catalystUrl} target="_blank" rel="noopener noreferrer" className="text-slate-500 font-normal hover:text-slate-300 hover:underline transition-colors">{row.thesis}</a>
                          ) : (
                            <span className="text-slate-500 font-normal">{row.thesis}</span>
                          )
                        )}
                        {(row.newsPublisher || row.newsAge) && (
                          <span className="text-[8px] text-slate-600 font-medium ml-1.5 whitespace-nowrap">
                            {[row.newsPublisher, row.newsAge].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-slate-600 italic font-normal">No news catalyst — technical setup only.</span>
                    )}
                  </p>
                </div>
              </td>
            </tr>
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );

  const activeBand = DVOL_BANDS.find(b => b.key === minDvol)!;
  const clearing = raw.filter(r => r.dvol >= activeBand.min && r.dvol < activeBand.max).length;

  const handleCopyTickers = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const tickers = rows.map(r => r.row.ticker).join(',');
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
    const t = rows.map(r => r.row.ticker);
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

  const displaySession = ['Pre-Market', 'Open', 'Post-Market', 'Closed'].includes(session) ? session : 'Closed';

  return (
    <div className="bg-[#101623] border border-white/5 rounded-2xl p-4 md:p-8 relative shadow-xl w-full max-w-[1280px] mx-auto">
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex justify-between items-center cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-5 border-b border-white/5 pb-4' : ''}`}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs md:text-sm font-bold text-[#7c8bfa] bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 group-hover:bg-white/[0.02] transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]" />
            DOLLAR VOLUME
          </span>
          {rows.length > 0 && (
            <button
              onClick={handleCopyTickers}
              title={`Copy ${rows.length} ticker${rows.length !== 1 ? 's' : ''} for TradingView`}
              className={`text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded border transition-all duration-200 ${
                copied
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-[#161c2a] text-slate-400 border-white/5 hover:text-slate-200 hover:bg-white/[0.04]'
              }`}
            >
              {copied ? `✓ Copied ${rows.length}` : `Copy ${rows.length}`}
            </button>
          )}
          {rows.length > 0 && (
            <button
              onClick={handleDownloadTxt}
              title={`Download ${rows.length} ticker${rows.length !== 1 ? 's' : ''} as .txt for TradingView import`}
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
            Top {Math.min(SHOWN, rows.length)} of {clearing} in ${activeBand.label} · +4%+ · 5M shares · $2+ · 25M cap · whole market
          </span>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-center justify-center border border-white/5 bg-[#161c2a]/40 px-4 py-1.5 rounded-[10px] min-w-[120px]">
            <span className={`text-[10px] font-bold tracking-widest uppercase ${displaySession === 'Open' ? 'text-[#00e676]' : displaySession === 'Pre-Market' ? 'text-amber-500' : displaySession === 'Post-Market' ? 'text-indigo-400' : 'text-slate-500'}`}>{displaySession}</span>
          </div>
          {lastScanTime && (<span className="text-[11px] text-slate-400/80 font-medium px-1 tracking-wide">Scanned: {formatTime(lastScanTime)} EST</span>)}
        </div>
      </div>

      {isExpanded && (
        <>
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[8px] font-bold tracking-widest uppercase text-slate-500 mr-0.5">$Vol</span>
              {DVOL_BANDS.map(b => (
                <button key={b.key} onClick={() => setMinDvol(b.key)} className={pill(minDvol === b.key)}>
                  {b.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[8px] font-bold tracking-widest uppercase text-slate-500 mr-0.5">Cap</span>
              {CAP_ORDER.map(band => (
                <button key={band} onClick={() => selectCap(band)} className={pill(cap === band)}>
                  {band}
                </button>
              ))}
              {cap != null && (
                <button onClick={() => setCap(null)} className="text-[9px] font-bold tracking-wider uppercase text-slate-500 hover:text-slate-300 px-1.5">
                  Clear
                </button>
              )}
            </div>
          </div>

          {status === 'loading' ? (
            <div className="py-10 text-center">
              <div className="w-5 h-5 border-2 border-white/10 border-t-indigo-400 rounded-full animate-spin mx-auto mb-3" />
              <span className="text-xs text-slate-500 font-medium">Scanning the market…</span>
            </div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500">
              {status === 'error'
                ? 'Feed unavailable — awaiting next scheduled scan.'
                : status === 'empty'
                  ? 'No scan yet — awaiting the next scheduled run.'
                  : `Nothing in $${activeBand.label}${cap ? ` in ${cap} caps` : ''}.`}
            </div>
          ) : (
            <div className="overflow-x-auto overflow-y-hidden custom-scrollbar" style={{ scrollbarWidth: 'thin' }}>
              {renderRows(rows)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

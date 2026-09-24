'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ThemeToggle } from './ThemeProvider';
import DashNav from './DashNav';
import { edgeTier, EDGE_TINT, EDGE_FILTER_TIP } from '@/lib/scans/edge';
import EdgeFilterPills, { edgeCounts, useEdgeFilter } from './EdgeFilterPills';
import TickerChartHover, { ActiveChartProvider } from './TickerChartHover';
import HelpModal from './HelpModal';
import InfoDot from './InfoDot';
import { WatchlistProvider } from './WatchlistContext';
import WatchlistPanel from './WatchlistPanel';
import { ChartLevelsCtx } from './analyst/MiniChart';
import type { ExternalLevel } from './analyst/MiniChart';
import { EXIT_GUIDANCE } from '@/lib/scans/exits';
import {
  levelsFor, statusText, fmtLvl, verdictOf, trendLine, whyLine, flagsOf, shortName, shortRisk, bestLine,
  STATUS_HELP, type ReadoutReport, type ReportTf, type FlagTone,
} from '@/lib/confluence/readout';
import type { PlanStatus } from '@/lib/scans/triggerProximity';

// ---- types ------------------------------------------------------------------

interface TfAnalysis extends ReportTf {
  emaTrend: string;
  macdHist: number | null;
  macdLabel: string;
  priceVsEmas: string;
  biasScore: number;
}

interface TradeRec {
  direction: string;
  entry: string;
  stopLoss: string;
  takeProfit: string;
  rr: string;
}

interface Report extends ReadoutReport {
  name: string;
  sector: string;
  changePct: number;
  cnfScore: number;
  cnfGrade: string;
  rsRating: number;
  vol: number;
  dVol: number;
  stage: string;
  setupName: string;
  catalyst: string;
  stochK: number | null;
  mf: number | null;
  closeStrength: number | null;
  pctOffHigh: number | null;
  float: number | null;
  mktCap: number | null;
  timeframes: TfAnalysis[];
  biasScore: number;
  biasMax: number;
  confluenceScore: number;
  confluenceMax: number;
  tradeRec: TradeRec | null;
}

interface AiSummary {
  overallBias: string;
  biasRationale: string;
  topPicks: { ticker: string; reason: string; grade: string; cnfScore: number; rsRating: number; stage: string }[];
  keyLevels: { ticker: string; grade: string; support: string[]; resistance: string[] }[];
  sectorThemes: string[];
  riskNotes: string[];
  actionPlan: string;
}

// ---- styling ----------------------------------------------------------------

/* One badge for every ticker on the page — hero picks and cards alike — so
   the size never varies. Colour is the grade: A green, B amber, C slate. */
const gradeBg = (g: string | null | undefined) =>
  g === 'A' ? 'bg-emerald-400' : g === 'B' ? 'bg-amber-400' : 'bg-slate-400';

function TickerBadge({ ticker, grade }: { ticker: string; grade: string | null | undefined }) {
  return (
    <TickerChartHover symbol={ticker}>
      <span className={`inline-block text-[13px] leading-none font-extrabold text-[#0b0f1a] rounded-md px-2 py-[5px] cursor-pointer ${gradeBg(grade)}`}>
        {ticker}
      </span>
    </TickerChartHover>
  );
}

const LAB = 'text-[11px] font-bold tracking-[0.14em] uppercase';

const STATUS_PILL: Record<PlanStatus, string> = {
  wait: 'text-slate-300 bg-slate-700/60',
  hit: 'text-emerald-300 bg-emerald-500/15',
  miss: 'text-rose-300 bg-rose-500/15',
  ext: 'text-orange-400 bg-orange-950/60',
  out: 'text-rose-300 bg-rose-500/15',
};

const FLAG_TONE: Record<FlagTone, string> = {
  amber: 'text-amber-400',
  rose: 'text-rose-400',
  slate: 'text-slate-400',
};

// ---- helpers ----------------------------------------------------------------

const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
const fmtVol = (v: number) => v >= 1e9 ? (v / 1e9).toFixed(1) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : v.toString();
const fmtDvol = (v: number) => v >= 1e9 ? '$' + (v / 1e9).toFixed(1) + 'B' : v >= 1e6 ? '$' + (v / 1e6).toFixed(0) + 'M' : '$' + v.toLocaleString();
const stageNum = (stage: string) => (stage || '').replace(/^Stage\s*/i, '').trim();

/** Support nearest-first (highest below price), resistance nearest-first (lowest above). */
const nearSupport = (r: Report) => [...r.levels.support].sort((a, b) => b - a).slice(0, 2);
const nearResistance = (r: Report) => [...r.levels.resistance].sort((a, b) => a - b).slice(0, 2);
const lvlList = (v: number[]) => (v.length ? v.map(fmtLvl).join(', ') : '—');

/** Ticker names inside a sentence keep their chart hover. */
function withTickerHover(text: string, tickers: Set<string>, re: RegExp | null) {
  if (!re) return <>{text}</>;
  return <>{text.split(re).map((seg, i) => tickers.has(seg)
    ? <TickerChartHover key={i} symbol={seg}><span className="font-semibold text-slate-200 cursor-pointer">{seg}</span></TickerChartHover>
    : <span key={i}>{seg}</span>)}</>;
}

// ---- hero -------------------------------------------------------------------

function TheRead({ summary, reports, lastScan }: { summary: AiSummary | null; reports: Report[]; lastScan: number | null }) {
  const v = verdictOf(summary?.overallBias, reports);
  const tiles: [number, string, string][] = [
    [v.lineUp, 'Line up', 'text-emerald-400'],
    [v.mixed, 'Mixed', 'text-amber-400'],
    [v.down, 'Point down', 'text-rose-400'],
  ];
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-[#0f1a2e] to-[#0b101a] px-4 md:px-5 py-4 md:py-5 mb-4">
      <div className="flex items-center gap-2">
        <span className={`${LAB} text-cyan-400`}>The read</span>
        <span className="ml-auto flex items-center gap-2">
          {lastScan && <span className="text-[11px] text-slate-500 tabular-nums whitespace-nowrap">{new Date(lastScan).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })} ET</span>}
          <WatchlistPanel />
        </span>
      </div>
      <div className="text-[20px] md:text-[24px] leading-snug font-extrabold text-slate-100 mt-1.5">{v.headline}</div>
      <div className="text-[14px] text-slate-400 mt-1.5">{v.sub}</div>
      <div className="flex flex-wrap gap-2.5 mt-3.5">
        {tiles.map(([n, t, cls]) => (
          <div key={t} className="rounded-xl border border-white/[0.08] bg-[#0a1220] px-3.5 py-2.5 min-w-[96px]">
            <div className={`text-[20px] font-extrabold tabular-nums ${cls}`}>{n}</div>
            <div className="text-[11px] text-slate-500">{t}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BestAndRisks({ summary, reports }: { summary: AiSummary; reports: Report[] }) {
  const byTicker = useMemo(() => new Map(reports.map(r => [r.ticker, r])), [reports]);
  const tickers = useMemo(() => new Set(reports.map(r => r.ticker)), [reports]);
  const re = useMemo(() => tickers.size ? new RegExp(`\\b(${[...tickers].join('|')})\\b`, 'g') : null, [tickers]);
  const picks = summary.topPicks.slice(0, 3);
  const lead = picks[0] ? byTicker.get(picks[0].ticker) : undefined;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 mb-4">
      <div className="rounded-2xl border border-white/[0.08] bg-[#0b101a] px-4 md:px-5 py-4">
        <div className={`${LAB} text-emerald-400`}>Best three</div>
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {picks.map(p => <TickerBadge key={p.ticker} ticker={p.ticker} grade={byTicker.get(p.ticker)?.cnfGrade || p.grade} />)}
        </div>
        {lead && <div className="text-[14px] text-slate-400 mt-2">{bestLine(lead)}</div>}
      </div>
      <div className="rounded-2xl border border-white/[0.08] bg-[#0b101a] px-4 md:px-5 py-4">
        <div className={`${LAB} text-rose-400`}>Watch out for</div>
        <ul className="mt-2 ml-4 list-disc text-[14px] leading-relaxed text-slate-400 space-y-0.5">
          {summary.riskNotes.map((n, i) => <li key={i}>{withTickerHover(shortRisk(n), tickers, re)}</li>)}
        </ul>
      </div>
    </div>
  );
}

// ---- stock card -------------------------------------------------------------

/* Everything a reader needs is on the face of the card in plain words. The
   indicator readings the plain words are built from wait behind Details, so
   nothing measured was deleted — it just stopped being the first thing read. */
function Details({ r }: { r: Report }) {
  const stg = stageNum(r.stage);
  const stats = [
    `Score ${r.cnfScore}`,
    r.rsRating > 0 ? `RS ${r.rsRating}` : '',
    stg ? `Stage ${stg}` : '',
    `Bias ${r.biasScore}/${r.biasMax}`,
    `RVOL ${r.rvol.toFixed(1)}x`,
    `Vol ${fmtVol(r.vol)}`,
    `$Vol ${fmtDvol(r.dVol)}`,
    r.adrPct != null ? `ADR ${r.adrPct.toFixed(1)}%` : '',
    r.stochK != null ? `Stoch ${r.stochK.toFixed(0)}` : '',
    r.pctOffHigh != null ? `Off high ${r.pctOffHigh.toFixed(1)}%` : '',
    r.float != null ? `Float ${fmtVol(r.float)}` : '',
    r.sector ? r.sector : '',
  ].filter(Boolean);
  return (
    <div className="mt-2 pt-2 border-t border-white/[0.06] space-y-1.5 text-slate-400">
      <div>{stats.join(' · ')}</div>
      {r.timeframes.map(tf => (
        <div key={tf.timeframe}>
          <span className="font-semibold text-slate-300">{tf.timeframe}</span>{' '}
          {[
            tf.emaTrend !== 'N/A' ? `EMA ${tf.emaTrend}` : '',
            tf.rsi != null ? `RSI ${tf.rsi.toFixed(1)} (${tf.rsiLabel})` : '',
            tf.macdHist != null ? `MACD ${tf.macdHist >= 0 ? '+' : ''}${tf.macdHist.toFixed(2)} (${tf.macdLabel})` : '',
            tf.priceVsEmas !== 'N/A' ? `Price ${tf.priceVsEmas.toLowerCase()} EMAs` : '',
            `Bias ${tf.bias} ${tf.biasScore}/4`,
          ].filter(Boolean).join(' · ')}
        </div>
      ))}
      {r.tradeRec && <div>Drawn target {r.tradeRec.takeProfit}</div>}
      {/* What the 5-year replay of these tables says to do with that target. */}
      <div>{EXIT_GUIDANCE.scanner}</div>
    </div>
  );
}

function StockCard({ report: r }: { report: Report }) {
  const [open, setOpen] = useState(false);
  /* Same shading as every scan row, from the shared rules — on the card now
     that there are no rows. The colour's meaning sits in the help dot beside
     the filter pills rather than a native title on every card. */
  const tier = edgeTier(r);
  const tint = tier ? EDGE_TINT[tier] : '';
  const name = shortName(r.name, r.ticker);
  const lv = levelsFor(r);
  const why = whyLine(r);
  const flags = flagsOf(r);

  /* One size for the whole card (13px); weight and colour carry the
     hierarchy instead. */
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#0b101a] overflow-hidden min-w-0">
      <div className={`h-full px-4 py-4 text-[13px] ${tint}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <TickerBadge ticker={r.ticker} grade={r.cnfGrade} />
            {name && <span className="text-slate-400 truncate">{name}</span>}
          </div>
          <span className={`font-extrabold tabular-nums shrink-0 ${r.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{fmtPct(r.changePct)}</span>
        </div>

        {lv && (
          <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 mt-3 px-3 py-2.5 rounded-xl bg-[#0a1220]">
            <div className="min-w-0">
              <div className="text-slate-400">{lv.kind === 'scan' ? lv.buyLabel : 'Buy above'}</div>
              <div className="font-extrabold text-slate-100 tabular-nums">{lv.kind === 'scan' ? fmtLvl(lv.trigger) : lv.trigger}</div>
            </div>
            <div className="min-w-0">
              <div className="text-slate-400">Stop</div>
              <div className="font-extrabold text-rose-400 tabular-nums">{lv.kind === 'scan' ? fmtLvl(lv.stop) : lv.stop}</div>
            </div>
            <div>
              {lv.kind === 'scan' && (
                <span className={`inline-block font-extrabold uppercase tracking-wide rounded-full px-2.5 py-0.5 whitespace-nowrap ${STATUS_PILL[lv.status]}`}>
                  {statusText(lv.status, lv.awayPct)}
                </span>
              )}
            </div>
          </div>
        )}

        <div className="mt-2 text-slate-300"><span className="font-semibold text-slate-100 mr-1">Trend</span>{trendLine(r)}</div>
        {(nearSupport(r).length > 0 || nearResistance(r).length > 0) && (
          <div className="mt-1 text-slate-300">
            {nearSupport(r).length > 0 && <><span className="font-semibold text-slate-100 mr-1">Support</span>{lvlList(nearSupport(r))}</>}
            {nearResistance(r).length > 0 && <><span className={`font-semibold text-slate-100 mr-1 ${nearSupport(r).length > 0 ? 'ml-3' : ''}`}>Resistance</span>{lvlList(nearResistance(r))}</>}
          </div>
        )}
        {why && <div className="mt-1 text-slate-300"><span className="font-semibold text-slate-100 mr-1">Why</span>{why}</div>}

        {flags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {flags.map(f => (
              <span key={f.text} className={`font-semibold rounded-full border border-white/[0.08] bg-[#0a1220] px-2.5 py-0.5 ${FLAG_TONE[f.tone]}`}>{f.text}</span>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="mt-2.5 text-slate-500 hover:text-slate-300 transition-colors"
          aria-expanded={open}
        >{open ? 'Hide details ▴' : 'Details ▾'}</button>
        {open && <Details r={r} />}
      </div>
    </div>
  );
}

// ---- main page --------------------------------------------------------------

export default function ConfluenceReport() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastScan, setLastScan] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiSummary, setAiSummary] = useState<AiSummary | null>(null);
  const [sectorFilter, setSectorFilter] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  /* Sector filter first, then colour — the sector chips are a question about
     the tape, the colour is a question about the name. */
  const sectorReports = useMemo(
    () => (sectorFilter ? reports.filter(r => r.sector === sectorFilter) : reports),
    [reports, sectorFilter],
  );
  const edgeTally = useMemo(() => edgeCounts(sectorReports, edgeTier), [sectorReports]);
  // Opens on every name (null), strongest first — a green-only default left two
  // cards and hid the lead pick.
  const edge = useEdgeFilter(edgeTally, null);
  /* Most actionable first: names at or near their buy level (nearest first),
     then stretched / missed / broken ones; within each, green before yellow
     before red. A green name that is EXT is not something to act on today. */
  const visibleReports = useMemo(() => {
    const TIER: Record<string, number> = { green: 0, yellow: 1, red: 2 };
    const ST: Record<string, number> = { hit: 0, wait: 1, ext: 2, miss: 3, out: 4 };
    const rank = (r: Report) => {
      const lv = levelsFor(r);
      const st = lv && lv.kind === 'scan' ? (ST[lv.status] ?? 5) : 5;
      const away = lv && lv.kind === 'scan' && lv.status === 'wait' ? lv.awayPct : 0;
      return [st, TIER[edgeTier(r) ?? ''] ?? 3, away] as const;
    };
    const list = edge.key ? sectorReports.filter(r => edgeTier(r) === edge.key) : sectorReports;
    return [...list].sort((a, b) => {
      const x = rank(a), y = rank(b);
      return x[0] - y[0] || (x[0] === 1 ? x[2] - y[2] : 0) || x[1] - y[1] || b.biasScore - a.biasScore;
    });
  }, [sectorReports, edge.key]);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/confluence/latest');
      const data = await res.json();
      if (data.success) {
        setReports((data.reports || []).sort((a: Report, b: Report) => b.biasScore - a.biasScore));
        setLastScan(data.lastScanTime);
        setAiSummary(data.aiSummary ?? null);
        setError(null);
      } else {
        setError(data.error || 'Failed to load');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 120000);
    return () => clearInterval(iv);
  }, [fetchData]);

  const levelsMap = useMemo(() => {
    const m = new Map<string, ExternalLevel[]>();
    for (const r of reports) {
      const levels: ExternalLevel[] = [];
      for (const v of r.levels.resistance) levels.push({ price: v, type: 'R' });
      for (const v of r.levels.support) levels.push({ price: v, type: 'S' });
      if (levels.length > 0) m.set(r.ticker, levels);
    }
    return m;
  }, [reports]);

  const sectors = useMemo(
    () => (aiSummary?.sectorThemes ?? []).map(s => s.replace(/\s*\(.*\)$/, '')),
    [aiSummary],
  );

  const edgeHelp = `Card shading — what the 5-year test measured on these scans:\nGREEN — ${EDGE_FILTER_TIP.green}\nYELLOW — ${EDGE_FILTER_TIP.yellow}\nRED — ${EDGE_FILTER_TIP.red}`;

  return (
    <>
    <WatchlistProvider>
    <ActiveChartProvider>
      <ChartLevelsCtx.Provider value={levelsMap}>
      {/* overflow-HIDDEN, both axes, exactly as the dashboard's card does it —
         and the distinction is the whole bug. `overflow-x: hidden` with
         `overflow-y: visible` is not a thing CSS allows: the spec computes the
         visible axis to `auto`, so the element quietly becomes a scroll
         container, and on iOS a scroll container is something a finger can
         drag. Hiding one axis to stop the sliding is what created it. */}
      <div className="min-h-screen overflow-hidden bg-[var(--bg-primary)] text-slate-300 px-4 md:px-6 py-4 md:py-6 max-w-[1100px] mx-auto">
        {/* Header — stacks on a phone; the nav gets its own centred row so
            it never pushes the page sideways. */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4 md:mb-5">
          <a href="https://confluencetradingtools.com" className="flex items-center gap-3 no-underline min-w-0" style={{ textDecoration: 'none' }}>
            <img src="/logo.svg" alt="CTT" className="w-8 h-8 md:w-10 md:h-10 opacity-80" />
            <div className="min-w-0">
              <h1 className="text-[20px] md:text-[22px] font-bold text-slate-100 tracking-tight">Confluence Report</h1>
              <p className="text-[12px] text-slate-500">
                {reports.length > 0 ? `${reports.length} names from every scan · ` : ''}daily and weekly checked together
              </p>
            </div>
          </a>
          <div className="flex items-center gap-2 flex-wrap">
            <ThemeToggle />
            <button
              onClick={() => setHelpOpen(true)}
              className="w-7 h-7 flex items-center justify-center rounded text-[11px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-white/10 transition-colors shrink-0"
              aria-label="Help"
            >?</button>
          </div>
          <div className="w-full flex justify-center order-last md:w-auto md:order-none">
            <DashNav />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <span className="text-[11px] text-slate-500 tracking-widest uppercase animate-pulse">Loading confluence data...</span>
          </div>
        ) : error ? (
          <div className="text-rose-400 text-[13px] py-10 text-center">{error}</div>
        ) : reports.length === 0 ? (
          <div className="text-slate-500 text-[13px] py-10 text-center">No confluence data available yet.</div>
        ) : (
          <>
            <TheRead summary={aiSummary} reports={reports} lastScan={lastScan} />
            {aiSummary && <BestAndRisks summary={aiSummary} reports={reports} />}

            {/* Filters: the same colour pills as the scan cards, plus the
                sector chips the old summary card carried. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3 text-[11px]">
              <span className="flex items-center gap-2">
                <span className="font-bold tracking-widest uppercase text-slate-500">Edge</span>
                <EdgeFilterPills counts={edgeTally} active={edge.key} onToggle={edge.toggle} tips={EDGE_FILTER_TIP} />
                <InfoDot text={edgeHelp} />
              </span>
              {sectors.length > 0 && (
                <span className="flex flex-wrap items-center gap-1">
                  <span className="font-bold tracking-widest uppercase text-slate-500 mr-1">Sector</span>
                  {sectors.map(s => {
                    const on = sectorFilter === s;
                    return (
                      <button
                        key={s}
                        onClick={() => setSectorFilter(on ? null : s)}
                        className={`rounded-full border px-2 py-[1px] transition-colors ${on ? 'text-slate-100 bg-indigo-500/30 border-indigo-400/50' : 'text-slate-400 border-white/10 hover:border-white/20'}`}
                      >{s}</button>
                    );
                  })}
                  {sectorFilter && (
                    <button onClick={() => setSectorFilter(null)} className="text-slate-500 hover:text-slate-300 px-1">Clear</button>
                  )}
                </span>
              )}
              <span className="flex items-center text-slate-500">
                Levels<InfoDot text={STATUS_HELP} />
              </span>
            </div>

            <div className="grid gap-3.5 grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))]">
              {visibleReports.map(r => <StockCard key={r.ticker} report={r} />)}
            </div>
            {visibleReports.length === 0 && (
              <div className="text-slate-500 text-[13px] py-10 text-center">No names match the current filter.</div>
            )}
          </>
        )}

        <div className="mt-6 px-4 md:px-5 py-3 rounded-2xl border border-white/[0.06] bg-[#0b101a]">
          <div className="text-[11px] font-bold tracking-widest uppercase text-amber-400/70 mb-1.5">Good to know</div>
          <ul className="text-[12px] text-slate-500 space-y-0.5 list-disc list-inside">
            <li>Buy and stop levels are the scan&apos;s own — the same ones on the dashboard. Names not on a scan today show this report&apos;s levels and say so.</li>
            <li>Support and resistance come from recent swing highs and lows and may miss some levels.</li>
            <li>Price data is delayed. Always apply your own risk management.</li>
          </ul>
        </div>
      </div>
      </ChartLevelsCtx.Provider>
    </ActiveChartProvider>
    </WatchlistProvider>
    <HelpModal isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}

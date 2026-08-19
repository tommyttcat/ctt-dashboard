'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ThemeToggle } from './ThemeProvider';
import TickerChartHover, { ActiveChartProvider } from './TickerChartHover';
import HelpModal from './HelpModal';
import { cnfBadgeCls } from '@/lib/indicators/columnColors';
import { rsBadge } from '@/lib/indicators/rs';
import { stageBadge } from '@/lib/indicators/stage';
import { ChartLevelsCtx } from './analyst/MiniChart';
import type { ExternalLevel } from './analyst/MiniChart';

// ---- types ------------------------------------------------------------------

interface TfAnalysis {
  timeframe: string;
  emaTrend: string;
  rsi: number | null;
  rsiLabel: string;
  macdHist: number | null;
  macdLabel: string;
  priceVsEmas: string;
  bias: string;
  biasScore: number;
}

interface TradeRec {
  direction: string;
  entry: string;
  stopLoss: string;
  takeProfit: string;
  rr: string;
}

interface Report {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  changePct: number;
  cnfScore: number;
  cnfGrade: string;
  rsRating: number;
  rvol: number;
  vol: number;
  dVol: number;
  stage: string;
  setupName: string;
  catalyst: string;
  stochK: number | null;
  mf: number | null;
  adrPct: number | null;
  pctOffHigh: number | null;
  float: number | null;
  mktCap: number | null;
  timeframes: TfAnalysis[];
  biasScore: number;
  biasMax: number;
  confluenceScore: number;
  confluenceMax: number;
  confluenceLabel: string;
  levels: { resistance: number[]; support: number[] };
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

// ---- styling constants ------------------------------------------------------

const CHIP_BASE = 'inline-block text-[7px] font-bold tracking-wider px-1 py-[1px] rounded border text-center';
const CHIP_A = `${CHIP_BASE} text-emerald-300 bg-emerald-500/10 border-emerald-400/30`;
const CHIP_B = `${CHIP_BASE} text-amber-300 bg-amber-500/10 border-amber-400/30`;
const CHIP_C = `${CHIP_BASE} text-slate-300 bg-slate-500/10 border-white/10`;
const CHIP_RED = `${CHIP_BASE} text-rose-200 bg-rose-950 border-rose-500/20`;

const chipForGrade = (grade: string | null | undefined) =>
  grade === 'A' ? CHIP_A : grade === 'B' ? CHIP_B : CHIP_C;

const VAL = 'text-[10px] tabular-nums';
const LABEL = 'text-[7px] font-bold tracking-widest uppercase text-slate-500';
const SECTION_LABEL = 'text-[8px] font-bold tracking-widest uppercase';

// ---- helpers ----------------------------------------------------------------

const fmtPrc = (v: number) => v >= 1000 ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v.toFixed(2);
const fmtVol = (v: number) => v >= 1e9 ? (v / 1e9).toFixed(1) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : v.toString();
const fmtDvol = (v: number) => v >= 1e9 ? '$' + (v / 1e9).toFixed(1) + 'B' : v >= 1e6 ? '$' + (v / 1e6).toFixed(0) + 'M' : '$' + v.toLocaleString();

const biasColor = (bias: string) =>
  bias === 'BULLISH' ? 'text-emerald-400' : bias === 'BEARISH' ? 'text-rose-400' : 'text-amber-400';
const biasBg = (bias: string) =>
  bias === 'BULLISH' ? 'bg-emerald-500/10' : bias === 'BEARISH' ? 'bg-rose-500/10' : 'bg-amber-500/10';

const rsiColor = (v: number | null) => {
  if (v == null) return 'text-slate-500';
  if (v >= 70) return 'text-rose-400';
  if (v >= 55) return 'text-emerald-400';
  if (v >= 45) return 'text-slate-300';
  if (v >= 30) return 'text-amber-400';
  return 'text-rose-400';
};

// ---- timeframe table --------------------------------------------------------

function TimeframeTable({ timeframes }: { timeframes: TfAnalysis[] }) {
  const visible = timeframes.filter(tf =>
    tf.emaTrend !== 'N/A' || tf.rsi != null || tf.macdHist != null || tf.priceVsEmas !== 'N/A'
  );
  if (visible.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[10px] tabular-nums">
        <thead>
          <tr className="border-b border-white/10">
            <th className={`${LABEL} text-left py-1.5 pr-2`}>Timeframe</th>
            <th className={`${LABEL} text-left py-1.5 pr-2`}>EMA Trend</th>
            <th className={`${LABEL} text-center py-1.5 px-1`}>RSI</th>
            <th className={`${LABEL} text-center py-1.5 px-1`}>MACD Hist</th>
            <th className={`${LABEL} text-left py-1.5 px-1`}>Price vs EMAs</th>
            <th className={`${LABEL} text-center py-1.5 pl-1`}>Bias</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((tf) => (
            <tr key={tf.timeframe} className="border-b border-white/5">
              <td className="py-1.5 pr-2 text-amber-400 font-semibold">{tf.timeframe}</td>
              <td className="py-1.5 pr-2 text-slate-300">{tf.emaTrend}</td>
              <td className={`py-1.5 px-1 text-center ${rsiColor(tf.rsi)}`}>
                {tf.rsi != null ? tf.rsi.toFixed(1) : '—'} <span className="text-slate-500">({tf.rsiLabel})</span>
              </td>
              <td className={`py-1.5 px-1 text-center ${(tf.macdHist ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {tf.macdHist != null ? (tf.macdHist >= 0 ? '+' : '') + tf.macdHist.toFixed(2) : '—'} <span className="text-slate-500">({tf.macdLabel})</span>
              </td>
              <td className="py-1.5 px-1 text-slate-300">{tf.priceVsEmas}</td>
              <td className="py-1.5 pl-1 text-center">
                <span className={`inline-block text-[8px] font-bold px-1.5 py-[1px] rounded ${biasColor(tf.bias)} ${biasBg(tf.bias)}`}>
                  {tf.bias} ({tf.biasScore}/4)
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- AI summary card --------------------------------------------------------

function AiSummaryCard({ summary, reports, activeSector, onSectorFilter }: { summary: AiSummary; reports: Report[]; activeSector: string | null; onSectorFilter: (sector: string | null) => void }) {
  const biasCls = summary.overallBias === 'BULLISH' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
    : summary.overallBias === 'BEARISH' ? 'text-rose-400 bg-rose-500/10 border-rose-500/20'
    : 'text-amber-400 bg-amber-500/10 border-amber-500/20';

  const gradeMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of reports) m.set(r.ticker, r.cnfGrade || 'C');
    return m;
  }, [reports]);

  const gradeOf = (ticker: string) => gradeMap.get(ticker) || 'C';

  const picks = useMemo(() => summary.topPicks.map(p => {
    if (p.cnfScore != null && p.cnfScore > 0) return { ...p, grade: gradeMap.get(p.ticker) || p.grade };
    const cnfM = p.reason.match(/CNF\s+(\d+)/);
    const rsM = p.reason.match(/RS\s+(\d+)/);
    const stgM = p.reason.match(/Stage\s+(\S+)/);
    const cleaned = p.reason
      .replace(/CNF\s+\d+\s*·?\s*/g, '')
      .replace(/RS\s+\d+\s*·?\s*/g, '')
      .replace(/Stage\s+\S+\s*·?\s*/g, '')
      .replace(/^[\s·]+|[\s·]+$/g, '');
    const cnf = cnfM ? +cnfM[1] : 0;
    const grade = gradeMap.get(p.ticker) || (cnf >= 70 ? 'A' : cnf >= 50 ? 'B' : 'C');
    return { ...p, cnfScore: cnf, rsRating: rsM ? +rsM[1] : 0, stage: stgM ? stgM[1] : '', grade, reason: cleaned };
  }), [summary.topPicks, gradeMap]);

  const levels = useMemo(() => {
    const raw = summary.keyLevels as any[];
    if (raw.length > 0 && Array.isArray(raw[0].support)) {
      return (raw as AiSummary['keyLevels']).map(l => ({ ...l, grade: gradeMap.get(l.ticker) || l.grade }));
    }
    const grouped = new Map<string, { ticker: string; grade: string; support: string[]; resistance: string[] }>();
    for (const entry of raw) {
      const key = entry.ticker;
      if (!grouped.has(key)) grouped.set(key, { ticker: key, grade: gradeMap.get(key) || 'C', support: [], resistance: [] });
      const g = grouped.get(key)!;
      const lvl = (entry as any).level as string | undefined;
      const type = (entry as any).type as string | undefined;
      if (lvl && type) {
        if (type.startsWith('S')) g.support.push(lvl);
        else g.resistance.push(lvl);
      }
    }
    return Array.from(grouped.values());
  }, [summary.keyLevels, gradeMap]);

  const tickerRe = useMemo(() => {
    const syms = reports.map(r => r.ticker).filter(Boolean);
    if (syms.length === 0) return null;
    return new RegExp(`\\b(${syms.join('|')})\\b`, 'g');
  }, [reports]);

  const badgeText = (text: string) => {
    if (!tickerRe) return <>{text}</>;
    const parts = text.split(tickerRe);
    return <>{parts.map((seg, i) => gradeMap.has(seg)
      ? <TickerChartHover key={i} symbol={seg}><span className={`${chipForGrade(gradeOf(seg))} mx-0.5 cursor-pointer`}>{seg}</span></TickerChartHover>
      : <span key={i}>{seg}</span>
    )}</>;
  };

  return (
    <div className="bg-slate-900/60 border border-indigo-500/20 rounded-lg overflow-hidden mb-4">
      <div className="px-3 md:px-5 py-2 border-b border-indigo-500/10 flex items-center gap-2">
        <span className="text-[10px] font-bold text-indigo-400 tracking-wider uppercase">AI Analyst Rec</span>
        <span className={`inline-block text-[7px] font-bold tracking-wider px-1.5 py-[1px] rounded border ${biasCls}`}>{summary.overallBias}</span>
      </div>

      <div className="px-3 md:px-5 py-2.5">
        <p className="text-[10px] text-slate-300 leading-relaxed mb-2">{summary.biasRationale}</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2">
          {/* Left column */}
          <div className="space-y-2">
            {/* Top Picks */}
            {picks.length > 0 && (
              <div>
                <div className={`${LABEL} text-indigo-400 mb-1`}>Top Picks</div>
                <table className="text-[10px]" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th className={`${LABEL} text-left py-0.5 pr-1.5`}>Ticker</th>
                      <th className={`${LABEL} text-right py-0.5 pr-1.5`}>CHG%</th>
                      <th className={`${LABEL} text-right py-0.5 pr-1.5`}>Price</th>
                      <th className={`${LABEL} text-center py-0.5 pr-0.5`}>CNF</th>
                      <th className={`${LABEL} text-center py-0.5 pr-0.5`}>Bias</th>
                      <th className={`${LABEL} text-center py-0.5 pr-0.5`}>RS</th>
                      <th className={`${LABEL} text-center py-0.5 pr-1.5`}>STG</th>
                      <th className={`${LABEL} text-left py-0.5`}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {picks.map(p => {
                      const rpt = reports.find(r => r.ticker === p.ticker);
                      const chg = rpt?.changePct ?? 0;
                      const prc = rpt?.price ?? 0;
                      const stg = p.stage ? p.stage.replace(/^Stage\s*/i, '').trim() : '';
                      return (
                        <tr key={p.ticker}>
                          <td className="py-0.5 pr-1.5">
                            <TickerChartHover symbol={p.ticker}>
                              <span className={`${chipForGrade(p.grade)} w-[38px] cursor-pointer`}>{p.ticker}</span>
                            </TickerChartHover>
                          </td>
                          <td className={`py-0.5 pr-1.5 text-right tabular-nums font-semibold ${chg >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{chg >= 0 ? '+' : ''}{chg.toFixed(2)}%</td>
                          <td className="py-0.5 pr-1.5 text-right tabular-nums text-slate-300">${fmtPrc(prc)}</td>
                          <td className="py-0.5 pr-0.5 text-center"><span className={`${CHIP_BASE} min-w-[20px] ${cnfBadgeCls(p.cnfScore)}`}>{p.cnfScore}</span></td>
                          <td className="py-0.5 pr-0.5 text-center">{rpt && <span className={`${CHIP_BASE} min-w-[20px] ${biasBadgeCls(rpt.biasScore)}`}>{rpt.biasScore}/{rpt.biasMax}</span>}</td>
                          <td className="py-0.5 pr-0.5 text-center">{p.rsRating > 0 && <span className={`${CHIP_BASE} min-w-[20px] ${rsBadge(p.rsRating)}`}>{p.rsRating}</span>}</td>
                          <td className="py-0.5 pr-1.5 text-center">{stg && <span className={`${CHIP_BASE} min-w-[20px] ${stageBadge(stg)}`}>{stg}</span>}</td>
                          <td className="py-0.5 text-slate-500">{p.reason.replace(/Episodic Pivot/g, 'EP')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Risk Notes */}
            {summary.riskNotes.length > 0 && (
              <div>
                <div className={`${LABEL} text-rose-400/70 mb-0.5`}>Risk Notes</div>
                {summary.riskNotes.map((n, i) => (
                  <div key={i} className="text-[10px] text-slate-500 leading-snug">{badgeText(n)}</div>
                ))}
              </div>
            )}
          </div>

          {/* Right column */}
          <div className="space-y-2">
            {/* Key Levels */}
            {levels.length > 0 && (
              <div>
                <div className={`${LABEL} text-indigo-400 mb-0.5`}>Key Levels</div>
                <table className="text-[10px]">
                  <tbody>
                    {levels.map(l => (
                      <tr key={l.ticker}>
                        <td className="pr-1.5 py-[1px]"><TickerChartHover symbol={l.ticker}><span className={`${chipForGrade(l.grade)} w-[38px] cursor-pointer`}>{l.ticker}</span></TickerChartHover></td>
                        <td className="pr-0.5 py-[1px] text-right"><span className="text-[7px] font-bold text-emerald-400">S</span></td>
                        <td className="pr-2 py-[1px] text-slate-300">{l.support.length > 0 ? l.support.join(' / ') : '—'}</td>
                        <td className="pr-0.5 py-[1px] text-right"><span className="text-[7px] font-bold text-rose-400">R</span></td>
                        <td className="py-[1px] text-slate-300">{l.resistance.length > 0 ? l.resistance.join(' / ') : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Sector Themes */}
            {summary.sectorThemes.length > 0 && (
              <div>
                <div className={`${LABEL} text-indigo-400 mb-0.5`}>Sectors</div>
                <div className="flex flex-wrap gap-1">
                  {summary.sectorThemes.map(s => {
                    const sectorName = s.replace(/\s*\(.*\)$/, '');
                    const isActive = activeSector === sectorName;
                    return (
                      <button
                        key={s}
                        onClick={() => onSectorFilter(isActive ? null : sectorName)}
                        className={`${CHIP_BASE} cursor-pointer transition-colors ${isActive ? 'text-white bg-indigo-500/30 border-indigo-400/50' : 'text-slate-300 bg-slate-700/40 border-white/10 hover:border-white/20'}`}
                      >{s}</button>
                    );
                  })}
                  {activeSector && (
                    <button
                      onClick={() => onSectorFilter(null)}
                      className={`${CHIP_BASE} cursor-pointer text-slate-500 bg-transparent border-white/5 hover:text-slate-300`}
                    >Clear</button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Action Plan */}
        <div className="mt-2 pt-2 border-t border-white/[0.06]">
          <div className={`${LABEL} text-emerald-400/70 mb-0.5`}>Action Plan</div>
          <p className="text-[10px] text-slate-200 leading-snug font-medium">{badgeText(summary.actionPlan)}</p>
        </div>
      </div>
    </div>
  );
}

// ---- stock card -------------------------------------------------------------

function stageNum(stage: string): string {
  return (stage || '').replace(/^Stage\s*/i, '').trim();
}

function biasBadgeCls(score: number): string {
  if (score >= 3) return 'text-emerald-300 bg-emerald-500/10 border-emerald-400/30';
  if (score <= 1) return 'text-rose-300 bg-rose-500/10 border-rose-400/30';
  return 'text-amber-300 bg-amber-500/10 border-amber-400/30';
}

function StockCard({ report }: { report: Report }) {
  const r = report;
  const chipCls = chipForGrade(r.cnfGrade);
  const stg = stageNum(r.stage);

  return (
    <div className="bg-slate-900/60 border border-white/[0.06] rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-3 md:px-5 py-3 md:py-4 border-b border-white/[0.06] flex items-center justify-between gap-3">
        {/* Left: Ticker, Company, %CHG, Price, CNF, Bias */}
        <div className="flex items-center gap-3 min-w-0">
          <TickerChartHover symbol={r.ticker}>
            <span className={`${chipCls} w-[44px] md:w-[50px] text-[9px]`}>{r.ticker}</span>
          </TickerChartHover>
          <span className={`${VAL} font-semibold shrink-0 ${r.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {r.changePct >= 0 ? '+' : ''}{r.changePct.toFixed(2)}%
          </span>
          <span className={`${VAL} text-slate-300 shrink-0`}>${fmtPrc(r.price)}</span>
          <div className="text-center shrink-0">
            <div className={`${LABEL} mb-0.5`}>CNF</div>
            <span className={`${CHIP_BASE} min-w-[24px] ${cnfBadgeCls(r.cnfScore)}`} title={`Confluence Score: ${r.cnfScore}/100`}>{r.cnfScore}</span>
          </div>
          <div className="text-center shrink-0">
            <div className={`${LABEL} mb-0.5`}>BIAS</div>
            <span className={`${CHIP_BASE} min-w-[24px] ${biasBadgeCls(r.biasScore)}`} title={`Bias: ${r.biasScore}/${r.biasMax} ${r.confluenceLabel} (Weekly + Daily)`}>{r.biasScore}/{r.biasMax}</span>
          </div>
        </div>
        {/* Right: RS, Stage */}
        <div className="flex items-end gap-2 shrink-0">
          {r.rsRating > 0 && (
            <div className="text-center">
              <div className={`${LABEL} mb-0.5`}>RS</div>
              <span className={`${CHIP_BASE} min-w-[24px] ${rsBadge(r.rsRating)}`} title={`Relative Strength: ${r.rsRating}`}>{r.rsRating}</span>
            </div>
          )}
          {stg && (
            <div className="text-center">
              <div className={`${LABEL} mb-0.5`}>STG</div>
              <span className={`${CHIP_BASE} min-w-[24px] ${stageBadge(stg)}`}>{stg}</span>
            </div>
          )}
        </div>
      </div>

      {/* Quick stats */}
      <div className="px-3 md:px-5 py-2 flex flex-wrap gap-x-4 gap-y-1 border-b border-white/[0.06] text-[10px]">
        <span><span className="text-slate-500">RVOL</span> <span className={`font-semibold ${r.rvol >= 2 ? 'text-amber-400' : r.rvol >= 1.5 ? 'text-emerald-400' : 'text-slate-300'}`}>{r.rvol.toFixed(2)}</span></span>
        <span><span className="text-slate-500">VOL</span> <span className="text-slate-300">{fmtVol(r.vol)}</span></span>
        <span><span className="text-slate-500">$VOL</span> <span className="text-slate-300">{fmtDvol(r.dVol)}</span></span>
        {r.adrPct != null && <span><span className="text-slate-500">ADR</span> <span className={r.adrPct >= 5 ? 'text-emerald-400' : 'text-slate-300'}>{r.adrPct.toFixed(1)}%</span></span>}
        {r.stochK != null && <span><span className="text-slate-500">Stoch</span> <span className={r.stochK <= 20 ? 'text-purple-400' : r.stochK <= 30 ? 'text-emerald-400' : 'text-slate-300'}>{r.stochK.toFixed(0)}</span></span>}
        {r.pctOffHigh != null && <span><span className="text-slate-500">Off High</span> <span className="text-slate-300">{r.pctOffHigh.toFixed(1)}%</span></span>}
        {r.float != null && <span><span className="text-slate-500">Float</span> <span className="text-slate-300">{fmtVol(r.float)}</span></span>}
        {r.setupName && <span className={`${CHIP_BASE} text-violet-400 bg-violet-500/10 border-violet-500/20`}>{r.setupName === 'Episodic Pivot' ? 'EP' : r.setupName}</span>}
        {r.catalyst && <span className="text-amber-400/80 font-medium truncate max-w-[200px]">{r.catalyst}</span>}
      </div>

      {/* Timeframe Breakdown */}
      <div className="px-3 md:px-5 py-3">
        <div className={`${SECTION_LABEL} text-cyan-400 mb-2`}>Timeframe Breakdown</div>
        <TimeframeTable timeframes={r.timeframes} />
      </div>

      {/* Key Levels */}
      {(r.levels.resistance.length > 0 || r.levels.support.length > 0) && (
        <div className="px-3 md:px-5 py-3 border-t border-white/[0.06]">
          <div className={`${SECTION_LABEL} text-cyan-400 mb-2`}>Key Levels (Daily)</div>
          <div className="space-y-1 text-[10px]">
            {r.levels.resistance.length > 0 && (
              <div>
                <span className="text-rose-400 font-semibold">Resistance:</span>{' '}
                <span className="text-slate-300">{r.levels.resistance.map(v => '$' + fmtPrc(v)).join(' / ')}</span>
              </div>
            )}
            {r.levels.support.length > 0 && (
              <div>
                <span className="text-emerald-400 font-semibold">Support:</span>{' '}
                <span className="text-slate-300">{r.levels.support.map(v => '$' + fmtPrc(v)).join(' / ')}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Trade Recommendation */}
      {r.tradeRec && (
        <div className="px-3 md:px-5 py-3 border-t border-white/[0.06]">
          <div className={`${SECTION_LABEL} text-cyan-400 mb-2`}>
            Trade Recommendation: <span className={`${r.tradeRec.direction === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}`}>{r.tradeRec.direction}</span>
          </div>
          <div className="grid grid-cols-4 gap-2 text-[10px]">
            <div>
              <div className="text-slate-500 text-[7px] font-bold tracking-widest uppercase">Entry</div>
              <div className="text-slate-200 font-semibold">{r.tradeRec.entry}</div>
            </div>
            <div>
              <div className="text-slate-500 text-[7px] font-bold tracking-widest uppercase">Stop Loss</div>
              <div className="text-rose-400 font-semibold">{r.tradeRec.stopLoss}</div>
            </div>
            <div>
              <div className="text-slate-500 text-[7px] font-bold tracking-widest uppercase">Take Profit</div>
              <div className="text-emerald-400 font-semibold">{r.tradeRec.takeProfit}</div>
            </div>
            <div>
              <div className="text-slate-500 text-[7px] font-bold tracking-widest uppercase">R:R</div>
              <div className="text-amber-400 font-semibold">{r.tradeRec.rr}</div>
            </div>
          </div>
        </div>
      )}
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

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/confluence/latest');
      const data = await res.json();
      if (data.success) {
        setReports(data.reports || []);
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

  return (
    <>
    <ActiveChartProvider>
      <ChartLevelsCtx.Provider value={levelsMap}>
      <div className="min-h-screen bg-[var(--bg-primary)] text-slate-300 px-3 md:px-6 py-4 md:py-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 md:mb-6">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="CTT" className="w-8 h-8 md:w-10 md:h-10 opacity-80" />
            <div>
              <h1 className="text-lg md:text-xl font-bold text-slate-100 tracking-tight">Multi-Confluence Report</h1>
              <p className="text-[10px] text-slate-500 tracking-widest uppercase">Top Setups — Multi-Timeframe Analysis</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {lastScan && (
              <span className="text-[9px] text-slate-600 italic tabular-nums whitespace-nowrap">
                Updated: {new Date(lastScan).toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })} ET
              </span>
            )}
            <ThemeToggle />
            <a href="/" className="text-[10px] font-bold tracking-wider uppercase px-3 py-1.5 rounded bg-slate-800 text-slate-400 hover:text-slate-200 border border-white/10 transition-colors">
              Dashboard
            </a>
            <a href="/analyst" className="text-[10px] font-bold tracking-wider uppercase px-3 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-500 transition-colors">
              Analyst Brief
            </a>
            <button
              onClick={() => setHelpOpen(true)}
              className="w-7 h-7 flex items-center justify-center rounded text-[11px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-white/10 transition-colors shrink-0"
              title="Help"
            >?</button>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <span className="text-[10px] text-slate-500 tracking-widest uppercase animate-pulse">Loading confluence data...</span>
          </div>
        ) : error ? (
          <div className="text-rose-400 text-[11px] py-10 text-center">{error}</div>
        ) : reports.length === 0 ? (
          <div className="text-slate-500 text-[11px] py-10 text-center">
            No confluence data available. Run the scan first.
          </div>
        ) : (
          <>
            {aiSummary && <AiSummaryCard summary={aiSummary} reports={reports} activeSector={sectorFilter} onSectorFilter={setSectorFilter} />}
            <div className="space-y-4">
              {(sectorFilter ? reports.filter(r => r.sector === sectorFilter) : reports).map((r) => (
                <StockCard key={r.ticker} report={r} />
              ))}
            </div>
          </>
        )}

        {/* Important Caveats */}
        <div className="mt-6 px-3 md:px-5 py-3 bg-slate-900/40 border border-white/[0.04] rounded-lg">
          <div className={`${SECTION_LABEL} text-amber-400/60 mb-1.5`}>Important Caveats</div>
          <ul className="text-[10px] text-slate-500 space-y-0.5 list-disc list-inside">
            <li>Multi-timeframe data uses real-time intraday bars from Polygon</li>
            <li>S/R levels are derived from swing highs/lows and may not reflect all key levels</li>
            <li>Trade recommendations are mechanical — always apply your own risk management</li>
          </ul>
        </div>
      </div>
      </ChartLevelsCtx.Provider>
    </ActiveChartProvider>
    <HelpModal isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}

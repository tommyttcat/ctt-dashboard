'use client';

import React, { useState, useEffect } from 'react';
import InfoDot from './InfoDot';

interface Indicator {
  id: string;
  label: string;
  unit: string;
  value: number;
  previousValue: number | null;
  change: number | null;
  date: string;
  previousDate: string;
}

interface MacroEconData {
  updatedAt: number;
  updatedAtET: string;
  indicators: Indicator[];
  derived: { yieldSpread: number | null };
}

const fmtVal = (value: number, unit: string): string => {
  if (unit === 'B$') return `$${(value / 1000).toFixed(1)}T`;
  if (unit === 'M$') {
    if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(1)}T`;
    if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(0)}B`;
    return `$${value.toFixed(0)}M`;
  }
  if (unit === 'K') {
    if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(1)}M`;
    return `${value.toFixed(0)}K`;
  }
  if (unit === '%') return `${value.toFixed(2)}%`;
  if (unit === '$/bbl') return `$${value.toFixed(2)}`;
  if (unit === 'index') return value.toFixed(1);
  return String(value);
};

const fmtChange = (change: number, unit: string): string => {
  const sign = change >= 0 ? '+' : '';
  if (unit === '%' || unit === 'index') return `${sign}${change.toFixed(2)}`;
  if (unit === '$/bbl') return `${sign}$${change.toFixed(2)}`;
  if (unit === 'B$') return `${sign}${change.toFixed(0)}B`;
  if (unit === 'M$') return `${sign}${change.toFixed(0)}M`;
  if (unit === 'K') return `${sign}${change.toFixed(0)}K`;
  return `${sign}${change.toFixed(2)}`;
};

const fmtDate = (dateStr: string): string => {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return dateStr;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(m[2]) - 1]} ${parseInt(m[3])}, ${m[1]}`;
};

type Tone = 'green' | 'red' | 'slate';

const changeTone = (id: string, change: number): Tone => {
  if (Math.abs(change) < 0.001) return 'slate';
  const invertedIds = new Set(['unemployment', 'inflation', 'cpi']);
  const effective = invertedIds.has(id) ? -change : change;
  return effective >= 0 ? 'green' : 'red';
};

const cellCls = (tone: Tone) =>
  tone === 'green' ? 'bg-emerald-500/8 border-emerald-500/20' :
  tone === 'red'   ? 'bg-rose-500/8 border-rose-500/20' :
                      'bg-slate-500/8 border-white/10';

const valCls = (tone: Tone) =>
  tone === 'green' ? 'text-emerald-400' :
  tone === 'red'   ? 'text-rose-400' :
                      'text-slate-300';

const TOOLTIPS: Record<string, string> = {
  fedFunds: 'The interest rate banks charge each other overnight, set by the Federal Reserve. Higher = tighter policy, slower growth. Lower = looser policy, risk-on.',
  treasury10y: '10-year US government bond yield. The benchmark for mortgage rates and corporate borrowing. Rising yields pressure growth stocks; falling yields signal flight to safety.',
  treasury2y: '2-year US government bond yield. Closely tracks Fed rate expectations. When 2Y > 10Y the curve is inverted — historically the strongest recession predictor.',
  cpi: 'Consumer Price Index — measures the cost of a basket of goods and services. The Fed\'s primary inflation gauge. Rising CPI = hawkish Fed, falling = dovish.',
  inflation: 'Year-over-year change in consumer prices. The Fed targets 2%. Above 3% the Fed tightens, below 2% it eases. Drives rate expectations and equity multiples.',
  unemployment: 'Percentage of the labor force actively seeking work. Below 4% is full employment. Rising unemployment triggers rate cuts; low unemployment supports hawkish policy.',
  gdp: 'Inflation-adjusted total output of the US economy. Two consecutive negative quarters = technical recession.',
  retailSales: 'Monthly total of retail and food services sales. A direct read on consumer spending, which drives ~70% of US GDP. Surprise beats are risk-on.',
  nonfarm: 'Monthly change in non-farm payrolls — jobs added or lost. The single most market-moving economic release. Strong = hawkish, weak = dovish.',
  wti: 'West Texas Intermediate crude oil price per barrel. Rising oil feeds into CPI and squeezes consumer spending. Falling oil is disinflationary and supports margins.',
};

const DISPLAY_ORDER = [
  'fedFunds', 'treasury10y', 'treasury2y', 'inflation', 'wti',
  'cpi', 'unemployment', 'gdp', 'retailSales', 'nonfarm',
];


export default function MacroEconPanel() {
  const [data, setData] = useState<MacroEconData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/macro-econ')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d?.indicators) setData(d); else if (!cancelled) setError(true); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, []);

  if (error || !data) return null;

  const byId = new Map(data.indicators.map(i => [i.id, i]));
  const cells = DISPLAY_ORDER.map(id => byId.get(id)).filter(Boolean) as Indicator[];
  if (cells.length === 0) return null;

  return (
    <div className="bg-[#101623] border-0 md:border md:border-white/5 md:rounded-2xl p-2 md:p-8 relative md:shadow-xl w-full">
      <div className="hidden md:block absolute right-0 top-0 w-64 h-64 bg-teal-500/5 blur-3xl rounded-full -translate-y-1/2 translate-x-1/3 pointer-events-none" />
      <div className="flex justify-between items-center relative z-10 mb-3 md:mb-6 border-b border-white/5 pb-2 md:pb-4">
        <span className="text-xs md:text-sm font-bold text-teal-400 bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />
          Macro Environment
        </span>
        <span className="text-[10px] text-slate-500 font-medium tracking-wide">
          Updated: {data.updatedAtET} ET
        </span>
      </div>

      <div className="relative z-10">
        <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
          {cells.map(ind => {
            const tone: Tone = ind.change != null ? changeTone(ind.id, ind.change) : 'slate';
            return (
              <div
                key={ind.id}
                className={`rounded-lg border px-3.5 py-3 text-center ${cellCls(tone)}`}
              >
                <div className="text-[8px] font-bold uppercase tracking-[0.08em] text-slate-500 mb-1 flex items-center justify-center gap-1">
                  <span className="truncate">{ind.label}</span>
                  {TOOLTIPS[ind.id] && <InfoDot text={TOOLTIPS[ind.id]} />}
                </div>
                <div className={`text-[15px] font-bold tabular-nums leading-tight ${valCls(tone)}`}>
                  {fmtVal(ind.value, ind.unit)}
                </div>
                {ind.change != null && (
                  <div className={`text-[10px] mt-0.5 tabular-nums ${valCls(tone)}`}>
                    {fmtChange(ind.change, ind.unit)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

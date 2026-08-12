'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, CandlestickSeries, LineSeries, AreaSeries } from 'lightweight-charts';
import type { IChartApi, LineData, Time } from 'lightweight-charts';

interface Bar { time: string; open: number; high: number; low: number; close: number; volume: number }

const PREFS_KEY = 'ctt_chart_prefs';

function loadPrefs(): { tf: string; mode: string; trend: boolean } {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { tf: 'daily', mode: 'candle', trend: false };
}

function savePrefs(tf: string, mode: string, trend: boolean) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ tf, mode, trend })); } catch {}
}

function calcEMA(data: Bar[], period: number): LineData<Time>[] {
  const k = 2 / (period + 1);
  const result: LineData<Time>[] = [];
  let ema = 0;
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      ema += data[i].close / period;
      continue;
    }
    if (i === period - 1) {
      ema += data[i].close / period;
    } else {
      ema = data[i].close * k + ema * (1 - k);
    }
    result.push({ time: data[i].time as Time, value: ema });
  }
  return result;
}

function calcSMA(data: Bar[], period: number): LineData<Time>[] {
  const result: LineData<Time>[] = [];
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j].close;
    result.push({ time: data[i].time as Time, value: sum / period });
  }
  return result;
}

function calcTrendLine(data: Bar[], period: number): LineData<Time>[] {
  const slice = data.slice(-period);
  if (slice.length < 2) return [];
  const n = slice.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += slice[i].close;
    sumXY += i * slice[i].close;
    sumXX += i * i;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  return slice.map((b, i) => ({ time: b.time as Time, value: intercept + slope * i }));
}

const MA_CONFIG: Record<string, { period: number; color: string; sma?: boolean }[]> = {
  daily: [
    { period: 10, color: '#22c55e' },
    { period: 21, color: '#eab308' },
  ],
  '3m': [
    { period: 10, color: '#22c55e' },
    { period: 21, color: '#eab308' },
  ],
  weekly: [
    { period: 4, color: '#60a5fa', sma: true },
    { period: 10, color: '#22c55e', sma: true },
    { period: 30, color: '#f97316', sma: true },
  ],
  monthly: [
    { period: 6, color: '#22c55e', sma: true },
    { period: 12, color: '#eab308', sma: true },
    { period: 24, color: '#f43f5e', sma: true },
  ],
  ytd: [
    { period: 10, color: '#22c55e', sma: true },
    { period: 21, color: '#eab308', sma: true },
    { period: 50, color: '#f97316', sma: true },
  ],
};

function fmtVol(v: number): string {
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return v.toFixed(0);
}

interface MiniChartProps {
  symbol: string;
  mode?: 'candle' | 'line';
  showTrend?: boolean;
  compact?: boolean;
  large?: boolean;
  vol?: number | null;
  dvol?: number | null;
  rvol?: number | null;
  rs?: number | null;
  stage?: string | null;
}

export default function MiniChart({ symbol, mode = 'candle', showTrend = false, large = false, vol, dvol, rvol, rs, stage }: MiniChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [inited, setInited] = useState(false);
  const [tf, setTf] = useState<'daily' | 'weekly' | 'monthly' | '3m' | 'ytd'>('daily');
  const [chartMode, setChartMode] = useState<'candle' | 'line'>(mode);
  const [trend, setTrend] = useState(showTrend);
  const [bars, setBars] = useState<Bar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const w = isMobile ? window.innerWidth - 28 : large ? 520 : 440;
  const h = isMobile ? 260 : large ? 320 : 260;

  useEffect(() => {
    const p = loadPrefs();
    setTf(p.tf as any);
    setChartMode(p.mode as any);
    setTrend(p.trend);
    setInited(true);
  }, []);

  const changeTf = useCallback((v: 'daily' | 'weekly' | 'monthly' | '3m' | 'ytd') => {
    setTf(v);
    savePrefs(v, chartMode, trend);
  }, [chartMode, trend]);

  const changeMode = useCallback((v: 'candle' | 'line') => {
    setChartMode(v);
    savePrefs(tf, v, trend);
  }, [tf, trend]);

  const changeTrend = useCallback(() => {
    const next = !trend;
    setTrend(next);
    savePrefs(tf, chartMode, next);
  }, [tf, chartMode, trend]);

  const fetchData = useCallback(async (timeframe: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/chart/${encodeURIComponent(symbol)}?tf=${timeframe}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setBars(data.bars || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => { if (inited) fetchData(tf); }, [tf, fetchData, inited]);

  useEffect(() => {
    if (!containerRef.current || bars.length === 0) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(containerRef.current, {
      width: w,
      height: h,
      layout: {
        background: { color: '#0c1322' },
        textColor: '#64748b',
        fontSize: 9,
      },
      grid: {
        vertLines: { color: '#1e293b' },
        horzLines: { color: '#1e293b' },
      },
      crosshair: {
        vertLine: { color: '#475569', width: 1, style: 2, labelBackgroundColor: '#1e293b' },
        horzLine: { color: '#475569', width: 1, style: 2, labelBackgroundColor: '#1e293b' },
      },
      rightPriceScale: {
        borderColor: '#1e293b',
        textColor: '#64748b',
      },
      timeScale: {
        borderColor: '#1e293b',
        timeVisible: false,
      },
    });

    if (chartMode === 'candle') {
      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#2dd4bf',
        downColor: '#ef4444',
        borderUpColor: '#2dd4bf',
        borderDownColor: '#ef4444',
        wickUpColor: '#2dd4bf',
        wickDownColor: '#ef4444',
      });
      candleSeries.setData(bars.map(b => ({
        time: b.time as Time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })));
    } else {
      const last = bars[bars.length - 1];
      const first = bars[0];
      const isUp = last && first && last.close >= first.close;
      const color = isUp ? '#2dd4bf' : '#ef4444';
      const areaSeries = chart.addSeries(AreaSeries, {
        lineColor: color,
        lineWidth: 2,
        topColor: isUp ? 'rgba(45,212,191,0.25)' : 'rgba(239,68,68,0.25)',
        bottomColor: isUp ? 'rgba(45,212,191,0.02)' : 'rgba(239,68,68,0.02)',
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: true,
      });
      areaSeries.setData(bars.map(b => ({ time: b.time as Time, value: b.close })));
    }

    if (chartMode === 'candle') {
      const mas = MA_CONFIG[tf] || MA_CONFIG['daily'];
      for (const { period, color, sma } of mas) {
        const lineSeries = chart.addSeries(LineSeries, {
          color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        lineSeries.setData(sma ? calcSMA(bars, period) : calcEMA(bars, period));
      }
    }

    if (trend) {
      const trendData = calcTrendLine(bars, bars.length);
      if (trendData.length > 1) {
        const trendSeries = chart.addSeries(LineSeries, {
          color: '#ffffff',
          lineWidth: 3,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        trendSeries.setData(trendData);
      }
    }

    chart.timeScale().fitContent();
    chartRef.current = chart;

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [bars, tf, chartMode, trend, w, h]);

  if (!inited) return null;

  const mas = MA_CONFIG[tf] || MA_CONFIG['daily'];
  const btnCls = (active: boolean) =>
    `text-[10px] font-bold px-2 py-1 rounded border tracking-wider transition-colors ${active ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30' : 'text-slate-500 border-white/10 hover:text-slate-300'}`;

  const last = bars.length > 0 ? bars[bars.length - 1] : null;
  const chg = (n: number) => {
    if (bars.length < 2) return null;
    const idx = Math.max(0, bars.length - 1 - n);
    const prev = bars[idx].close;
    return ((bars[bars.length - 1].close - prev) / prev) * 100;
  };
  const changes = tf === 'daily' || tf === '3m' || tf === 'ytd'
    ? [
        { label: 'DAY', val: chg(1) },
        { label: 'WEEK', val: chg(5) },
        { label: 'MONTH', val: chg(21) },
      ]
    : tf === 'weekly'
    ? [
        { label: 'MONTH', val: chg(4) },
        { label: '3M', val: chg(13) },
        { label: '1Y', val: chg(52) },
      ]
    : [
        { label: '1Y', val: chg(12) },
        { label: '3Y', val: chg(36) },
        { label: '5Y', val: chg(60) },
      ];
  let adr: number | null = null;
  if (bars.length >= 14) {
    const recent = bars.slice(-14);
    adr = recent.reduce((s, b) => s + ((b.high - b.low) / b.close) * 100, 0) / recent.length;
  }

  const displayVol = vol ?? (last ? last.volume : null);
  const displayDvol = dvol ?? (last ? last.close * last.volume : null);
  const avgVol = bars.length > 5 ? bars.slice(-20).reduce((s, b) => s + b.volume, 0) / Math.min(20, bars.length) : null;
  const displayRvol = rvol ?? (last && avgVol ? last.volume / avgVol : null);

  return (
    <div>
      <div className="flex items-center justify-between mb-1 flex-wrap gap-1">
        <div className="flex gap-0.5">
          <button onClick={(e) => { e.stopPropagation(); changeTf('daily'); }} className={btnCls(tf === 'daily')}>D</button>
          <button onClick={(e) => { e.stopPropagation(); changeTf('weekly'); }} className={btnCls(tf === 'weekly')}>W</button>
          <button onClick={(e) => { e.stopPropagation(); changeTf('monthly'); }} className={btnCls(tf === 'monthly')}>M</button>
          <button onClick={(e) => { e.stopPropagation(); changeTf('3m'); }} className={btnCls(tf === '3m')}>3M</button>
          <button onClick={(e) => { e.stopPropagation(); changeTf('ytd'); }} className={btnCls(tf === 'ytd')}>YTD</button>
          <span className="w-px bg-white/10 mx-0.5" />
          <button onClick={(e) => { e.stopPropagation(); changeMode('candle'); }} className={btnCls(chartMode === 'candle')}>OHLC</button>
          <button onClick={(e) => { e.stopPropagation(); changeMode('line'); }} className={btnCls(chartMode === 'line')}>LINE</button>
          <span className="w-px bg-white/10 mx-0.5" />
          <button onClick={(e) => { e.stopPropagation(); changeTrend(); }} className={btnCls(trend)}>TREND</button>
        </div>
        <div className="flex items-center gap-1.5">
          {chartMode === 'candle' && mas.map(({ period, color }) => (
            <span key={period} className="flex items-center gap-0.5 text-[7px] font-bold tracking-wider">
              <span className="w-2 h-[2px] rounded-full inline-block" style={{ backgroundColor: color }} />
              <span style={{ color }} className="opacity-80">{period}</span>
            </span>
          ))}
          {trend && (
            <span className="flex items-center gap-0.5 text-[7px] font-bold tracking-wider">
              <span className="w-2 h-[2px] rounded-full inline-block" style={{ backgroundColor: '#ffffff', borderTop: '1px dashed #ffffff' }} />
              <span style={{ color: '#ffffff' }} className="opacity-80">TRD</span>
            </span>
          )}
        </div>
      </div>
      {!loading && bars.length > 0 && (
        <div className="flex items-center gap-2 mb-1 text-[9px] font-bold tracking-wider tabular-nums flex-wrap">
          {changes.map(c => c.val != null && (
            <span key={c.label} className={c.val >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
              {c.label} {c.val >= 0 ? '+' : ''}{c.val.toFixed(1)}%
            </span>
          ))}
          {adr != null && <span className="text-slate-400">ADR <span className="text-slate-300">{adr.toFixed(1)}%</span></span>}
          {displayVol != null && <span className="text-slate-400">VOL <span className="text-slate-300">{fmtVol(displayVol)}</span></span>}
          {displayDvol != null && <span className="text-slate-400">DVOL <span className="text-slate-300">${fmtVol(displayDvol)}</span></span>}
          {displayRvol != null && <span className={displayRvol >= 2 ? 'text-amber-400' : displayRvol >= 1.5 ? 'text-emerald-400' : 'text-slate-400'}>RVOL <span className="font-semibold">{displayRvol.toFixed(2)}</span></span>}
          {rs != null && <span className={rs >= 80 ? 'text-emerald-400' : rs >= 50 ? 'text-amber-400' : 'text-rose-400'}>RS <span className="font-semibold">{rs}</span></span>}
          {stage && <span className="text-violet-400">STG <span className="font-semibold">{stage.replace(/^stage\s*/i, '')}</span></span>}
        </div>
      )}
      {loading && (
        <div className="flex items-center justify-center" style={{ height: h }}>
          <div className="w-4 h-4 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
        </div>
      )}
      {error && (
        <div className="flex items-center justify-center text-[10px] text-rose-400" style={{ height: h }}>{error}</div>
      )}
      {!loading && !error && bars.length === 0 && (
        <div className="flex items-center justify-center text-[10px] text-slate-500" style={{ height: h }}>No data</div>
      )}
      <div ref={containerRef} className={loading || error || bars.length === 0 ? 'hidden' : ''} />
    </div>
  );
}

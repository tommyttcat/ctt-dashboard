'use client';

import React, { useEffect, useRef, useState, useCallback, useContext } from 'react';
import { createChart, CandlestickSeries, LineSeries, AreaSeries } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, LineData, Time } from 'lightweight-charts';

interface Bar { time: string; open: number; high: number; low: number; close: number; volume: number }

const PREFS_KEY = 'ctt_chart_prefs';

function loadPrefs(): { tf: string; mode: string; trend: boolean; channel: boolean; sr: boolean } {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { tf: 'daily', mode: 'candle', trend: false, channel: false, sr: false };
}

function savePrefs(tf: string, mode: string, trend: boolean, channel: boolean, sr: boolean) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ tf, mode, trend, channel, sr })); } catch {}
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

function calcChannel(data: Bar[], period: number): { mid: LineData<Time>[]; upper: LineData<Time>[]; lower: LineData<Time>[] } {
  const slice = data.slice(-period);
  if (slice.length < 2) return { mid: [], upper: [], lower: [] };
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
  let maxUp = 0, maxDown = 0;
  for (let i = 0; i < n; i++) {
    const reg = intercept + slope * i;
    const hi = slice[i].high - reg;
    const lo = reg - slice[i].low;
    if (hi > maxUp) maxUp = hi;
    if (lo > maxDown) maxDown = lo;
  }
  const halfWidth = (maxUp + maxDown) / 2;
  const shift = (maxUp - maxDown) / 2;
  const mid: LineData<Time>[] = [];
  const upper: LineData<Time>[] = [];
  const lower: LineData<Time>[] = [];
  for (let i = 0; i < n; i++) {
    const reg = intercept + slope * i;
    const center = reg + shift;
    mid.push({ time: slice[i].time as Time, value: center });
    upper.push({ time: slice[i].time as Time, value: center + halfWidth });
    lower.push({ time: slice[i].time as Time, value: center - halfWidth });
  }
  return { mid, upper, lower };
}

function calcATR(data: Bar[], period = 14): number | null {
  if (data.length < period + 1) return null;
  const recent = data.slice(-(period + 1));
  let sum = 0;
  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1].close;
    const tr = Math.max(recent[i].high - recent[i].low, Math.abs(recent[i].high - prev), Math.abs(recent[i].low - prev));
    sum += tr;
  }
  return sum / period;
}

function calcSR(data: Bar[], maxLevels = 5): { price: number; type: 'S' | 'R'; touches: number }[] {
  if (data.length < 5) return [];
  const pivots: { price: number; type: 'S' | 'R' }[] = [];
  for (let i = 2; i < data.length - 2; i++) {
    if (data[i].high >= data[i - 1].high && data[i].high >= data[i - 2].high &&
        data[i].high >= data[i + 1].high && data[i].high >= data[i + 2].high) {
      pivots.push({ price: data[i].high, type: 'R' });
    }
    if (data[i].low <= data[i - 1].low && data[i].low <= data[i - 2].low &&
        data[i].low <= data[i + 1].low && data[i].low <= data[i + 2].low) {
      pivots.push({ price: data[i].low, type: 'S' });
    }
  }
  if (pivots.length === 0) return [];
  const range = Math.max(...data.map(b => b.high)) - Math.min(...data.map(b => b.low));
  const threshold = range * 0.04;
  const clusters: { price: number; type: 'S' | 'R'; touches: number; best: number }[] = [];
  for (const p of pivots) {
    const match = clusters.find(c => Math.abs(c.price - p.price) <= threshold);
    if (match) {
      match.touches++;
      if (p.type === 'R' && p.price > match.best) match.best = p.price;
      else if (p.type === 'S' && p.price < match.best) match.best = p.price;
      match.price = match.best;
    } else {
      clusters.push({ price: p.price, type: p.type, touches: 1, best: p.price });
    }
  }
  const lastClose = data[data.length - 1].close;
  for (const c of clusters) {
    c.type = c.price >= lastClose ? 'R' : 'S';
  }
  clusters.sort((a, b) => b.touches - a.touches);
  return clusters.slice(0, maxLevels);
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

export interface ExternalLevel { price: number; type: 'S' | 'R' }

export const ChartLevelsCtx = React.createContext<Map<string, ExternalLevel[]>>(new Map());

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
  onProfile?: (p: { name?: string; sector?: string }) => void;
  externalLevels?: ExternalLevel[];
}

/* Bars keyed by symbol+timeframe, kept for the life of the page.
 *
 * Re-hovering a ticker used to refetch it in full, so the second look at a
 * name cost exactly as much as the first — the single biggest reason the
 * popup feels slow next to Finviz, which is just serving a cached image.
 * Daily bars do not change within a session, so there is nothing to
 * invalidate; the API's own 5-minute cache still governs freshness on a
 * hard reload.
 *
 * `inflight` dedupes concurrent requests: dragging the cursor down a list
 * can start several fetches for the same symbol before the first returns. */
/* Fixed silhouette for the loading skeleton. Deliberately static rather than
   random — a shape that changes on every hover reads as content arriving,
   which is exactly the wrong signal while you are still waiting. */
const SKELETON_BARS = [38, 52, 45, 60, 55, 71, 64, 58, 69, 78, 72, 66, 80, 74, 85, 79, 68, 74, 88, 82];

const barCache = new Map<string, Bar[]>();
const inflight = new Map<string, Promise<{ bars: Bar[]; profile?: any }>>();

export async function fetchChartData(symbol: string, tf: string): Promise<{ bars: Bar[]; profile?: any }> {
  const key = `${symbol}:${tf}`;
  const cached = barCache.get(key);
  if (cached) return { bars: cached };

  const pending = inflight.get(key);
  if (pending) return pending;

  const p = (async () => {
    const res = await fetch(`/api/chart/${encodeURIComponent(symbol)}?tf=${tf}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const bars: Bar[] = data.bars || [];
    if (bars.length) barCache.set(key, bars);
    return { bars, profile: data.profile };
  })().finally(() => { inflight.delete(key); });

  inflight.set(key, p);
  return p;
}

/** Warm the cache before the popup opens, so it renders from memory. */
export function prefetchChart(symbol: string, tf = 'daily') {
  fetchChartData(symbol, tf).catch(() => {});
}

export default function MiniChart({ symbol, mode = 'candle', showTrend = false, large = false, vol, dvol, rvol, rs, stage, onProfile, externalLevels }: MiniChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [inited, setInited] = useState(false);
  const ctxLevels = useContext(ChartLevelsCtx);
  const resolvedLevels = externalLevels ?? ctxLevels.get(symbol) ?? undefined;
  const [tf, setTf] = useState<'daily' | 'weekly' | 'monthly' | '3m' | 'ytd'>('daily');
  const [chartMode, setChartMode] = useState<'candle' | 'line'>(mode);
  const [trend, setTrend] = useState(showTrend);
  const [channel, setChannel] = useState(false);
  const [sr, setSr] = useState(false);
  const [bars, setBars] = useState<Bar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* Prefetch-on-hover means the bars usually land within a frame or two, and
     showing the skeleton for that long read as a flash of grey bars right
     before the chart — worse than showing nothing. Hold it back until the wait
     is long enough to be worth acknowledging; fast loads now go straight to
     the chart and never flash. */
  const [showSkeleton, setShowSkeleton] = useState(false);
  useEffect(() => {
    if (!loading) { setShowSkeleton(false); return; }
    const t = setTimeout(() => setShowSkeleton(true), 220);
    return () => clearTimeout(t);
  }, [loading]);

  /* Height is fixed, width follows the container via `autoSize`. The old code
     guessed the width as `innerWidth - 28`, but the mobile popup spends 40px
     on inset and padding, so the canvas overhung its own box by 12px. */
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const h = isMobile ? 240 : large ? 320 : 260;

  useEffect(() => {
    const p = loadPrefs();
    setTf(p.tf as any);
    setChartMode(p.mode as any);
    setTrend(p.trend);
    setChannel(p.channel ?? false);
    setSr((p as any).sr ?? false);
    setInited(true);
  }, []);

  const changeTf = useCallback((v: 'daily' | 'weekly' | 'monthly' | '3m' | 'ytd') => {
    setTf(v);
    savePrefs(v, chartMode, trend, channel, sr);
  }, [chartMode, trend, channel, sr]);

  const changeMode = useCallback((v: 'candle' | 'line') => {
    setChartMode(v);
    savePrefs(tf, v, trend, channel, sr);
  }, [tf, trend, channel, sr]);

  const changeTrend = useCallback(() => {
    const next = !trend;
    setTrend(next);
    if (next) setChannel(false);
    savePrefs(tf, chartMode, next, next ? false : channel, sr);
  }, [tf, chartMode, trend, channel, sr]);

  const changeChannel = useCallback(() => {
    const next = !channel;
    setChannel(next);
    if (next) setTrend(false);
    savePrefs(tf, chartMode, next ? false : trend, next, sr);
  }, [tf, chartMode, trend, channel, sr]);

  const changeSR = useCallback(() => {
    const next = !sr;
    setSr(next);
    savePrefs(tf, chartMode, trend, channel, next);
  }, [tf, chartMode, trend, channel, sr]);

  const fetchData = useCallback(async (timeframe: string) => {
    /* A cache hit skips the loading state entirely — no spinner, no skeleton,
       the chart is simply there on the next paint. */
    const cached = barCache.get(`${symbol}:${timeframe}`);
    if (cached) {
      setBars(cached);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await fetchChartData(symbol, timeframe);
      setBars(data.bars);
      if (data.profile && onProfile) onProfile(data.profile);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [symbol, onProfile]);

  useEffect(() => { if (inited) fetchData(tf); }, [tf, fetchData, inited]);

  useEffect(() => {
    if (!containerRef.current || bars.length === 0) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(containerRef.current, {
      autoSize: true,
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

    /* Kept so the S/R levels can hang price lines off it below. */
    let mainSeries: ISeriesApi<'Candlestick'> | ISeriesApi<'Area'> | null = null;

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
      mainSeries = candleSeries;
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
      mainSeries = areaSeries;
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
        /* Drawn exactly like the channel's middle line — same weight, same
           dash — and kept white so it still reads as its own thing. */
        const trendSeries = chart.addSeries(LineSeries, {
          color: '#ffffff',
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: false,
        });
        trendSeries.setData(trendData);
      }
    }

    if (channel) {
      const ch = calcChannel(bars, bars.length);
      if (ch.mid.length > 1) {
        const midSeries = chart.addSeries(LineSeries, {
          color: '#94a3b8',
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: false,
        });
        midSeries.setData(ch.mid);
        const upperSeries = chart.addSeries(LineSeries, {
          color: '#94a3b8',
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: false,
        });
        upperSeries.setData(ch.upper);
        const lowerSeries = chart.addSeries(LineSeries, {
          color: '#94a3b8',
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: false,
        });
        lowerSeries.setData(ch.lower);
      }
    }

    /* Real price lines rather than two-point series. A series' axis label takes
       the series colour, which put full-strength red and green tags right next
       to the live price badge and made them easy to misread as the price.
       A price line lets the label be coloured on its own, so the line keeps its
       saturated colour on the chart while the tag stays a pale tint. */
    if (sr && mainSeries) {
      for (const lvl of calcSR(bars)) {
        const isR = lvl.type === 'R';
        mainSeries.createPriceLine({
          price: lvl.price,
          color: isR ? '#f43f5e' : '#22c55e',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          axisLabelColor: isR ? '#fca5a5' : '#86efac',
          axisLabelTextColor: '#0c1322',
          title: '',
        });
      }
    }

    if (resolvedLevels && resolvedLevels.length > 0 && mainSeries) {
      for (const lvl of resolvedLevels) {
        const isR = lvl.type === 'R';
        mainSeries.createPriceLine({
          price: lvl.price,
          color: isR ? '#f43f5e' : '#22c55e',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          axisLabelColor: isR ? '#fca5a5' : '#86efac',
          axisLabelTextColor: '#0c1322',
          title: '',
        });
      }
    }

    chart.timeScale().fitContent();
    chartRef.current = chart;

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [bars, tf, chartMode, trend, channel, sr, resolvedLevels]);

  if (!inited) return null;

  const mas = MA_CONFIG[tf] || MA_CONFIG['daily'];
  /* All ten buttons have to sit on one row. At the desktop size they overflow
     the narrow mobile popup and S/R wrapped onto a line of its own, so the
     padding and letter-spacing tighten below md — that is roughly 70px of
     width recovered, which is enough to fit on a phone. */
  const btnCls = (active: boolean) =>
    `text-[9px] md:text-[10px] font-bold px-1.5 md:px-2 py-1 rounded border tracking-normal md:tracking-wider transition-colors ${active ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30' : 'text-slate-500 border-white/10 hover:text-slate-300'}`;

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
  const atr = calcATR(bars);

  const displayVol = vol ?? (last ? last.volume : null);
  const displayDvol = dvol ?? (last ? last.close * last.volume : null);
  const avgVol = bars.length > 5 ? bars.slice(-20).reduce((s, b) => s + b.volume, 0) / Math.min(20, bars.length) : null;
  const displayRvol = rvol ?? (last && avgVol ? last.volume / avgVol : null);

  return (
    <div>
      <div className="flex items-center justify-between mb-1 flex-wrap gap-1">
        <div className="flex flex-wrap gap-0.5">
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
          <button onClick={(e) => { e.stopPropagation(); changeChannel(); }} className={btnCls(channel)}>CHAN</button>
          <button onClick={(e) => { e.stopPropagation(); changeSR(); }} className={btnCls(sr)}>S/R</button>
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
          {channel && (
            <span className="flex items-center gap-0.5 text-[7px] font-bold tracking-wider">
              <span className="w-2 h-[2px] rounded-full inline-block" style={{ backgroundColor: '#94a3b8' }} />
              <span style={{ color: '#94a3b8' }} className="opacity-80">CH</span>
            </span>
          )}
          {sr && (
            <span className="flex items-center gap-1 text-[7px] font-bold tracking-wider">
              <span className="w-2 h-[2px] inline-block" style={{ backgroundColor: '#f43f5e' }} />
              <span style={{ color: '#f43f5e' }} className="opacity-80">R</span>
              <span className="w-2 h-[2px] inline-block" style={{ backgroundColor: '#22c55e' }} />
              <span style={{ color: '#22c55e' }} className="opacity-80">S</span>
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
          {atr != null && <span className="text-slate-400">ATR <span className="text-slate-300">{atr >= 10 ? atr.toFixed(1) : atr.toFixed(2)}</span></span>}
          {displayVol != null && <span className="text-slate-400">VOL <span className="text-slate-300">{fmtVol(displayVol)}</span></span>}
          {displayDvol != null && <span className="text-slate-400">DVOL <span className="text-slate-300">${fmtVol(displayDvol)}</span></span>}
          {displayRvol != null && <span className={displayRvol >= 2 ? 'text-amber-400' : displayRvol >= 1.5 ? 'text-emerald-400' : 'text-slate-400'}>RVOL <span className="font-semibold">{displayRvol < 1 ? displayRvol.toFixed(1) : Math.round(displayRvol)}</span></span>}
          {rs != null && <span className={rs >= 80 ? 'text-emerald-400' : rs >= 50 ? 'text-amber-400' : 'text-rose-400'}>RS <span className="font-semibold">{rs}</span></span>}
          {stage && <span className="text-violet-400">STG <span className="font-semibold">{stage.replace(/^stage\s*/i, '')}</span></span>}
        </div>
      )}
      {/* A skeleton at the chart's exact height rather than a spinner. The
          spinner drew attention to the wait and, being a different size than
          the chart, made the popup resize the moment data landed. This holds
          the final dimensions so the chart fades in without moving anything. */}
      {/* The box always occupies the chart's height while loading so nothing
          reflows. The bar silhouette that used to sit here is gone: on mobile
          there is no hover to prefetch against, so the fetch always outlasted
          the delay and the grey bars showed on every single tap, reading as a
          broken chart a moment before the real one appeared. Only the shimmer
          remains, and only once the wait is long enough to be worth marking. */}
      {loading && (
        <div className="relative overflow-hidden rounded" style={{ height: h }}>
          {showSkeleton && (
            <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-white/[0.04] to-transparent" />
          )}
        </div>
      )}
      {error && (
        <div className="flex items-center justify-center text-[10px] text-rose-400" style={{ height: h }}>{error}</div>
      )}
      {!loading && !error && bars.length === 0 && (
        <div className="flex items-center justify-center text-[10px] text-slate-500" style={{ height: h }}>No data</div>
      )}
      <div
        ref={containerRef}
        style={{ height: h, width: '100%' }}
        className={loading || error || bars.length === 0 ? 'hidden' : ''}
      />
    </div>
  );
}

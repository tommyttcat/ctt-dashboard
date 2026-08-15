import type { Bar } from './marketMath';

export interface MacdResult {
  macd: number;
  signal: number;
  histogram: number;
}

function emaSeeded(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out.push(e);
  for (let i = period; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}

export function macd(bars: Bar[], fast = 12, slow = 26, sig = 9): MacdResult | null {
  if (bars.length < slow + sig) return null;
  const closes = bars.map(b => b.c);
  const emaFast = emaSeeded(closes, fast);
  const emaSlow = emaSeeded(closes, slow);
  const offset = slow - fast;
  const macdLine: number[] = [];
  for (let i = 0; i < emaSlow.length; i++) {
    macdLine.push(emaFast[i + offset] - emaSlow[i]);
  }
  if (macdLine.length < sig) return null;
  const signalLine = emaSeeded(macdLine, sig);
  const m = macdLine[macdLine.length - 1];
  const s = signalLine[signalLine.length - 1];
  return { macd: m, signal: s, histogram: m - s };
}

export function macdLabel(hist: number): string {
  return hist >= 0 ? 'bullish' : 'bearish';
}

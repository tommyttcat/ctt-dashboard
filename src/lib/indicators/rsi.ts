import type { Bar } from './marketMath';

export function rsi(bars: Bar[], period = 14): number | null {
  if (bars.length < period + 1) return null;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const delta = bars[i].c - bars[i - 1].c;
    if (delta > 0) avgGain += delta;
    else avgLoss -= delta;
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period + 1; i < bars.length; i++) {
    const delta = bars[i].c - bars[i - 1].c;
    avgGain = (avgGain * (period - 1) + (delta > 0 ? delta : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (delta < 0 ? -delta : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function rsiLabel(v: number): string {
  if (v >= 70) return 'overbought';
  if (v >= 55) return 'bullish';
  if (v >= 45) return 'neutral';
  if (v >= 30) return 'bearish';
  return 'oversold';
}

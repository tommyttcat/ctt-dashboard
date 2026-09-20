'use client';

// components/scan/TickerCell.tsx — the ticker cell, kept apart from the rest
// of the cell library on purpose.
//
// It is the only cell that needs the chart-hover component, which pulls in
// lightweight-charts. Keeping it here means components/scan/ScanTable.tsx has
// no heavy dependency and can be imported by a plain node script — which is
// what the render-equivalence check does.

import React from 'react';
import { tickerChipForScore, tickerTitle } from '@/lib/indicators/columnColors';
import TickerChartHover, { WatchlistBtn } from '../TickerChartHover';
import { SCAN } from './ScanTable';

export function TickerCell({ symbol, name, score }: { symbol: string; name?: string; score?: number | null }) {
  return (
    <td className={SCAN.td}>
      <div className="flex items-center justify-start gap-1.5">
        <WatchlistBtn symbol={symbol} />
        <TickerChartHover symbol={symbol}><span title={tickerTitle(name, symbol, score)} className={tickerChipForScore(score)}>{symbol}</span></TickerChartHover>
      </div>
    </td>
  );
}

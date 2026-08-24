'use client';

import React, { useState } from 'react';
import { useMarketData } from './MarketDataContext';

/* The benchmark SMA strip — symbol, a Day/Week toggle, and a dot per moving
 * average showing whether the benchmark is above or below it.
 *
 * It used to live inside the Top Movers filter bar, where it read as one more
 * filter for that table rather than what it is: a market-level reading that
 * belongs with the scorecard. Moved out verbatim; only its data source
 * changed, from Top Movers' own fetch to the shared snapshot. */

interface MovingAverage { label: string; value: number; above: boolean }

const PILL_WRAP = 'flex items-center gap-1.5 px-2 py-0.5 bg-[#161c2a] border border-white/5 rounded-lg shrink-0';

export default function BenchmarkStrips() {
  const { benchmarks } = useMarketData();
  if (!benchmarks?.length) return null;
  return (
    <div className="flex items-center justify-center gap-2 flex-wrap">
      {benchmarks.map((b) => <Strip key={b.symbol} benchmark={b} />)}
    </div>
  );
}

function Strip({ benchmark }: { benchmark: any }) {
  const [maTimeframe, setMaTimeframe] = useState<'day' | 'week'>('day');

  if (!benchmark) return null;

  const activeMas: MovingAverage[] =
    maTimeframe === 'day' ? (benchmark.day || benchmark.mas || []) : (benchmark.week || []);
  const unit = maTimeframe === 'day' ? 'D' : 'W';

  if (!activeMas.length) return null;

  return (
    <div className={PILL_WRAP}>
      <span className="text-[8px] font-bold tracking-widest uppercase text-[#7c8bfa]">{benchmark.symbol}</span>
      <div className="flex items-center bg-[#0b101a] border border-white/5 rounded-md p-0.5">
        {(['day', 'week'] as const).map((tf) => (
          <button
            key={tf}
            onClick={(e) => { e.stopPropagation(); setMaTimeframe(tf); }}
            className={`px-1.5 py-0.5 rounded text-[8px] font-bold tracking-widest uppercase transition-colors ${maTimeframe === tf ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-500 hover:text-slate-300'}`}
          >
            {tf === 'day' ? 'Day' : 'Week'}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        {activeMas.map((m, idx) => (
          <React.Fragment key={m.label}>
            {idx > 0 && <span className="text-[9px] text-slate-600">|</span>}
            <div
              className="flex items-center gap-1"
              title={`${benchmark.symbol} ${m.label}${unit} SMA: $${m.value.toFixed(2)} — ${m.above ? 'above' : 'below'}`}
            >
              <span className="text-[9px] font-medium text-slate-400">{m.label}</span>
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${m.above ? 'bg-emerald-400' : 'bg-rose-500'}`} />
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

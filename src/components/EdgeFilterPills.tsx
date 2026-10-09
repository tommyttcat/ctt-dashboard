'use client';

/* components/EdgeFilterPills.tsx — the GREEN / YELLOW / RED quick filter.
 *
 * One component for every card, because the shading means the same thing
 * everywhere even though the RULE behind it is different on each scan: green
 * is the bucket that paid in both halves of the 5-year test, red is the one
 * that lost, yellow is the rest. The per-scan tier functions live in
 * lib/scans/edge.ts and are the only place the thresholds exist.
 *
 * Behaviour is the Setups Summary card's, which shipped first and is what the
 * reader has already learned:
 *   - single select. Click a pill to isolate it, click it again for all.
 *   - a pill with no rows behind it is hidden rather than greyed.
 *   - counts come from the UNFILTERED rows, so an empty bucket is visible
 *     before it is clicked.
 *   - opens on GREEN, since the point of the card is the shortlist. A scan
 *     with no green rows today falls back to showing everything rather than
 *     an empty table, until the reader clicks — after that their choice
 *     stands.
 */

import React from 'react';
import { EDGE_TINT, type EdgeTier } from '@/lib/scans/edge';

export type { EdgeTier };

const ORDER: EdgeTier[] = ['green', 'yellow', 'red'];

const PILL_CLS: Record<EdgeTier, string> = {
  green: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  yellow: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  red: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
};

/** Tier counts for a list of rows under that card's own tier function. */
export function edgeCounts<T>(rows: T[], tierOf: (r: T) => EdgeTier | null): Record<EdgeTier, number> {
  const c: Record<EdgeTier, number> = { green: 0, yellow: 0, red: 0 };
  for (const r of rows) {
    const t = tierOf(r);
    if (t) c[t] += 1;
  }
  return c;
}

/**
 * Filter state for a card. Opens on green, and falls back to "all" while
 * green is empty — derived rather than corrected in an effect, so there is no
 * frame where the table renders empty and no state write during render. Once
 * the reader clicks anything their choice stands, including a deliberate
 * click onto an empty bucket.
 */
export function useEdgeFilter(counts: Record<EdgeTier, number>, initial: EdgeTier | null = 'green') {
  const [key, setKey] = React.useState<EdgeTier | null>(initial);
  const [touched, setTouched] = React.useState(false);

  const toggle = React.useCallback((t: EdgeTier) => {
    setTouched(true);
    setKey(prev => (prev === t ? null : t));
  }, []);

  const effective = touched || key == null || counts[key] > 0 ? key : null;

  return { key: effective, setKey, toggle };
}

export default function EdgeFilterPills({
  counts, active, onToggle, tips, className = '',
}: {
  counts: Record<EdgeTier, number>;
  active: EdgeTier | null;
  onToggle: (t: EdgeTier) => void;
  /** The per-scan explanation of what each colour measured. */
  tips: Record<EdgeTier, string>;
  className?: string;
}) {
  const total = counts.green + counts.yellow + counts.red;
  if (total === 0) return null;

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {ORDER.map(t => {
        if (counts[t] === 0) return null;
        const on = active === t;
        return (
          <button
            key={t}
            onClick={e => { e.stopPropagation(); onToggle(t); }}
            title={`${t.toUpperCase()} — ${tips[t]}`}
            className={`text-[9px] font-bold tracking-wider uppercase px-1.5 py-[2px] rounded border transition-all duration-150 ${
              on ? PILL_CLS[t] : active == null ? PILL_CLS[t] : 'text-slate-600 bg-transparent border-white/5'
            }`}
          >
            {t.toUpperCase()} {counts[t]}
          </button>
        );
      })}
    </div>
  );
}

/** The shared footer legend, so every card explains the shading the same way. */
export function EdgeLegend({ tips, className = '' }: { tips: Record<EdgeTier, string>; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500 ${className}`}>
      <span>Row shading — what the 5-year test measured on this scan:</span>
      {ORDER.map(t => (
        <span key={t} className="inline-flex items-center gap-1" title={tips[t]}>
          <span className={`inline-block w-2.5 h-2.5 rounded-sm ${EDGE_TINT[t]} border border-white/10`} />
          <span className="capitalize">{t}</span>
        </span>
      ))}
    </div>
  );
}

'use client';

/* components/ScanStatsNote.tsx — the footer line under a scan table.
 *
 * Every card shows a plan; this says what that plan has been worth over five
 * years on that scan. One line visible, the full breakdown on hover, so the
 * number a reader needs to size a position is on the card rather than in a
 * source comment. Figures and their caveats: lib/scans/stats.
 */

import React from 'react';
import { SCAN_STATS, type StatScan } from '@/lib/scans/stats';

export default function ScanStatsNote({ scan, className = '' }: { scan: StatScan; className?: string }) {
  const s = SCAN_STATS[scan];
  return (
    <div className={`px-3 md:px-5 py-2 text-[10px] text-slate-500 leading-snug ${className}`}>
      <span className="group relative inline-block cursor-help">
        <span className="text-slate-600 font-bold tracking-widest uppercase mr-1.5">Track record</span>
        <span className="text-slate-400">{s.headline}</span>
        <span className="absolute bottom-full left-0 mb-2 w-[380px] max-w-[80vw] px-3.5 py-2.5 rounded-lg bg-[#1a2035] border border-white/10 shadow-2xl text-[10px] leading-[1.6] text-slate-300 font-normal whitespace-pre-line opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-[9999]">
          {s.detail}
        </span>
      </span>
    </div>
  );
}

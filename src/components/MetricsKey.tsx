'use client';

// MetricsKey — the "?" that shows a table's scan gates.
//
// Deliberately minimal: just the thresholds. They are the one thing you
// genuinely cannot see anywhere else — when a name you are watching never
// appears, there is no way to know which gate ate it. Everything else has a
// home already: column meanings are native tooltips on the headers, and the
// filter pills carry their own.
//
// Hover to peek, click to pin. The close-delay matters — a panel that vanishes
// the moment the cursor leaves the "?" is unusable, since you have to cross
// dead space to read it.

import React, { useState, useRef, useEffect } from 'react';
import type { ScanConfigMeta, ScanGate } from '@/lib/scanConfig';

interface MetricsKeyProps {
  meta: ScanConfigMeta;
  /** Live gates from the scan payload — what the scan ACTUALLY enforced.
   *  Falls back to the static metadata when KV is cold. */
  liveGates?: ScanGate[] | null;
  /** Anchor right instead of left on tables where the "?" sits far over. */
  align?: 'left' | 'right';
}

const CLOSE_DELAY_MS = 220;

export default function MetricsKey({ meta, liveGates, align = 'left' }: MetricsKeyProps) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const gates = liveGates && liveGates.length > 0 ? liveGates : meta.gates;

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const scheduleClose = () => {
    if (pinned) return;
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };

  // Pinned panels close on outside click or Escape — otherwise the only way
  // out is finding the "?" again, which is worse than the problem.
  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setPinned(false);
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setPinned(false); setOpen(false); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pinned]);

  useEffect(() => () => cancelClose(), []);

  const togglePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pinned) { setPinned(false); setOpen(false); }
    else { setPinned(true); setOpen(true); }
  };

  return (
    <div
      ref={wrapRef}
      className="relative inline-block"
      onMouseEnter={() => { cancelClose(); setOpen(true); }}
      onMouseLeave={scheduleClose}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={togglePin}
        title={pinned ? 'Click to unpin' : 'Scan criteria'}
        className={`w-5 h-5 flex items-center justify-center rounded-full border text-[10px] font-bold transition-all duration-200 ${
          open
            ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
            : 'bg-[#161c2a] text-slate-500 border-white/5 hover:text-slate-300 hover:bg-white/[0.04]'
        }`}
      >
        ?
      </button>

      {open && (
        // Background set inline rather than via a Tailwind arbitrary value —
        // the utility was resolving transparent and the table bled through.
        <div
          className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-7 z-[60] rounded-xl border border-white/10 px-5 py-4`}
          style={{
            backgroundColor: '#0d121c',
            boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
            minWidth: '280px',
          }}
        >
          <div className="text-[11px] font-bold tracking-widest uppercase text-slate-200 whitespace-nowrap">
            {meta.title}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5 mb-3 whitespace-nowrap">
            {meta.shows}
          </div>

          <div className="space-y-1.5">
            {gates.map((g) => (
              <div key={g.label} className="flex items-baseline gap-6 whitespace-nowrap">
                <span className="text-[10px] font-bold tracking-wide uppercase text-slate-400 w-[92px] shrink-0">
                  {g.label}
                </span>
                <span className="text-[10px] font-semibold text-slate-200 tabular-nums">
                  {g.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
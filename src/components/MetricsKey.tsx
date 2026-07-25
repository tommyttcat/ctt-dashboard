'use client';

// MetricsKey — the "?" that shows a table's scan gates.
//
// Deliberately minimal: just the thresholds. They are the one thing you
// genuinely cannot see anywhere else — when a name you are watching never
// appears, there is no way to know which gate ate it. Column meanings live
// as native tooltips on the headers. Nothing else renders here: no FILTERS
// section, no glossary, no premise text.
//
// Hover to peek, click to pin. Background is a solid inline hex so it can
// never fall through to transparent regardless of layer ordering.

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
      if (e.key === 'Escape') {
        setPinned(false);
        setOpen(false);
      }
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
    if (pinned) {
      setPinned(false);
      setOpen(false);
    } else {
      setPinned(true);
      setOpen(true);
    }
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
        title={pinned ? 'Unpin' : 'Scan criteria — click to pin'}
        aria-label="Scan criteria"
        className={`w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center transition-colors ${
          pinned || open
            ? 'bg-indigo-500/30 text-[#7c8bfa] ring-1 ring-indigo-400/40'
            : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200'
        }`}
      >
        ?
      </button>

      {open && (
        <div
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          className={`absolute top-full mt-2 z-[70] w-[300px] rounded-xl border border-white/10 p-5 shadow-2xl shadow-black/60 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
          style={{ backgroundColor: '#10141f' }}
        >
          <div className="text-[13px] font-bold tracking-[0.12em] uppercase text-slate-100">
            {meta.title}
          </div>
          {meta.shows && (
            <div className="text-[11px] text-slate-500 mt-0.5 mb-3">{meta.shows}</div>
          )}

          <div className="space-y-2 mt-3">
            {gates.map((g) => (
              <div key={g.label} className="flex items-center justify-between gap-4">
                <span className="text-[10px] font-bold tracking-wide uppercase text-slate-400 whitespace-nowrap">
                  {g.label}
                </span>
                <span className="text-[11px] font-semibold text-slate-100 tabular-nums whitespace-nowrap">
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
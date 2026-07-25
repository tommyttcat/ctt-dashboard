'use client';

// MetricsKey — the "?" that documents a table's scan gates.
//
// Scope is deliberately narrow: this covers what you CANNOT see anywhere else.
// The thresholds are invisible by nature — when a name you are watching does
// not appear in a table, there is no way to know which gate ate it. That is
// what this answers.
//
// Column meanings are NOT here. Those live as native `title` tooltips on the
// column headers themselves, where you are already looking when the question
// occurs to you. A single panel trying to explain seventeen columns plus the
// gates plus the filters was 900px of wall text nobody would read.
//
// Behaviour: hover to peek, click to pin. The close-delay matters — a panel
// that vanishes the moment the cursor leaves the "?" is unusable, because you
// have to travel across dead space to read it.

import React, { useState, useRef, useEffect } from 'react';
import type { ScanConfigMeta, ScanGate } from '@/lib/scanConfig';
import { FILTER_NOTES } from '@/lib/scanConfig';

interface MetricsKeyProps {
  /** Scan metadata — falls back to the static import when the payload has none. */
  meta: ScanConfigMeta;
  /** Live gates from the scan payload. Overrides meta.gates when present, so
   *  the key shows what the scan ACTUALLY used rather than a hardcoded copy. */
  liveGates?: ScanGate[] | null;
  /** Anchor the panel to the right edge instead of the left. Use on tables
   *  where the "?" sits far enough right that a left-anchored panel overflows. */
  align?: 'left' | 'right';
}

/** How long the panel lingers after the cursor leaves. */
const CLOSE_DELAY_MS = 220;

export default function MetricsKey({ meta, liveGates, align = 'left' }: MetricsKeyProps) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
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
      setShowFilters(false);
    } else {
      setPinned(true);
      setOpen(true);
    }
  };

  const gateLabel = 'text-[10px] font-bold tracking-wide uppercase text-slate-300 whitespace-nowrap';
  const gateValue = 'text-[10px] font-semibold text-emerald-400/90 tabular-nums whitespace-nowrap';
  const gateWhy = 'text-[10px] text-slate-500 leading-relaxed';

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
        title={pinned ? 'Click to unpin' : 'Scan criteria — hover to read, click to pin'}
        className={`w-5 h-5 flex items-center justify-center rounded-full border text-[10px] font-bold transition-all duration-200 ${
          open
            ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
            : 'bg-[#161c2a] text-slate-500 border-white/5 hover:text-slate-300 hover:bg-white/[0.04]'
        }`}
      >
        ?
      </button>

      {open && (
        <div
          className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-7 z-[60] w-[520px] max-h-[70vh] overflow-y-auto custom-scrollbar bg-[#0d121c] border border-white/10 rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.75)] p-5`}
          style={{ scrollbarWidth: 'thin' }}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-3 pb-3 border-b border-white/5">
            <div>
              <div className="text-xs font-bold tracking-widest uppercase text-slate-200">{meta.title}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">{meta.shows}</div>
            </div>
            {pinned && (
              <button
                onClick={togglePin}
                className="shrink-0 text-[9px] font-bold tracking-widest uppercase text-slate-500 hover:text-slate-300 border border-white/5 rounded px-2 py-1 transition-colors"
              >
                Close
              </button>
            )}
          </div>

          {/* What the scan is looking for */}
          <p className="text-[11px] text-slate-400 leading-relaxed mb-4">{meta.premise}</p>

          {/* Scan gates — the part that is otherwise invisible */}
          <div className="space-y-2">
            {gates.map((g) => (
              <div key={g.label} className="flex items-start gap-3">
                <span className={`${gateLabel} w-[96px] shrink-0`}>{g.label}</span>
                <span className={`${gateValue} w-[112px] shrink-0`}>{g.value}</span>
                <span className={gateWhy}>{g.why}</span>
              </div>
            ))}
          </div>

          {/* Filter semantics — collapsed by default. These trip people up more
              than the thresholds do, because a filter that quietly means
              something other than what it says reads as a bug. */}
          <div className="mt-4 pt-3 border-t border-white/5">
            <button
              onClick={(e) => { e.stopPropagation(); setShowFilters(!showFilters); }}
              className="flex items-center gap-1.5 text-[9px] font-bold tracking-[0.14em] uppercase text-slate-500 hover:text-slate-300 transition-colors"
            >
              <span className={`inline-block transition-transform duration-200 ${showFilters ? 'rotate-90' : ''}`}>▸</span>
              How the filters behave
            </button>

            {showFilters && (
              <div className="space-y-2 mt-3">
                {FILTER_NOTES.map((f) => (
                  <div key={f.label} className="flex items-start gap-3">
                    <span className={`${gateLabel} w-[130px] shrink-0`}>{f.label}</span>
                    <span className={gateWhy}>{f.note}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-white/5 text-[9px] text-slate-600 leading-relaxed">
            Column meanings are on the headers — hover any column title.
          </div>
        </div>
      )}
    </div>
  );
}
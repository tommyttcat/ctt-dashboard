'use client';

// MetricsKey — the "?" that explains a table.
//
// Two problems this solves. First, the metrics have accumulated faster than
// anyone can hold them: CNF, RMV/RME, MF, ADR, DTC, TURN, sub-stages, and a
// colour language that is deliberately NOT monotonic (RMV is green when low,
// MF is green when high, and T2108 is green at both ends for opposite
// reasons). Second, and more useful: the scan gates are invisible. When a name
// you are watching does not appear, there is currently no way to know which
// threshold ate it. This shows them.
//
// Behaviour: hover to peek, click to pin. The close-delay matters — a panel
// this size that vanishes the moment the cursor leaves the "?" is unusable,
// because you have to travel across dead space to read it.

import React, { useState, useRef, useEffect } from 'react';
import type { ScanConfigMeta, ScanGate } from '@/lib/scanConfig';
import { FILTER_NOTES, COLUMN_NOTES } from '@/lib/scanConfig';

interface MetricsKeyProps {
  /** Scan metadata — falls back to the static import when the payload has none. */
  meta: ScanConfigMeta;
  /** Live gates from the scan payload. Overrides meta.gates when present, so
   *  the key shows what the scan ACTUALLY used rather than a hardcoded copy. */
  liveGates?: ScanGate[] | null;
  /** Column labels present on this table, in header order. */
  columns: string[];
}

/** How long the panel lingers after the cursor leaves. */
const CLOSE_DELAY_MS = 220;

export default function MetricsKey({ meta, liveGates, columns }: MetricsKeyProps) {
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

  // Only document columns this table actually shows.
  const shownColumns = columns
    .map((c) => ({ label: c, note: COLUMN_NOTES[c] }))
    .filter((c): c is { label: string; note: typeof COLUMN_NOTES[string] } => !!c.note);

  const sectionLabel = 'text-[9px] font-bold tracking-[0.14em] uppercase text-[#7c8bfa] mb-2';
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
        title={pinned ? 'Click to unpin' : 'Hover to read, click to pin'}
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
          className="absolute left-0 top-7 z-50 w-[560px] max-h-[70vh] overflow-y-auto custom-scrollbar bg-[#0b101a] border border-white/10 rounded-xl shadow-2xl p-5"
          style={{ scrollbarWidth: 'thin' }}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-4 pb-3 border-b border-white/5">
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
          <p className="text-[11px] text-slate-400 leading-relaxed mb-5">{meta.premise}</p>

          {/* Scan gates — the part that is otherwise invisible */}
          <div className="mb-5">
            <div className={sectionLabel}>Scan criteria</div>
            <div className="space-y-2">
              {gates.map((g) => (
                <div key={g.label} className="flex items-start gap-3">
                  <span className={`${gateLabel} w-[104px] shrink-0`}>{g.label}</span>
                  <span className={`${gateValue} w-[128px] shrink-0`}>{g.value}</span>
                  <span className={gateWhy}>{g.why}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Column glossary */}
          {shownColumns.length > 0 && (
            <div className="mb-5">
              <div className={sectionLabel}>Columns</div>
              <div className="space-y-2.5">
                {shownColumns.map(({ label, note }) => (
                  <div key={label}>
                    <div className="flex items-baseline gap-2">
                      <span className={gateLabel}>{label}</span>
                      <span className="text-[10px] text-slate-500 leading-relaxed">{note.what}</span>
                    </div>
                    {note.colour && (
                      <div className="text-[10px] text-slate-600 mt-0.5 pl-0.5">{note.colour}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Filter semantics — these look like bugs when forgotten */}
          <div>
            <div className={sectionLabel}>Filters</div>
            <div className="space-y-2">
              {FILTER_NOTES.map((f) => (
                <div key={f.label} className="flex items-start gap-3">
                  <span className={`${gateLabel} w-[140px] shrink-0`}>{f.label}</span>
                  <span className={gateWhy}>{f.note}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
'use client';

// components/scan/ScanTable.tsx — the React half of a scanner table.
//
// WHY THIS EXISTS
// ---------------
// CLAUDE.md: "All Summary Cards and Scanner tables must match the DailySetups
// scanner format — same columns, column alignment, column order, spacing and
// content." Twelve components were each keeping their own copy of that format,
// which is how `pillBtn` ended up with a trailing `cursor-pointer` in exactly
// one of them. The rule now has one implementation instead of twelve copies.
//
// DAILYSETUPS IS THE CANON. Every cell here was lifted from it verbatim; where
// 10/21 had drifted, the difference is called out on the cell rather than
// parameterised, so the next person can see what was reconciled and why.
//
// The non-React half — formatters, plan badge, filter buckets — is
// lib/scans/tableFormat.ts, and this file may never be imported back into it:
// a cycle through a component fails a Next build in a way the error does not
// explain. See the MarketSummary split (c5cdeef) for the same rule.
//
// Extracted 20 Sep 2026. Adopted by DailySetups and Consolidation1021; the
// other ten tables still hold their own copies and can move over one at a
// time, which is the point of doing it as cells rather than one big table.

import React from 'react';
import { stageShort, stageDescription, stageBadge } from '@/lib/indicators/stage';
import { mfColor, mfLabel, mfArrow } from '@/lib/indicators/moneyflow';
import { rsTooltip, rsBadge } from '@/lib/indicators/rs';
import { chopTooltip } from '@/lib/indicators/chop';
import {
  rvolColor as getRvolColor,
  adrColor as getAdrColor,
  dtcColor as getDtcColor,
  stochColor as getStochColor,
  floatColor as getFloatColor,
  scoreCellCls,
} from '@/lib/indicators/columnColors';
import { formatNumber, formatCurrency, emaDotClass } from '@/lib/scans/tableFormat';

/* The format itself. These were identical, character for character, in every
   table that declared them; they are the rule made literal. */
export const SCAN = {
  th: 'px-0.5 py-2.5 text-[10px] text-slate-500 font-bold tracking-wide leading-tight cursor-pointer hover:text-slate-300 transition-colors text-center',
  td: 'px-0.5 pt-2.5 pb-1.5 text-center',
  // STAGE: left-aligned so short codes sit against the left edge.
  thStage: 'px-0.5 pl-1.5 py-2.5 text-[10px] text-slate-500 font-bold tracking-wide leading-tight cursor-pointer hover:text-slate-300 transition-colors text-left',
  tdStage: 'px-0.5 pl-1.5 pt-2.5 pb-1.5 text-left',
  // SECTOR: LEFT-aligned so it starts right after STAGE.
  thSector: 'px-0.5 pl-1.5 py-2.5 text-[10px] text-slate-500 font-bold tracking-wide leading-tight cursor-pointer hover:text-slate-300 transition-colors text-left',
  tdSector: 'px-0.5 pl-1.5 pt-2.5 pb-1.5 text-left',
  filterBtnActive: 'bg-[#1e293b] text-indigo-400 border border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.1)]',
  filterBtnIdle: 'text-slate-500 border border-transparent hover:text-slate-300 hover:bg-white/[0.02]',
  pillWrap: 'flex items-center gap-3 px-4 py-1 bg-[#161c2a] border border-white/5 rounded-lg shrink-0',
  pillLabel: 'text-[11px] font-bold tracking-widest uppercase text-slate-400',
  pillBtn: 'px-3 py-1 rounded-lg text-[11px] font-bold tracking-widest uppercase transition-all duration-300 whitespace-nowrap',
} as const;

/* ---- Header -------------------------------------------------------------
   A column with no `onSort` keeps the hover styling of a sortable one, which
   is how the 10/21 column has always rendered — the classes are part of the
   format, not a claim that the column sorts. */
export function SortHeader({ label, width, title, icon = '', onSort, variant = 'base', className = '' }: {
  label: React.ReactNode;
  width: string;
  title?: string;
  icon?: string;
  onSort?: () => void;
  variant?: 'base' | 'stage' | 'sector';
  className?: string;
}) {
  const base = variant === 'stage' ? SCAN.thStage : variant === 'sector' ? SCAN.thSector : SCAN.th;
  return (
    <th className={`${base} ${width}${className ? ` ${className}` : ''}`} title={title} onClick={onSort}>
      {label}{icon}
    </th>
  );
}

/* ---- Filter pills -------------------------------------------------------
   One group: a label and its buttons. Every table built this by hand from the
   same three class strings. */
export function FilterPillGroup<T extends string>({ label, options, active, onSelect, labelOf, titleOf }: {
  label: string;
  options: readonly T[];
  active: T | 'All';
  onSelect: (opt: T) => void;
  labelOf?: (opt: T) => string;
  titleOf?: (opt: T) => string | undefined;
}) {
  return (
    <div className={SCAN.pillWrap}>
      <span className={SCAN.pillLabel}>{label}</span>
      <div className="flex items-center gap-1">
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onSelect(opt)}
            title={titleOf?.(opt)}
            className={`${SCAN.pillBtn} ${active === opt ? SCAN.filterBtnActive : SCAN.filterBtnIdle}`}
          >
            {labelOf ? labelOf(opt) : opt}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---- Dots ---------------------------------------------------------------
   The title differs per table — the 10/21 names the mechanism, the momentum
   tables name the setup — so it is a prop with the DailySetups text as the
   default. */
export const BlueDot = ({ className = '', title = 'Blue Dot Reversal' }: { className?: string; title?: string }) => (
  <span
    title={title}
    className={`inline-block w-1.5 h-1.5 rounded-full bg-sky-400 shadow-[0_0_5px_rgba(56,189,248,0.6)] align-middle shrink-0 ${className}`}
  />
);

export const RedDot = ({ className = '', title = 'Red Dot — overbought reversal against a long' }: { className?: string; title?: string }) => (
  <span
    title={title}
    className={`inline-block w-1.5 h-1.5 rounded-full bg-rose-500 shadow-[0_0_5px_rgba(244,63,94,0.6)] align-middle shrink-0 ${className}`}
  />
);

// ---- Cells ----------------------------------------------------------------
// Each renders exactly what the two tables rendered inline. Props are values
// rather than a row, so a table keeps its own row type and no normalisation
// layer has to exist.

/* '--', not '—', when unscored: it is the width of a number, so the column
   does not jump. */
export function ScoreCell({ value, title }: { value: number | null | undefined; title?: string }) {
  return (
    <td className={SCAN.td}>
      <span title={title} className={scoreCellCls(value)}>
        {value != null ? value : '--'}
      </span>
    </td>
  );
}

export function RsCell({ value }: { value: number | null | undefined }) {
  return (
    <td className={`${SCAN.td} whitespace-nowrap`} title={rsTooltip(value)}>
      <span className={`inline-block px-1 py-[1px] rounded border text-[9px] font-bold tabular-nums cursor-help ${rsBadge(value)}`}>{value ?? '—'}</span>
    </td>
  );
}

/* The VWAP dot is a filter control, not decoration — clicking it filters the
   table to that side, and the ring shows when it is the active filter. */
export function PriceCell({ price, vwapStatus, vwapFilter, onToggleVwap }: {
  price: number;
  vwapStatus?: 'above' | 'below' | 'neutral' | null;
  vwapFilter?: string;
  onToggleVwap?: (side: 'above' | 'below') => void;
}) {
  return (
    <td className={`${SCAN.td} text-[10px] text-slate-300 font-medium whitespace-nowrap tabular-nums`}>
      <div className="flex items-center justify-center gap-1">${price.toFixed(2)}{vwapStatus && vwapStatus !== 'neutral' && (<div onClick={(e) => { e.stopPropagation(); onToggleVwap?.(vwapStatus as 'above' | 'below'); }} className={`w-1.5 h-1.5 rounded-full shrink-0 cursor-pointer ${vwapStatus === 'above' ? 'bg-emerald-400' : 'bg-rose-500'} ${vwapFilter === vwapStatus ? 'ring-1 ring-white/40' : ''}`} title={`VWAP: ${vwapStatus} — click to filter`}></div>)}</div>
    </td>
  );
}

export function ChgCell({ value }: { value: number | null | undefined }) {
  const isPositive = (value ?? 0) >= 0;
  return (
    <td className={`${SCAN.td} text-[10px] font-bold whitespace-nowrap tabular-nums ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
      {value != null ? `${isPositive ? '+' : ''}${value.toFixed(2)}%` : '—'}
    </td>
  );
}

/* The 10/21 pair. Hover text is the caller's, because the two tables read the
   same dots for different purposes: posture on the momentum tables, the
   signed gap into RDY on the coil table. */
export function Ema1021Cell({ above10, above21, title }: {
  above10: boolean | null | undefined;
  above21: boolean | null | undefined;
  title?: string;
}) {
  return (
    <td className={`${SCAN.td} whitespace-nowrap`}>
      <div className="flex items-center justify-center gap-1" title={title}>
        <div className="flex items-center gap-px">
          <span className="text-[8px] font-bold text-slate-500">10</span>
          <div className={`w-1.5 h-1.5 rounded-full ${emaDotClass(above10)}`} title={`10 EMA: ${above10 == null ? 'n/a' : above10 ? 'above' : 'below'}`}></div>
        </div>
        <div className="flex items-center gap-px">
          <span className="text-[8px] font-bold text-slate-500">21</span>
          <div className={`w-1.5 h-1.5 rounded-full ${emaDotClass(above21)}`} title={`21 EMA: ${above21 == null ? 'n/a' : above21 ? 'above' : 'below'}`}></div>
        </div>
      </div>
    </td>
  );
}

export function VolCell({ value }: { value: number | null | undefined }) {
  return <td className={`${SCAN.td} text-[10px] text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{formatNumber(value)}</td>;
}

/* `fallback` is the coil table's average dollar volume: a base that has gone
   quiet may have no dollar volume today worth printing. */
export function DollarVolCell({ value, fallback }: { value: number | null | undefined; fallback?: string }) {
  return (
    <td className={`${SCAN.td} text-[10px] text-slate-400 font-medium whitespace-nowrap tabular-nums`}>
      {value ? formatCurrency(value) : (fallback ?? '—')}
    </td>
  );
}

export function RvolCell({ value }: { value: number | null | undefined }) {
  return (
    <td className={`${SCAN.td} text-[10px] font-bold whitespace-nowrap tabular-nums ${getRvolColor(value)}`}>
      {value ? `${value < 1 ? value.toFixed(1) : Math.round(value)}x` : '—'}
    </td>
  );
}

export function FloatCell({ value }: { value: number | null | undefined }) {
  return <td className={`${SCAN.td} text-[10px] font-bold whitespace-nowrap tabular-nums ${getFloatColor(value)}`}>{formatNumber(value)}</td>;
}

/* ADR, optionally carrying CHOP in the same cell. The momentum tables stack
   the two deliberately — ADR says the name MOVES, CHOP says it moves
   SOMEWHERE, and adjacent columns would let the eye take one without the
   other. Pass `chop` to get that cell; omit it for the plain ADR cell. */
export function AdrCell({ adr, chop }: { adr: number | null; chop?: number | null }) {
  if (chop === undefined) {
    return (
      <td className={`${SCAN.td} text-[10px] font-bold whitespace-nowrap tabular-nums ${getAdrColor(adr)}`}>
        {adr != null ? `${adr.toFixed(1)}%` : '—'}
      </td>
    );
  }
  return (
    <td className={`${SCAN.td} whitespace-nowrap tabular-nums cursor-help`} title={chopTooltip(chop, adr)}>
      <div className="flex flex-col leading-tight">
        <span className={`text-[10px] font-bold ${getAdrColor(adr)}`}>
          {adr != null ? `${adr.toFixed(1)}%` : '—'}
        </span>
      </div>
    </td>
  );
}

export function MfCell({ value, trend }: { value: number | null; trend?: number }) {
  return (
    <td className={`${SCAN.td} text-[10px] font-bold whitespace-nowrap tabular-nums ${mfColor(value)}`} title={value != null ? `Money Flow ${value.toFixed(0)} — ${mfLabel(value)}` : undefined}>
      {value != null ? `${value.toFixed(0)}${mfArrow(trend ?? 0)}` : '—'}
    </td>
  );
}

export function StochCell({ value }: { value: number | null | undefined }) {
  return <td className={`${SCAN.td} text-[10px] font-bold whitespace-nowrap tabular-nums ${getStochColor(value)}`}>{value != null ? value.toFixed(1) : '—'}</td>;
}

export function DtcCell({ value }: { value: number | null | undefined }) {
  return (
    <td className={`${SCAN.td} text-[10px] font-bold whitespace-nowrap tabular-nums ${getDtcColor(value)}`}>
      {value != null ? value.toFixed(1) : '—'}
    </td>
  );
}

export function McapCell({ value }: { value: number | null | undefined }) {
  return <td className={`${SCAN.td} text-[10px] text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{formatNumber(value)}</td>;
}

export function StageCell({ stage }: { stage: string | null | undefined }) {
  return (
    <td className={`${SCAN.tdStage} whitespace-nowrap border-l border-white/5`}>
      <span
        title={stageDescription(stage)}
        className={`inline-block px-1 py-[1px] rounded border text-[9px] font-bold tabular-nums tracking-wide cursor-help ${stageBadge(stage)}`}
      >
        {stageShort(stage)}
      </span>
    </td>
  );
}

export function SectorCell({ text }: { text: string }) {
  return (
    <td className={SCAN.tdSector}>
      <span title={text} className="block truncate text-left text-[8px] font-semibold tracking-wide uppercase text-slate-400">{text}</span>
    </td>
  );
}

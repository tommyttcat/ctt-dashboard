// lib/scans/tableFormat.ts — the non-React half of a scanner table.
//
// WHY THIS EXISTS
// ---------------
// CLAUDE.md requires every scanner table to match the DailySetups format:
// same columns, same alignment, same spacing, same badge sizes. That rule was
// being kept by hand in twelve components, each holding its own copy of the
// same formatters and the same class strings. A rule maintained by copy-paste
// is a rule that drifts, and it already had: `pillBtn` picked up a trailing
// `cursor-pointer` in one table and nowhere else.
//
// Anything a table needs that is NOT React lives here. The React half —
// the cells and the header — is components/scan/ScanTable.tsx.
//
// NO JSX, NO REACT IMPORT, and it must stay that way: the components import
// this, and a cycle back through a component is a Next build failure whose
// error message does not say so. Same rule as lib/summary/rowFormat.ts.
//
// Extracted verbatim from DailySetups (the canonical table) and
// Consolidation1021 on 20 Sep 2026; no behaviour change.

/* Coerce a field that may arrive as a string, null or NaN from KV. */
export const numField = (v: unknown): number | null => {
  if (v == null || isNaN(Number(v))) return null;
  return Number(v);
};

export const formatTime = (timestamp: number | Date) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
};

export const formatNumber = (num: number | null | undefined) => {
  if (num === null || num === undefined || num === 0 || isNaN(num)) return '—';
  if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return num.toLocaleString();
};

export const formatCurrency = (num: number | null | undefined) => {
  if (num === null || num === undefined || num === 0 || isNaN(num)) return '—';
  if (num >= 1e9) return '$' + (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return '$' + (num / 1e6).toFixed(1) + 'M';
  return '$' + num.toLocaleString();
};

// Price levels drop the cents on anything three digits or more — at $886 the
// pennies are noise, at $4.18 they are the whole trade.
export const formatLevel = (v: number | null | undefined): string => {
  if (v == null || isNaN(Number(v))) return '—';
  const n = Number(v);
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(2);
};

export const statePair = (rmv: number | null, rme: number | null): string => {
  const v = rmv == null ? '—' : String(Math.round(rmv));
  const e = rme == null ? '—' : String(Math.round(rme));
  return `${v}/${e}`;
};

/* Grey when the EMA is unknown — an absent reading is not a "below". */
export const emaDotClass = (state: boolean | null | undefined) => {
  if (state === null || state === undefined) return 'bg-slate-600';
  return state ? 'bg-emerald-400' : 'bg-rose-500';
};

// ---------------------------------------------------------------
// Trade plan — the RTR badge.
//
// The scan computes trigger / stop / 2R target / distance-to-resistance and
// ships them on every row. These read that object; nothing is recalculated,
// so the table cannot disagree with the score.
//
// `watch` is the 10/21 table's gate: outside its green bucket the levels are
// still worth seeing but the plan is not worth taking, so the badge reads
// WATCH. Every other table passes nothing and the branch never fires.
// ---------------------------------------------------------------
export interface TradePlanRow {
  family?: string;
  trigger?: number | null;
  triggerLabel?: string;
  trail?: number | null;
  trailLabel?: string;
  stop?: number | null;
  stopPct?: number | null;
  target?: number | null;
  rMultiple?: number;
  resistanceR?: number | null;
  resistanceLabel?: string | null;
  clear?: boolean;
  collapsed?: boolean;
  overextended?: boolean;
  tradeable?: boolean;
  note?: string;
}

export const PLAN_SORT_CLEAR = 99;
export const PLAN_SORT_NONE = -1;

export interface PlanOpts { watch?: boolean }

export const planShortOf = (p: TradePlanRow | null, opts?: PlanOpts): string => {
  if (p && p.tradeable === true && opts?.watch) return 'WATCH';
  if (!p) return '—';
  if (p.collapsed) return '✕';
  if (p.tradeable !== true) return '—';
  if (p.overextended) return 'EXT';
  if (p.clear) return p.resistanceR != null ? `${p.resistanceR.toFixed(1)}R` : '2R+';
  if (p.resistanceR == null) return '—';
  return `${p.resistanceR.toFixed(1)}R`;
};

export const planBadgeOf = (p: TradePlanRow | null, opts?: PlanOpts): string => {
  if (p && p.tradeable === true && opts?.watch) return 'bg-white/[0.02] text-slate-500 border-white/10';
  if (!p) return 'bg-white/[0.02] text-slate-600 border-white/5';
  if (p.collapsed) return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
  if (p.tradeable !== true) return 'bg-white/[0.02] text-slate-600 border-white/5';
  if (p.overextended) return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
  if (p.clear) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
  const r = p.resistanceR;
  if (r == null) return 'bg-white/[0.02] text-slate-600 border-white/5';
  if (r >= 1.0) return 'bg-slate-500/10 text-slate-300 border-white/10';
  if (r >= 0.5) return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
  return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
};

/* A name with no plan must sort to the BOTTOM rather than the top, and
   `clear` rows have no resistanceR at all when price is above every average —
   those are the BEST rows, so they need a high sentinel rather than a null. */
export const planSortValueOf = (p: TradePlanRow | null, opts?: PlanOpts): number => {
  if (opts?.watch) return PLAN_SORT_NONE;
  if (!p || p.tradeable !== true) return PLAN_SORT_NONE;
  if (p.collapsed) return PLAN_SORT_NONE;
  if (p.overextended) return PLAN_SORT_NONE;
  if (p.clear) return p.resistanceR != null ? p.resistanceR : PLAN_SORT_CLEAR;
  return p.resistanceR != null ? p.resistanceR : PLAN_SORT_NONE;
};

// ---------------------------------------------------------------
// Filters shared by every table. The BUCKETS arrays drive the pills, so a
// table gets the same controls in the same order without restating them.
// ---------------------------------------------------------------
export type SortDirection = 'asc' | 'desc';
export type CnfFilterType = 'All' | 'A' | 'B';
export type VwapFilterType = 'All' | 'above' | 'below';
export type AdrFilterType = 'All' | '5' | '10';
export type PlanFilterType = 'All' | '1R' | '2R';
export type CapFilterType = 'All' | 'Small' | 'Large';

export const CNF_BUCKETS: CnfFilterType[] = ['A', 'B'];
export const CNF_MIN_SCORE: Record<'A' | 'B', number> = { A: 70, B: 50 };
export const ADR_BUCKETS: AdrFilterType[] = ['5', '10'];
export const PLAN_BUCKETS: PlanFilterType[] = ['1R', '2R'];
export const CAP_BUCKETS: CapFilterType[] = ['Small', 'Large'];

/* $2B is the large/small line. A missing cap passes rather than fails —
   absent reference data is not evidence of a small company. */
export const matchesCapFilter = (mktCap: number | null | undefined, filter: CapFilterType): boolean => {
  if (!mktCap) return true;
  if (filter === 'Large') return mktCap >= 2e9;
  if (filter === 'Small') return mktCap < 2e9;
  return true;
};

// ---------------------------------------------------------------
// CNF tooltip body — the per-component breakdown, biggest contribution
// first. Each table passes its own label map so a scan-specific component
// (the 10/21's `coil`) reads as words rather than a key.
// ---------------------------------------------------------------
export const BASE_CNF_LABELS: Record<string, string> = {
  rvol: 'Relative volume',
  gap: 'Gap',
  rangeExpansion: 'Range expansion',
  relStrength: 'RS vs market',
  catalyst: 'Catalyst',
  earnings: 'Earnings proximity',
  persistence: 'Scan persistence',
  extension: 'Extension (RME)',
  vwap: 'VWAP',
  regime: 'Market regime',
  sector: 'Sector heat',
  moneyFlow: 'Money Flow',
  dot: 'Blue dot',
  reclaim: '10 EMA reclaimed',
  runway: 'Runway to target',
};

export const cnfBreakdownLines = (
  breakdown: Record<string, number> | null | undefined,
  labels: Record<string, string> = BASE_CNF_LABELS,
): string[] => {
  if (!breakdown || typeof breakdown !== 'object') return [];
  const entries = Object.entries(breakdown)
    .filter(([, v]) => typeof v === 'number' && v !== 0)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  if (entries.length === 0) return [];
  return ['', ...entries.map(([k, v]) => `${v > 0 ? '+' : ''}${v}  ${labels[k] || k}`)];
};

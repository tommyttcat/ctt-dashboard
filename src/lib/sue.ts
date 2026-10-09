// lib/sue.ts — the earnings surprise (SUE) behind Momentum Leaders' ranking.
//
// SUE, as scripts/backtest/rank-pead.ts tested it (9 Oct 2026): the latest
// quarter's EPS minus the same fiscal quarter a year earlier, divided by the
// standard deviation of those year-on-year changes over up to 8 earlier
// quarters (at least 4). Point in time by FILING date; a score is only used
// while its latest quarter was filed within the last 92 days.
//
// Fidelity notes. The test's fundamentals carried fiscal Q1-Q3 only (no Q4
// from the annual 10-K), so Q4 rows from FMP are dropped here to keep the
// same definition. EPS is FMP's `eps` (basic).
//
// SUE only changes when a new quarter is filed, so the store keeps one score
// per ticker with the filing date it is anchored to — not the history.

export const SUE_KEY = 'earnings_sue_v1';
export const SUE_FRESH_DAYS = 92;

export type Qtr = { fy: number; fp: string; filed: string; eps: number | null };

/** SUE from quarters known by `date` (filed on or before it). Null when undefined. */
export function sueAt(quarters: Qtr[], date: string): { sue: number | null; filed: string | null } {
  const known = quarters.filter(x => x.filed <= date && x.eps != null && x.fp !== 'Q4')
    .sort((a, b) => (a.filed < b.filed ? 1 : a.filed > b.filed ? -1 : 0));
  if (!known.length) return { sue: null, filed: null };
  const filed = known[0].filed;
  const diff = (x: Qtr) => { const p = known.find(y => y.fy === x.fy - 1 && y.fp === x.fp); return p ? (x.eps as number) - (p.eps as number) : null; };
  const dL = diff(known[0]);
  if (dL == null) return { sue: null, filed };
  const hist: number[] = [];
  for (const x of known.slice(1)) { const d = diff(x); if (d != null) hist.push(d); if (hist.length === 8) break; }
  if (hist.length < 4) return { sue: null, filed };
  const m = hist.reduce((a, b) => a + b, 0) / hist.length;
  const sd = Math.sqrt(hist.reduce((a, b) => a + (b - m) ** 2, 0) / (hist.length - 1));
  return { sue: sd > 0 ? dL / sd : null, filed };
}

/** FMP /stable/income-statement?period=quarter rows → quarters. */
export function fromFmp(rows: { fiscalYear?: string | number; period?: string; filingDate?: string; eps?: number | null }[]): Qtr[] {
  return rows
    .filter(r => r.filingDate && r.period && /^Q[1-4]$/.test(r.period) && r.fiscalYear != null)
    .map(r => ({ fy: Number(r.fiscalYear), fp: r.period as string, filed: String(r.filingDate).slice(0, 10), eps: typeof r.eps === 'number' && Number.isFinite(r.eps) ? r.eps : null }));
}

export interface SueEntry { s: number | null; f: string | null; a: string }   // score, anchoring filing date, fetched on
export interface SueStore { updatedAt: string; map: Record<string, SueEntry> }

/** Is this stored score usable on `date`? */
export const sueFresh = (e: SueEntry | undefined, date: string): e is SueEntry & { s: number; f: string } =>
  !!e && e.s != null && e.f != null && (Date.parse(date) - Date.parse(e.f)) / 86400000 <= SUE_FRESH_DAYS;

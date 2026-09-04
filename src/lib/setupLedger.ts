/**
 * Setup ledger — the append-only record of every setup the analyst publishes.
 *
 * WHY THIS EXISTS
 * ---------------
 * The brief has always published setups with exact levels, but nothing kept
 * them. `analyst_brief_v1` is overwritten on every POST (64 a day) and the
 * archive stored the whole document, so there was no way to ask the only
 * question that matters: do these setups actually work?
 *
 * You cannot score what you did not record, and a record written after the
 * outcome is known proves nothing. So the ledger is written at publish time,
 * before price has resolved anything, and is never rewritten. The scoring job
 * appends outcomes to a separate key; it cannot touch the entries themselves.
 *
 * INTEGRITY RULES (these are the product, not implementation detail)
 * -----------------------------------------------------------------
 *  1. One record per (date, ticker). A name in all three buckets is tagged
 *     with all three and counted once — otherwise n inflates threefold and the
 *     win rate is meaningless.
 *  2. Written once per session and frozen. `writeLedgerOnce` refuses to
 *     overwrite an existing date.
 *  3. No outcome field at write time. Absence of an outcome is what proves the
 *     entry predates its own result.
 *  4. Setups that never trigger are recorded like any other. They resolve to
 *     `no_trade`, are published as such, and are never silently dropped —
 *     dropping them is how a track record gets faked.
 */

export type SetupBucket = 'top' | 'confluence' | 'conviction';

/** Resolved by the scoring job. Absent on a freshly written entry. */
export type SetupOutcome = 'no_trade' | 'win' | 'loss' | 'open';

export interface SetupEntry {
  /** ET calendar date this setup was published (YYYY-MM-DD). */
  date: string;
  ticker: string;
  /** Every bucket this name appeared in, de-duplicated. */
  buckets: SetupBucket[];
  direction: 'long' | 'short';
  /** Price at publish time — the mark a no-trade is measured against. */
  refPrice: number | null;
  trigger: number | null;
  stop: number | null;
  target: number | null;
  /** As published. Recomputed on read rather than trusted. */
  rMultiple: number | null;
  invalidation?: string;
  thesis?: string;
  /** Free-text provenance, e.g. "Top Trades" or "confluence_report_v1". */
  sources: string[];
  recordedAt: string;
}

export interface SetupLedger {
  date: string;
  recordedAt: string;
  /** Which brief phase produced the record. Always 'closing' today. */
  phase: string;
  entries: SetupEntry[];
}

export const LEDGER_KEY = (date: string) => `setup_ledger:${date}`;
export const LEDGER_INDEX_KEY = 'setup_ledger_index';
export const SCORECARD_KEY = 'setup_scorecard_v1';

/* ── parsing helpers ─────────────────────────────────────────────────────── */

/**
 * Confluence trade recs store levels as display strings ("$123.45"), and the
 * analyst may send numbers or strings. Anything non-finite becomes null rather
 * than 0 — a 0 trigger would score as an instant fill and silently manufacture
 * wins.
 */
export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Pull the first **TICKER** out of a conviction line. */
export function tickerFromProse(s: string): string | null {
  const m = /\*\*([A-Z][A-Z0-9.\-]{0,9})\*\*/.exec(s || '');
  return m ? m[1] : null;
}

/** (target - trigger) / (trigger - stop), sign-corrected for shorts. */
export function computeR(
  trigger: number | null,
  stop: number | null,
  target: number | null,
): number | null {
  if (trigger == null || stop == null || target == null) return null;
  const risk = Math.abs(trigger - stop);
  if (risk === 0) return null;
  return Math.round((Math.abs(target - trigger) / risk) * 100) / 100;
}

function directionOf(trigger: number | null, stop: number | null): 'long' | 'short' {
  if (trigger != null && stop != null && stop > trigger) return 'short';
  return 'long';
}

/* ── extraction ──────────────────────────────────────────────────────────── */

function sectionRows(brief: any, name: string): any[] {
  const sec = (brief?.sections || []).find(
    (s: any) => String(s?.section || '').toLowerCase() === name.toLowerCase(),
  );
  return Array.isArray(sec?.stocks) ? sec.stocks : [];
}

/**
 * Top Setups — the Top Trades rows. These are the only brief rows carrying
 * trigger/stop/target; every other stock row shares the same schema and would
 * otherwise be swept in as a "setup" it never was.
 */
export function extractTopSetups(brief: any): SetupEntry[] {
  return sectionRows(brief, 'Top Trades')
    .filter((r: any) => r?.ticker && num(r.trigger) != null)
    .map((r: any) => {
      const trigger = num(r.trigger);
      const stop = num(r.stop);
      const target = num(r.target);
      return {
        date: '',
        ticker: String(r.ticker).toUpperCase(),
        buckets: ['top'] as SetupBucket[],
        direction: directionOf(trigger, stop),
        refPrice: num(r.price),
        trigger,
        stop,
        target,
        rMultiple: computeR(trigger, stop, target),
        invalidation: r.invalidation ? String(r.invalidation) : undefined,
        thesis: r.thesis ? String(r.thesis) : undefined,
        sources: ['Top Trades'],
        recordedAt: '',
      };
    });
}

/**
 * Conviction — `summary.conviction` is prose, so only the ticker is reliably
 * recoverable. Levels are backfilled by the merge when the same name also
 * appears in Top Trades or Confluence; a conviction call with no levels
 * anywhere is still recorded, and resolves as `no_trade` rather than being
 * quietly discarded.
 */
export function extractConviction(brief: any): SetupEntry[] {
  const lines: string[] = Array.isArray(brief?.summary?.conviction)
    ? brief.summary.conviction
    : [];
  const out: SetupEntry[] = [];
  for (const line of lines) {
    const ticker = tickerFromProse(String(line));
    if (!ticker) continue;
    out.push({
      date: '',
      ticker,
      buckets: ['conviction'],
      direction: 'long',
      refPrice: null,
      trigger: null,
      stop: null,
      target: null,
      rMultiple: null,
      thesis: String(line).replace(/\*\*/g, ''),
      sources: ['summary.conviction'],
      recordedAt: '',
    });
  }
  return out;
}

/** Confluence Setups — cards from `confluence_report_v1`, levels as strings. */
export function extractConfluence(reports: any[]): SetupEntry[] {
  if (!Array.isArray(reports)) return [];
  return reports
    .filter((r: any) => r?.ticker && r?.tradeRec)
    .map((r: any) => {
      const trigger = num(r.tradeRec.entry);
      const stop = num(r.tradeRec.stopLoss);
      const target = num(r.tradeRec.takeProfit);
      const dir = String(r.tradeRec.direction || '').toUpperCase().includes('SHORT')
        ? 'short'
        : 'long';
      return {
        date: '',
        ticker: String(r.ticker).toUpperCase(),
        buckets: ['confluence'] as SetupBucket[],
        direction: dir as 'long' | 'short',
        refPrice: num(r.price),
        trigger,
        stop,
        target,
        rMultiple: computeR(trigger, stop, target),
        sources: ['confluence_report_v1'],
        recordedAt: '',
      };
    });
}

/**
 * Merge to one record per ticker, unioning buckets and sources.
 *
 * Levels are taken from the first contributor that has them — Top Trades are
 * passed first because those are the hand-built levels with a stated
 * invalidation, and they should win over the confluence scanner's derived ones.
 */
export function mergeSetups(groups: SetupEntry[][], date: string, now: string): SetupEntry[] {
  const byTicker = new Map<string, SetupEntry>();
  for (const group of groups) {
    for (const e of group) {
      const prev = byTicker.get(e.ticker);
      if (!prev) {
        byTicker.set(e.ticker, { ...e, date, recordedAt: now });
        continue;
      }
      prev.buckets = Array.from(new Set([...prev.buckets, ...e.buckets]));
      prev.sources = Array.from(new Set([...prev.sources, ...e.sources]));
      // Backfill only what is missing; never overwrite an existing level.
      if (prev.trigger == null && e.trigger != null) {
        prev.trigger = e.trigger;
        prev.stop = e.stop;
        prev.target = e.target;
        prev.direction = e.direction;
        prev.rMultiple = computeR(prev.trigger, prev.stop, prev.target);
      }
      if (prev.refPrice == null) prev.refPrice = e.refPrice;
      if (!prev.invalidation && e.invalidation) prev.invalidation = e.invalidation;
      if (!prev.thesis && e.thesis) prev.thesis = e.thesis;
    }
  }
  return Array.from(byTicker.values()).sort((a, b) => a.ticker.localeCompare(b.ticker));
}

export function buildLedger(
  brief: any,
  confluenceReports: any[],
  date: string,
  phase: string,
): SetupLedger {
  const now = new Date().toISOString();
  return {
    date,
    recordedAt: now,
    phase,
    entries: mergeSetups(
      [extractTopSetups(brief), extractConfluence(confluenceReports), extractConviction(brief)],
      date,
      now,
    ),
  };
}

/* ── archive trimming ────────────────────────────────────────────────────── */

/** Sections whose `stocks[]` are movers, not setups — dropped from the archive. */
const MOVER_SECTIONS = [
  'pre-market gappers',
  'intraday movers',
  'post-market gappers',
  'stocks in play today',
];

/**
 * Shrink a brief for archival.
 *
 * The archived document was the full 44 KB brief, of which the movers and
 * Stocks-in-Play grids are ~40 of 51 stock rows and are never scored. They are
 * replaced by a compact summary so `/briefs/[date]` still has something to
 * render, while Top Trades and Top Avoid — the rows that carry a claim — are
 * kept in full.
 */
export function leanArchive(brief: any): any {
  if (!brief || !Array.isArray(brief.sections)) return brief;
  return {
    ...brief,
    archiveTrimmed: true,
    sections: brief.sections.map((sec: any) => {
      const name = String(sec?.section || '').toLowerCase();
      if (!MOVER_SECTIONS.includes(name) || !Array.isArray(sec.stocks)) return sec;
      const rows = sec.stocks;
      const compact = (r: any) => ({
        ticker: r?.ticker,
        changePct: r?.changePct,
        direction: r?.direction,
      });
      const { stocks, ...rest } = sec;
      return {
        ...rest,
        moversSummary: {
          total: rows.length,
          up: rows.filter((r: any) => (r?.changePct ?? 0) > 0).length,
          down: rows.filter((r: any) => (r?.changePct ?? 0) < 0).length,
          top: rows
            .filter((r: any) => (r?.changePct ?? 0) > 0)
            .slice(0, 5)
            .map(compact),
          bottom: rows
            .filter((r: any) => (r?.changePct ?? 0) < 0)
            .slice(0, 5)
            .map(compact),
        },
      };
    }),
  };
}

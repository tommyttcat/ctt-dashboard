/**
 * Server-side reads of the public brief archive.
 *
 * WHY THIS EXISTS
 * ---------------
 * The /briefs pages used to fetch their own API routes from the browser, which
 * cost two function invocations per view and — worse — shipped an empty HTML
 * shell to crawlers. Reading KV here lets the pages render their content into
 * the server HTML, and lets Next cache the result as ISR so the KV read
 * happens once per revalidate window instead of once per visitor.
 *
 * The index page in particular was an N+1: one fetch for the date list, then
 * one fetch per date (up to 30). getArchivedBriefs collapses that into a single
 * kv.mget.
 *
 * Archived briefs are immutable once written — /api/analyst/brief only writes
 * brief_archive:<date> on a date rollover, and /api/email/briefing only writes
 * it when no value exists yet. That immutability is what makes a long ISR
 * window safe here.
 */
import { kv } from '@vercel/kv';

export const ARCHIVE_INDEX_KEY = 'brief_archive_index';
export const archiveKey = (date: string) => `brief_archive:${date}`;

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface StockEntry {
  ticker: string;
  trigger?: number;
  target?: number;
  price?: number;
  change?: number;
  stage?: string;
  sector?: string;
  rs?: number;
  analysis?: string;
}

export interface SectionResult {
  section: string;
  analysis: string;
  stocks?: StockEntry[];
}

export interface RegimeBlock {
  regime: string;
  caution: string;
  posture: string;
}

export interface SummaryBlock {
  conviction: string[];
  watchlist: string[];
  traps: string[];
  tomorrow?: string[];
}

export interface UpdateBlock {
  phase: string;
  timestamp: string;
  paragraphs: string[];
  takeawayLabel: string;
  takeaway: string;
  colorTheme: string;
}

export interface BriefData {
  generatedAt: string;
  generatedAtET: string;
  snapshotTime: string | null;
  sections: SectionResult[];
  regimeDetail?: RegimeBlock;
  summary?: SummaryBlock;
  sessionUpdates?: Record<string, UpdateBlock>;
}

export interface BriefSummary {
  date: string;
  headline: string;
  regime: string;
  tickers: string[];
  setupCount: number;
  phases: string[];
}

/** Archived dates, newest first. One KV read. */
export async function getArchiveDates(): Promise<string[]> {
  try {
    const dates = await kv.get<string[]>(ARCHIVE_INDEX_KEY);
    if (!dates?.length) return [];
    return [...dates].filter((d) => DATE_RE.test(d)).sort((a, b) => b.localeCompare(a));
  } catch {
    return [];
  }
}

/** One archived brief. One KV read. */
export async function getArchivedBrief(date: string): Promise<BriefData | null> {
  if (!DATE_RE.test(date)) return null;
  try {
    return (await kv.get<BriefData>(archiveKey(date))) ?? null;
  } catch {
    return null;
  }
}

/** Many archived briefs in a single round trip. */
export async function getArchivedBriefs(dates: string[]): Promise<(BriefData | null)[]> {
  if (!dates.length) return [];
  try {
    const keys = dates.map(archiveKey);
    return await kv.mget<(BriefData | null)[]>(...keys);
  } catch {
    return dates.map(() => null);
  }
}

/** Collapse a long regime sentence into a short badge label. */
export function extractRegimeLabel(regime: string): string {
  if (regime.length < 30) return regime;
  const r = regime.toLowerCase();
  if (r.includes('risk-on') || r.includes('risk on')) return 'Risk-On';
  if (r.includes('risk-off') || r.includes('risk off')) return 'Risk-Off';
  if (r.includes('bull')) return 'Bullish';
  if (r.includes('bear')) return 'Bearish';
  if (r.includes('caution')) return 'Caution';
  return 'Neutral';
}

/** Card-level summary for the archive index. */
export function summarizeBrief(date: string, brief: BriefData | null): BriefSummary {
  const rd = brief?.regimeDetail;
  const regime = extractRegimeLabel(rd?.regime || 'Neutral');

  const sections = brief?.sections || [];
  const setupSections = sections.filter((s) => /Stocks in Play|Top Trades/i.test(s.section));
  const setupStocks = setupSections.flatMap((s) => s.stocks || []);

  const tickers = sections
    .flatMap((s) => s.stocks || [])
    .filter((s) => s.ticker)
    .slice(0, 5)
    .map((s) => s.ticker as string);

  const conviction = brief?.summary?.conviction || [];
  const headline = conviction[0]
    ? String(conviction[0]).replace(/\*\*/g, '').slice(0, 120)
    : sections[0]?.section || 'Market brief';

  return {
    date,
    headline,
    regime,
    tickers,
    setupCount: setupStocks.length,
    phases: Object.keys(brief?.sessionUpdates || {}),
  };
}

/** All tickers mentioned anywhere in a brief — used for meta descriptions. */
export function allTickers(brief: BriefData | null, limit = 8): string[] {
  const seen = new Set<string>();
  for (const s of brief?.sections || []) {
    for (const st of s.stocks || []) {
      if (st.ticker) seen.add(st.ticker);
      if (seen.size >= limit) return [...seen];
    }
  }
  return [...seen];
}

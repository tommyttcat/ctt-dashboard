/* lib/catalysts.ts — the News page catalyst list (25 Nov 2026).
 *
 * A cloud routine (not the site, not the Anthropic API) reads
 * /api/catalysts/candidates — today's gappers, today's earnings reporters and
 * their SEC 8-K / FMP headlines — writes a one-line read, catalyst tags and a
 * grade for each, and POSTs the result to /api/catalysts. The News page reads
 * it back. This file is the shape both sides agree on, and the clean-up that
 * keeps a malformed routine write from reaching the page.
 */

export const CATALYSTS_KEY = 'catalysts_v1';

export const GRADES = ['A★', 'A', 'B', 'P2'] as const;
export type Grade = (typeof GRADES)[number];

/* Fixed vocabulary so the chips stay consistent from run to run. */
export const CATALYST_TAGS = [
  'Earnings', 'Biotech/FDA', 'Contracts', 'M&A', 'Transformation', 'Guidance',
  'Offering', 'Analyst', 'Product', 'Legal/Reg', 'Macro', 'No news',
] as const;
export type CatalystTag = (typeof CATALYST_TAGS)[number];

export type CatalystSource = 'gapper' | 'earnings' | 'both';

export type CatalystItem = {
  ticker: string;
  name: string;
  grade: Grade;
  summary: string;
  tags: CatalystTag[];
  source: CatalystSource;
  chg: number | null;      // % change at run time
  vol: number | null;      // shares traded at run time
  mktCap: number | null;   // USD
  url: string | null;      // filing or article the read came from
  isNew?: boolean;         // first seen this run (set by the save route)
};

export type CatalystsPayload = {
  runAt: string;           // ISO, when the routine finished
  gappers: number;         // candidates it was given
  earnings: number;
  top: { ticker: string; text: string } | null;
  ranked: CatalystItem[];  // read and graded, best first
  passed: CatalystItem[];  // screened in, lower grade
};

const str = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max);
const numOrNull = (v: unknown): number | null => {
  const n = Number(v);
  return v == null || v === '' || !Number.isFinite(n) ? null : n;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untrusted routine JSON, validated field by field
function cleanItem(raw: any): CatalystItem | null {
  const ticker = str(raw?.ticker, 10).toUpperCase().replace(/[^A-Z0-9.\-]/g, '');
  const summary = str(raw?.summary, 220);
  if (!ticker || !summary) return null;
  const grade = (GRADES as readonly string[]).includes(raw?.grade) ? (raw.grade as Grade) : 'P2';
  const tags = (Array.isArray(raw?.tags) ? raw.tags : [])
    .filter((t: unknown): t is CatalystTag => (CATALYST_TAGS as readonly string[]).includes(String(t)))
    .slice(0, 3);
  const source: CatalystSource = raw?.source === 'earnings' || raw?.source === 'both' ? raw.source : 'gapper';
  const url = str(raw?.url, 500);
  return {
    ticker,
    name: str(raw?.name, 60),
    grade,
    summary,
    tags,
    source,
    chg: numOrNull(raw?.chg),
    vol: numOrNull(raw?.vol),
    mktCap: numOrNull(raw?.mktCap),
    url: /^https:\/\//.test(url) ? url : null,
  };
}

/** Validate a routine write. Returns null when nothing usable came in. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untrusted routine JSON, validated field by field
export function cleanPayload(body: any): CatalystsPayload | null {
  const ranked = (Array.isArray(body?.ranked) ? body.ranked : []).map(cleanItem).filter(Boolean).slice(0, 10) as CatalystItem[];
  const passed = (Array.isArray(body?.passed) ? body.passed : []).map(cleanItem).filter(Boolean).slice(0, 25) as CatalystItem[];
  if (!ranked.length && !passed.length) return null;
  const topTicker = str(body?.top?.ticker, 10).toUpperCase();
  const topText = str(body?.top?.text, 300);
  return {
    runAt: new Date().toISOString(),
    gappers: Math.max(0, Math.round(Number(body?.gappers) || 0)),
    earnings: Math.max(0, Math.round(Number(body?.earnings) || 0)),
    top: topTicker && topText ? { ticker: topTicker, text: topText } : null,
    ranked,
    passed,
  };
}

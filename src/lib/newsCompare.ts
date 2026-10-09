/* lib/newsCompare.ts — shadow comparison: Benzinga vs the no-Benzinga stack.
 *
 * The question it answers: if the Massive/Benzinga news add-on is cancelled,
 * what do the scanner rows lose? Both sides are picked by the SAME
 * pickBestNews at the SAME moment for the SAME tickers (everything the
 * scanners currently show), so the only difference is the inputs:
 *
 *   current = Benzinga (general + WIIM + per-ticker) + Polygon
 *   alt     = SEC EDGAR 8-Ks + FMP stock news + Polygon
 *
 * Nothing here touches what users see. Reports are written by the
 * /api/news/compare/record cron and read on /admin/news-compare.
 */

import type { NewsItem } from '@/lib/indicators/news';

export const COMPARE_KEY = (id: string) => `news_compare:${id}`;
export const COMPARE_INDEX_KEY = 'news_compare_index';
export const COMPARE_TTL_SEC = 45 * 86_400;
export const COMPARE_INDEX_MAX = 60;

/* Scan payloads the ticker set is read from — one mget. ETF lists are left
   out: ETFs file no 8-Ks and carry no company news either side could find. */
export const SCAN_KEYS = [
  'daily_setups_v6', 'stocks_in_play_v6', 'top_movers_v6', 'ep9m_v1',
  'vcp_v1', 'swing_candidates_v1', 'consol_1021_v1', 'dvol_rows_v1',
] as const;

export const SCAN_LABEL: Record<string, string> = {
  daily_setups_v6: 'Daily', stocks_in_play_v6: 'SIP', ep9m_v1: 'EP9M', vcp_v1: 'VCP',
  swing_candidates_v1: 'Swing', consol_1021_v1: '10/21', dvol_rows_v1: 'DVOL',
  'Mega Caps': 'Mega', Gainers: 'Gainers', Losers: 'Losers',
};

export type Source = 'benzinga' | 'sec' | 'fmp' | 'polygon';

export interface Pick {
  title: string;
  url: string | null;
  publisher: string;
  ageH: number;
  tag: string;
  tier: NewsItem['tier'];
  from: Source;
}

export type Outcome = 'both' | 'current-only' | 'alt-only' | 'neither';

export interface CompareRow {
  t: string;
  scans: string[];
  cur: Pick | null;
  alt: Pick | null;
  outcome: Outcome;
  /* Raw item counts per source before filtering — separates "the source had
     nothing" from "the source had only junk the filter rejected". */
  n: { bz: number; sec: number; fmp: number; poly: number };
}

export interface CompareReport {
  id: string;
  date: string;
  at: string;
  tickers: number;
  rows: CompareRow[];
  summary: {
    both: number; currentOnly: number; altOnly: number; neither: number;
    curStrong: number; altStrong: number;
    curMedianAgeH: number | null; altMedianAgeH: number | null;
    altFrom: Record<Source, number>;
    curFrom: Record<Source, number>;
  };
  diag: {
    ms: number;
    sec: { filings: number; headlines: number; oldestUtc: string | null; tickersHit: number };
    fmp: { calls: number; bytes: number; errors: number; tickersHit: number };
    bz: { tickersHit: number };
    poly: { tickersHit: number };
  };
}

export const toPick = (n: NewsItem | null, from: (n: NewsItem) => Source): Pick | null =>
  n ? { title: n.title, url: n.url, publisher: n.publisher, ageH: n.ageHours, tag: n.tag, tier: n.tier, from: from(n) } : null;

export const outcomeOf = (cur: Pick | null, alt: Pick | null): Outcome =>
  cur && alt ? 'both' : cur ? 'current-only' : alt ? 'alt-only' : 'neither';

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10;
}

export function summarize(rows: CompareRow[]): CompareReport['summary'] {
  const zero = (): Record<Source, number> => ({ benzinga: 0, sec: 0, fmp: 0, polygon: 0 });
  const s = {
    both: 0, currentOnly: 0, altOnly: 0, neither: 0, curStrong: 0, altStrong: 0,
    curMedianAgeH: null as number | null, altMedianAgeH: null as number | null,
    altFrom: zero(), curFrom: zero(),
  };
  for (const r of rows) {
    if (r.outcome === 'both') s.both++;
    else if (r.outcome === 'current-only') s.currentOnly++;
    else if (r.outcome === 'alt-only') s.altOnly++;
    else s.neither++;
    if (r.cur?.tier === 'strong') s.curStrong++;
    if (r.alt?.tier === 'strong') s.altStrong++;
    if (r.cur) s.curFrom[r.cur.from]++;
    if (r.alt) s.altFrom[r.alt.from]++;
  }
  s.curMedianAgeH = median(rows.flatMap(r => (r.cur ? [r.cur.ageH] : [])));
  s.altMedianAgeH = median(rows.flatMap(r => (r.alt ? [r.alt.ageH] : [])));
  return s;
}

/* Tickers the scanners currently show, with which scans list each. */
export function tickersFromScans(values: unknown[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (rows: unknown, label: string) => {
    if (!Array.isArray(rows)) return;
    for (const r of rows as any[]) {
      const t = String(r?.ticker || r?.symbol || '').toUpperCase().trim();
      if (!t) continue;
      const s = out.get(t);
      if (!s) out.set(t, [label]);
      else if (!s.includes(label)) s.push(label);
    }
  };
  SCAN_KEYS.forEach((key, i) => {
    const v: any = values[i];
    if (key === 'top_movers_v6') {
      for (const group of ['Mega Caps', 'Gainers', 'Losers']) add(v?.[group], SCAN_LABEL[group]);
    } else {
      add(Array.isArray(v) ? v : v?.rows ?? v?.candidates, SCAN_LABEL[key]);
    }
  });
  return out;
}

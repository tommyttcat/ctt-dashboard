import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { etGate, etParts } from '@/lib/etCron';
import { authorized, authorizedOrAdmin } from '@/lib/apiAuth';
import {
  pickBestNews, polygonNewsPath, fetchBenzingaNewsIndex, enrichBenzingaIndex,
  type NewsItem, type PolygonNewsRaw,
} from '@/lib/indicators/news';
import { fetchEdgarNewsIndex, fetchFmpNewsIndex } from '@/lib/indicators/newsAlt';
import {
  COMPARE_KEY, COMPARE_INDEX_KEY, COMPARE_TTL_SEC, COMPARE_INDEX_MAX, SCAN_KEYS,
  tickersFromScans, toPick, outcomeOf, summarize,
  type CompareRow, type CompareReport, type Source,
} from '@/lib/newsCompare';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Shadow news comparison — see lib/newsCompare. Writes one report per run;
 * reads nothing users see and changes nothing they see.
 *
 * Cost (measured 9 Oct 2026): 1 KV mget (~325 KB of scan payloads) + 2 writes
 * per real run; 2 real runs a weekday. Flat in users — cron + admin only.
 * Outbound per run: ~3 + ~10 Massive/Benzinga, one Polygon + one FMP call per
 * ticker (~150), 5 SEC feed calls + up to 60 for press-release headlines.
 *
 * 10:30 and 15:30 ET. vercel.json fires at both candidate UTC hours; etGate
 * keeps the right one (lib/etCron). The admin page's "Run now" POSTs and
 * skips the gate.
 */

const MAX_TICKERS = 160;

function todayET(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

async function record(slot: string) {
  const t0 = Date.now();
  const polygonKey = process.env.POLYGON_API_KEY || '';
  const fmpKey = process.env.FMP_API_KEY || '';

  const scanValues = await kv.mget<unknown[]>(...SCAN_KEYS);
  const scansByTicker = tickersFromScans(scanValues);
  const tickers = [...scansByTicker.keys()].slice(0, MAX_TICKERS);
  if (tickers.length === 0) return { error: 'no scanner tickers in KV' } as const;

  const polygonOne = async (t: string): Promise<PolygonNewsRaw[]> => {
    try {
      const r = await fetch(`https://api.polygon.io${polygonNewsPath(t, 20)}&apiKey=${polygonKey}`, { cache: 'no-store' });
      const d = r.ok ? await r.json() : null;
      return Array.isArray(d?.results) ? d.results : [];
    } catch {
      return [];
    }
  };
  const polygonAll = async () => {
    const m = new Map<string, PolygonNewsRaw[]>();
    for (let i = 0; i < tickers.length; i += 8) {
      const batch = tickers.slice(i, i + 8);
      const got = await Promise.all(batch.map(polygonOne));
      batch.forEach((t, j) => m.set(t, got[j]));
    }
    return m;
  };
  const benzinga = async () => {
    const idx = await fetchBenzingaNewsIndex(polygonKey);
    await enrichBenzingaIndex(idx, tickers, polygonKey);
    return idx;
  };

  const [bz, poly, sec, fmp] = await Promise.all([
    benzinga(), polygonAll(), fetchEdgarNewsIndex(tickers), fetchFmpNewsIndex(tickers, fmpKey),
  ]);

  const now = Date.now();
  const rows: CompareRow[] = tickers.map(t => {
    const bzItems = bz.get(t) ?? [];
    const polyItems = poly.get(t) ?? [];
    const secItems = sec.index.get(t) ?? [];
    const fmpItems = fmp.index.get(t) ?? [];

    const fmpUrls = new Set(fmpItems.map(i => i.article_url).filter(Boolean));
    const bzUrls = new Set(bzItems.map(i => i.article_url).filter(Boolean));
    const altFrom = (n: NewsItem): Source =>
      n.publisher === 'SEC' ? 'sec' : n.url && fmpUrls.has(n.url) ? 'fmp' : 'polygon';
    const curFrom = (n: NewsItem): Source => (n.url && bzUrls.has(n.url) ? 'benzinga' : 'polygon');

    const cur = toPick(pickBestNews([...bzItems, ...polyItems], t, now), curFrom);
    const alt = toPick(pickBestNews([...secItems, ...fmpItems, ...polyItems], t, now), altFrom);
    return {
      t,
      scans: scansByTicker.get(t) ?? [],
      cur, alt,
      outcome: outcomeOf(cur, alt),
      n: { bz: bzItems.length, sec: secItems.length, fmp: fmpItems.length, poly: polyItems.length },
    };
  });

  const date = todayET();
  const id = `${date}-${slot}`;
  const hit = (m: Map<string, unknown[]>) => tickers.filter(t => (m.get(t)?.length ?? 0) > 0).length;
  const report: CompareReport = {
    id, date, at: new Date().toISOString(), tickers: tickers.length, rows,
    summary: summarize(rows),
    diag: {
      ms: Date.now() - t0,
      sec: { filings: sec.filings, headlines: sec.headlines, oldestUtc: sec.oldestUtc, tickersHit: hit(sec.index) },
      fmp: { calls: fmp.calls, bytes: fmp.bytes, errors: fmp.errors, tickersHit: hit(fmp.index) },
      bz: { tickersHit: hit(bz) },
      poly: { tickersHit: hit(poly) },
    },
  };

  const idx = (await kv.get<string[]>(COMPARE_INDEX_KEY)) || [];
  const nextIdx = [...idx.filter(x => x !== id), id].slice(-COMPARE_INDEX_MAX);
  await Promise.all([
    kv.set(COMPARE_KEY(id), report, { ex: COMPARE_TTL_SEC }),
    kv.set(COMPARE_INDEX_KEY, nextIdx),
  ]);
  return { id, tickers: tickers.length, summary: report.summary, diag: report.diag };
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { hour } = etParts();
  const gate = etGate([10, 15], 'news compare');
  if (gate) return gate;
  const result = await record(hour < 12 ? 'am' : 'pm');
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  if (!(await authorizedOrAdmin(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const result = await record(`manual-${etParts().hhmm.replace(':', '')}`);
  return NextResponse.json(result);
}

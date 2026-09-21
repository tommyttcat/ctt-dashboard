import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';
import { newsStarCount } from '@/lib/newsStars';

/* /api/news/pool — the news already attached to the names on the boards.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every scanner already resolves a catalyst per row: the headline, the link,
 * the publisher, how old it is, the classified tag, and — the useful bit —
 * whether the article states a REASON for the move or just restates it.
 * That work is paid for on every scan run and, until this route, was visible
 * only as a chip inside a table cell on the scanners page. Nothing collected
 * it, so there was no way to read the day's news for the names you actually
 * hold or watch.
 *
 * ONE READ, NINE KEYS. The scan payloads come back in a single kv.mget — one
 * Upstash command, not nine — and the response is edge-cached on the SCAN
 * profile (60s / 300s SWR), which is the cadence the underlying keys are
 * rewritten at anyway. Cost is therefore flat in users: the tenth reader in a
 * minute costs nothing, which is the rule this codebase got wrong once and
 * paid for. Callers must not cache-bust; query params are part of the CDN key.
 *
 * WHAT IT DOES NOT DO: fetch news. Not one upstream call. The general wire is
 * /api/news (Benzinga WIIM) and the page asks for that separately, so this
 * route's cost does not move when the wire is slow or down.
 *
 * The item shape deliberately keeps the CatalystRow field names — catalyst,
 * catalystUrl, thesis, newsPublisher, newsAge, newsSentiment, newsCausal — so
 * the page can hand an item straight to CatalystChip and NewsStars and render
 * news the same way the seven scanner tables do.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

/* Order is precedence: a name found by several scans is attributed to the
   first one here, which is the same order the dashboard's setup pool uses. */
const SCANS: { key: string; scan: string }[] = [
  { key: 'stocks_in_play_v6', scan: 'sip' },
  { key: 'daily_setups_v6', scan: 'daily' },
  { key: 'ep9m_v1', scan: 'ep9m' },
  { key: 'swing_candidates_v1', scan: 'swing' },
  { key: 'vcp_v1', scan: 'vcp' },
  { key: 'consol_1021_v1', scan: 'coil' },
  { key: 'dvol_rows_v1', scan: 'dvol' },
  { key: 'hrs_results_v1', scan: 'hrs' },
  { key: 'multibagger_v1', scan: 'mb' },
];

/* newsAge arrives as the label the scanners printed — "just now", "8h ago",
   "2d ago" — because that is what is stored. Sorting needs a number, and
   re-deriving one from publishedUtc is not possible here: the scan rows do not
   carry the timestamp. Anything unparseable sorts last rather than first, so a
   missing label can never masquerade as breaking news. */
const AGE_UNKNOWN = 1e9;
function ageMinutes(label: string | null | undefined): number {
  const s = String(label ?? '').trim().toLowerCase();
  if (!s) return AGE_UNKNOWN;
  if (s.startsWith('just')) return 0;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*([mhd])/);
  if (!m) return AGE_UNKNOWN;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return AGE_UNKNOWN;
  return m[2] === 'm' ? n : m[2] === 'h' ? n * 60 : n * 1440;
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export async function GET() {
  try {
    const raw = await kv.mget<unknown[]>(...SCANS.map(s => s.key));

    const seen = new Set<string>();
    const tickers: string[] = [];
    const items: Record<string, unknown>[] = [];

    SCANS.forEach(({ scan }, i) => {
      const rows = Array.isArray(raw?.[i]) ? (raw[i] as Record<string, any>[]) : [];
      for (const r of rows) {
        const ticker = String(r?.ticker ?? r?.symbol ?? '').toUpperCase();
        if (!ticker || seen.has(ticker)) continue;
        seen.add(ticker);
        tickers.push(ticker);

        /* A row earns a place only when there is something to open. An
           "Earnings" tag with no article behind it comes from the calendar,
           not the news feed — real, but not a headline, and hasNews on the
           client draws the same line. */
        const url = r.catalystUrl ?? r.newsUrl ?? null;
        const headline = r.thesis ?? r.news ?? r.headline ?? null;
        if (!url || !headline) continue;

        items.push({
          ticker,
          scan,
          name: r.name ?? null,
          sector: r.sector ?? null,
          price: num(r.price),
          changePct: num(r.changePct ?? r.change),
          /* dvol is the 100-Bagger's spelling of the same field. */
          rvol: num(r.rvol),
          vol: num(r.vol ?? r.dvol),
          cnf: num(r.conviction ?? r.cnfScore ?? r.score),
          rsRating: num(r.rsRating ?? r.rs),
          stage: r.stage ?? null,
          catalyst: r.catalyst ?? null,
          catalystUrl: url,
          thesis: headline,
          newsPublisher: r.newsPublisher ?? null,
          newsAge: r.newsAge ?? null,
          newsSentiment: r.newsSentiment ?? null,
          newsCausal: r.newsCausal ?? null,
          stars: newsStarCount({ catalyst: r.catalyst, catalystUrl: url, newsCausal: r.newsCausal }),
          _age: ageMinutes(r.newsAge),
        });
      }
    });

    /* Two stars first — a classified tag WITH a causal headline, which is the
       only combination that says why the name moved — then newest. */
    items.sort((a, b) =>
      (b.stars as number) - (a.stars as number) || (a._age as number) - (b._age as number));
    for (const it of items) delete it._age;

    return NextResponse.json(
      { success: true, items, tickers, poolCount: tickers.length, asOf: Date.now() },
      { headers: cacheHeaders(CACHE.SCAN) },
    );
  } catch (err) {
    console.error('[news/pool]', err);
    return NextResponse.json(
      { success: false, items: [], tickers: [], poolCount: 0 },
      { headers: noCacheHeaders() },
    );
  }
}

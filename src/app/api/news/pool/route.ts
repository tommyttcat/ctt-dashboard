import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';
import { newsStarCount } from '@/lib/newsStars';
import { tierForScan } from '@/lib/scans/edge';

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
    /* Stats for EVERY scanned name, not only the ones carrying a headline.
       The wire is a general feed: when one of its articles lands on a name
       that happens to be on a board, the page can only show CNF/RS/RVOL for
       it if the numbers are already here. Measured at ~190 names it adds
       about 12 KB to a payload the edge holds for 60s and serves to everyone
       — no extra KV work, since these rows are already in hand. */
    const stats: Record<string, Record<string, unknown>> = {};

    SCANS.forEach(({ scan }, i) => {
      const rows = Array.isArray(raw?.[i]) ? (raw[i] as Record<string, any>[]) : [];
      for (const r of rows) {
        const ticker = String(r?.ticker ?? r?.symbol ?? '').toUpperCase();
        if (!ticker || seen.has(ticker)) continue;
        seen.add(ticker);
        tickers.push(ticker);

        /* The row shading, decided HERE because each scan is tinted by its own
           measured rule and those rules read fields the page never receives —
           ADR, float turnover, coil ratio, contraction depth. Only the letter
           travels; the page looks the tooltip up from it. */
        const tier = tierForScan(scan, r)?.tier ?? null;

        stats[ticker] = {
          scan,
          tier,
          name: r.name ?? null,
          cnf: num(r.conviction ?? r.cnfScore ?? r.score),
          rsRating: num(r.rsRating ?? r.rs),
          rvol: num(r.rvol),
          vol: num(r.vol),
          dvol: num(r.dVol ?? r.dvol),
          changePct: num(r.changePct ?? r.change),
          price: num(r.price),
        };

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
          tier,
          name: r.name ?? null,
          sector: r.sector ?? null,
          price: num(r.price),
          changePct: num(r.changePct ?? r.change),
          rvol: num(r.rvol),
          vol: num(r.vol),
          /* dVol on eight of the nine scans, dvol on the 100-Bagger. Both are
             DOLLAR volume; `vol` above is shares, and conflating them would
             print a $6B row as six billion shares. */
          dvol: num(r.dVol ?? r.dvol),
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

    /* CNF first, like every other list on the site: the reader already ranks
       names that way, and a news list ordered by anything else asks them to
       hold two orderings in their head at once.

       Stars break the tie — a classified tag WITH a causal headline is the
       only combination that says why the name moved — and the age breaks
       that. A row with no score sorts last rather than as a zero, so an
       unscored name cannot displace a scored one. */
    const rank = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : -1);
    items.sort((a, b) =>
      rank(b.cnf) - rank(a.cnf)
      || (b.stars as number) - (a.stars as number)
      || (a._age as number) - (b._age as number));
    for (const it of items) delete it._age;

    return NextResponse.json(
      { success: true, items, tickers, stats, poolCount: tickers.length, asOf: Date.now() },
      { headers: cacheHeaders(CACHE.SCAN) },
    );
  } catch (err) {
    console.error('[news/pool]', err);
    return NextResponse.json(
      { success: false, items: [], tickers: [], stats: {}, poolCount: 0 },
      { headers: noCacheHeaders() },
    );
  }
}

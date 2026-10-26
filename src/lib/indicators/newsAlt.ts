/* News without Benzinga — SEC EDGAR 8-Ks + FMP stock news
   ==================================================================
   LIVE since 26 Oct 2026: the Massive/Benzinga news add-on ended 27 Oct, and the scans now
   take their headlines from fetchFreeNewsIndex below (+ Polygon where they already called it).
   It was first run as a shadow comparison (9-26 Oct, 22 runs, 1,727 ticker checks): FMP
   supplied 1,124 picks, SEC 59 (43 rated strong), Polygon 41; of 300 Benzinga picks, 13 had
   no replacement and the median headline age went 2.9h -> 6.2h. Both sources
   are mapped into PolygonNewsRaw so pickBestNews judges them with exactly the
   same publisher, shape, causal and age rules as everything else — the point
   of the shadow comparison (/api/news/compare) is that ONLY the inputs
   differ.

   EDGAR (free, official). The live "current filings" Atom feed carries every
   8-K with its acceptance timestamp, CIK and item codes. It pages 100 at a
   time and stops after ~4 pages, which measured 9 Oct 2026 as ~2.5 days of
   history — shorter than pickBestNews's 5-day window, so older catalysts are
   a known gap. For the filings that matter, the EX-99 press release is
   fetched to get the real headline; otherwise the item codes become one.
   SEC asks for a User-Agent with a contact and ≤10 req/s.

   FMP (already on the Starter plan). /stable/news/stock works on Starter;
   press-releases does NOT (needs Premium — measured 9 Oct 2026). Timestamps
   come back in New York time without a zone. Multi-symbol calls sort across
   symbols, so one busy ticker crowds out the rest — hence one call per
   ticker. Every item carries a single symbol, which pickBestNews reads as
   "focused" (+8); a known bias in FMP's favour.
   ================================================================== */

import type { PolygonNewsRaw } from './news';

const SEC_UA = 'ConfluenceTradingTools/1.0 noreply@confluencetradingtools.com';
const secFetch = (url: string, signal: AbortSignal) =>
  fetch(url, { headers: { 'User-Agent': SEC_UA, Accept: '*/*' }, signal: signal as any, cache: 'no-store' });
/* Per-instance memo (26 Oct 2026). Five scans call this every 15 minutes and their routes are
   force-dynamic (no fetch cache), so the 800 KB ticker map and the feed pages would be
   re-downloaded on every run. A warm function instance reuses them: the map for a day, the
   feed for 4 minutes (the scans fire at :05 and :07). */
const memo = new Map<string, { at: number; v: Promise<any> }>();
function memoized<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.v;
  const v = load().catch(e => { memo.delete(key); throw e; });
  memo.set(key, { at: Date.now(), v });
  return v;
}

/* SEC lists class shares with a dash (BRK-B); the scanners use a dot. */
const secTicker = (t: string) => t.toUpperCase().replace(/\./g, '-');

/* ---- 8-K items ----------------------------------------------------------
   Items that are never why a stock moves (vote results, bylaw edits, exhibit
   lists) are dropped; a filing made only of those is skipped entirely.
   Labels are worded so classifyNews tags them the way the scanners expect. */
const ITEM_LABEL: Record<string, string> = {
  '1.01': 'enters material definitive agreement',
  '1.03': 'bankruptcy or receivership',
  '1.05': 'discloses cybersecurity incident',
  '2.01': 'completes acquisition or disposition',
  '2.02': 'reports quarterly results',
  '2.05': 'announces restructuring costs',
  '2.06': 'records material impairment',
  '3.01': 'receives delisting notice',
  '3.02': 'unregistered sale of equity (dilution)',
  '4.02': 'non-reliance on prior financial statements',
  '5.01': 'change in control',
  '5.02': 'executive or director change',
  '7.01': 'Reg FD disclosure',
  '8.01': 'other events',
};

/* Items whose EX-99 press release is worth fetching for a headline. */
const HEADLINE_ITEMS = new Set(['1.01', '2.01', '2.02', '3.02', '5.02', '7.01', '8.01']);
const MAX_HEADLINE_FETCHES = 30;

interface Filing {
  cik: number;
  company: string;
  acc: string;
  indexUrl: string;
  acceptedUtc: string;
  items: string[];
}

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

function parseFeed(xml: string): Filing[] {
  const out: Filing[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const title = decode(e.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '');
    const tm = title.match(/^(\S+)\s+-\s+(.*?)\s+\((\d{10})\)/);
    if (!tm || !/^8-K/.test(tm[1])) continue;
    const href = e.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? '';
    const updated = e.match(/<updated>([^<]+)<\/updated>/)?.[1] ?? '';
    const summary = decode(e.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1] ?? '');
    const acc = summary.match(/AccNo:<\/b>\s*([\d-]+)/)?.[1] ?? '';
    const items = [...summary.matchAll(/Item (\d\.\d\d)/g)].map(x => x[1]);
    const ts = Date.parse(updated);
    if (!acc || !Number.isFinite(ts)) continue;
    out.push({
      cik: Number(tm[3]),
      company: tm[2],
      acc,
      indexUrl: href,
      acceptedUtc: new Date(ts).toISOString(),
      items,
    });
  }
  return out;
}

/* First readable line of an EX-99 press release: drop the EDGAR header and
   any "Exhibit 99.1" banner, then cut at the dateline or wire tag. */
export function headlineFromExhibit(htmlText: string): string | null {
  let t = htmlText
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  t = decode(t)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  t = t.replace(/^EX-\d+(?:\.\d+)?\s+\d+\s+\S+\s+/i, '');
  t = t.replace(/^(?:EX-\d+(?:\.\d+)?\s+)?(?:\S+\s+){0,3}?Document\s+/i, '');
  t = t.replace(/^(?:Exhibit|EX-)\s*99(?:\.\d+)?\s*/i, '');
  /* Filings often stack the tags ("EX-99.1 Exhibit 99.1 …") and lead with a cover line
     ("PRESENTATION DATED OCTOBER 26, 2026") — strip them until the headline itself leads
     (26 Oct 2026, the first live day showed both). Named entities (&reg;, &trade;) go too. */
  t = t.replace(/&(?:reg|trade|copy|#174|#8482|#169);/gi, '').replace(/&[a-z]+;/gi, ' ').replace(/[®™©]/g, '');
  for (let k = 0; k < 4; k++) {
    const before = t;
    t = t.replace(/^(?:EX-?\s*\d+(?:\.\d+)?|Exhibit\s*\d+(?:\.\d+)?)\s*[:\-–]?\s*/i, '')
      .replace(/^(?:PRESS RELEASE|NEWS RELEASE|FOR IMMEDIATE RELEASE|INVESTOR PRESENTATION|PRESENTATION)(?:\s+DATED\s+[A-Z]+\.?\s+\d{1,2},\s+\d{4})?\s*/i, '')
      .trim();
    if (t === before) break;
  }
  /* The dateline ends the headline. Wire datelines put the city in capitals ("NASHVILLE, Tenn.,
     Oct. 26, 2026"), so that form is tried first: the mixed-case pattern alone also matched the
     headline's own last words ("…Outpatient Platform NASHVILLE,") and cut them (26 Oct 2026). */
  const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?\\s+\\d{1,2},\\s+\\d{4}';
  const wire = t.search(/\(\s*(?:GLOBE NEWSWIRE|BUSINESS WIRE|ACCESSWIRE|ACCESS Newswire|Newsfile Corp|PRNewswire)|\s--\s/);
  const caps = t.search(new RegExp(`\\b[A-Z][A-Z.]+(?:\\s[A-Z][A-Z.]+){0,3},\\s+(?:[A-Z][a-z]+\\.?,?\\s+)?${MONTH}`));
  const mixed = t.search(new RegExp(`\\b[A-Z][A-Za-z. ]{2,30},\\s+(?:[A-Z][a-z]+\\.?,?\\s+)?${MONTH}`));
  const cut = [wire, caps >= 0 ? caps : mixed].filter(i => i > 0).reduce((m, i) => Math.min(m, i), Infinity);
  const head = (Number.isFinite(cut) ? t.slice(0, cut) : t.slice(0, 200)).trim();
  if (head.length < 15) return null;
  return head.length > 200 ? `${head.slice(0, 197).trimEnd()}…` : head;
}

async function exhibitHeadline(f: Filing, signal: AbortSignal): Promise<string | null> {
  try {
    const dir = f.indexUrl.replace(/\/[^/]+$/, '');
    const idx = await secFetch(`${dir}/index.json`, signal).then(r => (r.ok ? r.json() : null));
    const names: string[] = (idx?.directory?.item ?? []).map((i: any) => String(i?.name ?? ''));
    const ex = names.find(n => /ex-?99(?:[._-]?0?1)?\b|ex991|ex-991/i.test(n) && /\.html?$/i.test(n))
      ?? names.find(n => /99/.test(n) && /\.html?$/i.test(n) && !/index/i.test(n));
    if (!ex) return null;
    const html = await secFetch(`${dir}/${ex}`, signal).then(r => (r.ok ? r.text() : ''));
    return html ? headlineFromExhibit(html.slice(0, 60_000)) : null;
  } catch {
    return null;
  }
}

/** 8-Ks from the last ~2.5 days for `tickers`, indexed by scanner ticker. */
export async function fetchEdgarNewsIndex(
  tickers: string[],
  timeoutMs = 25_000,
): Promise<{ index: Map<string, PolygonNewsRaw[]>; filings: number; headlines: number; oldestUtc: string | null }> {
  const index = new Map<string, PolygonNewsRaw[]>();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let filings = 0, headlines = 0;
  let oldestUtc: string | null = null;
  try {
    const want = new Map(tickers.map(t => [secTicker(t), t]));
    const [map, ...pages] = await Promise.all([
      memoized('sec:tickers', 86_400_000, () => secFetch('https://www.sec.gov/files/company_tickers.json', controller.signal).then(r => (r.ok ? r.json() : Promise.reject(new Error(`SEC ${r.status}`))))).catch(() => ({})),
      ...[0, 100, 200, 300].map(start =>
        memoized(`sec:feed:${start}`, 240_000, () => secFetch(
          `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&owner=include&start=${start}&count=100&output=atom`,
          controller.signal,
        ).then(r => (r.ok ? r.text() : Promise.reject(new Error(`SEC ${r.status}`))))).catch(() => ''),
      ),
    ]);

    const cikToTicker = new Map<number, string>();
    for (const row of Object.values<any>(map || {})) {
      const t = want.get(String(row?.ticker ?? '').toUpperCase());
      if (t && !cikToTicker.has(Number(row.cik_str))) cikToTicker.set(Number(row.cik_str), t);
    }

    const all = pages.flatMap(parseFeed);
    filings = all.length;
    oldestUtc = all.reduce<string | null>((o, f) => (!o || f.acceptedUtc < o ? f.acceptedUtc : o), null);

    const seen = new Set<string>();
    const matched = all.filter(f => {
      if (!cikToTicker.has(f.cik) || seen.has(f.acc)) return false;
      seen.add(f.acc);
      return f.items.some(i => ITEM_LABEL[i]);
    });

    // Newest first, so the fetch cap spends itself on the freshest filings.
    matched.sort((a, b) => b.acceptedUtc.localeCompare(a.acceptedUtc));
    const toFetch = matched.filter(f => f.items.some(i => HEADLINE_ITEMS.has(i))).slice(0, MAX_HEADLINE_FETCHES);
    const heads = new Map<string, string | null>();
    for (let i = 0; i < toFetch.length; i += 4) {
      const batch = toFetch.slice(i, i + 4);
      const got = await Promise.all(batch.map(f => exhibitHeadline(f, controller.signal)));
      batch.forEach((f, j) => heads.set(f.acc, got[j]));
    }

    for (const f of matched) {
      const t = cikToTicker.get(f.cik)!;
      const labels = f.items.map(i => ITEM_LABEL[i]).filter(Boolean);
      const head = heads.get(f.acc) ?? null;
      if (head) headlines++;
      const raw: PolygonNewsRaw = {
        id: `sec-${f.acc}`,
        title: head ?? `${f.company} 8-K: ${labels.join('; ')}`,
        description: `8-K items ${f.items.join(', ')}: ${labels.join('; ')}`,
        article_url: f.indexUrl,
        published_utc: f.acceptedUtc,
        tickers: [t],
        publisher: { name: 'SEC' },
      };
      const bucket = index.get(t);
      if (bucket) bucket.push(raw);
      else index.set(t, [raw]);
    }
  } catch { /* best-effort: a partial index is still a fair comparison input */ } finally {
    clearTimeout(timer);
  }
  return { index, filings, headlines, oldestUtc };
}

/* "2026-10-09 14:25:05" in New York time → ISO UTC. */
export function nyToIso(s: string): string {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return '';
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const d = new Date(guess);
  const offset = Date.parse(d.toLocaleString('en-US', { timeZone: 'UTC' })) -
    Date.parse(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return new Date(guess + offset).toISOString();
}

/** FMP stock news for `tickers`, one call each, indexed by ticker. */
export async function fetchFmpNewsIndex(
  tickers: string[],
  apiKey: string,
  timeoutMs = 60_000,
): Promise<{ index: Map<string, PolygonNewsRaw[]>; calls: number; bytes: number; errors: number }> {
  const index = new Map<string, PolygonNewsRaw[]>();
  if (!apiKey) return { index, calls: 0, bytes: 0, errors: 0 };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const from = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
  let calls = 0, bytes = 0, errors = 0;
  try {
    for (let i = 0; i < tickers.length; i += 6) {
      await Promise.all(tickers.slice(i, i + 6).map(async t => {
        calls++;
        try {
          const res = await fetch(
            `https://financialmodelingprep.com/stable/news/stock?symbols=${encodeURIComponent(t)}&from=${from}&limit=20&apikey=${apiKey}`,
            { signal: controller.signal as any, cache: 'no-store' },
          );
          const text = await res.text();
          bytes += text.length;
          const arr = res.ok ? JSON.parse(text) : null;
          if (!Array.isArray(arr)) { errors++; return; }
          index.set(t, arr.map((it: any) => fmpToRaw(it, t)));
        } catch {
          errors++;
        }
      }));
    }
  } finally {
    clearTimeout(timer);
  }
  return { index, calls, bytes, errors };
}

const fmpToRaw = (it: any, t: string): PolygonNewsRaw => ({
  id: `fmp-${it?.url ?? it?.title}`,
  title: it?.title || '',
  description: it?.text || '',
  article_url: it?.url || '',
  published_utc: nyToIso(String(it?.publishedDate ?? '')),
  tickers: [t],
  publisher: { name: it?.publisher || it?.site || '' },
});

/** FMP stock news for many tickers in batches of 25 symbols (26 Oct 2026) — for a scan that
    shortlists far more names than it shows (VCP: up to 150, ~5 kept). Multi-symbol calls sort
    across symbols, so a busy name can crowd a quiet one out; per-ticker (fetchFmpNewsIndex) is
    the better read where the list is short. */
export async function fetchFmpNewsBatched(
  tickers: string[],
  apiKey: string,
  timeoutMs = 30_000,
): Promise<{ index: Map<string, PolygonNewsRaw[]>; calls: number; bytes: number; errors: number }> {
  const index = new Map<string, PolygonNewsRaw[]>();
  if (!apiKey || !tickers.length) return { index, calls: 0, bytes: 0, errors: 0 };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const from = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
  const want = new Set(tickers);
  let calls = 0, bytes = 0, errors = 0;
  try {
    const chunks: string[][] = [];
    for (let i = 0; i < tickers.length; i += 25) chunks.push(tickers.slice(i, i + 25));
    for (let i = 0; i < chunks.length; i += 3) {
      await Promise.all(chunks.slice(i, i + 3).map(async chunk => {
        calls++;
        try {
          const res = await fetch(
            `https://financialmodelingprep.com/stable/news/stock?symbols=${encodeURIComponent(chunk.join(','))}&from=${from}&limit=250&apikey=${apiKey}`,
            { signal: controller.signal as any, cache: 'no-store' },
          );
          const text = await res.text();
          bytes += text.length;
          const arr = res.ok ? JSON.parse(text) : null;
          if (!Array.isArray(arr)) { errors++; return; }
          for (const it of arr) {
            const t = String(it?.symbol ?? '').toUpperCase();
            if (!want.has(t)) continue;
            const b = index.get(t);
            if (b) b.push(fmpToRaw(it, t)); else index.set(t, [fmpToRaw(it, t)]);
          }
        } catch { errors++; }
      }));
    }
  } finally {
    clearTimeout(timer);
  }
  return { index, calls, bytes, errors };
}

/** The scans' news index without Benzinga (26 Oct 2026): SEC 8-Ks + FMP stock news for
    `tickers`, merged per ticker, in PolygonNewsRaw so pickBestNews judges it unchanged.
    `batched` uses the 25-symbol FMP calls (long shortlists). Never throws. */
export async function fetchFreeNewsIndex(
  tickers: string[],
  fmpKey: string,
  opts: { batched?: boolean } = {},
): Promise<Map<string, PolygonNewsRaw[]>> {
  const uniq = [...new Set(tickers.filter(Boolean).map(t => String(t).toUpperCase()))];
  const out = new Map<string, PolygonNewsRaw[]>();
  if (!uniq.length) return out;
  const [sec, fmp] = await Promise.all([
    fetchEdgarNewsIndex(uniq).catch(() => ({ index: new Map<string, PolygonNewsRaw[]>() })),
    (opts.batched ? fetchFmpNewsBatched(uniq, fmpKey) : fetchFmpNewsIndex(uniq, fmpKey)).catch(() => ({ index: new Map<string, PolygonNewsRaw[]>() })),
  ]);
  for (const [t, arr] of sec.index) out.set(t, [...arr]);
  for (const [t, arr] of fmp.index) out.set(t, [...(out.get(t) ?? []), ...arr]);
  return out;
}

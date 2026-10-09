/* News without Benzinga — SEC EDGAR 8-Ks + FMP stock news
   ==================================================================
   Candidate replacement for the Massive/Benzinga news add-on. Both sources
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
  const cut = t.search(
    /\(\s*(?:GLOBE NEWSWIRE|BUSINESS WIRE|ACCESSWIRE|ACCESS Newswire|Newsfile Corp|PRNewswire)|\s--\s|\b[A-Z][A-Za-z. ]{2,30},\s+(?:[A-Z][a-z]+\.?,?\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+\d{4}/,
  );
  const head = (cut > 0 ? t.slice(0, cut) : t.slice(0, 200)).trim();
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
      secFetch('https://www.sec.gov/files/company_tickers.json', controller.signal).then(r => (r.ok ? r.json() : {})),
      ...[0, 100, 200, 300].map(start =>
        secFetch(
          `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&owner=include&start=${start}&count=100&output=atom`,
          controller.signal,
        ).then(r => (r.ok ? r.text() : '')).catch(() => ''),
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
          index.set(t, arr.map((it: any): PolygonNewsRaw => ({
            id: `fmp-${it?.url ?? it?.title}`,
            title: it?.title || '',
            description: it?.text || '',
            article_url: it?.url || '',
            published_utc: nyToIso(String(it?.publishedDate ?? '')),
            tickers: [t],
            publisher: { name: it?.publisher || it?.site || '' },
          })));
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

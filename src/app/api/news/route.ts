import { NextResponse } from 'next/server';
import { pickBestNews, polygonNewsPath, RX_FUND_LETTER } from '@/lib/indicators/news';
import { nyToIso } from '@/lib/indicators/newsAlt';

import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/* FMP's latest stock news is the source since 26 Oct 2026 (the Massive/Benzinga add-on ended
   27 Oct). Polygon's aggregated feed only tops it up: on the current plan nearly every article it
   returns is Motley Fool, which the publisher filter rejects wholesale. */
const PER_TICKER_CAP = 2;   // one earnings night otherwise floods the section
const MAX_ITEMS = 20;
const MAX_HEADLINE_CHARS = 110;

/* Benzinga's WIIM desk writes full explanatory sentences rather than headlines
   — some run past 250 characters and swallow an entire slot in the brief. Cut
   on a word boundary so the short form still reads as prose; `title` and
   `originalTitle` keep the untouched text for anything that wants it. */
function shorten(title: string): string {
  const t = (title || '').trim();
  if (t.length <= MAX_HEADLINE_CHARS) return t;
  const cut = t.slice(0, MAX_HEADLINE_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  const body = lastSpace > 60 ? cut.slice(0, lastSpace) : cut;
  return `${body.replace(/[,;:.\s]+$/, '')}…`;
}

/* Benzinga prefixes crypto with a dollar sign ($BTC) and Polygon namespaces it
   with a colon (X:BTCUSD). Both reach the brief as ticker labels, so they get
   flattened to the bare symbol here rather than at each call site. */
const normalizeTicker = (raw: string): string => {
  const t = String(raw || '').trim().replace(/^\$/, '');
  return (t.includes(':') ? t.split(':')[1] : t).toUpperCase();
};

const JUNK_NEWS_KEYWORDS = [
  'lawsuit', 'class action', 'investigation', 'shareholder', 'investors alerted',
  'pomerantz', 'rosen law', 'glancy', 'kaskela', 'bronstein', 'schall',
  'johnson fistel', 'deadline', 'reminder', 'bragar', 'eagel', 'squire',
  'gross law', 'faruqi', 'portnoy', 'investors reminded', 'purchasers of',
  'securities litigation', 'equity alert'
];

const BLOCKED_PUBLISHERS = new Set([
  'the motley fool', 'motley fool', 'fool.com',
  'simply wall st', 'simply wall street',
  'insider monkey', 'validea', 'talkmarkets', 'invezz',
  'stocknews.com', 'stocknews', 'quiverquant',
  '24/7 wall st', '24/7 wall street',
]);

const isSpamNews = (title: string) => {
  if (!title) return true;
  const lower = title.toLowerCase();
  return JUNK_NEWS_KEYWORDS.some(w => lower.includes(w));
};

const isBlockedPublisher = (publisher: string) => {
  const p = (publisher || '').toLowerCase().trim();
  if (BLOCKED_PUBLISHERS.has(p)) return true;
  for (const b of BLOCKED_PUBLISHERS) if (p.includes(b)) return true;
  return false;
};

/* Headlines used to be rewritten and tagged by an LLM pass. Benzinga's own
   channels already carry the classification, so the model was paying rent for
   work the feed does itself; keyword rules cover whatever the channels miss. */
const CHANNEL_TAGS: [RegExp, string][] = [
  [/^wiim$/i, 'WIIM'],
  [/^fda$|health care|biotech/i, 'FDA'],
  [/^m&a$|mergers/i, 'M&A'],
  [/offering|ipos?$|secondary/i, 'OFFERING'],
  [/insider trade/i, 'INSIDER'],
  [/guidance|previews|outlook/i, 'GUIDANCE'],
  [/earnings/i, 'EARNINGS'],
  [/upgrade/i, 'UPGRADE'],
  [/downgrade/i, 'DOWNGRADE'],
  [/econom|federal reserve|treasur|fed speak|prediction markets/i, 'MACRO'],
];

const TAG_RULES: [string, RegExp][] = [
  ['FDA', /\bfda\b|phase [123]|clinical trial|breakthrough therapy/i],
  ['M&A', /acquir|merger|merge[sd]?\b|takeover|buyout|to buy\b|stake in\b/i],
  ['EARNINGS', /earnings|q[1-4] (results|report)|beats?\b|miss(es|ed)?\b|\beps\b/i],
  ['UPGRADE', /upgrade[sd]?\b|raises? (price )?target|initiat\w+ .*(buy|outperform)|overweight/i],
  ['DOWNGRADE', /downgrade[sd]?\b|cuts? (price )?target|underweight|underperform/i],
  ['OFFERING', /offering|public offer|priced? .*shares|dilut|convertible notes|shelf/i],
  ['GUIDANCE', /guidance|outlook|forecast|sees fy|sees q[1-4]/i],
  ['INSIDER', /insider|ceo (buys|sells)|form 4\b|13[dgf]\b/i],
  ['MACRO', /\bfed\b|inflation|\bcpi\b|jobs report|tariff|rate (cut|hike)|treasury yield/i],
];

const deriveTag = (headline: string, channels: string[] = []) => {
  /* Analyst channels don't say which direction, so the headline decides. */
  const analyst = channels.some(c => /analyst|price target|reiterat/i.test(c));
  if (analyst) {
    if (/raise|upgrade|boost|hike/i.test(headline)) return 'UPGRADE';
    if (/lower|downgrade|cut|slash/i.test(headline)) return 'DOWNGRADE';
  }
  for (const c of channels) {
    for (const [re, tag] of CHANNEL_TAGS) if (re.test(c)) return tag;
  }
  for (const [tag, re] of TAG_RULES) if (re.test(headline || '')) return tag;
  return 'TECH MOMENTUM';
};

type Normalized = {
  id: string; ticker: string; tickers: string[]; title: string;
  originalTitle: string; cleanHeadline: string; aiTag: string;
  url: string; publishedUtc: string; publisher: string;
  /** One or two sentences from the article itself (Benzinga teaser / body,
      Polygon description) — the "why" a headline like "What's Going On With
      X Stock?" leaves out. Empty when the source sent nothing usable. */
  summary: string;
};

const MAX_SUMMARY_CHARS = 240;

/* The article's own words, cut to a sentence or two. Comes in the response
   we already fetch — no extra upstream call. */
function summarize(raw: unknown, title: string): string {
  let t = String(raw ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Promo tails Benzinga appends ("Get the full market breakdown.").
  t = t.replace(/\s*(Get the full (market )?breakdown|Read the full (story|article)|Click here[^.]*|See more[^.]*|Read more[^.]*)\.?\s*$/i, '').trim();
  // A bare link (e.g. an SEC filing URL) is not a summary.
  t = t.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  if (t.length < 25) return '';
  // Drop a leading dateline / byline and anything that just repeats the title.
  t = t.replace(/^(?:[A-Z][A-Za-z .,'-]{0,40}\s)?\(?(?:Benzinga|Reuters|AP)\)?\s*[-—:]\s*/, '');
  if (t.toLowerCase().startsWith(String(title || '').toLowerCase().slice(0, 40))) return '';
  if (t.length <= MAX_SUMMARY_CHARS) return t;
  const cut = t.slice(0, MAX_SUMMARY_CHARS);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (end > 80) return cut.slice(0, end + 1);
  const sp = cut.lastIndexOf(' ');
  return `${cut.slice(0, sp > 80 ? sp : MAX_SUMMARY_CHARS).replace(/[,;:\s]+$/, '')}…`;
}

/* One ticker's earnings night can produce eight consecutive headlines. Without
   a cap the brief's eight slots become eight lines about the same company. */
function capPerTicker(items: Normalized[]): Normalized[] {
  const seen = new Map<string, number>();
  const out: Normalized[] = [];
  for (const it of items) {
    const n = seen.get(it.ticker) || 0;
    if (n >= PER_TICKER_CAP) continue;
    seen.set(it.ticker, n + 1);
    out.push(it);
  }
  return out;
}

/* FMP's latest stock news across the market (26 Oct 2026) — the wire this section reads since the
   Massive/Benzinga add-on ended (27 Oct). One call. FMP times are New York time without a zone
   (nyToIso). No WIIM desk any more, so tags come from the headline rules alone. */
/* Zacks-style filler the wire carries in bulk — previews, "A vs B", "should you buy" — that says
   nothing about why a stock is moving (first live pull, 26 Oct 2026: 11 of 20 were these). */
const FLUFF = /gears up to report|what's in the cards|what to expect|here's what investors should know|which (stock|is) .*better|better (buy|bet)\b|\bvs\.? .*:|should you (buy|sell|hold)|worth a (bet|look|buy)|is it time to|buy, sell or hold|top ranked|zacks rank|strong buy stock|stocks to (buy|watch)|\d+ (stocks|reasons)\b|bull of the day|bear of the day|earnings preview|in the (cards|offing)|set to report|to (post|report) q[1-4]|likely to (support|aid|hurt|boost)|: can (it|the)\b|fund roundup|stock (rises|falls) (as|while) market/i;

let fmpBytes = 0;   // last call's response size, for ?debug=1 (FMP bandwidth is plan-capped)
async function fetchFmpLatest(apiKey: string): Promise<Normalized[]> {
  const res = await fetch(`https://financialmodelingprep.com/stable/news/stock-latest?page=0&limit=150&apikey=${apiKey}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`FMP ${res.status}`);
  const body = await res.text();
  fmpBytes = body.length;
  const arr: any[] = JSON.parse(body);
  if (!Array.isArray(arr)) throw new Error('FMP: not a list');
  const normalized = arr
    .filter(it => it?.symbol && it?.title && !isSpamNews(it.title) && !FLUFF.test(it.title) && !RX_FUND_LETTER.test(it.title) && !isBlockedPublisher(it.publisher || it.site || ''))
    .map((it): Normalized => {
      const t = normalizeTicker(it.symbol);
      return {
        id: `fmp-${it.url || it.title}`,
        ticker: t,
        tickers: [t],
        title: it.title,
        originalTitle: it.title,
        cleanHeadline: shorten(it.title),
        aiTag: deriveTag(it.title),
        url: it.url || '',
        publishedUtc: nyToIso(String(it.publishedDate ?? '')),
        publisher: it.publisher || it.site || 'FMP',
        summary: summarize(it.text, it.title),
      };
    })
    .sort((a, b) => (b.publishedUtc > a.publishedUtc ? 1 : -1));
  return capPerTicker(normalized).slice(0, MAX_ITEMS);
}

async function fetchPolygon(apiKey: string): Promise<Normalized[]> {
  const res = await fetch(`https://api.polygon.io/v2/reference/news?limit=40&apiKey=${apiKey}`);
  if (!res.ok) throw new Error('News API Failed');

  const data = await res.json();
  const results: any[] = data.results || [];

  const normalized = results
    .filter(item =>
      !isSpamNews(item.title) &&
      !isBlockedPublisher(item.publisher?.name) &&
      item.tickers?.length > 0
    )
    .map((item): Normalized => {
      const tickers: string[] = (item.tickers || []).map(normalizeTicker).filter(Boolean);
      return {
        id: String(item.id),
        ticker: tickers[0] || '',
        tickers,
        title: item.title,
        originalTitle: item.title,
        cleanHeadline: shorten(item.title),
        aiTag: deriveTag(item.title),
        url: item.article_url || '',
        publishedUtc: item.published_utc || '',
        publisher: item.publisher?.name || 'MASSIVE',
        summary: summarize(item.description, item.title),
      };
    });

  return capPerTicker(normalized).slice(0, MAX_ITEMS);
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const debug = params.get('debug') === '1';
  const probe = params.get('probe');
  const polygonApiKey = process.env.POLYGON_API_KEY || '';
  const fmpKey = (process.env.FMP_API_KEY || '').trim();

  /* Diagnostic for the *other* news pipeline — the per-ticker Polygon feed
     behind scanner-row catalysts. It shares nothing with the code above, so
     this reports what that feed actually returns for one symbol and whether
     pickBestNews can find anything usable in it. */
  if (probe) {
    const polyResult: any = {};
    if (polygonApiKey) {
      const res = await fetch(`https://api.polygon.io${polygonNewsPath(probe, 20)}&apiKey=${polygonApiKey}`);
      const data = await res.json();
      const raw: any[] = data.results || [];
      const now = Date.now();
      Object.assign(polyResult, {
        upstreamStatus: data.status ?? null,
        rawCount: raw.length,
        publishers: [...new Set(raw.map((i: any) => i.publisher?.name || '?'))],
        picked: pickBestNews(raw, probe),
        sample: raw.slice(0, 5).map((i: any) => ({
          publisher: i.publisher?.name,
          ageH: Math.round((now - new Date(i.published_utc).getTime()) / 3_600_000),
          title: i.title,
        })),
      });
    }

    return NextResponse.json({
      probe,
      feed: polygonApiKey ? polyResult : 'no key',
    });
  }

  if (!polygonApiKey) {
    return NextResponse.json({ error: 'Missing data key' }, { status: 500, headers: noCacheHeaders() });
  }

  const sources: Record<string, number | string> = {};
  try {
    let results: Normalized[] = [];

    try {
      results = fmpKey ? await fetchFmpLatest(fmpKey) : [];
      sources.fmp = fmpKey ? results.length : 'no key';
      sources.fmpBytes = fmpBytes;
    } catch (e: any) {
      sources.fmp = `error: ${e.message}`;
    }

    // Polygon tops up a short FMP list (or stands in when FMP fails), skipping names already shown.
    if (results.length < MAX_ITEMS) {
      try {
        const have = new Set(results.map(r => r.ticker));
        const poly = (await fetchPolygon(polygonApiKey)).filter(r => !have.has(r.ticker));
        sources.polygon = poly.length;
        results = [...results, ...poly].sort((a, b) => (b.publishedUtc > a.publishedUtc ? 1 : -1)).slice(0, MAX_ITEMS);
      } catch (e: any) {
        sources.polygon = `error: ${e.message}`;
      }
    }

    if (debug) {
      return NextResponse.json({
        sources,
        count: results.length,
        tags: results.reduce((acc: Record<string, number>, r) => {
          acc[r.aiTag] = (acc[r.aiTag] || 0) + 1;
          return acc;
        }, {}),
        sample: results.slice(0, 10).map(r => ({ ticker: r.ticker, tag: r.aiTag, title: r.title })),
      });
    }

    return NextResponse.json({ results }, { headers: cacheHeaders(CACHE.NARRATIVE) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: noCacheHeaders() });
  }
}

import { NextResponse } from 'next/server';
import { pickBestNews, polygonNewsPath } from '@/lib/indicators/news';

import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/* Polygon's aggregated feed is the fallback, not the primary source: on the
   current plan every article it returns is Motley Fool, which the publisher
   filter rejects wholesale — the route answered `{results: []}` forever.
   Benzinga carries the WIIM ("why is it moving") desk copy this section is
   actually for, plus a channel taxonomy that classifies catalysts for free. */

const BENZINGA_PAGES = 3;   // 25 items/page, ~10 hours of coverage
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

/* The Benzinga equivalent of the blocked publishers above — same failure mode,
   expressed as a channel rather than a byline. Commentary about a move, not
   the move. "$1000 Invested In X 10 Years Ago" lands here. */
const BLOCKED_CHANNELS = new Set([
  'opinion', 'trading ideas', 'long ideas', 'short ideas',
  'personal finance', 'education', 'sports betting', 'cannabis',
  'entertainment', 'general', 'crowdsourcing',
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
};

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

async function fetchBenzinga(token: string): Promise<Normalized[]> {
  const generalPages = Array.from({ length: BENZINGA_PAGES }, (_, p) =>
    fetch(
      `https://api.benzinga.com/api/v2/news?token=${token}&pageSize=25&page=${p}&displayOutput=abstract`,
      { headers: { accept: 'application/json' } }
    )
      .then(r => (r.ok ? r.json() : []))
      .catch(() => [])
  );

  const wiimPages = Array.from({ length: 4 }, (_, p) =>
    fetch(
      `https://api.benzinga.com/api/v2/news?token=${token}`
        + `&pageSize=25&page=${p}&displayOutput=abstract&channels=WIIM`,
      { headers: { accept: 'application/json' } }
    )
      .then(r => (r.ok ? r.json() : []))
      .catch(() => [])
  );

  const generalResults = await Promise.all(generalPages);
  const wiimResults = await Promise.all(wiimPages);

  const raw: any[] = [...generalResults.flat(), ...wiimResults.flat()].filter(Boolean);
  const byId = new Map<number, any>();
  for (const it of raw) if (it?.id != null) byId.set(it.id, it);

  const normalized = [...byId.values()]
    .filter(it => {
      const channels: string[] = (it.channels || []).map((c: any) => (c?.name || '').toLowerCase());
      if (!it.stocks?.length) return false;
      if (isSpamNews(it.title)) return false;
      if (channels.some(c => BLOCKED_CHANNELS.has(c))) return false;
      return true;
    })
    .map((it): Normalized => {
      const channels: string[] = (it.channels || []).map((c: any) => c?.name || '').filter(Boolean);
      const tickers: string[] = (it.stocks || [])
        .map((s: any) => normalizeTicker(s?.name))
        .filter(Boolean);
      return {
        id: String(it.id),
        ticker: tickers[0] || '',
        tickers,
        title: it.title,
        originalTitle: it.title,
        cleanHeadline: shorten(it.title),
        aiTag: deriveTag(it.title, channels),
        url: it.url || '',
        publishedUtc: it.created ? new Date(it.created).toISOString() : '',
        publisher: 'Benzinga',
      };
    })
    .sort((a, b) => (b.publishedUtc > a.publishedUtc ? 1 : -1));

  const wiim = normalized.filter(n => n.aiTag === 'WIIM');
  const nonWiim = normalized.filter(n => n.aiTag !== 'WIIM');
  const WIIM_SLOTS = 5;
  const mainSlots = MAX_ITEMS - WIIM_SLOTS;
  const mainCapped = capPerTicker(nonWiim).slice(0, mainSlots);
  const wiimCapped = capPerTicker(wiim).slice(0, WIIM_SLOTS);
  const merged = [...mainCapped, ...wiimCapped]
    .sort((a, b) => (b.publishedUtc > a.publishedUtc ? 1 : -1));

  return merged;
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
      };
    });

  return capPerTicker(normalized).slice(0, MAX_ITEMS);
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const debug = params.get('debug') === '1';
  const probe = params.get('probe');
  const polygonApiKey = process.env.NEXT_PUBLIC_POLYGON_API_KEY || process.env.POLYGON_API_KEY || '';
  const benzingaKey = (process.env.NEXT_PUBLIC_BENZINGA_API_KEY || process.env.BENZINGA_API_KEY || '').trim();

  /* Diagnostic for the *other* news pipeline — the per-ticker Polygon feed
     behind scanner-row catalysts. It shares nothing with the code above, so
     this reports what that feed actually returns for one symbol and whether
     pickBestNews can find anything usable in it. */
  if (probe) {
    const bzProbe = benzingaKey ? await fetch(
      `https://api.benzinga.com/api/v2/news?token=${benzingaKey}&pageSize=10&page=0&displayOutput=abstract&tickers=${probe}`,
      { headers: { accept: 'application/json' } }
    ).then(r => r.ok ? r.json() : []).catch(() => []) : [];
    const bzArr = Array.isArray(bzProbe) ? bzProbe : [];
    const bzSample = bzArr.slice(0, 5).map((a: any) => ({
      title: (a.title || '').slice(0, 150),
      stocks: (a.stocks || []).map((s: any) => s?.name),
      channels: (a.channels || []).map((c: any) => c?.name),
      created: a.created,
    }));

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
      benzinga: { count: bzArr.length, sample: bzSample },
      polygon: polygonApiKey ? polyResult : 'no key',
    });
  }

  if (!polygonApiKey && !benzingaKey) {
    return NextResponse.json({ error: 'Missing API Keys' }, { status: 500, headers: noCacheHeaders() });
  }

  const sources: Record<string, number | string> = {};
  try {
    let results: Normalized[] = [];

    if (benzingaKey) {
      try {
        results = await fetchBenzinga(benzingaKey);
        sources.benzinga = results.length;
      } catch (e: any) {
        sources.benzinga = `error: ${e.message}`;
      }
    } else {
      sources.benzinga = 'no key';
    }

    /* Polygon only runs when Benzinga came back empty, so a lapsed Benzinga
       key degrades the section rather than blanking it. */
    if (!results.length && polygonApiKey) {
      results = await fetchPolygon(polygonApiKey);
      sources.polygon = results.length;
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

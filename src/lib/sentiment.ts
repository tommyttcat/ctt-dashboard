// lib/sentiment.ts — Social Sentiment: what StockTwits, Reddit and Bluesky are talking about.
//
// Asked for 1 Oct 2026. Three sources, read every 15 minutes by
// /api/sentiment/refresh and stored as one KV key the page reads through the
// CDN-cached /api/sentiment/latest:
//
//   StockTwits  public API: the trending list (rank, watchers, its own one-line
//               "why it's trending" summary) and, per name, the bull / bear
//               tags on the latest 30 messages.
//   Reddit      ApeWisdom's mention counts across the stock subreddits, now
//               and 24 hours ago.
//   Bluesky     posts with the cashtag in the last 24 hours (the site's own
//               account; the public search endpoint refuses anonymous calls),
//               with a crude word-count lean.
//
// X is not here: reading X needs its paid search tier; the site's X key only
// posts. Crowd sentiment is not a tested signal on this site — at extremes it
// marks tops as often as starts. Pure functions here; the route fetches.

export const SENTIMENT_KEY = 'sentiment_v1';
export const SENTIMENT_MAX = 25;

export interface StIn { t: string; n?: string; rank: number; watchers?: number; summary?: string }
export interface RedditIn { t: string; n?: string; rank: number; mentions: number; prev: number; upvotes?: number }

export interface SentimentRow {
  t: string;
  n?: string;
  price?: number | null;
  chg?: number | null;
  vol?: number | null;     // shares today
  rvol?: number | null;    // today's volume / usual by this time of day (Liquid Leaders profile), a multiple
  rs?: number | null;      // the site's RS Rating
  st?: { rank: number | null; bull: number; bear: number; msgs: number; watchers?: number; summary?: string } | null;
  reddit?: { rank: number; mentions: number; prev: number } | null;
  bsky?: { posts: number; bull: number; bear: number } | null;
}
export interface SentimentLive {
  asOf: number;
  rows: SentimentRow[];
  sources: { stocktwits: string; reddit: string; bluesky: string };
}

// Broad index / bond funds: always mentioned, never the story.
const SKIP = new Set(['SPY', 'QQQ', 'VOO', 'VTI', 'IWM', 'DIA', 'TLT', 'SPX', 'NDX', 'VIX']);

/** The names to read: StockTwits trending and Reddit's most mentioned, scored
    by rank on each (top of either list counts most; on both counts more). */
export function pickUniverse(st: StIn[], reddit: RedditIn[], max = SENTIMENT_MAX): string[] {
  const score = new Map<string, number>();
  const add = (t: string, rank: number) => {
    if (!/^[A-Z]{1,5}$/.test(t) || SKIP.has(t) || rank > 30) return;
    score.set(t, (score.get(t) ?? 0) + (31 - rank));
  };
  st.forEach(s => add(s.t, s.rank));
  reddit.forEach(r => add(r.t, r.rank));
  return [...score.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([t]) => t);
}

const BULL_RX = /\b(buy|buying|bought|long|calls?|bull(ish)?|breakout|moon(ing)?|rip(ping)?|squeeze|beat|upgrade[sd]?|undervalued|load(ed|ing)?|higher)\b|🚀/gi;
const BEAR_RX = /\b(sell|selling|sold|short(ing|ed)?|puts?|bear(ish)?|dump(ing)?|crash(ing)?|miss(ed)?|downgrade[sd]?|overvalued|fade|bagholders?|lower)\b|📉/gi;

/** A post's lean by counting bullish against bearish words. Crude by design —
    no model reads these — so it is shown only with enough posts behind it. */
export function postLean(text: string): 'bull' | 'bear' | null {
  const b = (text.match(BULL_RX) ?? []).length;
  const s = (text.match(BEAR_RX) ?? []).length;
  return b > s ? 'bull' : s > b ? 'bear' : null;
}

/** Bullish share of the posts that lean either way, or null when fewer than
    `min` lean at all (too few to call). */
export function bullShare(bull: number, bear: number, min = 5): number | null {
  const n = bull + bear;
  return n >= min ? Math.round((bull / n) * 100) : null;
}

export function buildRows(
  names: string[],
  st: Map<string, StIn>,
  stTags: Map<string, { bull: number; bear: number; msgs: number }>,
  reddit: Map<string, RedditIn>,
  bsky: Map<string, { posts: number; bull: number; bear: number }>,
  quotes: Map<string, { price: number; chg: number; vol?: number }>,
  extra: Map<string, { rvol: number | null; rs: number | null }> = new Map(),
): SentimentRow[] {
  return names.map(t => {
    const s = st.get(t), tags = stTags.get(t), r = reddit.get(t), q = quotes.get(t), x = extra.get(t);
    return {
      t,
      n: s?.n ?? r?.n,
      price: q?.price ?? null,
      chg: q?.chg ?? null,
      vol: q?.vol ?? null,
      rvol: x?.rvol ?? null,
      rs: x?.rs ?? null,
      st: s || tags ? { rank: s?.rank ?? null, bull: tags?.bull ?? 0, bear: tags?.bear ?? 0, msgs: tags?.msgs ?? 0, watchers: s?.watchers, summary: s?.summary } : null,
      reddit: r ? { rank: r.rank, mentions: r.mentions, prev: r.prev } : null,
      bsky: bsky.get(t) ?? null,
    };
  });
}

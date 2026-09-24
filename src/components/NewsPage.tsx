'use client';

/* components/NewsPage.tsx — the day's news, scoped to the names on the boards.
 *
 * WHY THIS PAGE EXISTS
 * --------------------
 * Every scanner already resolves a catalyst per row and shows it as a chip in
 * a table cell. Read the scanners page and the news is there, scattered across
 * twelve tables, one cell at a time — which is not reading the news. This
 * collects it: the headline, why it is classified the way it is, how old it
 * is, and, on the rows that earn two stars, that the article states a REASON
 * for the move rather than restating the move.
 *
 * TWO SECTIONS, DELIBERATELY DISJOINT. Measured on the live payloads: the scan
 * catalysts and the Benzinga WIIM wire share ZERO urls. The scanners attach
 * name-specific "why is X moving" copy; the wire carries broad-market pieces
 * (Boeing, Costco, Oracle) that no scan row references. Folding them into one
 * list would suggest one feed with duplicates in it. They are two feeds.
 *
 * COST. /api/news/pool is one kv.mget behind a 60s edge cache and /api/news is
 * already cached at 120s — both flat in users, neither polled. The page fetches
 * once on mount and offers a manual refresh instead of a timer, because news a
 * minute stale is news and a setInterval per open tab is how the Upstash quota
 * went out in August.
 *
 * LAYOUT (v2, Sep 2026). Same visual language as the Confluence report: a hero
 * card that says in one plain line what the news is about, three stat tiles,
 * type pills to filter by, then each story as its own card — tag, headline at
 * reading size, the names as solid chips (chart on hover), publisher and age.
 * The data, the two fetches and the no-timer rule are unchanged; everything
 * the hero and the pills show is derived client-side from the same payloads.
 */

import React from 'react';
import { ThemeToggle } from './ThemeProvider';
import { ActiveChartProvider } from './TickerChartHover';
import TickerChartHover, { WatchlistBtn } from './TickerChartHover';
import { WatchlistProvider } from './WatchlistContext';
import WatchlistPanel from './WatchlistPanel';
import DashNav from './DashNav';
import HelpModal from './HelpModal';
import InfoDot from './InfoDot';
import { EDGE_TINT, type EdgeTier } from '@/lib/scans/edge';
import { catalystTooltip, headlineOf, decodeEntities, type CatalystRow } from '@/lib/catalyst';
import { gradeOf, rvolColor } from '@/lib/indicators/columnColors';
import { isLawsuitNoise, isEvergreenNoise, FRESH_MIN,
  TAG_META, tagOf, tagCounts, minutesSince, ageLabelMinutes, relTime, fmtMove,
  type NewsTag,
} from '@/lib/newsView';

type StatRow = {
  tier: EdgeTier | null;
  cnf: number | null;
  rsRating: number | null;
  rvol: number | null;
  vol: number | null;
  dvol: number | null;
  changePct: number | null;
  price: number | null;
  scan: string;
  name: string | null;
};

type PoolItem = CatalystRow & {
  ticker: string;
  scan: string;
  name?: string | null;
  sector?: string | null;
  price?: number | null;
  changePct?: number | null;
  cnf?: number | null;
  rsRating?: number | null;
  rvol?: number | null;
  vol?: number | null;
  dvol?: number | null;
  tier?: EdgeTier | null;
  stars: number;
};

type WireItem = {
  id: string;
  ticker: string;
  tickers?: string[];
  title: string;
  cleanHeadline?: string;
  aiTag?: string;
  url: string;
  publishedUtc?: string;
  publisher?: string;
};

const SCAN_LABEL: Record<string, string> = {
  sip: 'SIP', daily: 'DAY', ep9m: 'EP9', swing: 'SWING', vcp: 'VCP',
  coil: '10/21', dvol: '$VOL', hrs: 'HRS', mb: '100',
};

/* Same palette the scan-source pills use on the dashboard, so a source means
   the same colour wherever it is named. */
const SCAN_CLS: Record<string, string> = {
  sip: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
  daily: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  ep9m: 'text-fuchsia-400 bg-fuchsia-500/10 border-fuchsia-500/20',
  swing: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
  vcp: 'text-teal-400 bg-teal-500/10 border-teal-500/20',
  coil: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
  dvol: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  hrs: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
  mb: 'text-fuchsia-400 bg-fuchsia-500/10 border-fuchsia-500/20',
};

/* The row tint the first version used, as words. Each scan's own measured
   tier, decided in the route where the fields that decide it still exist —
   a property of the name, not of the story. */
const moveCls = (v: number | null | undefined) =>
  v == null ? 'text-slate-500' : v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-slate-400';

/* ---- Shared pieces --------------------------------------------------------
   SIZES. Two per card and no more: the headline (and the day's move beside
   it) at 15px, everything else at 12px — pills at 11px uppercase, which reads
   as the same weight. The first version set prose at 13px and every fact
   around it at 7-10px, which is what made it hard to read. */

/* The pill, rounded fully as on the Confluence report. Filter controls and
   in-card tags share it so a colour means one thing on the page. */
const PILL = 'inline-flex items-center gap-1 rounded-full border px-2.5 py-[3px] text-[11px] font-bold tracking-[0.06em] uppercase leading-[1.3] whitespace-nowrap';
const PILL_OFF = 'text-slate-500 bg-transparent border-[#1e293b] hover:text-slate-300';
const LABEL = 'text-[11px] font-bold tracking-[0.14em] uppercase';

/* Solid ticker chip, coloured by CNF grade — green A, amber B, slate for the
   rest and for names that were never scored. The same grade the scan tables
   tint their chips with, filled in. */
function chipCls(cnf: number | null | undefined): string {
  const g = gradeOf(cnf);
  const fill = g === 'A' ? 'bg-emerald-400' : g === 'B' ? 'bg-amber-400' : 'bg-slate-400';
  return `inline-block rounded-md px-2 py-[3px] text-[14px] font-extrabold tracking-wide leading-none text-[#0b0f1a] ${fill}`;
}

function TagPill({ tag, hint }: { tag: NewsTag; hint?: string }) {
  const pill = <span className={`${PILL} ${TAG_META[tag].cls}`}>{TAG_META[tag].label}</span>;
  return hint ? <InfoDot text={hint}>{pill}</InfoDot> : pill;
}

/* "Nebius Group N.V. Class A Ordinary Shares" -> "Nebius Group". */
const shortName = (n: string) => n
  .replace(/\s+(Class [A-Z]|Common Stock|Ordinary Shares|American Depositary Shares?|Common|Shares)\b.*$/i, '')
  .replace(/,?\s+(Inc\.?|Incorporated|Corp\.?|Corporation|Company|Co\.|N\.V\.|plc|PLC|Ltd\.?|Limited|Holdings?|S\.A\.|AG|SE)\s*$/i, '')
  .replace(/,?\s+(Inc\.?|Corp\.?|N\.V\.|Ltd\.?)\s*$/i, '')
  .trim();

type Ticker = { t: string; cnf?: number | null; name?: string | null; move?: number | null };

function TickerRow({ tickers, showName }: { tickers: Ticker[]; showName?: boolean }) {
  const MAX = 4;
  const shown = tickers.slice(0, MAX);
  const more = tickers.length - shown.length;
  return (
    <div className="flex items-center gap-x-3 gap-y-2 flex-wrap text-[12px] min-w-0">
      {shown.map((k, i) => (
        <span key={k.t} className="inline-flex items-center gap-1.5 min-w-0">
          {i === 0 && <WatchlistBtn symbol={k.t} />}
          <TickerChartHover symbol={k.t}>
            <span className={chipCls(k.cnf)} aria-label={k.name || k.t}>{k.t}</span>
          </TickerChartHover>
          {i === 0 && showName && k.name && (
            <span className="text-slate-300 truncate max-w-[180px]">{shortName(k.name)}</span>
          )}
          {/* The lead name's move is already the big number top right. */}
          {i > 0 && k.move != null && (
            <span className={`font-bold tabular-nums ${moveCls(k.move)}`}>{fmtMove(k.move)}</span>
          )}
        </span>
      ))}
      {more > 0 && <span className="text-slate-500 font-semibold">+{more} more</span>}
    </div>
  );
}

/* The stat strip: the same fields and colour rules as the scan tables — CNF,
   RS, RVOL, VOL, $VOL — in words rather than column codes. The day's move is
   not repeated here: it is the big number on the card.

   On the wire these exist only for a name that is on a board. A missing strip
   is the honest answer there, not a row of dashes. */
function Stats({ s }: { s: Partial<StatRow> | null | undefined }) {
  // One fact, in words: how much busier than usual the stock is. Scores,
  // share counts and dollar volume live on the scan tables.
  if (!s || s.rvol == null) return null;
  const x = s.rvol >= 10 ? Math.round(s.rvol).toString() : s.rvol.toFixed(1);
  return <span className={`font-bold tabular-nums ${rvolColor(s.rvol)}`}>{x}× usual volume</span>;
}

/* ---- One story ------------------------------------------------------------
   THE HEADLINE IS THE CARD. Tag first, so the eye knows what kind of story it
   is before reading it; the headline at 15px; the names underneath; the small
   facts last, below a hairline. The day's move for the lead name sits top
   right, where the Confluence report puts it. */
function NewsCard({ tag, tagHint, headline, url, move, flags, tickers, showName, meta, stats, tier }: {
  tag: NewsTag;
  tagHint?: string;
  headline: string;
  url: string | null;
  move?: number | null;
  flags?: React.ReactNode;
  tickers: Ticker[];
  showName?: boolean;
  meta: string;
  stats?: Partial<StatRow> | null;
  /** The lead name's tier on its own scan — tints the card like every scan table. */
  tier?: EdgeTier | null;
}) {
  const head = (
    <p className="text-[15px] leading-[1.45] font-semibold text-slate-100 break-words group-hover/hl:text-cyan-300 transition-colors">
      {headline}
    </p>
  );
  /* The ticker is the first thing you see: names and the move on top, the
     headline under them, and the kind of story + source as small print. */
  return (
    <article className={`border border-[#1e293b] rounded-2xl p-4 flex flex-col gap-2.5 min-w-0 ${tier ? EDGE_TINT[tier] : 'bg-[#111827]'}`}>
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0"><TickerRow tickers={tickers} showName={showName} /></div>
        {move != null && (
          <span className={`shrink-0 text-[16px] font-extrabold tabular-nums leading-none ${moveCls(move)}`}>{fmtMove(move)}</span>
        )}
      </div>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="block group/hl" style={{ textDecoration: 'none' }}>
          {head}
        </a>
      ) : head}
      <div className="mt-auto flex items-center gap-x-2.5 gap-y-1.5 flex-wrap text-[12px] text-slate-400 border-t border-[#1e293b] pt-2.5">
        {tag !== 'general' && <TagPill tag={tag} hint={tagHint} />}
        {flags}
        {meta && <span>{meta}</span>}
        <Stats s={stats} />
      </div>
    </article>
  );
}

function Stars({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <InfoDot text={n >= 2
      ? '★★ — the tag is a real category (earnings, M&A, analyst, FDA…) AND the article states a reason for the move rather than restating it.'
      : '★ — there is an article, but it is generic: it restates the move rather than explaining it.'}>
      <span className={`text-[12px] font-bold leading-none ${n >= 2 ? 'text-amber-400' : 'text-amber-400/50'}`}>{n >= 2 ? '★★' : '★'}</span>
    </InfoDot>
  );
}

const TIER_RANK: Record<string, number> = { green: 0, yellow: 1, red: 2 };

const poolTag = (it: PoolItem): NewsTag => tagOf(it.catalyst);
const wireTag = (a: WireItem): NewsTag => tagOf(a.aiTag);

function PoolCard({ it }: { it: PoolItem }) {
  const headline = headlineOf(it);
  if (!headline) return null;
  const mins = ageLabelMinutes(it.newsAge);
  const age = mins != null ? relTime(mins) : (it.newsAge ?? '');
  const delayed = /\(Delayed\)\s*$/i.test(it.catalyst || '');
  return (
    <NewsCard
      tag={poolTag(it)}
      tagHint={catalystTooltip(it, { headline }) || undefined}
      headline={headline}
      url={it.catalystUrl ?? null}
      move={it.changePct ?? null}
      showName
      flags={
        <>
          <Stars n={it.stars} />
          {it.newsSentiment === 'negative' && (
            <span className={`${PILL} text-rose-400 bg-rose-500/10 border-rose-500/20`}>Negative</span>
          )}
        </>
      }
      tickers={[{ t: it.ticker, cnf: it.cnf, name: it.name, move: it.changePct }]}
      meta={[it.newsPublisher, age, delayed ? 'delayed' : null].filter(Boolean).join(' · ')}
      stats={it}
      tier={it.tier ?? null}
    />
  );
}

function WireCard({ it, stats, now }: { it: WireItem; stats: Record<string, StatRow>; now: number }) {
  /* An article can be tagged with several tickers; the one that leads is the
     first that is on a board, and its stats are what the card shows. */
  const uniq = [...new Set((it.tickers?.length ? it.tickers : [it.ticker]).map(t => String(t).toUpperCase()))];
  const leadIdx = uniq.findIndex(t => !!stats[t]);
  const ordered = leadIdx > 0 ? [uniq[leadIdx], ...uniq.filter((_, i) => i !== leadIdx)] : uniq;
  const lead = leadIdx >= 0 ? stats[uniq[leadIdx]] : undefined;
  return (
    <NewsCard
      tag={wireTag(it)}
      headline={decodeEntities(it.cleanHeadline || it.title)}
      url={it.url}
      move={lead?.changePct ?? null}
      tickers={ordered.map(t => ({ t, cnf: stats[t]?.cnf ?? null, name: stats[t]?.name ?? null, move: stats[t]?.changePct ?? null }))}
      meta={[it.publisher, relTime(minutesSince(it.publishedUtc, now))].filter(Boolean).join(' · ')}
      stats={lead}
      tier={lead?.tier ?? null}
    />
  );
}

function Section({ title, count, info, controls, children }: {
  title: string; count?: string; info: string; controls?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <h2 className={`${LABEL} text-slate-300`}>{title}</h2>
          {count && <span className="text-[12px] font-semibold text-slate-500 tabular-nums">{count}</span>}
          <InfoDot text={info} />
        </div>
        {controls}
      </div>
      {children}
    </section>
  );
}

/* Two INDEPENDENT columns, as the page had before: split the list and stack
   each half, so a two-line headline never leaves a hole beside a one-line
   one. One column on a phone. */
const Grid = ({ children }: { children: React.ReactNode }) => {
  const items = React.Children.toArray(children);
  if (items.length <= 2) return <div className="flex flex-col gap-3.5">{items}</div>;
  const mid = Math.ceil(items.length / 2);
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
      <div className="flex flex-col gap-3.5 min-w-0">{items.slice(0, mid)}</div>
      <div className="flex flex-col gap-3.5 min-w-0">{items.slice(mid)}</div>
    </div>
  );
};

const Note = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[12px] text-slate-500 bg-[#111827] border border-[#1e293b] rounded-2xl px-4 py-3.5">{children}</p>
);

export default function NewsPage() {
  const [pool, setPool] = React.useState<PoolItem[]>([]);
  const [stats, setStats] = React.useState<Record<string, StatRow>>({});
  const [poolCount, setPoolCount] = React.useState(0);
  const [wire, setWire] = React.useState<WireItem[]>([]);
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'error'>('loading');
  const [scanKey, setScanKey] = React.useState<string | null>(null);
  // Actionable by default: only stories that state a real reason (★★).
  const [causalOnly, setCausalOnly] = React.useState(true);
  const [wireScope, setWireScope] = React.useState<'pool' | 'all'>('pool');
  const [tagKey, setTagKey] = React.useState<NewsTag | null>(null);
  const [helpOpen, setHelpOpen] = React.useState(false);
  /* Ages are measured against the moment the data arrived, so every card on
     the page agrees and the render stays pure. Refresh moves it. */
  const [loadedAt, setLoadedAt] = React.useState(0);

  const load = React.useCallback(async () => {
    setStatus('loading');
    try {
      const [p, w] = await Promise.all([
        fetch('/api/news/pool').then(r => r.json()).catch(() => null),
        fetch('/api/news').then(r => r.json()).catch(() => null),
      ]);
      const items: PoolItem[] = p?.items ?? [];
      setPool(items);
      setStats(p?.stats ?? {});
      setPoolCount(p?.poolCount ?? 0);
      setWire(w?.results ?? []);
      setLoadedAt(Date.now());
      setStatus(items.length || (w?.results?.length ?? 0) ? 'ready' : 'error');
    } catch {
      setStatus('error');
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  /* A pool item without a headline never renders, so it does not count
     anywhere either — the pills and the hero add up to what is on screen. */
  const poolWithNews = React.useMemo(() => pool.filter(it => {
    const h = headlineOf(it);
    if (!h || isLawsuitNoise(h, poolTag(it)) || isEvergreenNoise(h)) return false;
    const m = ageLabelMinutes(it.newsAge);
    return m == null || m < FRESH_MIN;
  }), [pool]);
  // Lawsuit / class-action releases are dropped from both sections.
  const cleanWire = React.useMemo(() => wire.filter(a => {
    const h = decodeEntities(a.cleanHeadline || a.title);
    if (isLawsuitNoise(h, wireTag(a)) || isEvergreenNoise(h)) return false;
    const m = minutesSince(a.publishedUtc, Date.now());
    return m == null || m < FRESH_MIN;
  }), [wire]);

  /* Actionable order: the strongest setups first (green, yellow, red, none),
     then the bigger move. */
  const shown = React.useMemo(() => poolWithNews.filter(it =>
    (!scanKey || it.scan === scanKey) && (!causalOnly || it.stars >= 2) && (!tagKey || poolTag(it) === tagKey))
    .sort((a, b) => ((TIER_RANK[a.tier ?? ''] ?? 3) - (TIER_RANK[b.tier ?? ''] ?? 3))
      || (Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0))),
  [poolWithNews, scanKey, causalOnly, tagKey]);

  const onBoard = React.useCallback((a: WireItem) =>
    (a.tickers?.length ? a.tickers : [a.ticker]).some(t => !!stats[String(t).toUpperCase()]), [stats]);

  const ownedWire = React.useMemo(() => cleanWire.filter(onBoard), [cleanWire, onBoard]);
  const wireShown = React.useMemo(() =>
    (wireScope === 'pool' ? ownedWire : cleanWire).filter(a => !tagKey || wireTag(a) === tagKey),
  [wireScope, ownedWire, cleanWire, tagKey]);

  /* ---- The hero: both feeds as loaded. Filters do not move it — it is the
     summary of what came back, not of what is currently shown. */
  const counts = React.useMemo(
    () => tagCounts([...poolWithNews.map(poolTag), ...cleanWire.map(wireTag)]),
    [poolWithNews, cleanWire]);
  const total = poolWithNews.length + cleanWire.length;

  /* Only sources that actually have news get a pill — a pill with nothing
     behind it is noise, the same rule the dashboard's filters follow. */
  const scanPills = Object.keys(SCAN_LABEL)
    .map(k => ({ k, n: poolWithNews.filter(i => i.scan === k).length }))
    .filter(x => x.n > 0);

  const causalCount = poolWithNews.filter(i => i.stars >= 2).length;

  /* With nothing selected every pill shows its colour; once one is picked the
     rest dim — the dashboard's rule. */
  const filterPill = (active: boolean, anyActive: boolean, onCls: string) =>
    `${PILL} transition-colors ${active || !anyActive ? onCls : PILL_OFF}`;

  // 'General' is not a type anyone filters by.
  const tagPillOrder = counts.filter(c => c.tag !== 'general');

  return (
    <div className="news-v2 min-h-screen bg-[#05080f] text-slate-300 font-sans md:py-10 flex justify-center">
      {/* No MarketDataProvider here on purpose. It polls /api/scanner/latest —
          178 KB — every 60 seconds for the quote engine the scanner tables
          need, and nothing on this page reads it. An open news tab would cost
          ~10 MB an hour to display a headline list. The chart hover and the
          watchlist do not touch that context; they were the only reason the
          scanners page wraps all three. */}
      <WatchlistProvider>
          <ActiveChartProvider>
            <div className="w-full max-w-[1200px] bg-[#0b0f1a] md:rounded-[2rem] md:border md:border-white/5 overflow-hidden md:shadow-2xl relative pb-20">

              <div className="px-4 md:px-10 pt-6 md:pt-8 pb-4 md:pb-6 border-b border-white/5 flex flex-wrap justify-between items-center gap-3">
                <a href="https://confluencetradingtools.com" className="flex items-center gap-3.5 md:gap-5 no-underline" style={{ textDecoration: 'none' }}>
                  <img src="/logo.svg" alt="CTT" className="ctt-logo h-9 md:h-10 w-auto drop-shadow-[0_2px_10px_rgba(124,139,250,0.18)]" />
                  <div className="leading-none">
                    <h2 className="text-xl md:text-[1.75rem] font-extrabold text-slate-50 tracking-[-0.025em] leading-[1.05] antialiased">
                      Confluence Trading Tools
                    </h2>
                    <p className="text-[10px] font-semibold text-slate-500 tracking-[0.22em] uppercase mt-1.5">
                      News On Your Names
                    </p>
                  </div>
                </a>
                <div className="flex items-center gap-2">
                  <ThemeToggle />
                  <WatchlistPanel hideToggle />
                  <button
                    onClick={() => setHelpOpen(true)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-sm font-bold bg-slate-700/60 hover:bg-slate-600 text-slate-400 hover:text-slate-200 transition-colors shrink-0"
                    aria-label="Help"
                  >
                    ?
                  </button>
                </div>
                {/* The links get their own centred row on a phone: they are the
                    width of the screen, so sharing a line with the brand and the
                    controls is what pushed the theme toggle onto a line of its own.
                    From md up `order-none` puts them back inline. */}
                <div className="w-full flex justify-center order-last md:w-auto md:order-none">
                  <DashNav />
                </div>
              </div>

              <div className="px-4 md:px-10 py-6 space-y-6">

                <div>
                  <h1 className="text-[22px] font-extrabold text-slate-100 tracking-[-0.01em]">Today&apos;s news</h1>
                  <p className="text-[12px] text-slate-500 mt-1">
                    Headlines on the names in your scans, plus the wider market wire · open a headline to read the article
                  </p>
                </div>

                {/* No summary box — the page opens on the news itself. Only a
                    loading or error state needs a line here. */}
                {status !== 'ready' && (
                  <p className="text-[14px] text-slate-400">
                    {status === 'loading' ? 'Loading the latest headlines…' : 'No news came back. Try Refresh in a minute.'}
                  </p>
                )}

                {/* ---- Type filter — applies to both sections ---- */}
                {status !== 'loading' && tagPillOrder.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`${LABEL} text-slate-500 mr-1`}>Type</span>
                    <button
                      onClick={() => setTagKey(null)}
                      className={`${PILL} transition-colors ${tagKey == null ? 'text-slate-200 bg-[#1e293b] border-[#1e293b]' : PILL_OFF}`}
                    >
                      All {total}
                    </button>
                    {tagPillOrder.map(({ tag, n }) => (
                      <button
                        key={tag}
                        onClick={() => setTagKey(tagKey === tag ? null : tag)}
                        className={filterPill(tagKey === tag, tagKey != null, TAG_META[tag].cls)}
                      >
                        {TAG_META[tag].label} {n}
                      </button>
                    ))}
                  </div>
                )}

                <Section
                  title="On your names"
                  count={status === 'loading' ? '' : `${shown.length} of ${poolWithNews.length} · ${poolCount} names scanned`}
                  info={"Every headline the scanners attached to a name currently on one of your boards — the same article the chip in a scan table links to, collected in one place instead of one cell at a time.\n\nOrdered by CNF, like the rest of the site. The odds pill is each scan's OWN measured tier from its backtest — green, yellow, red — not one rule applied to all of them; hover it for what it means on that scan. ★★ breaks the tie — it means the tag is a real category (earnings, M&A, analyst, FDA…) AND the article states a REASON for the move rather than restating it — and the age breaks that. ★ means there is an article but it is generic. An unscored name sorts last rather than as a zero.\n\nThis is not a market feed: a name with no news simply is not here, and a name leaves when it leaves the scans."}
                  controls={
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {causalCount > 0 && (
                        <InfoDot text="Show only the headlines that explain the move (★★).">
                          <button
                            onClick={() => setCausalOnly(v => !v)}
                            className={`${PILL} transition-colors ${causalOnly ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' : PILL_OFF}`}
                          >
                            ★★ {causalCount}
                          </button>
                        </InfoDot>
                      )}
                      {scanPills.map(({ k, n }) => (
                        <button
                          key={k}
                          onClick={() => setScanKey(scanKey === k ? null : k)}
                          className={filterPill(scanKey === k, scanKey != null, SCAN_CLS[k])}
                        >
                          {SCAN_LABEL[k]} {n}
                        </button>
                      ))}
                    </div>
                  }
                >
                  {status === 'loading' ? (
                    <Note>Loading…</Note>
                  ) : shown.length === 0 ? (
                    <Note>
                      {poolWithNews.length === 0
                        ? 'No scanned name is carrying a headline right now. This fills in as the scans run.'
                        : 'No headline matches the active filter.'}
                    </Note>
                  ) : (
                    <Grid>{shown.map(it => <PoolCard key={`${it.ticker}-${it.scan}`} it={it} />)}</Grid>
                  )}
                </Section>

                <Section
                  title="Market wire"
                  count={status === 'loading' ? '' : `${wireShown.length} of ${wire.length}`}
                  info={"Benzinga's WIIM desk — the general feed, ten hours of coverage, with the lawsuit and deadline spam filtered out.\n\nON BOARD shows only the articles touching a name on one of your scans; ALL shows the rest of the wire too, which is where the index and mega-cap context lives.\n\nMeasured on the live feeds: this and the section above share no articles at all. The scanners attach name-specific copy; the wire carries the broader pieces no scan row references."}
                  controls={
                    <div className="flex items-center gap-1.5">
                      {(['pool', 'all'] as const).map(k => (
                        <button
                          key={k}
                          onClick={() => setWireScope(k)}
                          className={`${PILL} transition-colors ${
                            wireScope === k ? 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20' : PILL_OFF
                          }`}
                        >
                          {k === 'pool' ? `On board ${ownedWire.length}` : `All ${wire.length}`}
                        </button>
                      ))}
                    </div>
                  }
                >
                  {status === 'loading' ? (
                    <Note>Loading…</Note>
                  ) : wireShown.length === 0 ? (
                    <Note>
                      {wire.length === 0
                        ? 'The wire is empty right now.'
                        : tagKey && (wireScope === 'all' || ownedWire.length > 0)
                          ? 'Nothing on the wire matches the active filter.'
                          : 'Nothing on the wire touches a scanned name — switch to ALL for the rest of it.'}
                    </Note>
                  ) : (
                    <Grid>{wireShown.map(a => <WireCard key={a.id} it={a} stats={stats} now={loadedAt} />)}</Grid>
                  )}
                </Section>

                <div className="flex items-center gap-3 flex-wrap">
                  <button onClick={load} className={`${PILL} ${PILL_OFF} transition-colors`}>
                    Refresh
                  </button>
                  {/* No timer on purpose — see the header. */}
                  <span className="text-[12px] text-slate-500">
                    Loaded once. Refresh for the latest; the feeds are cached 60–120s at the edge.
                  </span>
                </div>
              </div>

              <div className="text-center text-[10px] text-slate-600 pt-10 pb-4 px-4">
                Confluence Trading Tools LLC © {new Date().getFullYear()} • Not investment advice. • <a href="mailto:info@confluencetradingtools.com" className="text-slate-500 hover:text-slate-400" style={{ textDecoration: 'none' }}>info@confluencetradingtools.com</a>
              </div>
            </div>
            <HelpModal isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
          </ActiveChartProvider>
      </WatchlistProvider>
    </div>
  );
}

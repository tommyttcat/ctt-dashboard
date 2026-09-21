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
 */

import React from 'react';
import { ThemeToggle } from './ThemeProvider';
import { ActiveChartProvider } from './TickerChartHover';
import TickerChartHover, { WatchlistBtn } from './TickerChartHover';
import { WatchlistProvider } from './WatchlistContext';
import WatchlistPanel from './WatchlistPanel';
import DashNav from './DashNav';
import InfoDot from './InfoDot';
import { CatalystChip, NewsStars, catalystTooltip, headlineOf, decodeEntities, type CatalystRow } from '@/lib/catalyst';
import { tickerChipForScore, tickerTitle } from '@/lib/indicators/columnColors';
import { scoreCellCls } from '@/lib/indicators/columnColors';

type PoolItem = CatalystRow & {
  ticker: string;
  scan: string;
  name?: string | null;
  sector?: string | null;
  price?: number | null;
  changePct?: number | null;
  cnf?: number | null;
  rsRating?: number | null;
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

const chgCls = (v: number | null | undefined) =>
  v == null ? 'text-slate-500' : v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-slate-400';

const fmtChg = (v: number | null | undefined) =>
  v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;

/* The wire carries a timestamp, so its ages are computed rather than read off
   a stored label — the opposite of the pool feed, which only has the label the
   scan printed. */
function wireAge(iso: string | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

const PILL = 'text-[9px] font-bold tracking-wider uppercase px-1.5 py-[2px] rounded border transition-all duration-150';

const Card = ({ title, count, info, children, right }: {
  title: string; count?: string; info: string; right?: React.ReactNode; children: React.ReactNode;
}) => (
  <div className="bg-[#0f1523] border border-white/5 rounded-xl px-4 md:px-5 py-4">
    <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
      <div className="flex items-center">
        <span className="text-[11px] font-bold tracking-widest uppercase text-slate-300">{title}</span>
        {count && <span className="ml-2 text-[10px] font-bold text-slate-500">{count}</span>}
        <InfoDot text={info} />
      </div>
      {right}
    </div>
    {children}
  </div>
);

/* ---- One item ------------------------------------------------------------
   THE HEADLINE IS THE PAGE. The first cut rendered everything at 10px, the
   scanner tables' size — right for a column of numbers you scan down, wrong
   for a sentence you read. Prose gets 13px and leads the item.

   ONE THING IN THE RAIL. The second cut stacked the ticker and its scan pill
   there, two chips of different widths under each other, and the left edge
   came out as a stair-step. The rail is a fixed 54px holding the ticker and
   nothing else, so every headline on the page starts at the same x; the scan
   moves down to the metadata line where the other small facts already live. */

const META = 'text-[10px] font-medium';

function ItemShell({ ticker, cnf, name, headline, url, title, meta }: {
  ticker: string;
  cnf?: number | null;
  name?: string | null;
  headline: string;
  url: string | null;
  title?: string;
  meta: React.ReactNode;
}) {
  /* group-hover with no group above it never fires, so one body serves the
     linked and unlinked cases without a second copy. */
  const body = (
    <>
      <p className="text-[13px] leading-[1.4] text-slate-100 font-medium group-hover/hl:text-indigo-300 transition-colors">
        {headline}
      </p>
      <div className={`mt-1 flex items-center gap-x-2 gap-y-1 flex-wrap ${META} text-slate-500`}>{meta}</div>
    </>
  );
  return (
    <div className="flex items-start gap-2.5 py-2.5 border-b border-white/[0.05] last:border-b-0">
      <div className="w-[58px] shrink-0 flex items-center gap-1 pt-[1px]">
        <WatchlistBtn symbol={ticker} />
        <TickerChartHover symbol={ticker}>
          <span title={tickerTitle(name, ticker, cnf)} className={tickerChipForScore(cnf)}>{ticker}</span>
        </TickerChartHover>
      </div>
      <div className="flex-1 min-w-0">
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" title={title} className="block group/hl" style={{ textDecoration: 'none' }}>
            {body}
          </a>
        ) : body}
      </div>
    </div>
  );
}

function PoolRow({ it }: { it: PoolItem }) {
  const headline = headlineOf(it);
  if (!headline) return null;
  return (
    <ItemShell
      ticker={it.ticker}
      cnf={it.cnf}
      name={it.name}
      url={it.catalystUrl ?? null}
      title={catalystTooltip(it, { headline })}
      headline={headline}
      meta={
        <>
          <span className={`${PILL} ${SCAN_CLS[it.scan] ?? 'text-slate-400 bg-slate-500/10 border-slate-500/20'}`}>
            {SCAN_LABEL[it.scan] ?? it.scan.toUpperCase()}
          </span>
          <NewsStars row={it} />
          <CatalystChip row={it} headline={headline} size="sm" />
          {it.cnf != null && <span className={scoreCellCls(it.cnf)} title="CNF score">{Math.round(it.cnf)}</span>}
          <span className={`font-bold tabular-nums ${chgCls(it.changePct)}`}>{fmtChg(it.changePct)}</span>
          <span className="text-slate-600 truncate">{[it.newsPublisher, it.newsAge].filter(Boolean).join(' · ')}</span>
        </>
      }
    />
  );
}

function WireRow({ it, owned }: { it: WireItem; owned: boolean }) {
  return (
    <ItemShell
      ticker={it.ticker}
      cnf={null}
      url={it.url}
      headline={decodeEntities(it.cleanHeadline || it.title)}
      meta={
        <>
          {owned && (
            <span className={`${PILL} text-indigo-400 bg-indigo-500/10 border-indigo-500/20`} title="On one of your scans right now">
              ON BOARD
            </span>
          )}
          {it.aiTag && <span className={`${PILL} text-slate-400 bg-slate-500/10 border-slate-500/20`}>{it.aiTag}</span>}
          <span className="text-slate-600 truncate">{[it.publisher, wireAge(it.publishedUtc)].filter(Boolean).join(' · ')}</span>
        </>
      }
    />
  );
}

/* Two INDEPENDENT columns, not a two-column grid.
   A grid lays its items out in rows, so a two-line headline on the left
   stretched the row and left a hole under the one-line headline on the right —
   which is what made the list look broken. Splitting the array and stacking
   each half in its own column lets both sides pack tight, and their dividers
   stop having to agree. Same structure the Setups Summary card uses. */
function TwoUp<T>({ items, render }: { items: T[]; render: (item: T, i: number) => React.ReactNode }) {
  if (items.length <= 4) return <div>{items.map(render)}</div>;
  const mid = Math.ceil(items.length / 2);
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
      <div className="min-w-0">{items.slice(0, mid).map(render)}</div>
      <div className="min-w-0 border-t border-white/[0.05] md:border-t-0">{items.slice(mid).map(render)}</div>
    </div>
  );
}

export default function NewsPage() {
  const [pool, setPool] = React.useState<PoolItem[]>([]);
  const [tickers, setTickers] = React.useState<Set<string>>(new Set());
  const [poolCount, setPoolCount] = React.useState(0);
  const [wire, setWire] = React.useState<WireItem[]>([]);
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'error'>('loading');
  const [scanKey, setScanKey] = React.useState<string | null>(null);
  const [causalOnly, setCausalOnly] = React.useState(false);
  const [wireScope, setWireScope] = React.useState<'pool' | 'all'>('pool');

  const load = React.useCallback(async () => {
    setStatus('loading');
    try {
      const [p, w] = await Promise.all([
        fetch('/api/news/pool').then(r => r.json()).catch(() => null),
        fetch('/api/news').then(r => r.json()).catch(() => null),
      ]);
      const items: PoolItem[] = p?.items ?? [];
      setPool(items);
      setTickers(new Set<string>((p?.tickers ?? []).map((t: string) => String(t).toUpperCase())));
      setPoolCount(p?.poolCount ?? 0);
      setWire(w?.results ?? []);
      setStatus(items.length || (w?.results?.length ?? 0) ? 'ready' : 'error');
    } catch {
      setStatus('error');
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const shown = React.useMemo(() => pool.filter(it =>
    (!scanKey || it.scan === scanKey) && (!causalOnly || it.stars >= 2)), [pool, scanKey, causalOnly]);

  const ownedWire = React.useMemo(
    () => wire.filter(a => (a.tickers?.length ? a.tickers : [a.ticker])
      .some(t => tickers.has(String(t).toUpperCase()))),
    [wire, tickers],
  );
  const wireShown = wireScope === 'pool' ? ownedWire : wire;

  /* Only sources that actually have news get a pill — a pill with nothing
     behind it is noise, the same rule the dashboard's filters follow. */
  const scanPills = Object.keys(SCAN_LABEL)
    .map(k => ({ k, n: pool.filter(i => i.scan === k).length }))
    .filter(x => x.n > 0);

  const causalCount = pool.filter(i => i.stars >= 2).length;

  return (
    <div className="min-h-screen bg-[#05080f] text-slate-300 font-sans md:py-10 flex justify-center">
      {/* No MarketDataProvider here on purpose. It polls /api/scanner/latest —
          178 KB — every 60 seconds for the quote engine the scanner tables
          need, and nothing on this page reads it. An open news tab would cost
          ~10 MB an hour to display a headline list. The chart hover and the
          watchlist do not touch that context; they were the only reason the
          scanners page wraps all three. */}
      <WatchlistProvider>
          <ActiveChartProvider>
            <div className="w-full max-w-[1200px] bg-[#0b101a] md:rounded-[2rem] md:border md:border-white/5 overflow-hidden md:shadow-2xl relative pb-20">

              <div className="px-3 md:px-10 pt-6 md:pt-8 pb-4 md:pb-6 border-b border-white/5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
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
                  <DashNav />
                  <WatchlistPanel hideToggle />
                </div>
              </div>

              <div className="px-3 md:px-10 py-6 space-y-5">

                <Card
                  title="On your names"
                  count={status === 'loading' ? '' : `${shown.length} of ${pool.length} · ${poolCount} names scanned`}
                  info={"Every headline the scanners attached to a name currently on one of your boards — the same article the chip in a scan table links to, collected in one place instead of one cell at a time.\n\n★★ means the tag is a real category (earnings, M&A, analyst, FDA…) AND the article states a REASON for the move rather than restating it. ★ means there is an article but it is generic. Sorted stars first, then newest.\n\nThis is not a market feed: a name with no news simply is not here, and a name leaves when it leaves the scans."}
                  right={
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {causalCount > 0 && (
                        <button
                          onClick={() => setCausalOnly(v => !v)}
                          title="Only headlines that explain the move"
                          className={`${PILL} ${causalOnly ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' : 'text-slate-600 bg-transparent border-white/5'}`}
                        >
                          ★★ {causalCount}
                        </button>
                      )}
                      {scanPills.map(({ k, n }) => (
                        <button
                          key={k}
                          onClick={() => setScanKey(scanKey === k ? null : k)}
                          className={`${PILL} ${
                            scanKey === k ? SCAN_CLS[k] : scanKey == null ? SCAN_CLS[k] : 'text-slate-600 bg-transparent border-white/5'
                          }`}
                        >
                          {SCAN_LABEL[k]} {n}
                        </button>
                      ))}
                    </div>
                  }
                >
                  {status === 'loading' ? (
                    <p className="text-[10px] text-slate-500 font-medium">Loading…</p>
                  ) : shown.length === 0 ? (
                    <p className="text-[10px] text-slate-500 font-medium">
                      {pool.length === 0
                        ? 'No scanned name is carrying a headline right now. This fills in as the scans run.'
                        : 'No headline matches the active filter.'}
                    </p>
                  ) : (
                    <TwoUp items={shown} render={it => <PoolRow key={`${it.ticker}-${it.scan}`} it={it} />} />
                  )}
                </Card>

                <Card
                  title="Market wire"
                  count={status === 'loading' ? '' : `${wireShown.length} of ${wire.length}`}
                  info={"Benzinga's WIIM desk — the general feed, ten hours of coverage, with the lawsuit and deadline spam filtered out.\n\nPOOL shows only the articles touching a name on one of your scans; ALL shows the rest of the wire too, which is where the index and mega-cap context lives.\n\nMeasured on the live feeds: this and the section above share no articles at all. The scanners attach name-specific copy; the wire carries the broader pieces no scan row references."}
                  right={
                    <div className="flex items-center gap-1.5">
                      {(['pool', 'all'] as const).map(k => (
                        <button
                          key={k}
                          onClick={() => setWireScope(k)}
                          className={`${PILL} ${
                            wireScope === k ? 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20' : 'text-slate-600 bg-transparent border-white/5'
                          }`}
                        >
                          {k === 'pool' ? `ON BOARD ${ownedWire.length}` : `ALL ${wire.length}`}
                        </button>
                      ))}
                    </div>
                  }
                >
                  {status === 'loading' ? (
                    <p className="text-[10px] text-slate-500 font-medium">Loading…</p>
                  ) : wireShown.length === 0 ? (
                    <p className="text-[10px] text-slate-500 font-medium">
                      {wire.length === 0
                        ? 'The wire is empty right now.'
                        : 'Nothing on the wire touches a scanned name — switch to ALL for the rest of it.'}
                    </p>
                  ) : (
                    <TwoUp
                      items={wireShown}
                      render={a => (
                        <WireRow
                          key={a.id}
                          it={a}
                          owned={(a.tickers?.length ? a.tickers : [a.ticker]).some(t => tickers.has(String(t).toUpperCase()))}
                        />
                      )}
                    />
                  )}
                </Card>

                <div className="flex items-center gap-3">
                  <button
                    onClick={load}
                    className="text-[10px] font-bold tracking-widest uppercase px-3 py-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/[0.04] border border-white/5 transition-colors"
                  >
                    Refresh
                  </button>
                  {/* No timer on purpose — see the header. */}
                  <span className="text-[10px] text-slate-600 font-medium">
                    Loaded once. Refresh for the latest; the feeds are cached 60–120s at the edge.
                  </span>
                </div>
              </div>

              <div className="text-center text-[10px] text-slate-600 pt-10 pb-4">
                Confluence Trading Tools LLC © {new Date().getFullYear()} • Not investment advice. • <a href="mailto:info@confluencetradingtools.com" className="text-slate-500 hover:text-slate-400" style={{ textDecoration: 'none' }}>info@confluencetradingtools.com</a>
              </div>
            </div>
          </ActiveChartProvider>
      </WatchlistProvider>
    </div>
  );
}

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

const getIsMarketActive = () => {
  const est = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = est.getDay();
  const timeStr = est.getHours() + est.getMinutes() / 60;

  if (day === 0 || day === 6) return false;
  if (timeStr >= 4 && timeStr < 20) return true;
  return false;
};

// ---------------------------------------------------------------
// Types
// ---------------------------------------------------------------
interface TapeQuote { ticker: string; pct: number; price: number | null; }

interface Breadth {
  advancers: number;
  decliners: number;
  up4: number;
  down4: number;
}

interface ActionableEvent { time: string; event: string; impact: 'High' | 'Medium' | 'Low'; }

interface SessionBlock {
  phase: string;
  timestamp: string;
  paragraphs: string[];
  takeaway: string;
  colorTheme: string;
}

// ---------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------
const fmt = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

const INDEX_NAMES: Record<string, string> = {
  SPY: 'the S&P', QQQ: 'the Nasdaq', DIA: 'the Dow', IWM: 'small caps',
};

const TAPE_TICKERS = ['SPY', 'QQQ', 'DIA', 'IWM', 'NVDA', 'AAPL', 'MSFT', 'AMZN', 'TSLA'];

// ---------------------------------------------------------------
// Deterministic catalyst classification (no AI) — keyword-tiered,
// same philosophy as the scanner's WIIM tagging.
// ---------------------------------------------------------------
const HIGH_RX = /earnings|beats|misses|guidance|raises (full|fy|outlook)|cuts (full|fy|outlook)|fda|phase (1|2|3|i|ii|iii)\b|approval|clearance|acquisition|acquires|merger|buyout|takeover|to buy\b|cpi|ppi|inflation data|fomc|fed (cuts|hikes|holds|decision)|rate (cut|hike|decision)|jobs report|nonfarm|payrolls|gdp\b|bankruptcy|chapter 11|trading halt|delisting|restatement/i;

const MED_RX = /upgrade|downgrade|initiates coverage|initiated|price target|overweight|underweight|contract|awarded|partnership|collaboration|launches|launch of|unveils|patent|buyback|repurchase|dividend|stock split|offering|secondary|ipo\b|sec (probe|investigation|charges)|doj\b|lawsuit|settlement|recall|short (report|seller)|13f|stake|insider (buy|sell)|guidance update|preliminary results/i;

const LOW_RX = /surges|soars|plunges|jumps|slides|rallies|spikes|tumbles|sinks|climbs|extends (gains|losses)|hits (record|52-week|all-time)/i;

const MACRO_RX = /\b(fed|fomc|cpi|ppi|inflation|treasury yields?|jobs report|nonfarm|payrolls|gdp|tariff|opec|crude oil|oil prices|dollar|geopolit|white house|congress|shutdown|stimulus)\b/i;

const JUNK_RX = /stocks to (buy|watch|sell)|\bwhy you\b|is it a buy|should you buy|prediction|price prediction|\btop \d+\b|\bbest \d+\b|here's what|what to know|things to know|how to invest|vs\.? which|motley|history says|could make you|millionaire|reasons to/i;

function classifyEvent(article: any): ActionableEvent | null {
  const title: string = article?.title || '';
  const desc: string = article?.description || '';
  const blob = `${title} ${desc}`;
  if (!title || JUNK_RX.test(title)) return null;

  let impact: 'High' | 'Medium' | 'Low' | null = null;
  if (HIGH_RX.test(blob)) impact = 'High';
  else if (MED_RX.test(blob)) impact = 'Medium';
  else if (LOW_RX.test(title)) impact = 'Low';
  if (!impact) return null;

  let ticker: string | null = Array.isArray(article?.tickers) && article.tickers.length > 0
    ? String(article.tickers[0]).toUpperCase()
    : null;
  if (!ticker || !/^[A-Z]{1,5}$/.test(ticker)) {
    if (MACRO_RX.test(blob)) ticker = 'MKT';
    else return null;
  }

  let headline = title
    .replace(new RegExp(`^\\(?${ticker}\\)?[:\\-\\s]+`, 'i'), '')
    .replace(/\s+/g, ' ')
    .trim();
  if (headline.length > 90) headline = headline.slice(0, 87).replace(/\s+\S*$/, '') + '…';

  const time = new Date(article.published_utc).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York',
  });

  return { time, event: `${ticker}: ${headline}`, impact };
}

function buildActionableEvents(articles: any[]): ActionableEvent[] {
  const rank = { High: 0, Medium: 1, Low: 2 } as const;
  const seen = new Set<string>();
  const events: ActionableEvent[] = [];

  const classified = articles
    .map(a => ({ a, ev: classifyEvent(a) }))
    .filter((x): x is { a: any; ev: ActionableEvent } => x.ev !== null)
    .sort((x, y) => rank[x.ev.impact] - rank[y.ev.impact] ||
      new Date(y.a.published_utc).getTime() - new Date(x.a.published_utc).getTime());

  for (const { ev } of classified) {
    const key = ev.event.split(':')[0];
    if (seen.has(key) && key !== 'MKT') continue;
    seen.add(key);
    events.push(ev);
    if (events.length >= 10) break;
  }
  return events;
}

// ---------------------------------------------------------------
// Session narrative blocks (no AI) — written from tape + breadth.
// ---------------------------------------------------------------
function toneTheme(spy: number | null, fallback: string): string {
  if (spy == null) return fallback;
  if (spy >= 0.3) return 'emerald';
  if (spy <= -0.3) return 'rose';
  return fallback;
}

function breadthSentence(b: Breadth | null): string {
  if (!b || (b.advancers === 0 && b.decliners === 0)) return '';
  const ratio = b.decliners > 0 ? b.advancers / b.decliners : null;
  let s: string;
  if (ratio !== null && ratio >= 1.5) {
    s = `Internals confirm: ${b.advancers.toLocaleString()} advancers vs ${b.decliners.toLocaleString()} decliners — participation is broad.`;
  } else if (ratio !== null && ratio <= 0.67) {
    s = `Internals are weak: ${b.decliners.toLocaleString()} decliners vs ${b.advancers.toLocaleString()} advancers — selling runs wider than the indexes show.`;
  } else {
    s = `Internals are split at ${b.advancers.toLocaleString()} advancers vs ${b.decliners.toLocaleString()} decliners — a rotational tape.`;
  }
  if (b.up4 >= 25) s += ` ${b.up4} names up 4%+ signal real momentum under the surface.`;
  else if (b.down4 >= 25) s += ` ${b.down4} names down 4%+ flag distribution pressure.`;
  return s;
}

function leadersLine(quotes: Record<string, TapeQuote>): { leader: string; laggard: string; text: string } | null {
  const idx = ['SPY', 'QQQ', 'DIA', 'IWM']
    .map(id => quotes[id])
    .filter((q): q is TapeQuote => !!q);
  if (idx.length < 2) return null;
  const leader = idx.reduce((a, b) => (b.pct > a.pct ? b : a));
  const laggard = idx.reduce((a, b) => (b.pct < a.pct ? b : a));
  return {
    leader: leader.ticker,
    laggard: laggard.ticker,
    text: `${INDEX_NAMES[leader.ticker]} leads at ${fmt(leader.pct)} while ${INDEX_NAMES[laggard.ticker]} lags at ${fmt(laggard.pct)}`,
  };
}

function megaLine(quotes: Record<string, TapeQuote>): string {
  const megas = ['NVDA', 'AAPL', 'MSFT', 'AMZN', 'TSLA']
    .map(id => quotes[id])
    .filter((q): q is TapeQuote => !!q);
  if (megas.length === 0) return '';
  const biggest = megas.reduce((a, b) => (Math.abs(b.pct) > Math.abs(a.pct) ? b : a));
  if (Math.abs(biggest.pct) < 0.75) return '';
  return `${biggest.ticker} (${fmt(biggest.pct)}) is the standout among the mega caps.`;
}

function buildBlocks(
  quotes: Record<string, TapeQuote>,
  breadth: Breadth | null,
  events: ActionableEvent[],
  hour: number,
  isWeekend: boolean
): { morning: SessionBlock; midday: SessionBlock | null; closing: SessionBlock | null } {
  const spy = quotes['SPY']?.pct ?? null;
  const qqq = quotes['QQQ']?.pct ?? null;
  const highCount = events.filter(e => e.impact === 'High').length;
  const lead = leadersLine(quotes);
  const bSent = breadthSentence(breadth);
  const mSent = megaLine(quotes);

  const dir = spy == null ? 'flat' : spy >= 0.3 ? 'higher' : spy <= -0.3 ? 'lower' : 'flat';
  const printLine = spy != null && qqq != null ? `S&P ${fmt(spy)}, Nasdaq ${fmt(qqq)}` : 'index prints pending';

  // ---- MORNING ----
  const morningP1 =
    dir === 'flat'
      ? `Early tape is undecided — ${printLine} — with neither side pressing yet. ${mSent}`.trim()
      : `Early tape is ${dir} — ${printLine} — setting the opening bias. ${mSent}`.trim();
  const morningP2 = [
    highCount > 0
      ? `${highCount} high-impact catalyst${highCount > 1 ? 's' : ''} in the pre-market news flow — check the Actionable Catalysts list for tickers in play.`
      : `News flow is light on top-tier catalysts so far — expect the tape to trade technically off the open.`,
    bSent,
  ].filter(Boolean).join(' ');
  const morning: SessionBlock = {
    phase: 'PRE-MARKET & MORNING TAPE',
    timestamp: '08:30 AM EST',
    paragraphs: [morningP1, morningP2],
    takeaway:
      dir === 'higher' ? 'Bias long above the opening range; let leaders confirm before pressing.' :
      dir === 'lower' ? 'Defense first — wait for the opening range to resolve before committing size.' :
      'No edge at the open — let the opening range define direction.',
    colorTheme: toneTheme(spy, 'cyan'),
  };

  // ---- MIDDAY ----
  let midday: SessionBlock | null = null;
  if (isWeekend || hour >= 11.5) {
    const midP1 = lead
      ? `Midday rotation check: ${lead.text} — ${lead.leader === 'IWM' ? 'risk appetite is broadening beyond the mega caps' : lead.leader === 'QQQ' ? 'growth is doing the heavy lifting' : 'the move is concentrated in the large-cap complex'}.`
      : `Midday tape holds ${dir} — ${printLine}.`;
    const midP2 = [bSent || `Index prints stand at ${printLine} through the lunch session.`, mSent].filter(Boolean).join(' ');
    midday = {
      phase: 'MIDDAY MIX & ROTATION',
      timestamp: '12:30 PM EST',
      paragraphs: [midP1, midP2],
      takeaway:
        dir === 'higher' ? 'Trend intact — pullbacks to intraday support remain buyable.' :
        dir === 'lower' ? 'Rallies are for selling until internals repair.' :
        'Chop regime — trade smaller and demand A-grade setups only.',
      colorTheme: toneTheme(spy, 'indigo'),
    };
  }

  // ---- CLOSING ----
  let closing: SessionBlock | null = null;
  if (isWeekend || hour >= 15.5) {
    const closeP1 =
      dir === 'flat'
        ? `At the close the averages finished little changed — ${printLine} — a digestion day rather than a directional one.`
        : `At the close the averages finished ${dir} — ${printLine} — ${dir === 'higher' ? 'with buyers holding control into the bell' : 'with sellers pressing into the bell'}.`;
    const adRatio = breadth && breadth.decliners > 0 ? (breadth.advancers / breadth.decliners).toFixed(2) : null;
    const closeP2 = [
      bSent,
      adRatio ? `Final A/D ratio ${adRatio}.` : '',
      highCount > 0 ? `${highCount} high-impact catalysts drove the session's single-stock action.` : '',
    ].filter(Boolean).join(' ') || `Session closed at ${printLine}.`;
    closing = {
      phase: 'POWER HOUR & CLOSING PRINT',
      timestamp: '04:15 PM EST',
      paragraphs: [closeP1, closeP2],
      takeaway:
        dir === 'higher' ? 'Carry constructive bias into the next session; watch for follow-through on volume.' :
        dir === 'lower' ? 'Carry defensive bias forward — let the next open prove repair before re-engaging.' :
        'Neutral into the next session — fresh catalysts will set the tone.',
      colorTheme: toneTheme(spy, 'emerald'),
    };
  }

  return { morning, midday, closing };
}

// ---------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get('date');
  const forceRefresh = searchParams.get('refresh') === 'true';

  const estStr = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  const est = new Date(estStr);
  const currentHourDecimal = est.getHours() + est.getMinutes() / 60;
  const isWeekend = est.getDay() === 0 || est.getDay() === 6;

  let effectiveDate = new Date(est);
  if (est.getDay() === 6) effectiveDate.setDate(est.getDate() - 1);
  if (est.getDay() === 0) effectiveDate.setDate(est.getDate() - 2);

  let targetDate = dateParam;
  if (!targetDate) {
    targetDate = `${effectiveDate.getFullYear()}-${String(effectiveDate.getMonth() + 1).padStart(2, '0')}-${String(effectiveDate.getDate()).padStart(2, '0')}`;
  }

  try {
    if (forceRefresh) {
      await kv.del(`market_narrative_${targetDate}`);
    } else {
      const cachedSummary = await kv.get(`market_narrative_${targetDate}`);
      if (cachedSummary) return NextResponse.json(cachedSummary);
    }

    const polygonKey = process.env.NEXT_PUBLIC_POLYGON_API_KEY || process.env.POLYGON_API_KEY;
    if (!polygonKey) throw new Error('Missing Polygon API Key');

    const dateOffset = (base: string, days: number): string => {
      const d = new Date(`${base}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };

    // Grouped daily bars for a date: every ticker's close in one call.
    const getGroupedCloses = async (date: string): Promise<Map<string, { c: number; v: number }> | null> => {
      try {
        const url = `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true&apiKey=${polygonKey}`;
        const res = await fetch(url, { cache: 'no-store' });
        const data = await res.json();
        if (!data?.results || data.results.length === 0) return null;
        const map = new Map<string, { c: number; v: number }>();
        for (const r of data.results) {
          if (r?.T && r?.c) map.set(r.T, { c: r.c, v: r.v || 0 });
        }
        return map;
      } catch {
        return null;
      }
    };

    // 1. Tape quotes — live snapshot on weekdays; frozen data detection
    const quotes: Record<string, TapeQuote> = {};
    let snapshotUsable = false;
    if (!isWeekend) {
      try {
        const snapshotUrl = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${TAPE_TICKERS.join(',')}&apiKey=${polygonKey}`;
        const snapRes = await fetch(snapshotUrl, { cache: 'no-store' });
        const snapData = await snapRes.json();
        for (const t of snapData?.tickers || []) {
          const price = t.lastTrade?.p || t.min?.c || t.day?.c || t.prevDay?.c || null;
          let pct = typeof t.todaysChangePerc === 'number' ? t.todaysChangePerc : 0;
          if ((!pct || pct === 0) && price && t.prevDay?.c) {
            pct = ((price - t.prevDay.c) / t.prevDay.c) * 100;
          }
          quotes[t.ticker] = { ticker: t.ticker, pct: Number.isFinite(pct) ? pct : 0, price };
        }
        // Snapshot counts as usable only if at least one print is nonzero —
        // a fully-zeroed snapshot means Polygon has reset it (holiday, outage).
        snapshotUsable = Object.values(quotes).some(q => q.pct !== 0);
      } catch (e) {
        console.error('Tape snapshot failed:', e);
      }
    }

    // 2. Breadth — live full snapshot on weekdays
    let breadth: Breadth | null = null;
    if (!isWeekend && snapshotUsable) {
      try {
        const fullUrl = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?apiKey=${polygonKey}`;
        const fullRes = await fetch(fullUrl, { cache: 'no-store' });
        const fullData = await fullRes.json();
        const tickers = fullData?.tickers || [];
        if (tickers.length > 0) {
          let advancers = 0, decliners = 0, up4 = 0, down4 = 0;
          for (const t of tickers) {
            const sym: string = t.ticker ?? '';
            if (!/^[A-Z]{1,5}$/.test(sym)) continue;
            const prev = t.prevDay;
            if (!prev || !prev.c || !prev.v) continue;
            if (prev.c < 5 || prev.c * prev.v < 5_000_000) continue;
            const chg = typeof t.todaysChangePerc === 'number' ? t.todaysChangePerc : 0;
            if (chg > 0) advancers++;
            else if (chg < 0) decliners++;
            if (chg >= 4) up4++;
            else if (chg <= -4) down4++;
          }
          if (advancers + decliners > 100) breadth = { advancers, decliners, up4, down4 };
        }
      } catch (e) {
        console.error('Breadth snapshot failed:', e);
      }
    }

    // 3. WEEKEND / DEAD-SNAPSHOT FALLBACK — rebuild tape + breadth from the
    // grouped daily bars of targetDate vs the prior trading day (2 calls).
    // This is how the weekend view shows Friday's real closing numbers instead
    // of the zeroed snapshot.
    if (isWeekend || !snapshotUsable || !breadth) {
      const dayBars = await getGroupedCloses(targetDate);
      if (dayBars) {
        // Walk back to the previous trading day with data (skips holidays).
        let prevBars: Map<string, { c: number; v: number }> | null = null;
        for (let back = 1; back <= 5 && !prevBars; back++) {
          prevBars = await getGroupedCloses(dateOffset(targetDate, -back));
        }
        if (prevBars) {
          // Tape tickers from real closes
          for (const sym of TAPE_TICKERS) {
            const now = dayBars.get(sym);
            const prev = prevBars.get(sym);
            if (now && prev && prev.c > 0) {
              quotes[sym] = { ticker: sym, pct: ((now.c - prev.c) / prev.c) * 100, price: now.c };
            }
          }
          // Breadth from real closes
          let advancers = 0, decliners = 0, up4 = 0, down4 = 0;
          for (const [sym, now] of Array.from(dayBars.entries())) {
            if (!/^[A-Z]{1,5}$/.test(sym)) continue;
            const prev = prevBars.get(sym);
            if (!prev || prev.c <= 0) continue;
            if (prev.c < 5 || prev.c * prev.v < 5_000_000) continue;
            const chg = ((now.c - prev.c) / prev.c) * 100;
            if (chg > 0) advancers++;
            else if (chg < 0) decliners++;
            if (chg >= 4) up4++;
            else if (chg <= -4) down4++;
          }
          if (advancers + decliners > 100) breadth = { advancers, decliners, up4, down4 };
        }
      }
    }

    // 4. News for actionable catalysts
    const newsUrl = `https://api.polygon.io/v2/reference/news?published_utc.gte=${targetDate}T00:00:00Z&published_utc.lte=${targetDate}T23:59:59Z&limit=100&sort=published_utc&order=desc&apiKey=${polygonKey}`;
    const response = await fetch(newsUrl, { cache: 'no-store' });
    const data = await response.json();

    const trashPublishers = ['the motley fool', 'zacks investment research', 'globe newswire', 'pr newswire', 'business wire'];
    const premiumNews = (data?.results || []).filter((a: any) => !trashPublishers.includes((a.publisher?.name || '').toLowerCase()));

    const actionableEvents = buildActionableEvents(premiumNews);

    // If we have neither tape nor news, there's genuinely nothing to report.
    if (Object.keys(quotes).length === 0 && actionableEvents.length === 0) {
      return NextResponse.json({ status: 404, message: "No market data recorded yet." }, { status: 404 });
    }

    // 5. Deterministic session blocks from the assembled data
    const { morning, midday, closing } = buildBlocks(quotes, breadth, actionableEvents, currentHourDecimal, isWeekend);

    const generatedSummary = { actionableEvents, morning, midday, closing };

    const isMarketActive = getIsMarketActive();
    const MARKET_CACHE_SEC = 900;    // 15 min during market hours
    const CLOSED_CACHE_SEC = 43200;  // 12 hours when closed
    const cacheExpiration = isMarketActive ? MARKET_CACHE_SEC : CLOSED_CACHE_SEC;

    await kv.set(`market_narrative_${targetDate}`, generatedSummary, { ex: cacheExpiration });
    try { await kv.set(`market_narrative_lastgood_${targetDate}`, generatedSummary, { ex: 86400 }); } catch {}

    return NextResponse.json(generatedSummary);

  } catch (error: any) {
    // FAILURE THROTTLE — unchanged pattern: serve last good, cool down 10 min.
    console.error('MARKET_SUMMARY_ERROR:', error);
    let payload: any = { actionableEvents: [], morning: null, midday: null, closing: null };
    try {
      const lastGood = await kv.get(`market_narrative_lastgood_${targetDate}`);
      if (lastGood) payload = lastGood;
    } catch {}
    try {
      await kv.set(`market_narrative_${targetDate}`, payload, { ex: 600 });
    } catch {}
    return NextResponse.json(payload);
  }
}
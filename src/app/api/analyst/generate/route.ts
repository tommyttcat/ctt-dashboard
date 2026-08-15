import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CACHE_KEY = 'analyst_brief_v1';

function resolveOrigin(req: Request): string {
  try {
    const u = new URL(req.url);
    if (u.origin && u.origin !== 'null') return u.origin;
  } catch { /* fall through */ }
  const h = req.headers;
  const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000';
  const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

async function fetchJson(url: string) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

function isWithinETWindow(): boolean {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const hour = now.getHours();
  return hour >= 4 && hour < 20;
}

const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

function extractStocks(snapshot: any): any[] {
  const data = snapshot?.data || {};
  const sip = data.stocksInPlay || {};
  const movers = sip.topMovers || {};
  const seen = new Set<string>();
  const all: any[] = [];

  const addStocks = (list: any[], source?: string) => {
    for (const s of list) {
      if (!s?.ticker) continue;
      if (seen.has(s.ticker)) {
        const existing = all.find(x => x.ticker === s.ticker);
        if (existing && source) existing.sources.push(source);
        continue;
      }
      seen.add(s.ticker);
      all.push({
        ticker: s.ticker,
        price: s.price || s.last || 0,
        changePct: s.changePct ?? s.change ?? 0,
        rvol: s.rvol != null ? Number(s.rvol) : null,
        vol: s.vol ?? s.volume ?? null,
        dvol: s.dVol ?? (s.price && s.vol ? s.price * s.vol : null),
        adrPct: s.adrPct ?? null,
        stage: s.stage || null,
        setup: s.setupName || s.setup || null,
        score: s.cnfScore ?? null,
        grade: s.cnfGrade ?? null,
        rs: s.rsRating ?? s.rs ?? null,
        catalyst: s.catalyst || null,
        dotKind: s.dotKind || null,
        sentiment: null,
        sources: source ? [source] : [],
      });
    }
  };

  addStocks(sip.stocksInPlay || sip.sips || [], 'sip');
  addStocks(sip.dailySetups || [], 'setup');
  addStocks(movers['Gainers'] || movers.gainers || [], 'gainer');
  addStocks(movers['Losers'] || movers.losers || [], 'loser');
  addStocks(movers['Mega Caps'] || [], 'mega');
  addStocks(data.ep9m?.candidates || [], 'ep9m');
  addStocks(data.vcp?.candidates || [], 'vcp');
  addStocks(data.swingCandidates?.candidates || [], 'swing');
  addStocks(data.consolidation1021?.candidates || [], 'consol');
  addStocks(data.multibagger?.candidates || [], 'multi');

  return all;
}

function computeRegime(snapshot: any, chop: any): { regime: string; caution: string; posture: string } {
  const data = snapshot?.data || {};
  const macro = data.macro || {};
  const breadth = macro.breadth || {};
  const quotes = macro.quotes || {};
  const t2108 = data.t2108;
  const sip = data.stocksInPlay || {};
  const bench = sip.benchmark;

  const spyQ = quotes.SPY || quotes.spy || {};
  const qqqQ = quotes.QQQ || quotes.qqq || {};
  const breadthScore = breadth.score ?? null;
  const breadthSignal = breadth.signal || '';
  const advancers = breadth.advancers ?? 0;
  const decliners = breadth.decliners ?? 0;
  const adRatio = decliners > 0 ? advancers / decliners : advancers > 0 ? 99 : 1;
  const t2108Val = t2108?.value ?? null;
  const t2108Zone = t2108?.zone || '';
  const chopVal = chop?.daily?.blended ?? chop?.blended ?? null;
  const newHighs = breadth.newHighs ?? 0;
  const newLows = breadth.newLows ?? 0;

  let bullPoints = 0;
  let bearPoints = 0;

  if (breadthScore != null) {
    if (breadthScore >= 5) bullPoints += 2;
    else if (breadthScore >= 4) bullPoints += 1;
    else if (breadthScore <= 1) bearPoints += 2;
    else if (breadthScore <= 2) bearPoints += 1;
  }
  if (adRatio > 2) bullPoints += 1;
  else if (adRatio < 0.5) bearPoints += 1;
  if (t2108Val != null) {
    if (t2108Val > 70) bullPoints += 1;
    else if (t2108Val < 25) bearPoints += 2;
    else if (t2108Val < 40) bearPoints += 1;
  }
  if (chopVal != null) {
    if (chopVal < 40) bullPoints += 1;
    else if (chopVal > 60) bearPoints += 1;
  }
  if (newHighs > newLows * 3) bullPoints += 1;
  else if (newLows > newHighs * 3) bearPoints += 1;

  const spyPct = spyQ.pct || 0;
  const qqqPct = qqqQ.pct || 0;
  if (spyPct > 0.5 && qqqPct > 0.5) bullPoints += 1;
  else if (spyPct < -0.5 && qqqPct < -0.5) bearPoints += 1;

  let emaAbove = 0;
  let emaTotal = 0;
  if (bench?.day) {
    for (const e of bench.day) { emaTotal++; if (e.above) emaAbove++; }
  }
  if (emaTotal > 0 && emaAbove === emaTotal) bullPoints += 1;
  else if (emaTotal > 0 && emaAbove === 0) bearPoints += 1;

  const net = bullPoints - bearPoints;
  let regimeLabel: string;
  let postureText: string;

  if (net >= 4) {
    regimeLabel = 'Strong uptrend';
    postureText = 'Aggressive — full exposure, lean into breakouts and episodic pivots. Add on strength.';
  } else if (net >= 2) {
    regimeLabel = 'Bullish';
    postureText = 'Selective offense — favor high-CNF setups with volume confirmation. Normal position sizing.';
  } else if (net >= 0) {
    regimeLabel = 'Transitional / Choppy';
    postureText = 'Reduce size, tighten stops, favor mean-reversion over breakouts. Wait for clarity.';
  } else if (net >= -2) {
    regimeLabel = 'Bearish';
    postureText = 'Defensive — small positions only on A+ setups. Raise cash, respect stops strictly.';
  } else {
    regimeLabel = 'Strong downtrend';
    postureText = 'Cash-heavy — avoid longs except quick scalps. Focus on capital preservation.';
  }

  const regimeParts = [`**${regimeLabel}** regime.`];
  if (spyQ.last) regimeParts.push(`SPY **${fmtPct(spyPct)}** at $${spyQ.last.toFixed(2)}.`);
  if (qqqQ.last) regimeParts.push(`QQQ **${fmtPct(qqqPct)}** at $${qqqQ.last.toFixed(2)}.`);
  if (breadthScore != null) regimeParts.push(`Breadth score ${breadthScore}/6 (${breadthSignal}).`);
  if (t2108Val != null) regimeParts.push(`T2108 at ${t2108Val.toFixed(1)}% (${t2108Zone}).`);

  const cautionParts: string[] = [];
  /* These test the producer's own vocabulary — computeT2108 emits
     'washed out | deeply oversold | oversold | neutral | extended | frothy'.
     The froth branch previously looked for 'overbought', a string nothing
     ever produces, so the top-of-range warning could never fire. */
  if (t2108Zone === 'frothy') cautionParts.push(`T2108 frothy at ${t2108Val?.toFixed(1)}% — elevated reversal risk.`);
  else if (t2108Zone === 'extended') cautionParts.push(`T2108 extended at ${t2108Val?.toFixed(1)}% — broad but late, breakouts fail more often from here.`);
  if (t2108Zone === 'washed out' || t2108Zone === 'deeply oversold') cautionParts.push(`T2108 deeply oversold at ${t2108Val?.toFixed(1)}% — bounce likely but don't catch knives.`);
  else if (t2108Zone === 'oversold') cautionParts.push(`T2108 oversold at ${t2108Val?.toFixed(1)}% — favour pullback entries over chasing strength.`);
  if (chopVal != null && chopVal > 55) cautionParts.push(`Chop index elevated at ${chopVal.toFixed(1)} — range-bound action expected.`);
  if (adRatio < 0.7 && advancers > 0) cautionParts.push(`Weak breadth: ${advancers} advancers vs ${decliners} decliners.`);
  if (newLows > newHighs * 2) cautionParts.push(`New lows (${newLows}) dominating new highs (${newHighs}).`);
  if (spyPct < -1) cautionParts.push(`SPY selling at ${fmtPct(spyPct)}.`);
  if (cautionParts.length === 0) cautionParts.push('No major caution flags. Standard risk management applies.');

  return { regime: regimeParts.join(' '), caution: cautionParts.join(' '), posture: postureText };
}

function buildMacroSection(snapshot: any, chop: any): { section: string; analysis: string } {
  const data = snapshot?.data || {};
  const macro = data.macro || {};
  const quotes = macro.quotes || {};
  const lines: string[] = [];

  const INDEX_SYMS = ['SPY', 'QQQ', 'DIA', 'IWM'];
  const BOND_SYMS = ['TLT', 'TLH', 'IEF', 'SHY', 'BND', 'AGG'];
  const VOL_SYMS = ['VIX', 'UVXY', 'SVXY'];
  const COMMODITY_SYMS = ['GLD', 'SLV', 'USO', 'GC', 'SI', 'CL', 'WTIC'];

  const indexParts: string[] = [];
  const bondParts: string[] = [];
  const volParts: string[] = [];
  const commodityParts: string[] = [];

  for (const [sym, q] of Object.entries(quotes) as any[]) {
    const price = q.last ?? q.price;
    if (!price) continue;
    const entry = `${sym} $${price.toFixed(2)} ${fmtPct(q.pct || 0)}`;
    const upper = sym.toUpperCase();
    if (INDEX_SYMS.includes(upper)) indexParts.push(entry);
    else if (BOND_SYMS.includes(upper)) bondParts.push(entry);
    else if (VOL_SYMS.includes(upper)) volParts.push(entry);
    else if (COMMODITY_SYMS.includes(upper)) commodityParts.push(entry);
    else indexParts.push(entry);
  }

  if (indexParts.length) lines.push(`**Indices**: ${indexParts.join(', ')}`);
  if (bondParts.length) lines.push(`**Bonds**: ${bondParts.join(', ')}`);
  if (volParts.length) lines.push(`**Volatility**: ${volParts.join(', ')}`);
  if (commodityParts.length) lines.push(`**Commodities**: ${commodityParts.join(', ')}`);


  return { section: 'Futures & Macro Snapshot', analysis: lines.join('\n') };
}

function buildBreadthSection(snapshot: any): { section: string; analysis: string } {
  const data = snapshot?.data || {};
  const breadth = data.macro?.breadth || {};
  const t2108 = data.t2108;
  const lines: string[] = [];

  if (breadth.advancers != null) {
    lines.push(`**Advancers/Decliners**: ${breadth.advancers} advancing vs ${breadth.decliners} declining`);
    lines.push(`**Breadth Score**: ${breadth.score}/6 ${breadth.signal}`);
  }
  if (breadth.up4 != null) lines.push(`**Extreme Moves**: ${breadth.up4} stocks up >4% vs ${breadth.down4} down >4%`);
  if (breadth.newHighs != null) lines.push(`**New Highs/Lows**: ${breadth.newHighs} new highs vs ${breadth.newLows} new lows`);
  if (t2108?.value != null) lines.push(`**T2108**: ${t2108.value.toFixed(1)}% — ${t2108.zone || 'neutral'}`);
  return { section: 'Sentiment & Market Breadth', analysis: lines.join('\n') };
}

function buildSectorSection(snapshot: any): { section: string; analysis: string } {
  const sectors = snapshot?.data?.sectors?.sectors || [];
  if (!sectors.length) return { section: 'Top Sectors & Money Flow', analysis: 'Sector data unavailable.' };

  const sorted = [...sectors].sort((a: any, b: any) => (b.changesPercentage || 0) - (a.changesPercentage || 0));
  const leading = sorted.slice(0, 3).map((s: any) => `${s.sector || s.name} ${fmtPct(s.changesPercentage || 0)}`);
  const lagging = sorted.slice(-3).reverse().map((s: any) => `${s.sector || s.name} ${fmtPct(s.changesPercentage || 0)}`);
  return { section: 'Top Sectors & Money Flow', analysis: `**Leading:** ${leading.join(', ')}. **Lagging:** ${lagging.join(', ')}.` };
}

function buildNewsSection(news: any[]): { section: string; analysis: string } {
  if (!Array.isArray(news) || !news.length) return { section: 'Key News & Catalysts', analysis: 'No significant news.' };
  const items = news.slice(0, 8).map((n: any) => {
    const tickers = (n.tickers || []).slice(0, 3).join(', ');
    const tag = n.aiTag && n.aiTag !== 'TECH MOMENTUM' ? `[${n.aiTag}] ` : '';
    /* cleanHeadline first: it's the length-capped form, and Benzinga's WIIM
       copy is long enough to swallow a slot if the raw title wins here. */
    return `${tickers ? `**${tickers}** ` : ''}${tag}${n.cleanHeadline || n.title || ''}`;
  });
  return { section: 'Key News & Catalysts', analysis: items.join('\n\n') };
}

function buildEconSection(econ: any[]): { section: string; analysis: string } | null {
  if (!Array.isArray(econ)) return null;
  const high = econ.filter((e: any) => e.impact !== 'Low').slice(0, 6);
  if (!high.length) return null;
  const items = high.map((e: any) => {
    const vals: string[] = [];
    if (e.actual != null) vals.push(`actual ${e.actual}`);
    if (e.estimate != null) vals.push(`est ${e.estimate}`);
    if (e.previous != null) vals.push(`prev ${e.previous}`);
    return `**${e.event}**: ${vals.join(', ')}`;
  });
  return { section: 'Economic Calendar', analysis: items.join('\n') };
}

function buildEarningsSection(earnings: any): { section: string; analysis: string } | null {
  const list = Array.isArray(earnings) ? earnings : earnings?.events || [];
  const big = list.filter((e: any) => (e.mktCap || 0) > 10e9).slice(0, 8);
  if (!big.length) return null;
  const items = big.map((e: any) => {
    const name = e.name ? ` (${e.name})` : '';
    const vals: string[] = [];
    if (e.epsActual != null) vals.push(`EPS $${e.epsActual} vs $${e.epsEstimated?.toFixed(2) || '?'} est`);
    if (e.epsSurprisePct != null) vals.push(`surprise ${fmtPct(e.epsSurprisePct)}`);
    return `**${e.symbol || e.ticker}**${name}: ${vals.join(', ') || 'pending'}`;
  });
  return { section: 'Earnings', analysis: items.join('\n') };
}

function scoreStock(s: any): number {
  let sc = 0;
  if (s.score != null) sc += s.score;
  if (s.rvol != null && s.rvol > 1.5) sc += 15;
  if (s.rvol != null && s.rvol > 3) sc += 10;
  if (s.stage === '2' || s.stage === 2) sc += 10;
  if (s.rs != null && s.rs >= 80) sc += 10;
  if (s.rs != null && s.rs >= 90) sc += 5;
  if (s.catalyst) sc += 10;
  if (s.setup) sc += 5;
  if (s.sources?.includes('ep9m')) sc += 15;
  if (s.sources?.includes('vcp')) sc += 10;
  if (s.sources?.length > 1) sc += 5 * (s.sources.length - 1);
  return sc;
}

function isAvoidStock(s: any): boolean {
  if (s.stage === '4' || s.stage === 4) return true;
  if (s.changePct < -5 && (!s.rvol || s.rvol < 1)) return true;
  if (s.sources?.includes('loser') && s.changePct < -3) return true;
  return false;
}

function buildNewsTickerMap(news: any): Map<string, { tag: string; headline: string; url: string }> {
  const map = new Map<string, { tag: string; headline: string; url: string }>();
  const items: any[] = Array.isArray(news) ? news : (news?.results ?? []);
  for (const n of items) {
    const tickers: string[] = n.tickers || [];
    const tag = n.aiTag && n.aiTag !== 'TECH MOMENTUM' ? n.aiTag : '';
    if (!tag) continue;
    for (const t of tickers) {
      if (!map.has(t)) {
        map.set(t, { tag, headline: n.cleanHeadline || n.title || '', url: n.url || '' });
      }
    }
  }
  return map;
}

function injectWiim(stocks: any[], newsMap: Map<string, { tag: string; headline: string; url: string }>): void {
  for (const s of stocks) {
    if (s.catalyst && s.catalyst !== 'Technical Momentum') continue;
    const wiim = newsMap.get(s.ticker);
    if (!wiim) continue;
    s.catalyst = `${wiim.tag} (WIIM)`;
    s.thesis = wiim.headline;
    s.catalystUrl = wiim.url || null;
  }
}

function buildBrief(snapshot: any, chop: any, news: any, earnings: any, econ: any, allStocks: any[]): any {
  const snapshotTime = snapshot?.meta?.generatedAt || null;
  const etNowStr = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  const hour = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).getHours();

  const regimeDetail = computeRegime(snapshot, chop);

  const newsMap = buildNewsTickerMap(news);
  injectWiim(allStocks, newsMap);

  const gapperPool = allStocks.filter(s => Math.abs(s.changePct) > 2);
  const gapperUps = gapperPool
    .filter(s => s.changePct > 0)
    .sort((a, b) => b.changePct - a.changePct)
    .slice(0, 5)
    .map(s => ({ ...s, direction: 'up', gapPct: s.changePct }));
  const gapperDowns = gapperPool
    .filter(s => s.changePct < 0)
    .sort((a, b) => a.changePct - b.changePct)
    .slice(0, 5)
    .map(s => ({ ...s, direction: 'down', gapPct: s.changePct }));
  const gapperStocks = [...gapperUps, ...gapperDowns];
  const gapperLabel = hour < 10 ? 'Pre-Market Gappers' : hour < 16 ? 'Intraday Movers' : 'Post-Market Gappers';

  const sipStocks = allStocks
    .filter(s => (s.score ?? 0) >= 40 || (s.rvol ?? 0) >= 1.5)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 20);

  const scored = allStocks.map(s => ({ ...s, _rank: scoreStock(s) }));
  const topStocks = scored
    .filter(s => !isAvoidStock(s) && s._rank > 0)
    .sort((a, b) => b._rank - a._rank)
    .slice(0, 7)
    .map(s => ({ ...s, sentiment: 'bullish' as const }));

  const avoidStocks = scored
    .filter(s => isAvoidStock(s))
    .sort((a, b) => a.changePct - b.changePct)
    .slice(0, 4)
    .map(s => ({ ...s, sentiment: 'bearish' as const }));

  const convictions: string[] = [];
  if (topStocks[0]) {
    convictions.push(`**${topStocks[0].ticker}** top-ranked — ${topStocks[0].setup || 'strong confluence'}${topStocks[0].rvol ? `, RVOL ${topStocks[0].rvol.toFixed(1)}` : ''}.`);
  }
  if (topStocks[1]) {
    convictions.push(`**${topStocks[1].ticker}** showing strength${topStocks[1].catalyst ? ` — ${topStocks[1].catalyst}` : ''}.`);
  }

  const watchlist = topStocks.slice(2, 5).map(s =>
    `**${s.ticker}** — ${s.setup || 'potential breakout'}${s.rs ? `, RS ${s.rs}` : ''}`
  );
  const traps = avoidStocks.slice(0, 3).map(s =>
    `**${s.ticker}** ${fmtPct(s.changePct)}${s.stage ? ` Stage ${s.stage}` : ''} — avoid`
  );

  const sections: any[] = [
    buildMacroSection(snapshot, chop),
    buildBreadthSection(snapshot),
    /* /api/news answers with { results: [...] }, never a bare array — reading
       it as one is why this section read "No significant news" every run. */
    buildNewsSection(Array.isArray(news) ? news : (news?.results ?? [])),
    buildSectorSection(snapshot),
  ];

  const econSection = buildEconSection(econ);
  if (econSection) sections.push(econSection);
  const earningsSection = buildEarningsSection(earnings);
  if (earningsSection) sections.push(earningsSection);

  sections.push(
    { section: gapperLabel, analysis: '', stocks: gapperStocks },
    { section: 'Stocks in Play Today', analysis: '', stocks: sipStocks },
    { section: 'Top Trades', analysis: '', stocks: topStocks },
    { section: 'Top Avoid', analysis: '', stocks: avoidStocks },
  );

  return {
    generatedAt: new Date().toISOString(),
    generatedAtET: etNowStr,
    generatedBy: 'deterministic',
    snapshotTime,
    sections,
    regimeDetail,
    summary: { conviction: convictions, watchlist, traps },
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const force = url.searchParams.get('force') === '1';

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && !force) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!force && !isWithinETWindow()) {
    return NextResponse.json({ skipped: true, reason: 'Outside 4 AM – 8 PM ET window' });
  }

  if (!force) {
    const existing = await kv.get<any>(CACHE_KEY);
    if (existing?.generatedBy === 'ai-analyst') {
      const genDate = new Date(existing.generatedAt);
      const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const genET = new Date(genDate.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const sameDay = nowET.getFullYear() === genET.getFullYear()
        && nowET.getMonth() === genET.getMonth()
        && nowET.getDate() === genET.getDate();
      if (sameDay) {
        return NextResponse.json({ skipped: true, reason: 'AI-generated brief exists for today — deterministic fallback will not overwrite' });
      }
    }
  }

  const origin = resolveOrigin(req);

  const [snapshot, chop, news, earnings, econ] = await Promise.all([
    /* full=1 matters as much as extras=1 here: without it every scan list is
       cut to 25 rows, so the regime counts and the "top" picks below were
       derived from a truncated board. */
    fetchJson(`${origin}/api/claude/snapshot?extras=1&full=1`),
    fetchJson(`${origin}/api/chop`),
    fetchJson(`${origin}/api/news`),
    fetchJson(`${origin}/api/earnings`),
    fetchJson(`${origin}/api/econ`),
  ]);

  if (!snapshot) {
    return NextResponse.json({ error: 'Failed to fetch snapshot' }, { status: 500 });
  }

  const allStocks = extractStocks(snapshot);

  try {
    const brief = buildBrief(snapshot, chop, news, earnings, econ, allStocks);
    await kv.set(CACHE_KEY, brief);

    return NextResponse.json({
      success: true,
      generatedAt: brief.generatedAtET,
      sectionsCount: brief.sections.length,
      stockCount: allStocks.length,
    });
  } catch (err: any) {
    console.error('[analyst/generate] Error:', err);
    return NextResponse.json({ error: err.message || 'Generation failed' }, { status: 500 });
  }
}

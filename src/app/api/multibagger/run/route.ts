// app/api/multibagger/run/route.ts — v1.0
//
// 100-BAGGER SCORECARD — fundamental scan for potential compounders.
//
// Unlike every other scan on this dashboard, this one looks at FINANCIALS,
// not price action. Revenue growth, return on capital, debt levels,
// valuation, and cash generation — the traits Peter Lynch, Chris Mayer,
// and every study of 100-baggers found in common.
//
// DATA SOURCE: Polygon /vX/reference/financials (SEC filings, standardised).
// Polygon /v3/reference/tickers/{ticker} for market cap and company details.
// Polygon /v2/snapshot for the current price universe.
//
// RUNS DAILY. Fundamentals change quarterly, not by the minute. The scan is
// expensive (hundreds of API calls for financials), so it caches aggressively
// and skips re-runs within 12 hours unless forced.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { runInBackground, isDetachedRun, BG_HEADERS } from '@/lib/background';
import { MULTIBAGGER, MULTIBAGGER_META } from '@/lib/scanConfig';
import { cleanSectorDescription } from '@/lib/sectors';
import { computeStageDetail, stageShort } from '@/lib/indicators/stage';
import { loadRsRatings } from '@/lib/indicators/rs';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 300;

const NO_STORE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fetchJson = async (url: string, fallback: any, timeoutMs = 20000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal as any });
    clearTimeout(id);
    if (!res.ok) return fallback;
    return await res.json();
  } catch {
    clearTimeout(id);
    return fallback;
  }
};

const fv = (obj: any, field: string): number | null => {
  const v = obj?.[field]?.value;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

const mcapTier = (mcap: number): string => {
  if (mcap <= 300_000_000) return 'Micro';
  if (mcap <= 2_000_000_000) return 'Small';
  if (mcap <= 10_000_000_000) return 'Mid';
  return 'Large';
};

const fmtMcap = (n: number): string => {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toLocaleString()}`;
};

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

interface ScoreBreakdown {
  revenueGrowth: number;
  returnOnCapital: number;
  lowDebt: number;
  marketCap: number;
  valuation: number;
  cashGeneration: number;
}

interface MultibaggerScore {
  score: number;
  grade: string;
  breakdown: ScoreBreakdown;
  attrs: {
    revGrowthPct: number | null;
    revGrowthYears: number;
    roic: number | null;
    debtToEquity: number | null;
    mcap: number;
    mcapTier: string;
    pe: number | null;
    fcfYield: number | null;
  };
}

function scoreMultibagger(
  revGrowths: number[],
  roic: number | null,
  debtToEquity: number | null,
  marketCapVal: number,
  pe: number | null,
  fcfYield: number | null,
): MultibaggerScore {
  const b: ScoreBreakdown = {
    revenueGrowth: 0,
    returnOnCapital: 0,
    lowDebt: 0,
    marketCap: 0,
    valuation: 0,
    cashGeneration: 0,
  };

  // Revenue Growth (25 pts) — 3yr CAGR
  let revCagr: number | null = null;
  const validGrowths = revGrowths.filter(g => Number.isFinite(g));
  if (validGrowths.length >= 2) {
    revCagr = validGrowths.reduce((s, v) => s + v, 0) / validGrowths.length;
  } else if (validGrowths.length === 1) {
    revCagr = validGrowths[0];
  }

  if (revCagr != null) {
    if (revCagr >= 30) b.revenueGrowth = 25;
    else if (revCagr >= 25) b.revenueGrowth = 22;
    else if (revCagr >= 20) b.revenueGrowth = 19;
    else if (revCagr >= 15) b.revenueGrowth = 15;
    else if (revCagr >= 10) b.revenueGrowth = 10;
    else if (revCagr >= 5) b.revenueGrowth = 5;
  }

  // Return on Capital (20 pts) — ROIC
  if (roic != null) {
    if (roic >= 25) b.returnOnCapital = 20;
    else if (roic >= 20) b.returnOnCapital = 17;
    else if (roic >= 15) b.returnOnCapital = 14;
    else if (roic >= 10) b.returnOnCapital = 10;
    else if (roic >= 5) b.returnOnCapital = 5;
  }

  // Low Debt (15 pts) — Debt/Equity
  if (debtToEquity != null && debtToEquity >= 0) {
    if (debtToEquity <= 0.1) b.lowDebt = 15;
    else if (debtToEquity <= 0.3) b.lowDebt = 12;
    else if (debtToEquity <= 0.5) b.lowDebt = 10;
    else if (debtToEquity <= 1.0) b.lowDebt = 6;
    else if (debtToEquity <= 2.0) b.lowDebt = 2;
  }

  // Market Cap (20 pts) — smaller = more room to multiply
  const tier = mcapTier(marketCapVal);
  if (tier === 'Micro') b.marketCap = 20;
  else if (tier === 'Small') b.marketCap = 15;
  else if (tier === 'Mid') b.marketCap = 8;
  else b.marketCap = 3;

  // Valuation P/E (10 pts)
  if (pe != null && pe > 0) {
    if (pe <= 12) b.valuation = 10;
    else if (pe <= 18) b.valuation = 8;
    else if (pe <= 25) b.valuation = 6;
    else if (pe <= 35) b.valuation = 3;
    else if (pe <= 50) b.valuation = 1;
  }

  // Cash Generation (10 pts) — FCF Yield
  if (fcfYield != null) {
    if (fcfYield >= 10) b.cashGeneration = 10;
    else if (fcfYield >= 7) b.cashGeneration = 8;
    else if (fcfYield >= 5) b.cashGeneration = 7;
    else if (fcfYield >= 3) b.cashGeneration = 5;
    else if (fcfYield >= 1) b.cashGeneration = 3;
    else if (fcfYield >= 0) b.cashGeneration = 1;
  }

  const score = Object.values(b).reduce((s, v) => s + v, 0);
  const grade = score >= 70 ? 'A' : score >= 50 ? 'B' : score >= 35 ? 'C' : 'D';

  return {
    score,
    grade,
    breakdown: b,
    attrs: {
      revGrowthPct: revCagr,
      revGrowthYears: validGrowths.length,
      roic,
      debtToEquity,
      mcap: marketCapVal,
      mcapTier: tier,
      pe,
      fcfYield,
    },
  };
}

// ---------------------------------------------------------------------------
// Financial data extraction from Polygon vX financials
// ---------------------------------------------------------------------------

interface ParsedFinancials {
  revGrowths: number[];
  roic: number | null;
  debtToEquity: number | null;
  pe: number | null;
  fcfYield: number | null;
  latestRevenue: number | null;
  latestNetIncome: number | null;
}

function parseFinancials(filings: any[], marketCap: number, price: number): ParsedFinancials {
  const result: ParsedFinancials = {
    revGrowths: [],
    roic: null,
    debtToEquity: null,
    pe: null,
    fcfYield: null,
    latestRevenue: null,
    latestNetIncome: null,
  };

  if (!filings || filings.length === 0) return result;

  // Sort by fiscal_year descending to ensure most recent first
  const sorted = [...filings].sort((a, b) => {
    const ya = parseInt(a.fiscal_year) || 0;
    const yb = parseInt(b.fiscal_year) || 0;
    return yb - ya;
  });

  // Revenue growth — YoY for each consecutive pair
  const revenues: number[] = [];
  for (const f of sorted) {
    const is = f.financials?.income_statement;
    const rev = fv(is, 'revenues') ?? fv(is, 'revenue');
    if (rev != null && rev > 0) revenues.push(rev);
  }

  if (revenues.length >= 2) {
    for (let i = 0; i < revenues.length - 1; i++) {
      const growth = ((revenues[i] - revenues[i + 1]) / revenues[i + 1]) * 100;
      if (Number.isFinite(growth) && Math.abs(growth) < 500) {
        result.revGrowths.push(growth);
      }
    }
  }
  result.latestRevenue = revenues[0] ?? null;

  // Latest filing for balance sheet + income statement metrics
  const latest = sorted[0];
  const is = latest.financials?.income_statement;
  const bs = latest.financials?.balance_sheet;
  const cf = latest.financials?.cash_flow_statement;

  // Net income
  const netIncome = fv(is, 'net_income_loss');
  result.latestNetIncome = netIncome;

  // ROIC = NOPAT / Invested Capital
  const opIncome = fv(is, 'operating_income_loss');
  const taxExpense = fv(is, 'income_tax_expense_benefit');
  const preTaxIncome = fv(is, 'income_loss_from_continuing_operations_before_tax')
    ?? fv(is, 'income_loss_before_equity_method_investments');

  let taxRate = 0.25; // default
  if (preTaxIncome != null && preTaxIncome > 0 && taxExpense != null) {
    const effectiveRate = taxExpense / preTaxIncome;
    if (effectiveRate > 0 && effectiveRate < 1) taxRate = effectiveRate;
  }

  const equity = fv(bs, 'equity') ?? fv(bs, 'equity_attributable_to_parent') ?? fv(bs, 'stockholders_equity');
  const totalAssets = fv(bs, 'assets');
  const currentLiabilities = fv(bs, 'current_liabilities');
  const totalLiabilities = fv(bs, 'liabilities');
  const noncurrentLiabilities = fv(bs, 'noncurrent_liabilities');

  // Invested Capital = Total Assets - Current Liabilities
  if (opIncome != null && totalAssets != null && currentLiabilities != null) {
    const investedCapital = totalAssets - currentLiabilities;
    if (investedCapital > 0) {
      const nopat = opIncome * (1 - taxRate);
      result.roic = (nopat / investedCapital) * 100;
    }
  }

  // Debt/Equity
  if (equity != null && equity > 0) {
    const debt = noncurrentLiabilities ?? (totalLiabilities != null && currentLiabilities != null
      ? totalLiabilities - currentLiabilities : totalLiabilities);
    if (debt != null) {
      result.debtToEquity = debt / equity;
    }
  }

  // P/E from market cap and net income
  if (netIncome != null && netIncome > 0 && marketCap > 0) {
    result.pe = marketCap / netIncome;
  }

  // FCF Yield
  const opCashFlow = fv(cf, 'net_cash_flow_from_operating_activities')
    ?? fv(cf, 'net_cash_flow_from_operating_activities_continuing');
  if (opCashFlow != null && marketCap > 0) {
    // Try to find capex
    const capex = fv(cf, 'capital_expenditure')
      ?? fv(cf, 'payments_to_acquire_property_plant_and_equipment');
    const fcf = capex != null ? opCashFlow + capex : opCashFlow; // capex is negative
    result.fcfYield = (fcf / marketCap) * 100;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main scan
// ---------------------------------------------------------------------------

async function executeScan(polygonKey: string) {
  const t0 = Date.now();

  // 1. Get the full snapshot to identify the liquid universe
  const snapRes = await fetchJson(
    `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?apiKey=${polygonKey}`,
    { tickers: [] },
    30000,
  );
  const rawSnap = snapRes.tickers || [];
  if (rawSnap.length === 0) throw new Error('Empty snapshot');

  // 2. Filter to common stock candidates
  const candidates = rawSnap.filter((t: any) => {
    const ticker = t.ticker;
    if (!ticker || !/^[A-Z]{1,5}$/.test(ticker)) return false;
    const price = t.lastTrade?.p || t.day?.c || t.prevDay?.c || 0;
    if (price < MULTIBAGGER.minPrice || price > 500) return false;
    const vol = t.day?.v || t.prevDay?.v || 0;
    if (vol < MULTIBAGGER.minAvgVolume) return false;
    return true;
  });

  // Enrich with dollar volume, skip the very top (mega caps) to focus on mid/small
  const withDolVol = candidates.map((t: any) => {
    const price = t.lastTrade?.p || t.day?.c || t.prevDay?.c || 0;
    const vol = t.day?.v || t.prevDay?.v || 0;
    return { ...t, _price: price, _dolVol: price * vol };
  });
  withDolVol.sort((a: any, b: any) => b._dolVol - a._dolVol);

  // Skip the top 100 by dollar volume (almost always $10B+ mega caps) and take
  // the next N — these are the liquid mid/small caps the scan actually targets.
  const universe = withDolVol.slice(100, 100 + MULTIBAGGER.universeSize);
  console.log(`[multibagger] snapshot filtered: ${rawSnap.length} → ${candidates.length} → ${universe.length}`);

  // 3. Fetch ticker details to get market cap (parallel batches)
  const BATCH = 25;
  const tickerDetails = new Map<string, any>();
  for (let i = 0; i < universe.length; i += BATCH) {
    const batch = universe.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map((t: any) =>
        fetchJson(
          `https://api.polygon.io/v3/reference/tickers/${t.ticker}?apiKey=${polygonKey}`,
          null,
          10000,
        )
      )
    );
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === 'fulfilled' && r.value?.results) {
        tickerDetails.set(batch[j].ticker, r.value.results);
      }
    }
  }

  // 4. Filter by market cap — prefer shares × price (live), fall back to reference
  const mcapFiltered: Array<{ ticker: string; price: number; detail: any; mcap: number; changePct: number; vol: number; dvol: number }> = [];
  for (const t of universe) {
    const detail = tickerDetails.get(t.ticker);
    if (!detail) continue;
    if (detail.type && detail.type !== 'CS') continue;

    const shares = detail.weighted_shares_outstanding
      ?? detail.share_class_shares_outstanding;
    const liveMcap = typeof shares === 'number' && shares > 0
      ? shares * t._price
      : null;
    const refMcap = typeof detail.market_cap === 'number' ? detail.market_cap : null;
    const mcap = liveMcap ?? refMcap;

    if (mcap == null || mcap < MULTIBAGGER.minMarketCap || mcap > MULTIBAGGER.maxMarketCap) continue;

    const vol = t.day?.v || t.prevDay?.v || 0;
    const changePct = t.todaysChangePerc ?? 0;
    mcapFiltered.push({ ticker: t.ticker, price: t._price, detail, mcap, changePct, vol, dvol: t._dolVol });
  }

  console.log(`[multibagger] after mcap filter: ${mcapFiltered.length}`);

  // 5. Fetch financials for filtered candidates
  const scored: any[] = [];
  for (let i = 0; i < mcapFiltered.length; i += BATCH) {
    const batch = mcapFiltered.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(c =>
        fetchJson(
          `https://api.polygon.io/vX/reference/financials?ticker=${c.ticker}&timeframe=annual&order=desc&limit=4&sort=period_of_report_date&apiKey=${polygonKey}`,
          { results: [] },
          15000,
        )
      )
    );

    for (let j = 0; j < results.length; j++) {
      const c = batch[j];
      const r = results[j];
      const filings = r.status === 'fulfilled' ? (r.value?.results || []) : [];

      if (filings.length === 0) continue;

      const parsed = parseFinancials(filings, c.mcap, c.price);

      // Skip companies with no revenue data
      if (parsed.latestRevenue == null) continue;

      const s = scoreMultibagger(
        parsed.revGrowths,
        parsed.roic,
        parsed.debtToEquity,
        c.mcap,
        parsed.pe,
        parsed.fcfYield,
      );

      // Must-pass gates: revenue growth ≥ 10% AND ROIC ≥ 10%
      const revCagr = s.attrs.revGrowthPct;
      const roicVal = s.attrs.roic;
      if (revCagr == null || revCagr < 10) continue;
      if (roicVal == null || roicVal < 10) continue;

      // Only keep stocks that score above a minimum threshold
      if (s.score < 20) continue;

      const d = c.detail;
      scored.push({
        ticker: c.ticker,
        name: d.name || d.company_name || c.ticker,
        price: Math.round(c.price * 100) / 100,
        marketCap: c.mcap,
        marketCapFmt: fmtMcap(c.mcap),
        mcapTier: s.attrs.mcapTier,
        sector: cleanSectorDescription(d.sic_description, d.sector, d.industry),
        employees: d.total_employees || null,
        changePct: Math.round(c.changePct * 100) / 100,
        vol: c.vol,
        dvol: Math.round(c.dvol),
        score: s.score,
        grade: s.grade,
        breakdown: s.breakdown,
        attrs: {
          revGrowthPct: s.attrs.revGrowthPct != null ? Math.round(s.attrs.revGrowthPct * 10) / 10 : null,
          revGrowthYears: s.attrs.revGrowthYears,
          roic: s.attrs.roic != null ? Math.round(s.attrs.roic * 10) / 10 : null,
          debtToEquity: s.attrs.debtToEquity != null ? Math.round(s.attrs.debtToEquity * 100) / 100 : null,
          pe: s.attrs.pe != null ? Math.round(s.attrs.pe * 10) / 10 : null,
          fcfYield: s.attrs.fcfYield != null ? Math.round(s.attrs.fcfYield * 10) / 10 : null,
        },
        latestRevenue: parsed.latestRevenue,
        latestNetIncome: parsed.latestNetIncome,
      });
    }
  }

  // 6. Rank by score, take top N
  scored.sort((a, b) => b.score - a.score);
  const final = scored.slice(0, MULTIBAGGER.finalSize);

  // 6b. Attach RS Ratings from the precomputed market-wide map
  const rsLookup = await loadRsRatings();
  for (const c of final) {
    c.rs = rsLookup.get(c.ticker);
  }

  // 6c. Enrich top N with daily bars for Stage + RVOL
  const today = new Date();
  const fromDate = new Date(today);
  fromDate.setDate(fromDate.getDate() - 400);
  const toStr = today.toISOString().split('T')[0];
  const fromStr = fromDate.toISOString().split('T')[0];

  for (let i = 0; i < final.length; i += BATCH) {
    const batch = final.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map((c: any) =>
        fetchJson(
          `https://api.polygon.io/v2/aggs/ticker/${c.ticker}/range/1/day/${fromStr}/${toStr}?adjusted=true&sort=asc&limit=350&apiKey=${polygonKey}`,
          { results: [] },
          15000,
        )
      )
    );
    for (let j = 0; j < results.length; j++) {
      const c = batch[j];
      const r = results[j];
      const bars = r.status === 'fulfilled' ? (r.value?.results || []) : [];

      if (bars.length >= 210) {
        const stageResult = computeStageDetail(
          bars.map((b: any) => ({ c: b.c })),
          { order: 'asc', price: c.price },
        );
        c.stage = stageResult.label;
        c.stageShort = stageResult.short;
      } else {
        c.stage = null;
        c.stageShort = '—';
      }

      if (bars.length >= 20) {
        const recentBars = bars.slice(-20);
        const avgVol = recentBars.reduce((s: number, b: any) => s + (b.v || 0), 0) / recentBars.length;
        c.avgVol = Math.round(avgVol);
        c.rvol = avgVol > 0 && c.vol > 0 ? Math.round((c.vol / avgVol) * 100) / 100 : null;
      } else {
        c.avgVol = 0;
        c.rvol = null;
      }
    }
  }

  // 7. Persist to KV
  const meta = {
    universeSize: rawSnap.length,
    filtered: candidates.length,
    mcapFiltered: mcapFiltered.length,
    scored: scored.length,
    count: final.length,
    scanMeta: MULTIBAGGER_META,
    durationMs: Date.now() - t0,
  };

  await Promise.all([
    kv.set('multibagger_v1', final),
    kv.set('multibagger_last_scan_v1', Date.now()),
    kv.set('multibagger_meta_v1', meta),
  ]);

  console.log(`[multibagger] done: ${scored.length} scored, ${final.length} stored, ${Date.now() - t0}ms`);

  return { final, meta };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const forceRefresh = searchParams.get('force') === 'true';
  const bg = searchParams.get('bg') === 'true' && !isDetachedRun(request);

  const polygonKey = process.env.POLYGON_API_KEY || '';
  if (!polygonKey) {
    return NextResponse.json({ error: 'Missing Polygon API key' }, { status: 500 });
  }

  // Cache check — fundamentals don't change intraday, so 12h cache is fine
  if (!forceRefresh) {
    try {
      const lastScan = await kv.get<number>('multibagger_last_scan_v1');
      if (lastScan && Date.now() - lastScan < 12 * 60 * 60 * 1000) {
        const [candidates, meta] = await Promise.all([
          kv.get<any[]>('multibagger_v1'),
          kv.get<any>('multibagger_meta_v1'),
        ]);
        return NextResponse.json({
          success: true,
          fromCache: true,
          candidates: candidates || [],
          lastScanTime: lastScan,
          ...meta,
          scanMeta: meta?.scanMeta ?? MULTIBAGGER_META,
        }, { headers: NO_STORE });
      }
    } catch (e) {
      console.error('[multibagger] cache read failed', e);
    }
  }

  // Background execution for cron
  if (bg) {
    const bgResult = await runInBackground(request, 'multibagger', () => executeScan(polygonKey));
    return NextResponse.json({
      success: true,
      background: true,
      ...bgResult,
    }, { headers: BG_HEADERS });
  }

  // Synchronous execution
  try {
    const { final, meta } = await executeScan(polygonKey);
    return NextResponse.json({
      success: true,
      candidates: final,
      lastScanTime: Date.now(),
      ...meta,
      scanMeta: MULTIBAGGER_META,
    }, { headers: NO_STORE });
  } catch (error: any) {
    console.error('[multibagger] scan failed:', error);
    return NextResponse.json(
      { success: false, error: error.message, candidates: [] },
      { status: 500, headers: NO_STORE },
    );
  }
}

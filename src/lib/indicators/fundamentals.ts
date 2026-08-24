// lib/indicators/fundamentals.ts
//
// Shared fundamental analysis: parse Polygon SEC filings into revenue growth,
// ROIC, D/E, P/E, FCF yield and score them on the 100-bagger rubric.
// Used by multibagger/run and optionally by other scanner /run routes to
// enrich candidates with fundamental data.

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

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface ScoreBreakdown {
  revenueGrowth: number;
  returnOnCapital: number;
  lowDebt: number;
  marketCap: number;
  valuation: number;
  cashGeneration: number;
}

export interface FundamentalAttrs {
  revGrowthPct: number | null;
  revGrowthYears: number;
  roic: number | null;
  debtToEquity: number | null;
  mcap: number;
  mcapTier: string;
  pe: number | null;
  fcfYield: number | null;
}

export interface FundamentalScore {
  score: number;
  grade: string;
  breakdown: ScoreBreakdown;
  attrs: FundamentalAttrs;
}

export function scoreMultibagger(
  revGrowths: number[],
  roic: number | null,
  debtToEquity: number | null,
  marketCapVal: number,
  pe: number | null,
  fcfYield: number | null,
): FundamentalScore {
  const b: ScoreBreakdown = {
    revenueGrowth: 0,
    returnOnCapital: 0,
    lowDebt: 0,
    marketCap: 0,
    valuation: 0,
    cashGeneration: 0,
  };

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

  if (roic != null) {
    if (roic >= 25) b.returnOnCapital = 20;
    else if (roic >= 20) b.returnOnCapital = 17;
    else if (roic >= 15) b.returnOnCapital = 14;
    else if (roic >= 10) b.returnOnCapital = 10;
    else if (roic >= 5) b.returnOnCapital = 5;
  }

  if (debtToEquity != null && debtToEquity >= 0) {
    if (debtToEquity <= 0.1) b.lowDebt = 15;
    else if (debtToEquity <= 0.3) b.lowDebt = 12;
    else if (debtToEquity <= 0.5) b.lowDebt = 10;
    else if (debtToEquity <= 1.0) b.lowDebt = 6;
    else if (debtToEquity <= 2.0) b.lowDebt = 2;
  }

  const tier = mcapTier(marketCapVal);
  if (tier === 'Micro') b.marketCap = 20;
  else if (tier === 'Small') b.marketCap = 15;
  else if (tier === 'Mid') b.marketCap = 8;
  else b.marketCap = 3;

  if (pe != null && pe > 0) {
    if (pe <= 12) b.valuation = 10;
    else if (pe <= 18) b.valuation = 8;
    else if (pe <= 25) b.valuation = 6;
    else if (pe <= 35) b.valuation = 3;
    else if (pe <= 50) b.valuation = 1;
  }

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

export interface ParsedFinancials {
  revGrowths: number[];
  roic: number | null;
  debtToEquity: number | null;
  pe: number | null;
  fcfYield: number | null;
  latestRevenue: number | null;
  latestNetIncome: number | null;
}

export function parseFinancials(filings: any[], marketCap: number, price: number): ParsedFinancials {
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

  const sorted = [...filings].sort((a, b) => {
    const ya = parseInt(a.fiscal_year) || 0;
    const yb = parseInt(b.fiscal_year) || 0;
    return yb - ya;
  });

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

  const latest = sorted[0];
  const is = latest.financials?.income_statement;
  const bs = latest.financials?.balance_sheet;
  const cf = latest.financials?.cash_flow_statement;

  const netIncome = fv(is, 'net_income_loss');
  result.latestNetIncome = netIncome;

  const opIncome = fv(is, 'operating_income_loss');
  const taxExpense = fv(is, 'income_tax_expense_benefit');
  const preTaxIncome = fv(is, 'income_loss_from_continuing_operations_before_tax')
    ?? fv(is, 'income_loss_before_equity_method_investments');

  let taxRate = 0.25;
  if (preTaxIncome != null && preTaxIncome > 0 && taxExpense != null) {
    const effectiveRate = taxExpense / preTaxIncome;
    if (effectiveRate > 0 && effectiveRate < 1) taxRate = effectiveRate;
  }

  const equity = fv(bs, 'equity') ?? fv(bs, 'equity_attributable_to_parent') ?? fv(bs, 'stockholders_equity');
  const totalAssets = fv(bs, 'assets');
  const currentLiabilities = fv(bs, 'current_liabilities');
  const totalLiabilities = fv(bs, 'liabilities');
  const noncurrentLiabilities = fv(bs, 'noncurrent_liabilities');

  if (opIncome != null && totalAssets != null && currentLiabilities != null) {
    const investedCapital = totalAssets - currentLiabilities;
    if (investedCapital > 0) {
      const nopat = opIncome * (1 - taxRate);
      result.roic = (nopat / investedCapital) * 100;
    }
  }

  if (equity != null && equity > 0) {
    const debt = noncurrentLiabilities ?? (totalLiabilities != null && currentLiabilities != null
      ? totalLiabilities - currentLiabilities : totalLiabilities);
    if (debt != null) {
      result.debtToEquity = debt / equity;
    }
  }

  if (netIncome != null && netIncome > 0 && marketCap > 0) {
    result.pe = marketCap / netIncome;
  }

  const opCashFlow = fv(cf, 'net_cash_flow_from_operating_activities')
    ?? fv(cf, 'net_cash_flow_from_operating_activities_continuing');
  if (opCashFlow != null && marketCap > 0) {
    const capex = fv(cf, 'capital_expenditure')
      ?? fv(cf, 'payments_to_acquire_property_plant_and_equipment');
    const fcf = capex != null ? opCashFlow + capex : opCashFlow;
    result.fcfYield = (fcf / marketCap) * 100;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Bulk enrichment — cross-reference multibagger KV, then fill gaps from Polygon
// ---------------------------------------------------------------------------

export interface FundamentalResult {
  score: number;
  grade: string;
  attrs: {
    revGrowthPct: number | null;
    revGrowthYears?: number;
    roic: number | null;
    debtToEquity: number | null;
    pe: number | null;
    fcfYield: number | null;
  };
}

export async function enrichWithFundamentals(
  tickers: { ticker: string; price: number; marketCap?: number }[],
  polygonKey: string,
  existingMbData?: any[],
): Promise<Map<string, FundamentalResult>> {
  const result = new Map<string, FundamentalResult>();
  if (!tickers.length) return result;

  const mbLookup = new Map<string, FundamentalResult>();
  if (existingMbData) {
    for (const m of existingMbData) {
      const t = (m.ticker ?? m.symbol ?? '').toUpperCase();
      if (t && m.attrs) {
        mbLookup.set(t, {
          score: m.score,
          grade: m.grade,
          attrs: {
            revGrowthPct: m.attrs.revGrowthPct ?? null,
            revGrowthYears: m.attrs.revGrowthYears,
            roic: m.attrs.roic ?? null,
            debtToEquity: m.attrs.debtToEquity ?? null,
            pe: m.attrs.pe ?? null,
            fcfYield: m.attrs.fcfYield ?? null,
          },
        });
      }
    }
  }

  const needFetch: typeof tickers = [];
  for (const t of tickers) {
    const existing = mbLookup.get(t.ticker.toUpperCase());
    if (existing) {
      result.set(t.ticker.toUpperCase(), existing);
    } else {
      needFetch.push(t);
    }
  }

  if (needFetch.length === 0 || !polygonKey) return result;

  // Batch-fetch financials from Polygon for remaining tickers
  const BATCH = 25;
  for (let i = 0; i < needFetch.length; i += BATCH) {
    const batch = needFetch.slice(i, i + BATCH);
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

      const mcap = c.marketCap ?? (c.price * 1e6);
      const parsed = parseFinancials(filings, mcap, c.price);
      if (parsed.latestRevenue == null) continue;

      const s = scoreMultibagger(
        parsed.revGrowths,
        parsed.roic,
        parsed.debtToEquity,
        mcap,
        parsed.pe,
        parsed.fcfYield,
      );

      result.set(c.ticker.toUpperCase(), {
        score: s.score,
        grade: s.grade,
        attrs: {
          revGrowthPct: s.attrs.revGrowthPct != null ? Math.round(s.attrs.revGrowthPct * 10) / 10 : null,
          revGrowthYears: s.attrs.revGrowthYears,
          roic: s.attrs.roic != null ? Math.round(s.attrs.roic * 10) / 10 : null,
          debtToEquity: s.attrs.debtToEquity != null ? Math.round(s.attrs.debtToEquity * 100) / 100 : null,
          pe: s.attrs.pe != null ? Math.round(s.attrs.pe * 10) / 10 : null,
          fcfYield: s.attrs.fcfYield != null ? Math.round(s.attrs.fcfYield * 10) / 10 : null,
        },
      });
    }
  }

  return result;
}

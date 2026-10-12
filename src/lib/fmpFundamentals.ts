// lib/fmpFundamentals.ts — annual financial statements from FMP, shaped like the Polygon
// vX/reference/financials filings the 100-Bagger parser was written for (12 Oct 2026).
//
// Why: Polygon retired /vX/reference/financials (410 Gone) and its replacement
// /stocks/financials/v1/* is not on this plan (403). The 100-Bagger scored 0 of 390 names
// and every scan's fundamentals enrichment came back empty.
//
// COST, measured 12 Oct 2026: one company = 3 FMP calls (income, balance sheet, cash flow;
// 4 annual periods) ≈ 21 KB. Statements change quarterly, so each company's parsed filings
// are cached in KV for 7 days (`fund_fmp_v1:<T>`, ~0.5 KB): a scan reads its names in ONE
// mget and only fetches the misses, capped per run. A name FMP does not cover gets a 1-day
// empty sentinel so it is not re-fetched every 15 minutes. Flat in users (cron-driven).
// FMP Starter allows 300 calls a minute: fetches go 10 names (30 calls) at a time, ~6.5 s
// apart.

import { kv } from '@vercel/kv';

const KEY = () => (process.env.FMP_API_KEY || '').trim();
const CACHE = (t: string) => `fund_fmp_v1:${t.toUpperCase()}`;
const TTL_OK = 7 * 86400, TTL_EMPTY = 86400;
const BASE = 'https://financialmodelingprep.com/stable';

type Num = number | null | undefined;
const v = (x: Num) => (typeof x === 'number' && Number.isFinite(x) ? { value: x } : undefined);

/** One filing in the Polygon shape parseFinancials reads (only the fields it uses). */
export interface Filing {
  fiscal_year: string;
  financials: {
    income_statement: Record<string, { value: number } | undefined>;
    balance_sheet: Record<string, { value: number } | undefined>;
    cash_flow_statement: Record<string, { value: number } | undefined>;
  };
}

async function getJson(url: string): Promise<unknown[] | null> {
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const j = await res.json();
    return Array.isArray(j) ? j : null;
  } catch {
    return null;
  }
}

/** Three FMP calls → up to 4 annual filings, newest first. Null on a fetch failure. */
export async function fetchFmpFilings(symbol: string): Promise<Filing[] | null> {
  const key = KEY(); if (!key) return null;
  const q = `symbol=${encodeURIComponent(symbol)}&period=annual&limit=4&apikey=${key}`;
  const [inc, bal, cf] = await Promise.all([
    getJson(`${BASE}/income-statement?${q}`), getJson(`${BASE}/balance-sheet-statement?${q}`), getJson(`${BASE}/cash-flow-statement?${q}`),
  ]);
  if (!inc) return null;
  type Row = Record<string, Num | string>;
  const byYear = (rows: unknown[] | null) => new Map((rows ?? []).map(r => [String((r as Row).fiscalYear ?? String((r as Row).date ?? '').slice(0, 4)), r as Row]));
  const B = byYear(bal), C = byYear(cf);
  return (inc as Row[]).map(i => {
    const y = String(i.fiscalYear ?? String(i.date ?? '').slice(0, 4));
    const b = B.get(y) ?? {}, c = C.get(y) ?? {};
    return {
      fiscal_year: y,
      financials: {
        income_statement: {
          revenues: v(i.revenue as Num), net_income_loss: v(i.netIncome as Num), operating_income_loss: v(i.operatingIncome as Num),
          income_tax_expense_benefit: v(i.incomeTaxExpense as Num), income_loss_from_continuing_operations_before_tax: v(i.incomeBeforeTax as Num),
        },
        balance_sheet: {
          equity: v((b.totalStockholdersEquity ?? b.totalEquity) as Num), assets: v(b.totalAssets as Num),
          current_liabilities: v(b.totalCurrentLiabilities as Num), liabilities: v(b.totalLiabilities as Num),
          noncurrent_liabilities: v(b.totalNonCurrentLiabilities as Num),
        },
        cash_flow_statement: {
          net_cash_flow_from_operating_activities: v(c.operatingCashFlow as Num), capital_expenditure: v(c.capitalExpenditure as Num),
        },
      },
    };
  });
}

/**
 * Filings for many symbols: one KV mget for the cache, FMP for up to `maxFetch` misses.
 * Symbols not returned are unknown this run (cap reached or a fetch failed).
 */
export async function getFilings(symbols: string[], maxFetch: number): Promise<Map<string, Filing[]>> {
  const out = new Map<string, Filing[]>();
  const syms = [...new Set(symbols.map(s => s.toUpperCase()).filter(Boolean))];
  if (!syms.length) return out;
  const cached = await kv.mget<(Filing[] | null)[]>(...syms.map(CACHE)).catch(() => syms.map(() => null));
  const miss: string[] = [];
  syms.forEach((s, i) => { const c = cached[i]; if (Array.isArray(c)) { if (c.length) out.set(s, c); } else miss.push(s); });
  const todo = miss.slice(0, Math.max(0, maxFetch));
  for (let i = 0; i < todo.length; i += 10) {
    const batch = todo.slice(i, i + 10);
    const got = await Promise.all(batch.map(async s => [s, await fetchFmpFilings(s)] as const));
    const p = kv.pipeline();
    for (const [s, f] of got) {
      if (f == null) continue;                       // a failure: try again next run
      p.set(CACHE(s), f, { ex: f.length ? TTL_OK : TTL_EMPTY });
      if (f.length) out.set(s, f);
    }
    await p.exec().catch(() => {});
    if (i + 10 < todo.length) await new Promise(r => setTimeout(r, 6500));
  }
  return out;
}

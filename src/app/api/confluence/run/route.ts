// app/api/confluence/run/route.ts — v1.0
//
// Multi-timeframe confluence report for the top setups.
//
// Picks the highest-confluence stocks from existing scan data (daily_setups_v6,
// swing_candidates_v1, dvol_rows_v1) filtered by Stage 2A+, RS >= 70, RVOL >= 1,
// CNF >= 40. For each, fetches weekly/daily/4h/1h bars from Polygon and computes
// EMA trends, RSI(14), MACD(12,26,9), price vs EMAs, and derives S/R levels from
// swing highs/lows. The result is a per-stock confluence card with a trade rec.
//
// KV: reads 3 keys (existing scan data), writes 2 keys. Polygon: ~4 calls per
// stock × up to 10 stocks = ~40 calls per run. Flat cost, cron-driven.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { ema, sma, atr } from '@/lib/indicators/marketMath';
import { rsi, rsiLabel } from '@/lib/indicators/rsi';
import { macd, macdLabel } from '@/lib/indicators/macd';
import type { Bar } from '@/lib/indicators/marketMath';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

// ---- helpers ----------------------------------------------------------------

const fetchSafeJson = async (url: string, fallback: any, timeoutMs = 15000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  const redacted = url.replace(/apiKey=[^&]+/, 'apiKey=***');
  try {
    const res = await fetch(url, { signal: controller.signal as any });
    clearTimeout(id);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[CONFLUENCE] FETCH ${res.status} ${redacted} — ${body.slice(0, 200)}`);
      return fallback;
    }
    const json = await res.json();
    console.log(`[CONFLUENCE] OK ${redacted} — resultsCount=${json.resultsCount ?? json.results?.length ?? '?'}`);
    return json;
  } catch (err: any) {
    clearTimeout(id);
    console.error(`[CONFLUENCE] FETCH ERR ${redacted} — ${err.message}`);
    return fallback;
  }
};

interface ScanStock {
  ticker?: string; symbol?: string;
  cnfScore?: number; cnfGrade?: string;
  rsRating?: number; rvol?: number; vol?: number;
  stage?: string; price?: number; changePct?: number;
  setupName?: string; catalyst?: string;
  plan?: any; cnfBreakdown?: any;
  dVol?: number; dvol?: number;
  stochK?: number; mf?: number; mfTrend?: number;
  adrPct?: number; pctOffHigh?: number;
  ema10?: number; ema21?: number; ema50?: number;
  float?: number; mktCap?: number; sector?: string; name?: string;
}

function sym(s: ScanStock): string { return s.ticker || s.symbol || ''; }

// ---- timeframe analysis -----------------------------------------------------

type Timeframe = 'Weekly' | 'Daily' | '4-Hour' | '2-Hour' | '1-Hour';

interface TfAnalysis {
  timeframe: Timeframe;
  ema21: number | null;
  ema55: number | null;
  emaTrend: string;
  rsi: number | null;
  rsiLabel: string;
  macdHist: number | null;
  macdLabel: string;
  priceVsEmas: string;
  bias: string;
  biasScore: number; // 0-4
}

function analyzeTf(bars: Bar[], tf: Timeframe): TfAnalysis | null {
  const isIntraday = tf !== 'Weekly' && tf !== 'Daily';
  const minBars = isIntraday ? 2 : 36;
  if (!bars || bars.length < minBars) return null;
  const closes = bars.map(b => b.c);
  const price = closes[closes.length - 1];

  const emaShort = isIntraday ? 8 : 21;
  const emaLong = isIntraday ? 21 : 55;
  const rsiPeriod = isIntraday ? 7 : 14;
  const macdFast = isIntraday ? 5 : 12;
  const macdSlow = isIntraday ? 13 : 26;
  const macdSig = isIntraday ? 4 : 9;

  const e21 = ema(closes, emaShort);
  const e55 = ema(closes, emaLong);
  const rsiVal = rsi(bars, rsiPeriod);
  const macdRes = macd(bars, macdFast, macdSlow, macdSig);

  const emaTrend = e21 != null && e55 != null
    ? (e21 > e55 ? `Bullish (${emaShort} > ${emaLong})` : `Bearish (${emaShort} < ${emaLong})`)
    : 'N/A';

  let priceVsEmas = 'N/A';
  if (e21 != null && e55 != null) {
    const above21 = price > e21;
    const above55 = price > e55;
    priceVsEmas = above21 && above55 ? 'Above both'
      : !above21 && !above55 ? 'Below both'
      : above21 ? 'Above 21, below 55'
      : 'Below 21, above 55';
  }

  let biasScore = 0;
  if (e21 != null && e55 != null && e21 > e55) biasScore++;
  if (rsiVal != null && rsiVal > 50) biasScore++;
  if (macdRes != null && macdRes.histogram > 0) biasScore++;
  if (e21 != null && e55 != null && price > e21 && price > e55) biasScore++;

  const bias = biasScore >= 3 ? 'BULLISH' : biasScore <= 1 ? 'BEARISH' : 'NEUTRAL';

  return {
    timeframe: tf,
    ema21: e21 != null ? Math.round(e21 * 100) / 100 : null,
    ema55: e55 != null ? Math.round(e55 * 100) / 100 : null,
    emaTrend,
    rsi: rsiVal != null ? Math.round(rsiVal * 10) / 10 : null,
    rsiLabel: rsiVal != null ? rsiLabel(rsiVal) : 'N/A',
    macdHist: macdRes ? Math.round(macdRes.histogram * 100) / 100 : null,
    macdLabel: macdRes ? macdLabel(macdRes.histogram) : 'N/A',
    priceVsEmas,
    bias,
    biasScore,
  };
}

// ---- S/R levels from swing points -------------------------------------------

function findSwingLevels(bars: Bar[], lookback = 60): { resistance: number[]; support: number[] } {
  const resistance: number[] = [];
  const support: number[] = [];
  const recent = bars.slice(-lookback);
  for (let i = 2; i < recent.length - 2; i++) {
    const b = recent[i];
    if (b.h > recent[i - 1].h && b.h > recent[i - 2].h && b.h > recent[i + 1].h && b.h > recent[i + 2].h) {
      resistance.push(Math.round(b.h * 100) / 100);
    }
    if (b.l < recent[i - 1].l && b.l < recent[i - 2].l && b.l < recent[i + 1].l && b.l < recent[i + 2].l) {
      support.push(Math.round(b.l * 100) / 100);
    }
  }
  // Dedupe close levels (within 0.5%)
  const dedup = (arr: number[]) => {
    arr.sort((a, b) => b - a);
    const out: number[] = [];
    for (const v of arr) {
      if (out.length === 0 || Math.abs(v - out[out.length - 1]) / out[out.length - 1] > 0.005) {
        out.push(v);
      }
    }
    return out.slice(0, 3);
  };
  return { resistance: dedup(resistance), support: dedup(support.sort((a, b) => a - b).reverse()) };
}

// ---- trade recommendation ---------------------------------------------------

interface TradeRec {
  direction: string;
  entry: string;
  stopLoss: string;
  takeProfit: string;
  rr: string;
}

function tradeRec(stock: ScanStock, dailyBars: Bar[], levels: { resistance: number[]; support: number[] }): TradeRec {
  const price = stock.price ?? dailyBars[dailyBars.length - 1]?.c ?? 0;
  const atrVal = atr(dailyBars, 14) ?? price * 0.03;

  const st = (stock.stage ?? '').replace(/^Stage\s*/i, '');
  const bullish = st.startsWith('2') || st === '1C';
  const direction = bullish ? 'LONG' : 'SHORT';

  let entry: number;
  let stop: number;
  let target: number;

  if (bullish) {
    entry = price;
    stop = stock.plan?.stop ?? (levels.support[0] ?? (price - 2 * atrVal));
    target = levels.resistance[0] ?? (price + 3 * atrVal);
    if (stop >= entry) stop = entry - 1.5 * atrVal;
  } else {
    entry = price;
    target = levels.support[0] ?? (price - 3 * atrVal);
    stop = levels.resistance[0] ?? (price + 2 * atrVal);
    if (stop <= entry) stop = entry + 1.5 * atrVal;
  }

  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  const rr = risk > 0 ? (reward / risk).toFixed(1) : '—';

  const fmtPrice = (v: number) => v >= 100 ? v.toFixed(0) : v.toFixed(2);

  return {
    direction,
    entry: `$${fmtPrice(entry)}`,
    stopLoss: `$${fmtPrice(stop)}`,
    takeProfit: `$${fmtPrice(target)}`,
    rr: `1:${rr}`,
  };
}

// ---- AI summary -------------------------------------------------------------

interface AiSummary {
  overallBias: string;
  biasRationale: string;
  topPicks: { ticker: string; reason: string; grade: string; cnfScore: number; rsRating: number; stage: string }[];
  keyLevels: { ticker: string; grade: string; support: string[]; resistance: string[] }[];
  sectorThemes: string[];
  riskNotes: string[];
  actionPlan: string;
}

function generateAiSummary(reports: any[]): AiSummary {
  const bullish = reports.filter(r => r.confluenceLabel === 'Bullish');
  const bearish = reports.filter(r => r.confluenceLabel === 'Bearish');
  const mixed = reports.filter(r => r.confluenceLabel === 'Mixed');

  const overallBias = bullish.length > bearish.length + mixed.length ? 'BULLISH'
    : bearish.length > bullish.length + mixed.length ? 'BEARISH' : 'MIXED';

  const biasRationale = `${bullish.length} of ${reports.length} setups show multi-timeframe bullish confluence. ` +
    `${bearish.length} bearish, ${mixed.length} mixed. ` +
    (overallBias === 'BULLISH' ? 'Momentum favors longs with selective entries on pullbacks.'
      : overallBias === 'BEARISH' ? 'Confluence is weak across timeframes — wait for higher-quality setups or play defense.'
      : 'Mixed signals across timeframes — be selective, favor highest-confluence names only.');

  const sorted = [...reports].sort((a, b) => {
    const sc = (r: any) => r.cnfScore * 2 + r.rsRating + (r.confluenceScore / r.confluenceMax) * 50;
    return sc(b) - sc(a);
  });

  const topPicks = sorted.slice(0, 3).map(r => {
    const dailyTf = r.timeframes.find((tf: any) => tf.timeframe === 'Daily');
    const rsiNote = dailyTf?.rsi != null ? `RSI ${dailyTf.rsi.toFixed(0)}` : '';
    const macdNote = dailyTf?.macdLabel ?? '';
    const parts = [
      rsiNote,
      macdNote ? `MACD ${macdNote}` : '',
      r.rvol >= 1.5 ? `RVOL ${r.rvol.toFixed(1)}x` : '',
      r.setupName || '',
    ].filter(Boolean);
    return {
      ticker: r.ticker,
      reason: parts.join(' · '),
      grade: r.cnfGrade || 'C',
      cnfScore: r.cnfScore ?? 0,
      rsRating: r.rsRating ?? 0,
      stage: (r.stage || '').replace(/^Stage\s*/i, ''),
    };
  });

  const fmtLvl = (v: number) => `$${v >= 100 ? v.toFixed(0) : v.toFixed(2)}`;
  const keyLevels: AiSummary['keyLevels'] = [];
  for (const r of reports) {
    const sup = (r.levels.support || []).slice(0, 2).map(fmtLvl);
    const res = (r.levels.resistance || []).slice(0, 2).map(fmtLvl);
    if (sup.length > 0 || res.length > 0) {
      keyLevels.push({ ticker: r.ticker, grade: r.cnfGrade || 'C', support: sup, resistance: res });
    }
  }

  const sectors = new Map<string, number>();
  for (const r of reports) {
    if (r.sector) sectors.set(r.sector, (sectors.get(r.sector) || 0) + 1);
  }
  const sectorThemes = [...sectors.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([s, c]) => `${s} (${c} setup${c > 1 ? 's' : ''})`);

  const riskNotes: string[] = [];
  const highRsi = reports.filter(r => {
    const d = r.timeframes.find((tf: any) => tf.timeframe === 'Daily');
    return d && d.rsi != null && d.rsi >= 70;
  });
  if (highRsi.length > 0) riskNotes.push(`${highRsi.map((r: any) => r.ticker).join(', ')} ${highRsi.length > 1 ? 'are' : 'is'} overbought on the daily (RSI > 70) — chase risk elevated.`);

  const lowRvol = reports.filter(r => r.rvol < 1);
  if (lowRvol.length > 0) riskNotes.push(`${lowRvol.map((r: any) => r.ticker).join(', ')} trading below average volume — confirmation needed.`);

  const wideAdr = reports.filter(r => r.adrPct != null && r.adrPct >= 10);
  if (wideAdr.length > 0) riskNotes.push(`${wideAdr.map((r: any) => r.ticker).join(', ')} ${wideAdr.length > 1 ? 'have' : 'has'} ADR > 10% — size accordingly.`);

  if (riskNotes.length === 0) riskNotes.push('No elevated risk signals detected across the scan.');

  const bestRR = sorted.find(r => r.tradeRec);
  const actionPlan = bestRR
    ? `Primary focus: ${bestRR.ticker} — ${bestRR.tradeRec.direction} from ${bestRR.tradeRec.entry}, stop ${bestRR.tradeRec.stopLoss}, target ${bestRR.tradeRec.takeProfit} (${bestRR.tradeRec.rr}). ` +
      (topPicks.length > 1 ? `Secondary: ${topPicks[1].ticker}. ` : '') +
      `${overallBias === 'BULLISH' ? 'Environment supports aggressive positioning.' : overallBias === 'BEARISH' ? 'Reduce exposure, tighten stops.' : 'Be selective — only trade A+ setups.'}`
    : 'No actionable trade setups meet minimum criteria.';

  return { overallBias, biasRationale, topPicks, keyLevels, sectorThemes, riskNotes, actionPlan };
}

// ---- main -------------------------------------------------------------------

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    const { searchParams } = new URL(request.url);
    if (searchParams.get('secret') !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const polygonApiKey = process.env.NEXT_PUBLIC_POLYGON_API_KEY || process.env.POLYGON_API_KEY || '';
  if (!polygonApiKey) return NextResponse.json({ error: 'Missing API Key' }, { status: 500 });

  try {
    // 1. Pull top stocks from existing scan data
    const [dailySetups, swingCandidates, dvolRows] = await Promise.all([
      kv.get<ScanStock[]>('daily_setups_v6'),
      kv.get<ScanStock[]>('swing_candidates_v1'),
      kv.get<ScanStock[]>('dvol_rows_v1'),
    ]);

    const all = new Map<string, ScanStock>();
    for (const list of [dailySetups, swingCandidates, dvolRows]) {
      if (!Array.isArray(list)) continue;
      for (const s of list) {
        const t = sym(s);
        if (!t) continue;
        const existing = all.get(t);
        if (!existing || (s.cnfScore ?? 0) > (existing.cnfScore ?? 0)) {
          all.set(t, s);
        }
      }
    }

    // Filter: Stage 2x or 1C, RS >= 50, CNF >= 20
    const candidates = [...all.values()].filter(s => {
      const st = (s.stage ?? '').replace(/^Stage\s*/i, '');
      const isGoodStage = st.startsWith('2') || st === '1C';
      return isGoodStage
        && (s.cnfScore ?? 0) >= 20
        && (s.rsRating ?? 0) >= 50;
    });

    // Sort by composite: CNF weighted highest, then RS, RVOL, Vol
    candidates.sort((a, b) => {
      const scoreA = (a.cnfScore ?? 0) * 3 + (a.rsRating ?? 0) * 2 + Math.min(a.rvol ?? 0, 5) * 10 + Math.min((a.dVol ?? a.dvol ?? 0) / 1e6, 100) * 0.1;
      const scoreB = (b.cnfScore ?? 0) * 3 + (b.rsRating ?? 0) * 2 + Math.min(b.rvol ?? 0, 5) * 10 + Math.min((b.dVol ?? b.dvol ?? 0) / 1e6, 100) * 0.1;
      return scoreB - scoreA;
    });

    const top = candidates.slice(0, 10);

    if (top.length === 0) {
      await kv.set('confluence_report_v1', []);
      await kv.set('confluence_last_scan_v1', Date.now());
      return NextResponse.json({ success: true, count: 0, reports: [] });
    }

    // 2. Fetch multi-TF bars for each stock
    const now = new Date();
    const toStr = now.toISOString().split('T')[0];
    const dailyFrom = new Date(now.getTime() - 365 * 86400000).toISOString().split('T')[0];
    const weeklyFrom = new Date(now.getTime() - 1460 * 86400000).toISOString().split('T')[0];
    const intraFrom = new Date(now.getTime() - 90 * 86400000).toISOString().split('T')[0];

    const reports = [];

    for (const stock of top) {
      const ticker = sym(stock);
      const [weeklyRes, dailyRes, h4Res, h2Res, h1Res] = await Promise.all([
        fetchSafeJson(`https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/week/${weeklyFrom}/${toStr}?adjusted=true&sort=asc&limit=200&apiKey=${polygonApiKey}`, { results: [] }),
        fetchSafeJson(`https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${dailyFrom}/${toStr}?adjusted=true&sort=asc&limit=400&apiKey=${polygonApiKey}`, { results: [] }),
        fetchSafeJson(`https://api.polygon.io/v2/aggs/ticker/${ticker}/range/4/hour/${intraFrom}/${toStr}?adjusted=true&sort=asc&limit=500&apiKey=${polygonApiKey}`, { results: [] }),
        fetchSafeJson(`https://api.polygon.io/v2/aggs/ticker/${ticker}/range/2/hour/${intraFrom}/${toStr}?adjusted=true&sort=asc&limit=500&apiKey=${polygonApiKey}`, { results: [] }),
        fetchSafeJson(`https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/hour/${intraFrom}/${toStr}?adjusted=true&sort=asc&limit=500&apiKey=${polygonApiKey}`, { results: [] }),
      ]);

      const toBars = (res: any): Bar[] =>
        (res.results || []).map((r: any) => ({ o: r.o, h: r.h, l: r.l, c: r.c, v: r.v, t: r.t }));

      const weeklyBars = toBars(weeklyRes);
      const dailyBars = toBars(dailyRes);
      const h4Bars = toBars(h4Res);
      const h2Bars = toBars(h2Res);
      const h1Bars = toBars(h1Res);

      console.log(`[CONFLUENCE] ${ticker}: weekly=${weeklyBars.length} daily=${dailyBars.length} 4h=${h4Bars.length} 2h=${h2Bars.length} 1h=${h1Bars.length}`);

      const tfWeekly = analyzeTf(weeklyBars, 'Weekly');
      const tfDaily = analyzeTf(dailyBars, 'Daily');
      const tf4h = analyzeTf(h4Bars, '4-Hour');
      const tf2h = analyzeTf(h2Bars, '2-Hour');
      const tf1h = analyzeTf(h1Bars, '1-Hour');

      const timeframes = [tfWeekly, tfDaily, tf4h, tf2h, tf1h].filter(Boolean) as TfAnalysis[];

      // Confluence score: sum of bias scores across timeframes
      const totalBias = timeframes.reduce((sum, tf) => sum + tf.biasScore, 0);
      const maxBias = timeframes.length * 4;
      const confluenceScore = maxBias > 0 ? Math.round((totalBias / maxBias) * 4) : 0;
      const confluenceLabel = confluenceScore >= 3 ? 'Bullish' : confluenceScore <= 1 ? 'Bearish' : 'Mixed';

      // S/R from daily bars, filtered to within 25% of current price
      const rawLevels = dailyBars.length > 10 ? findSwingLevels(dailyBars) : { resistance: [], support: [] };
      const curPrice = stock.price ?? dailyBars[dailyBars.length - 1]?.c ?? 0;
      const levels = {
        resistance: rawLevels.resistance.filter(v => v > curPrice && v <= curPrice * 1.25),
        support: rawLevels.support.filter(v => v < curPrice && v >= curPrice * 0.75),
      };

      // Trade rec
      const rec = dailyBars.length > 0 ? tradeRec(stock, dailyBars, levels) : null;

      reports.push({
        ticker,
        name: stock.name ?? ticker,
        sector: stock.sector ?? '',
        price: stock.price ?? dailyBars[dailyBars.length - 1]?.c ?? 0,
        changePct: stock.changePct ?? 0,
        cnfScore: stock.cnfScore ?? 0,
        cnfGrade: stock.cnfGrade ?? '',
        rsRating: stock.rsRating ?? 0,
        rvol: stock.rvol ?? 0,
        vol: stock.vol ?? 0,
        dVol: stock.dVol ?? stock.dvol ?? 0,
        stage: stock.stage ?? '',
        setupName: stock.setupName ?? '',
        catalyst: stock.catalyst ?? '',
        stochK: stock.stochK ?? null,
        mf: stock.mf ?? null,
        mfTrend: stock.mfTrend ?? null,
        adrPct: stock.adrPct ?? null,
        pctOffHigh: stock.pctOffHigh ?? null,
        float: stock.float ?? null,
        mktCap: stock.mktCap ?? null,
        timeframes,
        confluenceScore,
        confluenceMax: timeframes.length,
        confluenceLabel,
        levels,
        tradeRec: rec,
      });
    }

    const aiSummary = generateAiSummary(reports);

    await Promise.all([
      kv.set('confluence_report_v1', reports),
      kv.set('confluence_last_scan_v1', Date.now()),
      kv.set('confluence_ai_summary_v1', aiSummary),
    ]);

    return NextResponse.json({
      success: true,
      count: reports.length,
      reports,
      aiSummary,
    });
  } catch (error: any) {
    console.error('CONFLUENCE_RUN_ERROR:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

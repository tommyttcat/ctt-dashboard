'use client';

import React, { useState, useEffect } from 'react';

interface ActionableEvent {
  time: string;
  event: string;
  impact: 'High' | 'Medium' | 'Low';
}

interface UpdateBlock {
  phase: string;
  timestamp: string;
  paragraphs: string[];
  takeawayLabel: string;
  takeaway: string;
  colorTheme: 'cyan' | 'emerald' | 'indigo' | 'amber' | 'rose';
}

interface SummaryData {
  morning: UpdateBlock | null;
  midday: UpdateBlock | null;
  closing: UpdateBlock | null;
  actionableEvents?: ActionableEvent[]; 
}

interface WatchItem {
  symbol: string;
  score?: number | string;
  reason: string;
  catalyst?: string | null;
  catalystUrl?: string | null;
}

interface TopCatalyst {
  ticker: string;
  headline: string;
  url: string | null;
  brief?: string | null;
}

interface MacroInsights {
  theme: string;
  briefing: string;
  watching: WatchItem[];
  topCatalyst?: TopCatalyst | null;
  topCatalysts?: TopCatalyst[];
}

type MarketSession = 'Pre-Market' | 'Open' | 'Post-Market' | 'Closed';

const getEstDateInfo = () => {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
};

const getCurrentEstDecimal = () => {
  const est = getEstDateInfo();
  return est.getHours() + est.getMinutes() / 60;
};

const isWeekendNow = () => {
  const day = getEstDateInfo().getDay();
  return day === 0 || day === 6;
};

const getMarketSession = (): MarketSession => {
  const est = getEstDateInfo();
  const day = est.getDay();
  const timeStr = est.getHours() + est.getMinutes() / 60;
  if (day === 0 || day === 6) return 'Closed';
  if (timeStr >= 4 && timeStr < 9.5) return 'Pre-Market';
  if (timeStr >= 9.5 && timeStr < 16) return 'Open';
  if (timeStr >= 16 && timeStr < 20) return 'Post-Market';
  return 'Closed'; 
};

const formatTime = (date: Date) => {
  return date.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit', 
    second: '2-digit',
    timeZone: 'America/New_York'
  });
};

/* ============================================================
   Deterministic briefing engine — builds the market briefing
   directly from the scanner KV payload. Zero AI cost.
   ============================================================ */

// Acronyms/tickers that should stay uppercase inside Title Case themes
const KEEP_UPPER = new Set(['ETF', 'ETFS', 'QQQ', 'SPY', 'IWM', 'DIA', 'IT', 'AI', 'EV', 'REIT', 'REITS', 'IPO', 'SPAC', 'US', 'USA']);

const titleCase = (input: string): string => {
  return input
    .split(/(\s+|—|–|-|&|\/)/)
    .map(part => {
      const trimmed = part.trim();
      if (!trimmed || /^(\s+|—|–|-|&|\/)$/.test(part)) return part;
      const upper = trimmed.toUpperCase();
      if (KEEP_UPPER.has(upper)) return upper;
      return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
    })
    .join('');
};

const num = (v: any): number => {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
};

const numOrNull = (v: any): number | null => {
  if (v == null || v === '' || v === '—' || v === '-') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
};

// CNF score reader — prefers conviction, then cnfScore, then legacy fields.
const scoreOf = (s: any): number => num(s?.conviction ?? s?.cnfScore ?? s?.smbScore ?? s?.score);
const chgOf = (s: any): number => num(s?.change ?? s?.changePct);
const rvolOf = (s: any): number | null => (s?.rvol != null && !isNaN(Number(s.rvol)) ? Number(s.rvol) : null);
const stageOf = (s: any): string => (s?.stage ? String(s.stage).replace(/Stage\s*/i, '') : '');
const setupOf = (s: any): string | null => {
  const n = s?.setupName;
  if (!n || n === '-' || n === '—') return null;
  if (String(n).includes('BB SQZ')) return 'BB SQZ';
  if (n === 'Blue Dot Rev') return 'BD Rev';
  if (n === 'Episodic Pivot') return 'EP';
  return String(n);
};
const hasRealCatalyst = (s: any): boolean =>
  !!s?.catalyst && !String(s.catalyst).toLowerCase().startsWith('technical momentum');

const catalystTextOf = (s: any): string | null =>
  hasRealCatalyst(s) ? String(s.catalyst).replace(/\.$/, '') : null;

// Dollar volume — prefer the stored dVol, fall back to price * volume.
const dVolOf = (s: any): number => {
  const d = Number(s?.dVol);
  if (!isNaN(d) && d > 0) return d;
  const p = Number(s?.price) || 0;
  const v = Number(s?.volume ?? s?.vol) || 0;
  return p * v;
};

/* ---- 10/21 EMA posture readers ------------------------------
   Tolerant: direct field → computed from price → parsed out of
   the thesis string. Returns null when nothing resolves so the
   10/21 section simply does not render.
   ------------------------------------------------------------ */

const priceOf = (s: any): number | null => numOrNull(s?.price ?? s?.last ?? s?.close);
const ema10Of = (s: any): number | null => numOrNull(s?.ema10 ?? s?.ema10d ?? s?.tenEma ?? s?.ma10 ?? s?.sma10);
const ema21Of = (s: any): number | null => numOrNull(s?.ema21 ?? s?.ema21d ?? s?.twentyOneEma ?? s?.ma21 ?? s?.sma21);

// Percent distance from the 21 EMA (negative = below the line)
const pctFrom21 = (s: any): number | null => {
  const direct = numOrNull(s?.pctFrom21 ?? s?.dist21 ?? s?.pct21 ?? s?.ema21Dist ?? s?.distFrom21);
  if (direct != null) return direct;
  const p = priceOf(s);
  const e21 = ema21Of(s);
  if (p != null && e21 != null && e21 > 0) return ((p - e21) / e21) * 100;
  const t = String(s?.thesis || '');
  const m = t.match(/(\d+(?:\.\d+)?)%\s+(above|below)[^.]*?21\s*EMA/i);
  if (m) return parseFloat(m[1]) * (m[2].toLowerCase() === 'below' ? -1 : 1);
  return null;
};

// Percent distance from the 10 EMA
const pctFrom10 = (s: any): number | null => {
  const direct = numOrNull(s?.pctFrom10 ?? s?.dist10 ?? s?.pct10 ?? s?.ema10Dist ?? s?.distFrom10);
  if (direct != null) return direct;
  const p = priceOf(s);
  const e10 = ema10Of(s);
  if (p != null && e10 != null && e10 > 0) return ((p - e10) / e10) * 100;
  const t = String(s?.thesis || '');
  const m = t.match(/(\d+(?:\.\d+)?)%\s+(above|below)[^.]*?10\s*EMA/i);
  if (m) return parseFloat(m[1]) * (m[2].toLowerCase() === 'below' ? -1 : 1);
  return null;
};

// 21 EMA slope posture
const slope21Of = (s: any): 'rising' | 'flat' | 'falling' | null => {
  const raw = s?.ema21Slope ?? s?.slope21 ?? s?.ema21Trend ?? s?.trend21;
  if (typeof raw === 'number' && !isNaN(raw)) return raw > 0.05 ? 'rising' : raw < -0.05 ? 'falling' : 'flat';
  const txt = (typeof raw === 'string' ? raw : String(s?.thesis || '')).toLowerCase();
  if (/declining|falling|rolling over|down-?slop/.test(txt)) return 'falling';
  if (/rising|up-?slop|advancing|uptrend/.test(txt)) return 'rising';
  if (/\bflat\b/.test(txt)) return 'flat';
  return null;
};

// 10 above 21 (stacked) — direct comparison or inferred from the two distances
const stackedOf = (s: any): boolean | null => {
  const e10 = ema10Of(s);
  const e21 = ema21Of(s);
  if (e10 != null && e21 != null) return e10 > e21;
  const d10 = pctFrom10(s);
  const d21 = pctFrom21(s);
  if (d10 != null && d21 != null) return d21 > d10;
  return null;
};

const fmtDollar = (v: number): string => {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${Math.round(v / 1e3)}K`;
};

const fmtLeader = (s: any): string => {
  const bits = [`${chgOf(s) >= 0 ? '+' : ''}${chgOf(s).toFixed(2)}%`];
  const rv = rvolOf(s);
  if (rv != null && rv > 0) bits.push(`RVOL ${rv.toFixed(2)}`);
  const su = setupOf(s);
  if (su) bits.push(su);
  return `${s.ticker} (${bits.join(', ')})`;
};

// Brief attached under a real news catalyst — why the headline matters mechanically.
const buildCatalystBrief = (s: any): string => {
  const bits: string[] = [];
  const chg = chgOf(s);
  const rv = rvolOf(s);
  const su = setupOf(s);
  const st = stageOf(s);
  const d21 = pctFrom21(s);
  const cnf = scoreOf(s);

  bits.push(`${chg >= 0 ? 'Up' : 'Down'} ${Math.abs(chg).toFixed(2)}%${rv != null && rv > 0 ? ` on RVOL ${rv.toFixed(2)}` : ''}`);

  if (rv != null && rv >= 2) bits.push('heavy participation is validating the headline');
  else if (rv != null && rv >= 1.5) bits.push('volume is confirming');
  else if (rv != null && rv > 0 && rv < 1) bits.push('headline pop without volume — fade risk');

  if (su) bits.push(`${su}${st ? ` in Stage ${st}` : ''}`);
  if (d21 != null) bits.push(`${d21 >= 0 ? '+' : ''}${d21.toFixed(1)}% vs the 21 EMA`);
  if (cnf) bits.push(`CNF ${cnf}`);

  return bits.join(' · ') + '.';
};

const buildWatchReason = (s: any): string => {
  const parts: string[] = [];
  const su = setupOf(s);
  const st = stageOf(s);
  const rv = rvolOf(s);

  let lead = su || 'Momentum move';
  if (st) lead += ` in Stage ${st}`;
  if (rv != null && rv > 0) lead += ` with RVOL ${rv.toFixed(2)}`;
  parts.push(lead);

  if (rv != null) {
    if (rv >= 2) parts.push('heavy participation confirms the move');
    else if (rv >= 1.5) parts.push('solid volume backing');
    else if (rv > 0 && rv < 1) parts.push('price without volume — fade risk');
  }

  // 10/21 posture clause
  const d21 = pctFrom21(s);
  const d10 = pctFrom10(s);
  const slope = slope21Of(s);
  if (d21 != null) {
    if (d21 > 0 && d10 != null && d10 < 0) {
      parts.push(`in the 10/21 pullback zone (+${d21.toFixed(1)}% over the 21, under the 10)`);
    } else if (d21 > 0) {
      parts.push(`+${d21.toFixed(1)}% over a${slope === 'rising' ? ' rising' : slope === 'falling' ? ' declining' : slope === 'flat' ? ' flat' : ''} 21 EMA`);
    } else {
      parts.push(`${d21.toFixed(1)}% under the 21 EMA — trend needs repair`);
    }
  }

  if (s?.stochK != null && !isNaN(Number(s.stochK))) {
    const k = Number(s.stochK);
    if (k <= 25) parts.push(`stoch ${k.toFixed(0)} (oversold reset)`);
  }
  if (s?.rsVsSpy != null && !isNaN(Number(s.rsVsSpy)) && Number(s.rsVsSpy) >= 10) {
    parts.push(`RS +${Number(s.rsVsSpy).toFixed(0)} vs SPY`);
  }

  const tt = s?.tradeType ? String(s.tradeType).toLowerCase() : null;
  if (tt?.startsWith('day')) parts.push('classified DAY — intraday only');
  else if (tt?.startsWith('swing')) parts.push('classified SWING — multi-day hold viable');

  // Catalyst intentionally omitted here — it renders as its own chip on the card.

  return parts.join('; ') + '.';
};

/* ---- 10/21 Thesis paragraph builder ---- */
const build1021Para = (pool: any[]): string => {
  const rows = pool
    .filter(s => s?.ticker)
    .map(s => ({
      ticker: s.ticker,
      d21: pctFrom21(s),
      d10: pctFrom10(s),
      stacked: stackedOf(s),
      slope: slope21Of(s),
    }))
    .filter(r => r.d21 != null);

  if (rows.length < 2) return '';

  const aligned = rows.filter(r => (r.d21 as number) > 0 && (r.d10 == null || (r.d10 as number) > 0));
  const pullback = rows.filter(r => (r.d21 as number) > 0 && r.d10 != null && (r.d10 as number) <= 0);
  const broken = rows.filter(r => (r.d21 as number) <= 0);
  const badSlope = rows.filter(r => r.slope === 'falling' || r.slope === 'flat');
  const unstacked = rows.filter(r => r.stacked === false);

  // Pre-cross: 10 still under the 21 but within ~1% of it and price holding —
  // the earliest entry, coiling into the cross before it fires.
  const precross = rows.filter(r =>
    r.stacked === false && r.d10 != null && r.d21 != null &&
    Math.abs((r.d10 as number) - (r.d21 as number)) <= 1.5 && (r.d21 as number) > -3
  );

  const lines: string[] = [];

  if (aligned.length) {
    lines.push(`Trend-aligned (holding above both the 10 and 21 EMA): ${aligned.map(r => r.ticker).slice(0, 6).join(', ')} — buy the pullback, these have the cleanest structure.`);
  } else {
    lines.push(`Nothing in the scan holds above both the 10 and 21 EMA — no clean trend-aligned entries on the board.`);
  }

  if (pullback.length) {
    lines.push(`Pullback zone (under the 10, still over the 21): ${pullback.map(r => r.ticker).slice(0, 6).join(', ')} — first-touch buys live here.`);
  }

  if (precross.length) {
    lines.push(`Pre-cross (10 coiling up into the 21, about to flip): ${precross.map(r => r.ticker).slice(0, 6).join(', ')} — earliest entry, size small until the cross confirms.`);
  }

  if (broken.length) {
    const avgBroken = broken.reduce((a, r) => a + (r.d21 as number), 0) / broken.length;
    lines.push(`Below the 21 EMA and in repair: ${broken.map(r => r.ticker).slice(0, 6).join(', ')} (avg ${avgBroken.toFixed(1)}% under the line) — no-touch until reclaimed.`);
  }

  if (unstacked.length && !precross.length) {
    lines.push(`${unstacked.length} show the 10 under the 21 — short-term trend is still inverted, wait for the cross.`);
  } else if (badSlope.length) {
    lines.push(`${badSlope.length} sit under a flat or declining 21 EMA — no slope to lean on yet.`);
  }

  const avgAll = rows.reduce((a, r) => a + (r.d21 as number), 0) / rows.length;
  lines.push(avgAll >= 10
    ? `Group averages +${avgAll.toFixed(1)}% from the 21 EMA — extended, size down and let it come back to the line.`
    : avgAll >= 0
      ? `Group averages +${avgAll.toFixed(1)}% from the 21 EMA — healthy distance, not stretched.`
      : `Group averages ${avgAll.toFixed(1)}% from the 21 EMA — the tape is below its own trend line.`);

  return `10/21 Thesis: ${lines.join('\n')}`;
};

/* ---- EP9M readers — the ep9m payload uses its own field names ---- */
const ep9mVs60dOf = (s: any): number | null => numOrNull(s?.volVs60dMax);
const ep9mUnprec = (s: any): boolean => s?.unprecedented === true;
const ep9mTurnOf = (s: any): number | null => numOrNull(s?.floatTurnover);
const ep9mSilent = (s: any): boolean => !hasRealCatalyst(s);

/* ---- Blended idea score — ranks watchlist candidates by more than raw CNF.
   CNF is the base; RVOL and a real catalyst add weight so a volume-confirmed
   name with news outranks a high-CNF name that is quiet. ---- */
const blendedScore = (s: any): number => {
  let v = scoreOf(s);
  const rv = rvolOf(s);
  if (rv != null) {
    if (rv >= 2) v += 12;
    else if (rv >= 1.5) v += 7;
    else if (rv < 1 && rv > 0) v -= 6; // price without volume — demote
  }
  if (hasRealCatalyst(s)) v += 8;
  if (ep9mUnprec(s)) v += 6;
  const d21 = pctFrom21(s);
  const d10 = pctFrom10(s);
  if (d21 != null && d21 > 0 && d10 != null && d10 <= 0) v += 5; // pullback-zone entry
  return v;
};

/* ---- Regime line — one-verdict market posture from breadth + ETF flow ---- */
const buildRegimePara = (flowNames: any[], etfs: { chg: number; dVol: number }[]): string => {
  const totalD = flowNames.reduce((a, s) => a + dVolOf(s), 0);
  if (totalD <= 0) return '';
  const advD = flowNames.filter(s => chgOf(s) > 0).reduce((a, s) => a + dVolOf(s), 0);
  const advShare = Math.round((advD / totalD) * 100);

  const etfUp = etfs.filter(e => e.chg > 0).reduce((a, e) => a + e.dVol, 0);
  const etfTot = etfs.reduce((a, e) => a + e.dVol, 0);
  const etfShare = etfTot > 0 ? Math.round((etfUp / etfTot) * 100) : null;

  let verdict: string;
  let action: string;
  if (advShare >= 60 && (etfShare == null || etfShare >= 55)) {
    verdict = 'Risk-On';
    action = 'buy leaders on strength, breakouts have follow-through behind them.';
  } else if (advShare <= 40 && (etfShare == null || etfShare <= 45)) {
    verdict = 'Defensive';
    action = 'tighten up — most dollars are on the sell side, fade rips rather than chase.';
  } else {
    verdict = 'Mixed';
    action = 'stock-picker\'s tape — no broad wind, stay in the highest-conviction names only.';
  }

  const bits = [`${advShare}% of tracked dollars on the advancing side`];
  if (etfShare != null) bits.push(`ETF flow ${etfShare}% green`);
  return `Regime: ${verdict} — ${bits.join(', ')}. ${action}`;
};

/* ---- Top Movers — the actual biggest movers, RVOL-confirmed, as a trade list ---- */
const buildMoversPara = (movers: any): string => {
  const gainers: any[] = Array.isArray(movers?.['Gainers']) ? movers['Gainers'] : [];
  const losers: any[] = Array.isArray(movers?.['Losers']) ? movers['Losers'] : [];
  if (gainers.length === 0 && losers.length === 0) return '';

  const fmtMover = (s: any): string => {
    const bits = [`${chgOf(s) >= 0 ? '+' : ''}${chgOf(s).toFixed(2)}%`];
    const rv = rvolOf(s);
    if (rv != null && rv > 0) bits.push(`RVOL ${rv.toFixed(2)}`);
    return `${s.ticker} (${bits.join(', ')})`;
  };

  const topG = gainers
    .slice()
    .sort((a, b) => chgOf(b) - chgOf(a))
    .slice(0, 4);
  const topL = losers
    .slice()
    .sort((a, b) => chgOf(a) - chgOf(b))
    .slice(0, 3);

  const lines: string[] = [];
  if (topG.length) {
    const confirmed = topG.filter(s => (rvolOf(s) ?? 0) >= 1.5);
    lines.push(`Leading the tape: ${topG.map(fmtMover).join(', ')}.`);
    if (confirmed.length) {
      lines.push(`Volume-confirmed of those: ${confirmed.map(s => s.ticker).join(', ')} — RVOL over 1.5 means the move has real participation, not just a thin gap.`);
    } else {
      lines.push('None of the top gainers carry RVOL over 1.5 — moves are thin, treat as fade candidates rather than momentum longs.');
    }
  }
  if (topL.length) {
    lines.push(`Heaviest red: ${topL.map(fmtMover).join(', ')} — weakness leaders for short setups or names to avoid on the long side.`);
  }
  return `Top Movers: ${lines.join('\n')}`;
};

/* ---- EP9M Thesis — abnormal-volume institutional footprints ---- */
const buildEp9mPara = (ep9m: any[]): string => {
  const rows = ep9m.filter(s => s?.ticker);
  if (rows.length < 1) return '';

  const fmtEp = (s: any): string => {
    const bits: string[] = [];
    const vs = ep9mVs60dOf(s);
    if (vs != null) bits.push(`${vs.toFixed(2)}× 60d high`);
    const rv = rvolOf(s);
    if (rv != null && rv > 0) bits.push(`RVOL ${rv.toFixed(2)}`);
    const turn = ep9mTurnOf(s);
    if (turn != null && turn >= 0.25) bits.push(`${turn.toFixed(2)}× float`);
    return `${s.ticker}${bits.length ? ` (${bits.join(', ')})` : ''}`;
  };

  const unprec = rows.filter(ep9mUnprec).sort((a, b) => (ep9mVs60dOf(b) ?? 0) - (ep9mVs60dOf(a) ?? 0));
  const silent = rows.filter(ep9mSilent).sort((a, b) => (rvolOf(b) ?? 0) - (rvolOf(a) ?? 0));
  const news = rows.filter(hasRealCatalyst).sort((a, b) => scoreOf(b) - scoreOf(a));

  const lines: string[] = [];
  if (unprec.length) {
    lines.push(`Unprecedented volume (today beats their own 60-day record): ${unprec.slice(0, 5).map(fmtEp).join(', ')} — institutions are accumulating ahead of the story.`);
  }
  if (silent.length) {
    lines.push(`Silent — heavy volume, no headline yet: ${silent.slice(0, 5).map(s => s.ticker).join(', ')}. The footprint is visible before the news; these are the research-now names.`);
  }
  if (news.length) {
    lines.push(`With a catalyst already out: ${news.slice(0, 4).map(s => s.ticker).join(', ')}.`);
  }
  if (!lines.length) {
    lines.push(`${rows.length} name${rows.length !== 1 ? 's' : ''} trading abnormal size — ${rows.slice(0, 6).map(fmtEp).join(', ')}.`);
  }
  return `EP9M Thesis: ${lines.join('\n')}`;
};

const buildLocalInsights = (scan: any, ep9mList: any[] = []): MacroInsights | null => {
  const sips: any[] = Array.isArray(scan?.stocksInPlay) ? scan.stocksInPlay : [];
  const daily: any[] = Array.isArray(scan?.dailySetups) ? scan.dailySetups : [];
  const ep9m: any[] = Array.isArray(ep9mList) ? ep9mList.filter(s => s?.ticker) : [];
  const movers = scan?.topMovers || {};
  if (sips.length === 0 && daily.length === 0 && ep9m.length === 0) return null;

  /* ---- Watchlist: top 6 by BLENDED score across SIPs + Daily + EP9M, deduped.
     Blended score weights CNF with RVOL confirmation and catalyst presence so
     the six names shown are the best ideas, not merely the highest raw score. ---- */
  const pool = [...sips, ...daily, ...ep9m].filter(s => s?.ticker);
  const seen = new Set<string>();
  const ranked = pool
    .slice()
    .sort((a, b) => blendedScore(b) - blendedScore(a))
    .filter(s => {
      if (seen.has(s.ticker)) return false;
      seen.add(s.ticker);
      return true;
    })
    .slice(0, 6);

  const watching: WatchItem[] = ranked.map(s => ({
    symbol: s.ticker,
    score: scoreOf(s) || undefined,
    reason: buildWatchReason(s),
    catalyst: catalystTextOf(s),
    catalystUrl: s?.catalystUrl || null,
  }));

  /* ---- Top catalysts: up to 3 highest-conviction names with real headlines ---- */
  const withNews = pool
    .filter(hasRealCatalyst)
    .slice()
    .sort((a, b) => scoreOf(b) - scoreOf(a))
    .filter((s, i, arr) => arr.findIndex(x => x.ticker === s.ticker) === i);
  const topCatalyst: TopCatalyst | null = withNews.length
    ? {
        ticker: withNews[0].ticker,
        // Prefer the actual news line; only fall back to the technical thesis.
        headline: String(withNews[0].catalyst || withNews[0].thesis).replace(/\.$/, ''),
        url: withNews[0].catalystUrl || null,
        brief: buildCatalystBrief(withNews[0]),
      }
    : null;
  const topCatalysts: TopCatalyst[] = withNews.slice(0, 3).map(s => ({
    ticker: s.ticker,
    headline: String(s.catalyst || s.thesis).replace(/\.$/, ''),
    url: s.catalystUrl || null,
    brief: buildCatalystBrief(s),
  }));

  /* ---- Flow universe: all scanned stocks, deduped by ticker ---- */
  const stockLists = [
    ...sips, ...daily, ...ep9m,
    ...(movers['Gainers'] || []), ...(movers['Losers'] || []), ...(movers['Mega Caps'] || []),
  ];
  const flowSeen = new Set<string>();
  const flowNames = stockLists.filter(s => {
    if (!s?.ticker || flowSeen.has(s.ticker)) return false;
    flowSeen.add(s.ticker);
    return true;
  });

  /* ---- Theme: dominant sectors among ranked + A-grade count ---- */
  const sectorCounts: Record<string, number> = {};
  ranked.forEach(s => {
    const sec = s?.sector && s.sector !== '—' ? String(s.sector) : null;
    if (sec) sectorCounts[sec] = (sectorCounts[sec] || 0) + 1;
  });
  const topSectors = Object.entries(sectorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([sec]) => sec);
  const aCount = ranked.filter(s => scoreOf(s) >= 70).length;
  const rawTheme = `${topSectors.length ? topSectors.join(' & ') : 'Broad Market'} In Focus — ${aCount > 0 ? `${aCount} A-Grade Setup${aCount > 1 ? 's' : ''}` : 'Momentum Watch'}`;
  const theme = titleCase(rawTheme);

  /* ---- Paragraph 1: SIPs Thesis — one sentence per line, no count ---- */
  const sipsSorted = sips.slice().sort((a, b) => (rvolOf(b) ?? 0) - (rvolOf(a) ?? 0));
  const leaders = sipsSorted.filter(s => (rvolOf(s) ?? 0) >= 1.5).slice(0, 3);
  const grinders = sips.filter(s => rvolOf(s) != null && (rvolOf(s) as number) < 1).map(s => s.ticker).slice(0, 7);
  const newsNames = sips.filter(hasRealCatalyst).map(s => s.ticker).slice(0, 4);

  const sipsLines: string[] = [];
  if (leaders.length) {
    sipsLines.push(`Volume-confirmed leadership from ${leaders.map(fmtLeader).join(', ')} — RVOL above 1.5 signals real participation behind the move.`);
  }
  if (newsNames.length) {
    sipsLines.push(`News-driven: ${newsNames.join(', ')}.`);
  }
  if (grinders.length) {
    sipsLines.push(`${grinders.join(', ')} ${grinders.length > 1 ? 'are' : 'is'} moving on sub-1.0 RVOL — price without volume, prone to fading by close.`);
  }
  const sipsPara = sipsLines.length
    ? `SIPs Thesis: ${sipsLines.join('\n')}`
    : (sips.length ? `SIPs Thesis: No volume-confirmed leaders yet.` : '');

  /* ---- Paragraph 2: Daily Setups Thesis — one sentence per line ---- */
  const dayCt = daily.filter(s => String(s?.tradeType || '').toLowerCase().startsWith('day')).length;
  const swingCt = daily.filter(s => String(s?.tradeType || '').toLowerCase().startsWith('swing')).length;
  const dailyTop = daily.slice().sort((a, b) => scoreOf(b) - scoreOf(a)).slice(0, 3);
  const stage2Ct = daily.filter(s => String(s?.stage || '').includes('2')).length;

  const dailyLines: string[] = [];
  if (dayCt || swingCt) {
    dailyLines.push(`${swingCt} classified SWING (structure supports a multi-day hold), ${dayCt} DAY (intraday momentum only).`);
  }
  if (stage2Ct > 0) {
    dailyLines.push(`${stage2Ct} of ${daily.length} sit in constructive Stage 2 bases.`);
  }
  if (dailyTop.length) {
    dailyLines.push(`Highest conviction by CNF score: ${dailyTop.map(s => `${s.ticker} (${scoreOf(s)})`).join(', ')}.`);
  }
  const dailyPara = dailyLines.length ? `Daily Setups Thesis: ${dailyLines.join('\n')}` : '';

  /* ---- Paragraph 3: 10/21 Thesis — trend posture across the scan ---- */
  const ema1021Para = build1021Para(pool);

  /* ---- Paragraph 4: Industry Heat — one sentence per line ---- */
  const heatAgg: Record<string, { sum: number; count: number }> = {};
  flowNames.forEach(s => {
    const sec = s?.sector && s.sector !== '—' && s.sector !== 'Other' ? String(s.sector) : null;
    if (!sec) return;
    if (!heatAgg[sec]) heatAgg[sec] = { sum: 0, count: 0 };
    heatAgg[sec].sum += chgOf(s);
    heatAgg[sec].count += 1;
  });
  const heat = Object.entries(heatAgg)
    .map(([sector, v]) => ({ sector, avgChg: v.sum / v.count, count: v.count }))
    .sort((a, b) => b.avgChg - a.avgChg);

  let heatPara = '';
  if (heat.length >= 2) {
    const fmtHeat = (h: { sector: string; avgChg: number; count: number }) =>
      `${h.sector} (${h.avgChg >= 0 ? '+' : ''}${h.avgChg.toFixed(1)}% avg, ${h.count} name${h.count !== 1 ? 's' : ''})`;
    const hot = heat.filter(h => h.avgChg > 0).slice(0, 3);
    const cold = heat.filter(h => h.avgChg < 0).slice(-3).reverse();
    const heatLines: string[] = [];
    if (hot.length && cold.length) {
      heatLines.push(`Strongest groups are ${hot.map(fmtHeat).join(', ')}.`);
      heatLines.push(`Weakest are ${cold.map(fmtHeat).join(', ')}.`);
      const spread = hot[0].avgChg - cold[0].avgChg;
      heatLines.push(spread >= 8
        ? 'Wide dispersion between groups — a stock-picker\'s tape, stay in the leaders.'
        : 'Group dispersion is narrow — moves are market-driven more than industry-driven.');
    } else if (hot.length) {
      heatLines.push(`All tracked groups lean green, led by ${hot.map(fmtHeat).join(', ')} — broad industry participation.`);
    } else if (cold.length) {
      heatLines.push(`All tracked groups lean red, heaviest in ${cold.map(fmtHeat).join(', ')} — no industry shelter today.`);
    }
    if (heatLines.length) heatPara = `Industry Heat: ${heatLines.join('\n')}`;
  }

  /* ---- Paragraph 5: ETF Flow — one sentence per line ---- */
  const etfAll = [...(movers['ETF Gainers'] || []), ...(movers['ETF Losers'] || [])];
  const etfSeen = new Set<string>();
  const etfs = etfAll
    .filter(e => {
      if (!e?.ticker || etfSeen.has(e.ticker)) return false;
      etfSeen.add(e.ticker);
      return true;
    })
    .map(e => ({ ticker: e.ticker, dVol: dVolOf(e), chg: chgOf(e) }))
    .filter(e => e.dVol > 0)
    .sort((a, b) => b.dVol - a.dVol);

  let etfPara = '';
  if (etfs.length) {
    const fmtE = (e: { ticker: string; dVol: number; chg: number }) =>
      `${e.ticker} ${fmtDollar(e.dVol)} (${e.chg >= 0 ? '+' : ''}${e.chg.toFixed(2)}%)`;
    const top = etfs.slice(0, 4);
    const upD = etfs.filter(e => e.chg > 0).reduce((a, e) => a + e.dVol, 0);
    const totD = etfs.reduce((a, e) => a + e.dVol, 0);
    const upShare = totD > 0 ? Math.round((upD / totD) * 100) : 0;
    const etfLines: string[] = [];
    etfLines.push(`Heaviest dollar volume in ${top.map(fmtE).join(', ')}.`);
    etfLines.push(upShare >= 60
      ? `${upShare}% of ETF dollars are on the advancing side — money is chasing strength.`
      : upShare <= 40
        ? `Only ${upShare}% of ETF dollars are on the advancing side — flows favor the short/defensive vehicles.`
        : `ETF dollars are split ${upShare}/${100 - upShare} between advancing and declining vehicles — no clean directional bet.`);
    etfPara = `ETF Flow: ${etfLines.join('\n')}`;
  }

  /* ---- Paragraph 6: Money Flow — one sentence per line ---- */
  let moneyPara = '';
  const totalD = flowNames.reduce((a, s) => a + dVolOf(s), 0);
  if (totalD > 0) {
    const advD = flowNames.filter(s => chgOf(s) > 0).reduce((a, s) => a + dVolOf(s), 0);
    const advShare = Math.round((advD / totalD) * 100);
    const magnets = flowNames
      .slice()
      .sort((a, b) => dVolOf(b) - dVolOf(a))
      .slice(0, 3)
      .map(s => `${s.ticker} ${fmtDollar(dVolOf(s))} (${chgOf(s) >= 0 ? '+' : ''}${chgOf(s).toFixed(2)}%)`);

    const inflowAgg: Record<string, number> = {};
    flowNames.filter(s => chgOf(s) > 0).forEach(s => {
      const sec = s?.sector && s.sector !== '—' && s.sector !== 'Other' ? String(s.sector) : null;
      if (sec) inflowAgg[sec] = (inflowAgg[sec] || 0) + dVolOf(s);
    });
    const topInflows = Object.entries(inflowAgg).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([sec]) => sec);

    const moneyLines: string[] = [];
    let firstLine = `${fmtDollar(totalD)} in tracked dollar volume, ${advShare}% riding the advancing side`;
    firstLine += advShare >= 60 ? ' — buyers are paying up.' : advShare <= 40 ? ' — sellers control the tape\'s dollars.' : ' — a two-sided fight.';
    moneyLines.push(firstLine);
    if (magnets.length) moneyLines.push(`Dollar magnets: ${magnets.join(', ')}.`);
    if (topInflows.length) moneyLines.push(`Inflows concentrate in ${topInflows.join(' & ')}.`);
    moneyPara = `Money Flow: ${moneyLines.join('\n')}`;
  }

  /* ---- New sections: Regime (verdict), Top Movers, EP9M ---- */
  const regimePara = buildRegimePara(flowNames, etfs);
  const moversPara = buildMoversPara(movers);
  const ep9mPara = buildEp9mPara(ep9m);

  /* ---- Assemble in reading order: verdict first, then ideas, then flow.
     Empty sections drop out; if a whole section is quiet we still surface a
     short note (below) rather than letting it vanish silently. ---- */
  // Quiet-section notes: if a core idea section produced nothing but the scan
  // clearly ran, surface a one-line "quiet" note so it reads as "nothing here
  // today" rather than a broken/absent section.
  const sipsFinal = sipsPara || (sips.length === 0 && (daily.length || ep9m.length) ? 'SIPs Thesis: No stocks in play in the current scan.' : '');
  const dailyFinal = dailyPara || (daily.length === 0 && (sips.length || ep9m.length) ? 'Daily Setups Thesis: No daily setups on the board right now.' : '');
  const ep9mFinal = ep9mPara || (ep9m.length === 0 && (sips.length || daily.length) ? 'EP9M Thesis: No names trading abnormal 9M+ size yet — this fills in as session volume builds.' : '');

  const orderedParas = [
    regimePara,
    moversPara,
    sipsFinal,
    dailyFinal,
    ema1021Para,
    ep9mFinal,
    heatPara,
    etfPara,
    moneyPara,
  ];

  const briefing = orderedParas.filter(Boolean).join('\n\n');

  return {
    theme,
    briefing,
    watching,
    topCatalyst,
    topCatalysts,
  };
};

/* ============================================================
   Briefing/session text renderer — badges tickers + index names,
   colors percents, metrics, and dollar values. Values render
   regular weight and one size smaller than the body text.
   ============================================================ */

// Label/acronym tokens that must NOT be badged as tickers
const TICKER_STOPWORDS = new Set([
  'RVOL', 'CNF', 'SMB', 'DAY', 'SWING', 'BD', 'REV', 'EP', 'BB', 'SQZ',
  'GLB', 'VCP', 'PB', 'GO', 'GC', 'EMA', 'SMA', 'MACD', 'ATR', 'RS', 'R2G',
  'ETF', 'ETFS', 'STAGE', 'A', 'I', 'AND', 'THE', 'IS', 'ARE',
  'IN', 'OF', 'BY', 'VS', 'ON', 'TO', 'UP', 'AT', 'OR', 'IT', 'AI',
  'US', 'USA', 'FDA', 'SEC', 'IPO', 'CEO', 'EPS', 'FY', 'Q',
  'EST', 'PM', 'AM',
]);

// Inline chip — compact gray, matching the CNF badge look
const tickerChipCls = "inline-block align-baseline text-[10px] font-bold text-slate-300 bg-slate-500/10 px-1.5 py-[1px] rounded border border-white/10 tracking-wider mx-0.5";
// Colored numeric values — slightly smaller than the 13px body
const valNum = "text-[12px] tabular-nums";

const rvolColor = (v: number) => (v >= 2 ? 'text-amber-400' : v >= 1.5 ? 'text-emerald-400' : 'text-slate-400');
const stageColor = (st: string) => {
  if (st.includes('1')) return 'text-slate-400';
  if (st.includes('2')) return 'text-emerald-400';
  if (st.includes('3')) return 'text-amber-400';
  if (st.includes('4')) return 'text-rose-400';
  return 'text-slate-400';
};
const stochColor = (k: number) => (k <= 20 ? 'text-purple-400' : k <= 30 ? 'text-emerald-400' : 'text-slate-400');
const rsColor = (rs: number) => (rs >= 20 ? 'text-purple-400' : rs >= 10 ? 'text-emerald-400' : rs >= 0 ? 'text-slate-300' : 'text-rose-400');

const renderBriefingText = (text: string): React.ReactNode[] => {
  // Capture metric phrases first (longest match), then index/asset names,
  // then dollar values, signed percents, and uppercase ticker-like tokens.
  const rx = /(RVOL \d+(?:\.\d+)?|Stage \d[AB]?|stoch \d+(?:\.\d+)?|RS \+?\d+(?:\.\d+)?|10\/21|S&P|Nasdaq|Dow|Bitcoin|\$\d+(?:\.\d+)?[BMK]|[+-]\d+(?:\.\d+)?%|\b[A-Z]{1,5}\b)/g;
  const parts = text.split(rx);

  return parts.map((part, i) => {
    if (!part) return null;

    // RVOL n.nn — table thresholds: amber >=2, emerald >=1.5
    let m = part.match(/^RVOL (\d+(?:\.\d+)?)$/);
    if (m) {
      const v = parseFloat(m[1]);
      return <span key={i}>RVOL <span className={`${valNum} ${rvolColor(v)}`}>{m[1]}</span></span>;
    }

    // Stage 2A etc — table stage colors
    m = part.match(/^Stage (\d[AB]?)$/);
    if (m) {
      return <span key={i}>Stage <span className={`${valNum} ${stageColor(m[1])}`}>{m[1]}</span></span>;
    }

    // stoch nn — purple deep oversold, emerald oversold
    m = part.match(/^stoch (\d+(?:\.\d+)?)$/);
    if (m) {
      const v = parseFloat(m[1]);
      return <span key={i}>stoch <span className={`${valNum} ${stochColor(v)}`}>{m[1]}</span></span>;
    }

    // RS +nn — purple elite, emerald strong
    m = part.match(/^RS (\+?\d+(?:\.\d+)?)$/);
    if (m) {
      const v = parseFloat(m[1]);
      return <span key={i}>RS <span className={`${valNum} ${rsColor(v)}`}>{m[1]}</span></span>;
    }

    // 10/21 pair label — violet, matches the section rule
    if (part === '10/21') {
      return <span key={i} className={`${valNum} text-violet-400 font-bold`}>10/21</span>;
    }

    // Index/asset names — gray badge
    if (part === 'S&P' || part === 'Nasdaq' || part === 'Dow' || part === 'Bitcoin') {
      return <span key={i} className={tickerChipCls}>{part}</span>;
    }

    // Dollar values ($4.2B / $850M) — neutral, slightly brighter
    if (/^\$\d+(?:\.\d+)?[BMK]$/.test(part)) {
      return <span key={i} className={`${valNum} text-slate-200`}>{part}</span>;
    }

    // Signed percent — green/red
    if (/^[+]\d+(?:\.\d+)?%$/.test(part)) {
      return <span key={i} className={`${valNum} text-emerald-400`}>{part}</span>;
    }
    if (/^-\d+(?:\.\d+)?%$/.test(part)) {
      return <span key={i} className={`${valNum} text-rose-400`}>{part}</span>;
    }

    // Trade-type classifications — match the DailySetups pill colors
    if (part === 'DAY') return <span key={i} className="text-amber-400">DAY</span>;
    if (part === 'SWING') return <span key={i} className="text-cyan-400">SWING</span>;

    // Ticker — compact gray chip, unless it's a known label/acronym
    if (/^[A-Z]{2,5}$/.test(part) && !TICKER_STOPWORDS.has(part)) {
      return <span key={i} className={tickerChipCls}>{part}</span>;
    }

    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
};

/* ============================================================
   Briefing paragraph blocks — label lifted into a colored badge,
   body in a bubble with a colored left rule. Multi-line bodies
   (\n-separated sentences) render one sentence per line.
   ============================================================ */

const BRIEFING_SECTIONS: { label: string; color: string }[] = [
  { label: 'Regime', color: 'violet' },
  { label: 'Top Movers', color: 'emerald' },
  { label: 'SIPs Thesis', color: 'cyan' },
  { label: 'Daily Setups Thesis', color: 'emerald' },
  { label: '10/21 Thesis', color: 'violet' },
  { label: 'EP9M Thesis', color: 'rose' },
  { label: 'Industry Heat', color: 'amber' },
  { label: 'ETF Flow', color: 'indigo' },
  { label: 'Money Flow', color: 'rose' },
  { label: 'Sector Flow', color: 'indigo' },
];

const sectionStyles = (color: string) => {
  switch (color) {
    case 'cyan': return { border: 'border-cyan-500', badge: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20', bg: 'bg-cyan-500/[0.04]' };
    case 'emerald': return { border: 'border-emerald-500', badge: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', bg: 'bg-emerald-500/[0.04]' };
    case 'amber': return { border: 'border-amber-500', badge: 'text-amber-400 bg-amber-500/10 border-amber-500/20', bg: 'bg-amber-500/[0.04]' };
    case 'rose': return { border: 'border-rose-500', badge: 'text-rose-400 bg-rose-500/10 border-rose-500/20', bg: 'bg-rose-500/[0.04]' };
    case 'violet': return { border: 'border-violet-500', badge: 'text-violet-400 bg-violet-500/10 border-violet-500/20', bg: 'bg-violet-500/[0.04]' };
    case 'indigo': default: return { border: 'border-indigo-500', badge: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20', bg: 'bg-indigo-500/[0.04]' };
  }
};

const splitBriefingSection = (para: string): { label: string | null; color: string; body: string } => {
  for (const sec of BRIEFING_SECTIONS) {
    if (para.startsWith(`${sec.label}:`)) {
      return { label: sec.label, color: sec.color, body: para.slice(sec.label.length + 1).trim() };
    }
  }
  return { label: null, color: 'indigo', body: para };
};

export default function MarketSummary() {
  const [data, setData] = useState<SummaryData | null>(null);
  const [macroInsights, setMacroInsights] = useState<MacroInsights | null>(null);
  const [status, setStatus] = useState<'Loading' | 'Synced' | 'Error'>('Loading');
  const [session, setSession] = useState<MarketSession>('Closed');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(true);

  useEffect(() => {
    setSession(getMarketSession());
    const sessionTimer = setInterval(() => setSession(getMarketSession()), 60000);
    return () => clearInterval(sessionTimer);
  }, []);

  useEffect(() => {
    let isMounted = true;

    const fetchData = async () => {
      // 1. Load the stored session summary (morning/midday/closing blocks)
      try {
        const res = await fetch('/api/market-summary/latest', { cache: 'no-store' });
        if (res.ok) {
          const json = await res.json();
          if (isMounted && json?.success && json.data) {
            setData(json.data);
          }
        }
      } catch (error) {
        console.error("Summary Sync Error:", error);
      }

      // 2. Build Market Briefing deterministically from scanner data (no AI).
      //    EP9M lives on its own endpoint, so fetch both in parallel. The
      //    ep9m call is defensive: if it fails or is empty, the briefing still
      //    builds from the scanner payload alone.
      try {
        const [scannerRes, ep9mRes] = await Promise.all([
          fetch('/api/scanner/latest', { cache: 'no-store' }),
          fetch(`/api/ep9m/latest?t=${Date.now()}`, { cache: 'no-store' }).catch(() => null),
        ]);
        if (!scannerRes.ok) throw new Error(`Scanner API returned status: ${scannerRes.status}`);

        const scannerData = await scannerRes.json();

        let ep9mList: any[] = [];
        try {
          if (ep9mRes && ep9mRes.ok) {
            const ep9mData = await ep9mRes.json();
            if (ep9mData && Array.isArray(ep9mData.candidates)) ep9mList = ep9mData.candidates;
          }
        } catch { /* ep9m is optional — ignore parse errors */ }

        if (isMounted) {
          const local = buildLocalInsights(scannerData, ep9mList);
          if (local) {
            setMacroInsights(local);
          } else if (scannerData.macroInsights) {
            // Fallback to stored payload if scan data is empty
            setMacroInsights(scannerData.macroInsights);
          }
        }
      } catch (error) {
        console.error("Scanner Macro Sync Error:", error);
      }

      // Finish Sync
      if (isMounted) {
        setStatus('Synced');
        setLastUpdated(new Date());
      }
    };

    fetchData();
    const dataTimer = setInterval(fetchData, 60000);
    return () => { isMounted = false; clearInterval(dataTimer); };
  }, []);

  const getThemeStyles = (theme: string) => {
    switch (theme) {
      case 'cyan': return { border: 'border-cyan-500/30', badge: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20', accent: 'text-cyan-400' };
      case 'emerald': return { border: 'border-emerald-500/30', badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', accent: 'text-emerald-400' };
      case 'amber': return { border: 'border-amber-500/30', badge: 'bg-amber-500/10 text-amber-400 border-amber-500/20', accent: 'text-amber-400' };
      case 'rose': return { border: 'border-rose-500/30', badge: 'bg-rose-500/10 text-rose-400 border-rose-500/20', accent: 'text-rose-400' };
      case 'indigo': default: return { border: 'border-indigo-500/30', badge: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20', accent: 'text-indigo-400' };
    }
  };

  const getSessionColor = () => {
    switch (session) {
      case 'Pre-Market': return 'text-amber-500';
      case 'Open': return 'text-[#00e676]';
      case 'Post-Market': return 'text-indigo-400';
      default: return 'text-slate-500';
    }
  };

  const formatBriefing = (text: string) => {
    if (!text) return "";
    return text
      .replace(/(Top Movers:)/gi, '\n\n$1')
      .replace(/(SIPs Thesis:)/gi, '\n\n$1')
      .replace(/(Daily Setups Thesis:)/gi, '\n\n$1')
      .replace(/(10\/21 Thesis:)/gi, '\n\n$1')
      .replace(/(EP9M Thesis:)/gi, '\n\n$1')
      .replace(/(Industry Heat:)/gi, '\n\n$1')
      .replace(/(ETF Flow:)/gi, '\n\n$1')
      .replace(/(Money Flow:)/gi, '\n\n$1')
      .replace(/(Sector Flow:)/gi, '\n\n$1');
  };

  const renderSingleUpdateBlock = (block: UpdateBlock | null) => {
    if (!block) return null;
    const styles = getThemeStyles(block.colorTheme);

    return (
      <div className="bg-[#161c2a]/60 border border-white/5 rounded-xl p-5 md:p-6 mt-3">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <span className={`text-[10px] font-bold tracking-widest uppercase px-2.5 py-1 rounded border ${styles.badge}`}>
            {block.phase}
          </span>
          <span className="text-[11px] text-slate-500 font-medium tracking-wide">{block.timestamp}</span>
        </div>
        {block.paragraphs.map((para, idx) => (
          <p key={idx} className="text-[13px] text-slate-300 leading-relaxed mb-3 last:mb-0">
            {renderBriefingText(para)}
          </p>
        ))}
        {block.takeaway && (
          <div className={`mt-4 pt-4 border-t border-white/5`}>
            <span className={`text-[10px] font-bold tracking-widest uppercase ${styles.accent}`}>{block.takeawayLabel}: </span>
            <span className="text-[13px] text-slate-200 font-medium">{renderBriefingText(block.takeaway)}</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="bg-[#101623] border border-white/5 rounded-2xl p-3 md:p-5 relative overflow-visible shadow-xl w-full max-w-[1280px] mx-auto">
      {/* Header */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex justify-between items-center relative z-30 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-5 border-b border-white/5 pb-4' : ''}`}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs md:text-sm font-bold text-[#7c8bfa] bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 group-hover:bg-white/[0.02] transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
            Market Summary
          </span>
          {macroInsights?.theme && (
            <span className="hidden md:inline text-[11px] text-slate-400 font-medium tracking-wide">
              {macroInsights.theme}
            </span>
          )}
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-center justify-center border border-white/5 bg-[#161c2a]/40 px-4 py-1.5 rounded-[10px] min-w-[120px]">
            <span className={`text-[10px] font-bold tracking-widest uppercase ${getSessionColor()}`}>{session}</span>
          </div>
          {lastUpdated && (
            <span className="text-[11px] text-slate-400/80 font-medium px-1 tracking-wide">
              Updated: {formatTime(lastUpdated)} EST
            </span>
          )}
        </div>
      </div>

      {isExpanded && (
        <>
          {status === 'Loading' && (
            <div className="py-12 text-center text-slate-500 text-sm font-medium">Building market briefing…</div>
          )}

          {status !== 'Loading' && !macroInsights && !data && (
            <div className="py-12 text-center text-slate-500 text-sm font-medium">
              No briefing available — awaiting the next scheduled scan.
            </div>
          )}

          {macroInsights && (
            <>
              {/* Top catalysts — up to 3 highest-conviction names with real news.
                  Falls back to the single topCatalyst for older stored payloads. */}
              {(() => {
                const cats = (macroInsights.topCatalysts && macroInsights.topCatalysts.length)
                  ? macroInsights.topCatalysts
                  : (macroInsights.topCatalyst ? [macroInsights.topCatalyst] : []);
                if (!cats.length) return null;
                return (
                  <div className="mb-6 relative z-10 flex flex-col gap-2">
                    {cats.map((cat, ci) => (
                      <div key={ci} className="border-l-[3px] border-amber-500 bg-amber-500/[0.04] rounded-r-xl px-4 py-3">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <span className="text-[9px] font-bold tracking-widest uppercase text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded shrink-0">{ci === 0 ? 'TOP CATALYST' : 'CATALYST'}</span>
                          <span className="text-[11px] font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20 tracking-wider shrink-0">{cat.ticker}</span>
                          {cat.url ? (
                            <a href={cat.url} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-300 font-medium hover:text-cyan-300 transition-colors hover:underline">
                              {cat.headline}
                            </a>
                          ) : (
                            <span className="text-xs text-slate-300 font-medium">{cat.headline}</span>
                          )}
                        </div>
                        {cat.brief && (
                          <p className="text-[12px] text-slate-400 font-medium leading-relaxed mt-2">
                            {renderBriefingText(cat.brief)}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Stacked layout — narrative first, watchlist beneath it */}
              <div className="relative z-10 flex flex-col gap-8">
                {/* Briefing narrative */}
                <div className="flex flex-col gap-3">
                  {formatBriefing(macroInsights.briefing).split('\n\n').filter(Boolean).map((para, idx) => {
                    const { label, color, body } = splitBriefingSection(para);
                    const styles = sectionStyles(color);
                    return (
                      <div key={idx} className={`border-l-[3px] ${styles.border} ${styles.bg} rounded-r-xl px-4 py-3`}>
                        {label && (
                          <span className={`inline-block text-[9px] font-bold tracking-widest uppercase px-2 py-0.5 rounded border mb-2 ${styles.badge}`}>
                            {label}
                          </span>
                        )}
                        <div className="flex flex-col gap-1.5">
                          {body.split('\n').filter(Boolean).map((line, li) => (
                            <p key={li} className="text-[13px] text-slate-300 leading-relaxed">
                              {renderBriefingText(line)}
                            </p>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Watchlist */}
                {macroInsights.watching && macroInsights.watching.length > 0 && (
                  <div className="flex flex-col gap-3">
                    <span className="text-[10px] font-bold tracking-widest uppercase text-slate-500">Watchlist</span>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {macroInsights.watching.map((item, idx) => (
                        <div key={idx} className="bg-[#161c2a]/60 border border-white/5 rounded-xl px-4 py-3 flex flex-col gap-2">
                          <div className="flex items-center gap-2.5 flex-wrap">
                            <span className="text-[11px] font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20 tracking-wider">{item.symbol}</span>
                            {item.score != null && (
                              <span className="text-[10px] font-bold text-slate-400 bg-white/[0.03] border border-white/5 px-2 py-0.5 rounded tracking-wider">CNF {item.score}</span>
                            )}
                            {item.catalyst && (
                              item.catalystUrl ? (
                                <a href={item.catalystUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold tracking-wider uppercase text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded hover:bg-amber-500/20 transition-colors">
                                  News
                                </a>
                              ) : (
                                <span className="text-[10px] font-bold tracking-wider uppercase text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded">News</span>
                              )
                            )}
                          </div>
                          <p className="text-[12px] text-slate-400 leading-relaxed">{renderBriefingText(item.reason)}</p>
                          {item.catalyst && (
                            <p className="text-[11px] text-slate-500 leading-relaxed border-t border-white/5 pt-2">
                              {item.catalystUrl ? (
                                <a href={item.catalystUrl} target="_blank" rel="noopener noreferrer" className="hover:text-slate-300 hover:underline transition-colors">
                                  {item.catalyst}
                                </a>
                              ) : (
                                item.catalyst
                              )}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Stored session update blocks (morning / midday / closing) */}
          {data && (data.morning || data.midday || data.closing) && (
            <div className="relative z-10 mt-8 flex flex-col gap-3">
              <span className="text-[10px] font-bold tracking-widest uppercase text-slate-500">Session Updates</span>
              {renderSingleUpdateBlock(data.closing)}
              {renderSingleUpdateBlock(data.midday)}
              {renderSingleUpdateBlock(data.morning)}
            </div>
          )}

          {/* Actionable events */}
          {data?.actionableEvents && data.actionableEvents.length > 0 && (
            <div className="relative z-10 mt-8 flex flex-col gap-3">
              <span className="text-[10px] font-bold tracking-widest uppercase text-slate-500">On the Calendar</span>
              <div className="flex flex-col gap-2">
                {data.actionableEvents.map((event, idx) => {
                  const impactColor =
                    event.impact === 'High' ? 'text-rose-400 bg-rose-500/10 border-rose-500/20'
                      : event.impact === 'Medium' ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                        : 'text-slate-400 bg-white/[0.03] border-white/5';
                  return (
                    <div key={idx} className="bg-[#161c2a]/60 border border-white/5 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] text-slate-500 font-medium tabular-nums shrink-0">{event.time}</span>
                        <span className="text-[13px] text-slate-300 font-medium">{event.event}</span>
                      </div>
                      <span className={`text-[9px] font-bold tracking-widest uppercase px-2 py-0.5 rounded border shrink-0 ${impactColor}`}>
                        {event.impact}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
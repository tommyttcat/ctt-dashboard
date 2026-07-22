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

  const lines: string[] = [];

  if (aligned.length) {
    lines.push(`${aligned.length} of ${rows.length} hold above both the 10 and 21 EMA — trend-aligned, pullbacks are the entry.`);
  } else {
    lines.push(`Nothing in the scan holds above both the 10 and 21 EMA — no clean trend-aligned entries on the board.`);
  }

  if (pullback.length) {
    lines.push(`In the 10/21 pullback zone (under the 10, still over the 21): ${pullback.map(r => r.ticker).slice(0, 6).join(', ')} — first-touch buys live here.`);
  }

  if (broken.length) {
    const avgBroken = broken.reduce((a, r) => a + (r.d21 as number), 0) / broken.length;
    lines.push(`Below the 21 EMA and in repair: ${broken.map(r => r.ticker).slice(0, 6).join(', ')} (avg ${avgBroken.toFixed(1)}% under the line).`);
  }

  if (unstacked.length) {
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

const buildLocalInsights = (scan: any): MacroInsights | null => {
  const sips: any[] = Array.isArray(scan?.stocksInPlay) ? scan.stocksInPlay : [];
  const daily: any[] = Array.isArray(scan?.dailySetups) ? scan.dailySetups : [];
  const movers = scan?.topMovers || {};
  if (sips.length === 0 && daily.length === 0) return null;

  /* ---- Watchlist: top 6 by CNF across SIPs + Daily, deduped ---- */
  const pool = [...sips, ...daily].filter(s => s?.ticker);
  const seen = new Set<string>();
  const ranked = pool
    .slice()
    .sort((a, b) => scoreOf(b) - scoreOf(a))
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

  /* ---- Top themed catalyst: highest-CNF name with a real headline ---- */
  const withNews = pool
    .filter(hasRealCatalyst)
    .sort((a, b) => scoreOf(b) - scoreOf(a));
  const topCatalyst: TopCatalyst | null = withNews.length
    ? {
        ticker: withNews[0].ticker,
        // Prefer the actual news line; only fall back to the technical thesis.
        headline: String(withNews[0].catalyst || withNews[0].thesis).replace(/\.$/, ''),
        url: withNews[0].catalystUrl || null,
        brief: buildCatalystBrief(withNews[0]),
      }
    : null;

  /* ---- Flow universe: all scanned stocks, deduped by ticker ---- */
  const stockLists = [
    ...sips, ...daily,
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

  return {
    theme,
    briefing: [sipsPara, dailyPara, ema1021Para, heatPara, etfPara, moneyPara].filter(Boolean).join('\n\n'),
    watching,
    topCatalyst,
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
  { label: 'SIPs Thesis', color: 'cyan' },
  { label: 'Daily Setups Thesis', color: 'emerald' },
  { label: '10/21 Thesis', color: 'violet' },
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

  const isWeekend = isWeekendNow();

  useEffect(() => {
    let isMounted = true;
    if (!data && !macroInsights) setStatus('Loading');

    const fetchMarketData = async () => {
      if (isMounted) setSession(getMarketSession());

      try {
        // 1. Fetch Narrative Data (Session Updates)
        const narrativeRes = await fetch('/api/market-summary', { cache: 'no-store' });

        if (!narrativeRes.ok) {
          if (narrativeRes.status === 404 && isMounted) {
            setData({ morning: null, midday: null, closing: null, actionableEvents: [] });
          } else {
            throw new Error(`Narrative API returned status: ${narrativeRes.status}`);
          }
        } else {
          const payload: SummaryData = await narrativeRes.json();
          if (isMounted) {
            const estTime = getCurrentEstDecimal();
            const gatedData: SummaryData = {
              morning: (estTime >= 4.0 || isWeekend) ? (payload.morning || null) : null,
              midday: (estTime >= 11.5 || isWeekend) ? (payload.midday || null) : null,
              closing: (estTime >= 15.5 || isWeekend) ? (payload.closing || null) : null,
              actionableEvents: payload.actionableEvents || [] 
            };
            setData(gatedData);
          }
        }
      } catch (error) {
        console.error("Narrative Sync Error:", error);
      }

      // 2. Build Market Briefing deterministically from scanner data (no AI)
      try {
        const scannerRes = await fetch('/api/scanner/latest', { cache: 'no-store' });
        if (!scannerRes.ok) throw new Error(`Scanner API returned status: ${scannerRes.status}`);
        
        const scannerData = await scannerRes.json();
        
        if (isMounted) {
          const local = buildLocalInsights(scannerData);
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

    fetchMarketData();
    const interval = setInterval(fetchMarketData, 60000); 
    return () => { isMounted = false; clearInterval(interval); };
  }, [isWeekend]); 

  const getThemeStyles = (theme: string) => {
    switch (theme) {
      case 'cyan': return { border: 'border-cyan-500/20', bg: 'bg-cyan-500/5', text: 'text-cyan-400', boxBg: 'bg-cyan-500/10', boxBorder: 'border-cyan-500', boxText: 'text-cyan-100/90' };
      case 'emerald': return { border: 'border-emerald-500/20', bg: 'bg-emerald-500/5', text: 'text-emerald-400', boxBg: 'bg-emerald-500/10', boxBorder: 'border-emerald-500', boxText: 'text-emerald-100/90' };
      case 'rose': return { border: 'border-rose-500/20', bg: 'bg-rose-500/5', text: 'text-rose-400', boxBg: 'bg-rose-500/10', boxBorder: 'border-rose-500', boxText: 'text-rose-100/90' };
      case 'amber': return { border: 'border-amber-500/20', bg: 'bg-amber-500/5', text: 'text-amber-400', boxBg: 'bg-amber-500/10', boxBorder: 'border-amber-500', boxText: 'text-amber-100/90' };
      case 'indigo': default: return { border: 'border-indigo-500/30', bg: 'bg-indigo-500/5', text: 'text-indigo-400', boxBg: 'bg-indigo-500/10', boxBorder: 'border-indigo-500', boxText: 'text-indigo-100/90' };
    }
  };

  const getSessionTextColor = () => {
    if (session === 'Pre-Market') return 'text-amber-500';
    if (session === 'Open') return 'text-[#00e676]';
    if (session === 'Post-Market') return 'text-indigo-400';
    return 'text-slate-500';
  };

  const formatBriefing = (text: string) => {
    if (!text) return "";
    return text
      .replace(/(Daily Setups Thesis:)/gi, '\n\n$1')
      .replace(/(10\/21 Thesis:)/gi, '\n\n$1')
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
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-2 h-2 rounded-full ${styles.bg} border border-current ${styles.text}`}></div>
          <h4 className={`text-[11px] font-bold tracking-widest uppercase ${styles.text}`}>
            {block.phase}
          </h4>
          <span className="text-[9px] text-slate-500 font-medium tracking-wider px-2 py-0.5 bg-black/20 border border-white/5 rounded">
            {block.timestamp}
          </span>
        </div>

        <div className="space-y-3 mb-5">
          {block.paragraphs.map((p, idx) => (
            <p key={idx} className="text-[13px] text-slate-400 leading-relaxed border-l-[2px] border-slate-500/30 pl-3.5">
              {renderBriefingText(p)}
            </p>
          ))}
        </div>

        <div className={`border-l-[4px] p-4 rounded-r-xl transition-colors duration-300 ${styles.boxBg} ${styles.boxBorder}`}>
          <p className={`text-[13px] leading-relaxed ${styles.boxText}`}>
            {block.takeaway}
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-[#101623] border border-white/10 rounded-2xl p-6 md:p-8 relative overflow-hidden shadow-2xl w-full">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-500 via-emerald-500 to-indigo-500 opacity-40"></div>
      
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex justify-between items-start md:items-center relative z-10 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-8 border-b border-white/5 pb-4' : ''}`}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs md:text-sm font-bold border px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 transition-colors text-[#7c8bfa] bg-[#161c2a]/40 border-white/5 group-hover:bg-white/[0.02]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
            LIVE SESSION NARRATIVE
          </span>
        </div>

        <div className="flex flex-col items-center gap-1.5 mt-3 md:mt-0">
          <div className="flex items-center justify-center border border-white/5 bg-[#161c2a]/40 px-4 py-1.5 rounded-[10px] min-w-[120px]">
            <span className={`text-[10px] font-bold tracking-widest uppercase ${status === 'Loading' ? 'text-amber-500' : status === 'Error' ? 'text-rose-400' : getSessionTextColor()}`}>
              {status === 'Synced' ? session : status}
            </span>
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
          {/* 1. Market Briefing — deterministic, built from scanner data */}
          {macroInsights && (
            <div className="mb-8 bg-[#161c2a]/60 border border-cyan-500/20 rounded-xl p-5 md:p-6 relative overflow-hidden shadow-[0_0_15px_rgba(34,211,238,0.03)]">
              <div className="absolute right-0 top-0 w-64 h-64 bg-cyan-500/10 blur-3xl rounded-full -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>

              <div className="flex items-center gap-3 mb-3 relative z-10 flex-wrap">
                <span className="text-[10px] font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-3 py-1 rounded tracking-widest uppercase flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
                  MARKET BRIEFING
                </span>
                <span className="text-sm md:text-base font-black text-white tracking-wide">{macroInsights.theme}</span>
              </div>

              {/* Top themed catalyst — highest-conviction name with real news + brief */}
              {macroInsights.topCatalyst && (
                <div className="mb-6 relative z-10 border-l-[3px] border-amber-500 bg-amber-500/[0.04] rounded-r-xl px-4 py-3">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="text-[9px] font-bold tracking-widest uppercase text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded shrink-0">TOP CATALYST</span>
                    <span className="text-[11px] font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20 tracking-wider shrink-0">{macroInsights.topCatalyst.ticker}</span>
                    {macroInsights.topCatalyst.url ? (
                      <a href={macroInsights.topCatalyst.url} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-300 font-medium hover:text-cyan-300 transition-colors hover:underline">
                        {macroInsights.topCatalyst.headline}
                      </a>
                    ) : (
                      <span className="text-xs text-slate-300 font-medium">{macroInsights.topCatalyst.headline}</span>
                    )}
                  </div>
                  {macroInsights.topCatalyst.brief && (
                    <p className="text-[12px] text-slate-400 font-medium leading-relaxed mt-2">
                      {renderBriefingText(macroInsights.topCatalyst.brief)}
                    </p>
                  )}
                </div>
              )}

              {/* Stacked layout — narrative first, watchlist beneath it */}
              <div className="relative z-10 flex flex-col gap-8">
                <div>
                  <h3 className="text-[9px] font-bold tracking-widest uppercase text-slate-500 mb-3">Narrative Breakdown</h3>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {formatBriefing(macroInsights.briefing).split('\n\n').filter(Boolean).map((para, idx) => {
                      const { label, color, body } = splitBriefingSection(para.trim());
                      const st = sectionStyles(color);
                      return (
                        <div key={idx} className={`border-l-[3px] rounded-r-xl px-4 py-3 ${st.border} ${st.bg}`}>
                          {label && (
                            <span className={`inline-block text-[9px] font-bold tracking-widest uppercase px-2 py-0.5 rounded border mb-2 ${st.badge}`}>
                              {label}
                            </span>
                          )}
                          <div className="space-y-2">
                            {body.split('\n').filter(Boolean).map((line, li) => (
                              <p key={li} className="text-[13px] text-slate-300 leading-relaxed font-medium">
                                {renderBriefingText(line)}
                              </p>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="border-t border-white/5 pt-6">
                  <h3 className="text-[9px] font-bold tracking-widest uppercase text-slate-500 mb-3">What To Watch &amp; Why</h3>
                  <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {macroInsights.watching?.map((item, idx) => {
                      const symbol = typeof item === 'string' ? item : item.symbol;
                      const reason = typeof item === 'string' ? 'Momentum continuation and algorithmic confluence.' : item.reason;
                      const catalyst = typeof item === 'string' ? null : item.catalyst;
                      const catalystUrl = typeof item === 'string' ? null : item.catalystUrl;
                      
                      let parsedScore: number | undefined = undefined;
                      if (typeof item === 'object' && item.score !== undefined && item.score !== null) {
                        const num = Number(item.score.toString().replace(/\D/g, ''));
                        if (!isNaN(num)) parsedScore = num;
                      }

                      return (
                        <li key={idx} className="flex flex-col gap-2 bg-[#161c2a]/60 p-3.5 rounded-xl border border-white/5 hover:border-cyan-500/20 transition-colors">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20 tracking-wider">
                              {symbol}
                            </span>
                            {parsedScore !== undefined && (
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded border tracking-wide ${
                                parsedScore >= 70 
                                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                                  : parsedScore >= 50 
                                    ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400' 
                                    : 'bg-slate-500/10 border-white/10 text-slate-400'
                              }`}>
                                {parsedScore}
                              </span>
                            )}
                          </div>
                          {(() => {
                            // Split the reason on semicolons: first clause is the
                            // lead line, the rest stack as their own lines below.
                            const clauses = (reason || '').split(';').map((c) => c.trim()).filter(Boolean);
                            if (clauses.length <= 1) {
                              return (
                                <p className="text-[13px] text-slate-300 font-medium leading-relaxed">
                                  {renderBriefingText(reason)}
                                </p>
                              );
                            }
                            return (
                              <div className="flex flex-col gap-1">
                                <p className="text-[13px] text-slate-300 font-medium leading-relaxed">
                                  {renderBriefingText(clauses[0])}
                                </p>
                                {clauses.slice(1).map((c, ci) => (
                                  <p key={ci} className="text-[12px] text-slate-400 font-medium leading-relaxed">
                                    {renderBriefingText(c)}
                                  </p>
                                ))}
                              </div>
                            );
                          })()}

                          {/* Current catalyst on the name, when there is real news */}
                          {catalyst && (
                            <div className="flex items-start gap-2 pt-2 mt-0.5 border-t border-white/5">
                              <span className="text-[8px] font-bold tracking-widest uppercase text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded shrink-0 mt-[1px]">NEWS</span>
                              {catalystUrl ? (
                                <a href={catalystUrl} target="_blank" rel="noopener noreferrer" className="text-[12px] text-slate-400 font-medium leading-relaxed hover:text-cyan-300 hover:underline transition-colors">
                                  {catalyst}
                                </a>
                              ) : (
                                <span className="text-[12px] text-slate-400 font-medium leading-relaxed">{catalyst}</span>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* 2. Session Narrative Feed (Render sequentially) */}
          <div className="border-t border-white/5 pt-6 mt-4">
            <span className="inline-flex text-xs md:text-sm font-bold border px-4 py-1.5 rounded-lg tracking-widest uppercase items-center gap-2 text-[#7c8bfa] bg-[#161c2a]/40 border-white/5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
              LIVE SESSION UPDATES
            </span>
            {status === 'Loading' && !data ? (
              <div className="animate-pulse bg-[#161c2a]/40 border border-white/5 rounded-xl p-5 md:p-6 mt-3">
                <div className="h-3 bg-white/5 rounded w-1/4 mb-4"></div>
                <div className="h-3 bg-white/5 rounded w-full mb-2"></div>
                <div className="h-3 bg-white/5 rounded w-11/12 mb-6"></div>
                <div className="h-12 bg-white/5 border-l-[4px] border-white/10 rounded-r-xl w-full"></div>
              </div>
            ) : (
              <div className="animate-in fade-in duration-500 flex flex-col gap-2">
                {data?.morning && renderSingleUpdateBlock(data.morning)}
                {data?.midday && renderSingleUpdateBlock(data.midday)}
                {data?.closing && renderSingleUpdateBlock(data.closing)}
                
                {!data?.morning && !data?.midday && !data?.closing && (
                  <div className="text-center py-8 text-slate-500 text-sm font-medium border border-dashed border-white/10 rounded-xl mt-3">
                    Awaiting pre-market data ingestion...
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
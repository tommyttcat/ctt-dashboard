'use client';

import React, { useState, useEffect } from 'react';

/* ActionableEvent and the actionableEvents field are retained because
   /api/market-summary returns them and the fetch assigns them. The SECTION
   that rendered them is gone: the Benzinga high-impact feed is dominated by
   litigation solicitations, and the filter was losing an arms race against
   firms not on the list — ClaimsFiler, Brodsky & Smith, and Johnson all
   walked through a regex that caught Rosen and Pomerantz. Four of eight rows
   on a typical morning were shareholder-alert blasts.

   The scanner's own isSpamNews() in /api/scanner/run is separate and stays —
   that one prevents these headlines from becoming a ticker's catalyst, which
   is where they would actually distort a score. */
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

type PostureBucket = 'first-touch' | 'stacked' | 'pre-cross' | 'extended' | 'below-21';

interface WatchItem {
  symbol: string;
  score?: number | string;
  reason: string;
  catalyst?: string | null;
  catalystUrl?: string | null;
  posture?: PostureBucket | null;
  dotKind?: 'blue' | 'red' | null;
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

interface EconEvent {
  event: string;
  date: string;
  country: string;
  currency: string;
  actual: number | null;
  previous: number | null;
  estimate: number | null;
  impact: 'High' | 'Medium' | 'Low';
}

interface EarningsEvent {
  symbol: string;
  date: string;
  name: string;
  epsEstimated?: number | null;
  revenueEstimated?: number | null;
  epsActual?: number | null;
  epsSurprisePct?: number | null;
  importance?: number;
}

type MarketSession = 'Pre-Market' | 'Open' | 'Post-Market' | 'Closed';
type BlockKey = 'morning' | 'midday' | 'closing';
type Direction = 'up' | 'down' | 'neutral';

const getEstDateInfo = () =>
  new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));

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
  const t = est.getHours() + est.getMinutes() / 60;
  if (day === 0 || day === 6) return 'Closed';
  if (t >= 4 && t < 9.5) return 'Pre-Market';
  if (t >= 9.5 && t < 16) return 'Open';
  if (t >= 16 && t < 20) return 'Post-Market';
  return 'Closed';
};

/* ---- Session-block staleness ----
   A block written for the 8:30 window is describing a tape that has moved on
   by 11 AM. Blocks are marked, never hidden and never dimmed into
   illegibility — an earlier pass used opacity-50 over text-slate-500, which
   compounded into unreadable. The signal is color, not contrast. */
const BLOCK_WINDOWS: Record<BlockKey, { opens: number; supersededAt: number; nextLabel: string }> = {
  morning: { opens: 4.0, supersededAt: 11.5, nextLabel: 'midday' },
  midday: { opens: 11.5, supersededAt: 15.5, nextLabel: 'closing' },
  closing: { opens: 15.5, supersededAt: 24, nextLabel: '' },
};

const isBlockStale = (key: BlockKey, weekend: boolean): boolean => {
  if (weekend) return false;
  return getCurrentEstDecimal() >= BLOCK_WINDOWS[key].supersededAt;
};

/* ---- Directional accent ----
   Accent tracks the direction of the tape the block describes, read out of
   the block's own prose — colorTheme on the payload is effectively a constant
   and was decorating rather than informing. Index NAME followed by a signed
   percentage, so a mega-cap gapping in the same sentence is not counted.
   Inside ±0.25% the move is noise and colorTheme stands. */
const INDEX_MOVE_RX = /\b(S&P|Nasdaq|Dow|Russell|SPX|NDX)\b[^.]{0,40}?([+-]\d+(?:\.\d+)?)%/gi;
const DIRECTION_NEUTRAL_BAND = 0.25;

const deriveDirection = (block: UpdateBlock): Direction | null => {
  const text = (block.paragraphs || []).join(' ');
  if (!text) return null;
  const moves: number[] = [];
  INDEX_MOVE_RX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INDEX_MOVE_RX.exec(text)) !== null) {
    const v = parseFloat(m[2]);
    if (!Number.isNaN(v)) moves.push(v);
  }
  if (moves.length === 0) return null;
  const avg = moves.reduce((a, b) => a + b, 0) / moves.length;
  if (Math.abs(avg) < DIRECTION_NEUTRAL_BAND) return 'neutral';
  return avg > 0 ? 'up' : 'down';
};

const formatTime = (date: Date) =>
  date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'America/New_York',
  });

const KEEP_UPPER = new Set(['ETF', 'ETFS', 'QQQ', 'SPY', 'IWM', 'DIA', 'IT', 'AI', 'EV', 'REIT', 'REITS', 'IPO', 'SPAC', 'US', 'USA']);

const titleCase = (input: string): string =>
  input
    .split(/(\s+|—|–|-|&|\/)/)
    .map(part => {
      const trimmed = part.trim();
      if (!trimmed || /^(\s+|—|–|-|&|\/)$/.test(part)) return part;
      const upper = trimmed.toUpperCase();
      if (KEEP_UPPER.has(upper)) return upper;
      return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
    })
    .join('');

const num = (v: any): number => {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
};

const numOrNull = (v: any): number | null => {
  if (v == null || v === '' || v === '—' || v === '-') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
};

const scoreOf = (s: any): number => num(s?.conviction ?? s?.cnfScore ?? s?.smbScore ?? s?.score);
const chgOf = (s: any): number => num(s?.change ?? s?.changePct);

/* ---- RVOL, guarded ----
   A row showed RVOL 678.33 on the board. That is not participation, it is a
   near-zero denominator: avgVol on a recently-listed name with a handful of
   daily bars. The scanner guards avgVol > 0, which is true at 500 shares.

   Two floors. An absolute one on avgVol, because a name normally trading
   under 25k shares cannot produce a tradeable RVOL regardless of today. And
   a sanity ceiling on the ratio — a genuine 40x day exists, a 600x day does
   not, and past that the denominator is the story. Null means every consumer
   treats it as "no reading" rather than as a very large one. */
const MIN_AVG_VOL_FOR_RVOL = 25_000;
const MAX_PLAUSIBLE_RVOL = 40;

const rvolOf = (s: any): number | null => {
  const raw = s?.rvol;
  if (raw == null || isNaN(Number(raw))) return null;
  const v = Number(raw);
  if (v <= 0) return null;
  const avg = numOrNull(s?.avgVol);
  if (avg != null && avg < MIN_AVG_VOL_FOR_RVOL) return null;
  if (v > MAX_PLAUSIBLE_RVOL) return null;
  return v;
};

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

const catalystLinked = (s: any): string => {
  const cat = catalystTextOf(s);
  if (!cat) return '';
  const url = s?.catalystUrl || null;
  return url ? `[${cat}](${url})` : cat;
};

const dVolOf = (s: any): number => {
  const d = Number(s?.dVol);
  if (!isNaN(d) && d > 0) return d;
  const p = Number(s?.price) || 0;
  const v = Number(s?.volume ?? s?.vol) || 0;
  return p * v;
};

const dotOf = (s: any): 'blue' | 'red' | null => {
  const k = s?.dotKind;
  return k === 'blue' || k === 'red' ? k : null;
};

/* Detects ETF-style sector strings: "ETF", "TICKER - ETF", or ETF_TARGET_MAP
   values like "QQQ - Nasdaq", "SOXX - Semi's -3X". Leveraged/sector products,
   not industries — they belong in ETF Flow, not Industry Heat, and never in
   the 10/21 thesis. */
const isEtfSector = (sec: string | null | undefined): boolean => {
  if (!sec || sec === '—') return false;
  const s = String(sec);
  if (s === 'ETF' || s.includes('- ETF')) return true;
  if (/^[A-Z]{2,5}\s*-\s/.test(s)) return true;
  return false;
};

const priceOf = (s: any): number | null => numOrNull(s?.price ?? s?.last ?? s?.close);
const ema10Of = (s: any): number | null => numOrNull(s?.ema10 ?? s?.ema10d ?? s?.tenEma ?? s?.ma10 ?? s?.sma10);
const ema21Of = (s: any): number | null => numOrNull(s?.ema21 ?? s?.ema21d ?? s?.twentyOneEma ?? s?.ma21 ?? s?.sma21);

const pctFrom21 = (s: any): number | null => {
  const direct = numOrNull(s?.pctFrom21 ?? s?.dist21 ?? s?.pct21 ?? s?.ema21Dist ?? s?.distFrom21 ?? s?.distToEma21);
  if (direct != null) return direct;
  const p = priceOf(s);
  const e21 = ema21Of(s);
  if (p != null && e21 != null && e21 > 0) return ((p - e21) / e21) * 100;
  const t = String(s?.thesis || s?.readout || '');
  const m = t.match(/(\d+(?:\.\d+)?)%\s+(above|below)[^.]*?21\s*EMA/i);
  if (m) return parseFloat(m[1]) * (m[2].toLowerCase() === 'below' ? -1 : 1);
  return null;
};

const pctFrom10 = (s: any): number | null => {
  const direct = numOrNull(s?.pctFrom10 ?? s?.dist10 ?? s?.pct10 ?? s?.ema10Dist ?? s?.distFrom10 ?? s?.distToEma10);
  if (direct != null) return direct;
  const p = priceOf(s);
  const e10 = ema10Of(s);
  if (p != null && e10 != null && e10 > 0) return ((p - e10) / e10) * 100;
  const t = String(s?.thesis || s?.readout || '');
  const m = t.match(/(\d+(?:\.\d+)?)%\s+(above|below)[^.]*?10\s*EMA/i);
  if (m) return parseFloat(m[1]) * (m[2].toLowerCase() === 'below' ? -1 : 1);
  return null;
};

const slope21Of = (s: any): 'rising' | 'flat' | 'falling' | null => {
  if (s?.ema21Rising === true) return 'rising';
  if (s?.ema21Rising === false) return 'falling';
  const raw = s?.ema21Slope ?? s?.slope21 ?? s?.ema21Trend ?? s?.trend21;
  if (typeof raw === 'number' && !isNaN(raw)) return raw > 0.05 ? 'rising' : raw < -0.05 ? 'falling' : 'flat';
  const txt = (typeof raw === 'string' ? raw : String(s?.thesis || s?.readout || '')).toLowerCase();
  if (/declining|falling|rolling over|down-?slop/.test(txt)) return 'falling';
  if (/rising|up-?slop|advancing|uptrend/.test(txt)) return 'rising';
  if (/\bflat\b/.test(txt)) return 'flat';
  return null;
};

const stackedOf = (s: any): boolean | null => {
  const e10 = ema10Of(s);
  const e21 = ema21Of(s);
  if (e10 != null && e21 != null) return e10 > e21;
  const d10 = pctFrom10(s);
  const d21 = pctFrom21(s);
  if (d10 != null && d21 != null) return d21 > d10;
  return null;
};

const isExtendedOf = (s: any): boolean => {
  const d21 = pctFrom21(s);
  const atrPct = numOrNull(s?.atrPct);
  if (d21 == null) return false;
  // Same rule the scanner uses: more than three ATRs above the anchor leaves
  // no stop to place. Flat 12% fallback when ATR is missing.
  if (atrPct != null && atrPct > 0) return d21 > 3 * atrPct;
  return d21 > 12;
};

/* ---- THE single source of structural truth ------------------------------
   This exists because the 10/21 section and the watchlist used to compute
   structure independently and disagreed in public. CRWV, INTC, and BHC each
   appeared in "No touch" AND in "What To Watch" in the same render:
   build1021Para bucketed on EMA position while blendedScore ranked on
   CNF + RVOL + catalyst and knew nothing about position at all.

   Worse, the asymmetry pushed exactly the wrong names up — a +5 bonus for
   the pullback zone and no penalty whatsoever for sitting below a declining
   21. A name 9% under its anchor could out-rank one at its anchor on tape
   noise alone.

   Every consumer now reads posture() and nothing else. */
const POSTURE_META: Record<PostureBucket, { label: string; short: string; tone: 'good' | 'warn' | 'bad'; scoreAdj: number }> = {
  'first-touch': { label: 'first touch', short: 'FIRST TOUCH', tone: 'good', scoreAdj: 8 },
  'stacked': { label: 'stacked', short: 'STACKED', tone: 'good', scoreAdj: 4 },
  'pre-cross': { label: 'pre-cross', short: 'PRE-CROSS', tone: 'warn', scoreAdj: 2 },
  'extended': { label: 'too extended', short: 'EXTENDED', tone: 'bad', scoreAdj: -10 },
  'below-21': { label: 'below the 21', short: 'BELOW 21', tone: 'bad', scoreAdj: -12 },
};

const posture = (s: any): PostureBucket | null => {
  const d21 = pctFrom21(s);
  if (d21 == null) return null;

  // Extension checked FIRST — a name can be well above both EMAs and still be
  // untouchable. That was the original bug here: everything above the 21 went
  // in the buy bucket, then the closing line contradicted it.
  if (isExtendedOf(s)) return 'extended';

  const d10 = pctFrom10(s);

  if (d21 > 0) {
    // Under the 10 but holding the 21 — the Dr. Wish first touch, the only
    // bucket where the stop is both defined and close.
    if (d10 != null && d10 <= 0) return 'first-touch';
    return 'stacked';
  }

  if (stackedOf(s) === false && d10 != null &&
      Math.abs(d10 - d21) <= 1.5 && d21 > -3) {
    return 'pre-cross';
  }

  return 'below-21';
};

const postureScoreAdj = (s: any): number => {
  const b = posture(s);
  return b ? POSTURE_META[b].scoreAdj : 0;
};

const fmtDollar = (v: number): string => {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${Math.round(v / 1e3)}K`;
};

const fmtLeader = (s: any): string => {
  const chg = `${chgOf(s) >= 0 ? '+' : ''}${chgOf(s).toFixed(2)}%`;
  const bits: string[] = [];
  const rv = rvolOf(s);
  if (rv != null) bits.push(`RVOL ${rv.toFixed(2)}`);
  const su = setupOf(s);
  if (su) bits.push(su);
  return `${s.ticker} ${chg}${bits.length ? ` · ${bits.join(' · ')}` : ''}`;
};

/* ---- Key Events — the only forward-looking section ----------------------
   Every other section is REACTIVE. A 2:00 PM rate decision produces nothing
   at 8:30 AM, so a session frozen ahead of one looks — to every other
   section — like weak breadth with no leadership.

   Econ is TODAY ONLY: what can still move the tape while you hold. Earnings
   run today + tomorrow, because an after-close print is tomorrow's gap and
   you size for it today. */
const parseEtDateTime = (s: string): { dayKey: string; minutes: number | null } => {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return { dayKey: '', minutes: null };
  const dayKey = `${m[1]}-${m[2]}-${m[3]}`;
  if (m[4] == null) return { dayKey, minutes: null };
  return { dayKey, minutes: parseInt(m[4], 10) * 60 + parseInt(m[5], 10) };
};

const etDayKey = (offsetDays = 0): string => {
  const d = getEstDateInfo();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const fmtClock = (minutes: number | null): string => {
  if (minutes == null) return '';
  const h24 = Math.floor(minutes / 60);
  const mm = minutes % 60;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${ampm}`;
};

const fmtEconNum = (v: number | null | undefined): string => {
  if (v == null) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
};

const buildKeyEventsPara = (econ: EconEvent[], earnings: EarningsEvent[]): string => {
  const today = etDayKey(0);
  const tomorrow = etDayKey(1);
  const now = getEstDateInfo();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const econRows = econ
    .map(e => {
      const { dayKey, minutes } = parseEtDateTime(e.date);
      return { ...e, dayKey, minutes };
    })
    .filter(e => e.dayKey === today && e.impact !== 'Low')
    .sort((a, b) => (a.minutes ?? 0) - (b.minutes ?? 0));

  const earnRows = earnings
    .filter(e => {
      const { dayKey } = parseEtDateTime(e.date);
      return (dayKey === today || dayKey === tomorrow) && (e.importance ?? 0) >= 5;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));

  if (econRows.length === 0 && earnRows.length === 0) return '';

  const isPending = (e: any) => e.minutes != null && e.minutes > nowMinutes && e.actual == null;

  const fmtEcon = (e: any): string => {
    const t = fmtClock(e.minutes);
    const marker = isPending(e) ? '▸ ' : '';
    const bits: string[] = [];
    if (e.actual != null) bits.push(`act ${fmtEconNum(e.actual)}`);
    if (e.estimate != null) bits.push(`est ${fmtEconNum(e.estimate)}`);
    if (e.previous != null) bits.push(`prev ${fmtEconNum(e.previous)}`);
    return `${marker}${t ? `${t} ` : ''}${e.event}${bits.length ? ` · ${bits.join(' · ')}` : ''}`;
  };

  const pending = econRows.filter(isPending);
  const released = econRows.filter(e => !isPending(e));

  let econCol = '';
  if (econRows.length) {
    const econLines = [...pending.map(fmtEcon), ...released.map(fmtEcon)];
    econCol = `${pending.length ? `Economic — ${pending.length} still ahead:` : 'Economic — all printed:'}\n${econLines.join('\n')}`;
  } else {
    econCol = 'Economic:\nNothing scheduled today.';
  }

  const fmtEarn = (e: EarningsEvent): string => {
    const { dayKey } = parseEtDateTime(e.date);
    const when = dayKey === tomorrow ? '(tmrw) ' : '';
    if (e.epsActual != null) {
      const beat = e.epsEstimated != null && e.epsActual >= e.epsEstimated;
      return `${when}${e.symbol} — ${beat ? 'beat' : 'miss'} ${e.epsActual} vs ${e.epsEstimated ?? '—'} est`;
    }
    return `▸ ${when}${e.symbol} — est ${e.epsEstimated ?? '—'} EPS`;
  };

  const reported = earnRows.filter(e => e.epsActual != null);
  const upcoming = earnRows.filter(e => e.epsActual == null);

  let earnCol = '';
  if (earnRows.length) {
    const earnLines = [...upcoming.map(fmtEarn), ...reported.map(fmtEarn)];
    earnCol = `${upcoming.length ? `Earnings — ${upcoming.length} pending:` : 'Earnings — all reported:'}\n${earnLines.join('\n')}`;
  } else {
    earnCol = 'Earnings:\nNo mega-cap prints today or tomorrow.';
  }

  const lines: string[] = [`${econCol}|||${earnCol}`];
  if (pending.filter(e => e.impact === 'High').length) {
    lines.push('Setups are on a clock until this prints — breakouts into a scheduled release carry event risk the scan cannot price.');
  }
  return `Key Events: ${lines.join('\n')}`;
};

const buildCatalystBrief = (s: any): string => {
  const bits: string[] = [];
  const chg = chgOf(s);
  const rv = rvolOf(s);
  const su = setupOf(s);
  const st = stageOf(s);
  const d21 = pctFrom21(s);
  const cnf = scoreOf(s);
  const dot = dotOf(s);

  bits.push(`${chg >= 0 ? 'Up' : 'Down'} ${Math.abs(chg).toFixed(2)}%${rv != null ? ` on RVOL ${rv.toFixed(2)}` : ''}`);
  if (rv != null && rv >= 2) bits.push('heavy participation is validating the headline');
  else if (rv != null && rv >= 1.5) bits.push('volume is confirming');
  else if (rv != null && rv < 1) bits.push('headline pop without volume — fade risk');
  if (dot === 'red') bits.push('RED DOT active — reversal against a long');
  else if (dot === 'blue') bits.push('BLUE DOT');
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
  const dot = dotOf(s);

  let lead = su || 'Momentum move';
  if (st) lead += ` in Stage ${st}`;
  if (rv != null) lead += ` with RVOL ${rv.toFixed(2)}`;
  parts.push(lead);

  // Dot leads the qualifiers — a red dot is the single most important thing
  // to know about a name being considered long, and it should not be buried
  // behind volume commentary.
  if (dot === 'red') {
    const since = numOrNull(s?.dotBarsSince);
    parts.push(`RED DOT${since === 0 ? ' today' : since != null ? ` ${since} bars ago` : ''} — overbought reversal, grade capped`);
  } else if (dot === 'blue') {
    const since = numOrNull(s?.dotBarsSince);
    parts.push(`BLUE DOT${since === 0 ? ' today' : since != null ? ` ${since} bars ago` : ''}`);
  }

  if (rv != null) {
    if (rv >= 2) parts.push('heavy participation confirms the move');
    else if (rv >= 1.5) parts.push('solid volume backing');
    else if (rv < 1) parts.push('price without volume — fade risk');
  }

  const d21 = pctFrom21(s);
  const slope = slope21Of(s);
  const b = posture(s);

  // Posture phrasing comes from the shared bucket, so this sentence can never
  // describe a name differently than the 10/21 section does.
  if (d21 != null && b) {
    if (b === 'first-touch') parts.push(`first touch — +${d21.toFixed(1)}% over the 21, back under the 10`);
    else if (b === 'stacked') parts.push(`stacked +${d21.toFixed(1)}% over a${slope === 'rising' ? ' rising' : slope === 'falling' ? ' declining' : ''} 21 EMA`);
    else if (b === 'pre-cross') parts.push(`pre-cross — ${d21.toFixed(1)}% vs the 21, lines converging`);
    else if (b === 'extended') parts.push(`+${d21.toFixed(1)}% over the 21 — too extended to place a stop`);
    else parts.push(`${d21.toFixed(1)}% under the 21 EMA — structure needs repair first`);
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

  return parts.join('; ') + '.';
};

const ep9mUnprec = (s: any): boolean => s?.unprecedented === true;

/* ---- Blended idea score ----
   CNF is the base. RVOL and a real catalyst add weight so a volume-confirmed
   name with news outranks a quiet high-CNF name.

   The posture term is SYMMETRIC — it used to be a lone +5 for the pullback
   zone with no downside, which is how names under a declining 21 ended up
   topping the watchlist while the section above called them untouchable.

   The dot term mirrors the scanner's own ceiling logic: a live red dot is a
   contradiction on a long idea, not a nuance. */
const blendedScore = (s: any): number => {
  let v = scoreOf(s);
  const rv = rvolOf(s);
  if (rv != null) {
    if (rv >= 2) v += 12;
    else if (rv >= 1.5) v += 7;
    else if (rv < 1) v -= 6;
  }
  if (hasRealCatalyst(s)) v += 8;
  if (ep9mUnprec(s)) v += 6;
  v += postureScoreAdj(s);

  const dot = dotOf(s);
  const since = numOrNull(s?.dotBarsSince) ?? 0;
  if (dot === 'blue') v += since === 0 ? 8 : 5;
  else if (dot === 'red') v -= since === 0 ? 15 : 9;

  return v;
};

/* ---- 10/21 Thesis ------------------------------------------------------
   Restructured from "at the anchor vs no touch" into SWING/REVERSAL vs DAY,
   ranked by the same blendedScore that drives the watchlist, each row
   carrying its posture tag.

   The old split answered "what is buyable" but sat next to a separately-
   ranked watchlist answering "what is interesting" — and the two disagreed.
   This IS the ranked pick list, cut by holding period, with structure shown
   per row rather than as a bucket heading. A name below its 21 still appears
   if it ranks, but labelled BELOW 21 rather than in a column implying
   otherwise. */
const isDayName = (s: any): boolean =>
  String(s?.tradeType || '').toLowerCase().startsWith('day');

const build1021Para = (pool: any[]): string => {
  const seenTickers = new Set<string>();
  const rows = pool
    .filter(s => {
      if (!s?.ticker || isEtfSector(s.sector)) return false;
      if (seenTickers.has(s.ticker)) return false;
      seenTickers.add(s.ticker);
      return true;
    })
    .map(s => ({
      ticker: s.ticker,
      d21: pctFrom21(s),
      d10: pctFrom10(s),
      bucket: posture(s),
      dot: dotOf(s),
      day: isDayName(s),
      score: blendedScore(s),
    }))
    .filter(r => r.d21 != null && r.bucket != null);

  if (rows.length < 2) return '';

  const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
  const fmtRow = (r: any): string => {
    const bits = [`${pct(r.d21 as number)} vs 21`];
    if (r.d10 != null) bits.push(`${pct(r.d10 as number)} vs 10`);
    const tags: string[] = [POSTURE_META[r.bucket as PostureBucket].label];
    if (r.dot === 'red') tags.push('RED DOT');
    else if (r.dot === 'blue') tags.push('BD');
    return `${r.ticker} ${bits.join(' · ')} — ${tags.join(', ')}`;
  };

  const byScore = (a: any, b: any) => b.score - a.score;
  const swing = rows.filter(r => !r.day).sort(byScore).slice(0, 6);
  const day = rows.filter(r => r.day).sort(byScore).slice(0, 6);

  const swingCol = swing.length
    ? `Swing / reversal — ${swing.length}:\n${swing.map(fmtRow).join('\n')}`
    : 'Swing / reversal:\nNothing multi-day on the board.';
  const dayCol = day.length
    ? `Day — ${day.length}:\n${day.map(fmtRow).join('\n')}`
    : 'Day:\nNo intraday-only names classified.';

  const lines: string[] = [`${swingCol}|||${dayCol}`];

  // Closing read counts the buckets that actually matter, so it can no longer
  // claim "the buyable names are stacked" while listing six broken ones.
  const anchored = rows.filter(r => r.bucket === 'first-touch');
  const stacked = rows.filter(r => r.bucket === 'stacked');
  const broken = rows.filter(r => r.bucket === 'below-21');
  const reds = rows.filter(r => r.dot === 'red');
  const hasAnyD10 = rows.some(r => r.d10 != null);

  if (anchored.length) {
    lines.push(`${anchored.length} name${anchored.length === 1 ? ' sits' : 's sit'} at a first touch — under the 10, still over the 21. That is where the stop is defined and close.`);
  } else if (!hasAnyD10) {
    lines.push('No 10 EMA distance in the current scan payload — first-touch pullbacks cannot be identified until the scanner runs again.');
  } else if (stacked.length) {
    lines.push(`No first touches. ${stacked.length} name${stacked.length === 1 ? ' is' : 's are'} stacked over the 21 but none has pulled back to the 10 — trend intact, entry not offered.`);
  } else if (broken.length) {
    lines.push(`${broken.length} of ${rows.length} names sit below their 21 EMA. Nothing here is at an anchor — these rank on tape action, not structure.`);
  } else {
    lines.push('No equity in the scan is at a usable anchor.');
  }

  if (reds.length) {
    lines.push(`${reds.length} carrying an active red dot — grade-capped on the long side regardless of tape.`);
  }

  return `10/21 Thesis: ${lines.join('\n')}`;
};

const ep9mVs60dOf = (s: any): number | null => numOrNull(s?.volVs60dMax);
const ep9mTurnOf = (s: any): number | null => numOrNull(s?.floatTurnover);
const ep9mSilent = (s: any): boolean => !hasRealCatalyst(s);

const buildMoversPara = (movers: any): string => {
  const gainers: any[] = Array.isArray(movers?.['Gainers']) ? movers['Gainers'] : [];
  const losers: any[] = Array.isArray(movers?.['Losers']) ? movers['Losers'] : [];
  if (gainers.length === 0 && losers.length === 0) return '';

  const fmtMover = (s: any): string => {
    const chg = `${chgOf(s) >= 0 ? '+' : ''}${chgOf(s).toFixed(2)}%`;
    const rv = rvolOf(s);
    return `${s.ticker} ${chg}${rv != null ? ` · RVOL ${rv.toFixed(2)}` : ''}`;
  };

  const topG = gainers.slice().sort((a, b) => chgOf(b) - chgOf(a)).slice(0, 4);
  const topL = losers.slice().sort((a, b) => chgOf(a) - chgOf(b)).slice(0, 3);

  const lines: string[] = [];
  if (topG.length) {
    const confirmed = topG.filter(s => (rvolOf(s) ?? 0) >= 1.5);
    const confirmNote = confirmed.length
      ? `Volume-confirmed: ${confirmed.map(s => s.ticker).join(', ')}`
      : 'No RVOL over 1.5 — moves are thin, fade candidates.';
    if (topL.length) {
      lines.push(`Leading the tape:\n${topG.map(fmtMover).join('\n')}\n${confirmNote}|||Heaviest red:\n${topL.map(fmtMover).join('\n')}\nWeakness leaders / names to avoid long.`);
    } else {
      lines.push(`Leading the tape:\n${topG.map(fmtMover).join('\n')}\n${confirmNote}`);
    }
  } else if (topL.length) {
    lines.push(`Heaviest red:\n${topL.map(fmtMover).join('\n')}\nWeakness leaders for short setups or names to avoid on the long side.`);
  }
  return `Top Movers: ${lines.join('\n')}`;
};

const buildEp9mPara = (ep9m: any[]): string => {
  const rows = ep9m.filter(s => s?.ticker);
  if (rows.length < 1) return '';

  const fmtEp = (s: any): string => {
    const bits: string[] = [];
    const vs = ep9mVs60dOf(s);
    if (vs != null) bits.push(`${vs.toFixed(2)}× 60d high`);
    const rv = rvolOf(s);
    if (rv != null) bits.push(`RVOL ${rv.toFixed(2)}`);
    const turn = ep9mTurnOf(s);
    if (turn != null && turn >= 0.25) bits.push(`${turn.toFixed(2)}× float`);
    const chg = chgOf(s);
    return `${s.ticker} ${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%${bits.length ? ` · ${bits.join(' · ')}` : ''}`;
  };

  const unprec = rows.filter(ep9mUnprec).sort((a, b) => (ep9mVs60dOf(b) ?? 0) - (ep9mVs60dOf(a) ?? 0));
  const silent = rows.filter(ep9mSilent).sort((a, b) => (rvolOf(b) ?? 0) - (rvolOf(a) ?? 0));
  const news = rows.filter(hasRealCatalyst).sort((a, b) => scoreOf(b) - scoreOf(a));

  const lines: string[] = [];
  if (unprec.length && silent.length) {
    lines.push(`Unprecedented (beat 60d vol high):\n${unprec.slice(0, 5).map(fmtEp).join('\n')}|||Silent (no headline yet):\n${silent.slice(0, 5).map(fmtEp).join('\n')}`);
  } else if (unprec.length) {
    lines.push(`Unprecedented volume (today beats their own 60-day record):\n${unprec.slice(0, 5).map(fmtEp).join('\n')}`);
  } else if (silent.length) {
    lines.push(`Silent — heavy volume, no headline yet:\n${silent.slice(0, 5).map(fmtEp).join('\n')}`);
  }
  if (news.length) lines.push(`With a catalyst already out:\n${news.slice(0, 4).map(fmtEp).join('\n')}`);
  if (!lines.length) {
    lines.push(`${rows.length} name${rows.length !== 1 ? 's' : ''} trading abnormal size:\n${rows.slice(0, 6).map(fmtEp).join('\n')}`);
  }
  return `EP9M Thesis: ${lines.join('\n')}`;
};

const buildLocalInsights = (
  scan: any,
  ep9mList: any[] = [],
  econList: EconEvent[] = [],
  earningsList: EarningsEvent[] = []
): MacroInsights | null => {
  const sips: any[] = Array.isArray(scan?.stocksInPlay) ? scan.stocksInPlay : [];
  const daily: any[] = Array.isArray(scan?.dailySetups) ? scan.dailySetups : [];
  const ep9m: any[] = Array.isArray(ep9mList) ? ep9mList.filter(s => s?.ticker) : [];
  const movers = scan?.topMovers || {};
  if (sips.length === 0 && daily.length === 0 && ep9m.length === 0) return null;

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

  // Posture and dot ride along on the item so the card can chip them without
  // recomputing — and therefore without any chance of disagreeing.
  const watching: WatchItem[] = ranked.map(s => ({
    symbol: s.ticker,
    score: scoreOf(s) || undefined,
    reason: buildWatchReason(s),
    catalyst: catalystTextOf(s),
    catalystUrl: s?.catalystUrl || null,
    posture: posture(s),
    dotKind: dotOf(s),
  }));

  const withNews = pool
    .filter(hasRealCatalyst)
    .slice()
    .sort((a, b) => scoreOf(b) - scoreOf(a))
    .filter((s, i, arr) => arr.findIndex(x => x.ticker === s.ticker) === i);
  const topCatalyst: TopCatalyst | null = withNews.length
    ? {
        ticker: withNews[0].ticker,
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

  const sectorCounts: Record<string, number> = {};
  ranked.forEach(s => {
    const sec = s?.sector && s.sector !== '—' && !isEtfSector(s.sector) ? String(s.sector) : null;
    if (sec) sectorCounts[sec] = (sectorCounts[sec] || 0) + 1;
  });
  const topSectors = Object.entries(sectorCounts).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([sec]) => sec);
  const aCount = ranked.filter(s => scoreOf(s) >= 70).length;
  const theme = titleCase(
    `${topSectors.length ? topSectors.join(' & ') : 'Broad Market'} In Focus — ${aCount > 0 ? `${aCount} A-Grade Setup${aCount > 1 ? 's' : ''}` : 'Momentum Watch'}`
  );

  const sipsSorted = sips.slice().sort((a, b) => (rvolOf(b) ?? 0) - (rvolOf(a) ?? 0));
  const leaders = sipsSorted.filter(s => (rvolOf(s) ?? 0) >= 1.5).slice(0, 3);
  const faders = sips.filter(s => { const r = rvolOf(s); return r != null && r < 1; });
  const newsItems = sips.filter(hasRealCatalyst).slice(0, 4);

  const fmtNewsRow = (s: any): string => {
    const cat = catalystLinked(s);
    const chg = `${chgOf(s) >= 0 ? '+' : ''}${chgOf(s).toFixed(2)}%`;
    const rv = rvolOf(s);
    return `${s.ticker} ${chg}${rv != null ? ` · RVOL ${rv.toFixed(2)}` : ''}${cat ? ` — ${cat}` : ''}`;
  };
  const fmtFaderRow = (s: any): string =>
    `${s.ticker} ${chgOf(s) >= 0 ? '+' : ''}${chgOf(s).toFixed(2)}% · RVOL ${(rvolOf(s) ?? 0).toFixed(2)}`;

  const leadersCol = leaders.length ? `Volume-confirmed:\n${leaders.map(fmtLeader).join('\n')}` : '';
  const newsCol = newsItems.length ? `News-driven:\n${newsItems.map(fmtNewsRow).join('\n')}` : '';
  const fadersCol = faders.length ? `Sub-1.0 RVOL (faders):\n${faders.slice(0, 5).map(fmtFaderRow).join('\n')}` : '';

  const leftCol = leadersCol || newsCol;
  const rightCol = leadersCol ? (fadersCol || newsCol) : fadersCol;

  let sipsPara = '';
  if (leftCol && rightCol && leftCol !== rightCol) {
    const extra = (leadersCol && newsCol && fadersCol) ? `\n${newsCol}` : '';
    sipsPara = `SIPs Thesis: ${leftCol}|||${rightCol}${extra}`;
  } else if (leftCol || rightCol) {
    sipsPara = `SIPs Thesis: ${leftCol || rightCol}`;
  } else if (sips.length) {
    sipsPara = 'SIPs Thesis: No volume-confirmed leaders yet.';
  }

  const fmtDaily = (s: any): string => {
    const chg = `${chgOf(s) >= 0 ? '+' : ''}${chgOf(s).toFixed(2)}%`;
    const bits: string[] = [];
    const rv = rvolOf(s);
    if (rv != null) bits.push(`RVOL ${rv.toFixed(2)}`);
    const su = setupOf(s);
    if (su) bits.push(su);
    const st = stageOf(s);
    if (st) bits.push(`Stage ${st}`);
    const dot = dotOf(s);
    if (dot === 'red') bits.push('RED DOT');
    else if (dot === 'blue') bits.push('BD');
    bits.push(`CNF ${scoreOf(s)}`);
    return `${s.ticker} ${chg} · ${bits.join(' · ')}`;
  };

  const swingNames = daily.filter(s => !isDayName(s)).sort((a, b) => blendedScore(b) - blendedScore(a)).slice(0, 6);
  const dayNames = daily.filter(isDayName).sort((a, b) => blendedScore(b) - blendedScore(a)).slice(0, 6);

  let dailyPara = '';
  if (swingNames.length || dayNames.length) {
    const swingCol = swingNames.length ? `SWING (multi-day hold):\n${swingNames.map(fmtDaily).join('\n')}` : '';
    const dayCol = dayNames.length ? `DAY (intraday only):\n${dayNames.map(fmtDaily).join('\n')}` : '';
    dailyPara = swingCol && dayCol
      ? `Daily Setups Thesis: ${swingCol}|||${dayCol}`
      : `Daily Setups Thesis: ${swingCol || dayCol}`;
  }

  const ema1021Para = build1021Para(pool);

  const heatAgg: Record<string, { sum: number; count: number }> = {};
  flowNames.forEach(s => {
    const sec = s?.sector && s.sector !== '—' && s.sector !== 'Other' && !isEtfSector(s.sector) ? String(s.sector) : null;
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
      `${h.avgChg >= 0 ? '+' : ''}${h.avgChg.toFixed(1)}% · ${h.sector} (${h.count} name${h.count !== 1 ? 's' : ''})`;
    const hot = heat.filter(h => h.avgChg > 0).slice(0, 4);
    const cold = heat.filter(h => h.avgChg < 0).slice(-4).reverse();
    const heatLines: string[] = [];
    if (hot.length && cold.length) {
      heatLines.push(`Strongest:\n${hot.map(fmtHeat).join('\n')}|||Weakest:\n${cold.map(fmtHeat).join('\n')}`);
      heatLines.push(hot[0].avgChg - cold[0].avgChg >= 8
        ? 'Wide dispersion between groups — a stock-picker\'s tape, stay in the leaders.'
        : 'Group dispersion is narrow — moves are market-driven more than industry-driven.');
    } else if (hot.length) {
      heatLines.push(`All tracked groups lean green:\n${hot.map(fmtHeat).join('\n')}\nBroad industry participation.`);
    } else if (cold.length) {
      heatLines.push(`All tracked groups lean red:\n${cold.map(fmtHeat).join('\n')}\nNo industry shelter today.`);
    }
    if (heatLines.length) heatPara = `Industry Heat: ${heatLines.join('\n')}`;
  }

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
      `${e.ticker} ${fmtDollar(e.dVol)} ${e.chg >= 0 ? '+' : ''}${e.chg.toFixed(2)}%`;
    const upD = etfs.filter(e => e.chg > 0).reduce((a, e) => a + e.dVol, 0);
    const totD = etfs.reduce((a, e) => a + e.dVol, 0);
    const upShare = totD > 0 ? Math.round((upD / totD) * 100) : 0;
    const etfLines: string[] = [`Heaviest dollar volume:\n${etfs.slice(0, 4).map(fmtE).join('\n')}`];
    etfLines.push(upShare >= 60
      ? `${upShare}% of ETF dollars are on the advancing side — money is chasing strength.`
      : upShare <= 40
        ? `Only ${upShare}% of ETF dollars are on the advancing side — flows favor the short/defensive vehicles.`
        : `ETF dollars are split ${upShare}/${100 - upShare} between advancing and declining vehicles — no clean directional bet.`);
    etfPara = `ETF Flow: ${etfLines.join('\n')}`;
  }

  let moneyPara = '';
  const totalD = flowNames.reduce((a, s) => a + dVolOf(s), 0);
  if (totalD > 0) {
    const advD = flowNames.filter(s => chgOf(s) > 0).reduce((a, s) => a + dVolOf(s), 0);
    const advShare = Math.round((advD / totalD) * 100);
    const magnets = flowNames
      .slice()
      .sort((a, b) => dVolOf(b) - dVolOf(a))
      .slice(0, 3)
      .map(s => `${s.ticker} ${fmtDollar(dVolOf(s))} ${chgOf(s) >= 0 ? '+' : ''}${chgOf(s).toFixed(2)}%`);

    const inflowAgg: Record<string, number> = {};
    flowNames.filter(s => chgOf(s) > 0).forEach(s => {
      const sec = s?.sector && s.sector !== '—' && s.sector !== 'Other' && !isEtfSector(s.sector) ? String(s.sector) : null;
      if (sec) inflowAgg[sec] = (inflowAgg[sec] || 0) + dVolOf(s);
    });
    const topInflows = Object.entries(inflowAgg).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([sec]) => sec);

    const moneyLines: string[] = [
      `${fmtDollar(totalD)} in tracked dollar volume, ${advShare}% riding the advancing side` +
      (advShare >= 60 ? ' — buyers are paying up.' : advShare <= 40 ? ' — sellers control the tape\'s dollars.' : ' — a two-sided fight.'),
    ];
    if (magnets.length) moneyLines.push(`Dollar magnets:\n${magnets.join('\n')}`);
    if (topInflows.length) moneyLines.push(`Inflows concentrate in ${topInflows.join(' & ')}.`);
    moneyPara = `Money Flow: ${moneyLines.join('\n')}`;
  }

  const keyEventsPara = buildKeyEventsPara(econList, earningsList);
  const moversPara = buildMoversPara(movers);
  const ep9mPara = buildEp9mPara(ep9m);

  const sipsFinal = sipsPara || (sips.length === 0 && (daily.length || ep9m.length) ? 'SIPs Thesis: No stocks in play in the current scan.' : '');
  const dailyFinal = dailyPara || (daily.length === 0 && (sips.length || ep9m.length) ? 'Daily Setups Thesis: No daily setups on the board right now.' : '');
  const ep9mFinal = ep9mPara || (ep9m.length === 0 && (sips.length || daily.length) ? 'EP9M Thesis: No names trading abnormal 9M+ size yet — this fills in as session volume builds.' : '');

  const orderedParas = [
    moversPara, sipsFinal, dailyFinal, ema1021Para, ep9mFinal,
    heatPara, etfPara, moneyPara, keyEventsPara,
  ];

  return {
    theme,
    briefing: orderedParas.filter(Boolean).join('\n\n'),
    watching,
    topCatalyst,
    topCatalysts,
  };
};

const TICKER_STOPWORDS = new Set([
  'RVOL', 'CNF', 'SMB', 'DAY', 'SWING', 'BD', 'REV', 'EP', 'BB', 'SQZ',
  'GLB', 'VCP', 'PB', 'GO', 'GC', 'EMA', 'SMA', 'MACD', 'ATR', 'RS', 'R2G',
  'ETF', 'ETFS', 'STAGE', 'A', 'I', 'AND', 'THE', 'IS', 'ARE',
  'IN', 'OF', 'BY', 'VS', 'ON', 'TO', 'UP', 'AT', 'OR', 'IT', 'AI',
  'US', 'USA', 'FDA', 'SEC', 'IPO', 'CEO', 'EPS', 'FY', 'Q',
  'EST', 'PM', 'AM',
  'ET', 'FOMC', 'CPI', 'PPI', 'GDP', 'NFP', 'PCE', 'ISM', 'FED', 'MOM', 'YOY', 'U6',
  'FIRST', 'TOUCH', 'BELOW', 'CROSS', 'PRE', 'RED', 'DOT', 'BLUE',
]);

const tickerChipCls = "inline-block align-baseline text-[10px] font-bold text-slate-300 bg-slate-500/10 px-1.5 py-[1px] rounded border border-white/10 tracking-wider mx-0.5 min-w-[48px] text-center";
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

const postureChipCls = (tone: 'good' | 'warn' | 'bad'): string => {
  if (tone === 'good') return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
  if (tone === 'warn') return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
  return 'text-rose-400 bg-rose-500/10 border-rose-500/20';
};

const renderBriefingText = (text: string): React.ReactNode[] => {
  const rx = /(▸|RED DOT|BLUE DOT|\[[^\]]+\]\([^)]+\)|\d{1,2}:\d{2} (?:AM|PM)|RVOL \d+(?:\.\d+)?|Stage \d[AB]?|stoch \d+(?:\.\d+)?|RS \+?\d+(?:\.\d+)?|10\/21|S&P|Nasdaq|Dow|Bitcoin|\$\d+(?:\.\d+)?[BMK]|[+-]\d+(?:\.\d+)?%|\b[A-Z]{1,5}\b)/g;
  const parts = text.split(rx);

  return parts.map((part, i) => {
    if (!part) return null;
    if (part === '▸') return <span key={i} className="text-rose-400 font-bold">▸</span>;
    if (part === 'RED DOT') return <span key={i} className="text-rose-400 font-bold tracking-wide">RED DOT</span>;
    if (part === 'BLUE DOT') return <span key={i} className="text-cyan-400 font-bold tracking-wide">BLUE DOT</span>;

    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return <a key={i} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-cyan-300 hover:underline transition-colors">{linkMatch[1]}</a>;
    }
    if (/^\d{1,2}:\d{2} (?:AM|PM)$/.test(part)) {
      return <span key={i} className={`${valNum} text-amber-400 font-bold`}>{part}</span>;
    }

    let m = part.match(/^RVOL (\d+(?:\.\d+)?)$/);
    if (m) {
      const v = parseFloat(m[1]);
      return <span key={i}>RVOL <span className={`${valNum} ${rvolColor(v)}`}>{m[1]}</span></span>;
    }
    m = part.match(/^Stage (\d[AB]?)$/);
    if (m) return <span key={i}>Stage <span className={`${valNum} ${stageColor(m[1])}`}>{m[1]}</span></span>;
    m = part.match(/^stoch (\d+(?:\.\d+)?)$/);
    if (m) {
      const v = parseFloat(m[1]);
      return <span key={i}>stoch <span className={`${valNum} ${stochColor(v)}`}>{m[1]}</span></span>;
    }
    m = part.match(/^RS (\+?\d+(?:\.\d+)?)$/);
    if (m) {
      const v = parseFloat(m[1]);
      return <span key={i}>RS <span className={`${valNum} ${rsColor(v)}`}>{m[1]}</span></span>;
    }
    if (part === '10/21') return <span key={i} className={`${valNum} text-violet-400 font-bold`}>10/21</span>;
    if (part === 'S&P' || part === 'Nasdaq' || part === 'Dow' || part === 'Bitcoin') {
      return <span key={i} className={tickerChipCls}>{part}</span>;
    }
    if (/^\$\d+(?:\.\d+)?[BMK]$/.test(part)) return <span key={i} className={`${valNum} text-slate-200`}>{part}</span>;
    if (/^[+]\d+(?:\.\d+)?%$/.test(part)) return <span key={i} className={`${valNum} text-emerald-400`}>{part}</span>;
    if (/^-\d+(?:\.\d+)?%$/.test(part)) return <span key={i} className={`${valNum} text-rose-400`}>{part}</span>;
    if (part === 'DAY') return <span key={i} className="text-amber-400">DAY</span>;
    if (part === 'SWING') return <span key={i} className="text-cyan-400">SWING</span>;
    if (/^[A-Z]{2,5}$/.test(part) && !TICKER_STOPWORDS.has(part)) {
      return <span key={i} className={tickerChipCls}>{part}</span>;
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
};

const BRIEFING_SECTIONS: { label: string; color: string; blurb: string }[] = [
  { label: 'Top Movers', color: 'emerald', blurb: 'Biggest moves right now. Volume-confirmed names are tradeable; thin gaps are fade candidates.' },
  { label: 'SIPs Thesis', color: 'cyan', blurb: 'Stocks in play — who has real volume behind the move, who has news, and who is grinding on air.' },
  { label: 'Daily Setups Thesis', color: 'emerald', blurb: 'Structured setups from the daily scan. SWING holds for days; DAY is intraday momentum only.' },
  { label: '10/21 Thesis', color: 'violet', blurb: 'Top-ranked names split by holding period, each tagged with its 10/21 EMA posture. Leveraged and inverse ETFs excluded. A name tagged BELOW 21, EXTENDED, or RED DOT ranks on tape action — it is not at an entry.' },
  { label: 'EP9M Thesis', color: 'rose', blurb: 'Abnormal 9M+ share volume — institutional footprints. Unprecedented = beat their own 60-day record.' },
  { label: 'Industry Heat', color: 'amber', blurb: 'Sector rotation — where money is flowing in and where it is leaving. Wide dispersion = stock-picker tape.' },
  { label: 'ETF Flow', color: 'indigo', blurb: 'Heaviest ETF dollar volume and the advancing/declining split — shows where leveraged money is betting.' },
  { label: 'Money Flow', color: 'rose', blurb: 'Total tracked dollar volume across the scanned universe — who is buying, where dollars concentrate, and the advancing share.' },
  { label: 'Key Events', color: 'amber', blurb: 'Today\'s releases and mega-cap prints. ▸ marks what has not happened yet. The only forward-looking section here.' },
  { label: 'Sector Flow', color: 'indigo', blurb: '' },
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

const splitBriefingSection = (para: string): { label: string | null; color: string; blurb: string; body: string } => {
  for (const sec of BRIEFING_SECTIONS) {
    if (para.startsWith(`${sec.label}:`)) {
      return { label: sec.label, color: sec.color, blurb: sec.blurb, body: para.slice(sec.label.length + 1).trim() };
    }
  }
  return { label: null, color: 'indigo', blurb: '', body: para };
};

function SectionCopyButton({ tickers }: { tickers: string[] }) {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = tickers.join(',');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch {}
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button
      onClick={handleCopy}
      title={`Copy ${tickers.length} ticker${tickers.length !== 1 ? 's' : ''}: ${tickers.join(', ')}`}
      className={`text-[9px] font-bold tracking-wider uppercase px-2 py-0.5 rounded border transition-all duration-200 ${
        copied
          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
          : 'bg-[#161c2a] text-slate-500 border-white/5 hover:text-slate-300 hover:bg-white/[0.04]'
      }`}
    >
      {copied ? `✓ ${tickers.length}` : `Copy ${tickers.length}`}
    </button>
  );
}

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
            setData({
              morning: (estTime >= BLOCK_WINDOWS.morning.opens || isWeekend) ? (payload.morning || null) : null,
              midday: (estTime >= BLOCK_WINDOWS.midday.opens || isWeekend) ? (payload.midday || null) : null,
              closing: (estTime >= BLOCK_WINDOWS.closing.opens || isWeekend) ? (payload.closing || null) : null,
              actionableEvents: payload.actionableEvents || [],
            });
          }
        }
      } catch (error) {
        console.error('Narrative Sync Error:', error);
      }

      try {
        const [scannerRes, ep9mRes, econRes, earningsRes] = await Promise.all([
          fetch('/api/scanner/latest', { cache: 'no-store' }),
          fetch(`/api/ep9m/latest?t=${Date.now()}`, { cache: 'no-store' }).catch(() => null),
          fetch('/api/econ', { cache: 'no-store' }).catch(() => null),
          fetch('/api/earnings', { cache: 'no-store' }).catch(() => null),
        ]);
        if (!scannerRes.ok) throw new Error(`Scanner API returned status: ${scannerRes.status}`);

        const scannerData = await scannerRes.json();

        let ep9mList: any[] = [];
        try {
          if (ep9mRes && ep9mRes.ok) {
            const ep9mData = await ep9mRes.json();
            if (ep9mData && Array.isArray(ep9mData.candidates)) ep9mList = ep9mData.candidates;
          }
        } catch { /* ep9m is optional */ }

        let econList: EconEvent[] = [];
        try {
          if (econRes && econRes.ok) {
            const d = await econRes.json();
            if (Array.isArray(d)) econList = d;
          }
        } catch { /* econ is optional */ }

        let earningsList: EarningsEvent[] = [];
        try {
          if (earningsRes && earningsRes.ok) {
            const d = await earningsRes.json();
            if (Array.isArray(d)) earningsList = d;
          }
        } catch { /* earnings is optional */ }

        if (isMounted) {
          const local = buildLocalInsights(scannerData, ep9mList, econList, earningsList);
          if (local) setMacroInsights(local);
          else if (scannerData.macroInsights) setMacroInsights(scannerData.macroInsights);
        }
      } catch (error) {
        console.error('Scanner Macro Sync Error:', error);
      }

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
      case 'cyan': return { bg: 'bg-cyan-500/5', text: 'text-cyan-400', boxBg: 'bg-cyan-500/10', boxBorder: 'border-cyan-500', boxText: 'text-cyan-100/90' };
      case 'emerald': return { bg: 'bg-emerald-500/5', text: 'text-emerald-400', boxBg: 'bg-emerald-500/10', boxBorder: 'border-emerald-500', boxText: 'text-emerald-100/90' };
      case 'rose': return { bg: 'bg-rose-500/5', text: 'text-rose-400', boxBg: 'bg-rose-500/10', boxBorder: 'border-rose-500', boxText: 'text-rose-100/90' };
      case 'amber': return { bg: 'bg-amber-500/5', text: 'text-amber-400', boxBg: 'bg-amber-500/10', boxBorder: 'border-amber-500', boxText: 'text-amber-100/90' };
      case 'indigo': default: return { bg: 'bg-indigo-500/5', text: 'text-indigo-400', boxBg: 'bg-indigo-500/10', boxBorder: 'border-indigo-500', boxText: 'text-indigo-100/90' };
    }
  };

  const getSessionTextColor = () => {
    if (session === 'Pre-Market') return 'text-amber-500';
    if (session === 'Open') return 'text-[#00e676]';
    if (session === 'Post-Market') return 'text-indigo-400';
    return 'text-slate-500';
  };

  const formatBriefing = (text: string) => {
    if (!text) return '';
    return text
      .replace(/(Top Movers:)/gi, '\n\n$1')
      .replace(/(SIPs Thesis:)/gi, '\n\n$1')
      .replace(/(Daily Setups Thesis:)/gi, '\n\n$1')
      .replace(/(10\/21 Thesis:)/gi, '\n\n$1')
      .replace(/(EP9M Thesis:)/gi, '\n\n$1')
      .replace(/(Industry Heat:)/gi, '\n\n$1')
      .replace(/(ETF Flow:)/gi, '\n\n$1')
      .replace(/(Money Flow:)/gi, '\n\n$1')
      .replace(/(Key Events:)/gi, '\n\n$1')
      .replace(/(Sector Flow:)/gi, '\n\n$1');
  };

  const renderSingleUpdateBlock = (block: UpdateBlock | null, key: BlockKey) => {
    if (!block) return null;
    const stale = isBlockStale(key, isWeekend);
    const direction = stale ? null : deriveDirection(block);
    const themeKey =
      direction === 'up' ? 'emerald' :
      direction === 'down' ? 'rose' :
      block.colorTheme;
    const styles = getThemeStyles(themeKey);
    const nextLabel = BLOCK_WINDOWS[key].nextLabel;

    return (
      <div className="bg-[#161c2a]/60 border border-white/5 rounded-xl p-5 md:p-6 mt-3">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className={`w-2 h-2 rounded-full border border-current ${stale ? 'bg-slate-500/10 text-slate-500' : `${styles.bg} ${styles.text}`}`}></div>
          <h4 className={`text-[11px] font-bold tracking-widest uppercase ${stale ? 'text-slate-400' : styles.text}`}>
            {block.phase}
          </h4>
          <span className="text-[9px] text-slate-500 font-medium tracking-wider px-2 py-0.5 bg-black/20 border border-white/5 rounded">
            {block.timestamp}
          </span>
          {stale && (
            <span className="text-[9px] font-bold tracking-widest uppercase text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded">
              Superseded
            </span>
          )}
        </div>

        <div className="space-y-3 mb-5">
          {block.paragraphs.map((p, idx) => (
            <p key={idx} className="text-[13px] text-slate-400 leading-relaxed border-l-[2px] border-slate-500/30 pl-3.5">
              {renderBriefingText(p)}
            </p>
          ))}
        </div>

        <div className={`border-l-[4px] p-4 rounded-r-xl transition-colors duration-300 ${stale ? 'bg-slate-500/[0.07] border-slate-500' : `${styles.boxBg} ${styles.boxBorder}`}`}>
          <p className={`text-[13px] leading-relaxed ${stale ? 'text-slate-300' : styles.boxText}`}>
            {block.takeaway}
          </p>
        </div>

        {stale && (
          <p className="text-[11px] text-amber-400/90 font-medium mt-3 leading-snug">
            Written for the {block.phase.toLowerCase()} window — the tape has moved past this read.
            {nextLabel ? ` Treat it as history until the ${nextLabel} update posts.` : ''}
          </p>
        )}
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

              <div className="relative z-10 flex flex-col gap-8">
                <div>
                  <h3 className="text-[9px] font-bold tracking-widest uppercase text-slate-500 mb-3">Narrative Breakdown</h3>
                  <div className="flex flex-col gap-3">
                    {formatBriefing(macroInsights.briefing).split('\n\n').filter(Boolean).map((para, idx) => {
                      const { label, color, blurb, body } = splitBriefingSection(para.trim());
                      const st = sectionStyles(color);
                      const bodyTickers = Array.from(new Set(
                        (body.match(/\b[A-Z]{2,5}\b/g) || []).filter(t => !TICKER_STOPWORDS.has(t))
                      ));
                      return (
                        <div key={idx} className={`border-l-[3px] rounded-r-xl px-4 py-3 ${st.border} ${st.bg}`}>
                          {label && (
                            <div className="mb-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`inline-block text-[9px] font-bold tracking-widest uppercase px-2 py-0.5 rounded border ${st.badge}`}>
                                  {label}
                                </span>
                                {bodyTickers.length > 0 && <SectionCopyButton tickers={bodyTickers} />}
                              </div>
                              {blurb && <p className="text-[11px] text-slate-500 font-medium mt-1.5 leading-snug">{blurb}</p>}
                            </div>
                          )}
                          {body.includes('|||') ? (
                            (() => {
                              const parts = body.split('|||');
                              const afterCols = parts.length > 2 ? parts.slice(2).join('') : '';
                              return (
                                <>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                                    {parts.slice(0, 2).map((col, ci) => {
                                      const colLines = col.trim().split('\n').filter(Boolean);
                                      const [heading, ...rows] = colLines;
                                      const isHeading = heading && heading.trim().endsWith(':');
                                      return (
                                        <div key={ci} className="space-y-1.5">
                                          {isHeading ? (
                                            <>
                                              <p className="text-[10px] font-bold tracking-wider uppercase text-slate-500 pb-0.5 border-b border-white/5">
                                                {heading.replace(/:$/, '')}
                                              </p>
                                              {rows.map((line, li) => (
                                                <p key={li} className="text-[13px] text-slate-300 leading-relaxed font-medium">
                                                  {renderBriefingText(line)}
                                                </p>
                                              ))}
                                            </>
                                          ) : (
                                            colLines.map((line, li) => (
                                              <p key={li} className="text-[13px] text-slate-300 leading-relaxed font-medium">
                                                {renderBriefingText(line)}
                                              </p>
                                            ))
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                  {afterCols && (
                                    <div className="space-y-1.5 mt-4 pt-3 border-t border-white/5">
                                      {afterCols.trim().split('\n').filter(Boolean).map((line, li) => (
                                        <p key={li} className="text-[12px] text-slate-400 leading-relaxed font-medium">
                                          {renderBriefingText(line)}
                                        </p>
                                      ))}
                                    </div>
                                  )}
                                </>
                              );
                            })()
                          ) : (
                            <div className="space-y-2">
                              {body.split('\n').filter(Boolean).map((line, li) => (
                                <p key={li} className="text-[13px] text-slate-300 leading-relaxed font-medium">
                                  {renderBriefingText(line)}
                                </p>
                              ))}
                            </div>
                          )}
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
                      const pb = typeof item === 'string' ? null : (item.posture || null);
                      const pMeta = pb ? POSTURE_META[pb] : null;
                      const dk = typeof item === 'string' ? null : (item.dotKind || null);

                      let parsedScore: number | undefined = undefined;
                      if (typeof item === 'object' && item.score !== undefined && item.score !== null) {
                        const n = Number(item.score.toString().replace(/\D/g, ''));
                        if (!isNaN(n)) parsedScore = n;
                      }

                      return (
                        <li key={idx} className={`flex flex-col gap-2 bg-[#161c2a]/60 p-3.5 rounded-xl border transition-colors ${
                          dk === 'red' ? 'border-rose-500/25 hover:border-rose-500/40' : 'border-white/5 hover:border-cyan-500/20'
                        }`}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20 tracking-wider">
                              {symbol}
                            </span>
                            <div className="flex items-center gap-1.5">
                              {dk && (
                                <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded border tracking-wider uppercase ${
                                  dk === 'red'
                                    ? 'text-rose-400 bg-rose-500/10 border-rose-500/20'
                                    : 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20'
                                }`}>
                                  {dk === 'red' ? 'RD' : 'BD'}
                                </span>
                              )}
                              {pMeta && (
                                <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded border tracking-wider uppercase ${postureChipCls(pMeta.tone)}`}>
                                  {pMeta.short}
                                </span>
                              )}
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
                          </div>
                          {(() => {
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
                {data?.morning && renderSingleUpdateBlock(data.morning, 'morning')}
                {data?.midday && renderSingleUpdateBlock(data.midday, 'midday')}
                {data?.closing && renderSingleUpdateBlock(data.closing, 'closing')}

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
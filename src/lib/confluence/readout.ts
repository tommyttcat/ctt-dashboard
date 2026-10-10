// lib/confluence/readout.ts — the Confluence page in plain words.
//
// Two halves, both pure so scripts/plan.test.mts can pin them:
//
//   reportPlanOf / scanPlanFor   builder side (api/confluence/run). Copies the
//                                SCAN's own buy level and stop onto each report
//                                from rows the builder already holds — no new
//                                KV read, no new fetch.
//   levelsFor                    page side. Reads report.plan through the same
//                                trigRowOf + planStatusOf the Setups Summary
//                                card uses, so the Confluence page can never
//                                quote a buy level or a status the rest of the
//                                site disagrees with. Falls back to the
//                                report's own tradeRec only when no scan plan
//                                exists, and says so.
//
// Everything else here turns indicator output into reader words: no RSI, no
// MACD, no EMA, no R-multiples on the face of a card.

import { trigRowOf, planStatusOf, type PlanStatus } from '@/lib/scans/triggerProximity';
import { MOVER_SOURCES } from '@/lib/summary/rowFormat';
import { numOrNull } from '@/lib/summary/rowFormat';

// ---- types -----------------------------------------------------------------

/** The scan's plan as stored on a confluence report. */
export interface ReportPlan {
  trigger: number;
  stop: number;
  overextended: boolean;
  tradeable: boolean;
  collapsed: boolean;
  /** Which scan the plan came from ('daily', 'swing', 'ep9m', 'vcp', ...). */
  source: string;
}

export interface ReportTf {
  timeframe: string;
  rsi: number | null;
  rsiLabel: string;
  bias: string;
}

/** The fields of a stored confluence report these helpers read. */
export interface ReadoutReport {
  ticker: string;
  name?: string;
  price: number;
  changePct?: number;
  adrPct: number | null;
  rvol: number;
  setupName?: string;
  catalyst?: string;
  confluenceLabel: string;
  timeframes: ReportTf[];
  levels: { resistance: number[]; support: number[] };
  tradeRec: { entry: string; stopLoss: string } | null;
  plan?: ReportPlan | null;
}

// ---- builder side ----------------------------------------------------------

/** A scan row's plan in the report's shape, or null when it has no levels.
 *  VCP is the one scan that carries trigger/stop at the top level. */
export function reportPlanOf(row: any, source: string): ReportPlan | null {
  if (!row) return null;
  const isVcp = source === 'vcp';
  const p = row.plan && typeof row.plan === 'object' ? row.plan : null;
  const trigger = numOrNull(p?.trigger ?? (isVcp ? row.trigger : null));
  const stop = numOrNull(p?.stop ?? (isVcp ? row.stop : null));
  if (trigger == null || stop == null || trigger <= 0) return null;
  return {
    trigger,
    stop,
    overextended: p?.overextended === true,
    tradeable: p ? p.tradeable === true : isVcp,
    collapsed: p?.collapsed === true,
    source,
  };
}

const isLive = (p: ReportPlan) => p.tradeable && !p.collapsed;

/** The plan for one ticker from lists already in hand, searched in the order
 *  given (the site's own precedence). A live plan beats a dead one. */
export function scanPlanFor(ticker: string, lists: [string, any[] | null | undefined][]): ReportPlan | null {
  let fallback: ReportPlan | null = null;
  for (const [source, rows] of lists) {
    // Movers, not buys (rowFormat MOVER_SOURCES): Daily / Stocks in Play carry no plan.
    if (!Array.isArray(rows) || MOVER_SOURCES.has(source)) continue;
    const row = rows.find(s => (s?.ticker ?? s?.symbol) === ticker);
    const plan = reportPlanOf(row, source);
    if (!plan) continue;
    if (isLive(plan)) return plan;
    fallback ??= plan;
  }
  return fallback;
}

// ---- page side: levels -------------------------------------------------------

export type Levels =
  | {
      kind: 'scan';
      buyLabel: 'Buy above' | 'Buy dip' | 'At market';
      trigger: number;
      stop: number;
      status: PlanStatus;
      awayPct: number;
      source: string;
    }
  | {
      kind: 'report';
      trigger: string;
      stop: string;
      /** Why these are not the scan's levels. */
      note: string;
    };

export const NOTE_NOT_ON_SCAN = 'Levels from this report — not on a scan today';
export const NOTE_PLAN_OFF = "Levels from this report — the scan's plan is off for this name today";

/** Adapter: a report with a plan becomes the row shape planStatusOf reads. */
export function planRowOfReport(r: ReadoutReport) {
  const p = r.plan;
  if (!p) return null;
  return trigRowOf(
    {
      ticker: r.ticker,
      price: r.price,
      adrPct: r.adrPct,
      _source: p.source,
      plan: { trigger: p.trigger, stop: p.stop, overextended: p.overextended, tradeable: p.tradeable, collapsed: p.collapsed },
    },
    { keepThrough: true, keepExtended: true },
  );
}

const stripDollar = (s: string) => s.replace(/^\$/, '');

export function levelsFor(r: ReadoutReport): Levels | null {
  const row = planRowOfReport(r);
  if (row) {
    return {
      kind: 'scan',
      buyLabel: row.atMarket ? 'At market' : row.pullback ? 'Buy dip' : 'Buy above',
      trigger: row.trigger,
      stop: row.stop,
      status: planStatusOf(row),
      awayPct: row.awayPct,
      source: r.plan!.source,
    };
  }
  if (!r.tradeRec) return null;
  return {
    kind: 'report',
    trigger: stripDollar(r.tradeRec.entry),
    stop: stripDollar(r.tradeRec.stopLoss),
    note: r.plan ? NOTE_PLAN_OFF : NOTE_NOT_ON_SCAN,
  };
}

export function statusText(status: PlanStatus, awayPct: number): string {
  return status === 'wait' ? `${awayPct.toFixed(1)}% away` : status.toUpperCase();
}

/** What each status word means, for the one help dot on the page. */
export const STATUS_HELP =
  'Buy above / Stop are the scan\'s own levels — the same ones on the dashboard.\n' +
  'N% AWAY — not at the buy level yet.\n' +
  'HIT — at or just through the buy level.\n' +
  'MISS — ran more than a normal day\'s move past it. Buying now is chasing.\n' +
  'EXT — too stretched for a sensible stop. Levels are for reference only.\n' +
  'OUT — at or below the stop. The idea failed.';

export const fmtLvl = (v: number): string =>
  v >= 1000 ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v.toFixed(2);

// ---- page side: plain words -----------------------------------------------

const tfOf = (r: ReadoutReport, tf: string) => r.timeframes.find(t => t.timeframe === tf);

export function counts(reports: ReadoutReport[]) {
  const lineUp = reports.filter(r => r.confluenceLabel === 'Bullish').length;
  const mixed = reports.filter(r => r.confluenceLabel === 'Mixed').length;
  return { lineUp, mixed, down: reports.length - lineUp - mixed, total: reports.length };
}

/** The hero: one verdict and one line under it. */
export function verdictOf(overallBias: string | null | undefined, reports: ReadoutReport[]) {
  const c = counts(reports);
  const bias = (overallBias ?? '').toUpperCase();
  const headline = bias === 'BULLISH'
    ? `Leaning bullish — ${c.lineUp} of ${c.total} line up on both timeframes.`
    : bias === 'BEARISH'
      ? `Leaning bearish — ${c.down} of ${c.total} point down.`
      : `Mixed — ${c.lineUp} of ${c.total} line up on both timeframes.`;
  const downPart = c.down === 0 ? 'None point down.' : `${c.down} point${c.down === 1 ? 's' : ''} down.`;
  const mixedPart = c.mixed === 0 ? '' : ` ${c.mixed} ${c.mixed === 1 ? 'is' : 'are'} mixed: the day and the week disagree.`;
  const advice = bias === 'BULLISH' ? ' Favour pullbacks over chasing.'
    : bias === 'BEARISH' ? ' Play defence — wait for better setups.'
    : ' Be selective — only the cleanest names.';
  return { headline, sub: `${downPart}${mixedPart}${advice}`, ...c };
}

const dailyWord = (bias: string | undefined) =>
  bias === 'BULLISH' ? 'up' : bias === 'BEARISH' ? 'down' : 'sideways';

const weeklyWord = (tf: ReportTf) =>
  tf.rsiLabel === 'overbought' ? 'stretched'
    : tf.bias === 'BULLISH' ? 'up' : tf.bias === 'BEARISH' ? 'down' : 'flat';

export function trendLine(r: ReadoutReport): string {
  const d = tfOf(r, 'Daily');
  const w = tfOf(r, 'Weekly');
  const parts: string[] = [];
  if (d) parts.push(`Daily ${dailyWord(d.bias)}`);
  if (w) parts.push(`${parts.length ? 'weekly' : 'Weekly'} ${weeklyWord(w)}`);
  return parts.join(' · ') || '—';
}

const SETUP_WORDS: Record<string, string> = {
  '20 EMA PB': 'Pullback to its 20-day',
  'EMA Pullback': 'Pullback to its 20-day',
  'Trend Hold': 'Holding its trend',
  'R2G': 'Red to green',
  'Gap & Go': 'Gap and go',
  'Gap and Go': 'Gap and go',
  'Episodic Pivot': 'Big news gap',
  'Inside Day': 'Inside-day breakout',
  'Range Breakout': 'Range breakout',
  'Power Earnings Gap': 'Earnings gap',
  'Momentum Burst': 'Momentum burst',
  'Blue Dot Rev': 'Oversold bounce',
};

export function setupWords(name: string | null | undefined): string {
  const n = (name ?? '').trim();
  if (!n || n === '-' || n === '—' || n === 'Technical Momentum') return '';
  if (SETUP_WORDS[n]) return SETUP_WORDS[n];
  if (n.startsWith('Inside Day')) return 'Inside-day breakout';
  if (n.includes('BB SQZ')) return 'Tight squeeze';
  if (/blue dot/i.test(n)) return 'Oversold bounce';
  return n;
}

/* "Red to green · Technical Momentum catalyst" read as noise. Setup in plain
   words, then the news reason only when it is a real one. */
const REAL_CATALYST = /earnings|fda|analyst|upgrade|downgrade|m&a|merger|takeover|acqui|contract|guidance|offering|legal/i;
export function whyLine(r: ReadoutReport): string {
  const setup = setupWords(r.setupName);
  const cat = String(r.catalyst || '').replace(/\s*\(delayed\)\s*/i, '').trim();
  const news = cat && REAL_CATALYST.test(cat) ? `${cat.toLowerCase()} news` : '';
  if (setup && news) return `${setup}, on ${news}.`;
  return setup ? `${setup}.` : news ? `Moving on ${news}.` : '';
}

export type FlagTone = 'amber' | 'rose' | 'slate';

/** Thresholds are the report's own risk notes and the edge tint's (lib/scans/edge.ts). */
export function flagsOf(r: ReadoutReport): { text: string; tone: FlagTone }[] {
  const out: { text: string; tone: FlagTone }[] = [];
  const d = tfOf(r, 'Daily');
  if (d?.rsi != null && d.rsi >= 70) out.push({ text: 'Overbought — chase risk', tone: 'amber' });
  if (r.adrPct != null && r.adrPct > 9) out.push({ text: 'Very volatile — size down', tone: 'rose' });
  if (r.price >= 5 && r.price < 10) out.push({ text: '$5–10 — weakest price band', tone: 'rose' });
  if (r.rvol < 1) out.push({ text: 'Light volume', tone: 'slate' });
  return out;
}

/** "Nebius Group N.V. Class A Ordinary Shares" -> "Nebius Group". */
export function shortName(name: string | null | undefined, ticker: string): string {
  let s = (name ?? '').split(',')[0].trim();
  s = s.replace(/\s+(Class\s+[A-Z]\b.*|Common Stock.*|Ordinary Shares.*|American Depositary.*|Sponsored ADR.*|ADR\b.*)$/i, '').trim();
  let prev = '';
  while (prev !== s) {
    prev = s;
    s = s.replace(/\s+(Inc\.?|Corp\.?|Corporation|N\.V\.|Ltd\.?|Limited|plc|S\.A\.|L\.P\.|Co\.?|Holdings?)$/i, '').trim();
  }
  return s && s !== ticker ? s : '';
}

/** A risk note shortened to its first clause, with indicator names taken out. */
export function shortRisk(note: string): string {
  return note
    .split(' — ')[0]
    .replace(/\s*\(RSI[^)]*\)/g, '')
    .replace(/ADR above 9%/g, 'daily swings above 9%')
    .replace(/\.$/, '')
    .trim();
}

/** The one line under BEST THREE, about the lead pick. */
export function bestLine(r: ReadoutReport | undefined): string {
  if (!r) return '';
  const lv = levelsFor(r);
  const where = !lv || lv.kind === 'report' ? ''
    : lv.status === 'wait' ? `${lv.awayPct.toFixed(1)}% from its buy level`
    : lv.status === 'hit' ? 'at its buy level'
    : lv.status === 'ext' ? 'stretched — wait for a pullback'
    : lv.status === 'miss' ? 'already ran past its buy level'
    : 'below its stop';
  const trend = r.confluenceLabel === 'Bullish' ? 'strong trend on both timeframes'
    : r.confluenceLabel === 'Mixed' ? 'the day and the week disagree'
    : 'weak on both timeframes';
  return where ? `${r.ticker} leads: ${where}, ${trend}.` : `${r.ticker} leads: ${trend}.`;
}

// ---- has the move happened? (9 Oct 2026) -------------------------------------
/* How far the name has already run, in its own average daily ranges (ADR), so
   a $20 stock and a $900 stock read the same:
     today   today's change / ADR%           (1.0 = a full normal day already)
     stretch (price − daily 21 EMA) / ADR    (distance above its 21-day line)
   extended  stretch 3+ ADRs, or today 1.5+ ADRs, or daily RSI 75+
   moving    stretch 1.5+ ADRs, or today 0.75+ ADRs
   early     neither — still near its 21-day line on a normal day
   The thresholds are a description, not a tested signal: buying names that
   had used little of the day's range did no better over 10 days in
   scripts/backtest/atr-lod.ts. */
export type MoveState = 'early' | 'moving' | 'extended';
export interface MoveRead { state: MoveState; today: number | null; stretch: number | null }
export function moveStatus(r: ReadoutReport): MoveRead | null {
  const adr = r.adrPct;
  if (!(adr != null && adr > 0) || !(r.price > 0)) return null;
  const d = r.timeframes.find(t => t.timeframe === 'Daily') as (ReportTf & { ema21?: number | null }) | undefined;
  const e21 = d?.ema21 ?? null;
  const today = r.changePct != null ? r.changePct / adr : null;
  const stretch = e21 != null && e21 > 0 ? ((r.price - e21) / e21) * 100 / adr : null;
  if (today == null && stretch == null) return null;
  const rsi = d?.rsi ?? null;
  const state: MoveState =
    (stretch != null && stretch >= 3) || (today != null && today >= 1.5) || (rsi != null && rsi >= 75) ? 'extended'
      : (stretch != null && stretch >= 1.5) || (today != null && today >= 0.75) ? 'moving'
        : 'early';
  return { state, today, stretch };
}

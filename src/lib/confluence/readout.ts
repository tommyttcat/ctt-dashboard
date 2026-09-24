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
    if (!Array.isArray(rows)) continue;
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
      buyLabel: 'Buy above' | 'Buy dip';
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
      buyLabel: row.pullback ? 'Buy dip' : 'Buy above',
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

export function whyLine(r: ReadoutReport): string {
  const parts = [setupWords(r.setupName), r.catalyst ? `${r.catalyst} catalyst` : ''].filter(Boolean);
  return parts.join(' · ');
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
  const where = !lv || lv.kind === 'report' ? 'not on a scan today'
    : lv.status === 'wait' ? `${lv.awayPct.toFixed(1)}% from its buy level`
    : lv.status === 'hit' ? 'at its buy level'
    : lv.status === 'ext' ? 'stretched — wait for a pullback'
    : lv.status === 'miss' ? 'already ran past its buy level'
    : 'below its stop';
  const trend = r.confluenceLabel === 'Bullish' ? 'strong trend on both timeframes'
    : r.confluenceLabel === 'Mixed' ? 'the day and the week disagree'
    : 'weak on both timeframes';
  return `${r.ticker} leads: ${where}, ${trend}.`;
}

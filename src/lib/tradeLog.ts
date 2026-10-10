// lib/tradeLog.ts — the owner's own trade log, scored against QQQ over the same days.
//
// 10 Oct 2026: every mechanical test of the scanners (buy every hit) lost to holding QQQ.
// What none of them measured is the owner's judgment — which hits they actually take and
// how they manage them. This log is that test: each trade they take, its % result, and
// what QQQ did over the same days. After 30-50 closed trades it answers "do the scanners
// plus my eye beat doing nothing".
//
// QQQ comparison: QQQ's open on the buy date to its close on the sell date (or the last
// close while the trade is open). The buy can be any time that day, so this is close, not
// exact. Long trades only. A partial sell is logged as two trades.

export const TRADE_LOG_KEY = 'trade_log_v1';
export const MAX_TRADES = 2000;

export interface Trade {
  id: string;
  t: string;              // ticker
  src: string;            // which scanner / card it came from
  buyDate: string;        // YYYY-MM-DD
  buy: number;
  shares: number | null;  // optional; enables the $ lines
  sellDate: string | null;
  sell: number | null;
  note: string;
}

export interface TradeLog { trades: Trade[]; updatedAt: string }

/** QQQ daily bars by date: [open, close]. */
export type Bars = Record<string, [number, number]>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;

/** Clean an incoming trade; returns an error string when it cannot be stored. */
export function cleanTrade(raw: Record<string, unknown>, today: string): Trade | string {
  const t = String(raw.t ?? '').trim().toUpperCase();
  if (!TICKER.test(t)) return 'ticker looks wrong';
  const buyDate = String(raw.buyDate ?? '');
  if (!DATE.test(buyDate) || buyDate > today) return 'buy date looks wrong';
  const buy = Number(raw.buy);
  if (!(buy > 0)) return 'buy price must be above 0';
  const sharesRaw = raw.shares === '' || raw.shares == null ? null : Number(raw.shares);
  if (sharesRaw != null && !(sharesRaw > 0)) return 'shares must be above 0 or blank';
  const sellDate = raw.sellDate ? String(raw.sellDate) : null;
  const sellRaw = raw.sell === '' || raw.sell == null ? null : Number(raw.sell);
  if ((sellDate == null) !== (sellRaw == null)) return 'a sell needs both a date and a price';
  if (sellDate != null && (!DATE.test(sellDate) || sellDate < buyDate || sellDate > today)) return 'sell date looks wrong';
  if (sellRaw != null && !(sellRaw > 0)) return 'sell price must be above 0';
  const id = typeof raw.id === 'string' && /^[a-z0-9]{6,20}$/.test(raw.id) ? raw.id : Math.random().toString(36).slice(2, 12);
  return {
    id, t, src: String(raw.src ?? '').trim().slice(0, 30) || 'Other', buyDate, buy,
    shares: sharesRaw, sellDate, sell: sellRaw, note: String(raw.note ?? '').trim().slice(0, 300),
  };
}

export interface ScoredTrade extends Trade {
  open: boolean;
  exitPx: number | null;      // sell, or the last close while open
  pct: number | null;         // the trade, %
  qqqPct: number | null;      // QQQ over the same days, %
  vsQqq: number | null;       // pct - qqqPct
  dollars: number | null;     // with shares
  qqqDollars: number | null;  // the same dollars in QQQ
  days: number | null;        // calendar days held
}

export interface Agg {
  n: number; wins: number; avgPct: number | null; avgQqq: number | null; beatQqq: number;
  dollars: number | null; qqqDollars: number | null;
}

/** First bar on or after `d` (open) / on or before `d` (close). */
const openOn = (bars: Bars, dates: string[], d: string) => { const x = dates.find(k => k >= d); return x ? bars[x][0] : null; };
const closeOn = (bars: Bars, dates: string[], d: string) => { let x: string | null = null; for (const k of dates) { if (k <= d) x = k; else break; } return x ? bars[x][1] : null; };

export function scoreTrades(trades: Trade[], bars: Bars, last: Record<string, number>, today: string): ScoredTrade[] {
  const dates = Object.keys(bars).sort();
  return trades.map(tr => {
    const open = tr.sell == null;
    const exitPx = open ? (last[tr.t] ?? null) : tr.sell;
    const pct = exitPx != null ? (exitPx / tr.buy - 1) * 100 : null;
    const q0 = openOn(bars, dates, tr.buyDate), q1 = closeOn(bars, dates, open ? today : (tr.sellDate as string));
    const qqqPct = q0 && q1 ? (q1 / q0 - 1) * 100 : null;
    const cost = tr.shares != null ? tr.shares * tr.buy : null;
    const end = open ? today : (tr.sellDate as string);
    return {
      ...tr, open, exitPx, pct, qqqPct,
      vsQqq: pct != null && qqqPct != null ? pct - qqqPct : null,
      dollars: cost != null && exitPx != null ? (tr.shares as number) * (exitPx - tr.buy) : null,
      qqqDollars: cost != null && qqqPct != null ? cost * qqqPct / 100 : null,
      days: Math.round((Date.parse(end) - Date.parse(tr.buyDate)) / 864e5),
    };
  });
}

export function aggregate(rows: ScoredTrade[]): Agg {
  const s = rows.filter(r => r.pct != null);
  const q = s.filter(r => r.qqqPct != null);
  const withD = s.filter(r => r.dollars != null && r.qqqDollars != null);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    n: s.length,
    wins: s.filter(r => (r.pct as number) > 0).length,
    avgPct: mean(s.map(r => r.pct as number)),
    avgQqq: mean(q.map(r => r.qqqPct as number)),
    beatQqq: q.filter(r => (r.vsQqq as number) > 0).length,
    dollars: withD.length ? withD.reduce((a, r) => a + (r.dollars as number), 0) : null,
    qqqDollars: withD.length ? withD.reduce((a, r) => a + (r.qqqDollars as number), 0) : null,
  };
}

/** Closed trades overall and by source, plus open trades marked to the last close. */
export function summarize(rows: ScoredTrade[]) {
  const closed = rows.filter(r => !r.open);
  const bySrc: Record<string, Agg> = {};
  for (const src of [...new Set(closed.map(r => r.src))].sort()) bySrc[src] = aggregate(closed.filter(r => r.src === src));
  return { closed: aggregate(closed), open: aggregate(rows.filter(r => r.open)), bySrc };
}

// lib/modelBook.ts — the Model Book: one paper account run by fixed rules.
//
// The other two records score every pick on its own. This one is what an
// account following the site would actually have held: ten slots, a cash
// balance, position sizes, and the trades it had to skip because the slots
// were full. It is the live test of scripts/backtest/portfolio.ts, the
// `card-hold20-always` variant, and must keep those rules to stay comparable.
//
// RULES — fixed 24 Sep 2026. Changing one starts a new book, not an edit.
//   Universe   green rows only, each scan by its own edge.ts function:
//                Stocks in Play + Daily (edgeTier)  bought at the next open
//                Swing Candidates (swingTier)       bought at the next open
//                EP9M (ep9mTier)                    bought on a dip to the
//                  EP-day midpoint, from the second session after the pick,
//                  within 10 sessions; a close under the EP-day low cancels
//   Stop       the card's stop (plan stop, else the pick day's low; EP9M =
//              the EP-day low), never closer than 0.5% of the fill. A gap
//              through it exits at the open; a stop touched on the entry day
//              counts as hit (daily bars cannot order it against the fill).
//   Exit       the stop, or the close of the 20th session held.
//   Account    $100,000 paper. 0.5% of equity (prior close) at risk per
//              trade, no position above 20% of equity, no margin, at most 10
//              open, one position per ticker.
//   Ranking    more buys than free slots: highest RS rating first.
//   Costs      0.10% slippage on every fill, both sides.
//
// Cost: one KV read and one write inside the daily tick, which already has
// the bars and the scan rows. Flat in users; nothing runs on a page view.

import { edgeTier, swingTier, ep9mTier } from '@/lib/scans/edge';

export const MODEL_BOOK_KEY = 'model_book_v1';

export const MB = {
  equity0: 100_000,
  risk: 0.005,
  maxPos: 10,
  maxWeight: 0.2,
  slip: 0.001,
  hold: 20,
  openWindow: 5,     // sessions a next-open buy waits for a bar (halts, data gaps)
  dipWindow: 10,     // sessions an EP9M dip stays live
  minRiskPct: 0.5,
  closedCap: 60,
} as const;

export type BookScan = 'sip' | 'daily' | 'swing' | 'ep9m';
export const BOOK_SCANS: BookScan[] = ['sip', 'daily', 'swing', 'ep9m'];

export interface Bar { o: number; h: number; l: number; c: number }

/** A buy the book will make on a coming session, if it has a slot. */
export interface BookCandidate {
  t: string; scan: BookScan; d: string;
  rs: number;
  kind: 'open' | 'dip';
  stop: number;
  buy: number | null;   // dip level (EP-day midpoint); null for next-open buys
  age: number;          // ticks since the pick
  seen: number;         // sessions with a bar since the pick
}

export interface BookHolding {
  t: string; scan: BookScan; d: string;
  entryDate: string;
  fill: number;         // the price the rules bought at, before slippage
  stop: number;
  sh: number;
  n: number;            // sessions held, entry day = 1
  last: number;
}

export interface BookClosed {
  t: string; scan: BookScan; d: string;
  entryDate: string; exitDate: string;
  fill: number; exit: number; stop: number; sh: number;
  r: number;            // after slippage, per unit of risk
  pnl: number;          // dollars, after slippage
  how: 'stop' | 'time';
}

export interface ModelBook {
  v: 1;
  startedOn: string;
  lastDate: string | null;
  cash: number;
  equity: number;
  peak: number;
  maxDdPct: number;
  spy0: number | null;
  spyLast: number | null;
  candidates: BookCandidate[];
  open: BookHolding[];
  closed: BookClosed[];            // newest first, capped; the totals below are not
  curve: [string, number, number | null][];   // [date, equity, SPY close]
  totals: { trades: number; wins: number; sumR: number; pnl: number; skippedFull: number };
  updatedAt?: string;
}

export function newBook(date: string, spyClose: number | null): ModelBook {
  return {
    v: 1, startedOn: date, lastDate: null,
    cash: MB.equity0, equity: MB.equity0, peak: MB.equity0, maxDdPct: 0,
    spy0: spyClose, spyLast: spyClose,
    candidates: [], open: [], closed: [], curve: [],
    totals: { trades: 0, wins: 0, sumR: 0, pnl: 0, skippedFull: 0 },
  };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The tier function each scan was measured with. */
export function bookTier(scan: BookScan, row: Record<string, unknown>): string | null {
  if (scan === 'swing') return swingTier(row as never);
  if (scan === 'ep9m') return ep9mTier(row as never);
  return edgeTier(row as never);
}

/** A green row becomes a candidate; anything else (or unusable levels) is null. */
export function candidateFrom(scan: BookScan, row: Record<string, unknown>, date: string): BookCandidate | null {
  if (bookTier(scan, row) !== 'green') return null;
  const t = String(row.ticker ?? row.symbol ?? '').toUpperCase();
  if (!t) return null;
  const rs = num(row.rsRating) ?? -1;
  const dayLow = num(row.dayLow);
  const plan = row.plan as { tradeable?: boolean; stop?: number | null } | undefined;

  if (scan === 'ep9m') {
    const hi = num(row.dayHigh);
    if (hi == null || dayLow == null || !(hi > dayLow)) return null;
    return { t, scan, d: date, rs, kind: 'dip', stop: dayLow, buy: (hi + dayLow) / 2, age: 0, seen: 0 };
  }
  const planStop = plan?.tradeable ? num(plan.stop) : null;
  const stop = planStop ?? dayLow;
  if (stop == null || !(stop > 0)) return null;
  return { t, scan, d: date, rs, kind: 'open', stop, buy: null, age: 0, seen: 0 };
}

/** Tonight's picks, green only, one per ticker, never one the book already holds or waits on. */
export function addPicks(book: ModelBook, date: string, rowsByScan: Partial<Record<BookScan, Record<string, unknown>[]>>): number {
  const taken = new Set([...book.open.map(h => h.t), ...book.candidates.map(c => c.t)]);
  let added = 0;
  for (const scan of BOOK_SCANS) {
    for (const row of rowsByScan[scan] ?? []) {
      const c = candidateFrom(scan, row, date);
      if (!c || taken.has(c.t)) continue;
      taken.add(c.t);
      book.candidates.push(c);
      added++;
    }
  }
  return added;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * One session forward on `date`'s bars: buys at the open, then stops and
 * time exits through the close, then the mark. Same order as the backtest —
 * a slot freed by today's exit is not reused until tomorrow's open.
 */
export function stepBook(book: ModelBook, date: string, bars: Map<string, Bar>, spyClose: number | null): void {
  if (book.lastDate === date) return;
  const equityPrev = book.equity;

  // 1. Today's buys.
  const buys: { c: BookCandidate; fill: number }[] = [];
  const keep: BookCandidate[] = [];
  for (const c of book.candidates) {
    c.age += 1;
    const bar = bars.get(c.t);
    if (c.kind === 'open') {
      if (!bar || !(bar.o > 0)) { if (c.age < MB.openWindow) keep.push(c); continue; }
      if (bar.o > c.stop) buys.push({ c, fill: bar.o });
      continue;                              // one shot: bought, or opened under its stop
    }
    if (!bar) { if (c.age < MB.dipWindow) keep.push(c); continue; }
    c.seen += 1;
    const mid = c.buy as number;
    if (c.seen >= 2 && bar.l <= mid && bar.o > c.stop) { buys.push({ c, fill: Math.min(mid, bar.o) }); continue; }
    if (bar.c < c.stop) continue;            // closed under the EP-day low: setup dead
    if (c.age < MB.dipWindow) keep.push(c);
  }
  book.candidates = keep;

  buys.sort((a, b) => b.c.rs - a.c.rs);
  for (const { c, fill } of buys) {
    if (book.open.length >= MB.maxPos) { book.totals.skippedFull += 1; continue; }
    if (book.open.some(h => h.t === c.t)) continue;
    const stop = fill - c.stop < fill * (MB.minRiskPct / 100) ? fill * (1 - MB.minRiskPct / 100) : c.stop;
    const cost = fill * (1 + MB.slip);
    let sh = Math.floor((MB.risk * equityPrev) / (fill - stop));
    sh = Math.min(sh, Math.floor((MB.maxWeight * equityPrev) / cost), Math.floor(book.cash / cost));
    if (sh <= 0) continue;
    book.cash -= sh * cost;
    book.open.push({ t: c.t, scan: c.scan, d: c.d, entryDate: date, fill, stop, sh, n: 0, last: fill });
  }

  // 2. Walk every holding through today's bar.
  const still: BookHolding[] = [];
  for (const h of book.open) {
    const bar = bars.get(h.t);
    if (!bar) { still.push(h); continue; }
    h.n += 1;
    h.last = bar.c;
    let exit: number | null = null, how: BookClosed['how'] = 'time';
    if (bar.l <= h.stop) { exit = h.entryDate === date ? h.stop : Math.min(h.stop, bar.o); how = 'stop'; }
    else if (h.n >= MB.hold) exit = bar.c;
    if (exit == null) { still.push(h); continue; }

    const cost = h.fill * (1 + MB.slip);
    const px = exit * (1 - MB.slip);
    book.cash += h.sh * px;
    const closed: BookClosed = {
      t: h.t, scan: h.scan, d: h.d, entryDate: h.entryDate, exitDate: date,
      fill: h.fill, exit, stop: h.stop, sh: h.sh,
      r: +((px - cost) / (h.fill - h.stop)).toFixed(3),
      pnl: round2(h.sh * (px - cost)), how,
    };
    book.closed = [closed, ...book.closed].slice(0, MB.closedCap);
    book.totals.trades += 1;
    if (closed.pnl > 0) book.totals.wins += 1;
    book.totals.sumR = +(book.totals.sumR + closed.r).toFixed(3);
    book.totals.pnl = round2(book.totals.pnl + closed.pnl);
  }
  book.open = still;

  // 3. Mark to market.
  book.cash = round2(book.cash);
  book.equity = round2(book.cash + book.open.reduce((a, h) => a + h.sh * h.last, 0));
  book.peak = Math.max(book.peak, book.equity);
  book.maxDdPct = Math.min(book.maxDdPct, +((book.equity / book.peak - 1) * 100).toFixed(2));
  if (book.spy0 == null && spyClose != null) book.spy0 = spyClose;
  if (spyClose != null) book.spyLast = spyClose;
  book.curve.push([date, Math.round(book.equity), spyClose]);
  book.lastDate = date;
}

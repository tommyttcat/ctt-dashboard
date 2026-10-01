import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { etGate } from '@/lib/etCron';
import { LEDGER_KEY, LEDGER_INDEX_KEY, type SetupLedger } from '@/lib/setupLedger';
import { TRACK_OPEN_KEY, type OpenPosition } from '@/lib/track';
import {
  SCORECARD_KEY, SCORE_DAY_KEY, POOL_GIVE_UP_SESSIONS, emptyScorecard, scoreDate, advance,
  type DayBar, type DateScore, type Scorecard,
} from '@/lib/ledgerScore';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Ledger scoring cron — did the brief's picks beat the scan list?
 *
 * Runs at 20:40 ET, after /api/track/tick (20:10) has walked the scan picks
 * this compares against. Every unfinished ledger date is rescored from daily
 * bars on every run, so a missed night or a backfill costs nothing; a date is
 * folded into the totals once, when finished (lib/ledgerScore `advance`).
 *
 * It never writes to the ledger itself — the frozen entries are the proof that
 * the picks predate their results.
 *
 * Cost per run: 2 KV mgets (scorecard + ledger index + track_open_v1, then
 * the unfinished ledger dates), 1 KV set, plus 1 set per date that finishes.
 * One Polygon daily-range call per unique ticker still being scored, plus
 * SPY. Flat in users — nothing here runs on a page view.
 */

const POLYGON_KEY = process.env.POLYGON_API_KEY || '';
const etDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

async function dailyBars(ticker: string, from: string, to: string): Promise<DayBar[] | null> {
  const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=150&apiKey=${POLYGON_KEY}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!res?.ok) continue;
    const j = await res.json().catch(() => null);
    const rows: { t: number; o: number; h: number; l: number; c: number }[] = j?.results ?? [];
    return rows.map(r => ({ d: etDate(new Date(r.t)), o: r.o, h: r.h, l: r.l, c: r.c }));
  }
  return null;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const gate = etGate([20], 'ledger scoring');
  if (gate) return gate;

  if (!POLYGON_KEY) return NextResponse.json({ success: false, error: 'no data key' }, { status: 500 });

  const today = etDate(new Date());
  const [cardIn, index, trackOpen] = await kv.mget<[Scorecard | null, string[] | null, OpenPosition[] | null]>(
    SCORECARD_KEY, LEDGER_INDEX_KEY, TRACK_OPEN_KEY,
  );
  const dates = [...(index || [])].sort();
  if (dates.length === 0) {
    // The silent failure this whole job exists to avoid: say it out loud.
    console.error('LEDGER_SCORE_EMPTY: setup_ledger_index has no dates — the ledger is not being written');
    return NextResponse.json({ success: false, error: 'ledger index is empty — nothing has been recorded' });
  }

  let card = cardIn || emptyScorecard(today);
  const folded = new Set(card.foldedNextOpen.filter(d => card.foldedLevels.includes(d)));
  const todo = dates.filter(d => !folded.has(d) && d < today);
  if (todo.length === 0) {
    return NextResponse.json({ success: true, ledgerDates: dates.length, todo: 0, note: 'nothing unfinished' });
  }

  const ledgers = await kv.mget<(SetupLedger | null)[]>(...todo.map(LEDGER_KEY));
  const byDate = new Map<string, SetupLedger>();
  todo.forEach((d, i) => { const l = ledgers[i]; if (l?.entries?.length) byDate.set(d, l); });

  // One range per ticker, from the earliest unfinished date it appears on.
  const firstSeen = new Map<string, string>();
  for (const [d, l] of byDate) for (const e of l.entries) {
    const prev = firstSeen.get(e.ticker);
    if (!prev || d < prev) firstSeen.set(e.ticker, d);
  }
  firstSeen.set('SPY', todo[0]);

  const bars = new Map<string, DayBar[] | null>();
  const tickers = [...firstSeen.keys()];
  for (let i = 0; i < tickers.length; i += 8) {
    const batch = tickers.slice(i, i + 8);
    const got = await Promise.all(batch.map(t => dailyBars(t, firstSeen.get(t)!, today)));
    batch.forEach((t, j) => bars.set(t, got[j]));
  }
  const fetchFailed = tickers.filter(t => bars.get(t) == null);
  const spyAll = bars.get('SPY');
  if (!spyAll) return NextResponse.json({ success: false, error: 'no SPY bars — not scoring on a broken calendar' }, { status: 502 });

  const after = (rows: DayBar[] | null | undefined, d: string) => (rows ? rows.filter(b => b.d > d) : null);
  const scored = new Map<string, DateScore>();
  for (const [d, l] of byDate) {
    scored.set(d, scoreDate(
      d,
      l.entries,
      t => {
        // A failed fetch is unknown, not "no bars": treat it as pending so it
        // is never scored as missing data on a bad night.
        const rows = bars.get(t);
        return rows == null ? [] : after(rows, d);
      },
      after(spyAll, d) || [],
      trackOpen || [],
    ));
  }
  // A failed fetch must not let a date finish on a "no data" verdict — unless
  // it has failed for so long that waiting would hold the date open forever.
  if (fetchFailed.length) {
    for (const s of scored.values()) {
      if (s.sessions < POOL_GIVE_UP_SESSIONS && s.picks.some(p => fetchFailed.includes(p.t))) { s.nextOpenDone = false; s.levelsDone = false; }
    }
  }

  const { card: next, finished } = advance(card, dates, scored);
  card = next;

  for (const s of finished) await kv.set(SCORE_DAY_KEY(s.d), s);
  await kv.set(SCORECARD_KEY, card);

  const t = card.totals;
  return NextResponse.json({
    success: true,
    ledgerDates: dates.length,
    scoredDates: scored.size,
    emptyLedgers: todo.length - byDate.size,
    finished: finished.map(s => s.d),
    open: card.open.length,
    tickers: tickers.length,
    fetchFailed,
    totals: {
      dates: t.dates,
      picks: t.picks.n,
      picksAvgPct: t.picks.n ? +(t.picks.sumPct / t.picks.n).toFixed(2) : null,
      poolAvgPct: t.pool.n ? +(t.pool.sumPct / t.pool.n).toFixed(2) : null,
      datesBeat: `${t.datesBeat} of ${t.datesWithPool}`,
    },
  });
}

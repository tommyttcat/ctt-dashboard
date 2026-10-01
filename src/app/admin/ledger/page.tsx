'use client';

import { useState, useEffect, useCallback } from 'react';
import InfoDot from '@/components/InfoDot';

interface SetupEntry {
  date: string;
  ticker: string;
  buckets: string[];
  direction: 'long' | 'short';
  refPrice: number | null;
  trigger: number | null;
  stop: number | null;
  target: number | null;
  rMultiple: number | null;
  invalidation?: string;
  thesis?: string;
  sources: string[];
  recordedAt: string;
}

/* % from the buy level to the target — not R, which the reader reads as
   gibberish (28 Sep 2026). A short's gain is the drop, so the sign follows
   the direction. */
const toTargetPct = (e: SetupEntry): string => {
  if (e.trigger == null || e.target == null || !(e.trigger > 0)) return '—';
  const pct = e.direction === 'short' ? (e.trigger - e.target) / e.trigger * 100 : (e.target / e.trigger - 1) * 100;
  return `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%`;
};

interface Ledger {
  date: string;
  recordedAt: string;
  phase: string;
  entries: SetupEntry[];
}

/* lib/ledgerScore, as the admin API serves it. */
interface Agg { n: number; wins: number; sumPct: number; sumBest: number; sumWorst: number }
interface PickScore {
  t: string; direction: 'long' | 'short'; state: string;
  pct: number | null; nowPct: number | null; best: number | null; worst: number | null;
  level: string; levelPct: number | null;
}
interface PoolScore { n: number; wins: number; sumPct: number; nowN: number; nowSumPct: number; waiting: number }
interface DateScore {
  d: string; sessions: number; picks: PickScore[]; pool: PoolScore | null;
  spyPct: number | null; spyNowPct: number | null; nextOpenDone: boolean; levelsDone: boolean;
}
interface Scorecard {
  startedOn: string; updatedAt?: string;
  totals: {
    dates: number; datesBeat: number; datesWithPool: number;
    picks: Agg; pool: Agg; spy: { n: number; sumPct: number }; shorts: Agg; nodata: number;
    byBucket: Record<string, Agg>;
    level: { picked: number; filled: number; failed: number; missed: number; expired: number; closed: number; wins: number; sumPct: number };
  };
  open: DateScore[];
  recent: DateScore[];
}

interface LedgerResponse {
  dates: string[];
  date: string | null;
  ledger: Ledger | null;
  score: DateScore | null;
  scorecard: Scorecard | null;
}

const pct = (v: number | null | undefined, digits = 1) =>
  v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}%`;
const avg = (sum: number, n: number) => (n > 0 ? sum / n : null);
const rate = (wins: number, n: number) => (n > 0 ? `${Math.round((wins / n) * 100)}%` : '—');
const tone = (v: number | null | undefined) =>
  v == null ? 'text-slate-400' : v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-slate-300';

const LEVEL_LABEL: Record<string, string> = {
  none: 'no level', watching: 'waiting', filled: 'in trade', target: 'hit target', stopped: 'stopped',
  timeout: 'timed out', missed: 'gapped past', failed: 'stop first', expired: 'never reached',
};

/* Everything in this panel is 12px — one size per section. */
function ScorePanel({ card }: { card: Scorecard | null }) {
  if (!card) {
    return (
      <div className="rounded-lg border border-white/10 bg-[#1a2035] px-4 py-3 mb-5 text-[12px] text-slate-300">
        Not scored yet. The scoring job runs at 8:40 PM ET on weekdays and backfills every recorded date.
      </div>
    );
  }
  const t = card.totals;
  const picksAvg = avg(t.picks.sumPct, t.picks.n);
  const poolAvg = avg(t.pool.sumPct, t.pool.n);
  const spyAvg = avg(t.spy.sumPct, t.spy.n);

  // In progress: unfinished dates marked to the last close — moves every night.
  let pN = 0, pSum = 0, qN = 0, qSum = 0, sN = 0, sSum = 0;
  for (const s of card.open) {
    for (const p of s.picks) if (p.direction === 'long' && p.nowPct != null) { pN += 1; pSum += p.nowPct; }
    if (s.pool) { qN += s.pool.nowN; qSum += s.pool.nowSumPct; }
    if (s.spyNowPct != null) { sN += 1; sSum += s.spyNowPct; }
  }
  const L = t.level;
  const row = (label: string, n: number | string, win: string, a: number | null, best?: number | null, worst?: number | null) => (
    <tr className="border-t border-white/5">
      <td className="px-3 py-2 text-slate-200">{label}</td>
      <td className="px-3 py-2 text-right tabular-nums">{n}</td>
      <td className="px-3 py-2 text-right tabular-nums">{win}</td>
      <td className={`px-3 py-2 text-right tabular-nums ${tone(a)}`}>{pct(a, 2)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-emerald-400/80">{best === undefined ? '' : pct(best)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-red-400/80">{worst === undefined ? '' : pct(worst)}</td>
    </tr>
  );

  return (
    <div className="mb-5 text-[12px] text-slate-300">
      <h2 className="font-semibold text-slate-100 mb-1">Did the brief&apos;s picks beat the scan list?</h2>
      <p className="text-slate-400 mb-2">
        Bought at the next open, out at the stop or the close of session 20 — the same rule /track uses for every scan name.
        Finished dates only: {t.dates}. Picks beat the list on <span className="text-slate-200">{t.datesBeat} of {t.datesWithPool}</span> dates.
      </p>
      <div className="overflow-x-auto rounded-lg border border-white/10 mb-3">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[#1a2035] text-slate-400 text-left">
              <th className="px-3 py-2 font-medium">Finished</th>
              <th className="px-3 py-2 font-medium text-right">Trades</th>
              <th className="px-3 py-2 font-medium text-right">Win</th>
              <th className="px-3 py-2 font-medium text-right">Avg</th>
              <th className="px-3 py-2 font-medium text-right">Avg best</th>
              <th className="px-3 py-2 font-medium text-right">Avg worst</th>
            </tr>
          </thead>
          <tbody>
            {row('Brief picks', t.picks.n, rate(t.picks.wins, t.picks.n), picksAvg, avg(t.picks.sumBest, t.picks.n), avg(t.picks.sumWorst, t.picks.n))}
            {row('Scan list, same dates', t.pool.n, rate(t.pool.wins, t.pool.n), poolAvg)}
            {row('SPY, same dates', `${t.spy.n} dates`, '', spyAvg)}
            {(['top', 'conviction', 'confluence'] as const).map(b => {
              const a = t.byBucket[b];
              return a && a.n > 0 ? row(`  ${b}`, a.n, rate(a.wins, a.n), avg(a.sumPct, a.n), avg(a.sumBest, a.n), avg(a.sumWorst, a.n)) : null;
            })}
            {t.shorts.n > 0 && row('Shorts (not compared)', t.shorts.n, rate(t.shorts.wins, t.shorts.n), avg(t.shorts.sumPct, t.shorts.n))}
            <tr className="border-t border-white/10 bg-white/[0.02]">
              <td className="px-3 py-2 text-slate-400">In progress ({card.open.length} dates, so far)</td>
              <td className="px-3 py-2 text-right tabular-nums text-slate-400">{pN}</td>
              <td className="px-3 py-2 text-right tabular-nums text-slate-400">picks</td>
              <td className={`px-3 py-2 text-right tabular-nums ${tone(avg(pSum, pN))}`}>{pct(avg(pSum, pN), 2)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-slate-400">list {pct(avg(qSum, qN), 2)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-slate-400">SPY {pct(avg(sSum, sN), 2)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-slate-400 mb-3">
        Following the brief&apos;s own levels: {L.picked} with a level · {L.filled} reached it · {L.failed} hit the stop first · {L.expired} never reached it ·
        {' '}{L.closed} finished, {rate(L.wins, L.closed)} won, avg <span className={tone(avg(L.sumPct, L.closed))}>{pct(avg(L.sumPct, L.closed), 2)}</span>.
        {t.nodata > 0 && <> {t.nodata} picks had no price data.</>}
      </p>
      <p className="text-slate-500">
        Caveats: tiny sample until ~60 finished picks; a good month flatters everything, so read it against SPY; the list is the names /track
        recorded fresh that evening, while the brief can pick a name that has sat on a table for weeks; no luck check yet.
        {card.updatedAt && <> Scored {new Date(card.updatedAt).toLocaleString()}.</>}
      </p>
    </div>
  );
}

const fmt = (n: number | null) => (n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export default function LedgerViewer() {
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [date, setDate] = useState<string>('');
  const [status, setStatus] = useState<'loading' | 'ok' | 'unauthorized' | 'error'>('loading');

  const load = useCallback(async (d?: string) => {
    setStatus('loading');
    try {
      const res = await fetch(`/api/analyst/ledger${d ? `?date=${d}` : ''}`, { cache: 'no-store' });
      if (res.status === 401) { setStatus('unauthorized'); return; }
      if (!res.ok) { setStatus('error'); return; }
      const json: LedgerResponse = await res.json();
      setData(json);
      setDate(json.date || '');
      setStatus('ok');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const entries = data?.ledger?.entries ?? [];
  const scoreOf = new Map((data?.score?.picks ?? []).map(p => [p.t, p]));

  return (
    <div className="min-h-screen bg-[#0b0e1a] text-slate-200 p-6 text-[13px]">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-lg font-semibold mb-1">Setup Ledger</h1>
        <p className="text-[11px] text-slate-400 mb-4">
          Setups frozen at the close, before their outcome. Outcomes are scored separately each evening and never touch these records.
        </p>

        {status === 'unauthorized' && (
          <div className="rounded-lg border border-white/10 bg-[#1a2035] px-4 py-3 text-slate-300">
            Admin session required. Sign in as an admin to view the ledger.
          </div>
        )}

        {status === 'error' && (
          <div className="rounded-lg border border-red-500/30 bg-red-950/30 px-4 py-3 text-red-300">
            Failed to load the ledger.
          </div>
        )}

        {status !== 'unauthorized' && status !== 'error' && (
          <>
            {status === 'ok' && <ScorePanel card={data?.scorecard ?? null} />}
            <div className="flex items-center gap-3 mb-4">
              <label className="text-[11px] text-slate-400">Date</label>
              <select
                className="bg-[#1a2035] border border-white/10 rounded-md px-2.5 py-1.5 text-[12px] text-slate-200"
                value={date}
                onChange={(e) => { setDate(e.target.value); load(e.target.value); }}
                disabled={!data?.dates?.length}
              >
                {(data?.dates ?? []).map((d) => <option key={d} value={d}>{d}</option>)}
                {!data?.dates?.length && <option value="">no ledgers yet</option>}
              </select>
              {data?.ledger && (
                <span className="text-[11px] text-slate-500">
                  {entries.length} setups · phase {data.ledger.phase} · recorded {new Date(data.ledger.recordedAt).toLocaleString()}
                </span>
              )}
            </div>

            {status === 'loading' && <div className="text-slate-400">Loading…</div>}

            {status === 'ok' && !data?.dates?.length && (
              <div className="rounded-lg border border-white/10 bg-[#1a2035] px-4 py-3 text-slate-300">
                No ledgers recorded yet. The first writes after a weekday close (cron at 21:50 UTC).
              </div>
            )}

            {status === 'ok' && entries.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="bg-[#1a2035] text-slate-400 text-left">
                      <th className="px-3 py-2 font-medium">Ticker</th>
                      <th className="px-3 py-2 font-medium">Buckets</th>
                      <th className="px-3 py-2 font-medium">Dir</th>
                      <th className="px-3 py-2 font-medium text-right">Ref</th>
                      <th className="px-3 py-2 font-medium text-right">Trigger</th>
                      <th className="px-3 py-2 font-medium text-right">Stop</th>
                      <th className="px-3 py-2 font-medium text-right">Target</th>
                      <th className="px-3 py-2 font-medium text-right" title="The move from the buy level to the target, in % (a short counts the drop)">To target</th>
                      <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Next open <InfoDot text="Bought at the next open, out at the stop or the close of session 20. Grey = still running, marked to the last close." /></th>
                      <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Best / worst <InfoDot text="Best and worst move from the next open within 20 sessions." /></th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">Levels <InfoDot text="What happened if you followed the brief's buy level and stop: same rules as the 'followed the levels' record on /track." /></th>
                      <th className="px-3 py-2 font-medium">Thesis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.ticker} className="border-t border-white/5 hover:bg-white/[0.02]">
                        <td className="px-3 py-2 font-semibold text-slate-100">{e.ticker}</td>
                        <td className="px-3 py-2 text-slate-400">{e.buckets.join(', ')}</td>
                        <td className={`px-3 py-2 ${e.direction === 'short' ? 'text-red-400' : 'text-emerald-400'}`}>{e.direction}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(e.refPrice)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(e.trigger)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(e.stop)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(e.target)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{toTargetPct(e)}</td>
                        {(() => {
                          const sc = scoreOf.get(e.ticker);
                          const final = sc?.pct != null;
                          const v = final ? sc!.pct : sc?.nowPct ?? null;
                          return (
                            <>
                              <td className={`px-3 py-2 text-right tabular-nums ${final ? tone(v) : 'text-slate-500'}`}>
                                {sc ? (sc.state === 'nodata' ? 'no data' : sc.state === 'pending' ? 'pending' : pct(v)) : '—'}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                                <span className="text-emerald-400/80">{pct(sc?.best)}</span> / <span className="text-red-400/80">{pct(sc?.worst)}</span>
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap text-slate-400">
                                {sc ? LEVEL_LABEL[sc.level] ?? sc.level : '—'}
                                {sc?.levelPct != null && <span className={`ml-1 ${tone(sc.levelPct)}`}>{pct(sc.levelPct)}</span>}
                              </td>
                            </>
                          );
                        })()}
                        <td className="px-3 py-2 text-slate-400 max-w-[280px] truncate" title={e.thesis || ''}>{e.thesis || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

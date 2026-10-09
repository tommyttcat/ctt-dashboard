'use client';

import { useState, useEffect, useCallback } from 'react';
import InfoDot from '@/components/InfoDot';
import type { CompareReport, CompareRow, Outcome, Pick } from '@/lib/newsCompare';

interface Resp { ids: string[]; id: string | null; report: CompareReport | null }

const FILTERS: { key: 'all' | Outcome | 'differ'; label: string }[] = [
  { key: 'differ', label: 'Differ' },
  { key: 'current-only', label: 'Benzinga only' },
  { key: 'alt-only', label: 'New only' },
  { key: 'both', label: 'Both' },
  { key: 'all', label: 'All' },
];

const FROM_LABEL: Record<string, string> = { benzinga: 'Benzinga', sec: 'SEC 8-K', fmp: 'FMP', polygon: 'Polygon' };
const TIER_TONE: Record<string, string> = {
  strong: 'text-emerald-400', negative: 'text-red-400', neutral: 'text-slate-300', headline: 'text-slate-500', none: 'text-slate-500',
};
const ageOf = (h: number) => (h < 1 ? '<1h' : h < 24 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`);

/* One line per side. Everything in the list is 12px — one size per section. */
function Side({ label, p }: { label: string; p: Pick | null }) {
  return (
    <div className="flex gap-2 min-w-0">
      <span className="w-[70px] shrink-0 text-slate-500">{label}</span>
      {p ? (
        <span className="min-w-0">
          <span className={TIER_TONE[p.tier] ?? 'text-slate-300'}>{p.tag}</span>
          <span className="text-slate-500"> · {FROM_LABEL[p.from]} · {p.publisher} · {ageOf(p.ageH)} · </span>
          {p.url ? (
            <a href={p.url} target="_blank" rel="noreferrer" className="text-slate-200 hover:text-indigo-300 break-words">{p.title}</a>
          ) : (
            <span className="text-slate-200 break-words">{p.title}</span>
          )}
        </span>
      ) : (
        <span className="text-slate-600">no catalyst</span>
      )}
    </div>
  );
}

function Tile({ label, value, tip }: { label: string; value: string | number; tip?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#1a2035] px-3 py-2">
      <div className="text-slate-400 flex items-center gap-1">{label}{tip && <InfoDot text={tip} />}</div>
      <div className="text-slate-100 tabular-nums">{value}</div>
    </div>
  );
}

export default function NewsCompare() {
  const [data, setData] = useState<Resp | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'unauthorized' | 'error'>('loading');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('differ');
  const [running, setRunning] = useState(false);

  const load = useCallback(async (id?: string) => {
    setStatus('loading');
    try {
      const res = await fetch(`/api/news/compare${id ? `?id=${encodeURIComponent(id)}` : ''}`, { cache: 'no-store' });
      if (res.status === 401) { setStatus('unauthorized'); return; }
      if (!res.ok) { setStatus('error'); return; }
      setData(await res.json());
      setStatus('ok');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runNow = async () => {
    setRunning(true);
    try {
      const res = await fetch('/api/news/compare/record', { method: 'POST' });
      const j = await res.json().catch(() => null);
      await load(j?.id);
    } finally {
      setRunning(false);
    }
  };

  const r = data?.report ?? null;
  const s = r?.summary;
  const rows: CompareRow[] = (r?.rows ?? []).filter(row =>
    filter === 'all' ? true : filter === 'differ' ? row.outcome === 'current-only' || row.outcome === 'alt-only' : row.outcome === filter,
  );

  return (
    <div className="min-h-screen bg-[#0b0e1a] text-slate-200 px-4 py-6 sm:p-6 text-[12px]">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-lg font-semibold mb-1">News: Benzinga vs no-Benzinga</h1>
        <p className="text-slate-400 mb-4">
          Same tickers, same moment, same catalyst filter. <span className="text-slate-300">Benzinga</span> = what the scanners use today
          (Benzinga + Polygon). <span className="text-slate-300">New</span> = SEC 8-Ks + FMP news + Polygon. Users see none of this.
          Runs 10:30 and 15:30 ET on weekdays.
        </p>

        {status === 'unauthorized' && (
          <div className="rounded-lg border border-white/10 bg-[#1a2035] px-4 py-3">Admin session required.</div>
        )}
        {status === 'error' && (
          <div className="rounded-lg border border-red-500/30 bg-red-950/30 px-4 py-3 text-red-300">Failed to load.</div>
        )}

        {(status === 'ok' || status === 'loading') && (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <select
                className="bg-[#1a2035] border border-white/10 rounded-md px-2.5 py-1.5 text-slate-200"
                value={data?.id ?? ''}
                onChange={e => load(e.target.value)}
                disabled={!data?.ids?.length}
              >
                {(data?.ids ?? []).map(id => <option key={id} value={id}>{id}</option>)}
                {!data?.ids?.length && <option value="">no runs yet</option>}
              </select>
              <button
                onClick={runNow}
                disabled={running}
                className="rounded-md border border-indigo-400/40 px-2.5 py-1.5 text-indigo-300 hover:bg-indigo-500/10 disabled:opacity-50"
              >
                {running ? 'Running… (~1 min)' : 'Run now'}
              </button>
              {r && <span className="text-slate-500">{r.tickers} tickers · {new Date(r.at).toLocaleString()} · {Math.round(r.diag.ms / 1000)}s</span>}
            </div>

            {status === 'loading' && <div className="text-slate-400">Loading…</div>}

            {status === 'ok' && !r && (
              <div className="rounded-lg border border-white/10 bg-[#1a2035] px-4 py-3">No comparison recorded yet. Use Run now, or wait for the next cron.</div>
            )}

            {status === 'ok' && r && s && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                  <Tile label="Benzinga has a catalyst" value={`${s.both + s.currentOnly} / ${r.tickers}`} />
                  <Tile label="New has a catalyst" value={`${s.both + s.altOnly} / ${r.tickers}`} />
                  <Tile label="Lost without Benzinga" value={s.currentOnly} tip="Rows where Benzinga found a catalyst and the new stack found nothing. This is what cancelling costs." />
                  <Tile label="Only New found" value={s.altOnly} tip="Rows where the new stack found a catalyst and Benzinga did not." />
                  <Tile label="Strong catalysts" value={`${s.curStrong} vs ${s.altStrong}`} tip="Earnings, FDA, M&A, guidance, contract or product with a causal headline. Benzinga vs New." />
                  <Tile label="Median age" value={`${s.curMedianAgeH == null ? '—' : ageOf(s.curMedianAgeH)} vs ${s.altMedianAgeH == null ? '—' : ageOf(s.altMedianAgeH)}`} tip="How old the chosen headline was. Benzinga vs New." />
                  <Tile label="New picks from" value={`8-K ${s.altFrom.sec} · FMP ${s.altFrom.fmp} · Poly ${s.altFrom.polygon}`} />
                  <Tile label="Benzinga picks from" value={`BZ ${s.curFrom.benzinga} · Poly ${s.curFrom.polygon}`} />
                </div>
                <p className="text-slate-500 mb-4">
                  Sources reached: SEC {r.diag.sec.tickersHit} tickers ({r.diag.sec.filings} filings back to{' '}
                  {r.diag.sec.oldestUtc ? new Date(r.diag.sec.oldestUtc).toLocaleDateString() : '—'}, {r.diag.sec.headlines} headlines) ·
                  FMP {r.diag.fmp.tickersHit} ({r.diag.fmp.errors} errors, {Math.round(r.diag.fmp.bytes / 1024)} KB) ·
                  Benzinga {r.diag.bz.tickersHit} · Polygon {r.diag.poly.tickersHit}.
                  Known biases: the 8-K feed only reaches ~2.5 days back; FMP items each carry one ticker, which the filter scores as focused.
                </p>

                <div className="flex flex-wrap gap-1.5 mb-3">
                  {FILTERS.map(f => (
                    <button
                      key={f.key}
                      onClick={() => setFilter(f.key)}
                      className={`rounded-md px-2.5 py-1 border ${filter === f.key ? 'border-indigo-400/60 text-indigo-200 bg-indigo-500/10' : 'border-white/10 text-slate-400'}`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                <div className="rounded-lg border border-white/10 divide-y divide-white/5">
                  {rows.length === 0 && <div className="px-3 py-3 text-slate-500">Nothing in this filter.</div>}
                  {rows.map(row => (
                    <div key={row.t} className="px-3 py-2.5 space-y-1">
                      <div className="flex items-baseline gap-2">
                        <span className="font-semibold text-slate-100">{row.t}</span>
                        <span className="text-slate-500">{row.scans.join(', ')}</span>
                        <span className="ml-auto text-slate-600 tabular-nums whitespace-nowrap">
                          bz {row.n.bz} · 8k {row.n.sec} · fmp {row.n.fmp} · poly {row.n.poly}
                        </span>
                      </div>
                      <Side label="Benzinga" p={row.cur} />
                      <Side label="New" p={row.alt} />
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

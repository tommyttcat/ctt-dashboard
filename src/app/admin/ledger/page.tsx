'use client';

import { useState, useEffect, useCallback } from 'react';

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

interface Ledger {
  date: string;
  recordedAt: string;
  phase: string;
  entries: SetupEntry[];
}

interface LedgerResponse {
  dates: string[];
  date: string | null;
  ledger: Ledger | null;
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

  return (
    <div className="min-h-screen bg-[#0b0e1a] text-slate-200 p-6 text-[13px]">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-lg font-semibold mb-1">Setup Ledger</h1>
        <p className="text-[11px] text-slate-400 mb-4">
          Raw frozen setups recorded at close. Not yet scored — outcomes are added later by the scoring job.
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
                      <th className="px-3 py-2 font-medium text-right">R</th>
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
                        <td className="px-3 py-2 text-right tabular-nums">{e.rMultiple == null ? '—' : `${fmt(e.rMultiple)}R`}</td>
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

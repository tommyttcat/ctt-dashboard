'use client';

/* /admin/trades — the owner's own trade log, scored against QQQ (lib/tradeLog).
   10 Oct 2026: the scanners lost to QQQ when every hit is bought blindly; this
   measures the trades the owner actually takes. Phone-first: one column, cards. */

import { useCallback, useEffect, useState } from 'react';
import InfoDot from '@/components/InfoDot';
import type { Agg, ScoredTrade } from '@/lib/tradeLog';

type Resp = { rows: ScoredTrade[]; summary: { closed: Agg; open: Agg; bySrc: Record<string, Agg>; byTier?: Record<string, Agg> }; updatedAt: string };
const TIER_DOT: Record<string, string> = { green: 'bg-emerald-400', yellow: 'bg-amber-300', red: 'bg-rose-400' };
const TIER_WORD: Record<string, string> = { green: 'Green (go)', yellow: 'Yellow (look)', red: 'Red (stay away)', none: 'Not on a card' };
const SOURCES = ['EP9M', 'SIP', 'Daily', 'Swing', 'VCP', 'HRS', '100-Bagger', 'Momentum Leaders', 'Confluence', 'Liquid Leaders', 'Early Movers', 'Other'];
const etToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const blank = () => ({ id: '', t: '', src: '', style: 'swing', buyDate: etToday(), buy: '', shares: '', sellDate: '', sell: '', note: '' });
type Form = ReturnType<typeof blank>;

const pct = (v: number | null | undefined, d = 1) => (v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}%`);
const usd = (v: number | null | undefined) => (v == null ? '—' : `${v >= 0 ? '+' : '−'}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
const tone = (v: number | null | undefined) => (v == null ? 'text-slate-500' : v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-slate-300');
const input = 'w-full bg-[#0b0e1a] border border-white/10 rounded-md px-2.5 py-2 text-[12px] text-slate-200';

function Verdict({ a }: { a: Agg }) {
  if (!a.n) return <p className="text-slate-400">No closed trades yet. Log each trade you take from the scanners; the comparison means something after 30–50 closed trades.</p>;
  const beat = a.avgPct != null && a.avgQqq != null && a.avgPct > a.avgQqq;
  return (
    <p className="text-slate-300">
      {a.n} closed · won {a.wins} ({Math.round((100 * a.wins) / a.n)}%) · avg <span className={tone(a.avgPct)}>{pct(a.avgPct, 2)}</span> a trade
      against QQQ <span className={tone(a.avgQqq)}>{pct(a.avgQqq, 2)}</span> over the same days · beat QQQ on {a.beatQqq} of {a.n}.
      {a.dollars != null && <> · <span className={tone(a.dollars)}>{usd(a.dollars)}</span> vs the same money in QQQ <span className={tone(a.qqqDollars)}>{usd(a.qqqDollars)}</span>.</>}
      {' '}<span className={beat ? 'text-emerald-400' : 'text-red-400'}>{beat ? 'Ahead of QQQ so far.' : 'Behind QQQ so far.'}</span>
      {a.n < 30 && <span className="text-slate-500"> Too few trades to tell yet.</span>}
    </p>
  );
}

export default function TradeLogPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'unauthorized' | 'error'>('loading');
  const [form, setForm] = useState<Form>(blank());
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/trades', { cache: 'no-store' });
      if (res.status === 401) { setStatus('unauthorized'); return; }
      if (!res.ok) { setStatus('error'); return; }
      setData(await res.json()); setStatus('ok');
    } catch { setStatus('error'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const post = async (body: unknown) => {
    setBusy(true); setMsg('');
    try {
      const res = await fetch('/api/admin/trades', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(j.error || 'Could not save.'); return false; }
      await load(); return true;
    } finally { setBusy(false); }
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await post({ action: 'save', trade: { ...form, id: form.id || undefined } })) { setForm(blank()); setMsg('Saved.'); }
  };
  const edit = (r: ScoredTrade) => {
    setForm({ id: r.id, t: r.t, src: r.src, style: r.style ?? 'swing', buyDate: r.buyDate, buy: String(r.buy), shares: r.shares == null ? '' : String(r.shares), sellDate: r.sellDate ?? '', sell: r.sell == null ? '' : String(r.sell), note: r.note });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const del = async (r: ScoredTrade) => { if (window.confirm(`Delete ${r.t} bought ${r.buyDate}?`)) await post({ action: 'delete', id: r.id }); };
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  const s = data?.summary;
  return (
    <div className="min-h-screen bg-[#0b0e1a] text-slate-200 px-4 py-5 text-[12px]">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-[15px] font-semibold">Trade Log</h1>
          <a href="/admin" className="text-indigo-400 hover:text-indigo-300">Admin</a>
        </div>
        <p className="text-slate-400 mb-4">
          Your trades from the scanners, each against what QQQ did over the same days. This is the test the backtests could not run: your judgment.
          <InfoDot text={"Each trade: your % from buy to sell (or to the last close while open), and QQQ's % from the OPEN of your buy date to the CLOSE of your sell date — close, not exact, since you may buy any time that day.\n\nAdd shares to see dollars: your $ result against the same money held in QQQ.\n\nSold half? Log it as two trades. Long trades only.\n\nThe question it answers: after 30–50 closed trades, do the scanners plus your judgment beat holding QQQ? Fewer than that and luck dominates."} />
        </p>

        {status === 'unauthorized' && <div className="rounded-lg border border-white/10 bg-[#1a2035] px-4 py-3">Admin session required.</div>}
        {status === 'error' && <div className="rounded-lg border border-red-500/30 bg-red-950/30 px-4 py-3 text-red-300">Failed to load the log.</div>}

        {status !== 'unauthorized' && (
          <>
            <form onSubmit={save} className="rounded-lg border border-white/10 bg-[#1a2035] p-3 mb-4 grid grid-cols-2 gap-2">
              <label className="col-span-1">Ticker<input className={input} value={form.t} onChange={set('t')} placeholder="NVDA" autoCapitalize="characters" required /></label>
              <label className="col-span-1">From<input className={input} value={form.src} onChange={set('src')} list="trade-src" placeholder="EP9M" /></label>
              <datalist id="trade-src">{SOURCES.map(x => <option key={x} value={x} />)}</datalist>
              <label className="col-span-2">Type
                <select className={input} value={form.style} onChange={e => setForm(f => ({ ...f, style: e.target.value }))}>
                  <option value="swing">Swing (3–5 days, runners run)</option>
                  <option value="day">Day trade</option>
                </select>
              </label>
              <label>Buy date<input className={input} type="date" value={form.buyDate} onChange={set('buyDate')} required /></label>
              <label>Buy price<input className={input} inputMode="decimal" value={form.buy} onChange={set('buy')} placeholder="0.00" required /></label>
              <label>Sell date<input className={input} type="date" value={form.sellDate} onChange={set('sellDate')} /></label>
              <label>Sell price<input className={input} inputMode="decimal" value={form.sell} onChange={set('sell')} placeholder="blank = still open" /></label>
              <label>Shares<input className={input} inputMode="decimal" value={form.shares} onChange={set('shares')} placeholder="optional" /></label>
              <label>Note<input className={input} value={form.note} onChange={set('note')} placeholder="why I took it" /></label>
              <div className="col-span-2 flex items-center gap-3 pt-1">
                <button type="submit" disabled={busy} className="rounded-md bg-indigo-500/90 hover:bg-indigo-500 px-4 py-2 font-medium text-white disabled:opacity-50">{form.id ? 'Update trade' : 'Add trade'}</button>
                {form.id && <button type="button" onClick={() => setForm(blank())} className="text-slate-400">Cancel edit</button>}
                {msg && <span className={msg === 'Saved.' ? 'text-emerald-400' : 'text-red-400'}>{msg}</span>}
              </div>
            </form>

            {status === 'loading' && <div className="text-slate-400">Loading…</div>}

            {s && (
              <div className="rounded-lg border border-white/10 bg-[#1a2035] p-3 mb-4 space-y-2">
                <div className="font-semibold text-slate-100">Closed trades vs QQQ</div>
                <Verdict a={s.closed} />
                {s.open.n > 0 && <p className="text-slate-400">Open: {s.open.n} · avg <span className={tone(s.open.avgPct)}>{pct(s.open.avgPct)}</span> vs QQQ <span className={tone(s.open.avgQqq)}>{pct(s.open.avgQqq)}</span> so far (marked to the last close).</p>}
                {s.byTier && Object.keys(s.byTier).length > 0 && (
                  <div className="pt-1 space-y-0.5">
                    <div className="text-slate-400">By checklist colour when you logged it <InfoDot text={"Each trade logged on its buy day records the name's day or swing checklist colour at that moment (from the scan cards). After 30–50 closed trades this answers whether your greens actually beat your yellows and reds — your results, not a backtest."} /></div>
                    {Object.entries(s.byTier).map(([tier, a]) => (
                      <div key={tier} className="flex justify-between gap-2">
                        <span className="text-slate-300 inline-flex items-center gap-1.5">{TIER_DOT[tier] && <span className={`inline-block w-2 h-2 rounded-full ${TIER_DOT[tier]}`} />}{TIER_WORD[tier] ?? tier}</span>
                        <span className="tabular-nums text-slate-400">{a.n} · won {a.wins} · <span className={tone(a.avgPct)}>{pct(a.avgPct)}</span> vs QQQ <span className={tone(a.avgQqq)}>{pct(a.avgQqq)}</span></span>
                      </div>
                    ))}
                  </div>
                )}
                {Object.keys(s.bySrc).length > 1 && (
                  <div className="pt-1 space-y-0.5">
                    {Object.entries(s.bySrc).map(([src, a]) => (
                      <div key={src} className="flex justify-between gap-2">
                        <span className="text-slate-300">{src}</span>
                        <span className="tabular-nums text-slate-400">{a.n} · won {a.wins} · <span className={tone(a.avgPct)}>{pct(a.avgPct)}</span> vs QQQ <span className={tone(a.avgQqq)}>{pct(a.avgQqq)}</span></span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              {(data?.rows ?? []).map(r => (
                <div key={r.id} className="rounded-lg border border-white/10 bg-[#141a2b] px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {r.atEntry && <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${TIER_DOT[r.atEntry.tier]}`} title={`${r.atEntry.mode} checklist at entry (${r.atEntry.src}):\n${r.atEntry.checks.map(([l, ok]) => `${ok === true ? '✔' : ok === false ? '✖' : '–'} ${l}`).join('\n')}${r.atEntry.reds.length ? `\nRed because: ${r.atEntry.reds.join('; ')}` : ''}`} />}
                      <span className="font-semibold text-slate-100">{r.t}</span>
                      <span className="text-slate-500 truncate">{r.src}{r.style === 'day' ? ' · day' : ''}</span>
                      {r.open && <span className="rounded px-1.5 py-0.5 bg-indigo-500/15 text-indigo-300">OPEN</span>}
                    </div>
                    <div className="tabular-nums whitespace-nowrap">
                      <span className={tone(r.pct)}>{pct(r.pct)}</span>
                      <span className="text-slate-500"> vs QQQ </span>
                      <span className={tone(r.qqqPct)}>{pct(r.qqqPct)}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-slate-400">
                    <span className="tabular-nums truncate">
                      {r.buyDate} @ {r.buy} → {r.open ? `last ${r.exitPx ?? '—'}` : `${r.sellDate} @ ${r.sell}`} · {r.days}d
                      {r.dollars != null && <> · <span className={tone(r.dollars)}>{usd(r.dollars)}</span></>}
                    </span>
                    <span className="whitespace-nowrap">
                      <button onClick={() => edit(r)} className="text-indigo-400 mr-3">{r.open ? 'Sell / edit' : 'Edit'}</button>
                      <button onClick={() => del(r)} className="text-red-400/80">Delete</button>
                    </span>
                  </div>
                  {r.note && <div className="text-slate-500 truncate">{r.note}</div>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

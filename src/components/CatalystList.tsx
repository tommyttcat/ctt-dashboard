'use client';
/* News page catalyst list (25 Nov 2026). Written by a cloud routine a few times
   a weekday (see lib/catalysts.ts); this card only reads /api/catalysts once on
   load and on Refresh — no polling, no cache-buster. */
import React from 'react';
import InfoDot from './InfoDot';
import TickerChartHover, { WatchlistBtn } from './TickerChartHover';
import type { CatalystItem, CatalystsPayload, Grade } from '@/lib/catalysts';

const LABEL = 'text-[11px] font-bold tracking-[0.14em] uppercase';
const PILL = 'inline-flex items-center gap-1 rounded-full border px-2.5 py-[3px] text-[11px] font-bold tracking-[0.06em] uppercase leading-[1.3] whitespace-nowrap';
const PILL_ON = 'text-slate-200 bg-[#1e293b] border-[#1e293b]';
const PILL_OFF = 'text-slate-500 bg-transparent border-[#1e293b] hover:text-slate-300';

const GRADE_CLS: Record<Grade, string> = {
  'A★': 'text-emerald-300 bg-emerald-500/10 border-emerald-400/30',
  A: 'text-emerald-300 bg-emerald-500/10 border-emerald-400/30',
  B: 'text-amber-300 bg-amber-500/10 border-amber-400/30',
  P2: 'text-slate-300 bg-slate-500/10 border-white/10',
};
const GRADE_TIP: Record<Grade, string> = {
  'A★': 'A★: a hard, new, company-specific fact (trial data, signed contract, beat-and-raise) with size behind the move.',
  A: 'A: a clear company-specific reason for the move.',
  B: 'B: a real reason, but smaller, older or already partly priced.',
  P2: 'P2: passed the screen; the news is thin, vague or not new.',
};
const TAG_CLS = (t: string) => (t === 'Earnings' ? 'text-amber-300 bg-amber-500/10 border-amber-400/30' : 'text-slate-400 bg-slate-500/10 border-white/10');

const fmtChg = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);
const chgCls = (v: number | null) => (v == null ? 'text-slate-500' : v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-slate-400');
const fmtBig = (v: number | null, money = false) => {
  if (v == null || !Number.isFinite(v)) return '—';
  const p = money ? '$' : '';
  return v >= 1e12 ? `${p}${(v / 1e12).toFixed(1)}T` : v >= 1e9 ? `${p}${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${p}${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${p}${Math.round(v / 1e3)}K` : `${p}${Math.round(v)}`;
};
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) + ' ET';
const etDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

type Filter = 'all' | 'earnings' | 'gappers' | 'new';

function Row({ r, i, runAt }: { r: CatalystItem; i: number; runAt: string }) {
  return (
    <div className="flex gap-3 px-3.5 md:px-4 py-3 border-t border-[#1e293b] first:border-t-0">
      <span className="w-5 shrink-0 text-[12px] text-slate-500 tabular-nums pt-[2px]">{i}</span>
      <div className="w-[88px] md:w-[120px] shrink-0 min-w-0">
        <div className="flex items-center gap-1.5">
          <WatchlistBtn symbol={r.ticker} />
          <TickerChartHover symbol={r.ticker}>
            <span className="inline-block text-[12px] font-bold tracking-wider px-1.5 py-[2px] rounded border leading-none text-slate-200 bg-slate-500/10 border-white/10">{r.ticker}</span>
          </TickerChartHover>
        </div>
        {r.name && <div className="text-[12px] text-slate-500 truncate mt-1">{r.name}</div>}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2">
          <InfoDot text={GRADE_TIP[r.grade]}>
            <span className={`inline-block text-[11px] font-bold px-1.5 py-[2px] rounded border leading-none mt-[2px] ${GRADE_CLS[r.grade]}`}>{r.grade}</span>
          </InfoDot>
          {r.url
            ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-[15px] leading-snug text-slate-100 hover:text-white no-underline">{r.summary}</a>
            : <span className="text-[15px] leading-snug text-slate-100">{r.summary}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
          {r.tags.map(t => <span key={t} className={`${PILL} ${TAG_CLS(t)}`}>{t}</span>)}
          {r.isNew && <span className={`${PILL} text-sky-300 bg-sky-500/10 border-sky-400/30`}>New</span>}
          <span className="text-[12px] text-slate-500">{fmtTime(runAt)}</span>
        </div>
      </div>
      <div className="shrink-0 text-right tabular-nums">
        <div className={`text-[15px] font-bold ${chgCls(r.chg)}`}>{fmtChg(r.chg)}</div>
        <div className="text-[12px] text-slate-500">{fmtBig(r.vol)} vol</div>
        <div className="text-[12px] text-slate-500">{fmtBig(r.mktCap, true)}</div>
      </div>
    </div>
  );
}

export default function CatalystList({ reloadKey }: { reloadKey: number }) {
  const [data, setData] = React.useState<CatalystsPayload | null>(null);
  const [state, setState] = React.useState<'loading' | 'ready' | 'empty'>('loading');
  const [filter, setFilter] = React.useState<Filter>('all');

  React.useEffect(() => {
    let on = true;
    fetch('/api/catalysts')
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (!on) return;
        if (j && Array.isArray(j.ranked)) { setData(j); setState('ready'); } else setState('empty');
      })
      .catch(() => on && setState('empty'));
    return () => { on = false; };
  }, [reloadKey]);

  const keep = React.useCallback((r: CatalystItem) =>
    filter === 'all' ? true
      : filter === 'earnings' ? r.source !== 'gapper'
      : filter === 'gappers' ? r.source !== 'earnings'
      : !!r.isNew, [filter]);

  if (state === 'loading') return null;
  if (state === 'empty' || !data) {
    return <p className="text-[12px] text-slate-500 bg-[#111827] border border-[#1e293b] rounded-2xl px-4 py-3.5">No catalyst run yet. The list is written before the open and through the morning on weekdays.</p>;
  }

  const ranked = data.ranked.filter(keep);
  const passed = data.passed.filter(keep);
  const old = etDay(data.runAt) !== etDay(new Date().toISOString());
  const info = 'A scheduled Claude routine reads today’s gappers and earnings reporters with their SEC 8-K filings and news, then writes one line on what happened and grades it. Runs about 8:00, 9:00, 10:00 and 12:00 ET on weekdays. % change, volume and market cap are as of the run, not live. Grades are a read of the news, not a buy signal and not a tested edge.';

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className={`${LABEL} text-slate-300`}>Catalysts</h2>
        <span className="text-[12px] font-semibold text-slate-500 tabular-nums">
          {old ? `${etDay(data.runAt)} ` : ''}{fmtTime(data.runAt)} · {data.gappers} gappers · {data.earnings} earnings
        </span>
        <InfoDot text={info} />
      </div>

      {data.top && (
        <div className="bg-[#111827] border border-[#1e293b] border-l-2 border-l-emerald-400/60 rounded-2xl px-4 py-3">
          <div className={`${LABEL} text-slate-500`}>Top of the list</div>
          <p className="text-[15px] leading-snug text-slate-100 mt-1"><span className="font-bold">{data.top.ticker}</span> {data.top.text}</p>
        </div>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        {([['all', 'All'], ['earnings', 'Earnings'], ['gappers', 'Gappers'], ['new', 'New in last run']] as [Filter, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className={`${PILL} transition-colors ${filter === k ? PILL_ON : PILL_OFF}`}>{l}</button>
        ))}
      </div>

      <div className={`${LABEL} text-slate-500`}>Ranked · {ranked.length}</div>
      {ranked.length
        ? <div className="bg-[#111827] border border-[#1e293b] rounded-2xl overflow-hidden">{ranked.map((r, i) => <Row key={r.ticker} r={r} i={i + 1} runAt={data.runAt} />)}</div>
        : <p className="text-[12px] text-slate-500">None under this filter.</p>}

      {passed.length > 0 && (
        <>
          <div className={`${LABEL} text-slate-500`}>Passed the screen, lower grade · {passed.length}</div>
          <div className="bg-[#111827] border border-[#1e293b] rounded-2xl overflow-hidden">{passed.map((r, i) => <Row key={r.ticker} r={r} i={ranked.length + i + 1} runAt={data.runAt} />)}</div>
        </>
      )}
    </section>
  );
}

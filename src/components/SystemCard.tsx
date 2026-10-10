'use client';

/* SystemCard (10 Oct 2026) — lib/system: a 2x Nasdaq core switched by the
   200-day, and the model's top-10 shortlist. Rebuilt nightly by
   /api/system/nightly; read once per page load through the CDN. */

import { useEffect, useState } from 'react';
import InfoDot from './InfoDot';
import TickerChartHover from './TickerChartHover';
import type { SystemPick } from '@/lib/system';

type View = {
  state: { asOf: string; universe: number; core: { on: boolean; leverage: number; qqq: number; sma200: number; pctFrom200: number }; picks: SystemPick[] } | null;
  record?: { since: string | null; days: number; core: number; list: number; qqq: number };
};
const pct = (x: number, d = 0) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%`;

/* Embedded at the top of Momentum Leaders since 10 Oct 2026 (was its own card under
   the Market exposure strip). */
const SystemCard = ({ embedded = false }: { embedded?: boolean }) => {
  const [v, setV] = useState<View | null>(null);
  useEffect(() => {
    let on = true;
    fetch('/api/system/latest').then(r => (r.ok ? r.json() : null)).then(j => { if (on && j) setV(j); }).catch(() => {});
    return () => { on = false; };
  }, []);
  if (!v?.state) return null;
  const { core, picks, asOf, universe } = v.state;
  const rec = v.record;
  const H = 'text-[7px] font-bold tracking-widest uppercase text-slate-600';
  return (
    <div className={embedded ? 'mb-3 px-3 py-2.5 rounded-lg border border-white/[0.06] bg-[#0b101a] text-[10px]' : 'relative z-10 mb-4 md:mb-5 px-3 py-2.5 rounded-lg border border-white/[0.06] bg-[#0f1524] text-[10px]'}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-bold tracking-widest uppercase text-slate-400">{embedded ? 'Model top 10' : 'System'}</span>
        <span className={`font-bold px-2 py-[1px] rounded border ${core.on ? 'text-emerald-300 bg-emerald-500/15 border-emerald-400/30' : 'text-amber-300 bg-amber-500/15 border-amber-400/30'}`}>
          {core.on ? `Core: ${core.leverage}× QQQ` : 'Core: cash'}
        </span>
        <span className="text-slate-200">QQQ {core.qqq.toFixed(2)} is {Math.abs(core.pctFrom200).toFixed(1)}% {core.pctFrom200 >= 0 ? 'above' : 'below'} its 200-day</span>
        <span className="text-slate-500">{core.on ? `cash on a close below ${core.sma200.toFixed(2)}` : `back in on a close above ${core.sma200.toFixed(2)}`}</span>
        <span className="text-slate-600 ml-auto">as of the {asOf} close</span>
        <InfoDot text={`CORE — ${core.leverage}× QQQ (like QLD) while QQQ closes above its 200-day average, cash below; decided at the close for the next session. Tested 2016-2026 with the fund fee and borrowing cost: +209% / +273% (2016-20 / 2021-26) against QQQ's +180% / +128%; worst drop −40% / −39% against −29% / −36%; 2022 −31% against −33%. Leverage magnifies both directions and needs margin or a leveraged fund.\n\nSHORTLIST — the top ${picks.length} of ${universe} liquid stocks ($50M+ a day) scored by a model trained on 2016-2026 daily data: it favours steady leaders near their 52-week highs, above the 200-day, not after a spike, not wild. Trained only on earlier years, it ranked stocks the right way round in 7 of 9 unseen years — a small, real edge — but its top 20 held alone did NOT beat QQQ in testing. A list to choose from, not a buy list. LATE = up 4%+ or a range over 2× its ATR that day.\n\nNot advice. Rebuilt each evening from the close.`} />
      </div>
      <div className="mt-1 text-slate-500">
        {rec && rec.days >= 2
          ? <>Live since {rec.since}: core {pct(rec.core, 1)} · list {pct(rec.list, 1)} · QQQ {pct(rec.qqq, 1)}</>
          : <>Live record starts {asOf}.</>} · ranked best of {universe.toLocaleString()} liquid stocks
      </div>
      <div className="mt-2 overflow-x-auto">
        <div className="min-w-[340px]">
          <div className="flex items-center whitespace-nowrap py-[2px] border-b border-white/5 mb-0.5">
            <span className={`${H} w-[14px] text-right mr-1`}>#</span>
            <span className={`${H} w-[44px] text-center mx-0.5`}>Ticker</span>
            <span className={`${H} w-[46px] text-right ml-2`}>12M</span>
            <span className={`${H} w-[40px] text-right ml-2`}>Off hi</span>
            <span className={`${H} w-[36px] text-right ml-2`}>Today</span>
            <span className={`${H} w-[36px] text-right ml-2`}>Price</span>
            <span className={`${H} w-[34px] text-center ml-2`}>Flag</span>
          </div>
          {picks.map((p, i) => (
            <div key={p.t} className="flex items-center whitespace-nowrap py-[1px]" title={p.n ?? p.t}>
              <span className="text-[9px] tabular-nums text-slate-500 w-[14px] text-right mr-1">{i + 1}</span>
              <TickerChartHover symbol={p.t}><span className="inline-block w-[44px] mx-0.5 text-center text-[9px] font-bold tracking-wide rounded border border-white/10 bg-white/[0.03] text-slate-200 py-[1px]">{p.t}</span></TickerChartHover>
              <span className={`text-[9px] tabular-nums font-semibold w-[46px] text-right ml-2 ${p.mom >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{pct(p.mom)}</span>
              <span className="text-[9px] tabular-nums text-slate-400 w-[40px] text-right ml-2">{pct(p.off52)}</span>
              <span className={`text-[9px] tabular-nums w-[36px] text-right ml-2 ${p.chg1 >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{pct(p.chg1, 1)}</span>
              <span className="text-[9px] tabular-nums text-slate-300 w-[36px] text-right ml-2">{p.price >= 100 ? p.price.toFixed(0) : p.price.toFixed(2)}</span>
              <span className="w-[34px] text-center ml-2">{p.late
                ? <span className="inline-block px-1 rounded border text-[7px] font-bold text-rose-300 border-rose-500/30 bg-rose-500/10">LATE</span>
                : <span className="inline-block px-1 rounded border text-[7px] font-bold text-emerald-300 border-emerald-500/30 bg-emerald-500/10">OK</span>}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SystemCard;

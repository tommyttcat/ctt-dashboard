'use client';

import { useEffect, useState } from 'react';
import InfoDot from './InfoDot';
import { poll, pollMs } from '@/lib/poll';

/* ---- Market exposure (9 Oct 2026) ------------------------------------------
   One line in the Scorecard, under Choppiness: how much of the index the tested rule
   holds for the next session (lib/exposure, scripts/backtest/index-overlay.ts
   O4) — QQQ above its 200-day: in; below: cash; 150% for 10 sessions after a
   washout close. Decided once a night by /api/exposure/nightly; read through
   the CDN once per page load. Replaced the Washout light, whose breadth came
   from the scanner universe and ran a few points off the tested one.
   QQQ's live price (14 Oct) comes from /api/macro — the same CDN-cached URL
   the dashboard already polls, so no new Webull calls or KV reads; through
   lib/poll so hidden tabs fetch nothing. Since 30 Oct the pill follows that live price (below). */
type ExposureView = {
  asOf: string; mode: 'in' | 'out' | 'boost'; exposure: number; qqq: number; sma200: number;
  pctFrom200: number; breadth: number | null; boostDay: number | null;
};
const ExposureStrip = () => {
  const [s, setS] = useState<ExposureView | null>(null);
  useEffect(() => {
    let on = true;
    fetch('/api/exposure/latest').then(r => (r.ok ? r.json() : null)).then(j => { if (on && j?.state) setS(j.state); }).catch(() => {});
    return () => { on = false; };
  }, []);
  const [live, setLive] = useState<{ price: number; pct: number } | null>(null);
  useEffect(() => {
    let on = true;
    const load = () => fetch('/api/macro').then(r => (r.ok ? r.json() : null)).then(j => {
      const q = j?.quotes?.QQQ;
      if (on && q?.price > 0) setLive({ price: q.price, pct: q.pct });
    }).catch(() => {});
    load();
    const stop = poll(load, pollMs.marketHours(60_000, 900_000));
    return () => { on = false; stop(); };
  }, []);
  if (!s) return null;
  /* 30 Oct 2026, LIVE (owner chose it after "its very misleading": QQQ −4.0% on the day and the strip
     still said In · 100% from the night before). In/Out now follow QQQ's live price against last
     night's 200-day — under it is Out the moment it trades there. A boost stays on (it is set by a
     washout close, not by price). UNTESTED: the backtest decided at the close only; intraday
     switching whipsaws on days that dip under the line and close back over it. */
  const px = live?.price ?? s.qqq;
  const from200 = ((px - s.sma200) / s.sma200) * 100;
  const cut = s.sma200.toFixed(2);
  const mode = s.mode === 'boost' ? 'boost' : px > s.sma200 ? 'in' : 'out';
  const pill = mode === 'boost'
    ? { text: `Boost · 150% · day ${s.boostDay ?? '?'} of 10`, cls: 'text-indigo-300 bg-indigo-500/15 border-indigo-400/30' }
    : mode === 'in'
      ? Math.abs(from200) < 2
        ? { text: 'In · 100% · near the line', cls: 'text-amber-300 bg-amber-500/15 border-amber-400/30' }
        : { text: 'In · 100%', cls: 'text-emerald-300 bg-emerald-500/15 border-emerald-400/30' }
      : { text: 'Out · cash', cls: 'text-rose-300 bg-rose-500/15 border-rose-400/30' };
  const changed = live != null && s.mode !== 'boost' && mode !== s.mode
    ? `Was ${s.mode === 'in' ? 'In' : 'Out'} at the ${s.asOf} close` : null;
  const trend = `QQQ ${px.toFixed(2)}${live ? ` (${live.pct >= 0 ? '+' : ''}${live.pct.toFixed(1)}% today)` : ''} · ${Math.abs(from200).toFixed(1)}% ${from200 >= 0 ? 'above' : 'below'} the 200-day ${cut}`;
  const panic = s.mode === 'boost'
    ? `Washout: only ${s.breadth?.toFixed(0)}% of stocks were above their 40-day`
    : `Panic signal off · ${s.breadth?.toFixed(0) ?? '—'}% of stocks above their 40-day at the ${s.asOf} close`;
  return (
    <div className={`relative z-10 mb-4 md:mb-5 px-3 py-2 rounded-lg border bg-[#0f1524] flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] ${mode === 'boost' ? 'border-indigo-400/30' : mode === 'out' ? 'border-rose-400/30' : 'border-white/[0.06]'}`}>
      <span className="font-bold tracking-widest uppercase text-slate-400">Market exposure</span>
      <span className={`font-bold px-2 py-[1px] rounded border ${pill.cls}`}>{pill.text}</span>
      <span className="text-slate-200">{trend}</span>
      {changed && <span className="text-slate-500">{changed}</span>}
      <span className="text-slate-500">{panic}</span>
      <InfoDot text={`LIVE: In while QQQ trades above its 200-day (${cut}, from the ${s.asOf} close), Out the moment it trades below. The test below decided at the close only — switching during the day is UNTESTED and will flip back and forth on days that dip under the line and recover.\n\n` + "HOW MUCH OF THE INDEX TO HOLD, NOT WHICH STOCKS. Tested rule: in (100% QQQ) while QQQ closes above its 200-day average; out (cash) when it closes below; 150% for the 10 sessions after a washout close — 20% or fewer of all stocks above their own 40-day average. Decided at each close for the next session.\n\nTESTED OVER 2016–2026 (to 11 Sep), with this strip's own breadth formula and 0.2% charged each time it switches: 2016–20 +112% against QQQ +187% — it lagged; 2021–26 +200% against +131%. Over the whole stretch +535% against +553%, about even. Its value is in bad years — 2018 +5% against −1%, 2022 −18% against −33% — not in beating QQQ.\n\nTHE WEAKNESSES — the 150% washout part is knife-edge. It fired about a dozen times, and in February 2020 firing one day later (breadth 20.2% instead of 19.8%) turns 2020 from +74% into +20%. Its worst drop, −44% in March 2020 while at 150%, was deeper than QQQ's worst (−36%, 2022). The 200-day half is the long-published, well-tested part. 150% needs margin or a leveraged fund. Not advice."} />
    </div>
  );
};

export default ExposureStrip;

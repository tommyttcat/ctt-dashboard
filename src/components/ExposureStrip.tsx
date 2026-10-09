'use client';

import { useEffect, useState } from 'react';
import InfoDot from './InfoDot';

/* ---- Market exposure (9 Oct 2026) ------------------------------------------
   One line in the Scorecard, under Choppiness: how much of the index the tested rule
   holds for the next session (lib/exposure, scripts/backtest/index-overlay.ts
   O4) — QQQ above its 200-day: in; below: cash; 150% for 10 sessions after a
   washout close. Decided once a night by /api/exposure/nightly; read through
   the CDN once per page load. Replaced the Washout light, whose breadth came
   from the scanner universe and ran a few points off the tested one. */
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
  if (!s) return null;
  const pill = s.mode === 'boost'
    ? { text: `Boost · 150% · day ${s.boostDay ?? '?'} of 10`, cls: 'text-indigo-300 bg-indigo-500/15 border-indigo-400/30' }
    : s.mode === 'in'
      ? { text: 'In · 100%', cls: 'text-emerald-300 bg-emerald-500/15 border-emerald-400/30' }
      : { text: 'Out · cash', cls: 'text-amber-300 bg-amber-500/15 border-amber-400/30' };
  const trend = `QQQ ${s.qqq.toFixed(2)} is ${Math.abs(s.pctFrom200).toFixed(1)}% ${s.pctFrom200 >= 0 ? 'above' : 'below'} its 200-day (${s.sma200.toFixed(2)})`;
  const panic = s.mode === 'boost'
    ? `Washout: only ${s.breadth?.toFixed(0)}% of stocks were above their 40-day`
    : `Panic signal: off · ${s.breadth?.toFixed(0) ?? '—'}% of stocks above their 40-day`;
  return (
    <div className={`relative z-10 mb-4 md:mb-5 px-3 py-2 rounded-lg border bg-[#0f1524] flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] ${s.mode === 'boost' ? 'border-indigo-400/30' : 'border-white/[0.06]'}`}>
      <span className="font-bold tracking-widest uppercase text-slate-400">Market exposure</span>
      <span className={`font-bold px-2 py-[1px] rounded border ${pill.cls}`}>{pill.text}</span>
      <span className="text-slate-200">{trend}</span>
      <span className="text-slate-500">{panic}</span>
      <span className="text-slate-600 ml-auto">for the session after the {s.asOf} close</span>
      <InfoDot text={"HOW MUCH OF THE INDEX TO HOLD, NOT WHICH STOCKS. In (100% QQQ) while QQQ closes above its 200-day average; out (cash) when it closes below; 150% for the 10 sessions after a washout close — 20% or fewer of all stocks above their own 40-day average. Decided at each close for the next session.\n\nTESTED Jun 2022 – Sep 2026: +197% against QQQ +156% and SPY +103%; worst drop −20% against QQQ −23%.\n\nTHE WEAKNESSES — the washout part fired only 11 times and was found on the same data, so expect less. It is on a knife-edge: a few readings of 19.9% vs 20.1% move the four-year result by about 28 points, and only 10 of 15 nearby settings beat QQQ. The 200-day half is the long-published, well-tested part (it cut the worst drop from −23% to −14% on its own). 150% needs margin or a leveraged fund. Not advice."} />
    </div>
  );
};

export default ExposureStrip;

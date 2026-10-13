'use client';

/* NetHighsLowsChart — net new 52-week highs − new lows, with EMA 8 / 20 (13 Oct 2026, the
   owner's ask). Data: lib/netHighsLows, built nightly by the System job, served inside the
   CDN-cached /api/exposure/latest the Exposure strip already reads. Inline SVG, scales to the
   card's width (phones included). A breadth description, not a stand-aside rule: our own test
   found weak breadth preceded better QQQ returns. */

import { useEffect, useMemo, useState } from 'react';
import InfoDot from './InfoDot';
import { emaSeries, type NetHLPoint } from '@/lib/netHighsLows';

const W = 800, H = 140, PAD_B = 14;

export default function NetHighsLowsChart() {
  const [pts, setPts] = useState<NetHLPoint[] | null>(null);
  useEffect(() => {
    let on = true;
    fetch('/api/exposure/latest').then(r => (r.ok ? r.json() : null))
      .then(j => { if (on) setPts(j?.netHL?.history ?? null); }).catch(() => {});
    return () => { on = false; };
  }, []);

  const view = useMemo(() => {
    if (!pts || pts.length < 21) return null;
    const net = pts.map(p => p.net);
    const e8 = emaSeries(net, 8), e20 = emaSeries(net, 20);
    const max = Math.max(1, ...net.map(Math.abs), ...e8.map(Math.abs));
    const n = pts.length, bw = W / n, mid = (H - PAD_B) / 2;
    const y = (v: number) => mid - (v / max) * (mid - 4);
    const x = (i: number) => i * bw + bw / 2;
    const segs: { d: string; up: boolean }[] = [];
    for (let i = 1; i < n; i++) segs.push({ d: `M${x(i - 1)},${y(e8[i - 1])}L${x(i)},${y(e8[i])}`, up: e8[i] >= e20[i] });
    const months: { i: number; label: string }[] = [];
    pts.forEach((p, i) => { if (i > 0 && p.d.slice(5, 7) !== pts[i - 1].d.slice(5, 7)) months.push({ i, label: new Date(p.d + 'T12:00:00Z').toLocaleString('en-US', { month: 'short' }) }); });
    const last = pts[n - 1];
    const rising = e8[n - 1] >= e20[n - 1];
    return { net, e20, segs, months, last, rising, bw, y, x, mid, max };
  }, [pts]);

  if (!view) return null;
  const { net, e20, segs, months, last, rising, bw, y, x, mid } = view;
  return (
    <div className="relative z-10 mb-4 md:mb-5 px-3 py-2 rounded-lg border border-white/[0.06] bg-[#0f1524] text-[10px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-1">
        <span className="font-bold tracking-widest uppercase text-slate-400">Net new highs − lows</span>
        <span className={`font-bold px-2 py-[1px] rounded border ${rising ? 'text-emerald-300 bg-emerald-500/15 border-emerald-400/30' : 'text-rose-300 bg-rose-500/15 border-rose-400/30'}`}>{rising ? 'Rising' : 'Declining'}</span>
        <span className="text-slate-200 tabular-nums">{last.h} highs · {last.l} lows · net {last.net >= 0 ? '+' : ''}{last.net}</span>
        <span className="text-slate-600 ml-auto">52-week · EMA 8 / 20 · {last.d}</span>
        <InfoDot text={"NET NEW 52-WEEK HIGHS − LOWS: each day, how many US stocks and ADRs ($3+) made a new 52-week high minus how many made a new 52-week low. Bars are the daily net — green when more stocks made new highs than new lows, red when more made new lows; the bright line is its 8-day EMA (green while above the 20-day, red below); the grey line is the 20-day EMA. RISING / DECLINING = the 8-day above / below the 20-day.\n\nA breadth DESCRIPTION, not a rule. Our own 2016–2026 test found weak breadth was followed by BETTER QQQ returns over the next 20 days (washouts were buying chances), so this does not say 'stand aside'. Rebuilt each evening."} />
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-[120px] md:h-[140px]" role="img" aria-label="Net new 52-week highs minus lows">
        <line x1={0} x2={W} y1={mid} y2={mid} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
        {net.map((v, i) => (
          /* More new highs than lows = green bar, more lows = red (13 Oct 2026); muted so the
             EMA lines stay readable on top. */
          <rect key={i} x={i * bw + bw * 0.1} width={bw * 0.8} y={Math.min(y(v), mid)} height={Math.abs(y(v) - mid)} fill={v >= 0 ? '#10b981' : '#f43f5e'} opacity={0.45} />
        ))}
        <path d={e20.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('')} fill="none" stroke="#94a3b8" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        {segs.map((s, i) => <path key={i} d={s.d} fill="none" stroke={s.up ? '#22c55e' : '#ef4444'} strokeWidth={2} vectorEffect="non-scaling-stroke" />)}
        {months.map(m => <line key={m.i} x1={x(m.i)} x2={x(m.i)} y1={H - PAD_B} y2={H - PAD_B + 4} stroke="rgba(255,255,255,0.25)" vectorEffect="non-scaling-stroke" />)}
      </svg>
      <div className="relative h-3 text-slate-500">
        {months.map(m => <span key={m.i} className="absolute -translate-x-1/2" style={{ left: `${(x(m.i) / W) * 100}%` }}>{m.label}</span>)}
      </div>
    </div>
  );
}

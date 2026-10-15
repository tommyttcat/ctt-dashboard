// lib/scans/swingFields.ts — the swing checklist's inputs from a scan's own daily bars
// (12 Oct 2026). For scans whose rows did not carry them (VCP), so the universal colour can
// judge every row the same way. Bars oldest first; no extra API calls.

import { tightnessOf } from './tightness';

export type SFBar = { h: number; l: number; c: number; v: number };

export function swingFieldsOf(bars: SFBar[]): {
  ema50?: number; distToEma21?: number; distToEma10?: number; ema21Rising?: boolean; adrPct?: number; tight5?: number | null; volDry?: number | null; lowerHigh?: number | null;
} {
  const n = bars.length; if (n < 55) return {};
  const ema = (k: number, upto: number) => { let e = bars[0].c; for (let i = 1; i <= upto; i++) e = bars[i].c * (2 / (k + 1)) + e * (1 - 2 / (k + 1)); return e; };
  const c = bars[n - 1].c, e10 = ema(10, n - 1), e21 = ema(21, n - 1), e21p = ema(21, n - 2), e50 = ema(50, n - 1);
  const last20 = bars.slice(-20).filter(b => b.l > 0 && b.h > 0);
  const out: ReturnType<typeof swingFieldsOf> = {
    ema50: +e50.toFixed(2), ema21Rising: e21 > e21p,
    distToEma21: +((c / e21 - 1) * 100).toFixed(2), distToEma10: +((c / e10 - 1) * 100).toFixed(2),
    ...tightnessOf(bars),
  };
  if (last20.length >= 15) out.adrPct = +((last20.reduce((a, b) => a + b.h / b.l - 1, 0) / last20.length) * 100).toFixed(2);
  return out;
}

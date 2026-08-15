/* Everything MacroScorecardPanel needs, fetched and derived in one place.
 *
 * The dashboard drives its own copy of this from a live websocket feed, so it
 * does not use this hook. The analyst briefing does — and because every value
 * below comes from the same shared lib functions the dashboard uses, the two
 * pages cannot disagree about what the numbers are. They used to: three
 * different CHOP composites, two T2108 vocabularies, and cell ladders that
 * contradicted the bar ladders on the same screen.
 */

'use client';

import { useEffect, useState } from 'react';
import {
  type ChopMode,
  type ChopBands,
  type DivergenceRead,
  CHOP_BANDS,
  DEFAULT_CHOP_MODE,
  bandsFor,
  chopComposite,
  rawChopOf,
  chopZoneLabel,
  chopVerdict,
  chopSpreadNote,
  chopAllBandsNote,
  divergenceOf,
  CHOP_TREND_BAND,
  INTRADAY_STALE_MINUTES,
} from '@/lib/indicators/chopMarket';
import { marketTone, advPct as advPctOf, highsPct as highsPctOf, type MarketTone } from '@/lib/indicators/marketScorecard';

export interface MacroScorecardData {
  marketTone: MarketTone;
  quotes: Record<string, any>;
  breadth: any | null;
  tVal: number | null;
  chop: any;
  chopVal: number | null;
  chopRaw: number | null;
  chopDelta: number | null;
  chopTrend: 'up' | 'down' | 'flat';
  adTrend: 'up' | 'down' | 'flat';
  hlTrend: 'up' | 'down' | 'flat';
  advPct: number;
  highsPct: number;
  intraVal: number | null;
  intraStale: boolean;
  intraLastBar: string | null;
  chopTooltipText: string;
  chopMode: ChopMode;
  setChopMode: (m: ChopMode) => void;
  bands: ChopBands;
  divergence: DivergenceRead;
  ready: boolean;
}

const minutesSince = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 60000;
};

export function useMacroScorecard(): MacroScorecardData {
  const [quotes, setQuotes] = useState<Record<string, any>>({});
  const [breadth, setBreadth] = useState<any | null>(null);
  const [tVal, setTVal] = useState<number | null>(null);
  const [chop, setChop] = useState<any>(null);
  const [chopMode, setChopModeState] = useState<ChopMode>(DEFAULT_CHOP_MODE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [macroRes, t2108Res, chopRes, modeRes] = await Promise.all([
        fetch('/api/macro', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/t2108/latest', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/chop', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/settings/chop', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      if (cancelled) return;
      setQuotes(macroRes?.quotes || {});
      setBreadth(macroRes?.breadth ?? null);
      setTVal(t2108Res?.value ?? null);
      setChop(chopRes ?? null);
      if (modeRes?.mode && CHOP_BANDS[modeRes.mode as ChopMode]) setChopModeState(modeRes.mode as ChopMode);
      setReady(true);
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const setChopMode = (m: ChopMode) => {
    setChopModeState(m);
    fetch('/api/settings/chop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: m }),
    }).catch(() => {});
  };

  const bands = bandsFor(chopMode);
  const { tone } = marketTone(quotes, breadth?.score);

  const chopRaw = chop?.success ? rawChopOf(chop) : null;
  const chopRawPrev = chop?.daily?.blendedPrev ?? chop?.blendedPrev ?? null;
  const chopVal = chopComposite(chopRaw, breadth);

  /* Delta is taken from the RAW readings, not the composites — the modifiers
     are today's internals and would otherwise show up as movement in a
     day-over-day comparison. */
  const chopDelta = chopRaw != null && chopRawPrev != null ? chopRaw - chopRawPrev : null;
  const chopTrend: 'up' | 'down' | 'flat' =
    chopDelta == null || Math.abs(chopDelta) < CHOP_TREND_BAND ? 'flat' : chopDelta > 0 ? 'up' : 'down';

  const intraVal = chop?.intraday?.blended ?? null;
  const intraLastBar = chop?.intraday?.lastBar ?? null;
  const intraAgeMin = minutesSince(intraLastBar);
  const intraStale = intraAgeMin != null && intraAgeMin > INTRADAY_STALE_MINUTES;

  const divergence = divergenceOf(chopVal, intraVal, bands);

  const advPct = advPctOf(breadth?.advancers, breadth?.decliners);
  const highsPct = highsPctOf(breadth?.newHighs, breadth?.newLows);

  const chopTooltipText = chopVal == null ? '' : [
    `CHOP ${chopVal.toFixed(0)} — ${chopZoneLabel(chopVal, bands)}   [${bands.label}]`,
    '',
    chopVerdict(chopVal, bands),
    '',
    `Daily (${chop?.period ?? 14} × 1d): QQQ ${chop?.qqq != null ? chop.qqq.toFixed(1) : '—'}, SPY ${chop?.spy != null ? chop.spy.toFixed(1) : '—'}, blended ${chopRaw != null ? chopRaw.toFixed(1) : '—'}`,
    `Adjusted ${chopRaw != null && chopVal - chopRaw >= 0 ? '+' : ''}${chopRaw != null ? (chopVal - chopRaw).toFixed(1) : '0'} by breadth centrality and high/low balance.`,
    chopSpreadNote(chop?.qqq ?? null, chop?.spy ?? null),
    intraVal != null
      ? `\nIntraday (${chop?.intraday?.windowMinutes ?? 210} min): ${intraVal.toFixed(1)} — ${chopZoneLabel(intraVal, bands)}. Raw, unadjusted.` +
        (divergence.label ? `\n${divergence.label}: ${divergence.detail}` : '')
      : '',
    '',
    chopAllBandsNote(chopVal, chopMode),
  ].filter(Boolean).join('\n');

  return {
    marketTone: tone,
    quotes,
    breadth,
    tVal,
    chop,
    chopVal,
    chopRaw,
    chopDelta,
    chopTrend,
    /* A single-fetch page has no previous refresh to compare against, so the
       A/D and H/L arrows stay neutral rather than implying a direction. */
    adTrend: 'flat',
    hlTrend: 'flat',
    advPct,
    highsPct,
    intraVal,
    intraStale,
    intraLastBar,
    chopTooltipText,
    chopMode,
    setChopMode,
    bands,
    divergence,
    ready,
  };
}

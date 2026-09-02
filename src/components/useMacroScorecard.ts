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
  chopWithConcordance,
  chopTrendOf,
  rawChopOf,
  chopZoneLabel,
  chopVerdict,
  chopSpreadNote,
  chopAllBandsNote,
  divergenceOf,
  INTRADAY_STALE_MINUTES,
} from '@/lib/indicators/chopMarket';
import {
  marketTone,
  advPct as advPctOf,
  highsPct as highsPctOf,
  instDirSetup,
  instDirSignal,
  type MarketTone,
  type InstDirSetup,
  type InstDirSignal,
} from '@/lib/indicators/marketScorecard';

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
  hourVal: number | null;
  hourStale: boolean;
  hourLastBar: string | null;
  chopTooltipText: string;
  chopMode: ChopMode;
  setChopMode: (m: ChopMode) => void;
  bands: ChopBands;
  divergence: DivergenceRead;
  instSetup: InstDirSetup;
  instSignal: InstDirSignal;
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

  const intraVal = chop?.intraday?.blended ?? null;
  const intraLastBar = chop?.intraday?.lastBar ?? null;
  const intraAgeMin = minutesSince(intraLastBar);
  const intraStale = intraAgeMin != null && intraAgeMin > INTRADAY_STALE_MINUTES;

  const hourVal = chop?.hourly?.blended ?? null;
  const hourLastBar = chop?.hourly?.lastBarAt ?? null;
  const hourAgeMin = minutesSince(hourLastBar);
  const hourStale = hourAgeMin != null && hourAgeMin > INTRADAY_STALE_MINUTES;

  const sessionDir = { qqqPct: quotes['QQQ']?.pct ?? null, spyPct: quotes['SPY']?.pct ?? null };
  const chopRawBase = hourVal ?? chopRaw;
  const chopBase = chopComposite(chopRawBase, breadth, { blended: intraVal, stale: intraStale || intraVal == null }, sessionDir);
  const chopVal = chopWithConcordance(chopBase, intraVal, bands);

  const chopDelta = chopRaw != null && chopRawPrev != null ? chopRaw - chopRawPrev : null;
  const chopTrend = chopTrendOf(chopRaw, chopRawPrev, intraVal, intraStale, chopBase);

  const divergence = divergenceOf(chopBase, intraVal, bands);

  const advPct = advPctOf(breadth?.advancers, breadth?.decliners);
  const highsPct = highsPctOf(breadth?.newHighs, breadth?.newLows);

  const spy = quotes['SPY'];
  const qqq = quotes['QQQ'];
  const vix = quotes['VIX'];
  const iSetup = spy && qqq && vix
    ? instDirSetup(
        spy.price ?? 0, spy.prevLow ?? null, spy.pct ?? 0,
        qqq.price ?? 0, qqq.prevLow ?? null,
        vix.price ?? 0, vix.prevHigh ?? null, vix.pct ?? 0,
      )
    : 'CLEAR' as InstDirSetup;
  const iSignal = instDirSignal(iSetup);

  const chopTooltipText = chopVal == null ? '' : [
    `CHOP ${chopVal.toFixed(0)} — ${chopZoneLabel(chopVal, bands)}   [${bands.label}]`,
    '',
    chopVerdict(chopVal, bands),
    '',
    hourVal != null
      ? `Hourly (${chop?.period ?? 14} × 1h): QQQ ${chop?.hourly?.qqq != null ? chop.hourly.qqq.toFixed(1) : '—'}, SPY ${chop?.hourly?.spy != null ? chop.hourly.spy.toFixed(1) : '—'}, blended ${hourVal.toFixed(1)}`
      : `Daily (${chop?.period ?? 14} × 1d): QQQ ${chop?.qqq != null ? chop.qqq.toFixed(1) : '—'}, SPY ${chop?.spy != null ? chop.spy.toFixed(1) : '—'}, blended ${chopRaw != null ? chopRaw.toFixed(1) : '—'}`,
    `Adjusted ${chopRawBase != null && chopVal - chopRawBase >= 0 ? '+' : ''}${chopRawBase != null ? (chopVal - chopRawBase).toFixed(1) : '0'} by breadth centrality and high/low balance.`,
    chopSpreadNote(hourVal != null ? chop?.hourly?.qqq ?? null : chop?.qqq ?? null, hourVal != null ? chop?.hourly?.spy ?? null : chop?.spy ?? null),
    intraVal != null
      ? `\nIntraday (${chop?.intraday?.windowMinutes ?? 210} min, 15m bars): ${intraVal.toFixed(1)} — ${chopZoneLabel(intraVal, bands)}. Raw, unadjusted.` +
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
    hourVal,
    hourStale,
    hourLastBar,
    chopTooltipText,
    chopMode,
    setChopMode,
    bands,
    divergence,
    instSetup: iSetup,
    instSignal: iSignal,
    ready,
  };
}

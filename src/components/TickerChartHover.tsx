'use client';

import React, { useState, useCallback, useEffect, Suspense, useId, useRef } from 'react';

const MiniChart = React.lazy(() => import('./analyst/MiniChart'));
import { prefetchChart } from './analyst/MiniChart';

export const ActiveChartCtx = React.createContext<{
  activeId: string | null;
  activeSymbol: string | null;
  triggerX: number;
  triggerEl: HTMLElement | null;
  setActive: (id: string | null, symbol: string | null, x?: number, el?: HTMLElement | null) => void;
  scheduleDismiss: () => void;
  cancelDismiss: () => void;
}>({ activeId: null, activeSymbol: null, triggerX: 0, triggerEl: null, setActive: () => {}, scheduleDismiss: () => {}, cancelDismiss: () => {} });

/* Finviz opens on contact and closes the moment you leave. Ours can't be a
   literal zero — a cursor crossing a dense table would strobe through every
   row it passes — but 60ms is below the threshold where a hover reads as
   deliberate, so it feels instant while still ignoring pure transit.
   Shared so the analyst page's own chip can't drift away from this again. */
export const HOVER_DELAY_MS = 60;

/* The popup sits top-centred, so leaving a ticker to go use its timeframe
   buttons means crossing most of the screen. This is the budget for that trip:
   long enough to make it, short enough that a stale chart is not still sitting
   there seconds after you have moved on. The old value was 3000ms. */
export const DISMISS_DELAY_MS = 700;

const POPUP_W = 560;
const ANCHOR_GAP = 12;
const VIEWPORT_EDGE = 8;

export const autoScrollRef = { current: false };
export const scrollingRef = { current: false };
export const activeSectionEl = { current: null as HTMLElement | null };
export const scrollDir = { current: 'down' as 'up' | 'down' };
export const activeLock = { current: false };
let lastScrollY = 0;
let scrollCooldown: ReturnType<typeof setTimeout> | null = null;

export function ActiveChartProvider({ children, inline }: { children: React.ReactNode; inline?: boolean }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeSymbol, setActiveSymbol] = useState<string | null>(null);
  const [triggerX, setTriggerX] = useState(0);
  const [triggerEl, setTriggerEl] = useState<HTMLElement | null>(null);
  const dismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelDismiss = useCallback(() => {
    if (dismissRef.current) { clearTimeout(dismissRef.current); dismissRef.current = null; }
  }, []);

  const setActive = useCallback((id: string | null, symbol: string | null, x?: number, el?: HTMLElement | null) => {
    cancelDismiss();
    if (id) {
      autoScrollRef.current = true;
      setTimeout(() => { autoScrollRef.current = false; }, 300);
    } else {
      activeSectionEl.current = null;
    }
    setActiveId(id);
    setActiveSymbol(symbol);
    setTriggerEl(el ?? null);
    if (x != null) setTriggerX(x);
  }, [cancelDismiss]);

  const scheduleDismiss = useCallback(() => {
    cancelDismiss();
    dismissRef.current = setTimeout(() => { setActiveId(null); setActiveSymbol(null); setTriggerEl(null); }, DISMISS_DELAY_MS);
  }, [cancelDismiss]);

  useEffect(() => {
    const handler = () => {
      const y = window.scrollY;
      if (y > lastScrollY) scrollDir.current = 'down';
      else if (y < lastScrollY) scrollDir.current = 'up';
      lastScrollY = y;
      if (autoScrollRef.current) return;
      scrollingRef.current = true;
      if (scrollCooldown) clearTimeout(scrollCooldown);
      scrollCooldown = setTimeout(() => { scrollingRef.current = false; }, 400);
      /* No dismiss-on-scroll any more. The popup is now pinned to the row that
         opened it and re-anchors as the page moves, so it can never end up
         describing a ticker that has scrolled away from it. */
    };
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, [cancelDismiss]);

  const isActive = !!(activeId && activeSymbol);

  return (
    <ActiveChartCtx.Provider value={{ activeId, activeSymbol, triggerX, triggerEl, setActive, scheduleDismiss, cancelDismiss }}>
      {children}
      {isActive && !inline && (
        <ChartPopup symbol={activeSymbol} triggerX={triggerX} />
      )}
    </ActiveChartCtx.Provider>
  );
}

/* Hold a table's rows still while a chart is open.
 *
 * Every table polls on its own 60s timer and re-sorts, so rows could reorder
 * under you in the middle of reading a chart you opened from one of them. The
 * poll still runs and state still updates — this only defers what is *shown*,
 * returning the last value from before the popup opened and snapping to the
 * current one the moment it closes. */
export function useFreezeWhileChartOpen<T>(value: T): T {
  const { activeSymbol } = React.useContext(ActiveChartCtx);
  const open = activeSymbol != null;
  const held = useRef(value);
  if (!open) held.current = value;
  return open ? held.current : value;
}

export function InlineChart() {
  const { activeSymbol, scheduleDismiss, cancelDismiss } = React.useContext(ActiveChartCtx);
  const [profile, setProfile] = useState<{ name?: string; sector?: string } | null>(null);
  const onProfile = useCallback((p: { name?: string; sector?: string }) => setProfile(p), []);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevSymbol = useRef<string | null>(null);
  const chartHeight = useRef(0);

  useEffect(() => {
    if (activeSymbol && activeSymbol !== prevSymbol.current) {
      setProfile(null);
    }
    if (activeSymbol && !prevSymbol.current) {
      requestAnimationFrame(() => {
        if (containerRef.current) {
          chartHeight.current = containerRef.current.scrollHeight;
          autoScrollRef.current = true;
          window.scrollBy({ top: chartHeight.current, behavior: 'instant' as ScrollBehavior });
          setTimeout(() => { autoScrollRef.current = false; }, 100);
        }
      });
    }
    if (!activeSymbol && prevSymbol.current) {
      if (chartHeight.current > 0) {
        autoScrollRef.current = true;
        window.scrollBy({ top: -chartHeight.current, behavior: 'instant' as ScrollBehavior });
        chartHeight.current = 0;
        setTimeout(() => { autoScrollRef.current = false; }, 100);
      }
    }
    prevSymbol.current = activeSymbol;
  }, [activeSymbol]);

  return (
    <div
      ref={containerRef}
      className={activeSymbol ? 'sticky top-0 z-50 mb-5' : 'h-0 overflow-hidden'}
      onMouseEnter={cancelDismiss}
      onMouseLeave={scheduleDismiss}
    >
      {activeSymbol && (
        <div className="max-w-[600px] mx-auto rounded-lg border border-white/10 bg-[#0c1322] shadow-2xl shadow-black/60 px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[13px] font-bold text-slate-200 tracking-wider">{activeSymbol}</span>
            {profile && (profile.name || profile.sector) && (
              <>
                <span className="text-slate-600">·</span>
                {profile.name && <span className="text-[11px] text-slate-500 truncate">{profile.name}</span>}
                {profile.sector && <span className="text-[10px] text-slate-600 shrink-0">{profile.sector}</span>}
              </>
            )}
          </div>
          <Suspense fallback={<div className="flex items-center justify-center h-[320px]"><div className="w-4 h-4 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" /></div>}>
            <MiniChart symbol={activeSymbol} showTrend large onProfile={onProfile} />
          </Suspense>
        </div>
      )}
    </div>
  );
}

/* The setup tables run as two side-by-side columns, each with its ticker chips
   on its own left edge. A popup fixed to the centre of the screen covers one of
   those ticker columns, which is the list you are reading. So: stay pinned to
   the top, but slide sideways out of the way of whichever column you are on —
   hovering the left column pushes the popup right of those chips, hovering the
   right column puts it left of them. Clamped so it can't leave the viewport. */
function useSidePosition(
  triggerEl: HTMLElement | null,
  popupRef: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  const [left, setLeft] = useState<number | null>(null);

  React.useLayoutEffect(() => {
    if (!enabled || !triggerEl) { setLeft(null); return; }

    const place = () => {
      const r = triggerEl.getBoundingClientRect();
      const pw = popupRef.current?.offsetWidth || POPUP_W;
      const vw = window.innerWidth;

      const inLeftColumn = r.left + r.width / 2 < vw / 2;
      const raw = inLeftColumn ? r.right + ANCHOR_GAP : r.left - ANCHOR_GAP - pw;
      const clamped = Math.min(
        Math.max(VIEWPORT_EDGE, raw),
        Math.max(VIEWPORT_EDGE, vw - pw - VIEWPORT_EDGE),
      );

      setLeft(prev => (prev === clamped ? prev : clamped));
    };

    place();

    /* The popup is narrower on its first frame and settles once the chart is
       in, so a right-column placement computed too early lands in the wrong
       spot. Re-place whenever its own size changes. */
    const ro = new ResizeObserver(place);
    if (popupRef.current) ro.observe(popupRef.current);
    window.addEventListener('resize', place);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [triggerEl, enabled, popupRef]);

  return left;
}

let earningsCache: Map<string, EarningsData> | null = null;
let earningsFetch: Promise<Map<string, EarningsData>> | null = null;

function fetchEarningsMap(): Promise<Map<string, EarningsData>> {
  if (earningsCache) return Promise.resolve(earningsCache);
  if (earningsFetch) return earningsFetch;
  earningsFetch = (async () => {
    const map = new Map<string, EarningsData>();
    try {
      const now = new Date();
      const mon = new Date(now); mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      const fri = new Date(mon); fri.setDate(mon.getDate() + 11);
      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      const res = await fetch(`/api/earnings?from=${fmt(mon)}&to=${fmt(fri)}`);
      if (!res.ok) return map;
      const data = await res.json();
      const today = fmt(now);
      for (const e of data.events || []) {
        const sym = (e.symbol || '').toUpperCase();
        if (!sym) continue;
        const reported = e.date < today || (e.date === today && !(e.when || '').toString().toUpperCase().includes('AMC'));
        map.set(sym, {
          date: e.date,
          when: null,
          reported,
          epsEst: e.epsEstimated ?? null,
          epsActual: e.epsActual ?? null,
          revEst: e.revenueEstimated ?? null,
          revActual: null,
          surprise: e.epsSurprisePct ?? null,
        });
      }
    } catch {}
    earningsCache = map;
    setTimeout(() => { earningsCache = null; earningsFetch = null; }, 4 * 60 * 60 * 1000);
    return map;
  })();
  return earningsFetch;
}

const fmtRev = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toLocaleString()}`;
};

const fmtEarningsDate = (dateStr: string, when: string | null) => {
  const d = new Date(dateStr + 'T12:00:00');
  const month = d.toLocaleString('en-US', { month: 'short' });
  const day = d.getDate();
  const timing = when ? ` ${when}` : '';
  return `${month} ${day}${timing}`;
};

interface EarningsData {
  date: string;
  when: string | null;
  reported: boolean;
  epsEst: number | null;
  epsActual: number | null;
  revEst: number | null;
  revActual: number | null;
  surprise: number | null;
}

function EarningsStrip({ earnings }: { earnings: EarningsData }) {
  const { date, when, reported, epsEst, epsActual, revEst, revActual, surprise } = earnings;

  const hasBeat = surprise != null;
  const beatColor = hasBeat
    ? surprise! > 0 ? 'text-emerald-400' : surprise! < 0 ? 'text-red-400' : 'text-slate-400'
    : '';
  const beatLabel = hasBeat
    ? surprise! > 0 ? 'BEAT' : surprise! < 0 ? 'MISS' : 'INLINE'
    : '';

  return (
    <div className="mt-1.5 pt-1.5 border-t border-white/5 flex items-center gap-2 text-[10px] font-medium tracking-wide">
      <span className="text-amber-400/80 font-bold shrink-0">EARNINGS</span>
      <span className="text-slate-400">{fmtEarningsDate(date, when)}</span>
      {reported && hasBeat && (
        <>
          <span className={`font-bold ${beatColor}`}>
            {beatLabel} {surprise! > 0 ? '+' : ''}{surprise!.toFixed(1)}%
          </span>
          {epsActual != null && epsEst != null && (
            <span className="text-slate-500">${epsActual.toFixed(2)} vs ${epsEst.toFixed(2)} est</span>
          )}
        </>
      )}
      {!reported && epsEst != null && (
        <span className="text-slate-500">Est EPS ${epsEst.toFixed(2)}</span>
      )}
      {!reported && revEst != null && (
        <span className="text-slate-500">Est Rev {fmtRev(revEst)}</span>
      )}
      {reported && !hasBeat && epsActual != null && (
        <span className="text-slate-500">EPS ${epsActual.toFixed(2)}</span>
      )}
      {reported && revActual != null && (
        <span className="text-slate-500">Rev {fmtRev(revActual)}</span>
      )}
    </div>
  );
}

function ChartPopup({ symbol }: { symbol: string; triggerX: number }) {
  const { setActive, scheduleDismiss, cancelDismiss, triggerEl } = React.useContext(ActiveChartCtx);
  const popupRef = useRef<HTMLDivElement>(null);
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const left = useSidePosition(triggerEl, popupRef, !isMobile);
  const [profile, setProfile] = useState<{ name?: string; sector?: string } | null>(null);
  const onProfile = useCallback((p: { name?: string; sector?: string }) => setProfile(p), []);

  const [earnings, setEarnings] = useState<EarningsData | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchEarningsMap().then(map => {
      if (!cancelled) setEarnings(map.get(symbol) || null);
    });
    return () => { cancelled = true; };
  }, [symbol]);
  const prevSymbol = useRef(symbol);
  useEffect(() => {
    if (symbol !== prevSymbol.current) { setProfile(null); prevSymbol.current = symbol; }
  }, [symbol]);

  useEffect(() => {
    if (!isMobile) return;
    const handler = (e: TouchEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        const target = e.target as HTMLElement;
        if (target.closest('[data-chart-hover]')) return;
        setActive(null, null);
      }
    };
    document.addEventListener('touchstart', handler, { passive: true });
    return () => document.removeEventListener('touchstart', handler);
  }, [isMobile, setActive]);

  useEffect(() => {
    if (isMobile) return;
    const handler = (e: MouseEvent) => {
      if (popupRef.current && popupRef.current.contains(e.target as Node)) return;
      if ((e.target as HTMLElement)?.closest('[data-chart-hover]')) return;
      if ((e.target as HTMLElement)?.closest('[data-chart-section]')) return;
      setActive(null, null);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [isMobile, setActive]);

  return (
    <div
      ref={popupRef}
      onMouseEnter={cancelDismiss}
      onMouseLeave={scheduleDismiss}
      onClick={scheduleDismiss}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchEnd={(e) => { e.stopPropagation(); scheduleDismiss(); }}
      /* Pinned to the top; `left` is chosen to clear the hovered ticker column.
         Until it is measured the popup is parked offscreen rather than flashed
         at the wrong side. The width and height caps keep it on screen —
         without them a popup taller than the viewport ran off the bottom. */
      style={isMobile ? undefined : {
        left: left ?? -9999,
        top: VIEWPORT_EDGE,
        width: `min(${POPUP_W}px, calc(100vw - ${VIEWPORT_EDGE * 2}px))`,
        maxHeight: `calc(100vh - ${VIEWPORT_EDGE * 2}px)`,
        overflowY: 'auto',
      }}
      className={isMobile
        ? 'fixed z-[9999] top-2 left-2 right-2 rounded-lg border border-white/10 bg-[#0c1322] shadow-2xl shadow-black/60 px-3 py-2'
        : 'fixed z-[9999] rounded-lg border border-white/10 bg-[#0c1322] shadow-2xl shadow-black/60 px-4 py-3'}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[13px] font-bold text-slate-200 tracking-wider">{symbol}</span>
        {profile && (profile.name || profile.sector) && (
          <>
            <span className="text-slate-600">·</span>
            {profile.name && <span className="text-[11px] text-slate-500 truncate">{profile.name}</span>}
            {profile.sector && <span className="text-[10px] text-slate-600 shrink-0">{profile.sector}</span>}
          </>
        )}
      </div>
      <Suspense fallback={<div className="flex items-center justify-center h-[320px]"><div className="w-4 h-4 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" /></div>}>
        <MiniChart symbol={symbol} showTrend large onProfile={onProfile} />
      </Suspense>
      {earnings && <EarningsStrip earnings={earnings} />}
    </div>
  );
}

interface TickerChartHoverProps {
  symbol: string;
  children: React.ReactNode;
}

export default function TickerChartHover({ symbol, children }: TickerChartHoverProps) {
  const instanceId = useId();
  const { activeId, setActive, scheduleDismiss, cancelDismiss } = React.useContext(ActiveChartCtx);
  const spanRef = useRef<HTMLSpanElement>(null);
  const hoverDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getTriggerX = () => {
    if (!spanRef.current) return 0;
    const rect = spanRef.current.getBoundingClientRect();
    return rect.left + rect.width / 2;
  };

  const activate = useCallback(() => {
    cancelDismiss();
    setActive(instanceId, symbol, getTriggerX(), spanRef.current);
  }, [instanceId, symbol, setActive, cancelDismiss]);

  /* The old `scrollingRef` guard suppressed hover for 400ms after any scroll,
     which is why the first hover after scrolling to a row appeared dead and
     only a click would open it — click never consulted the guard. Scrolling no
     longer blocks opening; the popup anchors to its row instead.

     The fetch starts on contact rather than when the timer fires, so by the
     time the popup opens the bars are usually already in the cache. */
  const handleEnter = useCallback(() => {
    cancelDismiss();
    prefetchChart(symbol);
    if (hoverDelayRef.current) clearTimeout(hoverDelayRef.current);
    hoverDelayRef.current = setTimeout(activate, HOVER_DELAY_MS);
  }, [cancelDismiss, activate, symbol]);

  const handleLeave = useCallback(() => {
    if (hoverDelayRef.current) { clearTimeout(hoverDelayRef.current); hoverDelayRef.current = null; }
    scheduleDismiss();
  }, [scheduleDismiss]);

  const handleTap = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (activeId === instanceId) {
      setActive(null, null);
    } else {
      setActive(instanceId, symbol, getTriggerX(), spanRef.current);
    }
  }, [activeId, instanceId, symbol, setActive]);

  return (
    <span
      ref={spanRef}
      data-chart-hover="1"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onClick={(e) => { e.stopPropagation(); activate(); }}
      onTouchEnd={handleTap}
      className="cursor-default relative inline-block touch-target"
    >
      {children}
    </span>
  );
}

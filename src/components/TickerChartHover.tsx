'use client';

import React, { useState, useCallback, useEffect, Suspense, useId, useRef } from 'react';

const MiniChart = React.lazy(() => import('./analyst/MiniChart'));

export const ActiveChartCtx = React.createContext<{
  activeId: string | null;
  activeSymbol: string | null;
  triggerX: number;
  setActive: (id: string | null, symbol: string | null, x?: number) => void;
  scheduleDismiss: () => void;
  cancelDismiss: () => void;
}>({ activeId: null, activeSymbol: null, triggerX: 0, setActive: () => {}, scheduleDismiss: () => {}, cancelDismiss: () => {} });

export const autoScrollRef = { current: false };
export const scrollingRef = { current: false };
export const activeSectionEl = { current: null as HTMLElement | null };
export const scrollDir = { current: 'down' as 'up' | 'down' };
export const activeLock = { current: false };
let lastScrollY = 0;
let scrollCooldown: ReturnType<typeof setTimeout> | null = null;

export function ActiveChartProvider({ children }: { children: React.ReactNode }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeSymbol, setActiveSymbol] = useState<string | null>(null);
  const [triggerX, setTriggerX] = useState(0);
  const dismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelDismiss = useCallback(() => {
    if (dismissRef.current) { clearTimeout(dismissRef.current); dismissRef.current = null; }
  }, []);

  const setActive = useCallback((id: string | null, symbol: string | null, x?: number) => {
    cancelDismiss();
    if (id) {
      autoScrollRef.current = true;
      scrollAnchor.current = window.scrollY;
      setTimeout(() => { autoScrollRef.current = false; }, 300);
    } else {
      activeSectionEl.current = null;
    }
    setActiveId(id);
    setActiveSymbol(symbol);
    if (x != null) setTriggerX(x);
  }, [cancelDismiss]);

  const scheduleDismiss = useCallback(() => {
    cancelDismiss();
    dismissRef.current = setTimeout(() => { setActiveId(null); setActiveSymbol(null); }, 3000);
  }, [cancelDismiss]);

  const scrollAnchor = useRef(0);
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
      if (window.innerWidth >= 768 && Math.abs(y - scrollAnchor.current) > 40) {
        setActiveId(null);
        setActiveSymbol(null);
        cancelDismiss();
      }
    };
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, [cancelDismiss]);

  const isActive = !!(activeId && activeSymbol);

  return (
    <ActiveChartCtx.Provider value={{ activeId, activeSymbol, triggerX, setActive, scheduleDismiss, cancelDismiss }}>
      {children}
      {isActive && (
        <ChartPopup symbol={activeSymbol} triggerX={triggerX} />
      )}
    </ActiveChartCtx.Provider>
  );
}

function ChartPopup({ symbol, triggerX }: { symbol: string; triggerX: number }) {
  const { setActive, scheduleDismiss, cancelDismiss } = React.useContext(ActiveChartCtx);
  const popupRef = useRef<HTMLDivElement>(null);
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

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
      setActive(null, null);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [isMobile, setActive]);

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const triggerOnLeft = triggerX <= vw / 2;

  const midDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (isMobile) return;
    const mid = vw / 2;
    const handler = (e: MouseEvent) => {
      if (popupRef.current && popupRef.current.contains(e.target as Node)) {
        if (midDismissRef.current) { clearTimeout(midDismissRef.current); midDismissRef.current = null; }
        return;
      }
      if ((e.target as HTMLElement)?.closest('[data-chart-hover]')) {
        if (midDismissRef.current) { clearTimeout(midDismissRef.current); midDismissRef.current = null; }
        return;
      }
      const crossed = (triggerOnLeft && e.clientX > mid) || (!triggerOnLeft && e.clientX < mid);
      if (crossed && !midDismissRef.current) {
        midDismissRef.current = setTimeout(() => { midDismissRef.current = null; setActive(null, null); }, 3000);
      }
      if (!crossed && midDismissRef.current) {
        clearTimeout(midDismissRef.current); midDismissRef.current = null;
      }
    };
    document.addEventListener('mousemove', handler, { passive: true });
    return () => {
      document.removeEventListener('mousemove', handler);
      if (midDismissRef.current) clearTimeout(midDismissRef.current);
    };
  }, [isMobile, vw, triggerOnLeft, setActive]);

  return (
    <div
      ref={popupRef}
      onMouseEnter={cancelDismiss}
      onMouseLeave={scheduleDismiss}
      onClick={scheduleDismiss}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchEnd={(e) => { e.stopPropagation(); scheduleDismiss(); }}
      className={isMobile
        ? 'fixed z-[9999] top-2 left-2 right-2 rounded-lg border border-white/10 bg-[#0c1322] shadow-2xl shadow-black/60 px-3 py-2'
        : 'fixed z-[9999] top-2 left-1/2 -translate-x-1/2 w-[560px] rounded-lg border border-white/10 bg-[#0c1322] shadow-2xl shadow-black/60 px-4 py-3'}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[13px] font-bold text-slate-200 tracking-wider">{symbol}</span>
      </div>
      <Suspense fallback={<div className="flex items-center justify-center h-[320px]"><div className="w-4 h-4 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" /></div>}>
        <MiniChart symbol={symbol} showTrend large />
      </Suspense>
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
    setActive(instanceId, symbol, getTriggerX());
  }, [instanceId, symbol, setActive, cancelDismiss]);

  const handleEnter = useCallback(() => {
    if (scrollingRef.current) return;
    cancelDismiss();
    if (hoverDelayRef.current) clearTimeout(hoverDelayRef.current);
    hoverDelayRef.current = setTimeout(() => {
      if (!scrollingRef.current) activate();
    }, 500);
  }, [cancelDismiss, activate]);

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
      setActive(instanceId, symbol, getTriggerX());
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

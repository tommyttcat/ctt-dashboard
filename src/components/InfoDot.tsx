'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

const POPUP_W = 288; // w-72 = 18rem = 288px
const EDGE = 8;

export default function InfoDot({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const dotRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (show && dotRef.current) {
      const rect = dotRef.current.getBoundingClientRect();
      const vw = window.innerWidth;
      const above = rect.top > 180;
      let left = rect.left + rect.width / 2 - POPUP_W / 2;
      if (left < EDGE) left = EDGE;
      if (left + POPUP_W > vw - EDGE) left = vw - EDGE - POPUP_W;
      setPos({
        left,
        ...(above
          ? { bottom: window.innerHeight - rect.top + 6 }
          : { top: rect.bottom + 6 }),
      });
    } else {
      setPos(null);
    }
  }, [show]);

  const popup = show && pos && createPortal(
    <span
      className="fixed z-[9999] w-72 max-h-60 overflow-y-auto px-3.5 py-2.5 rounded-lg bg-[#1a2035] border border-white/10 shadow-2xl text-[10px] leading-[1.6] text-slate-300 normal-case tracking-normal font-normal whitespace-normal text-left"
      style={pos}
    >
      {text}
    </span>,
    document.body,
  );

  return (
    <span
      className="relative ml-1 inline-flex"
      ref={dotRef}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={(e) => { e.stopPropagation(); setShow(s => !s); }}
    >
      <span className="text-[8px] text-slate-600 border border-white/10 rounded-full w-[11px] h-[11px] leading-[10px] text-center shrink-0 cursor-help hover:text-slate-400 hover:border-white/20 transition-colors">?</span>
      {popup}
    </span>
  );
}

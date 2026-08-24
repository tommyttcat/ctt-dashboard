'use client';

import React, { useState, useRef, useEffect } from 'react';

export default function InfoDot({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  const [above, setAbove] = useState(true);
  const dotRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (show && dotRef.current) {
      const rect = dotRef.current.getBoundingClientRect();
      setAbove(rect.top > 180);
    }
  }, [show]);

  return (
    <span
      className="relative ml-1 inline-flex"
      ref={dotRef}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={(e) => { e.stopPropagation(); setShow(s => !s); }}
    >
      <span className="text-[8px] text-slate-600 border border-white/10 rounded-full w-[11px] h-[11px] leading-[10px] text-center shrink-0 cursor-help hover:text-slate-400 hover:border-white/20 transition-colors">?</span>
      {show && (
        <span
          className={`fixed z-[9999] w-72 max-h-60 overflow-y-auto px-3.5 py-2.5 rounded-lg bg-[#1a2035] border border-white/10 shadow-2xl text-[10px] leading-[1.6] text-slate-300 normal-case tracking-normal font-normal whitespace-normal text-left`}
          style={{
            left: dotRef.current ? dotRef.current.getBoundingClientRect().left - 130 : 0,
            ...(above
              ? { bottom: dotRef.current ? window.innerHeight - dotRef.current.getBoundingClientRect().top + 6 : 0 }
              : { top: dotRef.current ? dotRef.current.getBoundingClientRect().bottom + 6 : 0 }),
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

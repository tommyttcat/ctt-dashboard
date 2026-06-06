'use client';

import React, { useState } from 'react';

export default function CollapsibleSection({ 
  title, 
  defaultOpen = true, 
  children 
}: { 
  title: string; 
  defaultOpen?: boolean; 
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="flex flex-col gap-2">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full px-5 py-3 bg-[#101623] hover:bg-[#161c2a] border border-white/5 hover:border-indigo-500/30 rounded-xl transition-all group cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <div className={`w-1.5 h-1.5 rounded-full transition-colors ${isOpen ? 'bg-indigo-500' : 'bg-slate-600'}`}></div>
          <span className={`text-xs font-bold tracking-widest uppercase transition-colors ${isOpen ? 'text-indigo-400' : 'text-slate-400 group-hover:text-slate-300'}`}>
            {title}
          </span>
        </div>
        <span className="text-slate-600 text-[10px] font-mono tracking-widest uppercase group-hover:text-slate-400 transition-colors">
          {isOpen ? 'HIDE ▼' : 'SHOW ◀'}
        </span>
      </button>
      
      {isOpen && (
        <div className="mt-2">
          {children}
        </div>
      )}
    </div>
  );
}
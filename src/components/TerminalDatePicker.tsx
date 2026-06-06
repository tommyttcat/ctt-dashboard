"use client";

import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function TerminalDatePicker() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Get the current date from the URL, or default to today
  const today = new Date().toISOString().split('T')[0];
  const selectedDate = searchParams.get('date') || today;

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDate = e.target.value;
    if (newDate === today) {
      router.push('/'); // Clear params if it's today
    } else {
      router.push(`/?date=${newDate}`); // Set the date in the URL
    }
  };

  const isHistorical = selectedDate !== today;

  return (
    <div className="flex items-center gap-3 bg-[#161c2a] border border-white/10 rounded-lg px-3 py-1.5">
      <div className={`w-2 h-2 rounded-full ${isHistorical ? 'bg-amber-500' : 'bg-emerald-500 animate-pulse'}`}></div>
      <span className="text-[10px] text-slate-400 font-bold tracking-widest uppercase">
        {isHistorical ? 'HISTORICAL ARCHIVE' : 'LIVE ENGINE'}
      </span>
      <div className="h-4 w-px bg-white/10 mx-1"></div>
      <input 
        type="date" 
        value={selectedDate}
        onChange={handleDateChange}
        max={today}
        className="bg-transparent text-sm text-slate-200 font-mono outline-none border-none cursor-pointer [&::-webkit-calendar-picker-indicator]:invert-[0.8]"
      />
    </div>
  );
}
'use client';

import React, { Suspense } from 'react';
import { MarketDataProvider } from './MarketDataContext';
import { ThemeToggle } from './ThemeProvider';
import { ActiveChartProvider } from './TickerChartHover';

import Scorecard from './Scorecard';
import DailySetupsComponent from './DailySetups';
import StocksInPlay from './StocksInPlay';
import Consolidation1021 from './Consolidation1021';
import TechnicalsEcon from './TechnicalsEcon';
import EarningsCalendar from './EarningsCalendar';
import MarketSummary from './MarketSummary';
import TopMovers from './TopMovers';
import DollarVolumeScanner from './DollarVolumeScanner';
import SwingCandidates from './SwingCandidates';
import Ep9m from './Ep9m';
import Vcp from './Vcp';
import Multibagger from './Multibagger';


export default function DailySetupsPage() {
  return (
    <div className="min-h-screen bg-[#05080f] text-slate-300 font-sans md:py-10 flex justify-center">
      <Suspense fallback={<div className="flex h-screen w-full items-center justify-center text-slate-500 font-bold tracking-widest uppercase">Loading Workspace...</div>}>
        
        <MarketDataProvider>
          <ActiveChartProvider>
          <div className="w-full max-w-[1200px] bg-[#0b101a] md:rounded-[2rem] border-x md:border border-white/5 overflow-hidden shadow-2xl relative pb-20">
            
            {/* Header */}
            <div className="px-6 md:px-10 pt-8 pb-6 border-b border-white/5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div className="flex items-center gap-3.5 md:gap-5">
                <img src="/logo.svg" alt="CTT" className="ctt-logo h-9 md:h-12 w-auto drop-shadow-[0_2px_10px_rgba(124,139,250,0.18)]" />
                <div className="leading-none">
                  <h2 className="text-2xl md:text-[2.5rem] font-extrabold text-slate-50 tracking-[-0.025em] leading-[1.05] antialiased">
                    Confluence Trading Tools
                  </h2>
                  <p className="text-[10px] md:text-[11px] font-semibold text-slate-500 tracking-[0.22em] uppercase mt-2">
                    Stock Market Dashboard
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <ThemeToggle />
                <a
                  href="/confluence"
                  className="px-4 py-2 rounded-lg text-sm font-bold bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors shrink-0"
                >
                  Confluence
                </a>
                <a
                  href="/analyst"
                  className="px-4 py-2 rounded-lg text-sm font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors shrink-0"
                >
                  Analyst Brief
                </a>
              </div>
            </div>

            {/* The Stack */}
            <div className="px-4 md:px-10 py-6 space-y-6">
              <Scorecard />
              <MarketSummary />
              <TopMovers />
              <StocksInPlay />
              <DollarVolumeScanner />
              <DailySetupsComponent />
              <SwingCandidates />
              <Consolidation1021 />
              <Vcp />
              <Ep9m />
              <Multibagger />
              <TechnicalsEcon />
              <EarningsCalendar />
              
              
            </div>

            {/* Footer */}
            <div className="text-center text-[10px] text-slate-600 pt-10 pb-4">
              Confluence Trading Tools © {new Date().getFullYear()} • Not investment advice.
            </div>
          </div>
          </ActiveChartProvider>
        </MarketDataProvider>

      </Suspense>
    </div>
  );
}
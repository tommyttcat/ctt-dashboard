'use client';

import React, { Suspense } from 'react';
import { MarketDataProvider } from './MarketDataContext';
import { ThemeToggle } from './ThemeProvider';
import { ActiveChartProvider } from './TickerChartHover';
import DashNav from './DashNav';

import TopMovers from './TopMovers';
import StocksInPlay from './StocksInPlay';
import DollarVolumeScanner from './DollarVolumeScanner';
import DailySetupsComponent from './DailySetups';
import SwingCandidates from './SwingCandidates';
import HiddenRelativeStrength from './HiddenRelativeStrength';
import Consolidation1021 from './Consolidation1021';
import Vcp from './Vcp';
import Ep9m from './Ep9m';
import Multibagger from './Multibagger';
import SetupConfluence from './SetupConfluence';

export default function ScannersPage() {
  return (
    <div className="min-h-screen bg-[#05080f] text-slate-300 font-sans md:py-10 flex justify-center">
      <Suspense fallback={<div className="flex h-screen w-full items-center justify-center text-slate-500 font-bold tracking-widest uppercase">Loading Scanners...</div>}>
        <MarketDataProvider>
          <ActiveChartProvider>
          <div className="w-full max-w-[1200px] bg-[#0b101a] md:rounded-[2rem] md:border md:border-white/5 overflow-hidden md:shadow-2xl relative pb-20">

            {/* Header */}
            <div className="px-3 md:px-10 pt-6 md:pt-8 pb-4 md:pb-6 border-b border-white/5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div className="flex items-center gap-3.5 md:gap-5">
                <a href="/dashboard">
                  <img src="/logo.svg" alt="CTT" className="ctt-logo h-9 md:h-12 w-auto drop-shadow-[0_2px_10px_rgba(124,139,250,0.18)]" />
                </a>
                <div className="leading-none">
                  <h2 className="text-2xl md:text-[2.5rem] font-extrabold text-slate-50 tracking-[-0.025em] leading-[1.05] antialiased">
                    Confluence Trading Tools
                  </h2>
                  <p className="text-[10px] md:text-[11px] font-semibold text-slate-500 tracking-[0.22em] uppercase mt-2">
                    Stock Market Scanners
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <ThemeToggle />
                <DashNav />
              </div>
            </div>

            {/* Scanner Stack */}
            <div className="px-0 md:px-10 py-6 space-y-6">
              <SetupConfluence />
              <TopMovers />
              <StocksInPlay />
              <DollarVolumeScanner />
              <DailySetupsComponent />
              <SwingCandidates />
              <HiddenRelativeStrength />
              <Consolidation1021 />
              <Vcp />
              <Ep9m />
              <Multibagger />
            </div>

            {/* Footer */}
            <div className="text-center text-[10px] text-slate-600 pt-10 pb-4">
              Confluence Trading Tools LLC © {new Date().getFullYear()} • Not investment advice.
            </div>
          </div>
          </ActiveChartProvider>
        </MarketDataProvider>
      </Suspense>
    </div>
  );
}

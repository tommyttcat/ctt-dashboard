'use client';

import React, { Suspense, useState } from 'react';
import { MarketDataProvider } from './MarketDataContext';
import { ThemeToggle } from './ThemeProvider';
import { ActiveChartProvider } from './TickerChartHover';
import HelpModal from './HelpModal';
import DashNav from './DashNav';
import { WatchlistProvider } from './WatchlistContext';
import WatchlistPanel from './WatchlistPanel';

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
import HighBeta from './HighBeta';
import SetupConfluence from './SetupConfluence';

export default function ScannersPage() {
  const [helpOpen, setHelpOpen] = useState(false);
  return (
    <div className="min-h-screen bg-[#05080f] text-slate-300 font-sans md:py-10 flex justify-center">
      <Suspense fallback={<div className="flex h-screen w-full items-center justify-center text-slate-500 font-bold tracking-widest uppercase">Loading Scanners...</div>}>
        <WatchlistProvider>
        <MarketDataProvider>
          <ActiveChartProvider>
          <div className="w-full max-w-[1200px] bg-[#0b101a] md:rounded-[2rem] md:border md:border-white/5 overflow-hidden md:shadow-2xl relative pb-20">

            {/* Header */}
            <div className="px-3 md:px-10 pt-6 md:pt-8 pb-4 md:pb-6 border-b border-white/5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <a href="https://confluencetradingtools.com" className="flex items-center gap-3.5 md:gap-5 no-underline" style={{ textDecoration: 'none' }}>
                <img src="/logo.svg" alt="CTT" className="ctt-logo h-9 md:h-10 w-auto drop-shadow-[0_2px_10px_rgba(124,139,250,0.18)]" />
                <div className="leading-none">
                  <h2 className="text-xl md:text-[1.75rem] font-extrabold text-slate-50 tracking-[-0.025em] leading-[1.05] antialiased">
                    Confluence Trading Tools
                  </h2>
                  <p className="text-[10px] md:text-[10px] font-semibold text-slate-500 tracking-[0.22em] uppercase mt-1.5">
                    Stock Market Scanners
                  </p>
                </div>
              </a>
              <div className="flex items-center gap-2">
                <ThemeToggle />
                <DashNav />
                <WatchlistPanel hideToggle />
                <button
                  onClick={() => setHelpOpen(true)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-sm font-bold bg-slate-700/60 hover:bg-slate-600 text-slate-400 hover:text-slate-200 transition-colors shrink-0"
                  title="Help"
                >
                  ?
                </button>
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
              <HighBeta />
            </div>

            {/* Footer */}
            <div className="text-center text-[10px] text-slate-600 pt-10 pb-4">
              Confluence Trading Tools LLC © {new Date().getFullYear()} • Not investment advice. • <a href="mailto:info@confluencetradingtools.com" className="text-slate-500 hover:text-slate-400" style={{ textDecoration: 'none' }}>info@confluencetradingtools.com</a>
            </div>
          </div>
          </ActiveChartProvider>
        </MarketDataProvider>
        </WatchlistProvider>
      </Suspense>
      <HelpModal isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

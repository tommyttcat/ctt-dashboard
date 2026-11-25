'use client';

import React, { Suspense, useEffect, useState } from 'react';
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

/* One scanner on screen at a time (25 Nov 2026). The page used to stack all
   eleven tables, every one polling its own route each minute. Only the picked
   table is mounted, so only it fetches — the others cost nothing until chosen.
   The pick is kept in localStorage and can be linked with ?scan=<key>. */
const SCANS: { key: string; label: string; El: React.ComponentType }[] = [
  { key: 'movers', label: 'Top Movers', El: TopMovers },
  { key: 'sip', label: 'Stocks in Play', El: StocksInPlay },
  { key: 'dvol', label: '$ Volume', El: DollarVolumeScanner },
  { key: 'daily', label: 'Daily Setups', El: DailySetupsComponent },
  { key: 'swing', label: 'Swing', El: SwingCandidates },
  { key: 'hrs', label: 'Hidden RS', El: HiddenRelativeStrength },
  { key: '1021', label: '10/21', El: Consolidation1021 },
  { key: 'vcp', label: 'VCP', El: Vcp },
  { key: 'ep9m', label: 'EP9M', El: Ep9m },
  { key: 'mb', label: '100-Bagger', El: Multibagger },
  { key: 'beta', label: 'High Beta', El: HighBeta },
];
const SCAN_PICK_KEY = 'ctt_scanner_pick';

export default function ScannersPage() {
  const [helpOpen, setHelpOpen] = useState(false);
  const [pick, setPick] = useState(SCANS[0].key);
  /* Read the saved pick after mount, not in the initial state, so the server
     render and the first client render agree. */
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('scan');
    const saved = fromUrl ?? localStorage.getItem(SCAN_PICK_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one read of external state (URL / localStorage) after hydration
    if (saved && SCANS.some(sc => sc.key === saved)) setPick(saved);
  }, []);
  const choose = (key: string) => {
    setPick(key);
    localStorage.setItem(SCAN_PICK_KEY, key);
    const url = new URL(window.location.href);
    url.searchParams.set('scan', key);
    window.history.replaceState(null, '', url);
  };
  const Active = (SCANS.find(sc => sc.key === pick) ?? SCANS[0]).El;
  return (
    <div className="min-h-screen bg-[#05080f] text-slate-300 font-sans md:py-10 flex justify-center">
      <Suspense fallback={<div className="flex h-screen w-full items-center justify-center text-slate-500 font-bold tracking-widest uppercase">Loading Scanners...</div>}>
        <WatchlistProvider>
        <MarketDataProvider>
          <ActiveChartProvider>
          <div className="w-full max-w-[1200px] bg-[#0b101a] md:rounded-[2rem] md:border md:border-white/5 overflow-hidden md:shadow-2xl relative pb-20">

            {/* Header */}
            <div className="px-3 md:px-10 pt-6 md:pt-8 pb-4 md:pb-6 border-b border-white/5 flex flex-wrap justify-between items-center gap-3">
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
                <WatchlistPanel hideToggle />
                <button
                  onClick={() => setHelpOpen(true)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-sm font-bold bg-slate-700/60 hover:bg-slate-600 text-slate-400 hover:text-slate-200 transition-colors shrink-0"
                  title="Help"
                >
                  ?
                </button>
              </div>
              {/* The links get their own centred row on a phone: they are the
                  width of the screen, so sharing a line with the brand and the
                  controls is what pushed the theme toggle onto a line of its own.
                  From md up `order-none` puts them back inline. */}
              <div className="w-full flex justify-center order-last md:w-auto md:order-none">
                <DashNav />
              </div>
            </div>

            {/* Scanner picker + the one picked table */}
            <div className="px-0 md:px-10 py-6 space-y-6">
              {/* Wraps onto a second row on a phone rather than scrolling sideways,
                  so every scanner stays one tap away. */}
              <div className="px-3 md:px-0 flex flex-wrap justify-center md:justify-start gap-1">
                {SCANS.map(sc => (
                  <button
                    key={sc.key}
                    onClick={() => choose(sc.key)}
                    className={`px-2.5 py-1.5 rounded-lg text-[12px] font-bold tracking-wide transition-colors shrink-0 whitespace-nowrap ${
                      pick === sc.key
                        ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/25'
                        : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04] border border-white/5'
                    }`}
                  >
                    {sc.label}
                  </button>
                ))}
              </div>
              <Active key={pick} />
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

// Tell Vercel NOT to statically prerender this real-time dashboard
export const dynamic = 'force-dynamic';
// KILL-SWITCH FOR CACHE: Force zero caching across the board
export const revalidate = 0;

import React, { Suspense } from 'react';
import { MarketDataProvider } from '../components/MarketDataContext'; 

import Scorecard from '../components/Scorecard';
import NewsCatalysts from '../components/NewsCatalysts';
import SectorsFlow from '../components/SectorsFlow';
import DailySetupsComponent from '../components/DailySetups';
import StocksInPlay from '../components/StocksInPlay';
import TechnicalsEcon from '../components/TechnicalsEcon';
import EarningsCalendar from '../components/EarningsCalendar';
import MarketSummary from '../components/MarketSummary';
import TopMovers from '../components/TopMovers';
import SwingCandidates from '../components/SwingCandidates';

export default function DailySetupsPage() {
  return (
    <div className="min-h-screen bg-[#05080f] text-slate-300 font-sans md:py-10 flex justify-center">
      <Suspense fallback={<div className="flex h-screen w-full items-center justify-center text-slate-500 font-bold tracking-widest uppercase">Loading Workspace...</div>}>
        
        <MarketDataProvider>
          
          <div className="w-full max-w-[1200px] bg-[#0b101a] md:rounded-[2rem] border-x md:border border-white/5 overflow-hidden shadow-2xl relative pb-20">
            
            {/* Header */}
            <div className="px-6 md:px-10 pt-8 pb-6 border-b border-white/5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h2 className="text-2xl md:text-4xl font-extrabold text-slate-100 mb-2">Confluence Trading Tools</h2>
                <p className="text-sm md:text-base text-slate-400">Stock Market Dashboard</p>
              </div>
            </div>

            {/* The Stack */}
            <div className="px-4 md:px-10 py-6 space-y-6">
              <Scorecard />
              <SectorsFlow />
              <MarketSummary />
              <TopMovers />
              <StocksInPlay />
              <DailySetupsComponent />
              <SwingCandidates />
              <NewsCatalysts />
              <TechnicalsEcon />
              <EarningsCalendar />
              
              
            </div>

            {/* Footer */}
            <div className="text-center text-[10px] text-slate-600 pt-10 pb-4">
              Confluence Trading Tools © {new Date().getFullYear()} • Not investment advice.
            </div>
          </div>
        </MarketDataProvider>

      </Suspense>
    </div>
  );
}
'use client';

import React, { useState, useEffect, useCallback } from 'react';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  tier?: string;
}

type Tab = 'overview' | 'dashboard' | 'analyst' | 'confluence' | 'interactions' | 'updates';

const ALL_TABS: { key: Tab; label: string; minTier: 'starter' | 'core' | 'pro' }[] = [
  { key: 'overview', label: 'Overview', minTier: 'starter' },
  { key: 'dashboard', label: 'Dashboard', minTier: 'core' },
  { key: 'analyst', label: 'Analyst Brief', minTier: 'core' },
  { key: 'confluence', label: 'Confluence', minTier: 'pro' },
  { key: 'interactions', label: 'Controls', minTier: 'core' },
  { key: 'updates', label: 'Updates', minTier: 'starter' },
];

const TIER_RANK: Record<string, number> = { starter: 0, core: 1, pro: 2, trial_7: 2, trial_14: 2, trial_30: 2 };

function tierRank(tier: string): number {
  return TIER_RANK[tier] ?? 2;
}

const H = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-sm font-bold text-slate-100 tracking-wide mt-6 mb-2 first:mt-0">{children}</h3>
);
const P = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[13px] text-slate-400 leading-[1.8] mb-3">{children}</p>
);
const Li = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="mb-3 pl-3 border-l-2 border-white/5">
    <span className="text-[13px] font-semibold text-slate-200">{title}</span>
    <span className="text-[13px] text-slate-400 leading-[1.8]"> — {children}</span>
  </div>
);
const Badge = ({ color, children }: { color: string; children: React.ReactNode }) => (
  <span className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded border tracking-wider ${color}`}>{children}</span>
);

const ProBadge = () => (
  <span className="inline-block text-[9px] font-bold px-1.5 py-0.5 rounded border tracking-wider text-amber-400 bg-amber-500/10 border-amber-500/20 ml-2">PRO</span>
);

function TierLabel({ tier }: { tier: string }) {
  const labels: Record<string, { name: string; color: string }> = {
    starter: { name: 'Starter', color: '#818cf8' },
    core: { name: 'Core', color: '#34d399' },
    pro: { name: 'Pro', color: '#fbbf24' },
    trial_7: { name: 'Pro Trial', color: '#fbbf24' },
    trial_14: { name: 'Pro Trial', color: '#fbbf24' },
    trial_30: { name: 'Pro Trial', color: '#fbbf24' },
  };
  const info = labels[tier] || labels.pro;
  return (
    <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full tracking-wider" style={{ background: `${info.color}20`, color: info.color }}>
      {info.name}
    </span>
  );
}

function OverviewTab({ tier }: { tier: string }) {
  const rank = tierRank(tier);
  return (
    <div>
      <H>What is CTT?</H>
      <P>
        Confluence Trading Tools is a stock market dashboard that scans for high-probability trade setups
        by measuring how many independent technical and fundamental factors align on a single name. The core idea
        is <strong className="text-slate-200">confluence</strong>: a stock with volume, relative strength, a clean base,
        a catalyst, and favorable market conditions is more likely to follow through than one with just one of those.
      </P>

      <H>Your Plan — <TierLabel tier={tier} /></H>
      {rank === 0 && (
        <P>
          Your Starter plan includes AI-powered market briefings delivered to your inbox — Morning Briefing, Midday Update, and Closing Print emails
          with regime analysis, top trade ideas, and actionable catalysts. Upgrade to Core for live dashboard access.
        </P>
      )}
      {rank === 1 && (
        <P>
          Your Core plan includes email briefings for all five trading sessions, plus live dashboard access with the market scorecard,
          Top Movers, Stocks in Play, Dollar Volume, Sector Performance, Industry Heat Map, and Key Events.
          You also have access to the Analyst Brief page. Upgrade to Pro for full scanner access, Confluence reports, and Macro analysis.
        </P>
      )}
      {rank >= 2 && (
        <P>
          Your Pro plan gives you full access to every feature — all scanners, the Confluence report, Macro Scorecard,
          Economic Calendar, Earnings Calendar, and all five session email briefings.
        </P>
      )}

      <H>What Each Plan Includes</H>
      <div className="space-y-4 mb-3">
        <div className={`rounded-lg border p-3 ${rank === 0 ? 'border-indigo-400/40 bg-indigo-500/10' : 'border-indigo-500/20 bg-indigo-500/5'}`}>
          <div className="text-[12px] font-bold text-indigo-300 mb-1.5">Starter</div>
          <div className="text-[12px] text-slate-400 leading-[1.8]">
            Morning Briefing Email &middot; Midday Update Email &middot; Closing Print Email &middot; AI-Powered Market Analysis
          </div>
        </div>
        <div className={`rounded-lg border p-3 ${rank === 1 ? 'border-emerald-400/40 bg-emerald-500/10' : 'border-emerald-500/20 bg-emerald-500/5'}`}>
          <div className="text-[12px] font-bold text-emerald-300 mb-1.5">Core</div>
          <div className="text-[12px] text-slate-400 leading-[1.8]">
            All Starter features &middot; All 5 Session Emails &middot; Dashboard (Scorecard, Top Movers, SIPs, $Vol, Sector Performance,
            Industry Heat, Key Events) &middot; Analyst Brief page
          </div>
        </div>
        <div className={`rounded-lg border p-3 ${rank >= 2 ? 'border-amber-400/40 bg-amber-500/10' : 'border-amber-500/20 bg-amber-500/5'}`}>
          <div className="text-[12px] font-bold text-amber-300 mb-1.5">Pro</div>
          <div className="text-[12px] text-slate-400 leading-[1.8]">
            All Core features &middot; Full Scanners page (Daily Setups, Swing, VCP, EP9M, HRS, Multibagger, 10/21) &middot;
            Confluence Report &middot; Macro Scorecard &middot; Macro Economic Analysis &middot; Earnings Calendar &middot; Economic Calendar
          </div>
        </div>
      </div>

      <H>Pages</H>
      {rank === 0 && (
        <P>
          As a Starter subscriber, your analysis is delivered via email. Upgrade to Core or Pro for live dashboard and briefing page access.
        </P>
      )}
      {rank === 1 && (
        <>
          <Li title="Dashboard (/)">
            Your workspace with scorecard, Top Movers, Stocks in Play, Dollar Volume, Sector Performance,
            Industry Heat Map, and Key Events.
          </Li>
          <Li title="Analyst Brief (/analyst)">
            AI-generated market analysis updated throughout the trading day. Regime assessment, session updates,
            top trade ideas with thesis and risk, and actionable catalysts.
          </Li>
        </>
      )}
      {rank >= 2 && (
        <>
          <Li title="Dashboard (/)">
            The main workspace. Twelve scanner panels ranked by confluence score, plus a macro scorecard
            and economic/earnings calendars. This is where you spend most of your time.
          </Li>
          <Li title="Analyst Brief (/analyst)">
            AI-generated market analysis updated throughout the trading day. Regime assessment, session updates
            (pre-market, midday, closing), top trade ideas with thesis and risk, and actionable catalysts.
          </Li>
          <Li title="Scanners (/scanners)">
            All 11 scanners in a single vertical stack — Setup Confluence, Top Movers, Stocks in Play,
            Dollar Volume, Daily Setups, Swing Candidates, HRS, 10/21 Consolidation, VCP, EP9M, and Multibagger.
            Each scanner runs independently and updates every 15 minutes.
          </Li>
          <Li title="Confluence (/confluence)">
            Multi-timeframe confluence report. Shows which stocks score highly across daily, weekly, and monthly
            timeframes. Sector filtering and an AI summary with top picks.
          </Li>
        </>
      )}
    </div>
  );
}

function DashboardTab({ tier }: { tier: string }) {
  const isPro = tierRank(tier) >= 2;
  const isCore = tierRank(tier) === 1;
  return (
    <div>
      {isPro && (
        <>
          <H>Macro Scorecard</H>
          <P>
            The top row of cards shows key market internals at a glance. Each card is color-coded green/amber/red
            based on its current reading. Cards include SPY, QQQ, VIX, bonds (TLT), gold, key sector ETFs, and
            crypto. The <strong className="text-slate-200">Market Tone</strong> card synthesizes breadth into a
            single signal. Click the section header to expand or collapse.
          </P>
        </>
      )}

      <H>Setups Summary</H>
      <P>
        All scanners pooled into one ranked view. Every ticker from every scanner is deduplicated, scored, and sorted
        by confluence. The number to the left of each row shows how many scanners the ticker currently appears in — hover
        it to see which ones (e.g. DAY &middot; EP9 &middot; VCP).
      </P>
      <P>
        Filter pills narrow the pool by source or pattern. <strong className="text-slate-200">Source filters</strong> show
        tickers from a specific scanner:
      </P>
      <div className="flex flex-wrap gap-1.5 mb-3 pl-3">
        <Badge color="text-amber-400 bg-amber-500/10 border-amber-500/20">DAY</Badge>
        <Badge color="text-cyan-400 bg-cyan-500/10 border-cyan-500/20">SWING</Badge>
        <Badge color="text-teal-400 bg-teal-500/10 border-teal-500/20">VCP</Badge>
        <Badge color="text-fuchsia-400 bg-fuchsia-500/10 border-fuchsia-500/20">EP9</Badge>
        <Badge color="text-violet-400 bg-violet-500/10 border-violet-500/20">10/21</Badge>
        <Badge color="text-fuchsia-400 bg-fuchsia-500/10 border-fuchsia-500/20">100</Badge>
      </div>
      <P><strong className="text-slate-200">Pattern filters</strong> match cross-scanner signals:</P>
      <Li title="GNG">Gap & Go — gapped up on volume.</Li>
      <Li title="TH">Trend Hold — holding a key moving average.</Li>
      <Li title="PB">20 EMA Pullback — pulling back to the 20 EMA.</Li>
      <Li title="SQZ">Bollinger Band Squeeze — volatility contraction.</Li>
      <Li title="CNF">Confluence — tickers appearing in 2+ scanners simultaneously.</Li>
      <Li title="STK">Sticky — tickers with 3+ consecutive scan appearances.</Li>
      <Li title="FND">Fundamentals — tickers passing the 100-Bagger fundamentals scan.</Li>
      <P>
        The active filter name appears in the section title (e.g. &quot;Setups Summary — CNF&quot;).
        CNF is selected by default. Click a pill to switch; click again to deselect and show all.
      </P>

      <H>Top Movers</H>
      <P>
        Biggest percentage movers sorted by change%. Split into stocks and ETFs using the toggle buttons.
      </P>

      <H>Stocks in Play (SIPs)</H>
      <P>
        The primary scanner. Stocks scored 0–100 on how many independent confluence factors align: relative volume,
        gap, range expansion, RS Rating, catalyst quality, persistence, VWAP, market regime, sector heat, dots, and runway.
        Grade A = 70+, B = 50–69.
      </P>
      <P>Filters narrow the board without changing the scores:</P>
      <Li title="CNF">Grade filter — show only A or B names.</Li>
      <Li title="POSTURE">Price vs 10/21 EMAs. First Touch = pullback to 21 EMA. Stacked = above both. Extended = stretched far above.</Li>
      <Li title="PLAN">Room-to-resistance filter. 1R = any plan exists. 2R+ = target is at least 2 stop-widths from trigger.</Li>
      <Li title="VWAP">Above or below session VWAP.</Li>
      <Li title="ADR">Average Daily Range filter — 5%+ or 10%+ movers only.</Li>
      <Li title="CAP">Market cap — Small or Large.</Li>

      <H>Dollar Volume Scanner</H>
      <P>
        Ranks stocks by dollar volume (price × shares traded). Useful for finding where institutional money is flowing.
        The CNF score here is slightly conservative because it lacks scan-streak and sector-heat inputs.
      </P>

      <H>Sector Performance</H>
      <P>
        Real-time sector ETF performance ranked by today&apos;s change. Shows which sectors are leading and lagging
        to help identify where money is flowing.
      </P>

      <H>Industry Heat Map</H>
      <P>
        Granular industry-level performance within each sector. Color-coded by strength to quickly spot
        the hottest and coldest pockets of the market.
      </P>

      <H>Key Events</H>
      <P>
        Today&apos;s market-moving economic data releases and events. Shows actual vs estimate with impact rating.
      </P>

      {isPro && (
        <>
          <H>Daily Setups<ProBadge /></H>
          <P>
            Intraday setup candidates with the same filter set as SIPs. Each row expands to show trigger, stop,
            and target prices. The setup name (EP, VCP, COIL, SWING, etc.) appears under the ticker.
          </P>

          <H>Swing Candidates<ProBadge /></H>
          <P>
            Multi-day pullback setups. Uses StochK for mean-reversion timing. The blue dot marks an oversold
            stochastic reset. These need more patience than daily setups — wait for the StochK reversal.
          </P>

          <H>Consolidation 10-21<ProBadge /></H>
          <P>
            Stocks coiling between the 10 and 21 EMAs. Has an extra <strong className="text-slate-200">RDY</strong> (Readiness)
            score 0–100 that measures base quality independent of tape action: breakout volume readiness, 10/21 gap,
            days in coil, and prior move size. CNF says whether it&apos;s moving; RDY says whether the base is ready.
          </P>

          <H>VCP (Volatility Contraction Pattern)<ProBadge /></H>
          <P>
            Minervini-style volatility contraction setups. Scored on contraction shape, volume drying, RS Rating,
            and Trend Template (7 structural criteria). Status badges: WATCH (building), READY (tight enough),
            FRESH (just triggered), EXTENDED (already moved).
          </P>

          <H>EP9M (Episodic Pivot)<ProBadge /></H>
          <P>
            Pradeep Bonde / Stockbee episodic pivots — stocks trading at least $9M in dollar volume with RVOL ≥ 3x.
            No trend gate, so STAGE is the main way to separate accumulation from capitulation. The fuchsia dot
            marks unprecedented volume (beat its own 60-day high).
          </P>

          <H>Hidden Relative Strength (HRS)<ProBadge /></H>
          <P>
            Stocks showing relative strength against a weak market — holding up or advancing while the index pulls back.
            Scored on how much the stock is outperforming SPY over the session. These are the names institutional
            money is quietly accumulating. Runs every 30 minutes from 9 AM – 5 PM ET.
          </P>

          <H>Multibagger<ProBadge /></H>
          <P>
            Fundamental scan for potential 100-bagger compounders. Scores on six attributes: Revenue Growth (25),
            Return on Capital (20), Low Debt (15), Market Cap (20), Valuation (10), Cash Generation (10).
            Filter by grade (A/B) and market cap tier.
          </P>

          <H>Economic Calendar &amp; Earnings<ProBadge /></H>
          <P>
            Upcoming economic data releases filtered by impact (High / Medium). Earnings calendar shows
            today and tomorrow, filterable by market cap tier. Both tables are sortable.
          </P>
        </>
      )}

      {isCore && (
        <div className="mt-6 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
          <div className="text-[11px] font-bold text-amber-300 mb-1">Unlock More with Pro</div>
          <div className="text-[12px] text-slate-400 leading-[1.8]">
            Daily Setups, Swing Candidates, VCP, EP9M, HRS, Multibagger scanners, Macro Scorecard, Economic Calendar, and Earnings Calendar.
          </div>
        </div>
      )}
    </div>
  );
}

function AnalystTab({ tier }: { tier: string }) {
  const isPro = tierRank(tier) >= 2;
  return (
    <div>
      <H>AI Analyst Brief</H>
      <P>
        The analyst brief is generated by an AI session that reads the full dashboard snapshot and writes
        market analysis. It updates throughout the trading day with session-specific commentary.
      </P>

      <H>Regime Assessment</H>
      <P>
        A market regime classification (Strong Uptrend → Strong Downtrend) based on breadth score, advance/decline ratio,
        T2108, chop index, new highs/lows, index performance, and EMA structure. Color-coded green/amber/red.
        The <strong className="text-slate-200">Posture</strong> line tells you how to size positions given the current regime.
      </P>

      {isPro && (
        <>
          <H>Macro Scorecard<ProBadge /></H>
          <P>
            Market internals scorecard showing SPY, QQQ, VIX, bonds, gold, sector ETFs, and crypto performance
            at a glance. Color-coded green/amber/red by signal strength.
          </P>

          <H>Macro Economic Analysis<ProBadge /></H>
          <P>
            Economic data overlay showing key macro indicators and their market impact. Helps contextualize
            price action within the broader economic environment.
          </P>
        </>
      )}

      <H>Session Updates</H>
      <P>
        Five blocks that appear throughout the trading day:{' '}
        <strong className="text-slate-200">Pre-Market</strong> (4:00 AM – 10:00 AM ET),{' '}
        <strong className="text-slate-200">Morning</strong> (10:00 AM – 12:00 PM ET),{' '}
        <strong className="text-slate-200">Midday</strong> (12:00 PM – 2:00 PM ET),{' '}
        <strong className="text-slate-200">Power Hour</strong> (2:00 PM – 4:00 PM ET), and{' '}
        <strong className="text-slate-200">Closing</strong> (4:00 PM – close).
        Each has a takeaway box summarizing the key point. Stale blocks (superseded by the next session) are dimmed.
      </P>

      <H>Key News &amp; Catalysts</H>
      <P>
        Top market-moving catalysts pulled from the scanner&apos;s per-ticker news data — the same source as the
        dashboard&apos;s Actionable Catalysts panel. Each entry shows ticker, change%, catalyst tag, and headline.
        Ranked by impact (RVOL + move size).
      </P>

      <H>Top Movers &amp; Stocks in Play</H>
      <P>
        Same grid layout as the dashboard tables. Sortable by CNF, change%, RVOL, volume, dollar volume, RS, and stage.
        Hover any ticker chip for a mini chart.
      </P>

      <H>Actionable Summary</H>
      <P>
        The bottom section distills the analysis into three buckets:
      </P>
      <Li title="Highest Conviction">Top 2 picks with full thesis, risk assessment, and trade plan (trigger/stop/target).</Li>
      <Li title="Watchlist">Next 3–5 names that need confirmation before acting. Each has a note on what to wait for.</Li>
      <Li title="Traps to Avoid">Names that look tempting but have structural problems — Stage 4, weak volume, etc.</Li>
    </div>
  );
}

function ConfluenceTab() {
  return (
    <div>
      <H>Multi-Timeframe Confluence</H>
      <P>
        The Confluence page runs the same scoring engine across daily, weekly, and monthly timeframes.
        A stock that scores well on all three has deeper confluence than one that only works on the daily.
      </P>

      <H>AI Summary</H>
      <P>
        An AI-generated overview of the highest-confluence names, grouped by sector. Shows a leaders table
        and sector performance breakdown. Click a sector name to filter the report to that sector.
      </P>

      <H>Report Cards</H>
      <P>
        Each stock gets a card showing its confluence score per timeframe, grade (A/B/C), sector,
        and a per-row breakdown of what&apos;s driving the score. Cards are sorted by composite score.
      </P>
    </div>
  );
}

function InteractionsTab() {
  return (
    <div>
      <H>Ticker Hover → Mini Chart</H>
      <P>
        Hover any ticker chip (the small labeled badges) on any table to see a mini price chart popup.
        On mobile, tap the chip to open the chart. The chart shows recent price action and helps you
        quickly assess the pattern without leaving the dashboard.
      </P>

      <H>Sortable Columns</H>
      <P>
        Click any column header with a sort arrow (↓/↑) to sort. Click once for descending, again for ascending,
        and a third time to reset to default order. Most tables default to CNF score descending.
      </P>

      <H>Filter Toggles</H>
      <P>
        Filters appear as small pill buttons below each section header. Click to activate (highlighted), click again
        to deactivate. Filters are independent — activating CNF A and VWAP Above shows only grade-A names that
        are above VWAP. The count badge shows how many rows pass the current filter combination.
      </P>

      <H>Expandable Rows</H>
      <P>
        On tables with trade plans (SIPs, Daily Setups, Swing Candidates), click a row to expand it and see
        the sub-row with trigger, stop, and target prices, along with EMA positions, sector, and scan provenance.
      </P>

      <H>My Watchlist</H>
      <P>
        Build a personal ticker list that syncs across all your devices. Hover any ticker to open the mini chart,
        then click the <strong className="text-slate-200">+</strong> button in the popup header to add it to your watchlist.
        A checkmark means it&apos;s already on the list — click again to remove.
      </P>
      <P>
        The watchlist icon in the top nav bar shows your count. Click it to open the panel where you can
        review your list, <strong className="text-slate-200">Copy TXT</strong> to clipboard, or download as a
        .txt file for import into TradingView, ThinkOrSwim, or any platform that accepts symbol lists.
      </P>

      <H>Copy TXT (Scanner Export)</H>
      <P>
        Each scanner section has a copy button in the header that copies all visible tickers as a
        newline-separated text list. Paste directly into TradingView&apos;s symbol import or any platform
        that accepts ticker lists. The export respects active filters — only tickers matching the current
        filter are included.
      </P>

      <H>Catalyst Chips</H>
      <P>
        Color-coded badges next to tickers that indicate the type of news driving the move:
      </P>
      <div className="flex flex-wrap gap-2 mb-3 pl-3">
        <Badge color="text-emerald-400 bg-emerald-500/10 border-emerald-500/20">EPS</Badge>
        <Badge color="text-emerald-400 bg-emerald-500/10 border-emerald-500/20">GDE</Badge>
        <Badge color="text-sky-400 bg-sky-500/10 border-sky-500/20">FDA</Badge>
        <Badge color="text-violet-400 bg-violet-500/10 border-violet-500/20">M&A</Badge>
        <Badge color="text-cyan-400 bg-cyan-500/10 border-cyan-500/20">CTR</Badge>
        <Badge color="text-cyan-400 bg-cyan-500/10 border-cyan-500/20">PRD</Badge>
        <Badge color="text-blue-400 bg-blue-500/10 border-blue-500/20">ANL</Badge>
        <Badge color="text-rose-400 bg-rose-500/10 border-rose-500/20">OFR</Badge>
        <Badge color="text-rose-400 bg-rose-500/10 border-rose-500/20">LGL</Badge>
      </div>
      <P>
        Hover the chip for the full headline, publisher, and age. Click to open the source article.
        Rose-colored chips (OFR, LGL) indicate potentially negative catalysts.
      </P>

      <H>News Stars</H>
      <P>
        <span className="text-amber-400 font-bold">★</span> = stock has a real news catalyst.{' '}
        <span className="text-amber-400 font-bold">★★</span> = high-quality causal catalyst (the news is directly
        causing the move, not just commentary). Click the star to open the article.
      </P>

      <H>Section Collapse</H>
      <P>
        Click any section header to collapse or expand it. Collapsed sections save vertical space
        so you can focus on the panels you care about.
      </P>

      <H>Theme Toggle</H>
      <P>
        The sun/moon icon in the top-right switches between dark and light mode. Your preference is saved
        in local storage.
      </P>

      <H>Column Key</H>
      <P>Common columns across scanner tables:</P>
      <Li title="CNF">Confluence score 0–100. Grades: A (70+), B (50–69), C (&lt;50).</Li>
      <Li title="CHG%">Today&apos;s price change percentage. Green = up, red = down.</Li>
      <Li title="RVOL">Relative Volume — today&apos;s volume vs 20-day average. 1.0 = normal, 2.0+ = elevated.</Li>
      <Li title="$VOL">Dollar Volume — price × shares traded. Measures institutional liquidity.</Li>
      <Li title="RS">Relative Strength Rating 0–99. Measures price performance vs the market over 12 months.</Li>
      <Li title="STG">Weinstein Stage. 1 = base, 2A = advance, 2B = extended, 2C = sagging, 3 = top, 4 = decline.</Li>
      <Li title="RTR">Room to Resistance. Measured in R-multiples (trigger minus stop). 2R+ = favorable.</Li>
      <Li title="ADR%">Average Daily Range as a percentage of price. Higher = more volatile.</Li>
      <Li title="10/21">Price position vs the 10 and 21 EMAs (Dr. Wish trend pair).</Li>
    </div>
  );
}

const Sched = ({ time, children }: { time: string; children: React.ReactNode }) => (
  <div className="mb-2 pl-3 border-l-2 border-white/5 flex items-start gap-3">
    <span className="text-[11px] font-medium text-indigo-400 shrink-0 w-[140px]">{time}</span>
    <span className="text-[13px] text-slate-400 leading-[1.8]">{children}</span>
  </div>
);

function UpdatesTab({ tier }: { tier: string }) {
  const isPro = tierRank(tier) >= 2;
  const isCore = tierRank(tier) >= 1;
  return (
    <div>
      <H>Update Schedules</H>
      <P>
        All times are Eastern Time (ET). Scanners run on weekdays only (Mon–Fri).
        Scanner data updates every 15 minutes during market hours.
      </P>

      {isCore && (
        <>
          <H>Scanners</H>
          <Sched time="Every 15 min">
            <strong className="text-slate-200">Main Scanner</strong> — Stocks in Play, Top Movers, Daily Setups. Runs at :05, :20, :35, :50 past the hour, 4 AM – 7 PM ET.
          </Sched>
          <Sched time="Every 15 min">
            <strong className="text-slate-200">Dollar Volume</strong> — Dollar volume scanner. Runs at :07, :22, :37, :52 past the hour, 4 AM – 7 PM ET.
          </Sched>
          {isPro && (
            <>
              <Sched time="Every 15 min">
                <strong className="text-slate-200">Swing Candidates</strong> — Multi-day pullback setups. Runs at :07, :22, :37, :52 past the hour, 4 AM – 7 PM ET.
              </Sched>
              <Sched time="Every 15 min">
                <strong className="text-slate-200">VCP</strong> — Volatility contraction patterns. Runs at :07, :22, :37, :52 past the hour, 4 AM – 7 PM ET.
              </Sched>
              <Sched time="Every 15 min">
                <strong className="text-slate-200">EP9M</strong> — Episodic pivots. Runs at :07, :22, :37, :52 past the hour, 9 AM – 5 PM ET.
              </Sched>
              <Sched time="Every 30 min">
                <strong className="text-slate-200">HRS</strong> — Hidden Relative Strength. Runs at :15 and :45 past the hour, 9 AM – 5 PM ET.
              </Sched>
              <Sched time="4x daily">
                <strong className="text-slate-200">Multibagger</strong> — Fundamental compounder scan. Runs at 8:15 AM, 11:15 AM, 2:15 PM, 5:15 PM ET.
              </Sched>
            </>
          )}

          <H>Analyst Brief</H>
          <Sched time="Every 15 min">
            <strong className="text-slate-200">Data Refresh</strong> — News, macro, breadth, and sector data refresh at :10, :25, :40, :55 past the hour, 4 AM – 7 PM ET.
          </Sched>
          <Sched time="8 PM &amp; 8:30 PM">
            <strong className="text-slate-200">After-Hours</strong> — End-of-day data snapshot for next morning.
          </Sched>
          <P>
            AI-generated analysis (regime, session updates, stock write-ups) is produced by a separate AI session
            and posted on its own schedule. Deterministic data sections merge into the AI brief without overwriting the analysis.
          </P>

          {isPro && (
            <>
              <H>Macro Environment</H>
              <Sched time="Every 15 min">
                <strong className="text-slate-200">Macro Update</strong> — Economic indicators, breadth internals, and macro scorecard data refresh at :10, :25, :40, :55 past the hour, 4 AM – 7 PM ET.
              </Sched>

              <H>Confluence Report</H>
              <Sched time="Every hour">
                <strong className="text-slate-200">Confluence Run</strong> — Multi-timeframe analysis runs every hour from 9:30 AM – 7:30 PM ET on the half-hour.
              </Sched>
            </>
          )}

          <H>Relative Strength</H>
          <Sched time="8 AM daily">
            <strong className="text-slate-200">RS Ranking</strong> — Relative strength ratings recalculated once daily before market open.
          </Sched>
        </>
      )}

      <H>Emails</H>
      {tierRank(tier) === 0 && (
        <>
          <P>
            Your Starter plan includes the Morning Briefing, Midday Update, and Closing Print emails.
          </P>
          <Sched time="8:45 – 9:45 AM">
            <strong className="text-slate-200">Pre-Market</strong> — Morning briefing with overnight analysis and setup.
          </Sched>
          <Sched time="12:45 – 1:45 PM">
            <strong className="text-slate-200">Midday</strong> — Midday session update and top ideas.
          </Sched>
          <Sched time="4:45 – 5:45 PM">
            <strong className="text-slate-200">Closing</strong> — End-of-day wrap with tomorrow&apos;s watchlist.
          </Sched>
        </>
      )}
      {tierRank(tier) >= 1 && (
        <>
          <P>
            Phase-based emails with a retry fan — each phase attempts to send at the start of its window and retries every 15 minutes
            until the session update for that phase is available.
          </P>
          <Sched time="8:45 – 9:45 AM">
            <strong className="text-slate-200">Pre-Market</strong> — Pre-market analysis and overnight setup.
          </Sched>
          <Sched time="10:45 – 11:45 AM">
            <strong className="text-slate-200">Morning</strong> — First-hour recap and developing setups.
          </Sched>
          <Sched time="12:45 – 1:45 PM">
            <strong className="text-slate-200">Midday</strong> — Midday session update and top ideas.
          </Sched>
          <Sched time="2:45 – 3:45 PM">
            <strong className="text-slate-200">Power Hour</strong> — Power hour action and into-close setups.
          </Sched>
          <Sched time="4:45 – 5:45 PM">
            <strong className="text-slate-200">Closing</strong> — End-of-day wrap with tomorrow&apos;s watchlist.
          </Sched>
          <Sched time="Sun 5:30 PM">
            <strong className="text-slate-200">Weekly Summary</strong> — Weekly performance summary.
          </Sched>
        </>
      )}
    </div>
  );
}

export default function HelpModal({ isOpen, onClose, tier = 'pro' }: HelpModalProps) {
  const rank = tierRank(tier);
  const visibleTabs = ALL_TABS.filter(t => rank >= TIER_RANK[t.minTier]);
  const [tab, setTab] = useState<Tab>('overview');

  const safeTab = visibleTabs.some(t => t.key === tab) ? tab : 'overview';

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl max-h-[85vh] mx-4 bg-[#0b101a] border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-slate-100">Help</span>
            <span className="text-[10px] text-slate-500 tracking-wider uppercase">Confluence Trading Tools</span>
            <TierLabel tier={tier} />
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-3 pb-2 border-b border-white/5 shrink-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {visibleTabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold tracking-wider uppercase whitespace-nowrap transition-colors ${
                safeTab === t.key
                  ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-400/30'
                  : 'text-slate-500 hover:text-slate-300 border border-transparent'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5" style={{ scrollbarWidth: 'thin', scrollbarColor: '#334155 transparent' }}>
          {safeTab === 'overview' && <OverviewTab tier={tier} />}
          {safeTab === 'dashboard' && <DashboardTab tier={tier} />}
          {safeTab === 'analyst' && <AnalystTab tier={tier} />}
          {safeTab === 'confluence' && <ConfluenceTab />}
          {safeTab === 'interactions' && <InteractionsTab />}
          {safeTab === 'updates' && <UpdatesTab tier={tier} />}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-white/5 shrink-0">
          <p className="text-[10px] text-slate-600 text-center">
            Press ESC or click outside to close
          </p>
        </div>
      </div>
    </div>
  );
}

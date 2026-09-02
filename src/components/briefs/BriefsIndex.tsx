'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import DashNav from '../DashNav';
import { ThemeToggle } from '../ThemeProvider';

interface BriefSummary {
  date: string;
  headline: string;
  regime: string;
  tickers: string[];
  setupCount: number;
  phases: string[];
}

const REGIME_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  bullish:  { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  'risk-on': { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  bearish:  { text: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/20' },
  'risk-off': { text: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/20' },
  caution:  { text: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  neutral:  { text: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/20' },
};

function regimeStyle(regime: string) {
  const key = regime.toLowerCase();
  for (const [k, v] of Object.entries(REGIME_COLORS)) {
    if (key.includes(k)) return v;
  }
  return REGIME_COLORS.neutral;
}

function extractRegimeLabel(regime: string): string {
  if (regime.length < 30) return regime;
  const r = regime.toLowerCase();
  if (r.includes('risk-on') || r.includes('risk on')) return 'Risk-On';
  if (r.includes('risk-off') || r.includes('risk off')) return 'Risk-Off';
  if (r.includes('bull')) return 'Bullish';
  if (r.includes('bear')) return 'Bearish';
  if (r.includes('caution')) return 'Caution';
  return 'Neutral';
}

function extractSummary(date: string, brief: any): BriefSummary {
  const rd = brief?.regimeDetail || {};
  const regime = extractRegimeLabel(rd.regime || 'Neutral');

  const setupSections = (brief?.sections || []).filter((s: any) =>
    /Stocks in Play|Top Trades/i.test(s.section),
  );
  const setupStocks = setupSections.flatMap((s: any) => s.stocks || []);

  const allStocks = (brief?.sections || []).flatMap((s: any) => s.stocks || []);
  const tickers = allStocks
    .filter((s: any) => s.ticker)
    .slice(0, 5)
    .map((s: any) => s.ticker);

  const summary = brief?.summary || {};
  const conviction = summary.conviction || [];
  const headline = conviction[0]
    ? String(conviction[0]).replace(/\*\*/g, '').slice(0, 120)
    : (brief?.sections?.[0]?.section || 'Market brief');

  const phases = Object.keys(brief?.sessionUpdates || {});

  return {
    date,
    headline,
    regime,
    tickers,
    setupCount: setupStocks.length,
    phases,
  };
}

function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const day = dt.getDate();
  const month = dt.toLocaleDateString('en-US', { month: 'short' });
  const weekday = dt.toLocaleDateString('en-US', { weekday: 'short' });
  return { day, month, weekday };
}

export default function BriefsIndex() {
  const [briefs, setBriefs] = useState<BriefSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const idxRes = await fetch('/api/briefs', { cache: 'no-store' });
        if (!idxRes.ok) throw new Error('Failed to load brief index');
        const { dates } = await idxRes.json();
        if (!dates?.length) {
          setBriefs([]);
          return;
        }

        const results = await Promise.all(
          dates.slice(0, 30).map(async (date: string) => {
            const res = await fetch(`/api/briefs/${date}`, { cache: 'no-store' });
            if (!res.ok) return null;
            const data = await res.json();
            return extractSummary(date, data);
          }),
        );
        setBriefs(results.filter(Boolean) as BriefSummary[]);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="min-h-screen bg-[#05080f] text-slate-300 font-sans md:py-10 flex justify-center">
      <div className="w-full max-w-[1200px] bg-[#0b101a] md:rounded-[2rem] md:border md:border-white/5 overflow-hidden md:shadow-2xl relative pb-20">
        {/* Header */}
        <div className="px-3 md:px-10 pt-6 md:pt-8 pb-4 md:pb-6 border-b border-white/5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <a href="https://confluencetradingtools.com" className="flex items-center gap-3.5 md:gap-5 no-underline" style={{ textDecoration: 'none' }}>
            <img src="/logo.svg" alt="CTT" className="ctt-logo h-9 md:h-10 w-auto drop-shadow-[0_2px_10px_rgba(124,139,250,0.18)]" />
            <div className="leading-none">
              <h1 className="text-xl md:text-[1.75rem] font-extrabold text-slate-50 tracking-[-0.025em] leading-[1.05] antialiased">
                Confluence Trading Tools
              </h1>
              <p className="text-[10px] md:text-[10px] font-semibold text-slate-500 tracking-[0.22em] uppercase mt-1.5">
                Brief Archive
              </p>
            </div>
          </a>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <DashNav />
          </div>
        </div>

        <div className="px-3 md:px-10 py-6">
          {/* Intro */}
          <div className="mb-8">
            <p className="text-[13px] text-slate-400 leading-relaxed max-w-2xl">
              Daily AI-generated market analysis — tape reading, regime context, and actionable setups.
              Briefs are delayed 24 hours. Want tomorrow&apos;s brief before the open?
            </p>
            <a
              href="/subscribe"
              className="inline-block mt-3 text-[12px] font-bold text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              Start free trial →
            </a>
          </div>

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-20 gap-3">
              <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
              <span className="text-slate-500 text-sm">Loading archive...</span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && briefs.length === 0 && (
            <div className="bg-white/[0.02] border border-white/5 rounded-xl p-8 text-center">
              <p className="text-slate-400 text-sm font-medium">No archived briefs yet.</p>
              <p className="text-slate-600 text-xs mt-1.5">
                Briefs are archived at market close and appear here the next day.
              </p>
            </div>
          )}

          {/* Brief cards */}
          {briefs.length > 0 && (
            <div className="space-y-3">
              {briefs.map((b) => {
                const { day, month, weekday } = formatDate(b.date);
                const rs = regimeStyle(b.regime);
                return (
                  <Link
                    key={b.date}
                    href={`/briefs/${b.date}`}
                    className="block group no-underline"
                    style={{ textDecoration: 'none' }}
                  >
                    <div className="flex items-start gap-4 md:gap-6 p-3 md:p-5 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/10 transition-all">
                      {/* Date column */}
                      <div className="min-w-[52px] text-center shrink-0">
                        <div className="text-[22px] font-extrabold text-slate-200 leading-none">{day}</div>
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-0.5">{month}</div>
                        <div className="text-[9px] text-slate-600 uppercase tracking-wider">{weekday}</div>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-bold text-slate-200 group-hover:text-slate-100 transition-colors truncate">
                          {b.headline}
                        </div>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          {/* Regime badge */}
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${rs.text} ${rs.bg} ${rs.border} uppercase tracking-wider`}>
                            {b.regime}
                          </span>
                          {/* Setup count */}
                          {b.setupCount > 0 && (
                            <span className="text-[10px] text-slate-500">
                              {b.setupCount} setup{b.setupCount !== 1 ? 's' : ''}
                            </span>
                          )}
                          {/* Phase count */}
                          {b.phases.length > 0 && (
                            <span className="text-[10px] text-slate-600">
                              {b.phases.length} phase{b.phases.length !== 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                        {/* Ticker pills */}
                        {b.tickers.length > 0 && (
                          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                            {b.tickers.map((t) => (
                              <span
                                key={t}
                                className="text-[10px] font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-1.5 py-0.5 rounded"
                              >
                                ${t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Arrow */}
                      <div className="shrink-0 text-slate-600 group-hover:text-slate-400 transition-colors self-center">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M6 3l5 5-5 5" />
                        </svg>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {/* Bottom CTA */}
          {briefs.length > 0 && (
            <div className="mt-10 border border-indigo-500/20 bg-indigo-500/[0.06] rounded-2xl p-6 md:p-8 text-center">
              <h3 className="text-[15px] font-bold text-slate-200 mb-1">
                Get tomorrow&apos;s brief before the open
              </h3>
              <p className="text-[12px] text-slate-400 mb-4">
                Try the daily brief at 8:30 AM ET — plus tape updates at every session phase. 14 days free.
              </p>
              <a
                href="/subscribe"
                className="inline-block bg-indigo-500 hover:bg-indigo-400 text-white font-bold text-[12px] px-6 py-2.5 rounded-lg transition-colors tracking-wide"
              >
                Start free trial
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

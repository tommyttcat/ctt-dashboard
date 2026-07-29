'use client';

// ---------------------------------------------------------------------------
// Key Events — scheduled catalysts for today and tomorrow
// v1.0
//
// The gap this fills: every other card on the dashboard is REACTIVE. The
// scanner reads published news, the catalyst tagger reads headlines that
// already exist. A 2:00 PM Fed decision generates nothing at 8:30 AM, so a
// session that is entirely on hold waiting for one looks, to the scan, like a
// session with weak breadth and no leadership.
//
// Sources are both existing routes, unchanged:
//   /api/econ      — Benzinga economic calendar (US only, rolling window)
//   /api/earnings  — upcoming earnings with estimates and actuals
//
// Filtered to today + tomorrow. A 14-day calendar is a reference document;
// what matters pre-open is what can move the tape before you are flat.
// ---------------------------------------------------------------------------

import React, { useState, useEffect } from 'react';

interface EconEvent {
  event: string;
  date: string;            // "YYYY-MM-DD HH:MM:SS"
  country: string;
  currency: string;
  actual: number | null;
  previous: number | null;
  estimate: number | null;
  impact: 'High' | 'Medium' | 'Low';
}

interface EarningsEvent {
  symbol: string;
  date: string;            // "YYYY-MM-DD" (no time component)
  name: string;
  epsEstimated?: number | null;
  revenueEstimated?: number | null;
  epsActual?: number | null;
  epsSurprisePct?: number | null;
  importance?: number;
}

const etNow = (): Date =>
  new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));

// YYYY-MM-DD in ET, offset by n days.
const etDayKey = (offsetDays = 0): string => {
  const d = etNow();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Benzinga dates arrive as local ET wall-clock strings with no timezone
// marker. Parsing with `new Date(str)` would apply the BROWSER's timezone —
// wrong for anyone not on Eastern. Parse the components manually instead and
// compare against the ET clock.
const parseEtDateTime = (s: string): { dayKey: string; minutes: number | null } => {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return { dayKey: '', minutes: null };
  const dayKey = `${m[1]}-${m[2]}-${m[3]}`;
  if (m[4] == null) return { dayKey, minutes: null };
  return { dayKey, minutes: parseInt(m[4], 10) * 60 + parseInt(m[5], 10) };
};

const fmtClock = (minutes: number | null): string => {
  if (minutes == null) return '—';
  const h24 = Math.floor(minutes / 60);
  const mm = minutes % 60;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${ampm}`;
};

const fmtNum = (v: number | null | undefined): string => {
  if (v == null) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
};

const impactStyles = (impact: string, released: boolean) => {
  if (released) {
    return { dot: 'bg-slate-600', badge: 'text-slate-500 bg-slate-500/10 border-white/5' };
  }
  switch (impact) {
    case 'High':
      return { dot: 'bg-rose-400', badge: 'text-rose-400 bg-rose-500/10 border-rose-500/20' };
    case 'Medium':
      return { dot: 'bg-amber-400', badge: 'text-amber-400 bg-amber-500/10 border-amber-500/20' };
    default:
      return { dot: 'bg-slate-500', badge: 'text-slate-400 bg-slate-500/10 border-white/10' };
  }
};

export default function KeyEvents() {
  const [econ, setEcon] = useState<EconEvent[]>([]);
  const [earnings, setEarnings] = useState<EarningsEvent[]>([]);
  const [status, setStatus] = useState<'Loading' | 'Synced' | 'Error'>('Loading');
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  // Re-render on a timer so events flip from pending to released as the
  // session progresses, without needing a refetch.
  const [, setTick] = useState(0);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      try {
        const [econRes, earnRes] = await Promise.all([
          fetch('/api/econ', { cache: 'no-store' }).catch(() => null),
          fetch('/api/earnings', { cache: 'no-store' }).catch(() => null),
        ]);

        if (isMounted && econRes?.ok) {
          const d = await econRes.json();
          if (Array.isArray(d)) setEcon(d);
        }
        if (isMounted && earnRes?.ok) {
          const d = await earnRes.json();
          if (Array.isArray(d)) setEarnings(d);
        }
        if (isMounted) setStatus('Synced');
      } catch {
        if (isMounted) setStatus('Error');
      }
    };

    load();
    const dataInterval = setInterval(load, 5 * 60 * 1000);
    const clockInterval = setInterval(() => setTick(t => t + 1), 60 * 1000);
    return () => {
      isMounted = false;
      clearInterval(dataInterval);
      clearInterval(clockInterval);
    };
  }, []);

  const today = etDayKey(0);
  const tomorrow = etDayKey(1);
  const now = etNow();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  // --- Econ: today + tomorrow, drop Low impact (the CFTC/rig-count noise) ---
  const econRows = econ
    .map(e => {
      const { dayKey, minutes } = parseEtDateTime(e.date);
      return { ...e, dayKey, minutes };
    })
    .filter(e => (e.dayKey === today || e.dayKey === tomorrow) && e.impact !== 'Low')
    .sort((a, b) => {
      if (a.dayKey !== b.dayKey) return a.dayKey.localeCompare(b.dayKey);
      return (a.minutes ?? 0) - (b.minutes ?? 0);
    });

  // --- Earnings: today + tomorrow, importance 5 only (the names that move
  // the index, not every small cap reporting).
  const earnRows = earnings
    .filter(e => {
      const { dayKey } = parseEtDateTime(e.date);
      return (dayKey === today || dayKey === tomorrow) && (e.importance ?? 0) >= 5;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));

  const pendingHigh = econRows.filter(
    e => e.impact === 'High' && e.dayKey === today && e.minutes != null && e.minutes > nowMinutes
  );

  const hasAny = econRows.length > 0 || earnRows.length > 0;

  return (
    <div className="bg-[#101623] border border-white/10 rounded-2xl p-6 md:p-8 relative overflow-hidden shadow-2xl w-full">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-500 via-rose-500 to-indigo-500 opacity-40"></div>

      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex justify-between items-start md:items-center relative z-10 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-6 border-b border-white/5 pb-4' : ''}`}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs md:text-sm font-bold border px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 transition-colors text-amber-400 bg-[#161c2a]/40 border-white/5 group-hover:bg-white/[0.02]">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
            KEY EVENTS
          </span>
          {pendingHigh.length > 0 && (
            <span className="text-[10px] font-bold text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2.5 py-1 rounded tracking-wider uppercase flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse"></span>
              {pendingHigh.length} PENDING
            </span>
          )}
        </div>

        <div className="flex items-center border border-white/5 bg-[#161c2a]/40 px-4 py-1.5 rounded-[10px] mt-3 md:mt-0">
          <span className={`text-[10px] font-bold tracking-widest uppercase ${status === 'Loading' ? 'text-amber-500' : status === 'Error' ? 'text-rose-400' : 'text-slate-400'}`}>
            {status === 'Synced' ? 'TODAY & TOMORROW' : status}
          </span>
        </div>
      </div>

      {isExpanded && (
        <>
          {/* Pending high-impact banner — the thing this card exists for. */}
          {pendingHigh.length > 0 && (
            <div className="mb-5 border-l-[3px] border-rose-500 bg-rose-500/[0.05] rounded-r-xl px-4 py-3">
              {pendingHigh.map((e, i) => (
                <div key={i} className="flex items-center gap-2.5 flex-wrap py-0.5">
                  <span className="text-[9px] font-bold tracking-widest uppercase text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded shrink-0">
                    AHEAD
                  </span>
                  <span className="text-[11px] font-bold text-slate-200 tabular-nums shrink-0">
                    {fmtClock(e.minutes)} ET
                  </span>
                  <span className="text-[13px] text-slate-200 font-medium">{e.event}</span>
                </div>
              ))}
              <p className="text-[11px] text-slate-500 font-medium mt-2 leading-snug">
                Setups are on a clock until this prints. Breakouts into a scheduled release carry event risk the scan cannot see.
              </p>
            </div>
          )}

          {!hasAny && status === 'Synced' && (
            <div className="text-center py-8 text-slate-500 text-sm font-medium border border-dashed border-white/10 rounded-xl">
              No scheduled high-impact events today or tomorrow.
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* --- ECONOMIC --- */}
            {econRows.length > 0 && (
              <div>
                <h3 className="text-[9px] font-bold tracking-widest uppercase text-slate-500 mb-3">Economic</h3>
                <div className="flex flex-col gap-1.5">
                  {econRows.map((e, i) => {
                    const released = e.actual != null ||
                      (e.dayKey === today && e.minutes != null && e.minutes <= nowMinutes) ||
                      e.dayKey < today;
                    const st = impactStyles(e.impact, released);
                    return (
                      <div
                        key={i}
                        className={`flex items-start gap-3 px-3.5 py-2.5 rounded-lg border transition-colors ${
                          released
                            ? 'bg-[#161c2a]/30 border-white/5'
                            : 'bg-[#161c2a]/60 border-white/10'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-[7px] ${st.dot}`}></span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-[10px] font-bold tabular-nums shrink-0 ${released ? 'text-slate-600' : 'text-slate-300'}`}>
                              {fmtClock(e.minutes)}
                            </span>
                            {e.dayKey === tomorrow && (
                              <span className="text-[8px] font-bold tracking-widest uppercase text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.5 rounded shrink-0">
                                TMRW
                              </span>
                            )}
                            <span className={`text-[9px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded border shrink-0 ${st.badge}`}>
                              {e.impact}
                            </span>
                          </div>
                          <div className={`text-[13px] font-medium leading-snug mt-1 ${released ? 'text-slate-500' : 'text-slate-200'}`}>
                            {e.event}
                          </div>
                          {(e.actual != null || e.estimate != null || e.previous != null) && (
                            <div className="text-[11px] text-slate-500 font-medium mt-1 tabular-nums">
                              {e.actual != null && (
                                <span className="text-emerald-400">Act {fmtNum(e.actual)}</span>
                              )}
                              {e.actual != null && (e.estimate != null || e.previous != null) && <span> · </span>}
                              {e.estimate != null && <span>Est {fmtNum(e.estimate)}</span>}
                              {e.estimate != null && e.previous != null && <span> · </span>}
                              {e.previous != null && <span>Prev {fmtNum(e.previous)}</span>}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* --- EARNINGS --- */}
            {earnRows.length > 0 && (
              <div>
                <h3 className="text-[9px] font-bold tracking-widest uppercase text-slate-500 mb-3">Mega-Cap Earnings</h3>
                <div className="flex flex-col gap-1.5">
                  {earnRows.map((e, i) => {
                    const { dayKey } = parseEtDateTime(e.date);
                    const reported = e.epsActual != null;
                    const beat = reported && e.epsEstimated != null && (e.epsActual as number) >= e.epsEstimated;
                    return (
                      <div
                        key={i}
                        className={`flex items-start gap-3 px-3.5 py-2.5 rounded-lg border transition-colors ${
                          reported ? 'bg-[#161c2a]/30 border-white/5' : 'bg-[#161c2a]/60 border-white/10'
                        }`}
                      >
                        <span className="text-[11px] font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20 tracking-wider shrink-0 min-w-[52px] text-center">
                          {e.symbol}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-[13px] font-medium leading-snug ${reported ? 'text-slate-500' : 'text-slate-200'}`}>
                              {e.name}
                            </span>
                            {dayKey === tomorrow && (
                              <span className="text-[8px] font-bold tracking-widest uppercase text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.5 rounded shrink-0">
                                TMRW
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] font-medium mt-1 tabular-nums">
                            {reported ? (
                              <>
                                <span className={beat ? 'text-emerald-400' : 'text-rose-400'}>
                                  {beat ? 'Beat' : 'Miss'} {e.epsActual}
                                </span>
                                <span className="text-slate-500"> vs {e.epsEstimated} est</span>
                              </>
                            ) : (
                              <span className="text-slate-500">
                                Est {e.epsEstimated ?? '—'} EPS
                                {e.revenueEstimated ? ` · ${fmtNum(e.revenueEstimated)} rev` : ''}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
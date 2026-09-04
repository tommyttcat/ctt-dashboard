'use client';

import Link from 'next/link';
import DashNav from '../DashNav';
import type { BriefData, UpdateBlock } from '../../lib/briefArchive';
import { ThemeToggle } from '../ThemeProvider';

const PHASE_ORDER = ['pre', 'morning', 'midday', 'power', 'closing'] as const;
const PHASE_LABELS: Record<string, string> = {
  pre: 'Pre-market',
  morning: 'Morning',
  midday: 'Midday',
  power: 'Power hour',
  closing: 'Closing',
};
const PHASE_ACCENTS: Record<string, string> = {
  pre: '#22d3ee',
  morning: '#34d399',
  midday: '#fbbf24',
  power: '#f97316',
  closing: '#818cf8',
};

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

function regimeColor(regime: string): { text: string; bg: string; border: string; dot: string } {
  const r = regime.toLowerCase();
  if (r.includes('bull') || r.includes('risk-on') || r.includes('risk on'))
    return { text: 'text-emerald-400', bg: 'bg-emerald-500/[0.06]', border: 'border-emerald-500/30', dot: 'bg-emerald-400' };
  if (r.includes('bear') || r.includes('risk-off') || r.includes('risk off'))
    return { text: 'text-rose-400', bg: 'bg-rose-500/[0.06]', border: 'border-rose-500/30', dot: 'bg-rose-400' };
  if (r.includes('caution'))
    return { text: 'text-amber-400', bg: 'bg-amber-500/[0.06]', border: 'border-amber-500/30', dot: 'bg-amber-400' };
  return { text: 'text-slate-400', bg: 'bg-slate-500/[0.06]', border: 'border-slate-500/30', dot: 'bg-slate-400' };
}

function richText(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*([^*]+)\*\*|\$([A-Z]{1,5})\b|\b([A-Z]{2,5})\b/g;
  const NOISE = new Set(['THE', 'AND', 'FOR', 'NOT', 'BUT', 'ARE', 'WAS', 'HAS', 'HAD', 'CAN', 'MAY', 'ALL', 'ANY', 'ITS', 'NEW', 'LOW', 'HIGH', 'NOW', 'ETF', 'IPO', 'GDP', 'CPI', 'PCE', 'PPI', 'FOMC', 'FED', 'SEC', 'AM', 'PM', 'EST', 'EDT', 'UTC']);
  let last = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1]) {
      parts.push(<strong key={match.index} className="text-slate-100 font-bold">{match[1]}</strong>);
    } else if (match[2]) {
      parts.push(
        <span key={match.index} className="text-cyan-400 font-bold">${match[2]}</span>,
      );
    } else if (match[3] && !NOISE.has(match[3])) {
      parts.push(
        <span key={match.index} className="text-cyan-400 font-bold">${match[3]}</span>,
      );
    } else {
      parts.push(match[0]);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function SectionCard({
  title,
  accent,
  children,
}: {
  title: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="border-l-[3px] md:border md:border-white/5 md:rounded-2xl p-2 pl-3 md:p-8 relative overflow-hidden md:shadow-xl w-full rounded-xl"
      style={{ backgroundColor: `${accent}0a`, borderLeftColor: accent }}
    >
      <div
        className="hidden md:block absolute right-0 top-0 w-64 h-64 blur-3xl rounded-full -translate-y-1/2 translate-x-1/3 pointer-events-none"
        style={{ backgroundColor: `${accent}0d` }}
      />
      <div className="flex justify-between items-center relative z-10 mb-3 md:mb-6 border-b border-white/5 pb-2 md:pb-4">
        <span
          className="text-[8px] font-bold bg-[#161c2a]/40 border border-white/5 px-2 py-0.5 rounded tracking-widest uppercase flex items-center gap-2"
          style={{ color: accent }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: accent }} />
          {title}
        </span>
      </div>
      <div className="relative z-10 px-1 md:px-0">{children}</div>
    </div>
  );
}

function formatBriefDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

/**
 * Data arrives as a prop from the server page rather than a useEffect fetch.
 * That is what puts the brief text in the server HTML for crawlers, and it
 * drops the second function invocation + KV read that every view used to cost.
 */
export default function BriefDetail({
  date,
  brief,
}: {
  date: string;
  brief: BriefData;
}) {

  const regime = brief?.regimeDetail;
  const regimeLabel = regime ? extractRegimeLabel(regime.regime) : null;
  const rc = regime ? regimeColor(regime.regime) : null;
  const summary = brief?.summary;
  const su = brief?.sessionUpdates || {};

  const macroSection = brief?.sections?.find((s) =>
    /Futures.*Macro|Macro.*Snapshot/i.test(s.section),
  );
  const newsSection = brief?.sections?.find(
    (s) => s.section === 'Key News & Catalysts',
  );
  const sectorSection = brief?.sections?.find(
    (s) => s.section === 'Top Sectors & Money Flow',
  );
  const sipSection = brief?.sections?.find(
    (s) => s.section === 'Stocks in Play Today',
  );
  const gapperSection = brief?.sections?.find((s) =>
    /Gappers|Intraday Movers/i.test(s.section),
  );

  /* This table has Trigger and Target columns, so it wants setups — but it was
     flattening every stock row in the brief, and only Top Trades carries levels.
     The movers and Stocks-in-Play rows share the same schema and rendered as
     rows of em-dashes. Prefer rows that actually have a trigger, and fall back
     to the flat list so briefs without any leveled setup still show something.
     Also what keeps trimmed archives working, since those drop the mover
     grids entirely. */
  const flatStocks = (brief?.sections || []).flatMap((s) => s.stocks || []);
  const levelled = flatStocks.filter((s) => s.trigger != null);
  const allStocks = levelled.length > 0 ? levelled : flatStocks;

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

        <div className="px-3 md:px-10 py-6 space-y-6">
          {/* Back link */}
          <Link
            href="/briefs"
            className="inline-flex items-center gap-1.5 text-[12px] font-bold text-slate-500 hover:text-slate-300 transition-colors no-underline"
            style={{ textDecoration: 'none' }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M10 3l-5 5 5 5" />
            </svg>
            All briefs
          </Link>

          {brief && (
            <>
              {/* Date + regime header */}
              <div>
                <div className="text-[11px] text-slate-500 uppercase tracking-wider font-bold mb-1">
                  {formatBriefDate(date)}
                </div>
                {regime && rc && regimeLabel && (
                  <div className="flex items-center gap-3 mt-2">
                    <span className={`flex items-center gap-2 text-[11px] font-bold px-3 py-1 rounded-lg border ${rc.text} ${rc.bg} ${rc.border} uppercase tracking-wider`}>
                      <span className={`w-2 h-2 rounded-full ${rc.dot}`} />
                      {regimeLabel}
                    </span>
                    {Object.keys(su).length > 0 && (
                      <span className="text-[11px] text-slate-600">
                        {Object.keys(su).length} tape phase{Object.keys(su).length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Regime detail */}
              {regime && (
                <SectionCard title="Market regime" accent="#22d3ee">
                  <div className="space-y-3">
                    {regime.regime && regime.regime.length > 30 && (
                      <div>
                        <div className="text-[12px] font-bold text-slate-500 tracking-wider uppercase mb-1">Assessment</div>
                        <p className="text-[12px] text-slate-200 leading-[1.7]">{richText(regime.regime)}</p>
                      </div>
                    )}
                    {regime.caution && (
                      <div className={regime.regime && regime.regime.length > 30 ? 'pt-3 border-t border-white/[0.06]' : ''}>
                        <div className="text-[12px] font-bold text-slate-500 tracking-wider uppercase mb-1">Risk</div>
                        <p className="text-[12px] text-slate-200 leading-[1.7]">{richText(regime.caution)}</p>
                      </div>
                    )}
                    {regime.posture && (
                      <div className="pt-3 border-t border-white/[0.06]">
                        <div className="text-[12px] font-bold text-slate-500 tracking-wider uppercase mb-1">Structure</div>
                        <p className="text-[12px] text-slate-200 leading-[1.7]">{richText(regime.posture)}</p>
                      </div>
                    )}
                  </div>
                </SectionCard>
              )}

              {/* Macro snapshot */}
              {macroSection && (
                <SectionCard title={macroSection.section} accent="#22d3ee">
                  <p className="text-[12px] text-slate-200 leading-[1.7]">{richText(macroSection.analysis)}</p>
                </SectionCard>
              )}

              {/* News */}
              {newsSection && (
                <SectionCard title="Key news & catalysts" accent="#a78bfa">
                  <p className="text-[12px] text-slate-200 leading-[1.7]">{richText(newsSection.analysis)}</p>
                </SectionCard>
              )}

              {/* Conviction setups */}
              {summary && summary.conviction?.length > 0 && (
                <SectionCard title="Conviction setups" accent="#34d399">
                  <div className="space-y-0">
                    {summary.conviction.map((line, i) => (
                      <div key={i} className={i > 0 ? 'pt-3 mt-3 border-t border-white/[0.06]' : ''}>
                        <p className="text-[12px] text-slate-200 leading-[1.7]">{richText(String(line))}</p>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              )}

              {/* Top setups table */}
              {allStocks.length > 0 && (
                <SectionCard title="Setups" accent="#8b5cf6">
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="text-slate-500 uppercase tracking-wider font-bold border-b border-white/5">
                          <th className="text-left py-2 pr-3">Ticker</th>
                          <th className="text-right py-2 px-2">Price</th>
                          <th className="text-right py-2 px-2">Trigger</th>
                          <th className="text-right py-2 px-2">Target</th>
                          {allStocks.some((s) => s.stage) && <th className="text-left py-2 px-2">Stage</th>}
                          {allStocks.some((s) => s.sector) && <th className="text-left py-2 pl-2">Sector</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {allStocks.slice(0, 20).map((s, i) => (
                          <tr key={i} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                            <td className="py-2 pr-3 font-bold text-cyan-400">${s.ticker}</td>
                            <td className="py-2 px-2 text-right text-slate-300 font-mono">
                              {s.price ? s.price.toFixed(2) : '—'}
                            </td>
                            <td className="py-2 px-2 text-right text-emerald-400 font-mono">
                              {s.trigger ? s.trigger.toFixed(2) : '—'}
                            </td>
                            <td className="py-2 px-2 text-right text-amber-400 font-mono">
                              {s.target ? s.target.toFixed(2) : '—'}
                            </td>
                            {allStocks.some((st) => st.stage) && (
                              <td className="py-2 px-2 text-slate-400">{s.stage || '—'}</td>
                            )}
                            {allStocks.some((st) => st.sector) && (
                              <td className="py-2 pl-2 text-slate-400">{s.sector || '—'}</td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </SectionCard>
              )}

              {/* Sectors */}
              {sectorSection && (
                <SectionCard title="Sectors & money flow" accent="#fbbf24">
                  <p className="text-[12px] text-slate-200 leading-[1.7]">{richText(sectorSection.analysis)}</p>
                </SectionCard>
              )}

              {/* Gappers */}
              {gapperSection && (
                <SectionCard title={gapperSection.section} accent="#34d399">
                  <p className="text-[12px] text-slate-200 leading-[1.7]">{richText(gapperSection.analysis)}</p>
                </SectionCard>
              )}

              {/* Stocks in play */}
              {sipSection && sipSection.analysis && (
                <SectionCard title="Stocks in play" accent="#8b5cf6">
                  <p className="text-[12px] text-slate-200 leading-[1.7]">{richText(sipSection.analysis)}</p>
                </SectionCard>
              )}

              {/* Tape reading */}
              {Object.keys(su).length > 0 && (
                <SectionCard title="Tape reading" accent="#818cf8">
                  <div className="space-y-4">
                    {PHASE_ORDER.filter((p) => su[p]).map((p) => {
                      const block = su[p];
                      const accent = PHASE_ACCENTS[p] || '#818cf8';
                      return (
                        <div key={p} id={`tape-${p}`} className="bg-[#0d1220] border border-white/5 rounded-xl p-3 md:p-5">
                          <div className="flex items-center gap-2 mb-3">
                            <span
                              className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border"
                              style={{ color: accent, borderColor: `${accent}40`, backgroundColor: `${accent}10` }}
                            >
                              {PHASE_LABELS[p] || p}
                            </span>
                            {block.timestamp && (
                              <span className="text-[10px] text-slate-600">
                                {new Date(block.timestamp).toLocaleTimeString('en-US', {
                                  timeZone: 'America/New_York',
                                  hour: 'numeric',
                                  minute: '2-digit',
                                })} ET
                              </span>
                            )}
                          </div>
                          <div className="space-y-2">
                            {(block.paragraphs || []).map((para, i) => (
                              <p key={i} className="text-[12px] text-slate-300 leading-[1.7]">
                                {richText(para)}
                              </p>
                            ))}
                          </div>
                          {block.takeaway && (
                            <div className="mt-3 pt-3 border-t border-white/[0.06]">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mr-2">
                                {block.takeawayLabel || 'Takeaway'}:
                              </span>
                              <span className="text-[12px] text-slate-200">{richText(block.takeaway)}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </SectionCard>
              )}

              {/* Summary */}
              {summary && (
                <SectionCard title="Summary" accent="#34d399">
                  <div className="space-y-4">
                    {summary.watchlist?.length > 0 && (
                      <div>
                        <div className="text-[12px] font-bold text-slate-500 tracking-wider uppercase mb-2">Watchlist</div>
                        <div className="space-y-1">
                          {summary.watchlist.map((line, i) => (
                            <p key={i} className="text-[12px] text-slate-200 leading-[1.7]">{richText(String(line))}</p>
                          ))}
                        </div>
                      </div>
                    )}
                    {summary.traps?.length > 0 && (
                      <div className="pt-3 border-t border-white/[0.06]">
                        <div className="text-[12px] font-bold text-rose-400/80 tracking-wider uppercase mb-2">Traps</div>
                        <div className="space-y-1">
                          {summary.traps.map((line, i) => (
                            <p key={i} className="text-[12px] text-slate-200 leading-[1.7]">{richText(String(line))}</p>
                          ))}
                        </div>
                      </div>
                    )}
                    {(summary.tomorrow ?? []).length > 0 && (
                      <div className="pt-3 border-t border-white/[0.06]">
                        <div className="text-[12px] font-bold text-slate-500 tracking-wider uppercase mb-2">Tomorrow</div>
                        <div className="space-y-1">
                          {(summary.tomorrow ?? []).map((line, i) => (
                            <p key={i} className="text-[12px] text-slate-200 leading-[1.7]">{richText(String(line))}</p>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </SectionCard>
              )}

              {/* CTA */}
              <div className="border border-indigo-500/20 bg-indigo-500/[0.06] rounded-2xl p-6 md:p-8 text-center">
                <h3 className="text-[15px] font-bold text-slate-200 mb-1">
                  This brief is 24 hours old
                </h3>
                <p className="text-[12px] text-slate-400 mb-4">
                  Today&apos;s setups and tape reading are live now for subscribers.
                </p>
                <a
                  href="/subscribe"
                  className="inline-block bg-indigo-500 hover:bg-indigo-400 text-white font-bold text-[12px] px-6 py-2.5 rounded-lg transition-colors tracking-wide"
                >
                  Get today&apos;s brief
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';

import React, { useCallback } from 'react';
import { useWatchlist } from './WatchlistContext';

export function WatchlistToggle() {
  const { tickers, togglePanel } = useWatchlist();
  return (
    <button
      onClick={(e) => { e.stopPropagation(); togglePanel(); }}
      className="relative flex items-center justify-center w-8 h-8 rounded-lg transition-colors hover:bg-white/5"
      title="My Watchlist"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
      {tickers.length > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-indigo-500 text-[9px] font-bold text-white px-1">
          {tickers.length}
        </span>
      )}
    </button>
  );
}

export default function WatchlistPanel({ hideToggle = false }: { hideToggle?: boolean } = {}) {
  const { tickers, loading, remove, clear, panelOpen, togglePanel } = useWatchlist();
  const [copied, setCopied] = React.useState(false);

  const txt = tickers.join('\n');

  const copyToClipboard = useCallback(() => {
    navigator.clipboard.writeText(txt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [txt]);

  const downloadTxt = useCallback(() => {
    const blob = new Blob([txt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'watchlist.txt';
    a.click();
    URL.revokeObjectURL(url);
  }, [txt]);

  return (
    <>
      {!hideToggle && <WatchlistToggle />}

      {panelOpen && (
        <div className="fixed inset-0 z-[9998]" onClick={togglePanel}>
          <div
            className="absolute right-2 top-12 w-72 md:w-80 bg-[#0b101a] border border-white/10 rounded-xl shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <span className="text-sm font-bold text-slate-100">My Watchlist</span>
              <div className="flex items-center gap-1">
                {tickers.length > 0 && (
                  <>
                    <button
                      onClick={copyToClipboard}
                      className="px-2 py-1 rounded text-[10px] font-bold text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors"
                      title="Copy as TXT"
                    >
                      {copied ? 'Copied!' : 'Copy TXT'}
                    </button>
                    <button
                      onClick={downloadTxt}
                      className="px-2 py-1 rounded text-[10px] font-bold text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors"
                      title="Download as TXT"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                    </button>
                  </>
                )}
                <button
                  onClick={togglePanel}
                  className="w-6 h-6 flex items-center justify-center rounded text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="max-h-[400px] overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: '#334155 transparent' }}>
              {loading && (
                <div className="px-4 py-8 text-center text-[11px] text-slate-500">Loading...</div>
              )}
              {!loading && tickers.length === 0 && (
                <div className="px-4 py-8 text-center">
                  <div className="text-[11px] text-slate-500 mb-1">No tickers yet</div>
                  <div className="text-[10px] text-slate-600">Hover a ticker and click + to add</div>
                </div>
              )}
              {!loading && tickers.length > 0 && (
                <div className="px-3 py-2">
                  <div className="flex flex-wrap gap-1.5">
                    {tickers.map(t => (
                      <div key={t} className="group flex items-center gap-0.5 rounded border border-white/10 bg-white/[0.03] pl-2 pr-0.5 py-0.5">
                        <span className="text-[11px] font-bold text-slate-200 tracking-wider">{t}</span>
                        <button
                          onClick={() => remove(t)}
                          className="w-4 h-4 flex items-center justify-center rounded text-slate-600 hover:text-red-400 transition-colors"
                          title="Remove"
                        >
                          <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            {tickers.length > 0 && (
              <div className="px-4 py-2 border-t border-white/5 flex items-center justify-between">
                <span className="text-[10px] text-slate-600">{tickers.length} ticker{tickers.length !== 1 ? 's' : ''}</span>
                <button
                  onClick={clear}
                  className="text-[10px] font-medium text-slate-500 hover:text-red-400 transition-colors"
                >
                  Clear all
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

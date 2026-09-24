'use client';

/* components/QuickStart.tsx — how to read the site, in the time it takes to
 * scroll past it.
 *
 * The site speaks one vocabulary everywhere (buy above X · stop Y, HIT / % /
 * EXT / MISS / OUT, green / yellow / red), and a first-time visitor knows none
 * of it. The help modal explains everything; this explains the five things a
 * row says, and nothing else.
 *
 * The one-line prompt shows until dismissed. The dismissal is a per-viewer convenience, so it
 * lives in localStorage and every access is guarded — a private window or
 * blocked storage just shows the card again. Rendered only after mount so the
 * server HTML and the first client render agree. `inline` is the help modal's
 * copy of the same content, which is always shown and has no dismiss button.
 */

import React, { useEffect, useState } from 'react';

const KEY = 'ctt-quickstart-dismissed-v1';

const Row = ({ label, children }: { label: React.ReactNode; children: React.ReactNode }) => (
  <div className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-3 py-1.5 border-b border-white/[0.04] last:border-0">
    <div className="sm:w-40 shrink-0 text-[11px] font-semibold text-slate-200">{label}</div>
    <div className="text-[11px] text-slate-400 leading-relaxed">{children}</div>
  </div>
);

export function QuickStartBody() {
  return (
    <div>
      <Row label={<><span className="text-emerald-400">Green</span> · <span className="text-amber-400">yellow</span> · <span className="text-rose-400">red</span> rows</>}>
        How setups like this one did in that scan&apos;s 5-year test. Green did best, yellow was middling, red was weak — skip red unless you have your own reason.
      </Row>
      <Row label={<>Buy above 45.66 · Stop 42.16</>}>
        The plan. It becomes a buy only once it trades above the buy level; if it falls below the stop, the idea was wrong.
        On EP9M it reads <span className="text-slate-200">Buy dip</span> — buy on a pullback to the level instead.
      </Row>
      <Row label="Status">
        <span className="text-emerald-400 font-semibold">HIT</span> at the buy level ·{' '}
        <span className="text-slate-200 font-semibold">2.2%</span> not there yet, that far away ·{' '}
        <span className="text-orange-400 font-semibold">EXT</span> too stretched to set a stop, don&apos;t chase ·{' '}
        <span className="text-amber-400 font-semibold">MISS</span> already ran past it, don&apos;t chase ·{' '}
        <span className="text-rose-400 font-semibold">OUT</span> fell below the stop.
      </Row>
      <Row label="CNF score">
        0 to 100: how many things line up at once — volume, strength against the market, a real catalyst, the trend.
        It sorts the list; the colour and the status tell you what to do.
      </Row>
      <Row label="Does it work?">
        The <a href="/track" className="text-indigo-400 hover:text-indigo-300 underline decoration-dotted">Track Record</a> counts
        every pick that reached its buy level — winners, losers, and the ones that never gave an entry. Nothing is removed.
      </Row>
      <p className="text-[11px] text-slate-500 leading-relaxed pt-2">
        Hover (or tap) any number or column name for more. Not investment advice — the levels are each scan&apos;s own, not a recommendation.
      </p>
    </div>
  );
}

/* The prompt, not the guide (24 Sep 2026): the full card sat above the
   Scorecard and pushed the page down for everyone. The guide now lives in the
   ? help (first tab); new visitors get one line that opens it. */
export default function QuickStart({ onOpen }: { onOpen: () => void }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let dismissed = false;
    try { dismissed = localStorage.getItem(KEY) === '1'; } catch { /* storage blocked: show it */ }
    setShow(!dismissed);
  }, []);

  if (!show) return null;

  const dismiss = () => {
    setShow(false);
    try { localStorage.setItem(KEY, '1'); } catch { /* nothing to keep */ }
  };

  return (
    <div className="mx-3 md:mx-0 flex items-center justify-between gap-3 text-[11px]">
      <button onClick={onOpen} className="text-indigo-400 hover:text-indigo-300 text-left">
        New here? How to read this page in 20 seconds →
      </button>
      <button onClick={dismiss} className="text-slate-500 hover:text-slate-300 shrink-0" title="Hide this. The guide stays in the ? help.">✕</button>
    </div>
  );
}

'use client';

/* components/QuickStart.tsx — how to read the site, in the time it takes to
 * scroll past it.
 *
 * A first-time visitor does not know what a row's colour or score means. The
 * help modal explains everything; this explains what a row says, and nothing
 * else. Buy/stop levels and statuses were removed on 9 Oct 2026.
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
      <Row label="CNF score">
        0 to 100: how many things line up at once — volume, strength against the market, a real catalyst, the trend.
        It sorts the list.
      </Row>
      <Row label="No buy or stop levels">
        These are lists of what is moving and why, not recommendations. CTT stopped publishing buy levels and stops on
        9 Oct 2026 because the ones it published lost money live.
      </Row>
      <p className="text-[11px] text-slate-500 leading-relaxed pt-2">
        Hover (or tap) any number or column name for more. Not investment advice.
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

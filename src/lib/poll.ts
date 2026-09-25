/* lib/poll.ts — every client poll on the site goes through here.
 *
 * WHY: the 24 Sep 2026 cost check measured every open tab polling at full
 * rate whether or not anyone was looking — a Dashboard tab ~4 requests and
 * ~33 KB a minute in market hours, a Scanners tab ~12 and ~80 KB, and a tab
 * forgotten overnight still hitting /api/macro every 30 seconds (~2,900
 * requests a night). The CDN keeps that off KV, but each one is still a
 * Vercel edge request and bandwidth, linear in open tabs. The 12 Aug outage
 * was the same shape: a tab left open overnight.
 *
 * What this does instead of setInterval:
 *   - hidden tab  → the timer stops. Nothing is fetched while nobody looks.
 *   - tab shown   → if the data is older than one period, fetch at once, then
 *                   resume. A returning reader never sees staler data than a
 *                   tab that stayed visible.
 *   - `ms` may be a function, re-read before every wait, so a caller can slow
 *     down outside market hours (see pollMs.marketHours).
 *
 * Callers run their own first fetch on mount, as they always did; poll() only
 * owns the repeats. It returns the stop function for the effect's cleanup.
 * scripts/poll.test.mts fails if a raw setInterval creeps back into a
 * component that fetches.
 */

import { isMarketSessionWindow } from '@/lib/marketCalendar';

export function poll(fn: () => void, ms: number | (() => number)): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};

  const period = () => (typeof ms === 'function' ? ms() : ms);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = Date.now();              // the caller's own mount fetch just ran

  const schedule = () => { timer = setTimeout(tick, period()); };
  const tick = () => {
    timer = null;
    if (document.hidden) return;      // paused until the tab is shown again
    last = Date.now();
    fn();
    schedule();
  };
  const onVisibility = () => {
    if (document.hidden) {
      if (timer) { clearTimeout(timer); timer = null; }
      return;
    }
    if (timer) return;
    if (Date.now() - last >= period()) { last = Date.now(); fn(); }
    schedule();
  };

  document.addEventListener('visibilitychange', onVisibility);
  schedule();
  return () => {
    if (timer) clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

export const pollMs = {
  /** `live` inside the 4:00–20:00 ET trading-day window, `idle` outside it —
   *  quotes do not move overnight or at weekends. */
  marketHours: (live: number, idle: number) => () => (isMarketSessionWindow() ? live : idle),
};

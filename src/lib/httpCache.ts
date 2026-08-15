/**
 * CDN cache headers for the read-only API routes.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every /latest route used to ship `no-store, no-cache, must-revalidate` plus
 * `Surrogate-Control: no-store`, so nothing was ever cached anywhere: each poll
 * from each open tab ran the function and hit KV. Cost scaled linearly with
 * users — ~64 KV reads/min per tab, which is what exhausted the Upstash quota
 * on 12 Aug 2026 and what would have made 250 users unaffordable.
 *
 * These payloads are identical for every visitor and only change when a cron
 * /run route writes to KV, so one cached copy at the edge can serve everybody.
 * With these headers, N users cost the same as 1: KV reads become a function of
 * the TTL, not of how many people are on the site.
 *
 * HEADER SEMANTICS (Vercel)
 * -------------------------
 *   Vercel-CDN-Cache-Control  -> Vercel's edge only. Not forwarded to the
 *                                browser or to downstream CDNs.
 *   CDN-Cache-Control         -> any downstream CDN (e.g. if Cloudflare is ever
 *                                put in front). Sent to the browser, harmless.
 *   Cache-Control             -> the browser. Deliberately max-age=0 so a user
 *                                who reloads always revalidates; the edge, not
 *                                the browser, is what absorbs the load.
 *
 * Vercel refuses to cache any response whose Cache-Control carries `no-store`,
 * `no-cache` or `private`, so none of those may come back here. `Pragma` and
 * `Expires` are dropped for the same reason — legacy HTTP/1.0 directives that
 * only served to defeat the cache. `stale-if-error` and `proxy-revalidate` are
 * not supported by Vercel and are intentionally absent.
 *
 * The edge cache is segmented by region, so the true origin rate is roughly
 * (1 / sMaxAge) per active region rather than globally — still flat in users.
 */

/** Query params are part of the CDN cache key, so callers must not cache-bust. */
export type CacheProfile = {
  /** Seconds the edge may serve a response without revalidating. */
  sMaxAge: number;
  /** Seconds past sMaxAge the edge may serve stale while it refreshes behind. */
  swr: number;
};

/**
 * Named profiles keyed to how often the underlying data can actually change.
 * Tuning throughput happens here, not in seventeen route files.
 */
export const CACHE = {
  /** Carries live price/change data — kept tight so ticks stay current. */
  LIVE: { sMaxAge: 20, swr: 120 },
  /** Scan output: rewritten only when a cron /run route completes. */
  SCAN: { sMaxAge: 60, swr: 300 },
  /** Narrative + AI brief: regenerated on a 30-minute cron at best. */
  NARRATIVE: { sMaxAge: 120, swr: 600 },
  /** Calendars and daily aggregates: effectively static within a session. */
  SLOW: { sMaxAge: 600, swr: 3600 },
} as const satisfies Record<string, CacheProfile>;

/**
 * Build the header set for a cacheable GET response.
 *
 * Pass the response through unchanged on error paths — a failed read should not
 * be pinned at the edge for the whole TTL. Vercel already refuses to cache 5xx,
 * but routes that return a 200 with `success: false` must opt out explicitly.
 */
export function cacheHeaders(profile: CacheProfile): Record<string, string> {
  const directive = `public, s-maxage=${profile.sMaxAge}, stale-while-revalidate=${profile.swr}`;
  return {
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'CDN-Cache-Control': directive,
    'Vercel-CDN-Cache-Control': directive,
  };
}

/**
 * Headers for responses that must never be cached — error payloads returned
 * with a 200 status, and any route whose body is user-specific.
 */
export function noCacheHeaders(): Record<string, string> {
  return { 'Cache-Control': 'no-store, max-age=0' };
}

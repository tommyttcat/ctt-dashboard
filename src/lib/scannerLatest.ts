/**
 * Shared, de-duplicated client fetch for /api/scanner/latest.
 *
 * WHY THIS EXISTS
 * ---------------
 * Six components each fetched this route independently on their own 60s
 * interval — MarketDataContext, StocksInPlay, DailySetups, TopMovers,
 * NewsCatalysts and AnalystBrief. The route costs 9 KV reads, so a single
 * dashboard tab was issuing roughly 54 KV reads a minute, ~86,000 a day, and a
 * tab left open overnight exhausted a 500,000/month Upstash quota in five days.
 * That is what took the site down on 12 Aug 2026.
 *
 * The fix is deliberately NOT a refactor of those six components: they each
 * read different slices of the payload (dailySetups, stocksInPlay, topMovers,
 * scanMeta, …) and MarketDataContext reshapes it rather than exposing it raw,
 * so there is no single context to hang them off without rewriting all of them.
 * Instead every caller keeps its own call site and goes through here, which
 * collapses concurrent calls into one request and serves a short cache.
 *
 * Two mechanisms, both needed:
 *   1. In-flight de-duplication — the six near-simultaneous calls on mount (or
 *      on a shared interval tick) share a single network request.
 *   2. A TTL cache — absorbs the staggered polls that land between ticks.
 *
 * The TTL is session-aware because the overnight case is where the quota
 * actually went: outside the 4 AM – 8 PM ET weekday window no scan is running,
 * so the payload is byte-identical every time and re-fetching it every minute
 * buys nothing at all.
 *
 * SECOND LAYER (Aug 2026): the read routes are now edge-cacheable, so the CDN
 * absorbs load *across* users while this module absorbs it *within* a tab. This
 * layer alone could never make the site cheap at 100 users — it is per-tab
 * state, so tab #2 shares nothing with tab #1. See lib/httpCache.
 */

const ACTIVE_TTL_MS = 45_000;   // under the callers' 60s poll, so each tick refetches once
const IDLE_TTL_MS = 600_000;    // 10 min — nothing writes to KV outside the scan window

type CacheEntry = { at: number; data: any };

/* Keyed by path so every KV-backed poller can share the same mechanism.
   scanner/latest was the worst offender (9 KV reads x 6 components), but the
   per-scanner /latest routes each cost 3-4 reads and poll on their own 60s
   timer, which is the rest of the overnight burn. */
const cacheByPath = new Map<string, CacheEntry>();
const inFlightByPath = new Map<string, Promise<any>>();

/** Weekday 4 AM – 8 PM ET: the window in which a scan can actually write. */
function isActiveWindow(): boolean {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const hour = et.getHours();
  return hour >= 4 && hour < 20;
}

function ttlMs(): number {
  return isActiveWindow() ? ACTIVE_TTL_MS : IDLE_TTL_MS;
}

/**
 * Returns the parsed /api/scanner/latest payload. Callers keep their existing
 * `data.success` / field checks — this only changes how the request is made,
 * never the shape of what comes back.
 *
 * A failed request is never cached: the rejection propagates to every caller
 * sharing that in-flight promise, and the next call retries.
 */
/**
 * @param path  URL to fetch. Must NOT carry a per-call cache-buster — see below.
 * @param key   Stable cache key, when the path itself is not stable.
 *
 * NO CACHE-BUSTER. This used to append `?t=${Date.now()}` to every request.
 * Query strings are part of Vercel's CDN cache key, so a unique URL per call
 * guaranteed a MISS every time and sent every poll from every user through to
 * a function invocation and a KV read — which is exactly the cost that does not
 * scale. The read routes now ship s-maxage/stale-while-revalidate headers (see
 * lib/httpCache), so a stable URL lets the edge serve all users from one origin
 * hit. `cache: 'no-store'` stays on the fetch: that governs the *browser* cache
 * only, so a reload still revalidates against the edge rather than replaying a
 * local copy.
 *
 * The in-memory TTL cache below is still worth keeping — it collapses the six
 * components that mount at once into a single request, saving the round trip
 * entirely rather than just the origin work.
 */
export function cachedJson(path: string, key?: string): Promise<any> {
  const now = Date.now();
  const cacheKey = key ?? path;

  const hit = cacheByPath.get(cacheKey);
  if (hit && now - hit.at < ttlMs()) {
    return Promise.resolve(hit.data);
  }
  const pending = inFlightByPath.get(cacheKey);
  if (pending) return pending;

  const req = fetch(path, { cache: 'no-store' })
    .then((res) => {
      if (!res.ok) throw new Error(`${path} ${res.status}`);
      return res.json();
    })
    .then((data) => {
      cacheByPath.set(cacheKey, { at: Date.now(), data });
      return data;
    })
    .finally(() => {
      inFlightByPath.delete(cacheKey);
    });

  inFlightByPath.set(cacheKey, req);
  return req;
}

export function fetchScannerLatest(): Promise<any> {
  return cachedJson('/api/scanner/latest');
}

/** Drop cached entries so the next call refetches — for an explicit user refresh. */
export function invalidateCached(path?: string): void {
  if (path) cacheByPath.delete(path);
  else cacheByPath.clear();
}

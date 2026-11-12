// lib/uw.ts — Unusual Whales REST client (options flow).
//
// Key: UW_API_KEY in the Vercel environment. Plan: API Options Starter —
// 25,000 requests per billing month, 3 requests in flight at once. Every call
// goes through uwGetMany's 3-wide queue so a build never trips the 429.
//
// LICENCE: Unusual Whales retail/API plans are for individual use. Everything
// built on this stays behind the login, owner-only — never in the briefs,
// emails, Substack or social posts.

const BASE = 'https://api.unusualwhales.com';
const MAX_IN_FLIGHT = 3;

export const uwConfigured = (): boolean => !!process.env.UW_API_KEY;

export async function uwGet<T = any>(path: string): Promise<T> {
  const key = process.env.UW_API_KEY;
  if (!key) throw new Error('UW_API_KEY not set');
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const used = Number(res.headers.get('x-uw-daily-req-count'));
  if (Number.isFinite(used) && used > 0) lastDailyCount = { n: used, at: Date.now() };
  if (!res.ok) throw new Error(`flow feed error ${res.status}`);
  return res.json() as Promise<T>;
}

/* The API reports today's request count on every response (x-uw-daily-req-count). Kept per
   server instance so callers can slow down on a busy day; null until a call has been made. */
let lastDailyCount: { n: number; at: number } | null = null;
export const uwDailyCount = (): number | null =>
  lastDailyCount && Date.now() - lastDailyCount.at < 3_600_000 ? lastDailyCount.n : null;

/** Runs the paths at most 3 at a time (the plan's concurrency cap), in order. */
export async function uwGetMany<T = any>(paths: string[]): Promise<(T | null)[]> {
  const out: (T | null)[] = new Array(paths.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < paths.length) {
      const i = next++;
      try { out[i] = await uwGet<T>(paths[i]); } catch { out[i] = null; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_IN_FLIGHT, paths.length) }, worker));
  return out;
}

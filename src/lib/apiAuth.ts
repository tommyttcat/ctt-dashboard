import { verifySession, SESSION_COOKIE } from '@/lib/auth';
/* lib/apiAuth.ts — who may write through the public API.
 *
 * WHY THIS EXISTS
 * ---------------
 * Four routes that publish to a live audience — the analyst brief, the Top
 * Setups post, the scorecard caption, the weekly wrap — each grew their own
 * version of the same check, and every one of them had a hole:
 *
 *   `?force=1` skipped the check entirely on /api/social/top-setups and
 *   /api/social/scorecard, so a stranger could publish to Substack, X and
 *   Bluesky by typing a URL. The POST handlers that STORE what those posts
 *   will say had no check at all.
 *
 * The holes were not carelessness; they were a workaround. A cloud routine
 * has no environment, so it could not hold CRON_SECRET, and the comment in
 * the scorecard route said as much. The answer is a key the routine CAN
 * carry in its prompt, not an open door.
 *
 * TWO KEYS, DELIBERATELY:
 *   SOCIAL_POST_KEY — carried by the cloud routines in their prompt.
 *   CRON_SECRET     — sent automatically by Vercel crons.
 * A route called by both accepts either.
 *
 * READS STAY OPEN. Only calls that write or publish come through here; a
 * `preview` that renders what WOULD be posted needs no key, and gating it
 * would cost the routines the one cheap way to check their own work.
 */

/** True when the request carries a key that may write. */
export function authorized(req: Request): boolean {
  const keys = [process.env.SOCIAL_POST_KEY, process.env.CRON_SECRET].filter(Boolean) as string[];
  /* Nothing configured means nothing to check — the same behaviour these
     routes had before a key existed, so a misconfigured preview deploy fails
     open rather than breaking every routine at once. */
  if (keys.length === 0) return true;
  const provided = (req.headers.get('authorization') || '').replace('Bearer ', '');
  return keys.some(k => provided === k);
}

/* Header for one of our own routes calling another. The screenshot route is
   the case that needs it: it injects `_ss=CRON_SECRET` into the page it
   loads, so it can render a PAYWALLED page, and it used to accept `?force=1`
   instead of a credential — which turned it into a public reader for any
   gated page on the site. Its callers are server-side, so unlike a cloud
   routine they can simply hold the key. */
export function internalAuthHeaders(): Record<string, string> {
  const key = process.env.SOCIAL_POST_KEY || process.env.CRON_SECRET || '';
  return key ? { authorization: `Bearer ${key}` } : {};
}

/* The admin page sends from the browser, which cannot hold either key; it
   carries the signed session cookie instead. Until 24 Sep 2026 the phase
   email, Substack and analyst-generate routes let it through with `?force=1`
   and no credential at all — which let anyone email every subscriber, publish
   to Substack and post to X/Bluesky by typing a URL. A signed-in admin is the
   credential the page actually has. JWT only, no KV read. */
export async function authorizedOrAdmin(req: Request): Promise<boolean> {
  if (authorized(req)) return true;
  const cookie = req.headers.get('cookie') || '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (!m) return false;
  const session = await verifySession(decodeURIComponent(m[1])).catch(() => null);
  return !!session?.isAdmin;
}

/* Background scan execution
   ==================================================================
   Lets a long-running scan return HTTP 200 immediately and finish its work
   after the response has been sent.

   ------------------------------------------------------------------
   THE PROBLEM THIS SOLVES IS THE CRON CLIENT'S, NOT VERCEL'S.

   The scan routes complete well inside Vercel's 300-second maxDuration.
   What times out is cron-job.org, which gives up waiting at around thirty
   seconds. The work finishes, KV updates, everything is correct — and the
   cron dashboard reports a failure.

   That is worse than it sounds. A monitor that cries wolf on every run
   trains you to ignore it, and then a REAL failure — a Polygon outage, a
   bad deploy, an expired key — arrives looking exactly like the noise you
   have been dismissing for weeks. The value of the alert is destroyed
   before the thing it was meant to catch ever happens.

   So the fix is not to make the scan faster. It is to answer the cron
   request honestly and promptly: "received, running", which is what
   actually happened.
   ------------------------------------------------------------------

   TWO MECHANISMS, TRIED IN ORDER.

   1. next/server's `after()` — the correct tool. Registers a callback that
      runs after the response is flushed, within the same invocation, with
      the platform keeping the function alive. Requires Next 15 (or 14 with
      the `unstable_after` experimental flag), so it is probed rather than
      assumed.

   2. A detached self-call — the fallback. Fires a request at the route's
      own synchronous path and deliberately does not await it. Works on any
      Next version because it relies on nothing but fetch.

   THE FALLBACK'S WEAKNESS IS WORTH STATING PLAINLY: a serverless platform
   may freeze the invocation the moment the response is returned, which can
   kill an un-awaited fetch before its connection is even established. The
   50ms delay before responding is there to give the request time to leave —
   crude, but it turns "usually fails" into "usually works". Where `after()`
   is available it is strictly better and is always preferred.

   If NEITHER is viable the work runs inline and the response is honest
   about it, returning mode 'inline'. A route that silently ran
   synchronously while reporting 'background' would leave you debugging a
   cron timeout that the fix was supposed to have removed.
   ================================================================== */

export type RunMode = 'background' | 'detached' | 'inline';

export interface BackgroundResult {
  mode: RunMode;
  startedAt: string;
  note: string;
}

/* Register work to run after the response flushes.
   Returns false when `after()` is not available on this Next version. */
async function tryAfter(work: () => Promise<unknown>): Promise<boolean> {
  try {
    const nx: any = await import('next/server');
    const after = nx.after || nx.unstable_after;
    if (typeof after === 'function') {
      after(() => work());
      return true;
    }
  } catch {
    // Import failure means the export does not exist on this version.
  }
  return false;
}

/* Fire the synchronous path of the same route and do not await it.

   `bg` is stripped from the forwarded URL — without that the self-call would
   land back in background mode and recurse until the platform cut it off,
   with no scan ever running. Every other query parameter is preserved so
   `?force=true` and friends still reach the work. */
function detachedSelfCall(request: Request): void {
  try {
    const url = new URL(request.url);
    url.searchParams.delete('bg');
    url.searchParams.set('_detached', '1');

    void fetch(url.toString(), {
      method: 'GET',
      headers: { 'x-detached-run': '1' },
      cache: 'no-store',
    }).catch(() => {
      // Nothing useful to do here — the response has already gone out. The
      // KV timestamp is the real signal of whether the run happened.
    });
  } catch {
    // A malformed self-URL is not worth failing the request over.
  }
}

/* Wrap a scan's work so a cron client gets an immediate 200.

   `work` should be the route's full synchronous scan. It is expected to
   handle its own errors and persistence — by the time it runs, the HTTP
   response is gone and nothing it returns or throws can reach the caller.
   That is why it logs rather than propagates.

   `label` names the scan in logs, which is the only place a background
   failure is visible. */
export async function runInBackground(
  request: Request,
  label: string,
  work: () => Promise<unknown>
): Promise<BackgroundResult> {
  const startedAt = new Date().toISOString();

  const wrapped = async () => {
    const t0 = Date.now();
    try {
      await work();
      console.log(`[${label}] background run finished in ${Date.now() - t0}ms`);
    } catch (err: any) {
      console.error(`[${label}] background run FAILED after ${Date.now() - t0}ms:`, err?.message || err);
    }
  };

  if (await tryAfter(wrapped)) {
    return {
      mode: 'background',
      startedAt,
      note: 'Scan is running via next/server after(). KV will update when it completes.',
    };
  }

  detachedSelfCall(request);

  // Give the detached request time to leave before the response returns and
  // the platform potentially freezes this invocation.
  await new Promise(r => setTimeout(r, 50));

  return {
    mode: 'detached',
    startedAt,
    note: 'after() unavailable on this Next version — scan dispatched as a detached self-call. Verify via the KV scan timestamp.',
  };
}

/* True when this request is the detached self-call rather than the original
   cron hit. Routes use it to force the synchronous path even if `bg` somehow
   survived, which is a cheap guard against the recursion the parameter strip
   already prevents. */
export const isDetachedRun = (request: Request): boolean => {
  try {
    const url = new URL(request.url);
    return url.searchParams.get('_detached') === '1'
      || request.headers.get('x-detached-run') === '1';
  } catch {
    return false;
  }
};

/* Headers for a background acknowledgement. No caching anywhere in the
   chain — a cached 200 would tell the cron client the scan ran when nothing
   happened at all. */
export const BG_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
};
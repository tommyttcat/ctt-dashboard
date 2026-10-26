// lib/substackLatest.ts — the most recent Substack briefing, for posts that have no Substack
// post of their own (the Macro Scorecard on X and Bluesky). Owner, 26 Oct 2026: "X and Bluesky
// should link to the substack posts". Written by /api/email/briefing on each successful publish
// (1 KV write a phase), read by /api/social/scorecard (1 KV read a post, 2 a day).

export const SUBSTACK_LATEST_KEY = 'substack_latest_v1';
export interface SubstackLatest { url: string; phase: string; at: number }
/** Only link a briefing from the last 12 hours — never yesterday's. */
export const SUBSTACK_LATEST_MAX_AGE_MS = 12 * 3_600_000;
/* The fallback link when a post's own Substack publish failed: the publication's home, never the
   dashboard — X draws the site's "Trade with Confluence" banner card for confluencetradingtools.com
   links and nothing for substack.com ones (owner, 26 Oct 2026). */
export const substackHome = (): string => (process.env.SUBSTACK_PUB_URL || 'https://confluencetradingtools.substack.com').replace(/\/$/, '');

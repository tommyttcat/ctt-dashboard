// lib/modelScores.ts — the model's nightly score percentiles, shared by every card (client).
//
// Fetched once per page load from /api/system/scores (CDN-cached) and held in a
// module-level store, so 12 tables cost one request. lib/scans/edge.ts reads it
// through modelScoreOf(); on the server the store stays empty and every tier
// function behaves exactly as before.

import { useEffect, useState } from 'react';

let scores: Record<string, number> | null = null;
let asOf: string | null = null;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function modelScoreOf(ticker: string | null | undefined): number | undefined {
  return ticker && scores ? scores[ticker] : undefined;
}
export const modelScoresAsOf = () => asOf;
export const allModelScores = () => scores;
export function setModelScores(s: Record<string, number> | null, date: string | null = null) {
  scores = s; asOf = date; listeners.forEach(f => f());
}

/** Load once; re-render the caller when the scores arrive. Returns a version number. */
export function useModelScores(): number {
  const [v, setV] = useState(scores ? 1 : 0);
  useEffect(() => {
    const f = () => setV(x => x + 1);
    listeners.add(f);
    if (!scores && !pending && typeof window !== 'undefined') {
      pending = fetch('/api/system/scores').then(r => (r.ok ? r.json() : null))
        .then(j => { if (j?.scores && Object.keys(j.scores).length) setModelScores(j.scores, j.asOf ?? null); })
        .catch(() => {});
    }
    return () => { listeners.delete(f); };
  }, []);
  return v;
}

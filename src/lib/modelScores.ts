'use client';

// lib/modelScores.ts — load the model's nightly scores once per page (client hook).
// Fetched from /api/system/scores (CDN-cached) into lib/modelScoreStore, so 12 tables
// cost one request; each caller re-renders when they arrive.

import { useEffect, useState } from 'react';
import { allModelScores, onModelScores, setModelScores } from './modelScoreStore';

export { allModelScores, setModelScores } from './modelScoreStore';
let pending: Promise<void> | null = null;

export function useModelScores(): number {
  const [v, setV] = useState(allModelScores() ? 1 : 0);
  useEffect(() => {
    const off = onModelScores(() => setV(x => x + 1));
    if (!allModelScores() && !pending) {
      pending = fetch('/api/system/scores').then(r => (r.ok ? r.json() : null))
        .then(j => { if (j?.scores && Object.keys(j.scores).length) setModelScores(j.scores, j.asOf ?? null); })
        .catch(() => {});
    }
    return off;
  }, []);
  return v;
}

'use client';

// lib/modelScores.ts — load the model's nightly scores once per page (client hook).
// Fetched from /api/system/scores (CDN-cached) into lib/modelScoreStore, so 12 tables
// cost one request; each caller re-renders when they arrive.

import { useEffect, useState } from 'react';
import { allModelScores, onModelScores, setModelScores } from './modelScoreStore';
import { marketIsUp, onMarket, setMarketUp, setEarnings, setGroups, earningsLoaded } from './scans/checklist';

export { allModelScores, setModelScores } from './modelScoreStore';
let pending: Promise<void> | null = null;
let pendingMkt: Promise<void> | null = null;
let pendingEarn: Promise<void> | null = null;

export function useModelScores(): number {
  const [v, setV] = useState(allModelScores() ? 1 : 0);
  useEffect(() => {
    const off = onModelScores(() => setV(x => x + 1));
    /* The swing checklist's market line (QQQ above its 200-day) — /api/exposure/latest,
       187 bytes, CDN-cached 10 min: one request per page however many tables ask. */
    const offM = onMarket(() => setV(x => x + 1));
    if (marketIsUp() == null && !pendingMkt) {
      pendingMkt = fetch('/api/exposure/latest').then(r => (r.ok ? r.json() : null))
        .then(j => { const st = j?.state; if (st && typeof st.qqq === 'number' && typeof st.sma200 === 'number') setMarketUp(st.qqq > st.sma200); })
        .catch(() => {});
    }
    /* Earnings within 3 days, for every card's swing checklist — /api/earnings/upcoming,
       edge-cached 10 min, no KV. */
    if (!earningsLoaded() && !pendingEarn) {
      pendingEarn = fetch('/api/earnings/upcoming').then(r => (r.ok ? r.json() : null))
        .then(j => { if (j?.ok && j.dates) setEarnings(j.dates); })
        .catch(() => {});
    }
    if (!allModelScores() && !pending) {
      pending = fetch('/api/system/scores').then(r => (r.ok ? r.json() : null))
        .then(j => { if (j?.group) setGroups(j.group); if (j?.scores && Object.keys(j.scores).length) setModelScores(j.scores, j.asOf ?? null); })
        .catch(() => {});
    }
    return () => { off(); offM(); };
  }, []);
  return v;
}

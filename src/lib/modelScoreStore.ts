// lib/modelScoreStore.ts — the model's nightly score percentiles (no React; safe on the server).
// Filled in the browser by useModelScores (lib/modelScores); empty on the server, where
// every tier function in lib/scans/edge behaves exactly as before.

let scores: Record<string, number> | null = null;
let asOf: string | null = null;
const listeners = new Set<() => void>();

export function modelScoreOf(ticker: string | null | undefined): number | undefined {
  return ticker && scores ? scores[ticker] : undefined;
}
export const modelScoresAsOf = () => asOf;
export const allModelScores = () => scores;
export function setModelScores(s: Record<string, number> | null, date: string | null = null) {
  scores = s; asOf = date; listeners.forEach(f => f());
}
export function onModelScores(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f); }; }

// lib/netHighsLows.ts — net new 52-week highs minus new lows, the Scorecard chart (13 Oct 2026,
// the owner's ask). Universe: US common stock + ADRs (Polygon reference), close $3+, with at
// least 200 of the prior 252 sessions present. A new high = today's high above every high
// of the prior 252 sessions; a new low = today's low below every prior low. A breadth
// DESCRIPTION, like S2 — our own test found weak breadth preceded better QQQ returns, so it is
// not a stand-aside rule here.

export const NET_HL_KEY = 'net_hl_v1';
export interface NetHLPoint { d: string; h: number; l: number; net: number }
export interface NetHLState { asOf: string; history: NetHLPoint[] }

type Arr = ArrayLike<number>;

/** Highs, lows and net at session t from per-name high / low / close series (oldest first, NaN = no bar). */
export function netHLAt(H: Arr[], L: Arr[], C: Arr[], t: number): { h: number; l: number; net: number } {
  let h = 0, l = 0;
  for (let i = 0; i < C.length; i++) {
    const c = C[i][t], hi = H[i][t], lo = L[i][t];
    if (!(c >= 3) || !(hi > 0) || !(lo > 0) || t < 252) continue;
    let mx = -Infinity, mn = Infinity, seen = 0;
    for (let j = t - 252; j < t; j++) { const a = H[i][j], b = L[i][j]; if (a > 0 && b > 0) { seen++; if (a > mx) mx = a; if (b < mn) mn = b; } }
    if (seen < 200) continue;
    if (hi > mx) h++;
    else if (lo < mn) l++;
  }
  return { h, l, net: h - l };
}

/** Merge points into a stored history: one per date, sorted, last `keep`. */
export function mergeHistory(prev: NetHLPoint[] | undefined, pts: NetHLPoint[], keep = 400): NetHLPoint[] {
  const by = new Map((prev ?? []).map(p => [p.d, p]));
  for (const p of pts) by.set(p.d, p);
  return [...by.values()].sort((a, b) => a.d.localeCompare(b.d)).slice(-keep);
}

/** EMA of a series (first value seeds it). */
export function emaSeries(xs: number[], n: number): number[] {
  const k = 2 / (n + 1); const out: number[] = []; let e = NaN;
  for (const x of xs) { e = Number.isNaN(e) ? x : x * k + e * (1 - k); out.push(e); }
  return out;
}

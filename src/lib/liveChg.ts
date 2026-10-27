// lib/liveChg.ts — the live change overlay (live_chg_map_v1) carries the New York date it was
// built for (27 Oct 2026). Readers skip it on any other day, so Friday's after-hours change no
// longer shows as every card's change all weekend, and a failed run cannot leave an old map in
// force. The date rides in the map itself under a key no ticker can have (tickers are A-Z, 1-5
// letters), so no extra KV command is needed.

export type LiveChgMap = Record<string, [number, number]>;
export const LIVE_CHG_DATE_KEY = '_DATE';

const etYmd = (ms: number = Date.now()): number =>
  Number(new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, ''));

/** Stamp a map with today's New York date (yyyymmdd) and the build time. */
export function stampLiveChg(map: LiveChgMap, nowMs: number = Date.now()): LiveChgMap {
  map[LIVE_CHG_DATE_KEY] = [etYmd(nowMs), nowMs];
  return map;
}

/** The map when it was built today (New York), else null. Unstamped maps (written before the
    stamp existed) count as stale. */
export function todaysLiveChg(map: LiveChgMap | null | undefined, nowMs: number = Date.now()): LiveChgMap | null {
  const d = map?.[LIVE_CHG_DATE_KEY]?.[0];
  return map && d === etYmd(nowMs) ? map : null;
}

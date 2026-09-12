/* lib/summary/insights.ts — the dashboard's prose, built from scan data.
 *
 * Extracted verbatim from MarketSummary on 11 Sep 2026, unchanged. This is
 * every "build…Para" function plus buildLocalInsights, which turns the raw
 * scan payloads into the paragraphs, the watchlist, the setup pool and the
 * lookup maps the component renders — roughly a thousand lines of pure data
 * work that happened to live inside a React file.
 *
 * It must never import from the component: the component imports from here,
 * and a cycle between the two is how a Next build starts failing in a way the
 * error message does not explain. The shared types live here for the same
 * reason — they describe the data this file produces.
 */

import { edgeTier as edgeOf, type EdgeTier } from '@/lib/scans/edge';
import { isTradingDay } from '@/lib/marketCalendar';
import { isEtfSector, industryHeat } from '@/lib/sectors';
import {
  PLAN_MAX_REACH_ADR,
  catalystTagOf,
  catalystTextOf,
  chgOf,
  dVolOf,
  dotOf,
  fmtDollar,
  fmtLeader,
  fmtLevel,
  fmtVolStr,
  hasRealCatalyst,
  livePlanOf,
  num,
  numOrNull,
  pctFrom10,
  pctFrom21,
  posture,
  postureScoreAdj,
  priceOf,
  reachInAdr,
  rtrLabel,
  rvolOf,
  scoreOf,
  setupOf,
  setupRowLabel,
  slope21Of,
  stageOf,
  stdCols,
  tickerOf,
  titleCase,
  twoCol,
  type PostureBucket,
} from './rowFormat';

export interface WatchItem {
  symbol: string;
  score?: number | string;
  grade?: 'A' | 'B';
  reason: string;
  catalyst?: string | null;
  catalystUrl?: string | null;
  newsCausal?: boolean | null;
  posture?: PostureBucket | null;
  dotKind?: 'blue' | 'red' | null;
  chg?: number;
  rvol?: number | null;
  vol?: number;
  dVol?: number;
  stage?: string;
  rsRating?: number | null;
  price?: number | null;
}

export interface TopCatalyst {
  ticker: string;
  headline: string;
  url: string | null;
  brief?: string | null;
}

export interface MacroInsights {
  theme: string;
  marketOverview: string;
  briefing: string;
  watching: WatchItem[];
  tomorrowWatch: WatchItem[];
  gradeMap?: Record<string, 'A' | 'B'>;
  dotMap?: Record<string, 'blue' | 'red'>;
  postureMap?: Record<string, PostureBucket>;
  priceMap?: Record<string, number>;
  rsMap?: Record<string, number>;
  stageMap?: Record<string, string>;
  edgeMap?: Record<string, EdgeTier>;
  avoidSet?: Set<string>;
  topCatalyst?: TopCatalyst | null;
  topCatalysts?: TopCatalyst[];
  setupPool?: any[];
  repeatPivots?: Record<string, { count: number; events: { date: string; price: number; vol: number; rvol: number; score: number }[] }>;
  sectorHeat?: { sector: string; avgChg: number; count: number }[];
  econEvents?: EconEvent[];
  earningsEvents?: EarningsEvent[];
  etfMoversPara?: string;
}

export interface EconEvent {
  event: string;
  date: string;
  country: string;
  currency: string;
  actual: number | null;
  previous: number | null;
  estimate: number | null;
  impact: 'High' | 'Medium' | 'Low';
}

export interface EarningsEvent {
  symbol: string;
  date: string;
  name: string;
  epsEstimated?: number | null;
  revenueEstimated?: number | null;
  epsActual?: number | null;
  epsSurprisePct?: number | null;
  importance?: number;
}

export const getEstDateInfo = () =>
  new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));

/* ---- Key Events — the only forward-looking macro section ----------------
   Every other section is REACTIVE. A 2:00 PM rate decision produces nothing
   at 8:30 AM, so a session frozen ahead of one looks — to every other
   section — like weak breadth with no leadership.

   Econ is TODAY ONLY: what can still move the tape while you hold. Earnings
   run today + tomorrow, because an after-close print is tomorrow's gap and
   you size for it today. */
export const parseEtDateTime = (s: string): { dayKey: string; minutes: number | null } => {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return { dayKey: '', minutes: null };
  const dayKey = `${m[1]}-${m[2]}-${m[3]}`;
  if (m[4] == null) return { dayKey, minutes: null };
  return { dayKey, minutes: parseInt(m[4], 10) * 60 + parseInt(m[5], 10) };
};

export const etDayKey = (offsetDays = 0): string => {
  const d = getEstDateInfo();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const fmtClock = (minutes: number | null): string => {
  if (minutes == null) return '';
  const h24 = Math.floor(minutes / 60);
  const mm = minutes % 60;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${ampm}`;
};

export const fmtEconNum = (v: number | null | undefined): string => {
  if (v == null) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
};

export const buildKeyEventsPara = (econ: EconEvent[], earnings: EarningsEvent[]): string => {
  const today = etDayKey(0);
  const tomorrow = etDayKey(1);
  const now = getEstDateInfo();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const econRows = econ
    .map(e => {
      const { dayKey, minutes } = parseEtDateTime(e.date);
      return { ...e, dayKey, minutes };
    })
    .filter(e => e.dayKey === today && e.impact !== 'Low')
    .sort((a, b) => (a.minutes ?? 0) - (b.minutes ?? 0));

  const earnRows = earnings
    .filter(e => {
      const { dayKey } = parseEtDateTime(e.date);
      return (dayKey === today || dayKey === tomorrow) && (e.importance ?? 0) >= 7;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));

  if (econRows.length === 0 && earnRows.length === 0) return '';

  const isPending = (e: any) => e.minutes != null && e.minutes > nowMinutes && e.actual == null;

  const fmtEcon = (e: any): string => {
    const t = fmtClock(e.minutes);
    const marker = isPending(e) ? '▸' : '∅';
    const bits: string[] = [];
    if (e.actual != null) bits.push(`act ${fmtEconNum(e.actual)}`);
    if (e.estimate != null) bits.push(`est ${fmtEconNum(e.estimate)}`);
    if (e.previous != null) bits.push(`prev ${fmtEconNum(e.previous)}`);
    return `${marker} ${t ? `${t} ` : ''}${e.event}${bits.length ? ` ${bits.join(' ')}` : ''}`;
  };

  const pending = econRows.filter(isPending);
  const released = econRows.filter(e => !isPending(e));

  let econCol = '';
  if (econRows.length) {
    const econLines = [...pending.map(fmtEcon), ...released.map(fmtEcon)];
    econCol = `${pending.length ? `Economic — ${pending.length} still ahead:` : 'Economic — all printed:'}\n${econLines.join('\n')}`;
  } else {
    econCol = 'Economic:\nNothing scheduled today.';
  }

  const fmtEps = (v: number | null | undefined): string => {
    if (v == null) return '—';
    return v.toFixed(2);
  };

  const fmtRev = (v: number | null | undefined): string => {
    if (v == null) return '';
    if (v >= 1e9) return ` · rev ${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return ` · rev ${(v / 1e6).toFixed(0)}M`;
    return '';
  };

  const fmtEarnPending = (e: EarningsEvent): string =>
    `▸ ${e.symbol} — est ${fmtEps(e.epsEstimated)} EPS${fmtRev(e.revenueEstimated)}`;

  const fmtEarnReported = (e: EarningsEvent): string => {
    const beat = e.epsEstimated != null && e.epsActual != null && e.epsActual >= e.epsEstimated;
    const pct = e.epsSurprisePct != null ? ` (${e.epsSurprisePct > 0 ? '+' : ''}${e.epsSurprisePct.toFixed(1)}%)` : '';
    return `${e.symbol} — ${beat ? 'BEAT' : 'MISS'} ${fmtEps(e.epsActual)} vs ${fmtEps(e.epsEstimated)}${pct}${fmtRev(e.revenueEstimated)}`;
  };

  const todayEarn = earnRows.filter(e => parseEtDateTime(e.date).dayKey === today);
  const tmrwEarn = earnRows.filter(e => parseEtDateTime(e.date).dayKey === tomorrow);
  const todayPending = todayEarn.filter(e => e.epsActual == null);
  const todayReported = todayEarn.filter(e => e.epsActual != null);
  const tmrwPending = tmrwEarn.filter(e => e.epsActual == null);

  const todayCol: string[] = [];
  if (todayPending.length) {
    todayCol.push(`Today — ${todayPending.length} pending:`);
    todayCol.push(...todayPending.map(fmtEarnPending));
  }
  if (todayReported.length) {
    todayCol.push(todayPending.length ? 'Reported:' : 'Today — all reported:');
    todayCol.push(...todayReported.map(fmtEarnReported));
  }
  if (!todayCol.length) todayCol.push('Today:\nNo large-cap prints.');

  const tmrwCol: string[] = [];
  if (tmrwPending.length) {
    tmrwCol.push(`Tomorrow — ${tmrwPending.length} pending:`);
    tmrwCol.push(...tmrwPending.map(fmtEarnPending));
  }
  if (!tmrwCol.length) tmrwCol.push('Tomorrow:\nNo large-cap prints.');

  const footer: string[] = [];
  if (pending.filter(e => e.impact === 'High').length) {
    footer.push('Setups are on a clock until this prints — breakouts into a scheduled release carry event risk the scan cannot price.');
  }

  const earnCols = footer.length
    ? `${todayCol.join('\n')}|||${tmrwCol.join('\n')}|||${footer.join('\n')}`
    : `${todayCol.join('\n')}|||${tmrwCol.join('\n')}`;

  return `Key Events: ${econCol}^^^${earnCols}`;
};

export const buildCatalystBrief = (s: any): string => {
  const bits: string[] = [];
  const chg = chgOf(s);
  const rv = rvolOf(s);
  const su = setupOf(s);
  const st = stageOf(s);
  const d21 = pctFrom21(s);
  const cnf = scoreOf(s);
  const dot = dotOf(s);

  bits.push(`${chg >= 0 ? 'Up' : 'Down'} ${Math.abs(chg).toFixed(2)}%${rv != null ? ` on RVOL ${rv < 1 ? rv.toFixed(1) : Math.round(rv)}` : ''}`);
  if (rv != null && rv >= 2) bits.push('heavy participation is validating the headline');
  else if (rv != null && rv >= 1.5) bits.push('volume is confirming');
  else if (rv != null && rv < 1) bits.push('headline pop without volume — fade risk');
  if (dot === 'red') bits.push('RED DOT active — reversal against a long');
  // "Stage" is still emitted so the renderer has an unambiguous token to
  // match on — it strips the word and prints only the coloured number.
  if (su) bits.push(`${su}${st ? ` in Stage ${st}` : ''}`);
  if (d21 != null) bits.push(`${d21 >= 0 ? '+' : ''}${d21.toFixed(1)}% vs the 21 EMA`);
  if (cnf) bits.push(`CNF ${cnf}`);

  // If the name has a live plan, the levels belong in the brief — a catalyst
  // without an entry and an exit is a story, not a trade.
  const p = livePlanOf(s);
  if (p?.trigger != null) {
    bits.push(`TR ${fmtLevel(p.trigger)}`);
    if (p.stop != null) bits.push(`ST ${fmtLevel(p.stop)}`);
    bits.push(`${rtrLabel(s)} to the first level overhead`);
  }
  return bits.join(' · ') + '.';
};

export const buildWatchReason = (s: any): string => {
  const parts: string[] = [];
  const su = setupOf(s);
  const st = stageOf(s);
  const rv = rvolOf(s);
  const dot = dotOf(s);

  let lead = su || 'Momentum move';
  if (st) lead += ` in Stage ${st}`;
  if (rv != null) lead += ` with RVOL ${rv < 1 ? rv.toFixed(1) : Math.round(rv)}`;
  parts.push(lead);

  // Dot leads the qualifiers — a red dot is the single most important thing
  // to know about a name being considered long, and it should not be buried
  // behind volume commentary. The blue dot is already in the setup name, so
  // it is not repeated here.
  if (dot === 'red') {
    const since = numOrNull(s?.dotBarsSince);
    parts.push(`RED DOT${since === 0 ? ' today' : since != null ? ` ${since} bars ago` : ''} — overbought reversal, grade capped`);
  }

  if (rv != null) {
    if (rv >= 2) parts.push('heavy participation confirms the move');
    else if (rv >= 1.5) parts.push('solid volume backing');
    else if (rv < 1) parts.push('price without volume — fade risk');
  }

  const d21 = pctFrom21(s);
  const slope = slope21Of(s);
  const b = posture(s);

  // Posture phrasing comes from the shared bucket, so this sentence can never
  // describe a name differently than the 10/21 section does.
  if (d21 != null && b) {
    if (b === 'first-touch') parts.push(`first touch — +${d21.toFixed(1)}% over the 21, back under the 10`);
    else if (b === 'stacked') parts.push(`stacked +${d21.toFixed(1)}% over a${slope === 'rising' ? ' rising' : slope === 'falling' ? ' declining' : ''} 21 EMA`);
    else if (b === 'pre-cross') parts.push(`pre-cross — ${d21.toFixed(1)}% vs the 21, lines converging`);
    else if (b === 'extended') parts.push(`+${d21.toFixed(1)}% over the 21 — too extended to place a stop`);
    else parts.push(`${d21.toFixed(1)}% under the 21 EMA — structure needs repair first`);
  }

  // The card keeps reach where the Trade Plan row drops it: the row is a
  // ranked list already filtered on reach, but a watch card can hold a name
  // whose trigger is nowhere near, and saying so is the whole point.
  const p = livePlanOf(s);
  if (p?.trigger != null) {
    const reach = reachInAdr(s);
    const reachTxt = reach == null ? '' :
      reach <= 0.05 ? ', live now' :
      reach <= PLAN_MAX_REACH_ADR ? `, ${reach.toFixed(1)}x ADR away` :
      `, ${reach.toFixed(1)}x ADR away — not reachable in a normal session`;
    const stopTxt = p.stop != null ? ` ST ${fmtLevel(p.stop)}` : '';
    parts.push(`TR ${fmtLevel(p.trigger)}${reachTxt},${stopTxt} with ${rtrLabel(s)} of room`);
  } else if (s?.plan?.collapsed === true) {
    parts.push('no long plan — price has collapsed away from its averages');
  } else if (s?.plan?.overextended === true) {
    parts.push('no usable plan — too far past the 21 EMA to size a stop');
  }

  if (s?.stochK != null && !isNaN(Number(s.stochK))) {
    const k = Number(s.stochK);
    if (k <= 25) parts.push(`stoch ${k.toFixed(0)} (oversold reset)`);
  }
  /* 80 rather than the old +10 spread. The previous threshold fired on
     nearly every momentum name, and a qualifier that appears on every row
     conveys nothing. 80 is Minervini's "worth noticing" line, so the mention
     is now information rather than decoration. */
  if (s?.rsRating != null && !isNaN(Number(s.rsRating)) && Number(s.rsRating) >= 80) {
    parts.push(`RS ${Number(s.rsRating).toFixed(0)}`);
  }

  const tt = s?.tradeType ? String(s.tradeType).toLowerCase() : null;
  if (tt?.startsWith('day')) parts.push('classified DAY — intraday only');
  else if (tt?.startsWith('swing')) parts.push('classified SWING — multi-day hold viable');

  return parts.join('; ') + '.';
};

export const ep9mUnprec = (s: any): boolean => s?.unprecedented === true;

/* ---- Blended idea score ----
   CNF is the base. RVOL and a real catalyst add weight so a volume-confirmed
   name with news outranks a quiet high-CNF name.

   The posture term is SYMMETRIC — it used to be a lone +5 for the pullback
   zone with no downside, which is how names under a declining 21 ended up
   topping the watchlist while the section above called them untouchable.

   The dot term mirrors the scanner's own ceiling logic: a live red dot is a
   contradiction on a long idea, not a nuance. */
export const blendedScore = (s: any): number => {
  let v = scoreOf(s);
  const rv = rvolOf(s);
  if (rv != null) {
    if (rv >= 2) v += 12;
    else if (rv >= 1.5) v += 7;
    else if (rv < 1) v -= 6;
  }
  if (hasRealCatalyst(s)) v += 8;
  if (ep9mUnprec(s)) v += 6;
  v += postureScoreAdj(s);

  const dot = dotOf(s);
  const since = numOrNull(s?.dotBarsSince) ?? 0;
  if (dot === 'blue') v += since === 0 ? 8 : 5;
  else if (dot === 'red') v -= since === 0 ? 15 : 9;

  return v;
};

/* ---- 10/21 Thesis ------------------------------------------------------
   Restructured from "at the anchor vs no touch" into SWING/REVERSAL vs DAY,
   ranked by the same blendedScore that drives the watchlist, each row
   carrying its posture tag. */
export const isDayName = (s: any): boolean =>
  String(s?.tradeType || '').toLowerCase().startsWith('day');

export const build1021Para = (pool: any[]): string => {
  const seenTickers = new Set<string>();
  const rows = pool
    .filter(s => {
      if (!s?.ticker || isEtfSector(s.sector)) return false;
      if (seenTickers.has(s.ticker)) return false;
      seenTickers.add(s.ticker);
      return true;
    })
    .map(s => ({
      ticker: s.ticker,
      d21: pctFrom21(s),
      d10: pctFrom10(s),
      bucket: posture(s),
      dot: dotOf(s),
      day: isDayName(s),
      score: blendedScore(s),
      catalystUrl: s.catalystUrl ?? null,
      thesis: s.thesis ?? null,
      catalyst: s.catalyst ?? null,
      newsPublisher: s.newsPublisher ?? null,
      newsAge: s.newsAge ?? null,
      _src: s,
    }))
    .filter(r => r.d21 != null && r.bucket != null);

  if (rows.length < 2) return '';

  const fmtRow = (r: any): string => `${r.ticker} ${stdCols(r._src)}`;

  const byScore = (a: any, b: any) => b.score - a.score;
  const swing = rows.filter(r => !r.day).sort(byScore).slice(0, 6);
  const day = rows.filter(r => r.day).sort(byScore).slice(0, 6);

  const swingCol = swing.length
    ? `Swing / reversal — ${swing.length}:\n${swing.map(fmtRow).join('\n')}`
    : 'Swing / reversal:\nNothing multi-day on the board.';
  const dayCol = day.length
    ? `Day — ${day.length}:\n${day.map(fmtRow).join('\n')}`
    : 'Day:\nNo intraday-only names classified.';

  const footer: string[] = [];

  const anchored = rows.filter(r => r.bucket === 'first-touch');
  const stacked = rows.filter(r => r.bucket === 'stacked');
  const broken = rows.filter(r => r.bucket === 'below-21');
  const reds = rows.filter(r => r.dot === 'red');
  const hasAnyD10 = rows.some(r => r.d10 != null);

  if (anchored.length) {
    footer.push(`${anchored.length} name${anchored.length === 1 ? ' sits' : 's sit'} at a first touch — under the 10, still over the 21. That is where the stop is defined and close.`);
  } else if (!hasAnyD10) {
    footer.push('No 10 EMA distance in the current scan payload — first-touch pullbacks cannot be identified until the scanner runs again.');
  } else if (stacked.length) {
    footer.push(`No first touches. ${stacked.length} name${stacked.length === 1 ? ' is' : 's are'} stacked over the 21 but none has pulled back to the 10 — trend intact, entry not offered.`);
  } else if (broken.length) {
    footer.push(`${broken.length} of ${rows.length} names sit below their 21 EMA. Nothing here is at an anchor — these rank on tape action, not structure.`);
  } else {
    footer.push('No equity in the scan is at a usable anchor.');
  }

  if (reds.length) {
    footer.push(`${reds.length} carrying an active red dot — grade-capped on the long side regardless of tape.`);
  }

  return `10/21 Thesis: ${twoCol(swingCol, dayCol, footer)}`;
};

export const ep9mVs60dOf = (s: any): number | null => numOrNull(s?.volVs60dMax);
export const ep9mSilent = (s: any): boolean => !hasRealCatalyst(s);

export const buildMoversPara = (movers: any): string => {
  const gainers: any[] = Array.isArray(movers?.['Gainers']) ? movers['Gainers'] : [];
  const losers: any[] = Array.isArray(movers?.['Losers']) ? movers['Losers'] : [];
  if (gainers.length === 0 && losers.length === 0) return '';

  const fmtMover = (s: any): string =>
    `${s.ticker} ${stdCols(s)}`;

  /* Ten each way. The scanner already caps Gainers and Losers at 10 apiece
     (api/scanner/run), so this takes everything upstream provides rather than
     the lopsided 4-up / 3-down it used to show. The briefing email slices to
     the same depth — keep the two in step. */
  const topG = gainers.slice().sort((a, b) => chgOf(b) - chgOf(a)).slice(0, 10);
  const topL = losers.slice().sort((a, b) => chgOf(a) - chgOf(b)).slice(0, 10);

  if (topG.length) {
    const confirmed = topG.filter(s => (rvolOf(s) ?? 0) >= 1.5);
    const footer = [
      confirmed.length
        ? `Volume-confirmed: ${confirmed.map(s => s.ticker).join(', ')}.`
        : 'No RVOL over 1.5 — moves are thin, fade candidates.',
    ];
    if (topL.length) {
      return `Top Movers: ${twoCol(
        `Leading the tape:\n${topG.map(fmtMover).join('\n')}`,
        `Heaviest red:\n${topL.map(fmtMover).join('\n')}`,
        footer
      )}`;
    }
    return `Top Movers: Leading the tape:\n${topG.map(fmtMover).join('\n')}\n${footer.join('\n')}`;
  }
  if (topL.length) {
    return `Top Movers: Heaviest red:\n${topL.map(fmtMover).join('\n')}\nWeakness leaders for short setups or names to avoid on the long side.`;
  }
  return '';
};

export const buildEtfMoversPara = (movers: any): string => {
  const gainers: any[] = Array.isArray(movers?.['ETF Gainers']) ? movers['ETF Gainers'] : [];
  const losers: any[] = Array.isArray(movers?.['ETF Losers']) ? movers['ETF Losers'] : [];
  if (gainers.length === 0 && losers.length === 0) return '';

  const fmtMover = (s: any): string =>
    `${s.ticker} ${stdCols(s)}`;

  const topG = gainers.slice().sort((a, b) => chgOf(b) - chgOf(a)).slice(0, 10);
  const topL = losers.slice().sort((a, b) => chgOf(a) - chgOf(b)).slice(0, 10);

  if (topG.length && topL.length) {
    return twoCol(
      `Leading ETFs:\n${topG.map(fmtMover).join('\n')}`,
      `Weakest ETFs:\n${topL.map(fmtMover).join('\n')}`,
    );
  }
  if (topG.length) return `Leading ETFs:\n${topG.map(fmtMover).join('\n')}`;
  if (topL.length) return `Weakest ETFs:\n${topL.map(fmtMover).join('\n')}`;
  return '';
};

/* ---- VCP -----------------------------------------------------------------
   Volatility Contraction Pattern bases, split by whether the entry is still
   available.

   THE SPLIT IS THE POINT, and it is not the same as the scan's own `status`
   field. That reports 'breaking-out' whenever price is above the pivot with
   NO BOUND ON HOW FAR — a name that cleared its pivot three weeks ago and
   ran 18% still reports as breaking out, and on the first live scan five of
   nine names were in that state. A summary listing those alongside genuine
   setups would be half history.

   So the same derivation the VCP table uses is applied here: distance to the
   pivot decides. Within 3% either side is live; further below is still
   building; further above has gone.

   EXTENDED NAMES ARE EXCLUDED ENTIRELY rather than shown in a third column.
   The briefing exists to answer "what can I do", and a base whose entry
   passed cannot be acted on — its only remaining use is as a lesson, and a
   lesson does not belong in a list of candidates. The footer states how many
   were dropped so the omission is visible rather than silent. */
export const VCP_FRESH_PCT = 3;

export const vcpStatusOf = (c: any): 'ready' | 'watch' | 'extended' | null => {
  const p = numOrNull(c?.pctToPivot);
  if (p == null) return null;
  // pctToPivot is (pivot - price) / price: positive means price is BELOW the
  // pivot with that far to travel, negative means it is already through.
  if (p > VCP_FRESH_PCT) return 'watch';
  if (p >= -VCP_FRESH_PCT) return 'ready';
  return 'extended';
};

export const buildVcpPara = (vcp: any[]): string => {
  const rows = (Array.isArray(vcp) ? vcp : []).filter(c => c?.symbol);
  if (rows.length === 0) return '';

  const fmtVcp = (c: any): string => {
    const vcpBits: string[] = [];
    const legs = numOrNull(c?.contractionCount);
    if (legs != null) vcpBits.push(`T${legs.toFixed(0)}`);
    if (c?.trigger != null) vcpBits.push(`TR ${fmtLevel(c.trigger)}`);
    if (c?.stop != null) vcpBits.push(`ST ${fmtLevel(c.stop)}`);
    return `${c.symbol} ${stdCols(c)} ${vcpBits.join(' ')}`;
  };

  const byScore = (a: any, b: any) => num(b?.score) - num(a?.score);

  const ready = rows.filter(c => vcpStatusOf(c) === 'ready').sort(byScore);
  const watch = rows.filter(c => vcpStatusOf(c) === 'watch').sort(byScore);
  const extended = rows.filter(c => vcpStatusOf(c) === 'extended').length;

  const footer: string[] = [];

  if (ready.length === 0 && watch.length === 0) {
    if (extended > 0) {
      return `VCP Thesis: ${extended} base${extended === 1 ? '' : 's'} on the board but every one has already cleared its pivot and run. The patterns were real; the entries have gone.`;
    }
    return '';
  }

  if (ready.length) {
    footer.push(`${ready.length} base${ready.length === 1 ? ' is' : 's are'} within ${VCP_FRESH_PCT}% of the pivot — the trigger is the high of the final contraction and the stop is its low, which is why a VCP carries a tighter stop than an ATR rule would give you.`);
  } else {
    footer.push('Nothing is at a pivot yet. These are bases still contracting — the list to watch, not to trade.');
  }

  if (extended > 0) {
    footer.push(`${extended} more cleared and ran, excluded here.`);
  }

  const strong = rows.filter(c => num(c?.rsRating) >= 90).map(c => c.symbol);
  if (strong.length) {
    footer.push(`${strong.slice(0, 4).join(', ')} rank in the top decile of the market on relative strength.`);
  }

  const readyCol = ready.length
    ? `At the pivot — ${ready.length}:\n${ready.slice(0, 5).map(fmtVcp).join('\n')}`
    : 'At the pivot:\nNothing within reach yet.';
  const watchCol = watch.length
    ? `Still basing — ${watch.length}:\n${watch.slice(0, 5).map(fmtVcp).join('\n')}`
    : 'Still basing:\nNo bases in the building stage.';

  return `VCP Thesis: ${twoCol(readyCol, watchCol, footer)}`;
};

/* ---- EP9M ---------------------------------------------------------------
   Four fields: ticker, change, RVOL, catalyst.

   THE TWO RATIOS ARE GONE. Rows read "0.29x 60d 67.17x float", which are
   volume-vs-60-day-high and float turnover — both real EP9M measures and
   both unreadable without the definition in front of you. What made them
   worse than useless is that the COLUMN ALREADY SAYS IT: a name in the
   Unprecedented column beat its own 60-day record by definition.

   vs-60d still RANKS the Unprecedented column. Ranking without display is
   normal here — reach does the same in Trade Plan. */
export const buildEp9mPara = (ep9m: any[], repeatPivots?: Record<string, { count: number; events: any[] }>): string => {
  const rows = ep9m.filter(s => s?.ticker);
  if (rows.length < 1) return '';

  const fmtEp = (s: any): string => {
    const tag = catalystTagOf(s);
    const rpt = repeatPivots?.[s.ticker]?.count ?? 0;
    const rptTag = rpt >= 2 ? ` EP:${rpt}` : '';
    return `${s.ticker} ${stdCols(s)}${tag ? ` ${tag}` : ''}${rptTag}`;
  };

  const sorted = [...rows].sort((a, b) => {
    const aCat = hasRealCatalyst(a) ? 1 : 0;
    const bCat = hasRealCatalyst(b) ? 1 : 0;
    if (bCat !== aCat) return bCat - aCat;
    return scoreOf(b) - scoreOf(a);
  });
  const half = Math.ceil(sorted.length / 2);
  const left = sorted.slice(0, half);
  const right = sorted.slice(half);

  if (right.length) {
    return `EP9M Thesis: ${twoCol(
      left.map(fmtEp).join('\n'),
      right.map(fmtEp).join('\n'),
    )}`;
  }
  return `EP9M Thesis: ${sorted.map(fmtEp).join('\n')}`;
};

/* ---- 100-Bagger Scorecard ------------------------------------------------
   Compact summary of the multibagger scan. Shows grade-A names first, then
   a count of what passed the must-pass gates. Each row: ticker, score/grade,
   change, RS, and stage — enough to decide whether to scroll down. */
export const buildMultibaggerPara = (mbList: any[]): string => {
  const rows = (Array.isArray(mbList) ? mbList : [])
    .filter((c: any) => c?.ticker)
    .filter((c: any) => c.rs == null || c.rs >= 50);
  if (rows.length === 0) return '';

  const gradeA = rows.filter((c: any) => c.grade === 'A');
  const gradeB = rows.filter((c: any) => c.grade === 'B');

  const fmtMb = (c: any): string => {
    const chg = typeof c.changePct === 'number' ? `${c.changePct >= 0 ? '+' : ''}${c.changePct.toFixed(2)}%` : '—';
    const stg = c.stageShort || '—';
    const rvol = c.rvol != null ? `RVOL ${c.rvol < 1 ? c.rvol.toFixed(1) : Math.round(c.rvol)}` : 'RVOL —';
    const vol = c.vol ? `VOL ${c.vol >= 1e6 ? (c.vol / 1e6).toFixed(1) + 'M' : c.vol >= 1e3 ? Math.round(c.vol / 1e3) + 'K' : c.vol}` : 'VOL —';
    const dvol = c.dvol ? `$${c.dvol >= 1e9 ? (c.dvol / 1e9).toFixed(1) + 'B' : c.dvol >= 1e6 ? Math.round(c.dvol / 1e6) + 'M' : Math.round(c.dvol / 1e3) + 'K'}` : '';
    const rs = c.rs != null ? `RS ${c.rs}` : '';
    return `${c.ticker} ∅ SCR ${c.score} ${chg} ${rvol} ${vol} ${dvol} Stage ${stg} ${rs}`.trim();
  };

  const topRows = [...gradeA, ...gradeB.slice(0, Math.max(0, 8 - gradeA.length))].slice(0, 8);

  const half = Math.ceil(topRows.length / 2);
  const left = topRows.slice(0, half);
  const right = topRows.slice(half);

  if (right.length) {
    return `100-Bagger Thesis: ${gradeA.length}A / ${gradeB.length}B from ${rows.length} names passing Rev ≥10% + ROIC ≥10%.\n${twoCol(
      left.map(fmtMb).join('\n'),
      right.map(fmtMb).join('\n'),
    )}`;
  }
  return `100-Bagger Thesis: ${gradeA.length}A / ${gradeB.length}B from ${rows.length} names passing Rev ≥10% + ROIC ≥10%.\n${topRows.map(fmtMb).join('\n')}`;
};

/* ---- $Vol Summary -------------------------------------------------------
   Top 20 from the DVol screener, two columns of 10, sorted CNF desc with RS
   tiebreak — the same default every table on the site uses. DVol rows carry
   `cnfScore` / `changePct` / `vol` which stdCols reads through scoreOf /
   chgOf / fmtVolStr, so no adapter is needed. */
export const buildDvolPara = (dvolRows: any[]): string => {
  const rows = (Array.isArray(dvolRows) ? dvolRows : [])
    .filter((r: any) => r?.ticker && r.cnfScore != null)
    .slice()
    .sort((a: any, b: any) => num(b.dvol) - num(a.dvol))
    .slice(0, 20);

  if (rows.length === 0) return '';

  const fmtRow = (r: any): string => `${r.ticker} ${stdCols(r)}`;

  const left = rows.slice(0, 10);
  const right = rows.slice(10, 20);

  const totalDvol = rows.reduce((a: number, r: any) => a + (num(r.dvol)), 0);
  const advDvol = rows.filter((r: any) => num(r.changePct) > 0).reduce((a: number, r: any) => a + num(r.dvol), 0);
  const advShare = totalDvol > 0 ? Math.round((advDvol / totalDvol) * 100) : 0;

  const footer: string[] = [
    `${fmtDollar(totalDvol)} across ${rows.length} names, ${advShare}% advancing.`,
  ];

  if (right.length) {
    return `$Vol Summary: ${twoCol(
      left.map(fmtRow).join('\n'),
      right.map(fmtRow).join('\n'),
      footer
    )}`;
  }
  return `$Vol Summary: ${left.map(fmtRow).join('\n')}\n${footer.join('\n')}`;
};

export const buildLocalInsights = (
  scan: any,
  ep9mList: any[] = [],
  econList: EconEvent[] = [],
  earningsList: EarningsEvent[] = [],
  swingList: any[] = [],
  consolList: any[] = [],
  vcpList: any[] = [],
  mbList: any[] = [],
  dvolList: any[] = [],
  repeatPivots: Record<string, { count: number; events: { date: string; price: number; vol: number; rvol: number; score: number }[] }> = {},
): MacroInsights | null => {
  const sips: any[] = Array.isArray(scan?.stocksInPlay) ? scan.stocksInPlay : [];
  const daily: any[] = Array.isArray(scan?.dailySetups) ? scan.dailySetups : [];
  const ep9m: any[] = Array.isArray(ep9mList) ? ep9mList.filter(s => s?.ticker) : [];
  const movers = scan?.topMovers || {};
  if (sips.length === 0 && daily.length === 0 && ep9m.length === 0) return null;

  const pool = [...sips, ...daily, ...ep9m].filter(s => s?.ticker);

  const seen = new Set<string>();
  const ranked = pool
    .slice()
    .sort((a, b) => blendedScore(b) - blendedScore(a))
    .filter(s => {
      if (seen.has(s.ticker)) return false;
      seen.add(s.ticker);
      return true;
    })
    .filter(s => scoreOf(s) >= 50)
    .slice(0, 8);

  const watching: WatchItem[] = ranked
    .filter(s => Math.abs(chgOf(s)) >= 4 && (Number(s?.volume ?? s?.vol) || 0) >= 1e6)
    .map(s => ({
      symbol: s.ticker,
      score: scoreOf(s) || undefined,
      grade: (scoreOf(s) >= 70 ? 'A' : 'B') as 'A' | 'B',
      reason: buildWatchReason(s),
      catalyst: catalystTextOf(s),
      catalystUrl: s?.catalystUrl || null,
      newsCausal: s?.newsCausal ?? null,
      posture: posture(s),
      dotKind: dotOf(s),
      chg: chgOf(s),
      rvol: rvolOf(s),
      vol: Number(s?.volume ?? s?.vol) || 0,
      dVol: dVolOf(s),
      stage: stageOf(s),
      rsRating: s?.rsRating != null ? Number(s.rsRating) : null,
      price: priceOf(s),
    }));

  const withNews = pool
    .filter(hasRealCatalyst)
    .slice()
    .sort((a, b) => scoreOf(b) - scoreOf(a))
    .filter((s, i, arr) => arr.findIndex(x => x.ticker === s.ticker) === i);
  const topCatalyst: TopCatalyst | null = withNews.length
    ? {
        ticker: withNews[0].ticker,
        headline: String(withNews[0].catalyst || withNews[0].thesis).replace(/\.$/, ''),
        url: withNews[0].catalystUrl || null,
        brief: buildCatalystBrief(withNews[0]),
      }
    : null;
  const topCatalysts: TopCatalyst[] = withNews.slice(0, 3).map(s => ({
    ticker: s.ticker,
    headline: String(s.catalyst || s.thesis).replace(/\.$/, ''),
    url: s.catalystUrl || null,
    brief: buildCatalystBrief(s),
  }));

  const stockLists = [
    ...sips, ...daily, ...ep9m,
    ...(movers['Gainers'] || []), ...(movers['Losers'] || []), ...(movers['Mega Caps'] || []),
  ];
  const flowSeen = new Set<string>();
  const flowNames = stockLists.filter(s => {
    if (!s?.ticker || flowSeen.has(s.ticker)) return false;
    flowSeen.add(s.ticker);
    return true;
  });

  // Use the scanner's macro-level theme if available (regime + leadership),
  // otherwise fall back to a stock-focused theme.
  const scannerMacro = scan?.macroInsights;
  const theme = scannerMacro?.theme
    ? titleCase(scannerMacro.theme)
    : (() => {
        const sectorCounts: Record<string, number> = {};
        ranked.forEach(s => {
          const sec = s?.sector && s.sector !== '—' && !isEtfSector(s.sector) ? String(s.sector) : null;
          if (sec) sectorCounts[sec] = (sectorCounts[sec] || 0) + 1;
        });
        const topSectors = Object.entries(sectorCounts).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([sec]) => sec);
        const aCount = ranked.filter(s => scoreOf(s) >= 70).length;
        return titleCase(
          `${topSectors.length ? topSectors.join(' & ') : 'Broad Market'} In Focus — ${aCount > 0 ? `${aCount} A-Grade Setup${aCount > 1 ? 's' : ''}` : 'Momentum Watch'}`
        );
      })();
  const marketOverview = scannerMacro?.briefing ?? '';

  const sipsSorted = sips.slice().sort((a, b) => (rvolOf(b) ?? 0) - (rvolOf(a) ?? 0));
  const leaders = sipsSorted.filter(s => (rvolOf(s) ?? 0) >= 1.5).slice(0, 3);
  const faders = sips.filter(s => { const r = rvolOf(s); return r != null && r < 1 && !leaders.some(l => l.ticker === s.ticker); });
  const leaderTickers = new Set(leaders.map(s => s.ticker));
  const faderTickers = new Set(faders.map((s: any) => s.ticker));
  const newsItems = sips.filter(s => hasRealCatalyst(s) && !leaderTickers.has(s.ticker) && !faderTickers.has(s.ticker)).slice(0, 4);

  const fmtNewsRow = (s: any): string => {
    const tag = catalystTagOf(s);
    return `${s.ticker} ${stdCols(s)}${tag ? ` ${tag}` : ''}`;
  };
  const fmtFaderRow = (s: any): string =>
    `${s.ticker} ${stdCols(s)}`;

  const leadersCol = leaders.length ? `Volume-confirmed:\n${leaders.map(fmtLeader).join('\n')}` : '';
  const newsCol = newsItems.length ? `News-driven:\n${newsItems.map(fmtNewsRow).join('\n')}` : '';
  const fadersCol = faders.length ? `Sub-1.0 RVOL (faders):\n${faders.slice(0, 5).map(fmtFaderRow).join('\n')}` : '';

  const leftCol = leadersCol || newsCol;
  const rightCol = leadersCol ? (fadersCol || newsCol) : fadersCol;

  let sipsPara = '';
  if (leftCol && rightCol && leftCol !== rightCol) {
    const footer = (leadersCol && newsCol && fadersCol) ? [newsCol] : [];
    sipsPara = `SIPs Thesis: ${twoCol(leftCol, rightCol, footer)}`;
  } else if (leftCol || rightCol) {
    sipsPara = `SIPs Thesis: ${leftCol || rightCol}`;
  } else if (sips.length) {
    sipsPara = 'SIPs Thesis: No volume-confirmed leaders yet.';
  }

  const fmtDaily = (s: any): string => {
    const su = setupRowLabel(s);
    const extra: string[] = [];
    if (su) extra.push(su);
    if (dotOf(s) === 'red') extra.push('RED DOT');
    return `${s.ticker} ${stdCols(s)}${extra.length ? ` ${extra.join(' ')}` : ''}`;
  };

  const swingNames = daily.filter(s => !isDayName(s)).sort((a, b) => blendedScore(b) - blendedScore(a)).slice(0, 5);
  const dayNames = daily.filter(isDayName).sort((a, b) => blendedScore(b) - blendedScore(a)).slice(0, 5);

  let dailyPara = '';
  if (swingNames.length || dayNames.length) {
    const swingCol = swingNames.length ? `SWING (multi-day hold):\n${swingNames.map(fmtDaily).join('\n')}` : '';
    const dayCol = dayNames.length ? `DAY (intraday only):\n${dayNames.map(fmtDaily).join('\n')}` : '';
    dailyPara = swingCol && dayCol
      ? `Daily Setups Thesis: ${twoCol(swingCol, dayCol)}`
      : `Daily Setups Thesis: ${swingCol || dayCol}`;
  }

  const fmtSwingRow = (s: any): string => {
    const t = tickerOf(s) || '—';
    return `${t} ${stdCols(s)}`;
  };
  const swingRev = swingList.filter(s => {
    const sn = String(s?.setupName || '').toLowerCase();
    return sn.includes('reversal') || sn.includes('reclaim') || sn.includes('blue dot');
  }).sort((a, b) => blendedScore(b) - blendedScore(a)).slice(0, 5);
  const swingPull = swingList.filter(s => {
    const sn = String(s?.setupName || '').toLowerCase();
    return !sn.includes('reversal') && !sn.includes('reclaim') && !sn.includes('blue dot');
  }).sort((a, b) => blendedScore(b) - blendedScore(a)).slice(0, 5);
  let swingThesisPara = '';
  if (swingRev.length || swingPull.length) {
    const revCol = swingRev.length ? `Reversals — ${swingRev.length}:\n${swingRev.map(fmtSwingRow).join('\n')}` : '';
    const pullCol = swingPull.length ? `Pullbacks — ${swingPull.length}:\n${swingPull.map(fmtSwingRow).join('\n')}` : '';
    swingThesisPara = revCol && pullCol
      ? `Reversal Swing Thesis: ${twoCol(revCol, pullCol)}`
      : `Reversal Swing Thesis: ${revCol || pullCol}`;
  } else if (swingList.length) {
    swingThesisPara = `Reversal Swing Thesis: ${swingList.slice(0, 8).map(fmtSwingRow).join('\n')}`;
  }

  const ema1021Para = build1021Para(pool);

  /* Match the briefing page: heat is computed from the movers pool only
     (Gainers + Losers + Mega Caps), not the full stock universe. */
  const moverPool = (() => {
    const seen = new Set<string>();
    return [...(movers['Gainers'] || []), ...(movers['Losers'] || []), ...(movers['Mega Caps'] || [])]
      .filter(s => { if (!s?.ticker || seen.has(s.ticker)) return false; seen.add(s.ticker); return true; });
  })();
  const heat = industryHeat(moverPool, chgOf);

  /* Sector Performance — the same aggregation Sector Concentration lists, drawn as
     bars instead. Emitted in the "Name +1.2%" shape the briefing page's
     parseSectorItems already reads, so the two surfaces agree on the format
     as well as the numbers. Every group, not just the top four: a bar chart
     with four rows is a list with extra steps. */
  const sectorBarsPara = heat.length >= 2
    ? `Sector Performance: ${heat.map(h => `${h.sector} ${h.avgChg >= 0 ? '+' : ''}${h.avgChg.toFixed(2)}%`).join('\n')}`
    : '';

  const heatPara = 'Sector Concentration: interactive';

  const etfAll = [...(movers['ETF Gainers'] || []), ...(movers['ETF Losers'] || [])];
  const etfSeen = new Set<string>();
  const etfs = etfAll
    .filter(e => {
      if (!e?.ticker || etfSeen.has(e.ticker)) return false;
      etfSeen.add(e.ticker);
      return true;
    })
    .filter(e => dVolOf(e) > 0)
    .sort((a, b) => dVolOf(b) - dVolOf(a));

  let etfPara = '';
  if (etfs.length) {
    const upD = etfs.filter(e => chgOf(e) > 0).reduce((a, e) => a + dVolOf(e), 0);
    const totD = etfs.reduce((a, e) => a + dVolOf(e), 0);
    const upShare = totD > 0 ? Math.round((upD / totD) * 100) : 0;
    const etfRows = etfs.slice(0, 5).map(e => `${e.ticker} ${stdCols(e)}`);
    /* Shaped exactly as the briefing page's FlowTable: one blurb line, then the
       rows. The "Heaviest dollar volume:" heading went with it — a line ending
       in a colon becomes a GROUP HEADING in the section parser, so it was
       costing a full line to label the only table in the card. */
    const etfLines: string[] = [
      `${upShare}% of ETF dollars on the advancing side${
        upShare >= 60 ? ' — chasing strength.' : upShare <= 40 ? ' — favoring defense.' : ' — no clean bet.'
      }`,
      etfRows.join('\n'),
    ];
    etfPara = `ETF Flow: ${etfLines.join('\n')}`;
  }

  let moneyPara = '';
  const totalD = moverPool.reduce((a, s) => a + dVolOf(s), 0);
  if (totalD > 0) {
    const advD = moverPool.filter(s => chgOf(s) > 0).reduce((a, s) => a + dVolOf(s), 0);
    const advShare = Math.round((advD / totalD) * 100);
    const magnets = moverPool
      .slice()
      .sort((a, b) => dVolOf(b) - dVolOf(a))
      .slice(0, 5)
      .map(s => `${s.ticker} ${stdCols(s)}`);


    const moneyLines: string[] = [
      `${fmtDollar(totalD)} tracked, ${advShare}% advancing` +
      (advShare >= 60 ? ' — buyers paying up.' : advShare <= 40 ? ' — sellers control.' : ' — two-sided fight.'),
    ];
    /* Same shape as ETF Flow and as the briefing page: blurb, then rows. The
       "Dollar magnets:" heading and the trailing inflows sentence are gone —
       neither appears on the brief page, and the sector concentration they
       reported is what Sector Concentration is for. */
    if (magnets.length) moneyLines.push(magnets.join('\n'));
    moneyPara = `Money Flow: ${moneyLines.join('\n')}`;
  }

  const keyEventsPara = buildKeyEventsPara(econList, earningsList);
  const moversPara = buildMoversPara(movers);
  const etfMoversPara = buildEtfMoversPara(movers);
  const vcpPara = buildVcpPara(vcpList);
  const ep9mPara = buildEp9mPara(ep9m, repeatPivots);
  /* No client-side overlay: /api/multibagger/latest, /api/swing-candidates/latest
     and /api/consolidation/latest all apply liveChgMap server-side now, so these
     rows already carry live changePct/price. That is what let scanner/latest stop
     shipping the 235 KB map to every browser. */
  const mbPara = buildMultibaggerPara(mbList);
  const dvolPara = buildDvolPara(dvolList);

  /* Setup pool: every name from every scan, tagged with source and deduped
     by ticker (first occurrence wins — the order favours higher-signal scans).
     The SetupSummary component renders them with interactive filter pills. */
  const setupSeen = new Set<string>();
  const tagAndDedup = (list: any[], source: string) =>
    list.filter(s => {
      const t = s?.ticker ?? s?.symbol;
      if (!t || setupSeen.has(t)) return false;
      setupSeen.add(t);
      return true;
    }).map(s => ({ ...s, ticker: s.ticker ?? s.symbol, _source: source }));

  const setupPool = [
    ...tagAndDedup(sips, 'sip'),
    ...tagAndDedup(daily, 'daily'),
    ...tagAndDedup(ep9m, 'ep9m'),
    ...tagAndDedup(swingList, 'swing'),
    ...tagAndDedup(vcpList, 'vcp'),
    ...tagAndDedup(mbList, 'mb'),
  ];
  const setupsPara = setupPool.length > 0 ? 'Setups Summary: interactive' : '';

  const allScannerLists: [string, any[]][] = [
    ['daily', daily], ['sip', sips], ['dvol', dvolList],
    ['swing', swingList], ['coil', consolList], ['vcp', vcpList],
    ['hrs', []],  ['ep9m', ep9m], ['multi', mbList],
  ];
  const cnfTickerMap = new Map<string, Set<string>>();
  for (const [src, list] of allScannerLists) {
    for (const row of list) {
      const t = (row?.ticker ?? row?.symbol ?? '').toUpperCase();
      if (!t) continue;
      let s = cnfTickerMap.get(t);
      if (!s) { s = new Set(); cnfTickerMap.set(t, s); }
      s.add(src);
    }
  }
  const streakCounts: Record<string, number> = scan?.scanStreaks ?? {};
  const mbFundLookup = new Map<string, { score: number; grade: string; attrs: any }>();
  for (const m of mbList) {
    const mt = (m.ticker ?? m.symbol ?? '').toUpperCase();
    if (mt && m.attrs) mbFundLookup.set(mt, { score: m.score, grade: m.grade, attrs: m.attrs });
  }
  for (const item of setupPool) {
    const t = (item.ticker ?? '').toUpperCase();
    const src = cnfTickerMap.get(t);
    if (src && src.size >= 2) {
      item._cnfOverlap = src.size;
      item._cnfSources = Array.from(src);
    }
    item._scanStreak = streakCounts[t] || item.scanStreak || 0;
    const rpt = repeatPivots[t];
    if (rpt && rpt.count >= 2) item._repeatPivot = rpt;
    const mbf = item._fund ?? mbFundLookup.get(t);
    if (mbf) item._mbFund = mbf;
  }

  const sipsFinal = sipsPara || (sips.length === 0 && (daily.length || ep9m.length) ? 'SIPs Thesis: No stocks in play in the current scan.' : '');
  const ep9mFinal = ep9mPara || (ep9m.length === 0 && (sips.length || daily.length) ? 'EP9M Thesis: No names trading abnormal 9M+ size yet — this fills in as session volume builds.' : '');
  const mbFinal = mbPara || '100-Bagger Thesis: No candidates — awaiting scan.';

  const orderedParas = [
    setupsPara, moversPara, sipsFinal, dvolPara,
    dailyPara, swingThesisPara,
    ema1021Para, vcpPara, ep9mFinal, mbFinal,
    sectorBarsPara, heatPara, etfPara, moneyPara, keyEventsPara,
  ];

  // Tomorrow's watchlist: swing candidates, consolidation patterns, and
  // names with plans setting up that haven't triggered yet.
  const tmrwSeen = new Set<string>();
  const tmrwPool = [
    ...(Array.isArray(swingList) ? swingList : []),
    ...(Array.isArray(consolList) ? consolList : []),
  ]
    .map(s => ({ ...s, ticker: tickerOf(s) }))
    .filter(s => s.ticker && scoreOf(s) >= 50)
    .sort((a, b) => blendedScore(b) - blendedScore(a))
    .filter(s => {
      if (tmrwSeen.has(s.ticker)) return false;
      if (seen.has(s.ticker)) return false;
      tmrwSeen.add(s.ticker);
      return true;
    })
    .slice(0, 6);

  const tomorrowWatch: WatchItem[] = tmrwPool
    .filter(s => (Number(s?.volume ?? s?.vol) || 0) >= 1e6)
    .map(s => ({
    symbol: s.ticker,
    score: scoreOf(s) || undefined,
    grade: (scoreOf(s) >= 70 ? 'A' : 'B') as 'A' | 'B',
    reason: buildWatchReason(s),
    catalyst: catalystTextOf(s),
    catalystUrl: s?.catalystUrl || null,
    newsCausal: s?.newsCausal ?? null,
    posture: posture(s),
    dotKind: dotOf(s),
    chg: chgOf(s),
    rvol: rvolOf(s),
    vol: Number(s?.volume ?? s?.vol) || 0,
    dVol: dVolOf(s),
    stage: stageOf(s),
    rsRating: s?.rsRating != null ? Number(s.rsRating) : null,
    price: priceOf(s),
  }));

  const gradeMap: Record<string, 'A' | 'B'> = {};
  const dotMap: Record<string, 'blue' | 'red'> = {};
  const postureMap: Record<string, PostureBucket> = {};
  const priceMap: Record<string, number> = {};
  const rsMap: Record<string, number> = {};
  const stageMap: Record<string, string> = {};
  const edgeMap: Record<string, EdgeTier> = {};
  for (const s of pool) {
    const t = s?.ticker;
    if (!t || gradeMap[t]) continue;
    const sc = scoreOf(s);
    if (sc >= 70) gradeMap[t] = 'A';
    else if (sc >= 50) gradeMap[t] = 'B';
    const d = dotOf(s);
    if (d) dotMap[t] = d;
    const p = posture(s);
    if (p) postureMap[t] = p;
    const prc = priceOf(s);
    if (prc != null) priceMap[t] = prc;
    const rs = s?.rsRating != null ? Number(s.rsRating) : null;
    if (rs != null && isFinite(rs) && !rsMap[t]) rsMap[t] = rs;
    const st = stageOf(s);
    if (st && st !== '—' && !stageMap[t]) stageMap[t] = st;
    const edge = edgeOf(s);
    if (edge && !edgeMap[t]) edgeMap[t] = edge;
  }
  for (const arr of [...Object.values(movers), swingList, consolList, vcpList, mbList, dvolList]) {
    if (!Array.isArray(arr)) continue;
    for (const s of arr) {
      const t = s?.ticker || s?.symbol;
      if (!t) continue;
      if (!priceMap[t]) { const prc = priceOf(s); if (prc != null) priceMap[t] = prc; }
      if (!rsMap[t]) { const rs = s?.rsRating != null ? Number(s.rsRating) : null; if (rs != null && isFinite(rs)) rsMap[t] = rs; }
      if (!stageMap[t]) { const st = stageOf(s); if (st && st !== '—') stageMap[t] = st; }
      if (!edgeMap[t]) { const edge = edgeOf(s); if (edge) edgeMap[t] = edge; }
    }
  }

  return {
    theme,
    marketOverview,
    briefing: orderedParas.filter(Boolean).join('\n\n'),
    watching,
    tomorrowWatch,
    gradeMap,
    dotMap,
    postureMap,
    priceMap,
    rsMap,
    stageMap,
    edgeMap,
    topCatalyst,
    topCatalysts,
    setupPool,
    repeatPivots,
    sectorHeat: heat,
    econEvents: econList,
    earningsEvents: earningsList,
    etfMoversPara,
  };
};

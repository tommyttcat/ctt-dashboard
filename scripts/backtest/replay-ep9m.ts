// scripts/backtest/replay-ep9m.ts — EP9M historical replay, v1 (bars-only).
//
// Replays every cached session through the SAME functions the live route runs
// (lib/scans/ep9m: universe gate, abnormality shortlist, score, EP type) and
// writes the registry the live scan would have produced, one row per flagged
// name per day, plus the features every later slice needs.
//
// Run from trade-dash:  npx tsx scripts/backtest/replay-ep9m.ts
// Reads  CTT/backtest-data/grouped/{adj,unadj}  and  reference/tickers.json.gz
// Writes CTT/backtest-data/replay/ep9m_v1_*.jsonl + meta.json
//
// Local only: no network, no KV, no Vercel.
//
// ---------------------------------------------------------------------------
// FIDELITY NOTES — where this matches the live route exactly, and where not.
//
// Exact (shared code or mirrored arithmetic):
//   - Universe gate (symbol shape, ETF list, $2–$2000, 9M shares) on the
//     session's AS-TRADED close and volume — unadjusted, so a later reverse
//     split cannot shrink history below the 9M floor.
//   - Volume profile = the 60 market sessions before the scan date, EXCLUDING
//     the scan date. The live getVolumeProfile walks calendar days 90→1, so
//     today is never in it; shortlistAbnormal then drops the last bar, which
//     is therefore YESTERDAY, not a partial today. Replicated as-is.
//   - RVOL / $-volume / 60d max are ratios or split-invariant products, so
//     they are computed on split-adjusted bars exactly as live does.
//   - Change gate (changePct < 0 dropped) applied AFTER scoring; dropped names
//     are kept here as a shadow set flagged gatedByChange.
//   - Registry: best score per ticker/day, 90 calendar days, repeat triggers
//     counted from it; days-ago in calendar days, as live.
//   - Indicators via the same lib calls with the same parameters as the route.
//
// v2 (`npx tsx scripts/backtest/replay-ep9m.ts v2`, after download-lookups.mjs)
// closes the three biggest v1 gaps with point-in-time data for every
// shortlisted name — scored through the same shareMetrics / catalystTierOf /
// pickBestNews the live route uses:
//   - float + market cap + type from /v3/reference/tickers/{t}?date=D
//   - short interest: latest settlement at least SI_LAG_DAYS before D (FINRA
//     publishes ~7 business days after settlement, so anything newer was not
//     yet public). NOTE the live routes currently read the OLDEST record —
//     a bug, flagged separately; v2 scores the intended behaviour.
//   - news: Polygon /v2/reference/news as of D 21:00 UTC (after the close),
//     judged by pickBestNews with that clock. The live Benzinga index has no
//     history, so v2 news is the Polygon feed only.
//   Float turnover and days-to-cover use AS-TRADED volume, because share
//   counts are as of D while the adjusted bars are scaled for later splits.
//
// Approximations in v1 (each one a named v2 item, not a silent gap):
//   - EOD only. Live scans every 15 min and keeps the best intraday score;
//     this equals the post-close scan. Entry is assumed next session.
//   - No float, short interest or news: floatTurnover, daysToCover and
//     catalystTier score 0 / 'none'. Max reachable v1 score is ~73 + repeat.
//   - Common-stock check uses Polygon's reference list (latest known type,
//     delisted included) rather than point-in-time ticker details.
//   - RS rating rebuilt per session from yesterday's close with session-exact
//     anchors (live uses calendar-day approximations of 63/126/189/252).
//   - EP type sees company name only — no sector, fundamentals or news tag.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';

import { APP, DATA, readDay, loadAdjusted } from './cache';

import { EP9M } from '@/lib/scanConfig';
import {
  shortlistAbnormal, scoreEp9m, classifyEpType, priorSwingHighOf,
  closeStrengthOf, passesUniverseGate, shareMetrics, catalystTierOf,
  type LiteBar, type SnapInfo, type CatalystTier,
} from '@/lib/scans/ep9m';
import { computeRMV } from '@/lib/indicators/rmv';
import { computeRMEDetail } from '@/lib/indicators/rme';
import { computeStage } from '@/lib/indicators/stage';
import { computeMoneyFlow, moneyFlowTrend } from '@/lib/indicators/moneyflow';
import { computeTradePlan } from '@/lib/indicators/tradeplan';
import { choppiness, CHOP_PERIOD_DEFAULT } from '@/lib/indicators/chop';
import { sma, ema, atr, adrPct, stochK } from '@/lib/indicators/marketMath';
import { rawRsScore, percentileRank } from '@/lib/indicators/vcp';
import { pickBestNews, type PolygonNewsRaw, type NewsItem } from '@/lib/indicators/news';
import { cleanSectorDescription } from '@/lib/sectors';

const VERSION = process.argv[2] === 'v2' ? 'v2' : 'v1';
const SI_LAG_DAYS = 11;
const NEWS_CLOCK_UTC = 'T21:00:00Z';

const OUT = path.join(DATA, 'replay');
const LOOKUPS = path.join(DATA, 'lookups');

/* ── v2 point-in-time lookups ───────────────────────────────────────────── */

interface Details { type?: string | null; market_cap?: number | null; share_class_shares_outstanding?: number | null; name?: string | null; sic_description?: string | null }
interface DayLookups { [ticker: string]: { details?: Details | null; news?: PolygonNewsRaw[] } }

function readDayLookups(date: string): DayLookups | null {
  const f = path.join(LOOKUPS, 'bydate', date.slice(0, 4), `${date}.json.gz`);
  return fs.existsSync(f) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString()) : null;
}

const shortCache = new Map<string, [string, number][]>();
function shortInterestAsOf(sym: string, date: string): number | null {
  let rows = shortCache.get(sym);
  if (!rows) {
    const f = path.join(LOOKUPS, 'shorts', `${sym}.json.gz`);
    rows = fs.existsSync(f) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString()) : [];
    shortCache.set(sym, rows!);
  }
  const cutoff = new Date(Date.parse(`${date}T00:00:00Z`) - SI_LAG_DAYS * 86_400_000).toISOString().slice(0, 10);
  let best: number | null = null;
  for (const [settled, si] of rows!) { if (settled <= cutoff) best = si; else break; }
  return best;
}

const DAY_MS = 86_400_000;
const PROFILE_SESSIONS = EP9M.volProfileDays;   // 60, as live
const BARS_LOOKBACK_DAYS = 450;                 // live: aggs from dateStr(450)
const REGISTRY_DAYS = EP9M.registryDays;        // 90

// Mirrors RANK_MIN_* and EXCLUDED in app/api/rs/run (11 Sep 2026). Only feeds
// the RS slice, never the score or a gate.
const RS_MIN_PRICE = 5;
const RS_MIN_VOLUME = 100_000;
const RS_EXCLUDED = new Set([
  'SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'VTI', 'EEM', 'EFA', 'XLF', 'XLE', 'XLK',
  'XLI', 'XLV', 'XLU', 'XLP', 'XLY', 'XLB', 'XLRE', 'XLC', 'SMH', 'SOXX',
  'TQQQ', 'SQQQ', 'QLD', 'QID', 'SOXL', 'SOXS', 'TECL', 'TECS', 'SPXL', 'SPXS',
  'SPXU', 'UPRO', 'SDS', 'SSO', 'TNA', 'TZA', 'FAS', 'FAZ', 'LABU', 'LABD',
  'UVXY', 'UVIX', 'SVIX', 'VIXY', 'VXX', 'FNGU', 'FNGD', 'GLD', 'SLV', 'GDX',
  'GDXJ', 'USO', 'UNG', 'TLT', 'HYG', 'LQD', 'ARKK', 'IBIT', 'BITO', 'BITX',
  'NUGT', 'DUST', 'JNUG', 'ERX', 'ERY', 'BOIL', 'KOLD', 'NAIL', 'URAA',
  'MSTX', 'MSTU', 'CONL', 'NVDL', 'TSLL', 'AAPU', 'MSFU', 'AMZU', 'GGLL',
  'AGG', 'BND', 'SHY', 'IEF', 'VXUS', 'VEA', 'VWO', 'SCHD', 'JEPI', 'JEPQ',
]);

/* ── reference ─────────────────────────────────────────────────────────── */

/* Reference types. The live route drops a name only when its type is KNOWN
   and not CS/ADRC; an unknown type passes. Same rule here. */
function loadReference(): Map<string, { type: string | null; name: string | null; delisted: string | null }[]> {
  const j = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DATA, 'reference', 'tickers.json.gz'))).toString());
  const m = new Map<string, { type: string | null; name: string | null; delisted: string | null }[]>();
  for (const [ticker, type, , name, delisted] of j.rows) {
    const arr = m.get(ticker) ?? [];
    arr.push({ type, name, delisted: delisted ? String(delisted).slice(0, 10) : null });
    m.set(ticker, arr);
  }
  return m;
}

function refAt(ref: ReturnType<typeof loadReference>, sym: string, date: string) {
  const recs = ref.get(sym);
  if (!recs?.length) return null;
  // A reused symbol: prefer the listing that was alive on the scan date.
  return recs.find(r => !r.delisted || r.delisted >= date) ?? recs[recs.length - 1];
}

/* ── main ────────────────────────────────────────────────────────────────── */

function main() {
  const t0 = Date.now();
  const cache = loadAdjusted();
  const { sessions, tMs, idOf, syms, O, H, L, C, V, VW, barsOf } = cache;
  const N = sessions.length;
  console.log(`${N} sessions ${sessions[0]} → ${sessions[N - 1]}; loaded ${syms.length} tickers in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  const ref = loadReference();
  const spy = idOf.get('SPY');

  /* RS ratings as /api/rs/run would have published them before session s:
     P0 = the prior session's close, anchors 63/126/189/252 sessions before. */
  const rsFor = (p0: number): { ratings: Map<string, number>; sortedRaws: number[] } => {
    const ratings = new Map<string, number>();
    if (p0 - 63 < 0) return { ratings, sortedRaws: [] };
    const raws: [string, number][] = [];
    const at = (id: number, s: number) => (s >= 0 && !Number.isNaN(C[id][s]) && C[id][s] > 0 ? C[id][s] : null);
    for (let id = 0; id < syms.length; id++) {
      const sym = syms[id];
      if (RS_EXCLUDED.has(sym) || !/^[A-Z]{1,5}$/.test(sym)) continue;
      const c0 = at(id, p0);
      if (c0 == null || c0 < RS_MIN_PRICE) continue;
      if (!(V[id][p0] >= RS_MIN_VOLUME)) continue;
      const c63 = at(id, p0 - 63);
      if (c63 == null) continue;
      const raw = rawRsScore({ p0: c0, p63: c63, p126: at(id, p0 - 126), p189: at(id, p0 - 189), p252: at(id, p0 - 252) });
      if (raw != null) raws.push([sym, raw]);
    }
    const sortedRaws = raws.map(r => r[1]).sort((a, b) => a - b);
    for (const [sym, raw] of raws) ratings.set(sym, percentileRank(raw, sortedRaws));
    return { ratings, sortedRaws };
  };

  fs.mkdirSync(OUT, { recursive: true });
  const regOut = fs.createWriteStream(path.join(OUT, `ep9m_${VERSION}_registry.jsonl`));
  const sesOut = fs.createWriteStream(path.join(OUT, `ep9m_${VERSION}_sessions.jsonl`));
  // Every shortlisted name per session — the shortlist depends on bars only,
  // so it is identical in v1 and v2 and drives download-lookups.mjs.
  const slOut = fs.createWriteStream(path.join(OUT, 'ep9m_shortlist.jsonl'));
  let missingLookups = 0;

  type RegEntry = { ticker: string; date: string; dateMs: number; score: number };
  let registry: RegEntry[] = [];
  let totalFinal = 0, totalShadow = 0;

  for (let s = PROFILE_SESSIONS; s < N; s++) {
    const date = sessions[s];
    const dMs = tMs[s];

    // Stage 1 — universe, gated on the as-traded (unadjusted) print.
    const snapMap = new Map<string, SnapInfo>();
    const asTraded = new Map<string, { c: number; v: number }>();
    for (const [T, , , , c, v] of readDay('unadj', date)) {
      if (!passesUniverseGate(T, c, v)) continue;
      const id = idOf.get(T);
      if (id === undefined || Number.isNaN(C[id][s])) continue;
      let prevClose = 0;
      for (let j = s - 1; j >= Math.max(0, s - 5); j--) {
        if (!Number.isNaN(C[id][j])) { prevClose = C[id][j]; break; }
      }
      const price = C[id][s];
      const changePct = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
      snapMap.set(T, {
        price, prevClose, changePct: Number.isNaN(changePct) ? 0 : changePct,
        vol: V[id][s],
        vwap: Number.isNaN(VW[id][s]) ? null : VW[id][s],
        dayHigh: H[id][s], dayLow: L[id][s], dayOpen: O[id][s],
      });
      asTraded.set(T, { c, v });
    }

    // Stage 2 — volume profile: the 60 sessions BEFORE the scan date.
    const series = new Map<string, LiteBar[]>();
    snapMap.forEach((_, sym) => {
      const id = idOf.get(sym)!;
      const arr: LiteBar[] = [];
      for (let j = s - PROFILE_SESSIONS; j <= s - 1; j++) {
        if (!Number.isNaN(C[id][j])) arr.push({ c: C[id][j], h: H[id][j], l: L[id][j], v: V[id][j] });
      }
      series.set(sym, arr);
    });

    // Stage 3 — abnormality shortlist (shared code).
    const shortlist = shortlistAbnormal(series, snapMap);
    slOut.write(JSON.stringify({ date, tickers: shortlist.map(a => a.sym) }) + '\n');
    const dayLk = VERSION === 'v2' ? readDayLookups(date) : null;
    if (VERSION === 'v2' && shortlist.length && !dayLk) missingLookups++;

    // Registry context, as the live route reads it.
    const cutoff = dMs - REGISTRY_DAYS * DAY_MS;
    registry = registry.filter(e => e.dateMs >= cutoff);
    const priorCounts = new Map<string, number>();
    const priorRecent = new Map<string, number>();
    for (const e of registry) {
      if (e.date === date) continue;
      priorCounts.set(e.ticker, (priorCounts.get(e.ticker) || 0) + 1);
      const daysAgo = Math.round((dMs - e.dateMs) / DAY_MS);
      if (daysAgo > 0) {
        const cur = priorRecent.get(e.ticker);
        if (cur == null || daysAgo < cur) priorRecent.set(e.ticker, daysAgo);
      }
    }

    const rs = rsFor(s - 1);

    // Market regime at the scan date — slice context only.
    let regime: Record<string, number | boolean | null> = {};
    if (spy !== undefined) {
      const sc = barsOf(spy, s - 260, s).map(b => b.c);
      const spyPx = sc[sc.length - 1];
      const s50 = sma(sc, 50), s200 = sma(sc, 200), s50prev = sma(sc.slice(0, -10), 50);
      regime = {
        spyAbove50: s50 != null ? spyPx > s50 : null,
        spyAbove200: s200 != null ? spyPx > s200 : null,
        spy50Rising: s50 != null && s50prev != null ? s50 > s50prev : null,
        spyRet20: sc.length > 21 ? +(((spyPx / sc[sc.length - 21]) - 1) * 100).toFixed(2) : null,
      };
    }

    // Stage 4 — enrichment and scoring, per shortlisted name.
    const firstIdx = (() => { let j = s; while (j > 0 && tMs[j - 1] >= dMs - BARS_LOOKBACK_DAYS * DAY_MS) j--; return j; })();
    let typeDropped = 0, shortHistory = 0;
    const candidates: Record<string, unknown>[] = [];

    for (const ab of shortlist) {
      const sym = ab.sym;
      const snap = snapMap.get(sym)!;
      const refRec = refAt(ref, sym, date);
      const lk = dayLk?.[sym];
      const tickerType = ((VERSION === 'v2' && lk?.details ? lk.details.type : refRec?.type) || '').toUpperCase();
      if (tickerType && tickerType !== 'CS' && tickerType !== 'ADRC') { typeDropped++; continue; }

      const id = idOf.get(sym)!;
      const bars = barsOf(id, firstIdx, s);
      if (bars.length < 30) { shortHistory++; continue; }

      const closes = bars.map(b => b.c);
      const price = snap.price;
      const atr14 = atr(bars, 14);
      const atrPctVal = atr14 && price > 0 ? (atr14 / price) * 100 : null;
      const adr = adrPct(bars, 20);
      const rmv = computeRMV(bars, { lookback: 15 });
      const rme = computeRMEDetail(bars, { maLength: 21, lookback: 250 }).rme;
      const chop14 = choppiness(bars, CHOP_PERIOD_DEFAULT);
      const mf = computeMoneyFlow(bars, { length: 21 });
      const mfTrend = moneyFlowTrend(bars, { length: 21, lookback: 5 });
      const stochKVal = stochK(bars, 10);
      const e10 = ema(closes, 10), e21 = ema(closes, 21), e50 = ema(closes, 50);
      const e21Prev = ema(closes.slice(0, -3), 21);
      const sma50 = sma(closes, 50), sma200 = sma(closes, 200);
      const hiWindow = bars.slice(-Math.min(252, bars.length)).map(b => b.h);
      const hi52 = hiWindow.length ? Math.max(...hiWindow) : null;
      const pctOffHigh = hi52 && hi52 > 0 ? ((price - hi52) / hi52) * 100 : null;

      let rsRating = rs.ratings.get(sym) ?? null;
      if (rsRating == null && bars.length >= 63 && rs.sortedRaws.length > 0) {
        const n = bars.length;
        const raw = rawRsScore({
          p0: bars[n - 1]?.c, p63: bars[n - 1 - Math.min(63, n - 1)]?.c,
          p126: n > 126 ? bars[n - 1 - 126]?.c : null,
          p189: n > 189 ? bars[n - 1 - 189]?.c : null,
          p252: n > 252 ? bars[n - 1 - 252]?.c : null,
        });
        if (raw != null) rsRating = percentileRank(raw, rs.sortedRaws);
      }

      const closeStrength = closeStrengthOf(price, snap.dayHigh, snap.dayLow);
      const dayHigh = snap.dayHigh ?? bars[bars.length - 1]?.h ?? null;
      const priorSwingHigh = priorSwingHighOf(bars);
      const plan = computeTradePlan({
        price, adrPct: adr, atrPct: atrPctVal, changePct: snap.changePct,
        ema10: e10, ema21: e21, ema50: e50, dayHigh, priorSwingHigh,
        aboveEma10: e10 != null ? price >= e10 : null,
        aboveEma21: e21 != null ? price >= e21 : null,
        setupName: null,
      });

      const priorTriggers = priorCounts.get(sym) || 0;
      const at = asTraded.get(sym)!;

      // v2 inputs. v1 leaves them empty, which scores 0 / 'none' as before.
      let sm: ReturnType<typeof shareMetrics> | null = null;
      let news: NewsItem | null = null;
      let tier: CatalystTier = 'none';
      let sector = '';
      if (VERSION === 'v2') {
        const splitFactor = snap.vol > 0 ? at.v / snap.vol : 1;   // adjusted → as-traded shares
        sm = shareMetrics({
          marketCap: lk?.details?.market_cap,
          sharesOutstanding: lk?.details?.share_class_shares_outstanding,
          shortInterest: shortInterestAsOf(sym, date),
          price: at.c, vol: at.v, avgVol: ab.avgVol * splitFactor,
        });
        news = pickBestNews(lk?.news ?? [], sym, Date.parse(`${date}${NEWS_CLOCK_UTC}`));
        tier = catalystTierOf(news);
        sector = cleanSectorDescription(lk?.details?.sic_description ?? undefined, undefined, undefined) || '';
      }

      const scored = scoreEp9m({
        rvol: ab.rvol, volVs60dMax: ab.volVs60dMax,
        floatTurnover: sm?.floatTurnover ?? null, daysToCover: sm?.daysToCover ?? null,
        closeStrength, mf, catalystTier: tier, priorTriggers,
      });
      const cls = classifyEpType({
        fund: null, newsTag: news?.tag ?? null, companyName: lk?.details?.name || refRec?.name || sym, sector,
        catalyst: news?.title ?? null, priorTriggers, mostRecentPriorDaysAgo: priorRecent.get(sym) ?? null,
      });

      const r4 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : +v.toFixed(4));
      candidates.push({
        date, sIdx: s, ticker: sym, name: refRec?.name ?? null,
        score: scored.score, grade: scored.grade, breakdown: scored.breakdown,
        gatedByChange: (snap.changePct ?? 0) < 0,
        price: r4(price), priceAsTraded: at.c, volAsTraded: at.v,
        changePct: r4(snap.changePct), gapPct: snap.prevClose > 0 && snap.dayOpen != null ? r4(((snap.dayOpen - snap.prevClose) / snap.prevClose) * 100) : null,
        dVol: Math.round(at.c * at.v),
        rvol: r4(ab.rvol), avgVol: Math.round(ab.avgVol), volVs60dMax: r4(ab.volVs60dMax), unprecedented: ab.unprecedented,
        closeStrength: r4(closeStrength), mf: r4(mf), mfTrend, chop14: r4(chop14), stochK: r4(stochKVal),
        atrPct: r4(atrPctVal), adrPct: r4(adr), rmv: r4(rmv), rme: r4(rme),
        ema21Rising: e21 != null && e21Prev != null ? e21 > e21Prev : null,
        goldenCross: sma50 != null && sma200 != null ? sma50 > sma200 : null,
        aboveSma50: sma50 != null ? price > sma50 : null,
        aboveSma200: sma200 != null ? price > sma200 : null,
        distToEma21: e21 ? r4(((price - e21) / e21) * 100) : null,
        pctOffHigh: r4(pctOffHigh), rsRating, stage: computeStage(closes, { price }),
        priorTriggers, epType: cls.epType, epTheme: cls.epTheme,
        ...(VERSION === 'v2' ? {
          float: sm?.float ?? null, mktCap: sm?.mktCap ?? null, shortPct: r4(sm?.shortPct), daysToCover: r4(sm?.daysToCover),
          floatTurnover: r4(sm?.floatTurnover), catalystTier: tier, newsTag: news?.tag ?? null,
          newsPublisher: news?.publisher ?? null, newsAgeHours: news?.ageHours ?? null,
          newsSentiment: news?.sentiment ?? null, newsCausal: news?.causal ?? null, sector: sector || null,
          hasDetails: !!lk?.details,
        } : {}),
        plan: {
          family: plan.family, tradeable: plan.tradeable, trigger: r4(plan.trigger), stop: r4(plan.stop),
          target: r4(plan.target), stopPct: r4(plan.stopPct), rMultiple: plan.rMultiple ?? null,
          clear: plan.clear ?? null, overextended: plan.overextended ?? null, collapsed: plan.collapsed ?? null,
          note: plan.note ?? null,
        },
        dayHigh: r4(dayHigh), dayLow: r4(snap.dayLow), priorSwingHigh: r4(priorSwingHigh),
        ...regime,
      });
    }

    // Stage 5 — change gate, rank, top 25, registry (as live).
    const passing = candidates.filter(c => !c.gatedByChange).sort((a, b) => (b.score as number) - (a.score as number));
    const finalList = passing.slice(0, EP9M.finalSize);
    const shadow = candidates.filter(c => c.gatedByChange);
    finalList.forEach((c, i) => regOut.write(JSON.stringify({ ...c, inFinal: true, rank: i + 1 }) + '\n'));
    shadow.forEach(c => regOut.write(JSON.stringify({ ...c, inFinal: false, rank: null }) + '\n'));
    for (const c of finalList) registry.push({ ticker: c.ticker as string, date, dateMs: dMs, score: c.score as number });
    totalFinal += finalList.length; totalShadow += shadow.length;

    sesOut.write(JSON.stringify({
      date, raw9m: snapMap.size, shortlisted: shortlist.length, typeDropped, shortHistory,
      scored: candidates.length, final: finalList.length, cutByTop25: Math.max(0, passing.length - finalList.length),
      shadow: shadow.length, rsUniverse: rs.sortedRaws.length, ...regime,
    }) + '\n');

    if ((s - PROFILE_SESSIONS) % 100 === 0) {
      console.log(`${date}  final=${finalList.length} shadow=${shadow.length} raw9m=${snapMap.size}  total=${totalFinal}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
  }

  regOut.end(); sesOut.end(); slOut.end();
  if (missingLookups) console.warn(`WARNING: ${missingLookups} sessions had no lookups file — run download-lookups.mjs first`);
  let commit = 'unknown';
  try { commit = execSync('git rev-parse --short HEAD', { cwd: APP }).toString().trim(); } catch { /* not fatal */ }
  fs.writeFileSync(path.join(OUT, `ep9m_${VERSION}_meta.json`), JSON.stringify({
    version: VERSION === 'v2' ? 'v2-point-in-time' : 'v1-bars-only', siLagDays: SI_LAG_DAYS, newsClockUtc: NEWS_CLOCK_UTC, commit, generatedAt: new Date().toISOString(),
    firstScan: sessions[PROFILE_SESSIONS], lastScan: sessions[N - 1], sessionsScanned: N - PROFILE_SESSIONS,
    totalFinal, totalShadow, config: EP9M,
  }, null, 2));
  console.log(`DONE ${N - PROFILE_SESSIONS} sessions, ${totalFinal} flagged EPs (+${totalShadow} change-gated shadow) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main();

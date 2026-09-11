// scripts/backtest/replay-multibagger.ts — 100-Bagger Scorecard replay.
//
// Run from trade-dash (after download-fundamentals.mjs):
//   npx tsx scripts/backtest/replay-multibagger.ts
// Writes CTT/backtest-data/replay/multibagger_{registry,sessions}.jsonl + meta.json
//
// MEASURED DIFFERENTLY FROM EVERY OTHER SCAN, on purpose. This screen is a
// multi-year thesis — companies that compound — so a 60-session R multiple
// would say nothing about whether it works. Each month-end list is scored on
// FORWARD RETURNS at 3, 6, 12 and 24 months against the same month's universe
// median, which is the only honest question the data can answer: did the names
// this screen liked beat the liquid small/mid-cap market it picked them from?
//
// Exact, through the same code production runs (lib/indicators/fundamentals):
//   - universe: price $2-500, 50k+ shares that day, ranked by dollar volume,
//     top 100 skipped (mega caps), next 1,500 taken — rebuilt per month end
//   - type must be CS (this screen excludes ADRs, unlike EP9M and VCP)
//   - market cap = share count × that day's price, gated to $50M-$10B
//   - parseFinancials over the 4 most recent ANNUAL filings that were already
//     PUBLIC on the scan date (filing_date <= date), then scoreMultibagger
//   - must-pass gates: revenue CAGR >= 10%, ROIC >= 10%, score >= 20
//   - final list = top MULTIBAGGER.finalSize by score
//
// Approximations:
//   - Month-end snapshots rather than daily (the inputs change a few times a
//     year; daily would multiply the API cost ~20x for the same answer).
//   - Share counts from one snapshot per calendar year, the latest at or
//     before the scan date — they move slowly, and price does the rest.
//   - The live route reads today's reference data; here everything is
//     as-of-date, so this replay is if anything stricter than production.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';

import { APP, DATA, loadAdjusted } from './cache';
import { MULTIBAGGER } from '@/lib/scanConfig';
import { parseFinancials, scoreMultibagger } from '@/lib/indicators/fundamentals';

const OUT = path.join(DATA, 'replay');
const FUND = path.join(DATA, 'fundamentals');
const HORIZONS = [63, 126, 252, 504];         // ~3, 6, 12, 24 months

interface Filing { filing_date: string | null; period_of_report_date: string | null; financials: unknown }
interface ShareSnap { type: string | null; weighted_shares_outstanding: number | null; share_class_shares_outstanding: number | null; market_cap: number | null; name: string | null; sic_description: string | null }

const readGz = <T,>(file: string): T | null =>
  fs.existsSync(file) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString()) as T : null;

function main() {
  const t0 = Date.now();
  const cache = loadAdjusted();
  const { sessions, idOf, O, H, C } = cache;
  const N = sessions.length;
  const idxOf = new Map(sessions.map((d, i) => [d, i]));

  const uni = readGz<{ monthEnds: string[]; universes: Record<string, string[]> }>(path.join(FUND, 'universe.json.gz'));
  if (!uni) throw new Error('run download-fundamentals.mjs first');
  console.log(`${uni.monthEnds.length} month ends; cache ${sessions[0]} → ${sessions[N - 1]}`);

  fs.mkdirSync(OUT, { recursive: true });
  const regOut = fs.createWriteStream(path.join(OUT, 'multibagger_registry.jsonl'));
  const sesOut = fs.createWriteStream(path.join(OUT, 'multibagger_sessions.jsonl'));
  const filingsCache = new Map<string, Filing[] | null>();
  const sharesCache = new Map<string, Record<string, ShareSnap> | null>();
  let rows = 0;

  /** Forward return from the next session's open, plus the best print along the way. */
  const forward = (id: number, s: number) => {
    const o1 = O[id][s + 1];
    if (!(o1 > 0)) return null;
    const out: Record<string, number | null> = {};
    for (const h of HORIZONS) {
      const end = Math.min(N - 1, s + h);
      let last: number | null = null, hi = -Infinity;
      for (let j = s + 1; j <= end; j++) {
        if (Number.isNaN(C[id][j])) continue;
        last = C[id][j]; hi = Math.max(hi, H[id][j]);
      }
      const complete = s + h <= N - 1;
      out[`ret${h}`] = complete && last != null ? +((last / o1 - 1) * 100).toFixed(2) : null;
      out[`run${h}`] = complete && hi > 0 ? +((hi / o1 - 1) * 100).toFixed(2) : null;
    }
    return out;
  };

  for (const date of uni.monthEnds) {
    const s = idxOf.get(date);
    if (s == null || s + 1 >= N) continue;
    const names = uni.universes[date] || [];
    let noShares = 0, wrongType = 0, mcapOut = 0, noFilings = 0, noRevenue = 0, gateFail = 0;
    const scored: Record<string, unknown>[] = [];

    for (const t of names) {
      const id = idOf.get(t);
      if (id === undefined || Number.isNaN(C[id][s])) continue;
      const price = C[id][s];

      if (!sharesCache.has(t)) sharesCache.set(t, readGz<Record<string, ShareSnap>>(path.join(FUND, 'shares', `${t}.json.gz`)));
      const snaps = sharesCache.get(t);
      if (!snaps) { noShares++; continue; }
      const asOf = Object.keys(snaps).filter(d => d <= date).sort().pop();
      const snap = asOf ? snaps[asOf] : null;
      if (!snap) { noShares++; continue; }
      if (snap.type && snap.type !== 'CS') { wrongType++; continue; }

      const shares = snap.weighted_shares_outstanding ?? snap.share_class_shares_outstanding;
      const mcap = typeof shares === 'number' && shares > 0 ? shares * price : snap.market_cap;
      if (mcap == null || mcap < MULTIBAGGER.minMarketCap || mcap > MULTIBAGGER.maxMarketCap) { mcapOut++; continue; }

      if (!filingsCache.has(t)) filingsCache.set(t, readGz<Filing[]>(path.join(FUND, 'financials', `${t}.json.gz`)));
      const all = filingsCache.get(t);
      if (!all?.length) { noFilings++; continue; }
      // Only what was already filed on the scan date — this is the look-ahead guard.
      const filings = all
        .filter(f => f.filing_date && f.filing_date <= date)
        .sort((a, b) => String(b.period_of_report_date).localeCompare(String(a.period_of_report_date)))
        .slice(0, 4);
      if (!filings.length) { noFilings++; continue; }

      const parsed = parseFinancials(filings, mcap, price);
      if (parsed.latestRevenue == null) { noRevenue++; continue; }
      const sc = scoreMultibagger(parsed.revGrowths, parsed.roic, parsed.debtToEquity, mcap, parsed.pe, parsed.fcfYield);
      if (sc.attrs.revGrowthPct == null || sc.attrs.revGrowthPct < 10) { gateFail++; continue; }
      if (sc.attrs.roic == null || sc.attrs.roic < 10) { gateFail++; continue; }
      if (sc.score < 20) { gateFail++; continue; }

      scored.push({
        date, sIdx: s, ticker: t, name: snap.name ?? t, sector: snap.sic_description ?? null,
        price: +price.toFixed(2), marketCap: Math.round(mcap), score: sc.score, grade: sc.grade,
        breakdown: sc.breakdown, mcapTier: sc.attrs.mcapTier,
        revGrowthPct: sc.attrs.revGrowthPct, revGrowthYears: sc.attrs.revGrowthYears,
        roic: sc.attrs.roic, debtToEquity: sc.attrs.debtToEquity, pe: sc.attrs.pe, fcfYield: sc.attrs.fcfYield,
        filingsUsed: filings.length, latestFiling: filings[0]?.filing_date ?? null,
        fwd: forward(id, s),
      });
    }

    scored.sort((a, b) => (b.score as number) - (a.score as number));
    const finalList = scored.slice(0, MULTIBAGGER.finalSize);

    /* The benchmark: every name in the same month's universe that had a
       forward path. A screen is only interesting if it beats the pond it
       fished in. */
    const bench: Record<string, number[]> = {};
    for (const t of names) {
      const id = idOf.get(t);
      if (id === undefined) continue;
      const f = forward(id, s);
      if (!f) continue;
      for (const h of HORIZONS) {
        const v = f[`ret${h}`];
        if (v != null) (bench[`ret${h}`] ||= []).push(v);
      }
    }
    const med = (xs: number[]) => xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null;
    const benchMed = Object.fromEntries(HORIZONS.map(h => [`ret${h}`, med(bench[`ret${h}`] || [])]));

    for (const r of finalList) { regOut.write(JSON.stringify({ ...r, benchMed }) + '\n'); rows++; }
    sesOut.write(JSON.stringify({
      date, universe: names.length, noShares, wrongType, mcapOut, noFilings, noRevenue, gateFail,
      passed: scored.length, final: finalList.length, benchMed, benchN: (bench.ret252 || []).length,
    }) + '\n');
    console.log(`${date}  universe=${names.length} passed=${scored.length} final=${finalList.length}  (mcap out ${mcapOut}, gates ${gateFail})`);
  }

  regOut.end(); sesOut.end();
  let commit = 'unknown';
  try { commit = execSync('git rev-parse --short HEAD', { cwd: APP }).toString().trim(); } catch { /* not fatal */ }
  fs.writeFileSync(path.join(OUT, 'multibagger_meta.json'), JSON.stringify({
    scan: '100-bagger scorecard', commit, generatedAt: new Date().toISOString(),
    monthEnds: uni.monthEnds.length, rows, horizons: HORIZONS, gates: MULTIBAGGER,
    measure: 'forward returns vs the same month universe median',
  }, null, 2));
  console.log(`DONE ${rows} rows in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main();

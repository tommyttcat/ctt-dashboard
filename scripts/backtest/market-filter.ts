// scripts/backtest/market-filter.ts — does the market on the day improve the breakout entry?
//
// Run from trade-dash:
//   npx tsx scripts/backtest/market-filter.ts download   SPY minute bars (~50 calls)
//   npx tsx scripts/backtest/market-filter.ts tag        → replay/intraday_market_tags.json
//   npx tsx scripts/backtest/portfolio.ts market         the verdicts
//
// The question (27 Sep 2026, after a Friday entry with futures down Sunday
// night): should the site hold back its buy on the tested entry when the
// market itself is weak? The scorecard's chop and "Above 40-day" readings
// were tested on NEXT-OPEN entries on 24 Sep and did not hold as
// instructions; SPY-above-its-averages hurt the account. None was ever
// tested on the volume-confirmed opening-range breakout (E2 in intraday.ts,
// lib/orb — the entry the tables now use), and the market's own action on
// the morning of the entry was never tested at all.
//
// RULES — fixed 27 Sep 2026 BEFORE any SPY minute bar was downloaded.
//   Trades   every E2 fill in replay/intraday_entries.jsonl (green Stocks in
//            Play / Daily / Swing, 26 Sep 2022 on), found again with
//            lib/orb orbTrigger to get the breakout minute.
//   Filters  skip the trade when —
//     F1 GAP     SPY opened the entry session 0.5% or more below its prior
//                close (the "futures way down" morning).
//     F2 RED     SPY's last completed minute before the breakout minute is
//                below its prior close.
//     F3 BREAK   SPY's last completed minute before the breakout minute is
//                below SPY's own opening-range low (9:30-9:59) — the market
//                breaking down while the stock breaks out.
//     F4 CHOP    the scorecard's daily chop reading the evening before is
//                choppy or worse on the site's own setting (VERY SENSITIVE,
//                lib/indicators/chopMarket DEFAULT_CHOP_MODE).
//   Scoring  the account and per-trade machinery of portfolio.ts intraday
//            mode, unchanged: hold 20, card stop, 10 slots, 0.5% risk, RS
//            first, EP9M's dip trades alongside, split at two-thirds.
//   PASS     a filter must beat unfiltered E2 on ALL of: per-trade average R
//            in both halves, account return in both halves, and the median
//            of 200 random orderings. Anything less and the site does not
//            hold back its buy for it.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DATA, loadAdjusted, listSessions, readDay } from './cache';
import { signals, type Sig } from './intraday';
import { orbTrigger, etMinute, type Minute } from '@/lib/orb';
import { choppiness } from '@/lib/indicators/chop';
import { CHOP_BANDS, DEFAULT_CHOP_MODE } from '@/lib/indicators/chopMarket';

const REPLAY = path.join(DATA, 'replay');
const MIN_DIR = path.join(DATA, 'minute');
const SPY_DIR = path.join(MIN_DIR, 'SPY');
const OPEN = 9 * 60 + 30, CLOSE = 16 * 60;

function polygonKey(): string {
  const txt = fs.readFileSync(path.resolve(DATA, '../.env.backtest'), 'utf8');
  const m = txt.match(/^POLYGON_API_KEY=(.+)$/m);
  if (!m) throw new Error('POLYGON_API_KEY missing from CTT/.env.backtest');
  return m[1].trim().replace(/^["']|["']$/g, '');
}

const etDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const dayOf = (ms: number) => etDay.format(new Date(ms));
const readRows = (f: string) => fs.readFileSync(path.join(REPLAY, f), 'utf8').trim().split('\n').map(l => JSON.parse(l));

/** The E2 trades, each with its signal (for avgVol) and entry session date. */
function trades() {
  const c = loadAdjusted();
  const sig = new Map<string, Sig>(signals().map(g => [`${g.ticker}|${g.date}`, g]));
  const out: { g: Sig; e: { ei: number; fill: number }; entryDate: string }[] = [];
  for (const r of readRows('intraday_entries.jsonl')) {
    const e = r.entries?.E2;
    const g = sig.get(`${r.ticker}|${r.date}`);
    if (!e || !g) continue;
    out.push({ g, e, entryDate: c.sessions[e.ei] });
  }
  return { c, out };
}

async function download() {
  const key = polygonKey();
  const { out } = trades();
  const dates = [...new Set(out.map(t => t.entryDate))].sort();
  fs.mkdirSync(SPY_DIR, { recursive: true });
  const months = [...new Set(dates.map(d => d.slice(0, 7)))];
  let calls = 0;
  for (const mo of months) {
    const want = dates.filter(d => d.startsWith(mo) && !fs.existsSync(path.join(SPY_DIR, `${d}.json.gz`)));
    if (!want.length) continue;
    const url = `https://api.polygon.io/v2/aggs/ticker/SPY/range/1/minute/${want[0]}/${want.at(-1)}?adjusted=true&sort=asc&limit=50000&apiKey=${key}`;
    const res = await fetch(url);
    calls++;
    if (!res.ok) throw new Error(`SPY ${mo}: ${res.status}`);
    const j = await res.json();
    const rows: Minute[] = (j.results ?? []).map((r: { t: number; o: number; h: number; l: number; c: number; v: number }) => [r.t, r.o, r.h, r.l, r.c, r.v]);
    if (j.next_url) throw new Error(`SPY ${mo}: more than one page — narrow the range`);
    for (const d of want) {
      const day = rows.filter(m => dayOf(m[0]) === d && etMinute(m[0]) >= OPEN && etMinute(m[0]) < CLOSE);
      fs.writeFileSync(path.join(SPY_DIR, `${d}.json.gz`), zlib.gzipSync(JSON.stringify(day)));
    }
    await new Promise(r => setTimeout(r, 400));
  }
  console.log(`SPY minutes: ${dates.length} sessions, ${calls} calls`);
}

function tag() {
  const { c, out } = trades();
  const spy = c.idOf.get('SPY')!;

  // The scorecard's daily chop reading, rebuilt as analyze-chop.ts does.
  const bars: Record<'QQQ' | 'SPY', { h: number; l: number; c: number }[]> = { QQQ: [], SPY: [] };
  const chopOn = new Map<string, number>();
  for (const d of listSessions()) {
    const rows = readDay('adj', d);
    for (const T of ['QQQ', 'SPY'] as const) {
      const r = rows.find(x => x[0] === T);
      if (r) bars[T].push({ h: r[2], l: r[3], c: r[4] });
    }
    const q = choppiness(bars.QQQ), s = choppiness(bars.SPY);
    if (q != null && s != null) chopOn.set(d, 0.6 * q + 0.4 * s);
  }
  const chopLine = CHOP_BANDS[DEFAULT_CHOP_MODE].chop;

  const tags: Record<string, unknown> = {};
  let mismatch = 0, noSpy = 0;
  for (const { g, e, entryDate } of out) {
    const f = path.join(MIN_DIR, g.date.slice(0, 4), `${g.ticker}_${g.date}.json.gz`);
    const sf = path.join(SPY_DIR, `${entryDate}.json.gz`);
    if (!fs.existsSync(f) || !fs.existsSync(sf) || g.avgVol == null) { noSpy++; continue; }
    const day1 = (JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString()) as Minute[]).filter(m => dayOf(m[0]) === entryDate);
    const trig = orbTrigger(day1, g.avgVol);
    if (!trig || Math.abs(trig.fill - e.fill) > 1e-3 * e.fill) { mismatch++; continue; }
    const spyMin = (JSON.parse(zlib.gunzipSync(fs.readFileSync(sf)).toString()) as Minute[]).map(m => ({ m, t: etMinute(m[0]) }));
    const prevClose = c.C[spy][e.ei - 1];
    const before = spyMin.filter(x => x.t < trig.minute);
    const last = before.at(-1)?.m[4];
    const orLow = Math.min(...spyMin.filter(x => x.t < OPEN + 30).map(x => x.m[3]));
    if (last == null || !(prevClose > 0) || !Number.isFinite(orLow)) { noSpy++; continue; }
    const chop = chopOn.get(g.date) ?? null;
    tags[`${g.ticker}|${g.date}`] = {
      minute: trig.minute,
      gapPct: +((c.O[spy][e.ei] / prevClose - 1) * 100).toFixed(3),
      spyAtFillPct: +((last / prevClose - 1) * 100).toFixed(3),
      spyBelowOrLow: last < orLow,
      chop: chop == null ? null : +chop.toFixed(2),
      F1: c.O[spy][e.ei] / prevClose - 1 <= -0.005,
      F2: last < prevClose,
      F3: last < orLow,
      F4: chop != null && chop >= chopLine,
    };
  }
  fs.writeFileSync(path.join(REPLAY, 'intraday_market_tags.json'), JSON.stringify(tags));
  const n = Object.keys(tags).length;
  const share = (k: string) => (100 * Object.values(tags).filter((t: any) => t[k]).length / n).toFixed(0);
  console.log(`tagged ${n} of ${out.length} E2 trades (breakout mismatch ${mismatch}, no SPY/avgVol ${noSpy}); ` +
    `skipped by F1 ${share('F1')}% · F2 ${share('F2')}% · F3 ${share('F3')}% · F4 ${share('F4')}%`);
}

const mode = process.argv[2];
if (mode === 'download') download();
else if (mode === 'tag') tag();
else console.log('usage: market-filter.ts download | tag');

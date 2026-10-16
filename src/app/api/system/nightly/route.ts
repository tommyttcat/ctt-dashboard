// app/api/system/nightly/route.ts — the System card (lib/system), once each trading evening.
//
// 18:15 ET on weekdays (two UTC hours + etGate), after Momentum Leaders (18:10).
// 1. Reference: common stock and ADRs (Polygon, ~10 calls).
// 2. Grouped daily bars for the last 262 sessions (one call per session) — a
//    year of OHLCV for every name, ~1.5 MB a call.
// 3. Every liquid name ($2+, $20M+ a day, a full year of bars) gets the model's
//    features (lib/system featuresAt — the backtest's code), ranked across the
//    universe and scored with the frozen weights. Top 10 among $50M+ a day.
// 4. Core: QQQ's close against its 200-day. History: one entry per build (the
//    live record). One KV read (last state), two KV writes (the state, and every
//    name's score percentile for site-wide row colours). Nothing per page view.
// force=1 (cron secret or a signed-in admin) rebuilds outside the window.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { authorized, authorizedOrAdmin } from '@/lib/apiAuth';
import { etGate } from '@/lib/etCron';
import { groupTerciles } from '@/lib/groups';
import { stage2At, stageMapAt, STAGE2_KEY, STAGE_MAP_KEY, type Stage2State, type StageMapState } from '@/lib/stageBreadth';
import { netHLAt, mergeHistory, NET_HL_KEY, type NetHLState } from '@/lib/netHighsLows';
import {
  SYSTEM_KEY, SYSTEM_SCORES_KEY, LEVERAGE, SHORTLIST_N, MIN_DVOL_PICK, featuresAt, rankFeatures, scoreRow, scoreGo, isLate, stepColours,
  type SystemState, type SystemPick, type SystemDay,
} from '@/lib/system';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const KEY = process.env.POLYGON_API_KEY || '';
const SESSIONS = 262;
async function pg<T = any>(path: string): Promise<T | null> {
  const url = path.startsWith('http') ? `${path}&apiKey=${KEY}` : `https://api.polygon.io${path}${path.includes('?') ? '&' : '?'}apiKey=${KEY}`;
  for (let a = 0; a < 3; a++) {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30000) }).catch(() => null);
    if (res?.ok) return (await res.json().catch(() => null)) as T | null;
    await new Promise(r => setTimeout(r, 600 * (a + 1)));
  }
  return null;
}
const etDate = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get('force') === '1';
  if (!(force ? await authorizedOrAdmin(req) : authorized(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const gate = force ? null : etGate([18], 'system nightly');
  if (gate) return gate;
  if (!KEY) return NextResponse.json({ success: false, error: 'no data key' }, { status: 500 });
  const t0 = Date.now();

  const names = new Map<string, string>();
  for (const type of ['CS', 'ADRC']) {
    let next: string | null = `/v3/reference/tickers?type=${type}&market=stocks&active=true&limit=1000`;
    for (let p = 0; next && p < 20; p++) {
      const j: { results?: { ticker: string; name?: string }[]; next_url?: string } | null = await pg(next);
      for (const r of j?.results ?? []) names.set(r.ticker, r.name ?? r.ticker);
      next = j?.next_url ?? null;
    }
  }
  if (names.size < 3000) return NextResponse.json({ success: false, error: `reference too small (${names.size})` }, { status: 502 });

  const to = etDate(Date.now()), from = etDate(Date.now() - 420 * 864e5);
  const spy = await pg<{ results?: { t: number }[] }>(`/v2/aggs/ticker/SPY/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=500`);
  const cal = (spy?.results ?? []).map(r => etDate(r.t));
  if (cal.length < SESSIONS) return NextResponse.json({ success: false, error: `calendar too short (${cal.length})` }, { status: 502 });
  const days = cal.slice(cal.length - SESSIONS);
  const T = SESSIONS - 1;

  // ticker -> 5 x SESSIONS arrays (NaN = no bar)
  const data = new Map<string, Float64Array[]>();
  const slot = (tk: string) => { let a = data.get(tk); if (!a) { a = [0, 1, 2, 3, 4].map(() => new Float64Array(SESSIONS).fill(NaN)); data.set(tk, a); } return a; };
  let empty = 0;
  for (let i = 0; i < SESSIONS; i += 16) {
    await Promise.all(days.slice(i, i + 16).map(async (d, k) => {
      const j = await pg<{ results?: { T: string; o: number; h: number; l: number; c: number; v: number }[] }>(`/v2/aggs/grouped/locale/us/market/stocks/${d}?adjusted=true`);
      const rs = j?.results ?? []; if (!rs.length) empty++;
      for (const r of rs) { if (!names.has(r.T) && r.T !== 'QQQ') continue; const a = slot(r.T); const s = i + k; a[0][s] = r.o; a[1][s] = r.h; a[2][s] = r.l; a[3][s] = r.c; a[4][s] = r.v; }
    }));
  }
  if (empty > 3) return NextResponse.json({ success: false, error: `${empty} grouped days empty` }, { status: 502 });
  const q = data.get('QQQ'); if (!q) return NextResponse.json({ success: false, error: 'no QQQ' }, { status: 502 });

  const rows: number[][] = [], meta: { t: string; dvol: number; price: number }[] = [];
  for (const [tk, a] of data) {
    if (tk === 'QQQ') continue;
    const [O, H, L, C, V] = a;
    let ok = true; for (let j = T - 260; j <= T; j++) if (!(C[j] > 0 && H[j] > 0 && L[j] > 0 && O[j] > 0)) { ok = false; break; }
    if (!ok || !(C[T] >= 2)) continue;
    let dv = 0; for (let j = T - 19; j <= T; j++) dv += C[j] * V[j]; dv /= 20;
    if (dv < 20e6) continue;
    rows.push(featuresAt({ o: O, h: H, l: L, c: C, v: V }, T, q[3], C[T], dv));
    meta.push({ t: tk, dvol: dv, price: C[T] });
  }
  if (rows.length < 500) return NextResponse.json({ success: false, error: `universe too small (${rows.length})` }, { status: 502 });
  const X = rankFeatures(rows);
  const scores = rows.map((_, i) => scoreRow(X, i));
  const order = scores.map((s, i) => [s, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const pctl = new Float64Array(rows.length); order.forEach(([, i], k) => { pctl[i] = k / (rows.length - 1); });
  const picks: SystemPick[] = order.slice().reverse().filter(([, i]) => meta[i].dvol >= MIN_DVOL_PICK).slice(0, SHORTLIST_N).map(([s, i]) => {
    const f = rows[i];
    return { t: meta[i].t, n: names.get(meta[i].t), score: +s.toFixed(4), pctl: +pctl[i].toFixed(3), price: meta[i].price, mom: +f[4].toFixed(4), off52: +f[9].toFixed(4), smooth: +f[8].toFixed(4), chg1: +f[16].toFixed(4), dvol: Math.round(meta[i].dvol), late: isLate(f[16], f[17]) };
  });

  let s200 = 0; for (let j = T - 199; j <= T; j++) s200 += q[3][j]; s200 /= 200;
  const core = { on: q[3][T] > s200, leverage: LEVERAGE, qqq: q[3][T], sma200: +s200.toFixed(2), pctFrom200: +((q[3][T] / s200 - 1) * 100).toFixed(2) };
  const asOf = days[T];

  // live record: yesterday's picks marked to today's closes
  const prev = await kv.get<SystemState>(SYSTEM_KEY);
  let history: SystemDay[] = prev?.history ?? [];
  if (history.length && history[history.length - 1].d === asOf) history = history.slice(0, -1);
  const last = history[history.length - 1];
  let listRet: number | null = null;
  if (last && prev?.picks?.length && prev.asOf === last.d) {
    const rs = prev.picks.map(p => { const a = data.get(p.t); const c = a?.[3][T]; return c && p.price > 0 ? c / p.price - 1 : null; }).filter((x): x is number => x != null);
    if (rs.length) listRet = +(rs.reduce((x, y) => x + y, 0) / rs.length - 0.002).toFixed(6);
  }
  history = [...history, { d: asOf, on: (core.on ? 1 : 0) as 0 | 1, qqq: core.qqq, picks: picks.map(p => p.t), listRet }].slice(-1000);


  /* Row colours and the Mdl column use the GO model (trade result), ranked to percentiles. */
  const go = rows.map((_, i) => scoreGo(X, i));
  const goOrder = go.map((g, i) => [g, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const scoreMap: Record<string, number> = {}; goOrder.forEach(([, i], k) => { scoreMap[meta[i].t] = +(k / (rows.length - 1)).toFixed(3); });
  /* Live colour scorecard: last night's groups marked to tonight's closes (same night = rebuilt in place). */
  const closesNow: Record<string, number> = {}; meta.forEach(m => { closesNow[m.t] = m.price; });
  const prevCol = prev?.colours && prev.asOf !== asOf ? prev.colours : undefined;
  const colours = prev?.colours && prev.asOf === asOf
    ? { ...prev.colours, prevBands: stepColours(undefined, asOf, closesNow, scoreMap).prevBands, prevCloses: closesNow }
    : stepColours(prevCol, asOf, closesNow, scoreMap);
  const state: SystemState = { asOf, builtAt: new Date().toISOString(), universe: rows.length, core, picks, history, colours };
  await kv.set(SYSTEM_KEY, state);
  /* Industry-group terciles for the swing checklist (lib/groups): ~1,800 names x ~8 bytes
     in the same value the page already reads — no extra KV command. */
  const group = groupTerciles(meta.map((m, i) => ({ t: m.t, r63: rows[i][2] })));

  /* S2 breadth (lib/stageBreadth): % of the scored names in Weinstein Stage 2 tonight, plus the
     sessions back to the earliest with 210 bars when the history is short. 1 KV read + 1 write. */
  try {
    const cl = meta.map(m => data.get(m.t)![3]);
    const prevS2 = await kv.get<Stage2State>(STAGE2_KEY);
    const keep = (prevS2?.history ?? []).filter(h => h.d < days[T]);
    const need = keep.length >= 30 ? [T] : Array.from({ length: Math.max(1, T - 209) }, (_, k) => 210 + k).filter(t => t <= T && !keep.some(h => h.d === days[t]));
    const pts = need.map(t => ({ d: days[t], ...stage2At(cl, t) }));
    const now = pts[pts.length - 1];
    const history = [...keep, ...pts.map(p => ({ d: p.d, pct: p.pct, n: p.n }))].sort((a, b) => a.d.localeCompare(b.d)).slice(-260);
    await kv.set(STAGE2_KEY, { asOf: now.d, pct: now.pct, n: now.n, counts: now.counts, history } satisfies Stage2State);
    /* Per-name stage for the Liquid Leaders universe ($10+, $100M+ a day; ~1,000 names, ~15 KB),
       read once a night by /api/leaders/nightly. 1 KV write. */
    const big = meta.map((m, i) => ({ m, i })).filter(({ m }) => m.price >= 10 && m.dvol >= 100e6);
    await kv.set(STAGE_MAP_KEY, { asOf: days[T], stage: stageMapAt(big.map(({ m }) => data.get(m.t)![3]), big.map(({ m }) => m.t), T) } satisfies StageMapState);
  } catch (e) { console.error('STAGE2_ERROR', e); }

  /* Net new 52-week highs − lows (lib/netHighsLows): tonight's point from the whole-market bars
     already loaded (every CS/ADR, not just the scored names). 1 KV read + 1 write. */
  try {
    const all = [...data.entries()].filter(([t]) => t !== 'QQQ').map(([, a]) => a);
    const pt = netHLAt(all.map(a => a[1]), all.map(a => a[2]), all.map(a => a[3]), T);
    const prevHL = await kv.get<NetHLState>(NET_HL_KEY);
    await kv.set(NET_HL_KEY, { asOf: days[T], history: mergeHistory(prevHL?.history, [{ d: days[T], ...pt }]) } satisfies NetHLState);
  } catch (e) { console.error('NETHL_ERROR', e); }
  await kv.set(SYSTEM_SCORES_KEY, { asOf, scores: scoreMap, group });
  return NextResponse.json({ success: true, asOf, universe: rows.length, ms: Date.now() - t0, core, top: picks.map(p => `${p.t}${p.late ? '*' : ''}`), historyDays: history.length });
}

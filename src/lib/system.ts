// lib/system.ts — the System card: a 2x Nasdaq core and the model's top-10 shortlist.
//
// CORE  2x QQQ while QQQ closes above its 200-day average, cash below (decided at
//       the close for the next session). Tested 2016-2026 on daily bars
//       (scripts/backtest/other-ways-1.ts C1, 0.95% fund fee + 4% borrowing on the
//       extra 1x): +209% / +273% (2016-20 / 2021-26) vs QQQ +180% / +128%; worst
//       drop -40% / -39% vs -29% / -36%; 2022 -31% vs QQQ -33%.
// SHORTLIST  a ridge model over ranked daily features (scripts/backtest/ai-system.ts,
//       NOSEC=1): trained walk-forward, it ranked stocks the right way round in 7 of 9
//       unseen years (2018-2026), mean weekly rank correlation +0.025 — a small, real
//       edge. Its long-only top 20 did NOT beat QQQ in testing (+30% / +37% vs +151% /
//       +78%). The weights below were fitted on every week 2016-01-04..2026-08-11 (534
//       weeks) and are frozen: do not re-fit on the same data.
// featuresAt() is shared with the backtest, so live scores use the tested code.

export const SYSTEM_KEY = 'system_v1';
/** Every scored name's GO-model percentile (0 = worst, 1 = best), for row colours site-wide. */
export const SYSTEM_SCORES_KEY = 'system_scores_v1';
export interface SystemScores { asOf: string; scores: Record<string, number> }
export const LEVERAGE = 2;
export const SHORTLIST_N = 10;
export const MIN_DVOL_PICK = 50e6;
export const FEATS = ["r5", "r21", "r63", "r126", "mom", "vol20", "vol60", "adr", "smooth", "off52", "vs20", "vs50", "vs200", "slope50", "rvol1", "rvol5", "chg1", "atrExp", "closeStr", "gap", "rsi", "max21", "min21", "logDvol", "beta", "logPx", "offLow20", "secMom", "relSec"] as const;
const F = FEATS.length;
const BETA = [2.36156e-05, -0.0138996, -0.00569994, -0.0131359, -0.00666106, -0.00223766, 0.00887931, 0.0134461, -0.00896412, 0.0135414, 0.0276815, 8.24731e-05, 0.00469604, 0.0110611, -0.0142097, 0.0063631, 0.000509765, 0.00646796, -0.0039605, -0.000759493, 0.00496864, -0.000156974, -0.00317803, 0.0052939, 0.0014516, 0.00406233, 0.0148739, -0.00386386, 0, 0, -0.00778085, -0.00622687, -0.00795606, -0.00898219, 0.00137238, -0.0172202, -0.0159748, -0.0169689, -0.0136283, -0.0165607, -0.00573775, -0.00260067, -0.0068651, -0.0102235, -0.00945193, -0.0114331, -0.00879753, -0.00706442, 0.00021837, -0.000494252, 0.00119601, -0.0115476, -0.0224966, 0.00461351, 0.00311054, -0.0106064, -0.0092428, 1.65925e-15, 1.65925e-15];
/* GO model (10 Oct 2026, scripts/backtest/runner-model.ts TARGET=trade NOSEC=1): the same
   features, trained on the RESULT of a +20% target / -10% stop / 40-session trade from the
   close. Walk-forward 2018-2026 it PASSED its pre-registered bar: the top decile beat the
   average trade in 8 of 9 unseen years; its top 10 a week averaged +1.71% (2018-21) and
   +0.49% (2022-26) a trade after costs vs +0.34% / -0.08% for a random stock. Average trade
   by score decile fell steadily from best to worst in both halves — the basis of the
   site's colours (top 30% go, middle 40% look, bottom 30% stay away). Fitted on every week
   2016-01-04..2026-07-14 (530 weeks); frozen. */
const BETA_GO = [2.52231e-05, -0.0103635, -0.010472, -0.0128317, -0.00439529, -0.012867, 0.00388619, -0.00614373, -0.0388361, 0.0103892, 0.0360789, 0.00319015, 0.0102304, 0.0130433, -0.0102058, -0.00160283, 0.00944212, 0.00852838, -0.0049249, -0.00455962, 0.0014552, -0.000198835, -0.00823278, 0.00201556, 0.00175423, -0.000643904, 0.0127123, -0.00646824, 0, 0, -0.00909259, -0.00386621, -0.0125136, -0.0162157, -0.00565154, -0.0172791, -0.0152221, -0.0198935, -0.0119183, -0.0187832, -0.0074952, -0.00466482, -0.0130208, -0.0134294, -0.000731991, -0.00446203, -0.0108262, -0.00435906, -0.00163301, -0.0071739, -0.00108454, -0.00728185, -0.0125752, 0.00593002, 0.000513858, -0.0114396, -0.00737307, 1.85639e-15, 1.85639e-15];
const SECTOR_FROM = 27;   // secMom, relSec: not used live (left at 0, as NOSEC=1 trained it)

export interface Bars { o: ArrayLike<number>; h: ArrayLike<number>; l: ArrayLike<number>; c: ArrayLike<number>; v: ArrayLike<number> }

/**
 * Raw features at index t (bars oldest first, no gaps in t-260..t). `q` = QQQ closes on
 * the same index; `realPx` = the traded (unadjusted) close; `dvol` = 20-session average
 * dollar volume. Order = FEATS. Sector features are NaN here.
 */
export function featuresAt(b: Bars, t: number, q: ArrayLike<number>, realPx: number, dvol: number): number[] {
  const cl = b.c, H = b.h, L = b.l, V = b.v, O = b.o;
  const ret = (a: number) => cl[t] / cl[t - a] - 1;
  const dr = (j: number) => cl[j] / cl[j - 1] - 1;
  const qr = (j: number) => q[j] / q[j - 1] - 1;
  const sd = (n: number) => { let s = 0, s2 = 0; for (let j = t - n + 1; j <= t; j++) { const x = dr(j); s += x; s2 += x * x; } const m = s / n; return Math.sqrt(Math.max(0, s2 / n - m * m)); };
  const sma = (n: number, at = t) => { let s = 0; for (let j = at - n + 1; j <= at; j++) s += cl[j]; return s / n; };
  let hi252 = -Infinity, lo20 = Infinity, adr = 0, atr = 0, up = 0, dn = 0, mx = -Infinity, mn = Infinity, g = 0, ls = 0, v20 = 0, v5 = 0, v50 = 0;
  for (let j = t - 251; j <= t; j++) { hi252 = Math.max(hi252, H[j]); const x = dr(j); if (x > 0) up++; else if (x < 0) dn++; }
  for (let j = t - 19; j <= t; j++) { lo20 = Math.min(lo20, L[j]); adr += H[j] / L[j] - 1; v20 += V[j]; }
  for (let j = t - 13; j <= t; j++) { atr += Math.max(H[j], cl[j - 1]) - Math.min(L[j], cl[j - 1]); const x = dr(j); if (x > 0) g += x; else ls -= x; }
  for (let j = t - 20; j <= t; j++) { const x = dr(j); mx = Math.max(mx, x); mn = Math.min(mn, x); }
  for (let j = t - 4; j <= t; j++) v5 += V[j];
  for (let j = t - 49; j <= t; j++) v50 += V[j];
  let sxy = 0, sxx = 0; for (let j = t - 59; j <= t; j++) { const a = qr(j), bb = dr(j); sxy += a * bb; sxx += a * a; }
  const r12 = ret(252);
  return [
    ret(5), ret(21), ret(63), ret(126), cl[t - 21] / cl[t - 252] - 1, sd(20), sd(60), adr / 20, -Math.sign(r12) * (dn - up) / 252,
    cl[t] / hi252 - 1, cl[t] / sma(20) - 1, cl[t] / sma(50) - 1, cl[t] / sma(200) - 1, sma(50) / sma(50, t - 10) - 1,
    V[t] / (v20 / 20), (v5 / 5) / (v50 / 50), dr(t), (H[t] - L[t]) / (atr / 14),
    H[t] > L[t] ? (cl[t] - L[t]) / (H[t] - L[t]) : 0.5, O[t] / cl[t - 1] - 1, ls === 0 ? 100 : 100 - 100 / (1 + g / ls),
    mx, mn, Math.log(dvol), sxx > 0 ? sxy / sxx : 1, Math.log(realPx), cl[t] / lo20 - 1, NaN, NaN,
  ];
}

/** Rank each feature across the day's universe to [-0.5, 0.5] (NaN -> 0), as trained. */
export function rankFeatures(rows: number[][]): Float32Array {
  const n = rows.length, X = new Float32Array(n * F);
  for (let f = 0; f < F; f++) {
    if (f >= SECTOR_FROM) continue;
    const o = rows.map((r, i) => [r[f], i] as [number, number]).filter(p => Number.isFinite(p[0])).sort((a, b) => a[0] - b[0]);
    const m = o.length; o.forEach(([, i], k) => { X[i * F + f] = m > 1 ? k / (m - 1) - 0.5 : 0; });
  }
  return X;
}

/** Model score for row i of ranked X (higher = better expected next-20-session rank). */
export function scoreRow(X: Float32Array, i: number, beta: number[] = BETA): number {
  let s = beta[0];
  for (let f = 0; f < F; f++) { const x = X[i * F + f]; s += beta[1 + f] * x + beta[1 + F + f] * (x * x - 1 / 12); }
  return s;
}
/** GO score: expected result of the +20% / -10% / 40-session trade (higher = better). */
export const scoreGo = (X: Float32Array, i: number) => scoreRow(X, i, BETA_GO);

/** Spiked today: the LATE idea in two numbers (day change > +4%, or range > 2x ATR). */
export const isLate = (chg1: number, atrExp: number) => chg1 > 0.04 || atrExp > 2;

export interface SystemPick { t: string; n?: string; score: number; pctl: number; price: number; mom: number; off52: number; smooth: number; chg1: number; dvol: number; late: boolean }
export interface SystemDay { d: string; on: 0 | 1; qqq: number; picks: string[]; listRet: number | null }
export interface SystemState {
  asOf: string; builtAt: string; universe: number;
  core: { on: boolean; leverage: number; qqq: number; sma200: number; pctFrom200: number };
  picks: SystemPick[];
  history: SystemDay[];      // one entry per nightly build, newest last (live record)
}

/** Live record: 2x QQQ core NAV and the daily-updated top-10 list NAV, from history. */
export function liveRecord(h: SystemDay[]): { since: string | null; days: number; core: number; list: number; qqq: number } {
  if (h.length < 2) return { since: h[0]?.d ?? null, days: h.length, core: 0, list: 0, qqq: 0 };
  let core = 1, list = 1;
  for (let i = 1; i < h.length; i++) {
    const r = h[i].qqq / h[i - 1].qqq - 1;
    core *= h[i - 1].on ? 1 + LEVERAGE * r - 0.0095 / 252 - (LEVERAGE - 1) * 0.04 / 252 : 1 + 0.03 / 252;
    const lr = h[i].listRet; if (lr != null) list *= 1 + lr;
  }
  return { since: h[0].d, days: h.length, core: core - 1, list: list - 1, qqq: h[h.length - 1].qqq / h[0].qqq - 1 };
}

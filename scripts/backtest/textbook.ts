// scripts/backtest/textbook.ts — the research survivors, run the way the papers run them.
//
// Run from trade-dash:  npx tsx scripts/backtest/textbook.ts
// Local data only (backtest-data), no network, no KV.
//
// 28 Sep 2026. The reader asked to "tap into all the trading PhDs". The 2020
// replication study (Hou, Xue & Zhang, "Replicating Anomalies") re-tested 452
// published anomalies; about two-thirds failed. The ones that keep surviving
// are momentum, post-earnings drift, profitability ("quality") and index
// trend-following. None had been tested here the textbook way: a monthly,
// diversified portfolio rather than a handful of names held 20 days.
//
// RULES — fixed 28 Sep 2026 BEFORE running.
//   Calendar  formed at each month-end close from Sep 2022 (a year of history
//             first) through Jul 2026; bought at the next session's open, held
//             to the next month-end close; rebalanced monthly.
//   Universe  common stock, close >= $5, 20-day average dollar volume >= $10M
//             at the month-end (liquid names, as the papers exclude microcaps).
//   Portfolio 30 names, equal weight. Cost 0.1% per side on every name that
//             enters or leaves (turnover only).
//   MOM       top 30 by the 12-1 month return: close 21 sessions ago over the
//             close 252 sessions ago (the Jegadeesh-Titman / Carhart signal).
//   PEAD      earnings drift, measured by the market's own reaction (the
//             "earnings announcement return" version, no analyst estimates
//             needed): names whose quarterly report was filed in the last
//             month, ranked by the 3-session return around the filing
//             (close before to close after) minus SPY's; top 30, reaction > 0.
//   QUAL      top 30 by gross profit / total assets (Novy-Marx) from the last
//             annual report FILED before the month-end, among names that have
//             one; its own equal-weight benchmark is those covered names.
//   TREND     SPY while its month-end close is above its 210-session average,
//             cash (0%) otherwise (Faber's 10-month rule).
//   Split     formations before 16 May 2025 / from 16 May 2025, as every test.
//   PASS      a stock strategy: after costs it beats SPY in BOTH periods AND
//             beats the equal-weight universe over the whole run. TREND: a
//             worst drop at least 5 points smaller than SPY's while keeping at
//             least 80% of SPY's total return.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DATA, loadAdjusted } from './cache';

const START = '2022-09-01';
const CUT = '2025-05-16';
const TOP = 30;
const COST = 0.001;

const gz = (p: string) => JSON.parse(zlib.gunzipSync(fs.readFileSync(p)).toString());
const exists = (p: string) => fs.existsSync(p);

function main() {
  const c = loadAdjusted();
  const { sessions, syms, O, C, V } = c;
  const N = sessions.length;
  const ref = gz(path.join(DATA, 'reference', 'tickers.json.gz'));
  const cs = new Set<string>((ref.rows as [string, string][]).filter(r => r[1] === 'CS').map(r => r[0]));
  const spy = c.idOf.get('SPY')!;

  // Month-end session indices.
  const me: number[] = [];
  for (let s = 0; s < N - 1; s++) if (sessions[s].slice(0, 7) !== sessions[s + 1].slice(0, 7)) me.push(s);
  const forms = me.filter((s, i) => sessions[s] >= START && i + 1 < me.length);

  // Per-ticker data we need.
  const ids: number[] = [];
  for (let id = 0; id < syms.length; id++) if (cs.has(syms[id])) ids.push(id);
  const filings = new Map<number, number[]>();          // id -> session indices of quarterly filings
  const gpa = new Map<number, { d: string; v: number }[]>(); // id -> annual GP/A by filing date
  const sessIdx = new Map(sessions.map((d, i) => [d, i]));
  const nextSess = (d: string) => { let lo = 0, hi = N; while (lo < hi) { const m = (lo + hi) >> 1; if (sessions[m] < d) lo = m + 1; else hi = m; } return lo < N ? lo : -1; };
  for (const id of ids) {
    const T = syms[id];
    const qf = path.join(DATA, 'fundamentals', 'quarterly', `${T}.json.gz`);
    if (exists(qf)) {
      const q = gz(qf).q ?? [];
      const idx = q.map((x: { filed?: string }) => (x.filed ? (sessIdx.get(x.filed) ?? nextSess(x.filed)) : -1)).filter((i: number) => i > 0);
      filings.set(id, [...new Set<number>(idx)].sort((a, b) => a - b));
    }
    const ff = path.join(DATA, 'fundamentals', 'financials', `${T}.json.gz`);
    if (exists(ff)) {
      const out: { d: string; v: number }[] = [];
      for (const x of gz(ff) as any[]) {
        if (x.fiscal_period !== 'FY' || !x.filing_date) continue;
        const inc = x.financials?.income_statement ?? {}, bal = x.financials?.balance_sheet ?? {};
        const gp = inc.gross_profit?.value ?? (inc.revenues?.value != null && inc.cost_of_revenue?.value != null ? inc.revenues.value - inc.cost_of_revenue.value : null);
        const assets = bal.assets?.value;
        if (gp != null && assets > 0) out.push({ d: x.filing_date, v: gp / assets });
      }
      out.sort((a, b) => a.d.localeCompare(b.d));
      if (out.length) gpa.set(id, out);
    }
  }

  const ok = (v: number) => Number.isFinite(v) && v > 0;
  const lastClose = (id: number, from: number, to: number) => { for (let j = to; j > from; j--) if (ok(C[id][j])) return C[id][j]; return NaN; };
  const monthRet = (id: number, s: number, e: number) => {
    const o = O[id][s + 1]; const cl = lastClose(id, s + 1, e);
    return ok(o) && ok(cl) ? cl / o - 1 : NaN;
  };

  type Book = { name: string; eq: number[]; months: { d: string; r: number }[]; prev: Set<number> };
  const books: Record<string, Book> = {};
  const book = (name: string) => (books[name] ||= { name, eq: [1], months: [], prev: new Set() });

  for (let k = 0; k < forms.length; k++) {
    const s = forms[k]; const e = me[me.indexOf(s) + 1];
    const d = sessions[s];
    // Universe at s.
    const uni: number[] = [];
    for (const id of ids) {
      const p = C[id][s]; if (!ok(p) || p < 5) continue;
      let dv = 0, n = 0; for (let j = s - 19; j <= s; j++) if (ok(C[id][j])) { dv += C[id][j] * V[id][j]; n++; }
      if (n < 15 || dv / n < 10e6) continue;
      if (!ok(O[id][s + 1])) continue;
      uni.push(id);
    }
    const hold = (name: string, picks: number[]) => {
      const b = book(name);
      const rs = picks.map(id => monthRet(id, s, e)).filter(Number.isFinite);
      if (!rs.length) { b.months.push({ d, r: 0 }); b.eq.push(b.eq[b.eq.length - 1]); return; }
      const turn = picks.filter(id => !b.prev.has(id)).length + [...b.prev].filter(id => !picks.includes(id)).length;
      const cost = (turn / Math.max(1, picks.length)) * COST;
      const r = rs.reduce((a, x) => a + x, 0) / rs.length - cost;
      b.months.push({ d, r }); b.eq.push(b.eq[b.eq.length - 1] * (1 + r)); b.prev = new Set(picks);
    };
    const holdNoCost = (name: string, picks: number[]) => {
      const b = book(name);
      const rs = picks.map(id => monthRet(id, s, e)).filter(Number.isFinite);
      const r = rs.length ? rs.reduce((a, x) => a + x, 0) / rs.length : 0;
      b.months.push({ d, r }); b.eq.push(b.eq[b.eq.length - 1] * (1 + r));
    };

    // Benchmarks.
    { const b = book('SPY'); const r = C[spy][e] / O[spy][s + 1] - 1; b.months.push({ d, r }); b.eq.push(b.eq[b.eq.length - 1] * (1 + r)); }
    holdNoCost('EW universe', uni);

    // MOM.
    const mom = uni.filter(id => ok(C[id][s - 21]) && ok(C[id][s - 252]))
      .map(id => ({ id, v: C[id][s - 21] / C[id][s - 252] - 1 })).sort((a, b) => b.v - a.v).slice(0, TOP).map(x => x.id);
    hold('MOM', mom);

    // PEAD (EAR).
    const prevMe = me[me.indexOf(s) - 1];
    const ear: { id: number; v: number }[] = [];
    for (const id of uni) {
      const f = (filings.get(id) ?? []).filter(i => i > prevMe && i <= s - 1);
      if (!f.length) continue;
      const i = f[f.length - 1];
      if (!ok(C[id][i - 1]) || !ok(C[id][i + 1]) || !ok(C[spy][i - 1])) continue;
      const v = (C[id][i + 1] / C[id][i - 1] - 1) - (C[spy][i + 1] / C[spy][i - 1] - 1);
      if (v > 0) ear.push({ id, v });
    }
    hold('PEAD', ear.sort((a, b) => b.v - a.v).slice(0, TOP).map(x => x.id));

    // QUAL.
    const covered: { id: number; v: number }[] = [];
    for (const id of uni) {
      const g = gpa.get(id); if (!g) continue;
      let v: number | null = null; for (const x of g) { if (x.d <= d) v = x.v; else break; }
      if (v != null) covered.push({ id, v });
    }
    hold('QUAL', covered.sort((a, b) => b.v - a.v).slice(0, TOP).map(x => x.id));
    holdNoCost('EW covered (QUAL benchmark)', covered.map(x => x.id));

    // TREND.
    {
      const b = book('TREND (SPY or cash)');
      let sma = 0; for (let j = s - 209; j <= s; j++) sma += C[spy][j]; sma /= 210;
      const r = C[spy][s] > sma ? C[spy][e] / O[spy][s + 1] - 1 : 0;
      b.months.push({ d, r }); b.eq.push(b.eq[b.eq.length - 1] * (1 + r));
    }
  }

  const stats = (b: Book) => {
    const total = (b.eq[b.eq.length - 1] - 1) * 100;
    let peak = 1, dd = 0; for (const v of b.eq) { peak = Math.max(peak, v); dd = Math.min(dd, v / peak - 1); }
    const h = [0, 1].map(k => (b.months.filter(m => (m.d < CUT) === (k === 0)).reduce((a, m) => a * (1 + m.r), 1) - 1) * 100);
    const win = (100 * b.months.filter(m => m.r > 0).length) / b.months.length;
    return { total, dd: dd * 100, h, win };
  };
  const S = Object.fromEntries(Object.entries(books).map(([k, b]) => [k, stats(b)]));
  const f = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
  console.log(`${forms.length} monthly rebalances, ${sessions[forms[0]]} to ${sessions[forms[forms.length - 1]]}\n`);
  for (const [k, v] of Object.entries(S)) console.log(`${k.padEnd(30)} total ${f(v.total).padStart(8)}  worst drop ${f(v.dd).padStart(7)}  periods ${f(v.h[0])} / ${f(v.h[1])}  months up ${v.win.toFixed(0)}%`);
  const spyS = S['SPY'];
  console.log('');
  for (const k of ['MOM', 'PEAD', 'QUAL']) {
    const v = S[k]; const bench = k === 'QUAL' ? S['EW covered (QUAL benchmark)'] : S['EW universe'];
    const pass = v.h[0] > spyS.h[0] && v.h[1] > spyS.h[1] && v.total > bench.total;
    console.log(`${k}: ${pass ? 'PASS' : 'fail'} (vs SPY ${f(v.h[0])} / ${f(v.h[1])} against ${f(spyS.h[0])} / ${f(spyS.h[1])}; vs its equal-weight benchmark ${f(v.total)} against ${f(bench.total)})`);
  }
  const t = S['TREND (SPY or cash)'];
  console.log(`TREND: ${t.dd >= spyS.dd + 5 && t.total >= 0.8 * spyS.total ? 'PASS' : 'fail'} (worst drop ${f(t.dd)} vs SPY ${f(spyS.dd)}; return ${f(t.total)} vs ${f(spyS.total)})`);
  fs.writeFileSync(path.join(DATA, 'replay', 'textbook.json'), JSON.stringify(S, null, 1));
}

main();

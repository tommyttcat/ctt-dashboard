// analyst-loop.mjs — KV read/write via Upstash REST API (no deps needed)
//
//   node scripts/analyst-loop.mjs read       → dumps full snapshot JSON to stdout (~200KB)
//   node scripts/analyst-loop.mjs digest     → dumps a trimmed snapshot (scanner KV only)
//   node scripts/analyst-loop.mjs digest-full → digest + live data from deployed API routes
//                                              (macro, sectors, earnings, econ, news,
//                                               t2108, chop, gappers)
//   node scripts/analyst-loop.mjs write      → reads analysis JSON from stdin, writes to KV

const REST_URL = 'https://charming-cockatoo-144873.upstash.io';
const REST_TOKEN = 'gQAAAAAAAjXpAAIgcDEyZDUwZjE1NDAzMDg0MzNjYjkyNjVjZmI2OTRlMTI4Yw';
const BRIEF_KEY = 'analyst_brief_v1';
const BRIEF_TTL = null; // no expiry — persist over weekends

const DEPLOY_ORIGIN = 'https://ctt-dashboard.vercel.app';
const CRON_SECRET = 'ThomasScannerEngine2026!';

const KEYS = [
  'stocks_in_play_v6', 'daily_setups_v6', 'top_movers_v6',
  'macro_insights_v6', 'benchmark_v6', 'market_breadth_v6',
  'last_scan_time_v6', 'consol_1021_v1', 'ep9m_v1',
  'swing_candidates_v1', 'vcp_v1'
];

async function kvGet(key) {
  const res = await fetch(`${REST_URL}/get/${key}`, {
    headers: { Authorization: `Bearer ${REST_TOKEN}` },
  });
  const data = await res.json();
  if (data.result === null) return null;
  if (typeof data.result === 'string') {
    try { return JSON.parse(data.result); } catch { return data.result; }
  }
  return data.result;
}

async function kvPost(commands) {
  const res = await fetch(`${REST_URL}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });
  return res.json();
}

// Field allowlists for `digest`. Anything not listed here — cnfBreakdown,
// scoreBreakdown, dotKind/dotStochK/dotBarsSince, rme/rmeExtPct/rmeSampled,
// null earnings fields, etc. — is debug/derived noise that bloated `read`
// past what the Read tool (or a human) can look at directly, which is what
// forced every caller to write a fresh ad-hoc parsing script per run.
const STOCK_FIELDS = [
  'ticker', 'symbol', 'sector', 'price', 'changePct', 'rvol', 'vol', 'dVol',
  'atrPct', 'adrPct', 'stage', 'setupName', 'catalyst', 'catalystUrl', 'thesis',
  'newsPublisher', 'newsAge', 'stochK', 'chop14',
  'ema10', 'ema21', 'ema21Rising', 'goldenCross', 'pctOffHigh', 'gapPct',
  'rsVsMkt', 'rsRating', 'cnfScore', 'cnfGrade', 'plan', 'shortPct',
  'daysToCover', 'extended', 'priorSwingHigh', 'vwapStatus',
];
const VCP_FIELDS = [
  'symbol', 'sector', 'price', 'changePct', 'rvol', 'vol', 'atrPct',
  'stage', 'status', 'pivot', 'trigger', 'stop', 'target', 'score', 'grade', 'rsRating',
  'contractionCount', 'depths', 'baseLengthBars',
  'priorMovePct', 'volumeDryingRatio', 'pctToPivot',
  'catalyst', 'catalystUrl', 'thesis', 'newsPublisher', 'newsAge',
];
const CONSOL_FIELDS = [
  ...STOCK_FIELDS, 'coilRatio', 'coilDays', 'ema1021GapPct',
];
const MOVER_FIELDS = ['ticker', 'sector', 'price', 'changePct', 'rvol', 'mktCap'];

// Thesis/catalyst prose is the highest-value field per byte but the
// longest — cap it so one verbose entry can't blow the digest budget.
const clip = (s, max = 220) => (typeof s === 'string' && s.length > max) ? s.slice(0, max - 1) + '…' : s;

const pick = (obj, fields) => {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const f of fields) {
    if (obj[f] === undefined || obj[f] === null) continue;
    out[f] = (f === 'thesis' || f === 'catalyst') ? clip(obj[f]) : obj[f];
  }
  return out;
};
const pickList = (arr, fields) => Array.isArray(arr) ? arr.map(o => pick(o, fields)) : arr;

// Sort by whatever score-like field the dataset has and keep the top N —
// the brief only ever uses the leaders, and this is what keeps `digest`
// small enough to read in one shot instead of needing a parsing script.
const topN = (arr, n, scoreFn) =>
  Array.isArray(arr) ? arr.slice().sort((a, b) => scoreFn(b) - scoreFn(a)).slice(0, n) : arr;

async function fetchRoute(path) {
  try {
    const res = await fetch(`${DEPLOY_ORIGIN}${path}`, {
      headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchLiveData() {
  const [macro, sectors, earnings, econ, news, t2108, chop, gappers] = await Promise.all([
    fetchRoute('/api/macro'),
    fetchRoute('/api/sectors'),
    fetchRoute('/api/earnings'),
    fetchRoute('/api/econ'),
    fetchRoute('/api/news'),
    fetchRoute('/api/t2108/latest'),
    fetchRoute('/api/chop'),
    fetchRoute('/api/gappers'),
  ]);
  return { macro, sectors, earnings, econ, news, t2108, chop, gappers };
}

function trimEarnings(data) {
  if (!Array.isArray(data)) return [];
  const today = new Date().toISOString().slice(0, 10);
  return data
    .filter(e => e.date === today || e.reportingDate === today || e.date?.startsWith(today))
    .map(e => ({
      symbol: e.symbol, date: e.date || e.reportingDate,
      time: e.when || e.time || null,
      epsEstimated: e.epsEstimated ?? null,
      revenueEstimated: e.revenueEstimated ?? null,
    }))
    .slice(0, 30);
}

function trimEcon(data) {
  if (!Array.isArray(data)) return [];
  const today = new Date().toISOString().slice(0, 10);
  return data
    .filter(e => {
      const d = (e.date || '').slice(0, 10);
      return d === today;
    })
    .map(e => ({
      event: e.event, date: e.date, country: e.country,
      impact: e.impact, actual: e.actual, previous: e.previous, estimate: e.estimate,
    }))
    .slice(0, 20);
}

function trimNews(data) {
  const results = data?.results || data?.news || (Array.isArray(data) ? data : []);
  return results.slice(0, 12).map(n => ({
    title: n.title || n.headline,
    ticker: n.parsedTicker || (n.tickers?.[0]) || null,
    sentiment: n.sentiment || null,
    impact: n.impact || null,
    published: n.published_utc || n.date || null,
  }));
}

function trimGappers(data) {
  if (!data) return null;
  return {
    phase: data.phase,
    gappersUp: (data.gappersUp || []).slice(0, 10),
    gappersDown: (data.gappersDown || []).slice(0, 10),
    totalGapUp: data.totalGapUp || 0,
    totalGapDown: data.totalGapDown || 0,
  };
}

function trimSectors(data) {
  if (!data) return null;
  const snap = data.snapshot || data;
  if (!snap || typeof snap !== 'object') return null;
  const sectors = snap.sectors || snap.sectorPerformance || [];
  if (Array.isArray(sectors)) {
    return sectors.map(s => ({
      sector: s.sector || s.name, changePct: s.changesPercentage ?? s.changePct ?? s.change ?? 0,
    })).slice(0, 15);
  }
  return snap;
}

function buildDigest(data) {
  const movers = data.top_movers_v6 || {};
  const trimmedMovers = {};
  for (const cat of Object.keys(movers)) {
    trimmedMovers[cat] = pickList(topN(movers[cat], 6, (s) => Math.abs(Number(s?.changePct) || 0)), MOVER_FIELDS);
  }

  return {
    stocks_in_play_v6: pickList(data.stocks_in_play_v6, STOCK_FIELDS),
    daily_setups_v6: pickList(data.daily_setups_v6, STOCK_FIELDS),
    ep9m_v1: pickList(data.ep9m_v1, STOCK_FIELDS),
    vcp_v1: pickList(topN(data.vcp_v1, 10, (s) => Number(s?.score) || 0), VCP_FIELDS),
    consol_1021_v1: pickList(topN(data.consol_1021_v1, 10, (s) => Number(s?.score) || 0), CONSOL_FIELDS),
    swing_candidates_v1: pickList(data.swing_candidates_v1, CONSOL_FIELDS),
    top_movers_v6: trimmedMovers,
    macro_insights_v6: data.macro_insights_v6,
    benchmark_v6: data.benchmark_v6,
    market_breadth_v6: data.market_breadth_v6,
    last_scan_time_v6: data.last_scan_time_v6,
  };
}

async function main() {
  const cmd = process.argv[2] || 'read';

  if (cmd === 'read' || cmd === 'digest' || cmd === 'digest-full') {
    const results = await Promise.all(KEYS.map(k => kvGet(k)));
    const data = {};
    KEYS.forEach((k, i) => { data[k] = results[i]; });

    if (cmd === 'read') {
      process.stdout.write(JSON.stringify(data));
    } else if (cmd === 'digest') {
      process.stdout.write(JSON.stringify(buildDigest(data)));
    } else {
      const digest = buildDigest(data);
      const live = await fetchLiveData();
      digest.live = {
        macro: live.macro || null,
        sectors: trimSectors(live.sectors),
        earnings_today: trimEarnings(live.earnings),
        econ_today: trimEcon(live.econ),
        news: trimNews(live.news),
        t2108: live.t2108 || null,
        chop: live.chop || null,
        gappers: trimGappers(live.gappers),
      };
      process.stdout.write(JSON.stringify(digest));
    }

  } else if (cmd === 'write') {
    let input = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) input += chunk;
    const briefStr = input.trim();
    // Validate JSON
    JSON.parse(briefStr);
    const cmd = BRIEF_TTL
      ? ['SET', BRIEF_KEY, briefStr, 'EX', String(BRIEF_TTL)]
      : ['SET', BRIEF_KEY, briefStr];
    const result = await kvPost([cmd]);
    process.stdout.write(JSON.stringify({ success: true, result }));

  } else {
    process.stderr.write('Usage: node analyst-loop.mjs [read|digest|digest-full|write]\n');
    process.exit(1);
  }
}

main().catch(e => { process.stderr.write(e.message + '\n'); process.exit(1); });

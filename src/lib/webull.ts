// Webull OpenAPI client (server-side only).
//
// Signs requests the way the official webull-openapi-python-sdk does
// (webull/core/auth/composer/default_signature_composer.py, HMAC-SHA256
// variant), so this file is a faithful port rather than a guess:
//
//   string_to_sign = urlquote( uri + "&" + sorted("k=v" of signed headers + query) )
//   signature      = base64( HMAC-SHA256( app_secret + "&", string_to_sign ) )
//
// Signed headers are x-app-key, x-timestamp, x-signature-version,
// x-signature-algorithm, x-signature-nonce and the Host — lower-cased and
// sorted alongside the query params. The app secret never leaves this module.
//
// Entitlement: the account holds Nasdaq Basic (Level 1). Snapshots, bars and
// the fundamentals endpoints (capital flow) work on it; Level 2 / footprint /
// futures do not and are not wrapped here.

import { createHash, createHmac, randomUUID } from 'crypto';

const HOST = 'api.webull.com';
const VERSION = 'v3';

export type WebullSnapshot = {
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  preClose: number;
  change: number;
  changeRatio: number;
  lastTradeTime: number | null;
  /* Pre-market / after-hours print. Present when extend_hour_required=true
     and there has been an extended-session trade today. */
  extPrice: number | null;
  extVolume: number | null;
  extLastTradeTime: number | null;
  /* Overnight session (8pm–4am ET). Present when overnight_required=true. */
  ovnPrice: number | null;
  delayMinutes: number | null;
};

export type WebullCapitalFlowDay = {
  date: string; // YYYYMMDD
  largeIn: number;
  largeOut: number;
  mediumIn: number;
  mediumOut: number;
  smallIn: number;
  smallOut: number;
};

export function webullConfigured(): boolean {
  return Boolean((process.env.WEBULL_APP_KEY || '').trim() && (process.env.WEBULL_APP_SECRET || '').trim());
}

/* Python's urllib.parse.quote(s, safe='') — everything except A-Z a-z 0-9 - . _ ~
   becomes %XX. encodeURIComponent leaves ! ' ( ) * alone, so patch those. */
function pyQuote(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function isoSeconds(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function buildSignedHeaders(uri: string, query: Record<string, string>, body?: string): Record<string, string> {
  const appKey = (process.env.WEBULL_APP_KEY || '').trim();
  const appSecret = (process.env.WEBULL_APP_SECRET || '').trim();
  if (!appKey || !appSecret) throw new Error('WEBULL_APP_KEY / WEBULL_APP_SECRET not set');

  const signHeaders: Record<string, string> = {
    'x-app-key': appKey,
    'x-timestamp': isoSeconds(),
    'x-signature-version': '1.0',
    'x-signature-algorithm': 'HMAC-SHA256',
    'x-signature-nonce': randomUUID(),
  };

  const signParams: Record<string, string> = { ...signHeaders, host: HOST };
  for (const [k, v] of Object.entries(query)) {
    signParams[k] = signParams[k] != null ? `${signParams[k]}&${v}` : String(v);
  }
  const sorted = Object.keys(signParams)
    .sort()
    .map((k) => `${k}=${signParams[k]}`)
    .join('&');
  /* POST bodies are signed by appending the upper-cased SHA-256 hex of the
     compact JSON, exactly as the SDK's _get_body_string does. */
  const bodyPart = body != null ? `&${createHash('sha256').update(body).digest('hex').toUpperCase()}` : '';
  const stringToSign = pyQuote(`${uri}&${sorted}${bodyPart}`);
  const signature = createHmac('sha256', `${appSecret}&`).update(stringToSign).digest('base64');

  return {
    ...signHeaders,
    'x-signature': signature,
    'x-version': VERSION,
    'x-webull-client-source': 'sdk',
    'User-Agent': 'ctt-dashboard',
    Accept: 'application/json',
  };
}

export async function webullGet<T = any>(uri: string, query: Record<string, string>, timeoutMs = 8000): Promise<T> {
  return webullRequest<T>('GET', uri, query, undefined, timeoutMs);
}

export async function webullPost<T = any>(uri: string, body: Record<string, unknown>, timeoutMs = 8000): Promise<T> {
  return webullRequest<T>('POST', uri, {}, body, timeoutMs);
}

async function webullRequest<T>(
  method: 'GET' | 'POST',
  uri: string,
  query: Record<string, string>,
  body: Record<string, unknown> | undefined,
  timeoutMs: number,
): Promise<T> {
  const bodyText = body != null ? JSON.stringify(body) : undefined;
  const headers = buildSignedHeaders(uri, query, bodyText);
  if (bodyText != null) headers['Content-Type'] = 'application/json';
  const qs = new URLSearchParams(query).toString();
  const url = `https://${HOST}${uri}${qs ? `?${qs}` : ''}`;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers, body: bodyText, signal: controller.signal as any, cache: 'no-store' });
    const text = await res.text();
    if (!res.ok) throw new Error(`webull ${res.status} ${uri}: ${text.slice(0, 200)}`);
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(id);
  }
}

const num = (v: any): number => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: any): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

/* Real-time Level 1 snapshot. Max 100 symbols per call. `price` is the
   regular-session last; `extPrice` carries the pre/post print when one exists. */
export async function webullSnapshot(
  symbols: string[],
  category: 'US_STOCK' | 'US_ETF',
  opts: { extendedHours?: boolean; overnight?: boolean } = {},
): Promise<WebullSnapshot[]> {
  if (symbols.length === 0) return [];
  const query: Record<string, string> = { symbols: symbols.join(','), category };
  if (opts.extendedHours) query.extend_hour_required = 'true';
  if (opts.overnight) query.overnight_required = 'true';
  const raw = await webullGet<any[]>('/market-data/stocks/snapshots/list', query);
  return (Array.isArray(raw) ? raw : []).map((r) => ({
    symbol: String(r.symbol || ''),
    price: num(r.price),
    open: num(r.open),
    high: num(r.high),
    low: num(r.low),
    volume: num(r.volume),
    preClose: num(r.pre_close),
    change: num(r.change),
    changeRatio: num(r.change_ratio),
    lastTradeTime: numOrNull(r.last_trade_time),
    extPrice: numOrNull(r.extend_hour_last_price),
    extVolume: numOrNull(r.extend_hour_volume),
    extLastTradeTime: numOrNull(r.extend_hour_last_trade_time),
    ovnPrice: numOrNull(r.ovn_price),
    delayMinutes: numOrNull(r.delay_minutes),
  }));
}

/* Daily capital flow split by order size (large / medium / small, in and out,
   USD notional). One row per session, oldest first as Webull returns it. */
export async function webullCapitalFlow(symbol: string, count = 5): Promise<WebullCapitalFlowDay[]> {
  const raw = await webullGet<any[]>('/market-data/fundamentals/capital-flows/get', {
    symbol,
    category: 'US_STOCK',
    count: String(count),
  });
  return (Array.isArray(raw) ? raw : []).map((r) => ({
    date: String(r.date || ''),
    largeIn: num(r.large_in),
    largeOut: num(r.large_out),
    mediumIn: num(r.medium_in),
    mediumOut: num(r.medium_out),
    smallIn: num(r.small_in),
    smallOut: num(r.small_out),
  }));
}

export type WebullRankRow = {
  symbol: string;
  price: number;
  preClose: number;
  changeRatio: number; // fraction, e.g. 0.0721 = +7.21%
  volume: number;
  marketValue: number;
  exchangeCode: string;
};

/* Market-wide gainers/losers ranking, computed server-side by Webull. The
   PRE_MARKET and AFTER_MARKET rank types measure the extended session itself,
   which is what a "gapper" list needs and what a delayed RTH snapshot cannot
   give. Non-paginated v3 endpoint: top 200 rows. */
export async function webullGainersLosers(
  rankType: 'PRE_MARKET' | 'AFTER_MARKET' | 'DAY_1',
  side: 'gainers' | 'losers',
): Promise<WebullRankRow[]> {
  const raw = await webullGet<any>('/market-data/screeners/gainers-losers/list', {
    rank_type: rankType,
    category: 'US_STOCK',
    sort_by: 'CHANGE_RATIO',
    direction: side === 'gainers' ? 'DESC' : 'ASC',
  }, 10000);
  const rows: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];
  return rows.map((r) => ({
    symbol: String(r.symbol || ''),
    price: num(r.price),
    preClose: num(r.pre_close),
    changeRatio: num(r.change_ratio),
    volume: num(r.volume),
    marketValue: num(r.market_value),
    exchangeCode: String(r.exchange_code || ''),
  }));
}

export type WebullBar = { t: number; o: number; h: number; l: number; c: number; v: number };
export type WebullTimespan = 'M1' | 'M5' | 'M15' | 'M30' | 'M60' | 'M120' | 'M240' | 'D' | 'W' | 'M' | 'Y';

/* Historical bars for one symbol, returned OLDEST FIRST with millisecond
   timestamps (Webull returns newest first with ISO strings). Closed bars only
   unless `includeForming` is set. `sessions` selects which trading sessions
   the intraday bars cover — omit for regular hours only. Max 1200 bars. */
export async function webullBars(
  symbol: string,
  timespan: WebullTimespan,
  count: number,
  opts: { sessions?: Array<'PRE' | 'RTH' | 'ATH' | 'OVN'>; includeForming?: boolean; category?: 'US_STOCK' | 'US_ETF' } = {},
): Promise<WebullBar[]> {
  /* The batch endpoint (POST, JSON body) is the one that answers on
     api.webull.com; the single-symbol GET variant in the SDK 404s there. One
     symbol per call keeps this helper's contract simple. */
  const body: Record<string, unknown> = {
    symbols: [symbol],
    category: opts.category || 'US_STOCK',
    timespan,
    count: String(Math.min(Math.max(1, Math.floor(count)), 1200)),
  };
  if (opts.sessions?.length) body.trading_sessions = opts.sessions.join(',');
  if (opts.includeForming) body.real_time_required = true;
  const raw = await webullPost<any>('/market-data/stocks/bars/list', body, 10000);
  /* Batch shape: { result: [ { symbol, result: [bars...] } ] }. Also accept a
     bare array in case the server ever answers in the single-symbol shape. */
  let rows: any[] = [];
  if (Array.isArray(raw)) rows = raw;
  else if (Array.isArray(raw?.result)) {
    const mine = raw.result.find((r: any) => r?.symbol === symbol) ?? raw.result[0];
    rows = mine && Array.isArray(mine?.result) ? mine.result : raw.result;
  }
  const bars: WebullBar[] = [];
  for (const r of rows) {
    const t = Date.parse(r.time);
    const o = num(r.open), h = num(r.high), l = num(r.low), c = num(r.close), v = num(r.volume);
    if (!Number.isFinite(t) || !(c > 0)) continue;
    bars.push({ t, o, h, l, c, v });
  }
  bars.sort((a, b) => a.t - b.t);
  return bars;
}

const etDate = (ms: number): string =>
  new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

/* Daily bars PLUS today's session as a forming bar. Webull's bars endpoint
   only serves closed daily bars (real_time_required applies to minute bars),
   which would leave every daily-bar consumer a session behind while the
   market is open. The snapshot carries today's open/high/low/last/volume, so
   when its last trade is today and no bar for today exists, one is appended.
   Timestamped like Webull's daily bars: midnight ET as 04:00 UTC. */
export async function webullDailyBarsWithToday(
  symbol: string,
  count: number,
  opts: { category?: 'US_STOCK' | 'US_ETF' } = {},
): Promise<WebullBar[]> {
  const [bars, snaps] = await Promise.all([
    webullBars(symbol, 'D', count, { category: opts.category }),
    webullSnapshot([symbol], opts.category || 'US_STOCK').catch(() => [] as WebullSnapshot[]),
  ]);
  const snap = snaps.find((s) => s.symbol === symbol);
  if (!snap || !(snap.price > 0) || snap.lastTradeTime == null) return bars;
  const today = etDate(snap.lastTradeTime);
  const last = bars[bars.length - 1];
  if (last && etDate(last.t) >= today) return bars;
  if (!(snap.open > 0) || !(snap.high > 0) || !(snap.low > 0)) return bars;
  const t = Date.parse(`${today}T04:00:00Z`);
  return [...bars, { t, o: snap.open, h: snap.high, l: snap.low, c: snap.price, v: snap.volume }];
}

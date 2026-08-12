import { NextResponse } from 'next/server';
import { Resend } from 'resend';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const PHASES = ['pre', 'morning', 'midday', 'closing'] as const;
type Phase = (typeof PHASES)[number];

const PHASE_LABELS: Record<Phase, string> = {
  pre: 'Pre-Market',
  morning: 'Morning',
  midday: 'Midday',
  closing: 'Closing',
};

function resolveOrigin(req: Request): string {
  try {
    const u = new URL(req.url);
    if (u.origin && u.origin !== 'null') return u.origin;
  } catch { /* fall through */ }
  const h = req.headers;
  const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000';
  const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

async function fetchJson(url: string) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

const CHOP_BANDS = { chop: 50, trend: 28, dead: 58, strongTrend: 20 };
const chopZone = (v: number) => v >= CHOP_BANDS.dead ? 'DEAD CHOP' : v >= CHOP_BANDS.chop ? 'CHOPPY' : v > CHOP_BANDS.trend ? 'MIXED' : v > CHOP_BANDS.strongTrend ? 'TRENDING' : 'STRONG TREND';
const t2108Zone = (v: number) => v <= 20 ? 'OVERSOLD' : v <= 35 ? 'WASHED' : v <= 65 ? 'NEUTRAL' : v <= 80 ? 'WARM' : 'OVERBOUGHT';

function bc(type: string) {
  switch (type) {
    case 'green': return { bg: '#064e3b', text: '#34d399', border: '#34d39950' };
    case 'red': return { bg: '#4c1111', text: '#fb7185', border: '#fb718550' };
    case 'amber': return { bg: '#78350f', text: '#fbbf24', border: '#fbbf2450' };
    case 'lime': return { bg: '#365320', text: '#a3e635', border: '#a3e63550' };
    case 'cyan': return { bg: '#0e4845', text: '#22d3ee', border: '#22d3ee50' };
    default: return { bg: '#1e293b', text: '#cbd5e1', border: '#ffffff20' };
  }
}

const toneType = (t: string) => t === 'BULLISH' ? 'green' : t === 'BEARISH' ? 'red' : 'amber';
const breadthType = (s: string) => s === 'GREEN' ? 'green' : s === 'RED' ? 'red' : 'amber';
const chopType = (v: number) => v >= CHOP_BANDS.dead ? 'red' : v >= CHOP_BANDS.chop ? 'amber' : v > CHOP_BANDS.trend ? 'slate' : 'green';
const t2108Type = (v: number) => v <= 20 ? 'green' : v <= 35 ? 'lime' : v <= 65 ? 'slate' : v <= 80 ? 'amber' : 'red';

const badge = (label: string, type: string) => {
  const c = bc(type);
  return `<span style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:6px 14px;border-radius:6px;border:1px solid ${c.border};background:${c.bg};color:${c.text};margin-right:8px;margin-bottom:6px;">${label}</span>`;
};

const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
const chgClr = (v: number) => v >= 0 ? '#34d399' : '#fb7185';
// Stage 1 = basing (neutral), 2 = uptrend (green), 3 = topping (amber), 4 = decline (red) —
// matches the brief's own "Stage 4B/4C = always bearish" rule, so a glance at STG tells the story.
const stageColor = (stageRaw: string) => {
  const n = String(stageRaw || '').match(/[1-4]/)?.[0];
  return n === '2' ? '#34d399' : n === '3' ? '#fbbf24' : n === '4' ? '#fb7185' : '#94a3b8';
};
const fmtVol = (v: number) => v >= 1e9 ? '$' + (v / 1e9).toFixed(1) + 'B' : v >= 1e6 ? '$' + (v / 1e6).toFixed(0) + 'M' : v > 0 ? '$' + (v / 1e3).toFixed(0) + 'K' : '';
const fmtVolShort = (v: number) => v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'K' : '—';

const SETUP_COLORS: Record<string, string> = {
  EP: '#818cf8', VCP: '#34d399', COIL: '#a3e635', SWING: '#fbbf24', MOM: '#fb923c', 'BB SQZ': '#f472b6',
};

const setupBadge = (setup: string) => {
  if (!setup) return '';
  const color = SETUP_COLORS[setup] || '#94a3b8';
  return `<span style="display:inline-block;font-size:9px;font-weight:700;letter-spacing:0.05em;padding:2px 6px;border-radius:3px;background:${color}20;color:${color};border:1px solid ${color}40;">${setup}</span>`;
};

const TH = 'padding:5px 8px;font-size:9px;color:#475569;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;border-bottom:1px solid #ffffff10;';
const TD = 'padding:5px 8px;font-size:11px;';

function renderMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#f1f5f9;">$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/not rising/gi, '<span style="color:#fbbf24;font-weight:700;">not rising</span>')
    .replace(/\n/g, '<br/>');
}

function regimeCard(title: string, borderColor: string, titleColor: string, text: string) {
  return sectionCard(title, borderColor, titleColor, renderMarkdown(text));
}

function sectionCard(title: string, borderColor: string, titleColor: string, bodyHtml: string) {
  return `<div style="margin-bottom:16px;border-radius:10px;border:1px solid #ffffff08;background:#0f172a;overflow:hidden;">
    <div style="border-left:4px solid ${borderColor};padding:16px 20px;">
      <div style="font-size:9px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${titleColor};margin-bottom:10px;">${title}</div>
      <div style="font-size:13px;color:#cbd5e1;line-height:1.65;">${bodyHtml}</div>
    </div>
  </div>`;
}

// Mirrors the Industry Heat / ETF Flow / Money Flow logic in MarketSummary.tsx —
// same field accessors so the email tells the same story as the dashboard.
const chgOf = (s: any): number => Number(s?.change ?? s?.changePct) || 0;
const dVolOf = (s: any): number => {
  const d = Number(s?.dVol);
  if (!isNaN(d) && d > 0) return d;
  const p = Number(s?.price) || 0;
  const v = Number(s?.volume ?? s?.vol) || 0;
  return p * v;
};
const isEtfSector = (sec: string | null | undefined): boolean => {
  if (!sec || sec === '—') return false;
  const s = String(sec);
  if (s === 'ETF' || s.includes('- ETF')) return true;
  if (/^[A-Z]{2,5}\s*-\s/.test(s)) return true;
  return false;
};

// Wraps bare ticker mentions inside free-prose text (regime/caution/posture
// paragraphs) in the same chip used everywhere else in the email. Only
// badges tokens that are in `known` — real tickers pulled from this run's
// data — so acronyms like EMA/RVOL/ETF never get mistaken for a symbol.
function badgeTickers(text: string, known: Set<string>): string {
  if (!text || known.size === 0) return text;
  return text.replace(/\b[A-Z]{1,6}(?:\.[A-Z]{1,2})?\b/g, (tok) =>
    known.has(tok)
      ? `<span style="display:inline-block;background:#1e293b;border:1px solid #ffffff10;border-radius:4px;padding:0 6px;font-size:12px;font-weight:700;color:#e2e8f0;">${tok}</span>`
      : tok
  );
}

function flowRow(s: any): string {
  const chg = chgOf(s);
  return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:4px 0;border-bottom:1px solid #ffffff05;">
    <span style="display:inline-block;background:#1e293b;border:1px solid #ffffff10;border-radius:4px;padding:1px 8px;font-size:11px;font-weight:700;color:#e2e8f0;min-width:40px;text-align:center;">${s.ticker}</span>
    <span style="color:${chg >= 0 ? '#34d399' : '#fb7185'};font-weight:700;">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</span>
    <span style="color:#94a3b8;">${fmtVol(dVolOf(s))}</span>
  </div>`;
}

function subhead(label: string): string {
  return `<div style="font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin:8px 0 3px;">${label}</div>`;
}

function buildIndustryHeatCard(pool: any[]): string {
  const agg: Record<string, { sum: number; count: number }> = {};
  pool.forEach((s) => {
    const sec = s?.sector && s.sector !== '—' && s.sector !== 'Other' && !isEtfSector(s.sector) ? String(s.sector) : null;
    if (!sec) return;
    if (!agg[sec]) agg[sec] = { sum: 0, count: 0 };
    agg[sec].sum += chgOf(s);
    agg[sec].count += 1;
  });
  const heat = Object.entries(agg)
    .map(([sector, v]) => ({ sector, avgChg: v.sum / v.count, count: v.count }))
    .sort((a, b) => b.avgChg - a.avgChg);
  if (heat.length < 2) return '';

  const hot = heat.filter((h) => h.avgChg > 0).slice(0, 4);
  const cold = heat
    .filter((h) => h.avgChg < 0)
    .slice(-4)
    .reverse();
  const heatRow = (h: { sector: string; avgChg: number; count: number }) =>
    `<div style="display:flex;justify-content:space-between;padding:3px 0;">
      <span style="color:${h.avgChg >= 0 ? '#34d399' : '#fb7185'};font-weight:700;">${h.avgChg >= 0 ? '+' : ''}${h.avgChg.toFixed(1)}%</span>
      <span style="color:#cbd5e1;">${h.sector} (${h.count})</span>
    </div>`;

  let footer = '';
  if (hot.length && cold.length) {
    footer = hot[0].avgChg - cold[0].avgChg >= 8
      ? "Wide dispersion between groups — a stock-picker's tape, stay in the leaders."
      : 'Group dispersion is narrow — moves are market-driven more than industry-driven.';
  } else if (hot.length) {
    footer = 'All tracked groups lean green — broad industry participation.';
  } else if (cold.length) {
    footer = 'All tracked groups lean red — no industry shelter today.';
  }

  const body = `
    ${hot.length ? `${subhead('Strongest')}${hot.map(heatRow).join('')}` : ''}
    ${cold.length ? `${subhead('Weakest')}${cold.map(heatRow).join('')}` : ''}
    <div style="margin-top:8px;color:#94a3b8;font-size:12px;">${footer}</div>
  `;
  return sectionCard('Industry Heat', '#fbbf24', '#fbbf24', body);
}

function buildEtfFlowCard(movers: any): string {
  const etfAll = [...(movers?.['ETF Gainers'] || []), ...(movers?.['ETF Losers'] || [])];
  const seen = new Set<string>();
  const etfs = etfAll
    .filter((e: any) => {
      if (!e?.ticker || seen.has(e.ticker)) return false;
      seen.add(e.ticker);
      return true;
    })
    .filter((e: any) => dVolOf(e) > 0)
    .sort((a: any, b: any) => dVolOf(b) - dVolOf(a));
  if (!etfs.length) return '';

  const upD = etfs.filter((e: any) => chgOf(e) > 0).reduce((a: number, e: any) => a + dVolOf(e), 0);
  const totD = etfs.reduce((a: number, e: any) => a + dVolOf(e), 0);
  const upShare = totD > 0 ? Math.round((upD / totD) * 100) : 0;
  const flowLine = upShare >= 60
    ? `${upShare}% of ETF dollars are on the advancing side — money is chasing strength.`
    : upShare <= 40
      ? `Only ${upShare}% of ETF dollars are on the advancing side — flows favor the short/defensive vehicles.`
      : `ETF dollars are split ${upShare}/${100 - upShare} between advancing and declining vehicles — no clean directional bet.`;

  const body = `${subhead('Heaviest Dollar Volume')}${etfs.slice(0, 4).map(flowRow).join('')}
    <div style="margin-top:8px;color:#94a3b8;font-size:12px;">${flowLine}</div>`;
  return sectionCard('ETF Flow', '#818cf8', '#818cf8', body);
}

function buildMoneyFlowCard(pool: any[]): string {
  const totalD = pool.reduce((a, s) => a + dVolOf(s), 0);
  if (totalD <= 0) return '';

  const advD = pool.filter((s) => chgOf(s) > 0).reduce((a, s) => a + dVolOf(s), 0);
  const advShare = Math.round((advD / totalD) * 100);
  const magnets = pool.slice().sort((a, b) => dVolOf(b) - dVolOf(a)).slice(0, 3);

  const inflowAgg: Record<string, number> = {};
  pool.filter((s) => chgOf(s) > 0).forEach((s) => {
    const sec = s?.sector && s.sector !== '—' && !isEtfSector(s.sector) ? String(s.sector) : null;
    if (sec) inflowAgg[sec] = (inflowAgg[sec] || 0) + dVolOf(s);
  });
  const topInflows = Object.entries(inflowAgg).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([sec]) => sec);

  const summaryLine = `${fmtVol(totalD)} in tracked dollar volume, ${advShare}% riding the advancing side` +
    (advShare >= 60 ? ' — buyers are paying up.' : advShare <= 40 ? " — sellers control the tape's dollars." : ' — a two-sided fight.');
  const inflowLine = topInflows.length ? `Inflows concentrate in ${topInflows.join(' & ')}.` : '';

  const body = `<div style="color:#cbd5e1;margin-bottom:8px;">${summaryLine}</div>
    ${magnets.length ? `${subhead('Dollar Magnets')}${magnets.map(flowRow).join('')}` : ''}
    ${inflowLine ? `<div style="margin-top:8px;color:#94a3b8;font-size:12px;">${inflowLine}</div>` : ''}`;
  return sectionCard('Money Flow', '#fb7185', '#fb7185', body);
}

function tradesTable(stocks: any[], showNotes: boolean = false) {
  if (!stocks?.length) return '';

  const rows = stocks.map((s: any) => {
    const chg = s.changePct ?? 0;
    const rv = s.rvol != null ? Number(s.rvol) : null;
    const dv = s.dVol ?? (s.price && s.vol ? s.price * s.vol : 0);
    const grade = s.grade || '';
    const gradeClr = grade === 'A' ? '#34d399' : grade === 'B' ? '#fbbf24' : '#64748b';
    const stage = (s.stage || '').replace(/Stage\s*/i, '') || '—';
    const rs = s.rs ?? s.rsRating ?? null;

    let noteHtml = '';
    if (showNotes && s.thesis) {
      const thesis = String(s.thesis);
      const waitMatch = thesis.match(/(wait for .+?)(?:\.|$)/i) || thesis.match(/(near pivot.+?)(?:\.|$)/i);
      if (waitMatch) {
        noteHtml = `<td style="${TD}color:#64748b;font-size:10px;font-style:italic;text-align:right;white-space:nowrap;">${waitMatch[1]}</td>`;
      }
    }

    return `<tr style="border-bottom:1px solid #ffffff05;">
      <td style="${TD}font-weight:700;color:${gradeClr};text-align:center;width:20px;">${grade}</td>
      <td style="${TD}font-weight:700;color:#e2e8f0;white-space:nowrap;">
        <span style="display:inline-block;background:#1e293b;border:1px solid #ffffff10;border-radius:4px;padding:1px 8px;font-size:11px;min-width:40px;text-align:center;">${s.ticker}</span>
      </td>
      <td style="${TD}text-align:center;">${s.score ? `<span style="display:inline-block;background:${gradeClr}18;border:1px solid ${gradeClr}40;border-radius:3px;padding:1px 5px;font-size:10px;font-weight:700;color:${gradeClr};">${s.score}</span>` : ''}</td>
      <td style="${TD}text-align:center;">${setupBadge(s.setup || '')}</td>
      <td style="${TD}font-weight:700;color:${chgClr(chg)};text-align:right;">${fmtPct(chg)}</td>
      <td style="${TD}color:${rv != null && rv >= 2 ? '#34d399' : '#94a3b8'};text-align:right;font-weight:${rv != null && rv >= 2 ? '700' : '400'};">${rv != null ? rv.toFixed(2) : '—'}</td>
      <td style="${TD}color:#94a3b8;text-align:right;">${fmtVolShort(s.vol || 0)}</td>
      <td style="${TD}color:#94a3b8;text-align:right;">${fmtVol(dv)}</td>
      <td style="${TD}color:${stageColor(stage)};font-weight:700;text-align:center;">${stage}</td>
      <td style="${TD}color:${rs != null && rs >= 80 ? '#34d399' : '#94a3b8'};font-weight:${rs != null && rs >= 80 ? '700' : '400'};text-align:right;">${rs ?? '—'}</td>
      ${noteHtml}
    </tr>`;
  }).join('');

  const headers = `<tr>
    <th style="${TH}text-align:center;"></th>
    <th style="${TH}text-align:left;">TICKER</th>
    <th style="${TH}text-align:center;">CNF</th>
    <th style="${TH}text-align:center;"></th>
    <th style="${TH}text-align:right;">CHG%</th>
    <th style="${TH}text-align:right;">RVOL</th>
    <th style="${TH}text-align:right;">VOL</th>
    <th style="${TH}text-align:right;">$VOL</th>
    <th style="${TH}text-align:center;">STG</th>
    <th style="${TH}text-align:right;">RS</th>
    ${showNotes ? `<th style="${TH}text-align:right;"></th>` : ''}
  </tr>`;

  return `<table style="border-collapse:collapse;width:100%;">${headers}${rows}</table>`;
}

function trapsTable(stocks: any[]) {
  if (!stocks?.length) return '';

  const rows = stocks.map((s: any) => {
    const chg = s.changePct ?? 0;
    const stage = (s.stage || '').replace(/Stage\s*/i, '') || '—';
    const reason = s.reason || '';
    const shortReason = reason.length > 80 ? reason.slice(0, 77) + '...' : reason;

    return `<tr style="border-bottom:1px solid #ffffff05;">
      <td style="${TD}font-weight:700;white-space:nowrap;">
        <span style="display:inline-block;background:#4c1111;border:1px solid #fb718530;border-radius:4px;padding:1px 8px;font-size:11px;color:#fb7185;min-width:40px;text-align:center;">${s.ticker}</span>
      </td>
      <td style="${TD}font-weight:700;color:${chgClr(chg)};text-align:right;white-space:nowrap;">${fmtPct(chg)}</td>
      <td style="${TD}color:${stageColor(stage)};text-align:center;font-weight:700;">${stage}</td>
      <td style="${TD}color:#64748b;font-size:10px;line-height:1.4;">${shortReason}</td>
    </tr>`;
  }).join('');

  return `<table style="border-collapse:collapse;width:100%;">
    <tr>
      <th style="${TH}text-align:left;">TICKER</th>
      <th style="${TH}text-align:right;">CHG%</th>
      <th style="${TH}text-align:center;">STG</th>
      <th style="${TH}text-align:left;"></th>
    </tr>
    ${rows}
  </table>`;
}

function sectionTitle(title: string, borderColor: string, titleColor: string) {
  return `<div style="border-left:3px solid ${borderColor};padding-left:12px;margin-bottom:10px;">
    <div style="font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${titleColor};">${title}</div>
  </div>`;
}

function buildEmail(phase: Phase, macro: any, chop: any, t2108Data: any, brief: any, snapshot: any): string {
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const phaseLabel = PHASE_LABELS[phase];

  const quotes = macro?.quotes || {};
  const getPct = (id: string) => quotes[id]?.pct || 0;

  // Tone
  const eqScore = (getPct('SPY') * 3.0) + (getPct('QQQ') * 2.5) + (getPct('IWM') * 1.0);
  const vixPct = getPct('VIX');
  const volScore = Math.abs(vixPct) > 2 ? (vixPct * -0.6) : 0;
  const cryptoScore = (getPct('BTC') * 0.25);
  const bData = macro?.breadth;
  const breadthAdj = bData ? ((bData.score - 3) / 3) * 1.5 : 0;
  const totalScore = eqScore + volScore + cryptoScore + breadthAdj;
  const tone = totalScore >= 1.0 ? 'BULLISH' : totalScore <= -1.0 ? 'BEARISH' : 'NEUTRAL';

  // Chop
  let chopVal: number | null = null;
  if (chop?.success) {
    const raw = chop.daily?.blended ?? chop.blended ?? null;
    if (raw != null) {
      let adj = 0;
      if (bData && typeof bData.score === 'number') {
        const centrality = 1 - Math.abs(bData.score - 3) / 3;
        adj += (centrality - 0.5) * 2 * 3;
      }
      chopVal = Math.max(0, Math.min(100, raw + adj));
    }
  }

  const tVal = t2108Data?.value ?? null;

  // Badges
  let badgesHtml = badge(`TONE: ${tone}`, toneType(tone));
  if (bData) badgesHtml += badge(`BREADTH ${bData.score}/6`, breadthType(bData.signal));
  if (chopVal != null) badgesHtml += badge(`CHOP: ${chopZone(chopVal)} ${chopVal.toFixed(0)}`, chopType(chopVal));
  if (tVal != null) badgesHtml += badge(`T2108 ${t2108Zone(tVal)}`, t2108Type(tVal));

  // Industry Heat / ETF Flow / Money Flow — same pool + accessors as the
  // dashboard's MarketSummary.tsx, built from the raw scanner snapshot.
  const sip = snapshot?.stocksInPlay || {};
  const movers = sip?.topMovers || {};
  const ep9mList: any[] = Array.isArray(snapshot?.ep9m?.candidates) ? snapshot.ep9m.candidates : [];
  const flowStockLists = [
    ...(Array.isArray(sip.stocksInPlay) ? sip.stocksInPlay : []),
    ...(Array.isArray(sip.dailySetups) ? sip.dailySetups : []),
    ...ep9mList,
    ...(movers['Gainers'] || []), ...(movers['Losers'] || []), ...(movers['Mega Caps'] || []),
  ];
  const flowSeen = new Set<string>();
  const flowPool = flowStockLists.filter((s: any) => {
    if (!s?.ticker || flowSeen.has(s.ticker)) return false;
    flowSeen.add(s.ticker);
    return true;
  });
  const heatHtml = buildIndustryHeatCard(flowPool);
  const etfFlowHtml = buildEtfFlowCard(movers);
  const moneyFlowHtml = buildMoneyFlowCard(flowPool);

  // Stock sections from brief
  const sections = brief?.sections || [];
  const summary = brief?.summary || {};

  const topTrades = sections.find((s: any) => s.section === 'Top Trades')?.stocks || [];
  const topAvoid = sections.find((s: any) => s.section === 'Top Avoid')?.stocks || [];

  // Every ticker we actually know about — used to badge ticker mentions
  // inside the free-prose regime/caution/posture paragraphs below.
  const knownTickers = new Set<string>([
    ...topTrades.map((s: any) => s.ticker),
    ...topAvoid.map((s: any) => s.ticker),
    ...flowPool.map((s: any) => s.ticker),
    ...Object.keys(quotes),
  ].filter(Boolean));

  // New brief sections
  const SECTION_COLORS: Record<string, { border: string; title: string }> = {
    'Futures & Macro Snapshot': { border: '#22d3ee', title: '#22d3ee' },
    'Key News & Catalysts': { border: '#a78bfa', title: '#a78bfa' },
    'Top Sectors & Money Flow': { border: '#fbbf24', title: '#fbbf24' },
    'Pre-Market Gappers': { border: '#34d399', title: '#34d399' },
    'Post-Market Gappers': { border: '#34d399', title: '#34d399' },
    'Stocks in Play Today': { border: '#818cf8', title: '#818cf8' },
    'Sentiment & Market Breadth': { border: '#fb7185', title: '#fb7185' },
    'Technical Analysis & VPCI': { border: '#94a3b8', title: '#94a3b8' },
    'Economic Data & Catalysts Today': { border: '#fb923c', title: '#fb923c' },
    "Today's Earnings Calendar": { border: '#a3e635', title: '#a3e635' },
  };

  const extraSectionsHtml = sections
    .filter((s: any) => !['Market Regime', 'Top Trades', 'Top Avoid'].includes(s.section))
    .map((sec: any) => {
      const colors = SECTION_COLORS[sec.section] || { border: '#94a3b8', title: '#94a3b8' };
      const analysisHtml = sec.analysis ? renderMarkdown(badgeTickers(sec.analysis, knownTickers)) : '';
      return sectionCard(sec.section, colors.border, colors.title, analysisHtml);
    })
    .join('');

  // Regime cards
  const rd = brief?.regimeDetail || {};
  const regimeHtml = rd.regime ? regimeCard('Regime Assessment', '#22d3ee', '#22d3ee', badgeTickers(rd.regime, knownTickers)) : '';
  const cautionHtml = rd.caution ? regimeCard('Caution Flag', '#fbbf24', '#fbbf24', badgeTickers(rd.caution, knownTickers)) : '';
  const postureHtml = rd.posture ? regimeCard('Posture', '#34d399', '#34d399', badgeTickers(rd.posture, knownTickers)) : '';

  // Split trades into conviction vs watchlist — summary.conviction is a prose
  // string with **TICKER** call-outs, so pull every bolded ticker out of it.
  const convictionText = String(summary.conviction || '');
  const convictionTickers = new Set(
    Array.from(convictionText.matchAll(/\*\*([A-Z]{1,6})\*\*/g)).map((m) => m[1])
  );

  const conviction = topTrades.filter((s: any) => convictionTickers.has(s.ticker));
  const watchlist = topTrades.filter((s: any) => !convictionTickers.has(s.ticker));

  // Build conviction section
  let convictionHtml = '';
  if (conviction.length) {
    convictionHtml = `<div style="margin:24px 0;">
      ${sectionTitle('Highest Conviction', '#22d3ee', '#22d3ee')}
      ${tradesTable(conviction)}
    </div>`;
  }

  // Build watchlist section
  let watchlistHtml = '';
  if (watchlist.length) {
    watchlistHtml = `<div style="margin:24px 0;">
      ${sectionTitle('Watchlist — Not Yet Actionable', '#64748b', '#94a3b8')}
      ${tradesTable(watchlist, true)}
    </div>`;
  }

  // Build traps section
  let trapsHtml = '';
  if (topAvoid.length) {
    trapsHtml = `<div style="margin:24px 0;">
      ${sectionTitle('Traps to Avoid', '#fb7185', '#fb7185')}
      ${trapsTable(topAvoid.slice(0, 8))}
    </div>`;
  }

  // Updated time from brief
  const updatedTime = brief?.snapshotTime
    ? new Date(brief.snapshotTime).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
    : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#05080f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:700px;margin:0 auto;padding:24px 16px;">
    <div style="border-top:3px solid;border-image:linear-gradient(90deg,#06b6d4,#34d399,#818cf8) 1;padding-top:20px;margin-bottom:24px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
        <img src="https://ctt-dashboard.vercel.app/logo.svg" alt="CTT" style="height:28px;width:auto;" />
        <h1 style="font-size:18px;font-weight:800;color:#f1f5f9;margin:0;">Confluence Trading Tools Market Briefing</h1>
      </div>
      <div style="font-size:11px;color:#64748b;margin-bottom:16px;">${phaseLabel} · ${now} ET${updatedTime ? ` · Updated ${updatedTime} ET` : ''}</div>
      <div style="margin-bottom:8px;">${badgesHtml}</div>
    </div>

    ${regimeHtml}
    ${cautionHtml}
    ${postureHtml}

    ${extraSectionsHtml}

    ${heatHtml}
    ${etfFlowHtml}
    ${moneyFlowHtml}

    ${convictionHtml}
    ${watchlistHtml}
    ${trapsHtml}

    <div style="border-top:1px solid #ffffff10;padding-top:16px;margin-top:24px;">
      <div style="font-size:10px;color:#475569;text-align:center;">
        Confluence Trading Tools · Not investment advice · Scanner data only
      </div>
    </div>
  </div>
</body>
</html>`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const phase = (url.searchParams.get('phase') || 'morning') as Phase;
  if (!PHASES.includes(phase)) {
    return NextResponse.json({ error: `Invalid phase. Use: ${PHASES.join(', ')}` }, { status: 400 });
  }

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.RESEND_API_KEY || '';
  if (!apiKey) {
    return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 });
  }

  const recipientEmail = process.env.BRIEFING_EMAIL || process.env.Email || 'thomasbeach@gmail.com';
  const origin = resolveOrigin(req);

  const [macro, chopData, t2108Data, brief, snapshotRes] = await Promise.all([
    fetchJson(`${origin}/api/macro`),
    fetchJson(`${origin}/api/chop?t=${Date.now()}`),
    fetchJson(`${origin}/api/t2108/latest`),
    fetchJson(`${origin}/api/analyst/brief`),
    fetchJson(`${origin}/api/claude/snapshot?full=1`),
  ]);
  const snapshot = snapshotRes?.data || {};

  const html = buildEmail(phase, macro, chopData, t2108Data, brief, snapshot);
  const phaseLabel = PHASE_LABELS[phase];

  const preview = url.searchParams.get('preview');
  if (preview === '1') {
    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
  }

  const resend = new Resend(apiKey);

  try {
    const { data, error } = await resend.emails.send({
      from: 'CTT Briefing <onboarding@resend.dev>',
      to: recipientEmail,
      subject: `CTT ${phaseLabel} Briefing — ${new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })}`,
      html,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, emailId: data?.id, phase, to: recipientEmail });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Send failed' }, { status: 500 });
  }
}

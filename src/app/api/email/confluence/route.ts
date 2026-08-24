import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { getEmailRecipients } from '@/lib/users';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

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

const fmtPrc = (v: number) => v >= 1000 ? v.toFixed(0) : v.toFixed(2);
const fmtVol = (v: number) => v >= 1e9 ? (v / 1e9).toFixed(1) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : String(v);
const fmtDvol = (v: number) => v >= 1e9 ? '$' + (v / 1e9).toFixed(1) + 'B' : v >= 1e6 ? '$' + (v / 1e6).toFixed(0) + 'M' : '$' + v.toLocaleString();
const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
const chgClr = (v: number) => v >= 0 ? '#34d399' : '#fb7185';

const BADGE = 'display:inline-block;font-size:6px;font-weight:700;border-radius:3px;width:18px;line-height:12px;text-align:center;border:1px solid';

function cnfPill(score: number, grade?: string): string {
  const c = grade === 'A' ? '#34d399' : grade === 'B' ? '#fbbf24' : '#94a3b8';
  return `<span style="${BADGE} ${c}33;background:${c}1a;color:${c};">${score}</span>`;
}

function rsPill(rs: number | null): string {
  if (rs == null || rs === 0) return '';
  const [bg, bc, tx] = rs >= 90 ? ['#3b0764','#6b21a8','#c084fc']
    : rs >= 80 ? ['#042f2e','#065f46','#34d399']
    : rs >= 70 ? ['#1e293b','#ffffff1a','#cbd5e1']
    : ['#4c0519','#9f1239','#fb7185'];
  return `<span style="${BADGE} ${bc};background:${bg};color:${tx};">${rs}</span>`;
}

function stagePill(stage: string): string {
  const s = String(stage || '').replace(/Stage\s*/i, '').trim();
  if (!s) return '';
  const u = s.toUpperCase();
  const [bg, bc, tx] = u.startsWith('2') ? ['#042f2e','#065f46','#34d399']
    : u.startsWith('4') ? ['#4c0519','#9f1239','#fb7185']
    : u.startsWith('3') ? ['#422006','#854d0e','#fbbf24']
    : u.startsWith('1') ? ['#0c1a29','#0e4a6e','#38bdf8']
    : ['#0f172a','#ffffff0d','#475569'];
  return `<span style="${BADGE} ${bc};background:${bg};color:${tx};">${s}</span>`;
}

function tickerChip(ticker: string, grade?: string): string {
  const [bg, bc, tx] = grade === 'A' ? ['#042f2e','#115e59','#6ee7b7']
    : grade === 'B' ? ['#422006','#854d0e','#fde68a']
    : ['#1b2434','#2a3446','#cbd5e1'];
  return `<span style="display:inline-block;background:${bg};border:1px solid ${bc};border-radius:3px;padding:0px 3px;font-size:6px;font-weight:700;letter-spacing:.06em;color:${tx};">${ticker}</span>`;
}

function biasColor(bias: string): string {
  return bias === 'BULLISH' || bias === 'Bullish' ? '#34d399' : bias === 'BEARISH' || bias === 'Bearish' ? '#fb7185' : '#fbbf24';
}

function buildAiSummary(ai: any): string {
  if (!ai) return '';
  const bClr = biasColor(ai.overallBias);
  const picksHtml = (ai.topPicks || []).map((p: any) =>
    `<tr>
      <td class="d" style="padding-left:0;">${tickerChip(p.ticker, p.grade)}</td>
      <td class="d">${cnfPill(p.cnfScore || 0, p.grade)}</td>
      <td class="d">${rsPill(p.rsRating || 0)}</td>
      <td class="d" style="color:#94a3b8;">${p.reason || ''}</td>
    </tr>`
  ).join('');

  const levelsHtml = (ai.keyLevels || []).map((l: any) => {
    const support = Array.isArray(l.support) ? l.support.join(' / ') : '—';
    const resistance = Array.isArray(l.resistance) ? l.resistance.join(' / ') : '—';
    return `<tr>
      <td class="d" style="padding-left:0;">${tickerChip(l.ticker, l.grade)}</td>
      <td class="d" style="color:#34d399;">${support}</td>
      <td class="d" style="color:#fb7185;">${resistance}</td>
    </tr>`;
  }).join('');

  const risksHtml = (ai.riskNotes || []).map((n: string) =>
    `<div style="font-size:8px;color:#94a3b8;line-height:1.5;padding-left:8px;border-left:2px solid #334155;margin-bottom:4px;">${n}</div>`
  ).join('');

  const sectorsHtml = (ai.sectorThemes || []).map((s: string) =>
    `<span style="display:inline-block;font-size:7px;font-weight:700;padding:1px 5px;border-radius:3px;background:#1e293b;border:1px solid #ffffff0d;color:#cbd5e1;margin:1px 2px;">${s}</span>`
  ).join('');

  return `<div style="margin-bottom:12px;border-radius:14px;border:1px solid #6366f133;padding:14px 16px;">
    <div style="margin-bottom:10px;border-bottom:1px solid #ffffff08;padding-bottom:8px;display:flex;align-items:center;gap:8px;">
      <span style="display:inline-block;font-size:8px;font-weight:700;color:#818cf8;background:#161c2a;border:1px solid #ffffff0d;padding:3px 8px;border-radius:4px;letter-spacing:0.14em;text-transform:uppercase;">
        <span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:#818cf8;margin-right:6px;vertical-align:middle;"></span>AI Analyst Rec
      </span>
      <span style="display:inline-block;font-size:7px;font-weight:700;padding:2px 6px;border-radius:3px;background:${bClr}1a;border:1px solid ${bClr}33;color:${bClr};">${ai.overallBias}</span>
    </div>
    <div style="font-size:10px;color:#cbd5e1;line-height:1.6;margin-bottom:10px;">${ai.biasRationale || ''}</div>
    ${picksHtml ? `<div style="margin-bottom:8px;">
      <div style="font-size:7px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#818cf8;margin-bottom:4px;">Top Picks</div>
      <table width="100%" style="border-collapse:collapse;">${picksHtml}</table>
    </div>` : ''}
    ${levelsHtml ? `<div style="margin-bottom:8px;">
      <div style="font-size:7px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#818cf8;margin-bottom:4px;">Key Levels</div>
      <table style="border-collapse:collapse;">
        <tr><th class="h" style="padding-left:0;text-align:left;">Ticker</th><th class="h" style="text-align:left;">Support</th><th class="h" style="text-align:left;">Resistance</th></tr>
        ${levelsHtml}
      </table>
    </div>` : ''}
    ${sectorsHtml ? `<div style="margin-bottom:8px;">
      <div style="font-size:7px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#818cf8;margin-bottom:4px;">Sectors</div>
      ${sectorsHtml}
    </div>` : ''}
    ${risksHtml ? `<div style="margin-bottom:8px;">
      <div style="font-size:7px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#fb718580;margin-bottom:4px;">Risk Notes</div>
      ${risksHtml}
    </div>` : ''}
    ${ai.actionPlan ? `<div style="border-top:1px solid #ffffff0d;padding-top:8px;margin-top:8px;">
      <div style="font-size:7px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#34d39980;margin-bottom:4px;">Action Plan</div>
      <div style="font-size:10px;color:#e2e8f0;line-height:1.5;font-weight:600;">${ai.actionPlan}</div>
    </div>` : ''}
  </div>`;
}

function buildStockCard(r: any): string {
  const tfRows = (r.timeframes || [])
    .filter((tf: any) => tf.emaTrend !== 'N/A' || tf.rsi != null || tf.macdHist != null)
    .map((tf: any) => {
      const rsiClr = tf.rsi == null ? '#64748b' : tf.rsi >= 70 ? '#fb7185' : tf.rsi >= 55 ? '#34d399' : tf.rsi >= 45 ? '#cbd5e1' : tf.rsi >= 30 ? '#fbbf24' : '#fb7185';
      const macdClr = (tf.macdHist ?? 0) >= 0 ? '#34d399' : '#fb7185';
      const bClr = biasColor(tf.bias);
      return `<tr>
        <td class="d" style="padding-left:0;color:#fbbf24;font-weight:600;">${tf.timeframe}</td>
        <td class="d" style="color:#cbd5e1;">${tf.emaTrend}</td>
        <td class="d" style="text-align:center;color:${rsiClr};">${tf.rsi != null ? tf.rsi.toFixed(1) : '—'}</td>
        <td class="d" style="text-align:center;color:${macdClr};">${tf.macdHist != null ? (tf.macdHist >= 0 ? '+' : '') + tf.macdHist.toFixed(2) : '—'}</td>
        <td class="d" style="color:#cbd5e1;">${tf.priceVsEmas || ''}</td>
        <td class="d" style="text-align:center;"><span style="display:inline-block;font-size:7px;font-weight:700;padding:1px 4px;border-radius:3px;background:${bClr}1a;border:1px solid ${bClr}33;color:${bClr};">${tf.bias} (${tf.biasScore}/4)</span></td>
      </tr>`;
    }).join('');

  const levelsHtml = [];
  if (r.levels?.resistance?.length > 0) {
    levelsHtml.push(`<span style="color:#fb7185;font-weight:600;">R:</span> <span style="color:#cbd5e1;">${r.levels.resistance.map((v: number) => '$' + fmtPrc(v)).join(' / ')}</span>`);
  }
  if (r.levels?.support?.length > 0) {
    levelsHtml.push(`<span style="color:#34d399;font-weight:600;">S:</span> <span style="color:#cbd5e1;">${r.levels.support.map((v: number) => '$' + fmtPrc(v)).join(' / ')}</span>`);
  }

  const tradeHtml = r.tradeRec ? `<div style="border-top:1px solid #ffffff0d;padding-top:8px;margin-top:8px;">
    <div style="font-size:7px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#22d3ee;margin-bottom:4px;">
      Trade Rec: <span style="color:${r.tradeRec.direction === 'LONG' ? '#34d399' : '#fb7185'};">${r.tradeRec.direction}</span>
    </div>
    <table style="border-collapse:collapse;font-size:9px;">
      <tr>
        <td style="padding-right:16px;"><span style="color:#64748b;font-size:7px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">Entry</span><br/><span style="color:#e2e8f0;font-weight:600;">${r.tradeRec.entry}</span></td>
        <td style="padding-right:16px;"><span style="color:#64748b;font-size:7px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">Stop</span><br/><span style="color:#fb7185;font-weight:600;">${r.tradeRec.stopLoss}</span></td>
        <td style="padding-right:16px;"><span style="color:#64748b;font-size:7px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">Target</span><br/><span style="color:#34d399;font-weight:600;">${r.tradeRec.takeProfit}</span></td>
        <td><span style="color:#64748b;font-size:7px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">R:R</span><br/><span style="color:#fbbf24;font-weight:600;">${r.tradeRec.rr}</span></td>
      </tr>
    </table>
  </div>` : '';

  const rvolClr = r.rvol >= 2 ? '#fbbf24' : r.rvol >= 1.5 ? '#34d399' : '#cbd5e1';
  const confLabel = r.confluenceLabel || '';
  const confClr = biasColor(confLabel === 'Bullish' ? 'BULLISH' : confLabel === 'Bearish' ? 'BEARISH' : 'NEUTRAL');

  return `<div style="margin-bottom:10px;border-radius:10px;border:1px solid #ffffff0d;overflow:hidden;">
    <!-- Header -->
    <div style="padding:10px 14px;border-bottom:1px solid #ffffff0d;font-size:0;">
      ${tickerChip(r.ticker, r.cnfGrade)}
      <span style="font-size:10px;font-weight:500;color:#cbd5e1;margin-left:8px;vertical-align:middle;">${r.name || ''}</span>
      <span style="font-size:10px;font-weight:600;color:${chgClr(r.changePct)};margin-left:8px;vertical-align:middle;">${fmtPct(r.changePct)}</span>
      <span style="font-size:10px;color:#cbd5e1;margin-left:6px;vertical-align:middle;">$${fmtPrc(r.price)}</span>
      <span style="float:right;vertical-align:middle;">
        ${r.sector ? `<span style="font-size:8px;color:#64748b;margin-right:6px;vertical-align:middle;">${r.sector}</span>` : ''}
        ${cnfPill(r.cnfScore, r.cnfGrade)}
        ${(() => { const bs = r.biasScore ?? 0; const bm = r.biasMax ?? 4; const bc = bs >= 3 ? '#34d399' : bs <= 1 ? '#fb7185' : '#fbbf24'; return `<span style="${BADGE} ${bc}33;background:${bc}1a;color:${bc};">${bs}/${bm}</span>`; })()}
        ${rsPill(r.rsRating)}
        ${stagePill(r.stage)}
      </span>
    </div>
    <!-- Quick stats -->
    <div style="padding:6px 14px;border-bottom:1px solid #ffffff0d;font-size:9px;color:#94a3b8;">
      <span style="color:#64748b;">RVOL</span> <span style="color:${rvolClr};font-weight:600;">${r.rvol != null ? (r.rvol < 1 ? r.rvol.toFixed(1) : Math.round(r.rvol)) + 'x' : '—'}</span>
      &nbsp;&nbsp;<span style="color:#64748b;">VOL</span> <span style="color:#cbd5e1;">${fmtVol(r.vol || 0)}</span>
      &nbsp;&nbsp;<span style="color:#64748b;">$VOL</span> <span style="color:#cbd5e1;">${fmtDvol(r.dVol || 0)}</span>
      ${r.adrPct != null ? `&nbsp;&nbsp;<span style="color:#64748b;">ADR</span> <span style="color:${r.adrPct >= 5 ? '#34d399' : '#cbd5e1'};">${r.adrPct.toFixed(1)}%</span>` : ''}
      ${r.setupName ? `&nbsp;&nbsp;<span style="display:inline-block;font-size:7px;font-weight:700;padding:1px 4px;border-radius:3px;background:#8b5cf61a;border:1px solid #8b5cf633;color:#a78bfa;">${r.setupName}</span>` : ''}
    </div>
    <!-- Timeframes -->
    ${tfRows ? `<div style="padding:8px 14px;">
      <div style="font-size:7px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#22d3ee;margin-bottom:4px;">Timeframe Breakdown</div>
      <table width="100%" style="border-collapse:collapse;">
        <tr>
          <th class="h" style="padding-left:0;text-align:left;">TF</th>
          <th class="h" style="text-align:left;">EMA</th>
          <th class="h" style="text-align:center;">RSI</th>
          <th class="h" style="text-align:center;">MACD</th>
          <th class="h" style="text-align:left;">vs EMAs</th>
          <th class="h" style="text-align:center;">Bias</th>
        </tr>${tfRows}
      </table>
    </div>` : ''}
    <!-- Levels -->
    ${levelsHtml.length > 0 ? `<div style="padding:6px 14px;border-top:1px solid #ffffff0d;font-size:9px;">${levelsHtml.join('&nbsp;&nbsp;&nbsp;')}</div>` : ''}
    <!-- CNF + Bias Score -->
    <div style="padding:6px 14px;border-top:1px solid #ffffff0d;">
      <span style="font-size:7px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#22d3ee;">CNF: </span>
      <span style="font-size:10px;font-weight:700;color:#cbd5e1;">${r.cnfScore}</span>
      <span style="margin-left:12px;font-size:7px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#22d3ee;">Bias: </span>
      <span style="font-size:10px;font-weight:700;color:${confClr};">${r.biasScore ?? 0}/${r.biasMax ?? 4} ${confLabel}</span>
    </div>
    ${tradeHtml}
  </div>`;
}

function minify(html: string): string {
  return html.replace(/>[^\S\n]*\n\s*</g, '><').replace(/\n\s+/g, '\n').trim();
}

function buildEmail(reports: any[], aiSummary: any, lastScanTime: number | null): string {
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const scanTime = lastScanTime ? new Date(lastScanTime).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) : '';

  const cards = reports.map(buildStockCard).join('');
  const summary = buildAiSummary(aiSummary);

  return minify(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  table { max-width: 100%; }
  .d { padding: 2px 2px; font-size: 8px; }
  .h { padding: 2px 2px; font-size: 6px; color: #475569; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; border-bottom: 1px solid #ffffff10; }
  @media only screen and (max-width: 860px) {
    .shell { padding: 12px 4px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#020408;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#020408;"><tr><td align="center" style="padding:0;">
  <div class="shell" style="max-width:900px;margin:0 auto;background:#05080f;border-left:1px solid #0f1729;border-right:1px solid #0f1729;text-align:left;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="height:3px;background:#22d3ee;"></td>
    </tr></table>
    <div style="padding:20px 16px;">

    <div style="padding:10px 0 12px;border-bottom:1px solid #ffffff0d;margin-bottom:14px;">
      <table width="100%" style="border-collapse:collapse;"><tr>
        <td style="padding:0;vertical-align:middle;">
          <img src="https://ctt-dashboard.vercel.app/logo.svg" alt="CTT" style="height:24px;width:auto;vertical-align:middle;" />
          <span style="font-size:11px;font-weight:800;color:#f1f5f9;vertical-align:middle;margin-left:8px;">Confluence Trading Tools</span>
          <div style="font-size:8px;font-weight:600;color:#64748b;letter-spacing:0.22em;text-transform:uppercase;margin-top:3px;margin-left:32px;">Multi-Confluence Report</div>
        </td>
      </tr></table>
      <div style="font-size:8px;color:#64748b;margin-top:6px;">${now} ET${scanTime ? ` &middot; Scan ${scanTime} ET` : ''} &middot; ${reports.length} setup${reports.length !== 1 ? 's' : ''}</div>
    </div>

    ${summary}
    ${cards}

    <div style="margin-top:12px;padding:8px 14px;background:#0f172a80;border:1px solid #ffffff06;border-radius:8px;">
      <div style="font-size:7px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#fbbf2480;margin-bottom:4px;">Important</div>
      <div style="font-size:8px;color:#64748b;line-height:1.5;">Trade recommendations are mechanical. Always apply your own risk management. S/R levels derived from swing highs/lows.</div>
    </div>

    <div style="padding-top:14px;margin-top:18px;">
      <div style="font-size:8px;color:#475569;text-align:center;">
        Confluence Trading Tools &copy; ${new Date().getFullYear()} &bull; Not investment advice.
      </div>
    </div>
    </div>
  </div>
  </td></tr></table>
</body>
</html>`);
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  const force = url.searchParams.get('force') === '1';
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && !force) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.RESEND_API_KEY || '';
  if (!apiKey) {
    return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 });
  }

  const origin = resolveOrigin(req);
  const data = await fetchJson(`${origin}/api/confluence/latest`);

  if (!data?.success) {
    return NextResponse.json({ error: 'Failed to fetch confluence data' }, { status: 500 });
  }

  const reports = data.reports || [];
  if (reports.length === 0) {
    return NextResponse.json({ error: 'No confluence data available' }, { status: 404 });
  }

  const html = buildEmail(reports, data.aiSummary, data.lastScanTime);

  if (url.searchParams.get('preview') === '1') {
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  const userRecipients = await getEmailRecipients('confluence', 'confluence');
  const fallback = process.env.BRIEFING_EMAIL || process.env.Email || 'thomasbeach@gmail.com';
  const recipients = userRecipients.length > 0 ? userRecipients : [fallback];

  const resend = new Resend(apiKey);
  const subject = `CTT Confluence Report — ${new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })} — ${reports.length} Setups`;

  try {
    const results = await Promise.allSettled(
      recipients.map((to) =>
        resend.emails.send({
          from: 'CTT <noreply@confluencetradingtools.com>',
          to,
          subject,
          html,
        }),
      ),
    );

    const sent = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    return NextResponse.json({ success: true, sent, failed, recipients: recipients.length, reports: reports.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Send failed' }, { status: 500 });
  }
}

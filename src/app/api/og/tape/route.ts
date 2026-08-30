import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

export const dynamic = 'force-dynamic';

const CACHE_KEY = 'analyst_brief_v1';

const PHASES = ['pre', 'morning', 'midday', 'power', 'closing'] as const;

const SESSION_THEME: Record<string, { dot: string; label: string; boxBg: string; boxBorder: string; boxText: string }> = {
  emerald: { dot: '#34d399', label: '#34d399', boxBg: '#042f2e', boxBorder: '#34d399', boxText: '#d1fae5' },
  rose:    { dot: '#fb7185', label: '#fb7185', boxBg: '#4c0519', boxBorder: '#fb7185', boxText: '#ffe4e6' },
  cyan:    { dot: '#22d3ee', label: '#22d3ee', boxBg: '#083344', boxBorder: '#22d3ee', boxText: '#cffafe' },
  amber:   { dot: '#fbbf24', label: '#fbbf24', boxBg: '#422006', boxBorder: '#fbbf24', boxText: '#fef3c7' },
  indigo:  { dot: '#818cf8', label: '#818cf8', boxBg: '#1e1b4b', boxBorder: '#818cf8', boxText: '#e0e7ff' },
};

const INVERSE_TICKERS = new Set(['VIX', 'UVXY', 'SVXY']);

function colorPctsHtml(text: string): string {
  return text.replace(/([+-]?\d+(?:\.\d+)?)%/g, (whole, num, offset) => {
    const v = parseFloat(num);
    if (isNaN(v)) return whole;
    const signed = /^[+-]/.test(num);
    if (!signed) return `<span style="font-weight:700;color:#cbd5e1;">${whole}</span>`;
    const before = text.slice(Math.max(0, offset - 60), offset);
    const nearTicker = before.match(/\b([A-Z]{2,5})\b(?!.*\b[A-Z]{2,5}\b)/);
    const invert = nearTicker ? INVERSE_TICKERS.has(nearTicker[1]) : false;
    const clr = invert ? (v >= 0 ? '#fb7185' : '#34d399') : (v >= 0 ? '#34d399' : '#fb7185');
    return `<span style="font-weight:700;color:${clr};">${whole}</span>`;
  });
}

function richHtml(text: string): string {
  const stripped = String(text || '').replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#f1f5f9;">$1</strong>');
  return colorPctsHtml(stripped);
}

function deriveDir(paragraphs: string[]): 'up' | 'down' | null {
  const text = paragraphs.join(' ');
  const rx = /\b(?:S&P|Nasdaq|Dow|Russell|SPX|NDX)\b[^.]{0,40}?([+-]\d+(?:\.\d+)?)%/gi;
  const moves: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text)) !== null) { const v = parseFloat(m[1]); if (!isNaN(v)) moves.push(v); }
  if (!moves.length) return null;
  const avg = moves.reduce((a, b) => a + b, 0) / moves.length;
  return Math.abs(avg) < 0.25 ? null : avg > 0 ? 'up' : 'down';
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const phase = url.searchParams.get('phase') || '';

  const brief = await kv.get<any>(CACHE_KEY);
  if (!brief) {
    return NextResponse.json({ error: 'No brief available' }, { status: 404 });
  }

  const su = brief.sessionUpdates || {};
  const key = (phase && su[phase]) ? phase : [...PHASES].reverse().find(k => su[k]);
  if (!key || !su[key]) {
    return NextResponse.json({ error: 'No session update available' }, { status: 404 });
  }

  const block = su[key];
  const dir = deriveDir(block.paragraphs || []);
  const themeKey = dir === 'up' ? 'emerald' : dir === 'down' ? 'rose' : (block.colorTheme || 'indigo');
  const st = SESSION_THEME[themeKey] || SESSION_THEME.indigo;

  const paras = (block.paragraphs || []).map((p: string) =>
    `<div style="font-size:14px;color:#94a3b8;line-height:1.7;border-left:3px solid #334155;padding-left:12px;margin-bottom:10px;">${richHtml(p)}</div>`
  ).join('');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:24px}</style>
</head>
<body data-loaded>
<div id="tape-card" style="background:#161c2a;border:1px solid rgba(255,255,255,0.05);border-radius:16px;padding:24px 28px;max-width:760px;display:inline-block;">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap;">
    <div style="width:10px;height:10px;border-radius:50%;background:${st.dot};"></div>
    <span style="font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${st.label};">${block.phase || ''}</span>
    <span style="font-size:10px;color:#64748b;font-weight:500;letter-spacing:0.08em;padding:3px 10px;border:1px solid rgba(255,255,255,0.05);border-radius:4px;">${block.timestamp || ''}</span>
  </div>
  <div style="margin-bottom:20px;">
    ${paras}
  </div>
  <div style="border-left:4px solid ${st.boxBorder};background:${st.boxBg.replace(')', ',0.5)')};padding:14px 16px;border-radius:0 12px 12px 0;">
    <div style="font-size:14px;line-height:1.7;color:${st.boxText};">${richHtml(block.takeaway || '')}</div>
  </div>
  <div style="margin-top:16px;display:flex;align-items:center;gap:8px;">
    <img src="https://ctt-dashboard.vercel.app/logo.svg" alt="CTT" style="height:16px;width:auto;opacity:0.5;" />
    <span style="font-size:9px;color:#475569;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;">Confluence Trading Tools</span>
  </div>
</div>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

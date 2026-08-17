import { NextResponse } from 'next/server';

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

const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

/* ── ProseMirror node builders ── */

function text(t: string, marks?: any[]): any {
  const node: any = { type: 'text', text: t };
  if (marks?.length) node.marks = marks;
  return node;
}
function bold(t: string): any { return text(t, [{ type: 'bold' }]); }

function italic(t: string): any { return text(t, [{ type: 'italic' }]); }

function parseInline(raw: string): any[] {
  const nodes: any[] = [];
  const parts = String(raw || '').split(/(\*\*.+?\*\*|\*.+?\*)/g);
  for (const p of parts) {
    if (!p) continue;
    const mb = p.match(/^\*\*(.+)\*\*$/);
    if (mb) { nodes.push(bold(mb[1])); continue; }
    const mi = p.match(/^\*(.+)\*$/);
    if (mi) { nodes.push(italic(mi[1])); continue; }
    nodes.push(text(p));
  }
  return nodes.length ? nodes : [text(raw || '')];
}

function para(content: any[]): any { return { type: 'paragraph', content }; }
function paraText(t: string): any { return para(parseInline(t)); }

function heading(level: number, t: string): any {
  return { type: 'heading', attrs: { level }, content: parseInline(t) };
}

function hr(): any { return { type: 'horizontal_rule' }; }

function blockquote(content: any[]): any {
  return { type: 'blockquote', content };
}

function bulletList(items: string[]): any {
  return {
    type: 'bullet_list',
    content: items.map(item => ({
      type: 'list_item',
      content: [para(parseInline(item))],
    })),
  };
}

function analysisToNodes(raw: string): any[] {
  if (!raw) return [];
  return String(raw).split(/\n\n+/).filter(Boolean).map(p => paraText(p));
}

function trimAnalysis(raw: string, maxSentences = 3): string {
  if (!raw) return '';
  const sentences = String(raw).split(/(?<=[.!])\s+/).filter(Boolean);
  return sentences.slice(0, maxSentences).join(' ');
}

function stockTableMarkdown(stocks: any[], cols: { key: string; label: string; fmt?: (v: any) => string }[]): any[] {
  if (!stocks.length) return [];
  const headerLine = cols.map(c => c.label).join(' | ');
  const rows = stocks.map(s =>
    cols.map(c => {
      const v = s[c.key];
      return c.fmt ? c.fmt(v) : String(v ?? '—');
    }).join(' | ')
  );
  return [
    para([bold(headerLine)]),
    ...rows.map(r => paraText(r)),
  ];
}

function captionedImage(src: string): any {
  return {
    type: 'captionedImage',
    content: [{
      type: 'image2',
      attrs: {
        src,
        fullscreen: false,
        imageSize: 'small',
        alt: 'CTT Market Brief',
      },
    }],
  };
}

async function uploadImageToSubstack(
  pubUrl: string,
  session: string,
  imageUrl: string,
): Promise<string | null> {
  const res = await fetch(`${pubUrl}/api/v1/image`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: `substack.sid=${session}`,
    },
    body: `image=${encodeURIComponent(imageUrl)}`,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`upload-url ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.url || null;
}

/* ── Build ProseMirror doc from brief ── */

function formatForSubstack(brief: any): any {
  const sections: any[] = brief?.sections || [];
  const summary = brief?.summary || {};
  const rd = brief?.regimeDetail || {};
  const sectionByName = (rx: RegExp) => sections.find((s: any) => rx.test(s.section));

  const nodes: any[] = [];

  /* ── Regime: the lead — 2 sentences max ── */
  if (rd.regime) {
    nodes.push(paraText(trimAnalysis(rd.regime, 2)));
    if (rd.posture) nodes.push(blockquote([paraText(trimAnalysis(rd.posture, 2))]));
    nodes.push(hr());
  }

  /* ── Macro — 3 sentences ── */
  const macroSec = sectionByName(/Futures.*Macro|Macro.*Snapshot/i);
  if (macroSec?.analysis) {
    nodes.push(heading(2, 'Macro'));
    nodes.push(paraText(trimAnalysis(macroSec.analysis, 3)));
    nodes.push(hr());
  }

  /* ── News — 3 sentences ── */
  const newsSec = sectionByName(/Key News/i);
  if (newsSec?.analysis) {
    nodes.push(heading(2, 'News & Catalysts'));
    nodes.push(paraText(trimAnalysis(newsSec.analysis, 3)));
    nodes.push(hr());
  }

  /* ── Breadth — 2 sentences ── */
  const sentimentSec = sectionByName(/Sentiment.*Breadth/i);
  if (sentimentSec?.analysis) {
    nodes.push(heading(2, 'Breadth'));
    nodes.push(paraText(trimAnalysis(sentimentSec.analysis, 2)));
    nodes.push(hr());
  }

  /* ── Sectors — image + 2 sentences ── */
  const sectorSec = sectionByName(/Sectors.*Money Flow/i);
  if (sectorSec?.analysis) {
    nodes.push(heading(2, 'Sectors'));
    nodes.push(paraText(trimAnalysis(sectorSec.analysis, 2)));
    nodes.push(hr());
  }

  /* ── Calendar — 2 sentences each, combined ── */
  const econSec = sectionByName(/Economic Calendar/i);
  const earnSec = sectionByName(/^Earnings$/i);
  if (econSec?.analysis || earnSec?.analysis) {
    nodes.push(heading(2, 'Calendar'));
    if (econSec?.analysis) nodes.push(paraText(trimAnalysis(econSec.analysis, 2)));
    if (earnSec?.analysis) nodes.push(paraText(trimAnalysis(earnSec.analysis, 2)));
    nodes.push(hr());
  }

  /* ── Top Trades — image then text ── */
  const tradesSec = sectionByName(/Top Trades/i);
  const trades: any[] = tradesSec?.stocks || [];
  if (trades.length) {
    nodes.push(heading(2, 'VCP Trade Ideas'));
    trades.forEach((s: any, i: number) => {
      const label = i < 2 ? 'CONVICTION' : 'WATCH';
      const thesis = s.thesis ? trimAnalysis(s.thesis, 1) : '';
      const line = [
        `**${s.ticker}** ${fmtPct(s.changePct ?? 0)}`,
        label,
        s.stage ? `Stage ${s.stage}` : null,
        s.rs != null ? `RS ${s.rs}` : null,
        s.setup || null,
      ].filter(Boolean).join(' · ');
      nodes.push(paraText(line));
      if (thesis) nodes.push(paraText(thesis));
      const levels = [
        s.trigger != null ? `Entry ${s.trigger}` : null,
        s.stop != null ? `Stop ${s.stop}` : null,
        s.target != null ? `Target ${s.target}` : null,
        s.rMultiple != null ? `${s.rMultiple}R` : null,
      ].filter(Boolean).join(' | ');
      if (levels) nodes.push(paraText(levels));
    });
    nodes.push(hr());
  }

  /* ── Names to Avoid — image then text ── */
  const avoidSec = sectionByName(/Top Avoid/i);
  const avoids: any[] = avoidSec?.stocks || [];
  if (avoids.length) {
    nodes.push(heading(2, 'Stay Away'));
    avoids.forEach((s: any) => {
      const reason = s.reason ? trimAnalysis(s.reason, 1) : '';
      nodes.push(paraText(`**${s.ticker}** ${fmtPct(s.changePct ?? 0)} — ${reason}`));
    });
    nodes.push(hr());
  }

  /* ── Summary ── */
  const convictionArr: string[] = Array.isArray(summary.conviction) ? summary.conviction : [];
  const watchlistArr: string[] = Array.isArray(summary.watchlist) ? summary.watchlist : [];
  const trapsArr: string[] = Array.isArray(summary.traps) ? summary.traps : [];
  const tomorrowArr: string[] = Array.isArray(summary.tomorrow) ? summary.tomorrow : [];

  if (tomorrowArr.length) {
    nodes.push(heading(2, 'Tomorrow'));
    nodes.push(bulletList(tomorrowArr));
  }

  if (trapsArr.length) {
    nodes.push(heading(3, 'Traps'));
    nodes.push(bulletList(trapsArr));
  }

  /* ── Footer ── */
  nodes.push(hr());
  nodes.push(paraText('*Confluence Trading Tools. Analysis only. Not financial advice.*'));

  return { type: 'doc', content: nodes };
}

/* ── HTML preview (dark) ── */

function formatPreviewHtml(brief: any): string {
  const sections: any[] = brief?.sections || [];
  const summary = brief?.summary || {};
  const rd = brief?.regimeDetail || {};
  const sectionByName = (rx: RegExp) => sections.find((s: any) => rx.test(s.section));
  const md = (t: string) => String(t || '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>');
  const parts: string[] = [];

  if (rd.regime) {
    parts.push(`<h2>Market Regime</h2><p>${md(rd.regime)}</p>`);
    if (rd.caution) parts.push(`<blockquote><strong>Risk:</strong> ${md(rd.caution)}</blockquote>`);
    if (rd.posture) parts.push(`<p><strong>Structure:</strong> ${md(rd.posture)}</p>`);
  }
  for (const { rx, title } of [
    { rx: /Futures.*Macro|Macro.*Snapshot/i, title: 'Macro Snapshot' },
    { rx: /Key News/i, title: 'Key News &amp; Catalysts' },
    { rx: /Sectors.*Money Flow/i, title: 'Sectors &amp; Money Flow' },
    { rx: /Economic Calendar/i, title: 'Economic Calendar' },
    { rx: /^Earnings$/i, title: 'Earnings' },
    { rx: /Sentiment.*Breadth/i, title: 'Sentiment &amp; Market Breadth' },
  ]) {
    const sec = sectionByName(rx);
    if (sec?.analysis) parts.push(`<h2>${title}</h2><p>${md(sec.analysis)}</p>`);
  }

  const tradesSec = sectionByName(/Top Trades/i);
  const trades: any[] = tradesSec?.stocks || [];
  if (trades.length) {
    parts.push(`<h2>Top Trades</h2>`);
    trades.forEach((s: any, i: number) => {
      const badge = i < 2 ? ' (Highest Conviction)' : '';
      parts.push(`<h3>${s.ticker} — ${fmtPct(s.changePct ?? 0)}${badge}</h3>`);
      if (s.thesis) parts.push(`<p><strong>Thesis:</strong> ${md(s.thesis)}</p>`);
      if (s.risk) parts.push(`<p><strong>Risk:</strong> ${md(s.risk)}</p>`);
      if (s.invalidation) parts.push(`<p><strong>Invalidation:</strong> ${md(s.invalidation)}</p>`);
    });
  }

  const convictionArr: string[] = Array.isArray(summary.conviction) ? summary.conviction : [];
  const watchlistArr: string[] = Array.isArray(summary.watchlist) ? summary.watchlist : [];
  const tomorrowArr: string[] = Array.isArray(summary.tomorrow) ? summary.tomorrow : [];
  if (convictionArr.length) parts.push(`<h2>Highest Conviction</h2><ul>${convictionArr.map(c => `<li>${md(c)}</li>`).join('')}</ul>`);
  if (watchlistArr.length) parts.push(`<h2>Watchlist</h2><ul>${watchlistArr.map(w => `<li>${md(w)}</li>`).join('')}</ul>`);
  if (tomorrowArr.length) parts.push(`<h2>What to Look For Tomorrow</h2><ul>${tomorrowArr.map(t => `<li>${md(t)}</li>`).join('')}</ul>`);

  return parts.join('\n');
}

function buildTitle(brief: any): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `CTT Market Brief — ${dateStr}`;
}

function buildSubtitle(brief: any): string {
  const rd = brief?.regimeDetail;
  if (!rd?.regime) return 'Daily market analysis from Confluence Trading Tools';
  const first = String(rd.regime).split(/[.!]\s/)[0];
  return first.length > 140 ? first.slice(0, 137) + '...' : first;
}

async function substackGetUserId(pubUrl: string, session: string): Promise<{ id: number | null; debug?: string }> {
  const endpoints = [
    `https://substack.com/api/v1/user/self`,
    `${pubUrl}/api/v1/publication`,
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: { Cookie: `substack.sid=${session}` },
      });
      if (!res.ok) continue;
      const data = await res.json();
      const id = data.id ?? data.author_id ?? data.bylines?.[0]?.id ?? data.authors?.[0]?.id ?? null;
      if (id) return { id, debug: `from ${url}` };
    } catch { continue; }
  }
  return { id: null, debug: 'all endpoints failed' };
}

async function substackCreateDraft(pubUrl: string, session: string, title: string, subtitle: string, bodyJson: any): Promise<{ id?: number; error?: string }> {
  const userResult = await substackGetUserId(pubUrl, session);
  if (!userResult.id) {
    return { error: `Could not fetch Substack user ID — ${userResult.debug || 'unknown error'}. Cookie length: ${session.length}` };
  }

  const payload = {
    type: 'newsletter',
    draft_title: title,
    draft_subtitle: subtitle,
    draft_body: JSON.stringify(bodyJson),
    draft_bylines: [{ id: userResult.id }],
    audience: 'everyone',
  };

  const res = await fetch(`${pubUrl}/api/v1/drafts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `substack.sid=${session}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { error: `Draft creation failed (${res.status}): ${text}` };
  }
  const data = await res.json();
  return { id: data.id };
}

async function substackPublish(pubUrl: string, session: string, draftId: number, send: boolean): Promise<{ error?: string }> {
  const res = await fetch(`${pubUrl}/api/v1/drafts/${draftId}/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `substack.sid=${session}`,
    },
    body: JSON.stringify({
      audience: 'everyone',
      send,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { error: `Publish failed (${res.status}): ${text}` };
  }
  return {};
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const preview = url.searchParams.get('preview') === '1';
  const publish = url.searchParams.get('publish') === '1';
  const send = url.searchParams.get('send') !== '0';
  const force = url.searchParams.get('force') === '1';

  const secret = process.env.CRON_SECRET;
  if (!preview && !force && secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const origin = resolveOrigin(req);
  const brief = await fetchJson(`${origin}/api/analyst/brief`);
  if (!brief || brief.pending || brief.error) {
    return NextResponse.json(
      { error: 'No analyst brief available', detail: brief?.error },
      { status: 404 },
    );
  }

  const title = buildTitle(brief);
  const subtitle = buildSubtitle(brief);

  if (preview) {
    const body = formatPreviewHtml(brief);
    const imgTag = `<div style="margin:24px 0;text-align:center"><img src="${origin}/api/og/brief" alt="CTT Market Brief" style="max-width:100%;border-radius:8px;border:1px solid #334155" /></div>`;
    const previewHtml = `
      <html><head><meta charset="utf-8"><title>${title}</title>
      <style>body{max-width:680px;margin:40px auto;padding:0 20px;font-family:Georgia,serif;color:#e2e8f0;background:#0f172a;line-height:1.7}
      h1{color:#f1f5f9}h2{margin-top:32px;font-size:20px;color:#f1f5f9}h3{margin-top:20px;font-size:16px;color:#cbd5e1}
      table{width:100%;border-collapse:collapse;margin:16px 0;font-size:14px}
      th,td{padding:6px 10px;border:1px solid #1e293b;text-align:left;color:#cbd5e1}
      th{background:#1e293b;font-weight:600;color:#94a3b8}blockquote{border-left:3px solid #334155;margin:16px 0;padding:8px 16px;color:#94a3b8}
      hr{border:none;border-top:1px solid #1e293b;margin:32px 0}a{color:#38bdf8}
      strong{color:#f1f5f9}em{color:#94a3b8}</style></head>
      <body><h1>${title}</h1><p><em>${subtitle}</em></p>${imgTag}${body}</body></html>`;
    return new Response(previewHtml, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const pubUrl = process.env.SUBSTACK_PUB_URL;
  const session = process.env.SUBSTACK_SESSION;
  if (!pubUrl || !session) {
    return NextResponse.json({
      error: 'Missing SUBSTACK_PUB_URL or SUBSTACK_SESSION env vars',
    }, { status: 500 });
  }

  const bodyJson = formatForSubstack(brief);

  const draft = await substackCreateDraft(pubUrl, session, title, subtitle, bodyJson);
  if (draft.error) {
    return NextResponse.json({ error: draft.error }, { status: 502 });
  }

  if (publish && draft.id) {
    const pub = await substackPublish(pubUrl, session, draft.id, send);
    if (pub.error) {
      return NextResponse.json({
        draftId: draft.id,
        published: false,
        error: pub.error,
      }, { status: 502 });
    }
    return NextResponse.json({
      success: true,
      draftId: draft.id,
      published: true,
      sent: send,
      title,
    });
  }

  return NextResponse.json({
    success: true,
    draftId: draft.id,
    published: false,
    title,
    note: 'Draft created. Add ?publish=1 to publish and send to subscribers.',
  });
}

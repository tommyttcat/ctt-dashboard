import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
function link(t: string, href: string): any { return text(t, [{ type: 'link', attrs: { href } }]); }

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

function trimAnalysis(raw: string, maxSentences = 2, maxChars = 280): string {
  if (!raw) return '';
  const sentences = String(raw).split(/(?<=[.!])\s+/).filter(Boolean);
  let result = '';
  for (let i = 0; i < Math.min(sentences.length, maxSentences); i++) {
    const next = result ? result + ' ' + sentences[i] : sentences[i];
    if (next.length > maxChars) break;
    result = next;
  }
  if (!result && sentences[0]) {
    result = sentences[0].length > maxChars
      ? sentences[0].slice(0, maxChars - 3) + '...'
      : sentences[0];
  }
  return result;
}

function extractBullets(raw: string, maxBullets = 3, maxLen = 140): string[] {
  if (!raw) return [];
  const sentences = String(raw).split(/(?<=[.!])\s+/).filter(Boolean);
  return sentences.slice(0, maxBullets).map(s =>
    s.length > maxLen ? s.slice(0, maxLen - 3) + '...' : s
  );
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

function captionedImage(src: string, size = 'normal'): any {
  return {
    type: 'captionedImage',
    content: [{
      type: 'image2',
      attrs: {
        src,
        fullscreen: false,
        imageSize: size,
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

async function uploadImageBytesToSubstack(
  pubUrl: string,
  session: string,
  imageBuffer: ArrayBuffer,
  filename = 'screenshot.png',
): Promise<string | null> {
  const boundary = '----SubstackUpload' + Date.now();
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;

  const headerBytes = new TextEncoder().encode(header);
  const footerBytes = new TextEncoder().encode(footer);
  const body = new Uint8Array(headerBytes.length + imageBuffer.byteLength + footerBytes.length);
  body.set(headerBytes, 0);
  body.set(new Uint8Array(imageBuffer), headerBytes.length);
  body.set(footerBytes, headerBytes.length + imageBuffer.byteLength);

  const res = await fetch(`${pubUrl}/api/v1/image`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      Cookie: `substack.sid=${session}`,
    },
    body,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`upload-bytes ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.url || null;
}

/* ── Build ProseMirror doc from brief ── */

function formatForSubstack(brief: any, dashScreenshotUrl?: string, phase?: string): any {
  const sections: any[] = brief?.sections || [];
  const summary = brief?.summary || {};
  const rd = brief?.regimeDetail || {};
  const sessionUpdates = brief?.sessionUpdates || {};
  const sectionByName = (rx: RegExp) => sections.find((s: any) => rx.test(s.section));

  const nodes: any[] = [];

  /* ── Dashboard screenshot with link to site ── */
  if (dashScreenshotUrl) {
    nodes.push(captionedImage(dashScreenshotUrl, 'normal'));
    nodes.push(para([link('View Full Dashboard →', 'https://app.confluencetradingtools.com')]));
  }

  /* ── Regime: the lead ── */
  if (rd.regime) {
    nodes.push(blockquote([paraText(trimAnalysis(rd.regime, 1, 200))]));
    if (rd.posture) {
      const bullets = extractBullets(rd.posture);
      if (bullets.length) nodes.push(bulletList(bullets));
    }
    nodes.push(hr());
  }

  /* ── Macro ── */
  const macroSec = sectionByName(/Futures.*Macro|Macro.*Snapshot/i);
  if (macroSec?.analysis) {
    nodes.push(heading(2, 'Macro'));
    const bullets = extractBullets(macroSec.analysis);
    if (bullets.length) nodes.push(bulletList(bullets));
    else nodes.push(paraText(trimAnalysis(macroSec.analysis, 1, 200)));
    nodes.push(hr());
  }

  /* ── News ── */
  const newsSec = sectionByName(/Key News/i);
  if (newsSec?.analysis) {
    nodes.push(heading(2, 'News & Catalysts'));
    const bullets = extractBullets(newsSec.analysis);
    if (bullets.length) nodes.push(bulletList(bullets));
    else nodes.push(paraText(trimAnalysis(newsSec.analysis, 1, 200)));
    nodes.push(hr());
  }

  /* ── Breadth ── */
  const sentimentSec = sectionByName(/Sentiment.*Breadth/i);
  if (sentimentSec?.analysis) {
    nodes.push(heading(2, 'Breadth'));
    const bullets = extractBullets(sentimentSec.analysis);
    if (bullets.length) nodes.push(bulletList(bullets));
    else nodes.push(paraText(trimAnalysis(sentimentSec.analysis, 1, 200)));
    nodes.push(hr());
  }

  /* ── Sectors ── */
  const sectorSec = sectionByName(/Sectors.*Money Flow/i);
  if (sectorSec?.analysis) {
    nodes.push(heading(2, 'Sectors'));
    const bullets = extractBullets(sectorSec.analysis);
    if (bullets.length) nodes.push(bulletList(bullets));
    else nodes.push(paraText(trimAnalysis(sectorSec.analysis, 1, 200)));
    nodes.push(hr());
  }

  /* ── Calendar ── */
  const econSec = sectionByName(/Economic Calendar/i);
  const earnSec = sectionByName(/^Earnings$/i);
  if (econSec?.analysis || earnSec?.analysis) {
    nodes.push(heading(2, 'Calendar'));
    const calBullets: string[] = [];
    if (econSec?.analysis) calBullets.push(trimAnalysis(econSec.analysis, 1, 140));
    if (earnSec?.analysis) calBullets.push(trimAnalysis(earnSec.analysis, 1, 140));
    if (calBullets.length) nodes.push(bulletList(calBullets));
    nodes.push(hr());
  }

  /* ── Names to Avoid ── */
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

  /* ── Tape Reading ── */
  const PHASE_ORDER = ['closing', 'midday', 'morning', 'pre'];
  const phaseKey = phase && sessionUpdates[phase] ? phase : PHASE_ORDER.find(p => sessionUpdates[p]);
  const tape = phaseKey ? sessionUpdates[phaseKey] : null;
  if (tape) {
    nodes.push(hr());
    const tapeTitle = tape.phase || 'Tape Reading';
    const tapeTime = tape.timestamp ? ` — ${tape.timestamp}` : '';
    nodes.push(heading(2, `${tapeTitle}${tapeTime}`));
    const paragraphs: string[] = tape.paragraphs || [];
    for (const p of paragraphs) {
      nodes.push(paraText(p));
    }
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

const PHASE_LABELS: Record<string, string> = {
  pre: 'Pre-Market',
  morning: 'Morning',
  midday: 'Midday',
  closing: 'Closing',
};

function buildTitle(brief: any, phase?: string): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
  });
  const label = phase ? PHASE_LABELS[phase] || 'Market' : 'Market';
  return `CTT AI Analyst ${label} Briefing — ${dateStr}`;
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

async function substackCreateDraft(pubUrl: string, session: string, title: string, subtitle: string, bodyJson: any, coverImageUrl?: string): Promise<{ id?: number; error?: string }> {
  const userResult = await substackGetUserId(pubUrl, session);
  if (!userResult.id) {
    return { error: `Could not fetch Substack user ID — ${userResult.debug || 'unknown error'}. Cookie length: ${session.length}` };
  }

  const payload: any = {
    type: 'newsletter',
    draft_title: title,
    draft_subtitle: subtitle,
    draft_body: JSON.stringify(bodyJson),
    draft_bylines: [{ id: userResult.id }],
    audience: 'everyone',
  };
  if (coverImageUrl) {
    payload.cover_image = coverImageUrl;
    payload.social_image = coverImageUrl;
  }

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
  const custom = url.searchParams.get('custom');

  if (custom === 'intro') {
    const pubUrl = process.env.SUBSTACK_PUB_URL;
    const session = process.env.SUBSTACK_SESSION;
    if (!pubUrl || !session) return NextResponse.json({ error: 'Missing env' }, { status: 500 });

    let coverCdn: string | undefined;
    try {
      const logoUrl = `${origin}/api/og/brief?section=cover&phase=pre`;
      coverCdn = await uploadImageToSubstack(pubUrl, session, logoUrl) || undefined;
    } catch {}

    const introBody = { type: 'doc', content: [
      para([bold('Confluence Trading Tools'), text(' is a professional market intelligence platform built for serious traders who want institutional-grade analysis without the institutional price tag.')]),
      para([text('I built CTT because I was tired of juggling 15 tabs every morning — one for breadth, one for internals, one for sector rotation, one for economic data, another for earnings, and so on. Every piece of the puzzle lived somewhere different, and by the time I stitched it together, the opening bell had already rung.')]),
      heading(2, 'What CTT Does'),
      bulletList([
        '**Macro Scorecard** — A single-glance view of market tone, breadth, advance/decline, highs/lows, T2108, VIX, and CHOP. Color-coded so you know the regime in seconds.',
        '**Market Internals** — Real-time advance/decline bars, ATHI/ATLO spreads, and the CHOP trend indicator that tells you whether the tape is trending or chopping.',
        '**AI Analyst Briefings** — Four times a day (pre-market, morning, midday, closing), an AI analyst synthesizes all the data into a concise briefing with regime assessment, sector flows, and key catalysts.',
        '**Custom TradingView Indicators** — Purpose-built Pine Script indicators for confluence signals, including CHOP Zone, Session Profiler, and more.',
        '**Live Quote Grid** — SPY, QQQ, DIA, IWM, VIX, TLT, GLD, SLV, USO, BTC, ETH, and T2108 — all in one view with change percentages.',
      ]),
      heading(2, 'Why Substack?'),
      para([text('This Substack delivers the AI Analyst briefings directly to your inbox — the same analysis that powers the dashboard, formatted for quick reading. Each post includes a live scorecard snapshot so you can see the tape at a glance.')]),
      heading(2, 'Looking for Founding Members'),
      para([text("CTT is in early access and I'm looking for founding members to test the platform and help shape the roadmap. If you're a trader who wants to influence what gets built next — the indicators, the dashboard features, the analysis — this is your chance to get in on the ground floor.")]),
      para([link('Visit the Dashboard →', 'https://app.confluencetradingtools.com')]),
      para([link('Join the Founders List →', 'https://confluencetradingtools.com')]),
      hr(),
      paraText('*Confluence Trading Tools. Analysis only. Not financial advice.*'),
    ]};

    const draft = await substackCreateDraft(pubUrl, session, 'Introducing Confluence Trading Tools', 'Professional market intelligence for serious traders — and why I built it.', introBody, coverCdn);
    if (draft.error) return NextResponse.json({ error: draft.error }, { status: 502 });

    if (publish && draft.id) {
      const pub = await substackPublish(pubUrl, session, draft.id, send);
      if (pub.error) return NextResponse.json({ draftId: draft.id, error: pub.error }, { status: 502 });
      return NextResponse.json({ success: true, draftId: draft.id, published: true, sent: send });
    }
    return NextResponse.json({ success: true, draftId: draft.id, published: false });
  }

  const brief = await fetchJson(`${origin}/api/analyst/brief`);
  if (!brief || brief.pending || brief.error) {
    return NextResponse.json(
      { error: 'No analyst brief available', detail: brief?.error },
      { status: 404 },
    );
  }

  const phase = url.searchParams.get('phase') || undefined;
  const title = buildTitle(brief, phase);
  const subtitle = buildSubtitle(brief);

  if (preview) {
    const body = formatPreviewHtml(brief);
    const previewHtml = `
      <html><head><meta charset="utf-8"><title>${title}</title>
      <style>body{max-width:680px;margin:40px auto;padding:0 20px;font-family:Georgia,serif;color:#e2e8f0;background:#0f172a;line-height:1.7}
      h1{color:#f1f5f9}h2{margin-top:32px;font-size:20px;color:#f1f5f9}h3{margin-top:20px;font-size:16px;color:#cbd5e1}
      table{width:100%;border-collapse:collapse;margin:16px 0;font-size:14px}
      th,td{padding:6px 10px;border:1px solid #1e293b;text-align:left;color:#cbd5e1}
      th{background:#1e293b;font-weight:600;color:#94a3b8}blockquote{border-left:3px solid #334155;margin:16px 0;padding:8px 16px;color:#94a3b8}
      hr{border:none;border-top:1px solid #1e293b;margin:32px 0}a{color:#38bdf8}
      strong{color:#f1f5f9}em{color:#94a3b8}</style></head>
      <body><h1>${title}</h1><p><em>${subtitle}</em></p>${body}</body></html>`;
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

  let dashScreenshotCdn: string | undefined;
  let coverImageUrl: string | undefined;
  let coverDebug = '';
  try {
    const screenshotUrl = `${origin}/api/og/screenshot?force=1&w=1200&h=1200&clip=60,168,1080,1005`;
    const imgRes = await fetch(screenshotUrl, { cache: 'no-store' });
    if (!imgRes.ok) throw new Error(`screenshot ${imgRes.status}`);
    const imgBuf = await imgRes.arrayBuffer();
    const b64 = Buffer.from(imgBuf).toString('base64');
    const dataUri = `data:image/png;base64,${b64}`;
    const cdnUrl = await uploadImageToSubstack(pubUrl, session, dataUri);
    if (cdnUrl) {
      dashScreenshotCdn = cdnUrl;
      coverImageUrl = cdnUrl;
    }
    coverDebug = cdnUrl ? `ok: ${cdnUrl}` : 'upload returned null';
  } catch (e: any) {
    coverDebug = `error: ${e.message || String(e)}`;
  }

  const bodyJson = formatForSubstack(brief, dashScreenshotCdn, phase);

  const draft = await substackCreateDraft(pubUrl, session, title, subtitle, bodyJson, coverImageUrl);
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
      coverDebug,
    });
  }

  return NextResponse.json({
    success: true,
    draftId: draft.id,
    published: false,
    title,
    coverDebug,
    note: 'Draft created. Add ?publish=1 to publish and send to subscribers.',
  });
}

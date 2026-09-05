import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { postToX } from '@/lib/twitter';
import { postToBluesky } from '@/lib/bluesky';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/* ── Weekly "Top Setups of the Week" post ──────────────────────────────────
   Mirrors the Weekly Wrap flow. A Saturday cloud routine writes the prose
   (model output lives in the cloud, never in a Vercel/Anthropic-API call),
   POSTs it here to store in KV, then GET ?publish=1 builds the Substack post,
   attaches a live screenshot of the Daily Setups scanner as the cover,
   publishes, and shares the post link + tags to X and Bluesky.

   send defaults to OFF: publish to the Substack site + archive without emailing
   subscribers. Pass ?send=1 to also email the list.                          */

const KV_KEY = 'top_setups_data';
const DASH_URL = 'app.confluencetradingtools.com';

type Setup = { ticker?: string; heading?: string; body?: string };
type Narrative = {
  title?: string;
  subtitle?: string;
  intro?: string;
  setups?: Setup[];
  takeaway?: string;
  tags?: string[];
  cashtags?: string[];
  hashtags?: string[];
  social?: string;
};

/* ── ProseMirror node builders (self-contained; mirrors the substack route) ── */
function text(t: string, marks?: any[]): any { const n: any = { type: 'text', text: t }; if (marks?.length) n.marks = marks; return n; }
function bold(t: string): any { return text(t, [{ type: 'bold' }]); }
function italic(t: string): any { return text(t, [{ type: 'italic' }]); }
function link(t: string, href: string): any { return text(t, [{ type: 'link', attrs: { href } }]); }
function para(content: any[]): any { return { type: 'paragraph', content }; }
function heading(level: number, t: string): any { return { type: 'heading', attrs: { level }, content: parseInline(t) }; }
function blockquote(content: any[]): any { return { type: 'blockquote', content }; }
function hr(): any { return { type: 'horizontal_rule' }; }

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
function paraText(t: string): any { return para(parseInline(t)); }
function analysisToNodes(raw: string): any[] {
  return String(raw || '')
    .split(/\n\n+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(paraText);
}
function captionedImage(src: string): any {
  return {
    type: 'captionedImage',
    content: [{ type: 'image2', attrs: { src, fullscreen: false, imageSize: 'normal', alt: 'CTT Top Setups board' } }],
  };
}

/* Static CNF explainer — same every week, kept here so the prose stays on-brand
   and the cloud routine never has to regenerate boilerplate. */
const CNF_EXPLAINER = [
  `CNF — short for **Confluence** — is CTT's proprietary conviction score. Every stock gets graded 0 to 100 on a single question: how many things are lining up at once?`,
  `A great setup is never one signal. It's volume confirming the move, relative strength beating the market, a real catalyst behind the tape, price respecting structure, and the broader regime cooperating — all at the same time. CNF measures that stacking effect. The more forces pulling the same direction, the higher the score. **A** is rare, high-conviction alignment. **B** is a strong, tradeable setup. **C** is on the radar but missing a piece.`,
  `One number. Every signal. No guesswork.`,
];

/* ── Substack API (self-contained) ── */
async function substackGetUserId(pubUrl: string, session: string): Promise<number | null> {
  for (const url of [`https://substack.com/api/v1/user/self`, `${pubUrl}/api/v1/publication`]) {
    try {
      const res = await fetch(url, { headers: { Cookie: `substack.sid=${session}` } });
      if (!res.ok) continue;
      const data = await res.json();
      const id = data.id ?? data.author_id ?? data.bylines?.[0]?.id ?? data.authors?.[0]?.id ?? null;
      if (id) return id;
    } catch { continue; }
  }
  return null;
}

// Matches the proven cover path in the substack route: base64 data URI posted
// as a form-urlencoded `image` field. The raw-multipart variant does not upload.
async function uploadCover(pubUrl: string, session: string, buf: ArrayBuffer): Promise<string | null> {
  const dataUri = `data:image/png;base64,${Buffer.from(buf).toString('base64')}`;
  const res = await fetch(`${pubUrl}/api/v1/image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: `substack.sid=${session}` },
    body: `image=${encodeURIComponent(dataUri)}`,
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data.url || null;
}

async function createDraft(pubUrl: string, session: string, title: string, subtitle: string, bodyJson: any, cover?: string, tags?: string[]): Promise<{ id?: number; error?: string }> {
  const uid = await substackGetUserId(pubUrl, session);
  if (!uid) return { error: 'Could not resolve Substack user id' };
  const payload: any = {
    type: 'newsletter',
    draft_title: title,
    draft_subtitle: subtitle,
    draft_body: JSON.stringify(bodyJson),
    draft_bylines: [{ id: uid }],
    audience: 'everyone',
  };
  if (cover) { payload.cover_image = cover; payload.social_image = cover; }
  if (tags?.length) payload.postTags = tags.map(name => ({ name }));
  const res = await fetch(`${pubUrl}/api/v1/drafts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `substack.sid=${session}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { error: `Draft failed (${res.status}): ${(await res.text().catch(() => '')).slice(0, 200)}` };
  const data = await res.json();
  return { id: data.id };
}

async function publishDraft(pubUrl: string, session: string, draftId: number, send: boolean): Promise<{ url?: string; error?: string }> {
  const res = await fetch(`${pubUrl}/api/v1/drafts/${draftId}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `substack.sid=${session}` },
    body: JSON.stringify({ audience: 'everyone', send }),
  });
  if (!res.ok) return { error: `Publish failed (${res.status}): ${(await res.text().catch(() => '')).slice(0, 200)}` };
  const data = await res.json().catch(() => ({} as any));
  const url = data.canonical_url || (data.slug ? `${pubUrl}/p/${data.slug}` : undefined);
  return { url };
}

/* ── Build the Substack ProseMirror body ── */
function buildBody(n: Narrative, coverCdn?: string): any {
  const content: any[] = [];
  if (coverCdn) content.push(captionedImage(coverCdn));
  if (n.intro) content.push(...analysisToNodes(n.intro));

  content.push(heading(3, "What's a CNF Score?"));
  content.push(blockquote(CNF_EXPLAINER.map(paraText)));

  for (const s of n.setups || []) {
    if (s.heading) content.push(heading(3, s.heading));
    if (s.body) content.push(...analysisToNodes(s.body));
  }

  if (n.takeaway) {
    content.push(hr());
    content.push(heading(3, 'The Takeaway'));
    content.push(...analysisToNodes(n.takeaway));
  }

  content.push(hr());
  if (n.cashtags?.length) content.push(para([bold(n.cashtags.join('  '))]));
  content.push(para([link('See the setups live before the bell →', `https://${DASH_URL}`)]));
  content.push(paraText('*Confluence Trading Tools. Analysis only. Not financial advice.*'));
  return { type: 'doc', content };
}

/* ── Compose social text within a char budget ── */
function socialText(n: Narrative, postUrl: string, max: number): string {
  const title = n.title || 'Top Setups of the Week';
  const teaser = (n.social || '').trim();
  const tagLine = [...(n.cashtags || []).slice(0, 4), ...(n.hashtags || []).slice(0, 3)].join(' ');
  const parts = [title];
  if (teaser) parts.push(teaser);
  let head = parts.join('\n\n');
  const tail = `${tagLine}\n${postUrl}`;
  const budget = max - tail.length - 2;
  if (head.length > budget) head = head.slice(0, Math.max(0, budget - 1)).trimEnd() + '…';
  return `${head}\n\n${tail}`;
}

async function fetchCover(origin: string): Promise<ArrayBuffer | null> {
  try {
    // Screenshot the live Daily Setups scanner (expanded). The screenshot route
    // appends _ss=CRON_SECRET for confluencetradingtools.com hosts, which the
    // middleware honors to grant headless access to the gated /scanners page.
    const boardUrl = 'https://app.confluencetradingtools.com/scanners?expand=1';
    const shotUrl = `${origin}/api/og/screenshot?force=1&w=1400&h=1700`
      + `&url=${encodeURIComponent(boardUrl)}`
      + `&selector=${encodeURIComponent('#daily-setups-card')}&minText=200`;
    const res = await fetch(shotUrl, { cache: 'no-store' });
    if (!res.ok || !res.headers.get('content-type')?.includes('image')) return null;
    return await res.arrayBuffer();
  } catch { return null; }
}

function resolveOrigin(req: Request): string {
  try { const u = new URL(req.url); if (u.origin && u.origin !== 'null') return u.origin; } catch { /* */ }
  const h = req.headers;
  const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000';
  const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

/* ── POST: store the generated narrative ── */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Narrative;
    if (!body || !body.title || !Array.isArray(body.setups) || !body.setups.length) {
      return NextResponse.json({ error: 'Missing title or setups' }, { status: 400 });
    }
    await kv.set(KV_KEY, body);
    return NextResponse.json({ success: true, stored: true, setups: body.setups.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Bad request' }, { status: 400 });
  }
}

/* ── GET: preview or publish ── */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const preview = url.searchParams.get('preview') === '1';
  const publish = url.searchParams.get('publish') === '1';
  const send = url.searchParams.get('send') === '1';   // default OFF: no subscriber email
  const force = url.searchParams.get('force') === '1';

  const secret = process.env.CRON_SECRET;
  if (!preview && !force && secret) {
    if ((req.headers.get('authorization') || '') !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const origin = resolveOrigin(req);
  const n = await kv.get<Narrative>(KV_KEY);
  if (!n || !n.setups?.length) {
    return NextResponse.json({ error: 'No top-setups narrative in KV — POST one first' }, { status: 404 });
  }

  if (preview) {
    return NextResponse.json({ title: n.title, subtitle: n.subtitle, setups: n.setups.map(s => s.heading), tags: n.tags, cashtags: n.cashtags, hashtags: n.hashtags });
  }

  const pubUrl = process.env.SUBSTACK_PUB_URL;
  const session = process.env.SUBSTACK_SESSION;
  if (!pubUrl || !session) {
    return NextResponse.json({ error: 'Missing SUBSTACK_PUB_URL or SUBSTACK_SESSION' }, { status: 500 });
  }

  const today = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' }).replace(/\//g, '-');
  const subKey = `substack_sent:topsetups:${today}`;

  // Cover image from the CNF board.
  const coverBuf = await fetchCover(origin);
  const coverCdn = coverBuf ? await uploadCover(pubUrl, session, coverBuf).catch(() => null) : null;

  const title = n.title || 'Top Setups of the Week';
  const subtitle = n.subtitle || 'The highest-confluence setups from this past week.';
  const bodyJson = buildBody(n, coverCdn || undefined);

  const draft = await createDraft(pubUrl, session, title, subtitle, bodyJson, coverCdn || undefined, n.tags);
  if (draft.error || !draft.id) return NextResponse.json({ error: draft.error || 'no draft id' }, { status: 502 });

  if (!publish) {
    return NextResponse.json({ success: true, draftId: draft.id, published: false, coverUploaded: !!coverCdn, note: 'Draft created. Add ?publish=1 to publish.' });
  }

  // Idempotency lock — one publish per ET day, independent of `force`. `force`
  // only bypasses auth (the cloud routine has no secret header); it must never
  // enable a double-publish if the routine retries mid-run.
  const locked = await kv.set(subKey, 1, { nx: true, ex: 86400 });
  if (!locked) return NextResponse.json({ skipped: true, reason: 'Top Setups already published today' });

  const pub = await publishDraft(pubUrl, session, draft.id, send);
  if (pub.error) return NextResponse.json({ draftId: draft.id, published: false, error: pub.error }, { status: 502 });

  const postUrl = pub.url || `https://${DASH_URL}`;

  // Share to X + Bluesky with the post link, tags, and cover image.
  let xRes: any = 'skipped', bskyRes: any = 'skipped';
  try {
    const xText = socialText(n, postUrl, 280);
    const bskyText = socialText(n, postUrl, 300);
    const image = coverBuf ? { data: new Uint8Array(coverBuf) } : undefined;
    const linkPos = bskyText.lastIndexOf(postUrl);
    const facets = linkPos >= 0 ? [{ start: linkPos, end: linkPos + postUrl.length, url: postUrl }] : [];
    const results = await Promise.allSettled([
      postToX(xText, image),
      postToBluesky(bskyText, facets, image ? { data: image.data, alt: 'CTT Top Setups board' } : undefined),
    ]);
    xRes = results[0].status === 'fulfilled' ? (results[0].value ? 'posted' : 'skipped') : `error: ${(results[0] as any).reason?.message || 'failed'}`;
    bskyRes = results[1].status === 'fulfilled' ? (results[1].value ? 'posted' : 'skipped') : `error: ${(results[1] as any).reason?.message || 'failed'}`;
  } catch (e: any) {
    xRes = bskyRes = `error: ${e.message || e}`;
  }

  return NextResponse.json({
    success: true,
    published: true,
    sent: send,
    postUrl,
    coverUploaded: !!coverCdn,
    x: xRes,
    bluesky: bskyRes,
  });
}

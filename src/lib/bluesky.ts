const BSKY_SERVICE = 'https://bsky.social';
/** Scheduled Bluesky posts on/off. Off for an hour on 13 Nov 2026, back ON the same day: the owner
    had mistaken people's comments on our posts for the (stopped) reply bot. See postToBluesky. */
const BLUESKY_POSTING_ON = true;

interface BskySession {
  accessJwt: string;
  did: string;
}

async function createSession(handle: string, password: string): Promise<BskySession> {
  const res = await fetch(`${BSKY_SERVICE}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: handle, password }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Bluesky auth failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return { accessJwt: data.accessJwt, did: data.did };
}

interface LinkFacet {
  start: number;
  end: number;
  url: string;
}

function buildFacets(text: string, links: LinkFacet[]) {
  return links.map((l) => ({
    index: { byteStart: byteIndex(text, l.start), byteEnd: byteIndex(text, l.end) },
    features: [{ $type: 'app.bsky.richtext.facet#link', uri: l.url }],
  }));
}

function byteIndex(text: string, charIndex: number): number {
  return new TextEncoder().encode(text.slice(0, charIndex)).length;
}

async function uploadBlob(session: BskySession, imageData: Buffer | Uint8Array, mimeType = 'image/png') {
  const res = await fetch(`${BSKY_SERVICE}/xrpc/com.atproto.repo.uploadBlob`, {
    method: 'POST',
    headers: {
      'Content-Type': mimeType,
      Authorization: `Bearer ${session.accessJwt}`,
    },
    body: imageData as unknown as BodyInit,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Bluesky blob upload failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return data.blob;
}

export async function postToBluesky(
  text: string,
  links: LinkFacet[] = [],
  image?: { data: Buffer | Uint8Array; alt: string; mimeType?: string },
  /* A link card. An image embed opens the image; only an external embed makes
     the whole card click through to a URL, which is the difference between a
     post people look at and one that sends them somewhere. When both are
     given the card wins, and the image becomes its thumbnail. */
  external?: {
    uri: string;
    title: string;
    description?: string;
    thumb?: { data: Buffer | Uint8Array; mimeType?: string };
  },
): Promise<{ uri: string; cid: string } | null> {
  /* Kill switch (13 Nov 2026). Every Bluesky post — phase/session posts, Scorecard, Top Setups,
     Weekly Wrap — goes through here, so BLUESKY_POSTING_ON = false stops them all. X, Substack,
     emails and the Bluesky READ for Social Sentiment never pass through it. Off returns null,
     the same as missing credentials, which every caller handles. The reply/follow bot is a
     separate local script (CTT/bsky-bot), stopped since 11 Nov — not this. */
  if (!BLUESKY_POSTING_ON) {
    console.log('[bluesky] posting is off — skipped');
    return null;
  }
  const handle = process.env.BLUESKY_HANDLE;
  const password = process.env.BLUESKY_APP_PASSWORD;
  if (!handle || !password) return null;

  const session = await createSession(handle, password);

  const record: any = {
    $type: 'app.bsky.feed.post',
    text,
    createdAt: new Date().toISOString(),
  };

  if (links.length) {
    record.facets = buildFacets(text, links);
  }

  if (external?.uri) {
    const thumbSrc = external.thumb ?? (image ? { data: image.data, mimeType: image.mimeType } : null);
    const thumb = thumbSrc ? await uploadBlob(session, thumbSrc.data, thumbSrc.mimeType) : undefined;
    record.embed = {
      $type: 'app.bsky.embed.external',
      external: {
        uri: external.uri,
        title: external.title,
        description: external.description || '',
        ...(thumb ? { thumb } : {}),
      },
    };
  } else if (image) {
    const blob = await uploadBlob(session, image.data, image.mimeType);
    record.embed = {
      $type: 'app.bsky.embed.images',
      images: [{ alt: image.alt, image: blob }],
    };
  }

  const res = await fetch(`${BSKY_SERVICE}/xrpc/com.atproto.repo.createRecord`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessJwt}`,
    },
    body: JSON.stringify({
      repo: session.did,
      collection: 'app.bsky.feed.post',
      record,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Bluesky post failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return { uri: data.uri, cid: data.cid };
}

/* Cashtag search for Social Sentiment (lib/sentiment). The public AppView
   refuses anonymous searchPosts (403), so this signs in as the site's account
   — one session per run, then one search per name. Returns the texts of posts
   from the last `hours`, up to 100 per name; null when not configured or the
   sign-in fails, so the card can say Bluesky is unavailable. */
export async function blueskyCashtagPosts(tickers: string[], hours = 24): Promise<Map<string, string[]> | null> {
  const handle = process.env.BLUESKY_HANDLE;
  const password = process.env.BLUESKY_APP_PASSWORD;
  if (!handle || !password) return null;
  let session: BskySession;
  try { session = await createSession(handle, password); } catch { return null; }
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const out = new Map<string, string[]>();
  for (let i = 0; i < tickers.length; i += 5) {
    await Promise.all(tickers.slice(i, i + 5).map(async t => {
      const url = `${BSKY_SERVICE}/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent('$' + t)}&sort=latest&limit=100&since=${encodeURIComponent(since)}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${session.accessJwt}` }, cache: 'no-store', signal: AbortSignal.timeout(10000) }).catch(() => null);
      const j = res?.ok ? await res.json().catch(() => null) : null;
      // The search matches the word as well as the cashtag; keep posts that carry the cashtag itself.
      const rx = new RegExp(`\\$${t}\\b`, 'i');
      out.set(t, (j?.posts ?? []).map((p: { record?: { text?: string } }) => String(p?.record?.text ?? '')).filter((s: string) => rx.test(s)));
    }));
  }
  return out;
}

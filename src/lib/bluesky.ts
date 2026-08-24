const BSKY_SERVICE = 'https://bsky.social';

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
): Promise<{ uri: string; cid: string } | null> {
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

  if (image) {
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

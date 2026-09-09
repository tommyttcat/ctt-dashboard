/* The generated cover, prepared for the places it gets shown.
 *
 * Two routes need the same three steps and used to have their own partial
 * copies: /api/email/substack (the Substack post cover) and
 * /api/email/briefing (the Bluesky link-card thumbnail). Only the Substack
 * side stamped the logo, so the same poster went out branded in one place and
 * bare in the other. */

export async function fetchImageBytes(u?: string | null): Promise<Uint8Array | undefined> {
  try {
    if (!u) return undefined;
    const r = await fetch(u, { cache: 'no-store' });
    if (!r.ok || !(r.headers.get('content-type') || '').startsWith('image/')) return undefined;
    return new Uint8Array(await r.arrayBuffer());
  } catch { return undefined; }
}

/* The logo goes bottom-right at 7.5% of frame height with a 4.5% margin. The
   image generator is told to leave that corner empty for exactly this reason —
   an earlier cover put the domain there and the mark landed on top of it.
   Returns the original bytes unchanged on any failure: a cover without the
   logo is worth publishing, a failed publish is not. */
export async function stampLogo(image: Buffer | Uint8Array): Promise<Buffer> {
  const input = Buffer.from(image);
  try {
    const sharp = (await import('sharp')).default;
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const logoPath = path.join(process.cwd(), 'public', 'logo-mark.png');
    const logo = await fs.readFile(logoPath).catch(() => null);
    if (!logo) return input;

    const meta = await sharp(input).metadata();
    const W = meta.width ?? 0;
    const H = meta.height ?? 0;
    if (!W || !H) return input;

    const targetH = Math.round(H * 0.075);
    const mark = await sharp(logo).resize({ height: targetH }).png().toBuffer();
    const markMeta = await sharp(mark).metadata();
    const margin = Math.round(H * 0.045);

    return await sharp(input)
      .composite([{
        input: mark,
        left: W - (markMeta.width ?? targetH) - margin,
        top: H - targetH - margin,
      }])
      .png()
      .toBuffer();
  } catch {
    return input;
  }
}

/* Social image budget: Bluesky rejects blobs over 1 MB-ish (hard cap 2 MB) and
   X over 5 MB. Generated covers arrive as 5-7 MB PNGs, so downscale to a
   1600px JPEG before posting. Falls back to the original bytes if sharp fails. */
export async function socialImage(bytes?: Uint8Array | Buffer): Promise<{ data: Uint8Array; mimeType: string } | undefined> {
  if (!bytes) return undefined;
  try {
    const sharp = (await import('sharp')).default;
    const out = await sharp(Buffer.from(bytes)).resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    return { data: new Uint8Array(out), mimeType: 'image/jpeg' };
  } catch {
    return { data: new Uint8Array(Buffer.from(bytes)), mimeType: 'image/png' };
  }
}

/* Fetch, stamp, downscale — what a social post wants from a cover URL. */
export async function posterForSocial(coverUrl?: string | null): Promise<{ data: Uint8Array; mimeType: string } | undefined> {
  const raw = await fetchImageBytes(coverUrl);
  if (!raw) return undefined;
  return socialImage(await stampLogo(raw));
}

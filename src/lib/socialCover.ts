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

/* The image generator is told to leave the bottom-right corner empty and does
   not reliably obey. On 9 Sep 2026 the 8:45 run came back clean and a later one
   drew a pure-black rectangle over the whole bottom-right quadrant — invisible
   in isolation, obvious in a feed once the logo sits inside its edge. Tightening
   the wording moved the odds and did not settle them, so the corner is repaired
   here instead.

   Per-pixel, not per-region, which is what makes it safe: the poster's content
   is BRIGHTER than its background (white and accent headline, cyan rule) while
   the spurious box is DARKER. Repainting only pixels darker than the background
   erases the box and cannot touch a letter. Restricted to the corner the design
   reserves, and skipped entirely unless the poster is dark, so it can never
   damage a layout it was not written for. */
async function cleanReservedCorner(sharp: any, input: Buffer, W: number, H: number): Promise<Buffer> {
  const { data: small } = await sharp(input).resize({ width: 64 }).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const counts = new Map<string, number>();
  for (let i = 0; i < small.length; i += 3) {
    const k = `${small[i]},${small[i + 1]},${small[i + 2]}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let bgKey = '', best = -1;
  for (const [k, n] of counts) if (n > best) { best = n; bgKey = k; }
  const bg = bgKey.split(',').map(Number);
  const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const bgLum = lum(bg[0], bg[1], bg[2]);
  if (bgLum > 60) return input; // not the dark poster this was written for

  const rx = Math.floor(W * 0.68);
  const ry = Math.floor(H * 0.46);
  const rw = W - rx;
  const rh = H - ry;
  if (rw < 8 || rh < 8) return input;

  const { data: reg, info } = await sharp(input)
    .extract({ left: rx, top: ry, width: rw, height: rh })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let repainted = 0;
  for (let i = 0; i < reg.length; i += 3) {
    if (lum(reg[i], reg[i + 1], reg[i + 2]) < bgLum - 4) {
      reg[i] = bg[0]; reg[i + 1] = bg[1]; reg[i + 2] = bg[2];
      repainted++;
    }
  }
  if (!repainted) return input;

  const patch = await sharp(reg, { raw: { width: info.width, height: info.height, channels: 3 } })
    .png().toBuffer();
  return await sharp(input).composite([{ input: patch, left: rx, top: ry }]).png().toBuffer();
}

/* The logo goes bottom-right at 7.5% of frame height with a 4.5% margin, onto a
   corner the step above has just guaranteed is clean. Returns the original bytes
   unchanged on any failure: a cover without the logo is worth publishing, a
   failed publish is not. */
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

    const cleaned = await cleanReservedCorner(sharp, input, W, H).catch(() => input);

    const targetH = Math.round(H * 0.075);
    const mark = await sharp(logo).resize({ height: targetH }).png().toBuffer();
    const markMeta = await sharp(mark).metadata();
    const margin = Math.round(H * 0.045);

    return await sharp(cleaned)
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

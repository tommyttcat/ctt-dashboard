import crypto from 'crypto';

const API_URL = 'https://api.twitter.com/2/tweets';
const UPLOAD_URL = 'https://upload.twitter.com/1.1/media/upload.json';

function percentEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function oauthHeader(method: string, url: string, params: Record<string, string> = {}): string {
  const consumerKey = process.env.X_API_KEY!;
  const consumerSecret = process.env.X_API_SECRET!;
  const token = process.env.X_ACCESS_TOKEN!;
  const tokenSecret = process.env.X_ACCESS_TOKEN_SECRET!;

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: token,
    oauth_version: '1.0',
  };

  const allParams = { ...oauthParams, ...params };
  const paramString = Object.keys(allParams)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(allParams[k])}`)
    .join('&');

  const baseString = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');

  oauthParams.oauth_signature = signature;

  const header = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(', ');

  return `OAuth ${header}`;
}

async function uploadMedia(imageData: Buffer | Uint8Array): Promise<string> {
  const b64 = Buffer.from(imageData).toString('base64');
  const params = { media_data: b64 };
  const auth = oauthHeader('POST', UPLOAD_URL, params);

  const body = new URLSearchParams(params);
  const res = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`X media upload failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  return data.media_id_string;
}

export async function postToX(
  text: string,
  image?: { data: Buffer | Uint8Array },
): Promise<{ id: string } | null> {
  const hasKeys = process.env.X_API_KEY && process.env.X_API_SECRET &&
    process.env.X_ACCESS_TOKEN && process.env.X_ACCESS_TOKEN_SECRET;
  if (!hasKeys) return null;

  const tweetBody: any = { text };

  if (image) {
    const mediaId = await uploadMedia(image.data);
    tweetBody.media = { media_ids: [mediaId] };
  }

  const body = JSON.stringify(tweetBody);
  const auth = oauthHeader('POST', API_URL, {});

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
    },
    body,
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`X post failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  return { id: data.data?.id };
}

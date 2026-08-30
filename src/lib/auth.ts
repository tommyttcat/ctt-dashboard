const SECRET = () => process.env.AUTH_SECRET || 'dev-secret-change-in-production';

function base64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signToken(payload: Record<string, unknown>): Promise<string> {
  const key = await hmacKey();
  const data = base64url(new TextEncoder().encode(JSON.stringify(payload)).buffer as ArrayBuffer);
  const sig = base64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
  return `${data}.${sig}`;
}

export async function verifyToken<T = Record<string, unknown>>(token: string): Promise<T | null> {
  try {
    const dot = token.indexOf('.');
    if (dot < 0) return null;
    const data = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const key = await hmacKey();
    const valid = await crypto.subtle.verify(
      'HMAC', key, fromBase64url(sig) as unknown as BufferSource, new TextEncoder().encode(data),
    );
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(data)));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload as T;
  } catch {
    return null;
  }
}

export interface Session {
  email: string;
  name: string;
  tier: 'starter' | 'indicators' | 'core' | 'core-max' | 'pro' | 'pro-max' | 'trial_7' | 'trial_14' | 'trial_30';
  isAdmin: boolean;
  exp: number;
  accessExpiresAt?: string;
}

const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes

export async function createMagicToken(email: string): Promise<string> {
  return signToken({ email, purpose: 'magic', exp: Date.now() + MAGIC_LINK_TTL_MS });
}

export async function verifyMagicToken(token: string): Promise<string | null> {
  const payload = await verifyToken<{ email: string; purpose: string }>(token);
  if (!payload || payload.purpose !== 'magic') return null;
  return payload.email;
}

export async function createSessionToken(user: {
  email: string; name: string; tier: Session['tier']; isAdmin: boolean; accessExpiresAt?: string;
}): Promise<string> {
  return signToken({
    email: user.email,
    name: user.name,
    tier: user.tier,
    isAdmin: user.isAdmin,
    exp: Date.now() + SESSION_TTL_MS,
    ...(user.accessExpiresAt ? { accessExpiresAt: user.accessExpiresAt } : {}),
  });
}

export async function verifySession(cookieValue: string | undefined): Promise<Session | null> {
  if (!cookieValue) return null;
  return verifyToken<Session>(cookieValue);
}

export const SESSION_COOKIE = 'ctt-session';
export const SESSION_MAX_AGE = Math.floor(SESSION_TTL_MS / 1000);
